// ─── Priority read-only proxy ────────────────────────────────────────
// The browser never sees the Priority token. It calls this function with its
// Supabase session; the function checks the user is in allowed_users and then
// talks to Priority with GET requests ONLY — nothing here can create, change
// or delete data in Priority, whatever the browser sends.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   PRIORITY_PAT   the token from "אסימוני אימות לממשקי REST"   (required)
//   PRIORITY_ROOT  service root, defaults to the value below      (optional)
//
// Body (JSON, POST from the app):
//   { action: 'query', form, select?, filter?, expand?, orderby?, maxRows? }
//   { action: 'describe', form }   → field + subform names of a form
//   { action: 'describe', forms:[] } → the same for several forms, one $metadata download
//   { action: 'ping' }             → checks the token works
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const DEFAULT_ROOT = 'https://p.priority-connect.online/odata/Priority/tabA974E.ini/gate';
const ROOT = (Deno.env.get('PRIORITY_ROOT') || DEFAULT_ROOT).replace(/\/+$/, '');
const PAT = Deno.env.get('PRIORITY_PAT') || '';

// Only these forms can be read through the proxy.
const ALLOWED_FORMS = new Set([
  'LOGPART', 'PARTBAL', 'ACCBAL', 'ACCBALSON', 'WARHSBAL',
  'PORDERS', 'DOCUMENTS_P',
  'AINVOICES', 'CINVOICES', 'YINVOICES',
  'ORDERS', 'CUSTOMERS', 'SUPPLIERS', 'FAMILY_LOG',
]);
const PAGE = 500;               // rows per Priority request (MAXAPILINES default is 2000)
const HARD_MAX = 60000;         // never pull more than this in one call
const TIME_BUDGET_MS = 110_000; // stop paging well before the 150s platform limit; the app continues from nextSkip

// $metadata describes the whole Priority system (several MB, ~30s to download).
// Keep the last copy for an hour in this warm instance instead of re-downloading per form.
let metaCache: { text: string; at: number } | null = null;
async function getMetadata(): Promise<{ ok: boolean; text: string; err?: string; status?: number }> {
  if (metaCache && Date.now() - metaCache.at < 3600_000) return { ok: true, text: metaCache.text };
  const r = await priorityGet('$metadata');
  if (!r.ok) return { ok: false, text: '', err: priorityError(r), status: r.status };
  metaCache = { text: r.text, at: Date.now() };
  return { ok: true, text: r.text };
}
const ODATA_OPT = /^[\w\s,.;'()\-:/$=<>!*"א-ת]*$/; // plain OData option text only

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

const authHeader = () => 'Basic ' + btoa(`${PAT}:PAT`);

async function priorityGet(path: string): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const res = await fetch(`${ROOT}/${path}`, { method: 'GET', headers: { Authorization: authHeader(), Accept: 'application/json' } });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* XML ($metadata) or empty */ }
  return { ok: res.ok, status: res.status, data, text };
}

const priorityError = (r: { status: number; data: any; text: string }) =>
  r.data?.error?.message || r.data?.FORM?.InterfaceErrors?.text || r.text.slice(0, 300) || `HTTP ${r.status}`;

// $metadata is XML: pull the fields of one entity type, and of each of its
// subforms (navigation properties such as PORDERITEMS_SUBFORM).
function entityFields(xml: string, type: string) {
  const m = xml.match(new RegExp(`<EntityType Name="${type}"[^>]*>([\\s\\S]*?)</EntityType>`));
  if (!m) return null;
  const body = m[1];
  const fields = [...body.matchAll(/<Property Name="([^"]+)" Type="([^"]+)"/g)].map(x => x[1]);
  const nav = [...body.matchAll(/<NavigationProperty Name="([^"]+)" Type="([^"]+)"/g)]
    .map(x => ({ name: x[1], type: x[2].replace(/^Collection\(/, '').replace(/\)$/, '').split('.').pop() || '' }));
  return { fields, nav };
}
function describeFromMetadata(xml: string, form: string) {
  const top = entityFields(xml, form);
  if (!top) return null;
  const subforms: Record<string, string[]> = {};
  for (const n of top.nav) subforms[n.name] = entityFields(xml, n.type)?.fields || [];
  return { fields: top.fields, subforms };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // ── who is calling ──
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  const email = (u?.user?.email || '').toLowerCase();
  if (ue || !email) return json({ error: 'not signed in' }, 401);
  const { data: allowed } = await admin.from('allowed_users').select('email').eq('email', email).maybeSingle();
  if (!allowed) return json({ error: 'user not allowed' }, 403);

  if (!PAT) return json({ error: 'PRIORITY_PAT secret is not set on the server' }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad JSON body' }, 400); }
  const action = body.action || 'query';

  if (action === 'ping') {
    const r = await priorityGet('CUSTOMERS?$top=1&$select=CUSTNAME');
    return json({ ok: r.ok, status: r.status, error: r.ok ? null : priorityError(r) }, r.ok ? 200 : 502);
  }

  if (action === 'describe' && Array.isArray(body.forms)) {
    const forms = body.forms.map(String).filter((f: string) => ALLOWED_FORMS.has(f));
    const m = await getMetadata();
    if (!m.ok) return json({ error: m.err, status: m.status }, 502);
    const out: Record<string, unknown> = {};
    for (const f of forms) out[f] = describeFromMetadata(m.text, f) || { error: `form ${f} is not open for API (not in $metadata)` };
    return json({ forms: out });
  }

  const form = String(body.form || '');
  if (!ALLOWED_FORMS.has(form)) return json({ error: `form ${form || '(none)'} is not on the allowed list` }, 400);

  if (action === 'describe') {
    const m = await getMetadata();
    if (!m.ok) return json({ error: m.err, status: m.status }, 502);
    const d = describeFromMetadata(m.text, form);
    if (!d) return json({ error: `form ${form} is not open for API (not in $metadata)` }, 404);
    return json({ form, ...d });
  }

  if (action !== 'query') return json({ error: 'unknown action' }, 400);

  const opts: Record<string, string> = {};
  for (const k of ['select', 'filter', 'expand', 'orderby'] as const) {
    if (body[k] == null || body[k] === '') continue;
    const v = String(body[k]);
    if (v.length > 2000 || !ODATA_OPT.test(v)) return json({ error: `invalid ${k}` }, 400);
    opts['$' + k] = v;
  }
  const maxRows = Math.min(Math.max(1, Number(body.maxRows) || HARD_MAX), HARD_MAX);
  const startSkip = Math.max(0, Number(body.skip) || 0);
  const started = Date.now();

  const rows: any[] = [];
  let skip = startSkip;
  let nextSkip: number | null = null;
  while (rows.length < maxRows) {
    const top = Math.min(PAGE, maxRows - rows.length);
    const qs = new URLSearchParams({ ...opts, $top: String(top), $skip: String(skip) });
    const r = await priorityGet(`${form}?${qs.toString().replace(/\+/g, '%20')}`);
    if (!r.ok) return json({ error: priorityError(r), status: r.status, form, fetched: rows.length }, 502);
    const page = Array.isArray(r.data?.value) ? r.data.value : [];
    rows.push(...page);
    skip += page.length;
    if (page.length < top) break;
    // Running out of time: hand back what we have and where to continue.
    if (Date.now() - started > TIME_BUDGET_MS) { nextSkip = skip; break; }
  }
  return json({ form, count: rows.length, value: rows, nextSkip });
});
