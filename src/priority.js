// ─── Priority REST API → the same rows the Excel uploads produce ─────────
// All Priority traffic goes through the Supabase Edge Function "priority",
// which holds the token and only ever sends GET requests to Priority.
// Each source below reads the form's real field list first ($metadata via
// action:'describe'), picks the fields it needs from a list of known Priority
// names, and builds rows with exactly the Hebrew headers the existing file
// parsers look for — so every calculation in the app stays the same.
import { supabase } from './cloud.js';

const call = async (body) => {
  const { data, error } = await supabase.functions.invoke('priority', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

export const pingPriority = () => call({ action: 'ping' });

// ── Field lists ("schema") ──
// Priority's $metadata is huge and slow (~30s). The field lists of the forms we
// use are fetched in ONE request and kept for 7 days (saved like any other
// setting, so every signed-in device shares them).
const SYNC_FORMS = ['LOGPART', 'PORDERS', 'AINVOICES', 'CINVOICES', 'YINVOICES'];
const SCHEMA_KEY = 'prioritySchema';
const SCHEMA_TTL = 7 * 86400000;
let schemaPromise = null;
const loadSchema = (force = false) => {
  if (!force && schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!force) {
      try { const c = JSON.parse(localStorage.getItem(SCHEMA_KEY) || 'null'); if (c && Date.now() - c.at < SCHEMA_TTL && c.forms) return c.forms; } catch { /* refetch */ }
    }
    const r = await call({ action: 'describe', forms: SYNC_FORMS });
    try { localStorage.setItem(SCHEMA_KEY, JSON.stringify({ at: Date.now(), forms: r.forms })); } catch { /* best-effort */ }
    return r.forms;
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
};
const describe = async (form) => {
  const forms = await loadSchema();
  const d = forms?.[form];
  if (!d) throw new Error(`form ${form} not in field list`);
  if (d.error) throw new Error(d.error);
  return d;
};
// One logical query; the server hands back nextSkip when it ran out of time, so keep asking.
const query = async (form, opts) => {
  const all = [];
  let skip = 0;
  for (let guard = 0; guard < 200; guard++) {
    const r = await call({ action: 'query', form, ...opts, skip });
    all.push(...(r.value || []));
    if (r.nextSkip == null) break;
    skip = r.nextSkip;
  }
  return all;
};
// Run async jobs with at most `limit` in flight.
const pool = async (items, limit, fn) => {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
};
// [since, now] split into calendar-month windows — small enough that each request stays fast.
const monthWindows = (sinceIso) => {
  const out = [];
  let a = new Date(sinceIso.slice(0, 10) + 'T00:00:00Z');
  const end = new Date(Date.now() + 86400000);
  while (a < end) {
    const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
    out.push([a.toISOString().slice(0, 10) + 'T00:00:00Z', (b < end ? b : end).toISOString().slice(0, 10) + 'T00:00:00Z']);
    a = b;
  }
  return out;
};

// First candidate that really exists on the form.
const pick = (fields, candidates) => candidates.find(c => fields.includes(c)) || null;
class MissingFieldError extends Error {}
const need = (fields, candidates, what, form) => {
  const f = pick(fields, candidates);
  if (!f) throw new MissingFieldError(`בטופס ${form} לא נמצא שדה ל"${what}". שדות קיימים: ${fields.join(', ')}`);
  return f;
};
const subformOf = (desc, test, form) => {
  const name = Object.keys(desc.subforms || {}).find(test);
  if (!name) throw new MissingFieldError(`בטופס ${form} לא נמצא תת-טופס מתאים. תתי-טפסים: ${Object.keys(desc.subforms || {}).join(', ') || '(אין)'}`);
  return { name, fields: desc.subforms[name] };
};
const sel = (...names) => [...new Set(names.filter(Boolean))].join(',');

// Priority dates arrive as "2025-09-04T00:00:00+03:00" → "04/09/2025" (what the Excel export shows).
const dmy = (v) => { const s = String(v || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const isoDaysAgo = (days) => { const d = new Date(Date.now() - days * 86400000); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; };
const numv = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; };

// ── field name candidates (standard Priority names first) ──
const F = {
  part: ['PARTNAME'], partDes: ['PARTDES', 'PDES'], status: ['STATDES'],
  invFlag: ['INVFLAG'],
  supName: ['SUPDES', 'CDES', 'SUPNAME'],
  buyPrice: ['LASTPRICE', 'PURPRICE', 'BUYPRICE', 'LPRICE', 'COST', 'PRICE'],
  buyCur: ['PURCODE', 'LASTCODE', 'CODE', 'CURRENCY'],
  minStock: ['MINQUANT', 'INVMIN', 'MINBAL', 'MINSTOCK'],
  moq: ['MINPURQUANT', 'MINORDQUANT', 'PURMINQUANT'],
  balance: ['BALANCE', 'TBALANCE', 'QUANT', 'TQUANT'],
  ordName: ['ORDNAME'], ordDate: ['CURDATE', 'ORDDATE'],
  lineBalance: ['TBALANCE', 'BALANCE', 'QBALANCE', 'RTQUANT'],
  lineDue: ['REQDATE', 'DUEDATE', 'SUPDATE'],
  linePrice: ['PRICE', 'IPRICE'], lineTotal: ['QPRICE', 'IVPRICE', 'TOTPRICE'],
  quant: ['TQUANT', 'QUANT'],
  ivNum: ['IVNUM'], ivDate: ['IVDATE', 'CURDATE'],
  custNum: ['CUSTNAME'], custName: ['CDES', 'CUSTDES'],
  supInvName: ['CDES', 'SUPDES', 'SUPNAME'],
  cur: ['CODE', 'ICODE'], lineCur: ['ICODE', 'CODE'], rate: ['EXCH', 'IEXCH', 'EXCHANGE'],
  debit: ['DEBIT'],
};

// ── 1. items + stock balances (one sheet → fills both inventory slots) ──
async function pullItems(report) {
  const d = await describe('LOGPART');
  const f = d.fields;
  const sku = need(f, F.part, 'מק"ט', 'LOGPART'), des = need(f, F.partDes, 'תאור', 'LOGPART');
  const st = pick(f, F.status), inv = pick(f, F.invFlag), sup = pick(f, F.supName), price = pick(f, F.buyPrice),
    cur = pick(f, F.buyCur), min = pick(f, F.minStock), moq = pick(f, F.moq);
  const balSub = Object.keys(d.subforms || {}).find(n => /BAL/.test(n));
  const balField = balSub ? pick(d.subforms[balSub], F.balance) : null;
  if (!balSub || !balField) report(`יתרות מלאי: לא נמצא תת-טופס יתרות ב-LOGPART (${Object.keys(d.subforms || {}).join(', ') || 'אין'}) — הכמויות לא יעודכנו`);
  const rows = await query('LOGPART', {
    select: sel(sku, des, st, inv, sup, price, cur, min, moq),
    expand: balSub && balField ? `${balSub}($select=${balField})` : '',
  });
  const out = [];
  for (const r of rows) {
    if (st && r[st] && r[st] !== 'פעיל') continue;
    if (inv && r[inv] && r[inv] !== 'Y') continue;
    const bal = balSub && balField ? (r[balSub] || []).reduce((s, b) => s + numv(b[balField]), 0) : null;
    out.push({
      'מק"ט': r[sku], 'תאור מוצר': r[des], 'יתרה': bal ?? 0,
      'מחיר קניה אחרון': price ? r[price] ?? '' : '', 'מטבע': cur ? r[cur] ?? '' : '',
      'כמות מינימום למלאי': min ? r[min] ?? '' : '', 'כמות מינימום להזמנה': moq ? r[moq] ?? '' : '',
      'שם ספק': sup ? r[sup] ?? '' : '',
    });
  }
  return { rows: out, hasBalances: !!(balSub && balField), hasCost: !!price };
}

// ── 2. purchase orders (open lines → open-orders slot; dates also used by purchase lines) ──
async function pullPurchaseOrders() {
  const d = await describe('PORDERS');
  const f = d.fields;
  const ord = need(f, F.ordName, 'מספר הזמנה', 'PORDERS'), date = need(f, F.ordDate, 'תאריך הזמנה', 'PORDERS');
  const sup = pick(f, F.supName);
  const it = subformOf(d, n => /ITEMS/.test(n), 'PORDERS');
  const sku = need(it.fields, F.part, 'מק"ט', it.name), des = pick(it.fields, F.partDes);
  const bal = need(it.fields, F.lineBalance, 'יתרה לאספקה', it.name);
  const due = pick(it.fields, F.lineDue), price = pick(it.fields, F.linePrice);
  const parts = await pool(monthWindows(isoDaysAgo(730)), 3, ([a, b]) => query('PORDERS', {
    select: sel(ord, date, sup), filter: `${date} ge ${a} and ${date} lt ${b}`, orderby: ord,
    expand: `${it.name}($select=${sel(sku, des, bal, due, price)})`,
  }));
  const rows = parts.flat();
  const open = [], dates = {};
  for (const r of rows) {
    dates[r[ord]] = dmy(r[date]);
    for (const l of r[it.name] || []) {
      const q = numv(l[bal]); if (q <= 0) continue;
      open.push({ 'הזמנה': r[ord], 'מק"ט': l[sku], 'תאור מוצר': des ? l[des] : '', 'יתרה לאספקה': q,
        'שווי יתרה': price ? q * numv(l[price]) : '', 'ת. הזמנה': dmy(r[date]), 'ת. אספקה': due ? dmy(l[due]) : '', 'שם ספק': sup ? r[sup] : '' });
    }
  }
  return { rows: open, poDates: dates };
}

// ── 3. sales invoice lines (tax invoices + consolidated invoices when open) ──
const SALES_HEADERS = ['תאריך', 'חשבונית', 'מס. לקוח', 'שם לקוח', 'מק"ט', 'תאור מוצר', 'כמות', 'סה"כ אחרי הנחה', 'הזמנה'];
async function pullSalesForm(form, since, report = () => {}) {
  const d = await describe(form);
  const f = d.fields;
  const iv = need(f, F.ivNum, 'חשבונית', form), date = need(f, F.ivDate, 'תאריך', form);
  const cn = pick(f, F.custNum), cd = pick(f, F.custName);
  const it = subformOf(d, n => /ITEMS/.test(n), form);
  const sku = need(it.fields, F.part, 'מק"ט', it.name), des = pick(it.fields, F.partDes);
  const q = need(it.fields, F.quant, 'כמות', it.name), tot = pick(it.fields, F.lineTotal), ord = pick(it.fields, F.ordName);
  const wins = monthWindows(since);
  let done = 0;
  const parts = await pool(wins, 3, async ([a, b]) => {
    const r = await query(form, {
      select: sel(iv, date, cn, cd), filter: `${date} ge ${a} and ${date} lt ${b}`, orderby: iv,
      expand: `${it.name}($select=${sel(sku, des, q, tot, ord)})`,
    });
    done++; if (wins.length > 2) report(`${form}: ${done}/${wins.length} חודשים`);
    return r;
  });
  const rows = parts.flat();
  const out = [];
  for (const r of rows) for (const l of r[it.name] || [])
    out.push([dmy(r[date]), r[iv], cn ? r[cn] : '', cd ? r[cd] : '', l[sku], des ? l[des] : '', numv(l[q]), tot ? numv(l[tot]) : 0, ord ? l[ord] || '' : '']);
  return out;
}

// ── 4. supplier invoice lines ──
const PURCH_HEADERS = ['תאריך', 'חשבונית', 'שם ספק', 'מק"ט', 'תאור מוצר', 'כמות', 'מחיר ליחידה', 'מטבע שורה', 'סה"כ אחרי הנחה', 'שער חליפין', 'הזמנת רכש', 'תאריך ההזמנה', 'חיוב/זכוי'];
async function pullPurchaseLines(since, poDates) {
  const form = 'YINVOICES';
  const d = await describe(form);
  const f = d.fields;
  const iv = need(f, F.ivNum, 'חשבונית', form), date = need(f, F.ivDate, 'תאריך', form), sup = need(f, F.supInvName, 'שם ספק', form);
  const cur = pick(f, F.cur), rate = pick(f, F.rate), deb = pick(f, F.debit);
  const it = subformOf(d, n => /ITEMS/.test(n), form);
  const sku = need(it.fields, F.part, 'מק"ט', it.name), des = pick(it.fields, F.partDes);
  const q = need(it.fields, F.quant, 'כמות', it.name), price = pick(it.fields, F.linePrice), tot = pick(it.fields, F.lineTotal);
  const lcur = pick(it.fields, F.lineCur), ord = pick(it.fields, F.ordName);
  const parts = await pool(monthWindows(since), 3, ([a, b]) => query(form, {
    select: sel(iv, date, sup, cur, rate, deb), filter: `${date} ge ${a} and ${date} lt ${b}`, orderby: iv,
    expand: `${it.name}($select=${sel(sku, des, q, price, tot, lcur, ord)})`,
  }));
  const rows = parts.flat();
  const out = [];
  for (const r of rows) for (const l of r[it.name] || []) {
    const po = ord ? l[ord] || '' : '';
    out.push([dmy(r[date]), r[iv], r[sup], l[sku], des ? l[des] : '', numv(l[q]), price ? numv(l[price]) : 0,
      (lcur && l[lcur]) || (cur ? r[cur] : '') || '', tot ? numv(l[tot]) : 0, rate ? numv(r[rate]) || '' : '',
      po, po ? poDates[po] || '' : '', deb ? r[deb] || '' : '']);
  }
  return out;
}

// Turn rows into an .xlsx File, so the existing upload handlers process it unchanged.
export const rowsToFile = (rowsOrAoa, name) => {
  const XLSX = window.XLSX;
  const ws = Array.isArray(rowsOrAoa[0]) ? XLSX.utils.aoa_to_sheet(rowsOrAoa) : XLSX.utils.json_to_sheet(rowsOrAoa);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Priority');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

// Pull everything the procurement page needs. Independent parts run in
// parallel; each fails on its own. Invoices are pulled only from `since`
// (incremental) — the app merges them into what it already has.
//   salesSince / purchaseSince: 'YYYY-MM-DD' (incremental) or null (full, `months` back)
export async function pullAllFromPriority({ months = 24, salesSince = null, purchaseSince = null, report = () => {} } = {}) {
  const fullSince = isoDaysAgo(Math.round(months * 30.5));
  const sSince = salesSince ? `${salesSince}T00:00:00Z` : fullSince;
  const pSince = purchaseSince ? `${purchaseSince}T00:00:00Z` : fullSince;
  const stamp = new Date().toLocaleDateString('he-IL').replace(/\./g, '-');
  const out = { files: {}, errors: {}, notes: [], since: { salesLines: sSince.slice(0, 10), purchaseLines: pSince.slice(0, 10) } };
  const note = (t) => { out.notes.push(t); report(t); };
  let schemaRefreshed = false;
  const step = async (slot, label, fn) => {
    const t0 = Date.now();
    report(`מושך ${label}…`);
    try {
      try { await fn(); }
      catch (e) {
        // A field the saved field list doesn't know about → refresh the list once and retry.
        if (!(e instanceof MissingFieldError) || schemaRefreshed) throw e;
        schemaRefreshed = true; report('רשימת השדות התעדכנה ב-Priority — מרענן…');
        await loadSchema(true); await fn();
      }
      report(`${label}: הסתיים (${Math.round((Date.now() - t0) / 1000)} שנ׳)`);
    }
    catch (e) { out.errors[slot] = e.message || String(e); note(`${label}: ${out.errors[slot]}`); }
  };

  report('טוען רשימת שדות…');
  try { await loadSchema(); }
  catch (e) { out.errors.all = e.message || String(e); note(`רשימת שדות: ${out.errors.all}`); return out; }

  const items = step('items', 'פריטים ויתרות מלאי', async () => {
    const r = await pullItems(note);
    if (!r.rows.length) throw new Error('לא התקבלו פריטים');
    out.files.items = rowsToFile(r.rows, `Priority פריטים ${stamp}.xlsx`);
    out.itemsInfo = { count: r.rows.length, hasBalances: r.hasBalances, hasCost: r.hasCost };
  });
  const ordersThenPurchases = (async () => {
    let poDates = {};
    await step('openOrders', 'הזמנות רכש פתוחות', async () => {
      const r = await pullPurchaseOrders(); poDates = r.poDates;
      out.files.openOrders = r.rows.length ? rowsToFile(r.rows, `Priority הזמנות רכש ${stamp}.xlsx`) : null;
      if (!r.rows.length) note('הזמנות רכש: אין שורות פתוחות');
    });
    await step('purchaseLines', 'שורות חשבוניות ספק', async () => {
      const lines = await pullPurchaseLines(pSince, poDates);
      out.files.purchaseLines = rowsToFile([PURCH_HEADERS, ...lines], `Priority חשבוניות ספק ${stamp}.xlsx`);
      out.counts = { ...(out.counts || {}), purchaseLines: lines.length };
    });
  })();
  const sales = step('salesLines', 'שורות חשבוניות מכירה', async () => {
    const lines = [];
    // Both forms must succeed — a partial pull would silently drop sales.
    for (const form of ['AINVOICES', 'CINVOICES']) {
      try { lines.push(...await pullSalesForm(form, sSince, report)); }
      catch (e) {
        if (form === 'CINVOICES' && /not open|לא פתוח|not in \$metadata|not in field list/i.test(e.message)) { note('CINVOICES לא פתוח ל-API — רק חשבוניות מס'); continue; }
        throw new Error(`${form}: ${e.message}`);
      }
    }
    out.files.salesLines = rowsToFile([SALES_HEADERS, ...lines], `Priority חשבוניות מכירה ${stamp}.xlsx`);
    out.counts = { ...(out.counts || {}), salesLines: lines.length };
  });
  await Promise.all([items, ordersThenPurchases, sales]);
  return out;
}

// For troubleshooting: the real field lists of every form the sync uses.
export async function describeAll() {
  return loadSchema(true);
}
