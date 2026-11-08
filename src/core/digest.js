// ─── Weekly summary (computed on the server from the stored data) ──────
// Uses the same model as the procurement page (procModel.js), so the numbers
// in the email match the website.
import { mergeLinesIntoMonthly, detectOutliers, saleLineId, supplierLeadTimes, matchShipSupplier, shipmentStage, daysBetween, stockTimelines, stockoutSummary,
  purchasePriceHistory, priceIncreases, priceCheck, linkShipmentsToPOs, returnsAnalysis, productStartDates, inactiveSkusOf, withShipMarks, withShipSups, applyCardNames, DAY_MS, isoToDisplay } from './data.js';
import { computeProducts, enrichOrders, overdueByProductOf, incomingMapOf, supplierConcentrationOf, makeLeadFor } from './procModel.js';

// Items that sell but whose stock + incoming is well beyond the plan's need.
export const excessOf = (products, marginMonths = 3) => {
  const rows = [];
  products.forEach(p => {
    if (!(p.avgMonthly > 0) || !(p.currentStock > 0)) return;
    const buffer = Math.max(p.safetyStock || 0, p.minStock || 0);
    const needed = (p.projectedDemand || 0) + buffer + p.avgMonthly * marginMonths;
    const total = p.currentStock + (p.incomingQty || 0);
    const excessQty = Math.floor(total - needed);
    if (excessQty <= 0) return;
    const onHandExcess = Math.min(excessQty, p.currentStock);
    const poExcess = Math.min(p.incomingQty || 0, excessQty);
    rows.push({ ...p, excessQty, onHandExcess, poExcess, coverMonths: total / p.avgMonthly,
      excessValue: p.unitCost ? onHandExcess * p.unitCost : null, poExcessValue: p.unitCost ? poExcess * p.unitCost : null });
  });
  return rows.sort((a, b) => (b.excessValue || 0) - (a.excessValue || 0));
};

// Products whose sales moved: units in the last 30 days vs the product's usual monthly pace in the year
// before them (a year, not 3 months: one quiet or out-of-stock stretch doesn't make the next month look like
// a boom). The usual pace is measured only over days the product could actually be sold:
//  · from its first arrival (first supplier invoice, or first sale if earlier) — a product that arrived
//    a month ago isn't divided by three months;
//  · skipping days it was out of stock (from the stock history) — no stock, no sales, not lower demand.
// Fewer than 30 sellable days before the last 30 → "new" (no % — there is nothing fair to compare with).
// A rise that comes mostly from one invoice is flagged `single` (one big order, not a trend).
// Rising: 5+ units now and +40% (or new). Falling: usual pace 5+/month and −40%, per sellable day.
// Ranked by the extra revenue, so a jump on a big seller beats +300% on a 2-unit item.
export const trendingProducts = (lines, { now = Date.now(), products = [], names = {}, purchaseLines = [], stockHistory = null, currentStock = {}, inactive = null } = {}) => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = iso(now), a0 = iso(now - 29 * DAY_MS), b0 = iso(now - (29 + 365) * DAY_MS);
  const skip = (k) => inactive && inactive.has(k);
  const by = {}, firstSale = {}, firstBuy = {};
  let dataStart = today; // the stored history doesn't go back forever — nothing before it counts as "no sales"
  lines.forEach(l => {
    if (l.d && l.d < dataStart) dataStart = l.d;
    if (l.x || l.junk || !l.k || !l.q) return;
    if (l.q > 0 && (!firstSale[l.k] || l.d < firstSale[l.k])) firstSale[l.k] = l.d;
    if (l.d < b0 || l.d > today || skip(l.k)) return;
    const x = (by[l.k] ||= { k: l.k, name: names[l.k] || l.n || l.k, q: 0, v: 0, pq: 0, pv: 0, inv: {}, soldDays: new Set() });
    if (l.q > 0) x.soldDays.add(l.d);
    // returns (negative lines) are netted out — a sale that came back isn't demand
    if (l.d >= a0) { x.q += l.q; x.v += l.v || 0; if (l.q > 0) { const key = l.inv || l.d + '|' + (l.cid || l.c); const iv = (x.inv[key] ||= { q: 0, c: l.c || '' }); iv.q += l.q; } }
    else { x.pq += l.q; x.pv += l.v || 0; }
  });
  purchaseLines.forEach(l => { if (!l.junk && l.k && l.q > 0 && l.d && (!firstBuy[l.k] || l.d < firstBuy[l.k])) firstBuy[l.k] = l.d; });
  // only products that could make either list (5+ units now, or 5+ before) — keeps the server within its CPU budget
  const ks = Object.keys(by).filter(k => by[k].q >= 5 || by[k].pq >= 5);
  // stock per day over the period (estimated back from today's balance with the invoices + daily snapshots)
  const tl = ks.length ? stockTimelines({ stockHistory, currentStock, salesLines: lines, purchaseLines, skus: ks, fromIso: b0, toIso: today }) : {};
  const prodBy = {}; products.forEach(p => { if (p.sku) prodBy[p.sku] = p; });
  const rows = ks.map(k => {
    const x = by[k];
    const fs = firstSale[k], fb = firstBuy[k];
    // first arrival = first supplier invoice or first sale, whichever is earlier — but only when it is well
    // after the start of the stored history (otherwise the product simply existed before it)
    const first = fs && fb ? (fs < fb ? fs : fb) : (fs || fb || '');
    const histStart = dataStart > b0 ? dataStart : b0;
    const arrived = first && Date.parse(first) - Date.parse(dataStart) > 60 * DAY_MS ? first : '';
    const start = arrived && arrived > histStart ? arrived : histStart;
    const startPrev = start;
    // a day is "out" only when the balance at its end was 0 and nothing sold that day
    const recentFrom = start > a0 ? start : a0;
    let prevOut = 0, recentOut = 0;
    (tl[k] || []).forEach(t => {
      if (!(t.q <= 0 && !t.neg && !x.soldDays.has(t.d))) return;
      if (t.d >= startPrev && t.d < a0) prevOut++; else if (t.d >= recentFrom && t.d <= today) recentOut++;
    });
    const span = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS));
    const prevDays = span(startPrev, a0) - prevOut;            // sellable days before the last 30
    const recentDays = span(recentFrom, today) + 1 - recentOut;
    const isNew = prevDays < 30;
    const prevPace = !isNew ? x.pq / prevDays * 30 : null;              // units per 30 sellable days
    const recentPace = recentDays > 0 ? x.q / recentDays * 30 : x.q;
    const pct = prevPace > 0 ? (recentPace / prevPace - 1) * 100 : null;
    const prevV = !isNew ? x.pv / prevDays * 30 : 0;
    // one invoice carrying most of the rise
    const big = Object.values(x.inv).sort((a, b) => b.q - a.q)[0];
    let single = null;
    if (big && big.q >= 5 && big.q >= x.q * 0.6 && (pct == null || pct >= 40)) {
      const rest = x.q - big.q, restPace = recentDays > 0 ? rest / recentDays * 30 : rest;
      if (isNew || !prevPace || (restPace / prevPace - 1) * 100 < 40) single = { q: Math.round(big.q), c: big.c };
    }
    const p = prodBy[k];
    const coverWeeks = p && p.currentStock != null && x.q > 0 ? Math.max(0, Math.round((p.currentStock + (p.incomingQty || 0)) / (recentPace / 30) / 7)) : null;
    return { k, name: x.name, q: Math.round(x.q), prevQ: prevPace != null ? Math.round(prevPace * 10) / 10 : 0, pct, delta: x.v - prevV, coverWeeks,
      isNew, noPrev: !isNew && !(prevPace > 0), since: arrived && arrived > b0 ? arrived : null, prevDays, prevOut, recentOut, single };
  });
  const up = rows.filter(x => x.q >= 5 && (x.pct == null || x.pct >= 40))
    .sort((a, b) => (a.single ? 1 : 0) - (b.single ? 1 : 0) || b.delta - a.delta);
  // a drop explained by running out of stock (a week+ of the last 30 days) isn't lower demand → not listed
  const down = rows.filter(x => x.prevQ >= 5 && x.pct != null && x.pct <= -40 && x.recentOut < 7).sort((a, b) => a.delta - b.delta);
  return { up, down };
};

// state: { app: {key: parsed value}, sets: {key: value} } — exactly what the website stores.
export const buildDigest = ({ app = {}, sets = {} }, { now = Date.now() } = {}) => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = iso(now);
  // product names from the Priority item cards, not the (editable) invoice-line text
  const salesLinesAll = applyCardNames(sets.procSalesLines || [], app.procurementNames || {}, sets.procItemsExtra || {});
  const salesLines = salesLinesAll.filter(l => !l.x);
  const purchaseLines = applyCardNames(sets.procPurchaseLines || [], app.procurementNames || {}, sets.procItemsExtra || {});
  // shipments the person marked as received are done — not "on the way" anymore
  const shipments = withShipMarks(sets.procShipments || [], app.procShipReceived || {}, app.procShipDelivery || {});
  const stockMap = app.procurementStock || {};
  const supplierMap = app.procurementSupplier || {};
  const costMap = app.procurementCost || {}, currencyMap = app.procurementCurrency || {};
  const exchangeRates = app.exchangeRates || {};
  const openOrders = app.openOrders || [];
  const shipSupOverride = app.procShipSupplierMap || {};
  // inactive products (Priority item status): out of every product-level list; money totals keep them
  const inactive = inactiveSkusOf(sets.procItemsExtra || {});

  // outliers → the plan's sales (same as the page)
  const outliers = detectOutliers(salesLines, { sinceIso: iso(now - 365 * DAY_MS) });
  const decisions = app.procOutlierDecisions || {};
  const caps = {}; Object.values(outliers).forEach(o => o.lines.forEach(l => { if (decisions[l.id] === 'cap') caps[l.id] = l.cap; }));
  const linesForPlan = Object.keys(caps).length ? salesLines.map(l => { const c = caps[saleLineId(l)]; return c != null ? { ...l, q: c } : l; }) : salesLines;
  const salesData = mergeLinesIntoMonthly(sets.dashboardSalesData || [], linesForPlan);

  // stock history → stockouts
  const from = iso(now - 364 * DAY_MS);
  const skus = [...new Set(salesLines.filter(l => l.d >= from).map(l => l.k))].filter(k => k && stockMap[k] != null);
  const stockouts = stockoutSummary(stockTimelines({ stockHistory: sets.stockHistory, currentStock: stockMap, salesLines, purchaseLines, skus, fromIso: from, toIso: today, startBy: productStartDates({ itemsExtra: sets.procItemsExtra || {}, purchaseLines }) }));

  // lead times
  const knownSuppliers = [...new Set([...purchaseLines.map(l => l.s), ...Object.values(supplierMap).filter(Boolean), ...openOrders.map(o => o.supplier).filter(Boolean)])];
  const supOf = (s) => shipSupOverride[s.sup] === '' ? null : (shipSupOverride[s.sup] ?? matchShipSupplier(s.sup, knownSuppliers));
  const transitBySupplier = {};
  shipments.forEach(s => { const sup = supOf(s); if (sup && s.dep && s.arr) { const d = daysBetween(s.dep, s.arr); if (d > 0 && d < 120) (transitBySupplier[sup] ||= []).push(d); } });
  const leadStats = supplierLeadTimes({ purchaseLines, poMeta: sets.procPoMeta || {}, transitBySupplier, sinceIso: iso(now - 540 * DAY_MS) });
  const leadFor = makeLeadFor({ leadStats, leadTimeMap: app.procurementLeadTime || {}, leadAddTransit: app.procLeadAddTransit || {}, leadTime: app.procDefaultLeadTime != null && Number.isFinite(Number(app.procDefaultLeadTime)) ? Number(app.procDefaultLeadTime) : 1 });

  const ordersEnriched = enrichOrders({ openOrders, currencyMap, exchangeRates, costMap });
  const purchBySku = {}, lastSupBySku = {};
  purchaseLines.forEach(l => { if (l.junk) return; (purchBySku[l.k] ||= []).push(l); if (!lastSupBySku[l.k]) lastSupBySku[l.k] = l; });
  const productsAll = computeProducts({ salesData, excludeCurrentMonth: app.excludeCurrentMonth !== false, avgWindowMonths: Number.isFinite(Number(app.procAvgWindow)) && app.procAvgWindow != null ? Number(app.procAvgWindow) : 12, stockouts, skipStockoutMonths: app.procSkipStockoutMonths !== '0' && app.procSkipStockoutMonths !== 0,
    stockMap, minStockMap: app.procurementMinStock || {}, lastSupBySku, supplierMap, costMap, itemsExtra: sets.procItemsExtra || {}, currencyMap, exchangeRates,
    costHistory: app.procurementCostHistory || {}, purchBySku, leadFor, incomingMap: incomingMapOf(openOrders), overdueByProduct: overdueByProductOf(ordersEnriched),
    moqMap: app.procurementMOQ || {}, monthsToStock: Number(app.procMonthsToStock) || 2, supplierConcentration: supplierConcentrationOf(supplierMap), outliers, outlierDecisions: decisions, orderBlock: app.procOrderBlock || {} });
  const products = productsAll.filter(p => !p.inactive);

  // 1. what to order, by supplier
  const bySup = {};
  products.filter(p => p.suggestedOrder > 0 && !p.ownMade).forEach(p => {
    const s = (bySup[p.supplier || 'ספק לא ידוע'] ||= { name: p.supplier || 'ספק לא ידוע', n: 0, now: 0, value: 0, lead: p.effectiveLeadTime });
    s.n++; if (p.status === 'now') s.now++; s.value += p.orderCost || 0;
  });
  const toOrder = Object.values(bySup).sort((a, b) => b.now - a.now || b.value - a.value);

  // 2. on the way: late POs, delayed shipments
  const latePOs = ordersEnriched.filter(o => o.isOverdue).sort((a, b) => b.daysLate - a.daysLate);
  const lateBySup = {}; latePOs.forEach(o => { const s = (lateBySup[o.supplier || '—'] ||= { name: o.supplier || '—', lines: 0, maxDays: 0, pos: new Set() }); s.lines++; s.maxDays = Math.max(s.maxDays, o.daysLate); if (o.poNumber) s.pos.add(o.poNumber); });
  const delayed = shipments.map(s => ({ ...s, stage: shipmentStage(s, today), delayDays: s.change ? Math.round(daysBetween(s.change.from, s.change.to)) : 0 }))
    .filter(s => s.stage.idx < 2 && s.delayDays > 0).sort((a, b) => b.delayDays - a.delayDays);

  // 3. price increases on supplier invoices this week
  const hist = purchasePriceHistory(purchaseLines.filter(l => !inactive.has(l.k)));
  const names = app.procurementNames || {};
  const priceUps = priceIncreases(hist, { sinceIso: iso(now - 7 * DAY_MS) }).map(x => ({ ...x, name: names[x.k] || hist[x.k]?.[0]?.n || x.k }));

  // 4. excess stock
  const excess = excessOf(products, 3);
  const excessValue = excess.reduce((a, p) => a + (p.excessValue || 0), 0);
  const excessPOs = excess.filter(p => p.poExcess > 0);

  // 5. sales: last 7 days vs the same 7 days a year ago; products on the move; returns
  const sum = (a, b) => salesLinesAll.filter(l => l.d >= a && l.d <= b && l.v > 0).reduce((s, l) => s + l.v, 0);
  const w0 = iso(now - 6 * DAY_MS), ly0 = iso(now - (365 + 6) * DAY_MS), ly1 = iso(now - 365 * DAY_MS);
  const week = { v: sum(w0, today), lastYear: sum(ly0, ly1), from: w0, to: today };
  // Products on the move: last 30 days vs the monthly pace of the 90 days before them.
  const productMoves = trendingProducts(salesLinesAll, { now, products, names: app.procurementNames || {}, purchaseLines, stockHistory: sets.stockHistory, currentStock: stockMap, inactive });
  const ret = returnsAnalysis(salesLinesAll, { fromIso: iso(now - 30 * DAY_MS), toIso: today });
  const returnSpikes = ret.products.filter(p => !inactive.has(p.k)).filter(p => p.rate != null && p.rate >= 10 && p.retQ >= 3).slice(0, 8);

  return {
    generatedAt: now, today,
    syncAt: app.prioritySyncAt ? Number(app.prioritySyncAt) : null,
    toOrder, toOrderTotal: toOrder.reduce((a, s) => a + s.value, 0), toOrderNow: products.filter(p => p.status === 'now' && !p.ownMade).length,
    toMake: products.filter(p => p.ownMade && p.suggestedOrder > 0).length, toMakeNow: products.filter(p => p.ownMade && p.status === 'now').length,
    // own-made that is nearly out (under procOwnMadeAlertDays, default 14, or no stock) — the urgent part
    toMakeUrgent: products.filter(p => p.ownMade && p.status === 'now' && ((p.currentStock ?? 0) <= 0 || (p.effectiveCoverDays != null && p.effectiveCoverDays < (Number(app.procOwnMadeAlertDays) || 14)))).length,
    toMakeList: products.filter(p => p.ownMade && p.suggestedOrder > 0 && p.currentStock != null)
      .sort((a, b) => (b.status === 'now') - (a.status === 'now') || (a.effectiveCoverDays ?? 999) - (b.effectiveCoverDays ?? 999))
      .slice(0, 15).map(p => ({ name: p.name, sku: p.sku, stock: p.currentStock, coverDays: p.effectiveCoverDays != null ? Math.round(p.effectiveCoverDays) : null, qty: p.suggestedOrder, now: p.status === 'now' })),
    latePOs: Object.values(lateBySup).map(s => ({ ...s, pos: [...s.pos] })).sort((a, b) => b.maxDays - a.maxDays), latePOLines: latePOs.length,
    delayed: delayed.slice(0, 10).map(s => ({ cont: s.cont, file: s.file || '', sup: s.sup, arr: s.arr, from: s.change?.from, delayDays: s.delayDays })),
    priceUps: priceUps.slice(0, 15), excessValue, excessPOs: excessPOs.slice(0, 10).map(p => ({ name: p.name, sku: p.sku, supplier: p.supplier, poExcess: p.poExcess, value: p.poExcessValue })), excessPOCount: excessPOs.length,
    overview: (() => {
      const lastSale = {}; salesLinesAll.forEach(l => { if (!l.x && l.k && l.q > 0 && (!lastSale[l.k] || l.d > lastSale[l.k])) lastSale[l.k] = l.d; });
      const d90 = iso(now - 90 * DAY_MS), wk = iso(now + 7 * DAY_MS);
      let stockValue = 0, cogs = 0, deadValue = 0, deadCount = 0;
      products.forEach(p => {
        const v = p.unitCost != null ? Math.max(0, p.currentStock || 0) * p.unitCost : 0;
        stockValue += v; if (p.unitCost != null) cogs += (p.avgMonthly || 0) * p.unitCost;
        if ((p.currentStock || 0) > 0 && (!lastSale[p.sku] || lastSale[p.sku] < d90)) { deadValue += v; deadCount++; }
      });
      const poPrice = {}, catalog = {};
      ordersEnriched.forEach(o => { if (o.unitPriceOriginal > 0) poPrice[o.productKey] = { p: o.unitPriceOriginal, cur: o.currency || 'ILS', po: o.poNumber || '' }; });
      Object.entries(costMap).forEach(([k, v]) => { if (v > 0) catalog[k] = { p: v, cur: currencyMap[k] || 'ILS' }; });
      const blocked = new Set(products.filter(p => p.orderBlocked).map(p => p.sku));
      const pc = Object.values(priceCheck(hist, { now, poPrice, catalog, names })).filter(x => !blocked.has(x.k));
      const shipsAll = shipments.map(s => withShipSups({ ...s, matched: supOf(s), stage: shipmentStage(s, today), delayDays: s.change ? Math.round(daysBetween(s.change.from, s.change.to)) : 0 }, app.procShipExtraSups || {}));
      // everything not yet marked received: at sea, waiting to sail, at the port / trucking
      const active = shipsAll.filter(s => s.stage.idx <= 2);
      const links = linkShipmentsToPOs({ shipments: shipsAll, orders: ordersEnriched, manual: app.procShipPoLinks || {} });
      const arriving = active.filter(s => s.arr && s.arr >= today && s.arr <= wk);
      const inTransit = active.map(s => ({ id: s.id, sup: s.sups.length ? s.sups.join(' + ') : s.sup, sups: s.sups, fwdSup: s.sup, matched: s.sups.length > 0, cont: s.cont, file: s.file || '', arr: s.arr, dep: s.dep, stage: s.stage.label, stageIdx: s.stage.idx, sub: s.stage.sub,
        delivery: s.delivery || null, fromPort: s.from || '', toPort: s.to || '', mode: s.mode || '', gone: s.gone || null,
        days: s.arr ? Math.round(daysBetween(today, s.arr)) : null, delayDays: s.delayDays, from: s.change?.from || null, pos: links.byShip[s.id] || [], thisWeek: !!(s.arr && s.arr >= today && s.arr <= wk) }))
        .sort((a, b) => (a.arr || '9999') < (b.arr || '9999') ? -1 : 1);
      return {
        stockValue, daysOfInventory: cogs > 0 && stockValue > 0 ? Math.round(stockValue / (cogs / 30)) : null, deadValue, deadCount, excessValue,
        toOrder: products.filter(p => p.suggestedOrder > 0 && p.currentStock != null && !p.ownMade).length,
        toOrderValue: products.filter(p => p.suggestedOrder > 0 && p.currentStock != null && !p.ownMade).reduce((a, p) => a + (p.orderCost || 0), 0),
        arrivingWeek: arriving.length, delayedCount: delayed.length, inTransitCount: active.length, inTransit,
        atPort: active.filter(s => s.stage.idx === 2).length, toBook: active.filter(s => s.stage.idx === 2 && !s.delivery?.booked).length,
        priceHigh: pc.filter(x => x.verdict === 'high').length, priceCheck: pc.filter(x => x.verdict !== 'ok').length,
      };
    })(),
    allProductsLite: Object.fromEntries(products.filter(p => /^[AB]/.test(p.abc || '')).map(p => [p.sku || p.key, { name: p.name, stock: p.currentStock, incoming: p.incomingQty || 0 }])),
    alertSource: {
      stock: products.filter(p => p.status === 'now' && /^[AB]/.test(p.abc || '') && p.avgMonthly > 0)
        .map(p => ({ k: p.sku || p.key, name: p.name, supplier: p.supplier || '', ownMade: !!p.ownMade, stock: p.currentStock, incoming: p.incomingQty || 0,
          coverDays: p.effectiveCoverDays != null ? Math.round(p.effectiveCoverDays) : null, leadMonths: p.effectiveLeadTime, qty: p.suggestedOrder, abc: p.abc })),
      ships: delayed.map(s => ({ id: s.id, cont: s.cont, file: s.file || '', sup: s.sup, arr: s.arr, from: s.change?.from, delayDays: s.delayDays })),
    },
    week, productsUp: productMoves.up.slice(0, 10), productsDown: productMoves.down.slice(0, 6), returnSpikes,
  };
};

// ─── The email itself (RTL HTML; tables because mail clients ignore most CSS) ───
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ils = (v) => '₪' + Math.round(v || 0).toLocaleString('en-US');
const pctS = (v) => `<span dir="ltr">${v > 0 ? '+' : ''}${v.toFixed(0)}%</span>`;
// Small note under a product on the move: arrived recently / one big order / was out of stock.
export const moveNoteText = (x) => [
  x.since ? `במלאי מ-${isoToDisplay(x.since)}` : '',
  x.single ? `הזמנה בודדת של ${x.single.q} יח'${x.single.c ? ' (' + x.single.c + ')' : ''}` : '',
  x.prevOut >= 7 ? `${x.prevOut} ימים חסר במלאי לא נספרו` : '',
].filter(Boolean).join(' · ');
const moveNote = (x) => { const t = moveNoteText(x); return t ? ' · ' + esc(t) : ''; };

// container number, and the forwarder's file number under it (what the forwarder asks for on the phone)
const contCell = (x) => `${esc(x.cont || '—')}${x.file ? `<br><span style="color:#94a3b8;font-size:11px">תיק ${esc(x.file)}</span>` : ''}`;
export const renderDigestHtml = (d, { siteUrl }) => {
  const sec = (title, inner, link) => `<tr><td style="padding:18px 22px;border-top:1px solid #e2e8f0">
    <h2 style="margin:0 0 10px;font-size:16px;color:#0f172a">${esc(title)}</h2>${inner}
    ${link ? `<p style="margin:10px 0 0"><a href="${esc(link)}" style="color:#1F5FBF;font-size:13px">פתח באתר ←</a></p>` : ''}</td></tr>`;
  const table = (head, rows) => rows.length ? `<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
    <tr style="background:#f1f5f9;color:#475569">${head.map(h => `<th align="right" style="font-weight:600">${esc(h)}</th>`).join('')}</tr>
    ${rows.map(r => `<tr>${r.map(c => `<td align="right" style="border-bottom:1px solid #f1f5f9">${c}</td>`).join('')}</tr>`).join('')}</table>` : '<p style="margin:0;color:#64748b;font-size:13px">אין</p>';
  const p = (t) => `<p style="margin:0 0 8px;font-size:14px;color:#334155">${t}</p>`;
  const proc = `${siteUrl}`;
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden" dir="rtl">
    <tr><td style="background:#0f172a;color:#fff;padding:18px 22px"><div style="font-size:18px;font-weight:bold">סיכום שבועי — רכש ומכירות</div>
      <div style="font-size:12px;opacity:.75;margin-top:4px">${esc(isoToDisplay(d.today))}${d.syncAt ? ` · נתוני Priority מ-${esc(new Date(d.syncAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}` : ''}</div></td></tr>
    ${sec('מה להזמין השבוע', p(`<b>${d.toOrderNow}</b> מוצרים להזמין עכשיו · שווי משוער של כל ההמלצות <b>${ils(d.toOrderTotal)}</b>`) +
      p('<b>להזמין מספקים</b>') +
      table(['ספק', 'מוצרים', 'דחוף', 'שווי משוער', 'זמן אספקה'], d.toOrder.slice(0, 12).map(s => [esc(s.name), s.n, s.now ? `<b style="color:#C8322B">${s.now}</b>` : '—', s.value ? ils(s.value) : '—', `${s.lead} ח׳`])) +
      ((d.toMakeList || []).length ? '<div style="height:12px"></div>' + p(`<b>לייצור</b> — ${d.toMake} מוצרים${d.toMakeNow ? ` (מהם <b style="color:#C8322B">${d.toMakeNow}</b> דחופים)` : ''}`) +
        table(['מוצר', 'מלאי', 'מספיק ל', 'לייצר'], d.toMakeList.map(x => [`${x.now ? '<b style="color:#C8322B">●</b> ' : ''}${esc(x.name)}<br><span style="color:#94a3b8;font-size:11px">${esc(x.sku || '')}</span>`, x.stock ?? '—', x.coverDays == null ? '—' : `${x.coverDays} ימים`, `<b>${(x.qty || 0).toLocaleString('en-US')}</b>`]))
        + (d.toMake > d.toMakeList.length ? p(`<span style="font-size:12px;color:#64748b">ועוד ${d.toMake - d.toMakeList.length} — באתר</span>`) : '') : ''), proc)}
    ${sec('מה בדרך — באיחור ונדחה', p(`הזמנות רכש באיחור: <b>${d.latePOLines}</b> שורות`) +
      table(['ספק', 'שורות', 'איחור מרבי', 'הזמנות'], d.latePOs.slice(0, 8).map(s => [esc(s.name), s.lines, `${s.maxDays} ימים`, esc(s.pos.slice(0, 4).join(', '))])) +
      (d.delayed.length ? '<div style="height:10px"></div>' + table(['מכולה / תיק', 'ספק', 'הגעה', 'נדחה'], d.delayed.map(s => [contCell(s), esc(s.sup), esc(isoToDisplay(s.arr)), `${s.delayDays} ימים (היה ${esc(isoToDisplay(s.from))})`])) : ''), proc)}
    ${sec('התייקרויות בחשבוניות ספק השבוע', table(['מוצר', 'ספק', 'קודם', 'עכשיו', 'שינוי'], d.priceUps.map(x => [esc(x.name), esc(x.s), `${x.prevP} ${esc(x.cur)}`, `<b>${x.p} ${esc(x.cur)}</b>`, `<b style="color:#C8322B">${pctS(x.pct)}</b>`])), proc)}
    ${sec('מלאי עודף', p(`כסף שיושב במלאי עודף: <b>${ils(d.excessValue)}</b> · הזמנות פתוחות על מוצרים בעודף: <b>${d.excessPOCount}</b>`) +
      table(['מוצר', 'ספק', 'בהזמנה מיותרת', 'שווי'], d.excessPOs.map(x => [esc(x.name), esc(x.supplier || '—'), `${x.poExcess} יח׳`, x.value ? ils(x.value) : '—'])), proc)}
    ${sec('מכירות', p(`7 הימים האחרונים: <b>${ils(d.week.v)}</b>${d.week.lastYear ? ` · אותו שבוע אשתקד ${ils(d.week.lastYear)} (<b>${pctS((d.week.v / d.week.lastYear - 1) * 100)}</b>)` : ''}`) +
      ((d.productsUp || []).length ? '<div style="height:6px"></div>' + p('<b>מוצרים בעלייה</b> — נמכר ב-30 הימים האחרונים מול הממוצע החודשי הרגיל שלו בשנה שלפני (מאז שהגיע למלאי, בלי ימים שהיה חסר)') +
        table(['מוצר', '30 יום', 'ממוצע רגיל לחודש', 'שינוי', 'מלאי מספיק ל'], d.productsUp.map(x => [`${esc(x.name)}<br><span style="color:#94a3b8;font-size:11px">${esc(x.k)}${moveNote(x)}</span>`, x.q.toLocaleString('en-US'), x.isNew ? 'חדש' : x.noPrev ? 'לא נמכר' : x.prevQ.toLocaleString('en-US'), x.pct != null ? `<b style="color:#2E8B57">${pctS(x.pct)}</b>` : '—', x.coverWeeks == null ? '—' : x.coverWeeks < 4 ? `<b style="color:#C8322B">${x.coverWeeks} שבועות</b>` : `${x.coverWeeks} שבועות`])) : '') +
      ((d.productsDown || []).length ? '<div style="height:10px"></div>' + p('<b>מוצרים בירידה</b> — אותו חישוב; מוצר שהיה חסר במלאי לא מופיע כאן') +
        table(['מוצר', '30 יום', 'ממוצע רגיל לחודש', 'שינוי'], d.productsDown.map(x => [`${esc(x.name)}<br><span style="color:#94a3b8;font-size:11px">${esc(x.k)}${moveNote(x)}</span>`, x.q.toLocaleString('en-US'), x.prevQ.toLocaleString('en-US'), `<b style="color:#C8322B">${pctS(x.pct)}</b>`])) : '') +
      (d.returnSpikes.length ? '<div style="height:6px"></div>' + p('<b>מוצרים עם הרבה החזרות ב-30 הימים האחרונים:</b>') + table(['מוצר', 'נמכרו', 'חזרו', 'אחוז'], d.returnSpikes.map(x => [esc(x.n), x.soldQ, x.retQ, `<b style="color:#C8322B">${x.rate.toFixed(0)}%</b>`])) : ''), proc)}
    <tr><td style="padding:14px 22px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">נשלח אוטומטית כל יום ראשון מהאתר BizData · הנתונים מ-Priority (קריאה בלבד)</td></tr>
  </table></td></tr></table></body></html>`;
};


// ─── Instant alerts ───
// From the same numbers as the weekly email: key products (A/B) that will run out before a new
// order can arrive, and shipments whose arrival date was pushed back. `sent` = { key: ISO date } of
// alerts already sent — an item is sent again only after `repeatDays` (stock) or when the date moves again (ships).
export const pickAlerts = (d, sent = {}, { now = Date.now(), repeatDays = 14 } = {}) => {
  const fresh = (key) => !sent[key] || (now - Date.parse(sent[key])) > repeatDays * 86400000;
  const stock = (d.alertSource?.stock || []).filter(x => fresh(`stock:${x.k}`))
    .sort((x, y) => String(x.abc).localeCompare(String(y.abc)) || (x.coverDays ?? 999) - (y.coverDays ?? 999));
  const ships = (d.alertSource?.ships || []).filter(x => !sent[`ship:${x.id}:${x.arr}`]);
  return { stock, ships, keys: [...stock.map(x => `stock:${x.k}`), ...ships.map(x => `ship:${x.id}:${x.arr}`)] };
};
// ─── Morning reminder (every morning, 07:30) ───
// Every A/B product that is still "order now" is listed every morning until it is no longer at risk
// (a PO was opened, stock came in, or demand dropped) — or until the person snoozed it on the site.
// state (app_state 'alertsMorning') = { items: { sku: { since, stock, incoming } }, lastSent }
// snooze (app_state 'procAlertSnooze') = { sku: { until: 'YYYY-MM-DD' } | { untilStock: true, stock } }
export const isSnoozed = (x, snooze = {}, todayIso) => {
  const z = snooze[x.k];
  if (!z) return false;
  if (z.until) return z.until >= todayIso;
  if (z.untilStock) return !((x.stock ?? 0) > (z.stock ?? 0)); // until stock goes up from what it was
  return false;
};
// Own-made products are listed only when nearly out (cover under ownMadeDays, default 14, or no stock) —
// they can be made quickly; products bought from suppliers are listed as soon as they are "order now".
export const pickMorningAlerts = (d, state = {}, snooze = {}, { now = Date.now(), ownMadeDays = 14 } = {}) => {
  const today = new Date(now).toISOString().slice(0, 10);
  const prev = state.items || {};
  const all = d.alertSource?.stock || [];
  const snoozed = all.filter(x => isSnoozed(x, snooze, today));
  const urgentEnough = (x) => !x.ownMade || (x.stock ?? 0) <= 0 || (x.coverDays != null && x.coverDays < ownMadeDays);
  const current = all.filter(x => !isSnoozed(x, snooze, today) && urgentEnough(x)).map(x => {
    const p = prev[x.k];
    const since = p?.since || today;
    return { ...x, isNew: !p, since, days: Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86400000)) };
  }).sort((a, b) => (b.isNew - a.isNew) || String(a.abc).localeCompare(String(b.abc)) || (a.coverDays ?? 999) - (b.coverDays ?? 999));
  const inNow = new Set(all.map(x => x.k));
  const resolved = Object.entries(prev).filter(([k]) => !inNow.has(k)).map(([k, p]) => {
    const cur = (d.allProductsLite || {})[k] || {};
    const why = (cur.incoming || 0) > (p.incoming || 0) ? 'נפתחה הזמנה' : (cur.stock ?? 0) > (p.stock ?? 0) ? 'המלאי עלה' : 'כבר לא בסיכון';
    return { k, name: p.name || cur.name || k, why };
  });
  const items = {};
  [...current, ...snoozed].forEach(x => { items[x.k] = { since: prev[x.k]?.since || today, stock: x.stock ?? null, incoming: x.incoming || 0, name: x.name }; });
  const buy = current.filter(x => !x.ownMade), make = current.filter(x => x.ownMade);
  const groups = {};
  buy.forEach(x => { (groups[x.supplier || 'ספק לא ידוע'] ||= []).push(x); });
  const bySupplier = Object.entries(groups).map(([name, items]) => ({ name, items, newCount: items.filter(x => x.isNew).length, minCover: Math.min(...items.map(x => x.coverDays ?? 999)) }))
    .sort((a, b) => (b.newCount > 0) - (a.newCount > 0) || a.minCover - b.minCover || b.items.length - a.items.length);
  return { current, buy, make, bySupplier, ownMadeDays, resolved, snoozedCount: snoozed.length, nextState: { items, lastSent: state.lastSent || null } };
};
export const renderMorningHtml = (m, ships = [], { siteUrl }) => {
  const row = (cells) => `<tr>${cells.map(c => `<td align="right" style="padding:6px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:top">${c}</td>`).join('')}</tr>`;
  const head = (cells) => `<tr style="background:#f1f5f9;color:#475569">${cells.map(c => `<th align="right" style="padding:6px;font-size:12px;font-weight:600">${esc(c)}</th>`).join('')}</tr>`;
  const tag = (x) => x.isNew ? '<span style="background:#C8322B;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:bold">חדש</span> '
    : `<span style="color:#b45309;font-size:11px;font-weight:bold">ברשימה ${x.days} ${x.days === 1 ? 'יום' : 'ימים'}</span> `;
  const itemRow = (x, verb) => row([`${tag(x)}<b>${esc(x.name)}</b><br><span style="color:#94a3b8;font-size:11px">${esc(x.k)}</span>`,
    x.stock ?? '—', x.incoming || '—', x.coverDays == null ? '—' : `<b style="color:#C8322B">${x.coverDays} ימים</b>`, `<b>${(x.qty || 0).toLocaleString('en-US')}</b> ${verb}`]);
  const cols = (verb) => head(['מוצר', 'מלאי', 'בדרך', 'מספיק ל', verb]);
  const buy = m.buy || m.current.filter(x => !x.ownMade), make = m.make || m.current.filter(x => x.ownMade);
  let shown = 0; const LIMIT = 60;
  const supBlocks = (m.bySupplier || []).map(g => {
    if (shown >= LIMIT) return '';
    const items = g.items.slice(0, Math.max(0, LIMIT - shown)); shown += items.length;
    return `<tr><td colspan="5" style="padding:10px 6px 4px;font-size:14px;font-weight:bold;color:#0f172a;border-bottom:2px solid #e2e8f0"><bdi>${esc(g.name)}</bdi> <span style="font-weight:normal;color:#64748b;font-size:12px">— ${g.items.length === 1 ? 'מוצר אחד' : `${g.items.length} מוצרים`}${g.newCount ? `, ${g.newCount === 1 ? 'חדש אחד' : `${g.newCount} חדשים`}` : ''}</span></td></tr>`
      + items.map(x => itemRow(x, 'להזמין')).join('');
  }).join('');
  const shipRows = ships.map(x => row([contCell(x), esc(x.sup), esc(isoToDisplay(x.from || '')), `<b>${esc(isoToDisplay(x.arr || ''))}</b>`, `<b style="color:#C8322B">+${x.delayDays} ימים</b>`]));
  const newCount = m.current.filter(x => x.isNew).length;
  const title = [buy.length ? `${buy.length} מוצרים להזמין מ-${(m.bySupplier || []).length} ספקים` : '', make.length ? `${make.length} לייצור` : ''].filter(Boolean).join(' · ') || 'הכל טופל';
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 8px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#fff;border-radius:12px;overflow:hidden" dir="rtl">
  <tr><td style="background:#C8322B;color:#fff;padding:14px 18px;font-size:17px;font-weight:bold">תזכורת בוקר — ${esc(title)}${newCount ? ` <span style="font-size:13px;font-weight:normal">(${newCount} חדשים)</span>` : ''}</td></tr>
  ${m.resolved.length ? `<tr><td style="padding:12px 18px;background:#f0fdf4;font-size:13px;color:#166534"><b>טופלו מאז אתמול:</b> ${m.resolved.map(r => `${esc(r.name)} — ${esc(r.why)}`).join(' · ')}</td></tr>` : ''}
  ${buy.length ? `<tr><td style="padding:14px 18px"><h2 style="margin:0 0 4px;font-size:15px;color:#0f172a">להזמין מספקים</h2>
    <p style="margin:0 0 8px;font-size:12px;color:#64748b">מוצרים מרכזיים (A/B) שהמלאי + מה שבדרך לא יחזיק עד שהזמנה חדשה תגיע — לפי ספק. כל מוצר נשאר כאן כל בוקר עד שנפתחת הזמנה או שהמלאי עולה.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${cols('מומלץ')}${supBlocks}</table>${buy.length > shown ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">ועוד ${buy.length - shown} — הרשימה המלאה באתר</p>` : ''}</td></tr>` : ''}
  ${make.length ? `<tr><td style="padding:14px 18px;border-top:1px solid #e2e8f0"><h2 style="margin:0 0 4px;font-size:15px;color:#475569">לייצור — פחות דחוף</h2>
    <p style="margin:0 0 8px;font-size:12px;color:#64748b">ייצור עצמי שנשאר לו מלאי לפחות מ-${m.ownMadeDays || 14} יום (או שנגמר).</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${cols('לייצר')}${make.slice(0, 25).map(x => itemRow(x, 'לייצר')).join('')}</table></td></tr>` : ''}
  ${ships.length ? `<tr><td style="padding:14px 18px;border-top:1px solid #e2e8f0"><h2 style="margin:0 0 8px;font-size:15px;color:#0f172a">משלוחים שנדחו (${ships.length})</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${head(['מכולה', 'ספק', 'היה', 'עכשיו', 'דחייה'])}${shipRows.join('')}</table></td></tr>` : ''}
  <tr><td style="padding:12px 18px;border-top:1px solid #e2e8f0"><a href="${esc(siteUrl)}" style="color:#1F5FBF;font-size:13px">פתח באתר ←</a>
    <span style="color:#94a3b8;font-size:11px"> · מוצר שלא רוצים עליו תזכורת: בכרטיס המוצר באתר — "אל תזכיר לי" או "לפי הזמנה"${m.snoozedCount ? ` · ${m.snoozedCount} מוצרים מושתקים כרגע` : ''}</span></td></tr>
  </table></td></tr></table></body></html>`;
};

export const renderAlertsHtml = (a, { siteUrl }) => {
  const row = (cells) => `<tr>${cells.map(c => `<td align="right" style="padding:6px;border-bottom:1px solid #f1f5f9;font-size:13px">${c}</td>`).join('')}</tr>`;
  const head = (cells) => `<tr style="background:#f1f5f9;color:#475569">${cells.map(c => `<th align="right" style="padding:6px;font-size:12px;font-weight:600">${esc(c)}</th>`).join('')}</tr>`;
  const stockRows = a.stock.slice(0, 25).map(x => row([`<b>${esc(x.name)}</b><br><span style="color:#94a3b8;font-size:11px">${esc(x.k)} · ${esc(x.ownMade ? 'ייצור עצמי' : x.supplier || 'ספק לא ידוע')}</span>`,
    x.stock ?? '—', x.incoming || '—', x.coverDays == null ? '—' : `<b style="color:#C8322B">${x.coverDays} ימים</b>`, `${x.leadMonths} ח׳`, `<b>${(x.qty || 0).toLocaleString('en-US')}</b> ${x.ownMade ? 'לייצר' : 'להזמין'}`]));
  const shipRows = a.ships.map(x => row([contCell(x), esc(x.sup), esc(isoToDisplay(x.from || '')), `<b>${esc(isoToDisplay(x.arr || ''))}</b>`, `<b style="color:#C8322B">+${x.delayDays} ימים</b>`]));
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 8px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden" dir="rtl">
  <tr><td style="background:#C8322B;color:#fff;padding:14px 18px;font-size:17px;font-weight:bold">התראה — דורש טיפול עכשיו</td></tr>
  ${a.stock.length ? `<tr><td style="padding:14px 18px"><h2 style="margin:0 0 8px;font-size:15px;color:#0f172a">מוצרים מרכזיים שעומדים להיגמר (${a.stock.length})</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#475569">המלאי + מה שבדרך לא יחזיק עד שהזמנה חדשה תגיע.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${head(['מוצר', 'מלאי', 'בדרך', 'מספיק ל', 'זמן אספקה', 'מומלץ'])}${stockRows.join('')}</table>${a.stock.length > 25 ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">ועוד ${a.stock.length - 25} — הרשימה המלאה באתר</p>` : ''}</td></tr>` : ''}
  ${a.ships.length ? `<tr><td style="padding:14px 18px;border-top:1px solid #e2e8f0"><h2 style="margin:0 0 8px;font-size:15px;color:#0f172a">משלוחים שנדחו (${a.ships.length})</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${head(['מכולה', 'ספק', 'היה', 'עכשיו', 'דחייה'])}${shipRows.join('')}</table></td></tr>` : ''}
  <tr><td style="padding:12px 18px;border-top:1px solid #e2e8f0"><a href="${esc(siteUrl)}" style="color:#1F5FBF;font-size:13px">פתח באתר ←</a>
    <span style="color:#94a3b8;font-size:11px"> · כל פריט נשלח פעם אחת (מוצר — שוב רק אחרי שבועיים אם עדיין חסר)</span></td></tr>
  </table></td></tr></table></body></html>`;
};
