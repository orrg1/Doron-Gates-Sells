// ─── Priority REST → the rows the app works with (shared core) ─────────
// No browser or Deno APIs here. The caller supplies:
//   forms  — field lists per form ({ fields:[], subforms:{ NAME:[fields] } }), see describeFromMetadata
//   query  — async (form, { select, filter, expand, orderby }) → all rows (the caller pages)
// The server-side sync ("priority-sync" Edge Function) runs this step by step,
// a few steps per invocation, so even a full 24-month sync never hits a time limit.
// Every query is a read — nothing here can change data in Priority.
import { parseSalesLines, parsePurchaseLines, parsePriorityOrders, parseInventoryFile,
  applyInventory, applyOpenOrders, mergeLinesSince } from './data.js';

export const SYNC_FORMS = ['LOGPART', 'PORDERS', 'AINVOICES', 'CINVOICES', 'EINVOICES', 'YINVOICES', 'CUSTOMERS'];
export const SALES_FORMS = ['AINVOICES', 'CINVOICES', 'EINVOICES'];
const OPTIONAL_SALES = { CINVOICES: 'חשבוניות מרכזות', EINVOICES: 'חשבוניות מס קבלה' };
export const FULL_MONTHS = 24;
export const OVERLAP_DAYS = 45; // incremental syncs re-read this far back (late edits, credits, cancellations)

// ── $metadata (XML) → field lists ──
const entityFields = (xml, type) => {
  const m = xml.match(new RegExp(`<EntityType Name="${type}"[^>]*>([\\s\\S]*?)</EntityType>`));
  if (!m) return null;
  const body = m[1];
  const fields = [...body.matchAll(/<Property Name="([^"]+)" Type="([^"]+)"/g)].map(x => x[1]);
  const nav = [...body.matchAll(/<NavigationProperty Name="([^"]+)" Type="([^"]+)"/g)]
    .map(x => ({ name: x[1], type: x[2].replace(/^Collection\(/, '').replace(/\)$/, '').split('.').pop() || '' }));
  return { fields, nav };
};
export const describeFromMetadata = (xml, form) => {
  const top = entityFields(xml, form);
  if (!top) return null;
  const subforms = {};
  for (const n of top.nav) subforms[n.name] = entityFields(xml, n.type)?.fields || [];
  return { fields: top.fields, subforms };
};

// ── helpers ──
const pick = (fields, candidates) => candidates.find(c => fields.includes(c)) || null;
export class MissingFieldError extends Error {}
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
const dmy = (v) => { const s = String(v || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const iso = (v) => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; };
const numv = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; };
const describe = (forms, form) => {
  const d = forms?.[form];
  if (!d) throw new MissingFieldError(`form ${form} not in field list`);
  if (d.error) throw new Error(d.error);
  return d;
};
export const isoDaysAgo = (days, now = Date.now()) => new Date(now - days * 86400000).toISOString().slice(0, 10);
// [since, now] in calendar-month windows: [['2026-09-10T00:00:00Z','2026-10-01T00:00:00Z'], …]
export const monthWindows = (sinceIso, now = Date.now()) => {
  const out = [];
  let a = new Date(sinceIso.slice(0, 10) + 'T00:00:00Z');
  const end = new Date(now + 86400000);
  while (a < end) {
    const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
    out.push([a.toISOString().slice(0, 10) + 'T00:00:00Z', (b < end ? b : end).toISOString().slice(0, 10) + 'T00:00:00Z']);
    a = b;
  }
  return out;
};

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
  family: ['FAMILYDES'], familyCode: ['FAMILYNAME'], partType: ['TYPE'], avgCost: ['COST'], listPrice: ['BASEPLPRICE'],
  lastSale: ['SALETRANSDATE'], lastBuy: ['PURTRANSDATE'], created: ['CREATEDDATE'],
  final: ['FINAL'], docStatus: ['STATDES'], hdrGross: ['QPRICE'], hdrNet: ['DISPRICE'], lineExch: ['EXCH'],
};
// Only finalized, non-cancelled documents count (drafts and cancelled invoices live in the same forms).
const finalFilter = (f) => pick(f, F.final) ? ` and ${pick(f, F.final)} eq 'Y'` : '';
const isCancelled = (r, f) => { const st = pick(f, F.docStatus); return !!(st && /מבוטל/.test(String(r[st] || ''))); };

// ── 1. items + stock balances + item-card extras ──
async function pullItems(forms, query) {
  const d = describe(forms, 'LOGPART');
  const f = d.fields;
  const sku = need(f, F.part, 'מק"ט', 'LOGPART'), des = need(f, F.partDes, 'תאור', 'LOGPART');
  const st = pick(f, F.status), inv = pick(f, F.invFlag), sup = pick(f, F.supName), price = pick(f, F.buyPrice),
    cur = pick(f, F.buyCur), min = pick(f, F.minStock), moq = pick(f, F.moq);
  const fam = pick(f, F.family), famCode = pick(f, F.familyCode), typ = pick(f, F.partType), avg = pick(f, F.avgCost),
    list = pick(f, F.listPrice), lastSale = pick(f, F.lastSale), lastBuy = pick(f, F.lastBuy), created = pick(f, F.created);
  const balSub = Object.keys(d.subforms || {}).find(n => /BAL/.test(n));
  const balField = balSub ? pick(d.subforms[balSub], F.balance) : null;
  const rows = await query('LOGPART', {
    select: sel(sku, des, st, inv, sup, price, cur, min, moq, fam, famCode, typ, avg, list, lastSale, lastBuy, created),
    expand: balSub && balField ? `${balSub}($select=${balField})` : '',
  });
  const out = [], extra = {};
  for (const r of rows) {
    if (st && r[st] && r[st] !== 'פעיל') continue;
    extra[r[sku]] = {
      fam: fam ? r[fam] || '' : '', famCode: famCode ? r[famCode] || '' : '', type: typ ? r[typ] || '' : '',
      avgCost: avg ? numv(r[avg]) || null : null, listPrice: list ? numv(r[list]) || null : null,
      lastSale: lastSale ? iso(r[lastSale]) : '', lastBuy: lastBuy ? iso(r[lastBuy]) : '', created: created ? iso(r[created]) : '',
    };
    if (inv && r[inv] && r[inv] !== 'Y') continue;
    const bal = balSub && balField ? (r[balSub] || []).reduce((s, b) => s + numv(b[balField]), 0) : null;
    out.push({
      'מק"ט': r[sku], 'תאור מוצר': r[des], 'יתרה': bal ?? 0,
      'מחיר קניה אחרון': price ? r[price] ?? '' : '', 'מטבע': cur ? r[cur] ?? '' : '',
      'כמות מינימום למלאי': min ? r[min] ?? '' : '', 'כמות מינימום להזמנה': moq ? r[moq] ?? '' : '',
      'שם ספק': sup ? r[sup] ?? '' : '',
    });
  }
  return { rows: out, extra, hasBalances: !!(balSub && balField), hasCost: !!price,
    notes: balSub && balField ? [] : [`יתרות מלאי: לא נמצא תת-טופס יתרות ב-LOGPART — הכמויות לא עודכנו`] };
}

// ── 2. customer cards ──
async function pullCustomers(forms, query) {
  const d = describe(forms, 'CUSTOMERS');
  const f = d.fields;
  const num = need(f, ['CUSTNAME'], 'מס. לקוח', 'CUSTOMERS'), name = need(f, ['CUSTDES'], 'שם לקוח', 'CUSTOMERS');
  const cols = { status: pick(f, ['STATDES']), created: pick(f, ['CREATEDDATE']), city: pick(f, ['STATEA', 'STATE']),
    agent: pick(f, ['AGENTNAME']), pay: pick(f, ['PAYDES']), type: pick(f, ['CTYPENAME']), zone: pick(f, ['ZONEDES']), credit: pick(f, ['MAX_CREDIT']) };
  const rows = await query('CUSTOMERS', { select: sel(num, name, ...Object.values(cols)) });
  const out = {};
  for (const r of rows) {
    const c = { num: r[num], name: r[name] };
    for (const [k, fld] of Object.entries(cols)) if (fld) c[k] = k === 'created' ? iso(r[fld]) : k === 'credit' ? numv(r[fld]) || null : (r[fld] || '');
    out[r[num]] = c;
  }
  return out;
}

// ── 3. purchase orders ──
// Status history (DOCTODOLISTLOG) gives the day the PO was really sent to the supplier —
// POs are often opened days or weeks before they go out.
const poShape = (forms) => {
  const d = describe(forms, 'PORDERS');
  const f = d.fields;
  const ord = need(f, F.ordName, 'מספר הזמנה', 'PORDERS'), date = need(f, F.ordDate, 'תאריך הזמנה', 'PORDERS');
  const sup = pick(f, F.supName), st = pick(f, F.status);
  const it = subformOf(d, n => /ITEMS/.test(n), 'PORDERS');
  const sku = need(it.fields, F.part, 'מק"ט', it.name), des = pick(it.fields, F.partDes);
  const bal = need(it.fields, F.lineBalance, 'יתרה לאספקה', it.name);
  const due = pick(it.fields, F.lineDue), price = pick(it.fields, F.linePrice);
  const logSub = Object.keys(d.subforms || {}).find(n => /^DOCTODOLISTLOG/.test(n));
  const logFields = logSub ? d.subforms[logSub] : [];
  const log = logSub && logFields.includes('UDATE') && logFields.includes('STATDES') ? logSub : null;
  return { ord, date, sup, st, it, sku, des, bal, due, price, log };
};
const poMetaOf = (r, s) => {
  const hist = s.log ? (r[s.log] || []).filter(x => x.UDATE).sort((a, b) => a.UDATE < b.UDATE ? -1 : 1) : [];
  const sentEntry = hist.find(x => x.STATDES === 'נשלחה') || hist.find(x => x.STATDES && !/טיוטא|מבוטל|מחכה/.test(x.STATDES));
  return { created: iso(r[s.date]), sent: sentEntry ? iso(sentEntry.UDATE) : '', status: s.st ? r[s.st] || '' : '', sup: s.sup ? r[s.sup] || '' : '' };
};
async function pullOpenPOs(forms, query) {
  const s = poShape(forms);
  // Only orders that really went out count as "on the way": sent (נשלחה) or approved (אושרה).
  // Drafts and orders waiting for approval are not commitments yet.
  const filter = s.st ? `(${s.st} eq 'נשלחה' or ${s.st} eq 'אושרה')` : '';
  const rows = await query('PORDERS', {
    select: sel(s.ord, s.date, s.sup, s.st), filter, orderby: s.ord,
    expand: [`${s.it.name}($select=${sel(s.sku, s.des, s.bal, s.due, s.price)})`, s.log ? `${s.log}($select=UDATE,STATDES)` : ''].filter(Boolean).join(','),
  });
  const lines = [], meta = {};
  for (const r of rows) {
    const m = poMetaOf(r, s); meta[r[s.ord]] = m;
    for (const l of r[s.it.name] || []) {
      const q = numv(l[s.bal]); if (q <= 0) continue;
      lines.push({ 'הזמנה': r[s.ord], 'מק"ט': l[s.sku], 'תאור מוצר': s.des ? l[s.des] : '', 'יתרה לאספקה': q,
        'שווי יתרה': s.price ? q * numv(l[s.price]) : '', 'ת. הזמנה': dmy(r[s.date]), 'ת. אספקה': s.due ? dmy(l[s.due]) : '',
        'שם ספק': s.sup ? r[s.sup] : '', 'סטטוס הזמנה': m.status, 'ת. שליחה': m.sent ? dmy(m.sent) : '' });
    }
  }
  return { lines, meta };
}
async function pullPoWindow(forms, query, [a, b]) {
  const s = poShape(forms);
  const rows = await query('PORDERS', {
    select: sel(s.ord, s.date, s.sup, s.st), filter: `${s.date} ge ${a} and ${s.date} lt ${b}`, orderby: s.ord,
    expand: s.log ? `${s.log}($select=UDATE,STATDES)` : '',
  });
  const meta = {};
  for (const r of rows) meta[r[s.ord]] = poMetaOf(r, s);
  return { meta };
}

// ── 4. sales invoice lines (one form, one window) ──
export const SALES_HEADERS = ['תאריך', 'חשבונית', 'מס. לקוח', 'שם לקוח', 'מק"ט', 'תאור מוצר', 'כמות', 'סה"כ אחרי הנחה', 'הזמנה'];
async function pullSalesWindow(forms, query, form, [a, b]) {
  const d = describe(forms, form);
  const f = d.fields;
  const iv = need(f, F.ivNum, 'חשבונית', form), date = need(f, F.ivDate, 'תאריך', form);
  const cn = pick(f, F.custNum), cd = pick(f, F.custName);
  const st = pick(f, F.docStatus), gross = pick(f, F.hdrGross), net = pick(f, F.hdrNet);
  const it = subformOf(d, n => /ITEMS/.test(n), form);
  const sku = need(it.fields, F.part, 'מק"ט', it.name), des = pick(it.fields, F.partDes);
  const q = need(it.fields, F.quant, 'כמות', it.name), tot = pick(it.fields, F.lineTotal), ord = pick(it.fields, F.ordName);
  const exch = pick(it.fields, F.lineExch);
  const rows = await query(form, {
    select: sel(iv, date, cn, cd, st, gross, net), filter: `${date} ge ${a} and ${date} lt ${b}${finalFilter(f)}`, orderby: iv,
    expand: `${it.name}($select=${sel(sku, des, q, tot, ord, exch)})`,
  });
  const out = [];
  for (const r of rows) {
    if (isCancelled(r, f)) continue;
    // Line totals are before the invoice-level discount and in the invoice currency:
    // spread the header discount over the lines and convert to ILS with the line rate.
    const g = gross ? numv(r[gross]) : 0, n = net ? numv(r[net]) : 0;
    const factor = g && n && Math.abs(n / g - 1) < 0.5 ? n / g : 1;
    for (const l of r[it.name] || []) {
      const rate = exch ? numv(l[exch]) || 1 : 1;
      const v = tot ? Math.round(numv(l[tot]) * rate * factor * 100) / 100 : 0;
      out.push([dmy(r[date]), r[iv], cn ? r[cn] : '', cd ? r[cd] : '', l[sku], des ? l[des] : '', numv(l[q]), v, ord ? l[ord] || '' : '']);
    }
  }
  return { rows: out };
}

// ── 5. supplier invoice lines (one window); PO dates are filled in at the end ──
export const PURCH_HEADERS = ['תאריך', 'חשבונית', 'שם ספק', 'מק"ט', 'תאור מוצר', 'כמות', 'מחיר ליחידה', 'מטבע שורה', 'סה"כ אחרי הנחה', 'שער חליפין', 'הזמנת רכש', 'תאריך ההזמנה', 'חיוב/זכוי', 'תאריך שליחה'];
async function pullPurchaseWindow(forms, query, [a, b]) {
  const form = 'YINVOICES';
  const d = describe(forms, form);
  const f = d.fields;
  const iv = need(f, F.ivNum, 'חשבונית', form), date = need(f, F.ivDate, 'תאריך', form), sup = need(f, F.supInvName, 'שם ספק', form);
  const cur = pick(f, F.cur), rate = pick(f, F.rate), deb = pick(f, F.debit), st = pick(f, F.docStatus);
  const it = subformOf(d, n => /ITEMS/.test(n), form);
  const sku = need(it.fields, F.part, 'מק"ט', it.name), des = pick(it.fields, F.partDes);
  const q = need(it.fields, F.quant, 'כמות', it.name), price = pick(it.fields, F.linePrice), tot = pick(it.fields, F.lineTotal);
  const lcur = pick(it.fields, F.lineCur), ord = pick(it.fields, F.ordName);
  const rows = await query(form, {
    select: sel(iv, date, sup, cur, rate, deb, st), filter: `${date} ge ${a} and ${date} lt ${b}${finalFilter(f)}`, orderby: iv,
    expand: `${it.name}($select=${sel(sku, des, q, price, tot, lcur, ord)})`,
  });
  const out = [];
  for (const r of rows) {
    if (isCancelled(r, f)) continue;
    for (const l of r[it.name] || []) {
      out.push([dmy(r[date]), r[iv], r[sup], l[sku], des ? l[des] : '', numv(l[q]), price ? numv(l[price]) : 0,
        (lcur && l[lcur]) || (cur ? r[cur] : '') || '', tot ? numv(l[tot]) : 0, rate ? numv(r[rate]) || '' : '',
        ord ? l[ord] || '' : '', '', deb ? r[deb] || '' : '', '']);
    }
  }
  return { rows: out };
}

// ── plan: which steps a sync needs ──
// since: { salesLines: 'YYYY-MM-DD' | null, purchaseLines: … }  (null = full window)
// poFull: no PO dates stored yet → read PO history for the whole window once.
export const planSteps = ({ since = {}, poFull = false, now = Date.now() }) => {
  const full = isoDaysAgo(Math.round(FULL_MONTHS * 30.5), now);
  const sSince = since.salesLines || full, pSince = since.purchaseLines || full;
  const steps = [{ id: 'items' }, { id: 'customers' }, { id: 'po-open' }];
  for (const w of monthWindows(poFull ? full : pSince, now)) steps.push({ id: `po:${w[0].slice(0, 10)}`, w });
  for (const form of SALES_FORMS) for (const w of monthWindows(sSince, now)) steps.push({ id: `sales:${form}:${w[0].slice(0, 10)}`, form, w });
  for (const w of monthWindows(pSince, now)) steps.push({ id: `purch:${w[0].slice(0, 10)}`, w });
  return { steps, sSince, pSince };
};

const NOT_OPEN = /not open|לא פתוח|לא ניתן להפעיל API|not in \$metadata|not in field list/i;
// Run one step → a JSON payload (stored by the caller until the final step).
export async function runStep(step, { forms, query }) {
  if (step.id === 'items') return pullItems(forms, query);
  if (step.id === 'customers') return { customers: await pullCustomers(forms, query) };
  if (step.id === 'po-open') return pullOpenPOs(forms, query);
  if (step.id.startsWith('po:')) return pullPoWindow(forms, query, step.w);
  if (step.id.startsWith('purch:')) return pullPurchaseWindow(forms, query, step.w);
  if (step.id.startsWith('sales:')) {
    try { return await pullSalesWindow(forms, query, step.form, step.w); }
    catch (e) {
      if (OPTIONAL_SALES[step.form] && NOT_OPEN.test(e.message || '')) return { rows: [], skipped: `${OPTIONAL_SALES[step.form]} (${step.form}) לא פתוחות ל-API ב-Priority — הן לא נכללות במכירות.` };
      throw e;
    }
  }
  throw new Error(`unknown step ${step.id}`);
}

// ── final step: everything pulled → the stored state the app reads ──
// prev: { appState: { key: parsed value }, datasets: { key: value } }
// payloads: { stepId: payload }, failed: { stepId: message }
// Returns { appState: {key: value}, datasets: {key: value}, log: [] } with only what changed.
export function finalizeSync({ prev, payloads, failed = {}, since = {}, sSince, pSince, now = Date.now() }) {
  const A = prev.appState || {}, D = prev.datasets || {};
  const today = new Date(now).toISOString().slice(0, 10);
  const stamp = today.split('-').reverse().join('-');
  const outState = {}, outSets = {}, log = [];
  const ids = Object.keys(payloads);
  const anyFailed = (prefix) => Object.keys(failed).some(k => k === prefix || k.startsWith(prefix));
  const filesMeta = { ...(A.procFilesMeta || {}) };
  const through = { ...(A.prioritySyncThrough || {}) };

  // PO dates (created / sent / status) — kept across syncs, refreshed by every pull
  const poMeta = { ...(D.procPoMeta || {}) };
  ids.filter(k => k.startsWith('po:')).forEach(k => Object.assign(poMeta, payloads[k].meta || {}));
  if (payloads['po-open']) Object.assign(poMeta, payloads['po-open'].meta || {});
  outSets.procPoMeta = poMeta;

  // items
  const it = payloads.items;
  if (it) {
    const parsed = parseInventoryFile(it.rows);
    const nx = applyInventory({ stock: A.procurementStock, cost: A.procurementCost, minStock: A.procurementMinStock, supplier: A.procurementSupplier,
      moq: A.procurementMOQ, currency: A.procurementCurrency, names: A.procurementNames, costHistory: A.procurementCostHistory },
    parsed, { replaceStock: it.hasBalances, today });
    Object.assign(outState, { procurementStock: nx.stock, procurementCost: nx.cost, procurementMinStock: nx.minStock, procurementSupplier: nx.supplier,
      procurementMOQ: nx.moq, procurementCurrency: nx.currency, procurementNames: nx.names, procurementCostHistory: nx.costHistory });
    const name = `Priority פריטים ${stamp}.xlsx`;
    const slots = { ...(A.procurementInvSlots || {}) };
    slots.product = { name, ...nx.stats, importedAt: now };
    slots.masterCard = { name, total: parsed.length, withQty: 0, withCost: 0, withMinStock: 0, withSupplier: 0, importedAt: now };
    outState.procurementInvSlots = slots;
    outState.inventoryFileName = name;
    outSets.procItemsExtra = it.extra;
    // daily stock snapshot → stock history (only items whose balance changed are stored)
    if (it.hasBalances) {
      const hist = D.stockHistory && D.stockHistory.days ? { ...D.stockHistory } : { days: [] };
      const last = {};   // balances as of the latest EARLIER day (a re-sync today replaces today's entry)
      (hist.days || []).filter(dd => dd.d !== today).forEach(day => Object.assign(last, day.s));
      const changes = {};
      Object.entries(nx.stock).forEach(([k, q]) => { if (last[k] !== q) changes[k] = q; });
      Object.keys(last).forEach(k => { if (!(k in nx.stock) && last[k] !== 0) changes[k] = 0; });
      const days = (hist.days || []).filter(dd => dd.d !== today);
      days.push({ d: today, s: changes, full: !days.length });
      outSets.stockHistory = { days };
    }
    log.push(`פריטים: ${parsed.length.toLocaleString()}`);
    (it.notes || []).forEach(n => log.push(n));
  } else if (failed.items) log.push(`פריטים לא עודכנו: ${failed.items}`);

  // customers
  if (payloads.customers) { outSets.priorityCustomers = payloads.customers.customers; log.push(`כרטיסי לקוחות: ${Object.keys(payloads.customers.customers).length.toLocaleString()}`); }

  // open purchase orders
  if (payloads['po-open']) {
    const parsed = parsePriorityOrders(payloads['po-open'].lines);
    const res = applyOpenOrders({ prevOrders: A.openOrders || [], parsed, receiptLog: A.procurementReceiptLog || [], draftQty: A.procurementDraftQty || {}, today });
    outState.openOrders = res.orders;
    if (res.receiptLog !== (A.procurementReceiptLog || [])) outState.procurementReceiptLog = res.receiptLog;
    if (res.draftQty !== (A.procurementDraftQty || {})) outState.procurementDraftQty = res.draftQty;
    const name = `Priority הזמנות רכש ${stamp}.xlsx`;
    outState.ordersFileName = name;
    filesMeta.openOrders = { name, rows: parsed.length, at: now };
    log.push(`הזמנות רכש פתוחות: ${parsed.length.toLocaleString()} שורות`);
  }

  // sales lines — only when every month of every required form came in
  const salesIds = ids.filter(k => k.startsWith('sales:'));
  if (salesIds.length && !anyFailed('sales:')) {
    const rows = []; const notes = new Set();
    salesIds.forEach(k => { rows.push(...(payloads[k].rows || [])); if (payloads[k].skipped) notes.add(payloads[k].skipped); });
    notes.forEach(n => log.push(n));
    const parsed = parseSalesLines([SALES_HEADERS, ...rows]) || [];
    const merged = mergeLinesSince(D.procSalesLines || [], parsed, since.salesLines || null);
    outSets.procSalesLines = merged;
    if (merged.length) filesMeta.salesLines = { name: `Priority חשבוניות מכירה ${stamp}.xlsx`, rows: merged.length, from: merged[merged.length - 1].d, to: merged[0].d, at: now };
    through.salesLines = today;
    log.push(`חשבוניות מכירה: ${parsed.length.toLocaleString()} שורות ${since.salesLines ? 'חדשות/מעודכנות' : '(24 חודשים)'}`);
  } else if (anyFailed('sales:')) log.push('חשבוניות מכירה לא עודכנו — חלק מהחודשים נכשלו. הנתונים הקודמים נשמרו.');

  // supplier invoice lines (PO created / sent dates from the PO map)
  const purchIds = ids.filter(k => k.startsWith('purch:'));
  if (purchIds.length && !anyFailed('purch:')) {
    const rows = [];
    purchIds.forEach(k => rows.push(...(payloads[k].rows || [])));
    rows.forEach(r => { const m = poMeta[r[10]]; if (m) { r[11] = m.created ? dmy(m.created) : ''; r[13] = m.sent ? dmy(m.sent) : ''; } });
    const parsed = parsePurchaseLines([PURCH_HEADERS, ...rows]) || [];
    const merged = mergeLinesSince(D.procPurchaseLines || [], parsed, since.purchaseLines || null);
    // older stored lines get their sent date too, once we know it
    merged.forEach(l => { if (l.po && !l.pos && poMeta[l.po]?.sent) l.pos = poMeta[l.po].sent; if (l.po && !l.pod && poMeta[l.po]?.created) l.pod = poMeta[l.po].created; });
    outSets.procPurchaseLines = merged;
    if (merged.length) filesMeta.purchaseLines = { name: `Priority חשבוניות ספק ${stamp}.xlsx`, rows: merged.length, from: merged[merged.length - 1].d, to: merged[0].d, at: now };
    through.purchaseLines = today;
    log.push(`חשבוניות ספק: ${parsed.length.toLocaleString()} שורות`);
  } else if (anyFailed('purch:')) log.push('חשבוניות ספק לא עודכנו — חלק מהחודשים נכשלו.');

  outState.procFilesMeta = filesMeta;
  outState.prioritySyncThrough = through;
  outState.prioritySyncAt = now;
  return { appState: outState, datasets: outSets, log, sSince, pSince };
}
