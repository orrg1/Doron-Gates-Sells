// GENERATED from src/core — do not edit here; run scripts/copy-core.sh

// src/core/data.js
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
  const colStatus = headers.indexOf("\u05E1\u05D8\u05D8\u05D5\u05E1 \u05D4\u05D6\u05DE\u05E0\u05D4");
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
var DAY_MS = 24 * 60 * 60 * 1e3;
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
  const vanished = prevOrders.filter((o) => o.fromPriority && o.poNumber && !newIds.has(idOf(o)));
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

// src/core/priorityPull.js
var SYNC_FORMS = ["LOGPART", "PORDERS", "AINVOICES", "CINVOICES", "EINVOICES", "YINVOICES", "CUSTOMERS"];
var SALES_FORMS = ["AINVOICES", "CINVOICES", "EINVOICES"];
var OPTIONAL_SALES = { CINVOICES: "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05E8\u05DB\u05D6\u05D5\u05EA", EINVOICES: "\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05E1 \u05E7\u05D1\u05DC\u05D4" };
var FULL_MONTHS = 24;
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
  return { created: iso(r[s.date]), sent: sentEntry ? iso(sentEntry.UDATE) : "", status: s.st ? r[s.st] || "" : "", sup: s.sup ? r[s.sup] || "" : "" };
};
async function pullOpenPOs(forms, query) {
  const s = poShape(forms);
  const filter = s.st ? `${s.st} ne '\u05E1\u05D2\u05D5\u05E8\u05D4' and ${s.st} ne '\u05DE\u05D1\u05D5\u05D8\u05DC\u05EA'` : "";
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
    expand: s.log ? `${s.log}($select=UDATE,STATDES)` : ""
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
var planSteps = ({ since = {}, poFull = false, now = Date.now() }) => {
  const full = isoDaysAgo(Math.round(FULL_MONTHS * 30.5), now);
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
function finalizeSync({ prev, payloads, failed = {}, since = {}, sSince, pSince, now = Date.now() }) {
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
      (hist.days || []).forEach((day) => Object.assign(last, day.s));
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
    log.push(`\u05D7\u05E9\u05D1\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05DB\u05D9\u05E8\u05D4: ${parsed.length.toLocaleString()} \u05E9\u05D5\u05E8\u05D5\u05EA ${since.salesLines ? "\u05D7\u05D3\u05E9\u05D5\u05EA/\u05DE\u05E2\u05D5\u05D3\u05DB\u05E0\u05D5\u05EA" : "(24 \u05D7\u05D5\u05D3\u05E9\u05D9\u05DD)"}`);
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
export {
  FULL_MONTHS,
  MissingFieldError,
  OVERLAP_DAYS,
  PURCH_HEADERS,
  SALES_FORMS,
  SALES_HEADERS,
  SYNC_FORMS,
  describeFromMetadata,
  finalizeSync,
  isoDaysAgo,
  monthWindows,
  planSteps,
  runStep
};
