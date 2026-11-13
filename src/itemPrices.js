// ─── Selling prices of one item, live from Priority (read only) ──────────────
// Through the read-only proxy (Edge Function "priority"): the item card's base prices and the
// sub-form "פריט במחירוני לקוח" (PARTINCUSTPLISTS_SUBFORM) + special prices per customer
// (LOGPARTCUST_SUBFORM). Which customers sit on which price list comes from the customer cards
// (CUSTPLIST_SUBFORM) — one bigger query, kept for a day.
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

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const q = (s) => String(s).replace(/'/g, "''");
// "מאושר" / empty → approved; "לא מאושר", "טיוטה", "מבוטל" … → not
export const isApprovedStatus = (s) => { const t = String(s || '').trim(); return !t || (/מאושר|approved|פעיל/i.test(t) && !/לא|not|un/i.test(t)); };

const cache = new Map(); // sku → { at, data }
export const fetchItemPrices = async (sku, { force = false } = {}) => {
  const c = cache.get(sku);
  if (!force && c && Date.now() - c.at < 10 * 60000) return c.data;
  const base = { action: 'query', form: 'LOGPART', filter: `PARTNAME eq '${q(sku)}'`, expand: 'PARTINCUSTPLISTS_SUBFORM,LOGPARTCUST_SUBFORM', maxRows: 1 };
  let r;
  try { r = await call({ ...base, select: 'PARTNAME,PARTDES,PRICE,CODE,BASEPLPRICE,BASEPLCODE,WSPLPRICE,WSPLCODE,MINPRICE,MINCODE,VATPRICE' }); }
  catch { r = await call(base); } // a field this Priority does not open → the whole card
  const it = r?.value?.[0];
  if (!it) throw new Error('הפריט לא נמצא בפריוריטי');
  const lists = (it.PARTINCUSTPLISTS_SUBFORM || []).map(x => ({
    pl: x.PLNAME || '', name: x.PLDES || x.PLNAME || '', status: x.STATDES || '', approved: isApprovedStatus(x.STATDES),
    price: num(x.PRICE), discount: num(x.PERCENT), net: num(x.DPRICE), withVat: num(x.DVATPRICE ?? x.VATPRICE), cur: x.CODE || '',
    qty: num(x.QUANT), unit: x.UNITNAME || '', date: String(x.PLDATE || x.UDATE || '').slice(0, 10),
  })).sort((a, b) => (b.approved - a.approved) || String(a.name).localeCompare(String(b.name), 'he') || (a.qty || 0) - (b.qty || 0));
  const custPrices = (it.LOGPARTCUST_SUBFORM || []).map(x => ({
    cust: x.CUSTNAME || '', name: x.CUSTDES || x.CUSTNAME || '', price: num(x.PARTPRICE ?? x.PRICE), cur: x.CODE1 || x.CODE || '',
    discount: num(x.PARTDISC ?? x.DISCOUNT), familyDiscount: num(x.FAMILYDISC),
  })).filter(x => x.price || x.discount || x.familyDiscount);
  const data = {
    sku, at: Date.now(),
    base: [
      { label: 'מחיר בסיס', price: num(it.PRICE), cur: it.CODE || '' },
      { label: 'מחירון בסיס', price: num(it.BASEPLPRICE), cur: it.BASEPLCODE || '' },
      { label: 'מחירון סיטונאי', price: num(it.WSPLPRICE), cur: it.WSPLCODE || '' },
      { label: 'מחיר מינימום', price: num(it.MINPRICE), cur: it.MINCODE || '' },
    ].filter(x => x.price),
    lists, custPrices,
  };
  cache.set(sku, { at: Date.now(), data });
  return data;
};

// price list → customers on it (from the customer cards). idb: 'custPriceLists' = { at, map: { PLNAME: [customer names] } }
let custMem = null, custLoading = null;
export const fetchCustomersByPriceList = async ({ idbGet, idbSet, force = false } = {}) => {
  const fresh = (x) => x && x.at && Date.now() - x.at < 24 * 3600000;
  if (!force && fresh(custMem)) return custMem;
  if (!force && idbGet) { try { const s = await idbGet('custPriceLists'); if (fresh(s)) return (custMem = s); } catch { /* none stored */ } }
  if (custLoading) return custLoading;
  custLoading = (async () => {
    const map = {}; let skip = 0;
    for (let guard = 0; guard < 20; guard++) {
      const r = await call({ action: 'query', form: 'CUSTOMERS', select: 'CUSTNAME,CUSTDES', expand: 'CUSTPLIST_SUBFORM', maxRows: 60000, skip });
      (r.value || []).forEach(c => (c.CUSTPLIST_SUBFORM || []).forEach(p => { if (p.PLNAME) (map[p.PLNAME] ||= []).push(c.CUSTDES || c.CUSTNAME); }));
      if (r.nextSkip == null) break; skip = r.nextSkip;
    }
    const out = { at: Date.now(), map };
    custMem = out;
    if (idbSet) idbSet('custPriceLists', out).catch(() => {});
    return out;
  })();
  try { return await custLoading; } finally { custLoading = null; }
};
