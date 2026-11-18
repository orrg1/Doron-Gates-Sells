// ─── Two warehouses, one Priority stock ───────────────────────────────────────
// Priority keeps one stock number per item (all warehouses together). The site keeps how much of it
// sits in the second warehouse (גדיש); the main warehouse (מגדל העמק) = Priority total − גדיש.
// So only the moves between the warehouses are typed in — every sale / receipt in Priority is
// automatically "in the main warehouse". Nothing here is sent to Priority.

export const GADISH_KEY = 'whGadish';        // { sku: qty }
export const GADISH_LOG_KEY = 'whGadishLog'; // [{ at, by, k, n, d, set?, note? }] newest first
export const GADISH_DAYS_KEY = 'whGadishDays'; // bring from גדיש when the main warehouse has < N days of sales
export const GADISH_BRING_KEY = 'whGadishBring'; // the server's latest "bring" list (for people who can't see sales)
export const MAIN_WH = 'מגדל העמק', SECOND_WH = 'גדיש';
export const LOG_MAX = 3000;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// apply one move: kind 'in' (moved to גדיש) | 'out' (brought back to the main warehouse) | 'set' (counted)
export const applyGadishMove = (gadish = {}, log = [], { k, n = '', kind, qty, note = '', by = '', at = Date.now() }) => {
  const before = Number(gadish[k]) || 0;
  const q = Math.abs(Number(qty) || 0);
  const after = kind === 'set' ? r2(qty) : kind === 'in' ? r2(before + q) : r2(Math.max(0, before - q));
  const next = { ...gadish };
  if (after > 0) next[k] = after; else delete next[k];
  const entry = { at, by, k, n, kind, d: r2(after - before), ...(kind === 'set' ? { set: after } : {}), ...(note ? { note: String(note).slice(0, 200) } : {}) };
  return { gadish: next, log: [entry, ...(log || [])].slice(0, LOG_MAX), entry };
};

// average units sold per day, last `days` days (returns subtract)
export const avgDailyBySku = (lines = [], { now = Date.now(), days = 180 } = {}) => {
  const from = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const q = {};
  lines.forEach(l => { if (!l.x && l.k && l.d >= from) q[l.k] = (q[l.k] || 0) + (l.q || 0); });
  const out = {}; Object.entries(q).forEach(([k, v]) => { if (v > 0) out[k] = v / days; });
  return out;
};

// What to bring from גדיש: the main warehouse has less than `days` days of sales and גדיש has some.
// Bring enough for `targetDays` (default 2 × days), never more than what is in גדיש.
export const gadishBringList = ({ gadish = {}, stock = {}, names = {}, avgDaily = {}, days = 14, targetDays } = {}) => {
  const target = targetDays || Math.max(30, days * 2);
  return Object.entries(gadish).map(([k, g]) => {
    const total = stock[k]; if (total == null || !(g > 0)) return null;
    const main = total - g, perDay = avgDaily[k] || 0;
    if (perDay <= 0) return main <= 0 ? { k, n: names[k] || '', total, gadish: g, main, perDay: 0, coverDays: 0, qty: Math.min(g, 1) } : null;
    const coverDays = Math.max(0, main) / perDay;
    if (coverDays >= days) return null;
    const qty = Math.min(g, Math.max(1, Math.ceil(target * perDay - Math.max(0, main))));
    return { k, n: names[k] || '', total, gadish: g, main, perDay: Math.round(perDay * 100) / 100, coverDays: Math.round(coverDays), qty };
  }).filter(Boolean).sort((a, b) => a.coverDays - b.coverDays);
};
