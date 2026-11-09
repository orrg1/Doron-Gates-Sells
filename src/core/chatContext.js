// ─── AI assistant: what data goes with the question ───────────────────────────
// The model only knows what we send it. So: find the products / suppliers the question is about
// (by SKU first — "DOR.S" — then by words of the name), and send their real numbers from the
// invoice lines: monthly quantities, customers, and — for two products or more — how often they
// were sold on the same invoice and how often apart.

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const STOP = new Set(['האם', 'היה', 'הייתה', 'היו', 'מכירה', 'מכירות', 'נמכר', 'נמכרו', 'נמכרה', 'מוצר', 'מוצרים', 'כמה', 'מה', 'של', 'את', 'עם', 'בלי',
  'גם', 'או', 'לא', 'כן', 'אני', 'שלי', 'יש', 'אין', 'ספק', 'ספקים', 'לקוח', 'לקוחות', 'בנפרד', 'ביחד', 'יחד', 'השנה', 'שנה', 'חודש', 'חודשים', 'מתי', 'איך', 'למה',
  'כל', 'הם', 'הן', 'זה', 'זו', 'על', 'לפי', 'בין', 'אחרי', 'לפני', 'עד', 'מאז', 'תן', 'תראה', 'הראה', 'רשימה', 'הכי', 'יותר', 'פחות', 'and', 'the']);
// words of the question: keeps SKU-like tokens whole (DOR.S, 188589, BULL-600)
const wordsOf = (q) => String(q || '').split(/[\s,?!:;()"'״׳]+/).map(w => w.replace(/^[-–.]+|[-–.]+$/g, '')).filter(Boolean);
// a Hebrew word may carry a one-letter prefix (ו/ה/ב/ל/מ/ש): "והמנוע" → "המנוע"/"מנוע"
const inName = (name, t) => name.includes(t) || (/^[והבלמש]/.test(t) && t.length >= 4 && name.includes(t.slice(1)));

export const findProductsInQuestion = (question, products) => {
  const words = wordsOf(question);
  const skuIdx = new Map(); products.forEach(p => { if (p.sku) skuIdx.set(norm(p.sku), p); });
  const hits = new Map();
  // 1) exact SKU (ignoring case, dots, dashes)
  words.forEach(w => { const p = skuIdx.get(norm(w)); if (p) hits.set(p.sku, { p, how: 'מק"ט' }); });
  // 2) SKU prefix ("DOR" → DOR.S, DOR.R …) — only for latin/number tokens of 3+ chars that matched no SKU exactly
  words.filter(w => /^[A-Za-z0-9][A-Za-z0-9.\-_/]{2,}$/.test(w) && !skuIdx.has(norm(w))).forEach(w => {
    const nw = norm(w); const m = products.filter(p => p.sku && norm(p.sku).startsWith(nw));
    if (m.length && m.length <= 12) m.forEach(p => { if (!hits.has(p.sku)) hits.set(p.sku, { p, how: 'תחילת מק"ט' }); });
  });
  // 3) words of the name (when the SKUs did not already answer it)
  if (hits.size < 2) {
    const terms = words.map(w => w.toLowerCase()).filter(w => w.length >= 2 && !STOP.has(w));
    if (terms.length) {
      const scored = products.map(p => {
        const name = String(p.name || '').toLowerCase();
        const s = terms.reduce((a, t) => a + (inName(name, t) ? (/^[a-z0-9]/.test(t) ? 2 : 1) : 0), 0);
        return { p, s };
      }).filter(x => x.s > 0);
      const best = Math.max(0, ...scored.map(x => x.s));
      if (best >= Math.min(2, terms.length)) scored.filter(x => x.s === best).slice(0, 8).forEach(x => { const key = x.p.sku || x.p.name; if (!hits.has(key)) hits.set(key, { p: x.p, how: 'שם' }); });
    }
  }
  return [...hits.values()].slice(0, 8);
};

const ym = (d) => String(d || '').slice(0, 7);
const fmtN = (n) => Math.round(n || 0).toLocaleString('en-US');

// lines: invoice lines [{d, inv, c, k, n, q, v, x?}] (sales; credit notes have q < 0)
export const buildChatContext = ({ question, lines = [], names = {}, stock = {}, supplier = {}, suppliersTotals = {}, today = new Date().toISOString().slice(0, 10) }) => {
  const sales = lines.filter(l => !l.x && l.k);
  const bySku = {};
  sales.forEach(l => { (bySku[l.k] ||= []).push(l); });
  const products = [...new Set([...Object.keys(bySku), ...Object.keys(names)])].map(sku => ({
    sku, name: names[sku] || bySku[sku]?.[0]?.n || '', stock: stock[sku], supplier: supplier[sku] || '',
  }));
  const first = sales.reduce((a, l) => (!a || l.d < a ? l.d : a), ''), last = sales.reduce((a, l) => (l.d > a ? l.d : a), '');
  let out = `=== הנתונים שיש לך (מחשבוניות המכירה בפריוריטי, ${first || '?'} עד ${last || '?'}, היום ${today}) ===\n`;

  const found = findProductsInQuestion(question, products);
  const y1 = new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10);
  found.forEach(({ p, how }) => {
    const ls = bySku[p.sku] || [];
    const sold = ls.filter(l => l.q > 0), back = ls.filter(l => l.q < 0);
    const months = {}; ls.forEach(l => { months[ym(l.d)] = (months[ym(l.d)] || 0) + l.q; });
    const custs = {}; sold.forEach(l => { const c = l.c || l.cid || '?'; custs[c] = (custs[c] || 0) + l.q; });
    const yr = sold.filter(l => l.d >= y1);
    out += `\n## ${p.name || '(בלי שם)'} — מק"ט ${p.sku || '—'} (זוהה לפי ${how})\n`
      + `ספק: ${p.supplier || 'לא ידוע'} · מלאי עכשיו: ${p.stock ?? 'לא ידוע'}\n`;
    if (!ls.length) { out += 'אין אף שורת מכירה למוצר הזה בתקופת הנתונים.\n'; return; }
    out += `סה"כ נמכרו ${fmtN(sold.reduce((a, l) => a + l.q, 0))} יח' ב-${new Set(sold.map(l => l.inv)).size} חשבוניות, ל-${Object.keys(custs).length} לקוחות · `
      + `ב-12 החודשים האחרונים: ${fmtN(yr.reduce((a, l) => a + l.q, 0))} יח', ₪${fmtN(yr.reduce((a, l) => a + (l.v || 0), 0))}`
      + (back.length ? ` · החזרות/זיכויים: ${fmtN(-back.reduce((a, l) => a + l.q, 0))} יח'` : '')
      + ` · מכירה ראשונה ${sold.length ? sold.reduce((a, l) => (l.d < a ? l.d : a), sold[0].d) : '—'}, אחרונה ${sold.length ? sold.reduce((a, l) => (l.d > a ? l.d : a), '') : '—'}\n`;
    out += 'כמות לפי חודש (24 אחרונים): ' + Object.entries(months).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-24).map(([m, q]) => `${m}: ${fmtN(q)}`).join(', ') + '\n';
    out += 'לקוחות מובילים: ' + Object.entries(custs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, q]) => `${c} (${fmtN(q)})`).join(', ') + '\n';
  });

  // two products or more: sold together on one invoice, or apart
  const withSku = found.map(f => f.p).filter(p => p.sku && bySku[p.sku]?.length).slice(0, 5);
  if (withSku.length >= 2) {
    const invOf = {}; withSku.forEach(p => { invOf[p.sku] = new Set(bySku[p.sku].filter(l => l.q > 0).map(l => l.inv)); });
    out += '\n## מכירה ביחד / בנפרד (לפי מספר חשבונית)\n';
    for (let i = 0; i < withSku.length; i++) for (let j = i + 1; j < withSku.length; j++) {
      const a = withSku[i], b = withSku[j], A = invOf[a.sku], B = invOf[b.sku];
      const both = [...A].filter(x => B.has(x)).length, la = `"${a.name}" (${a.sku})`, lb = `"${b.name}" (${b.sku})`;
      out += `${la} + ${lb}: באותה חשבונית ${both} פעמים · ${la} בלי ${lb}: ${A.size - both} חשבוניות · ${lb} בלי ${la}: ${B.size - both} חשבוניות\n`;
      const onlyA = bySku[a.sku].filter(l => l.q > 0 && !B.has(l.inv)).slice(0, 5), onlyB = bySku[b.sku].filter(l => l.q > 0 && !A.has(l.inv)).slice(0, 5);
      if (onlyA.length) out += `  דוגמאות ל-${a.name} לבד: ` + onlyA.map(l => `${l.d} ${l.c || ''} חשבונית ${l.inv} (${fmtN(l.q)})`).join('; ') + '\n';
      if (onlyB.length) out += `  דוגמאות ל-${b.name} לבד: ` + onlyB.map(l => `${l.d} ${l.c || ''} חשבונית ${l.inv} (${fmtN(l.q)})`).join('; ') + '\n';
    }
  }

  // suppliers named in the question
  const qn = norm(question);
  const sups = Object.keys(suppliersTotals).filter(s => { const w = norm(s).slice(0, 6); return w.length >= 3 && qn.includes(w); }).slice(0, 3);
  sups.forEach(s => {
    const its = products.filter(p => p.supplier === s);
    out += `\n## ספק ${s}: רכישות ₪${fmtN(suppliersTotals[s])} · ${its.length} מוצרים`
      + (its.length ? ': ' + its.slice(0, 25).map(p => `${p.name} (${p.sku}, מלאי ${p.stock ?? '?'})`).join(', ') : '') + '\n';
  });

  if (!found.length && !sups.length) {
    // nothing named — the overall picture: top products of the last 12 months
    const top = {}; sales.filter(l => l.d >= y1 && l.q > 0).forEach(l => { const t = (top[l.k] ||= { q: 0, v: 0 }); t.q += l.q; t.v += l.v || 0; });
    out += '\nמוצרים מובילים ב-12 החודשים האחרונים (לפי מחזור): ' + Object.entries(top).sort((a, b) => b[1].v - a[1].v).slice(0, 20)
      .map(([k, t]) => `${names[k] || bySku[k]?.[0]?.n || k} (${k}): ${fmtN(t.q)} יח', ₪${fmtN(t.v)}`).join('; ') + '\n';
    out += 'לא זוהה בשאלה מוצר או ספק מסוים.\n';
  }
  return { text: out, found: found.map(f => f.p), suppliers: sups };
};
