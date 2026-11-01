// ─── Work clothing: employees & sizes, hand-outs, round status, supplier order ───
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Shirt, Plus, Pencil, Trash2, Upload, Download, Printer, UserPlus, History, X, Search, CheckCircle2, RotateCcw, AlertTriangle, Settings } from 'lucide-react';
import {
  loadClothing, saveClothing, newId, todayIso, clothingStatus, STATUS_LABEL, roundQty, orderRows, orderLines, orderSummary,
  importClothingWorkbook, exportClothingWorkbook, sizeFor, SHORT, LONG, HOODIE, SHOES, PANTS, STD_ITEMS, CLOTHING_KEY,
} from './clothingModel.js';

const disp = (iso) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '—';
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

const ui = (dark) => ({
  card: `rounded-2xl border ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`,
  muted: dark ? 'text-slate-400' : 'text-slate-500',
  strong: dark ? 'text-slate-100' : 'text-slate-800',
  input: `px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${dark ? 'bg-slate-900 border-slate-600 text-white placeholder-slate-500' : 'bg-white border-slate-300'}`,
  btn: `inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${dark ? 'border-slate-600 text-slate-200 hover:bg-slate-700' : 'border-slate-300 text-slate-700 bg-white hover:bg-slate-50'}`,
  primary: 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50',
  th: `px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap ${dark ? 'bg-slate-900 text-slate-400' : 'bg-slate-50 text-slate-500'}`,
  td: 'px-3 py-2.5 align-middle',
  row: dark ? 'border-t border-slate-700 hover:bg-slate-700/30' : 'border-t border-slate-100 hover:bg-slate-50',
  sel: (dark) => (dark ? { background: '#0f172a', color: '#f1f5f9' } : {}),
});
const STATUS_CLS = (k, dark) => ({
  due: dark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-800',
  soon: dark ? 'bg-orange-500/15 text-orange-300' : 'bg-orange-50 text-orange-800',
  ok: dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-800',
  none: dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600',
}[k]);

// ── Modal shell (module level — never defined inside a component) ──
const Modal = ({ title, onClose, dark, children, wide }) => {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl ${dark ? 'bg-slate-800 text-slate-100' : 'bg-white text-slate-800'}`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${dark ? 'border-slate-700' : 'border-slate-100'}`}>
          <h3 className="font-bold text-lg">{title}</h3>
          <button type="button" onClick={onClose} aria-label="סגור" className={`p-2 rounded-full ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
};

const Field = ({ label, children, hint, dark }) => (
  <label className="block">
    <span className={`block text-xs font-semibold mb-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
    {children}
    {hint && <span className={`block text-xs mt-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{hint}</span>}
  </label>
);

const SizeSelect = ({ value, onChange, options, dark, id, label }) => {
  const c = ui(dark);
  return (
    <select id={id} aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={c.sel(dark)} className={`${c.input} w-full`}>
      <option value="">—</option>
      {[...new Set([...(value && !options.includes(value) ? [value] : []), ...options])].map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
};

// ── Employee form + history ──
const EmployeeModal = ({ emp, data, dark, onSave, onClose, onDelete, onRound, onNewDelivery, onEditDelivery, onDeleteDelivery }) => {
  const c = ui(dark);
  const isNew = !emp.id;
  const [f, setF] = useState({ name: '', active: true, shirt: '', hoodie: '', shoes: '', pants: '', short: '', long: '', hoodies: '', notes: '', ...emp });
  const [newKit, setNewKit] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const hist = useMemo(() => data.deliveries.filter(d => d.empId === emp.id).sort((a, b) => b.date.localeCompare(a.date)), [data.deliveries, emp.id]);
  const base = roundQty(data, f);
  const save = () => {
    if (!f.name.trim()) return;
    const clean = { ...f, name: f.name.trim(), short: f.short === '' ? '' : num(f.short), long: f.long === '' ? '' : num(f.long), hoodies: f.hoodies === '' ? '' : num(f.hoodies) };
    onSave(clean, isNew && newKit);
  };
  return (
    <Modal title={isNew ? 'עובד חדש' : f.name || 'עובד'} onClose={onClose} dark={dark} wide={!isNew}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="שם עובד" dark={dark}><input autoFocus={isNew} value={f.name} onChange={e => set('name', e.target.value)} className={`${c.input} w-full`} /></Field></div>
        <Field label="מידת חולצה" dark={dark}><SizeSelect value={f.shirt} onChange={v => set('shirt', v)} options={data.lists.shirtSizes} dark={dark} label="מידת חולצה" /></Field>
        <Field label="מידת קפוצון" hint="ריק = כמו החולצה" dark={dark}><SizeSelect value={f.hoodie} onChange={v => set('hoodie', v)} options={data.lists.shirtSizes} dark={dark} label="מידת קפוצון" /></Field>
        <Field label="מידת נעליים" dark={dark}><SizeSelect value={f.shoes} onChange={v => set('shoes', v)} options={data.lists.shoeSizes} dark={dark} label="מידת נעליים" /></Field>
        <Field label="מידת מכנסיים" dark={dark}><SizeSelect value={f.pants} onChange={v => set('pants', v)} options={data.lists.pantSizes} dark={dark} label="מידת מכנסיים" /></Field>
      </div>
      <div className={`rounded-xl p-3 space-y-2 ${dark ? 'bg-slate-900/50' : 'bg-slate-50'}`}>
        <p className="text-sm font-bold">כמויות בסבב</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="שרוול קצר" dark={dark}><input type="number" min="0" inputMode="numeric" value={f.short} onChange={e => set('short', e.target.value)} placeholder="0" className={`${c.input} w-full`} /></Field>
          <Field label="שרוול ארוך" dark={dark}><input type="number" min="0" inputMode="numeric" value={f.long} onChange={e => set('long', e.target.value)} placeholder="0" className={`${c.input} w-full`} /></Field>
          <Field label="קפוצונים" dark={dark}><input type="number" min="0" inputMode="numeric" value={f.hoodies} onChange={e => set('hoodies', e.target.value)} placeholder={String(data.settings.hoodiesPerEmp)} className={`${c.input} w-full`} /></Field>
        </div>
        <p className={`text-xs ${c.muted}`}>חולצות: כמה קצר וכמה ארוך (סה"כ בדרך כלל {data.settings.shirtsPerEmp}). קפוצונים ריק = ברירת המחדל ({data.settings.hoodiesPerEmp}). בסבב יקבל: {base.short} קצר · {base.long} ארוך · {base.hoodies} קפוצונים.</p>
      </div>
      <Field label="הערות" dark={dark}><textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} className={`${c.input} w-full`} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} className="w-5 h-5 accent-teal-600" />עובד פעיל <span className={`text-xs ${c.muted}`}>(לא פעיל = לא נכלל בהזמנות ובסטטוס, ההיסטוריה נשמרת)</span></label>
      {isNew && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newKit} onChange={e => setNewKit(e.target.checked)} className="w-5 h-5 accent-teal-600" />מסור ערכת עובד חדש עכשיו (נרשם ביומן המסירות)</label>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={save} disabled={!f.name.trim()} className={c.primary}><CheckCircle2 className="w-4 h-4" />שמור</button>
        {!isNew && <button type="button" onClick={() => onRound(emp)} className={c.btn}><Shirt className="w-4 h-4" />מסור סבב עכשיו</button>}
        {!isNew && <button type="button" onClick={() => onNewDelivery(emp)} className={c.btn}><Plus className="w-4 h-4" />מסירה אחרת</button>}
        <div className="flex-1" />
        {!isNew && <button type="button" onClick={() => onDelete(emp)} className={`${c.btn} !text-red-600`}><Trash2 className="w-4 h-4" />מחק עובד</button>}
      </div>
      {!isNew && (
        <div>
          <p className="text-sm font-bold mb-2 flex items-center gap-1.5"><History className="w-4 h-4" />היסטוריית מסירות ({hist.length})</p>
          {hist.length ? (
            <ul className={`divide-y rounded-xl border ${dark ? 'divide-slate-700 border-slate-700' : 'divide-slate-100 border-slate-200'}`}>
              {hist.map(d => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`tabular-nums ${c.muted}`}>{disp(d.date)}</span>
                  <span className="flex-1 min-w-0">{d.item}{d.size ? ` · ${d.size}` : ''} <b>×{d.qty}</b><span className={`block text-xs ${c.muted}`}>{d.type}{d.notes ? ` · ${d.notes}` : ''}</span></span>
                  <button type="button" onClick={() => onEditDelivery(d)} aria-label="ערוך מסירה" className={`p-2 rounded-lg ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><Pencil className="w-4 h-4" /></button>
                  <button type="button" onClick={() => onDeleteDelivery(d)} aria-label="מחק מסירה" className={`p-2 rounded-lg text-red-600 ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          ) : <p className={`text-sm ${c.muted}`}>עוד לא נרשמו מסירות לעובד הזה</p>}
        </div>
      )}
    </Modal>
  );
};

// ── One hand-out (new or edit) ──
const DeliveryModal = ({ delivery, data, dark, onSave, onClose }) => {
  const c = ui(dark);
  const [f, setF] = useState({ date: todayIso(), empId: '', item: SHORT, qty: 1, type: data.settings.roundType, size: '', notes: '', ...delivery });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const emp = data.employees.find(e => e.id === f.empId);
  const autoSize = sizeFor(emp, f.item);
  const emps = [...data.employees].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'he'));
  return (
    <Modal title={delivery?.id ? 'עריכת מסירה' : 'מסירה חדשה'} onClose={onClose} dark={dark}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="תאריך" dark={dark}><input type="date" value={f.date} onChange={e => set('date', e.target.value)} className={`${c.input} w-full`} /></Field>
        <Field label="עובד" dark={dark}>
          <select value={f.empId} onChange={e => set('empId', e.target.value)} style={c.sel(dark)} className={`${c.input} w-full`}>
            <option value="">בחר עובד</option>
            {emps.map(e => <option key={e.id} value={e.id}>{e.name}{e.active ? '' : ' (לא פעיל)'}</option>)}
          </select>
        </Field>
        <Field label="פריט" dark={dark}>
          <select value={f.item} onChange={e => set('item', e.target.value)} style={c.sel(dark)} className={`${c.input} w-full`}>
            {[...new Set([...data.lists.items, f.item])].map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="כמות" dark={dark}><input type="number" min="1" inputMode="numeric" value={f.qty} onChange={e => set('qty', e.target.value)} className={`${c.input} w-full`} /></Field>
        <Field label="סוג אספקה" dark={dark}>
          <select value={f.type} onChange={e => set('type', e.target.value)} style={c.sel(dark)} className={`${c.input} w-full`}>
            {[...new Set([...data.lists.supplyTypes, f.type])].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="מידה" hint={autoSize ? `ריק = ${autoSize} (מכרטיס העובד)` : 'ריק = לפי כרטיס העובד'} dark={dark}><input value={f.size} onChange={e => set('size', e.target.value)} placeholder={autoSize} className={`${c.input} w-full`} /></Field>
        <div className="col-span-2"><Field label="הערות" dark={dark}><input value={f.notes} onChange={e => set('notes', e.target.value)} className={`${c.input} w-full`} /></Field></div>
      </div>
      <button type="button" disabled={!f.empId || !f.date || !f.item} onClick={() => onSave({ ...f, qty: num(f.qty) || 1, size: f.size || autoSize })} className={`${c.primary} w-full`}><CheckCircle2 className="w-4 h-4" />שמור מסירה</button>
    </Modal>
  );
};

export default function ClothingPage({ isDarkMode: dark }) {
  const c = ui(dark);
  const [data, setData] = useState(loadClothing);
  const [view, setView] = useState('status');
  const [empModal, setEmpModal] = useState(null);   // employee object ({} = new)
  const [dlvModal, setDlvModal] = useState(null);   // delivery object ({} = new)
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dlvQ, setDlvQ] = useState('');
  // another computer saved newer data → pick it up
  useEffect(() => { const on = (e) => { if (e.key === CLOTHING_KEY) setData(loadClothing()); }; window.addEventListener('storage', on); return () => window.removeEventListener('storage', on); }, []);
  const update = (fn) => setData(prev => { const next = fn(prev); saveClothing(next); return next; });
  const flash = (text, kind = 'ok') => { setMsg({ text, kind }); setTimeout(() => setMsg(m => (m && m.text === text ? null : m)), 6000); };

  const status = useMemo(() => clothingStatus(data), [data]);
  const activeStatus = status.filter(r => r.emp.active);
  const counts = { due: activeStatus.filter(r => r.status === 'due').length, soon: activeStatus.filter(r => r.status === 'soon').length, none: activeStatus.filter(r => r.status === 'none').length, ok: activeStatus.filter(r => r.status === 'ok').length };
  const empById = useMemo(() => Object.fromEntries(data.employees.map(e => [e.id, e])), [data.employees]);
  const rows = useMemo(() => orderRows(data), [data]);
  const summary = useMemo(() => orderSummary(data), [data]);
  const warnCount = rows.filter(r => r.warn.length).length;

  // ── actions ──
  const saveEmployee = (e, giveKit) => {
    update(d => {
      const isNew = !e.id; const emp = isNew ? { ...e, id: newId() } : e;
      const employees = isNew ? [...d.employees, emp] : d.employees.map(x => (x.id === emp.id ? emp : x));
      let deliveries = d.deliveries;
      if (giveKit) {
        const b = roundQty(d, emp); const type = d.lists.supplyTypes.find(t => t.includes('חדש')) || d.settings.roundType;
        deliveries = [...deliveries, ...[[SHORT, b.short], [LONG, b.long], [HOODIE, b.hoodies]].filter(([, qn]) => qn > 0).map(([item, qty]) => ({ id: newId(), date: todayIso(), empId: emp.id, item, qty, type, size: sizeFor(emp, item), notes: '' }))];
      }
      return { ...d, employees, deliveries };
    });
    setEmpModal(null); flash(e.id ? 'העובד עודכן' : 'העובד נוסף');
  };
  const deleteEmployee = (e) => {
    const n = data.deliveries.filter(d => d.empId === e.id).length;
    if (!window.confirm(`למחוק את ${e.name}?${n ? `\nיימחקו גם ${n} המסירות שלו. אם העובד עזב — עדיף לסמן "לא פעיל" ולשמור את ההיסטוריה.` : ''}`)) return;
    update(d => { const draft = { ...d.draft }; delete draft[e.id]; return { ...d, employees: d.employees.filter(x => x.id !== e.id), deliveries: d.deliveries.filter(x => x.empId !== e.id), draft }; });
    setEmpModal(null); flash('העובד נמחק');
  };
  const giveRound = (e) => {
    const b = roundQty(data, e);
    const items = [[SHORT, b.short], [LONG, b.long], [HOODIE, b.hoodies]].filter(([, qn]) => qn > 0);
    if (!items.length) { flash('אין כמויות מוגדרות לסבב לעובד הזה', 'err'); return; }
    if (!window.confirm(`לרשום ל${e.name} מסירת סבב היום?\n${items.map(([i, qn]) => `${i}: ${qn}`).join('\n')}`)) return;
    update(d => ({ ...d, deliveries: [...d.deliveries, ...items.map(([item, qty]) => ({ id: newId(), date: todayIso(), empId: e.id, item, qty, type: d.settings.roundType, size: sizeFor(e, item), notes: '' }))] }));
    flash(`נרשם סבב ל${e.name}`);
  };
  const saveDelivery = (dv) => {
    update(d => ({ ...d, deliveries: dv.id ? d.deliveries.map(x => (x.id === dv.id ? dv : x)) : [...d.deliveries, { ...dv, id: newId() }] }));
    setDlvModal(null); flash(dv.id ? 'המסירה עודכנה' : 'המסירה נרשמה');
  };
  const deleteDelivery = (dv) => { if (!window.confirm(`למחוק את המסירה (${dv.item} ×${dv.qty}, ${disp(dv.date)})?`)) return; update(d => ({ ...d, deliveries: d.deliveries.filter(x => x.id !== dv.id) })); };
  const setDraft = (empId, k, v) => update(d => { const cur = { ...(d.draft[empId] || {}) }; if (v === '' || v == null) delete cur[k]; else cur[k] = k === 'include' ? v : num(v); return { ...d, draft: { ...d.draft, [empId]: cur } }; });
  const setSetting = (k, v) => update(d => ({ ...d, settings: { ...d.settings, [k]: v } }));

  const onImport = async (ev) => {
    const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return;
    if (data.employees.length && !window.confirm('הייבוא יחליף את כל נתוני הביגוד הקיימים (עובדים, מסירות, ספייר). להמשיך?')) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const { data: next, report } = importClothingWorkbook(XLSX, wb, data);
      if (!next.employees.length) throw new Error('לא נמצא גיליון "עובדים" עם עמודת "שם עובד"');
      saveClothing(next); setData(next); flash(`יובאו: ${report.join(' · ')}`);
    } catch (e) { flash(`הייבוא נכשל: ${e.message}`, 'err'); }
  };
  const onExport = () => XLSX.writeFile(exportClothingWorkbook(XLSX, data), `ביגוד-${todayIso()}.xlsx`);

  const printSummary = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const t = (head, body) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(x => `<td>${x ?? ''}</td>`).join('')}</tr>`).join('')}</table>`;
    const tops = summary.tops.filter(r => r.total);
    w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>הזמנת ביגוד ${disp(todayIso())}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:20px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #cbd5e1;padding:6px 12px;text-align:center;font-size:13px}th{background:#f1f5f9}</style></head><body>
      <h1>הזמנת ביגוד — ${disp(todayIso())}</h1>
      <h2>חולצות וקפוצונים</h2>${t(['מידה', SHORT, LONG, HOODIE, 'סה"כ'], [...tops.map(r => [r.size, r[SHORT], r[LONG], r[HOODIE], r.total]), ['סה"כ', ...[SHORT, LONG, HOODIE].map(k => tops.reduce((a, r) => a + r[k], 0)), tops.reduce((a, r) => a + r.total, 0)]])}
      ${summary.shoes.length ? `<h2>נעליים</h2>${t(['מידה', 'כמות'], summary.shoes.map(r => [r.size, r.qty]))}` : ''}
      ${summary.pants.length ? `<h2>מכנסיים</h2>${t(['מידה', 'כמות'], summary.pants.map(r => [r.size, r.qty]))}` : ''}
      ${summary.other.length ? `<h2>פריטים נוספים</h2>${t(['פריט', 'מידה', 'כמות', 'הערות'], summary.other.map(o => [o.item, o.size, o.qty, o.notes || '']))}` : ''}
      <script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  };
  const saveOrder = () => {
    const lines = orderLines(data);
    if (!lines.length && !data.spares.length) { flash('אין מה להזמין', 'err'); return; }
    update(d => ({ ...d, orders: [{ id: newId(), date: todayIso(), status: 'sent', lines, spares: d.spares.map(s => ({ ...s })) }, ...d.orders] }));
    flash('ההזמנה נשמרה כ"נשלחה לספק". כשתגיע — לחץ "התקבלה, חלק לעובדים".');
  };
  const receiveOrder = (o) => {
    const n = o.lines.length;
    if (!window.confirm(`לרשום את ההזמנה מ-${disp(o.date)} כהתקבלה ולחלק לעובדים?\nיירשמו ${n} מסירות ביומן (סבב קבוע, תאריך היום). אפשר לערוך או למחוק אחר כך.`)) return;
    update(d => ({ ...d, orders: d.orders.map(x => (x.id === o.id ? { ...x, status: 'received', receivedAt: todayIso() } : x)),
      deliveries: [...d.deliveries, ...o.lines.filter(l => d.employees.some(e => e.id === l.empId)).map(l => ({ id: newId(), date: todayIso(), empId: l.empId, item: l.item, qty: l.qty, type: d.settings.roundType, size: l.size, notes: `מהזמנה ${disp(o.date)}` }))] }));
    flash(`נרשמו ${n} מסירות`);
  };

  // ── views ──
  const statusBadge = (k) => <span className={`inline-block whitespace-nowrap text-xs font-bold px-2 py-1 rounded-lg ${STATUS_CLS(k, dark)}`}>{STATUS_LABEL[k]}</span>;

  const renderStatus = () => {
    const list = activeStatus.filter(r => statusFilter === 'all' || r.status === statusFilter)
      .sort((a, b) => ({ due: 0, soon: 1, none: 2, ok: 3 }[a.status] - { due: 0, soon: 1, none: 2, ok: 3 }[b.status]) || (a.left ?? 0) - (b.left ?? 0) || a.emp.name.localeCompare(b.emp.name, 'he'));
    return (
      <section className={`${c.card} overflow-hidden`}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          {[['all', 'כולם', activeStatus.length], ['due', 'הגיע מועד', counts.due], ['soon', 'בקרוב', counts.soon], ['none', 'אין סבב רשום', counts.none], ['ok', 'תקין', counts.ok]].map(([k, l, n]) => (
            <button key={k} type="button" aria-pressed={statusFilter === k} onClick={() => setStatusFilter(k)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border ${statusFilter === k ? (dark ? 'bg-slate-200 text-slate-900 border-slate-200' : 'bg-slate-900 text-white border-slate-900') : (dark ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-700 bg-white')}`}>{l} ({n})</button>
          ))}
          <span className={`text-xs ${c.muted}`}>סבב כל {data.settings.cycleMonths} חודשים · כמויות נספרות מ-{disp(data.settings.countFrom || `${todayIso().slice(0, 4)}-01-01`)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{['עובד', 'סטטוס', 'סבב הבא', 'סבב אחרון', 'קיבל מתחילת התקופה', 'נעליים אחרונות', ''].map(h => <th key={h} className={c.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.emp.id} className={c.row}>
                  <td className={c.td}><button type="button" onClick={() => setEmpModal(r.emp)} className={`font-semibold text-right hover:underline ${c.strong}`}>{r.emp.name}</button></td>
                  <td className={c.td}>{statusBadge(r.status)}</td>
                  <td className={`${c.td} tabular-nums`}>{r.next ? <>{disp(r.next)}<span className={`block text-xs ${c.muted}`}>{r.left <= 0 ? `עבר לפני ${-r.left} ימים` : `עוד ${r.left} ימים`}</span></> : '—'}</td>
                  <td className={`${c.td} tabular-nums`}>{disp(r.lastRound)}</td>
                  <td className={`${c.td} text-xs`}>{STD_ITEMS.filter(i => r.since[i]).map(i => `${i.replace('חולצה ', '')} ${r.since[i]}`).join(' · ') || '—'}</td>
                  <td className={`${c.td} tabular-nums`}>{disp(r.lastShoes)}</td>
                  <td className={c.td}><button type="button" onClick={() => giveRound(r.emp)} className={c.btn}><Shirt className="w-4 h-4" />מסור סבב</button></td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7} className={`px-4 py-10 text-center ${c.muted}`}>אין עובדים בסינון הזה</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const renderEmployees = () => {
    const list = data.employees.filter(e => (showInactive || e.active) && (!q || e.name.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'he'));
    const missing = (e) => [!e.shirt && 'חולצה', !e.shoes && 'נעליים', !e.pants && 'מכנסיים'].filter(Boolean);
    return (
      <section className={`${c.card} overflow-hidden`}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setEmpModal({})} className={c.primary}><UserPlus className="w-4 h-4" />עובד חדש</button>
          <div className="relative flex-1 min-w-[180px]">
            <Search className={`absolute right-3 top-3 w-4 h-4 ${c.muted}`} />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש עובד" aria-label="חיפוש עובד" className={`${c.input} w-full pr-9`} />
          </div>
          <label className={`flex items-center gap-2 text-sm ${c.muted}`}><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="w-5 h-5 accent-teal-600" />הצג גם לא פעילים ({data.employees.filter(e => !e.active).length})</label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{['עובד', 'חולצה', 'קפוצון', 'חולצות בסבב', 'קפוצונים', 'נעליים', 'מכנסיים', 'הערות', ''].map(h => <th key={h} className={c.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map(e => { const b = roundQty(data, e); const miss = missing(e); return (
                <tr key={e.id} className={`${c.row} ${e.active ? '' : 'opacity-60'}`}>
                  <td className={c.td}><button type="button" onClick={() => setEmpModal(e)} className={`font-semibold text-right hover:underline ${c.strong}`}>{e.name}</button>
                    {!e.active && <span className={`mr-2 text-xs ${c.muted}`}>לא פעיל</span>}
                    {e.active && miss.length > 0 && <span className={`block text-xs ${dark ? 'text-orange-300' : 'text-orange-700'}`}>חסרה מידת {miss.join(', ')}</span>}</td>
                  <td className={c.td}>{e.shirt || '—'}</td>
                  <td className={c.td}>{e.hoodie || (e.shirt ? <span className={c.muted}>{e.shirt}</span> : '—')}</td>
                  <td className={`${c.td} whitespace-nowrap`}>קצר {b.short} · ארוך {b.long}{!num(e.short) && !num(e.long) ? <span className={`block text-xs ${dark ? 'text-orange-300' : 'text-orange-700'}`}>לא הוגדרה חלוקה</span> : ''}</td>
                  <td className={`${c.td} tabular-nums`}>{b.hoodies}</td>
                  <td className={c.td}>{e.shoes || '—'}</td>
                  <td className={c.td}>{e.pants || '—'}</td>
                  <td className={`${c.td} text-xs ${c.muted}`}>{e.notes}</td>
                  <td className={c.td}><button type="button" onClick={() => setEmpModal(e)} className={c.btn}><Pencil className="w-4 h-4" />ערוך</button></td>
                </tr>
              ); })}
              {!list.length && <tr><td colSpan={9} className={`px-4 py-10 text-center ${c.muted}`}>לא נמצאו עובדים</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const renderDeliveries = () => {
    const list = [...data.deliveries].filter(d => !dlvQ || (empById[d.empId]?.name || '').includes(dlvQ) || d.item.includes(dlvQ))
      .sort((a, b) => b.date.localeCompare(a.date) || (empById[a.empId]?.name || '').localeCompare(empById[b.empId]?.name || '', 'he'));
    return (
      <section className={`${c.card} overflow-hidden`}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDlvModal({})} className={c.primary}><Plus className="w-4 h-4" />מסירה חדשה</button>
          <div className="relative flex-1 min-w-[180px]">
            <Search className={`absolute right-3 top-3 w-4 h-4 ${c.muted}`} />
            <input type="search" value={dlvQ} onChange={e => setDlvQ(e.target.value)} placeholder="חיפוש לפי עובד או פריט" aria-label="חיפוש מסירות" className={`${c.input} w-full pr-9`} />
          </div>
          <span className={`text-xs ${c.muted}`}>{list.length} מסירות</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{['עובד', 'תאריך', 'פריט', 'מידה', 'כמות', 'סוג אספקה', 'הערות', ''].map(h => <th key={h} className={c.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.slice(0, 500).map(d => (
                <tr key={d.id} className={c.row}>
                  <td className={`${c.td} font-semibold ${c.strong}`}>{empById[d.empId]?.name || '—'}</td>
                  <td className={`${c.td} tabular-nums`}>{disp(d.date)}</td>
                  <td className={c.td}>{d.item}</td>
                  <td className={c.td}>{d.size || '—'}</td>
                  <td className={`${c.td} tabular-nums font-bold`}>{d.qty}</td>
                  <td className={`${c.td} text-xs`}>{d.type}</td>
                  <td className={`${c.td} text-xs ${c.muted}`}>{d.notes}</td>
                  <td className={c.td}><span className="inline-flex gap-1">
                    <button type="button" onClick={() => setDlvModal(d)} aria-label="ערוך" className={`p-2 rounded-lg ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={() => deleteDelivery(d)} aria-label="מחק" className={`p-2 rounded-lg text-red-600 ${dark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><Trash2 className="w-4 h-4" /></button>
                  </span></td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} className={`px-4 py-10 text-center ${c.muted}`}>עוד אין מסירות</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const numIn = (value, onChange, label, placeholder) => (
    <input type="number" min="0" inputMode="numeric" aria-label={label} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={`${c.input} w-16 text-center !px-1`} />
  );

  const renderOrder = () => {
    const st = data.settings;
    const tot = (k) => rows.reduce((a, r) => a + r[k], 0);
    return (
      <div className="space-y-4">
        <section className={`${c.card} p-4 flex flex-wrap items-end gap-4`}>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={st.orderShirts} onChange={e => setSetting('orderShirts', e.target.checked)} className="w-5 h-5 accent-teal-600" />להזמין חולצות</label>
          <Field label="חולצות לעובד" dark={dark}>{numIn(st.shirtsPerEmp, v => setSetting('shirtsPerEmp', num(v)), 'חולצות לעובד')}</Field>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={st.orderHoodies} onChange={e => setSetting('orderHoodies', e.target.checked)} className="w-5 h-5 accent-teal-600" />להזמין קפוצונים</label>
          <Field label="קפוצונים לעובד" dark={dark}>{numIn(st.hoodiesPerEmp, v => setSetting('hoodiesPerEmp', num(v)), 'קפוצונים לעובד')}</Field>
          <p className={`text-xs basis-full ${c.muted}`}>החלוקה קצר/ארוך באה מכרטיס העובד. אפשר לשנות כאן לעובד מסוים רק להזמנה הזו. נעליים ומכנסיים — למלא כמות לפי צורך.</p>
          {warnCount > 0 && <p className={`basis-full text-sm font-semibold flex items-center gap-1.5 ${dark ? 'text-orange-300' : 'text-orange-700'}`}><AlertTriangle className="w-4 h-4" />{warnCount} עובדים עם מידה חסרה או חלוקת חולצות לא תקינה — מסומנים בטבלה</p>}
        </section>

        <section className={`${c.card} overflow-hidden`}>
          <h3 className={`px-4 pt-4 font-bold ${c.strong}`}>עובדים בהזמנה ({rows.filter(r => r.include).length})</h3>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm">
              <thead><tr>{['עובד', 'בהזמנה', 'מידת חולצה', 'קצר', 'ארוך', 'מידת קפוצון', 'קפוצונים', 'נעליים (מידה)', 'נעליים', 'מכנסיים (מידה)', 'מכנסיים', 'בדיקה'].map(h => <th key={h} className={c.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(r => { const dr = data.draft[r.emp.id] || {}; const base = roundQty(data, r.emp); return (
                  <tr key={r.emp.id} className={`${c.row} ${r.include ? '' : 'opacity-50'}`}>
                    <td className={c.td}><button type="button" onClick={() => setEmpModal(r.emp)} className={`font-semibold text-right hover:underline ${c.strong}`}>{r.emp.name}</button></td>
                    <td className={c.td}><input type="checkbox" aria-label={`${r.emp.name} בהזמנה`} checked={r.include} onChange={e => setDraft(r.emp.id, 'include', e.target.checked ? '' : false)} className="w-5 h-5 accent-teal-600" /></td>
                    <td className={c.td}>{r.emp.shirt || '—'}</td>
                    <td className={c.td}>{numIn(dr.short, v => setDraft(r.emp.id, 'short', v), `${r.emp.name} שרוול קצר`, String(st.orderShirts ? base.short : 0))}</td>
                    <td className={c.td}>{numIn(dr.long, v => setDraft(r.emp.id, 'long', v), `${r.emp.name} שרוול ארוך`, String(st.orderShirts ? base.long : 0))}</td>
                    <td className={c.td}>{r.emp.hoodie || r.emp.shirt || '—'}</td>
                    <td className={c.td}>{numIn(dr.hoodies, v => setDraft(r.emp.id, 'hoodies', v), `${r.emp.name} קפוצונים`, String(st.orderHoodies ? base.hoodies : 0))}</td>
                    <td className={c.td}>{r.emp.shoes || '—'}</td>
                    <td className={c.td}>{numIn(dr.shoes, v => setDraft(r.emp.id, 'shoes', v), `${r.emp.name} נעליים`, '0')}</td>
                    <td className={c.td}>{r.emp.pants || '—'}</td>
                    <td className={c.td}>{numIn(dr.pants, v => setDraft(r.emp.id, 'pants', v), `${r.emp.name} מכנסיים`, '0')}</td>
                    <td className={`${c.td} text-xs font-semibold ${dark ? 'text-orange-300' : 'text-orange-700'}`}>{r.warn.join(' · ')}</td>
                  </tr>
                ); })}
              </tbody>
              <tfoot><tr className={`${c.row} font-bold`}><td className={c.td}>סה"כ</td><td className={c.td} /><td className={c.td} /><td className={c.td}>{tot('short')}</td><td className={c.td}>{tot('long')}</td><td className={c.td} /><td className={c.td}>{tot('hoodies')}</td><td className={c.td} /><td className={c.td}>{tot('shoes')}</td><td className={c.td} /><td className={c.td}>{tot('pants')}</td><td className={c.td} /></tr></tfoot>
            </table>
          </div>
          {Object.keys(data.draft).length > 0 && <div className="px-4 py-3"><button type="button" onClick={() => { if (window.confirm('לאפס את כל השינויים שעשית בהזמנה הזו (כמויות לעובד, מי בהזמנה)?')) update(d => ({ ...d, draft: {} })); }} className={c.btn}><RotateCcw className="w-4 h-4" />אפס שינויים בהזמנה</button></div>}
        </section>

        <section className={`${c.card} overflow-hidden`}>
          <div className="px-4 pt-4 flex items-center gap-2"><h3 className={`font-bold flex-1 ${c.strong}`}>ספייר ותוספות (לא משויך לעובד)</h3>
            <button type="button" onClick={() => update(d => ({ ...d, spares: [...d.spares, { id: newId(), item: d.lists.items[0] || '', size: '', qty: 1, price: '', notes: '' }] }))} className={c.btn}><Plus className="w-4 h-4" />הוסף שורה</button></div>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm">
              <thead><tr>{['פריט', 'מידה', 'כמות', 'מחיר ליח׳', 'הערות', ''].map(h => <th key={h} className={c.th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.spares.map(s => { const setS = (k, v) => update(d => ({ ...d, spares: d.spares.map(x => (x.id === s.id ? { ...x, [k]: v } : x)) })); return (
                  <tr key={s.id} className={c.row}>
                    <td className={c.td}><select aria-label="פריט" value={s.item} onChange={e => setS('item', e.target.value)} style={c.sel(dark)} className={`${c.input} w-full min-w-[160px]`}>{[...new Set([...data.lists.items, s.item])].map(i => <option key={i} value={i}>{i}</option>)}</select></td>
                    <td className={c.td}><input aria-label="מידה" value={s.size} onChange={e => setS('size', e.target.value)} className={`${c.input} w-20`} /></td>
                    <td className={c.td}>{numIn(s.qty, v => setS('qty', num(v)), 'כמות')}</td>
                    <td className={c.td}><input type="number" min="0" aria-label="מחיר ליחידה" value={s.price} onChange={e => setS('price', e.target.value)} className={`${c.input} w-24`} /></td>
                    <td className={c.td}><input aria-label="הערות" value={s.notes} onChange={e => setS('notes', e.target.value)} className={`${c.input} w-full min-w-[140px]`} /></td>
                    <td className={c.td}><button type="button" onClick={() => update(d => ({ ...d, spares: d.spares.filter(x => x.id !== s.id) }))} aria-label="מחק שורה" className="p-2 rounded-lg text-red-600"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ); })}
                {!data.spares.length && <tr><td colSpan={6} className={`px-4 py-6 text-center ${c.muted}`}>אין שורות ספייר</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${c.card} p-4 space-y-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`font-bold flex-1 ${c.strong}`}>סיכום לספק — לפי מידות</h3>
            <button type="button" onClick={printSummary} className={c.btn}><Printer className="w-4 h-4" />הדפס</button>
            <button type="button" onClick={onExport} className={c.btn}><Download className="w-4 h-4" />ייצוא לאקסל</button>
            <button type="button" onClick={saveOrder} className={c.primary}><CheckCircle2 className="w-4 h-4" />שמור כהזמנה שנשלחה</button>
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>{['מידה', SHORT, LONG, HOODIE, 'סה"כ'].map(h => <th key={h} className={c.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {summary.tops.filter(r => r.total).map(r => <tr key={r.size} className={c.row}><td className={`${c.td} font-bold`}>{r.size}</td><td className={c.td}>{r[SHORT]}</td><td className={c.td}>{r[LONG]}</td><td className={c.td}>{r[HOODIE]}</td><td className={`${c.td} font-bold`}>{r.total}</td></tr>)}
                  {!summary.tops.some(r => r.total) && <tr><td colSpan={5} className={`px-4 py-6 text-center ${c.muted}`}>אין חולצות או קפוצונים בהזמנה</td></tr>}
                </tbody>
                {summary.tops.some(r => r.total) && <tfoot><tr className={`${c.row} font-bold`}><td className={c.td}>סה"כ</td>{[SHORT, LONG, HOODIE, 'total'].map(k => <td key={k} className={c.td}>{summary.tops.reduce((a, r) => a + r[k], 0)}</td>)}</tr></tfoot>}
              </table>
            </div>
            <div className="space-y-3">
              {[['נעליים', summary.shoes], ['מכנסיים', summary.pants]].map(([t, list]) => (
                <div key={t}><p className={`text-sm font-bold mb-1 ${c.strong}`}>{t}</p>
                  {list.length ? <div className="flex flex-wrap gap-1.5">{list.map(r => <span key={r.size} className={`px-2.5 py-1 rounded-lg text-sm ${dark ? 'bg-slate-900/60' : 'bg-slate-100'}`}>מידה {r.size}: <b>{r.qty}</b></span>)}</div> : <p className={`text-sm ${c.muted}`}>אין</p>}
                </div>
              ))}
              {summary.other.length > 0 && <div><p className={`text-sm font-bold mb-1 ${c.strong}`}>פריטים נוספים</p>
                <ul className="text-sm space-y-1">{summary.other.map((o, i) => <li key={i}>{o.item}{o.size ? ` · ${o.size}` : ''} — <b>{o.qty}</b>{o.notes ? <span className={c.muted}> ({o.notes})</span> : ''}</li>)}</ul></div>}
            </div>
          </div>
        </section>

        {data.orders.length > 0 && (
          <section className={`${c.card} overflow-hidden`}>
            <h3 className={`px-4 pt-4 font-bold ${c.strong}`}>הזמנות שנשמרו</h3>
            <ul className={`mt-2 divide-y ${dark ? 'divide-slate-700' : 'divide-slate-100'}`}>
              {data.orders.map(o => (
                <li key={o.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className={`font-semibold ${c.strong}`}>הזמנה מ-{disp(o.date)}</span>
                  <span className={c.muted}>{o.lines.reduce((a, l) => a + l.qty, 0)} פריטים לעובדים · {new Set(o.lines.map(l => l.empId)).size} עובדים{o.spares?.length ? ` · ${o.spares.length} שורות ספייר` : ''}</span>
                  {o.status === 'received' ? <span className={`text-xs font-bold px-2 py-1 rounded-lg ${STATUS_CLS('ok', dark)}`}>התקבלה {disp(o.receivedAt)}</span> : <span className={`text-xs font-bold px-2 py-1 rounded-lg ${STATUS_CLS('soon', dark)}`}>נשלחה לספק</span>}
                  <div className="flex-1" />
                  {o.status !== 'received' && <button type="button" onClick={() => receiveOrder(o)} className={c.primary}><CheckCircle2 className="w-4 h-4" />התקבלה, חלק לעובדים</button>}
                  <button type="button" onClick={() => { if (window.confirm('למחוק את ההזמנה מהרשימה? (מסירות שכבר נרשמו לא יימחקו)')) update(d => ({ ...d, orders: d.orders.filter(x => x.id !== o.id) })); }} aria-label="מחק הזמנה" className="p-2 rounded-lg text-red-600"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  };

  const renderSettings = () => {
    const st = data.settings;
    const listEdit = (key, label) => (
      <Field label={label} hint="שורה לכל ערך" dark={dark}>
        <textarea rows={6} defaultValue={data.lists[key].join('\n')} onBlur={e => { const v = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); update(d => ({ ...d, lists: { ...d.lists, [key]: [...new Set(v)] } })); }} className={`${c.input} w-full`} />
      </Field>
    );
    return (
      <div className="space-y-4">
        <section className={`${c.card} p-4 grid grid-cols-2 lg:grid-cols-4 gap-4`}>
          <Field label="מחזור סבב (חודשים)" dark={dark}><input type="number" min="1" value={st.cycleMonths} onChange={e => setSetting('cycleMonths', num(e.target.value) || 1)} className={`${c.input} w-full`} /></Field>
          <Field label='"בקרוב" — כמה ימים מראש' dark={dark}><input type="number" min="0" value={st.soonDays} onChange={e => setSetting('soonDays', num(e.target.value))} className={`${c.input} w-full`} /></Field>
          <Field label="ספירת כמויות מתאריך" hint="ריק = 1 בינואר השנה" dark={dark}><input type="date" value={st.countFrom} onChange={e => setSetting('countFrom', e.target.value)} className={`${c.input} w-full`} /></Field>
          <Field label="סוג האספקה שנחשב סבב" dark={dark}>
            <select value={st.roundType} onChange={e => setSetting('roundType', e.target.value)} style={c.sel(dark)} className={`${c.input} w-full`}>{[...new Set([...data.lists.supplyTypes, st.roundType])].map(t => <option key={t} value={t}>{t}</option>)}</select>
          </Field>
          <Field label="חולצות לעובד (ברירת מחדל)" dark={dark}><input type="number" min="0" value={st.shirtsPerEmp} onChange={e => setSetting('shirtsPerEmp', num(e.target.value))} className={`${c.input} w-full`} /></Field>
          <Field label="קפוצונים לעובד (ברירת מחדל)" dark={dark}><input type="number" min="0" value={st.hoodiesPerEmp} onChange={e => setSetting('hoodiesPerEmp', num(e.target.value))} className={`${c.input} w-full`} /></Field>
        </section>
        <section className={`${c.card} p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-4`}>
          {listEdit('items', 'פריטים')}
          {listEdit('supplyTypes', 'סוגי אספקה')}
          {listEdit('shirtSizes', 'מידות חולצה / קפוצון')}
          {listEdit('shoeSizes', 'מידות נעליים')}
          {listEdit('pantSizes', 'מידות מכנסיים')}
          <p className={`text-xs sm:col-span-2 lg:col-span-5 ${c.muted}`}>הפריטים {STD_ITEMS.join(', ')} נספרים בסטטוס ובסיכום לפי מידה; פריטים אחרים (מעיל, חגורה, ארון עזרה ראשונה…) מופיעים בהזמנה כ"פריטים נוספים".</p>
        </section>
        <section className={`${c.card} p-4 flex flex-wrap items-center gap-2`}>
          <label className={`${c.btn} cursor-pointer`}><Upload className="w-4 h-4" />ייבוא מאקסל (מחליף הכל)<input type="file" accept=".xlsx,.xls" className="sr-only" onChange={onImport} /></label>
          <button type="button" onClick={onExport} className={c.btn}><Download className="w-4 h-4" />ייצוא הכל לאקסל</button>
          <div className="flex-1" />
          <button type="button" onClick={() => { if (window.confirm('למחוק את כל נתוני הביגוד? (אי אפשר לשחזר — כדאי לייצא לאקסל קודם)')) { const d = { ...loadClothing(), employees: [], deliveries: [], spares: [], draft: {}, orders: [] }; saveClothing(d); setData(d); } }} className={`${c.btn} !text-red-600`}><Trash2 className="w-4 h-4" />מחק את כל נתוני הביגוד</button>
        </section>
      </div>
    );
  };

  const TABS = [['status', 'סטטוס', counts.due ? counts.due : null], ['employees', 'עובדים', data.employees.filter(e => e.active).length], ['deliveries', 'מסירות', null], ['order', 'הזמנה', warnCount || null], ['settings', 'הגדרות', null]];

  if (!data.employees.length) {
    return (
      <div className="space-y-4">
        <section className={`${c.card} p-8 text-center space-y-4`}>
          <Shirt className="w-12 h-12 mx-auto text-teal-500" />
          <h2 className={`text-xl font-bold ${c.strong}`}>מעקב ביגוד עובדים</h2>
          <p className={`max-w-md mx-auto ${c.muted}`}>רשימת עובדים ומידות, מסירות, מתי מגיע סבב, והכנת הזמנה לספק לפי מידות. אפשר לייבא את קובץ האקסל הקיים או להתחיל ידנית.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <label className={`${c.primary} cursor-pointer`}><Upload className="w-4 h-4" />ייבוא מקובץ האקסל<input type="file" accept=".xlsx,.xls" className="sr-only" onChange={onImport} /></label>
            <button type="button" onClick={() => setEmpModal({})} className={c.btn}><UserPlus className="w-4 h-4" />הוסף עובד ידנית</button>
          </div>
          {msg && <p className={`text-sm font-semibold ${msg.kind === 'err' ? 'text-red-600' : 'text-teal-600'}`}>{msg.text}</p>}
        </section>
        {empModal && <EmployeeModal emp={empModal} data={data} dark={dark} onSave={saveEmployee} onClose={() => setEmpModal(null)} onDelete={deleteEmployee} onRound={giveRound} onNewDelivery={() => {}} onEditDelivery={() => {}} onDeleteDelivery={() => {}} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {[['הגיע מועד סבב', counts.due, 'due'], ['בקרוב', counts.soon, 'soon'], ['אין סבב רשום', counts.none, 'none'], ['עובדים פעילים', data.employees.filter(e => e.active).length, null]].map(([t, v, k]) => (
          <button key={t} type="button" onClick={() => { setView(k ? 'status' : 'employees'); if (k) setStatusFilter(k); }} className={`${c.card} text-right p-3 sm:p-4`}>
            <p className={`text-sm font-semibold ${c.muted}`}>{t}</p>
            <p className={`text-2xl sm:text-3xl font-bold tabular-nums ${k === 'due' && v ? (dark ? 'text-red-300' : 'text-red-700') : c.strong}`}>{v}</p>
          </button>
        ))}
      </section>
      <div className={`flex items-center gap-2 max-sm:sticky max-sm:-top-3 max-sm:z-20 max-sm:-mx-3 max-sm:px-3 max-sm:py-1.5 ${dark ? 'max-sm:bg-slate-950' : 'max-sm:bg-slate-50'}`}>
        <div role="tablist" aria-label="תצוגות ביגוד" className={`flex items-center gap-1 rounded-xl p-1 border shadow-sm overflow-x-auto [scrollbar-width:none] max-sm:w-full ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          {TABS.map(([k, l, b]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`shrink-0 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap ${view === k ? (dark ? 'bg-slate-200 text-slate-900' : 'bg-slate-900 text-white') : (dark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100')}`}>
              {k === 'settings' && <Settings className="w-4 h-4" />}{l}{b != null && <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${view === k ? 'bg-white/20' : (dark ? 'bg-slate-700' : 'bg-slate-100')}`}>{b}</span>}
            </button>
          ))}
        </div>
      </div>
      {msg && <p role="status" className={`text-sm font-semibold px-4 py-2.5 rounded-xl ${msg.kind === 'err' ? (dark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-800') : (dark ? 'bg-teal-500/15 text-teal-300' : 'bg-teal-50 text-teal-800')}`}>{msg.text}</p>}
      {view === 'status' && renderStatus()}
      {view === 'employees' && renderEmployees()}
      {view === 'deliveries' && renderDeliveries()}
      {view === 'order' && renderOrder()}
      {view === 'settings' && renderSettings()}
      {empModal && <EmployeeModal key={empModal.id || 'new'} emp={empModal} data={data} dark={dark} onSave={saveEmployee} onClose={() => setEmpModal(null)} onDelete={deleteEmployee} onRound={giveRound}
        onNewDelivery={(e) => setDlvModal({ empId: e.id, type: data.lists.supplyTypes.find(t => t !== data.settings.roundType) || data.settings.roundType })} onEditDelivery={(d) => setDlvModal(d)} onDeleteDelivery={deleteDelivery} />}
      {dlvModal && <DeliveryModal key={dlvModal.id || 'new'} delivery={dlvModal} data={data} dark={dark} onSave={saveDelivery} onClose={() => setDlvModal(null)} />}
    </div>
  );
}
