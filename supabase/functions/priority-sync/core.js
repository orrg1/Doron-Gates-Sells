// GENERATED from src/core — do not edit here; run scripts/copy-core.sh

// src/core/data.js
var HebrewMonthsMap = {
  0: "\u05D9\u05E0\u05D5",
  1: "\u05E4\u05D1\u05E8",
  2: "\u05DE\u05E8\u05E5",
  3: "\u05D0\u05E4\u05E8",
  4: "\u05DE\u05D0\u05D9",
  5: "\u05D9\u05D5\u05E0",
  6: "\u05D9\u05D5\u05DC",
  7: "\u05D0\u05D5\u05D2",
  8: "\u05E1\u05E4\u05D8",
  9: "\u05D0\u05D5\u05E7",
  10: "\u05E0\u05D5\u05D1",
  11: "\u05D3\u05E6\u05DE"
};
var HebrewMonthsReverse = {
  "\u05D9\u05E0\u05D5": 1,
  "\u05E4\u05D1\u05E8": 2,
  "\u05DE\u05E8\u05E5": 3,
  "\u05D0\u05E4\u05E8": 4,
  "\u05DE\u05D0\u05D9": 5,
  "\u05D9\u05D5\u05E0": 6,
  "\u05D9\u05D5\u05DC": 7,
  "\u05D0\u05D5\u05D2": 8,
  "\u05E1\u05E4\u05D8": 9,
  "\u05D0\u05D5\u05E7": 10,
  "\u05E0\u05D5\u05D1": 11,
  "\u05D3\u05E6\u05DE": 12
};
var getDateVal = (s) => {
  if (!s || typeof s !== "string") return 0;
  const [m, y] = s.split("-");
  return (parseInt(y) + 2e3) * 100 + (HebrewMonthsReverse[m] || 0);
};
var parsePriorityOrders = (rows) => {
  if (!rows.length) return [];
  const norm = (s) => (s || "").toString().trim();
  const headers = Object.keys(rows[0]).map(norm);
  const findCol = (...variants) => {
    for (const v of variants) {
      const idx = headers.findIndex((h) => h === v);
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers.findIndex((h) => h.startsWith(v));
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers.findIndex((h) => h.includes(v));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const colPO = findCol("\u05D4\u05D6\u05DE\u05E0\u05D4", "\u05DE\u05E1\u05E4\u05E8 \u05D4\u05D6\u05DE\u05E0\u05D4", "PO", "po number");
  const colSKU = findCol('\u05DE\u05E7"\u05D8', "\u05DE\u05E7'\u05D8", "\u05DE\u05E7\u05D8", "sku", "item number");
  const colName = findCol("\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05EA\u05D9\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05EA\u05D0\u05D5\u05E8 \u05E4\u05E8\u05D9\u05D8", "\u05EA\u05D9\u05D0\u05D5\u05E8 \u05E4\u05E8\u05D9\u05D8", "\u05E9\u05DD \u05DE\u05D5\u05E6\u05E8");
  const colQty = findCol("\u05D9\u05EA\u05E8\u05D4 \u05DC\u05D0\u05E1\u05E4\u05E7\u05D4", "\u05D9\u05EA\u05E8\u05D4");
  const colVal = findCol("\u05E9\u05D5\u05D5\u05D9 \u05D9\u05EA\u05E8\u05D4", "\u05E9\u05D5\u05D5\u05D9");
  const colDate = findCol("\u05EA. \u05D4\u05D6\u05DE\u05E0\u05D4", "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D4\u05D6\u05DE\u05E0\u05D4", "\u05EA.\u05D4\u05D6\u05DE\u05E0\u05D4", "\u05EA\u05D0\u05E8\u05D9\u05DA");
  const colExpDate = findCol("\u05EA. \u05D0\u05E1\u05E4\u05E7\u05D4", "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D0\u05E1\u05E4\u05E7\u05D4", "\u05EA.\u05D0\u05E1\u05E4\u05E7\u05D4", "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D0\u05E1\u05E4\u05E7\u05D4 \u05E6\u05E4\u05D5\u05D9");
  const colSup = findCol("\u05E9\u05DD \u05E1\u05E4\u05E7", "\u05E1\u05E4\u05E7", "\u05E9\u05DD \u05D9\u05E6\u05E8\u05DF");
  const colStatus = headers.indexOf("\u05E1\u05D8\u05D8\u05D5\u05E1 \u05D4\u05D6\u05DE\u05E0\u05D4") !== -1 ? headers.indexOf("\u05E1\u05D8\u05D8\u05D5\u05E1 \u05D4\u05D6\u05DE\u05E0\u05D4") : headers.indexOf("\u05E1\u05D8\u05D8\u05D5\u05E1");
  const colSent = headers.indexOf("\u05EA. \u05E9\u05DC\u05D9\u05D7\u05D4");
  const excelToDate = (serial) => {
    const n = parseFloat(serial);
    if (isNaN(n) || n < 3e4 || n > 7e4) return serial?.toString() || "";
    const dt = new Date((n - 25569) * 86400 * 1e3);
    return dt.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  const result = [];
  rows.forEach((row) => {
    const vals = Object.values(row).map((v) => norm(String(v)));
    const sku = colSKU !== -1 ? vals[colSKU] : "";
    const name = colName !== -1 ? vals[colName] : "";
    if (!sku && !name) return;
    const qtyRaw = colQty !== -1 ? parseFloat(vals[colQty]) : NaN;
    const qty = isNaN(qtyRaw) || qtyRaw <= 0 ? 0 : qtyRaw;
    if (qty <= 0) return;
    if (colStatus !== -1 && vals[colStatus] && !["\u05E0\u05E9\u05DC\u05D7\u05D4", "\u05D0\u05D5\u05E9\u05E8\u05D4"].includes(vals[colStatus])) return;
    const valRaw = colVal !== -1 ? parseFloat(vals[colVal]) : NaN;
    result.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      poNumber: colPO !== -1 ? vals[colPO] : "",
      productKey: sku || name,
      productName: name || sku,
      supplier: colSup !== -1 ? vals[colSup] : "",
      orderedQty: qty,
      orderDate: colDate !== -1 ? excelToDate(vals[colDate]) : "",
      expectedDate: colExpDate !== -1 ? excelToDate(vals[colExpDate]) : "",
      status: "ordered",
      notes: "",
      value: isNaN(valRaw) ? 0 : valRaw,
      fromPriority: true,
      poStatus: colStatus !== -1 ? vals[colStatus] : "",
      sentDate: colSent !== -1 ? excelToDate(vals[colSent]) : ""
    });
  });
  return result;
};
var parseInventoryFile = (rows) => {
  const COL = {
    sku: ["\u05DE\u05E7'\u05D8", '\u05DE\u05E7"\u05D8', "\u05DE\u05E7\u05D8", "sku", "item number", "item", "barcode", "\u05D1\u05E8\u05E7\u05D5\u05D3", "\u05E7\u05D5\u05D3 \u05E4\u05E8\u05D9\u05D8", "\u05E7\u05D5\u05D3 \u05DE\u05D5\u05E6\u05E8", "\u05DE\u05E1\u05E4\u05E8 \u05E4\u05E8\u05D9\u05D8"],
    name: ["\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05EA\u05D9\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05EA\u05D0\u05D5\u05E8", "\u05EA\u05D9\u05D0\u05D5\u05E8", "\u05E9\u05DD \u05DE\u05D5\u05E6\u05E8", "\u05E9\u05DD \u05E4\u05E8\u05D9\u05D8", "item name", "description", "\u05E4\u05E8\u05D9\u05D8", "\u05E9\u05DD"],
    status: ["\u05E1\u05D8\u05D8\u05D5\u05E1", "status"],
    managed: ["\u05DE\u05E0\u05D5\u05D4\u05DC \u05DE\u05DC\u05D0\u05D9"],
    quantity: ["\u05D9\u05EA\u05E8\u05D4", "\u05D9\u05EA\u05E8\u05D4 \u05D1\u05DE\u05DC\u05D0\u05D9", "\u05D9\u05EA\u05E8\u05EA \u05DE\u05DC\u05D0\u05D9", "\u05DB\u05DE\u05D5\u05EA \u05D1\u05DE\u05DC\u05D0\u05D9", "\u05DB\u05DE\u05D5\u05EA \u05DE\u05DC\u05D0\u05D9", "qty", "stock", "quantity", "\u05DB\u05DE\u05D5\u05EA \u05D1\u05E1\u05D8\u05D5\u05E7"],
    minStock: ["\u05DB\u05DE\u05D5\u05EA \u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05DC\u05DE\u05DC\u05D0\u05D9", "\u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05DC\u05DE\u05DC\u05D0\u05D9", "\u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05DE\u05DC\u05D0\u05D9", "min stock", "\u05DE\u05D9\u05E0 \u05DE\u05DC\u05D0\u05D9", "\u05E8\u05DE\u05EA \u05D4\u05D6\u05DE\u05E0\u05D4"],
    cost: ["\u05DE\u05D7\u05D9\u05E8 \u05E7\u05E0\u05D9\u05D4 \u05D0\u05D7\u05E8\u05D5\u05DF", "\u05DE\u05D7\u05D9\u05E8 \u05E7\u05E0\u05D9\u05D4", '\u05E2\u05DC\u05D5\u05EA \u05E9"\u05D7', "\u05E2\u05DC\u05D5\u05EA \u05E9\u05D7", "\u05E2\u05DC\u05D5\u05EA", "unit cost", "cost", "\u05DE\u05D7\u05D9\u05E8 \u05E1\u05E4\u05E7"],
    costAlt: ['\u05E2\u05DC\u05D5\u05EA \u05E9"\u05D7', "\u05E2\u05DC\u05D5\u05EA \u05E9\u05D7", "\u05E2\u05DC\u05D5\u05EA \u05DB\u05D5\u05DC\u05DC\u05EA"],
    supplier: ["\u05E9\u05DD \u05E1\u05E4\u05E7", "\u05E1\u05E4\u05E7", "supplier"],
    moq: ["\u05DB\u05DE\u05D5\u05EA \u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05DC\u05D4\u05D6\u05DE\u05E0\u05D4", "\u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05D4\u05D6\u05DE\u05E0\u05D4", "\u05DB\u05DE\u05D5\u05EA \u05D4\u05D6\u05DE\u05E0\u05D4 \u05DE\u05D9\u05E0\u05D9\u05DE\u05DC\u05D9\u05EA", "moq", "min order", "minimum order qty", "minimum order quantity"],
    currency: ["\u05DE\u05D8\u05D1\u05E2", "currency"]
  };
  const norm = (s) => (s || "").toString().trim().replace(/\s+/g, " ");
  const findCol = (headers2, variants) => {
    for (const v of variants) {
      const idx = headers2.findIndex((h) => norm(h) === v);
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers2.findIndex((h) => norm(h).includes(v));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]).map(norm);
  const skuIdx = findCol(headers, COL.sku);
  const nameIdx = findCol(headers, COL.name);
  const statusIdx = findCol(headers, COL.status);
  const managedIdx = findCol(headers, COL.managed);
  const qtyIdx = findCol(headers, COL.quantity);
  const minStockIdx = findCol(headers, COL.minStock);
  const costIdx = findCol(headers, COL.cost);
  const costAltIdx = findCol(headers, COL.costAlt);
  const supplierIdx = findCol(headers, COL.supplier);
  const moqIdx = findCol(headers, COL.moq);
  const currencyIdx = costIdx !== -1 ? findCol(headers, COL.currency) : -1;
  const isPriorityMaster = skuIdx !== -1 && costIdx !== -1 && qtyIdx === -1;
  const result = [];
  rows.forEach((row) => {
    const vals = Object.values(row).map((v) => norm(String(v)));
    const sku = skuIdx !== -1 ? vals[skuIdx] : "";
    const name = nameIdx !== -1 ? vals[nameIdx] : "";
    if (!sku && !name) return;
    if (isPriorityMaster) {
      const status = statusIdx !== -1 ? vals[statusIdx] : "";
      const managed = managedIdx !== -1 ? vals[managedIdx] : "";
      if (status && status !== "\u05E4\u05E2\u05D9\u05DC") return;
      if (managed && managed !== "Y") return;
    }
    const qtyRaw = qtyIdx !== -1 ? parseFloat(vals[qtyIdx].replace(/[^\d.-]/g, "")) : NaN;
    const qty = isNaN(qtyRaw) ? null : qtyRaw;
    if (!isPriorityMaster && qty === null) return;
    const c1 = costIdx !== -1 ? parseFloat(vals[costIdx].replace(/[^\d.-]/g, "")) : NaN;
    const c2 = costAltIdx !== -1 ? parseFloat(vals[costAltIdx].replace(/[^\d.-]/g, "")) : NaN;
    const cost = !isNaN(c1) && c1 > 0 ? c1 : !isNaN(c2) && c2 > 0 ? c2 : null;
    const minRaw = minStockIdx !== -1 ? parseFloat(vals[minStockIdx].replace(/[^\d.-]/g, "")) : NaN;
    const minStock = !isNaN(minRaw) && minRaw > 0 ? minRaw : null;
    const supplier = supplierIdx !== -1 ? vals[supplierIdx] : null;
    const moqRaw = moqIdx !== -1 ? parseFloat(vals[moqIdx].replace(/[^\d.-]/g, "")) : NaN;
    const moq = !isNaN(moqRaw) && moqRaw > 0 ? moqRaw : null;
    const currRaw = currencyIdx !== -1 ? vals[currencyIdx] : "";
    const currNorm = currRaw.toLowerCase().replace(/\s+/g, "");
    const currency = !currNorm ? null : ['\u05E9"\u05D7', "\u05E9\u05D7", "\u20AA", "ils", "nis", "\u05E9\u05E7\u05DC", "\u05E9\u05E7\u05DC\u05D9\u05DD"].includes(currNorm) ? "ILS" : ["$", "usd", "us$", "\u05D3\u05D5\u05DC\u05E8", "\u05D3\u05D5\u05DC\u05E8\u05D9\u05DD"].includes(currNorm) ? "USD" : ["\u20AC", "eur", "\u05D0\u05D9\u05E8\u05D5", "\u05D9\u05D5\u05E8\u05D5"].includes(currNorm) ? "EUR" : currRaw;
    result.push({ sku: sku || name, name: name || sku, quantity: qty, cost, minStock, supplier, moq, currency });
  });
  return result;
};
var parseFlexDate = (s) => {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  const str = String(s).trim();
  if (str.includes("/")) {
    const [d, m, y] = str.split("/").map(Number);
    if (d && m && y) return new Date(y < 100 ? 2e3 + y : y, m - 1, d);
    return null;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const [y, m, d] = str.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return null;
};
var DAY_MS = 24 * 60 * 60 * 1e3;
var startOfToday = () => {
  const t = /* @__PURE__ */ new Date();
  t.setHours(0, 0, 0, 0);
  return t;
};
var SERVICE_LEVEL = { A: { z: 2.05, pct: 98 }, B: { z: 1.65, pct: 95 }, C: { z: 1.28, pct: 90 } };
var calcOrderPlan = ({ avgMonthly, stdDev, abc, leadTime, leadTimeStd = 0, monthsToStock, seasonalityIdx, seasonalityReliable, nextMonIdx, effectiveStock, minStock, moq, multiplier = 1 }) => {
  const base = avgMonthly * multiplier;
  const horizon = Math.max(0, leadTime + monthsToStock);
  let projectedDemand = 0;
  const useSeason = seasonalityReliable && nextMonIdx >= 0 && Array.isArray(seasonalityIdx);
  for (let i = 0; i < Math.ceil(horizon); i++) {
    const portion = Math.min(1, horizon - i);
    const f = useSeason ? Math.max(0.5, Math.min(2, seasonalityIdx[(nextMonIdx + i) % 12] || 1)) : 1;
    projectedDemand += base * f * portion;
  }
  const flatDemand = base * horizon;
  const sl = SERVICE_LEVEL[abc] || SERVICE_LEVEL.B;
  const lt = Math.max(leadTime, 0.5);
  const sigma = Math.sqrt(lt * Math.pow(stdDev || 0, 2) * multiplier + Math.pow(base, 2) * Math.pow(leadTimeStd || 0, 2));
  const safetyStock = Math.ceil(sl.z * sigma);
  const buffer = Math.max(safetyStock, minStock || 0);
  const raw = Math.max(0, Math.ceil(projectedDemand + buffer - (effectiveStock || 0)));
  const rounded = moq && moq > 0 && raw > 0 ? Math.ceil(raw / moq) * moq : raw;
  const rawFlat = Math.max(0, Math.ceil(flatDemand + buffer - (effectiveStock || 0)));
  return { suggestedOrder: rounded, suggestedOrderRaw: raw, suggestedOrderFlat: rawFlat, projectedDemand, safetyStock, buffer, serviceLevel: sl.pct, seasonalApplied: useSeason && Math.abs(projectedDemand - flatDemand) > 0.5 };
};
var normHeader = (h) => String(h ?? "").replace(/[‎‏]/g, "").replace(/\s+/g, " ").trim();
var findHeaderRow = (rows, required) => {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hs = rows[i].map(normHeader);
    if (required.every((req) => hs.some((h) => h === req))) return i;
  }
  return -1;
};
var colIndex = (headers, ...names) => {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
};
var toIsoDate = (v) => {
  if (v == null || v === "") return "";
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number") {
    if (v > 2e4 && v < 8e4) d = new Date(Math.round((v - 25569) * 86400 * 1e3));
  } else {
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
    if (m) {
      const y = +m[3] < 100 ? 2e3 + +m[3] : +m[3];
      d = new Date(y, +m[2] - 1, +m[1]);
    } else if (m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) d = new Date(+m[1], +m[2] - 1, +m[3]);
  }
  if (!d || isNaN(d.getTime())) return "";
  const dd = new Date(d.getTime() + 12 * 3600 * 1e3);
  return `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, "0")}-${String(dd.getUTCDate()).padStart(2, "0")}`;
};
var isoToDisplay = (iso2) => iso2 ? `${iso2.slice(8, 10)}.${iso2.slice(5, 7)}.${iso2.slice(2, 4)}` : "";
var isoToMonthKey = (iso2) => iso2 ? `${HebrewMonthsMap[+iso2.slice(5, 7) - 1]}-${iso2.slice(2, 4)}` : "";
var daysBetween = (a, b) => (parseFlexDate(b) - parseFlexDate(a)) / DAY_MS;
var num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
};
var normCurrency = (c) => {
  const s = String(c || "").toLowerCase().replace(/\s+/g, "");
  if (!s || ['\u05E9"\u05D7', "\u05E9\u05D7", "\u20AA", "ils", "nis"].includes(s)) return "ILS";
  if (["$", "usd", "us$", "\u05D3\u05D5\u05DC\u05E8"].includes(s)) return "USD";
  if (["eur", "\u20AC", "\u05D0\u05D9\u05E8\u05D5", "\u05D9\u05D5\u05E8\u05D5"].includes(s)) return "EUR";
  return String(c).trim();
};
var isJunkSku = (sku, desc) => !sku || sku === "000" || sku === "1" || sku === "H000" || /^-{3,}/.test(String(desc || ""));
var linesCoverage = (lines, fileMonths) => {
  const covered = new Set(lines.map((l) => isoToMonthKey(l.d)));
  if (lines.length) {
    const first = lines.reduce((m, l) => l.d < m ? l.d : m, lines[0].d);
    const fk = isoToMonthKey(first);
    if (+first.slice(8, 10) > 3 && fileMonths.has(fk)) covered.delete(fk);
  }
  return covered;
};
var NON_PRODUCT_LABEL = "\u05E9\u05D5\u05E8\u05D5\u05EA \u05DC\u05DC\u05D0 \u05DE\u05D5\u05E6\u05E8 (\u05D4\u05E0\u05D7\u05D5\u05EA, \u05E9\u05D9\u05E8\u05D5\u05EA, \u05D4\u05D5\u05D1\u05DC\u05D4)";
var mergeLinesIntoMonthly = (raw, lines, { includeExtra = false } = {}) => {
  const use = includeExtra ? lines : lines.filter((l) => !l.x);
  if (!use.length) return raw;
  const covered = linesCoverage(use, new Set(raw.map((r) => r.date)));
  const agg = {}, names = {};
  use.forEach((l) => {
    const m = isoToMonthKey(l.d);
    if (!covered.has(m)) return;
    const sku = l.k || "__extra";
    const key = sku + "|" + m;
    if (!agg[key]) agg[key] = { sku: l.k, date: m, quantity: 0, total: 0, extra: !l.k };
    agg[key].quantity += l.x ? 0 : l.q;
    agg[key].total += l.v;
    if (l.k && !names[l.k] && l.q > 0 && !l.x) names[l.k] = l.n;
    if (l.k && !names[l.k]) names[l.k] = l.n;
  });
  const fromLines = Object.values(agg).map((r, i) => ({
    id: "sl-" + i,
    sku: r.sku,
    date: r.date,
    quantity: r.quantity,
    total: Math.round(r.total * 100) / 100,
    description: r.extra ? NON_PRODUCT_LABEL : names[r.sku] || r.sku,
    unit: "\u05D9\u05D7'",
    supplier: "\u05DB\u05DC\u05DC\u05D9",
    fromLines: true
  }));
  return [...raw.filter((r) => !covered.has(r.date)), ...fromLines];
};
var parseSalesLines = (rows) => {
  const hi = findHeaderRow(rows, ["\u05EA\u05D0\u05E8\u05D9\u05DA", '\u05DE\u05E7"\u05D8', "\u05DB\u05DE\u05D5\u05EA", "\u05E9\u05DD \u05DC\u05E7\u05D5\u05D7"]);
  if (hi === -1) return null;
  const H = rows[hi].map(normHeader);
  const c = {
    d: colIndex(H, "\u05EA\u05D0\u05E8\u05D9\u05DA"),
    inv: colIndex(H, "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA"),
    cid: colIndex(H, "\u05DE\u05E1. \u05DC\u05E7\u05D5\u05D7"),
    cn: colIndex(H, "\u05E9\u05DD \u05DC\u05E7\u05D5\u05D7"),
    k: colIndex(H, '\u05DE\u05E7"\u05D8'),
    n: colIndex(H, "\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05EA\u05D9\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8"),
    q: colIndex(H, "\u05DB\u05DE\u05D5\u05EA"),
    v: colIndex(H, '\u05E1\u05D4"\u05DB \u05D0\u05D7\u05E8\u05D9 \u05D4\u05E0\u05D7\u05D4', '\u05E1\u05D4"\u05DB \u05DE\u05D7\u05D9\u05E8'),
    ord: colIndex(H, "\u05D4\u05D6\u05DE\u05E0\u05D4")
  };
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const k = String(r[c.k] ?? "").trim(), n = String(r[c.n] ?? "").trim();
    const q = num(r[c.q]), v = c.v !== -1 ? num(r[c.v]) : 0;
    const junk = isJunkSku(k, n);
    if ((junk || !q) && !v) continue;
    const d = toIsoDate(r[c.d]);
    if (!d) continue;
    const line = { d, inv: String(r[c.inv] ?? ""), cid: String(r[c.cid] ?? ""), c: String(r[c.cn] ?? "").trim(), k: junk ? "" : k, n, q: junk ? 0 : q, v, o: c.ord !== -1 ? String(r[c.ord] ?? "") : "" };
    if (junk || !q) line.x = 1;
    out.push(line);
  }
  out.sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
  return out;
};
var parsePurchaseLines = (rows) => {
  const hi = findHeaderRow(rows, ["\u05EA\u05D0\u05E8\u05D9\u05DA", "\u05E9\u05DD \u05E1\u05E4\u05E7", '\u05DE\u05E7"\u05D8', "\u05DB\u05DE\u05D5\u05EA"]);
  if (hi === -1) return null;
  const H = rows[hi].map(normHeader);
  const c = {
    d: colIndex(H, "\u05EA\u05D0\u05E8\u05D9\u05DA"),
    inv: colIndex(H, "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA"),
    s: colIndex(H, "\u05E9\u05DD \u05E1\u05E4\u05E7"),
    k: colIndex(H, '\u05DE\u05E7"\u05D8'),
    n: colIndex(H, "\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05EA\u05D9\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8"),
    q: colIndex(H, "\u05DB\u05DE\u05D5\u05EA"),
    p: colIndex(H, "\u05DE\u05D7\u05D9\u05E8 \u05DC\u05D9\u05D7\u05D9\u05D3\u05D4"),
    cur: colIndex(H, "\u05DE\u05D8\u05D1\u05E2 \u05E9\u05D5\u05E8\u05D4", "\u05DE\u05D8\u05D1\u05E2 \u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA"),
    tot: colIndex(H, '\u05E1\u05D4"\u05DB \u05D0\u05D7\u05E8\u05D9 \u05D4\u05E0\u05D7\u05D4', '\u05E1\u05D4"\u05DB \u05DE\u05D7\u05D9\u05E8'),
    rate: colIndex(H, "\u05E9\u05E2\u05E8 \u05D7\u05DC\u05D9\u05E4\u05D9\u05DF"),
    po: colIndex(H, "\u05D4\u05D6\u05DE\u05E0\u05EA \u05E8\u05DB\u05E9"),
    pod: colIndex(H, "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D4\u05D4\u05D6\u05DE\u05E0\u05D4", "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D4\u05D6\u05DE\u05E0\u05D4"),
    pos: colIndex(H, "\u05EA\u05D0\u05E8\u05D9\u05DA \u05E9\u05DC\u05D9\u05D7\u05D4"),
    dc: colIndex(H, "\u05D7\u05D9\u05D5\u05D1/\u05D6\u05DB\u05D5\u05D9")
  };
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const s = String(r[c.s] ?? "").trim();
    if (!s) continue;
    const d = toIsoDate(r[c.d]);
    if (!d) continue;
    const k = String(r[c.k] ?? "").trim(), n = String(r[c.n] ?? "").trim();
    const sign = c.dc !== -1 && String(r[c.dc]).trim() === "C" ? -1 : 1;
    const cur = normCurrency(r[c.cur]);
    const rate = c.rate !== -1 ? num(r[c.rate]) || 1 : 1;
    out.push({
      d,
      inv: String(r[c.inv] ?? ""),
      s,
      k,
      n,
      junk: isJunkSku(k, n),
      q: num(r[c.q]) * sign,
      p: num(r[c.p]),
      cur,
      tot: num(r[c.tot]) * sign,
      rate: cur === "ILS" ? 1 : rate,
      po: c.po !== -1 ? String(r[c.po] ?? "").trim() : "",
      pod: c.pod !== -1 ? toIsoDate(r[c.pod]) : "",
      pos: c.pos !== -1 ? toIsoDate(r[c.pos]) : ""
    });
  }
  out.sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
  return out;
};
var shipmentStage = (s, todayIso) => {
  if (!s.dep) return { idx: 0, label: "\u05D1\u05D4\u05DB\u05E0\u05D4" };
  if (s.dep > todayIso) return { idx: 0, label: "\u05DE\u05DE\u05EA\u05D9\u05DF \u05DC\u05D4\u05E4\u05DC\u05D2\u05D4" };
  if (!s.arr || s.arr > todayIso) return { idx: 1, label: "\u05D1\u05D3\u05E8\u05DA" };
  return { idx: 2, label: "\u05D4\u05D2\u05D9\u05E2 \u05DC\u05E0\u05DE\u05DC" };
};
var SHIP_NAME_STOP = /* @__PURE__ */ new Set(["LTD", "LIMITED", "CO", "COMPANY", "CORP", "CORPORATION", "INC", "GMBH", "SPA", "SRL", "SA", "INTERNATIONAL", "TRADE", "TRADING", "INDUSTRY", "INDUSTRIAL", "TECHNOLOGY", "TECH", "INTELLIGENT", "ELECTRIC", "ELECTRONIC", "ELECTRONICS", "MACHINE", "MOTORS", "MOTOR", "SHUTTER", "HARDWARE", "GROUP", "AND", "THE", "CITY", "CHINA", "GUANGDONG", "NINGBO", "ZHEJIANG", "SHANGHAI", "SHENZHEN", "XIAMEN", "JIANGSU", "FUJIAN", "UND", "AUTOMATISMI", "AUTOMATION", "SYSTEMS", "SYSTEM"]);
var matchShipSupplier = (fwdName, candidates) => {
  const words = String(fwdName).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const keys = /* @__PURE__ */ new Set();
  words.forEach((w, i) => {
    if (w.length >= 4 && !SHIP_NAME_STOP.has(w)) keys.add(w);
    if (i < words.length - 1) {
      const j = w + words[i + 1];
      if (j.length >= 6) keys.add(j);
    }
  });
  if (!keys.size) return null;
  let best = null, bestScore = 0;
  candidates.forEach((cand) => {
    const flat = String(cand).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!flat) return;
    let score = 0;
    keys.forEach((k) => {
      if (flat.includes(k)) score += k.length;
    });
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  });
  return bestScore >= 5 ? best : null;
};
var byDateDesc = (a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0;
var mergeLinesSince = (prev, fresh, since) => (since ? [...fresh, ...(prev || []).filter((l) => l.d < since)] : [...fresh]).sort(byDateDesc);
var applyInventory = (prev, parsed, { replaceStock = false, today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) } = {}) => {
  const ns = replaceStock ? {} : { ...prev.stock || {} }, nc = { ...prev.cost || {} }, nm = { ...prev.minStock || {} }, nsup = { ...prev.supplier || {} }, nmoq = { ...prev.moq || {} }, ncur = { ...prev.currency || {} }, nnames = { ...prev.names || {} }, nhist = { ...prev.costHistory || {} };
  parsed.forEach((item) => {
    const k = item.sku || item.name;
    if (item.name && item.name !== k) nnames[k] = item.name;
    if (item.quantity !== null) ns[k] = item.quantity;
    if (item.cost !== null) {
      const cur = item.currency || ncur[k] || "ILS";
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
    total: parsed.length,
    withQty: parsed.filter((p) => p.quantity !== null).length,
    withCost: parsed.filter((p) => p.cost !== null).length,
    withMinStock: parsed.filter((p) => p.minStock !== null).length,
    withSupplier: parsed.filter((p) => p.supplier).length
  };
  return { stock: ns, cost: nc, minStock: nm, supplier: nsup, moq: nmoq, currency: ncur, names: nnames, costHistory: nhist, stats };
};
var applyOpenOrders = ({ prevOrders = [], parsed, receiptLog = [], draftQty = {}, today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }) => {
  const idOf = (o) => `${o.poNumber || ""}|${o.productKey || o.productName || ""}`;
  const newIds = new Set(parsed.map(idOf));
  const SENT = /* @__PURE__ */ new Set(["\u05E0\u05E9\u05DC\u05D7\u05D4", "\u05D0\u05D5\u05E9\u05E8\u05D4"]);
  const vanished = prevOrders.filter((o) => o.fromPriority && o.poNumber && !newIds.has(idOf(o)) && (!o.poStatus || SENT.has(o.poStatus)));
  const nextLog = vanished.length ? [...receiptLog, ...vanished.map((o) => ({
    supplier: o.supplier || "",
    productKey: o.productKey || o.productName,
    poNumber: o.poNumber,
    orderDate: o.orderDate || "",
    expectedDate: o.expectedDate || "",
    receivedDate: today,
    qty: o.orderedQty || 0,
    estimated: true
  }))].slice(-2e3) : receiptLog;
  const orderedKeys = new Set(parsed.map((o) => o.productKey));
  let nextDraft = draftQty;
  if (Object.keys(draftQty).some((k) => orderedKeys.has(k))) {
    nextDraft = { ...draftQty };
    orderedKeys.forEach((k) => delete nextDraft[k]);
  }
  return { orders: [...prevOrders.filter((o) => !o.fromPriority), ...parsed], receiptLog: nextLog, draftQty: nextDraft, vanished: vanished.length };
};
var quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
var supplierLeadTimes = ({ purchaseLines = [], poMeta = {}, transitBySupplier = {}, sinceIso = null }) => {
  const by = {};
  const seen = /* @__PURE__ */ new Set();
  purchaseLines.forEach((l) => {
    if (!l.po || !(l.q > 0) || sinceIso && l.d < sinceIso) return;
    const k = l.po + "|" + l.inv;
    if (seen.has(k)) return;
    seen.add(k);
    const m = poMeta[l.po];
    const sent = m && m.sent || l.pos || "";
    const start = sent || m && m.created || l.pod;
    if (!start) return;
    const days = (Date.parse(l.d) - Date.parse(start)) / 864e5;
    if (!(days >= 0 && days < 400)) return;
    (by[l.s] ||= []).push({ days, fromSent: !!sent, d: l.d, po: l.po });
  });
  const out = {};
  Object.entries(by).forEach(([sup, arr]) => {
    const v = arr.map((x) => x.days).sort((a, b) => a - b);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    const tr = (transitBySupplier[sup] || []).slice().sort((a, b) => a - b);
    const transit = tr.length ? Math.round(quantile(tr, 0.5)) : 0;
    const median = Math.round(quantile(v, 0.5));
    out[sup] = {
      n: v.length,
      median,
      p80: Math.round(quantile(v, 0.8)),
      std: Math.round(std),
      transit,
      total: median + transit,
      sentShare: arr.filter((x) => x.fromSent).length / arr.length,
      samples: arr.sort((a, b) => a.d < b.d ? 1 : -1).slice(0, 12)
    };
  });
  return out;
};
var saleLineId = (l) => `${l.inv}|${l.k}|${l.q}|${l.d}`;
var detectOutliers = (lines, { sinceIso = null, factor = 4, minQty = 5, minImpact = 0.2 } = {}) => {
  const bySku = {};
  lines.forEach((l) => {
    if (!l.x && l.q > 0 && l.k) (bySku[l.k] ||= []).push(l);
  });
  const out = {};
  for (const [k, arr] of Object.entries(bySku)) {
    if (arr.length < 10) continue;
    const qs = arr.map((l) => l.q).sort((a, b) => a - b);
    const med = quantile(qs, 0.5);
    const mad = quantile(qs.map((q) => Math.abs(q - med)).sort((a, b) => a - b), 0.5);
    const T = Math.max(factor * med, med + 5 * mad, minQty);
    const monthQty = {};
    arr.forEach((l) => {
      const m = l.d.slice(0, 7);
      monthQty[m] = (monthQty[m] || 0) + l.q;
    });
    const recent = sinceIso ? arr.filter((l) => l.d >= sinceIso) : arr;
    const recentTotal = recent.reduce((a, l) => a + l.q, 0);
    const big = arr.filter((l) => l.q > T);
    if (!big.length) continue;
    const bigByCust = {};
    big.forEach((l) => {
      bigByCust[l.c] = (bigByCust[l.c] || 0) + 1;
    });
    const list = big.filter((l) => bigByCust[l.c] < 3 && l.q >= 0.5 * monthQty[l.d.slice(0, 7)] && (!sinceIso || l.d >= sinceIso) && recentTotal > 0 && (l.q - T) / recentTotal >= minImpact).map((l) => ({ id: saleLineId(l), d: l.d, c: l.c, q: l.q, inv: l.inv, cap: Math.max(1, Math.round(T)), monthQty: monthQty[l.d.slice(0, 7)] })).sort((a, b) => a.d < b.d ? 1 : -1);
    if (list.length) out[k] = { threshold: Math.round(T), median: med, lines: list };
  }
  return out;
};
var purchasePriceHistory = (purchaseLines = []) => {
  const by = {};
  purchaseLines.forEach((l) => {
    if (l.junk || !l.k || !(l.q > 0) || !(l.p > 0)) return;
    (by[l.k] ||= []).push({ d: l.d, s: l.s, n: l.n, p: l.p, cur: l.cur || "ILS", rate: l.rate || 1, ils: l.p * (l.rate || 1), q: l.q, inv: l.inv, po: l.po || "" });
  });
  Object.values(by).forEach((a) => a.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  return by;
};
var priceIncreases = (hist, { sinceIso, minPct = 5 } = {}) => {
  const out = [];
  Object.entries(hist).forEach(([k, pts]) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i], prev = [...pts.slice(0, i)].reverse().find((x) => x.s === a.s && x.cur === a.cur && x.d < a.d);
      if (!prev || sinceIso && a.d < sinceIso) continue;
      const pct = (a.p / prev.p - 1) * 100;
      if (pct >= minPct) out.push({ k, s: a.s, d: a.d, prevD: prev.d, p: a.p, prevP: prev.p, cur: a.cur, pct, ilsPct: (a.ils / prev.ils - 1) * 100, q: a.q, inv: a.inv });
    }
  });
  return out.sort((x, y) => x.d < y.d ? 1 : -1);
};
var productStartDates = ({ itemsExtra = {}, purchaseLines = [] } = {}) => {
  const out = {};
  let firstAny = null;
  const firstBuy = {};
  purchaseLines.forEach((l) => {
    if (!l.d) return;
    if (!firstAny || l.d < firstAny) firstAny = l.d;
    if (l.k && l.q > 0 && (!firstBuy[l.k] || l.d < firstBuy[l.k])) firstBuy[l.k] = l.d;
  });
  Object.entries(itemsExtra).forEach(([k, ex]) => {
    if (ex?.created) out[k] = ex.created;
  });
  if (firstAny) Object.entries(firstBuy).forEach(([k, d]) => {
    if (!out[k] && Date.parse(d) - Date.parse(firstAny) > 60 * 864e5) out[k] = d;
  });
  return out;
};
var stockTimelines = ({ stockHistory, currentStock = {}, salesLines = [], purchaseLines = [], skus, fromIso, toIso, startBy = {} }) => {
  const want = new Set(skus);
  const mv = {};
  salesLines.forEach((l) => {
    if (!l.x && want.has(l.k) && l.d >= fromIso && l.d <= toIso) {
      const m = mv[l.k] ||= {};
      m[l.d] = (m[l.d] || 0) - l.q;
    }
  });
  purchaseLines.forEach((l) => {
    if (!l.junk && want.has(l.k) && l.d >= fromIso && l.d <= toIso) {
      const m = mv[l.k] ||= {};
      m[l.d] = (m[l.d] || 0) + l.q;
    }
  });
  const snaps = {};
  const cum = {};
  (stockHistory?.days || []).slice().sort((a, b) => a.d < b.d ? -1 : 1).forEach((day) => {
    Object.assign(cum, day.s);
    want.forEach((k) => {
      if (k in cum) (snaps[k] ||= {})[day.d] = cum[k];
    });
  });
  const days = [];
  for (let t = Date.parse(toIso); t >= Date.parse(fromIso); t -= 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const out = {};
  want.forEach((k) => {
    const sn = snaps[k] || {}, m = mv[k] || {};
    let q = currentStock[k] ?? null;
    if (q == null && !Object.keys(sn).length) return;
    const series = [];
    let src = "calc";
    const start = startBy[k] || "";
    for (const d of days) {
      if (start && d < start) break;
      if (sn[d] != null) {
        q = sn[d];
        src = "snap";
      } else if (q == null) continue;
      series.push({ d, q: Math.max(0, Math.round(q * 100) / 100), src, neg: q < 0 });
      q = q - (m[d] || 0);
      if (sn[d] == null) src = "calc";
    }
    out[k] = series.reverse();
  });
  return out;
};
var stockoutSummary = (timelines) => {
  const out = {};
  Object.entries(timelines).forEach(([k, s]) => {
    let outDays = 0;
    const byMonth = {};
    s.forEach((x) => {
      const m = x.d.slice(0, 7);
      const b = byMonth[m] ||= { days: 0, out: 0 };
      b.days++;
      if (x.q <= 0 && !x.neg) {
        b.out++;
        outDays++;
      }
    });
    const monthsOut = Object.entries(byMonth).filter(([, b]) => b.out >= b.days / 2).map(([m]) => m);
    out[k] = { outDays, days: s.length, monthsOut, estimated: s.some((x) => x.src === "calc") };
  });
  return out;
};
var returnsAnalysis = (lines = [], { fromIso, toIso, prevFromIso } = {}) => {
  const inWin = (d) => d >= fromIso && d <= toIso;
  const prod = {}, cust = {}, inv = {}, months = {};
  let sold = 0, goods = 0, money = 0, prevGoods = 0, prevMoney = 0, prevSold = 0;
  lines.forEach((l) => {
    const isPrev = prevFromIso && l.d >= prevFromIso && l.d < fromIso;
    if (!inWin(l.d) && !isPrev) return;
    const goodsRet = !l.x && l.q < 0, moneyCr = l.x && l.v < 0;
    if (isPrev) {
      if (l.v > 0) prevSold += l.v;
      if (goodsRet) prevGoods += -l.v;
      if (moneyCr) prevMoney += -l.v;
      return;
    }
    if (l.v > 0) sold += l.v;
    if (!l.x && l.k) {
      const p = prod[l.k] ||= { k: l.k, n: l.n, soldQ: 0, soldV: 0, retQ: 0, retV: 0, cust: {} };
      if (l.q > 0) {
        p.soldQ += l.q;
        p.soldV += l.v;
        if (!p.n) p.n = l.n;
      }
      if (l.q < 0) {
        p.retQ += -l.q;
        p.retV += -l.v;
        p.cust[l.c] = (p.cust[l.c] || 0) + -l.q;
      }
    }
    const c = cust[l.c] ||= { c: l.c, soldV: 0, goodsV: 0, moneyV: 0, invs: /* @__PURE__ */ new Set() };
    if (l.v > 0) c.soldV += l.v;
    if (goodsRet || moneyCr) {
      if (goodsRet) {
        goods += -l.v;
        c.goodsV += -l.v;
      } else {
        money += -l.v;
        c.moneyV += -l.v;
      }
      c.invs.add(l.inv);
      const iv = inv[l.inv] ||= { inv: l.inv, d: l.d, c: l.c, goodsV: 0, moneyV: 0, items: [] };
      if (goodsRet) {
        iv.goodsV += -l.v;
        iv.items.push({ k: l.k, n: l.n, q: -l.q });
      } else iv.moneyV += -l.v;
      const m = l.d.slice(0, 7);
      months[m] ||= { m, goods: 0, money: 0 };
      months[m][goodsRet ? "goods" : "money"] += -l.v;
    }
  });
  const products = Object.values(prod).filter((p) => p.retQ > 0).map((p) => ({
    ...p,
    rate: p.soldQ > 0 ? p.retQ / p.soldQ * 100 : null,
    topCust: Object.entries(p.cust).sort((a, b) => b[1] - a[1])[0]?.[0] || ""
  })).sort((a, b) => b.retV - a.retV);
  const customers = Object.values(cust).filter((c) => c.goodsV || c.moneyV).map((c) => ({
    c: c.c,
    soldV: c.soldV,
    goodsV: c.goodsV,
    moneyV: c.moneyV,
    total: c.goodsV + c.moneyV,
    share: c.soldV > 0 ? (c.goodsV + c.moneyV) / c.soldV * 100 : null,
    n: c.invs.size
  })).sort((a, b) => b.total - a.total);
  const invoices = Object.values(inv).map((i) => ({ ...i, total: i.goodsV + i.moneyV, kind: i.goodsV && i.moneyV ? "both" : i.goodsV ? "goods" : "money" })).sort((a, b) => a.d < b.d ? 1 : -1);
  return { sold, goods, money, prevSold, prevGoods, prevMoney, products, customers, invoices, months: Object.values(months).sort((a, b) => a.m < b.m ? -1 : 1) };
};

// src/core/priorityPull.js
var SYNC_FORMS = ["LOGPART", "PORDERS", "AINVOICES", "CINVOICES", "EINVOICES", "YINVOICES", "CUSTOMERS"];
var SALES_FORMS = ["AINVOICES", "CINVOICES", "EINVOICES"];
var OPTIONAL_SALES = { CINVOICES: "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05E8\u05DB\u05D6\u05D5\u05EA", EINVOICES: "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05E1 \u05E7\u05D1\u05DC\u05D4" };
var FULL_MONTHS = 24;
var SYNC_MONTH_OPTIONS = [24, 36, 48, 60];
var syncMonthsOf = (v) => SYNC_MONTH_OPTIONS.includes(Number(v)) ? Number(v) : FULL_MONTHS;
var OVERLAP_DAYS = 45;
var entityFields = (xml, type) => {
  const m = xml.match(new RegExp(`<EntityType Name="${type}"[^>]*>([\\s\\S]*?)</EntityType>`));
  if (!m) return null;
  const body = m[1];
  const fields = [...body.matchAll(/<Property Name="([^"]+)" Type="([^"]+)"/g)].map((x) => x[1]);
  const nav = [...body.matchAll(/<NavigationProperty Name="([^"]+)" Type="([^"]+)"/g)].map((x) => ({ name: x[1], type: x[2].replace(/^Collection\(/, "").replace(/\)$/, "").split(".").pop() || "" }));
  return { fields, nav };
};
var describeFromMetadata = (xml, form) => {
  const top = entityFields(xml, form);
  if (!top) return null;
  const subforms = {};
  for (const n of top.nav) subforms[n.name] = entityFields(xml, n.type)?.fields || [];
  return { fields: top.fields, subforms };
};
var pick = (fields, candidates) => candidates.find((c) => fields.includes(c)) || null;
var MissingFieldError = class extends Error {
};
var need = (fields, candidates, what, form) => {
  const f = pick(fields, candidates);
  if (!f) throw new MissingFieldError(`\u05D1\u05D8\u05D5\u05E4\u05E1 ${form} \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0 \u05E9\u05D3\u05D4 \u05DC"${what}". \u05E9\u05D3\u05D5\u05EA \u05E7\u05D9\u05D9\u05DE\u05D9\u05DD: ${fields.join(", ")}`);
  return f;
};
var subformOf = (desc, test, form) => {
  const name = Object.keys(desc.subforms || {}).find(test);
  if (!name) throw new MissingFieldError(`\u05D1\u05D8\u05D5\u05E4\u05E1 ${form} \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0 \u05EA\u05EA-\u05D8\u05D5\u05E4\u05E1 \u05DE\u05EA\u05D0\u05D9\u05DD. \u05EA\u05EA\u05D9-\u05D8\u05E4\u05E1\u05D9\u05DD: ${Object.keys(desc.subforms || {}).join(", ") || "(\u05D0\u05D9\u05DF)"}`);
  return { name, fields: desc.subforms[name] };
};
var sel = (...names) => [...new Set(names.filter(Boolean))].join(",");
var dmy = (v) => {
  const s = String(v || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
var iso = (v) => {
  const m = String(v || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};
var numv = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
};
var describe = (forms, form) => {
  const d = forms?.[form];
  if (!d) throw new MissingFieldError(`form ${form} not in field list`);
  if (d.error) throw new Error(d.error);
  return d;
};
var isoDaysAgo = (days, now = Date.now()) => new Date(now - days * 864e5).toISOString().slice(0, 10);
var monthWindows = (sinceIso, now = Date.now()) => {
  const out = [];
  let a = /* @__PURE__ */ new Date(sinceIso.slice(0, 10) + "T00:00:00Z");
  const end = new Date(now + 864e5);
  while (a < end) {
    const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
    out.push([a.toISOString().slice(0, 10) + "T00:00:00Z", (b < end ? b : end).toISOString().slice(0, 10) + "T00:00:00Z"]);
    a = b;
  }
  return out;
};
var F = {
  part: ["PARTNAME"],
  partDes: ["PARTDES", "PDES"],
  status: ["STATDES"],
  invFlag: ["INVFLAG"],
  supName: ["SUPDES", "CDES", "SUPNAME"],
  buyPrice: ["LASTPRICE", "PURPRICE", "BUYPRICE", "LPRICE", "COST", "PRICE"],
  buyCur: ["PURCODE", "LASTCODE", "CODE", "CURRENCY"],
  minStock: ["MINQUANT", "INVMIN", "MINBAL", "MINSTOCK"],
  moq: ["MINPURQUANT", "MINORDQUANT", "PURMINQUANT"],
  balance: ["BALANCE", "TBALANCE", "QUANT", "TQUANT"],
  ordName: ["ORDNAME"],
  ordDate: ["CURDATE", "ORDDATE"],
  lineBalance: ["TBALANCE", "BALANCE", "QBALANCE", "RTQUANT"],
  lineDue: ["REQDATE", "DUEDATE", "SUPDATE"],
  linePrice: ["PRICE", "IPRICE"],
  lineTotal: ["QPRICE", "IVPRICE", "TOTPRICE"],
  quant: ["TQUANT", "QUANT"],
  ivNum: ["IVNUM"],
  ivDate: ["IVDATE", "CURDATE"],
  custNum: ["CUSTNAME"],
  custName: ["CDES", "CUSTDES"],
  supInvName: ["CDES", "SUPDES", "SUPNAME"],
  cur: ["CODE", "ICODE"],
  lineCur: ["ICODE", "CODE"],
  rate: ["EXCH", "IEXCH", "EXCHANGE"],
  debit: ["DEBIT"],
  family: ["FAMILYDES"],
  familyCode: ["FAMILYNAME"],
  partType: ["TYPE"],
  avgCost: ["COST"],
  listPrice: ["BASEPLPRICE"],
  lastSale: ["SALETRANSDATE"],
  lastBuy: ["PURTRANSDATE"],
  created: ["CREATEDDATE"],
  final: ["FINAL"],
  docStatus: ["STATDES"],
  hdrGross: ["QPRICE"],
  hdrNet: ["DISPRICE"],
  lineExch: ["EXCH"]
};
var finalFilter = (f) => pick(f, F.final) ? ` and ${pick(f, F.final)} eq 'Y'` : "";
var isCancelled = (r, f) => {
  const st = pick(f, F.docStatus);
  return !!(st && /מבוטל/.test(String(r[st] || "")));
};
async function pullItems(forms, query) {
  const d = describe(forms, "LOGPART");
  const f = d.fields;
  const sku = need(f, F.part, '\u05DE\u05E7"\u05D8', "LOGPART"), des = need(f, F.partDes, "\u05EA\u05D0\u05D5\u05E8", "LOGPART");
  const st = pick(f, F.status), inv = pick(f, F.invFlag), sup = pick(f, F.supName), price = pick(f, F.buyPrice), cur = pick(f, F.buyCur), min = pick(f, F.minStock), moq = pick(f, F.moq);
  const fam = pick(f, F.family), famCode = pick(f, F.familyCode), typ = pick(f, F.partType), avg = pick(f, F.avgCost), list = pick(f, F.listPrice), lastSale = pick(f, F.lastSale), lastBuy = pick(f, F.lastBuy), created = pick(f, F.created);
  const balSub = Object.keys(d.subforms || {}).find((n) => /BAL/.test(n));
  const balField = balSub ? pick(d.subforms[balSub], F.balance) : null;
  const rows = await query("LOGPART", {
    select: sel(sku, des, st, inv, sup, price, cur, min, moq, fam, famCode, typ, avg, list, lastSale, lastBuy, created),
    expand: balSub && balField ? `${balSub}($select=${balField})` : ""
  });
  const out = [], extra = {};
  for (const r of rows) {
    if (st && r[st] && r[st] !== "\u05E4\u05E2\u05D9\u05DC") continue;
    extra[r[sku]] = {
      fam: fam ? r[fam] || "" : "",
      famCode: famCode ? r[famCode] || "" : "",
      type: typ ? r[typ] || "" : "",
      avgCost: avg ? numv(r[avg]) || null : null,
      listPrice: list ? numv(r[list]) || null : null,
      lastSale: lastSale ? iso(r[lastSale]) : "",
      lastBuy: lastBuy ? iso(r[lastBuy]) : "",
      created: created ? iso(r[created]) : ""
    };
    if (inv && r[inv] && r[inv] !== "Y") continue;
    const bal = balSub && balField ? (r[balSub] || []).reduce((s, b) => s + numv(b[balField]), 0) : null;
    out.push({
      '\u05DE\u05E7"\u05D8': r[sku],
      "\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8": r[des],
      "\u05D9\u05EA\u05E8\u05D4": bal ?? 0,
      "\u05DE\u05D7\u05D9\u05E8 \u05E7\u05E0\u05D9\u05D4 \u05D0\u05D7\u05E8\u05D5\u05DF": price ? r[price] ?? "" : "",
      "\u05DE\u05D8\u05D1\u05E2": cur ? r[cur] ?? "" : "",
      "\u05DB\u05DE\u05D5\u05EA \u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05DC\u05DE\u05DC\u05D0\u05D9": min ? r[min] ?? "" : "",
      "\u05DB\u05DE\u05D5\u05EA \u05DE\u05D9\u05E0\u05D9\u05DE\u05D5\u05DD \u05DC\u05D4\u05D6\u05DE\u05E0\u05D4": moq ? r[moq] ?? "" : "",
      "\u05E9\u05DD \u05E1\u05E4\u05E7": sup ? r[sup] ?? "" : ""
    });
  }
  return {
    rows: out,
    extra,
    hasBalances: !!(balSub && balField),
    hasCost: !!price,
    notes: balSub && balField ? [] : [`\u05D9\u05EA\u05E8\u05D5\u05EA \u05DE\u05DC\u05D0\u05D9: \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0 \u05EA\u05EA-\u05D8\u05D5\u05E4\u05E1 \u05D9\u05EA\u05E8\u05D5\u05EA \u05D1-LOGPART \u2014 \u05D4\u05DB\u05DE\u05D5\u05D9\u05D5\u05EA \u05DC\u05D0 \u05E2\u05D5\u05D3\u05DB\u05E0\u05D5`]
  };
}
async function pullCustomers(forms, query) {
  const d = describe(forms, "CUSTOMERS");
  const f = d.fields;
  const num2 = need(f, ["CUSTNAME"], "\u05DE\u05E1. \u05DC\u05E7\u05D5\u05D7", "CUSTOMERS"), name = need(f, ["CUSTDES"], "\u05E9\u05DD \u05DC\u05E7\u05D5\u05D7", "CUSTOMERS");
  const cols = {
    status: pick(f, ["STATDES"]),
    created: pick(f, ["CREATEDDATE"]),
    city: pick(f, ["STATEA", "STATE"]),
    agent: pick(f, ["AGENTNAME"]),
    pay: pick(f, ["PAYDES"]),
    type: pick(f, ["CTYPENAME"]),
    zone: pick(f, ["ZONEDES"]),
    credit: pick(f, ["MAX_CREDIT"])
  };
  const rows = await query("CUSTOMERS", { select: sel(num2, name, ...Object.values(cols)) });
  const out = {};
  for (const r of rows) {
    const c = { num: r[num2], name: r[name] };
    for (const [k, fld] of Object.entries(cols)) if (fld) c[k] = k === "created" ? iso(r[fld]) : k === "credit" ? numv(r[fld]) || null : r[fld] || "";
    out[r[num2]] = c;
  }
  return out;
}
var poShape = (forms) => {
  const d = describe(forms, "PORDERS");
  const f = d.fields;
  const ord = need(f, F.ordName, "\u05DE\u05E1\u05E4\u05E8 \u05D4\u05D6\u05DE\u05E0\u05D4", "PORDERS"), date = need(f, F.ordDate, "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D4\u05D6\u05DE\u05E0\u05D4", "PORDERS");
  const sup = pick(f, F.supName), st = pick(f, F.status);
  const it = subformOf(d, (n) => /ITEMS/.test(n), "PORDERS");
  const sku = need(it.fields, F.part, '\u05DE\u05E7"\u05D8', it.name), des = pick(it.fields, F.partDes);
  const bal = need(it.fields, F.lineBalance, "\u05D9\u05EA\u05E8\u05D4 \u05DC\u05D0\u05E1\u05E4\u05E7\u05D4", it.name);
  const due = pick(it.fields, F.lineDue), price = pick(it.fields, F.linePrice);
  const logSub = Object.keys(d.subforms || {}).find((n) => /^DOCTODOLISTLOG/.test(n));
  const logFields = logSub ? d.subforms[logSub] : [];
  const log = logSub && logFields.includes("UDATE") && logFields.includes("STATDES") ? logSub : null;
  return { ord, date, sup, st, it, sku, des, bal, due, price, log };
};
var poMetaOf = (r, s) => {
  const hist = s.log ? (r[s.log] || []).filter((x) => x.UDATE).sort((a, b) => a.UDATE < b.UDATE ? -1 : 1) : [];
  const sentEntry = hist.find((x) => x.STATDES === "\u05E0\u05E9\u05DC\u05D7\u05D4") || hist.find((x) => x.STATDES && !/טיוטא|מבוטל|מחכה/.test(x.STATDES));
  const dues = {};
  if (s.due) for (const l of r[s.it.name] || []) {
    const d = iso(l[s.due]);
    if (l[s.sku] && d && (!dues[l[s.sku]] || d > dues[l[s.sku]])) dues[l[s.sku]] = d;
  }
  const m = { created: iso(r[s.date]), sent: sentEntry ? iso(sentEntry.UDATE) : "", status: s.st ? r[s.st] || "" : "", sup: s.sup ? r[s.sup] || "" : "" };
  if (s.due) m.dues = dues;
  return m;
};
async function pullOpenPOs(forms, query) {
  const s = poShape(forms);
  const filter = s.st ? `(${s.st} eq '\u05E0\u05E9\u05DC\u05D7\u05D4' or ${s.st} eq '\u05D0\u05D5\u05E9\u05E8\u05D4')` : "";
  const rows = await query("PORDERS", {
    select: sel(s.ord, s.date, s.sup, s.st),
    filter,
    orderby: s.ord,
    expand: [`${s.it.name}($select=${sel(s.sku, s.des, s.bal, s.due, s.price)})`, s.log ? `${s.log}($select=UDATE,STATDES)` : ""].filter(Boolean).join(",")
  });
  const lines = [], meta = {};
  for (const r of rows) {
    const m = poMetaOf(r, s);
    meta[r[s.ord]] = m;
    for (const l of r[s.it.name] || []) {
      const q = numv(l[s.bal]);
      if (q <= 0) continue;
      lines.push({
        "\u05D4\u05D6\u05DE\u05E0\u05D4": r[s.ord],
        '\u05DE\u05E7"\u05D8': l[s.sku],
        "\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8": s.des ? l[s.des] : "",
        "\u05D9\u05EA\u05E8\u05D4 \u05DC\u05D0\u05E1\u05E4\u05E7\u05D4": q,
        "\u05E9\u05D5\u05D5\u05D9 \u05D9\u05EA\u05E8\u05D4": s.price ? q * numv(l[s.price]) : "",
        "\u05EA. \u05D4\u05D6\u05DE\u05E0\u05D4": dmy(r[s.date]),
        "\u05EA. \u05D0\u05E1\u05E4\u05E7\u05D4": s.due ? dmy(l[s.due]) : "",
        "\u05E9\u05DD \u05E1\u05E4\u05E7": s.sup ? r[s.sup] : "",
        "\u05E1\u05D8\u05D8\u05D5\u05E1 \u05D4\u05D6\u05DE\u05E0\u05D4": m.status,
        "\u05EA. \u05E9\u05DC\u05D9\u05D7\u05D4": m.sent ? dmy(m.sent) : ""
      });
    }
  }
  return { lines, meta };
}
async function pullPoWindow(forms, query, [a, b]) {
  const s = poShape(forms);
  const rows = await query("PORDERS", {
    select: sel(s.ord, s.date, s.sup, s.st),
    filter: `${s.date} ge ${a} and ${s.date} lt ${b}`,
    orderby: s.ord,
    expand: [s.due ? `${s.it.name}($select=${sel(s.sku, s.due)})` : "", s.log ? `${s.log}($select=UDATE,STATDES)` : ""].filter(Boolean).join(",")
  });
  const meta = {};
  for (const r of rows) meta[r[s.ord]] = poMetaOf(r, s);
  return { meta };
}
var SALES_HEADERS = ["\u05EA\u05D0\u05E8\u05D9\u05DA", "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA", "\u05DE\u05E1. \u05DC\u05E7\u05D5\u05D7", "\u05E9\u05DD \u05DC\u05E7\u05D5\u05D7", '\u05DE\u05E7"\u05D8', "\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05DB\u05DE\u05D5\u05EA", '\u05E1\u05D4"\u05DB \u05D0\u05D7\u05E8\u05D9 \u05D4\u05E0\u05D7\u05D4', "\u05D4\u05D6\u05DE\u05E0\u05D4"];
async function pullSalesWindow(forms, query, form, [a, b]) {
  const d = describe(forms, form);
  const f = d.fields;
  const iv = need(f, F.ivNum, "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA", form), date = need(f, F.ivDate, "\u05EA\u05D0\u05E8\u05D9\u05DA", form);
  const cn = pick(f, F.custNum), cd = pick(f, F.custName);
  const st = pick(f, F.docStatus), gross = pick(f, F.hdrGross), net = pick(f, F.hdrNet);
  const it = subformOf(d, (n) => /ITEMS/.test(n), form);
  const sku = need(it.fields, F.part, '\u05DE\u05E7"\u05D8', it.name), des = pick(it.fields, F.partDes);
  const q = need(it.fields, F.quant, "\u05DB\u05DE\u05D5\u05EA", it.name), tot = pick(it.fields, F.lineTotal), ord = pick(it.fields, F.ordName);
  const exch = pick(it.fields, F.lineExch);
  const rows = await query(form, {
    select: sel(iv, date, cn, cd, st, gross, net),
    filter: `${date} ge ${a} and ${date} lt ${b}${finalFilter(f)}`,
    orderby: iv,
    expand: `${it.name}($select=${sel(sku, des, q, tot, ord, exch)})`
  });
  const out = [];
  for (const r of rows) {
    if (isCancelled(r, f)) continue;
    const g = gross ? numv(r[gross]) : 0, n = net ? numv(r[net]) : 0;
    const factor = g && n && Math.abs(n / g - 1) < 0.5 ? n / g : 1;
    for (const l of r[it.name] || []) {
      const rate = exch ? numv(l[exch]) || 1 : 1;
      const v = tot ? Math.round(numv(l[tot]) * rate * factor * 100) / 100 : 0;
      out.push([dmy(r[date]), r[iv], cn ? r[cn] : "", cd ? r[cd] : "", l[sku], des ? l[des] : "", numv(l[q]), v, ord ? l[ord] || "" : ""]);
    }
  }
  return { rows: out };
}
var PURCH_HEADERS = ["\u05EA\u05D0\u05E8\u05D9\u05DA", "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA", "\u05E9\u05DD \u05E1\u05E4\u05E7", '\u05DE\u05E7"\u05D8', "\u05EA\u05D0\u05D5\u05E8 \u05DE\u05D5\u05E6\u05E8", "\u05DB\u05DE\u05D5\u05EA", "\u05DE\u05D7\u05D9\u05E8 \u05DC\u05D9\u05D7\u05D9\u05D3\u05D4", "\u05DE\u05D8\u05D1\u05E2 \u05E9\u05D5\u05E8\u05D4", '\u05E1\u05D4"\u05DB \u05D0\u05D7\u05E8\u05D9 \u05D4\u05E0\u05D7\u05D4', "\u05E9\u05E2\u05E8 \u05D7\u05DC\u05D9\u05E4\u05D9\u05DF", "\u05D4\u05D6\u05DE\u05E0\u05EA \u05E8\u05DB\u05E9", "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D4\u05D4\u05D6\u05DE\u05E0\u05D4", "\u05D7\u05D9\u05D5\u05D1/\u05D6\u05DB\u05D5\u05D9", "\u05EA\u05D0\u05E8\u05D9\u05DA \u05E9\u05DC\u05D9\u05D7\u05D4"];
async function pullPurchaseWindow(forms, query, [a, b]) {
  const form = "YINVOICES";
  const d = describe(forms, form);
  const f = d.fields;
  const iv = need(f, F.ivNum, "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05EA", form), date = need(f, F.ivDate, "\u05EA\u05D0\u05E8\u05D9\u05DA", form), sup = need(f, F.supInvName, "\u05E9\u05DD \u05E1\u05E4\u05E7", form);
  const cur = pick(f, F.cur), rate = pick(f, F.rate), deb = pick(f, F.debit), st = pick(f, F.docStatus);
  const it = subformOf(d, (n) => /ITEMS/.test(n), form);
  const sku = need(it.fields, F.part, '\u05DE\u05E7"\u05D8', it.name), des = pick(it.fields, F.partDes);
  const q = need(it.fields, F.quant, "\u05DB\u05DE\u05D5\u05EA", it.name), price = pick(it.fields, F.linePrice), tot = pick(it.fields, F.lineTotal);
  const lcur = pick(it.fields, F.lineCur), ord = pick(it.fields, F.ordName);
  const rows = await query(form, {
    select: sel(iv, date, sup, cur, rate, deb, st),
    filter: `${date} ge ${a} and ${date} lt ${b}${finalFilter(f)}`,
    orderby: iv,
    expand: `${it.name}($select=${sel(sku, des, q, price, tot, lcur, ord)})`
  });
  const out = [];
  for (const r of rows) {
    if (isCancelled(r, f)) continue;
    for (const l of r[it.name] || []) {
      out.push([
        dmy(r[date]),
        r[iv],
        r[sup],
        l[sku],
        des ? l[des] : "",
        numv(l[q]),
        price ? numv(l[price]) : 0,
        lcur && l[lcur] || (cur ? r[cur] : "") || "",
        tot ? numv(l[tot]) : 0,
        rate ? numv(r[rate]) || "" : "",
        ord ? l[ord] || "" : "",
        "",
        deb ? r[deb] || "" : "",
        ""
      ]);
    }
  }
  return { rows: out };
}
var planSteps = ({ since = {}, poFull = false, now = Date.now(), months = FULL_MONTHS }) => {
  const full = isoDaysAgo(Math.round(syncMonthsOf(months) * 30.5), now);
  const sSince = since.salesLines || full, pSince = since.purchaseLines || full;
  const steps = [{ id: "items" }, { id: "customers" }, { id: "po-open" }];
  for (const w of monthWindows(poFull ? full : pSince, now)) steps.push({ id: `po:${w[0].slice(0, 10)}`, w });
  for (const form of SALES_FORMS) for (const w of monthWindows(sSince, now)) steps.push({ id: `sales:${form}:${w[0].slice(0, 10)}`, form, w });
  for (const w of monthWindows(pSince, now)) steps.push({ id: `purch:${w[0].slice(0, 10)}`, w });
  return { steps, sSince, pSince };
};
var NOT_OPEN = /not open|לא פתוח|לא ניתן להפעיל API|not in \$metadata|not in field list/i;
async function runStep(step, { forms, query }) {
  if (step.id === "items") return pullItems(forms, query);
  if (step.id === "customers") return { customers: await pullCustomers(forms, query) };
  if (step.id === "po-open") return pullOpenPOs(forms, query);
  if (step.id.startsWith("po:")) return pullPoWindow(forms, query, step.w);
  if (step.id.startsWith("purch:")) return pullPurchaseWindow(forms, query, step.w);
  if (step.id.startsWith("sales:")) {
    try {
      return await pullSalesWindow(forms, query, step.form, step.w);
    } catch (e) {
      if (OPTIONAL_SALES[step.form] && NOT_OPEN.test(e.message || "")) return { rows: [], skipped: `${OPTIONAL_SALES[step.form]} (${step.form}) \u05DC\u05D0 \u05E4\u05EA\u05D5\u05D7\u05D5\u05EA \u05DC-API \u05D1-Priority \u2014 \u05D4\u05DF \u05DC\u05D0 \u05E0\u05DB\u05DC\u05DC\u05D5\u05EA \u05D1\u05DE\u05DB\u05D9\u05E8\u05D5\u05EA.` };
      throw e;
    }
  }
  throw new Error(`unknown step ${step.id}`);
}
function finalizeSync({ prev, payloads, failed = {}, since = {}, sSince, pSince, now = Date.now(), months = FULL_MONTHS }) {
  const A = prev.appState || {}, D = prev.datasets || {};
  const today = new Date(now).toISOString().slice(0, 10);
  const stamp = today.split("-").reverse().join("-");
  const outState = {}, outSets = {}, log = [];
  const ids = Object.keys(payloads);
  const anyFailed = (prefix) => Object.keys(failed).some((k) => k === prefix || k.startsWith(prefix));
  const filesMeta = { ...A.procFilesMeta || {} };
  const through = { ...A.prioritySyncThrough || {} };
  const poMeta = { ...D.procPoMeta || {} };
  ids.filter((k) => k.startsWith("po:")).forEach((k) => Object.assign(poMeta, payloads[k].meta || {}));
  if (payloads["po-open"]) Object.assign(poMeta, payloads["po-open"].meta || {});
  outSets.procPoMeta = poMeta;
  const poSteps = ids.filter((k) => k.startsWith("po:"));
  if (poSteps.length && !anyFailed("po:") && poSteps.some((k) => Object.values(payloads[k].meta || {}).some((m) => m.dues))) outState.procPoDues = 1;
  const it = payloads.items;
  if (it) {
    const parsed = parseInventoryFile(it.rows);
    const nx = applyInventory(
      {
        stock: A.procurementStock,
        cost: A.procurementCost,
        minStock: A.procurementMinStock,
        supplier: A.procurementSupplier,
        moq: A.procurementMOQ,
        currency: A.procurementCurrency,
        names: A.procurementNames,
        costHistory: A.procurementCostHistory
      },
      parsed,
      { replaceStock: it.hasBalances, today }
    );
    Object.assign(outState, {
      procurementStock: nx.stock,
      procurementCost: nx.cost,
      procurementMinStock: nx.minStock,
      procurementSupplier: nx.supplier,
      procurementMOQ: nx.moq,
      procurementCurrency: nx.currency,
      procurementNames: nx.names,
      procurementCostHistory: nx.costHistory
    });
    const name = `Priority \u05E4\u05E8\u05D9\u05D8\u05D9\u05DD ${stamp}.xlsx`;
    const slots = { ...A.procurementInvSlots || {} };
    slots.product = { name, ...nx.stats, importedAt: now };
    slots.masterCard = { name, total: parsed.length, withQty: 0, withCost: 0, withMinStock: 0, withSupplier: 0, importedAt: now };
    outState.procurementInvSlots = slots;
    outState.inventoryFileName = name;
    outSets.procItemsExtra = it.extra;
    if (it.hasBalances) {
      const hist = D.stockHistory && D.stockHistory.days ? { ...D.stockHistory } : { days: [] };
      const last = {};
      (hist.days || []).filter((dd) => dd.d !== today).forEach((day) => Object.assign(last, day.s));
      const changes = {};
      Object.entries(nx.stock).forEach(([k, q]) => {
        if (last[k] !== q) changes[k] = q;
      });
      Object.keys(last).forEach((k) => {
        if (!(k in nx.stock) && last[k] !== 0) changes[k] = 0;
      });
      const days = (hist.days || []).filter((dd) => dd.d !== today);
      days.push({ d: today, s: changes, full: !days.length });
      outSets.stockHistory = { days };
    }
    log.push(`\u05E4\u05E8\u05D9\u05D8\u05D9\u05DD: ${parsed.length.toLocaleString()}`);
    (it.notes || []).forEach((n) => log.push(n));
  } else if (failed.items) log.push(`\u05E4\u05E8\u05D9\u05D8\u05D9\u05DD \u05DC\u05D0 \u05E2\u05D5\u05D3\u05DB\u05E0\u05D5: ${failed.items}`);
  if (payloads.customers) {
    outSets.priorityCustomers = payloads.customers.customers;
    log.push(`\u05DB\u05E8\u05D8\u05D9\u05E1\u05D9 \u05DC\u05E7\u05D5\u05D7\u05D5\u05EA: ${Object.keys(payloads.customers.customers).length.toLocaleString()}`);
  }
  if (payloads["po-open"]) {
    const parsed = parsePriorityOrders(payloads["po-open"].lines);
    const res = applyOpenOrders({ prevOrders: A.openOrders || [], parsed, receiptLog: A.procurementReceiptLog || [], draftQty: A.procurementDraftQty || {}, today });
    outState.openOrders = res.orders;
    if (res.receiptLog !== (A.procurementReceiptLog || [])) outState.procurementReceiptLog = res.receiptLog;
    if (res.draftQty !== (A.procurementDraftQty || {})) outState.procurementDraftQty = res.draftQty;
    const name = `Priority \u05D4\u05D6\u05DE\u05E0\u05D5\u05EA \u05E8\u05DB\u05E9 ${stamp}.xlsx`;
    outState.ordersFileName = name;
    filesMeta.openOrders = { name, rows: parsed.length, at: now };
    log.push(`\u05D4\u05D6\u05DE\u05E0\u05D5\u05EA \u05E8\u05DB\u05E9 \u05E4\u05EA\u05D5\u05D7\u05D5\u05EA: ${parsed.length.toLocaleString()} \u05E9\u05D5\u05E8\u05D5\u05EA`);
  }
  const salesIds = ids.filter((k) => k.startsWith("sales:"));
  if (salesIds.length && !anyFailed("sales:")) {
    const rows = [];
    const notes = /* @__PURE__ */ new Set();
    salesIds.forEach((k) => {
      rows.push(...payloads[k].rows || []);
      if (payloads[k].skipped) notes.add(payloads[k].skipped);
    });
    notes.forEach((n) => log.push(n));
    const parsed = parseSalesLines([SALES_HEADERS, ...rows]) || [];
    const merged = mergeLinesSince(D.procSalesLines || [], parsed, since.salesLines || null);
    outSets.procSalesLines = merged;
    if (merged.length) filesMeta.salesLines = { name: `Priority \u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05DB\u05D9\u05E8\u05D4 ${stamp}.xlsx`, rows: merged.length, from: merged[merged.length - 1].d, to: merged[0].d, at: now };
    through.salesLines = today;
    log.push(`\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05DB\u05D9\u05E8\u05D4: ${parsed.length.toLocaleString()} \u05E9\u05D5\u05E8\u05D5\u05EA ${since.salesLines ? "\u05D7\u05D3\u05E9\u05D5\u05EA/\u05DE\u05E2\u05D5\u05D3\u05DB\u05E0\u05D5\u05EA" : `(${syncMonthsOf(months)} \u05D7\u05D5\u05D3\u05E9\u05D9\u05DD)`}`);
    if (!since.salesLines) outState.prioritySyncMonthsDone = syncMonthsOf(months);
  } else if (anyFailed("sales:")) log.push("\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05DB\u05D9\u05E8\u05D4 \u05DC\u05D0 \u05E2\u05D5\u05D3\u05DB\u05E0\u05D5 \u2014 \u05D7\u05DC\u05E7 \u05DE\u05D4\u05D7\u05D5\u05D3\u05E9\u05D9\u05DD \u05E0\u05DB\u05E9\u05DC\u05D5. \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D4\u05E7\u05D5\u05D3\u05DE\u05D9\u05DD \u05E0\u05E9\u05DE\u05E8\u05D5.");
  const purchIds = ids.filter((k) => k.startsWith("purch:"));
  if (purchIds.length && !anyFailed("purch:")) {
    const rows = [];
    purchIds.forEach((k) => rows.push(...payloads[k].rows || []));
    rows.forEach((r) => {
      const m = poMeta[r[10]];
      if (m) {
        r[11] = m.created ? dmy(m.created) : "";
        r[13] = m.sent ? dmy(m.sent) : "";
      }
    });
    const parsed = parsePurchaseLines([PURCH_HEADERS, ...rows]) || [];
    const merged = mergeLinesSince(D.procPurchaseLines || [], parsed, since.purchaseLines || null);
    merged.forEach((l) => {
      if (l.po && !l.pos && poMeta[l.po]?.sent) l.pos = poMeta[l.po].sent;
      if (l.po && !l.pod && poMeta[l.po]?.created) l.pod = poMeta[l.po].created;
    });
    outSets.procPurchaseLines = merged;
    if (merged.length) filesMeta.purchaseLines = { name: `Priority \u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05E1\u05E4\u05E7 ${stamp}.xlsx`, rows: merged.length, from: merged[merged.length - 1].d, to: merged[0].d, at: now };
    through.purchaseLines = today;
    log.push(`\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05E1\u05E4\u05E7: ${parsed.length.toLocaleString()} \u05E9\u05D5\u05E8\u05D5\u05EA`);
  } else if (anyFailed("purch:")) log.push("\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05E1\u05E4\u05E7 \u05DC\u05D0 \u05E2\u05D5\u05D3\u05DB\u05E0\u05D5 \u2014 \u05D7\u05DC\u05E7 \u05DE\u05D4\u05D7\u05D5\u05D3\u05E9\u05D9\u05DD \u05E0\u05DB\u05E9\u05DC\u05D5.");
  outState.procFilesMeta = filesMeta;
  outState.prioritySyncThrough = through;
  outState.prioritySyncAt = now;
  return { appState: outState, datasets: outSets, log, sSince, pSince };
}

// src/core/procModel.js
var OWN_MADE = "\u05D9\u05D9\u05E6\u05D5\u05E8 \u05E2\u05E6\u05DE\u05D9";
var isOwnMadeFamily = (fam) => /ייצור\s*עצמי/.test(String(fam || ""));
var procStatus = (p) => {
  if (p.currentStock === null) return "unknown";
  if (p.suggestedOrder > 0) return p.risk === "critical" ? "now" : "soon";
  if (p.overdue || p.shortNowCoveredByPO) return "watch";
  return "ok";
};
var procChip = (p) => {
  if (p.overdue) return { t: `\u05D4\u05D6\u05DE\u05E0\u05D4 \u05D1\u05D0\u05D9\u05D7\u05D5\u05E8 ${p.overdue.maxDays} \u05D9\u05DE\u05D9\u05DD`, k: "now" };
  if (p.shortNowCoveredByPO) return { t: "\u05D7\u05E1\u05E8 \u05E2\u05DB\u05E9\u05D9\u05D5 \xB7 \u05DE\u05DB\u05D5\u05E1\u05D4 \u05D1\u05D4\u05D6\u05DE\u05E0\u05D4", k: "watch" };
  if (p.priceChangePct != null && Math.abs(p.priceChangePct) >= 3) return { t: `\u05DE\u05D7\u05D9\u05E8 \u05E7\u05E0\u05D9\u05D4 ${p.priceChangePct > 0 ? "\u05E2\u05DC\u05D4" : "\u05D9\u05E8\u05D3"} ${Math.abs(p.priceChangePct).toFixed(0)}%`, k: p.priceChangePct > 0 ? "watch" : "muted" };
  if (p.lifecycle === "dying") return { t: "\u05DE\u05DB\u05D9\u05E8\u05D5\u05EA \u05E6\u05D5\u05E0\u05D7\u05D5\u05EA", k: "watch" };
  if (p.isLimitedData && p.avgDataMonths > 0) return { t: `\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05DE-${p.avgDataMonths} \u05D7\u05F3 \u05D1\u05DC\u05D1\u05D3`, k: "muted" };
  if (p.effectiveCoverMonths != null && p.effectiveCoverMonths > 12) return { t: `\u05DE\u05DC\u05D0\u05D9 \u05DC-${Math.round(p.effectiveCoverMonths)} \u05D7\u05D5\u05D3\u05E9\u05D9\u05DD`, k: "muted" };
  return null;
};
var computeProducts = (ctx) => {
  const { salesData, excludeCurrentMonth, avgWindowMonths, stockouts, skipStockoutMonths, stockMap, minStockMap, lastSupBySku, supplierMap, costMap, itemsExtra, currencyMap, exchangeRates, costHistory, purchBySku, leadFor, incomingMap, overdueByProduct, moqMap, monthsToStock, supplierConcentration, outliers, outlierDecisions } = ctx;
  if (!salesData.length) return [];
  const map = {};
  salesData.forEach((row) => {
    const key = row.sku || row.description;
    if (!key) return;
    if (!map[key]) map[key] = { sku: row.sku || "", name: row.description || key, monthlyData: {}, monthlyRev: {}, totalQty: 0, totalRev: 0 };
    map[key].totalQty += row.quantity || 0;
    map[key].totalRev += row.total || 0;
    if (row.date) {
      map[key].monthlyData[row.date] = (map[key].monthlyData[row.date] || 0) + (row.quantity || 0);
      map[key].monthlyRev[row.date] = (map[key].monthlyRev[row.date] || 0) + (row.total || 0);
    }
  });
  let allMonthsFull = [...new Set(salesData.map((d) => d.date).filter(Boolean))].sort((a, b) => getDateVal(a) - getDateVal(b));
  if (excludeCurrentMonth && allMonthsFull.length > 1) allMonthsFull = allMonthsFull.slice(0, -1);
  const allMonths = avgWindowMonths === 0 ? allMonthsFull : allMonthsFull.slice(-avgWindowMonths);
  const windowMonthSet = new Set(allMonths);
  Object.values(map).forEach((p) => {
    p.windowRev = Object.entries(p.monthlyRev).reduce((s, [d, v]) => windowMonthSet.has(d) ? s + v : s, 0);
    p.monthlyDataWindow = Object.fromEntries(Object.entries(p.monthlyData).filter(([d]) => windowMonthSet.has(d)));
  });
  const totalWindowRev = Object.values(map).reduce((a, c) => a + Math.max(0, c.windowRev), 0);
  let cumulative = 0;
  const sorted = Object.values(map).sort((a, b) => b.windowRev - a.windowRev || b.totalRev - a.totalRev);
  sorted.forEach((p) => {
    const pct = totalWindowRev > 0 ? Math.max(0, p.windowRev) / totalWindowRev * 100 : 0;
    const before = cumulative;
    cumulative += pct;
    p.revPct = pct;
    p.abc = p.windowRev <= 0 ? "C" : before < 80 ? "A" : before < 95 ? "B" : "C";
  });
  const MONTH_ABBR = ["\u05D9\u05E0\u05D5", "\u05E4\u05D1\u05E8", "\u05DE\u05E8\u05E5", "\u05D0\u05E4\u05E8", "\u05DE\u05D0\u05D9", "\u05D9\u05D5\u05E0", "\u05D9\u05D5\u05DC", "\u05D0\u05D5\u05D2", "\u05E1\u05E4\u05D8", "\u05D0\u05D5\u05E7", "\u05E0\u05D5\u05D1", "\u05D3\u05E6\u05DE"];
  const lastMonthStr = allMonths[allMonths.length - 1] || "";
  const lastMonIdx = MONTH_ABBR.indexOf(lastMonthStr.split("-")[0]);
  const nextMonIdx = lastMonIdx !== -1 ? (lastMonIdx + 1) % 12 : -1;
  return sorted.map((p) => {
    const key = p.sku || p.name;
    const firstActiveIdx = allMonths.findIndex((m) => (p.monthlyDataWindow[m] || 0) > 0);
    let avgMonthly, avgDataMonths, isLimitedData, cappedVals = [];
    const so = stockouts[p.sku] || null;
    const outMonthKeys = so ? new Set(so.monthsOut.map((m) => isoToMonthKey(m + "-01"))) : /* @__PURE__ */ new Set();
    let skippedMonths = [];
    if (firstActiveIdx === -1) {
      avgMonthly = 0;
      avgDataMonths = 0;
      isLimitedData = true;
    } else {
      let relevantMonths = allMonths.slice(firstActiveIdx);
      if (skipStockoutMonths && outMonthKeys.size) {
        const kept = relevantMonths.filter((m) => !outMonthKeys.has(m));
        if (kept.length >= 3) {
          skippedMonths = relevantMonths.filter((m) => outMonthKeys.has(m));
          relevantMonths = kept;
        }
      }
      const rawVals = relevantMonths.map((m) => p.monthlyDataWindow[m] || 0);
      const activeVals = rawVals.filter((v) => v > 0);
      cappedVals = rawVals;
      if (activeVals.length >= 3) {
        const sortedActive = [...activeVals].sort((a, b) => a - b);
        const cap = sortedActive[Math.floor(sortedActive.length / 2)] * 3;
        cappedVals = rawVals.map((v) => v > cap ? cap : v);
      }
      avgMonthly = cappedVals.reduce((a, b) => a + b, 0) / relevantMonths.length;
      avgDataMonths = relevantMonths.length;
      isLimitedData = avgDataMonths < 3;
    }
    const sparkline = allMonths.slice(-6).map((m) => ({ m, v: p.monthlyData[m] || 0 }));
    const trendSeries = allMonths.slice(-12).map((m) => ({ month: m, qty: p.monthlyData[m] || 0 }));
    const last3 = allMonths.slice(-3).reduce((a, m) => a + (p.monthlyData[m] || 0), 0) / 3;
    const prev3 = allMonths.slice(-6, -3).reduce((a, m) => a + (p.monthlyData[m] || 0), 0) / 3;
    const trend = prev3 > 0 ? (last3 - prev3) / prev3 * 100 : 0;
    const currentStock = stockMap[key] ?? stockMap[p.sku] ?? stockMap[p.name] ?? null;
    const minStock = minStockMap[key] ?? minStockMap[p.sku] ?? minStockMap[p.name] ?? null;
    const lastP = lastSupBySku[p.sku] ?? lastSupBySku[key] ?? null;
    const ex = itemsExtra[p.sku] ?? itemsExtra[key] ?? null;
    const ownMade = isOwnMadeFamily(ex?.fam);
    const supplier = ownMade ? OWN_MADE : supplierMap[key] ?? supplierMap[p.sku] ?? supplierMap[p.name] ?? lastP?.s ?? null;
    const catalogCost = costMap[key] ?? costMap[p.sku] ?? costMap[p.name] ?? null;
    const costFromPurchase = catalogCost == null && lastP && lastP.p > 0;
    const costFromAvg = catalogCost == null && !costFromPurchase && ex?.avgCost > 0;
    const currency = costFromPurchase ? lastP.cur : costFromAvg ? "ILS" : currencyMap[key] ?? currencyMap[p.sku] ?? currencyMap[p.name] ?? null;
    const unitCostOriginal = costFromPurchase ? lastP.p : costFromAvg ? ex.avgCost : catalogCost;
    const isForeignCost = currency && currency !== "ILS";
    const fxRate = !isForeignCost ? 1 : exchangeRates?.[currency] > 0 ? exchangeRates[currency] : lastP && lastP.cur === currency && lastP.rate > 0 ? lastP.rate : null;
    const costUsable = unitCostOriginal != null && fxRate != null;
    const unitCost = costUsable ? unitCostOriginal * fxRate : null;
    const costConverted = costUsable && isForeignCost ? currency : null;
    const costCurrencyBlocked = unitCostOriginal != null && !costUsable ? currency : null;
    const hist = costHistory[key] ?? costHistory[p.sku] ?? costHistory[p.name] ?? null;
    let priceChangePct = null, prevPrice = null, priceChangedAt = null;
    if (hist && hist.length >= 2) {
      const last = hist[hist.length - 1], prev = hist[hist.length - 2];
      if (prev.c > 0 && last.cur === prev.cur) {
        priceChangePct = (last.c - prev.c) / prev.c * 100;
        prevPrice = prev.c;
        priceChangedAt = last.d;
      }
    }
    if (priceChangePct == null) {
      const buys = (purchBySku[p.sku] || purchBySku[key] || []).filter((b) => b.p > 0);
      if (buys.length >= 2) {
        const last = buys[0];
        const prev = buys.find((b) => b.cur === last.cur && Math.abs(b.p - last.p) > 1e-6 && b.d < last.d);
        if (prev && (unitCostOriginal == null || Math.abs(last.p - unitCostOriginal) <= unitCostOriginal * 0.02)) {
          priceChangePct = (last.p - prev.p) / prev.p * 100;
          prevPrice = prev.p;
          priceChangedAt = last.d;
        }
      }
    }
    const avgDaily = avgMonthly / 30;
    const coverageMonths = currentStock !== null && avgMonthly > 0 ? currentStock / avgMonthly : null;
    const coverageDays = currentStock !== null && avgDaily > 0 ? Math.round(currentStock / avgDaily) : null;
    const monthlyAvgs = MONTH_ABBR.map((mName) => {
      const vals = Object.entries(p.monthlyData).filter(([d]) => d.startsWith(mName + "-")).map(([, v]) => v);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    const monthlyByYear = MONTH_ABBR.map((mName) => {
      const yearMap = {};
      Object.entries(p.monthlyData).forEach(([date, qty]) => {
        if (!date) return;
        const hyphenIdx = date.indexOf("-");
        if (hyphenIdx === -1) return;
        if (date.slice(0, hyphenIdx) !== mName) return;
        const yrRaw = date.slice(hyphenIdx + 1);
        const year = yrRaw.length <= 2 ? "20" + yrRaw.padStart(2, "0") : yrRaw;
        yearMap[year] = (yearMap[year] || 0) + qty;
      });
      return Object.entries(yearMap).map(([year, qty]) => ({ year, qty })).sort((a, b) => a.year.localeCompare(b.year));
    });
    const annualAvg = monthlyAvgs.reduce((a, b) => a + b, 0) / 12 || 1;
    const monthsWithData = monthlyAvgs.filter((v) => v > 0).length;
    const yearsOfData = new Set(monthlyByYear.flat().map((y) => y.year)).size;
    const seasonalityReliable = yearsOfData >= 2 && monthsWithData >= 6;
    const seasonalityIdx = monthlyAvgs.map((v) => +(v / annualAvg).toFixed(2));
    const recent3 = allMonths.slice(-3);
    const recent3Avg = recent3.reduce((s, m) => s + (p.monthlyData[m] || 0), 0) / Math.max(recent3.length, 1);
    const trendFactor = Math.max(0.75, Math.min(1.4, 1 + (trend || 0) / 250));
    let seasonalFactor = 1;
    if (seasonalityReliable && nextMonIdx !== -1 && seasonalityIdx[nextMonIdx] > 0) {
      seasonalFactor = Math.max(0.5, Math.min(2, seasonalityIdx[nextMonIdx]));
    }
    const forecastNext = Math.round(recent3Avg * trendFactor * seasonalFactor);
    const stdDev = cappedVals.length > 1 ? Math.sqrt(cappedVals.reduce((s, v) => s + Math.pow(v - avgMonthly, 2), 0) / cappedVals.length) : 0;
    const cv = avgMonthly > 0 ? stdDev / avgMonthly : 0;
    const xyz = cv <= 0.5 ? "X" : cv <= 1 ? "Y" : "Z";
    const abcXyz = (p.abc || "C") + xyz;
    const lf = leadFor(supplier);
    const effectiveLeadTime = lf.months;
    const leadTimeOverridden = lf.source === "manual";
    const leadTimeSource = lf.source;
    const lcTrend = prev3 > 0 ? (last3 - prev3) / prev3 * 100 : 0;
    const lifecycle = lcTrend > 20 ? "growing" : lcTrend > -20 ? "stable" : lcTrend > -50 ? "declining" : "dying";
    const incomingQty = incomingMap[key] ?? incomingMap[p.sku] ?? incomingMap[p.name] ?? 0;
    const overdue = overdueByProduct[key] ?? overdueByProduct[p.sku] ?? overdueByProduct[p.name] ?? null;
    const effectiveStock = (currentStock ?? 0) + incomingQty;
    const effectiveCoverDays = currentStock !== null && avgDaily > 0 ? Math.round(effectiveStock / avgDaily) : null;
    const effectiveCoverMonths = currentStock !== null && avgMonthly > 0 ? effectiveStock / avgMonthly : null;
    const moq = moqMap[key] ?? moqMap[p.sku] ?? moqMap[p.name] ?? null;
    const plan = calcOrderPlan({ avgMonthly, stdDev, abc: p.abc, leadTime: effectiveLeadTime, leadTimeStd: lf.std, monthsToStock, seasonalityIdx, seasonalityReliable, nextMonIdx, effectiveStock, minStock, moq });
    const { suggestedOrder, suggestedOrderRaw, suggestedOrderFlat, safetyStock, projectedDemand, serviceLevel, seasonalApplied } = plan;
    const orderCost = suggestedOrder > 0 && unitCost ? suggestedOrder * unitCost : null;
    const orderCostOriginal = suggestedOrder > 0 && unitCostOriginal ? suggestedOrder * unitCostOriginal : null;
    const riskOf = (stock, covM) => stock <= 0 ? "critical" : covM < effectiveLeadTime ? "critical" : (minStock ? stock < minStock : covM < monthsToStock) ? "low" : "ok";
    const physicalRisk = currentStock !== null ? riskOf(currentStock, coverageMonths ?? (currentStock > 0 ? Infinity : 0)) : "unknown";
    const risk = currentStock !== null ? riskOf(effectiveStock, effectiveCoverMonths ?? (effectiveStock > 0 ? Infinity : 0)) : "unknown";
    const shortNowCoveredByPO = incomingQty > 0 && (physicalRisk === "critical" || physicalRisk === "low") && physicalRisk !== risk;
    const coverageRiskScore = { critical: 100, low: 60, ok: 12, unknown: 45 }[risk];
    const volatilityRiskScore = Math.min(100, Math.abs(trend || 0));
    const xyzRiskScore = { X: 10, Y: 50, Z: 100 }[xyz] ?? 50;
    const leadTimeRiskScore = Math.min(100, effectiveLeadTime / 3 * 100);
    const supplierRiskScore = supplier && supplierConcentration.totalAssigned > 0 ? Math.min(100, (supplierConcentration.counts[supplier] || 0) / supplierConcentration.totalAssigned * 100 * 3) : 0;
    const riskScore = Math.round(
      coverageRiskScore * 0.4 + volatilityRiskScore * 0.2 + xyzRiskScore * 0.15 + leadTimeRiskScore * 0.15 + supplierRiskScore * 0.1
    );
    const out = { ...p, key, avgMonthly, avgDataMonths, isLimitedData, windowMonths: allMonths.length, avgDaily, sparkline, trendSeries, trend, forecastNext, seasonalFactor, seasonalityReliable, seasonalityIdx, monthlyAvgs, cv, stdDev, xyz, abcXyz, safetyStock, serviceLevel, projectedDemand, seasonalApplied, suggestedOrderFlat, lifecycle, currentStock, unitCost, unitCostOriginal, costConverted, costCurrencyBlocked, priceChangePct, prevPrice, priceChangedAt, minStock, supplier, currency, moq, effectiveLeadTime, leadTimeOverridden, leadTimeSource, leadTimeStd: lf.std, nextMonIdx, coverageMonths, coverageDays, incomingQty, overdue, effectiveStock, effectiveCoverDays, effectiveCoverMonths, suggestedOrder, suggestedOrderRaw, orderCost, orderCostOriginal, risk, physicalRisk, shortNowCoveredByPO, riskScore };
    out.status = procStatus(out);
    out.statusRank = { now: 0, soon: 1, watch: 2, unknown: 3, ok: 4 }[out.status];
    out.chip = procChip(out);
    out.costFromPurchase = costFromPurchase;
    out.costFromAvg = costFromAvg;
    out.lastPurchase = lastP;
    out.family = ex?.fam || "";
    out.ownMade = ownMade;
    out.avgCostPriority = ex?.avgCost ?? null;
    out.listPrice = ex?.listPrice ?? null;
    out.lastSalePriority = ex?.lastSale || "";
    out.lastBuyPriority = ex?.lastBuy || "";
    out.stockout = so;
    out.skippedMonths = skippedMonths;
    out.lostQty = so && so.outDays && avgMonthly > 0 ? Math.round(so.outDays * avgMonthly / 30) : 0;
    out.avgPrice = p.totalQty > 0 ? p.totalRev / p.totalQty : null;
    const ol = outliers[p.sku] || outliers[key];
    out.outliers = ol || null;
    out.outlierPending = ol ? ol.lines.filter((l) => !outlierDecisions[l.id]).length : 0;
    out.outlierCapped = ol ? ol.lines.filter((l) => outlierDecisions[l.id] === "cap").length : 0;
    return out;
  });
};
var enrichOrders = ({ openOrders = [], currencyMap = {}, exchangeRates = {}, costMap = {} }) => openOrders.map((o) => {
  const currency = currencyMap[o.productKey] ?? currencyMap[o.productName] ?? null;
  const isForeign = currency && currency !== "ILS";
  const rate = !isForeign ? 1 : exchangeRates?.[currency] > 0 ? exchangeRates[currency] : null;
  const costUsable = o.value != null && rate != null;
  const valueILS = costUsable ? o.value * rate : null;
  const costCurrencyBlocked = o.value > 0 && isForeign && rate == null ? currency : null;
  const unitPriceOriginal = o.value > 0 && o.orderedQty > 0 ? o.value / o.orderedQty : null;
  const catalogCost = costMap[o.productKey] ?? costMap[o.productName] ?? null;
  const poPriceDiffPct = unitPriceOriginal != null && catalogCost > 0 ? (unitPriceOriginal - catalogCost) / catalogCost * 100 : null;
  const expectedDt = parseFlexDate(o.expectedDate);
  const today = startOfToday();
  const isOverdue = !!expectedDt && expectedDt < today && o.status !== "received";
  const daysLate = isOverdue ? Math.round((today - expectedDt) / DAY_MS) : 0;
  return { ...o, currency, valueILS, costCurrencyBlocked, costConverted: costUsable && isForeign ? currency : null, unitPriceOriginal, catalogCost, poPriceDiffPct, isOverdue, daysLate };
});
var overdueByProductOf = (ordersEnriched) => {
  const m = {};
  ordersEnriched.filter((o) => o.isOverdue).forEach((o) => {
    const k = o.productKey || o.productName;
    if (!m[k]) m[k] = { qty: 0, maxDays: 0 };
    m[k].qty += o.orderedQty || 0;
    m[k].maxDays = Math.max(m[k].maxDays, o.daysLate);
  });
  return m;
};
var incomingMapOf = (openOrders) => {
  const map = {};
  openOrders.filter((o) => o.status !== "received").forEach((o) => {
    const k = o.productKey || o.productName;
    map[k] = (map[k] || 0) + (o.orderedQty || 0);
  });
  return map;
};
var supplierConcentrationOf = (supplierMap) => {
  const counts = {};
  let totalAssigned = 0;
  Object.values(supplierMap).forEach((s) => {
    if (!s) return;
    counts[s] = (counts[s] || 0) + 1;
    totalAssigned++;
  });
  return { counts, totalAssigned };
};
var makeLeadFor = ({ leadStats = {}, leadTimeMap = {}, leadAddTransit = {}, leadTime }) => (sup) => {
  const st = sup ? leadStats[sup] : null;
  const computedDays = st && st.n >= 3 ? st.median + (leadAddTransit[sup] ? st.transit : 0) : null;
  const std = st && st.n >= 3 ? st.std / 30 : 0;
  if (sup && leadTimeMap[sup] != null) return { months: leadTimeMap[sup], source: "manual", std, computedDays, st };
  if (computedDays != null) return { months: Math.max(0.25, Math.round(computedDays / 30 * 10) / 10), source: "computed", std, computedDays, st };
  return { months: leadTime, source: "global", std: 0, computedDays: null, st };
};

// src/core/digest.js
var excessOf = (products, marginMonths = 3) => {
  const rows = [];
  products.forEach((p) => {
    if (!(p.avgMonthly > 0) || !(p.currentStock > 0)) return;
    const buffer = Math.max(p.safetyStock || 0, p.minStock || 0);
    const needed = (p.projectedDemand || 0) + buffer + p.avgMonthly * marginMonths;
    const total = p.currentStock + (p.incomingQty || 0);
    const excessQty = Math.floor(total - needed);
    if (excessQty <= 0) return;
    const onHandExcess = Math.min(excessQty, p.currentStock);
    const poExcess = Math.min(p.incomingQty || 0, excessQty);
    rows.push({
      ...p,
      excessQty,
      onHandExcess,
      poExcess,
      coverMonths: total / p.avgMonthly,
      excessValue: p.unitCost ? onHandExcess * p.unitCost : null,
      poExcessValue: p.unitCost ? poExcess * p.unitCost : null
    });
  });
  return rows.sort((a, b) => (b.excessValue || 0) - (a.excessValue || 0));
};
var trendingProducts = (lines, { now = Date.now(), products = [], names = {} } = {}) => {
  const iso2 = (ms) => new Date(ms).toISOString().slice(0, 10);
  const a0 = iso2(now - 29 * DAY_MS), b0 = iso2(now - 119 * DAY_MS);
  const by = {};
  lines.forEach((l) => {
    if (l.x || l.junk || !l.k || !(l.q > 0) || l.d < b0) return;
    const x = by[l.k] ||= { k: l.k, name: names[l.k] || l.n || l.k, q: 0, v: 0, pq: 0, pv: 0 };
    if (l.d >= a0) {
      x.q += l.q;
      x.v += l.v || 0;
    } else {
      x.pq += l.q;
      x.pv += l.v || 0;
    }
  });
  const prodBy = {};
  products.forEach((p) => {
    if (p.sku) prodBy[p.sku] = p;
  });
  const rows = Object.values(by).map((x) => {
    const prevQ = Math.round(x.pq / 3), prevV = x.pv / 3;
    const p = prodBy[x.k];
    const coverWeeks = p && p.currentStock != null && x.q > 0 ? Math.max(0, Math.round((p.currentStock + (p.incomingQty || 0)) / (x.q / 30) / 7)) : null;
    return { k: x.k, name: x.name, q: Math.round(x.q), prevQ, pct: prevQ ? (x.q / (x.pq / 3) - 1) * 100 : null, delta: x.v - prevV, coverWeeks };
  });
  const up = rows.filter((x) => x.q >= 5 && (x.pct == null || x.pct >= 40)).sort((a, b) => b.delta - a.delta);
  const down = rows.filter((x) => x.prevQ >= 5 && x.pct != null && x.pct <= -40).sort((a, b) => a.delta - b.delta);
  return { up, down };
};
var buildDigest = ({ app = {}, sets = {} }, { now = Date.now() } = {}) => {
  const iso2 = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = iso2(now);
  const salesLinesAll = sets.procSalesLines || [];
  const salesLines = salesLinesAll.filter((l) => !l.x);
  const purchaseLines = sets.procPurchaseLines || [];
  const shipments = sets.procShipments || [];
  const stockMap = app.procurementStock || {};
  const supplierMap = app.procurementSupplier || {};
  const costMap = app.procurementCost || {}, currencyMap = app.procurementCurrency || {};
  const exchangeRates = app.exchangeRates || {};
  const openOrders = app.openOrders || [];
  const shipSupOverride = app.procShipSupplierMap || {};
  const outliers = detectOutliers(salesLines, { sinceIso: iso2(now - 365 * DAY_MS) });
  const decisions = app.procOutlierDecisions || {};
  const caps = {};
  Object.values(outliers).forEach((o) => o.lines.forEach((l) => {
    if (decisions[l.id] === "cap") caps[l.id] = l.cap;
  }));
  const linesForPlan = Object.keys(caps).length ? salesLines.map((l) => {
    const c = caps[saleLineId(l)];
    return c != null ? { ...l, q: c } : l;
  }) : salesLines;
  const salesData = mergeLinesIntoMonthly(sets.dashboardSalesData || [], linesForPlan);
  const from = iso2(now - 364 * DAY_MS);
  const skus = [...new Set(salesLines.filter((l) => l.d >= from).map((l) => l.k))].filter((k) => k && stockMap[k] != null);
  const stockouts = stockoutSummary(stockTimelines({ stockHistory: sets.stockHistory, currentStock: stockMap, salesLines, purchaseLines, skus, fromIso: from, toIso: today, startBy: productStartDates({ itemsExtra: sets.procItemsExtra || {}, purchaseLines }) }));
  const knownSuppliers = [.../* @__PURE__ */ new Set([...purchaseLines.map((l) => l.s), ...Object.values(supplierMap).filter(Boolean), ...openOrders.map((o) => o.supplier).filter(Boolean)])];
  const supOf = (s) => shipSupOverride[s.sup] === "" ? null : shipSupOverride[s.sup] ?? matchShipSupplier(s.sup, knownSuppliers);
  const transitBySupplier = {};
  shipments.forEach((s) => {
    const sup = supOf(s);
    if (sup && s.dep && s.arr) {
      const d = daysBetween(s.dep, s.arr);
      if (d > 0 && d < 120) (transitBySupplier[sup] ||= []).push(d);
    }
  });
  const leadStats = supplierLeadTimes({ purchaseLines, poMeta: sets.procPoMeta || {}, transitBySupplier, sinceIso: iso2(now - 540 * DAY_MS) });
  const leadFor = makeLeadFor({ leadStats, leadTimeMap: app.procurementLeadTime || {}, leadAddTransit: app.procLeadAddTransit || {}, leadTime: app.procDefaultLeadTime != null && Number.isFinite(Number(app.procDefaultLeadTime)) ? Number(app.procDefaultLeadTime) : 1 });
  const ordersEnriched = enrichOrders({ openOrders, currencyMap, exchangeRates, costMap });
  const purchBySku = {}, lastSupBySku = {};
  purchaseLines.forEach((l) => {
    if (l.junk) return;
    (purchBySku[l.k] ||= []).push(l);
    if (!lastSupBySku[l.k]) lastSupBySku[l.k] = l;
  });
  const products = computeProducts({
    salesData,
    excludeCurrentMonth: app.excludeCurrentMonth !== false,
    avgWindowMonths: Number.isFinite(Number(app.procAvgWindow)) && app.procAvgWindow != null ? Number(app.procAvgWindow) : 12,
    stockouts,
    skipStockoutMonths: app.procSkipStockoutMonths !== "0" && app.procSkipStockoutMonths !== 0,
    stockMap,
    minStockMap: app.procurementMinStock || {},
    lastSupBySku,
    supplierMap,
    costMap,
    itemsExtra: sets.procItemsExtra || {},
    currencyMap,
    exchangeRates,
    costHistory: app.procurementCostHistory || {},
    purchBySku,
    leadFor,
    incomingMap: incomingMapOf(openOrders),
    overdueByProduct: overdueByProductOf(ordersEnriched),
    moqMap: app.procurementMOQ || {},
    monthsToStock: Number(app.procMonthsToStock) || 2,
    supplierConcentration: supplierConcentrationOf(supplierMap),
    outliers,
    outlierDecisions: decisions
  });
  const bySup = {};
  products.filter((p) => p.suggestedOrder > 0 && !p.ownMade).forEach((p) => {
    const s = bySup[p.supplier || "\u05E1\u05E4\u05E7 \u05DC\u05D0 \u05D9\u05D3\u05D5\u05E2"] ||= { name: p.supplier || "\u05E1\u05E4\u05E7 \u05DC\u05D0 \u05D9\u05D3\u05D5\u05E2", n: 0, now: 0, value: 0, lead: p.effectiveLeadTime };
    s.n++;
    if (p.status === "now") s.now++;
    s.value += p.orderCost || 0;
  });
  const toOrder = Object.values(bySup).sort((a, b) => b.now - a.now || b.value - a.value);
  const latePOs = ordersEnriched.filter((o) => o.isOverdue).sort((a, b) => b.daysLate - a.daysLate);
  const lateBySup = {};
  latePOs.forEach((o) => {
    const s = lateBySup[o.supplier || "\u2014"] ||= { name: o.supplier || "\u2014", lines: 0, maxDays: 0, pos: /* @__PURE__ */ new Set() };
    s.lines++;
    s.maxDays = Math.max(s.maxDays, o.daysLate);
    if (o.poNumber) s.pos.add(o.poNumber);
  });
  const delayed = shipments.map((s) => ({ ...s, stage: shipmentStage(s, today), delayDays: s.change ? Math.round(daysBetween(s.change.from, s.change.to)) : 0 })).filter((s) => s.stage.idx < 2 && s.delayDays > 0).sort((a, b) => b.delayDays - a.delayDays);
  const hist = purchasePriceHistory(purchaseLines);
  const names = app.procurementNames || {};
  const priceUps = priceIncreases(hist, { sinceIso: iso2(now - 7 * DAY_MS) }).map((x) => ({ ...x, name: names[x.k] || hist[x.k]?.[0]?.n || x.k }));
  const excess = excessOf(products, 3);
  const excessValue = excess.reduce((a, p) => a + (p.excessValue || 0), 0);
  const excessPOs = excess.filter((p) => p.poExcess > 0);
  const sum = (a, b) => salesLinesAll.filter((l) => l.d >= a && l.d <= b && l.v > 0).reduce((s, l) => s + l.v, 0);
  const w0 = iso2(now - 6 * DAY_MS), ly0 = iso2(now - (365 + 6) * DAY_MS), ly1 = iso2(now - 365 * DAY_MS);
  const week = { v: sum(w0, today), lastYear: sum(ly0, ly1), from: w0, to: today };
  const productMoves = trendingProducts(salesLinesAll, { now, products, names: app.procurementNames || {} });
  const ret = returnsAnalysis(salesLinesAll, { fromIso: iso2(now - 30 * DAY_MS), toIso: today });
  const returnSpikes = ret.products.filter((p) => p.rate != null && p.rate >= 10 && p.retQ >= 3).slice(0, 8);
  return {
    generatedAt: now,
    today,
    syncAt: app.prioritySyncAt ? Number(app.prioritySyncAt) : null,
    toOrder,
    toOrderTotal: toOrder.reduce((a, s) => a + s.value, 0),
    toOrderNow: products.filter((p) => p.status === "now" && !p.ownMade).length,
    toMake: products.filter((p) => p.ownMade && p.suggestedOrder > 0).length,
    toMakeNow: products.filter((p) => p.ownMade && p.status === "now").length,
    latePOs: Object.values(lateBySup).map((s) => ({ ...s, pos: [...s.pos] })).sort((a, b) => b.maxDays - a.maxDays),
    latePOLines: latePOs.length,
    delayed: delayed.slice(0, 10).map((s) => ({ cont: s.cont, sup: s.sup, arr: s.arr, from: s.change?.from, delayDays: s.delayDays })),
    priceUps: priceUps.slice(0, 15),
    excessValue,
    excessPOs: excessPOs.slice(0, 10).map((p) => ({ name: p.name, sku: p.sku, supplier: p.supplier, poExcess: p.poExcess, value: p.poExcessValue })),
    excessPOCount: excessPOs.length,
    alertSource: {
      stock: products.filter((p) => p.status === "now" && /^[AB]/.test(p.abc || "") && p.avgMonthly > 0).map((p) => ({
        k: p.sku || p.key,
        name: p.name,
        supplier: p.supplier || "",
        ownMade: !!p.ownMade,
        stock: p.currentStock,
        incoming: p.incomingQty || 0,
        coverDays: p.effectiveCoverDays != null ? Math.round(p.effectiveCoverDays) : null,
        leadMonths: p.effectiveLeadTime,
        qty: p.suggestedOrder,
        abc: p.abc
      })),
      ships: delayed.map((s) => ({ id: s.id, cont: s.cont, sup: s.sup, arr: s.arr, from: s.change?.from, delayDays: s.delayDays }))
    },
    week,
    productsUp: productMoves.up.slice(0, 10),
    productsDown: productMoves.down.slice(0, 6),
    returnSpikes
  };
};
var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
var ils = (v) => "\u20AA" + Math.round(v || 0).toLocaleString("en-US");
var pctS = (v) => `<span dir="ltr">${v > 0 ? "+" : ""}${v.toFixed(0)}%</span>`;
var renderDigestHtml = (d, { siteUrl }) => {
  const sec = (title, inner, link) => `<tr><td style="padding:18px 22px;border-top:1px solid #e2e8f0">
    <h2 style="margin:0 0 10px;font-size:16px;color:#0f172a">${esc(title)}</h2>${inner}
    ${link ? `<p style="margin:10px 0 0"><a href="${esc(link)}" style="color:#1F5FBF;font-size:13px">\u05E4\u05EA\u05D7 \u05D1\u05D0\u05EA\u05E8 \u2190</a></p>` : ""}</td></tr>`;
  const table = (head, rows) => rows.length ? `<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
    <tr style="background:#f1f5f9;color:#475569">${head.map((h) => `<th align="right" style="font-weight:600">${esc(h)}</th>`).join("")}</tr>
    ${rows.map((r) => `<tr>${r.map((c) => `<td align="right" style="border-bottom:1px solid #f1f5f9">${c}</td>`).join("")}</tr>`).join("")}</table>` : '<p style="margin:0;color:#64748b;font-size:13px">\u05D0\u05D9\u05DF</p>';
  const p = (t) => `<p style="margin:0 0 8px;font-size:14px;color:#334155">${t}</p>`;
  const proc = `${siteUrl}`;
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden" dir="rtl">
    <tr><td style="background:#0f172a;color:#fff;padding:18px 22px"><div style="font-size:18px;font-weight:bold">\u05E1\u05D9\u05DB\u05D5\u05DD \u05E9\u05D1\u05D5\u05E2\u05D9 \u2014 \u05E8\u05DB\u05E9 \u05D5\u05DE\u05DB\u05D9\u05E8\u05D5\u05EA</div>
      <div style="font-size:12px;opacity:.75;margin-top:4px">${esc(isoToDisplay(d.today))}${d.syncAt ? ` \xB7 \u05E0\u05EA\u05D5\u05E0\u05D9 Priority \u05DE-${esc(new Date(d.syncAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}` : ""}</div></td></tr>
    ${sec("\u05DE\u05D4 \u05DC\u05D4\u05D6\u05DE\u05D9\u05DF \u05D4\u05E9\u05D1\u05D5\u05E2", p(`<b>${d.toOrderNow}</b> \u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05DC\u05D4\u05D6\u05DE\u05D9\u05DF \u05E2\u05DB\u05E9\u05D9\u05D5 \xB7 \u05E9\u05D5\u05D5\u05D9 \u05DE\u05E9\u05D5\u05E2\u05E8 \u05E9\u05DC \u05DB\u05DC \u05D4\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA <b>${ils(d.toOrderTotal)}</b>`) + (d.toMake ? p(`\u05D9\u05D9\u05E6\u05D5\u05E8 \u05E2\u05E6\u05DE\u05D9: <b>${d.toMake}</b> \u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05DC\u05D9\u05D9\u05E6\u05E8${d.toMakeNow ? ` (\u05DE\u05D4\u05DD <b style="color:#C8322B">${d.toMakeNow}</b> \u05D3\u05D7\u05D5\u05E4\u05D9\u05DD)` : ""}`) : "") + table(["\u05E1\u05E4\u05E7", "\u05DE\u05D5\u05E6\u05E8\u05D9\u05DD", "\u05D3\u05D7\u05D5\u05E3", "\u05E9\u05D5\u05D5\u05D9 \u05DE\u05E9\u05D5\u05E2\u05E8", "\u05D6\u05DE\u05DF \u05D0\u05E1\u05E4\u05E7\u05D4"], d.toOrder.slice(0, 12).map((s) => [esc(s.name), s.n, s.now ? `<b style="color:#C8322B">${s.now}</b>` : "\u2014", s.value ? ils(s.value) : "\u2014", `${s.lead} \u05D7\u05F3`])), proc)}
    ${sec("\u05DE\u05D4 \u05D1\u05D3\u05E8\u05DA \u2014 \u05D1\u05D0\u05D9\u05D7\u05D5\u05E8 \u05D5\u05E0\u05D3\u05D7\u05D4", p(`\u05D4\u05D6\u05DE\u05E0\u05D5\u05EA \u05E8\u05DB\u05E9 \u05D1\u05D0\u05D9\u05D7\u05D5\u05E8: <b>${d.latePOLines}</b> \u05E9\u05D5\u05E8\u05D5\u05EA`) + table(["\u05E1\u05E4\u05E7", "\u05E9\u05D5\u05E8\u05D5\u05EA", "\u05D0\u05D9\u05D7\u05D5\u05E8 \u05DE\u05E8\u05D1\u05D9", "\u05D4\u05D6\u05DE\u05E0\u05D5\u05EA"], d.latePOs.slice(0, 8).map((s) => [esc(s.name), s.lines, `${s.maxDays} \u05D9\u05DE\u05D9\u05DD`, esc(s.pos.slice(0, 4).join(", "))])) + (d.delayed.length ? '<div style="height:10px"></div>' + table(["\u05DE\u05DB\u05D5\u05DC\u05D4", "\u05E1\u05E4\u05E7", "\u05D4\u05D2\u05E2\u05D4", "\u05E0\u05D3\u05D7\u05D4"], d.delayed.map((s) => [esc(s.cont || "\u2014"), esc(s.sup), esc(isoToDisplay(s.arr)), `${s.delayDays} \u05D9\u05DE\u05D9\u05DD (\u05D4\u05D9\u05D4 ${esc(isoToDisplay(s.from))})`])) : ""), proc)}
    ${sec("\u05D4\u05EA\u05D9\u05D9\u05E7\u05E8\u05D5\u05D9\u05D5\u05EA \u05D1\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05E1\u05E4\u05E7 \u05D4\u05E9\u05D1\u05D5\u05E2", table(["\u05DE\u05D5\u05E6\u05E8", "\u05E1\u05E4\u05E7", "\u05E7\u05D5\u05D3\u05DD", "\u05E2\u05DB\u05E9\u05D9\u05D5", "\u05E9\u05D9\u05E0\u05D5\u05D9"], d.priceUps.map((x) => [esc(x.name), esc(x.s), `${x.prevP} ${esc(x.cur)}`, `<b>${x.p} ${esc(x.cur)}</b>`, `<b style="color:#C8322B">${pctS(x.pct)}</b>`])), proc)}
    ${sec("\u05DE\u05DC\u05D0\u05D9 \u05E2\u05D5\u05D3\u05E3", p(`\u05DB\u05E1\u05E3 \u05E9\u05D9\u05D5\u05E9\u05D1 \u05D1\u05DE\u05DC\u05D0\u05D9 \u05E2\u05D5\u05D3\u05E3: <b>${ils(d.excessValue)}</b> \xB7 \u05D4\u05D6\u05DE\u05E0\u05D5\u05EA \u05E4\u05EA\u05D5\u05D7\u05D5\u05EA \u05E2\u05DC \u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05D1\u05E2\u05D5\u05D3\u05E3: <b>${d.excessPOCount}</b>`) + table(["\u05DE\u05D5\u05E6\u05E8", "\u05E1\u05E4\u05E7", "\u05D1\u05D4\u05D6\u05DE\u05E0\u05D4 \u05DE\u05D9\u05D5\u05EA\u05E8\u05EA", "\u05E9\u05D5\u05D5\u05D9"], d.excessPOs.map((x) => [esc(x.name), esc(x.supplier || "\u2014"), `${x.poExcess} \u05D9\u05D7\u05F3`, x.value ? ils(x.value) : "\u2014"])), proc)}
    ${sec("\u05DE\u05DB\u05D9\u05E8\u05D5\u05EA", p(`7 \u05D4\u05D9\u05DE\u05D9\u05DD \u05D4\u05D0\u05D7\u05E8\u05D5\u05E0\u05D9\u05DD: <b>${ils(d.week.v)}</b>${d.week.lastYear ? ` \xB7 \u05D0\u05D5\u05EA\u05D5 \u05E9\u05D1\u05D5\u05E2 \u05D0\u05E9\u05EA\u05E7\u05D3 ${ils(d.week.lastYear)} (<b>${pctS((d.week.v / d.week.lastYear - 1) * 100)}</b>)` : ""}`) + ((d.productsUp || []).length ? '<div style="height:6px"></div>' + p("<b>\u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05D1\u05E2\u05DC\u05D9\u05D9\u05D4</b> \u2014 30 \u05D4\u05D9\u05DE\u05D9\u05DD \u05D4\u05D0\u05D7\u05E8\u05D5\u05E0\u05D9\u05DD \u05DE\u05D5\u05DC \u05D4\u05E7\u05E6\u05D1 \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9 \u05D1-3 \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9\u05DD \u05E9\u05DC\u05E4\u05E0\u05D9\u05D4\u05DD") + table(["\u05DE\u05D5\u05E6\u05E8", "30 \u05D9\u05D5\u05DD", "\u05E7\u05E6\u05D1 \u05E7\u05D5\u05D3\u05DD \u05DC\u05D7\u05D5\u05D3\u05E9", "\u05E9\u05D9\u05E0\u05D5\u05D9", "\u05DE\u05DC\u05D0\u05D9 \u05DE\u05E1\u05E4\u05D9\u05E7 \u05DC"], d.productsUp.map((x) => [`${esc(x.name)}<br><span style="color:#94a3b8;font-size:11px">${esc(x.k)}</span>`, x.q.toLocaleString("en-US"), x.prevQ ? x.prevQ.toLocaleString("en-US") : "\u05D7\u05D3\u05E9", x.prevQ ? `<b style="color:#2E8B57">${pctS(x.pct)}</b>` : "\u2014", x.coverWeeks == null ? "\u2014" : x.coverWeeks < 4 ? `<b style="color:#C8322B">${x.coverWeeks} \u05E9\u05D1\u05D5\u05E2\u05D5\u05EA</b>` : `${x.coverWeeks} \u05E9\u05D1\u05D5\u05E2\u05D5\u05EA`])) : "") + ((d.productsDown || []).length ? '<div style="height:10px"></div>' + p("<b>\u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05D1\u05D9\u05E8\u05D9\u05D3\u05D4</b>") + table(["\u05DE\u05D5\u05E6\u05E8", "30 \u05D9\u05D5\u05DD", "\u05E7\u05E6\u05D1 \u05E7\u05D5\u05D3\u05DD \u05DC\u05D7\u05D5\u05D3\u05E9", "\u05E9\u05D9\u05E0\u05D5\u05D9"], d.productsDown.map((x) => [`${esc(x.name)}<br><span style="color:#94a3b8;font-size:11px">${esc(x.k)}</span>`, x.q.toLocaleString("en-US"), x.prevQ.toLocaleString("en-US"), `<b style="color:#C8322B">${pctS(x.pct)}</b>`])) : "") + (d.returnSpikes.length ? '<div style="height:6px"></div>' + p("<b>\u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05E2\u05DD \u05D4\u05E8\u05D1\u05D4 \u05D4\u05D7\u05D6\u05E8\u05D5\u05EA \u05D1-30 \u05D4\u05D9\u05DE\u05D9\u05DD \u05D4\u05D0\u05D7\u05E8\u05D5\u05E0\u05D9\u05DD:</b>") + table(["\u05DE\u05D5\u05E6\u05E8", "\u05E0\u05DE\u05DB\u05E8\u05D5", "\u05D7\u05D6\u05E8\u05D5", "\u05D0\u05D7\u05D5\u05D6"], d.returnSpikes.map((x) => [esc(x.n), x.soldQ, x.retQ, `<b style="color:#C8322B">${x.rate.toFixed(0)}%</b>`])) : ""), proc)}
    <tr><td style="padding:14px 22px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">\u05E0\u05E9\u05DC\u05D7 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u05DB\u05DC \u05D9\u05D5\u05DD \u05E8\u05D0\u05E9\u05D5\u05DF \u05DE\u05D4\u05D0\u05EA\u05E8 BizData \xB7 \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05DE-Priority (\u05E7\u05E8\u05D9\u05D0\u05D4 \u05D1\u05DC\u05D1\u05D3)</td></tr>
  </table></td></tr></table></body></html>`;
};
var pickAlerts = (d, sent = {}, { now = Date.now(), repeatDays = 14 } = {}) => {
  const fresh = (key) => !sent[key] || now - Date.parse(sent[key]) > repeatDays * 864e5;
  const stock = (d.alertSource?.stock || []).filter((x) => fresh(`stock:${x.k}`)).sort((x, y) => String(x.abc).localeCompare(String(y.abc)) || (x.coverDays ?? 999) - (y.coverDays ?? 999));
  const ships = (d.alertSource?.ships || []).filter((x) => !sent[`ship:${x.id}:${x.arr}`]);
  return { stock, ships, keys: [...stock.map((x) => `stock:${x.k}`), ...ships.map((x) => `ship:${x.id}:${x.arr}`)] };
};
var renderAlertsHtml = (a, { siteUrl }) => {
  const row = (cells) => `<tr>${cells.map((c) => `<td align="right" style="padding:6px;border-bottom:1px solid #f1f5f9;font-size:13px">${c}</td>`).join("")}</tr>`;
  const head = (cells) => `<tr style="background:#f1f5f9;color:#475569">${cells.map((c) => `<th align="right" style="padding:6px;font-size:12px;font-weight:600">${esc(c)}</th>`).join("")}</tr>`;
  const stockRows = a.stock.slice(0, 25).map((x) => row([
    `<b>${esc(x.name)}</b><br><span style="color:#94a3b8;font-size:11px">${esc(x.k)} \xB7 ${esc(x.ownMade ? "\u05D9\u05D9\u05E6\u05D5\u05E8 \u05E2\u05E6\u05DE\u05D9" : x.supplier || "\u05E1\u05E4\u05E7 \u05DC\u05D0 \u05D9\u05D3\u05D5\u05E2")}</span>`,
    x.stock ?? "\u2014",
    x.incoming || "\u2014",
    x.coverDays == null ? "\u2014" : `<b style="color:#C8322B">${x.coverDays} \u05D9\u05DE\u05D9\u05DD</b>`,
    `${x.leadMonths} \u05D7\u05F3`,
    `<b>${(x.qty || 0).toLocaleString("en-US")}</b> ${x.ownMade ? "\u05DC\u05D9\u05D9\u05E6\u05E8" : "\u05DC\u05D4\u05D6\u05DE\u05D9\u05DF"}`
  ]));
  const shipRows = a.ships.map((x) => row([esc(x.cont || "\u2014"), esc(x.sup), esc(isoToDisplay(x.from || "")), `<b>${esc(isoToDisplay(x.arr || ""))}</b>`, `<b style="color:#C8322B">+${x.delayDays} \u05D9\u05DE\u05D9\u05DD</b>`]));
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 8px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden" dir="rtl">
  <tr><td style="background:#C8322B;color:#fff;padding:14px 18px;font-size:17px;font-weight:bold">\u05D4\u05EA\u05E8\u05D0\u05D4 \u2014 \u05D3\u05D5\u05E8\u05E9 \u05D8\u05D9\u05E4\u05D5\u05DC \u05E2\u05DB\u05E9\u05D9\u05D5</td></tr>
  ${a.stock.length ? `<tr><td style="padding:14px 18px"><h2 style="margin:0 0 8px;font-size:15px;color:#0f172a">\u05DE\u05D5\u05E6\u05E8\u05D9\u05DD \u05DE\u05E8\u05DB\u05D6\u05D9\u05D9\u05DD \u05E9\u05E2\u05D5\u05DE\u05D3\u05D9\u05DD \u05DC\u05D4\u05D9\u05D2\u05DE\u05E8 (${a.stock.length})</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#475569">\u05D4\u05DE\u05DC\u05D0\u05D9 + \u05DE\u05D4 \u05E9\u05D1\u05D3\u05E8\u05DA \u05DC\u05D0 \u05D9\u05D7\u05D6\u05D9\u05E7 \u05E2\u05D3 \u05E9\u05D4\u05D6\u05DE\u05E0\u05D4 \u05D7\u05D3\u05E9\u05D4 \u05EA\u05D2\u05D9\u05E2.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${head(["\u05DE\u05D5\u05E6\u05E8", "\u05DE\u05DC\u05D0\u05D9", "\u05D1\u05D3\u05E8\u05DA", "\u05DE\u05E1\u05E4\u05D9\u05E7 \u05DC", "\u05D6\u05DE\u05DF \u05D0\u05E1\u05E4\u05E7\u05D4", "\u05DE\u05D5\u05DE\u05DC\u05E5"])}${stockRows.join("")}</table>${a.stock.length > 25 ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">\u05D5\u05E2\u05D5\u05D3 ${a.stock.length - 25} \u2014 \u05D4\u05E8\u05E9\u05D9\u05DE\u05D4 \u05D4\u05DE\u05DC\u05D0\u05D4 \u05D1\u05D0\u05EA\u05E8</p>` : ""}</td></tr>` : ""}
  ${a.ships.length ? `<tr><td style="padding:14px 18px;border-top:1px solid #e2e8f0"><h2 style="margin:0 0 8px;font-size:15px;color:#0f172a">\u05DE\u05E9\u05DC\u05D5\u05D7\u05D9\u05DD \u05E9\u05E0\u05D3\u05D7\u05D5 (${a.ships.length})</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${head(["\u05DE\u05DB\u05D5\u05DC\u05D4", "\u05E1\u05E4\u05E7", "\u05D4\u05D9\u05D4", "\u05E2\u05DB\u05E9\u05D9\u05D5", "\u05D3\u05D7\u05D9\u05D9\u05D4"])}${shipRows.join("")}</table></td></tr>` : ""}
  <tr><td style="padding:12px 18px;border-top:1px solid #e2e8f0"><a href="${esc(siteUrl)}" style="color:#1F5FBF;font-size:13px">\u05E4\u05EA\u05D7 \u05D1\u05D0\u05EA\u05E8 \u2190</a>
    <span style="color:#94a3b8;font-size:11px"> \xB7 \u05DB\u05DC \u05E4\u05E8\u05D9\u05D8 \u05E0\u05E9\u05DC\u05D7 \u05E4\u05E2\u05DD \u05D0\u05D7\u05EA (\u05DE\u05D5\u05E6\u05E8 \u2014 \u05E9\u05D5\u05D1 \u05E8\u05E7 \u05D0\u05D7\u05E8\u05D9 \u05E9\u05D1\u05D5\u05E2\u05D9\u05D9\u05DD \u05D0\u05DD \u05E2\u05D3\u05D9\u05D9\u05DF \u05D7\u05E1\u05E8)</span></td></tr>
  </table></td></tr></table></body></html>`;
};
export {
  FULL_MONTHS,
  MissingFieldError,
  OVERLAP_DAYS,
  PURCH_HEADERS,
  SALES_FORMS,
  SALES_HEADERS,
  SYNC_FORMS,
  SYNC_MONTH_OPTIONS,
  buildDigest,
  describeFromMetadata,
  finalizeSync,
  isoDaysAgo,
  monthWindows,
  pickAlerts,
  planSteps,
  renderAlertsHtml,
  renderDigestHtml,
  runStep,
  syncMonthsOf
};
