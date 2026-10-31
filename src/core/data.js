// ─── Core data logic (no React, no browser APIs) ──────────────────────
// Shared by the web app and the server-side Priority sync (Supabase Edge
// Function "priority-sync"), so both turn Priority data into exactly the same
// rows. The server gets a copy of this file — edit it here, then run
// scripts/copy-core.sh before deploying the function.

export const HebrewMonthsMap = {
  0:'ינו',1:'פבר',2:'מרץ',3:'אפר',4:'מאי',5:'יונ',
  6:'יול',7:'אוג',8:'ספט',9:'אוק',10:'נוב',11:'דצמ'
};

export const HebrewMonthsReverse = {
  'ינו':1,'פבר':2,'מרץ':3,'אפר':4,'מאי':5,'יונ':6,
  'יול':7,'אוג':8,'ספט':9,'אוק':10,'נוב':11,'דצמ':12
};

export const excelDateToJS = (serial) => new Date((Math.floor(serial - 25569)) * 86400 * 1000);

export const normalizeDate = (val) => {
  if (!val) return '';
  if (typeof val === 'string' && val.includes('-') && isNaN(parseFloat(val))) return val;
  const n = parseFloat(val);
  const d = (!isNaN(n) && n > 30000 && n < 60000) ? excelDateToJS(n) : new Date(val);
  if (d && !isNaN(d.getTime())) return `${HebrewMonthsMap[d.getMonth()]}-${d.getFullYear().toString().slice(-2)}`;
  return String(val);
};

export const getDateVal = (s) => {
  if (!s || typeof s !== 'string') return 0;
  const [m, y] = s.split('-');
  return ((parseInt(y)+2000) * 100) + (HebrewMonthsReverse[m] || 0);
};

export const monthsDiff = (a, b) => {
  if (!a || !b) return 1;
  const p = (d) => { const [m,y]=d.split('-'); return { m:HebrewMonthsReverse[m]||1, y:parseInt(y)+2000 }; };
  const s=p(a), e=p(b);
  return ((e.y-s.y)*12)+(e.m-s.m)+1;
};

// ─── PRIORITY OPEN ORDERS PARSER ──────────────────────────────────
export const parsePriorityOrders = (rows) => {
  if (!rows.length) return [];
  const norm = s => (s||'').toString().trim();
  const headers = Object.keys(rows[0]).map(norm);

  // Detect columns — exact match first, then partial (avoids "ת. הזמנה" matching "הזמנה")
  const findCol = (...variants) => {
    for (const v of variants) {
      const idx = headers.findIndex(h => h === v);          // exact
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers.findIndex(h => h.startsWith(v));  // starts-with
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers.findIndex(h => h.includes(v));    // contains
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colPO    = findCol('הזמנה', 'מספר הזמנה', 'PO', 'po number');
  const colSKU   = findCol('מק"ט', "מק'ט", 'מקט', 'sku', 'item number');
  const colName  = findCol('תאור מוצר', 'תיאור מוצר', 'תאור פריט', 'תיאור פריט', 'שם מוצר');
  const colQty   = findCol('יתרה לאספקה', 'יתרה');
  const colVal   = findCol('שווי יתרה', 'שווי');
  const colDate  = findCol('ת. הזמנה', 'תאריך הזמנה', 'ת.הזמנה', 'תאריך');
  const colExpDate = findCol('ת. אספקה', 'תאריך אספקה', 'ת.אספקה', 'תאריך אספקה צפוי');
  const colSup   = findCol('שם ספק', 'ספק', 'שם יצרן');
  // PO status — from the sync ('סטטוס הזמנה') or an exported report ('סטטוס'). Only sent / approved orders are open.
  const colStatus = headers.indexOf('סטטוס הזמנה') !== -1 ? headers.indexOf('סטטוס הזמנה') : headers.indexOf('סטטוס');
  const colSent   = headers.indexOf('ת. שליחה');

  // Convert Excel serial date → dd/mm/yyyy
  const excelToDate = (serial) => {
    const n = parseFloat(serial);
    if (isNaN(n) || n < 30000 || n > 70000) return serial?.toString() || '';
    const dt = new Date((n - 25569) * 86400 * 1000);
    return dt.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
  };

  const result = [];
  rows.forEach(row => {
    const vals = Object.values(row).map(v => norm(String(v)));
    const sku  = colSKU  !== -1 ? vals[colSKU]  : '';
    const name = colName !== -1 ? vals[colName] : '';
    if (!sku && !name) return;

    const qtyRaw = colQty !== -1 ? parseFloat(vals[colQty]) : NaN;
    const qty = isNaN(qtyRaw) || qtyRaw <= 0 ? 0 : qtyRaw;
    if (qty <= 0) return; // skip rows with no remaining qty
    if (colStatus !== -1 && vals[colStatus] && !['נשלחה', 'אושרה'].includes(vals[colStatus])) return; // draft / waiting for approval / closed

    const valRaw = colVal !== -1 ? parseFloat(vals[colVal]) : NaN;

    result.push({
      id:          Date.now().toString(36) + Math.random().toString(36).slice(2),
      poNumber:    colPO   !== -1 ? vals[colPO]   : '',
      productKey:  sku || name,
      productName: name || sku,
      supplier:    colSup  !== -1 ? vals[colSup]  : '',
      orderedQty:  qty,
      orderDate:   colDate !== -1 ? excelToDate(vals[colDate]) : '',
      expectedDate: colExpDate !== -1 ? excelToDate(vals[colExpDate]) : '',
      status:      'ordered',
      notes:       '',
      value:       isNaN(valRaw) ? 0 : valRaw,
      fromPriority: true,
      poStatus:    colStatus !== -1 ? vals[colStatus] : '',
      sentDate:    colSent !== -1 ? excelToDate(vals[colSent]) : '',
    });
  });
  return result;
};

// ─── INVENTORY FILE PARSER ─────────────────────────────
export const parseInventoryFile = (rows) => {
  // Column name variants — Priority "יתרות מלאי" uses: מק'ט (B), תאור מוצר (C), יתרה (J)
  // Priority "כרטיס פריטים" uses: מק"ט (A), תאור (B), מחיר קניה אחרון (AI), עלות ש"ח (AN)
  const COL = {
    sku:      ["מק'ט",'מק"ט','מקט','sku','item number','item','barcode','ברקוד','קוד פריט','קוד מוצר','מספר פריט'],
    name:     ['תאור מוצר','תיאור מוצר','תאור','תיאור','שם מוצר','שם פריט','item name','description','פריט','שם'],
    status:   ['סטטוס','status'],
    managed:  ['מנוהל מלאי'],
    quantity: ['יתרה','יתרה במלאי','יתרת מלאי','כמות במלאי','כמות מלאי','qty','stock','quantity','כמות בסטוק'],
    minStock: ['כמות מינימום למלאי','מינימום למלאי','מינימום מלאי','min stock','מינ מלאי','רמת הזמנה'],
    cost:     ['מחיר קניה אחרון','מחיר קניה','עלות ש"ח','עלות שח','עלות','unit cost','cost','מחיר ספק'],
    costAlt:  ['עלות ש"ח','עלות שח','עלות כוללת'],
    supplier: ['שם ספק','ספק','supplier'],
    moq:      ['כמות מינימום להזמנה','מינימום הזמנה','כמות הזמנה מינימלית','moq','min order','minimum order qty','minimum order quantity'],
    currency: ['מטבע','currency'],
  };
  const norm = (s) => (s||'').toString().trim().replace(/\s+/g,' ');
  const findCol = (headers, variants) => {
    for (const v of variants) {
      const idx = headers.findIndex(h => norm(h) === v);
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers.findIndex(h => norm(h).includes(v));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]).map(norm);

  const skuIdx      = findCol(headers, COL.sku);
  const nameIdx     = findCol(headers, COL.name);
  const statusIdx   = findCol(headers, COL.status);
  const managedIdx  = findCol(headers, COL.managed);
  const qtyIdx      = findCol(headers, COL.quantity);
  const minStockIdx = findCol(headers, COL.minStock);
  const costIdx     = findCol(headers, COL.cost);
  const costAltIdx  = findCol(headers, COL.costAlt);
  const supplierIdx = findCol(headers, COL.supplier);
  const moqIdx      = findCol(headers, COL.moq);
  // Currency: only meaningful when paired with the primary cost column
  // ("מחיר קניה אחרון"), since that's the column whose value we store as unitCost.
  const currencyIdx = (costIdx !== -1) ? findCol(headers, COL.currency) : -1;

  // Priority master (כרטיס פריטים) = has SKU + cost but NO quantity column
  const isPriorityMaster = skuIdx !== -1 && costIdx !== -1 && qtyIdx === -1;

  const result = [];
  rows.forEach(row => {
    const vals = Object.values(row).map(v => norm(String(v)));
    const sku  = skuIdx  !== -1 ? vals[skuIdx]  : '';
    const name = nameIdx !== -1 ? vals[nameIdx] : '';
    if (!sku && !name) return;

    if (isPriorityMaster) {
      const status  = statusIdx  !== -1 ? vals[statusIdx]  : '';
      const managed = managedIdx !== -1 ? vals[managedIdx] : '';
      if (status && status !== 'פעיל') return;
      if (managed && managed !== 'Y') return;
    }

    // Quantity — ALLOW NEGATIVE (backorder/deficit), only skip if absent
    const qtyRaw = qtyIdx !== -1 ? parseFloat(vals[qtyIdx].replace(/[^\d.-]/g,'')) : NaN;
    const qty = isNaN(qtyRaw) ? null : qtyRaw;
    if (!isPriorityMaster && qty === null) return;

    const c1 = costIdx    !== -1 ? parseFloat(vals[costIdx].replace(/[^\d.-]/g,''))    : NaN;
    const c2 = costAltIdx !== -1 ? parseFloat(vals[costAltIdx].replace(/[^\d.-]/g,'')) : NaN;
    const cost = (!isNaN(c1) && c1 > 0) ? c1 : ((!isNaN(c2) && c2 > 0) ? c2 : null);

    const minRaw = minStockIdx !== -1 ? parseFloat(vals[minStockIdx].replace(/[^\d.-]/g,'')) : NaN;
    const minStock = (!isNaN(minRaw) && minRaw > 0) ? minRaw : null;

    const supplier = supplierIdx !== -1 ? vals[supplierIdx] : null;
    const moqRaw = moqIdx !== -1 ? parseFloat(vals[moqIdx].replace(/[^\d.-]/g,'')) : NaN;
    const moq = (!isNaN(moqRaw) && moqRaw > 0) ? moqRaw : null;
    const currRaw = currencyIdx !== -1 ? vals[currencyIdx] : '';
    // Broad, case-insensitive normalization — Priority exports vary a lot in
    // how currency is written (symbol, Hebrew word, English code, ISO code),
    // and a miss here silently falls through to "treat as ILS" elsewhere, so
    // it's worth casting a wide net rather than only matching exact symbols.
    const currNorm = currRaw.toLowerCase().replace(/\s+/g,'');
    const currency = !currNorm ? null
      : ['ש"ח','שח','₪','ils','nis','שקל','שקלים'].includes(currNorm) ? 'ILS'
      : ['$','usd','us$','דולר','דולרים'].includes(currNorm) ? 'USD'
      : ['€','eur','אירו','יורו'].includes(currNorm) ? 'EUR'
      : currRaw; // unrecognized value kept as-is — will show as a blocked/unmapped currency rather than silently defaulting to ILS
    result.push({ sku: sku||name, name: name||sku, quantity: qty, cost, minStock, supplier, moq, currency });
  });
  return result;
};

// ─── CUSTOMER FILES ─────────────────────────────────────
// File 1: "מכירות ללקוח" — customer × month, no product breakdown.
// Gives the time dimension: trend, churn, new customers.
export const parseCustomerMonthlyFile = (rows) => {
  if (!rows.length) return [];
  const norm = (s) => (s||'').toString().trim();
  const headers = Object.keys(rows[0]).map(norm);
  const findCol = (variants) => {
    for (const v of variants) { const idx = headers.findIndex(h => h === v); if (idx !== -1) return idx; }
    for (const v of variants) { const idx = headers.findIndex(h => h.includes(v)); if (idx !== -1) return idx; }
    return -1;
  };
  const idIdx     = findCol(['מס. לקוח','מספר לקוח','מס לקוח','קוד לקוח']);
  const nameIdx    = findCol(['שם לקוח','לקוח']);
  const monthIdx   = findCol(['חודש']);
  const revIdx     = findCol(['הכנסה משוערכת','הכנסה']); // prefer the normalized/revalued figure if present
  const revInclIdx = findCol(["הכנסה כולל מע'מ","הכנסה כולל מעמ"]);
  const result = [];
  rows.forEach(row => {
    const vals = Object.values(row).map(v => norm(String(v)));
    const name = nameIdx !== -1 ? vals[nameIdx] : '';
    const month = monthIdx !== -1 ? vals[monthIdx] : '';
    if (!name || !month) return;
    const revenue = revIdx !== -1 ? parseFloat(vals[revIdx].replace(/[^\d.-]/g,'')) : NaN;
    const revenueIncl = revInclIdx !== -1 ? parseFloat(vals[revInclIdx].replace(/[^\d.-]/g,'')) : NaN;
    result.push({
      customerId: idIdx !== -1 ? vals[idIdx] : name,
      customer: name,
      date: month,
      revenue: isNaN(revenue) ? 0 : revenue,
      revenueIncl: isNaN(revenueIncl) ? null : revenueIncl,
    });
  });
  return result;
};

// File 2: "מכירות מוצר ללקוח" — customer × product, totals over the whole period (no month).
// Gives the breadth dimension: product mix, cross-sell, customer-product concentration.
export const parseCustomerProductFile = (rows) => {
  if (!rows.length) return [];
  const norm = (s) => (s||'').toString().trim();
  const headers = Object.keys(rows[0]).map(norm);
  const findCol = (variants) => {
    for (const v of variants) { const idx = headers.findIndex(h => h === v); if (idx !== -1) return idx; }
    for (const v of variants) { const idx = headers.findIndex(h => h.includes(v)); if (idx !== -1) return idx; }
    return -1;
  };
  const idIdx   = findCol(['מס. לקוח','מספר לקוח','מס לקוח','קוד לקוח']);
  const nameIdx  = findCol(['שם לקוח','לקוח']);
  const skuIdx   = findCol(["מק'ט",'מק"ט','מקט']);
  const prodIdx  = findCol(['תאור מוצר','תיאור מוצר','תאור','תיאור']);
  const qtyIdx   = findCol(['כמות']);
  const revIdx   = findCol(['הכנסה משוערכת','הכנסה']);
  const result = [];
  rows.forEach(row => {
    const vals = Object.values(row).map(v => norm(String(v)));
    const name = nameIdx !== -1 ? vals[nameIdx] : '';
    const product = prodIdx !== -1 ? vals[prodIdx] : '';
    if (!name || !product) return;
    const qty = qtyIdx !== -1 ? parseFloat(vals[qtyIdx].replace(/[^\d.-]/g,'')) : NaN;
    const revenue = revIdx !== -1 ? parseFloat(vals[revIdx].replace(/[^\d.-]/g,'')) : NaN;
    result.push({
      customerId: idIdx !== -1 ? vals[idIdx] : name,
      customer: name,
      sku: skuIdx !== -1 ? vals[skuIdx] : '',
      product,
      quantity: isNaN(qty) ? 0 : qty,
      revenue: isNaN(revenue) ? 0 : revenue,
    });
  });
  return result;
};

// ─── PROCUREMENT PAGE ──────────────────────────────────
export const MONTH_FULL_LABELS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

export const MONTH_ABBR_LABELS_SHORT = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];

// Parses both date formats that reach the procurement page: Priority exports
// arrive as "dd/mm/yyyy" (he-IL), the manual order form stores "yyyy-mm-dd".
// `new Date("15/07/2026")` is Invalid Date, which is why overdue detection
// never fired for Priority-imported orders — every date must go through here.
export const parseFlexDate = (s) => {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  const str = String(s).trim();
  if (str.includes('/')) { const [d,m,y] = str.split('/').map(Number); if (d&&m&&y) return new Date(y<100?2000+y:y, m-1, d); return null; }
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) { const [y,m,d] = str.slice(0,10).split('-').map(Number); return new Date(y, m-1, d); }
  return null;
};

export const DAY_MS = 24*60*60*1000;

export const startOfToday = () => { const t = new Date(); t.setHours(0,0,0,0); return t; };

// Service level per ABC class — A items must not run out (98%), C items
// shouldn't tie up cash in buffer stock (90%). Z = standard-normal quantile.
export const SERVICE_LEVEL = { A:{ z:2.05, pct:98 }, B:{ z:1.65, pct:95 }, C:{ z:1.28, pct:90 } };

// Single source of truth for "how much to order" — used by the main table
// AND the what-if scenario, so the two can never drift apart again.
//   demand over the horizon (lead time + months of stock), month by month,
//   scaled by the seasonal index of each upcoming calendar month when the
//   product has enough history for seasonality to be trusted
// + buffer  = max(statistical safety stock, Priority minimum stock)
// − stock on hand − quantity already on the way
// then rounded up to the supplier's MOQ.
// leadTimeStd (months): how much the supplier's real delivery time varies — an
// unreliable supplier needs more safety stock than a steady one with the same average.
export const calcOrderPlan = ({ avgMonthly, stdDev, abc, leadTime, leadTimeStd = 0, monthsToStock, seasonalityIdx, seasonalityReliable, nextMonIdx, effectiveStock, minStock, moq, multiplier = 1 }) => {
  const base = avgMonthly * multiplier;
  const horizon = Math.max(0, leadTime + monthsToStock);
  let projectedDemand = 0;
  const useSeason = seasonalityReliable && nextMonIdx >= 0 && Array.isArray(seasonalityIdx);
  for (let i = 0; i < Math.ceil(horizon); i++) {
    const portion = Math.min(1, horizon - i);
    const f = useSeason ? Math.max(0.5, Math.min(2.0, seasonalityIdx[(nextMonIdx + i) % 12] || 1)) : 1;
    projectedDemand += base * f * portion;
  }
  const flatDemand = base * horizon;
  const sl = SERVICE_LEVEL[abc] || SERVICE_LEVEL.B;
  // σ of demand over the lead time = √(LT·σd² + d²·σLT²)  (demand and supplier variability together)
  const lt = Math.max(leadTime, 0.5);
  const sigma = Math.sqrt(lt * Math.pow(stdDev || 0, 2) * multiplier + Math.pow(base, 2) * Math.pow(leadTimeStd || 0, 2));
  const safetyStock = Math.ceil(sl.z * sigma);
  const buffer = Math.max(safetyStock, minStock || 0);
  const raw = Math.max(0, Math.ceil(projectedDemand + buffer - (effectiveStock || 0)));
  const rounded = (moq && moq > 0 && raw > 0) ? Math.ceil(raw / moq) * moq : raw;
  const rawFlat = Math.max(0, Math.ceil(flatDemand + buffer - (effectiveStock || 0)));
  return { suggestedOrder: rounded, suggestedOrderRaw: raw, suggestedOrderFlat: rawFlat, projectedDemand, safetyStock, buffer, serviceLevel: sl.pct, seasonalApplied: useSeason && Math.abs(projectedDemand - flatDemand) > 0.5 };
};

export const normHeader = (h) => String(h??'').replace(/[‎‏]/g,'').replace(/\s+/g,' ').trim();

export const findHeaderRow = (rows, required) => {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hs = rows[i].map(normHeader);
    if (required.every(req => hs.some(h => h === req))) return i;
  }
  return -1;
};

export const colIndex = (headers, ...names) => { for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i; } return -1; };

// Any date shape Excel / Priority hands us → 'yyyy-mm-dd' (or '' when absent)
export const toIsoDate = (v) => {
  if (v == null || v === '') return '';
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') { if (v > 20000 && v < 80000) d = new Date(Math.round((v - 25569) * 86400 * 1000)); }
  else {
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; d = new Date(y, +m[2]-1, +m[1]); }
    else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) d = new Date(+m[1], +m[2]-1, +m[3]);
  }
  if (!d || isNaN(d.getTime())) return '';
  // Dates from Excel arrive as UTC midnight; nudge by 12h so the local date never slips a day.
  const dd = new Date(d.getTime() + 12*3600*1000);
  return `${dd.getUTCFullYear()}-${String(dd.getUTCMonth()+1).padStart(2,'0')}-${String(dd.getUTCDate()).padStart(2,'0')}`;
};

export const isoToDisplay = (iso) => iso ? `${iso.slice(8,10)}.${iso.slice(5,7)}.${iso.slice(2,4)}` : '';

export const isoToMonthKey = (iso) => iso ? `${HebrewMonthsMap[+iso.slice(5,7)-1]}-${iso.slice(2,4)}` : '';

export const daysBetween = (a, b) => (parseFlexDate(b) - parseFlexDate(a)) / DAY_MS;

export const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v??'').replace(/[^\d.-]/g,'')); return isNaN(n) ? 0 : n; };

export const normCurrency = (c) => {
  const s = String(c||'').toLowerCase().replace(/\s+/g,'');
  if (!s || ['ש"ח','שח','₪','ils','nis'].includes(s)) return 'ILS';
  if (['$','usd','us$','דולר'].includes(s)) return 'USD';
  if (['eur','€','אירו','יורו'].includes(s)) return 'EUR';
  return String(c).trim();
};

// Text / summary / discount lines Priority puts inside invoices — not products.
export const isJunkSku = (sku, desc) => !sku || sku === '000' || sku === '1' || sku === 'H000' || /^-{3,}/.test(String(desc||''));

// ─── Invoice lines → the monthly datasets the other tabs use ───────────
// Months the lines cover replace the same months from uploaded files; older
// months still come from the files. The earliest month counts as covered only
// if the lines start in its first days — otherwise (a sync that began mid-month)
// that month stays with the file when the file has it.
export const linesCoverage = (lines, fileMonths) => {
  const covered = new Set(lines.map(l => isoToMonthKey(l.d)));
  if (lines.length) {
    const first = lines.reduce((m, l) => l.d < m ? l.d : m, lines[0].d);
    const fk = isoToMonthKey(first);
    if (+first.slice(8, 10) > 3 && fileMonths.has(fk)) covered.delete(fk);
  }
  return covered;
};

export const linesRange = (lines) => {
  if (!lines?.length) return null;
  let from = lines[0].d, to = lines[0].d;
  lines.forEach(l => { if (l.d < from) from = l.d; if (l.d > to) to = l.d; });
  return { from, to };
};

export const NON_PRODUCT_LABEL = 'שורות ללא מוצר (הנחות, שירות, הובלה)';

// product × month rows (same shape as the "מכירות חודשיות לפי מוצר" file)
export const mergeLinesIntoMonthly = (raw, lines, { includeExtra = false } = {}) => {
  const use = includeExtra ? lines : lines.filter(l => !l.x);
  if (!use.length) return raw;
  const covered = linesCoverage(use, new Set(raw.map(r => r.date)));
  const agg = {}, names = {};
  use.forEach(l => {
    const m = isoToMonthKey(l.d); if (!covered.has(m)) return;
    const sku = l.k || '__extra'; const key = sku + '|' + m;
    if (!agg[key]) agg[key] = { sku: l.k, date: m, quantity: 0, total: 0, extra: !l.k };
    agg[key].quantity += l.x ? 0 : l.q; agg[key].total += l.v;
    if (l.k && !names[l.k] && l.q > 0 && !l.x) names[l.k] = l.n;
    if (l.k && !names[l.k]) names[l.k] = l.n;
  });
  const fromLines = Object.values(agg).map((r, i) => ({ id: 'sl-' + i, sku: r.sku, date: r.date, quantity: r.quantity, total: Math.round(r.total * 100) / 100,
    description: r.extra ? NON_PRODUCT_LABEL : (names[r.sku] || r.sku), unit: "יח'", supplier: 'כללי', fromLines: true }));
  return [...raw.filter(r => !covered.has(r.date)), ...fromLines];
};

// customer × month revenue (same shape as the "מכירות ללקוח בחתך חודשי" file)
export const customerMonthlyFromLines = (raw, lines) => {
  if (!lines.length) return raw;
  const covered = linesCoverage(lines, new Set(raw.map(r => r.date)));
  const agg = {};
  lines.forEach(l => {
    const m = isoToMonthKey(l.d); if (!covered.has(m) || !l.c) return;
    const key = l.c + '|' + m;
    if (!agg[key]) agg[key] = { customerId: l.cid || l.c, customer: l.c, date: m, revenue: 0, revenueIncl: null, fromLines: true };
    agg[key].revenue += l.v;
  });
  Object.values(agg).forEach(r => { r.revenue = Math.round(r.revenue * 100) / 100; });
  return [...raw.filter(r => !covered.has(r.date)), ...Object.values(agg)];
};

// customer × product totals for the whole period the lines cover
export const customerProductsFromLines = (lines) => {
  const agg = {}, names = {};
  lines.forEach(l => {
    if (!l.k || !l.c) return;
    if (!names[l.k] || (!l.x && l.q > 0)) names[l.k] = names[l.k] && l.x ? names[l.k] : l.n;
    const key = l.c + '|' + l.k;
    if (!agg[key]) agg[key] = { customerId: l.cid || l.c, customer: l.c, sku: l.k, product: '', quantity: 0, revenue: 0 };
    agg[key].quantity += l.x ? 0 : l.q; agg[key].revenue += l.v;
  });
  return Object.values(agg).map(r => ({ ...r, product: names[r.sku] || r.sku, revenue: Math.round(r.revenue * 100) / 100 }))
    .filter(r => r.quantity !== 0 || r.revenue !== 0);
};

// What a file is, from its headers — used to warn when a file is dropped into the wrong slot.
export const PROC_FILE_SIGNATURES = [
  { type:'shipments',     test: hs => hs.includes('Containers List') || (hs.includes('Supplier Name') && hs.includes('Arrival Date')) },
  { type:'salesLines',    test: hs => hs.includes('שם לקוח') && hs.includes('מק"ט') && hs.includes('כמות') && hs.includes('חשבונית') },
  { type:'purchaseLines', test: hs => hs.includes('שם ספק') && hs.includes('מק"ט') && hs.includes('כמות') && hs.includes('חשבונית') },
  { type:'openOrders',    test: hs => hs.some(h => h.startsWith('יתרה לאספקה')) },
  { type:'inventory',     test: hs => hs.includes('יתרה') || hs.some(h => h.startsWith('יתרה במלאי')) },
  { type:'masterCard',    test: hs => hs.some(h => h.startsWith('מחיר קניה')) },
];

export const detectProcFileType = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hs = rows[i].map(normHeader);
    const hit = PROC_FILE_SIGNATURES.find(s => s.test(hs));
    if (hit) return hit.type;
  }
  return null;
};

// Sales invoice lines → [{d, inv, cid, c, k, n, q, v}]  (q is net: returns are negative)
export const parseSalesLines = (rows) => {
  const hi = findHeaderRow(rows, ['תאריך','מק"ט','כמות','שם לקוח']);
  if (hi === -1) return null;
  const H = rows[hi].map(normHeader);
  const c = {
    d: colIndex(H,'תאריך'), inv: colIndex(H,'חשבונית'), cid: colIndex(H,'מס. לקוח'), cn: colIndex(H,'שם לקוח'),
    k: colIndex(H,'מק"ט'), n: colIndex(H,'תאור מוצר','תיאור מוצר'), q: colIndex(H,'כמות'),
    v: colIndex(H,'סה"כ אחרי הנחה','סה"כ מחיר'), ord: colIndex(H,'הזמנה'),
  };
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const k = String(r[c.k]??'').trim(), n = String(r[c.n]??'').trim();
    const q = num(r[c.q]), v = c.v!==-1 ? num(r[c.v]) : 0;
    const junk = isJunkSku(k, n);
    // Lines that aren't a product sale (discount / service / shipping lines, or a
    // price-only correction) still count toward revenue — kept, flagged x:1.
    if ((junk || !q) && !v) continue;
    const d = toIsoDate(r[c.d]); if (!d) continue;
    const line = { d, inv:String(r[c.inv]??''), cid:String(r[c.cid]??''), c:String(r[c.cn]??'').trim(), k: junk ? '' : k, n, q: junk ? 0 : q, v, o: c.ord!==-1 ? String(r[c.ord]??'') : '' };
    if (junk || !q) line.x = 1;
    out.push(line);
  }
  out.sort((a,b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0); // newest first
  return out;
};

// Supplier invoice lines → [{d, s, k, n, q, p, cur, tot, rate, po, pod}]
export const parsePurchaseLines = (rows) => {
  const hi = findHeaderRow(rows, ['תאריך','שם ספק','מק"ט','כמות']);
  if (hi === -1) return null;
  const H = rows[hi].map(normHeader);
  const c = {
    d: colIndex(H,'תאריך'), inv: colIndex(H,'חשבונית'), s: colIndex(H,'שם ספק'), k: colIndex(H,'מק"ט'),
    n: colIndex(H,'תאור מוצר','תיאור מוצר'), q: colIndex(H,'כמות'), p: colIndex(H,'מחיר ליחידה'),
    cur: colIndex(H,'מטבע שורה','מטבע חשבונית'), tot: colIndex(H,'סה"כ אחרי הנחה','סה"כ מחיר'),
    rate: colIndex(H,'שער חליפין'), po: colIndex(H,'הזמנת רכש'), pod: colIndex(H,'תאריך ההזמנה','תאריך הזמנה'), pos: colIndex(H,'תאריך שליחה'), dc: colIndex(H,'חיוב/זכוי'),
  };
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const s = String(r[c.s]??'').trim(); if (!s) continue;
    const d = toIsoDate(r[c.d]); if (!d) continue;
    const k = String(r[c.k]??'').trim(), n = String(r[c.n]??'').trim();
    const sign = c.dc!==-1 && String(r[c.dc]).trim()==='C' ? -1 : 1;
    const cur = normCurrency(r[c.cur]);
    const rate = c.rate!==-1 ? (num(r[c.rate]) || 1) : 1;
    out.push({ d, inv:String(r[c.inv]??''), s, k, n, junk: isJunkSku(k, n), q: num(r[c.q]) * sign, p: num(r[c.p]), cur,
      tot: num(r[c.tot]) * sign, rate: cur==='ILS' ? 1 : rate, po: c.po!==-1 ? String(r[c.po]??'').trim() : '', pod: c.pod!==-1 ? toIsoDate(r[c.pod]) : '', pos: c.pos!==-1 ? toIsoDate(r[c.pos]) : '' });
  }
  out.sort((a,b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
  return out;
};

// Forwarder daily report → [{id, job, file, ref, sup, from, to, pickup, dep, arr, mode, qty, pkg, cont, event, transport}]
export const parseShipments = (rows) => {
  const hi = findHeaderRow(rows, ['Supplier Name','Arrival Date']);
  if (hi === -1) return null;
  const H = rows[hi].map(normHeader);
  const g = (r, ...n) => { const i = colIndex(H, ...n); return i === -1 ? '' : r[i]; };
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const sup = String(g(r,'Supplier Name')||'').trim(); if (!sup) continue;
    const job = String(g(r,'Job Order No')||'').trim();
    const file = String(g(r,'File Number')||'').trim();
    out.push({
      id: job || file || `${sup}-${i}`, job, file: /^0*$/.test(file) ? '' : file, ref: String(g(r,'Customer Reference')||'').trim(), sup,
      from: String(g(r,'Load Port')||'').trim(), to: String(g(r,'Discharge Port')||'').trim(),
      pickup: toIsoDate(g(r,'Pick Up Date')), dep: toIsoDate(g(r,'Departure Date')), arr: toIsoDate(g(r,'Arrival Date')),
      mode: String(g(r,'FCL/LCL')||'').trim(), qty: num(g(r,'QTY')), pkg: String(g(r,'Freight Package Desc')||'').trim(),
      cont: String(g(r,'Containers List')||'').trim(), event: String(g(r,'Last Event Desc')||'').trim(), transport: String(g(r,'Transport Type')||'').trim(),
    });
  }
  return out;
};

// Where a shipment is, in plain words — from its dates (the event text is free-form).
export const shipmentStage = (s, todayIso) => {
  if (!s.dep) return { idx:0, label:'בהכנה' };
  if (s.dep > todayIso) return { idx:0, label:'ממתין להפלגה' };
  if (!s.arr || s.arr > todayIso) return { idx:1, label:'בדרך' };
  return { idx:2, label:'הגיע לנמל' };
};

// Forwarder supplier names are English ("JIE LONG SHUTTER MOTORS LTD"), Priority
// names are often Hebrew + English ("בנינקה - BENINCA"). Match on distinctive
// Latin words, also allowing split words to join ("JIE LONG" → "JIELONG").
export const SHIP_NAME_STOP = new Set(['LTD','LIMITED','CO','COMPANY','CORP','CORPORATION','INC','GMBH','SPA','SRL','SA','INTERNATIONAL','TRADE','TRADING','INDUSTRY','INDUSTRIAL','TECHNOLOGY','TECH','INTELLIGENT','ELECTRIC','ELECTRONIC','ELECTRONICS','MACHINE','MOTORS','MOTOR','SHUTTER','HARDWARE','GROUP','AND','THE','CITY','CHINA','GUANGDONG','NINGBO','ZHEJIANG','SHANGHAI','SHENZHEN','XIAMEN','JIANGSU','FUJIAN','UND','AUTOMATISMI','AUTOMATION','SYSTEMS','SYSTEM']);

export const matchShipSupplier = (fwdName, candidates) => {
  const words = String(fwdName).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
  const keys = new Set();
  words.forEach((w,i) => { if (w.length >= 4 && !SHIP_NAME_STOP.has(w)) keys.add(w); if (i < words.length-1) { const j = w + words[i+1]; if (j.length >= 6) keys.add(j); } });
  if (!keys.size) return null;
  let best = null, bestScore = 0;
  candidates.forEach(cand => {
    const flat = String(cand).toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (!flat) return;
    let score = 0; keys.forEach(k => { if (flat.includes(k)) score += k.length; });
    if (score > bestScore) { bestScore = score; best = cand; }
  });
  return bestScore >= 5 ? best : null;
};

// Which open POs travel in which shipment. The forwarder file has no PO number, so:
// 1) the person's own choice (manual: { shipId: [po, …] }) wins;
// 2) a PO number written in the shipment's reference field;
// 3) a supplier with exactly one open PO and one active shipment → that PO.
// Anything else stays unlinked — the app then says "by supplier, not by order".
export const linkShipmentsToPOs = ({ shipments = [], orders = [], manual = {} }) => {
  const posBySup = {};
  orders.forEach(o => { if (o.poNumber && o.supplier) (posBySup[o.supplier] ||= new Set()).add(o.poNumber); });
  const active = shipments.filter(s => s.matched && s.stage?.idx < 2);
  const activeBySup = {}; active.forEach(s => { (activeBySup[s.matched] ||= []).push(s); });
  const byShip = {}, howByShip = {};
  shipments.forEach(s => {
    if (manual[s.id]) { byShip[s.id] = manual[s.id].slice(); howByShip[s.id] = 'manual'; return; }
    const pos = [...(posBySup[s.matched] || [])];
    const ref = String(s.ref || '').toUpperCase();
    const inRef = pos.filter(po => ref && ref.includes(String(po).toUpperCase()));
    if (inRef.length) { byShip[s.id] = inRef; howByShip[s.id] = 'ref'; return; }
    if (s.stage?.idx < 2 && pos.length === 1 && (activeBySup[s.matched] || []).length === 1) { byShip[s.id] = pos; howByShip[s.id] = 'only'; return; }
    byShip[s.id] = []; howByShip[s.id] = null;
  });
  const shipByPo = {};
  shipments.forEach(s => (byShip[s.id] || []).forEach(po => { const cur = shipByPo[po]; if (!cur || (s.arr && (!cur.arr || s.arr < cur.arr))) shipByPo[po] = s; }));
  return { byShip, howByShip, shipByPo };
};

// ─── Applying an import to the stored state (used by file uploads AND the server sync) ───

const byDateDesc = (a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0;
// Invoice lines: keep stored lines before `since` and replace the rest with the new pull.
export const mergeLinesSince = (prev, fresh, since) =>
  (since ? [...fresh, ...(prev || []).filter(l => l.d < since)] : [...fresh]).sort(byDateDesc);

// Inventory / item-card rows (parseInventoryFile output) into the stored maps.
// prev: { stock, cost, minStock, supplier, moq, currency, names, costHistory }
export const applyInventory = (prev, parsed, { replaceStock = false, today = new Date().toISOString().slice(0, 10) } = {}) => {
  const ns = replaceStock ? {} : { ...(prev.stock || {}) }, nc = { ...(prev.cost || {}) }, nm = { ...(prev.minStock || {}) },
    nsup = { ...(prev.supplier || {}) }, nmoq = { ...(prev.moq || {}) }, ncur = { ...(prev.currency || {}) },
    nnames = { ...(prev.names || {}) }, nhist = { ...(prev.costHistory || {}) };
  parsed.forEach(item => {
    const k = item.sku || item.name;
    if (item.name && item.name !== k) nnames[k] = item.name;
    if (item.quantity !== null) ns[k] = item.quantity;
    if (item.cost !== null) {
      // Price history: append only when the price actually changed (or on first sight).
      const cur = item.currency || ncur[k] || 'ILS';
      const hist = nhist[k] ? [...nhist[k]] : [];
      const last = hist[hist.length - 1];
      if (!last || Math.abs(last.c - item.cost) > 1e-9 || last.cur !== cur) {
        if (last && last.d === today) hist[hist.length - 1] = { d: today, c: item.cost, cur };
        else hist.push({ d: today, c: item.cost, cur });
        nhist[k] = hist.slice(-24);
      }
      nc[k] = item.cost;
    }
    if (item.minStock !== null) nm[k] = item.minStock;
    if (item.supplier) nsup[k] = item.supplier;
    if (item.moq !== null) nmoq[k] = item.moq;
    if (item.currency) ncur[k] = item.currency;
  });
  const stats = {
    total: parsed.length, withQty: parsed.filter(p => p.quantity !== null).length, withCost: parsed.filter(p => p.cost !== null).length,
    withMinStock: parsed.filter(p => p.minStock !== null).length, withSupplier: parsed.filter(p => p.supplier).length,
  };
  return { stock: ns, cost: nc, minStock: nm, supplier: nsup, moq: nmoq, currency: ncur, names: nnames, costHistory: nhist, stats };
};

// Open purchase-order lines (parsePriorityOrders output) replace the previous Priority lines;
// manual orders stay. Lines that disappeared were (almost always) received — logged with today's date.
export const applyOpenOrders = ({ prevOrders = [], parsed, receiptLog = [], draftQty = {}, today = new Date().toISOString().slice(0, 10) }) => {
  const idOf = (o) => `${o.poNumber || ''}|${o.productKey || o.productName || ''}`;
  const newIds = new Set(parsed.map(idOf));
  // An order that disappears from the open list was received — unless it was never sent
  // (a draft / waiting-for-approval order that got cancelled or is now filtered out).
  const SENT = new Set(['נשלחה', 'אושרה']);
  const vanished = prevOrders.filter(o => o.fromPriority && o.poNumber && !newIds.has(idOf(o)) && (!o.poStatus || SENT.has(o.poStatus)));
  const nextLog = vanished.length ? [...receiptLog, ...vanished.map(o => ({
    supplier: o.supplier || '', productKey: o.productKey || o.productName, poNumber: o.poNumber,
    orderDate: o.orderDate || '', expectedDate: o.expectedDate || '', receivedDate: today, qty: o.orderedQty || 0, estimated: true,
  }))].slice(-2000) : receiptLog;
  // Quantities typed on a supplier page are done once Priority has the PO.
  const orderedKeys = new Set(parsed.map(o => o.productKey));
  let nextDraft = draftQty;
  if (Object.keys(draftQty).some(k => orderedKeys.has(k))) { nextDraft = { ...draftQty }; orderedKeys.forEach(k => delete nextDraft[k]); }
  return { orders: [...prevOrders.filter(o => !o.fromPriority), ...parsed], receiptLog: nextLog, draftQty: nextDraft, vanished: vanished.length };
};

// ─── Supplier lead time from real orders ───
// One sample per PO delivery: supplier invoice date − the day the PO was SENT
// (from Priority's status history; falls back to the PO date when unknown).
const quantile = (sorted, q) => { if (!sorted.length) return null; const i = (sorted.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
export const supplierLeadTimes = ({ purchaseLines = [], poMeta = {}, transitBySupplier = {}, sinceIso = null }) => {
  const by = {}; const seen = new Set();
  purchaseLines.forEach(l => {
    if (!l.po || !(l.q > 0) || (sinceIso && l.d < sinceIso)) return;
    const k = l.po + '|' + l.inv; if (seen.has(k)) return; seen.add(k);
    const m = poMeta[l.po];
    const sent = (m && m.sent) || l.pos || '';
    const start = sent || (m && m.created) || l.pod; if (!start) return;
    const days = (Date.parse(l.d) - Date.parse(start)) / 86400000;
    if (!(days >= 0 && days < 400)) return;
    (by[l.s] ||= []).push({ days, fromSent: !!sent, d: l.d, po: l.po });
  });
  const out = {};
  Object.entries(by).forEach(([sup, arr]) => {
    const v = arr.map(x => x.days).sort((a, b) => a - b);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    const tr = (transitBySupplier[sup] || []).slice().sort((a, b) => a - b);
    const transit = tr.length ? Math.round(quantile(tr, 0.5)) : 0;
    const median = Math.round(quantile(v, 0.5));
    out[sup] = { n: v.length, median, p80: Math.round(quantile(v, 0.8)), std: Math.round(std), transit, total: median + transit,
      sentShare: arr.filter(x => x.fromSent).length / arr.length, samples: arr.sort((a, b) => a.d < b.d ? 1 : -1).slice(0, 12) };
  });
  return out;
};

// ─── On-time delivery per supplier ───
// A supplier invoice line counts as on time when its date is no later than the
// promised date (REQDATE) of the same item on the same PO, plus a 3-day grace.
export const supplierOnTime = ({ purchaseLines = [], poMeta = {}, sinceIso = null, graceDays = 3 }) => {
  const by = {}; const seen = new Set();
  purchaseLines.forEach(l => {
    if (!l.po || !l.k || !(l.q > 0) || (sinceIso && l.d < sinceIso)) return;
    const due = poMeta[l.po]?.dues?.[l.k]; if (!due) return;
    const key = l.po + '|' + l.k + '|' + l.inv; if (seen.has(key)) return; seen.add(key);
    const late = Math.round((Date.parse(l.d) - Date.parse(due)) / 86400000);
    if (!Number.isFinite(late)) return;
    const s = (by[l.s] ||= { n: 0, onTime: 0, lateDaysSum: 0, lateN: 0 });
    s.n++;
    if (late <= graceDays) s.onTime++; else { s.lateN++; s.lateDaysSum += late; }
  });
  const out = {};
  Object.entries(by).forEach(([sup, s]) => {
    out[sup] = { n: s.n, onTime: s.onTime, pct: Math.round(s.onTime / s.n * 100), avgLateDays: s.lateN ? Math.round(s.lateDaysSum / s.lateN) : 0 };
  });
  return out;
};

// ─── Unusually large deals (one-off projects) ───
// Per product, a sale line counts as unusual when it is far above the product's
// normal line size AND it alone is at least half of that month's sales — and the
// customer doesn't buy that big regularly (3+ times = that IS their normal demand).
// Nothing is changed automatically: the person decides per deal whether to cap it
// to "large but normal" (cap) when averaging.
export const saleLineId = (l) => `${l.inv}|${l.k}|${l.q}|${l.d}`;
export const detectOutliers = (lines, { sinceIso = null, factor = 4, minQty = 5, minImpact = 0.2 } = {}) => {
  const bySku = {};
  lines.forEach(l => { if (!l.x && l.q > 0 && l.k) (bySku[l.k] ||= []).push(l); });
  const out = {};
  for (const [k, arr] of Object.entries(bySku)) {
    if (arr.length < 10) continue;               // too little history to call anything unusual
    const qs = arr.map(l => l.q).sort((a, b) => a - b);
    const med = quantile(qs, 0.5);
    const mad = quantile(qs.map(q => Math.abs(q - med)).sort((a, b) => a - b), 0.5);
    const T = Math.max(factor * med, med + 5 * mad, minQty);
    const monthQty = {};
    arr.forEach(l => { const m = l.d.slice(0, 7); monthQty[m] = (monthQty[m] || 0) + l.q; });
    const recent = sinceIso ? arr.filter(l => l.d >= sinceIso) : arr;
    const recentTotal = recent.reduce((a, l) => a + l.q, 0);
    const big = arr.filter(l => l.q > T);
    if (!big.length) continue;
    const bigByCust = {};
    big.forEach(l => { bigByCust[l.c] = (bigByCust[l.c] || 0) + 1; });
    const list = big.filter(l => bigByCust[l.c] < 3 && l.q >= 0.5 * monthQty[l.d.slice(0, 7)] && (!sinceIso || l.d >= sinceIso)
        // only deals that really move the average: the part above "normal" is 20%+ of the period's sales
        && recentTotal > 0 && (l.q - T) / recentTotal >= minImpact)
      .map(l => ({ id: saleLineId(l), d: l.d, c: l.c, q: l.q, inv: l.inv, cap: Math.max(1, Math.round(T)), monthQty: monthQty[l.d.slice(0, 7)] }))
      .sort((a, b) => a.d < b.d ? 1 : -1);
    if (list.length) out[k] = { threshold: Math.round(T), median: med, lines: list };
  }
  return out;
};

// ─── Purchase prices over time (from supplier invoice lines) ───
// Unit price in the supplier's currency and in ₪ (invoice rate), per product.
export const purchasePriceHistory = (purchaseLines = []) => {
  const by = {};
  purchaseLines.forEach(l => {
    if (l.junk || !l.k || !(l.q > 0) || !(l.p > 0)) return;
    (by[l.k] ||= []).push({ d: l.d, s: l.s, n: l.n, p: l.p, cur: l.cur || 'ILS', rate: l.rate || 1, ils: l.p * (l.rate || 1), q: l.q, inv: l.inv, po: l.po || '' });
  });
  Object.values(by).forEach(a => a.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  return by;
};
// ─── Price check: is the price I'm getting right? ───
// For every product with supplier invoices: the latest price against the same supplier's previous
// price and its median of the last 12 months (same currency), other suppliers' recent prices
// (in ₪), the price on open POs and on the item card. Each finding is a plain-language reason;
// verdict: 'high' (≥10% above normal), 'check' (something worth a look), 'ok'.
// opts.poPrice: { sku: { p, cur, po } } · opts.catalog: { sku: { p, cur } } · opts.names: { sku: name }
const wMedian = (pts) => {
  const a = pts.slice().sort((x, y) => x.p - y.p); const tot = a.reduce((s, x) => s + (x.q || 1), 0);
  let acc = 0; for (const x of a) { acc += (x.q || 1); if (acc >= tot / 2) return x.p; } return a.length ? a[a.length - 1].p : null;
};
export const priceCheck = (hist, { now = Date.now(), poPrice = {}, catalog = {}, names = {} } = {}) => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const y1 = iso(now - 365 * 86400000);
  const out = {};
  Object.entries(hist).forEach(([k, pts]) => {
    if (!pts.length) return;
    const last = pts[pts.length - 1];
    if (/^\s*(משלוח|הובלה|שילוח|עמלה|דמי)/.test(last.n || '')) return; // freight / fee lines, not products
    const same = pts.filter(x => x.s === last.s && x.cur === last.cur);
    const prev = [...same].reverse().find(x => x.inv !== last.inv && x.d <= last.d && x !== last) || null;
    const yr = same.filter(x => x.d >= y1);
    const base = yr.filter(x => x !== last);
    const med = base.length >= 2 ? wMedian(base) : null;
    const ps = yr.map(x => x.p);
    const qtys = base.map(x => x.q).sort((a, b) => a - b); const medQ = qtys.length ? qtys[Math.floor(qtys.length / 2)] : null;
    const allYr = pts.filter(x => x.d >= y1);
    const spend12 = allYr.reduce((a, x) => a + x.ils * x.q, 0), qty12 = allYr.reduce((a, x) => a + x.q, 0);
    // other suppliers, last 12 months, latest price each (₪ per unit)
    const bySup = {}; allYr.forEach(x => { if (x.s !== last.s) bySup[x.s] = x; });
    const others = Object.values(bySup).map(x => ({ s: x.s, d: x.d, p: x.p, cur: x.cur, ils: x.ils })).sort((a, b) => a.ils - b.ils);
    const r = { k, name: names[k] || last.n || k, last, prev, med, min: ps.length ? Math.min(...ps) : last.p, max: ps.length ? Math.max(...ps) : last.p,
      n12: yr.length, nAll: pts.length, spend12, qty12, others, reasons: [], verdict: 'ok', score: 0 };
    r.vsPrev = prev ? (last.p / prev.p - 1) * 100 : null;
    r.vsMed = med ? (last.p / med - 1) * 100 : null;
    r.ilsVsPrev = prev && last.cur !== 'ILS' ? (last.ils / prev.ils - 1) * 100 : null;
    const smallBuy = medQ && last.q < medQ / 2;
    const add = (lvl, text, score) => { r.reasons.push({ lvl, text }); r.score += score; if (lvl === 'high') r.verdict = 'high'; else if (r.verdict === 'ok') r.verdict = 'check'; };
    const f = (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;
    if (r.vsMed != null && r.vsMed >= 10) add(smallBuy ? 'check' : 'high', `המחיר האחרון ${f(r.vsMed)} מעל המחיר הרגיל (חציון 12 ח׳)${smallBuy ? ` — אבל נקנתה כמות קטנה מהרגיל (${last.q} מול ~${medQ})` : ''}`, r.vsMed);
    else if (r.vsPrev != null && r.vsPrev >= 10) add(smallBuy ? 'check' : 'high', `עלה ${f(r.vsPrev)} מהחשבונית הקודמת`, r.vsPrev);
    else if (r.vsPrev != null && r.vsPrev >= 5) add('check', `עלה ${f(r.vsPrev)} מהחשבונית הקודמת`, r.vsPrev);
    if (r.ilsVsPrev != null && r.vsPrev != null && Math.abs(r.vsPrev) < 3 && r.ilsVsPrev >= 5) add('check', `מחיר הספק לא השתנה, אבל בשקלים יקר ב-${f(r.ilsVsPrev)} בגלל השער`, r.ilsVsPrev / 2);
    const cheaper = others.find(o => o.ils < last.ils * 0.9);
    if (cheaper) add('check', `ספק אחר זול ב-${Math.round((1 - cheaper.ils / last.ils) * 100)}% (בשקלים) — ${cheaper.s}, ${cheaper.d.split('-').reverse().join('.')}`, 8);
    const po = poPrice[k];
    if (po && po.cur === last.cur && po.p > 0) {
      r.poP = po; r.poVsLast = (po.p / last.p - 1) * 100;
      if (r.poVsLast >= 5) add(r.poVsLast >= 10 ? 'high' : 'check', `בהזמנה הפתוחה ${po.po} המחיר ${f(r.poVsLast)} מעל החשבונית האחרונה`, r.poVsLast);
    }
    const cat = catalog[k];
    if (cat && cat.p > 0 && cat.cur === last.cur) {
      r.catP = cat; r.catVsLast = (cat.p / last.p - 1) * 100;
      if (Math.abs(r.catVsLast) >= 10) add('check', `המחיר בכרטיס הפריט (${cat.p}) שונה ב-${f(-r.catVsLast)} מהחשבונית האחרונה — כדאי לעדכן`, 3);
    }
    if (r.vsMed != null && r.vsMed <= -10) r.reasons.push({ lvl: 'good', text: `המחיר האחרון ${f(r.vsMed)} מתחת לרגיל` });
    out[k] = r;
  });
  return out;
};

// Price increases: an invoice ≥ minPct above the previous invoice of the same product, supplier and currency.
export const priceIncreases = (hist, { sinceIso, minPct = 5 } = {}) => {
  const out = [];
  Object.entries(hist).forEach(([k, pts]) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i], prev = [...pts.slice(0, i)].reverse().find(x => x.s === a.s && x.cur === a.cur && x.d < a.d);
      if (!prev || (sinceIso && a.d < sinceIso)) continue;
      const pct = (a.p / prev.p - 1) * 100;
      if (pct >= minPct) out.push({ k, s: a.s, d: a.d, prevD: prev.d, p: a.p, prevP: prev.p, cur: a.cur, pct, ilsPct: (a.ils / prev.ils - 1) * 100, q: a.q, inv: a.inv });
    }
  });
  return out.sort((x, y) => x.d < y.d ? 1 : -1);
};
// Supplier price index: the same products, recent price (last `recentDays`) vs a year earlier,
// weighted by recent quantity. Split into the supplier's own price change (in its currency)
// and the exchange-rate effect (₪ change minus currency change).
export const supplierPriceIndex = (hist, { now = Date.now(), recentDays = 180 } = {}) => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const rFrom = iso(now - recentDays * 86400000), bFrom = iso(now - (365 + recentDays / 2) * 86400000), bTo = iso(now - (365 - recentDays / 2) * 86400000);
  const sup = {};
  Object.entries(hist).forEach(([k, pts]) => {
    const groups = {};
    pts.forEach(x => { (groups[x.s + '|' + x.cur] ||= []).push(x); });
    Object.values(groups).forEach(g => {
      const rec = g.filter(x => x.d >= rFrom), base = g.filter(x => x.d >= bFrom && x.d <= bTo);
      if (!rec.length || !base.length) return;
      const avg = (a, f) => a.reduce((s, x) => s + f(x) * x.q, 0) / a.reduce((s, x) => s + x.q, 0);
      const w = rec.reduce((s, x) => s + x.q * x.ils, 0);
      const s = (sup[g[0].s] ||= { n: 0, w: 0, cur: 0, ils: 0, items: [] });
      const curPct = avg(rec, x => x.p) / avg(base, x => x.p) - 1, ilsPct = avg(rec, x => x.ils) / avg(base, x => x.ils) - 1;
      s.n++; s.w += w; s.cur += curPct * w; s.ils += ilsPct * w;
      s.items.push({ k, curPct: curPct * 100, ilsPct: ilsPct * 100, cur: g[0].cur });
    });
  });
  return Object.entries(sup).map(([name, s]) => ({ name, n: s.n, curPct: s.cur / s.w * 100, ilsPct: s.ils / s.w * 100, fxPct: (s.ils - s.cur) / s.w * 100, spend: s.w,
    items: s.items.sort((a, b) => b.curPct - a.curPct) })).sort((a, b) => b.spend - a.spend);
};

// ─── Stock history ───
// Real daily balances from the nightly snapshots (stockHistory = { days:[{ d, s:{sku:qty} }] },
// only changes stored), and for the time before the first snapshot an estimate worked
// backwards from the first known balance: earlier stock = later stock + sales − purchases.
// The estimate ignores counts/adjustments/own production, so it is marked as such.
// When each product started to exist: the item's creation date in Priority. Without one, the first
// supplier invoice — but only when the invoice history clearly starts earlier (so it is a real first buy).
export const productStartDates = ({ itemsExtra = {}, purchaseLines = [] } = {}) => {
  const out = {}; let firstAny = null; const firstBuy = {};
  purchaseLines.forEach(l => { if (!l.d) return; if (!firstAny || l.d < firstAny) firstAny = l.d; if (l.k && l.q > 0 && (!firstBuy[l.k] || l.d < firstBuy[l.k])) firstBuy[l.k] = l.d; });
  Object.entries(itemsExtra).forEach(([k, ex]) => { if (ex?.created) out[k] = ex.created; });
  if (firstAny) Object.entries(firstBuy).forEach(([k, d]) => { if (!out[k] && Date.parse(d) - Date.parse(firstAny) > 60 * 86400000) out[k] = d; });
  return out;
};
// startBy: { sku: 'YYYY-MM-DD' } — days before the product existed are left out (not counted as "out of stock").
export const stockTimelines = ({ stockHistory, currentStock = {}, salesLines = [], purchaseLines = [], skus, fromIso, toIso, startBy = {} }) => {
  const want = new Set(skus);
  const mv = {}; // sku → { day → net change that day (+in, −out) }
  salesLines.forEach(l => { if (!l.x && want.has(l.k) && l.d >= fromIso && l.d <= toIso) { const m = (mv[l.k] ||= {}); m[l.d] = (m[l.d] || 0) - l.q; } });
  purchaseLines.forEach(l => { if (!l.junk && want.has(l.k) && l.d >= fromIso && l.d <= toIso) { const m = (mv[l.k] ||= {}); m[l.d] = (m[l.d] || 0) + l.q; } });
  // snapshot values per sku per day (cumulative)
  const snaps = {}; const cum = {};
  (stockHistory?.days || []).slice().sort((a, b) => a.d < b.d ? -1 : 1).forEach(day => {
    Object.assign(cum, day.s);
    want.forEach(k => { if (k in cum) (snaps[k] ||= {})[day.d] = cum[k]; });
  });
  const days = []; for (let t = Date.parse(toIso); t >= Date.parse(fromIso); t -= 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const out = {};
  want.forEach(k => {
    const sn = snaps[k] || {}, m = mv[k] || {};
    let q = currentStock[k] ?? null;
    if (q == null && !Object.keys(sn).length) return;
    const series = []; let src = 'calc';
    const start = startBy[k] || '';
    for (const d of days) {             // newest → oldest; value = balance at END of day d
      if (start && d < start) break;    // before the item was created
      if (sn[d] != null) { q = sn[d]; src = 'snap'; }
      else if (q == null) continue;
      series.push({ d, q: Math.max(0, Math.round(q * 100) / 100), src, neg: q < 0 });
      q = q - (m[d] || 0);              // step back to the end of the previous day
      if (sn[d] == null) src = 'calc';
    }
    out[k] = series.reverse();
  });
  return out;
};
// Days out of stock per product and month (a month counts as "out" when ≥ half its days had no stock).
export const stockoutSummary = (timelines) => {
  const out = {};
  Object.entries(timelines).forEach(([k, s]) => {
    let outDays = 0; const byMonth = {};
    // a negative estimate means the books don't add up (counts, adjustments) — unknown, not "out"
    s.forEach(x => { const m = x.d.slice(0, 7); const b = (byMonth[m] ||= { days: 0, out: 0 }); b.days++; if (x.q <= 0 && !x.neg) { b.out++; outDays++; } });
    const monthsOut = Object.entries(byMonth).filter(([, b]) => b.out >= b.days / 2).map(([m]) => m);
    out[k] = { outDays, days: s.length, monthsOut, estimated: s.some(x => x.src === 'calc') };
  });
  return out;
};

// ─── Customers who stopped buying a product they used to buy regularly ───
// A pair (customer, product) counts as regular when it was bought on 4+ different months in the
// year before the last purchase. It has stopped when the silence since the last purchase is well
// beyond the usual gap: more than max(60 days, 2.5 × the median gap) — and less than a year
// (older than that is a lost customer, a different conversation).
// Regular (customer, product) pairs: bought on minMonths+ different months in the year before
// the last purchase. Shared by "stopped buying" and "due to reorder".
export const regularPairs = (lines = [], { now = Date.now(), minMonths = 4 } = {}) => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = iso(now), yearAgo = iso(now - 365 * 86400000), lookFrom = iso(now - 730 * 86400000);
  const pairs = {}, custLast = {};
  lines.forEach(l => {
    if (l.x || !l.k || !(l.q > 0) || l.d < lookFrom || l.d > today) return;
    const ck = l.cid || l.c; if (!ck) return;
    if (!custLast[ck] || l.d > custLast[ck]) custLast[ck] = l.d;
    const p = (pairs[ck + '|' + l.k] ||= { cid: l.cid, c: l.c, k: l.k, n: l.n, days: new Set(), lines: [] });
    p.days.add(l.d); p.lines.push(l);
  });
  const DAY = 86400000, out = [];
  Object.values(pairs).forEach(p => {
    const days = [...p.days].sort();
    const last = days[days.length - 1];
    if (last < yearAgo) return;
    const fromIso = iso(Date.parse(last) - 365 * DAY);
    const recent = days.filter(d => d >= fromIso);
    const months = new Set(recent.map(d => d.slice(0, 7)));
    if (months.size < minMonths) return;
    const gaps = []; for (let i = 1; i < recent.length; i++) gaps.push((Date.parse(recent[i]) - Date.parse(recent[i - 1])) / DAY);
    gaps.sort((a, b) => a - b);
    const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 30;
    let q = 0, v = 0, lastQ = 0; p.lines.forEach(l => { if (l.d >= fromIso) { q += l.q; v += l.v || 0; } if (l.d === last) lastQ += l.q; });
    const spanMonths = Math.max(1, (Date.parse(last) - Date.parse(recent[0])) / DAY / 30.4);
    const ck = p.cid || p.c;
    out.push({ cid: p.cid, c: p.c, k: p.k, n: p.n, last, lastQ, silence: Math.round((now - Date.parse(last)) / DAY), medGap, everyDays: Math.round(medGap),
      timesBought: recent.length, months: months.size, avgQty: Math.round(q / recent.length * 10) / 10,
      monthlyQty: Math.round(q / spanMonths * 10) / 10, yearlyValue: Math.round(v / spanMonths * 12),
      customerLast: custLast[ck], customerActive: !!custLast[ck] && (now - Date.parse(custLast[ck])) / DAY <= 60 });
  });
  return out;
};
// Stopped: silence well beyond the usual gap — more than max(60 days, 2.5 × median gap) — and under a year.
export const stoppedBuying = (lines = [], opts = {}) =>
  regularPairs(lines, opts).filter(p => p.silence > Math.max(60, p.medGap * 2.5)).sort((a, b) => b.yearlyValue - a.yearlyValue);
// Due to reorder: past the usual gap (plus a little slack) but not yet "stopped" — time to call.
export const dueToReorder = (lines = [], opts = {}) => {
  const DAY = 86400000;
  return regularPairs(lines, opts)
    .filter(p => p.silence >= p.medGap + Math.max(5, p.medGap * 0.2) && p.silence <= Math.max(60, p.medGap * 2.5))
    .map(p => ({ ...p, expected: new Date(Date.parse(p.last) + Math.round(p.medGap) * DAY).toISOString().slice(0, 10), daysLate: Math.round(p.silence - p.medGap) }))
    .sort((a, b) => b.yearlyValue - a.yearlyValue);
};

// ─── Sales at a glance (overview screen) ───
// Month to date, year to date and last 7 days against the same days a year earlier; customers this
// month (and how many bought for the first time in the data); monthly this year vs last; last 12 weeks.
export const salesOverview = (lines = [], { now = Date.now() } = {}) => {
  const DAY = 86400000, iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = iso(now), ly = (d) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  const mStart = today.slice(0, 8) + '01', yStart = today.slice(0, 5) + '01-01';
  const w0 = iso(now - 6 * DAY);
  const sum = (a, b) => { let v = 0; for (const l of lines) if (l.d >= a && l.d <= b) v += l.v || 0; return v; };
  const firstBuy = {}, monthCust = new Set(), year = Number(today.slice(0, 4));
  const byMonth = {}, byWeek = {}, cust30 = {};
  const d30 = iso(now - 29 * DAY);
  const weekStart = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - t.getUTCDay()); return t.toISOString().slice(0, 10); };
  const w12 = weekStart(iso(now - 11 * 7 * DAY));
  for (const l of lines) {
    const ck = l.cid || l.c;
    if (ck && l.v > 0 && (!firstBuy[ck] || l.d < firstBuy[ck])) firstBuy[ck] = l.d;
    if (ck && l.d >= mStart && l.d <= today && l.v > 0) monthCust.add(ck);
    const y = Number(l.d.slice(0, 4));
    if (y === year || y === year - 1) { const k = l.d.slice(5, 7); (byMonth[k] ||= { cur: 0, prev: 0 })[y === year ? 'cur' : 'prev'] += l.v || 0; }
    if (l.d >= w12 && l.d <= today) { const w = weekStart(l.d); byWeek[w] = (byWeek[w] || 0) + (l.v || 0); }
    if (ck && l.d >= d30 && l.d <= today) { const c = (cust30[ck] ||= { c: l.c, v: 0 }); c.v += l.v || 0; }
  }
  const newCust = [...monthCust].filter(c => firstBuy[c] >= mStart).length;
  const thisMonth = Number(today.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => { const k = String(i + 1).padStart(2, '0'); const b = byMonth[k] || { cur: 0, prev: 0 }; return { m: i + 1, cur: i + 1 <= thisMonth ? Math.round(b.cur) : null, prev: Math.round(b.prev) }; });
  const weeks = []; for (let t = Date.parse(w12); t <= now; t += 7 * DAY) { const w = iso(t); weeks.push({ w, v: Math.round(byWeek[w] || 0) }); }
  return {
    mtd: sum(mStart, today), mtdLY: sum(ly(mStart), ly(today)),
    ytd: sum(yStart, today), ytdLY: sum(ly(yStart), ly(today)),
    week: sum(w0, today), weekLY: sum(ly(w0), ly(today)),
    customersMonth: monthCust.size, newCustomers: newCust,
    months, weeks, topCustomers: Object.values(cust30).sort((a, b) => b.v - a.v).slice(0, 8),
    hasLastYear: lines.some(l => l.d <= ly(mStart)),
    newReliable: lines.some(l => l.d <= ly(mStart)), // 'first purchase' only means something with a year of history before it
  };
};

// ─── Customer returns per supplier (goods returns on sales invoices, last 12 months) ───
// supplierOf(sku) → supplier name. rate = returned units / sold units.
export const supplierReturns = (lines = [], supplierOf, { now = Date.now(), days = 365 } = {}) => {
  const from = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const by = {};
  lines.forEach(l => {
    if (l.x || !l.k || !l.q || l.d < from) return;
    const s = supplierOf(l.k); if (!s) return;
    const x = (by[s] ||= { name: s, soldQ: 0, soldV: 0, retQ: 0, retV: 0, prods: {} });
    const p = (x.prods[l.k] ||= { k: l.k, n: l.n, soldQ: 0, retQ: 0, retV: 0 });
    if (l.q > 0) { x.soldQ += l.q; x.soldV += l.v || 0; p.soldQ += l.q; if (!p.n) p.n = l.n; }
    else { x.retQ += -l.q; x.retV += -(l.v || 0); p.retQ += -l.q; p.retV += -(l.v || 0); }
  });
  const out = {};
  Object.values(by).forEach(x => {
    const products = Object.values(x.prods).filter(p => p.retQ > 0).map(p => ({ ...p, rate: p.soldQ > 0 ? p.retQ / p.soldQ * 100 : null })).sort((a, b) => b.retV - a.retV);
    out[x.name] = { name: x.name, soldQ: x.soldQ, soldV: x.soldV, retQ: x.retQ, retV: x.retV, rate: x.soldQ > 0 ? x.retQ / x.soldQ * 100 : null, valueRate: x.soldV > 0 ? x.retV / x.soldV * 100 : null, products };
  });
  return out;
};

// ─── Order calendar & spend forecast ───
// Per product: the day it must be ordered = when (stock + on order − safety stock) runs out, minus
// the supplier's lead time. Then repeat every `monthsToStock` months to the horizon, each time for
// monthsToStock months of sales. Gives each supplier's next order date and a monthly ₪ forecast.
// Open POs count in the month they are due. An estimate for planning, not a commitment.
export const orderCalendar = (products = [], { now = Date.now(), monthsToStock = 2, horizonMonths = 6, openOrders = [], skipSuppliers = [] } = {}) => {
  const DAY = 86400000, iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const end = new Date(today.getFullYear(), today.getMonth() + horizonMonths, 1).getTime();
  const months = []; for (let i = 0; i < horizonMonths; i++) { const d = new Date(today.getFullYear(), today.getMonth() + i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const mOf = (ms) => iso(ms).slice(0, 7);
  const cash = Object.fromEntries(months.map(m => [m, { m, open: 0, planned: 0, bySup: {} }]));
  const sups = {};
  const skip = new Set(skipSuppliers);
  products.forEach(p => {
    const sup = p.supplier || 'ספק לא ידוע';
    if (skip.has(sup) || !(p.avgMonthly > 0) || p.currentStock == null) return;
    const daily = p.avgMonthly / 30.4;
    const lead = (p.effectiveLeadTime || 0) * 30.4;
    const safety = (p.safetyStock || 0) / daily;
    const cover = ((p.currentStock || 0) + (p.incomingQty || 0)) / daily;
    let orderAt = t0 + Math.round(cover - safety - lead) * DAY;
    const late = orderAt < t0;
    if (late) orderAt = t0;
    const s = (sups[sup] ||= { name: sup, next: null, nowCount: 0, items: [], lead: p.effectiveLeadTime, value: 0 });
    s.items.push({ k: p.sku || p.key, n: p.name, orderAt: iso(orderAt), late, qty: p.suggestedOrder > 0 ? p.suggestedOrder : null });
    if (late) s.nowCount++;
    if (!s.next || iso(orderAt) < s.next) s.next = iso(orderAt);
    // cash events to the horizon
    const unit = p.unitCost || 0;
    let t = orderAt, first = true;
    while (t < end && unit > 0) {
      const qty = first && p.suggestedOrder > 0 ? p.suggestedOrder : Math.ceil(p.avgMonthly * monthsToStock);
      const v = qty * unit, m = mOf(t);
      if (cash[m]) { cash[m].planned += v; cash[m].bySup[sup] = (cash[m].bySup[sup] || 0) + v; }
      if (first) s.value += v;
      first = false; t += monthsToStock * 30.4 * DAY;
    }
  });
  openOrders.forEach(o => {
    const v = o.valueILS || 0; if (!v) return;
    const due = o.expectedDate ? Date.parse(o.expectedDate.split('/').reverse().join('-')) : NaN;
    const m = Number.isFinite(due) && due >= t0 ? mOf(due) : months[0];
    if (cash[m]) { cash[m].open += v; const k = o.supplier || 'ספק לא ידוע'; cash[m].bySup[k] = (cash[m].bySup[k] || 0) + v; }
  });
  const list = Object.values(sups).map(s => {
    const nextT = Date.parse(s.next);
    const join = s.items.filter(i => Date.parse(i.orderAt) <= nextT + 30 * DAY);
    return { ...s, daysToNext: Math.round((nextT - t0) / DAY), join: join.length, joinItems: join.sort((a, b) => a.orderAt < b.orderAt ? -1 : 1) };
  }).sort((a, b) => a.next < b.next ? -1 : a.next > b.next ? 1 : b.value - a.value);
  return { suppliers: list, months: months.map(m => cash[m]) };
};

// ─── Returns & credits (sales invoice lines) ───
// Goods returns = product lines with negative quantity. Money-only credits = negative
// value lines without a product quantity (after-the-fact discounts, price corrections).
export const returnsAnalysis = (lines = [], { fromIso, toIso, prevFromIso } = {}) => {
  const inWin = (d) => d >= fromIso && d <= toIso;
  const prod = {}, cust = {}, inv = {}, months = {};
  let sold = 0, goods = 0, money = 0, prevGoods = 0, prevMoney = 0, prevSold = 0;
  lines.forEach(l => {
    const isPrev = prevFromIso && l.d >= prevFromIso && l.d < fromIso;
    if (!inWin(l.d) && !isPrev) return;
    const goodsRet = !l.x && l.q < 0, moneyCr = l.x && l.v < 0;
    if (isPrev) { if (l.v > 0) prevSold += l.v; if (goodsRet) prevGoods += -l.v; if (moneyCr) prevMoney += -l.v; return; }
    if (l.v > 0) sold += l.v;
    if (!l.x && l.k) {
      const p = (prod[l.k] ||= { k: l.k, n: l.n, soldQ: 0, soldV: 0, retQ: 0, retV: 0, cust: {} });
      if (l.q > 0) { p.soldQ += l.q; p.soldV += l.v; if (!p.n) p.n = l.n; }
      if (l.q < 0) { p.retQ += -l.q; p.retV += -l.v; p.cust[l.c] = (p.cust[l.c] || 0) + -l.q; }
    }
    const c = (cust[l.c] ||= { c: l.c, soldV: 0, goodsV: 0, moneyV: 0, invs: new Set() });
    if (l.v > 0) c.soldV += l.v;
    if (goodsRet || moneyCr) {
      if (goodsRet) { goods += -l.v; c.goodsV += -l.v; } else { money += -l.v; c.moneyV += -l.v; }
      c.invs.add(l.inv);
      const iv = (inv[l.inv] ||= { inv: l.inv, d: l.d, c: l.c, goodsV: 0, moneyV: 0, items: [] });
      if (goodsRet) { iv.goodsV += -l.v; iv.items.push({ k: l.k, n: l.n, q: -l.q }); } else iv.moneyV += -l.v;
      const m = l.d.slice(0, 7); (months[m] ||= { m, goods: 0, money: 0 }); months[m][goodsRet ? 'goods' : 'money'] += -l.v;
    }
  });
  const products = Object.values(prod).filter(p => p.retQ > 0).map(p => ({ ...p, rate: p.soldQ > 0 ? p.retQ / p.soldQ * 100 : null,
    topCust: Object.entries(p.cust).sort((a, b) => b[1] - a[1])[0]?.[0] || '' })).sort((a, b) => b.retV - a.retV);
  const customers = Object.values(cust).filter(c => c.goodsV || c.moneyV).map(c => ({ c: c.c, soldV: c.soldV, goodsV: c.goodsV, moneyV: c.moneyV, total: c.goodsV + c.moneyV,
    share: c.soldV > 0 ? (c.goodsV + c.moneyV) / c.soldV * 100 : null, n: c.invs.size })).sort((a, b) => b.total - a.total);
  const invoices = Object.values(inv).map(i => ({ ...i, total: i.goodsV + i.moneyV, kind: i.goodsV && i.moneyV ? 'both' : i.goodsV ? 'goods' : 'money' })).sort((a, b) => a.d < b.d ? 1 : -1);
  return { sold, goods, money, prevSold, prevGoods, prevMoney, products, customers, invoices, months: Object.values(months).sort((a, b) => a.m < b.m ? -1 : 1) };
};

// ─── Brands (product families) ───
export const brandsAnalysis = (lines = [], { itemsExtra = {}, stock = {}, fromIso, toIso, prevFromIso } = {}) => {
  const fam = {};
  const famOf = (k) => (itemsExtra[k]?.fam || '').trim() || 'ללא משפחה';
  lines.forEach(l => {
    if (l.x || !l.k) return;
    const cur = l.d >= fromIso && l.d <= toIso, prev = prevFromIso && l.d >= prevFromIso && l.d < fromIso;
    if (!cur && !prev) return;
    const f = (fam[famOf(l.k)] ||= { name: famOf(l.k), v: 0, q: 0, prevV: 0, cost: 0, costedV: 0, skus: new Set(), cust: {}, months: {}, prod: {} });
    if (prev) { f.prevV += l.v; return; }
    f.v += l.v; f.q += l.q; f.skus.add(l.k); f.cust[l.c] = (f.cust[l.c] || 0) + l.v;
    const m = l.d.slice(0, 7); f.months[m] = (f.months[m] || 0) + l.v;
    const pr = (f.prod[l.k] ||= { k: l.k, n: l.n, v: 0, q: 0 }); pr.v += l.v; pr.q += l.q;
    const ac = itemsExtra[l.k]?.avgCost;
    if (ac > 0) { f.cost += ac * l.q; f.costedV += l.v; }
  });
  // stock value by family (average cost)
  Object.entries(stock).forEach(([k, q]) => {
    if (!(q > 0)) return; const ac = itemsExtra[k]?.avgCost; const n = famOf(k);
    const f = fam[n]; if (!f) return;
    f.stockV = (f.stockV || 0) + (ac > 0 ? q * ac : 0);
  });
  return Object.values(fam).filter(f => f.v || f.prevV).map(f => ({
    name: f.name, v: f.v, q: f.q, prevV: f.prevV, change: f.prevV > 0 ? (f.v / f.prevV - 1) * 100 : null,
    margin: f.costedV > 0 ? (1 - f.cost / f.costedV) * 100 : null, marginCoverage: f.v > 0 ? f.costedV / f.v * 100 : 0,
    skus: f.skus.size, customers: Object.keys(f.cust).length, stockV: f.stockV || 0,
    coverMonths: f.v > 0 && f.stockV ? f.stockV / ((f.cost > 0 && f.costedV > 0 ? f.cost / f.costedV * f.v : f.v) / 12) : null,
    months: Object.entries(f.months).sort(([a], [b]) => a < b ? -1 : 1).map(([m, v]) => ({ m, v })),
    topProducts: Object.values(f.prod).sort((a, b) => b.v - a.v).slice(0, 10),
    topCustomers: Object.entries(f.cust).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => ({ c, v })),
  })).sort((a, b) => b.v - a.v);
};
