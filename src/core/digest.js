// ─── Weekly summary (computed on the server from the stored data) ──────
// Uses the same model as the procurement page (procModel.js), so the numbers
// in the email match the website.
import { mergeLinesIntoMonthly, detectOutliers, saleLineId, supplierLeadTimes, matchShipSupplier, shipmentStage, daysBetween, stockTimelines, stockoutSummary,
  purchasePriceHistory, priceIncreases, returnsAnalysis, brandsAnalysis, DAY_MS, isoToDisplay } from './data.js';
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

// state: { app: {key: parsed value}, sets: {key: value} } — exactly what the website stores.
export const buildDigest = ({ app = {}, sets = {} }, { now = Date.now() } = {}) => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = iso(now);
  const salesLinesAll = sets.procSalesLines || [];
  const salesLines = salesLinesAll.filter(l => !l.x);
  const purchaseLines = sets.procPurchaseLines || [];
  const shipments = sets.procShipments || [];
  const stockMap = app.procurementStock || {};
  const supplierMap = app.procurementSupplier || {};
  const costMap = app.procurementCost || {}, currencyMap = app.procurementCurrency || {};
  const exchangeRates = app.exchangeRates || {};
  const openOrders = app.openOrders || [];
  const shipSupOverride = app.procShipSupplierMap || {};

  // outliers → the plan's sales (same as the page)
  const outliers = detectOutliers(salesLines, { sinceIso: iso(now - 365 * DAY_MS) });
  const decisions = app.procOutlierDecisions || {};
  const caps = {}; Object.values(outliers).forEach(o => o.lines.forEach(l => { if (decisions[l.id] === 'cap') caps[l.id] = l.cap; }));
  const linesForPlan = Object.keys(caps).length ? salesLines.map(l => { const c = caps[saleLineId(l)]; return c != null ? { ...l, q: c } : l; }) : salesLines;
  const salesData = mergeLinesIntoMonthly(sets.dashboardSalesData || [], linesForPlan);

  // stock history → stockouts
  const from = iso(now - 364 * DAY_MS);
  const skus = [...new Set(salesLines.filter(l => l.d >= from).map(l => l.k))].filter(k => k && stockMap[k] != null);
  const stockouts = stockoutSummary(stockTimelines({ stockHistory: sets.stockHistory, currentStock: stockMap, salesLines, purchaseLines, skus, fromIso: from, toIso: today }));

  // lead times
  const knownSuppliers = [...new Set([...purchaseLines.map(l => l.s), ...Object.values(supplierMap).filter(Boolean), ...openOrders.map(o => o.supplier).filter(Boolean)])];
  const supOf = (s) => shipSupOverride[s.sup] === '' ? null : (shipSupOverride[s.sup] ?? matchShipSupplier(s.sup, knownSuppliers));
  const transitBySupplier = {};
  shipments.forEach(s => { const sup = supOf(s); if (sup && s.dep && s.arr) { const d = daysBetween(s.dep, s.arr); if (d > 0 && d < 120) (transitBySupplier[sup] ||= []).push(d); } });
  const leadStats = supplierLeadTimes({ purchaseLines, poMeta: sets.procPoMeta || {}, transitBySupplier, sinceIso: iso(now - 540 * DAY_MS) });
  const leadFor = makeLeadFor({ leadStats, leadTimeMap: app.procurementLeadTime || {}, leadAddTransit: app.procLeadAddTransit || {}, leadTime: 1 });

  const ordersEnriched = enrichOrders({ openOrders, currencyMap, exchangeRates, costMap });
  const purchBySku = {}, lastSupBySku = {};
  purchaseLines.forEach(l => { if (l.junk) return; (purchBySku[l.k] ||= []).push(l); if (!lastSupBySku[l.k]) lastSupBySku[l.k] = l; });
  const products = computeProducts({ salesData, excludeCurrentMonth: app.excludeCurrentMonth !== false, avgWindowMonths: 12, stockouts, skipStockoutMonths: app.procSkipStockoutMonths !== '0' && app.procSkipStockoutMonths !== 0,
    stockMap, minStockMap: app.procurementMinStock || {}, lastSupBySku, supplierMap, costMap, itemsExtra: sets.procItemsExtra || {}, currencyMap, exchangeRates,
    costHistory: app.procurementCostHistory || {}, purchBySku, leadFor, incomingMap: incomingMapOf(openOrders), overdueByProduct: overdueByProductOf(ordersEnriched),
    moqMap: app.procurementMOQ || {}, monthsToStock: 2, supplierConcentration: supplierConcentrationOf(supplierMap), outliers, outlierDecisions: decisions });

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
  const hist = purchasePriceHistory(purchaseLines);
  const names = app.procurementNames || {};
  const priceUps = priceIncreases(hist, { sinceIso: iso(now - 7 * DAY_MS) }).map(x => ({ ...x, name: names[x.k] || hist[x.k]?.[0]?.n || x.k }));

  // 4. excess stock
  const excess = excessOf(products, 3);
  const excessValue = excess.reduce((a, p) => a + (p.excessValue || 0), 0);
  const excessPOs = excess.filter(p => p.poExcess > 0);

  // 5. sales: last 7 days vs the same 7 days a year ago; brands; returns
  const sum = (a, b) => salesLinesAll.filter(l => l.d >= a && l.d <= b && l.v > 0).reduce((s, l) => s + l.v, 0);
  const w0 = iso(now - 6 * DAY_MS), ly0 = iso(now - (365 + 6) * DAY_MS), ly1 = iso(now - 365 * DAY_MS);
  const week = { v: sum(w0, today), lastYear: sum(ly0, ly1), from: w0, to: today };
  const brands = brandsAnalysis(salesLinesAll, { itemsExtra: sets.procItemsExtra || {}, stock: stockMap, fromIso: iso(now - 30 * DAY_MS), toIso: today, prevFromIso: iso(now - 395 * DAY_MS) })
    .filter(b => b.prevV > 0 && b.v > 0 && !/ללא משפחה|כללית/.test(b.name));
  // prevV above spans a year; compare to the same 30 days last year instead
  const brandPrev = {};
  salesLinesAll.forEach(l => { if (l.x || !l.k || l.d < iso(now - 395 * DAY_MS) || l.d > iso(now - 365 * DAY_MS)) return; const f = (sets.procItemsExtra?.[l.k]?.fam || '').trim() || 'ללא משפחה'; brandPrev[f] = (brandPrev[f] || 0) + l.v; });
  const brandMoves = brands.map(b => ({ name: b.name, v: b.v, prev: brandPrev[b.name] || 0 })).filter(b => b.prev > 0)
    .map(b => ({ ...b, pct: (b.v / b.prev - 1) * 100 })).sort((a, b) => b.pct - a.pct);
  const ret = returnsAnalysis(salesLinesAll, { fromIso: iso(now - 30 * DAY_MS), toIso: today });
  const returnSpikes = ret.products.filter(p => p.rate != null && p.rate >= 10 && p.retQ >= 3).slice(0, 8);

  return {
    generatedAt: now, today,
    syncAt: app.prioritySyncAt ? Number(app.prioritySyncAt) : null,
    toOrder, toOrderTotal: toOrder.reduce((a, s) => a + s.value, 0), toOrderNow: products.filter(p => p.status === 'now' && !p.ownMade).length,
    toMake: products.filter(p => p.ownMade && p.suggestedOrder > 0).length, toMakeNow: products.filter(p => p.ownMade && p.status === 'now').length,
    latePOs: Object.values(lateBySup).map(s => ({ ...s, pos: [...s.pos] })).sort((a, b) => b.maxDays - a.maxDays), latePOLines: latePOs.length,
    delayed: delayed.slice(0, 10).map(s => ({ cont: s.cont, sup: s.sup, arr: s.arr, from: s.change?.from, delayDays: s.delayDays })),
    priceUps: priceUps.slice(0, 15), excessValue, excessPOs: excessPOs.slice(0, 10).map(p => ({ name: p.name, sku: p.sku, supplier: p.supplier, poExcess: p.poExcess, value: p.poExcessValue })), excessPOCount: excessPOs.length,
    week, brandUp: brandMoves.slice(0, 3), brandDown: brandMoves.slice(-3).reverse().filter(b => b.pct < 0), returnSpikes,
  };
};

// ─── The email itself (RTL HTML; tables because mail clients ignore most CSS) ───
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ils = (v) => '₪' + Math.round(v || 0).toLocaleString('en-US');
const pctS = (v) => `<span dir="ltr">${v > 0 ? '+' : ''}${v.toFixed(0)}%</span>`;
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
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden" dir="rtl">
    <tr><td style="background:#0f172a;color:#fff;padding:18px 22px"><div style="font-size:18px;font-weight:bold">סיכום שבועי — רכש ומכירות</div>
      <div style="font-size:12px;opacity:.75;margin-top:4px">${esc(isoToDisplay(d.today))}${d.syncAt ? ` · נתוני Priority מ-${esc(new Date(d.syncAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}` : ''}</div></td></tr>
    ${sec('מה להזמין השבוע', p(`<b>${d.toOrderNow}</b> מוצרים להזמין עכשיו · שווי משוער של כל ההמלצות <b>${ils(d.toOrderTotal)}</b>`) +
      (d.toMake ? p(`ייצור עצמי: <b>${d.toMake}</b> מוצרים לייצר${d.toMakeNow ? ` (מהם <b style="color:#C8322B">${d.toMakeNow}</b> דחופים)` : ''}`) : '') +
      table(['ספק', 'מוצרים', 'דחוף', 'שווי משוער', 'זמן אספקה'], d.toOrder.slice(0, 12).map(s => [esc(s.name), s.n, s.now ? `<b style="color:#C8322B">${s.now}</b>` : '—', s.value ? ils(s.value) : '—', `${s.lead} ח׳`])), proc)}
    ${sec('מה בדרך — באיחור ונדחה', p(`הזמנות רכש באיחור: <b>${d.latePOLines}</b> שורות`) +
      table(['ספק', 'שורות', 'איחור מרבי', 'הזמנות'], d.latePOs.slice(0, 8).map(s => [esc(s.name), s.lines, `${s.maxDays} ימים`, esc(s.pos.slice(0, 4).join(', '))])) +
      (d.delayed.length ? '<div style="height:10px"></div>' + table(['מכולה', 'ספק', 'הגעה', 'נדחה'], d.delayed.map(s => [esc(s.cont || '—'), esc(s.sup), esc(isoToDisplay(s.arr)), `${s.delayDays} ימים (היה ${esc(isoToDisplay(s.from))})`])) : ''), proc)}
    ${sec('התייקרויות בחשבוניות ספק השבוע', table(['מוצר', 'ספק', 'קודם', 'עכשיו', 'שינוי'], d.priceUps.map(x => [esc(x.name), esc(x.s), `${x.prevP} ${esc(x.cur)}`, `<b>${x.p} ${esc(x.cur)}</b>`, `<b style="color:#C8322B">${pctS(x.pct)}</b>`])), proc)}
    ${sec('מלאי עודף', p(`כסף שיושב במלאי עודף: <b>${ils(d.excessValue)}</b> · הזמנות פתוחות על מוצרים בעודף: <b>${d.excessPOCount}</b>`) +
      table(['מוצר', 'ספק', 'בהזמנה מיותרת', 'שווי'], d.excessPOs.map(x => [esc(x.name), esc(x.supplier || '—'), `${x.poExcess} יח׳`, x.value ? ils(x.value) : '—'])), proc)}
    ${sec('מכירות', p(`7 הימים האחרונים: <b>${ils(d.week.v)}</b>${d.week.lastYear ? ` · אותו שבוע אשתקד ${ils(d.week.lastYear)} (<b>${pctS((d.week.v / d.week.lastYear - 1) * 100)}</b>)` : ''}`) +
      (d.brandUp.length ? p(`מותגים בעלייה (30 יום מול אשתקד): ${d.brandUp.map(b => `${esc(b.name)} ${pctS(b.pct)}`).join(' · ')}`) : '') +
      (d.brandDown.length ? p(`מותגים בירידה: ${d.brandDown.map(b => `${esc(b.name)} ${pctS(b.pct)}`).join(' · ')}`) : '') +
      (d.returnSpikes.length ? '<div style="height:6px"></div>' + p('<b>מוצרים עם הרבה החזרות ב-30 הימים האחרונים:</b>') + table(['מוצר', 'נמכרו', 'חזרו', 'אחוז'], d.returnSpikes.map(x => [esc(x.n), x.soldQ, x.retQ, `<b style="color:#C8322B">${x.rate.toFixed(0)}%</b>`])) : ''), proc)}
    <tr><td style="padding:14px 22px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">נשלח אוטומטית כל יום ראשון מהאתר BizData · הנתונים מ-Priority (קריאה בלבד)</td></tr>
  </table></td></tr></table></body></html>`;
};
