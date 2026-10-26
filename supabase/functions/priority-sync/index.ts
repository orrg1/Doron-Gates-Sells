// ─── Priority → server sync (runs without the website open) ─────────────
// A sync is a job (table public.sync_jobs) made of small steps: items, customers,
// open POs, and one step per form per month of invoices. Each invocation ("tick")
// claims the job, runs steps for ~80 seconds, saves what it pulled to storage,
// and stops — the next tick continues. So a full 24-month sync is split over a
// few runs and never hits the 150-second limit. The last step merges everything
// into the same stored data the website reads (app_state + datasets).
//
// Who calls it:
//   • the website (signed-in, allowed user): { action:'start', kind:'incremental'|'full' } and { action:'tick' }
//   • pg_cron with the shared secret: { action:'tick' } every minute while a job is open,
//     { action:'nightly' } at 19:00 and 20:00 UTC — it only starts a job when it is 22:00 in Israel,
//     { action:'weekly' } Sundays at 04:00 and 05:00 UTC — sends the summary email when it is 07:00 in Israel.
//   • the website: { action:'digest', send?:true } — preview the weekly email (or send it now).
// Priority is only ever read (GET).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { SYNC_FORMS, describeFromMetadata, planSteps, runStep, finalizeSync, MissingFieldError, OVERLAP_DAYS, buildDigest, renderDigestHtml } from 'https://raw.githubusercontent.com/orrg1/Doron-Gates-Sells/e7b3fb72b9d8c12a703407be86360f12e19554b8/supabase/functions/priority-sync/core.js'; // pinned commit of the shared core (scripts/copy-core.sh)

const ROOT = (Deno.env.get('PRIORITY_ROOT') || 'https://p.priority-connect.online/odata/Priority/tabA974E.ini/gate').replace(/\/+$/, '');
const PAT = Deno.env.get('PRIORITY_PAT') || '';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const STEP_BUDGET_MS = 80_000;   // stop starting new steps after this
const PARALLEL = 4;              // steps in flight at once
const LEASE_S = 140;
const MAX_ATTEMPTS = 3;
const SCHEMA_TTL = 7 * 86400000;
const BY = 'Priority (סנכרון שרת)';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

// ── Priority (read only) ──
const auth = () => 'Basic ' + btoa(`${PAT}:PAT`);
async function priorityGet(path: string) {
  const res = await fetch(`${ROOT}/${path}`, { method: 'GET', headers: { Authorization: auth(), Accept: 'application/json' } });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { /* xml */ }
  if (!res.ok) throw new Error(data?.error?.message || data?.FORM?.InterfaceErrors?.text || text.slice(0, 300) || `HTTP ${res.status}`);
  return { data, text };
}
async function query(form: string, opts: Record<string, string>) {
  const params: Record<string, string> = {};
  for (const k of ['select', 'filter', 'expand', 'orderby']) if (opts[k]) params['$' + k] = opts[k];
  const out: any[] = []; let skip = 0;
  for (let guard = 0; guard < 400; guard++) {
    const qs = new URLSearchParams({ ...params, $top: '500', $skip: String(skip) });
    const r = await priorityGet(`${form}?${qs.toString().replace(/\+/g, '%20')}`);
    const page = Array.isArray(r.data?.value) ? r.data.value : [];
    out.push(...page); skip += page.length;
    if (page.length < 500) break;
  }
  return out;
}

// ── stored state (same format the website writes) ──
const gzip = async (str: string) => new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzip = async (blob: Blob) => new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
async function readDataset(key: string) {
  const { data: row } = await sb.from('datasets').select('path').eq('key', key).maybeSingle();
  if (!row) return null;
  const { data: blob, error } = await sb.storage.from('datasets').download(row.path);
  if (error || !blob) return null;
  const text = row.path.endsWith('.gz') ? await gunzip(blob) : await blob.text();
  return JSON.parse(text);
}
async function writeDataset(key: string, value: unknown) {
  const body = await gzip(JSON.stringify(value));
  const path = `${key}.json.gz`;
  const up = await sb.storage.from('datasets').upload(path, body, { upsert: true, contentType: 'application/gzip', cacheControl: '0' });
  if (up.error) throw up.error;
  const { error } = await sb.from('datasets').upsert({ key, path, bytes: body.length, rows: Array.isArray(value) ? value.length : null, updated_at: new Date().toISOString(), updated_by: BY });
  if (error) throw error;
}
// app_state values are what localStorage holds: plain strings stay strings, the rest JSON.
const STRING_KEYS = new Set(['inventoryFileName', 'ordersFileName']);
async function readState(keys: string[]) {
  const { data } = await sb.from('app_state').select('key,value').in('key', keys);
  const out: Record<string, any> = {};
  (data || []).forEach((r: any) => { try { out[r.key] = STRING_KEYS.has(r.key) ? r.value : JSON.parse(r.value); } catch { out[r.key] = r.value; } });
  return out;
}
async function writeState(obj: Record<string, unknown>) {
  const now = new Date().toISOString();
  const rows = Object.entries(obj).map(([key, v]) => ({ key, value: typeof v === 'string' ? v : JSON.stringify(v), updated_at: now, updated_by: BY }));
  if (rows.length) { const { error } = await sb.from('app_state').upsert(rows); if (error) throw error; }
}
const stagePath = (jobId: number, stepId: string) => `sync-staging/${jobId}/${stepId.replace(/[^\w.-]/g, '_')}.json.gz`;
async function putStage(jobId: number, stepId: string, payload: unknown) {
  const up = await sb.storage.from('datasets').upload(stagePath(jobId, stepId), await gzip(JSON.stringify(payload)), { upsert: true, contentType: 'application/gzip' });
  if (up.error) throw up.error;
}
async function getStage(jobId: number, stepId: string) {
  const { data, error } = await sb.storage.from('datasets').download(stagePath(jobId, stepId));
  if (error || !data) throw new Error(`staged data missing for ${stepId}`);
  return JSON.parse(await gunzip(data));
}
async function clearStage(jobId: number, stepIds: string[]) {
  const paths = stepIds.map(id => stagePath(jobId, id));
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from('datasets').remove(paths.slice(i, i + 100));
}

// ── field lists (cached 7 days in app_state, shared with the website) ──
async function loadSchema(force = false) {
  if (!force) {
    const s = (await readState(['prioritySchema'])).prioritySchema;
    const ok = s && s.forms && Date.now() - s.at < SCHEMA_TTL && SYNC_FORMS.every((f: string) => s.forms[f])
      && s.forms.PORDERS?.subforms && Object.keys(s.forms.PORDERS.subforms).some((n: string) => n.startsWith('DOCTODOLISTLOG'));
    if (ok) return s.forms;
  }
  const { text } = await priorityGet('$metadata');
  const forms: Record<string, unknown> = {};
  for (const f of SYNC_FORMS) forms[f] = describeFromMetadata(text, f) || { error: `form ${f} is not open for API (not in $metadata)` };
  await writeState({ prioritySchema: { at: Date.now(), forms } });
  return forms;
}

// ── jobs ──
const pool = async <T,>(items: T[], limit: number, fn: (x: T) => Promise<void>) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
};
const addLog = (job: any, line: string) => { job.log = [...(job.log || []), `${new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${line}`].slice(-200); };
async function saveJob(job: any, extra: Record<string, unknown> = {}) {
  const { error } = await sb.from('sync_jobs').update({ steps: job.steps, log: job.log, plan: job.plan, updated_at: new Date().toISOString(), ...extra }).eq('id', job.id);
  if (error) throw error;
}

async function createJob(kind: 'incremental' | 'full', trigger: string, by: string) {
  const { data: open } = await sb.from('sync_jobs').select('*').in('status', ['queued', 'running']).order('id').limit(1);
  if (open && open.length) return { job: open[0], existing: true };
  // what to pull: incremental re-reads the last OVERLAP_DAYS; a slot with no data yet is pulled in full
  const st = await readState(['prioritySyncThrough']);
  const { data: sets } = await sb.from('datasets').select('key,rows').in('key', ['procSalesLines', 'procPurchaseLines', 'procPoMeta']);
  const has = (k: string) => (sets || []).some((s: any) => s.key === k && (s.rows ?? 1) > 0);
  const through = st.prioritySyncThrough || {};
  const sinceFor = (slot: string, key: string) => {
    if (kind === 'full' || !has(key) || !through[slot]) return null;
    const d = new Date(through[slot] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - OVERLAP_DAYS);
    return d.toISOString().slice(0, 10);
  };
  const since = { salesLines: sinceFor('salesLines', 'procSalesLines'), purchaseLines: sinceFor('purchaseLines', 'procPurchaseLines') };
  const { steps, sSince, pSince } = planSteps({ since, poFull: kind === 'full' || !(sets || []).some((x: any) => x.key === 'procPoMeta') });
  const job: any = { kind, trigger, requested_by: by, steps: steps.map((s: any) => ({ ...s, done: false, attempts: 0 })), plan: { since, sSince, pSince }, log: [] };
  addLog(job, since.salesLines ? `סנכרון מהיר — חשבוניות מ-${since.salesLines} ואילך (${steps.length} חלקים)` : `סנכרון מלא — ${sSince} עד היום (${steps.length} חלקים)`);
  const { data, error } = await sb.from('sync_jobs').insert(job).select('*').single();
  if (error) throw error;
  return { job: data, existing: false };
}

async function tick() {
  const started = Date.now();
  const { data: claimed, error } = await sb.rpc('claim_sync_job', { p_lease: LEASE_S });
  if (error) throw error;
  const job: any = claimed && claimed[0];
  if (!job) return { idle: true };
  try {
    let forms: any = null;
    let schemaRefreshed = false;
    const pending = job.steps.filter((s: any) => !s.done && !s.failed);
    if (pending.length) {
      forms = await loadSchema();
      await pool(pending, PARALLEL, async (step: any) => {
        if (Date.now() - started > STEP_BUDGET_MS) return;
        try {
          let payload;
          try { payload = await runStep(step, { forms, query }); }
          catch (e) {
            if (!(e instanceof MissingFieldError) || schemaRefreshed) throw e;
            schemaRefreshed = true; forms = await loadSchema(true);
            payload = await runStep(step, { forms, query });
          }
          await putStage(job.id, step.id, payload);
          step.done = true;
          if (payload?.skipped && !job.log.some((l: string) => l.includes(payload.skipped))) addLog(job, payload.skipped);
        } catch (e) {
          step.attempts = (step.attempts || 0) + 1;
          step.lastError = String((e as Error).message || e).slice(0, 300);
          if (step.attempts >= MAX_ATTEMPTS) { step.failed = step.lastError; addLog(job, `${step.id}: נכשל — ${step.lastError}`); }
        }
      });
      const done = job.steps.filter((s: any) => s.done).length;
      addLog(job, `התקדמות: ${done}/${job.steps.length} חלקים`);
      await saveJob(job);
    }
    const left = job.steps.filter((s: any) => !s.done && !s.failed).length;
    // Merge only with enough time left in this run; otherwise the next run does it.
    if (!left && Date.now() - started < 60_000) {
      addLog(job, 'ממזג את הנתונים…');
      const doneSteps = job.steps.filter((s: any) => s.done);
      const payloads: Record<string, unknown> = {};
      await pool(doneSteps, 8, async (s: any) => { payloads[s.id] = await getStage(job.id, s.id); });
      const failed: Record<string, string> = {};
      job.steps.filter((s: any) => s.failed).forEach((s: any) => { failed[s.id] = s.failed; });
      const prevState = await readState(['procurementStock', 'procurementCost', 'procurementMinStock', 'procurementSupplier', 'procurementMOQ', 'procurementCurrency',
        'procurementNames', 'procurementCostHistory', 'procurementInvSlots', 'openOrders', 'procurementReceiptLog', 'procurementDraftQty', 'procFilesMeta', 'prioritySyncThrough']);
      const prevSets: Record<string, unknown> = {};
      for (const k of ['procSalesLines', 'procPurchaseLines', 'procPoMeta', 'stockHistory']) prevSets[k] = await readDataset(k);
      const res = finalizeSync({ prev: { appState: prevState, datasets: prevSets }, payloads, failed, since: job.plan.since, sSince: job.plan.sSince, pSince: job.plan.pSince });
      for (const [k, v] of Object.entries(res.datasets)) await writeDataset(k, v);
      await writeState(res.appState);
      res.log.forEach((l: string) => addLog(job, l));
      const hadFailures = Object.keys(failed).length > 0;
      addLog(job, hadFailures ? `הסתיים עם ${Object.keys(failed).length} חלקים שנכשלו — מה שנכשל לא עודכן` : `הסתיים בהצלחה (${Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000)} שנ׳)`);
      await saveJob(job, { status: 'done', finished_at: new Date().toISOString(), lease_until: null, error: hadFailures ? 'partial' : null });
      await clearStage(job.id, job.steps.map((s: any) => s.id)).catch(() => {});
      return { done: true, id: job.id };
    }
    await saveJob(job, { lease_until: null });
    return { progress: true, id: job.id, left };
  } catch (e) {
    addLog(job, `שגיאה: ${(e as Error).message || e}`);
    // a job that keeps failing as a whole is closed so it does not block the next one
    const fails = (job.plan?.tickFailures || 0) + 1;
    job.plan = { ...(job.plan || {}), tickFailures: fails };
    await saveJob(job, fails >= 5 ? { status: 'error', error: String((e as Error).message || e), finished_at: new Date().toISOString(), lease_until: null } : { lease_until: null }).catch(() => {});
    throw e;
  }
}

// ── weekly summary email (Resend) ──
const SITE_URL = 'https://orrg1.github.io/Doron-Gates-Sells/';
async function digestData() {
  const app = await readState(['procurementStock', 'procurementSupplier', 'procurementCost', 'procurementCurrency', 'exchangeRates', 'openOrders', 'procShipSupplierMap',
    'procOutlierDecisions', 'procurementLeadTime', 'procLeadAddTransit', 'excludeCurrentMonth', 'procSkipStockoutMonths', 'procurementMinStock', 'procurementCostHistory',
    'procurementMOQ', 'procurementNames', 'prioritySyncAt']);
  const sets: Record<string, unknown> = {};
  for (const k of ['procSalesLines', 'procPurchaseLines', 'procShipments', 'stockHistory', 'procPoMeta', 'procItemsExtra', 'dashboardSalesData']) sets[k] = await readDataset(k);
  return buildDigest({ app, sets });
}
async function sendDigest(by: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY secret is not set on the server');
  const to = (Deno.env.get('DIGEST_TO') || 'or@doron-gates.com').split(',').map(x => x.trim()).filter(Boolean);
  const d = await digestData();
  const html = renderDigestHtml(d, { siteUrl: SITE_URL });
  const subject = `סיכום שבועי — ${d.toOrderNow} מוצרים להזמין${d.latePOLines ? ` · ${d.latePOLines} שורות באיחור` : ''}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('DIGEST_FROM') || 'BizData <onboarding@resend.dev>', to, subject, html }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.message || `Resend HTTP ${res.status}`);
  await writeState({ digestSentAt: { at: new Date().toISOString(), by, id: out?.id || null, to } });
  return { sent: true, id: out?.id, to };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const action = body.action || 'tick';

  // caller: scheduler (secret) or a signed-in allowed user
  let caller = '';
  const secret = req.headers.get('x-sync-secret');
  if (secret) {
    const { data: s } = await sb.rpc('get_sync_secret');
    if (!s || s !== secret) return json({ error: 'bad secret' }, 403);
    caller = 'scheduler';
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt);
    const email = (u?.user?.email || '').toLowerCase();
    if (!email) return json({ error: 'not signed in' }, 401);
    const { data: allowed } = await sb.from('allowed_users').select('email').eq('email', email).maybeSingle();
    if (!allowed) return json({ error: 'user not allowed' }, 403);
    caller = email;
  }
  if (!PAT) return json({ error: 'PRIORITY_PAT secret is not set on the server' }, 500);

  try {
    if (action === 'start') {
      if (caller === 'scheduler') return json({ error: 'not allowed' }, 403);
      const r = await createJob(body.kind === 'full' ? 'full' : 'incremental', 'manual', caller);
      return json({ id: r.job.id, existing: r.existing });
    }
    if (action === 'nightly') {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(new Date()));
      if (hour !== 22 && !body.force) return json({ skipped: `not 22:00 in Israel (now ${hour}:00)` });
      const { data: recent } = await sb.from('sync_jobs').select('id').eq('trigger', 'nightly').gte('created_at', new Date(Date.now() - 3 * 3600_000).toISOString()).limit(1);
      if (recent && recent.length) return json({ skipped: 'nightly job already created' });
      const r = await createJob('incremental', 'nightly', 'scheduler');
      return json({ id: r.job.id, existing: r.existing, tick: await tick() });
    }
    if (action === 'tick') return json(await tick());
    if (action === 'digest') {
      if (body.send) return json(await sendDigest(caller));
      const d = await digestData();
      return json({ html: renderDigestHtml(d, { siteUrl: SITE_URL }) });
    }
    if (action === 'weekly') {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(new Date());
      const wd = parts.find(p => p.type === 'weekday')?.value, hour = Number(parts.find(p => p.type === 'hour')?.value);
      if ((wd !== 'Sun' || hour !== 7) && !body.force) return json({ skipped: `not Sunday 07:00 in Israel (${wd} ${hour}:00)` });
      const last = (await readState(['digestSentAt'])).digestSentAt;
      if (last?.at && Date.now() - new Date(last.at).getTime() < 20 * 3600_000 && !body.force) return json({ skipped: 'already sent' });
      return json(await sendDigest('scheduler'));
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
