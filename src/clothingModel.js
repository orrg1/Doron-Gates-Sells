// ─── Work-clothing tracking: data model, status and order math (no UI) ───
// Everything lives in one localStorage key ('clothingData'), which the cloud layer saves to the server.
import { toIsoDate } from './core/data.js';

export const CLOTHING_KEY = 'clothingData';
export const SHORT = 'חולצה שרוול קצר', LONG = 'חולצה שרוול ארוך', HOODIE = 'קפוצון', SHOES = 'נעליים', PANTS = 'מכנסיים';
export const STD_ITEMS = [SHORT, LONG, HOODIE, SHOES, PANTS];

export const DEFAULT_CLOTHING = () => ({
  v: 1,
  settings: { cycleMonths: 4, soonDays: 14, countFrom: '', shirtsPerEmp: 5, hoodiesPerEmp: 3, orderShirts: true, orderHoodies: true, roundType: 'סבב קבוע' },
  lists: {
    shirtSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'],
    shoeSizes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48'],
    pantSizes: ['36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
    items: [SHORT, LONG, HOODIE, SHOES, PANTS],
    supplyTypes: ['סבב קבוע', 'חלוקה חריגה', 'החלפה', 'עובד חדש'],
  },
  employees: [],   // { id, name, active, shirt, hoodie, shoes, pants, short, long, hoodies, notes }
  deliveries: [],  // { id, date, empId, item, qty, type, size, notes }
  spares: [],      // { id, item, size, qty, price, notes }
  draft: {},       // per employee, this order only: { [empId]: { include, short, long, hoodies, shoes, pants } }
  orders: [],      // saved orders: { id, date, status: 'sent'|'received', receivedAt, lines: [{ empId, name, item, size, qty }], spares: [...] }
});

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const loadClothing = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOTHING_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_CLOTHING();
    const d = DEFAULT_CLOTHING();
    return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) }, lists: { ...d.lists, ...(raw.lists || {}) } };
  } catch { return DEFAULT_CLOTHING(); }
};
export const saveClothing = (data) => { try { localStorage.setItem(CLOTHING_KEY, JSON.stringify(data)); } catch { /* best-effort */ } };

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const addMonths = (iso, m) => { const [y, mo, d] = iso.split('-').map(Number); const t = new Date(y, mo - 1 + m, d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Which size an item takes for an employee (hoodie falls back to the shirt size, like the Excel did).
export const sizeFor = (emp, item) => {
  if (!emp) return '';
  if (item === SHORT || item === LONG) return emp.shirt || '';
  if (item === HOODIE) return emp.hoodie || emp.shirt || '';
  if (item === SHOES) return emp.shoes || '';
  if (item === PANTS) return emp.pants || '';
  return '';
};

// Per employee: what they got since `countFrom`, the last regular round, when the next one is due.
export const clothingStatus = (data, today = todayIso()) => {
  const st = data.settings;
  const from = st.countFrom || `${today.slice(0, 4)}-01-01`;
  const byEmp = {};
  data.deliveries.forEach(dv => { (byEmp[dv.empId] ||= []).push(dv); });
  return data.employees.map(e => {
    const list = byEmp[e.id] || [];
    const since = {}; STD_ITEMS.forEach(i => { since[i] = 0; });
    let lastAny = '', lastRound = '', lastShoes = '';
    list.forEach(dv => {
      if (dv.date >= from && since[dv.item] != null) since[dv.item] += n(dv.qty);
      if (dv.date > lastAny) lastAny = dv.date;
      if (dv.type === st.roundType && dv.date > lastRound) lastRound = dv.date;
      if (dv.item === SHOES && dv.date > lastShoes) lastShoes = dv.date;
    });
    const next = lastRound ? addMonths(lastRound, n(st.cycleMonths) || 4) : '';
    const left = next ? daysBetween(today, next) : null;
    const status = !lastRound ? 'none' : left <= 0 ? 'due' : left <= (n(st.soonDays) || 14) ? 'soon' : 'ok';
    return { emp: e, since, lastAny, lastRound, lastShoes, next, left, status, count: list.length };
  });
};
export const STATUS_LABEL = { due: 'הגיע מועד', soon: 'בקרוב', ok: 'תקין', none: 'אין סבב רשום' };
export const dueCount = (data) => clothingStatus(data).filter(r => r.emp.active && (r.status === 'due')).length;

// Quantities an employee gets in a regular round (their own split, else the defaults).
export const roundQty = (data, e) => {
  const st = data.settings;
  // like the Excel: shirts come only from the employee's own short/long split (no split → none, with a warning)
  const short = n(e.short), long = n(e.long);
  const hoodies = e.hoodies != null && e.hoodies !== '' ? n(e.hoodies) : n(st.hoodiesPerEmp);
  return { short, long, hoodies };
};

// The order being prepared: one line per active employee, plus warnings.
export const orderRows = (data) => {
  const st = data.settings;
  return data.employees.filter(e => e.active).map(e => {
    const dr = data.draft[e.id] || {};
    const include = dr.include !== false;
    const base = roundQty(data, e);
    const short = include && st.orderShirts ? (dr.short ?? base.short) : 0;
    const long = include && st.orderShirts ? (dr.long ?? base.long) : 0;
    const hoodies = include && st.orderHoodies ? (dr.hoodies ?? base.hoodies) : 0;
    const shoes = include ? n(dr.shoes) : 0, pants = include ? n(dr.pants) : 0;
    const warn = [];
    if (include) {
      if (st.orderShirts && !n(e.short) && !n(e.long) && dr.short == null && dr.long == null) warn.push('לא הוגדרה חלוקת שרוולים');
      else if (st.orderShirts && n(short) + n(long) !== n(st.shirtsPerEmp)) warn.push(`סה"כ חולצות ${n(short) + n(long)} במקום ${n(st.shirtsPerEmp)}`);
      if (n(short) + n(long) > 0 && !e.shirt) warn.push('חסרה מידת חולצה');
      if (n(hoodies) > 0 && !(e.hoodie || e.shirt)) warn.push('חסרה מידת קפוצון');
      if (shoes > 0 && !e.shoes) warn.push('חסרה מידת נעליים');
      if (pants > 0 && !e.pants) warn.push('חסרה מידת מכנסיים');
    }
    return { emp: e, include, short: n(short), long: n(long), hoodies: n(hoodies), shoes, pants, warn };
  });
};

// Order lines (employee × item) — what gets sent and later handed out.
export const orderLines = (data) => orderRows(data).filter(r => r.include).flatMap(r => [
  [SHORT, r.short], [LONG, r.long], [HOODIE, r.hoodies], [SHOES, r.shoes], [PANTS, r.pants],
].filter(([, q]) => q > 0).map(([item, qty]) => ({ empId: r.emp.id, name: r.emp.name, item, size: sizeFor(r.emp, item), qty })));

// Totals by size for the supplier: shirts/hoodies, shoes, pants, and everything else.
export const orderSummary = (data) => {
  const lines = [...orderLines(data), ...data.spares.filter(s => n(s.qty) > 0).map(s => ({ item: s.item, size: String(s.size || ''), qty: n(s.qty), spare: true, notes: s.notes, price: s.price }))];
  const tops = {}, shoes = {}, pants = {}, other = [];
  lines.forEach(l => {
    if (l.item === SHORT || l.item === LONG || l.item === HOODIE) { const r = (tops[l.size || 'ללא מידה'] ||= { [SHORT]: 0, [LONG]: 0, [HOODIE]: 0 }); r[l.item] += l.qty; }
    else if (l.item === SHOES) shoes[l.size || 'ללא מידה'] = (shoes[l.size || 'ללא מידה'] || 0) + l.qty;
    else if (l.item === PANTS) pants[l.size || 'ללא מידה'] = (pants[l.size || 'ללא מידה'] || 0) + l.qty;
    else other.push(l);
  });
  const order = (list, keys) => [...keys.filter(k => list[k] != null), ...Object.keys(list).filter(k => !keys.includes(k))];
  return {
    tops: order(tops, data.lists.shirtSizes).map(size => ({ size, ...tops[size], total: tops[size][SHORT] + tops[size][LONG] + tops[size][HOODIE] })),
    shoes: order(shoes, data.lists.shoeSizes).map(size => ({ size, qty: shoes[size] })),
    pants: order(pants, data.lists.pantSizes).map(size => ({ size, qty: pants[size] })),
    other,
  };
};

// ─── Import from the Excel workbook ("מעקב ביגוד") ───
const findHeader = (rows, must) => rows.findIndex(r => r && must.every(m => r.some(c => String(c ?? '').trim() === m)));
const col = (hdr, ...names) => { for (const nm of names) { const i = hdr.findIndex(c => String(c ?? '').trim() === nm); if (i !== -1) return i; } for (const nm of names) { const i = hdr.findIndex(c => String(c ?? '').trim().startsWith(nm)); if (i !== -1) return i; } return -1; };
const str = (v) => (v == null ? '' : String(v).replace(/ /g, ' ').trim());
const sizeStr = (v) => { const s = str(v); return s === '0' ? '' : s; };

export const importClothingWorkbook = (XLSX, wb, prev = DEFAULT_CLOTHING()) => {
  const sheet = (name) => { const ws = wb.Sheets[name]; return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; };
  const out = { ...DEFAULT_CLOTHING(), settings: { ...prev.settings }, lists: { ...prev.lists } };
  const report = [];

  // lists
  const L = sheet('רשימות');
  if (L && L.length > 1) {
    const h = L[0].map(str); const colVals = (nm) => { const i = h.indexOf(nm); return i === -1 ? null : L.slice(1).map(r => str(r[i])).filter(Boolean); };
    const sh = colVals('מידות חולצה/קפוצון'); if (sh?.length) out.lists.shirtSizes = sh;
    const so = colVals('מידות נעליים'); if (so?.length) out.lists.shoeSizes = so;
    const pa = colVals('מידות מכנסיים'); if (pa?.length) out.lists.pantSizes = pa;
    const it = colVals('סוגי פריט'); if (it?.length) out.lists.items = [...new Set([...STD_ITEMS, ...it])];
    const ty = colVals('סוג אספקה'); if (ty?.length) { out.lists.supplyTypes = ty; out.settings.roundType = ty.find(t => t.startsWith('סבב')) || ty[0]; }
  }

  // employees
  const E = sheet('עובדים');
  const byName = {};
  if (E) {
    const hi = findHeader(E, ['שם עובד']);
    if (hi !== -1) {
      const h = E[hi];
      const c = { name: col(h, 'שם עובד'), active: col(h, 'פעיל'), shirt: col(h, 'מידת חולצה'), hoodie: col(h, 'מידת קפוצון'), short: col(h, 'חולצות שרוול קצר'), long: col(h, 'חולצות שרוול ארוך'), shoes: col(h, 'מידת נעליים'), pants: col(h, 'מידת מכנסיים'), notes: col(h, 'הערות') };
      E.slice(hi + 1).forEach(r => {
        const name = str(r[c.name]); if (!name) return;
        const e = { id: newId(), name, active: str(r[c.active]) !== 'לא', shirt: sizeStr(r[c.shirt]), hoodie: sizeStr(r[c.hoodie]), shoes: sizeStr(r[c.shoes]), pants: sizeStr(r[c.pants]),
          short: r[c.short] == null || r[c.short] === '' ? '' : n(r[c.short]), long: r[c.long] == null || r[c.long] === '' ? '' : n(r[c.long]), hoodies: '', notes: c.notes === -1 ? '' : str(r[c.notes]) };
        out.employees.push(e); byName[name] = e;
      });
      report.push(`${out.employees.length} עובדים`);
    }
  }

  // order settings, per-employee shoes/pants in the current order, spares
  const O = sheet('הזמנה');
  if (O) {
    const r2 = O[1] || [], r3 = O[2] || [];
    const after = (row, label) => { const i = row.findIndex(c => str(c).startsWith(label)); return i === -1 ? null : row[i + 1]; };
    if (after(r2, 'להזמין חולצות') != null) out.settings.orderShirts = str(after(r2, 'להזמין חולצות')) !== 'לא';
    if (after(r2, 'כמות לעובד') != null) out.settings.shirtsPerEmp = n(after(r2, 'כמות לעובד')) || out.settings.shirtsPerEmp;
    if (after(r3, 'להזמין קפוצונים') != null) out.settings.orderHoodies = str(after(r3, 'להזמין קפוצונים')) !== 'לא';
    if (after(r3, 'כמות לעובד') != null) out.settings.hoodiesPerEmp = n(after(r3, 'כמות לעובד')) || out.settings.hoodiesPerEmp;
    const hi = findHeader(O, ['שם עובד', 'נעליים']);
    if (hi !== -1) {
      const h = O[hi]; const ci = col(h, 'שם עובד'), cs = h.findIndex(x => str(x) === 'נעליים'), cp = h.findIndex(x => str(x) === 'מכנסיים');
      O.slice(hi + 1).forEach(r => {
        const emp = byName[str(r[ci])]; if (!emp) return;
        const sh = cs !== -1 ? n(r[cs]) : 0, pa = cp !== -1 ? n(r[cp]) : 0;
        if (sh || pa) out.draft[emp.id] = { ...(sh ? { shoes: sh } : {}), ...(pa ? { pants: pa } : {}) };
      });
    }
    const si = findHeader(O, ['פריט', 'מידה', 'כמות']);
    if (si !== -1) {
      const h = O[si]; const ci = col(h, 'פריט'), cz = col(h, 'מידה'), cq = col(h, 'כמות'), cn = col(h, 'הערות');
      O.slice(si + 1).forEach(r => { const item = str(r[ci]); if (!item) return; out.spares.push({ id: newId(), item, size: sizeStr(r[cz]), qty: n(r[cq]), price: '', notes: cn === -1 ? '' : str(r[cn]) }); });
      if (out.spares.length) report.push(`${out.spares.length} שורות ספייר`);
      out.spares.forEach(s => { if (!out.lists.items.includes(s.item)) out.lists.items.push(s.item); });
    }
  }

  // deliveries log
  const D = sheet('מעקב אספקה');
  if (D) {
    const hi = findHeader(D, ['תאריך', 'שם עובד', 'פריט']);
    if (hi !== -1) {
      const h = D[hi]; const c = { date: col(h, 'תאריך'), name: col(h, 'שם עובד'), item: col(h, 'פריט'), qty: col(h, 'כמות'), type: col(h, 'סוג אספקה'), auto: col(h, 'מידה (אוטו'), manual: col(h, 'מידה ידנית'), notes: col(h, 'הערות') };
      let skipped = 0;
      D.slice(hi + 1).forEach(r => {
        const name = str(r[c.name]), item = str(r[c.item]), date = toIsoDate(r[c.date]);
        if (!name || !item || !date) return;
        let emp = byName[name];
        if (!emp) { emp = { id: newId(), name, active: false, shirt: '', hoodie: '', shoes: '', pants: '', short: '', long: '', hoodies: '', notes: 'נוסף מיומן המסירות' }; out.employees.push(emp); byName[name] = emp; skipped++; }
        const size = sizeStr(r[c.manual]) || sizeFor(emp, item);
        let type = str(r[c.type]); if (type.startsWith('סבב')) type = out.settings.roundType;
        out.deliveries.push({ id: newId(), date, empId: emp.id, item, qty: n(r[c.qty]) || 1, type: type || out.settings.roundType, size, notes: c.notes === -1 ? '' : str(r[c.notes]) });
      });
      report.push(`${out.deliveries.length} מסירות${skipped ? ` (${skipped} עובדים מהיומן שלא היו ברשימה נוספו כלא פעילים)` : ''}`);
    }
  }
  // round type: imported types like "סבב קבוע (4 חודשים)" → the settings' round type
  const S = sheet('סטטוס עובדים');
  if (S && S[1]) { const i = S[1].findIndex(x => str(x).startsWith('מחזור סבב')); if (i !== -1 && n(S[1][i + 1])) out.settings.cycleMonths = n(S[1][i + 1]); }
  return { data: out, report };
};

// ─── Export everything back to Excel ───
export const exportClothingWorkbook = (XLSX, data) => {
  const empName = Object.fromEntries(data.employees.map(e => [e.id, e.name]));
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!views'] = [{ RTL: true }]; XLSX.utils.book_append_sheet(wb, ws, name); };
  add('עובדים', [['שם עובד', 'פעיל', 'מידת חולצה', 'מידת קפוצון', 'חולצות שרוול קצר', 'חולצות שרוול ארוך', 'קפוצונים לעובד', 'מידת נעליים', 'מידת מכנסיים', 'הערות'],
    ...data.employees.map(e => [e.name, e.active ? 'כן' : 'לא', e.shirt, e.hoodie, e.short, e.long, e.hoodies, e.shoes, e.pants, e.notes])]);
  add('מעקב אספקה', [['תאריך', 'שם עובד', 'פריט', 'כמות', 'סוג אספקה', 'מידה', 'הערות'],
    ...[...data.deliveries].sort((a, b) => a.date.localeCompare(b.date)).map(d => [d.date, empName[d.empId] || '', d.item, d.qty, d.type, d.size, d.notes])]);
  const stat = clothingStatus(data);
  add('סטטוס עובדים', [['שם עובד', 'פעיל', ...STD_ITEMS, 'אספקה אחרונה', 'סבב אחרון', 'סבב הבא', 'סטטוס'],
    ...stat.map(r => [r.emp.name, r.emp.active ? 'כן' : 'לא', ...STD_ITEMS.map(i => r.since[i]), r.lastAny, r.lastRound, r.next, STATUS_LABEL[r.status]])]);
  const sum = orderSummary(data);
  add('סיכום הזמנה', [['מידה', SHORT, LONG, HOODIE, 'סה"כ'], ...sum.tops.map(r => [r.size, r[SHORT], r[LONG], r[HOODIE], r.total]), [],
    ['נעליים — מידה', 'כמות'], ...sum.shoes.map(r => [r.size, r.qty]), [], ['מכנסיים — מידה', 'כמות'], ...sum.pants.map(r => [r.size, r.qty]), [],
    ['פריט נוסף', 'מידה', 'כמות', 'הערות'], ...sum.other.map(o => [o.item, o.size, o.qty, o.notes || ''])]);
  add('הזמנה לפי עובד', [['שם עובד', 'פריט', 'מידה', 'כמות'], ...orderLines(data).map(l => [l.name, l.item, l.size, l.qty])]);
  return wb;
};
