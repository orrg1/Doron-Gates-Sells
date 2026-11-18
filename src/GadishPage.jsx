import React, { useEffect, useMemo, useState } from 'react';
import { Warehouse, Search, Plus, Minus, ClipboardCheck, History, Truck, AlertTriangle, X } from 'lucide-react';
import { supabase } from './cloud.js';
import { GADISH_KEY, GADISH_LOG_KEY, GADISH_DAYS_KEY, GADISH_BRING_KEY, MAIN_WH, SECOND_WH, applyGadishMove, gadishBringList } from './core/warehouse.js';

// ─── Warehouses: what is in גדיש, what is in מגדל העמק ───
// Priority has one total per item. Here we keep what sits in גדיש; מגדל העמק = total − גדיש.
// Works on a phone (counting / moving goods in the warehouse). Nothing is sent to Priority.

const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* kept on screen */ } };
const fmt = (n) => n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString('he-IL');
const ils = (n) => `₪${Math.round(n || 0).toLocaleString('he-IL')}`;
const matcher = (q) => {
  const ws = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (k, n) => { const hay = `${k} ${n}`.toLowerCase(); return ws.every(w => hay.includes(w)); };
};
const KIND = { in: `הועבר ל${SECOND_WH}`, out: `הוחזר ל${MAIN_WH}`, set: 'ספירה' };

// one inline action (amount + note) under a product
const MoveForm = ({ item, kind, onDone, onCancel, dark }) => {
  const [qty, setQty] = useState(kind === 'set' ? String(item.gadish || '') : '');
  const [note, setNote] = useState('');
  const label = kind === 'in' ? `כמה הועברו ל${SECOND_WH}?` : kind === 'out' ? `כמה הוחזרו ל${MAIN_WH}?` : `כמה יש בפועל ב${SECOND_WH}?`;
  const ok = qty !== '' && Number(qty) >= 0 && !(kind !== 'set' && Number(qty) === 0);
  const input = `px-3 py-2 rounded-lg border text-sm ${dark ? 'bg-slate-900 border-slate-600 text-white' : 'bg-white border-slate-300'}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onDone(Number(qty), note); }} className={`mt-2 p-3 rounded-xl border space-y-2 ${dark ? 'border-slate-600 bg-slate-900/50' : 'border-blue-200 bg-blue-50/60'}`}>
      <label className="block text-xs font-semibold">{label}</label>
      <div className="flex gap-2 flex-wrap">
        <input type="number" inputMode="decimal" min="0" step="any" autoFocus value={qty} onChange={e => setQty(e.target.value)} aria-label={label} className={`${input} w-28`} />
        <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="הערה (לא חובה)" aria-label="הערה" className={`${input} flex-1 min-w-[8rem]`} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!ok} className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${ok ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-400 cursor-not-allowed'}`}>שמור</button>
        <button type="button" onClick={onCancel} className={`px-4 py-2 rounded-lg text-sm border ${dark ? 'border-slate-600' : 'border-slate-300'}`}>ביטול</button>
      </div>
    </form>
  );
};

export default function GadishPage({ isDarkMode: dark, full = false, salesAvgDaily = null, costOf = null, onOpenCard = null }) {
  const [stock] = useState(() => readJson('procurementStock', {}));
  const [names] = useState(() => readJson('procurementNames', {}));
  const syncAt = useMemo(() => Number(localStorage.getItem('prioritySyncAt')) || null, []);
  const [gadish, setGadish] = useState(() => readJson(GADISH_KEY, {}));
  const [log, setLog] = useState(() => readJson(GADISH_LOG_KEY, []));
  const [days, setDaysState] = useState(() => Number(localStorage.getItem(GADISH_DAYS_KEY)) || 14);
  const serverBring = useMemo(() => readJson(GADISH_BRING_KEY, null), []);
  const [by, setBy] = useState('');
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setBy(data?.session?.user?.email || '')).catch(() => {}); }, []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // { k, kind }
  const [showLog, setShowLog] = useState(false);
  const [filter, setFilter] = useState('');
  const [flash, setFlash] = useState('');
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 3000); return () => clearTimeout(t); }, [flash]);

  const catalog = useMemo(() => {
    const keys = new Set([...Object.keys(names), ...Object.keys(stock), ...Object.keys(gadish)]);
    return [...keys].filter(Boolean).map(k => ({ k, n: names[k] || '', total: stock[k] ?? null }));
  }, [names, stock, gadish]);
  const results = useMemo(() => { const m = matcher(q); return q.trim() ? catalog.filter(x => m(x.k, x.n)).slice(0, 30) : []; }, [q, catalog]);
  const rows = useMemo(() => Object.entries(gadish).map(([k, g]) => {
    const total = stock[k] ?? null;
    return { k, n: names[k] || '', total, gadish: g, main: total == null ? null : Math.round((total - g) * 100) / 100, value: costOf ? (costOf(k) || 0) * g : null };
  }).filter(r => { if (!filter.trim()) return true; return matcher(filter)(r.k, r.n); }).sort((a, b) => a.n.localeCompare(b.n, 'he')), [gadish, stock, names, filter, costOf]);
  const mismatch = rows.filter(r => r.main != null && r.main < 0);
  const totals = useMemo(() => {
    const all = Object.entries(gadish);
    return { items: all.length, units: all.reduce((s, [, g]) => s + g, 0), value: costOf ? all.reduce((s, [k, g]) => s + (costOf(k) || 0) * g, 0) : null };
  }, [gadish, costOf]);
  const bring = useMemo(() => {
    if (salesAvgDaily) return gadishBringList({ gadish, stock, names, avgDaily: salesAvgDaily, days });
    // no sales data on this account → the list the server made this morning (quantities kept current with what is here now)
    return (serverBring?.items || []).filter(x => (gadish[x.k] || 0) > 0).map(x => ({ ...x, gadish: gadish[x.k], qty: Math.min(x.qty, gadish[x.k]) }));
  }, [salesAvgDaily, gadish, stock, names, days, serverBring]);

  const move = (k, n, kind, qty, note) => {
    const r = applyGadishMove(gadish, log, { k, n, kind, qty, note, by });
    setGadish(r.gadish); setLog(r.log); writeJson(GADISH_KEY, r.gadish); writeJson(GADISH_LOG_KEY, r.log);
    setOpen(null);
    setFlash(`${n || k}: ${KIND[kind]} — עכשיו ב${SECOND_WH} ${fmt(r.gadish[k] || 0)}`);
  };
  const undo = (entry) => {
    // reverse one log line (back to the quantity before it)
    const before = Math.round(((gadish[entry.k] || 0) - entry.d) * 100) / 100;
    const r = applyGadishMove(gadish, log, { k: entry.k, n: entry.n, kind: 'set', qty: Math.max(0, before), note: `ביטול: ${KIND[entry.kind]} ${fmt(Math.abs(entry.d))}`, by });
    setGadish(r.gadish); setLog(r.log); writeJson(GADISH_KEY, r.gadish); writeJson(GADISH_LOG_KEY, r.log);
  };

  const muted = dark ? 'text-slate-400' : 'text-slate-500', strong = dark ? 'text-slate-100' : 'text-slate-900';
  const card = `rounded-2xl border ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`;
  const btn = `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${dark ? 'border-slate-600 hover:bg-slate-700 text-slate-200' : 'border-slate-300 hover:bg-slate-50 text-slate-700'}`;
  const nameEl = (k, n) => onOpenCard
    ? <button type="button" onClick={() => onOpenCard(k)} className={`text-right font-semibold underline decoration-dotted underline-offset-2 ${strong}`}>{n || k}</button>
    : <span className={`font-semibold ${strong}`}>{n || k}</span>;

  return (
    <div dir="rtl" className="space-y-4 max-w-5xl">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-500"><Warehouse className="w-6 h-6" /></div>
        <div className="flex-1 min-w-[14rem]">
          <h1 className={`text-xl font-bold ${strong}`}>מחסנים — {MAIN_WH} / {SECOND_WH}</h1>
          <p className={`text-sm ${muted}`}>בפריוריטי יש סה״כ אחד לכל מוצר. כאן רושמים מה נמצא ב{SECOND_WH}; {MAIN_WH} = הסה״כ בפריוריטי פחות {SECOND_WH}. שום דבר לא נשלח לפריוריטי.
            {syncAt ? ` מלאי פריוריטי מ-${new Date(syncAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`${card} p-3`}><p className={`text-xs ${muted}`}>מוצרים ב{SECOND_WH}</p><p className={`text-xl font-bold ${strong}`}>{totals.items.toLocaleString()}</p></div>
        <div className={`${card} p-3`}><p className={`text-xs ${muted}`}>יחידות ב{SECOND_WH}</p><p className={`text-xl font-bold ${strong}`}>{fmt(totals.units)}</p></div>
        {totals.value > 0 && <div className={`${card} p-3`}><p className={`text-xs ${muted}`}>שווי ב{SECOND_WH} (עלות)</p><p className={`text-xl font-bold ${strong}`}>{ils(totals.value)}</p></div>}
        <div className={`${card} p-3`}><p className={`text-xs ${muted}`}>להביא ל{MAIN_WH}</p><p className={`text-xl font-bold ${bring.length ? 'text-orange-500' : strong}`}>{bring.length}</p></div>
      </div>

      {/* add / count / move — search any product */}
      <div className={`${card} p-4 space-y-3`}>
        <label htmlFor="gd-search" className={`text-sm font-bold ${strong}`}>הוספה או עדכון של מוצר</label>
        <div className="relative">
          <Search className={`w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 ${muted}`} />
          <input id="gd-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם או מק״ט…"
            className={`w-full pr-9 pl-3 py-2.5 rounded-xl border text-sm ${dark ? 'bg-slate-900 border-slate-600 text-white' : 'bg-white border-slate-300'}`} />
        </div>
        {results.length > 0 && (
          <ul className="space-y-2">
            {results.map(x => {
              const g = gadish[x.k] || 0;
              const isOpen = open && open.k === x.k && open.from === 'search';
              return (
                <li key={x.k} className={`p-3 rounded-xl border ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex-1 min-w-[10rem]">{nameEl(x.k, x.n)}<span className={`block text-xs font-mono ${muted}`}>{x.k}</span></div>
                    <span className={`text-xs ${muted}`}>סה״כ {fmt(x.total)} · {SECOND_WH} {fmt(g)} · {MAIN_WH} {x.total == null ? '—' : fmt(x.total - g)}</span>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button type="button" className={btn} onClick={() => setOpen({ k: x.k, kind: 'in', from: 'search' })}><Plus className="w-3.5 h-3.5" />העברתי ל{SECOND_WH}</button>
                    {g > 0 && <button type="button" className={btn} onClick={() => setOpen({ k: x.k, kind: 'out', from: 'search' })}><Minus className="w-3.5 h-3.5" />הבאתי ל{MAIN_WH}</button>}
                    <button type="button" className={btn} onClick={() => setOpen({ k: x.k, kind: 'set', from: 'search' })}><ClipboardCheck className="w-3.5 h-3.5" />ספירה</button>
                  </div>
                  {isOpen && <MoveForm item={{ ...x, gadish: g }} kind={open.kind} dark={dark} onCancel={() => setOpen(null)} onDone={(qty, note) => move(x.k, x.n, open.kind, qty, note)} />}
                </li>
              );
            })}
          </ul>
        )}
        {q.trim() && !results.length && <p className={`text-sm ${muted}`}>לא נמצא מוצר. אפשר לחפש גם לפי חלק מהמק״ט.</p>}
      </div>

      {/* bring from גדיש */}
      {bring.length > 0 && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Truck className="w-5 h-5 text-orange-500" />
            <h2 className={`font-bold ${strong}`}>להביא מ{SECOND_WH} ל{MAIN_WH}</h2>
            <span className={`text-xs ${muted}`}>ב{MAIN_WH} נשאר פחות מ-
              {full ? <input type="number" min="1" value={days} onChange={e => { const v = Math.max(1, Number(e.target.value) || 14); setDaysState(v); try { localStorage.setItem(GADISH_DAYS_KEY, String(v)); } catch { /* */ } }} aria-label="מספר ימים" className={`w-14 mx-1 px-1.5 py-0.5 rounded border text-xs ${dark ? 'bg-slate-900 border-slate-600' : 'border-slate-300'}`} /> : ` ${days} `}
              ימי מכירה{!salesAvgDaily && serverBring?.at ? ` · חושב ב-${new Date(serverBring.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          </div>
          <ul className="divide-y divide-slate-200/60 dark:divide-slate-700">
            {bring.map(x => (
              <li key={x.k} className="py-2 flex items-center gap-2 flex-wrap text-sm">
                <div className="flex-1 min-w-[10rem]">{nameEl(x.k, x.n)}<span className={`block text-xs ${muted}`}>{MAIN_WH} {fmt(x.main)}{x.perDay ? ` · מספיק לכ-${x.coverDays} ימים` : ''} · {SECOND_WH} {fmt(x.gadish)}</span></div>
                <span className="font-bold text-orange-600 dark:text-orange-400">להביא {fmt(x.qty)}</span>
                <button type="button" className={btn} onClick={() => setOpen({ k: x.k, kind: 'out', from: 'bring' })}>הבאתי</button>
                {open && open.k === x.k && open.from === 'bring' && <div className="w-full"><MoveForm item={x} kind="out" dark={dark} onCancel={() => setOpen(null)} onDone={(qty, note) => move(x.k, x.n, 'out', qty, note)} /></div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* what is in גדיש */}
      <div className={card}>
        <div className="p-4 flex items-center gap-2 flex-wrap">
          <h2 className={`font-bold ${strong} flex-1`}>מה יש ב{SECOND_WH}</h2>
          {Object.keys(gadish).length > 8 && <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="סינון…" aria-label="סינון הרשימה" className={`px-3 py-1.5 rounded-lg border text-sm ${dark ? 'bg-slate-900 border-slate-600 text-white' : 'border-slate-300'}`} />}
        </div>
        {mismatch.length > 0 && (
          <p className={`mx-4 mb-3 p-2.5 rounded-lg text-xs flex gap-2 ${dark ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-700'}`}><AlertTriangle className="w-4 h-4 shrink-0" />
            ב-{mismatch.length} מוצרים רשום ב{SECOND_WH} יותר ממה שיש בפריוריטי בסה״כ — כנראה נמכר מ{SECOND_WH} ולא עודכן כאן. כדאי לספור אותם.</p>
        )}
        {!rows.length ? (
          <p className={`px-4 pb-5 text-sm ${muted}`}>{Object.keys(gadish).length ? 'אין התאמות לסינון.' : `עדיין לא נרשם כלום ב${SECOND_WH}. מחפשים מוצר למעלה ולוחצים "העברתי ל${SECOND_WH}" או "ספירה".`}</p>
        ) : (
          <ul>
            {rows.map(r => {
              const bad = r.main != null && r.main < 0;
              const isOpen = open && open.k === r.k && open.from === 'list';
              return (
                <li key={r.k} className={`cv-auto px-4 py-3 border-t ${dark ? 'border-slate-700' : 'border-slate-100'} ${bad ? (dark ? 'bg-red-900/20' : 'bg-red-50/70') : ''}`}>
                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                    <div className="flex-1 min-w-[10rem]">{nameEl(r.k, r.n)}<span className={`block text-xs font-mono ${muted}`}>{r.k}</span></div>
                    <div className="flex gap-3 text-xs tabular-nums">
                      <span><span className={muted}>{SECOND_WH} </span><b className={`text-base ${strong}`}>{fmt(r.gadish)}</b></span>
                      <span><span className={muted}>{MAIN_WH} </span><b className={bad ? 'text-red-600' : strong}>{fmt(r.main)}</b></span>
                      <span className={muted}>סה״כ {fmt(r.total)}</span>
                      {r.value > 0 && <span className={muted}>{ils(r.value)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button type="button" className={btn} onClick={() => setOpen({ k: r.k, kind: 'in', from: 'list' })}><Plus className="w-3.5 h-3.5" />העברתי ל{SECOND_WH}</button>
                    <button type="button" className={btn} onClick={() => setOpen({ k: r.k, kind: 'out', from: 'list' })}><Minus className="w-3.5 h-3.5" />הבאתי ל{MAIN_WH}</button>
                    <button type="button" className={btn} onClick={() => setOpen({ k: r.k, kind: 'set', from: 'list' })}><ClipboardCheck className="w-3.5 h-3.5" />ספירה</button>
                  </div>
                  {isOpen && <MoveForm item={r} kind={open.kind} dark={dark} onCancel={() => setOpen(null)} onDone={(qty, note) => move(r.k, r.n, open.kind, qty, note)} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* movement log */}
      <div className={card}>
        <button type="button" onClick={() => setShowLog(v => !v)} aria-expanded={showLog} className={`w-full p-4 flex items-center gap-2 text-right ${strong}`}>
          <History className="w-4 h-4" /><span className="font-bold flex-1">יומן תנועות ({log.length})</span><span className={`text-xs ${muted}`}>{showLog ? 'הסתר' : 'הצג'}</span>
        </button>
        {showLog && (
          <ul className="px-4 pb-4 space-y-1.5 text-xs">
            {!log.length && <li className={muted}>אין עדיין תנועות.</li>}
            {log.slice(0, 200).map((e, i) => (
              <li key={i} className={`flex items-center gap-2 flex-wrap py-1 border-t ${dark ? 'border-slate-700' : 'border-slate-100'}`}>
                <span className={`w-24 shrink-0 ${muted}`}>{new Date(e.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`flex-1 min-w-[8rem] ${strong}`}>{e.n || e.k}</span>
                <span>{KIND[e.kind]} {e.kind === 'set' ? fmt(e.set) : fmt(Math.abs(e.d))}{e.kind === 'set' && e.d ? ` (${e.d > 0 ? '+' : ''}${fmt(e.d)})` : ''}</span>
                {e.note && <span className={muted}>· {e.note}</span>}
                <span className={muted}>· {e.by ? e.by.split('@')[0] : ''}</span>
                {i === 0 && <button type="button" onClick={() => undo(e)} className="underline text-blue-600 dark:text-blue-300">בטל</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {flash && (
        <div role="status" className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl shadow-lg bg-slate-900 text-white text-sm flex items-center gap-2">
          {flash}<button type="button" onClick={() => setFlash('')} aria-label="סגור"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
