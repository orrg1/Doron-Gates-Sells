// ─── The AI assistant's tools (read only) ─────────────────────────────────────
// The model asks for data ("sales of customer X in March"), the site computes it from what is
// already stored in the browser and hands back only the result. Nothing here writes anything.
//
// D (the data bundle the site builds once per chat):
//   sales      — invoice lines [{d, inv, cid, c, k, n, q, v, x?}] (q < 0 = credit / return; x = a non-product line)
//   purchases  — supplier invoice lines [{d, s, k, n, q, p, cur, tot, rate, po}]
//   products   — the procurement model per product [{sku, name, supplier, abc, status, stock, incoming, avgMonthly, coverDays, …}]
//   orders     — open purchase orders [{po, supplier, sku, name, qty, ordered, expected, late, valueILS}]
//   shipments  — the forwarder's shipments [{container, file, supplier, arrival, stage, received, delayDays, …}]
//   today      — 'YYYY-MM-DD'

import { PROC_STATUS_LABEL } from './procModel.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const words = (s) => String(s ?? '').toLowerCase().split(/[\s,]+/).map(w => w.replace(/^[-–.]+|[-–.]+$/g, '')).filter(w => w.length >= 2);
const r0 = (n) => Math.round(n || 0);
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const ym = (d) => String(d || '').slice(0, 7);
const LIMIT = (n, def = 30) => Math.max(1, Math.min(100, Number(n) || def));
// 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' → an inclusive day range
const dayFrom = (s) => { s = String(s || '').trim(); if (/^\d{4}$/.test(s)) return `${s}-01-01`; if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const dayTo = (s) => {
  s = String(s || '').trim();
  if (/^\d{4}$/.test(s)) return `${s}-12-31`;
  if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split('-').map(Number); return `${s}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
const periodText = (from, to) => (from || to ? `${from || 'ההתחלה'} עד ${to || 'היום'}` : 'כל התקופה');

// the text a person typed matches a name: every word of it appears (a Hebrew one-letter prefix may be dropped)
const matchesText = (hay, q) => {
  const h = String(hay || '').toLowerCase(), hn = norm(hay);
  const ws = words(q); if (!ws.length) return false;
  return ws.every(w => h.includes(w) || hn.includes(norm(w)) || (/^[והבלמש]/.test(w) && w.length >= 4 && h.includes(w.slice(1))));
};

// ── lookups ──
const productIndex = (D) => {
  if (D._pidx) return D._pidx;
  const by = {};
  (D.products || []).forEach(p => { if (p.sku) by[p.sku] = { ...p }; });
  (D.sales || []).forEach(l => { if (l.k && !by[l.k]) by[l.k] = { sku: l.k, name: l.n, supplier: '', stock: null }; });
  (D.purchases || []).forEach(l => { if (l.k && !by[l.k]) by[l.k] = { sku: l.k, name: l.n, supplier: l.s, stock: null }; else if (l.k && !by[l.k].supplier) by[l.k].supplier = l.s; });
  D._pidx = by; return by;
};
// "DOR.S", "940901543", "קיט BULL 600" → SKUs
const resolveProducts = (D, list) => {
  const idx = productIndex(D), all = Object.values(idx);
  const out = new Set(), unknown = [];
  (Array.isArray(list) ? list : list ? [list] : []).forEach(q => {
    const qs = String(q).trim(); if (!qs) return;
    const exact = all.filter(p => norm(p.sku) === norm(qs));
    if (exact.length) { exact.forEach(p => out.add(p.sku)); return; }
    const byName = all.filter(p => matchesText(p.name, qs) || norm(p.sku).startsWith(norm(qs)));
    if (byName.length) byName.slice(0, 40).forEach(p => out.add(p.sku)); else unknown.push(qs);
  });
  return { skus: [...out], unknown };
};
const customerMatch = (l, q) => !q || matchesText(l.c, q) || (l.cid && norm(l.cid) === norm(q));
// the customers a name points at: the exact name / customer number, else names that contain it as a phrase, else all its words
const resolveCustomers = (D, q) => {
  if (D._cust?.[q]) return D._cust[q];
  const all = new Map(); (D.sales || []).forEach(l => { if (l.c || l.cid) all.set(l.c || l.cid, l); });
  const names = [...all.keys()], qn = norm(q), ql = String(q).trim().toLowerCase();
  let hit = names.filter(n => norm(n) === qn || norm(all.get(n).cid) === qn);
  if (!hit.length) hit = names.filter(n => n.toLowerCase().includes(ql) || norm(n).includes(qn));
  if (!hit.length) hit = names.filter(n => matchesText(n, q));
  (D._cust ||= {})[q] = new Set(hit); return D._cust[q];
};
const supplierMatch = (name, q) => !q || matchesText(name, q);
const supplierOfSku = (D, sku) => productIndex(D)[sku]?.supplier || '';
const nameOf = (D, sku) => productIndex(D)[sku]?.name || sku;

// ── the tools ──
const TOOLS = {
  find_products: {
    description: 'חיפוש מוצרים לפי שם, חלק משם או מק"ט (גם לפי ספק). מחזיר מק"ט, שם, ספק, מלאי וסיווג ABC. השתמש בזה כשלא ברור לאיזה מוצר הכוונה.',
    params: { query: ['string', 'מילים מהשם או מק"ט'], supplier: ['string', 'שם ספק (לא חובה)'], limit: ['integer', 'מספר תוצאות מרבי (ברירת מחדל 30)'] },
    required: ['query'],
    run: (D, a) => {
      const all = Object.values(productIndex(D));
      const hits = all.filter(p => (matchesText(p.name, a.query) || norm(p.sku).includes(norm(a.query))) && supplierMatch(p.supplier, a.supplier));
      return { total: hits.length, rows: hits.slice(0, LIMIT(a.limit)).map(p => ({ sku: p.sku, name: p.name, supplier: p.supplier || '', stock: p.stock ?? null, abc: p.abc || '', inactive: p.inactive || undefined })) };
    },
    label: (a) => `חיפוש מוצר "${a.query}"`,
  },

  find_customers: {
    description: 'חיפוש לקוחות לפי שם או חלק משם. מחזיר שם לקוח, מספר לקוח, מספר חשבוניות, מחזור ותאריך קנייה אחרון.',
    params: { query: ['string', 'שם או חלק משם הלקוח'], limit: ['integer', 'מספר תוצאות מרבי'] },
    required: ['query'],
    run: (D, a) => {
      const by = {};
      (D.sales || []).forEach(l => { if (!customerMatch(l, a.query)) return; const c = (by[l.c || l.cid] ||= { customer: l.c, id: l.cid, inv: new Set(), revenue: 0, last: '' }); c.inv.add(l.inv); c.revenue += l.v || 0; if (l.d > c.last) c.last = l.d; });
      const rows = Object.values(by).map(c => ({ customer: c.customer, id: c.id, invoices: c.inv.size, revenue: r0(c.revenue), lastPurchase: c.last })).sort((x, y) => y.revenue - x.revenue);
      return { total: rows.length, rows: rows.slice(0, LIMIT(a.limit)) };
    },
    label: (a) => `חיפוש לקוח "${a.query}"`,
  },

  sales: {
    description: 'מכירות מחשבוניות המכירה, עם סינון וקיבוץ. כמויות נטו (אחרי החזרות) ומחזור בש"ח לפני מע"מ. '
      + 'סנן לפי מוצרים, לקוח, ספק של המוצר וטווח תאריכים; קבץ לפי חודש / מוצר / לקוח / חשבונית / ספק, או סה"כ. '
      + 'בלי סינון מוצר — המחזור כולל גם שורות שאינן מוצר (הנחות, הובלה, שירות).',
    params: {
      products: ['array', 'מק"טים או שמות מוצרים (לא חובה)'], customer: ['string', 'שם לקוח או חלק ממנו (לא חובה)'], supplier: ['string', 'ספק של המוצר (לא חובה)'],
      from: ['string', 'מתאריך: YYYY או YYYY-MM או YYYY-MM-DD'], to: ['string', 'עד תאריך (כולל)'],
      group_by: ['string', 'month | product | customer | invoice | supplier | total'], sort: ['string', 'revenue | qty | date (ברירת מחדל revenue)'], limit: ['integer', 'מספר שורות מרבי'],
    },
    required: ['group_by'],
    run: (D, a) => {
      const from = dayFrom(a.from), to = dayTo(a.to);
      const pr = a.products ? resolveProducts(D, a.products) : null;
      const skuSet = pr ? new Set(pr.skus) : null;
      const custSet = a.customer ? resolveCustomers(D, a.customer) : null;
      const g = a.group_by || 'total';
      const by = {}; let tQ = 0, tV = 0, tRet = 0; const tInv = new Set(), tCust = new Set();
      (D.sales || []).forEach(l => {
        if (!inRange(l.d, from, to)) return;
        if (skuSet || a.supplier || g === 'product') { if (l.x || !l.k) return; if (skuSet && !skuSet.has(l.k)) return; if (a.supplier && !supplierMatch(supplierOfSku(D, l.k), a.supplier)) return; }
        if (custSet && !custSet.has(l.c || l.cid)) return;
        const key = g === 'month' ? ym(l.d) : g === 'product' ? (l.k || '(שורות שאינן מוצר)') : g === 'customer' ? (l.c || l.cid) : g === 'invoice' ? l.inv : g === 'supplier' ? (supplierOfSku(D, l.k) || 'לא ידוע') : 'total';
        const r = (by[key] ||= { key, qty: 0, revenue: 0, returnsQty: 0, inv: new Set(), cust: new Set(), date: l.d, customer: l.c });
        if (!l.x) { r.qty += l.q || 0; if (l.q < 0) r.returnsQty -= l.q; }
        r.revenue += l.v || 0; r.inv.add(l.inv); r.cust.add(l.c || l.cid); if (l.d > r.date) r.date = l.d;
        if (!l.x) { tQ += l.q || 0; if (l.q < 0) tRet -= l.q; } tV += l.v || 0; tInv.add(l.inv); tCust.add(l.c || l.cid);
      });
      let rows = Object.values(by).map(r => {
        const o = { [g === 'total' ? 'scope' : g]: r.key, qty: r1(r.qty), revenue: r0(r.revenue), invoices: r.inv.size };
        if (r.returnsQty) o.returnsQty = r1(r.returnsQty);
        if (g === 'product') { o.name = r.key.startsWith('(') ? r.key : nameOf(D, r.key); o.customers = r.cust.size; }
        if (g === 'month' || g === 'supplier') o.customers = r.cust.size;
        if (g === 'invoice') { o.date = r.date; o.customer = r.customer; }
        if (g === 'customer') o.lastPurchase = r.date;
        return o;
      });
      const sort = a.sort || (g === 'month' ? 'date' : 'revenue');
      rows.sort(sort === 'date' ? (x, y) => String(x.month || x.date || '').localeCompare(String(y.month || y.date || '')) : sort === 'qty' ? (x, y) => y.qty - x.qty : (x, y) => y.revenue - x.revenue);
      const total = rows.length; rows = rows.slice(0, LIMIT(a.limit, g === 'month' ? 60 : 30));
      const custs = custSet ? [...custSet] : null;
      return { period: periodText(from, to), productsMatched: pr ? pr.skus.map(k => `${nameOf(D, k)} (${k})`).slice(0, 15) : undefined, notFound: pr?.unknown?.length ? pr.unknown : undefined,
        customersMatched: custs ? custs.slice(0, 10) : undefined, nonProductLinesExcluded: g === 'product' && !skuSet && !a.supplier ? true : undefined,
        totals: { qty: r1(tQ), revenue: r0(tV), invoices: tInv.size, customers: tCust.size, returnsQty: r1(tRet) }, groups: total, rows };
    },
    label: (a) => ['מכירות', a.products ? `של ${[].concat(a.products).join(', ')}` : '', a.customer ? `ללקוח ${a.customer}` : '', a.supplier ? `מוצרי ${a.supplier}` : '',
      periodText(dayFrom(a.from), dayTo(a.to)), a.group_by && a.group_by !== 'total' ? `לפי ${{ month: 'חודש', product: 'מוצר', customer: 'לקוח', invoice: 'חשבונית', supplier: 'ספק' }[a.group_by] || a.group_by}` : ''].filter(Boolean).join(' · '),
  },

  compare_periods: {
    description: 'השוואה בין שתי תקופות (למשל רבעון מול אותו רבעון אשתקד) לפי מוצר / לקוח / ספק / סה"כ — מי עלה ומי ירד. '
      + 'אפשר לסנן לפי מוצרים, לקוח או ספק.',
    params: {
      from1: ['string', 'תקופה ראשונה (הבסיס) — מתאריך'], to1: ['string', 'תקופה ראשונה — עד'], from2: ['string', 'תקופה שנייה (להשוואה) — מתאריך'], to2: ['string', 'תקופה שנייה — עד'],
      group_by: ['string', 'product | customer | supplier | total'], products: ['array', 'מק"טים או שמות (לא חובה)'], customer: ['string', 'לקוח (לא חובה)'], supplier: ['string', 'ספק (לא חובה)'],
      sort: ['string', 'drop (הכי ירדו) | rise (הכי עלו) | value (הכי גדולים)'], measure: ['string', 'revenue | qty (ברירת מחדל revenue)'], limit: ['integer', 'מספר שורות מרבי'],
    },
    required: ['from1', 'to1', 'from2', 'to2', 'group_by'],
    run: (D, a) => {
      const run = (f, t) => TOOLS.sales.run(D, { products: a.products, customer: a.customer, supplier: a.supplier, from: f, to: t, group_by: a.group_by, limit: 100000 });
      const A = run(a.from1, a.to1), B = run(a.from2, a.to2);
      const g = a.group_by === 'total' ? 'scope' : a.group_by, m = a.measure === 'qty' ? 'qty' : 'revenue';
      const keys = new Set([...A.rows.map(r => r[g]), ...B.rows.map(r => r[g])]);
      const ia = Object.fromEntries(A.rows.map(r => [r[g], r])), ib = Object.fromEntries(B.rows.map(r => [r[g], r]));
      let rows = [...keys].map(k => {
        const x = ia[k] || {}, y = ib[k] || {};
        const o = { [g]: k, qty1: x.qty || 0, qty2: y.qty || 0, revenue1: x.revenue || 0, revenue2: y.revenue || 0 };
        if (g === 'product') o.name = x.name || y.name || nameOf(D, k);
        o.change = r0((o[m + '2'] || 0) - (o[m + '1'] || 0));
        o.changePct = o[m + '1'] ? r1(((o[m + '2'] - o[m + '1']) / Math.abs(o[m + '1'])) * 100) : null;
        return o;
      });
      rows.sort(a.sort === 'rise' ? (x, y) => y.change - x.change : a.sort === 'value' ? (x, y) => (y[m + '2'] + y[m + '1']) - (x[m + '2'] + x[m + '1']) : (x, y) => x.change - y.change);
      return { period1: A.period, period2: B.period, measure: m, totals1: A.totals, totals2: B.totals, groups: rows.length, rows: rows.slice(0, LIMIT(a.limit)) };
    },
    label: (a) => `השוואה ${periodText(dayFrom(a.from1), dayTo(a.to1))} מול ${periodText(dayFrom(a.from2), dayTo(a.to2))}${a.customer ? ` · ${a.customer}` : ''}${a.supplier ? ` · ${a.supplier}` : ''}`,
  },

  sold_together: {
    description: 'בודק לכמה מוצרים האם נמכרו ביחד באותה חשבונית או בנפרד: לכל זוג — כמה חשבוניות עם שניהם, וכמה עם כל אחד בלי השני (עם דוגמאות).',
    params: { products: ['array', '2 מוצרים או יותר — מק"טים או שמות'], from: ['string', 'מתאריך (לא חובה)'], to: ['string', 'עד תאריך (לא חובה)'] },
    required: ['products'],
    run: (D, a) => {
      const from = dayFrom(a.from), to = dayTo(a.to);
      const lists = [].concat(a.products || []).map(p => ({ q: p, ...resolveProducts(D, [p]) }));
      const lines = (D.sales || []).filter(l => l.k && l.q > 0 && inRange(l.d, from, to));
      const sets = lists.map(x => { const s = new Set(x.skus); return { label: x.skus.length === 1 ? `${nameOf(D, x.skus[0])} (${x.skus[0]})` : `${x.q} (${x.skus.length} מק"טים)`, inv: new Set(lines.filter(l => s.has(l.k)).map(l => l.inv)), lines: lines.filter(l => s.has(l.k)), found: x.skus.length > 0 }; });
      const pairs = [];
      for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
        const A = sets[i], B = sets[j]; const both = [...A.inv].filter(v => B.inv.has(v)).length;
        const ex = (S, O) => S.lines.filter(l => !O.inv.has(l.inv)).slice(0, 8).map(l => ({ date: l.d, customer: l.c, invoice: l.inv, qty: l.q }));
        pairs.push({ a: A.label, b: B.label, together: both, aWithoutB: A.inv.size - both, bWithoutA: B.inv.size - both, examplesAWithoutB: ex(A, B), examplesBWithoutA: ex(B, A) });
      }
      return { period: periodText(from, to), notFound: lists.filter(x => !x.skus.length).map(x => x.q), pairs };
    },
    label: (a) => `ביחד / בנפרד: ${[].concat(a.products || []).join(' + ')}`,
  },

  not_sold_since: {
    description: 'מוצרים שלא נמכרו מאז תאריך מסוים (לפי חשבוניות המכירה) — אפשר רק כאלה שיש להם מלאי, ולפי ספק.',
    params: { since: ['string', 'תאריך: לא נמכרו מאז (YYYY-MM-DD)'], with_stock_only: ['boolean', 'רק מוצרים עם מלאי חיובי'], supplier: ['string', 'ספק (לא חובה)'], limit: ['integer', 'מספר שורות מרבי'] },
    required: ['since'],
    run: (D, a) => {
      const since = dayFrom(a.since); const last = {};
      (D.sales || []).forEach(l => { if (l.k && l.q > 0 && (!last[l.k] || l.d > last[l.k])) last[l.k] = l.d; });
      const rows = Object.values(productIndex(D)).filter(p => !p.inactive && (!last[p.sku] || last[p.sku] < since) && (!a.with_stock_only || (p.stock || 0) > 0) && supplierMatch(p.supplier, a.supplier))
        .map(p => ({ sku: p.sku, name: p.name, supplier: p.supplier || '', stock: p.stock ?? null, lastSale: last[p.sku] || 'אף פעם בתקופת הנתונים', stockValue: p.unitCost != null && p.stock > 0 ? r0(p.unitCost * p.stock) : null }))
        .sort((x, y) => (y.stockValue || 0) - (x.stockValue || 0));
      return { since, total: rows.length, rows: rows.slice(0, LIMIT(a.limit)) };
    },
    label: (a) => `לא נמכרו מאז ${a.since}${a.supplier ? ` · ${a.supplier}` : ''}`,
  },

  stock_status: {
    description: 'מלאי ומצב הזמנה לפי מסך הרכש: מלאי, בדרך (הזמנות פתוחות), ממוצע מכירה חודשי, לכמה ימים המלאי מספיק, הצעת הזמנה וסטטוס. '
      + 'filter: order_now = להזמין עכשיו, soon = בקרוב, out = אזל, excess = עודף (מלאי ליותר משנה), all.',
    params: { products: ['array', 'מק"טים או שמות (לא חובה)'], supplier: ['string', 'ספק (לא חובה)'], filter: ['string', 'all | order_now | soon | out | excess'], limit: ['integer', 'מספר שורות מרבי'] },
    required: [],
    run: (D, a) => {
      const pr = a.products ? resolveProducts(D, a.products) : null; const skuSet = pr ? new Set(pr.skus) : null;
      const f = a.filter || 'all';
      const rows = (D.products || []).filter(p => !p.inactive && (!skuSet || skuSet.has(p.sku)) && supplierMatch(p.supplier, a.supplier)
        && (f === 'all' || (f === 'order_now' && p.status === 'now') || (f === 'soon' && p.status === 'soon') || (f === 'out' && p.stock != null && p.stock <= 0)
          || (f === 'excess' && p.avgMonthly > 0 && p.stock / p.avgMonthly > 12)))
        .map(p => ({ sku: p.sku, name: p.name, supplier: p.supplier, abc: p.abc, stock: p.stock, incoming: p.incoming, avgMonthly: p.avgMonthly, coverDays: p.coverDays,
          leadMonths: p.leadMonths, suggestedOrder: p.suggestedOrder, status: PROC_STATUS_LABEL[p.status] || p.status,
          ownMade: p.ownMade || undefined, madeToOrder: p.orderBlocked === 'mto' || undefined }))
        .sort((x, y) => (x.coverDays ?? 1e9) - (y.coverDays ?? 1e9));
      return { filter: f, notFound: pr?.unknown?.length ? pr.unknown : undefined, total: rows.length, rows: rows.slice(0, LIMIT(a.limit)) };
    },
    label: (a) => `מלאי ומצב הזמנה${a.supplier ? ` · ${a.supplier}` : ''}${a.products ? ` · ${[].concat(a.products).join(', ')}` : ''}${a.filter && a.filter !== 'all' ? ` · ${a.filter}` : ''}`,
  },

  purchases: {
    description: 'קניות מספקים לפי חשבוניות ספק: כמויות, מחיר ליחידה במטבע המקורי ובש"ח, תאריכים. סנן לפי ספק, מוצרים ותאריכים; קבץ לפי שורה / מוצר / ספק / חודש.',
    params: { supplier: ['string', 'ספק (לא חובה)'], products: ['array', 'מק"טים או שמות (לא חובה)'], from: ['string', 'מתאריך'], to: ['string', 'עד תאריך'],
      group_by: ['string', 'line | product | supplier | month'], limit: ['integer', 'מספר שורות מרבי'] },
    required: ['group_by'],
    run: (D, a) => {
      const from = dayFrom(a.from), to = dayTo(a.to);
      const pr = a.products ? resolveProducts(D, a.products) : null; const skuSet = pr ? new Set(pr.skus) : null;
      const ls = (D.purchases || []).filter(l => !l.junk && inRange(l.d, from, to) && (!skuSet || skuSet.has(l.k)) && supplierMatch(l.s, a.supplier));
      const ils = (l) => (l.tot != null ? l.tot : (l.p || 0) * (l.q || 0)) * (l.rate || 1);
      const g = a.group_by || 'line';
      let rows;
      if (g === 'line') rows = [...ls].sort((x, y) => (y.d > x.d ? 1 : -1)).map(l => ({ date: l.d, supplier: l.s, sku: l.k, name: l.n, qty: l.q, unitPrice: r1(l.p), currency: l.cur || 'ILS', totalILS: r0(ils(l)), po: l.po || '' }));
      else {
        const by = {};
        ls.forEach(l => { const key = g === 'product' ? l.k : g === 'supplier' ? l.s : ym(l.d); const r = (by[key] ||= { key, qty: 0, ils: 0, lines: 0, last: '', lastPrice: null, cur: '' }); r.qty += l.q || 0; r.ils += ils(l); r.lines++; if (l.d >= r.last) { r.last = l.d; r.lastPrice = l.p; r.cur = l.cur || 'ILS'; } });
        rows = Object.values(by).map(r => ({ [g]: r.key, ...(g === 'product' ? { name: nameOf(D, r.key), lastUnitPrice: r1(r.lastPrice), currency: r.cur } : {}), qty: r1(r.qty), totalILS: r0(r.ils), lines: r.lines, lastDate: r.last }))
          .sort(g === 'month' ? (x, y) => String(x.month).localeCompare(String(y.month)) : (x, y) => y.totalILS - x.totalILS);
      }
      return { period: periodText(from, to), productsMatched: pr ? pr.skus.map(k => `${nameOf(D, k)} (${k})`).slice(0, 15) : undefined, notFound: pr?.unknown?.length ? pr.unknown : undefined, totalILS: r0(ls.reduce((s, l) => s + ils(l), 0)), groups: rows.length, rows: rows.slice(0, LIMIT(a.limit)) };
    },
    label: (a) => `קניות${a.supplier ? ` מ-${a.supplier}` : ''}${a.products ? ` · ${[].concat(a.products).join(', ')}` : ''} · ${periodText(dayFrom(a.from), dayTo(a.to))}`,
  },

  open_orders: {
    description: 'הזמנות רכש פתוחות (שעוד לא התקבלו): ספק, מוצר, כמות, תאריך הזמנה, תאריך אספקה צפוי ואיחור בימים.',
    params: { supplier: ['string', 'ספק (לא חובה)'], products: ['array', 'מק"טים או שמות (לא חובה)'], late_only: ['boolean', 'רק הזמנות באיחור'], limit: ['integer', 'מספר שורות מרבי'] },
    required: [],
    run: (D, a) => {
      const pr = a.products ? resolveProducts(D, a.products) : null; const skuSet = pr ? new Set(pr.skus) : null;
      const rows = (D.orders || []).filter(o => supplierMatch(o.supplier, a.supplier) && (!skuSet || skuSet.has(o.sku)) && (!a.late_only || o.late > 0))
        .sort((x, y) => String(x.expected || '9').localeCompare(String(y.expected || '9')));
      return { total: rows.length, lateCount: rows.filter(o => o.late > 0).length, rows: rows.slice(0, LIMIT(a.limit, 50)) };
    },
    label: (a) => `הזמנות פתוחות${a.supplier ? ` · ${a.supplier}` : ''}${a.late_only ? ' · באיחור' : ''}`,
  },

  shipments: {
    description: 'משלוחים מהמשלח (מכולות): ספק, מספר מכולה ומספר תיק, נמל, תאריך הגעה לנמל, שלב, דחיות, תיאום הובלה. ברירת מחדל — רק מה שעוד לא התקבל.',
    params: { supplier: ['string', 'ספק (לא חובה)'], include_received: ['boolean', 'לכלול גם משלוחים שכבר התקבלו'], limit: ['integer', 'מספר שורות מרבי'] },
    required: [],
    run: (D, a) => {
      const rows = (D.shipments || []).filter(s => (a.include_received || !s.received) && (supplierMatch(s.supplier, a.supplier) || supplierMatch(s.forwarderName, a.supplier)))
        .sort((x, y) => String(x.arrival || '9').localeCompare(String(y.arrival || '9')));
      return { total: rows.length, rows: rows.slice(0, LIMIT(a.limit, 40)) };
    },
    label: (a) => `משלוחים${a.supplier ? ` · ${a.supplier}` : ''}`,
  },

  item_prices: {
    description: 'מחירי מכירה של מוצר, ישר מפריוריטי: מחיר בסיס, מחירון בסיס/סיטונאי/מינימום, המחירונים ללקוחות שהמוצר מופיע בהם (מחיר, הנחה, מחיר אחרי הנחה, כמות מינימלית, אם המחירון מאושר) ומחירים מיוחדים ללקוחות מסוימים. '
      + 'גם עלות הקנייה ליחידה (לחישוב רווח). עד 5 מוצרים בבקשה.',
    params: { products: ['array', 'מק"טים או שמות מוצרים (עד 5)'] },
    required: ['products'],
    run: async (D, a) => {
      if (!D.fetchPrices) return { error: 'קריאת מחירים מפריוריטי לא זמינה כאן' };
      const pr = resolveProducts(D, a.products); const out = [];
      for (const sku of pr.skus.slice(0, 5)) {
        const p = productIndex(D)[sku] || {};
        try {
          const r = await D.fetchPrices(sku);
          out.push({ sku, name: p.name || sku, unitCostILS: p.unitCost ?? null, base: r.base, priceLists: r.lists.slice(0, 40), customerPrices: r.custPrices.slice(0, 30) });
        } catch (e) { out.push({ sku, name: p.name || sku, error: String(e?.message || e) }); }
      }
      return { notFound: pr.unknown.length ? pr.unknown : undefined, moreMatches: pr.skus.length > 5 ? pr.skus.length : undefined, items: out };
    },
    label: (a) => `מחירי מכירה מפריוריטי: ${[].concat(a.products || []).join(', ')}`,
  },
};

// Gemini function declarations
export const aiToolDeclarations = () => Object.entries(TOOLS).map(([name, t]) => ({
  name, description: t.description,
  parameters: {
    type: 'OBJECT',
    properties: Object.fromEntries(Object.entries(t.params).map(([k, [type, description]]) => [k, type === 'array' ? { type: 'ARRAY', items: { type: 'STRING' }, description } : { type: type.toUpperCase(), description }])),
    required: t.required || [],
  },
}));

export const runAiTool = async (D, name, args = {}) => {
  const t = TOOLS[name];
  if (!t) return { result: { error: `אין כלי בשם ${name}` }, label: name };
  let result;
  try { result = await t.run(D, args || {}); } catch (e) { result = { error: String(e?.message || e) }; }
  // keep what goes back to the model small
  let json = JSON.stringify(result);
  if (json.length > 30000 && Array.isArray(result.rows)) { result = { ...result, rows: result.rows.slice(0, 40), cut: true }; json = JSON.stringify(result); }
  return { result, label: t.label ? t.label(args || {}) : name };
};

export const AI_SYSTEM_PROMPT = (today, range) => `אתה העוזר של אתר ניתוח הנתונים של "דורון שערים" — עסק לאוטומציה לשערים (מנועים, פיקודים, שלטים, מחסומים ועוד), שמוכר בעיקר למתקינים.
היום ${today}. נתוני חשבוניות המכירה מכסים ${range}.
יש לך כלים שקוראים את נתוני האתר (מכירות, לקוחות, מלאי, קניות מספקים, הזמנות פתוחות, משלוחים) ומחירי מכירה ומחירונים מפריוריטי. כללים:
- כל מספר בתשובה חייב להגיע מתוצאה של כלי. אל תנחש ואל תחשב מהזיכרון. אם צריך חישוב — בקש את הנתונים בכלי המתאים.
- כשלא ברור לאיזה מוצר / לקוח הכוונה — חפש קודם (find_products / find_customers). אם יש כמה התאמות, ציין אותן.
- "השנה" = מתחילת השנה הנוכחית עד היום; "שנה שעברה"/"אשתקד" = אותה תקופה בשנה הקודמת; "רבעון" = 3 חודשים קלנדריים.
- כשאתה מזכיר מוצר — כתוב את השם שלו ואת המק"ט בסוגריים. סכומים בש"ח לפני מע"מ.
- אם הנתונים לא מכילים את התשובה — אמור זאת בפשטות ואמור מה כן יש.
- ענה בעברית, קצר וברור. רשימות קצרות כשיש כמה פריטים.`;
