// ─── Procurement model (shared by the website and the server) ─────────
// The product plan, open-order enrichment and lead-time choice — pure functions,
// so the weekly email shows exactly the numbers the procurement page shows.
import { getDateVal, calcOrderPlan, isoToMonthKey, parseFlexDate, startOfToday, DAY_MS } from './data.js';

// ─── PROCUREMENT STATUS — one status and at most one note per row ─────
// Items whose Priority product family is "ייצור עצמי" are made in-house: they are planned
// under one pseudo-supplier of that name ("what to produce"), not ordered from a supplier.
export const OWN_MADE = 'ייצור עצמי';
export const isOwnMadeFamily = (fam) => /ייצור\s*עצמי/.test(String(fam || ''));
export const procStatus = (p) => {
  if (p.currentStock === null) return 'unknown';
  if (p.suggestedOrder > 0) return p.risk === 'critical' ? 'now' : 'soon';
  if (p.overdue || p.shortNowCoveredByPO) return 'watch';
  return 'ok';
};
export const PROC_STATUS_LABEL = { now:'להזמין עכשיו', soon:'להזמין בקרוב', watch:'לעקוב', ok:'תקין', unknown:'אין נתוני מלאי' };
// The single note shown under a product name — the most important one wins.
export const procChip = (p) => {
  if (p.overdue) return { t:`הזמנה באיחור ${p.overdue.maxDays} ימים`, k:'now' };
  if (p.shortNowCoveredByPO) return { t:'חסר עכשיו · מכוסה בהזמנה', k:'watch' };
  if (p.priceChangePct!=null && Math.abs(p.priceChangePct) >= 3) return { t:`מחיר קניה ${p.priceChangePct>0?'עלה':'ירד'} ${Math.abs(p.priceChangePct).toFixed(0)}%`, k: p.priceChangePct>0 ? 'watch' : 'muted' };
  if (p.lifecycle === 'dying') return { t:'מכירות צונחות', k:'watch' };
  if (p.isLimitedData && p.avgDataMonths > 0) return { t:`נתונים מ-${p.avgDataMonths} ח׳ בלבד`, k:'muted' };
  if (p.effectiveCoverMonths != null && p.effectiveCoverMonths > 12) return { t:`מלאי ל-${Math.round(p.effectiveCoverMonths)} חודשים`, k:'muted' };
  return null;
};

// ─── The product plan (one row per product) — used by the procurement page AND the server (weekly email) ───
// Pure: everything it needs comes in `ctx`; the same numbers wherever it runs.
export const computeProducts = (ctx) => {
  const { salesData, excludeCurrentMonth, avgWindowMonths, stockouts, skipStockoutMonths, stockMap, minStockMap, lastSupBySku, supplierMap, costMap, itemsExtra, currencyMap, exchangeRates, costHistory, purchBySku, leadFor, incomingMap, overdueByProduct, moqMap, monthsToStock, supplierConcentration, outliers, outlierDecisions } = ctx;
  if (!salesData.length) return [];
  const map = {};
  salesData.forEach(row => {
    const key = row.sku||row.description; if (!key) return;
    if (!map[key]) map[key] = { sku:row.sku||'', name:row.description||key, monthlyData:{}, monthlyRev:{}, totalQty:0, totalRev:0 };
    map[key].totalQty += row.quantity||0;
    map[key].totalRev += row.total||0;
    if (row.date) {
      map[key].monthlyData[row.date] = (map[key].monthlyData[row.date]||0)+(row.quantity||0);
      map[key].monthlyRev[row.date]  = (map[key].monthlyRev[row.date]||0)+(row.total||0);
    }
  });
  // All months in dataset (used for sparkline / seasonality base)
  // Most customers are invoiced only at month-end/start of next month, so the
  // single most recent calendar month is almost always incomplete. When the
  // global toggle is on, drop it everywhere here — sparklines, seasonality,
  // averages, trend, forecast — rather than let a partial month masquerade as
  // a real data point (which would otherwise look like a false decline).
  let allMonthsFull = [...new Set(salesData.map(d=>d.date).filter(Boolean))].sort((a,b)=>getDateVal(a)-getDateVal(b));
  if (excludeCurrentMonth && allMonthsFull.length > 1) allMonthsFull = allMonthsFull.slice(0, -1);
  // Window months — for average calculation (default: last 12 months)
  const allMonths = avgWindowMonths === 0
    ? allMonthsFull
    : allMonthsFull.slice(-avgWindowMonths);
  const windowMonthSet = new Set(allMonths);
  // ── ABC on the SAME window as the averages ──
  // Previously ABC used all-time revenue while averages used the window, so a
  // product that was big two years ago and has since faded stayed an "A".
  Object.values(map).forEach(p => {
    p.windowRev = Object.entries(p.monthlyRev).reduce((s,[d,v]) => windowMonthSet.has(d) ? s+v : s, 0);
    p.monthlyDataWindow = Object.fromEntries(Object.entries(p.monthlyData).filter(([d]) => windowMonthSet.has(d)));
  });
  const totalWindowRev = Object.values(map).reduce((a,c)=>a+Math.max(0,c.windowRev),0);
  let cumulative = 0;
  const sorted = Object.values(map).sort((a,b)=>b.windowRev-a.windowRev || b.totalRev-a.totalRev);
  sorted.forEach(p => {
    const pct = totalWindowRev>0 ? (Math.max(0,p.windowRev)/totalWindowRev)*100 : 0;
    // Classify by the running share BEFORE this product — so the product
    // that crosses the 80% line is still an A (otherwise a dominant best
    // seller holding e.g. 85% alone would be labelled B).
    const before = cumulative;
    cumulative += pct; p.revPct = pct;
    p.abc = p.windowRev<=0 ? 'C' : before<80 ? 'A' : before<95 ? 'B' : 'C';
  });
  const MONTH_ABBR = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
  const lastMonthStr = allMonths[allMonths.length-1] || '';
  const lastMonIdx = MONTH_ABBR.indexOf(lastMonthStr.split('-')[0]);
  const nextMonIdx = lastMonIdx !== -1 ? (lastMonIdx+1)%12 : -1;
  return sorted.map(p => {
    const key = p.sku||p.name;
    // ── Average monthly demand — calendar-based, zero-filled ──
    // Averaged over every calendar month from the product's FIRST sale
    // within the window through the end of the window — including months
    // with zero sales, so intermittent products aren't overstated. It still
    // avoids diluting a genuinely new product by NOT counting calendar
    // months before its first sale.
    const firstActiveIdx = allMonths.findIndex(m => (p.monthlyDataWindow[m]||0) > 0);
    let avgMonthly, avgDataMonths, isLimitedData, cappedVals = [];
    // Months the product was out of stock (≥ half the month) — low sales there were no demand signal.
    const so = stockouts[p.sku] || null;
    const outMonthKeys = so ? new Set(so.monthsOut.map(m => isoToMonthKey(m + '-01'))) : new Set();
    let skippedMonths = [];
    if (firstActiveIdx === -1) {
      avgMonthly = 0; avgDataMonths = 0; isLimitedData = true;
    } else {
      let relevantMonths = allMonths.slice(firstActiveIdx);
      if (skipStockoutMonths && outMonthKeys.size) {
        const kept = relevantMonths.filter(m => !outMonthKeys.has(m));
        if (kept.length >= 3) { skippedMonths = relevantMonths.filter(m => outMonthKeys.has(m)); relevantMonths = kept; }
      }
      const rawVals = relevantMonths.map(m => p.monthlyDataWindow[m]||0);
      const activeVals = rawVals.filter(v => v>0);
      // Cap (never drop) a rare abnormally-large single month — e.g. one
      // bulk order — at 3× the median of active months.
      cappedVals = rawVals;
      if (activeVals.length >= 3) {
        const sortedActive = [...activeVals].sort((a,b)=>a-b);
        const cap = sortedActive[Math.floor(sortedActive.length/2)] * 3;
        cappedVals = rawVals.map(v => v > cap ? cap : v);
      }
      avgMonthly = cappedVals.reduce((a,b)=>a+b,0) / relevantMonths.length;
      avgDataMonths = relevantMonths.length;
      isLimitedData = avgDataMonths < 3;
    }
    const sparkline = allMonths.slice(-6).map(m=>({m, v:p.monthlyData[m]||0}));
    const trendSeries = allMonths.slice(-12).map(m=>({month:m, qty:p.monthlyData[m]||0}));
    const last3 = allMonths.slice(-3).reduce((a,m)=>a+(p.monthlyData[m]||0),0)/3;
    const prev3 = allMonths.slice(-6,-3).reduce((a,m)=>a+(p.monthlyData[m]||0),0)/3;
    const trend = prev3>0?((last3-prev3)/prev3)*100:0;
    const currentStock = stockMap[key]??stockMap[p.sku]??stockMap[p.name]??null;
    const minStock     = minStockMap[key]??minStockMap[p.sku]??minStockMap[p.name]??null;
    // Last supplier invoice for this SKU — fills supplier / price when the item card has none.
    const lastP = lastSupBySku[p.sku] ?? lastSupBySku[key] ?? null;
    const ex = itemsExtra[p.sku] ?? itemsExtra[key] ?? null;
    const ownMade = isOwnMadeFamily(ex?.fam);
    const supplier     = ownMade ? OWN_MADE : (supplierMap[key]??supplierMap[p.sku]??supplierMap[p.name]??lastP?.s??null);
    const catalogCost  = costMap[key]??costMap[p.sku]??costMap[p.name]??null;
    const costFromPurchase = catalogCost==null && lastP && lastP.p>0;
    // Last resort: Priority's average cost (always in ₪) when there is no item-card price and no supplier invoice.
    const costFromAvg = catalogCost==null && !costFromPurchase && ex?.avgCost>0;
    const currency     = costFromPurchase ? lastP.cur : costFromAvg ? 'ILS' : (currencyMap[key]??currencyMap[p.sku]??currencyMap[p.name]??null);
    // ── Unit cost — original currency AND ₪-converted ──
    // unitCost (₪) feeds every aggregate; unitCostOriginal stays in the
    // supplier's currency for per-row / supplier-facing displays. A foreign
    // cost with no rate in Settings is null (flagged), never silently 1:1.
    const unitCostOriginal = costFromPurchase ? lastP.p : costFromAvg ? ex.avgCost : catalogCost;
    const isForeignCost = currency && currency!=='ILS';
    // Rate: Settings first, else the rate Priority recorded on the last supplier invoice in that currency.
    const fxRate = !isForeignCost ? 1 : (exchangeRates?.[currency]>0 ? exchangeRates[currency] : (lastP && lastP.cur===currency && lastP.rate>0 ? lastP.rate : null));
    const costUsable = unitCostOriginal!=null && fxRate!=null;
    const unitCost = costUsable ? unitCostOriginal*fxRate : null;
    const costConverted = costUsable && isForeignCost ? currency : null;
    const costCurrencyBlocked = unitCostOriginal!=null && !costUsable ? currency : null;
    // ── Purchase price movement (from import history) ──
    const hist = costHistory[key]??costHistory[p.sku]??costHistory[p.name]??null;
    let priceChangePct = null, prevPrice = null, priceChangedAt = null;
    if (hist && hist.length >= 2) {
      const last = hist[hist.length-1], prev = hist[hist.length-2];
      if (prev.c > 0 && last.cur === prev.cur) { priceChangePct = (last.c-prev.c)/prev.c*100; prevPrice = prev.c; priceChangedAt = last.d; }
    }
    // No change recorded from item-card imports? Use the real invoice prices:
    // latest supplier-invoice price vs the previous different price in the same currency.
    if (priceChangePct == null) {
      const buys = (purchBySku[p.sku] || purchBySku[key] || []).filter(b => b.p > 0);
      if (buys.length >= 2) {
        const last = buys[0];
        const prev = buys.find(b => b.cur === last.cur && Math.abs(b.p - last.p) > 1e-6 && b.d < last.d);
        if (prev && (unitCostOriginal == null || Math.abs(last.p - unitCostOriginal) <= unitCostOriginal*0.02)) { priceChangePct = (last.p-prev.p)/prev.p*100; prevPrice = prev.p; priceChangedAt = last.d; }
      }
    }
    const avgDaily      = avgMonthly / 30;
    const coverageMonths = (currentStock!==null&&avgMonthly>0)?currentStock/avgMonthly:null;
    const coverageDays   = (currentStock!==null&&avgDaily>0)?Math.round(currentStock/avgDaily):null;
    // ── Seasonality index — average per calendar month vs overall annual average ──
    const monthlyAvgs = MONTH_ABBR.map(mName => {
      const vals = Object.entries(p.monthlyData).filter(([d])=>d.startsWith(mName+'-')).map(([,v])=>v);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    });
    const monthlyByYear = MONTH_ABBR.map(mName => {
      const yearMap = {};
      Object.entries(p.monthlyData).forEach(([date, qty]) => {
        if (!date) return;
        const hyphenIdx = date.indexOf('-');
        if (hyphenIdx === -1) return;
        if (date.slice(0, hyphenIdx) !== mName) return;
        const yrRaw = date.slice(hyphenIdx + 1);
        const year = yrRaw.length <= 2 ? '20' + yrRaw.padStart(2,'0') : yrRaw;
        yearMap[year] = (yearMap[year]||0) + qty;
      });
      return Object.entries(yearMap).map(([year, qty]) => ({ year, qty })).sort((a,b) => a.year.localeCompare(b.year));
    });
    const annualAvg = monthlyAvgs.reduce((a,b)=>a+b,0)/12 || 1;
    // Only trust the seasonal index with 2+ years and 6+ distinct months.
    const monthsWithData = monthlyAvgs.filter(v=>v>0).length;
    const yearsOfData = new Set(monthlyByYear.flat().map(y=>y.year)).size;
    const seasonalityReliable = yearsOfData >= 2 && monthsWithData >= 6;
    const seasonalityIdx = monthlyAvgs.map(v => +(v/annualAvg).toFixed(2));
    // ── Forecast next month ──
    const recent3 = allMonths.slice(-3);
    const recent3Avg = recent3.reduce((s,m)=>s+(p.monthlyData[m]||0),0) / Math.max(recent3.length,1);
    const trendFactor = Math.max(0.75, Math.min(1.4, 1 + (trend||0)/250));
    let seasonalFactor = 1;
    if (seasonalityReliable && nextMonIdx !== -1 && seasonalityIdx[nextMonIdx] > 0) {
      seasonalFactor = Math.max(0.5, Math.min(2.0, seasonalityIdx[nextMonIdx]));
    }
    const forecastNext = Math.round(recent3Avg * trendFactor * seasonalFactor);
    // ── Demand variability — zero-filled, same months & same values as the average ──
    // Previously computed only over months WITH sales, across all history,
    // against a zero-filled windowed mean — three different bases mixed
    // together, which distorted both safety stock and X/Y/Z.
    const stdDev = cappedVals.length > 1
      ? Math.sqrt(cappedVals.reduce((s,v)=>s+Math.pow(v-avgMonthly,2),0) / cappedVals.length)
      : 0;
    const cv = avgMonthly > 0 ? stdDev / avgMonthly : 0;
    const xyz = cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z';
    const abcXyz = (p.abc||'C') + xyz;

    // ── Effective lead time: per-supplier override if set, else the global slider ──
    const lf = leadFor(supplier);
    const effectiveLeadTime = lf.months;
    const leadTimeOverridden = lf.source === 'manual';
    const leadTimeSource = lf.source;

    // ── Lifecycle: compare last 3 vs previous 3 months ──
    const lcTrend  = prev3>0 ? (last3-prev3)/prev3*100 : 0;
    const lifecycle = lcTrend > 20 ? 'growing' : lcTrend > -20 ? 'stable' : lcTrend > -50 ? 'declining' : 'dying';

    // ── Incoming orders (already on the way) ──
    const incomingQty = incomingMap[key] ?? incomingMap[p.sku] ?? incomingMap[p.name] ?? 0;
    const overdue = overdueByProduct[key] ?? overdueByProduct[p.sku] ?? overdueByProduct[p.name] ?? null;
    const effectiveStock = (currentStock??0) + incomingQty;
    const effectiveCoverDays = (currentStock!==null && avgDaily > 0) ? Math.round(effectiveStock / avgDaily) : null;
    const effectiveCoverMonths = (currentStock!==null && avgMonthly > 0) ? effectiveStock / avgMonthly : null;

    // ── Suggested order (shared with the what-if scenario) ──
    const moq = moqMap[key] ?? moqMap[p.sku] ?? moqMap[p.name] ?? null;
    const plan = calcOrderPlan({ avgMonthly, stdDev, abc:p.abc, leadTime:effectiveLeadTime, leadTimeStd: lf.std, monthsToStock, seasonalityIdx, seasonalityReliable, nextMonIdx, effectiveStock, minStock, moq });
    const { suggestedOrder, suggestedOrderRaw, suggestedOrderFlat, safetyStock, projectedDemand, serviceLevel, seasonalApplied } = plan;
    const orderCost = (suggestedOrder>0&&unitCost)?suggestedOrder*unitCost:null;
    const orderCostOriginal = (suggestedOrder>0&&unitCostOriginal)?suggestedOrder*unitCostOriginal:null;

    // ── Risk — judged on stock + what's already on the way ──
    // A product at 0 with 500 units arriving used to show "critical — order
    // now" while the order column said "enough". Risk now reflects whether
    // ACTION is needed; the physical shortage is kept as a separate flag.
    const riskOf = (stock, covM) => stock<=0 ? 'critical'
      : covM < effectiveLeadTime ? 'critical'
      : (minStock ? stock < minStock : covM < monthsToStock) ? 'low' : 'ok';
    const physicalRisk = currentStock!==null ? riskOf(currentStock, coverageMonths ?? (currentStock>0?Infinity:0)) : 'unknown';
    const risk = currentStock!==null ? riskOf(effectiveStock, effectiveCoverMonths ?? (effectiveStock>0?Infinity:0)) : 'unknown';
    const shortNowCoveredByPO = incomingQty>0 && (physicalRisk==='critical'||physicalRisk==='low') && physicalRisk!==risk;

    // ── Combined risk score (0-100) — a prioritization aid, not a forecast ──
    // Weights: coverage 40% · demand volatility 20% · XYZ 15% · lead time 15% · supplier concentration 10%.
    const coverageRiskScore = { critical:100, low:60, ok:12, unknown:45 }[risk];
    const volatilityRiskScore = Math.min(100, Math.abs(trend||0));
    const xyzRiskScore = { X:10, Y:50, Z:100 }[xyz] ?? 50;
    // Lead time is in MONTHS. The old formula divided by 60 as if it were
    // days, so a 3-month supplier scored 5/100. 3+ months = max risk.
    const leadTimeRiskScore = Math.min(100, (effectiveLeadTime/3)*100);
    const supplierRiskScore = (supplier && supplierConcentration.totalAssigned>0)
      ? Math.min(100, (supplierConcentration.counts[supplier]||0) / supplierConcentration.totalAssigned * 100 * 3)
      : 0;
    const riskScore = Math.round(
      coverageRiskScore*0.40 + volatilityRiskScore*0.20 + xyzRiskScore*0.15 + leadTimeRiskScore*0.15 + supplierRiskScore*0.10
    );

    const out = { ...p, key, avgMonthly, avgDataMonths, isLimitedData, windowMonths: allMonths.length, avgDaily, sparkline, trendSeries, trend, forecastNext, seasonalFactor, seasonalityReliable, seasonalityIdx, monthlyAvgs, cv, stdDev, xyz, abcXyz, safetyStock, serviceLevel, projectedDemand, seasonalApplied, suggestedOrderFlat, lifecycle, currentStock, unitCost, unitCostOriginal, costConverted, costCurrencyBlocked, priceChangePct, prevPrice, priceChangedAt, minStock, supplier, currency, moq, effectiveLeadTime, leadTimeOverridden, leadTimeSource, leadTimeStd: lf.std, nextMonIdx, coverageMonths, coverageDays, incomingQty, overdue, effectiveStock, effectiveCoverDays, effectiveCoverMonths, suggestedOrder, suggestedOrderRaw, orderCost, orderCostOriginal, risk, physicalRisk, shortNowCoveredByPO, riskScore };
    out.status = procStatus(out);
    out.statusRank = { now:0, soon:1, watch:2, unknown:3, ok:4 }[out.status];
    out.chip = procChip(out);
    out.costFromPurchase = costFromPurchase; out.costFromAvg = costFromAvg; out.lastPurchase = lastP;
    out.family = ex?.fam || ''; out.ownMade = ownMade; out.avgCostPriority = ex?.avgCost ?? null; out.listPrice = ex?.listPrice ?? null;
    out.lastSalePriority = ex?.lastSale || ''; out.lastBuyPriority = ex?.lastBuy || '';
    out.stockout = so; out.skippedMonths = skippedMonths;
    out.lostQty = so && so.outDays && avgMonthly > 0 ? Math.round(so.outDays * avgMonthly / 30) : 0;
    out.avgPrice = p.totalQty > 0 ? p.totalRev / p.totalQty : null;
    const ol = outliers[p.sku] || outliers[key];
    out.outliers = ol || null;
    out.outlierPending = ol ? ol.lines.filter(l => !outlierDecisions[l.id]).length : 0;
    out.outlierCapped = ol ? ol.lines.filter(l => outlierDecisions[l.id] === 'cap').length : 0;
    return out;
  });
};

// Open purchase orders with ₪ value, PO-vs-catalog price and lateness.
export const enrichOrders = ({ openOrders = [], currencyMap = {}, exchangeRates = {}, costMap = {} }) => openOrders.map(o => {
  const currency = currencyMap[o.productKey]??currencyMap[o.productName]??null;
  const isForeign = currency && currency!=='ILS';
  const rate = !isForeign ? 1 : (exchangeRates?.[currency]>0 ? exchangeRates[currency] : null);
  const costUsable = o.value!=null && rate!=null;
  const valueILS = costUsable ? o.value*rate : null;
  const costCurrencyBlocked = o.value>0 && isForeign && rate==null ? currency : null;
  const unitPriceOriginal = (o.value>0 && o.orderedQty>0) ? o.value/o.orderedQty : null;
  const catalogCost = costMap[o.productKey]??costMap[o.productName]??null;
  const poPriceDiffPct = (unitPriceOriginal!=null && catalogCost>0) ? ((unitPriceOriginal-catalogCost)/catalogCost)*100 : null;
  const expectedDt = parseFlexDate(o.expectedDate);
  const today = startOfToday();
  const isOverdue = !!expectedDt && expectedDt < today && o.status !== 'received';
  const daysLate = isOverdue ? Math.round((today - expectedDt)/DAY_MS) : 0;
  return { ...o, currency, valueILS, costCurrencyBlocked, costConverted: costUsable && isForeign ? currency : null, unitPriceOriginal, catalogCost, poPriceDiffPct, isOverdue, daysLate };
});
export const overdueByProductOf = (ordersEnriched) => {
  const m = {};
  ordersEnriched.filter(o => o.isOverdue).forEach(o => { const k=o.productKey||o.productName; if(!m[k]) m[k]={qty:0,maxDays:0}; m[k].qty+=o.orderedQty||0; m[k].maxDays=Math.max(m[k].maxDays,o.daysLate); });
  return m;
};
export const incomingMapOf = (openOrders) => {
  const map = {};
  openOrders.filter(o=>o.status!=='received').forEach(o => { const k = o.productKey||o.productName; map[k] = (map[k]||0) + (o.orderedQty||0); });
  return map;
};
export const supplierConcentrationOf = (supplierMap) => {
  const counts = {}; let totalAssigned = 0;
  Object.values(supplierMap).forEach(s => { if (!s) return; counts[s] = (counts[s]||0) + 1; totalAssigned++; });
  return { counts, totalAssigned };
};
// Which lead time a supplier gets: the manual setting first, then the computed one (3+ deliveries), then the global value.
export const makeLeadFor = ({ leadStats = {}, leadTimeMap = {}, leadAddTransit = {}, leadTime }) => (sup) => {
  const st = sup ? leadStats[sup] : null;
  const computedDays = st && st.n >= 3 ? st.median + (leadAddTransit[sup] ? st.transit : 0) : null;
  const std = st && st.n >= 3 ? st.std / 30 : 0;
  if (sup && leadTimeMap[sup] != null) return { months: leadTimeMap[sup], source: 'manual', std, computedDays, st };
  if (computedDays != null) return { months: Math.max(0.25, Math.round(computedDays / 30 * 10) / 10), source: 'computed', std, computedDays, st };
  return { months: leadTime, source: 'global', std: 0, computedDays: null, st };
};
