import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as XLSXLib from 'xlsx';
import { queueDataset } from './cloud.js';
import { pullAllFromPriority, describeAll } from './priority.js';
import { applyInventory, applyOpenOrders, mergeLinesSince, HebrewMonthsMap, HebrewMonthsReverse, excelDateToJS, normalizeDate, getDateVal, monthsDiff, parsePriorityOrders, parseInventoryFile, parseCustomerMonthlyFile, parseCustomerProductFile, MONTH_FULL_LABELS, MONTH_ABBR_LABELS_SHORT, parseFlexDate, DAY_MS, startOfToday, SERVICE_LEVEL, calcOrderPlan, normHeader, findHeaderRow, colIndex, toIsoDate, isoToDisplay, isoToMonthKey, daysBetween, num, normCurrency, isJunkSku, linesCoverage, linesRange, NON_PRODUCT_LABEL, mergeLinesIntoMonthly, customerMonthlyFromLines, customerProductsFromLines, PROC_FILE_SIGNATURES, detectProcFileType, parseSalesLines, parsePurchaseLines, parseShipments, shipmentStage, SHIP_NAME_STOP, matchShipSupplier } from './core/data.js';

// Excel parsing ships with the site; the CDN copy (loaded later) is only a fallback.
// Without this, uploads silently fail whenever the CDN is slow or blocked.
if (typeof window !== 'undefined' && !window.XLSX) window.XLSX = XLSXLib;
import {
  Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter,
  ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot,
  Loader2, FileText, Check, Trash2, Truck, Wallet, LayoutDashboard,
  FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight,
  BarChart3, Download, MousePointerClick, MessageSquare, Send, Moon, Sun,
  Info, Bell, User, Settings, Eye, EyeOff, TrendingDown, Zap,
  PieChart as PieChartIcon, Target, ArrowUpRight, ArrowDownRight, Home,
  ShoppingCart, ClipboardList, Sliders, TriangleAlert, Star, CircleDot,
  Minus, RefreshCw, SlidersHorizontal, MoreHorizontal
} from 'lucide-react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';

// ─── API ───────────────────────────────────────────────
// API key is managed via the settings modal (stored in localStorage)

// ─── HELPERS ───────────────────────────────────────────
// Smart search: '*' acts as a wildcard matching any characters (including none).
// "מנוע*1000" matches "מנוע נגרר 1000", "מנוע חדש 1000 וואט", etc.
// If no '*' is present, falls back to plain substring search (existing behavior).
const smartMatch = (text, query) => {
  if (!query) return true;
  if (!text) return false;
  const t = text.toString().toLowerCase();
  const q = query.toString().toLowerCase().trim();
  if (!q) return true;

  if (q.includes('*')) {
    // Escape regex special chars except '*', then convert '*' to '.*'
    const escaped = q
      .split('*')
      .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    try {
      return new RegExp(escaped).test(t);
    } catch {
      return t.includes(q.replace(/\*/g, ''));
    }
  }
  return t.includes(q);
};


// Negative amounts: the minus sign must stay on the left of the number. In an
// RTL page a bare "-₪809K" gets reordered by the browser into "809K-₪", so the
// value is isolated as a left-to-right run (U+2066 … U+2069).
const ltrIsolate = (t) => `\u2066${t}\u2069`;
const fmtPct = (v, d = 1) => v < 0 ? ltrIsolate(`${v.toFixed(d)}%`) : `${v.toFixed(d)}%`;
const formatCurrency = (val) => {
  if (isNaN(val)) return '₪0';
  const t = new Intl.NumberFormat('he-IL', { style:'currency', currency:'ILS', maximumFractionDigits:0 }).format(Math.abs(val));
  return val < 0 ? ltrIsolate('-' + t.replace(/[\u200e\u200f]/g,'').trim()) : t;
};

const formatShort = (val) => {
  if (isNaN(val)) return '₪0';
  const a = Math.abs(val);
  const t = a >= 1_000_000 ? `₪${(a/1_000_000).toFixed(1)}M` : a >= 1_000 ? `₪${(a/1_000).toFixed(0)}K` : null;
  if (t === null) return formatCurrency(val);
  return val < 0 ? ltrIsolate('-' + t) : t;
};

// Returns a display symbol for a stored currency code. Defaults to ₪ when
// unknown/missing, since that's the original app-wide assumption.
const currencySymbol = (code) => {
  if (code === 'USD') return '$';
  if (code === 'EUR') return '€';
  return '₪';
};
// Format a unit price with its real currency — NOT converted to ILS.
const formatUnitCost = (amount, code) => {
  if (amount==null || isNaN(amount)) return '';
  return `${currencySymbol(code)}${amount.toLocaleString(undefined,{maximumFractionDigits:2})}`;
};

// ─── PROCUREMENT TABLE COLUMN RESIZE ───────────────────
// Shared between the main "by product" table and every per-supplier table,
// so a manual resize (or auto-fit) looks the same everywhere.
const PROC_COL_KEYS = ['name','order','status','stock','coverage','avg','supplier'];
const PROC_COL_LABELS = { name:'מוצר', order:'להזמין', status:'מצב', stock:'מלאי + בדרך', coverage:'כיסוי', avg:'ממוצע לחודש', supplier:'ספק' };
const PROC_COL_DEFAULTS = { name:300, order:120, status:150, stock:150, coverage:140, avg:120, supplier:160 };
const PROC_COL_MIN = { name:160, order:90, status:110, stock:110, coverage:100, avg:90, supplier:90 };

let _measureCanvas = null;
const measureTextWidth = (text, font) => {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(String(text)).width;
};

// ─── PROCUREMENT STATUS — one status and at most one note per row ─────
// Color language (same everywhere): red = act now, orange = pay attention,
// green = fine, gray = secondary / no data. Blue is only for info & actions.
const procStatus = (p) => {
  if (p.currentStock === null) return 'unknown';
  if (p.suggestedOrder > 0) return p.risk === 'critical' ? 'now' : 'soon';
  if (p.overdue || p.shortNowCoveredByPO) return 'watch';
  return 'ok';
};
const PROC_STATUS_LABEL = { now:'להזמין עכשיו', soon:'להזמין בקרוב', watch:'לעקוב', ok:'תקין', unknown:'אין נתוני מלאי' };
// The single note shown under a product name — the most important one wins.
const procChip = (p) => {
  if (p.overdue) return { t:`הזמנה באיחור ${p.overdue.maxDays} ימים`, k:'now' };
  if (p.shortNowCoveredByPO) return { t:'חסר עכשיו · מכוסה בהזמנה', k:'watch' };
  if (p.priceChangePct!=null && Math.abs(p.priceChangePct) >= 3) return { t:`מחיר קניה ${p.priceChangePct>0?'עלה':'ירד'} ${Math.abs(p.priceChangePct).toFixed(0)}%`, k: p.priceChangePct>0 ? 'watch' : 'muted' };
  if (p.lifecycle === 'dying') return { t:'מכירות צונחות', k:'watch' };
  if (p.isLimitedData && p.avgDataMonths > 0) return { t:`נתונים מ-${p.avgDataMonths} ח׳ בלבד`, k:'muted' };
  if (p.effectiveCoverMonths != null && p.effectiveCoverMonths > 12) return { t:`מלאי ל-${Math.round(p.effectiveCoverMonths)} חודשים`, k:'muted' };
  return null;
};
const procStatusCls = (st, dark) => ({
  now:     dark ? 'bg-red-500/15 text-red-300'       : 'bg-red-50 text-red-700',
  soon:    dark ? 'bg-orange-500/15 text-orange-300' : 'bg-orange-50 text-orange-800',
  watch:   dark ? 'bg-orange-500/15 text-orange-300' : 'bg-orange-50 text-orange-800',
  ok:      dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700',
  unknown: dark ? 'bg-slate-700 text-slate-300'      : 'bg-slate-100 text-slate-600',
}[st]);
const procDotColor = { now:'#C8322B', soon:'#D9822B', watch:'#D9822B', ok:'#2E8B57', unknown:'#8A919E' };
const procChipCls = (k, dark) => ({
  now:   dark ? 'bg-red-500/15 text-red-300'       : 'bg-red-50 text-red-700',
  watch: dark ? 'bg-orange-500/15 text-orange-300' : 'bg-orange-50 text-orange-800',
  muted: dark ? 'bg-slate-700 text-slate-300'      : 'bg-slate-100 text-slate-600',
}[k]);

// Pulls the actual displayed value for a column, per product — used to
// auto-fit a column to its longest real value (not a guess).
const getProcColValue = (key, p) => {
  switch (key) {
    case 'name':     return p.name||'';
    case 'supplier': return p.supplier||'';
    case 'order':    return p.suggestedOrder?`${p.suggestedOrder.toLocaleString()} יח׳`:'—';
    case 'status':   return PROC_STATUS_LABEL[procStatus(p)]||'';
    case 'stock':    return p.currentStock!=null?`${p.currentStock.toLocaleString()} יח׳`:'';
    case 'coverage': return p.effectiveCoverDays!=null?`${p.effectiveCoverDays} יום`:'';
    case 'avg':      return `${p.avgMonthly.toFixed(1)} יח׳`;
    default: return '';
  }
};
// Extra px to account for icons/badges/padding that surround the text but
// aren't captured by a plain text measurement (varies per column).
const PROC_COL_EXTRA_PADDING = { name:90, order:40, status:50, stock:40, coverage:40, avg:30, supplier:30 };

// ─── IndexedDB storage for large datasets ──────────────────────
// localStorage caps out at ~5-10MB per origin (hard browser limit, not
// something the app can raise). Heavy datasets — raw sales/suppliers
// transactions and customer files — can outgrow that on real businesses with
// years of history. IndexedDB has a much larger quota (typically tied to
// available disk space), so those specific datasets live there instead.
// Everything else (settings, filenames, per-SKU procurement maps) stays in
// localStorage since it's small, bounded, and benefits from staying
// synchronous (simpler useState initializers, no loading flicker).
const IDB_NAME = 'BizDataProDB';
const IDB_STORE = 'kv';
let _idbPromise = null;
const openIDB = () => {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idbPromise;
};
const idbGet = async (key) => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
};
const idbSet = async (key, value) => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => { queueDataset(key, value); resolve(true); };
    tx.onerror = () => reject(tx.error);
  });
};
const idbDelete = async (key) => {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => { queueDataset(key, null); resolve(true); };
    tx.onerror = () => reject(tx.error);
  });
};
// Keys that live in IndexedDB instead of localStorage (the heavy datasets).
const IDB_KEYS = ['dashboardSalesData','dashboardSuppliersData','customerMonthlyData','customerProductData'];

// ─── Soft-delete (trash) for the heavy datasets ─────────────────
// Clearing a whole tab (sales/suppliers/customers) is one click and easy to
// hit by accident — a wrong tab, a wrong button. Before actually clearing,
// the previous value is stashed under `_trash_<key>` for 7 days (purged by
// the app-load effect), so "Restore" is possible without re-importing from
// Priority. Not used for tiny per-row deletes (e.g. one open order) — only
// for whole-dataset clears, where re-import is the expensive alternative.
const trashSet = async (key, value, extra) => {
  try { await idbSet('_trash_' + key, { value, extra, deletedAt: Date.now() }); } catch { /* best-effort safety net only */ }
};
const trashGet = async (key) => { try { return await idbGet('_trash_' + key); } catch { return null; } };
const trashClear = async (key) => { try { await idbDelete('_trash_' + key); } catch { /* best-effort */ } };





const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e','#6366f1'];
const CHART_COLORS = { blue:'#3b82f6', green:'#10b981', amber:'#f59e0b', red:'#ef4444', purple:'#8b5cf6' };

// ─── PARSING ───────────────────────────────────────────
const parseCSVLine = (line) => {
  const row = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
    else if (c===',' && !inQ) { row.push(cur.trim()); cur=''; }
    else cur+=c;
  }
  row.push(cur.trim()); return row;
};

const detectHeaders = (lines) => {
  const known = ['תאריך','חודש','מקט','מק"ט',"מק'ט",'תיאור','תאור','כמות','סכום','הכנסה','מחיר','יחידה',"יח'",'ספק','שם ספק','שם הספק','Supplier','הוצאה'];
  for (let i=0; i<Math.min(lines.length,30); i++) {
    if (!known.some(k=>lines[i].includes(k))) continue;
    const h = parseCSVLine(lines[i]).map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"').trim());
    if (h.filter(c=>known.some(k=>c.includes(k))).length>=2) return { index:i, headers:h };
  }
  const fi = lines.findIndex(l=>l.trim());
  if (fi===-1) return { index:-1, headers:[] };
  return { index:fi, headers:parseCSVLine(lines[fi]).map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"').trim()) };
};

const parseCSV = (text) => {
  const lines = text.split('\n');
  const { index, headers } = detectHeaders(lines);
  if (index===-1) return { data:[], type:'unknown' };
  const type = headers.some(h=>h.includes('ספק')||h.includes('Supplier')||h.includes('הוצאה')) ? 'suppliers' : 'sales';
  const result = [];
  for (let i=index+1; i<lines.length; i++) {
    const line = lines[i]; if (!line.trim()) continue;
    const vals = parseCSVLine(line);
    const row = {}; let hasData=false;
    headers.forEach((h,j) => { if (!h||j>=vals.length) return; row[h]=vals[j]; if(vals[j]?.trim()) hasData=true; });
    if (hasData) result.push(row);
  }
  return { data:result, type };
};

const processRow = (row, index, fileName, type) => {
  const id = `${Date.now()}-${Math.random().toString(36).substr(2,9)}-${index}-${fileName}`;
  let date = '';
  if (row['שנה'] && row['חודש']) {
    date = `${row['חודש']}-${row['שנה'].toString().slice(-2)}`;
  } else {
    date = normalizeDate(row['תאריך'] || row['חודש']);
  }
  const rawTotal = row['סה"כ סכום']||row['הכנסה בשקלים']||row['הוצאה משוערכת']||row["הוצאה כולל מע'מ"]||row['סה"כ']||'0';
  const total = parseFloat(rawTotal.toString().replace(/[^\d.-]/g,''));
  const quantity = parseFloat((row['כמות']||'0').toString().replace(/[^\d.-]/g,''));
  const sku = row['מקט מוצר']||row["מק'ט"]||row['מקט']||row["מס' ספק"]||'';
  const description = row['תיאור מוצר']||row['תאור מוצר']||row['שם ספק']||row['שם הספק']||'';
  const supplier = row['ספק']||row['שם ספק']||row['שם הספק']||'כללי';
  return { id, date, sku, description, quantity:isNaN(quantity)?0:quantity, total:isNaN(total)?0:total, unit:row['יחידה']||row["יח'"], supplier };
};

// ─── UI COMPONENTS ────────────────────────────────────

// Animated number counter
const AnimatedNumber = ({ value, formatter = (v) => v, duration = 800 }) => {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const start = prevRef.current, end = value, startTime = performance.now();
    const tick = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = start + (end - start) * ease;
      setDisplay(current);
      if (t < 1) requestAnimationFrame(tick);
      else prevRef.current = end;
    };
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <span>{formatter(display)}</span>;
};

// Sparkline mini chart
const Sparkline = ({ data, color = '#3b82f6', positive = true }) => {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.value || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const w = 80, h = 32;
  const coords = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - ((v - min) / range) * h]);
  const points = coords.map(([x,y]) => `${x},${y}`).join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  const gradId = `sparkGrad-${color.replace('#','')}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-90">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35}/>
          <stop offset="100%" stopColor={color} stopOpacity={0}/>
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} stroke="none"/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// KPI Card with sparkline
const KPICard = ({ title, value, formatted, subtext, icon: Icon, color, trend, sparkData, isDarkMode, onClick }) => {
  const isPositive = trend >= 0;
  const colorMap = {
    blue: { bg: isDarkMode ? 'bg-blue-500/10' : 'bg-blue-50', icon: 'text-blue-500', accent: '#3b82f6', border: isDarkMode ? 'border-blue-500/20' : 'border-blue-100' },
    green: { bg: isDarkMode ? 'bg-emerald-500/10' : 'bg-emerald-50', icon: 'text-emerald-500', accent: '#10b981', border: isDarkMode ? 'border-emerald-500/20' : 'border-emerald-100' },
    amber: { bg: isDarkMode ? 'bg-orange-500/10' : 'bg-orange-50', icon: 'text-orange-500', accent: '#f59e0b', border: isDarkMode ? 'border-orange-500/20' : 'border-orange-100' },
    red: { bg: isDarkMode ? 'bg-red-500/10' : 'bg-red-50', icon: 'text-red-500', accent: '#ef4444', border: isDarkMode ? 'border-red-500/20' : 'border-red-100' },
    purple: { bg: isDarkMode ? 'bg-purple-500/10' : 'bg-purple-50', icon: 'text-purple-500', accent: '#8b5cf6', border: isDarkMode ? 'border-purple-500/20' : 'border-purple-100' },
    cyan: { bg: isDarkMode ? 'bg-cyan-500/10' : 'bg-cyan-50', icon: 'text-cyan-500', accent: '#06b6d4', border: isDarkMode ? 'border-cyan-500/20' : 'border-cyan-100' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div
      onClick={onClick}
      className={`group relative p-5 rounded-2xl border transition-all duration-300 cursor-default overflow-hidden
        ${onClick ? 'cursor-pointer hover:-translate-y-1 hover:shadow-lg' : ''}
        ${isDarkMode ? `bg-slate-800/80 ${c.border} hover:border-opacity-40` : `bg-white ${c.border} hover:shadow-md`}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${c.bg} transition-transform duration-300 group-hover:scale-110`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
        {trend !== undefined && trend !== null && !isNaN(trend) && (
          <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold
            ${isPositive ? (isDarkMode?'bg-emerald-500/10 text-emerald-400':'bg-emerald-50 text-emerald-700') : (isDarkMode?'bg-red-500/10 text-red-400':'bg-red-50 text-red-700')}`}>
            {isPositive ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold tracking-tight mb-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
        {formatted || value}
      </div>
      <div className="flex items-center justify-between">
        <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{title}</p>
        {sparkData && <Sparkline data={sparkData} color={c.accent} />}
      </div>
      {subtext && <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{subtext}</p>}
    </div>
  );
};

// Overview Dashboard Page
// ─── CUSTOMERS PAGE ─────────────────────────────────────
const CustomersPage = ({ monthlyData, productData, isDarkMode, fileNames, onUploadMonthly, onUploadProduct, onClearMonthly, onClearProduct, loading, uploadError, uploadSuccess, onDismissError, excludeCurrentMonth, priorityRange = null, fileCounts = {}, customerCards = {}, onSyncPriority = null, lastSyncAt = null }) => {
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [sortConfig, setSortConfig] = useState({ key:'totalRevenue', direction:'desc' });
  const { sortRows, sortTh } = useTableSort();
  const [expandedCustomer, setExpandedCustomer] = useState(null);
  const [customerPage, setCustomerPage] = useState(1);
  const customerItemsPerPage = 50;
  const [periodFilter, setPeriodFilter] = useState({ start:'', end:'' });
  const availableMonths = useMemo(() => [...new Set(monthlyData.map(d=>d.date))].sort((a,b)=>getDateVal(a)-getDateVal(b)), [monthlyData]);
  useEffect(() => {
    if (!availableMonths.length || periodFilter.start) return;
    setPeriodFilter({ start:availableMonths[0], end:availableMonths[availableMonths.length-1] });
  }, [availableMonths]);
  const filteredMonthlyData = useMemo(() => {
    if (!periodFilter.start) return monthlyData;
    const startVal = getDateVal(periodFilter.start), endVal = getDateVal(periodFilter.end||periodFilter.start);
    return monthlyData.filter(d => { const v=getDateVal(d.date); return v>=startVal && v<=endVal; });
  }, [monthlyData, periodFilter]);
  const [trendHover, setTrendHover] = useState(null); // {key, rect}
  useEffect(() => {
    if (!trendHover) return;
    const close = () => setTrendHover(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [trendHover]);

  // ─── Per-customer aggregation from the monthly file (time dimension) ───
  const customers = useMemo(() => {
    if (!filteredMonthlyData.length) return [];
    const allMonths = [...new Set(filteredMonthlyData.map(d=>d.date))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    // The most recent month is usually only partially invoiced — keep it in the
    // revenue total (that money is real), but exclude it from average/trend/churn
    // math so one incomplete month doesn't masquerade as a real decline.
    const effectiveMonths = (excludeCurrentMonth && allMonths.length>1) ? allMonths.slice(0,-1) : allMonths;
    const map = {};
    filteredMonthlyData.forEach(d => {
      if (!map[d.customer]) map[d.customer] = { name:d.customer, customerId:d.customerId, monthly:{} };
      map[d.customer].monthly[d.date] = (map[d.customer].monthly[d.date]||0) + d.revenue;
    });
    const list = Object.values(map).map(c => {
      const months = Object.keys(c.monthly).sort((a,b)=>getDateVal(a)-getDateVal(b));
      const totalRevenue = months.reduce((s,m)=>s+c.monthly[m],0);
      const effMonthsForCustomer = months.filter(m=>effectiveMonths.includes(m));
      const avgMonthly = effMonthsForCustomer.length ? effMonthsForCustomer.reduce((s,m)=>s+c.monthly[m],0)/effMonthsForCustomer.length : 0;
      const firstMonth = months[0];
      const lastActiveMonth = months[months.length-1];
      // Trend — last 3 vs previous 3 *actual calendar months* (from the
      // overall effectiveMonths list, zero-filled), NOT the customer's own
      // last 3 active months. A customer who buys irregularly (e.g. Jan,
      // Mar, Jul) would otherwise have "recent 3" span half a year while
      // "previous 3" spans a different, unequal stretch — comparing real
      // amounts over mismatched time windows and producing a misleading %.
      const recent = effectiveMonths.slice(-3).reduce((s,m)=>s+(c.monthly[m]||0),0);
      const prev = effectiveMonths.slice(-6,-3).reduce((s,m)=>s+(c.monthly[m]||0),0);
      const trend = prev>0 ? ((recent-prev)/prev*100) : (recent>0?100:0);
      const isNew = effectiveMonths.indexOf(firstMonth) >= effectiveMonths.length-2;
      // Churned = zero revenue across the last 2 *effective* months (i.e. excluding
      // the partial one when the toggle is on).
      const last2Sum = effectiveMonths.slice(-2).reduce((s,m)=>s+(c.monthly[m]||0),0);
      const isChurned = !isNew && last2Sum === 0 && months.length>0;
      const status = isChurned ? 'churned' : isNew ? 'new' : 'active';
      // Early warning, before churn: 3 straight *effective* months of decline
      // (each strictly lower than the one before, last one still >0 revenue —
      // a customer who already hit 0 belongs in "churned" above, not here).
      // Combined with ABC (computed in the pass below) so the alert only
      // fires for revenue-significant customers worth calling, not noise.
      // Same calendar-based (zero-filled) window as `trend` above — a real
      // 3-calendar-month decline, not 3 non-zero months that might span
      // much longer than a quarter for an irregular buyer.
      const last3Cal = effectiveMonths.slice(-3);
      const decliningStreak = last3Cal.length===3
        && last3Cal.every((m,i)=> i===0 || (c.monthly[m]||0) < (c.monthly[last3Cal[i-1]]||0))
        && (c.monthly[last3Cal[2]]||0) > 0;
      return { ...c, months, totalRevenue, avgMonthly, firstMonth, lastActiveMonth, trend, status, decliningStreak };
    });
    // Customer card from Priority (city, agent, payment terms, customer since) — by number, else by name.
    const byName = {}; Object.values(customerCards).forEach(k => { if (k?.name) byName[k.name] = k; });
    list.forEach(c => {
      const card = customerCards[c.customerId] || byName[c.name];
      if (!card) return;
      c.city = card.city || ''; c.agent = card.agent || ''; c.pay = card.pay || ''; c.since = card.created || '';
      c.custType = card.type || ''; c.zone = card.zone || ''; c.credit = card.credit || null; c.cardStatus = card.status || '';
    });
    const totalAll = list.reduce((s,c)=>s+c.totalRevenue,0);
    const sorted = [...list].sort((a,b)=>b.totalRevenue-a.totalRevenue);
    let cumulative = 0;
    sorted.forEach(c => {
      const pct = totalAll>0 ? (c.totalRevenue/totalAll)*100 : 0;
      cumulative += pct;
      c.revPct = pct;
      c.abc = cumulative<=80 ? 'A' : cumulative<=95 ? 'B' : 'C';
      c.atRisk = c.status==='active' && c.decliningStreak && (c.abc==='A'||c.abc==='B');
    });
    return sorted;
  }, [filteredMonthlyData, excludeCurrentMonth, customerCards]);

  // Customer segmentation by ABC (revenue concentration) — replaces the monthly
  // trend chart here, since that's already covered in the "מכירות" tab.
  const abcSegments = useMemo(() => {
    const groups = { A:{count:0,revenue:0}, B:{count:0,revenue:0}, C:{count:0,revenue:0} };
    customers.forEach(c => { groups[c.abc].count++; groups[c.abc].revenue += c.totalRevenue; });
    return ['A','B','C'].map(k => ({ name:k, value:groups[k].revenue, count:groups[k].count }));
  }, [customers]);

  const productsByCustomer = useMemo(() => {
    const map = {};
    productData.forEach(d => {
      if (!map[d.customer]) map[d.customer] = [];
      map[d.customer].push(d);
    });
    Object.values(map).forEach(arr => arr.sort((a,b)=>b.revenue-a.revenue));
    return map;
  }, [productData]);

  const topProductsOverall = useMemo(() => {
    const map = {};
    productData.forEach(d => { map[d.product] = (map[d.product]||0) + d.revenue; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,total])=>({name,total}));
  }, [productData]);

  // ─── Cross-sell — which products tend to be bought by the same customers ───
  // For every customer, every pair of distinct products they bought together
  // counts as one co-occurrence. Pairs are ranked by how many customers share
  // them, which is a simple but honest proxy for "people who buy X also buy Y" —
  // no purchase-order/timing data is available, only the customer-product file's
  // aggregate totals, so this can't say whether purchases happened in the same
  // transaction, only that the same customer bought both at some point.
  const crossSellPairs = useMemo(() => {
    const pairCounts = {};
    Object.values(productsByCustomer).forEach(items => {
      const uniqueProducts = [...new Set(items.map(it=>it.product))];
      if (uniqueProducts.length < 2 || uniqueProducts.length > 60) return; // skip customers with 1 product (no pair) or absurdly many (noise, likely a distributor)
      for (let i=0; i<uniqueProducts.length; i++) {
        for (let j=i+1; j<uniqueProducts.length; j++) {
          const key = [uniqueProducts[i], uniqueProducts[j]].sort().join('␟');
          pairCounts[key] = (pairCounts[key]||0) + 1;
        }
      }
    });
    return Object.entries(pairCounts)
      .map(([key,count]) => { const [a,b] = key.split('␟'); return { a, b, count }; })
      .filter(p => p.count >= 2) // require at least 2 customers sharing the pair to call it a pattern, not coincidence
      .sort((a,b) => b.count - a.count)
      .slice(0, 15);
  }, [productsByCustomer]);

  const kpis = useMemo(() => {
    const totalRevenue = customers.reduce((s,c)=>s+c.totalRevenue,0);
    const newCount = customers.filter(c=>c.status==='new').length;
    const churnedCount = customers.filter(c=>c.status==='churned').length;
    const atRiskCount = customers.filter(c=>c.atRisk).length;
    const top1Pct = customers[0]?.revPct||0;
    const top5Pct = customers.slice(0,5).reduce((s,c)=>s+c.revPct,0);
    return { totalRevenue, newCount, churnedCount, atRiskCount, top1Pct, top5Pct, count: customers.length };
  }, [customers]);

  const filtered = useMemo(() => {
    let data = customers;
    if (search) data = data.filter(c=>smartMatch(c.name, search) || smartMatch(c.city||'', search) || smartMatch(c.agent||'', search));
    if (cityFilter) data = data.filter(c => (c.city||'') === cityFilter);
    const STATUS_LABEL = { new:'חדש', churned:'נטש', active:'פעיל' };
    const get = sortConfig.key==='status' ? (c => STATUS_LABEL[c.status]||'פעיל') : (c => c[sortConfig.key]);
    const mul = sortConfig.direction==='asc' ? 1 : -1;
    return [...data].sort((a,b)=>{
      const va=sortKeyOf(get(a)), vb=sortKeyOf(get(b));
      if (va===null || vb===null) return va===vb ? 0 : va===null ? 1 : -1;
      return compareSortKeys(va, vb) * mul;
    });
  }, [customers, search, cityFilter, sortConfig]);
  const cityOptions = useMemo(() => {
    const m = {}; customers.forEach(c => { if (c.city) m[c.city] = (m[c.city]||0) + 1; });
    return Object.entries(m).sort((a,b) => b[1]-a[1]);
  }, [customers]);
  const hasCards = customers.some(c => c.city || c.since || c.agent);
  useEffect(() => setCustomerPage(1), [search, sortConfig, customers]);
  const customerTotalPages = Math.ceil(filtered.length / customerItemsPerPage) || 1;
  const paginatedCustomers = useMemo(() => filtered.slice((customerPage-1)*customerItemsPerPage, customerPage*customerItemsPerPage), [filtered, customerPage]);

  const reqSort = (key, first='asc') => setSortConfig(p=>({ key, direction: p.key===key ? (p.direction==='asc'?'desc':'asc') : first }));

  const statusBadge = (status) => {
    if (status==='new') return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-100 text-blue-700'}`}>חדש</span>;
    if (status==='churned') return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDarkMode?'bg-red-500/20 text-red-300':'bg-red-100 text-red-700'}`}>נטש</span>;
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDarkMode?'bg-emerald-500/20 text-emerald-300':'bg-emerald-100 text-emerald-700'}`}>פעיל</span>;
  };

  // Per-customer monthly revenue chart, opened by clicking the trend % badge.
  // Uses the customer's own `months`/`monthly` map already computed above — no
  // re-scanning needed, and shows the FULL history available for that customer.
  const CustomerTrendButton = (c) => {
    const isOpen = trendHover?.key===c.name;
    const series = c.months.map(m => ({ month:m, revenue:c.monthly[m]||0 }));
    const avg = c.avgMonthly||0;
    return (
      <span className="relative inline-block" style={{lineHeight:0}}>
        <button
          onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setTrendHover(prev=>prev?.key===c.name?null:{key:c.name,rect:r});}}
          className={`flex items-center gap-1 text-xs font-bold whitespace-nowrap rounded px-1 -mx-1 transition-opacity ${!c.trend?(isDarkMode?'text-slate-500':'text-slate-400'):c.trend>0?'text-emerald-500':'text-red-500'} ${isOpen?'opacity-100 underline':'hover:opacity-70'}`}
          title="לחץ לגרף הכנסה חודשי">
          {c.trend>5?<ArrowUpRight className="w-3.5 h-3.5"/>:c.trend<-5?<ArrowDownRight className="w-3.5 h-3.5"/>:<Minus className="w-3.5 h-3.5"/>}
          {c.trend?`${Math.abs(c.trend).toFixed(0)}%`:'—'}
        </button>
        {isOpen && (
          <div className={`rounded-2xl border shadow-2xl text-right ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}
            onClick={e=>e.stopPropagation()}
            style={{
              position:'fixed', zIndex:9999, width: Math.min(440, window.innerWidth-16), padding:'16px', lineHeight:'normal',
              ...(trendHover?.rect ? {
                ...(trendHover.rect.top > 350
                  ? { bottom: window.innerHeight - trendHover.rect.top + 8 }
                  : { top: trendHover.rect.bottom + 8 }),
                ...(()=>{
                  const popupW = Math.min(440, window.innerWidth - 16);
                  const wantedRight = window.innerWidth - trendHover.rect.right + 8;
                  const right = Math.max(8, Math.min(wantedRight, window.innerWidth - popupW - 8));
                  return { right };
                })(),
              } : { top:100, right:8 })
            }}>
            <div className="flex items-center justify-between mb-2 gap-3">
              <p className={`text-sm font-bold shrink-0 ${isDarkMode?'text-white':'text-slate-800'}`}>📈 הכנסה חודשית</p>
              <button onClick={e=>{e.stopPropagation();setTrendHover(null);}}
                className={`shrink-0 p-1 rounded-full transition-colors ${isDarkMode?'hover:bg-slate-700 text-slate-400 hover:text-white':'hover:bg-slate-100 text-slate-400 hover:text-slate-700'}`}>
                <X className="w-4 h-4"/>
              </button>
            </div>
            <p className={`text-xs truncate mb-3 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{c.name}</p>
            {series.length<2 ? (
              <p className={`text-xs py-8 text-center ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין מספיק נתונים להצגת גרף</p>
            ) : (
              <>
                <div style={{width: Math.min(408, window.innerWidth-48), height:200}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{top:5,right:5,bottom:0,left:-15}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode?'#334155':'#e2e8f0'} vertical={false}/>
                      <XAxis dataKey="month" tick={{fontSize:10, fill:isDarkMode?'#94a3b8':'#64748b'}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10, fill:isDarkMode?'#94a3b8':'#64748b'}} axisLine={false} tickLine={false} width={32} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
                      <RechartsTooltip
                        content={({active, payload, label}) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload;
                          if (!row) return null;
                          const rev = row.revenue||0;
                          const diff = avg>0 ? Math.round((rev/avg - 1)*100) : null;
                          return (
                            <div style={{background:isDarkMode?'#1e293b':'#fff', border:`1px solid ${isDarkMode?'#334155':'#e2e8f0'}`, borderRadius:8, fontSize:12, padding:'8px 10px', direction:'rtl'}}>
                              <p style={{color:isDarkMode?'#e2e8f0':'#1e293b', fontWeight:'bold', marginBottom:4}}>{label}</p>
                              <p style={{color:isDarkMode?'#cbd5e1':'#334155'}}>{formatCurrency(rev)}</p>
                              {diff!=null && <p style={{color: diff>=0?'#10b981':'#ef4444', fontSize:11, marginTop:2}}>{diff>=0?'+':''}{diff}% מהממוצע ({formatShort(avg)})</p>}
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="revenue" name="הכנסה" radius={[4,4,0,0]}>
                        {series.map((d,i)=>(
                          <Cell key={i} fill={d.revenue >= avg ? '#ec4899' : (isDarkMode?'#475569':'#cbd5e1')}/>
                        ))}
                      </Bar>
                      {avg>0 && <Line type="monotone" dataKey={()=>avg} stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={false} name="ממוצע" isAnimationActive={false}/>}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className={`flex items-center justify-between mt-2 text-[11px] ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:'#ec4899'}}/>מעל הממוצע</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed" style={{borderColor:'#3b82f6'}}/>ממוצע ({formatShort(avg)})</span>
                  <span className={`font-bold ${c.trend>0?'text-emerald-500':c.trend<0?'text-red-500':''}`}>מגמה: {c.trend?`${c.trend>0?'+':''}${c.trend.toFixed(0)}%`:'—'}</span>
                </div>
              </>
            )}
          </div>
        )}
      </span>
    );
  };

  const hasAnyData = monthlyData.length>0 || productData.length>0;

  const uploadCards = (
    <div className="space-y-3">
      {uploadError && (
        <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-xs font-medium ${isDarkMode?'bg-red-500/10 text-red-300 border border-red-500/20':'bg-red-50 text-red-700 border border-red-200'}`}>
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5"/>
          <span className="flex-1">{uploadError.text}</span>
          {onDismissError && <button onClick={onDismissError} className="shrink-0 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5"/></button>}
        </div>
      )}
      {uploadSuccess && !uploadError && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium animate-in fade-in duration-200 ${isDarkMode?'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20':'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          <Check className="w-4 h-4 shrink-0"/>
          <span>הקובץ נשמר בהצלחה</span>
        </div>
      )}
      <PrioritySyncBar isDarkMode={isDarkMode} range={priorityRange} lastSyncAt={lastSyncAt} onSync={onSyncPriority} what="נתוני הלקוחות"/>
      {priorityRange && !fileNames.monthly && !fileNames.product ? (
        <details className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
          <summary className="cursor-pointer select-none font-semibold">קבצים ישנים (לא חובה) — רק אם צריך היסטוריה מלפני {isoToDisplay(priorityRange.from)}</summary>
          <div className="mt-3">{renderUploadGrid()}</div>
        </details>
      ) : renderUploadGrid()}
    </div>
  );
  function renderUploadGrid() { return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[
        { label:'מכירות ללקוח בחתך חודשי', sub:'מגמה, נטישה, לקוחות חדשים', fileName:fileNames.monthly, onUpload:onUploadMonthly, onClear:onClearMonthly, isLoading:loading.monthly, count:fileCounts.monthly ?? monthlyData.length },
        { label:'מכירות ללקוח לפי מוצר', sub:priorityRange ? 'תמהיל מוצרים, Cross-sell · כרגע מוצג מ-Priority' : 'תמהיל מוצרים, Cross-sell', fileName:fileNames.product, onUpload:onUploadProduct, onClear:onClearProduct, isLoading:loading.product, count:fileCounts.product ?? productData.length },
      ].map((card,i) => (
        <div key={i} className={`p-4 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <p className={`text-sm font-bold mb-0.5 ${isDarkMode?'text-white':'text-slate-800'}`}>{card.label}</p>
          <p className={`text-xs mb-3 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{card.sub}</p>
          {card.fileName ? (
            <div className="flex items-center gap-2">
              <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl ${isDarkMode?'bg-slate-700/50':'bg-slate-50'}`}>
                <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0"/>
                <span className={`text-xs truncate ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{card.fileName}</span>
                <span className={`text-xs shrink-0 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>({card.count.toLocaleString()})</span>
              </div>
              <button onClick={card.onClear} className={`p-2 rounded-lg ${isDarkMode?'text-red-400 hover:bg-red-500/10':'text-red-500 hover:bg-red-50'}`}><Trash2 className="w-4 h-4"/></button>
            </div>
          ) : (
            <label className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-dashed border-2 cursor-pointer text-xs font-medium transition-colors ${isDarkMode?'border-slate-600 text-slate-400 hover:border-pink-500 hover:text-pink-400':'border-slate-200 text-slate-500 hover:border-pink-400 hover:text-pink-600'}`}>
              {card.isLoading?<Loader2 className="w-4 h-4 animate-spin"/>:<Upload className="w-4 h-4"/>} העלה קובץ
              <input type="file" accept=".xlsx,.xls" onChange={card.onUpload} className="hidden" disabled={card.isLoading}/>
            </label>
          )}
        </div>
      ))}
      </div>
  ); }

  if (!hasAnyData) {
    return (
      <div className="space-y-6 animate-in fade-in duration-400">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="relative mb-4">
            <div className={`absolute inset-0 rounded-full blur-2xl opacity-40 ${isDarkMode?'bg-pink-600':'bg-pink-300'}`}/>
            <div className={`relative p-6 rounded-full ${isDarkMode?'bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700':'bg-gradient-to-br from-slate-50 to-white border border-slate-100'}`}><User className={`w-12 h-12 ${isDarkMode?'text-slate-500':'text-slate-300'}`}/></div>
          </div>
          <h3 className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>אין נתוני לקוחות עדיין</h3>
          <p className={`mt-2 max-w-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>לחץ "סנכרן עכשיו מ-Priority" למעלה — או טען קובץ "מכירות ללקוח בחתך חודשי" / "מכירות ללקוח לפי מוצר"</p>
        </div>
        {uploadCards}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-400">
      {uploadCards}

      {monthlyData.length>0 && (
        <>
          {/* Period filter */}
          {availableMonths.length>0 && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border flex-wrap ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              <div className={`p-2 rounded-xl ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}><Filter className={`w-4 h-4 ${isDarkMode?'text-slate-300':'text-slate-500'}`}/></div>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${isDarkMode?'bg-slate-900 border-slate-700':'bg-slate-50 border-slate-200'}`}>
                <Calendar className={`w-4 h-4 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
                <select value={periodFilter.start} onChange={e=>setPeriodFilter(p=>({...p,start:e.target.value}))}
                  style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}}
                  className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                  {availableMonths.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                <span className={isDarkMode?'text-slate-600':'text-slate-300'}>—</span>
                <select value={periodFilter.end} onChange={e=>setPeriodFilter(p=>({...p,end:e.target.value}))}
                  style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}}
                  className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                  {availableMonths.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {(periodFilter.start!==availableMonths[0]||periodFilter.end!==availableMonths[availableMonths.length-1]) && (
                <button onClick={()=>setPeriodFilter({start:availableMonths[0],end:availableMonths[availableMonths.length-1]})} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${isDarkMode?'bg-red-500/10 text-red-400 hover:bg-red-500/20':'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                  <X className="w-3.5 h-3.5"/> אפס לכל הטווח
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <KPICard title="לקוחות" formatted={kpis.count.toLocaleString()} icon={User} color="purple" isDarkMode={isDarkMode}/>
            <KPICard title="הכנסה כוללת" formatted={formatShort(kpis.totalRevenue)} icon={DollarSign} color="blue" isDarkMode={isDarkMode}/>
            <KPICard title="לקוחות חדשים" formatted={kpis.newCount.toString()} icon={ArrowUpRight} color="green" isDarkMode={isDarkMode}/>
            <KPICard title="לקוחות שנטשו" formatted={kpis.churnedCount.toString()} icon={ArrowDownRight} color="red" subtext={excludeCurrentMonth?"0 הכנסה ב-2 חודשים (לא כולל החודש הנוכחי)":"0 הכנסה ב-2 החודשים האחרונים"} isDarkMode={isDarkMode}/>
            <KPICard title="בסיכון נטישה" formatted={kpis.atRiskCount.toString()} icon={TriangleAlert} color="amber" subtext="לקוחות A/B בירידה 3 חודשים רצופים" isDarkMode={isDarkMode}/>
            <KPICard title="ריכוזיות (5 מובילים)" formatted={`${kpis.top5Pct.toFixed(0)}%`} icon={TriangleAlert} color={kpis.top5Pct>50?'amber':'cyan'} subtext={`לקוח בודד: ${kpis.top1Pct.toFixed(0)}%`} isDarkMode={isDarkMode}/>
          </div>

          <div className={`p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <h3 className={`font-bold flex items-center gap-2 mb-4 ${isDarkMode?'text-white':'text-slate-800'}`}><PieChartIcon className="w-5 h-5 text-pink-500"/>פילוח לקוחות (ABC לפי הכנסה)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={abcSegments} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none">
                    {abcSegments.map((seg,i) => (
                      <Cell key={i} fill={seg.name==='A'?'#f59e0b':seg.name==='B'?'#3b82f6':(isDarkMode?'#475569':'#cbd5e1')}/>
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(v,n,p)=>[`${formatCurrency(v)} (${p.payload.count} לקוחות)`, `קבוצה ${p.payload.name}`]}
                    contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#f1f5f9':'#0f172a'}}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {abcSegments.map((seg,i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2.5 rounded-xl ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background: seg.name==='A'?'#f59e0b':seg.name==='B'?'#3b82f6':(isDarkMode?'#475569':'#cbd5e1')}}/>
                      <span className={`text-sm font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>קבוצה {seg.name}</span>
                      <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{seg.count} לקוחות</span>
                    </div>
                    <span className={`text-sm font-bold ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatShort(seg.value)}</span>
                  </div>
                ))}
                <p className={`text-[11px] mt-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>A = 80% מההכנסה · B = עד 95% · C = שאר 5%</p>
              </div>
            </div>
          </div>

          <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className={`px-5 py-4 border-b flex flex-wrap justify-between items-center gap-3 ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
              <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><User className="w-4 h-4 text-slate-400"/>לקוחות <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500'}`}>{filtered.length.toLocaleString()}</span></h3>
              <div className="flex items-center gap-2">
              {cityOptions.length>0 && (
                <select aria-label="סינון לפי עיר" value={cityFilter} onChange={e=>setCityFilter(e.target.value)}
                  style={isDarkMode?{background:'#0f172a',color:'#f1f5f9'}:{}}
                  className={`px-3 py-2 border rounded-xl text-xs ${isDarkMode?'border-slate-700':'bg-slate-50 border-slate-200'}`}>
                  <option value="">כל הערים</option>
                  {cityOptions.map(([c,n]) => <option key={c} value={c}>{c} ({n})</option>)}
                </select>
              )}
              <div className="relative">
                <Search className={`absolute right-3 top-2.5 w-3.5 h-3.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
                <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder={hasCards?'חיפוש לקוח, עיר או סוכן...':'חיפוש לקוח...'}
                  className={`pr-9 pl-3 py-2 border rounded-xl text-xs w-48 focus:outline-none focus:ring-2 focus:ring-pink-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
              </div>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[460px]">
              <table className={`w-full text-sm text-right ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                <thead className={`text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                  <tr>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='name'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('name','asc')}>לקוח<SortIcon colKey="name" sortConfig={sortConfig}/></th>
                    {hasCards && <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='city'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('city','asc')}>עיר<SortIcon colKey="city" sortConfig={sortConfig}/></th>}
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='abc'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('abc','asc')}>ABC<SortIcon colKey="abc" sortConfig={sortConfig}/></th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='totalRevenue'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('totalRevenue','desc')}>הכנסה כוללת<SortIcon colKey="totalRevenue" sortConfig={sortConfig}/></th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='avgMonthly'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('avgMonthly','desc')}>ממוצע חודשי<SortIcon colKey="avgMonthly" sortConfig={sortConfig}/></th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='trend'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('trend','desc')}>מגמה<SortIcon colKey="trend" sortConfig={sortConfig}/></th>
                    <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500" aria-sort={sortConfig.key==='status'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('status','asc')}>סטטוס<SortIcon colKey="status" sortConfig={sortConfig}/></th>
                    {hasCards && <th className="px-4 py-3 cursor-pointer select-none hover:text-pink-500 whitespace-nowrap" aria-sort={sortConfig.key==='since'?(sortConfig.direction==='asc'?'ascending':'descending'):'none'} onClick={()=>reqSort('since','desc')}>לקוח מאז<SortIcon colKey="since" sortConfig={sortConfig}/></th>}
                    {productData.length>0 && <th className="px-4 py-3"></th>}
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                  {paginatedCustomers.map(c => {
                    const isOpen = expandedCustomer===c.name;
                    const myProducts = productsByCustomer[c.name];
                    return (
                      <React.Fragment key={c.name}>
                        <tr className={`transition-colors ${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50/80'}`}>
                          <td className={`px-4 py-3 font-medium ${isDarkMode?'text-slate-100':'text-slate-800'}`}>
                            {c.name}
                            {(c.agent || c.pay) && <p className={`text-[11px] font-normal ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{[c.agent && `סוכן: ${c.agent}`, c.pay && `תשלום: ${c.pay}`].filter(Boolean).join(' · ')}</p>}
                          </td>
                          {hasCards && <td className="px-4 py-3 text-xs">{c.city || '—'}</td>}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${c.abc==='A'?(isDarkMode?'bg-orange-500/20 text-orange-400':'bg-orange-100 text-orange-700'):c.abc==='B'?(isDarkMode?'bg-blue-500/20 text-blue-400':'bg-blue-100 text-blue-700'):(isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500')}`} title={`${c.revPct.toFixed(1)}% מההכנסות`}>{c.abc}</span>
                          </td>
                          <td className={`px-4 py-3 font-bold tabular-nums ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatCurrency(c.totalRevenue)}</td>
                          <td className="px-4 py-3">{formatShort(c.avgMonthly)}</td>
                          <td className="px-4 py-3">
                            {CustomerTrendButton(c)}
                          </td>
                          <td className="px-4 py-3 flex items-center gap-1.5 flex-wrap">
                            {statusBadge(c.status)}
                            {c.atRisk && (
                              <span title="ירידה 3 חודשים רצופים בהכנסה — כדאי ליצור קשר לפני שהלקוח נוטש לגמרי" className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${isDarkMode?'bg-orange-500/20 text-orange-300':'bg-orange-100 text-orange-700'}`}>
                                <TriangleAlert className="w-2.5 h-2.5"/>בסיכון
                              </span>
                            )}
                          </td>
                          {hasCards && <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">{c.since ? isoToDisplay(c.since) : '—'}</td>}
                          {productData.length>0 && (
                            <td className="px-4 py-3">
                              {myProducts?.length>0 && (
                                <button onClick={()=>setExpandedCustomer(isOpen?null:c.name)} className={`p-1 rounded ${isDarkMode?'text-slate-400 hover:text-pink-400':'text-slate-500 hover:text-pink-600'}`}>
                                  <ChevronDown className={`w-4 h-4 transition-transform ${isOpen?'rotate-180':''}`}/>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {isOpen && myProducts?.length>0 && (() => {
                          const myTotal = myProducts.reduce((s,p)=>s+p.revenue,0);
                          return (
                          <tr>
                            <td colSpan={hasCards?9:7} className={`px-4 py-3 ${isDarkMode?'bg-slate-900/40':'bg-slate-50'}`}>
                              <div className="flex items-center justify-between mb-1">
                                <p className={`text-xs font-bold ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מוצרים שנרכשו — {c.name} ({myProducts.length} מוצרים שונים)</p>
                                <p className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>סה"כ {formatCurrency(myTotal)}</p>
                              </div>
                              <p className={`text-[10px] mb-2 ${isDarkMode?'text-slate-600':'text-slate-400'}`}>{priorityRange ? `מחשבוניות Priority ${isoToDisplay(priorityRange.from)}–${isoToDisplay(priorityRange.to)} — לא מסונן לפי טווח התאריכים` : 'על כל התקופה בקובץ — לא ניתן לסינון לפי תאריך'}</p>
                              <div className="overflow-x-auto max-h-64">
                                <table className="w-full text-xs text-right">
                                  <thead className={`${isDarkMode?'text-slate-500':'text-slate-400'}`}>
                                    <tr>
                                      {sortTh('custProducts','product','מוצר',{className:'px-2 py-1.5 font-medium'})}
                                      {sortTh('custProducts','sku','מק"ט',{className:'px-2 py-1.5 font-medium'})}
                                      {sortTh('custProducts','quantity','כמות',{className:'px-2 py-1.5 font-medium',firstDir:'desc'})}
                                      {sortTh('custProducts','revenue','הכנסה',{className:'px-2 py-1.5 font-medium',firstDir:'desc'})}
                                      {sortTh('custProducts','pct','% מהלקוח',{className:'px-2 py-1.5 font-medium',firstDir:'desc'})}
                                    </tr>
                                  </thead>
                                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-200'}`}>
                                    {sortRows('custProducts', myProducts, { pct: p => p.revenue }).map((p,i) => (
                                      <tr key={i}>
                                        <td className={`px-2 py-1.5 ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.product}</td>
                                        <td className={`px-2 py-1.5 font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.sku}</td>
                                        <td className={`px-2 py-1.5 ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{p.quantity.toLocaleString()}</td>
                                        <td className={`px-2 py-1.5 font-bold ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatCurrency(p.revenue)}</td>
                                        <td className={`px-2 py-1.5 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{myTotal>0?((p.revenue/myTotal)*100).toFixed(1):'0'}%</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                  {filtered.length===0 && <tr><td colSpan={hasCards?9:7} className={`px-4 py-16 text-center text-sm ${isDarkMode?'text-slate-600':'text-slate-400'}`}>לא נמצאו לקוחות</td></tr>}
                </tbody>
              </table>
            </div>
            <div className={`px-5 py-3.5 border-t flex justify-between items-center text-xs ${isDarkMode?'bg-slate-900/30 border-slate-700 text-slate-500':'bg-slate-50 border-slate-100 text-slate-500'}`}>
              <span>מציג {filtered.length>0?(customerPage-1)*customerItemsPerPage+1:0}–{Math.min(customerPage*customerItemsPerPage,filtered.length)} מתוך {filtered.length.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <button onClick={()=>setCustomerPage(p=>Math.max(1,p-1))} disabled={customerPage===1} className={`p-1.5 rounded-lg disabled:opacity-30 ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-200'}`}><ChevronRight className="w-3.5 h-3.5"/></button>
                <span className="font-mono px-2">{customerPage}/{customerTotalPages}</span>
                <button onClick={()=>setCustomerPage(p=>Math.min(customerTotalPages,p+1))} disabled={customerPage===customerTotalPages} className={`p-1.5 rounded-lg disabled:opacity-30 ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-200'}`}><ChevronLeft className="w-3.5 h-3.5"/></button>
              </div>
            </div>
          </div>
        </>
      )}

      {productData.length>0 && (
        <div className={`p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><Box className="w-5 h-5 text-pink-500"/>מוצרים מובילים (כל הלקוחות)</h3>
            <span className={`text-[11px] px-2 py-1 rounded-lg ${isDarkMode?'bg-orange-500/10 text-orange-400':'bg-orange-50 text-orange-700'}`}>{priorityRange ? `חשבוניות Priority ${isoToDisplay(priorityRange.from)}–${isoToDisplay(priorityRange.to)} — לא לפי בורר התאריכים` : 'על כל התקופה בקובץ — לא ניתן לסינון לפי תאריך'}</span>
          </div>
          <p className={`text-xs mb-4 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>קובץ "מכירות ללקוח לפי מוצר" לא כולל עמודת חודש — הסכומים כאן הם סכום מצטבר על כל מה שיובא, בלי קשר לבורר התאריכים שמעל.</p>
          <div className="space-y-1.5">
            {topProductsOverall.map((p,i) => (
              <div key={i} className={`flex items-center justify-between text-sm px-3 py-2 rounded-lg ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                <span className={`truncate ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{p.name}</span>
                <span className={`font-bold shrink-0 ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatShort(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-sell — products frequently bought by the same customers */}
      {crossSellPairs.length>0 && (
        <div className={`p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><Box className="w-5 h-5 text-pink-500"/>נקנים יחד (Cross-sell)</h3>
            <span className={`text-[11px] px-2 py-1 rounded-lg ${isDarkMode?'bg-orange-500/10 text-orange-400':'bg-orange-50 text-orange-700'}`}>{priorityRange ? `חשבוניות Priority ${isoToDisplay(priorityRange.from)}–${isoToDisplay(priorityRange.to)} — לא לפי בורר התאריכים` : 'על כל התקופה בקובץ — לא ניתן לסינון לפי תאריך'}</span>
          </div>
          <p className={`text-xs mb-4 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>זוגות מוצרים שאותו לקוח קנה את שניהם (לא בהכרח באותה עסקה). מבוסס על {Object.keys(productsByCustomer).length.toLocaleString()} לקוחות עם פירוט מוצרים.</p>
          <div className="space-y-1.5">
            {crossSellPairs.map((pair,i) => (
              <div key={i} className={`flex items-center justify-between gap-3 text-sm px-3 py-2.5 rounded-lg ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`truncate ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{pair.a}</span>
                  <span className={`shrink-0 ${isDarkMode?'text-slate-600':'text-slate-300'}`}>+</span>
                  <span className={`truncate ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{pair.b}</span>
                </div>
                <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ${isDarkMode?'bg-pink-500/15 text-pink-300':'bg-pink-50 text-pink-700'}`}>{pair.count} לקוחות</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const OverviewPage = ({ salesData, suppliersData, dateFilter, availableDates, isDarkMode, setActiveTab, excludeCurrentMonth }) => {
  const startVal = dateFilter.start ? getDateVal(dateFilter.start) : 0;
  const endVal = dateFilter.end ? getDateVal(dateFilter.end) : 999999;
  const inRange = (d) => { const v=getDateVal(d.date); return v>=startVal && v<=endVal; };

  const filteredSales = useMemo(() => salesData.filter(inRange), [salesData, dateFilter]);
  const filteredSuppliers = useMemo(() => suppliersData.filter(inRange), [suppliersData, dateFilter]);

  const totalRevenue = filteredSales.reduce((a,c) => a+c.total, 0);
  const totalExpenses = filteredSuppliers.reduce((a,c) => a+c.total, 0);
  const netProfit = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (netProfit/totalRevenue)*100 : 0;
  const totalUnits = filteredSales.reduce((a,c) => a+c.quantity, 0);

  // Monthly combined chart
  const monthlyData = useMemo(() => {
    const map = {};
    filteredSales.forEach(d => { if (!d.date) return; map[d.date] = map[d.date] || {revenue:0,expenses:0}; map[d.date].revenue += d.total; });
    filteredSuppliers.forEach(d => { if (!d.date) return; map[d.date] = map[d.date] || {revenue:0,expenses:0}; map[d.date].expenses += d.total; });
    return Object.entries(map).map(([name,v]) => ({ name, ...v, profit:v.revenue-v.expenses, order:getDateVal(name) })).sort((a,b)=>a.order-b.order);
  }, [filteredSales, filteredSuppliers]);

  // Top products
  const topProducts = useMemo(() => {
    const map = {};
    filteredSales.forEach(d => { if (!d.description) return; map[d.description] = (map[d.description]||0)+d.total; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,total])=>({ name, total, pct: totalRevenue>0?(total/totalRevenue)*100:0 }));
  }, [filteredSales, totalRevenue]);

  // Top suppliers
  const topSuppliers = useMemo(() => {
    const map = {};
    filteredSuppliers.forEach(d => { if (!d.supplier) return; map[d.supplier] = (map[d.supplier]||0)+d.total; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([name,total])=>({ name, total, pct: totalExpenses>0?(total/totalExpenses)*100:0 }));
  }, [filteredSuppliers, totalExpenses]);

  // Trend calc
  const calcTrend = (data, key) => {
    let months = [...new Set(data.map(d=>d.date))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    if (excludeCurrentMonth && months.length>2) months = months.slice(0,-1);
    if (months.length < 2) return 0;
    const last = data.filter(d=>d.date===months[months.length-1]).reduce((a,c)=>a+c[key],0);
    const prev = data.filter(d=>d.date===months[months.length-2]).reduce((a,c)=>a+c[key],0);
    return prev===0 ? 100 : ((last-prev)/prev)*100;
  };

  const revTrend = calcTrend(filteredSales, 'total');
  const profitTrendMonths = excludeCurrentMonth && monthlyData.length>2 ? monthlyData.slice(0,-1) : monthlyData;
  const profitTrend = profitTrendMonths.length>=2 ? (profitTrendMonths[profitTrendMonths.length-1].profit - profitTrendMonths[profitTrendMonths.length-2].profit) / Math.abs(profitTrendMonths[profitTrendMonths.length-2].profit||1) * 100 : 0;

  const sparkRevenue = monthlyData.slice(-8).map(m => ({ value: m.revenue }));
  const sparkProfit = monthlyData.slice(-8).map(m => ({ value: m.profit }));

  // ─── Automatic insights — surfaces things worth noticing without having to dig ───
  const insights = useMemo(() => {
    const list = [];
    if (revTrend >= 25) list.push({ type:'success', icon:ArrowUpRight, text:`עלייה של ${revTrend.toFixed(0)}% בהכנסות החודש לעומת החודש הקודם` });
    else if (revTrend <= -25) list.push({ type:'warning', icon:ArrowDownRight, text:`ירידה של ${Math.abs(revTrend).toFixed(0)}% בהכנסות החודש לעומת החודש הקודם` });

    if (totalRevenue > 0) {
      if (margin < 10) list.push({ type:'warning', icon:TriangleAlert, text:`רווחיות נמוכה — ${fmtPct(margin)} בלבד מההכנסות` });
      else if (margin >= 40) list.push({ type:'success', icon:TrendingUp, text:`רווחיות גבוהה — ${margin.toFixed(1)}% מההכנסות` });
    }

    if (topSuppliers.length && topSuppliers[0].pct >= 40) {
      list.push({ type:'info', icon:Truck, text:`${topSuppliers[0].pct.toFixed(0)}% מההוצאות מגיעות מספק אחד (${topSuppliers[0].name}) — שווה לבדוק תלות` });
    }
    if (topProducts.length && topProducts[0].pct >= 40) {
      list.push({ type:'info', icon:Box, text:`${topProducts[0].pct.toFixed(0)}% מההכנסות מגיעות ממוצר אחד (${topProducts[0].name})` });
    }
    if (netProfit < 0) {
      list.push({ type:'warning', icon:TriangleAlert, text:`הפסד נקי בטווח הנבחר — ${formatCurrency(Math.abs(netProfit))}` });
    }
    return list.slice(0,4);
  }, [revTrend, margin, totalRevenue, topSuppliers, topProducts, netProfit]);

  const noData = salesData.length === 0 && suppliersData.length === 0;

  if (noData) return (
    <div className="flex flex-col items-center justify-center h-96 text-center animate-in fade-in zoom-in">
      <div className="relative mb-4">
        <div className={`absolute inset-0 rounded-full blur-2xl opacity-40 ${isDarkMode?'bg-blue-600':'bg-blue-300'}`}/>
        <div className={`relative p-6 rounded-full ${isDarkMode?'bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700':'bg-gradient-to-br from-slate-50 to-white border border-slate-100'}`}>
          <Home className={`w-12 h-12 ${isDarkMode?'text-slate-500':'text-slate-300'}`} />
        </div>
      </div>
      <h3 className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>ברוך הבא ל-BizData Pro</h3>
      <p className={`mt-2 max-w-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>טען קבצים בלשוניות מכירות או ספקים כדי לראות את ה-Overview המלא</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Auto insights */}
      {insights.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {insights.map((ins, i) => (
            <div key={i} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border ${
              ins.type==='success' ? (isDarkMode?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':'bg-emerald-50 border-emerald-200 text-emerald-700')
              : ins.type==='warning' ? (isDarkMode?'bg-red-500/10 border-red-500/20 text-red-300':'bg-red-50 border-red-200 text-red-700')
              : (isDarkMode?'bg-blue-500/10 border-blue-500/20 text-blue-300':'bg-blue-50 border-blue-200 text-blue-700')
            }`}>
              <ins.icon className="w-3.5 h-3.5 shrink-0"/>
              {ins.text}
            </div>
          ))}
        </div>
      )}
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="הכנסות" formatted={formatShort(totalRevenue)} icon={DollarSign} color="blue" trend={revTrend} sparkData={sparkRevenue} isDarkMode={isDarkMode} onClick={() => setActiveTab('sales')} />
        <KPICard title="הוצאות" formatted={formatShort(totalExpenses)} icon={Wallet} color="red" isDarkMode={isDarkMode} onClick={() => setActiveTab('suppliers')} />
        <KPICard title="רווח נקי" formatted={formatShort(netProfit)} icon={TrendingUp} color={netProfit>=0?'green':'red'} trend={profitTrend} sparkData={sparkProfit} isDarkMode={isDarkMode} onClick={() => setActiveTab('summary')} />
        <KPICard title="מכירות יחידות" formatted={totalUnits.toLocaleString()} icon={Package} color="amber" subtext={`${fmtPct(margin)} מרווח`} isDarkMode={isDarkMode} />
      </div>

      {/* Main charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue vs Expenses area chart */}
        <div className={`lg:col-span-2 p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <div className="flex items-center justify-between mb-5">
            <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
              <BarChart3 className="w-5 h-5 text-blue-500" /> מגמה חודשית
            </h3>
            <div className="flex gap-4 text-xs">
              {[['הכנסות','#3b82f6'],['הוצאות','#ef4444'],['רווח','#10b981']].map(([l,c]) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{background:c}}/>
                  <span className={isDarkMode?'text-slate-400':'text-slate-500'}>{l}</span>
                </span>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={monthlyData} margin={{top:5,right:5,left:0,bottom:5}}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode?'#334155':'#f1f5f9'} />
              <XAxis dataKey="name" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`${v<0?'-':''}₪${Math.abs(v/1000)}k`} width={58} />
              <RechartsTooltip
                formatter={(v,n) => [formatCurrency(v), n]}
                contentStyle={{ backgroundColor:isDarkMode?'#1e293b':'#fff', borderColor:isDarkMode?'#334155':'#e2e8f0', borderRadius:'12px', color:isDarkMode?'#fff':'#0f172a' }}
              />
              <Area type="monotone" dataKey="revenue" name="הכנסות" stroke="#3b82f6" fill="url(#gradRevenue)" strokeWidth={2.5} dot={false} />
              <Bar dataKey="expenses" name="הוצאות" fill="#ef4444" opacity={0.7} radius={[3,3,0,0]} barSize={14} />
              <Line type="monotone" dataKey="profit" name="רווח" stroke="#10b981" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Profit margin gauge + stats */}
        <div className={`p-6 rounded-2xl border flex flex-col gap-4 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
            <Target className="w-5 h-5 text-purple-500" /> מרווח רווחיות
          </h3>
          {/* Gauge SVG */}
          <div className="flex flex-col items-center py-2">
            <svg width="160" height="90" viewBox="0 0 160 90">
              <path d="M 15 80 A 65 65 0 0 1 145 80" fill="none" stroke={isDarkMode?'#334155':'#f1f5f9'} strokeWidth="14" strokeLinecap="round" />
              <path
                d="M 15 80 A 65 65 0 0 1 145 80"
                fill="none"
                stroke={margin > 20 ? '#10b981' : margin > 0 ? '#f59e0b' : '#ef4444'}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0,Math.min(100,margin)) * 2.04} 204`}
                className="transition-all duration-1000"
              />
              <text x="80" y="72" textAnchor="middle" className="font-bold" style={{fontSize:'22px', fill:isDarkMode?'#fff':'#1e293b', fontWeight:700}}>
                {fmtPct(margin)}
              </text>
            </svg>
            <span className={`text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מתוך ₪{(totalRevenue/1000).toFixed(0)}K הכנסות</span>
          </div>

          {/* Quick stats */}
          <div className="space-y-3 mt-auto">
            {[
              { label: 'פריטים ייחודיים', val: new Set(filteredSales.map(d=>d.description)).size, color: 'text-blue-500' },
              { label: 'ספקים פעילים', val: new Set(filteredSuppliers.map(d=>d.supplier)).size, color: 'text-emerald-500' },
              { label: 'חודשי נתונים', val: new Set([...filteredSales,...filteredSuppliers].map(d=>d.date)).size, color: 'text-orange-500' },
            ].map(s => (
              <div key={s.label} className={`flex justify-between items-center py-2 border-b last:border-0 ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
                <span className={`text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{s.label}</span>
                <span className={`font-bold ${s.color}`}>{s.val.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row: Top products + Top suppliers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className={`p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <div className="flex items-center justify-between mb-5">
            <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
              <Zap className="w-5 h-5 text-orange-500" /> מוצרים מובילים
            </h3>
            <button onClick={() => setActiveTab('sales')} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isDarkMode?'text-blue-400 hover:bg-blue-500/10':'text-blue-600 hover:bg-blue-50'}`}>
              הצג הכל ←
            </button>
          </div>
          <div className="space-y-3">
            {topProducts.length === 0 ? <p className={`text-sm text-center py-6 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין נתוני מכירות</p> :
            topProducts.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${i===0?(isDarkMode?'bg-orange-500/20 text-orange-400':'bg-orange-100 text-orange-700'):(isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500')}`}>{i+1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between mb-1">
                    <span className={`text-sm font-medium truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.name}</span>
                    <span className={`text-sm font-bold ml-2 shrink-0 ${isDarkMode?'text-slate-200':'text-slate-800'}`}>{formatShort(p.total)}</span>
                  </div>
                  <div className={`h-1.5 rounded-full overflow-hidden ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                    <div className="h-full rounded-full transition-all duration-700" style={{width:`${p.pct}%`, background:COLORS[i]}} />
                  </div>
                </div>
                <span className={`text-xs w-10 text-right shrink-0 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Suppliers */}
        <div className={`p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <div className="flex items-center justify-between mb-5">
            <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
              <Truck className="w-5 h-5 text-emerald-500" /> ספקים מובילים
            </h3>
            <button onClick={() => setActiveTab('suppliers')} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isDarkMode?'text-blue-400 hover:bg-blue-500/10':'text-blue-600 hover:bg-blue-50'}`}>
              הצג הכל ←
            </button>
          </div>
          <div className="space-y-4">
            {topSuppliers.length === 0 ? <p className={`text-sm text-center py-6 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין נתוני ספקים</p> :
            topSuppliers.map((s, i) => (
              <div key={s.name} className={`flex items-center justify-between p-3 rounded-xl ${isDarkMode?'bg-slate-700/50':'bg-slate-50'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs" style={{background:COLORS[i]+'22', color:COLORS[i]}}>
                    {s.name.slice(0,2)}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{s.name}</p>
                    <p className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{s.pct.toFixed(1)}% מסה"כ</p>
                  </div>
                </div>
                <span className={`font-bold ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{formatShort(s.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Empty State
// "Sync from Priority" call-to-action used on the sales and customers tabs.
const PrioritySyncBar = ({ isDarkMode, range, lastSyncAt, onSync, what }) => (
  <div className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-sm border ${isDarkMode?'bg-blue-500/10 border-blue-500/20 text-blue-200':'bg-blue-50 border-blue-200 text-blue-900'}`}>
    <RefreshCw className="w-4 h-4 shrink-0"/>
    <p className="flex-1 min-w-[240px]">
      {range
        ? <>{what} מתעדכנים מחשבוניות המכירה ב-Priority ({isoToDisplay(range.from)}–{isoToDisplay(range.to)}){lastSyncAt ? ` · סונכרן לאחרונה ${new Date(lastSyncAt).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}` : ''}. לא צריך להעלות קבצים.</>
        : <>אפשר למשוך את {what} ישירות מ-Priority, בלי קבצים. הסנכרון הראשון לוקח כמה דקות.</>}
    </p>
    {onSync && <button type="button" onClick={onSync} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700">
      <Activity className="w-4 h-4"/> סנכרן עכשיו מ-Priority
    </button>}
  </div>
);

const EmptyState = ({ onUpload, loading, isDarkMode, activeTab, onSync }) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in zoom-in duration-500">
    <div className="relative mb-6">
      <div className={`absolute inset-0 rounded-3xl blur-2xl opacity-40 ${isDarkMode?'bg-blue-600':'bg-blue-300'}`}/>
      <div className={`relative p-8 rounded-3xl ${isDarkMode?'bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700':'bg-gradient-to-br from-slate-50 to-white border border-slate-100'}`}>
        <FileSpreadsheet className={`w-14 h-14 ${isDarkMode?'text-slate-500':'text-slate-300'}`} />
      </div>
    </div>
    <h3 className={`text-2xl font-bold mb-2 ${isDarkMode?'text-white':'text-slate-800'}`}>אין נתונים עדיין</h3>
    <p className={`max-w-xs mb-2 text-sm leading-relaxed ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
      טען קבצי Excel או CSV של מכירות / ספקים כדי להתחיל
    </p>
    {activeTab==='sales' && onSync && (
      <button type="button" onClick={onSync} className="mb-4 inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700">
        <Activity className="w-4 h-4"/> סנכרן מכירות מ-Priority
      </button>
    )}
    {activeTab==='sales' && (
      <p className={`max-w-xs mb-6 text-xs px-3 py-1.5 rounded-lg ${isDarkMode?'bg-slate-800 text-slate-400 border border-slate-700':'bg-slate-100 text-slate-500 border border-slate-200'}`}>
        שם הקובץ הנדרש: <span className="font-bold">מכירות חודשיות לפי מוצר</span>
      </p>
    )}
    <label className="group flex items-center gap-3 px-7 py-3.5 bg-gradient-to-l from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-2xl cursor-pointer transition-all hover:scale-105 shadow-lg shadow-blue-500/25 font-medium">
      {loading ? <Loader2 className="w-5 h-5 animate-spin"/> : <Upload className="w-5 h-5"/>}
      בחר קבצים
      <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onUpload} className="hidden" disabled={loading}/>
    </label>
    <div className="flex items-center gap-1.5 mt-4">
      {['.xlsx','.xls','.csv'].map(ext => (
        <span key={ext} className={`px-2 py-0.5 rounded-md text-[11px] font-mono ${isDarkMode?'bg-slate-800 text-slate-400 border border-slate-700':'bg-slate-100 text-slate-500 border border-slate-200'}`}>{ext}</span>
      ))}
    </div>
  </div>
);

// Autocomplete
const Autocomplete = ({ options, value, onChange, placeholder, icon: Icon, multiple=false, maxSelections=Infinity, isDarkMode }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (!multiple) setSearch(value||''); }, [value, multiple]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); if (!multiple) setSearch(value||''); else setSearch(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [value, multiple]);
  const filtered = useMemo(() => !search ? options : options.filter(o=>smartMatch(o, search)), [options, search]);
  const handleSelect = (opt) => {
    if (multiple) { onChange(value.includes(opt) ? value.filter(v=>v!==opt) : value.length<maxSelections ? [...value,opt] : value); setSearch(''); }
    else { onChange(opt); setSearch(opt); setOpen(false); }
  };
  const limitReached = multiple && value.length >= maxSelections;
  return (
    <div className="relative w-full" ref={ref}>
      <div
        className={`relative flex items-center flex-wrap gap-1.5 w-full pl-9 pr-4 py-2.5 border rounded-xl transition-all cursor-text
          ${isDarkMode?'bg-slate-900 border-slate-700 focus-within:border-blue-500 text-white':'bg-white border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-50 text-slate-800'}
          ${limitReached?isDarkMode?'border-orange-500/40':'border-orange-200 bg-orange-50/50':''}`}
        onClick={() => document.getElementById(`ac-${placeholder}`)?.focus()}
      >
        {Icon && <Icon className={`absolute right-3 top-3 w-4 h-4 pointer-events-none ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>}
        {multiple && Array.isArray(value) && value.map(v=>(
          <span key={v} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${isDarkMode?'bg-blue-500/20 text-blue-200 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-100'}`}>
            <span className="max-w-[100px] truncate">{v}</span>
            <X className="w-3 h-3 cursor-pointer hover:text-red-500" onClick={e=>{e.stopPropagation();onChange(value.filter(x=>x!==v));}}/>
          </span>
        ))}
        <input id={`ac-${placeholder}`} type="text" className={`flex-1 bg-transparent border-none focus:ring-0 text-sm min-w-[80px] p-0 ${isDarkMode?'text-white placeholder-slate-500':'text-slate-700 placeholder-slate-400'}`}
          placeholder={multiple&&value.length>0?(limitReached?'מקסימום':''):placeholder}
          value={search} disabled={limitReached}
          onChange={e=>{setSearch(e.target.value);setOpen(true);if(!multiple&&!e.target.value)onChange('');}}
          onFocus={()=>setOpen(true)}
        />
        {(search||(multiple&&value.length>0)||(!multiple&&value))
          ? <button onClick={e=>{e.stopPropagation();setSearch('');onChange(multiple?[]:'');if(!multiple)setOpen(false);}} className="absolute left-2 top-3 text-slate-400 hover:text-red-500"><X className="w-4 h-4"/></button>
          : <ChevronDown className={`absolute left-2 top-3 w-4 h-4 pointer-events-none ${isDarkMode?'text-slate-600':'text-slate-300'}`}/>
        }
      </div>
      {open && !limitReached && (
        <div
          style={isDarkMode?{background:'#1e293b',borderColor:'#334155',color:'#f1f5f9'}:{background:'#fff',borderColor:'#f1f5f9',color:'#0f172a'}}
          className="absolute z-50 w-full mt-1.5 border rounded-xl shadow-2xl max-h-52 overflow-y-auto text-right animate-in fade-in slide-in-from-top-1 duration-150">
          {filtered.length>0 ? filtered.map((opt,i)=>{
            const sel = multiple?value.includes(opt):value===opt;
            return <div key={i}
              style={isDarkMode
                ? { borderBottomColor:'rgba(51,65,85,0.5)', color: sel?'#93c5fd':'#cbd5e1', background: sel?'rgba(30,58,138,0.3)':'transparent' }
                : { borderBottomColor:'#f8fafc', color: sel?'#1d4ed8':'#334155', background: sel?'#eff6ff':'transparent' }
              }
              className="px-4 py-2.5 cursor-pointer text-sm flex items-center justify-between border-b last:border-0 transition-colors hover:opacity-80"
              onClick={()=>handleSelect(opt)}>
              <span className={sel?'font-medium':''}>{opt}</span>
              {sel && <Check className="w-4 h-4 text-blue-500"/>}
            </div>;
          }) : <div style={isDarkMode?{color:'#64748b'}:{color:'#94a3b8'}} className="px-4 py-3 text-sm text-center">לא נמצאו תוצאות</div>}
        </div>
      )}
    </div>
  );
};

// Clear Modal
const ClearModal = ({ isOpen, onClose, onConfirm, type, isDarkMode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center ${isDarkMode?'bg-slate-800':'bg-white'}`}>
        <div className={`p-4 rounded-full mb-5 ${isDarkMode?'bg-red-500/10':'bg-red-50'}`}>
          <AlertTriangle className="w-9 h-9 text-red-500"/>
        </div>
        <h3 className={`text-xl font-bold mb-2 ${isDarkMode?'text-white':'text-slate-800'}`}>מחיקת נתונים</h3>
        <p className={`mb-7 text-sm leading-relaxed ${isDarkMode?'text-slate-400':'text-slate-600'}`}>
          האם למחוק את כל נתוני ה<strong>{type==='sales'?'מכירות':type==='suppliers'?'ספקים':(type==='overview'||type==='procurement')?'מערכת (מכירות + ספקים)':'מערכת'}</strong>? פעולה זו אינה הפיכה.
        </p>
        <div className="flex gap-3 w-full">
          <button onClick={onClose} className={`flex-1 py-3 rounded-xl font-medium ${isDarkMode?'bg-slate-700 text-slate-300 hover:bg-slate-600':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>ביטול</button>
          <button onClick={()=>{onConfirm();onClose();}} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 shadow-lg shadow-red-600/20">מחק</button>
        </div>
      </div>
    </div>
  );
};

// AI Report Modal
const AIModal = ({ isOpen, onClose, loading, report, isDarkMode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden ${isDarkMode?'bg-slate-800 border border-slate-700':'bg-white'}`}>
        <div className={`p-6 border-b flex justify-between items-center ${isDarkMode?'border-slate-700 bg-slate-900/50':'border-slate-100 bg-gradient-to-l from-indigo-50 to-white'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDarkMode?'bg-indigo-500/20':'bg-indigo-100'}`}><Sparkles className="w-5 h-5 text-indigo-500"/></div>
            <h2 className={`text-lg font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>תובנות AI</h2>
          </div>
          <button onClick={onClose} className={`p-2 rounded-full ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-100'}`}><X className={`w-5 h-5 ${isDarkMode?'text-slate-400':'text-slate-500'}`}/></button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 text-right" dir="rtl">
          {loading ? (
            <div className="flex flex-col items-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin"/>
              <p className={`font-medium animate-pulse ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מנתח נתונים...</p>
            </div>
          ) : (
            <p className={`whitespace-pre-wrap leading-relaxed ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{report || 'לא ניתן להפיק דוח.'}</p>
          )}
        </div>
        <div className={`p-4 border-t flex justify-end ${isDarkMode?'border-slate-700 bg-slate-900/30':'border-slate-100 bg-slate-50'}`}>
          <button onClick={onClose} className={`px-6 py-2 rounded-xl text-sm font-medium border ${isDarkMode?'border-slate-600 text-slate-300 hover:bg-slate-700':'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>סגור</button>
        </div>
      </div>
    </div>
  );
};

// Chat Window
const ChatWindow = ({ isOpen, onClose, onSend, messages, thinking, isDarkMode }) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  useEffect(() => { if (isOpen) bottomRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages, isOpen]);
  const submit = (e) => { e.preventDefault(); if (!input.trim()) return; onSend(input); setInput(''); };
  if (!isOpen) return null;
  return (
    <div className={`fixed bottom-24 left-6 z-50 w-96 h-[520px] rounded-2xl shadow-2xl border flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-300 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
      <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-1.5 rounded-lg"><Bot className="w-4 h-4"/></div>
          <div>
            <p className="font-bold text-sm">עוזר AI</p>
            <p className="text-[10px] opacity-70">שאל על הנתונים שלך</p>
          </div>
        </div>
        <button onClick={onClose} className="hover:bg-white/20 rounded-full p-1.5"><X className="w-4 h-4"/></button>
      </div>
      <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${isDarkMode?'bg-slate-900':'bg-slate-50'}`}>
        {messages.length===0 && (
          <div className={`text-center text-sm mt-16 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
            <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30"/>
            <p>שאל כל שאלה על הנתונים שלך</p>
          </div>
        )}
        {messages.map((m,i)=>(
          <div key={i} className={`flex ${m.role==='user'?'justify-start':'justify-end'}`}>
            <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.role==='user'?(isDarkMode?'bg-slate-700 text-white rounded-br-sm border border-slate-600':'bg-white text-slate-800 rounded-br-sm border border-slate-100 shadow-sm'):'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-bl-sm'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-end">
            <div className={`p-3 rounded-2xl rounded-bl-sm flex gap-1.5 ${isDarkMode?'bg-slate-800':'bg-indigo-50'}`}>
              {[0,150,300].map(d=><div key={d} className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay:`${d}ms`}}/>)}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>
      <form onSubmit={submit} className={`p-3 border-t flex gap-2 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
        <input type="text" value={input} onChange={e=>setInput(e.target.value)} placeholder="הקלד שאלה..."
          className={`flex-1 border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-700 border-slate-600 text-white placeholder-slate-400':'bg-slate-50 border-slate-200'}`}/>
        <button type="submit" disabled={thinking||!input.trim()} className={`p-2.5 rounded-full text-white transition-all active:scale-95 ${thinking||!input.trim()?'bg-slate-400 cursor-not-allowed':'bg-blue-600 hover:bg-blue-700 shadow-md'}`}>
          <Send className="w-4 h-4"/>
        </button>
      </form>
    </div>
  );
};

// Sort indicator
const SortIcon = ({ colKey, sortConfig }) => {
  if (sortConfig.key !== colKey) return <ArrowDown className="w-3 h-3 opacity-20 inline ml-1"/>;
  return sortConfig.direction === 'asc' ? <ArrowDown className="w-3 h-3 inline ml-1 text-blue-500 rotate-180"/> : <ArrowDown className="w-3 h-3 inline ml-1 text-blue-500"/>;
};


// ─── Click-to-sort for any table ───────────────────────────────────
// One hook per page; every table on it gets an id. Click a header: sort up,
// click again: down, third click: back to the table's own default order.
// Values are compared smartly — numbers as numbers, dates (dd/mm/yyyy,
// yyyy-mm-dd, mm-yy) as dates, text in Hebrew order — and empty cells always
// go to the bottom.
const sortKeyOf = (v) => {
  if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return isNaN(v) ? null : v.getTime();
  const s = String(v).trim();
  if (s === '—' || s === '-') return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return Date.UTC(y, +m[2]-1, +m[1]); }
  m = s.match(/^(\d{1,2})-(\d{2})$/); // "MM-YY" month keys
  if (m) return Date.UTC(2000 + +m[2], +m[1]-1, 1);
  return s;
};
const compareSortKeys = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a.localeCompare(b, 'he', { numeric: true, sensitivity: 'base' });
};
const useTableSort = () => {
  const [sorts, setSorts] = useState({});
  const toggle = (id, key, firstDir) => setSorts(prev => {
    const cur = prev[id];
    const next = !cur || cur.key !== key ? { key, dir: firstDir } : cur.dir === firstDir ? { key, dir: firstDir === 'asc' ? 'desc' : 'asc' } : null;
    return { ...prev, [id]: next };
  });
  // getters: { key: row => value } — anything not listed is read as row[key].
  const sortRows = (id, rows, getters = {}) => {
    const st = sorts[id];
    if (!st || !rows) return rows;
    const get = getters[st.key] || (r => r?.[st.key]);
    const mul = st.dir === 'asc' ? 1 : -1;
    return rows.map((r, i) => [r, sortKeyOf(get(r)), i]).sort((x, y) => {
      if (x[1] === null || y[1] === null) return x[1] === y[1] ? x[2] - y[2] : x[1] === null ? 1 : -1;
      return compareSortKeys(x[1], y[1]) * mul || x[2] - y[2];
    }).map(x => x[0]);
  };
  const sortIcon = (id, key) => {
    const st = sorts[id];
    const on = st && st.key === key;
    return <ArrowDown aria-hidden="true" className={`w-3 h-3 shrink-0 transition-transform ${on ? 'text-blue-500' : 'opacity-25'} ${on && st.dir === 'asc' ? 'rotate-180' : ''}`}/>;
  };
  const ariaSort = (id, key) => { const st = sorts[id]; return st && st.key === key ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'; };
  const sortButton = (id, key, label, firstDir = 'asc') => (
    <button type="button" onClick={(e) => { e.stopPropagation(); toggle(id, key, firstDir); }}
      title="לחץ למיון"
      className="inline-flex items-center gap-1 text-right hover:text-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
      <span>{label}</span>{sortIcon(id, key)}
    </button>
  );
  // <th> for real tables
  const sortTh = (id, key, label, { className = 'px-4 py-3', firstDir = 'asc', style } = {}) => (
    <th key={key} className={className} style={style} aria-sort={ariaSort(id, key)}>{sortButton(id, key, label, firstDir)}</th>
  );
  // header cell for div-grid "tables"
  const sortHead = (id, key, label, { className = '', firstDir = 'asc' } = {}) => (
    <div key={key} className={className}>{sortButton(id, key, label, firstDir)}</div>
  );
  const setSort = (id, key, dir = 'asc') => setSorts(prev => ({ ...prev, [id]: key ? { key, dir } : null }));
  return { sortRows, sortTh, sortHead, setSort, sortState: sorts };
};










// Builds a downloadable RTL .xls from an HTML table body (same approach used
// everywhere else in the app — ExcelJS doesn't load reliably from CDN).
const downloadXls = (sheetName, bodyHtml, fileName) => {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${sheetName}</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml></head><body>${bodyHtml}</body></html>`;
  const blob = new Blob(['﻿'+html], { type:'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.style.display='none'; a.href=url; a.setAttribute('download', fileName);
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
};
const escHtml = (s) => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ─── PURCHASING FILES: sales lines, supplier invoice lines, forwarder report ───
// Each Priority report / forwarder file has its own header row (the forwarder
// file has a 5-line title block above it), so every parser first finds the row
// that holds the expected column names instead of assuming row 1.
const readSheetAsRows = (file) => new Promise((resolve, reject) => {
  if (!window.XLSX) { reject(new Error('ספריית Excel עדיין נטענת — נסה שוב בעוד רגע.')); return; }
  const r = new FileReader();
  r.onload = (ev) => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type:'array', cellDates:true });
      resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'', raw:true }));
    } catch { reject(new Error('לא הצלחתי לקרוא את הקובץ — ודא שזה קובץ Excel תקין.')); }
  };
  r.onerror = () => reject(new Error('קריאת הקובץ נכשלה.'));
  r.readAsArrayBuffer(file);
});







// ─── PROCUREMENT PAGE ──────────────────────────────────
const ProcurementPage = ({ syncRequest = null, onSyncRequestHandled, onSyncDone, onSalesLinesChange, onCustomersChange, salesData: salesDataRaw, suppliersData = [], onOpenSupplierAnalytics, isDarkMode, apiKey, costMap, setCostMap, currencyMap, setCurrencyMap, exchangeRates, jumpTo, onJumpToSales, excludeCurrentMonth, otherSources = [] }) => {
  const [stockMap, setStockMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementStock')||'{}'); } catch { return {}; } });
  // SKU → product name, captured from the inventory file. Needed so items
  // that are in stock but never appear in sales can still be shown by name
  // in the dead-stock report (before this, they didn't exist anywhere).
  const [nameMap, setNameMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementNames')||'{}'); } catch { return {}; } });
  // SKU → [{d:'yyyy-mm-dd', c:cost, cur}] — a new entry is appended whenever an
  // inventory import brings a different purchase price than the last one seen.
  const [costHistory, setCostHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementCostHistory')||'{}'); } catch { return {}; } });
  // Log of orders that were received — the only way to measure how long a
  // supplier REALLY takes vs. the lead time configured for it.
  const [receiptLog, setReceiptLog] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementReceiptLog')||'[]'); } catch { return []; } });
  const saveReceiptLog = (log) => {
    const trimmed = log.slice(-2000);
    setReceiptLog(trimmed);
    try { localStorage.setItem('procurementReceiptLog', JSON.stringify(trimmed)); } catch { /* best-effort */ }
  };

  // ── Purchasing files (sales lines, supplier invoice lines, forwarder report) ──
  // Big datasets live in IndexedDB; a small summary of each file lives in localStorage.
  // All stored invoice lines (incl. value-only lines, x:1); procurement looks only at product lines.
  const [salesLinesAll, setSalesLinesAll] = useState([]);
  // Item-card extras from Priority: family, own production, average cost, list price, last sale / purchase
  const [itemsExtra, setItemsExtra] = useState({});
  const [familyFilter, setFamilyFilter] = useState('');
  const setSalesLines = (arr) => { setSalesLinesAll(arr); onSalesLinesChange?.(arr); };
  const salesLines = useMemo(() => salesLinesAll.filter(l => !l.x), [salesLinesAll]);
  const [purchaseLines, setPurchaseLines] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [filesMeta, setFilesMeta] = useState(() => { try { return JSON.parse(localStorage.getItem('procFilesMeta')||'{}'); } catch { return {}; } });
  const [fileBusy, setFileBusy] = useState(null);   // slot key being loaded
  const [fileMsg, setFileMsg] = useState(null);     // {slot, kind:'ok'|'error', text}
  const [shipSupOverride, setShipSupOverride] = useState(() => { try { return JSON.parse(localStorage.getItem('procShipSupplierMap')||'{}'); } catch { return {}; } });
  // Order quantities the user typed (SKU → qty), kept until the PO shows up in Priority's open-orders file.
  const [draftQty, setDraftQty] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementDraftQty')||'{}'); } catch { return {}; } });
  const saveDraft = (next) => { setDraftQty(next); try { localStorage.setItem('procurementDraftQty', JSON.stringify(next)); } catch { /* best-effort */ } };
  const [vendor, setVendor] = useState(null);       // supplier page open (name) or null = supplier list
  const [vendorSearch, setVendorSearch] = useState('');
  const [copiedVendor, setCopiedVendor] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, b, c, x] = await Promise.all([idbGet('procSalesLines'), idbGet('procPurchaseLines'), idbGet('procShipments'), idbGet('procItemsExtra')]);
        if (cancelled) return;
        if (x && typeof x === 'object') setItemsExtra(x);
        if (Array.isArray(a)) setSalesLinesAll(a);
        if (Array.isArray(b)) setPurchaseLines(b);
        if (Array.isArray(c)) setShipments(c);
      } catch { /* IndexedDB unavailable — the slots simply show "not loaded" */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const saveFileMeta = (slot, meta) => {
    setFilesMeta(prev => {
      const next = { ...prev, [slot]: { ...meta, at: Date.now() } };
      try { localStorage.setItem('procFilesMeta', JSON.stringify(next)); } catch { /* best-effort */ }
      return next;
    });
  };
  const SLOT_TITLES = { salesLines:'שורות חשבוניות מכירה', purchaseLines:'שורות חשבוניות ספק', shipments:'דוח משלוחים מהמשלח', openOrders:'הזמנות רכש פתוחות', inventory:'יתרות מלאי', masterCard:'כרטיס פריט' };
  // opts.mergeFrom ('YYYY-MM-DD'): incremental Priority pull — keep stored lines before that date, replace the rest.
  const handleProcFile = async (e, slot, opts = {}) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setFileBusy(slot); setFileMsg(null);
    try {
      const rows = await readSheetAsRows(file);
      const detected = detectProcFileType(rows);
      if (detected && detected !== slot) {
        setFileMsg({ slot, kind:'error', text:`זה נראה כמו קובץ "${SLOT_TITLES[detected]||detected}", לא "${SLOT_TITLES[slot]}". העלה אותו במשבצת המתאימה.` });
        return;
      }
      if (slot === 'salesLines') {
        let parsed = parseSalesLines(rows);
        if (!parsed) throw new Error('לא נמצאו עמודות תאריך / שם לקוח / מק"ט / כמות בקובץ.');
        if (opts.mergeFrom) parsed = mergeLinesSince(salesLinesAll, parsed, opts.mergeFrom);
        if (!parsed.length) throw new Error('לא נמצאו שורות מכירה.');
        await idbSet('procSalesLines', parsed);
        setSalesLines(parsed);
        saveFileMeta(slot, { name:file.name, rows:parsed.length, from:parsed[parsed.length-1].d, to:parsed[0].d });
        setFileMsg({ slot, kind:'ok', text:`נטענו ${parsed.length.toLocaleString()} שורות מכירה (${isoToDisplay(parsed[parsed.length-1].d)}–${isoToDisplay(parsed[0].d)})` });
      } else if (slot === 'purchaseLines') {
        let parsed = parsePurchaseLines(rows);
        if (!parsed) throw new Error('לא נמצאו עמודות תאריך / שם ספק / מק"ט / כמות בקובץ.');
        if (opts.mergeFrom) parsed = mergeLinesSince(purchaseLines, parsed, opts.mergeFrom);
        if (!parsed.length) throw new Error('לא נמצאו שורות קנייה.');
        await idbSet('procPurchaseLines', parsed);
        setPurchaseLines(parsed);
        saveFileMeta(slot, { name:file.name, rows:parsed.length, from:parsed[parsed.length-1].d, to:parsed[0].d });
        setFileMsg({ slot, kind:'ok', text:`נטענו ${parsed.length.toLocaleString()} שורות קנייה מ-${new Set(parsed.map(x=>x.s)).size} ספקים` });
      } else if (slot === 'shipments') {
        const parsed = parseShipments(rows);
        if (!parsed) throw new Error('לא נמצאו העמודות Supplier Name / Arrival Date בקובץ.');
        // Track arrival-date changes between the daily files.
        const prev = Object.fromEntries(shipments.map(s => [s.id, s]));
        const today = new Date().toISOString().slice(0,10);
        const merged = parsed.map(s => {
          const old = prev[s.id];
          let change = old?.change || null;
          if (old && old.arr && s.arr && old.arr !== s.arr) change = { from: old.arr, to: s.arr, at: today };
          return { ...s, change, firstSeen: old?.firstSeen || today };
        });
        await idbSet('procShipments', merged);
        setShipments(merged);
        const changed = merged.filter(s => s.change && s.change.at === today).length;
        saveFileMeta(slot, { name:file.name, rows:merged.length });
        setFileMsg({ slot, kind:'ok', text:`נטענו ${merged.length} משלוחים${changed?` · ${changed} שינו תאריך הגעה`:''}` });
      }
    } catch (err) {
      setFileMsg({ slot, kind:'error', text: err.message || 'טעינת הקובץ נכשלה.' });
    } finally { setFileBusy(null); }
  };

  // Monthly sales the page works from: months covered by the sales-lines file
  // come from the lines (exact, incl. zero-priced kit components and returns);
  // older months still come from the monthly file loaded in "מכירות".
  const salesData = useMemo(() => mergeLinesIntoMonthly(salesDataRaw, salesLines), [salesDataRaw, salesLines]);

  // Per-SKU indexes for the product drawer and supplier figures
  const linesBySku = useMemo(() => { const m = {}; salesLines.forEach(l => { (m[l.k] ||= []).push(l); }); return m; }, [salesLines]);
  const purchBySku = useMemo(() => { const m = {}; purchaseLines.forEach(l => { if (!l.junk) (m[l.k] ||= []).push(l); }); return m; }, [purchaseLines]);
  // Supplier per SKU from the most recent purchase (fallback when the item card has none)
  const lastSupBySku = useMemo(() => { const m = {}; purchaseLines.forEach(l => { if (!l.junk && !m[l.k]) m[l.k] = l; }); return m; }, [purchaseLines]);
  // Supplier-level figures from supplier invoices
  const purchBySupplier = useMemo(() => {
    const out = {};
    const cutoff = new Date(Date.now() - 365*DAY_MS).toISOString().slice(0,10);
    const leadSeen = new Set();
    purchaseLines.forEach(l => {
      const s = out[l.s] ||= { spend12:0, lastInv:'', lastPo:'', lastPoDate:'', leadSum:0, leadN:0, curCount:{}, lines:0 };
      if (l.d >= cutoff) s.spend12 += l.tot * (l.rate || 1);
      if (l.d > s.lastInv) s.lastInv = l.d;
      if (l.pod && l.pod > s.lastPoDate) { s.lastPoDate = l.pod; s.lastPo = l.po; }
      s.curCount[l.cur] = (s.curCount[l.cur]||0) + 1; s.lines++;
      const lk = l.po + '|' + l.inv;
      if (l.pod && l.po && !leadSeen.has(lk)) { leadSeen.add(lk); const days = daysBetween(l.pod, l.d); if (days >= 0 && days < 400) { s.leadSum += days; s.leadN++; } }
    });
    Object.values(out).forEach(s => {
      s.avgLeadDays = s.leadN ? Math.round(s.leadSum / s.leadN) : null;
      s.mainCur = Object.entries(s.curCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'ILS';
    });
    return out;
  }, [purchaseLines]);
  const [minStockMap, setMinStockMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementMinStock')||'{}'); } catch { return {}; } });
  const [supplierMap, setSupplierMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementSupplier')||'{}'); } catch { return {}; } });
  const [moqMap, setMoqMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementMOQ')||'{}'); } catch { return {}; } });
  // Lead time per SUPPLIER (months) — overrides the global slider for that supplier's
  // products. Keyed by supplier name since lead time is fundamentally a shipping-route
  // property, not a per-product one (a supplier in China ships everything slowly).
  const [leadTimeMap, setLeadTimeMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementLeadTime')||'{}'); } catch { return {}; } });
  const [colWidths, setColWidths] = useState(() => {
    try { return { ...PROC_COL_DEFAULTS, ...JSON.parse(localStorage.getItem('procurementColWidths')||'{}') }; }
    catch { return { ...PROC_COL_DEFAULTS }; }
  });
  useEffect(() => { localStorage.setItem('procurementColWidths', JSON.stringify(colWidths)); }, [colWidths]);
  const resizeRef = useRef(null); // {key, startX, startWidth, liveWidth}
  const handleColResizeMove = useCallback((e) => {
    const r = resizeRef.current; if (!r) return;
    // RTL layout: dragging the handle left (clientX decreasing) widens the column
    // to its left, since the column's right edge stays anchored.
    const delta = r.startX - e.clientX;
    const min = PROC_COL_MIN[r.key]||50;
    const newWidth = Math.max(min, r.startWidth + delta);
    r.liveWidth = newWidth;
    // Mutate the DOM directly while dragging — updating React state on every
    // mousemove would re-render every row in every visible table (main +
    // every expanded supplier table) on every pixel of movement, which is
    // what made resizing feel sluggish on large product lists.
    document.querySelectorAll(`col[data-colkey="${r.key}"]`).forEach(col => { col.style.width = newWidth+'px'; });
    document.querySelectorAll(`th[data-colkey="${r.key}"]`).forEach(th => { th.style.width = newWidth+'px'; th.style.maxWidth = newWidth+'px'; });
    document.querySelectorAll(`table[data-proctable]`).forEach(t => {
      const total = PROC_COL_KEYS.reduce((s,k)=> s + (k===r.key ? newWidth : (parseFloat(t.querySelector(`col[data-colkey="${k}"]`)?.style.width)||PROC_COL_DEFAULTS[k])), 0);
      t.style.width = total+'px';
    });
  }, []);
  const handleColResizeEnd = useCallback(() => {
    const r = resizeRef.current;
    // Commit the final width to React state once — this is the only re-render
    // the whole resize gesture triggers, keeping everything else in sync
    // (other tables that weren't visible/mounted during the drag, persistence, etc).
    if (r && r.liveWidth != null) {
      setColWidths(prev => ({ ...prev, [r.key]: r.liveWidth }));
    }
    resizeRef.current = null;
    document.removeEventListener('mousemove', handleColResizeMove);
    document.removeEventListener('mouseup', handleColResizeEnd);
  }, [handleColResizeMove]);
  const handleColResizeStart = useCallback((key, e) => {
    e.preventDefault(); e.stopPropagation();
    resizeRef.current = { key, startX: e.clientX, startWidth: colWidths[key]||PROC_COL_DEFAULTS[key]||100, liveWidth: null };
    document.addEventListener('mousemove', handleColResizeMove);
    document.addEventListener('mouseup', handleColResizeEnd);
  }, [colWidths, handleColResizeMove, handleColResizeEnd]);
  // Double-click a column's resize handle: shrink it to just fit its longest value.
  const autoFitProcColumn = useCallback((key, items) => {
    const font = '13px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    const values = [PROC_COL_LABELS[key], ...items.map(p=>getProcColValue(key,p))];
    const maxTextWidth = values.reduce((m,v)=>Math.max(m, measureTextWidth(v, font)), 0);
    const padding = PROC_COL_EXTRA_PADDING[key]||30;
    const min = PROC_COL_MIN[key]||50;
    setColWidths(prev => ({ ...prev, [key]: Math.max(min, Math.ceil(maxTextWidth + padding)) }));
  }, []);
  const [monthsToStock, setMonthsToStock] = useState(2);
  const [leadTime, setLeadTime] = useState(1);
  const [abcFilter, setAbcFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all'); // 'all'|'critical'|'low'|'ok'|'unknown'
  // Set by the action cards at the top: 'all' | 'order' | 'late'
  const [actionFilter, setActionFilter] = useState('all');
  // Product whose details drawer is open (by key), or null
  const [drawerKey, setDrawerKey] = useState(null);
  // Planning settings panel (uploads + parameters) — collapsed by default once
  // inventory files exist, so the page opens on "what to do", not on setup.
  const [settingsOpen, setSettingsOpen] = useState(() => { try { const sl = JSON.parse(localStorage.getItem('procurementInvSlots')||'null'); return !(sl && (sl.product || sl.masterCard)); } catch { return true; } });
  const [searchTerm, setSearchTerm] = useState('');
  // Arrived here via a "jump to procurement" link from the Sales tab — drop the
  // product name straight into this page's own search box.
  useEffect(() => { if (jumpTo?.term) setSearchTerm(jumpTo.term); }, [jumpTo]);
  // Default: most urgent first, then by order value — "what do I do first".
  const [sortConfig, setSortConfig] = useState({ key:'statusRank', direction:'asc' });
  const [editingStock, setEditingStock] = useState(null);
  const [editingMOQ, setEditingMOQ] = useState(null);
  const [editingLeadTime, setEditingLeadTime] = useState(null); // supplier name being edited
  const [invLoading, setInvLoading] = useState(false);
  const [invUploadError, setInvUploadError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [invFileName, setInvFileName] = useState(() => localStorage.getItem('inventoryFileName')||'');
  const [importStats, setImportStats] = useState(null);
  // Two independent, optional upload slots — mirrors the "לקוחות" tab UX: each
  // slot shows its own filename/stats when filled, or an upload prompt when
  // empty, so it's obvious at a glance which of the two expected files is
  // still missing. Both slots feed into the SAME shared maps (stockMap, costMap,
  // etc.) since both file types carry the same per-item columns — the split is
  // purely about which file the person needs to go find, not about the data model.
  const [invSlots, setInvSlots] = useState(() => {
    try { return JSON.parse(localStorage.getItem('procurementInvSlots')||'null') || { product:null, masterCard:null }; }
    catch { return { product:null, masterCard:null }; }
  });
  const [showBanner, setShowBanner] = useState(false);
  const [importBanner, setImportBanner] = useState(null); // {count, skipped}
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [deadStockDays, setDeadStockDays] = useState(90);
  const [avgWindowMonths, setAvgWindowMonths] = useState(12); // lookback window for avg calc // threshold in days
  // Free period comparison — same concept as the one in "מכירות", but scoped
  // here to inform purchasing decisions: did demand for products actually
  // shift between two custom periods, beyond what the fixed trend window shows.
  const [showProcCompare, setShowProcCompare] = useState(false);
  const procAvailableMonths = useMemo(() => [...new Set(salesData.map(d=>d.date).filter(Boolean))].sort((a,b)=>getDateVal(a)-getDateVal(b)), [salesData]);
  const [procPeriodA, setProcPeriodA] = useState({ start:'', end:'' });
  const [procPeriodB, setProcPeriodB] = useState({ start:'', end:'' });
  useEffect(() => {
    if (!showProcCompare || !procAvailableMonths.length || procPeriodA.start) return;
    const end = procAvailableMonths[procAvailableMonths.length-1];
    const aStart = procAvailableMonths[Math.max(0, procAvailableMonths.length-3)];
    const bEnd = procAvailableMonths[Math.max(0, procAvailableMonths.length-4)] || procAvailableMonths[0];
    const bStart = procAvailableMonths[Math.max(0, procAvailableMonths.length-6)];
    setProcPeriodA({ start:aStart, end });
    setProcPeriodB({ start:bStart, end:bEnd });
  }, [showProcCompare, procAvailableMonths]);
  const procCompareStats = useMemo(() => {
    if (!showProcCompare || !procPeriodA.start || !procPeriodB.start) return null;
    const calc = (period) => {
      const startVal = getDateVal(period.start), endVal = getDateVal(period.end||period.start);
      const rows = salesData.filter(d => { const v=getDateVal(d.date); return v>=startVal && v<=endVal; });
      const revenue = rows.reduce((a,c)=>a+(c.total||0),0);
      const qty = rows.reduce((a,c)=>a+(c.quantity||0),0);
      const byProduct = {};
      rows.forEach(r => { const n=r.description; if(!n) return; byProduct[n]=(byProduct[n]||0)+(r.quantity||0); });
      const top = Object.entries(byProduct).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,qty])=>({name,qty}));
      return { revenue, qty, top };
    };
    const a = calc(procPeriodA), b = calc(procPeriodB);
    const qtyDelta = b.qty>0 ? ((a.qty-b.qty)/b.qty*100) : (a.qty>0?100:0);
    return { a, b, qtyDelta };
  }, [showProcCompare, procPeriodA, procPeriodB, salesData]);
  const [whatIfMultiplier, setWhatIfMultiplier] = useState(1.2); // +20% default
  const [whatIfActive, setWhatIfActive] = useState(false);
  const [openOrders, setOpenOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('openOrders')||'[]'); } catch { return []; }
  });
  const [ordersFileName, setOrdersFileName] = useState(() => localStorage.getItem('ordersFileName')||'');
  const [ordersSortConfig] = useState({ key:null, direction:'asc' }); // default order; header clicks sort via useTableSort
  const { sortRows, sortTh, sortHead, setSort, sortState } = useTableSort();

  // ── Currency-aware open orders ──────────────────────────────────
  // parsePriorityOrders never captured a currency (Priority's "שווי יתרה"
  // column is just a number, in whatever currency that supplier bills in),
  // so this table was always showing "₪" on foreign-supplier orders no
  // matter what. Currency is resolved the same way as the main products
  // table — via currencyMap, matched by SKU/product name — which also means
  // it now benefits from the per-supplier currency override in the
  // "ספקים" view. valueILS is null (not silently 1:1) when the currency is
  // foreign and no exchange rate is set in Settings.
  const ordersEnriched = useMemo(() => {
    return openOrders.map(o => {
      const currency = currencyMap[o.productKey]??currencyMap[o.productName]??null;
      const isForeign = currency && currency!=='ILS';
      const rate = !isForeign ? 1 : (exchangeRates?.[currency]>0 ? exchangeRates[currency] : null);
      const costUsable = o.value!=null && rate!=null;
      const valueILS = costUsable ? o.value*rate : null;
      const costCurrencyBlocked = o.value>0 && isForeign && rate==null ? currency : null;
      const unitPriceOriginal = (o.value>0 && o.orderedQty>0) ? o.value/o.orderedQty : null;
      // PO price vs. the catalog purchase price ("מחיר קניה אחרון") — same
      // currency on both sides, so no conversion is involved in the comparison.
      const catalogCost = costMap[o.productKey]??costMap[o.productName]??null;
      const poPriceDiffPct = (unitPriceOriginal!=null && catalogCost>0) ? ((unitPriceOriginal-catalogCost)/catalogCost)*100 : null;
      // Overdue — expected delivery date has passed and it's still open.
      const expectedDt = parseFlexDate(o.expectedDate);
      const today = startOfToday();
      const isOverdue = !!expectedDt && expectedDt < today && o.status !== 'received';
      const daysLate = isOverdue ? Math.round((today - expectedDt)/DAY_MS) : 0;
      return { ...o, currency, valueILS, costCurrencyBlocked, costConverted: costUsable && isForeign ? currency : null, unitPriceOriginal, catalogCost, poPriceDiffPct, isOverdue, daysLate };
    });
  }, [openOrders, currencyMap, exchangeRates, costMap]);
  const overdueOrders = useMemo(() => ordersEnriched.filter(o=>o.isOverdue), [ordersEnriched]);
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  // Per product: how much of what's "on the way" is actually late.
  const overdueByProduct = useMemo(() => {
    const m = {};
    overdueOrders.forEach(o => { const k=o.productKey||o.productName; if(!m[k]) m[k]={qty:0,maxDays:0}; m[k].qty+=o.orderedQty||0; m[k].maxDays=Math.max(m[k].maxDays,o.daysLate); });
    return m;
  }, [overdueOrders]);
  const ordersBlockedCurrencies = useMemo(() => [...new Set(ordersEnriched.filter(o=>o.costCurrencyBlocked).map(o=>o.costCurrencyBlocked))], [ordersEnriched]);

  // ── Cash flow forecast — buckets open orders by expected delivery month ──
  // Uses valueILS (above) so mixed-currency open orders don't get summed as
  // if they were all ₪.
  const parseOrderDate = parseFlexDate;
  const cashFlowForecast = useMemo(() => {
    const active = ordersEnriched.filter(o => o.status !== 'received');
    const buckets = {};
    let noDateValue = 0, noDateCount = 0;
    active.forEach(o => {
      let dt = parseOrderDate(o.expectedDate);
      let estimated = false;
      if (!dt) {
        // Most orders don't carry a real expected-delivery date — fall back to
        // order date + lead time (per-supplier override if set, else the
        // global lead-time slider) as a planning estimate, clearly marked as
        // such in the chart rather than silently treated as a real date.
        const orderDt = parseOrderDate(o.orderDate);
        if (orderDt) {
          const effLeadTime = (o.supplier && leadTimeMap[o.supplier]!=null) ? leadTimeMap[o.supplier] : leadTime;
          dt = new Date(orderDt);
          dt.setDate(dt.getDate() + Math.round(effLeadTime*30));
          estimated = true;
        }
      }
      if (!dt) { noDateValue += o.valueILS||0; noDateCount++; return; } // no date to work with at all
      const key = `${dt.getFullYear()}-${String(dt.getMonth()).padStart(2,'0')}`;
      if (!buckets[key]) buckets[key] = { key, year:dt.getFullYear(), monthIdx:dt.getMonth(), actualValue:0, estimatedValue:0, actualCount:0, estimatedCount:0 };
      if (estimated) { buckets[key].estimatedValue += o.valueILS||0; buckets[key].estimatedCount++; }
      else { buckets[key].actualValue += o.valueILS||0; buckets[key].actualCount++; }
    });
    const sorted = Object.values(buckets).sort((a,b)=>a.key.localeCompare(b.key));
    let cumulative = 0;
    const data = sorted.map(b => {
      const monthTotal = b.actualValue + b.estimatedValue;
      cumulative += monthTotal;
      return {
        month: `${MONTH_ABBR_LABELS_SHORT[b.monthIdx]}-${String(b.year).slice(2)}`,
        actual: Math.round(b.actualValue), estimated: Math.round(b.estimatedValue),
        value: Math.round(monthTotal), cumulative: Math.round(cumulative),
        count: b.actualCount + b.estimatedCount,
      };
    });
    const anyEstimated = sorted.some(b => b.estimatedValue > 0);
    return { data, anyEstimated, noDateValue: Math.round(noDateValue), noDateCount, totalValue: Math.round(active.reduce((s,o)=>s+(o.valueILS||0),0)) };
  }, [ordersEnriched, leadTime, leadTimeMap]);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [editOrderId, setEditOrderId] = useState(null);
  const [orderForm, setOrderForm] = useState({ productKey:'', productName:'', supplier:'', orderedQty:'', orderDate:'', expectedDate:'', status:'ordered', poNumber:'', notes:'' });
  const [aiInsightOpen, setAiInsightOpen] = useState(false);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [aiInsightText, setAiInsightText] = useState('');
  const [viewMode, setViewMode] = useState('suppliers'); // 'products' | 'suppliers'
  const [expandedSuppliers, setExpandedSuppliers] = useState(new Set());

  const toggleSupplier = (name) => setExpandedSuppliers(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  // ── Import open orders from Priority Excel ──────────────────────
  const [ordersUploadError, setOrdersUploadError] = useState(null);
  const handlePriorityOrdersUpload = async (e, opts = {}) => {
    const file = e.target.files?.[0]; if (!file) return;
    setOrdersLoading(true);
    setOrdersUploadError(null);
    const process = (rows) => {
      const parsed = parsePriorityOrders(rows);
      if (!parsed.length) {
        setOrdersUploadError('לא זוהו שורות בקובץ — ודא שזה קובץ "הזמנות רכש פתוחות" מ-Priority עם עמודות מק"ט/יתרה לאספקה.');
        setOrdersLoading(false);
        return;
      }
      // Orders that were open in the previous Priority import and are gone
      // from this one were (almost always) received in between. Log them as
      // received today — an estimate, flagged as such — so supplier
      // reliability can be measured without manual bookkeeping.
      const res = applyOpenOrders({ prevOrders: openOrders, parsed, receiptLog, draftQty });
      if (res.receiptLog !== receiptLog) saveReceiptLog(res.receiptLog);
      if (res.draftQty !== draftQty) saveDraft(res.draftQty);
      saveFileMeta('openOrders', { name:file.name, rows:parsed.length });
      saveOrders(res.orders);
      setOrdersFileName(file.name);
      localStorage.setItem('ordersFileName', file.name);
      setImportBanner({ count: parsed.length, skipped: rows.length - parsed.length });
      setTimeout(() => setImportBanner(null), 6000);
      setOrdersLoading(false);
      if (!opts.silent) setViewMode('orders');
    };
    if (file.name.match(/\.xlsx?$/) && window.XLSX) {
      const r = new FileReader();
      r.onload = ev => {
        try {
          const wb = window.XLSX.read(ev.target.result, { type: 'binary' });
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          process(rows);
        } catch { setOrdersUploadError('לא הצלחתי לקרוא את הקובץ — ודא שזה קובץ Excel (.xlsx/.xls) תקין.'); setOrdersLoading(false); }
      };
      r.readAsBinaryString(file);
    } else {
      const r = new FileReader();
      r.onload = ev => {
        const lines = ev.target.result.split('\n').filter(l => l.trim());
        if (!lines.length) { setOrdersUploadError('הקובץ ריק.'); setOrdersLoading(false); return; }
        const headers = parseCSVLine(lines[0]).map(c => c.replace(/^"|"$/g,'').trim());
        const rows = lines.slice(1).map(line => {
          const vals = parseCSVLine(line).map(c => c.replace(/^"|"$/g,'').trim());
          const obj = {}; headers.forEach((h,i) => { obj[h] = vals[i]||''; }); return obj;
        }).filter(r => Object.values(r).some(v => v));
        process(rows);
      };
      r.readAsText(file);
    }
    e.target.value = '';
  };

  // Clears only the Priority-imported orders + filename, keeping manually
  // added ones intact (mirrors the "fromPriority" split already used on import).
  const clearPriorityOrders = () => {
    const manual = openOrders.filter(o => !o.fromPriority);
    saveOrders(manual);
    setOrdersFileName('');
    localStorage.removeItem('ordersFileName');
  };

  const sortedOpenOrders = useMemo(() => {
    const base = showOverdueOnly ? ordersEnriched.filter(o=>o.isOverdue) : ordersEnriched;
    if (!ordersSortConfig.key) return base;
    return [...base].sort((a,b) => {
      const va = a[ordersSortConfig.key] ?? '', vb = b[ordersSortConfig.key] ?? '';
      let cmp;
      if (typeof va === 'number' || typeof vb === 'number') cmp = (va||0) - (vb||0);
      else cmp = String(va).localeCompare(String(vb), 'he');
      return ordersSortConfig.direction === 'asc' ? cmp : -cmp;
    });
  }, [ordersEnriched, ordersSortConfig, showOverdueOnly]);

  const saveStock = (key, val) => {
    const n = parseFloat(val);
    const updated = { ...stockMap, [key]: isNaN(n) ? 0 : n };
    setStockMap(updated);
    localStorage.setItem('procurementStock', JSON.stringify(updated));
  };

  const saveMOQ = (key, val) => {
    const n = parseFloat(val);
    const updated = { ...moqMap };
    if (isNaN(n) || n <= 0) { delete updated[key]; } else { updated[key] = n; }
    setMoqMap(updated);
    localStorage.setItem('procurementMOQ', JSON.stringify(updated));
  };

  const saveLeadTime = (supplierName, val) => {
    const n = parseFloat(val);
    const updated = { ...leadTimeMap };
    if (isNaN(n) || n < 0) { delete updated[supplierName]; } else { updated[supplierName] = n; }
    setLeadTimeMap(updated);
    localStorage.setItem('procurementLeadTime', JSON.stringify(updated));
  };

  // Force the currency for every SKU under one supplier — bypasses whatever
  // the imported file's currency column did or didn't say. Currency is
  // fundamentally a property of the SUPPLIER, not each row, and Priority
  // exports don't always carry a clean per-row currency value — a supplier
  // showing a currency mix in costByCurrency is usually that detection
  // failing partway through, not an actual multi-currency supplier. This
  // lets the person correct it once per supplier instead of per SKU.
  const saveSupplierCurrency = (supplierName, code, items) => {
    const updated = { ...currencyMap };
    items.forEach(p => {
      const k = p.key || p.sku || p.name;
      if (!k) return;
      if (code === '') delete updated[k]; else updated[k] = code;
    });
    setCurrencyMap(updated);
    localStorage.setItem('procurementCurrency', JSON.stringify(updated));
  };

  const generateProcurementInsight = async () => {
    if (!apiKey) { setAiInsightText('⚠️ הוסף API Key של Gemini ב-⚙️ הגדרות.'); setAiInsightOpen(true); return; }
    setAiInsightOpen(true); setAiInsightLoading(true); setAiInsightText('');
    try {
      const critical = products.filter(p=>p.risk==='critical'&&p.suggestedOrder>0).slice(0,8);
      const low      = products.filter(p=>p.risk==='low'&&p.suggestedOrder>0).slice(0,8);
      const topA     = products.filter(p=>p.abc==='A'&&p.suggestedOrder>0).slice(0,5);
      const totalOrder = products.reduce((a,p)=>a+p.suggestedOrder,0);
      const totalCost  = products.reduce((a,p)=>a+(p.orderCost||0),0);
      const critLines = critical.length
        ? critical.map(p=>'• '+p.name+': מלאי '+(p.currentStock??'?')+', ממוצע '+p.avgMonthly.toFixed(0)+'/חודש, להזמין '+p.suggestedOrder).join('\n')
        : 'אין';
      const lowLines = low.length
        ? low.map(p=>'• '+p.name+': '+(p.coverageDays??'?')+' ימי כיסוי, להזמין '+p.suggestedOrder).join('\n')
        : 'אין';
      const topALines = topA.length
        ? topA.map(p=>'• '+p.name+': '+p.revPct.toFixed(1)+'% מהכנסות, תחזית '+p.forecastNext+'/חודש').join('\n')
        : 'אין';
      const prompt = 'אתה יועץ לוגיסטיקה ורכש. תן המלצות קצרות בעברית.\n\n'
        +'== קריטי ==\n'+critLines+'\n\n'
        +'== נמוך ==\n'+lowLines+'\n\n'
        +'== A לרכש ==\n'+topALines+'\n\n'
        +'סה"כ להזמנה: '+totalOrder.toLocaleString()+' יח\' | עלות: ₪'+Math.round(totalCost).toLocaleString()+'\n\n'
        +'== הזמנות באיחור ==\n'+(overdueOrders.length ? overdueOrders.slice(0,8).map(o=>'• '+o.productName+' מ-'+(o.supplier||'?')+': איחור '+o.daysLate+' ימים, '+o.orderedQty+' יח\'').join('\n') : 'אין')+'\n\n'
        +'== עליות מחיר קניה ==\n'+(priceChanges.filter(p=>p.priceChangePct>0).length ? priceChanges.filter(p=>p.priceChangePct>0).slice(0,6).map(p=>'• '+p.name+': +'+p.priceChangePct.toFixed(1)+'%').join('\n') : 'אין')+'\n\n'
        +'תן: 1) עדיפויות 2) אזהרות 3) המלצה לשיפור.';
      const text = await callGemini(prompt, apiKey);
      setAiInsightText(text);
    } catch(e) { setAiInsightText('❌ ' + e.message); }
    finally { setAiInsightLoading(false); }
  };

  const saveOrders = (orders) => {
    setOpenOrders(orders);
    localStorage.setItem('openOrders', JSON.stringify(orders));
  };
  const addOrder = () => {
    if (!orderForm.productName || !orderForm.orderedQty) return;
    const order = {
      id: Date.now().toString(),
      ...orderForm,
      orderedQty: parseFloat(orderForm.orderedQty)||0,
      productKey: orderForm.productKey || orderForm.productName,
    };
    saveOrders([...openOrders, order]);
    setOrderForm({ productKey:'', productName:'', supplier:'', orderedQty:'', orderDate:'', expectedDate:'', status:'ordered', poNumber:'', notes:'' });
    setShowAddOrder(false);
  };
  const updateOrder = (id, field, val) => {
    saveOrders(openOrders.map(o => o.id===id ? {...o, [field]: field==='orderedQty'?parseFloat(val)||0:val} : o));
  };
  const deleteOrder = (id) => saveOrders(openOrders.filter(o=>o.id!==id));
  const receiveOrder = (id) => {
    const o = openOrders.find(x=>x.id===id);
    if (o) saveReceiptLog([...receiptLog, {
      supplier:o.supplier||'', productKey:o.productKey||o.productName, poNumber:o.poNumber||'',
      orderDate:o.orderDate||'', expectedDate:o.expectedDate||'', receivedDate:new Date().toISOString().slice(0,10), qty:o.orderedQty||0, estimated:false,
    }]);
    saveOrders(openOrders.filter(x=>x.id!==id)); // remove when received
  };

  // ── Supplier reliability — real lead time & on-time rate from received orders ──
  const supplierReliability = useMemo(() => {
    const out = {};
    receiptLog.forEach(r => {
      const sup = r.supplier || 'ספק לא ידוע';
      if (!out[sup]) out[sup] = { deliveries:0, leadDaysSum:0, leadDaysN:0, onTimeN:0, onTimeBase:0, estimatedN:0, openOverdue:0, openCount:0 };
      const s = out[sup]; s.deliveries++; if (r.estimated) s.estimatedN++;
      const od = parseFlexDate(r.orderDate), rd = parseFlexDate(r.receivedDate), ed = parseFlexDate(r.expectedDate);
      if (od && rd && rd >= od) { s.leadDaysSum += (rd-od)/DAY_MS; s.leadDaysN++; }
      if (ed && rd) { s.onTimeBase++; if (rd <= new Date(ed.getTime() + 3*DAY_MS)) s.onTimeN++; } // 3-day grace
    });
    ordersEnriched.forEach(o => {
      const sup = o.supplier || 'ספק לא ידוע';
      if (!out[sup]) out[sup] = { deliveries:0, leadDaysSum:0, leadDaysN:0, onTimeN:0, onTimeBase:0, estimatedN:0, openOverdue:0, openCount:0 };
      out[sup].openCount++; if (o.isOverdue) out[sup].openOverdue++;
    });
    Object.values(out).forEach(s => {
      s.avgLeadDays = s.leadDaysN ? Math.round(s.leadDaysSum/s.leadDaysN) : null;
      s.onTimePct = s.onTimeBase ? Math.round(s.onTimeN/s.onTimeBase*100) : null;
    });
    return out;
  }, [receiptLog, ordersEnriched]);

  // Map incoming quantities by product key for use in calculations
  const incomingMap = useMemo(() => {
    const map = {};
    openOrders.filter(o=>o.status!=='received').forEach(o => {
      const k = o.productKey||o.productName;
      map[k] = (map[k]||0) + (o.orderedQty||0);
    });
    return map;
  }, [openOrders]);

  // opts.replaceStock: the file is the COMPLETE item list (Priority sync) — stock
  // balances are replaced, not merged, so items from older files don't linger.
  const handleInvUpload = async (e, slotKey, opts = {}) => {
    const file = e.target.files?.[0]; if (!file) return;
    setInvLoading(true);
    const applyRows = (rows) => {
      const parsed = parseInventoryFile(rows);
      if (!parsed.length) {
        setInvUploadError('לא זוהו שורות בקובץ — ודא שיש בו עמודות מק"ט/שם מוצר וכמות/עלות.');
        setInvLoading(false);
        return;
      }
      const nx = applyInventory({ stock:stockMap, cost:costMap, minStock:minStockMap, supplier:supplierMap, moq:moqMap, currency:currencyMap, names:nameMap, costHistory },
        parsed, { replaceStock: !!opts.replaceStock });
      const { stock:ns, cost:nc, minStock:nm, supplier:nsup, moq:nmoq, currency:ncur, names:nnames, costHistory:nhist } = nx;
      setStockMap(ns); setCostMap(nc); setMinStockMap(nm); setSupplierMap(nsup); setMoqMap(nmoq); setCurrencyMap(ncur);
      setNameMap(nnames); setCostHistory(nhist);
      try {
        localStorage.setItem('procurementNames', JSON.stringify(nnames));
        localStorage.setItem('procurementCostHistory', JSON.stringify(nhist));
      } catch { /* non-critical — reported below if the main maps also fail */ }
      // Same class of failure as the customer-file uploads: writing this much
      // data can hit the browser's storage quota. If it does, the in-memory
      // state above still updates (so the table looks fine right now), but
      // without a successful write here it's silently lost on next refresh —
      // so any failure must be surfaced, not swallowed.
      try {
        localStorage.setItem('procurementStock', JSON.stringify(ns));
        localStorage.setItem('procurementCost', JSON.stringify(nc));
        localStorage.setItem('procurementMinStock', JSON.stringify(nm));
        localStorage.setItem('procurementSupplier', JSON.stringify(nsup));
        localStorage.setItem('procurementMOQ', JSON.stringify(nmoq));
        localStorage.setItem('procurementCurrency', JSON.stringify(ncur));
        localStorage.setItem('inventoryFileName', file.name);
        setInvUploadError(null);
      } catch {
        setInvUploadError('הקובץ נטען למסך אבל לא נשמר בדפדפן — כנראה אחסון הדפדפן מלא. פנה מקום ונסה שוב, אחרת המידע ייעלם ברענון.');
      }
      setInvFileName(file.name);
      const { withQty, withCost, withMinStock, withSupplier } = nx.stats;
      setImportStats({ total: parsed.length, withQty, withCost, withMinStock });
      setInvSlots(prev => {
        const next = { ...prev, [slotKey]: { name: file.name, total: parsed.length, withQty, withCost, withMinStock, withSupplier, importedAt: Date.now() } };
        try { localStorage.setItem('procurementInvSlots', JSON.stringify(next)); } catch { setInvUploadError('הקובץ נטען למסך אבל לא נשמר בדפדפן — כנראה אחסון הדפדפן מלא. פנה מקום ונסה שוב, אחרת המידע ייעלם ברענון.'); }
        return next;
      });
      setShowBanner(true);
      setTimeout(() => setShowBanner(false), 7000);
      setInvLoading(false);
    };
    if (file.name.match(/\.xlsx?$/) && window.XLSX) {
      const r = new FileReader();
      r.onload = (ev) => { try { const wb=window.XLSX.read(ev.target.result,{type:'binary'}); applyRows(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})); } catch { setInvUploadError('לא הצלחתי לקרוא את הקובץ — ודא שזה קובץ Excel (.xlsx/.xls) תקין.'); setInvLoading(false); } };
      r.readAsBinaryString(file);
    } else {
      const r = new FileReader();
      r.onload = (ev) => {
        const lines = ev.target.result.split('\n').filter(l=>l.trim());
        if (!lines.length) { setInvUploadError('הקובץ ריק.'); setInvLoading(false); return; }
        const headers = parseCSVLine(lines[0]).map(c=>c.replace(/^"|"$/g,'').trim());
        const rows = lines.slice(1).map(line => {
          const vals = parseCSVLine(line).map(c=>c.replace(/^"|"$/g,'').trim());
          const obj={}; headers.forEach((h,i)=>{obj[h]=vals[i]||'';});  return obj;
        }).filter(r=>Object.values(r).some(v=>v));
        applyRows(rows);
      };
      r.readAsText(file);
    }
    e.target.value='';
  };

  // Clears just this slot's displayed filename/stats — NOT the merged inventory
  // data itself (stockMap/costMap/etc), since both files write into the same
  // shared maps and there's no reliable way to "un-merge" one file's contribution.
  // Use "נקה את כל נתוני המלאי" below for a true full reset.
  const clearInvSlot = (slotKey) => {
    setInvSlots(prev => {
      const next = { ...prev, [slotKey]: null };
      localStorage.setItem('procurementInvSlots', JSON.stringify(next));
      return next;
    });
  };

  const clearInventory = () => {
    setStockMap({}); setCostMap({}); setMinStockMap({}); setSupplierMap({}); setMoqMap({}); setCurrencyMap({});
    setNameMap({}); localStorage.removeItem('procurementNames');
    // Price history is intentionally kept — it's the record of past prices,
    // and wiping it on every inventory reset would defeat its purpose.
    setInvFileName(''); setImportStats(null); setInvSlots({ product:null, masterCard:null });
    localStorage.removeItem('procurementStock'); localStorage.removeItem('procurementCost');
    localStorage.removeItem('procurementMinStock'); localStorage.removeItem('procurementSupplier');
    localStorage.removeItem('procurementMOQ');
    localStorage.removeItem('procurementCurrency');
    localStorage.removeItem('inventoryFileName');
    localStorage.removeItem('procurementInvSlots');
    localStorage.removeItem('procurementImportedFiles');
  };

  // ── Supplier concentration — what share of the SKU catalog (that has a
  // supplier assigned at all) depends on the same supplier. Computed from
  // supplierMap directly (not from `products`) to avoid a circular
  // dependency, since this feeds into the risk score computed below. ──
  const supplierConcentration = useMemo(() => {
    const counts = {};
    let totalAssigned = 0;
    Object.values(supplierMap).forEach(s => { if (!s) return; counts[s] = (counts[s]||0) + 1; totalAssigned++; });
    return { counts, totalAssigned };
  }, [supplierMap]);

  const products = useMemo(() => {
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
      if (firstActiveIdx === -1) {
        avgMonthly = 0; avgDataMonths = 0; isLimitedData = true;
      } else {
        const relevantMonths = allMonths.slice(firstActiveIdx);
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
      const supplier     = supplierMap[key]??supplierMap[p.sku]??supplierMap[p.name]??lastP?.s??null;
      const catalogCost  = costMap[key]??costMap[p.sku]??costMap[p.name]??null;
      const costFromPurchase = catalogCost==null && lastP && lastP.p>0;
      const ex = itemsExtra[p.sku] ?? itemsExtra[key] ?? null;
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
      const effectiveLeadTime = (supplier && leadTimeMap[supplier]!=null) ? leadTimeMap[supplier] : leadTime;
      const leadTimeOverridden = supplier && leadTimeMap[supplier]!=null;

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
      const plan = calcOrderPlan({ avgMonthly, stdDev, abc:p.abc, leadTime:effectiveLeadTime, monthsToStock, seasonalityIdx, seasonalityReliable, nextMonIdx, effectiveStock, minStock, moq });
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

      const out = { ...p, key, avgMonthly, avgDataMonths, isLimitedData, windowMonths: allMonths.length, avgDaily, sparkline, trendSeries, trend, forecastNext, seasonalFactor, seasonalityReliable, seasonalityIdx, monthlyAvgs, cv, stdDev, xyz, abcXyz, safetyStock, serviceLevel, projectedDemand, seasonalApplied, suggestedOrderFlat, lifecycle, currentStock, unitCost, unitCostOriginal, costConverted, costCurrencyBlocked, priceChangePct, prevPrice, priceChangedAt, minStock, supplier, currency, moq, effectiveLeadTime, leadTimeOverridden, nextMonIdx, coverageMonths, coverageDays, incomingQty, overdue, effectiveStock, effectiveCoverDays, effectiveCoverMonths, suggestedOrder, suggestedOrderRaw, orderCost, orderCostOriginal, risk, physicalRisk, shortNowCoveredByPO, riskScore };
      out.status = procStatus(out);
      out.statusRank = { now:0, soon:1, watch:2, unknown:3, ok:4 }[out.status];
      out.chip = procChip(out);
      out.costFromPurchase = costFromPurchase; out.costFromAvg = costFromAvg; out.lastPurchase = lastP;
      out.family = ex?.fam || ''; out.ownMade = ex?.type === 'P'; out.avgCostPriority = ex?.avgCost ?? null; out.listPrice = ex?.listPrice ?? null;
      out.lastSalePriority = ex?.lastSale || ''; out.lastBuyPriority = ex?.lastBuy || '';
      return out;
    });
  }, [salesData, stockMap, costMap, costHistory, minStockMap, supplierMap, moqMap, currencyMap, leadTimeMap, monthsToStock, leadTime, incomingMap, overdueByProduct, avgWindowMonths, excludeCurrentMonth, supplierConcentration, exchangeRates, lastSupBySku, purchBySku, itemsExtra]);

  const filtered = useMemo(() => {
    let data = products;
    if (abcFilter!=='all') data=data.filter(p=>p.abc===abcFilter);
    if (familyFilter) data=data.filter(p=>(p.family||'ללא משפחה')===familyFilter);
    if (riskFilter!=='all') data=data.filter(p=>p.risk===riskFilter);
    if (actionFilter==='order') data=data.filter(p=>p.suggestedOrder>0);
    if (actionFilter==='late') data=data.filter(p=>p.overdue);
    if (searchTerm) data=data.filter(p=>smartMatch(p.name, searchTerm)||smartMatch(p.sku, searchTerm));
    return [...data].sort((a,b)=>{
      const va=a[sortConfig.key], vb=b[sortConfig.key];
      const aEmpty = va===null||va===undefined||va==='';
      const bEmpty = vb===null||vb===undefined||vb==='';
      // Always push empty/unknown values to the bottom, regardless of sort direction —
      // otherwise they get compared against a numeric sentinel and scatter randomly.
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof va === 'string' || typeof vb === 'string') {
        const cmp = String(va).localeCompare(String(vb), 'he');
        return sortConfig.direction==='asc' ? cmp : -cmp;
      }
      const cmp = sortConfig.direction==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0);
      return cmp || (b.orderCost||0)-(a.orderCost||0) || (b.totalRev||0)-(a.totalRev||0);
    });
  }, [products, abcFilter, familyFilter, riskFilter, actionFilter, searchTerm, sortConfig]);
  const familyOptions = useMemo(() => {
    const m = {}; products.forEach(p => { if (Object.keys(itemsExtra).length) { const f = p.family || 'ללא משפחה'; m[f] = (m[f]||0) + 1; } });
    return Object.entries(m).sort((a,b) => b[1]-a[1]);
  }, [products, itemsExtra]);

  // ─── Progressive rendering for the main table ───────────────────
  // With large catalogs (1000+ SKUs), building/diffing every row on every
  // interaction (typing in search, sorting, etc.) is what makes the page feel
  // sluggish — most of that cost is rows the user can't even see yet. Instead
  // we render an initial batch and grow it as the user scrolls near the
  // bottom, via an IntersectionObserver sentinel row.
  const PROC_BATCH_SIZE = 150;
  const [visibleCount, setVisibleCount] = useState(PROC_BATCH_SIZE);
  useEffect(() => { setVisibleCount(PROC_BATCH_SIZE); }, [filtered]);
  const loadMoreSentinelRef = useRef(null);
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleCount(v => Math.min(filtered.length, v + PROC_BATCH_SIZE));
      }
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);
  const visibleProducts = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // ── Data completeness stats ────────────────────────────────
  const completeness = useMemo(() => {
    const total     = products.length;
    const withStock = products.filter(p => p.currentStock !== null).length;
    const withCost  = products.filter(p => p.unitCostOriginal !== null && p.unitCostOriginal > 0).length;
    const withOrders= products.filter(p => p.incomingQty > 0).length;
    const withAll   = products.filter(p => p.currentStock !== null && p.unitCostOriginal !== null && p.unitCostOriginal > 0).length;
    const noData    = products.filter(p => p.currentStock === null && (p.unitCostOriginal === null || p.unitCostOriginal === 0)).length;
    return { total, withStock, withCost, withOrders, withAll, noData,
      stockPct:  total ? Math.round(withStock/total*100) : 0,
      costPct:   total ? Math.round(withCost/total*100)  : 0,
      allPct:    total ? Math.round(withAll/total*100)   : 0,
    };
  }, [products]);

  // Dead stock analysis — products not sold in deadStockDays
  const deadStockData = useMemo(() => {
    if (!salesData.length) return [];
    // Find latest date in dataset
    const MONTHS_REV = {'ינו':0,'פבר':1,'מרץ':2,'אפר':3,'מאי':4,'יונ':5,'יול':6,'אוג':7,'ספט':8,'אוק':9,'נוב':10,'דצמ':11};
    const toDate = (dateStr) => {
      if (!dateStr) return null;
      const [m,y] = dateStr.split('-');
      const mIdx = MONTHS_REV[m];
      if (mIdx===undefined) return null;
      return new Date(2000+parseInt(y), mIdx, 15);
    };
    const allDates = salesData.map(d=>d.date).filter(Boolean).map(toDate).filter(Boolean);
    if (!allDates.length) return [];
    const latestDate = new Date(Math.max(...allDates.map(d=>d.getTime())));
    const threshold = new Date(latestDate.getTime() - deadStockDays * 24*60*60*1000);

    // Items that are in stock but have NO sales at all in the data. `products`
    // is built from sales only, so these never existed anywhere in the page —
    // yet they're usually the most expensive dead stock. Pull them straight
    // from the inventory maps.
    const known = new Set();
    products.forEach(p => { known.add(p.key); if (p.sku) known.add(p.sku); if (p.name) known.add(p.name); });
    const neverSold = Object.entries(stockMap)
      .filter(([k,q]) => q > 0 && !known.has(k) && !known.has(nameMap[k]))
      .map(([k,q]) => {
        const currency = currencyMap[k] ?? null;
        const isForeign = currency && currency !== 'ILS';
        const rate = !isForeign ? 1 : (exchangeRates?.[currency]>0 ? exchangeRates[currency] : null);
        const ex = itemsExtra[k];
        const avgOnly = costMap[k] == null && ex?.avgCost > 0;
        const unitCostOriginal = avgOnly ? ex.avgCost : costMap[k] ?? null;
        const unitCost = avgOnly ? ex.avgCost : (unitCostOriginal!=null && rate!=null) ? unitCostOriginal*rate : null;
        // Priority's item card knows the real last sale even when it is older than the invoice lines we hold.
        const lastSaleDate = ex?.lastSale ? new Date(ex.lastSale) : null;
        return {
          key:k, sku:k, name:nameMap[k]||k, abc:'C', xyz:'', abcXyz:'C', currentStock:q, unitCost, unitCostOriginal,
          currency: avgOnly ? 'ILS' : currency, family: ex?.fam || '',
          costCurrencyBlocked: !avgOnly && unitCostOriginal!=null && rate==null ? currency : null,
          supplier: supplierMap[k] ?? null, lastSaleDate, daysSince: lastSaleDate ? Math.round((Date.now()-lastSaleDate)/(24*60*60*1000)) : null, neverSold: !lastSaleDate,
          stockValue: q * (unitCost ?? 0),
        };
      });

    return [...products
      .filter(p => {
        // Find last sale date for this product
        const saleDates = Object.entries(p.monthlyData)
          .filter(([,v])=>v>0)
          .map(([d])=>toDate(d))
          .filter(Boolean);
        if (!saleDates.length) return p.currentStock > 0; // never sold but has stock
        const lastSale = new Date(Math.max(...saleDates.map(d=>d.getTime())));
        return lastSale < threshold && p.currentStock > 0; // unknown stock is not "stuck" stock
      })
      .map(p => {
        const saleDates = Object.entries(p.monthlyData)
          .filter(([,v])=>v>0)
          .map(([d])=>toDate(d))
          .filter(Boolean);
        const fromCard = p.lastSalePriority ? new Date(p.lastSalePriority) : null;
        const lastSaleDate = saleDates.length
          ? new Date(Math.max(...saleDates.map(d=>d.getTime())))
          : fromCard;
        const daysSince = saleDates.length
          ? Math.round((latestDate-lastSaleDate)/(24*60*60*1000))
          : fromCard ? Math.round((Date.now()-fromCard)/(24*60*60*1000)) : null;
        const stockValue = (p.currentStock??0) * (p.unitCost??0);
        return { ...p, lastSaleDate, daysSince, stockValue, neverSold: !lastSaleDate };
      }), ...neverSold]
      .sort((a,b) => (b.stockValue||0)-(a.stockValue||0));
  }, [products, salesData, deadStockDays, stockMap, nameMap, costMap, currencyMap, supplierMap, exchangeRates, itemsExtra]);

  const deadStockValue = useMemo(() =>
    deadStockData.reduce((a,p)=>a+(p.stockValue||0),0), [deadStockData]);

  // ── Procurement schedule: when to order each product ──────────
  // Uses each product's OWN lead time (per-supplier override) and counts
  // stock already on the way — the old version used the global slider and
  // on-hand stock only, so a 3-month supplier got a far-too-late date.
  const scheduleData = useMemo(() => {
    const today = new Date();
    return products
      .filter(p => p.currentStock !== null && p.avgMonthly > 0 && p.suggestedOrder > 0)
      .map(p => {
        const leadDays = p.effectiveLeadTime * 30;
        const daysUntilOrder = (p.effectiveCoverDays||0) - leadDays;
        const orderByDate = new Date(today.getTime() + daysUntilOrder*24*60*60*1000);
        const urgency = daysUntilOrder <= 0 ? 'critical' : daysUntilOrder <= 7 ? 'urgent' : daysUntilOrder <= 14 ? 'soon' : daysUntilOrder <= 30 ? 'planned' : 'later';
        return { ...p, daysUntilOrder: Math.round(daysUntilOrder), orderByDate, urgency };
      })
      .sort((a,b) => a.daysUntilOrder - b.daysUntilOrder);
  }, [products]);

  // ── What-If: recalculate with demand multiplier ─────────────
  // Same calculation as the main table (calcOrderPlan) with the demand
  // multiplied — so it respects per-supplier lead time, open orders, MOQ,
  // seasonality and minimum stock, and the "change" column is a true delta.
  // (It also used to depend on a flag that was never switched on, so the
  // scenario table was always empty.)
  const whatIfProducts = useMemo(() => {
    if (!whatIfActive && viewMode!=='whatif') return [];
    return products.map(p => {
      const adjAvg = p.avgMonthly * whatIfMultiplier;
      const plan = calcOrderPlan({ avgMonthly:p.avgMonthly, stdDev:p.stdDev, abc:p.abc, leadTime:p.effectiveLeadTime, monthsToStock, seasonalityIdx:p.seasonalityIdx, seasonalityReliable:p.seasonalityReliable, nextMonIdx:p.nextMonIdx, effectiveStock:p.effectiveStock, minStock:p.minStock, moq:p.moq, multiplier:whatIfMultiplier });
      const adjOrder = plan.suggestedOrder;
      const adjCovDays = (p.currentStock!==null && adjAvg>0) ? Math.round(p.effectiveStock/(adjAvg/30)) : null;
      return { ...p, adjAvg, adjOrder, adjCovDays, orderDelta: adjOrder - p.suggestedOrder };
    }).filter(p => p.adjOrder > 0 || p.suggestedOrder > 0);
  }, [products, whatIfMultiplier, whatIfActive, viewMode, monthsToStock]);

  const reqSort = (key) => setSortConfig(p=>({key, direction:p.key===key&&p.direction==='desc'?'asc':'desc'}));
  const abcCounts = useMemo(()=>({ A:products.filter(p=>p.abc==='A').length, B:products.filter(p=>p.abc==='B').length, C:products.filter(p=>p.abc==='C').length }), [products]);
  const riskCounts = useMemo(()=>({ critical:products.filter(p=>p.risk==='critical').length, low:products.filter(p=>p.risk==='low').length, ok:products.filter(p=>p.risk==='ok').length, unknown:products.filter(p=>p.risk==='unknown').length, coveredByPO:products.filter(p=>p.shortNowCoveredByPO).length }), [products]);
  const totalOrderUnits = useMemo(()=>filtered.reduce((a,p)=>a+p.suggestedOrder,0),[filtered]);
  const totalOrderCost  = useMemo(()=>filtered.reduce((a,p)=>a+(p.orderCost||0),0),[filtered]);
  const blockedCurrencies = useMemo(() => [...new Set(products.filter(p=>p.costCurrencyBlocked).map(p=>p.costCurrencyBlocked))], [products]);
  const stockedCount = useMemo(()=>products.filter(p=>p.currentStock!==null).length,[products]);
  // Numbers for the four action cards — always over ALL products, not the filtered table.
  const actionKpis = useMemo(() => {
    const toOrder = products.filter(p=>p.suggestedOrder>0 && p.currentStock!==null);
    const stockValue = products.reduce((s,p)=>s+(p.unitCost!=null?Math.max(0,p.currentStock??0)*p.unitCost:0),0);
    const monthlyCogs = products.reduce((s,p)=>s+(p.unitCost!=null?(p.avgMonthly||0)*p.unitCost:0),0);
    return {
      orderCount: toOrder.length,
      orderCost: toOrder.reduce((s,p)=>s+(p.orderCost||0),0),
      urgentCount: toOrder.filter(p=>p.status==='now').length,
      lateValue: overdueOrders.reduce((s,o)=>s+(o.valueILS||0),0),
      stockValue,
      daysOfInventory: monthlyCogs>0 && stockValue>0 ? Math.round(stockValue/(monthlyCogs/30)) : null,
    };
  }, [products, overdueOrders]);

  // Group products-to-order by supplier — must be after filtered
  const supplierGroups = useMemo(() => {
    const groups = {};
    filtered.forEach(p => {
      const sup = p.supplier || 'ספק לא ידוע';
      if (!groups[sup]) groups[sup] = { name: sup, items: [], totalUnits: 0, totalCost: 0, costByCurrency: {}, criticalCount: 0, stockValue: 0, monthlyCogs: 0, missingCost: 0 };
      groups[sup].items.push(p);
      groups[sup].totalUnits += p.suggestedOrder;
      groups[sup].totalCost  += p.orderCost || 0; // ₪-converted — used for the blended headline total & supplier sort
      if (p.orderCostOriginal) {
        const cur = p.currency || 'ILS';
        groups[sup].costByCurrency[cur] = (groups[sup].costByCurrency[cur]||0) + p.orderCostOriginal; // native currency — kept pure, never blended
      }
      if (p.risk === 'critical') groups[sup].criticalCount++;
      // Inventory tied up with this supplier (₪) and its monthly consumption at cost
      if (p.unitCost!=null) {
        groups[sup].stockValue  += Math.max(0, p.currentStock??0) * p.unitCost;
        groups[sup].monthlyCogs += (p.avgMonthly||0) * p.unitCost;
      } else if ((p.currentStock??0) > 0) groups[sup].missingCost++;
    });
    Object.values(groups).forEach(g => {
      // Days of inventory = how many days the stock lasts at the current sales pace;
      // turns/year = how many times a year the stock is sold through.
      g.daysOfInventory = g.monthlyCogs>0 ? Math.round(g.stockValue/(g.monthlyCogs/30)) : (g.stockValue>0 ? Infinity : null);
      g.turnsPerYear = g.stockValue>0 ? (g.monthlyCogs*12)/g.stockValue : null;
    });
    return Object.values(groups)
      .sort((a, b) => b.totalCost - a.totalCost || b.totalUnits - a.totalUnits);
  }, [filtered]);
  const inventoryTotals = useMemo(() => {
    const stockValue = supplierGroups.reduce((a,g)=>a+g.stockValue,0);
    const monthlyCogs = supplierGroups.reduce((a,g)=>a+g.monthlyCogs,0);
    return { stockValue, monthlyCogs, daysOfInventory: monthlyCogs>0 ? Math.round(stockValue/(monthlyCogs/30)) : null, turnsPerYear: stockValue>0 ? monthlyCogs*12/stockValue : null };
  }, [supplierGroups]);

  // ── Shipments ↔ Priority suppliers ──────────────────────────────
  const knownSuppliers = useMemo(() => {
    const set = new Set();
    purchaseLines.forEach(l => set.add(l.s));
    Object.values(supplierMap).forEach(s => s && set.add(s));
    openOrders.forEach(o => o.supplier && set.add(o.supplier));
    return [...set].sort((a,b)=>a.localeCompare(b,'he'));
  }, [purchaseLines, supplierMap, openOrders]);
  const todayIso = new Date().toISOString().slice(0,10);
  const shipmentsEnriched = useMemo(() => shipments.map(s => {
    const override = shipSupOverride[s.sup];
    const matched = override === '' ? null : (override ?? matchShipSupplier(s.sup, knownSuppliers));
    const stage = shipmentStage(s, todayIso);
    const delayDays = s.change ? Math.round(daysBetween(s.change.from, s.change.to)) : 0;
    const daysToArrival = s.arr ? Math.round(daysBetween(todayIso, s.arr)) : null;
    return { ...s, matched, manual: override !== undefined, stage, delayDays, daysToArrival };
  }).sort((a,b) => (a.stage.idx===2) - (b.stage.idx===2) || (a.arr||'9999').localeCompare(b.arr||'9999')), [shipments, shipSupOverride, knownSuppliers, todayIso]);
  const setShipSupplier = (fwdName, prioName) => {
    const next = { ...shipSupOverride };
    if (prioName === '__auto') delete next[fwdName]; else next[fwdName] = prioName;
    setShipSupOverride(next);
    try { localStorage.setItem('procShipSupplierMap', JSON.stringify(next)); } catch { /* best-effort */ }
  };
  const activeShipsBySupplier = useMemo(() => {
    const m = {};
    shipmentsEnriched.filter(s => s.matched && s.stage.idx < 2).forEach(s => { (m[s.matched] ||= []).push(s); });
    return m;
  }, [shipmentsEnriched]);
  // When will what's on order for a product arrive: the supplier's next shipment
  // from the forwarder file if there is one, otherwise the PO's expected date.
  const productEta = useMemo(() => {
    const m = {};
    ordersEnriched.forEach(o => {
      const k = o.productKey || o.productName;
      const ship = (activeShipsBySupplier[o.supplier] || []).find(s => s.arr);
      const cand = ship ? { iso: ship.arr, cont: ship.cont, delayed: ship.delayDays > 0, src:'ship' }
        : (parseFlexDate(o.expectedDate) ? { iso: toIsoDate(parseFlexDate(o.expectedDate)), cont:'', delayed: o.isOverdue, src:'po' } : null);
      if (cand && (!m[k] || cand.iso < m[k].iso)) m[k] = cand;
    });
    return m;
  }, [ordersEnriched, activeShipsBySupplier]);
  const etaFor = (p) => productEta[p.key] ?? productEta[p.sku] ?? productEta[p.name] ?? null;

  // ── Supplier list ───────────────────────────────────────────────
  const orderQtyFor = (p) => draftQty[p.key] != null ? draftQty[p.key] : (p.currentStock !== null ? p.suggestedOrder : 0);
  const vendors = useMemo(() => {
    const groups = {};
    products.forEach(p => { const s = p.supplier || 'ספק לא ידוע'; (groups[s] ||= []).push(p); });
    return Object.entries(groups).map(([name, items]) => {
      const toOrder = items.filter(p => orderQtyFor(p) > 0);
      const value = toOrder.reduce((a,p) => a + orderQtyFor(p) * (p.unitCost || 0), 0);
      const worstRank = Math.min(...items.map(p => p.statusRank ?? 4));
      const orders = ordersEnriched.filter(o => o.supplier === name);
      const ships = activeShipsBySupplier[name] || [];
      const nextShip = ships.find(s => s.arr) || null;
      const pb = purchBySupplier[name] || null;
      const rel = supplierReliability[name] || null;
      const lead = leadTimeMap[name] != null ? leadTimeMap[name] : leadTime;
      const lastPo = [pb?.lastPoDate, ...orders.map(o => o.orderDate ? toIsoDate(parseFlexDate(o.orderDate)) : '')].filter(Boolean).sort().pop() || '';
      return {
        name, items, toOrder, value, worstRank,
        worst: ['now','soon','watch','unknown','ok'][worstRank] || 'ok',
        draftCount: items.filter(p => draftQty[p.key] != null).length,
        ordersCount: orders.length, ordersLate: orders.filter(o => o.isOverdue).length,
        ships, nextShip, shipDelayed: ships.some(s => s.delayDays > 0),
        pb, rel, lead, lastPo,
        actualLeadDays: rel?.avgLeadDays ?? pb?.avgLeadDays ?? null,
      };
    }).sort((a,b) => a.worstRank - b.worstRank || b.value - a.value || (b.pb?.spend12||0) - (a.pb?.spend12||0));
  }, [products, draftQty, ordersEnriched, activeShipsBySupplier, purchBySupplier, supplierReliability, leadTimeMap, leadTime]);
  const vendorObj = vendor ? vendors.find(v => v.name === vendor) : null;
  const setDraftFor = (p, val) => {
    const next = { ...draftQty };
    if (val === '' || val == null) delete next[p.key];
    else next[p.key] = Math.max(0, Math.round(Number(val) || 0));
    saveDraft(next);
  };
  const clearVendorDraft = (v) => { const next = { ...draftQty }; v.items.forEach(p => delete next[p.key]); saveDraft(next); };
  const copyVendorList = async (v) => {
    const lines = v.items.filter(p => orderQtyFor(p) > 0).map(p => `${p.sku||p.key}\t${orderQtyFor(p)}\t${p.name}`).join('\n');
    try { await navigator.clipboard.writeText(lines); setCopiedVendor(v.name); setTimeout(() => setCopiedVendor(null), 2500); }
    catch { setCopiedVendor('error'); }
  };

  // ── Supplier spend trend — from the "ספקים" expense file ──
  // Monthly spend per supplier: last 3 full months vs the 3 before, plus 12-month total.
  const supplierSpend = useMemo(() => {
    if (!suppliersData.length) return [];
    let months = [...new Set(suppliersData.map(d=>d.date).filter(Boolean))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    if (excludeCurrentMonth && months.length > 1) months = months.slice(0,-1);
    const last3 = new Set(months.slice(-3)), prev3 = new Set(months.slice(-6,-3)), last12 = new Set(months.slice(-12));
    const by = {};
    suppliersData.forEach(r => {
      const name = (r.supplier && r.supplier!=='כללי') ? r.supplier : (r.description || r.supplier || 'לא ידוע');
      if (!by[name]) by[name] = { name, last3:0, prev3:0, last12:0, series:{} };
      const v = r.total || 0;
      if (last3.has(r.date)) by[name].last3 += v;
      if (prev3.has(r.date)) by[name].prev3 += v;
      if (last12.has(r.date)) { by[name].last12 += v; by[name].series[r.date] = (by[name].series[r.date]||0) + v; }
    });
    return Object.values(by)
      .map(x => ({ ...x, changePct: x.prev3>0 ? (x.last3-x.prev3)/x.prev3*100 : null, sparkline: months.slice(-12).map(m=>({m, v:x.series[m]||0})) }))
      .filter(x => x.last12 > 0)
      .sort((a,b) => b.last12 - a.last12);
  }, [suppliersData, excludeCurrentMonth]);

  // ── Purchase price changes (catalog price history) and PO price deviations ──
  // monthlyImpactILS = extra (or saved) ₪ per month at the current sales pace.
  const priceChanges = useMemo(() => products
    .filter(p => p.priceChangePct!=null && Math.abs(p.priceChangePct) >= 0.5)
    .map(p => {
      const fx = (p.unitCost!=null && p.unitCostOriginal>0) ? p.unitCost/p.unitCostOriginal : null;
      const monthlyImpactILS = (fx!=null && p.prevPrice!=null) ? (p.avgMonthly||0) * (p.unitCostOriginal - p.prevPrice) * fx : null;
      return { ...p, monthlyImpactILS };
    })
    .sort((a,b) => Math.abs(b.monthlyImpactILS??0) - Math.abs(a.monthlyImpactILS??0) || Math.abs(b.priceChangePct) - Math.abs(a.priceChangePct)), [products]);
  const poPriceDeviations = useMemo(() => ordersEnriched
    .filter(o => o.poPriceDiffPct!=null && Math.abs(o.poPriceDiffPct) >= 3)
    .sort((a,b) => Math.abs(b.poPriceDiffPct) - Math.abs(a.poPriceDiffPct)), [ordersEnriched]);

  // ── Supplier order draft (supplier-facing — no internal ABC/coverage data) ──
  const exportSupplierDraft = (grp) => {
    const items = grp.items.filter(p=>p.suggestedOrder>0);
    if (!items.length) return;
    const dateStr = new Date().toLocaleDateString('he-IL');
    let body = `<h2 style="font-family:Calibri;font-size:16px">הזמנת רכש — ${escHtml(grp.name)}</h2><p style="font-family:Calibri;font-size:12px">תאריך: ${dateStr}</p>`;
    body += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri;font-size:12px;direction:rtl"><thead><tr style="background:#1e293b;color:#fff"><th>#</th><th>מק"ט</th><th>תאור</th><th>כמות</th><th>מחיר יחידה</th><th>סה"כ</th><th>מטבע</th></tr></thead><tbody>`;
    const totals = {};
    items.forEach((p,i) => {
      const cur = p.currency || 'ILS';
      const line = p.unitCostOriginal ? p.suggestedOrder*p.unitCostOriginal : null;
      if (line!=null) totals[cur] = (totals[cur]||0) + line;
      body += `<tr><td style="text-align:center">${i+1}</td><td>${escHtml(p.sku||p.name)}</td><td>${escHtml(p.name)}</td><td style="text-align:center;font-weight:bold">${p.suggestedOrder}</td><td style="text-align:center">${p.unitCostOriginal!=null?p.unitCostOriginal.toFixed(2):''}</td><td style="text-align:center">${line!=null?line.toFixed(2):''}</td><td style="text-align:center">${cur}</td></tr>`;
    });
    Object.entries(totals).forEach(([cur,amt]) => {
      body += `<tr style="font-weight:bold;background:#f1f5f9"><td colspan="5" style="text-align:left">סה"כ (${cur})</td><td style="text-align:center">${amt.toFixed(2)}</td><td style="text-align:center">${cur}</td></tr>`;
    });
    body += `</tbody></table>`;
    const safeName = grp.name.replace(/[\\/:*?"<>|]/g,'_');
    downloadXls('הזמנה', body, `הזמנה_${safeName}_${dateStr.replace(/[./]/g,'-')}.xls`);
  };
  // After sending a draft: record its lines as open orders, so the next
  // calculation already counts them as "on the way" and nothing is ordered twice.
  const registerSupplierDraftAsOrders = (grp) => {
    const items = grp.items.filter(p=>p.suggestedOrder>0);
    if (!items.length) return;
    if (!window.confirm(`לרשום ${items.length} שורות מ"${grp.name}" כהזמנות פתוחות? הן ייכנסו לחישוב כ"בדרך".`)) return;
    const todayIso = new Date().toISOString().slice(0,10);
    const lt = grp.items[0]?.effectiveLeadTime ?? leadTime;
    const exp = new Date(); exp.setDate(exp.getDate() + Math.round(lt*30));
    const added = items.map((p,i) => ({
      id: Date.now().toString(36)+i+Math.random().toString(36).slice(2,6),
      productKey: p.key, productName: p.name, supplier: grp.name==='ספק לא ידוע' ? '' : grp.name,
      orderedQty: p.suggestedOrder, orderDate: todayIso, expectedDate: exp.toISOString().slice(0,10),
      status: 'ordered', poNumber: '', notes: 'נרשם מטיוטת הזמנה', value: p.orderCostOriginal||0,
    }));
    saveOrders([...openOrders, ...added]);
  };

  // ─── Manager PDF report ──────────────────────────────────────
  // jsPDF's built-in fonts have no Hebrew glyphs, so the report is built as a
  // styled HTML element and rasterized via html2canvas into the PDF as an
  // image — the only reliable way to get correct Hebrew/RTL text into a PDF
  // without embedding a custom font.
  const generatePDFReport = async () => {
    if (!window.jspdf || !window.html2canvas) { alert('הספריות הדרושות עדיין נטענות — נסה שוב בעוד רגע.'); return; }
    setPdfGenerating(true);
    try {
      const criticalItems = products.filter(p=>p.risk==='critical').sort((a,b)=>(b.orderCost||0)-(a.orderCost||0)).slice(0,15);
      const lowItems = products.filter(p=>p.risk==='low').sort((a,b)=>(b.orderCost||0)-(a.orderCost||0)).slice(0,15);
      const topSuppliers = supplierGroups.filter(g=>g.totalUnits>0).slice(0,8);
      const dateStr = new Date().toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });

      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;top:-10000px;right:-10000px;width:780px;background:#fff;direction:rtl;font-family:Arial,sans-serif;color:#0f172a;padding:32px;';
      const rowHtml = (p) => `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:6px 8px;font-size:11px;">${p.name||''}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:center;">${p.abc||''}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:center;">${p.supplier||'—'}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:center;">${p.currentStock??'—'}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:center;font-weight:bold;color:${p.risk==='critical'?'#dc2626':'#d97706'};">${p.suggestedOrder.toLocaleString()}</td>
        <td style="padding:6px 8px;font-size:11px;text-align:center;">${p.orderCostOriginal?formatUnitCost(Math.round(p.orderCostOriginal),p.currency):'—'}</td>
      </tr>`;
      const tableHead = `<tr style="background:#1e293b;color:#fff;"><th style="padding:6px 8px;font-size:11px;text-align:right;">מוצר</th><th style="padding:6px 8px;font-size:11px;">ABC</th><th style="padding:6px 8px;font-size:11px;">ספק</th><th style="padding:6px 8px;font-size:11px;">מלאי</th><th style="padding:6px 8px;font-size:11px;">להזמין</th><th style="padding:6px 8px;font-size:11px;">עלות</th></tr>`;

      container.innerHTML = `
        <div style="text-align:center;margin-bottom:24px;border-bottom:3px solid #1e293b;padding-bottom:16px;">
          <h1 style="font-size:22px;margin:0 0 4px;">דוח תכנון רכש</h1>
          <p style="font-size:12px;color:#64748b;margin:0;">${dateStr}</p>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:24px;">
          <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:24px;font-weight:bold;color:#dc2626;">${riskCounts.critical}</div>
            <div style="font-size:11px;color:#7f1d1d;">קריטי — הזמן מיד</div>
          </div>
          <div style="flex:1;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:24px;font-weight:bold;color:#d97706;">${riskCounts.low}</div>
            <div style="font-size:11px;color:#78350f;">מלאי נמוך</div>
          </div>
          <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:24px;font-weight:bold;color:#1d4ed8;">${totalOrderUnits.toLocaleString()}</div>
            <div style="font-size:11px;color:#1e3a8a;">יח' להזמנה</div>
          </div>
          <div style="flex:1;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:20px;font-weight:bold;color:#059669;">${formatShort(totalOrderCost)}</div>
            <div style="font-size:11px;color:#064e3b;">עלות הזמנה משוערת</div>
          </div>
        </div>
        ${blockedCurrencies.length ? `<p style="margin:-12px 0 20px;font-size:11px;color:#b45309;text-align:center;">⚠ הסכום הכולל אינו כולל עלויות ב-${blockedCurrencies.join('/')} (אין שער חליפין מוגדר בהגדרות)</p>` : ''}
        ${criticalItems.length ? `<h2 style="font-size:15px;margin:20px 0 8px;color:#dc2626;">⛔ פריטים קריטיים — הזמן מיד (${criticalItems.length})</h2>
        <table style="width:100%;border-collapse:collapse;"><thead>${tableHead}</thead><tbody>${criticalItems.map(rowHtml).join('')}</tbody></table>` : ''}
        ${lowItems.length ? `<h2 style="font-size:15px;margin:20px 0 8px;color:#d97706;">⚠ מלאי נמוך (${lowItems.length})</h2>
        <table style="width:100%;border-collapse:collapse;"><thead>${tableHead}</thead><tbody>${lowItems.map(rowHtml).join('')}</tbody></table>` : ''}
        ${topSuppliers.length ? `<h2 style="font-size:15px;margin:20px 0 8px;">📦 ספקים מובילים להזמנה</h2>
        <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1e293b;color:#fff;"><th style="padding:6px 8px;font-size:11px;text-align:right;">ספק</th><th style="padding:6px 8px;font-size:11px;">פריטים</th><th style="padding:6px 8px;font-size:11px;">יח'</th><th style="padding:6px 8px;font-size:11px;">עלות</th></tr></thead><tbody>
          ${topSuppliers.map(g => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 8px;font-size:11px;">${g.name}</td><td style="padding:6px 8px;font-size:11px;text-align:center;">${g.items.filter(p=>p.suggestedOrder>0).length}</td><td style="padding:6px 8px;font-size:11px;text-align:center;">${g.totalUnits.toLocaleString()}</td><td style="padding:6px 8px;font-size:11px;text-align:center;">${Object.entries(g.costByCurrency).map(([cur,amt])=>formatUnitCost(Math.round(amt),cur==='ILS'?null:cur)).join(' + ')}</td></tr>`).join('')}
        </tbody></table>` : ''}
        <p style="margin-top:24px;font-size:10px;color:#94a3b8;text-align:center;">נוצר אוטומטית על ידי BizData Pro</p>
      `;
      document.body.appendChild(container);

      const canvas = await window.html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
      document.body.removeChild(container);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210, pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight, position = 0;
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save('דוח_תכנון_רכש_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.pdf');
    } catch (e) {
      console.error('PDF generation failed:', e);
      alert('יצירת ה-PDF נכשלה — נסה שוב.');
    } finally {
      setPdfGenerating(false);
    }
  };

  const ABCBadge = ({cls, xyz, abcXyz}) => {
    const abcStyle = {
      A: isDarkMode?'bg-orange-500/20 text-orange-300 border-orange-500/40':'bg-orange-50 text-orange-700 border-orange-300',
      B: isDarkMode?'bg-blue-500/20 text-blue-300 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-200',
      C: isDarkMode?'bg-slate-600/40 text-slate-400 border-slate-600':'bg-slate-100 text-slate-500 border-slate-200',
    };
    const xyzStyle = {
      X: isDarkMode?'text-emerald-400':'text-emerald-600',
      Y: isDarkMode?'text-orange-400':'text-orange-600',
      Z: isDarkMode?'text-red-400':'text-red-600',
    };
    const tooltips = {
      AX:'ערך גבוה + ביקוש קבוע — רכש שגרתי אוטומטי',
      AY:'ערך גבוה + ביקוש משתנה — דרוש מעקב',
      AZ:'ערך גבוה + ביקוש אי-סדיר — סיכון גבוה',
      BX:'ערך בינוני + ביקוש קבוע',
      BY:'ערך בינוני + ביקוש משתנה',
      BZ:'ערך בינוני + ביקוש אי-סדיר',
      CX:'ערך נמוך + ביקוש קבוע — שקול הפסקה',
      CY:'ערך נמוך + ביקוש משתנה',
      CZ:'ערך נמוך + ביקוש אי-סדיר — שקול ביטול',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border cursor-help gap-0.5 ${abcStyle[cls]||abcStyle.C}`}
        title={tooltips[abcXyz]||abcXyz}>
        {cls}<span className={`text-[10px] ${xyzStyle[xyz]||''}`}>{xyz||''}</span>
      </span>
    );
  };
const SeasonalityButton = (p) => (
                      <div className="relative" style={{lineHeight:0}}>
                            <button
                              onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setSeasonHover(prev=>prev?.key===p.key?null:{key:p.key,rect:r});}}
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${isDarkMode?'text-blue-300 hover:bg-slate-700':'text-blue-700 hover:bg-blue-50'}`}>
                              <Calendar className="w-3.5 h-3.5"/> עונתיות לפי חודש ושנה
                            </button>
                            {seasonHover?.key===p.key && (
                              <div className={`rounded-2xl border shadow-2xl text-right ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}
                                onClick={e=>e.stopPropagation()}
                                style={{
                                  position:'fixed',
                                  lineHeight:'normal',
                                  zIndex:9999,
                                  width:'max-content',
                                  padding:'16px',
                                  ...(seasonHover?.rect ? {
                                    // Open upward if enough space, else downward
                                    ...(seasonHover.rect.top > 350
                                      ? { bottom: window.innerHeight - seasonHover.rect.top + 8 }
                                      : { top: seasonHover.rect.bottom + 8 }),
                                    // Position so popup stays within viewport
                                    ...(()=>{
                                      const popupW = Math.min(
                                        24 * 36 + 60,  // max: 24 months * 36px + year col
                                        window.innerWidth - 16
                                      );
                                      const wantedRight = window.innerWidth - seasonHover.rect.right + 8;
                                      const right = Math.max(8, Math.min(wantedRight, window.innerWidth - popupW - 8));
                                      return { right };
                                    })(),
                                  } : { top:100, right:8 })
                                }}>
                                {/* Header */}
                                <div className="flex items-center justify-between mb-3 gap-3">
                                  <p className={`text-sm font-bold shrink-0 ${isDarkMode?'text-white':'text-slate-800'}`}>עונתיות חודשית</p>
                                  <p className={`text-xs truncate ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{p.name}</p>
                                  <button
                                    onClick={e=>{e.stopPropagation();setSeasonHover(null);}}
                                    className={`shrink-0 p-1 rounded-full transition-colors ${isDarkMode?'hover:bg-slate-700 text-slate-400 hover:text-white':'hover:bg-slate-100 text-slate-400 hover:text-slate-700'}`}>
                                    <X className="w-4 h-4"/>
                                  </button>
                                </div>
                                {/* Table: months as columns, years as rows */}
                                {(() => {
                                  // Build: months as columns (ינו-דצמ order), years as rows
                                  const monthOrder = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
                                  const monthFull  = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

                                  // Parse all entries: {year, month, qty}
                                  const cells = {}; // cells[year][monthAbbr] = qty
                                  Object.entries(p.monthlyData||{}).forEach(([date, qty]) => {
                                    if (!qty || !date) return;
                                    const hyphen = date.indexOf('-');
                                    if (hyphen === -1) return;
                                    const mon = date.slice(0, hyphen);
                                    const yrRaw = date.slice(hyphen + 1);
                                    const yr = yrRaw.length <= 2 ? '20' + yrRaw.padStart(2,'0') : yrRaw;
                                    if (!cells[yr]) cells[yr] = {};
                                    cells[yr][mon] = (cells[yr][mon]||0) + qty;
                                  });

                                  const years = Object.keys(cells).sort();
                                  if (!years.length) return <p className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין נתונים</p>;

                                  // Only include months that have data in at least one year
                                  const activeMons = monthOrder.filter(m => years.some(yr => cells[yr]?.[m]));

                                  return (
                                    <table className="border-collapse text-right" style={{tableLayout:'auto'}}>
                                      <thead>
                                        <tr>
                                          <th className={`text-xs pb-2 pr-3 text-right ${isDarkMode?'text-slate-400':'text-slate-500'}`} style={{minWidth:'48px'}}>שנה</th>
                                          {activeMons.map(m=>(
                                            <th key={m} className={`text-xs pb-2 text-center font-semibold px-2 ${isDarkMode?'text-slate-300':'text-slate-600'}`} style={{minWidth:'32px'}}>{m}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {years.map((yr,ri)=>(
                                          <tr key={yr} className={ri>0?`border-t ${isDarkMode?'border-slate-700':'border-slate-100'}`:''}>
                                            <td className={`text-xs font-bold py-1.5 pr-3 ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{yr}</td>
                                            {activeMons.map(m=>{
                                              const qty = cells[yr]?.[m];
                                              const avg = p.avgMonthly||1;
                                              const ratio = qty ? qty/avg : 0;
                                              const bg = !qty?''
                                                :ratio>=1.3?(isDarkMode?'bg-emerald-500/25':'bg-emerald-50')
                                                :ratio>=1.1?(isDarkMode?'bg-emerald-500/10':'bg-emerald-50/40')
                                                :ratio>=0.8?''
                                                :ratio>=0.5?(isDarkMode?'bg-orange-500/15':'bg-orange-50')
                                                :(isDarkMode?'bg-red-500/15':'bg-red-50');
                                              const tc = !qty?(isDarkMode?'text-slate-700':'text-slate-300')
                                                :ratio>=1.2?(isDarkMode?'text-emerald-300':'text-emerald-700')
                                                :ratio>=0.8?(isDarkMode?'text-slate-200':'text-slate-700')
                                                :ratio>=0.5?(isDarkMode?'text-orange-300':'text-orange-700')
                                                :(isDarkMode?'text-red-400':'text-red-600');
                                              return (
                                                <td key={m} className={`text-center py-1.5 px-2 text-xs font-semibold rounded-sm ${bg} ${tc}`}>
                                                  {qty||'—'}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        ))}
                                        {years.length>1 && (
                                          <tr className={`border-t-2 ${isDarkMode?'border-slate-600':'border-slate-300'}`}>
                                            <td className={`text-xs font-bold py-2 pr-3 ${isDarkMode?'text-slate-300':'text-slate-700'}`}>ממוצע</td>
                                            {activeMons.map(m=>{
                                              const vals = years.map(yr=>cells[yr]?.[m]).filter(Boolean);
                                              const avg = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
                                              return (
                                                <td key={m} className={`text-center py-2 px-2 text-xs font-bold ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                                                  {avg||'—'}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  );
                                })()}
                                {/* Legend */}
                                <div className={`flex items-center gap-4 mt-3 pt-3 border-t text-xs ${isDarkMode?'border-slate-700 text-slate-400':'border-slate-100 text-slate-500'}`}>
                                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-400/60 inline-block"/>שיא</span>
                                  <span className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded inline-block ${isDarkMode?'bg-slate-600':'bg-slate-200'}`}/>ממוצע</span>
                                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-400/60 inline-block"/>שפל</span>
                                  <span className={`mr-auto text-[10px] opacity-60`}>כמויות בפועל</span>
                                </div>
                              </div>
                            )}
                          </div>
);

  // Resize handle: sits on a <th>, lets you drag to resize, double-click to auto-fit.
  const renderColResizeHandle = (key, items) => (
    <div
      onMouseDown={e=>handleColResizeStart(key, e)}
      onClick={e=>{e.preventDefault(); e.stopPropagation();}}
      onDoubleClick={e=>{e.preventDefault(); e.stopPropagation(); autoFitProcColumn(key, items);}}
      title="גרור לשינוי רוחב · לחיצה כפולה להתאמה אוטומטית"
      style={{ position:'absolute', insetInlineEnd:-4, top:0, bottom:0, width:8, cursor:'col-resize', zIndex:5 }}
      className="group/resize"
    >
      <div className={`h-full w-px mx-auto ${isDarkMode?'bg-slate-700 group-hover/resize:bg-blue-400':'bg-slate-200 group-hover/resize:bg-blue-400'}`}/>
    </div>
  );
  // Shared header row — used by the main "by product" table AND every per-supplier
  // table, so column widths/behavior stay perfectly consistent everywhere.
  const renderProcTableHeader = (items) => (
    <tr>
      {PROC_COL_KEYS.map(key => {
        const extraCls = key==='order' ? `font-bold ${isDarkMode?'text-slate-100':'text-slate-800'}` : '';
        const sortKeyMap = { name:'name', supplier:'supplier', status:'statusRank', avg:'avgMonthly', stock:'currentStock', coverage:'effectiveCoverDays', order:'suggestedOrder' };
        const sortKey = sortKeyMap[key];
        return (
          <th key={key}
            data-colkey={key}
            className={`px-4 py-2.5 relative whitespace-nowrap select-none ${sortKey?`cursor-pointer hover:text-blue-500`:''} ${extraCls}`}
            style={{ width: colWidths[key], maxWidth: colWidths[key] }}
            onClick={sortKey ? ()=>reqSort(sortKey) : undefined}>
            {PROC_COL_LABELS[key]}{sortKey && <SortIcon colKey={sortKey} sortConfig={sortConfig}/>}
            {renderColResizeHandle(key, items)}
          </th>
        );
      })}
    </tr>
  );

// One row = one decision. Name (+ABC, SKU, a single note), how much to
// order, one status, stock + on the way, coverage, average, supplier.
// Everything else lives in the product drawer (click the row).
const renderProductRow = (p) => {
                const isEditing = editingStock===p.key;
                const st = p.status || procStatus(p);
                const chip = p.chip;
                const coverPct = p.effectiveCoverDays!=null ? Math.min(100, p.effectiveCoverDays/((p.effectiveLeadTime+monthsToStock)*30||1)*100) : 0;
                const isSel = drawerKey===p.key;
                return (
                  <tr key={p.key}
                    onClick={()=>setDrawerKey(p.key)}
                    onKeyDown={e=>{ if (e.key==='Enter' && e.target===e.currentTarget) setDrawerKey(p.key); }}
                    tabIndex={0}
                    aria-label={`${p.name} — פתח פרטים`}
                    className={`transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isSel?(isDarkMode?'bg-slate-700/60':'bg-blue-50/70'):(isDarkMode?'hover:bg-slate-700/40':'hover:bg-slate-50')}`}>
                    {/* Name */}
                    <td className="px-4 py-3 overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className={`font-semibold text-sm truncate ${isDarkMode?'text-slate-100':'text-slate-800'}`} title={p.name}>{p.name}</p>
                        <span title={`סיווג ${p.abcXyz}`} className={`shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded ${isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-100 text-slate-600'}`}>{p.abc}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 min-w-0">
                        {p.sku&&p.sku!==p.name&&<span className={`text-xs font-mono shrink-0 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.sku}</span>}
                        {chip && <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded truncate ${procChipCls(chip.k, isDarkMode)}`}>{chip.t}</span>}
                      </div>
                    </td>
                    {/* Order */}
                    <td className="px-4 py-3">
                      {p.suggestedOrder>0 ? (
                        <div className="flex flex-col">
                          <span className={`text-lg font-bold tabular-nums leading-tight ${isDarkMode?'text-white':'text-slate-900'}`}>{p.suggestedOrder.toLocaleString()} <span className="text-xs font-medium opacity-60">יח׳</span></span>
                          {p.orderCost ? <span className={`text-xs tabular-nums ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{formatShort(p.orderCost)}</span>
                            : p.costCurrencyBlocked ? <span className={`text-xs ${isDarkMode?'text-orange-300':'text-orange-700'}`} title="חסר שער חליפין בהגדרות">חסר שער {p.costCurrencyBlocked}</span> : null}
                        </div>
                      ) : <span className={`text-sm ${isDarkMode?'text-slate-500':'text-slate-400'}`}>—</span>}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${procStatusCls(st, isDarkMode)}`}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{background: procDotColor[st]}}/>
                        {PROC_STATUS_LABEL[st]}
                      </span>
                    </td>
                    {/* Stock (editable) + on the way */}
                    <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                      {isEditing ? (
                        <input type="number" autoFocus defaultValue={p.currentStock??''} aria-label="מלאי נוכחי"
                          onBlur={e=>{saveStock(p.key,e.target.value);setEditingStock(null);}}
                          onKeyDown={e=>{if(e.key==='Enter'){saveStock(p.key,e.target.value);setEditingStock(null);}if(e.key==='Escape')setEditingStock(null);}}
                          style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#3b82f6'}:{}}
                          className="w-24 px-2 py-1.5 border-2 border-blue-500 rounded-lg text-sm text-right focus:outline-none" placeholder="0"
                        />
                      ) : (
                        <button type="button" onClick={()=>setEditingStock(p.key)} title="לחץ לעריכת המלאי"
                          className={`flex flex-col items-start text-right rounded-lg px-2 py-1 -mx-2 transition-colors ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-100'}`}>
                          {p.currentStock!==null ? (
                            <span className={`text-sm font-semibold tabular-nums ${p.currentStock<=0?(isDarkMode?'text-red-300':'text-red-700'):(isDarkMode?'text-slate-100':'text-slate-800')}`}>{p.currentStock.toLocaleString()} יח׳</span>
                          ) : (
                            <span className={`text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>הזן מלאי</span>
                          )}
                          <span className={`text-xs ${p.overdue?(isDarkMode?'text-red-300':'text-red-700'):(isDarkMode?'text-slate-400':'text-slate-500')}`}>
                            {p.incomingQty>0 ? `+ ${p.incomingQty.toLocaleString()} בדרך` : 'אין בדרך'}
                          </span>
                        </button>
                      )}
                    </td>
                    {/* Coverage (stock + on the way) */}
                    <td className="px-4 py-3">
                      {p.effectiveCoverDays!=null ? (
                        <div className="flex flex-col gap-1.5">
                          <span className={`text-sm font-semibold tabular-nums ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{p.effectiveCoverDays.toLocaleString()} יום</span>
                          <div className={`h-1.5 w-24 rounded-full overflow-hidden ${isDarkMode?'bg-slate-700':'bg-slate-200'}`}>
                            <div className="h-full rounded-full" style={{ width: coverPct.toFixed(0)+'%', background: procDotColor[st] }}/>
                          </div>
                        </div>
                      ) : <span className={`text-sm ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.avgMonthly>0?'—':'אין מכירות'}</span>}
                    </td>
                    {/* Average */}
                    <td className={`px-4 py-3 text-sm tabular-nums ${isDarkMode?'text-slate-300':'text-slate-700'}`}>
                      {p.avgMonthly>0 ? `${p.avgMonthly.toFixed(1)} יח׳` : '—'}
                    </td>
                    {/* Supplier */}
                    <td className="px-4 py-3 overflow-hidden">
                      <span className={`text-sm truncate block ${isDarkMode?'text-slate-300':'text-slate-600'}`} title={p.supplier||''}>{p.supplier||'—'}</span>
                    </td>
                  </tr>
                );
};

  // ── Product drawer — every detail that used to crowd the row ──
  const renderProductDrawer = () => {
    const p = drawerKey ? products.find(x=>x.key===drawerKey) : null;
    if (!p) return null;
    const st = p.status || procStatus(p);
    const buffer = Math.max(p.safetyStock||0, p.minStock||0);
    const horizon = p.effectiveLeadTime + monthsToStock;
    const need = Math.max(0, Math.ceil((p.projectedDemand||0) + buffer - (p.currentStock??0) - (p.incomingQty||0)));
    const muted = isDarkMode?'text-slate-400':'text-slate-500';
    const strong = isDarkMode?'text-slate-100':'text-slate-800';
    const card = isDarkMode?'bg-slate-900/60':'bg-slate-50';
    const productOrders = ordersEnriched.filter(o => (o.productKey||o.productName)===p.key || o.productKey===p.sku || o.productName===p.name);
    const calcRows = [
      { label: `צפי מכירות ל-${horizon} חודשים (אספקה ${p.effectiveLeadTime} + יעד ${monthsToStock})${p.seasonalApplied?' · לפי עונתיות':''}`, value: `${Math.round(p.projectedDemand||0).toLocaleString()} יח׳` },
      { label: p.minStock>p.safetyStock ? `מלאי ביטחון — מינימום מ-Priority` : `מלאי ביטחון (רמת שירות ${p.serviceLevel}%)`, value: `+ ${buffer.toLocaleString()} יח׳` },
      { label: 'פחות מלאי קיים', value: `− ${Math.max(0,p.currentStock??0).toLocaleString()} יח׳` },
      { label: 'פחות מה שבדרך', value: `− ${(p.incomingQty||0).toLocaleString()} יח׳` },
      { label: 'חסר', value: `${need.toLocaleString()} יח׳` },
      ...(p.moq ? [{ label: `אחרי עיגול למינימום הזמנה (${p.moq})`, value: `${p.suggestedOrder.toLocaleString()} יח׳`, total:true }] : [{ label: 'להזמין', value: `${p.suggestedOrder.toLocaleString()} יח׳`, total:true }]),
    ];
    // Portal to <body>: an animated (transformed) ancestor would otherwise
    // turn position:fixed into position-relative-to-that-ancestor.
    return createPortal(
      <div className={`fixed inset-0 z-50 ${isDarkMode?'dark':''}`} role="dialog" aria-modal="true" aria-label={`פרטי מוצר: ${p.name}`} onKeyDown={e=>{ if (e.key==='Escape') setDrawerKey(null); }}>
        <div className="absolute inset-0 bg-slate-900/30" onClick={()=>setDrawerKey(null)}/>
        <aside className={`absolute top-0 bottom-0 left-0 w-full max-w-[500px] overflow-y-auto shadow-2xl animate-in slide-in-from-left duration-200 ${isDarkMode?'bg-slate-800 text-slate-200':'bg-white text-slate-700'}`} dir="rtl">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className={`text-xl font-bold leading-snug ${strong}`}>{p.name}</h2>
                <p className={`text-sm mt-1 ${muted}`}>{[p.sku&&p.sku!==p.name?p.sku:null, p.supplier, `סיווג ${p.abcXyz}`].filter(Boolean).join(' · ')}</p>
                <span className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-xs font-semibold ${procStatusCls(st, isDarkMode)}`}>
                  <span className="w-2 h-2 rounded-full" style={{background: procDotColor[st]}}/>{PROC_STATUS_LABEL[st]}
                </span>
                {p.chip && <span className={`inline-block mr-2 mt-2 text-xs font-semibold px-2 py-1 rounded ${procChipCls(p.chip.k, isDarkMode)}`}>{p.chip.t}</span>}
              </div>
              <button type="button" autoFocus onClick={()=>setDrawerKey(null)} aria-label="סגור" className={`p-2 rounded-lg border ${isDarkMode?'border-slate-600 hover:bg-slate-700':'border-slate-200 hover:bg-slate-50'}`}><X className="w-4 h-4"/></button>
            </div>

            {/* Key numbers */}
            <div className="grid grid-cols-3 gap-3">
              {[
                ['להזמין', p.currentStock===null ? 'חסר מלאי' : p.suggestedOrder>0 ? `${p.suggestedOrder.toLocaleString()} יח׳` : '—'],
                ['עלות', p.orderCost ? formatShort(p.orderCost) : (p.orderCostOriginal ? formatUnitCost(Math.round(p.orderCostOriginal), p.currency) : '—')],
                ['כיסוי כולל בדרך', p.effectiveCoverDays!=null ? `${p.effectiveCoverDays} יום` : '—'],
              ].map(([l,v]) => (
                <div key={l} className={`rounded-xl px-3 py-3 ${card}`}>
                  <p className={`text-xs ${muted}`}>{l}</p>
                  <p className={`text-lg font-bold tabular-nums mt-0.5 ${strong}`}>{v}</p>
                </div>
              ))}
            </div>

            {/* Why this quantity */}
            <section>
              <h3 className={`text-sm font-bold mb-2 ${strong}`}>למה הכמות הזו?</h3>
              <div className={`rounded-xl border overflow-hidden text-sm ${isDarkMode?'border-slate-700':'border-slate-200'}`}>
                {calcRows.map((r,i) => (
                  <div key={i} className={`flex justify-between gap-3 px-4 py-2.5 ${i>0?(isDarkMode?'border-t border-slate-700':'border-t border-slate-100'):''} ${r.total?(isDarkMode?'bg-slate-900/60 font-bold':'bg-slate-50 font-bold'):''}`}>
                    <span>{r.label}</span><span className="tabular-nums whitespace-nowrap font-semibold">{r.value}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Sales by month & year — from invoice lines when loaded, else the monthly file */}
            {(() => {
              const lines = linesBySku[p.sku] || linesBySku[p.key] || [];
              const byYm = {};
              if (lines.length) lines.forEach(l => { const ym = l.d.slice(0,7); byYm[ym] = (byYm[ym]||0) + l.q; });
              else Object.entries(p.monthlyData||{}).forEach(([mk,q]) => { const [m,y] = mk.split('-'); const mi = HebrewMonthsReverse[m]; if (mi) byYm[`20${y}-${String(mi).padStart(2,'0')}`] = q; });
              const years = [...new Set(Object.keys(byYm).map(k=>k.slice(0,4)))].sort().slice(-3);
              if (!years.length) return null;
              const max = Math.max(1, ...Object.values(byYm));
              return (
                <section>
                  <h3 className={`text-sm font-bold mb-2 ${strong}`}>כמה נמכר ומתי</h3>
                  <div className="grid gap-[3px] text-[11px] text-center" style={{gridTemplateColumns:'40px repeat(12, minmax(0,1fr)) 46px'}}>
                    <span/>
                    {MONTH_ABBR_LABELS_SHORT.map(m => <span key={m} className={muted}>{m}</span>)}
                    <span className={`font-bold ${muted}`}>סה״כ</span>
                    {years.map(y => {
                      const vals = MONTH_ABBR_LABELS_SHORT.map((_,i) => byYm[`${y}-${String(i+1).padStart(2,'0')}`]);
                      return (
                        <React.Fragment key={y}>
                          <span className={`font-bold text-right self-center ${strong}`}>{y}</span>
                          {vals.map((v,i) => {
                            const a = v>0 ? 0.14 + 0.78*(v/max) : 0;
                            return <span key={i} title={v!=null?`${MONTH_ABBR_LABELS_SHORT[i]} ${y}: ${v} יח׳`:''} className="h-6 rounded flex items-center justify-center font-semibold tabular-nums"
                              style={v>0?{background:`rgba(31,95,191,${a.toFixed(2)})`,color:a>0.5?'#fff':(isDarkMode?'#BFD3F2':'#1B3E77')}:{background:v===undefined?'transparent':(isDarkMode?'#1E293B':'#F1F3F6'),color:isDarkMode?'#475569':'#B4BAC4'}}>{v>0?Math.round(v):(v===undefined?'':'·')}</span>;
                          })}
                          <span className={`font-bold self-center tabular-nums ${strong}`}>{Math.round(vals.reduce((a,b)=>a+(b||0),0)).toLocaleString()}</span>
                        </React.Fragment>
                      );
                    })}
                  </div>
                  {!lines.length && <p className={`text-xs mt-1.5 ${muted}`}>לפרטים לפי לקוח ועסקה — טען את "שורות חשבוניות מכירה".</p>}
                </section>
              );
            })()}

            {/* Who bought it — last 12 months, from invoice lines */}
            {(() => {
              const lines = linesBySku[p.sku] || linesBySku[p.key] || [];
              if (!lines.length) return null;
              const cutoff = new Date(Date.now() - 365*DAY_MS).toISOString().slice(0,10);
              const byC = {};
              lines.forEach(l => { if (l.d < cutoff) return; const c = byC[l.c] ||= { name:l.c, q:0, n:0, last:'' }; c.q += l.q; if (l.q>0) c.n++; if (l.d > c.last) c.last = l.d; });
              const all = Object.values(byC).filter(c=>c.q>0).sort((a,b)=>b.q-a.q);
              const total = all.reduce((a,c)=>a+c.q,0);
              const top = all.slice(0,6);
              const biggest = lines.filter(l=>l.d>=cutoff && l.q>0).sort((a,b)=>b.q-a.q)[0];
              return (
                <section>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className={`text-sm font-bold ${strong}`}>מי קנה — 12 חודשים</h3>
                    <span className={`text-xs ${muted}`}>{all.length} לקוחות · {Math.round(total).toLocaleString()} יח׳</span>
                  </div>
                  <div className="space-y-1.5">
                    {top.map(c => (
                      <div key={c.name} className="flex items-center gap-2 text-sm">
                        <span className={`w-40 truncate ${strong}`} title={c.name}>{c.name}</span>
                        <div className={`flex-1 h-2 rounded-full ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}><div className="h-2 rounded-full bg-blue-600" style={{width:`${Math.max(3, c.q/top[0].q*100)}%`}}/></div>
                        <b className={`w-14 text-left tabular-nums ${strong}`}>{Math.round(c.q).toLocaleString()}</b>
                        <span className={`w-20 text-xs ${muted}`}>{c.n} עסקאות</span>
                      </div>
                    ))}
                  </div>
                  {top.length && total>0 && top[0].q/total >= 0.4 && <p className={`text-xs mt-2 font-semibold ${isDarkMode?'text-orange-300':'text-orange-700'}`}>{Math.round(top[0].q/total*100)}% מהכמות הלכה ללקוח אחד — הביקוש תלוי בו.</p>}
                  {biggest && <p className={`text-xs mt-1 ${muted}`}>העסקה הגדולה ביותר: {Math.round(biggest.q)} יח׳ ל{biggest.c} ב-{isoToDisplay(biggest.d)}</p>}
                </section>
              );
            })()}

            {/* Latest transactions */}
            {(() => {
              const lines = (linesBySku[p.sku] || linesBySku[p.key] || []).slice(0,8);
              if (!lines.length) return null;
              return (
                <section>
                  <h3 className={`text-sm font-bold mb-2 ${strong}`}>עסקאות אחרונות</h3>
                  <div className={`rounded-xl border overflow-hidden text-sm ${isDarkMode?'border-slate-700':'border-slate-200'}`}>
                    <div className={`grid gap-2 px-3 py-2 text-xs font-semibold ${isDarkMode?'bg-slate-900/60 text-slate-400':'bg-slate-50 text-slate-500'}`} style={{gridTemplateColumns:'70px minmax(0,1fr) 56px 90px'}}>{sortHead('drawerLines','d','תאריך',{firstDir:'desc'})}{sortHead('drawerLines','c','לקוח')}{sortHead('drawerLines','q','כמות',{firstDir:'desc'})}{sortHead('drawerLines','inv','חשבונית')}</div>
                    {sortRows('drawerLines', lines).map((l,i) => (
                      <div key={i} className={`grid gap-2 px-3 py-2 ${isDarkMode?'border-t border-slate-700':'border-t border-slate-100'}`} style={{gridTemplateColumns:'70px minmax(0,1fr) 56px 90px'}}>
                        <span className={muted}>{isoToDisplay(l.d)}</span>
                        <span className={`truncate ${strong}`} title={l.c}>{l.c}</span>
                        <b className={`tabular-nums ${l.q<0?(isDarkMode?'text-red-300':'text-red-700'):strong}`}>{l.q<0?`${l.q} (החזרה)`:l.q}</b>
                        <span className={`text-xs font-mono ${muted}`}>{l.inv}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* Purchase history — from supplier invoice lines */}
            {(() => {
              const buys = (purchBySku[p.sku] || purchBySku[p.key] || []).slice(0,6);
              if (!buys.length) return null;
              return (
                <section>
                  <h3 className={`text-sm font-bold mb-2 ${strong}`}>קניות אחרונות</h3>
                  <div className={`rounded-xl border overflow-hidden text-sm ${isDarkMode?'border-slate-700':'border-slate-200'}`}>
                    <div className={`grid gap-2 px-3 py-2 text-xs font-semibold ${isDarkMode?'bg-slate-900/60 text-slate-400':'bg-slate-50 text-slate-500'}`} style={{gridTemplateColumns:'70px minmax(0,1fr) 50px 80px 76px'}}>{sortHead('drawerBuys','d','חשבונית',{firstDir:'desc'})}{sortHead('drawerBuys','s','ספק')}{sortHead('drawerBuys','q','כמות',{firstDir:'desc'})}{sortHead('drawerBuys','p','מחיר יח׳',{firstDir:'desc'})}{sortHead('drawerBuys','lead','מהזמנה',{firstDir:'desc'})}</div>
                    {sortRows('drawerBuys', buys, { lead: b => b.pod ? daysBetween(b.pod, b.d) : null }).map((b,i) => (
                      <div key={i} className={`grid gap-2 px-3 py-2 ${isDarkMode?'border-t border-slate-700':'border-t border-slate-100'}`} style={{gridTemplateColumns:'70px minmax(0,1fr) 50px 80px 76px'}}>
                        <span className={muted}>{isoToDisplay(b.d)}</span>
                        <span className={`truncate ${strong}`} title={b.s}>{b.s}</span>
                        <b className={`tabular-nums ${strong}`}>{b.q}</b>
                        <span className={`tabular-nums ${strong}`}>{formatUnitCost(b.p, b.cur==='ILS'?null:b.cur)}</span>
                        <span className={`text-xs ${muted}`} title={b.po}>{b.pod ? `${Math.round(daysBetween(b.pod, b.d))} יום` : '—'}</span>
                      </div>
                    ))}
                  </div>
                  {p.costFromPurchase && <p className={`text-xs mt-1.5 ${muted}`}>אין מחיר בכרטיס הפריט — העלות מחושבת לפי החשבונית האחרונה.</p>}
                </section>
              );
            })()}

            {/* Purchasing */}
            <section>
              <h3 className={`text-sm font-bold mb-2 ${strong}`}>רכש</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className={muted}>זמן אספקה</dt><dd className={`font-semibold ${strong}`}>{p.effectiveLeadTime} ח׳{p.leadTimeOverridden?' (לפי ספק)':' (כללי)'}</dd>
                <dt className={muted}>מחיר קניה</dt>
                <dd className={`font-semibold ${strong}`}>
                  {p.unitCostOriginal!=null ? formatUnitCost(p.unitCostOriginal, p.currency) : '—'}
                  {p.costFromAvg && <span className={`mr-2 text-xs ${muted}`}>(עלות ממוצעת מ-Priority — אין מחיר בכרטיס)</span>}
                  {p.priceChangePct!=null && Math.abs(p.priceChangePct)>=0.5 && <span className={`mr-2 text-xs ${p.priceChangePct>0?(isDarkMode?'text-orange-300':'text-orange-700'):muted}`}>({p.priceChangePct>0?'עלה':'ירד'} {Math.abs(p.priceChangePct).toFixed(1)}% מ-{formatUnitCost(p.prevPrice, p.currency)})</span>}
                </dd>
                <dt className={muted}>מינימום הזמנה (MOQ)</dt>
                <dd>
                  {editingMOQ===p.key ? (
                    <input type="number" autoFocus defaultValue={p.moq??''} aria-label="מינימום הזמנה"
                      onBlur={e=>{saveMOQ(p.key,e.target.value);setEditingMOQ(null);}}
                      onKeyDown={e=>{e.stopPropagation(); if(e.key==='Enter'){saveMOQ(p.key,e.target.value);setEditingMOQ(null);} if(e.key==='Escape')setEditingMOQ(null);}}
                      style={isDarkMode?{background:'#1e293b',color:'#f1f5f9'}:{}}
                      className="w-24 px-2 py-1 border-2 border-blue-500 rounded-lg text-sm text-right focus:outline-none"/>
                  ) : (
                    <button type="button" onClick={()=>setEditingMOQ(p.key)} className={`font-semibold underline decoration-dotted underline-offset-4 ${isDarkMode?'text-blue-300':'text-blue-700'}`}>{p.moq ? `${p.moq} יח׳` : 'הוסף'}</button>
                  )}
                </dd>
                <dt className={muted}>מינימום מלאי (Priority)</dt><dd className={`font-semibold ${strong}`}>{p.minStock ?? '—'}</dd>
                {p.family && <><dt className={muted}>משפחת מוצר</dt><dd className={`font-semibold ${strong}`}>{p.family}{p.ownMade && <span className={`mr-2 text-[11px] px-1.5 py-0.5 rounded ${procChipCls('watch',isDarkMode)}`}>ייצור עצמי</span>}</dd></>}
                {p.avgCostPriority>0 && <><dt className={muted}>עלות ממוצעת (Priority)</dt><dd className={`font-semibold ${strong}`}>{formatUnitCost(p.avgCostPriority, null)}</dd></>}
                {p.listPrice>0 && <><dt className={muted}>מחיר מחירון</dt><dd className={`font-semibold ${strong}`}>{formatUnitCost(p.listPrice, null)}{p.avgCostPriority>0 && <span className={`mr-2 text-xs ${muted}`}>רווח {Math.round((1 - p.avgCostPriority/p.listPrice)*100)}%</span>}</dd></>}
                {(p.lastSalePriority || p.lastBuyPriority) && <><dt className={muted}>מכירה / קנייה אחרונה</dt><dd className={`font-semibold ${strong}`}>{p.lastSalePriority ? isoToDisplay(p.lastSalePriority) : '—'} / {p.lastBuyPriority ? isoToDisplay(p.lastBuyPriority) : '—'}</dd></>}
                <dt className={muted}>ציון סיכון</dt><dd className={`font-semibold ${strong}`} title="כיסוי מלאי 40% · תנודתיות ביקוש 20% · יציבות XYZ 15% · זמן אספקה 15% · ריכוזיות ספק 10%">{p.riskScore} / 100</dd>
              </dl>
            </section>

            {/* Open orders for this product */}
            {productOrders.length>0 && (
              <section>
                <h3 className={`text-sm font-bold mb-2 ${strong}`}>בדרך ({productOrders.length})</h3>
                <div className="space-y-2">
                  {productOrders.map(o => (
                    <div key={o.id} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${card}`}>
                      <span>{o.orderedQty.toLocaleString()} יח׳{o.poNumber?` · ${o.poNumber}`:''}</span>
                      <span className={o.isOverdue?(isDarkMode?'text-red-300 font-semibold':'text-red-700 font-semibold'):muted}>
                        {(() => { const sh = (activeShipsBySupplier[o.supplier]||[]).find(x=>x.arr); return sh ? `${sh.cont||'משלוח'} · הגעה ${isoToDisplay(sh.arr)}${sh.delayDays>0?' (נדחה)':''}` : (o.isOverdue ? `באיחור ${o.daysLate} ימים` : (o.expectedDate ? `צפוי ${o.expectedDate}` : 'ללא תאריך')); })()}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {onJumpToSales && (
              <button type="button" onClick={()=>{ setDrawerKey(null); onJumpToSales(p.name); }}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold ${isDarkMode?'border-slate-600 hover:bg-slate-700':'border-slate-200 hover:bg-slate-50'}`}>
                <TrendingUp className="w-4 h-4"/> פתח את המוצר במכירות
              </button>
            )}
          </div>
        </aside>
      </div>,
      document.body
    );
  };

  const MiniSparkline = ({data}) => {
    if (!data||data.length<2) return null;
    const vals=data.map(d=>d.v), min=Math.min(...vals), max=Math.max(...vals), range=max-min||1;
    const w=60, h=24;
    const pts=vals.map((v,i)=>`${(i/(vals.length-1))*w},${h-((v-min)/range)*(h-4)-2}`).join(' ');
    return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><polyline points={pts} fill="none" stroke={vals[vals.length-1]>=vals[0]?'#10b981':'#ef4444'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
  };

  // Seasonality popup — shown on hover over calendar icon
  const [seasonHover, setSeasonHover] = useState(null); // {key, rect}

  // Close seasonality popup on click outside
  useEffect(() => {
    if (!seasonHover) return;
    const close = () => setSeasonHover(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [seasonHover]);

  // Trend chart popup — shown on click over the trend % badge
  const [trendHover, setTrendHover] = useState(null); // {key, rect}
  useEffect(() => {
    if (!trendHover) return;
    const close = () => setTrendHover(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [trendHover]);




  // ══ PRIORITY SYNC — pulls the same data straight from Priority (read-only) ══
  // The pulled data is turned into the same sheets the uploads expect and fed
  // to the same handlers, so nothing downstream behaves differently.
  const [prioSync, setPrioSync] = useState({ busy:false, log:[], errors:{}, at: (() => { try { return Number(localStorage.getItem('prioritySyncAt'))||null; } catch { return null; } })() });
  const [prioFields, setPrioFields] = useState(null);
  // Incremental by default: invoices are re-pulled only from (last sync − 45 days),
  // which also catches late edits/credits, and merged into what's stored.
  // The first sync — or "סנכרון מלא" — pulls the full 24 months.
  const SYNC_OVERLAP_DAYS = 45; // also re-reads invoices cancelled a few weeks after they were issued
  const syncFromPriority = async (full = false) => {
    const log = [];
    const t0 = Date.now();
    const report = (t) => { log.push(t); setPrioSync(s => ({ ...s, log:[...log] })); };
    setPrioSync(s => ({ ...s, busy:true, log:[], errors:{} }));
    const asEvent = (file) => ({ target:{ files:[file], value:'' } });
    let through = {};
    try { through = JSON.parse(localStorage.getItem('prioritySyncThrough')||'{}'); } catch { /* full */ }
    const sinceFor = (slot, has) => {
      if (full || !has || !through[slot]) return null;
      const d = new Date(through[slot] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - SYNC_OVERLAP_DAYS);
      return d.toISOString().slice(0,10);
    };
    const salesSince = sinceFor('salesLines', salesLinesAll.length > 0);
    const purchaseSince = sinceFor('purchaseLines', purchaseLines.length > 0);
    report(salesSince || purchaseSince ? `סנכרון מהיר — חשבוניות מ-${isoToDisplay(salesSince || purchaseSince)} ואילך` : 'סנכרון מלא — 24 חודשים (פעם ראשונה לוקח כמה דקות)');
    try {
      const r = await pullAllFromPriority({ report, salesSince, purchaseSince });
      if (r.files.items) {
        handleInvUpload(asEvent(r.files.items), 'product', { replaceStock: r.itemsInfo.hasBalances });
        // The same pull also carries the item-card data (supplier, price, currency, minimum).
        setInvSlots(prev => {
          const next = { ...prev, masterCard: { name:r.files.items.name, total:r.itemsInfo.count, withQty:0, withCost:0, withMinStock:0, withSupplier:0, importedAt:Date.now() } };
          try { localStorage.setItem('procurementInvSlots', JSON.stringify(next)); } catch { /* best-effort */ }
          return next;
        });
        report(`פריטים: ${r.itemsInfo.count.toLocaleString()} פריטים פעילים${r.itemsInfo.hasBalances ? '' : ' (בלי יתרות מלאי)'}`);
      }
      if (r.itemsExtra) { setItemsExtra(r.itemsExtra); try { await idbSet('procItemsExtra', r.itemsExtra); } catch { /* best-effort */ } }
      if (r.customers) {
        try { await idbSet('priorityCustomers', r.customers); } catch { /* best-effort */ }
        onCustomersChange?.(r.customers);
        report(`כרטיסי לקוחות: ${Object.keys(r.customers).length.toLocaleString()}`);
      }
      if (r.files.openOrders) { handlePriorityOrdersUpload(asEvent(r.files.openOrders), { silent:true }); }
      const today = new Date().toISOString().slice(0,10);
      const nextThrough = { ...through };
      if (r.files.salesLines) { await handleProcFile(asEvent(r.files.salesLines), 'salesLines', { mergeFrom: salesSince }); nextThrough.salesLines = today; report(`חשבוניות מכירה: ${(r.counts?.salesLines||0).toLocaleString()} שורות ${salesSince?'חדשות/מעודכנות':''}`); }
      if (r.files.purchaseLines) { await handleProcFile(asEvent(r.files.purchaseLines), 'purchaseLines', { mergeFrom: purchaseSince }); nextThrough.purchaseLines = today; }
      try { localStorage.setItem('prioritySyncThrough', JSON.stringify(nextThrough)); } catch { /* best-effort */ }
      const okCount = Object.keys(r.files).filter(k => r.files[k]).length;
      if (okCount) { const at = Date.now(); try { localStorage.setItem('prioritySyncAt', String(at)); } catch { /* best-effort */ } setPrioSync(s => ({ ...s, at })); onSyncDone?.(at); }
      const secs = Math.round((Date.now()-t0)/1000);
      report(Object.keys(r.errors).length ? `הסתיים עם ${Object.keys(r.errors).length} בעיות (${secs} שנ׳) — פרטים למעלה. מה שנכשל לא עודכן; הנתונים הקודמים נשמרו.` : `הסנכרון הסתיים בהצלחה (${secs} שנ׳)`);
      setPrioSync(s => ({ ...s, busy:false, errors:r.errors }));
    } catch (err) {
      report(`הסנכרון נכשל: ${err.message || err}`);
      setPrioSync(s => ({ ...s, busy:false, errors:{ all: err.message || String(err) } }));
    }
  };
  // A sync asked for from another tab (sales / customers): open the files panel so the progress is visible, and run it.
  useEffect(() => {
    if (!syncRequest || prioSync.busy) return;
    onSyncRequestHandled?.();
    setSettingsOpen(true);
    syncFromPriority(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRequest]);

  const showPriorityFields = async () => {
    setPrioFields({ loading:true });
    try { setPrioFields({ data: await describeAll() }); } catch (e) { setPrioFields({ error: e.message || String(e) }); }
  };
  const renderPriorityCard = () => {
    const muted = isDarkMode?'text-slate-400':'text-slate-500';
    const strong = isDarkMode?'text-slate-100':'text-slate-800';
    const hasErr = Object.keys(prioSync.errors||{}).length > 0;
    return (
      <div className={`rounded-xl border p-4 space-y-3 ${isDarkMode?'bg-blue-500/5 border-blue-500/30':'bg-blue-50/60 border-blue-200'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <p className={`font-bold text-sm ${strong}`}>סנכרון ישיר מ-Priority</p>
            <p className={`text-xs mt-0.5 ${muted}`}>מושך פריטים, יתרות מלאי, הזמנות רכש פתוחות, חשבוניות מכירה וחשבוניות ספק — במקום להעלות קבצים. חשבוניות המכירה מעדכנות גם את לשוניות מכירות ולקוחות. רק חשבוניות סופיות נספרות (בלי טיוטות ובלי מבוטלות). אחרי הפעם הראשונה נמשכים רק החודש וחצי האחרונים, אז זה מהיר. קריאה בלבד, שום דבר לא משתנה ב-Priority. דוח המשלוחים מהמשלח עדיין נטען כקובץ.</p>
            {prioSync.at && <p className={`text-xs mt-1 ${muted}`}>סנכרון אחרון: {new Date(prioSync.at).toLocaleString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</p>}
          </div>
          <button type="button" onClick={()=>syncFromPriority(false)} disabled={prioSync.busy}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 ${prioSync.busy?'opacity-60 cursor-wait':''}`}>
            {prioSync.busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Activity className="w-4 h-4"/>}
            {prioSync.busy ? 'מסנכרן…' : 'סנכרן עכשיו'}
          </button>
          <button type="button" onClick={()=>{ if (window.confirm('סנכרון מלא מושך מחדש 24 חודשי חשבוניות ולוקח כמה דקות. להמשיך?')) syncFromPriority(true); }} disabled={prioSync.busy} className={`text-xs font-semibold underline ${muted}`}>סנכרון מלא</button>
          <button type="button" onClick={showPriorityFields} className={`text-xs font-semibold underline ${muted}`}>בדיקת שדות</button>
        </div>
        {prioSync.log.length > 0 && (
          <ul role="status" aria-live="polite" className={`text-xs space-y-0.5 ${hasErr?(isDarkMode?'text-amber-200':'text-amber-800'):muted}`}>
            {prioSync.log.map((t,i) => <li key={i}>• {t}</li>)}
          </ul>
        )}
        {prioFields && (
          <div className="space-y-1">
            {prioFields.loading && <p className={`text-xs ${muted}`}>טוען רשימת שדות…</p>}
            {prioFields.error && <p className="text-xs text-red-600">{prioFields.error}</p>}
            {prioFields.data && (<>
              <p className={`text-xs ${muted}`}>אם משהו לא נמשך נכון — העתק את זה ושלח:</p>
              <textarea readOnly dir="ltr" rows={6} value={JSON.stringify(prioFields.data)} onFocus={e=>e.target.select()}
                className={`w-full text-[11px] font-mono p-2 rounded border ${isDarkMode?'bg-slate-900 border-slate-700 text-slate-300':'bg-white border-slate-300 text-slate-700'}`}/>
            </>)}
          </div>
        )}
      </div>
    );
  };

  // ══ FILES PANEL — every upload explains exactly which file it expects ══
  const FILE_SLOT_DEFS = [
    { key:'inventory', title:'יתרות מלאי', report:'דוח יתרות מלאי מ-Priority (מלאי נוכחי לפי מוצר)', gives:'כמה יש עכשיו במחסן מכל מוצר', cols:['מק"ט','תאור מוצר','יתרה'], freq:'לפני כל סבב הזמנות', staleDays:7 },
    { key:'masterCard', title:'כרטיס פריט', report:'ייצוא כרטיסי פריטים מ-Priority', gives:'ספק, מחיר קניה, מטבע ומינימום מלאי לכל מוצר', cols:['מק"ט','שם ספק','מחיר קניה אחרון','מטבע','כמות מינימום למלאי'], freq:'פעם בחודש, או כשמחירים משתנים', staleDays:60 },
    { key:'openOrders', title:'הזמנות רכש פתוחות', report:'דוח הזמנות רכש פתוחות מ-Priority (עם יתרה לאספקה)', gives:'מה כבר הוזמן ועוד לא הגיע — כדי לא להזמין פעמיים', cols:['הזמנה','מק"ט','יתרה לאספקה','שם ספק','ת. הזמנה','ת. אספקה'], freq:'לפני כל סבב הזמנות, ואחרי שהוצאת הזמנה', staleDays:3 },
    { key:'salesLines', title:'שורות חשבוניות מכירה', report:'דוח שורות חשבוניות ללקוחות מ-Priority — לפחות 12 חודשים אחורה', gives:'כמה נמכר, מתי ולמי — עד רמת החשבונית', cols:['תאריך','חשבונית','שם לקוח','מק"ט','כמות','סה"כ אחרי הנחה'], freq:'פעם בשבוע (הקובץ החדש מחליף את הקודם)', staleDays:14 },
    { key:'purchaseLines', title:'שורות חשבוניות ספק', report:'דוח שורות חשבוניות ספק מ-Priority', gives:'מה קנית, באיזה מחיר, וכמה זמן עבר מההזמנה', cols:['תאריך','שם ספק','מק"ט','כמות','מחיר ליחידה','מטבע שורה','הזמנת רכש','תאריך ההזמנה'], freq:'פעם בשבוע', staleDays:30 },
    { key:'shipments', title:'דוח משלוחים מהמשלח', report:'האקסל היומי שמגיע מהמשלח ("דוח הזמנות ללקוחות")', gives:'מכולות בדרך, תאריכי הגעה ודחיות', cols:['Supplier Name','Containers List','Departure Date','Arrival Date','Last Event Desc'], freq:'כל יום', staleDays:2 },
  ];
  const slotStatus = (key) => {
    if (key==='inventory' || key==='masterCard') {
      const f = invSlots[key==='inventory'?'product':'masterCard'];
      return f ? { loaded:true, name:f.name, at:f.importedAt, detail:`${f.total.toLocaleString()} פריטים` } : { loaded:false };
    }
    if (key==='openOrders') {
      const n = openOrders.filter(o=>o.fromPriority).length;
      return ordersFileName ? { loaded:true, name:ordersFileName, at:filesMeta.openOrders?.at, detail:`${n} שורות פתוחות` } : { loaded:false };
    }
    const m = filesMeta[key];
    const has = key==='salesLines' ? salesLines.length : key==='purchaseLines' ? purchaseLines.length : shipments.length;
    if (!m || !has) return { loaded:false };
    const range = m.from ? ` · ${isoToDisplay(m.from)}–${isoToDisplay(m.to)}` : '';
    return { loaded:true, name:m.name, at:m.at, detail:`${m.rows.toLocaleString()} שורות${range}` };
  };
  const filesSummary = (() => {
    const st = FILE_SLOT_DEFS.map(d => ({ d, s: slotStatus(d.key) }));
    const loaded = st.filter(x => x.s.loaded).length;
    const stale = st.filter(x => x.s.loaded && x.s.at && (Date.now()-x.s.at)/DAY_MS > x.d.staleDays).map(x => x.d.title);
    return { loaded, total: FILE_SLOT_DEFS.length, stale };
  })(); // recomputed every render — cheap, and depends on many pieces of state
  const guardedUpload = async (e, slot, handler) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const rows = await readSheetAsRows(f);
      const det = detectProcFileType(rows);
      const ok = !det || det === slot || ((slot==='inventory'||slot==='masterCard') && (det==='inventory'||det==='masterCard'));
      if (!ok) { setFileMsg({ slot, kind:'error', text:`זה נראה כמו קובץ "${SLOT_TITLES[det]||det}", לא "${SLOT_TITLES[slot]}". העלה אותו במשבצת המתאימה.` }); e.target.value=''; return; }
    } catch { /* let the original handler report read errors */ }
    setFileMsg(null);
    handler(e);
  };
  // Delete what one slot loaded — independently of the other slots.
  const forgetSyncThrough = (slot) => {
    try { const t = JSON.parse(localStorage.getItem('prioritySyncThrough')||'{}'); delete t[slot]; localStorage.setItem('prioritySyncThrough', JSON.stringify(t)); } catch { /* best-effort */ }
  };
  const dropFileMeta = (slot) => setFilesMeta(prev => {
    const next = { ...prev }; delete next[slot];
    try { localStorage.setItem('procFilesMeta', JSON.stringify(next)); } catch { /* best-effort */ }
    return next;
  });
  const SLOT_DELETE_NOTE = {
    inventory: 'יימחקו יתרות המלאי. כרטיס הפריט (ספק, מחיר, מינימום) יישאר.',
    masterCard: 'יימחקו ספק, מחיר קנייה, מטבע, מינימום מלאי ו-MOQ לכל המוצרים. יתרות המלאי יישארו.',
    openOrders: 'יימחקו ההזמנות הפתוחות שנטענו מקובץ/Priority. הזמנות שהוספת ידנית יישארו.',
    salesLines: 'יימחקו כל שורות חשבוניות המכירה. ההיסטוריה תילקח שוב רק מקובץ המכירות החודשיות (אם נטען). הסנכרון הבא מ-Priority יהיה מלא.',
    purchaseLines: 'יימחקו כל שורות חשבוניות הספק. הסנכרון הבא מ-Priority יהיה מלא.',
    shipments: 'יימחקו כל המשלוחים, כולל מעקב שינויי תאריך ההגעה.',
  };
  const clearProcSlot = async (key) => {
    if (!window.confirm(`למחוק את "${SLOT_TITLES[key]}"?\n${SLOT_DELETE_NOTE[key]||''}`)) return;
    setFileMsg(null);
    if (key === 'salesLines' || key === 'purchaseLines' || key === 'shipments') {
      const idbKey = { salesLines:'procSalesLines', purchaseLines:'procPurchaseLines', shipments:'procShipments' }[key];
      try { await idbDelete(idbKey); } catch { /* best-effort */ }
      if (key === 'salesLines') setSalesLines([]); else if (key === 'purchaseLines') setPurchaseLines([]); else setShipments([]);
      dropFileMeta(key); forgetSyncThrough(key);
    } else if (key === 'openOrders') {
      clearPriorityOrders(); dropFileMeta('openOrders');
    } else if (key === 'inventory') {
      setStockMap({}); localStorage.removeItem('procurementStock');
      clearInvSlot('product'); setInvFileName(''); localStorage.removeItem('inventoryFileName');
    } else if (key === 'masterCard') {
      setSupplierMap({}); setMinStockMap({}); setMoqMap({}); setCurrencyMap({}); setCostMap({});
      ['procurementSupplier','procurementMinStock','procurementMOQ','procurementCurrency','procurementCost'].forEach(k => localStorage.removeItem(k));
      clearInvSlot('masterCard');
    }
    setFileMsg({ slot:key, kind:'ok', text:'נמחק.' });
  };
  const renderOtherSources = () => {
    if (!otherSources.length) return null;
    const muted = isDarkMode?'text-slate-400':'text-slate-500';
    const strong = isDarkMode?'text-slate-100':'text-slate-800';
    return (
      <div className={`rounded-xl border p-4 ${isDarkMode?'bg-slate-900/40 border-slate-700':'bg-slate-50/60 border-slate-200'}`}>
        <p className={`font-bold text-sm ${strong}`}>קבצים נוספים שטעונים באתר</p>
        <p className={`text-xs mt-0.5 mb-2 ${muted}`}>קבצים שהועלו בלשוניות האחרות. כשיש גם שורות חשבוניות (מ-Priority או מקובץ), החודשים שהן מכסות נלקחים מהן — והקבצים האלה משמשים רק לחודשים ישנים יותר. אפשר למחוק כל קובץ בנפרד.</p>
        <ul className={`divide-y ${isDarkMode?'divide-slate-700':'divide-slate-200'}`}>
          {otherSources.map(src => (
            <li key={src.id} className="flex items-center gap-3 py-2 text-xs">
              <FileSpreadsheet className="w-4 h-4 shrink-0 text-emerald-600"/>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold truncate ${strong}`} title={src.name}>{src.name}</p>
                <p className={muted}>{src.label}{src.detail ? ` · ${src.detail}` : ''}</p>
              </div>
              <button type="button" onClick={() => { if (window.confirm(`למחוק את הקובץ "${src.name}"?\n(${src.label})`)) src.onDelete(); }}
                aria-label={`מחק את ${src.name}`}
                className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold ${isDarkMode?'text-red-300 hover:bg-red-500/10':'text-red-700 hover:bg-red-50'}`}>
                <Trash2 className="w-3.5 h-3.5"/>מחק
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  const renderFilesPanel = () => {
    const muted = isDarkMode?'text-slate-400':'text-slate-500';
    const strong = isDarkMode?'text-slate-100':'text-slate-800';
    return (
      <section aria-label="קבצים" className="space-y-3">
        {renderPriorityCard()}
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className={`text-base font-bold ${strong}`}>קבצים</h3>
          <span className={`text-sm ${muted}`}>כל משבצת מקבלת קובץ אחד מסוים. אם תעלה קובץ למשבצת הלא נכונה, תופיע הודעה לאיזו משבצת הוא שייך.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {FILE_SLOT_DEFS.map((d, i) => {
            const st = slotStatus(d.key);
            const ageDays = st.at ? Math.floor((Date.now()-st.at)/DAY_MS) : null;
            const stale = st.loaded && ageDays!=null && ageDays > d.staleDays;
            const busy = fileBusy===d.key || (d.key==='openOrders'&&ordersLoading) || ((d.key==='inventory'||d.key==='masterCard')&&invLoading);
            const onPick = (e) => {
              if (d.key==='inventory') return guardedUpload(e, d.key, ev=>handleInvUpload(ev,'product'));
              if (d.key==='masterCard') return guardedUpload(e, d.key, ev=>handleInvUpload(ev,'masterCard'));
              if (d.key==='openOrders') return guardedUpload(e, d.key, handlePriorityOrdersUpload);
              return handleProcFile(e, d.key);
            };
            const msg = fileMsg?.slot===d.key ? fileMsg : (d.key==='openOrders'&&ordersUploadError ? {kind:'error',text:ordersUploadError} : ((d.key==='inventory'||d.key==='masterCard')&&invUploadError&&!fileMsg ? {kind:'error',text:invUploadError} : null));
            return (
              <div key={d.key} className={`rounded-xl border p-4 flex flex-col gap-2.5 ${isDarkMode?'bg-slate-900/40 border-slate-700':'bg-slate-50/60 border-slate-200'}`}>
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${isDarkMode?'bg-slate-700 text-slate-200':'bg-white border border-slate-300 text-slate-700'}`}>{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`font-bold text-sm ${strong}`}>{d.title}</p>
                    <p className={`text-xs mt-0.5 ${muted}`}>{d.gives}</p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded ${!st.loaded ? procChipCls('muted',isDarkMode) : stale ? procChipCls('watch',isDarkMode) : (isDarkMode?'bg-emerald-500/15 text-emerald-300':'bg-emerald-50 text-emerald-700')}`}>
                    {!st.loaded ? 'לא נטען' : stale ? `ישן · ${ageDays} ימים` : 'עדכני'}
                  </span>
                </div>
                <dl className="text-xs space-y-1.5">
                  <div><dt className={`inline font-semibold ${strong}`}>איזה קובץ: </dt><dd className={`inline ${muted}`}>{d.report}</dd></div>
                  <div>
                    <dt className={`font-semibold mb-1 ${strong}`}>עמודות שצריכות להיות בקובץ:</dt>
                    <dd className="flex flex-wrap gap-1">{d.cols.map(c => <span key={c} className={`px-1.5 py-0.5 rounded ${isDarkMode?'bg-slate-700 text-slate-200':'bg-white border border-slate-200 text-slate-700'}`}>{c}</span>)}</dd>
                  </div>
                  <div><dt className={`inline font-semibold ${strong}`}>מתי לעדכן: </dt><dd className={`inline ${muted}`}>{d.freq}</dd></div>
                </dl>
                {st.loaded && (
                  <p className={`text-xs truncate ${muted}`} title={st.name}>
                    <FileSpreadsheet className="w-3.5 h-3.5 inline -mt-0.5 ml-1"/>{st.name} · {st.detail}{st.at?` · נטען ${new Date(st.at).toLocaleDateString('he-IL')}`:''}
                  </p>
                )}
                {msg && <p className={`text-xs font-semibold px-2 py-1.5 rounded ${msg.kind==='ok'?(isDarkMode?'bg-emerald-500/15 text-emerald-300':'bg-emerald-50 text-emerald-800'):(isDarkMode?'bg-red-500/15 text-red-300':'bg-red-50 text-red-700')}`}>{msg.text}</p>}
                <div className="mt-auto flex gap-2">
                <label className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${busy?'opacity-60 cursor-wait':''} ${st.loaded?(isDarkMode?'border border-slate-600 text-slate-200 hover:bg-slate-700':'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50'):'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                  {busy ? 'טוען…' : st.loaded ? `החלף קובץ ${d.title}` : `העלה קובץ ${d.title}`}
                  <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={busy} onChange={onPick}/>
                </label>
                {st.loaded && !busy && (
                  <button type="button" onClick={() => clearProcSlot(d.key)} aria-label={`מחק ${d.title}`} title={`מחק ${d.title}`}
                    className={`shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold border ${isDarkMode?'border-slate-600 text-red-300 hover:bg-red-500/10':'border-slate-300 bg-white text-red-700 hover:bg-red-50'}`}>
                    <Trash2 className="w-4 h-4"/>מחק
                  </button>
                )}
                </div>
              </div>
            );
          })}
        </div>
        {renderOtherSources()}
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${muted}`}>
          <span>היסטוריה לפני תקופת שורות החשבוניות נלקחת מקובץ "מכירות חודשיות לפי מוצר" שבלשונית מכירות{salesDataRaw.length?' (נטען)':' (לא נטען)'}.</span>
          {(invSlots.product || invSlots.masterCard) && <button type="button" onClick={clearInventory} className={`font-semibold ${isDarkMode?'text-red-300':'text-red-700'} hover:underline`}>נקה את נתוני המלאי וכרטיס הפריט</button>}
        </div>
      </section>
    );
  };

  // ══ 12-month sales strip (one cell per month, darker = more units) ══
  // A plain render function (not a component) — components defined inside
  // other components remount on every render.
  const renderSalesStrip = (series, compact) => {
    const max = Math.max(1, ...series.map(d => d.qty||0));
    const size = compact ? 22 : 26;
    return (
      <div className="flex gap-0.5" aria-label={`מכירות 12 חודשים: ${series.map(d=>`${d.month} ${d.qty||0}`).join(', ')}`}>
        {series.map(d => {
          const v = d.qty||0;
          const a = v>0 ? 0.14 + 0.78*(v/max) : 0;
          const style = v>0
            ? { width:size, height:size, background:`rgba(31,95,191,${a.toFixed(2)})`, color: a>0.5 ? '#FFFFFF' : (isDarkMode?'#BFD3F2':'#1B3E77') }
            : { width:size, height:size, background: isDarkMode?'#1E293B':'#F1F3F6', color: isDarkMode?'#475569':'#B4BAC4' };
          return <span key={d.month} title={`${d.month}: ${v.toLocaleString()} יח׳`} style={style} className="rounded flex items-center justify-center text-[10px] font-semibold tabular-nums">{v ? (v>=1000?Math.round(v/100)/10+'k':Math.round(v)) : '·'}</span>;
        })}
      </div>
    );
  };

  // ══ SUPPLIERS: list → supplier page ══
  const renderVendors = () => {
    const muted = isDarkMode?'text-slate-400':'text-slate-500';
    const strong = isDarkMode?'text-slate-100':'text-slate-800';
    const cardCls = `rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`;
    const headCls = `text-xs font-semibold ${isDarkMode?'bg-slate-900/60 text-slate-400':'bg-slate-50 text-slate-500'}`;
    if (!vendorObj) {
      const list = sortRows('vendors', vendors.filter(v => !vendorSearch || smartMatch(v.name, vendorSearch) || v.items.some(p => smartMatch(p.name, vendorSearch) || smartMatch(p.sku, vendorSearch))), {
        toOrder: v => v.toOrder.length || null,
        worst: v => ({ now:0, soon:1, watch:2, unknown:3, ok:4 }[v.worst] ?? 5),
        incoming: v => (v.ordersCount || 0) + v.ships.length || null,
        spend12: v => v.pb?.spend12 || null,
        lead: v => v.actualLeadDays ?? v.lead * 30,
      });
      const grid = { gridTemplateColumns:'minmax(0,1.6fr) 140px 140px 170px 120px 120px 130px 20px' };
      return (
        <div className={cardCls}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h3 className={`text-base font-bold ${strong}`}>ספקים</h3>
            <span className={`text-sm ${muted}`}>{list.length} ספקים · מה שדורש פעולה למעלה · לחיצה על ספק פותחת את כל המוצרים שלו</span>
            <div className="flex-1"/>
            <input type="search" aria-label="חיפוש ספק או מוצר" placeholder="חיפוש ספק או מוצר" value={vendorSearch} onChange={e=>setVendorSearch(e.target.value)}
              className={`px-3 py-2 border rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1000px]">
              <div className={`grid gap-4 px-5 py-2.5 ${headCls}`} style={grid}>
                {sortHead('vendors','name','ספק')}{sortHead('vendors','toOrder','להזמין',{firstDir:'desc'})}{sortHead('vendors','worst','מצב')}{sortHead('vendors','incoming','בדרך',{firstDir:'desc'})}{sortHead('vendors','lastPo','הזמנה אחרונה',{firstDir:'desc'})}{sortHead('vendors','spend12','קניות 12 ח׳',{firstDir:'desc'})}{sortHead('vendors','lead','זמן אספקה',{firstDir:'desc'})}<div/>
              </div>
              {list.map(v => {
                const st = v.worst;
                return (
                  <button key={v.name} type="button" onClick={()=>{ setVendor(v.name); setDrawerKey(null); }}
                    className={`w-full text-right grid gap-4 items-center px-5 py-3.5 border-t transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${isDarkMode?'border-slate-700 hover:bg-slate-700/40':'border-slate-100 hover:bg-slate-50'}`} style={grid}>
                    <div className="min-w-0">
                      <p className={`font-bold text-sm truncate ${strong}`}>{v.name}</p>
                      <p className={`text-xs ${muted}`}>{v.items.length} מוצרים{v.draftCount?` · ${v.draftCount} כמויות שקבעת`:''}</p>
                    </div>
                    <div>
                      {v.toOrder.length ? <>
                        <p className={`text-sm font-bold ${strong}`}>{v.toOrder.length} מוצרים</p>
                        <p className={`text-xs ${muted}`}>{v.value>0?formatShort(v.value):''}</p>
                      </> : <span className={muted}>—</span>}
                    </div>
                    <div><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${procStatusCls(st, isDarkMode)}`}><span className="w-2 h-2 rounded-full" style={{background:procDotColor[st]}}/>{PROC_STATUS_LABEL[st]}</span></div>
                    <div className="min-w-0">
                      {v.ordersCount || v.ships.length ? <>
                        <p className={`text-sm font-semibold ${strong}`}>{v.ordersCount?`${v.ordersCount} שורות הזמנה`:''}{v.ordersCount&&v.ships.length?' · ':''}{v.ships.length?`${v.ships.length} משלוח${v.ships.length>1?'ים':''}`:''}</p>
                        <p className={`text-xs ${v.shipDelayed||v.ordersLate?(isDarkMode?'text-red-300':'text-red-700'):muted}`}>
                          {v.nextShip ? `${v.shipDelayed?'נדחה · ':''}מגיע ${isoToDisplay(v.nextShip.arr)}` : v.ordersLate ? `${v.ordersLate} באיחור` : ''}
                        </p>
                      </> : <span className={muted}>—</span>}
                    </div>
                    <div className={`text-sm ${strong}`}>{v.lastPo ? isoToDisplay(v.lastPo) : '—'}</div>
                    <div className={`text-sm ${strong}`}>{v.pb?.spend12 ? formatShort(v.pb.spend12) : '—'}</div>
                    <div>
                      <p className={`text-sm ${strong}`}>מוגדר {v.lead} ח׳</p>
                      <p className={`text-xs ${v.actualLeadDays!=null && v.actualLeadDays > v.lead*30*1.2+3 ?(isDarkMode?'text-orange-300':'text-orange-700'):muted}`}>{v.actualLeadDays!=null?`בפועל ~${v.actualLeadDays} יום`:'אין נתון בפועל'}</p>
                    </div>
                    <ChevronLeft className={`w-4 h-4 ${muted}`}/>
                  </button>
                );
              })}
              {!list.length && <p className={`px-5 py-10 text-center text-sm ${muted}`}>לא נמצאו ספקים</p>}
            </div>
          </div>
        </div>
      );
    }

    // ── Supplier page ──
    const v = vendorObj;
    const rows = [...v.items].sort((a,b) => (a.statusRank??4)-(b.statusRank??4) || (b.avgMonthly||0)-(a.avgMonthly||0));
    const months = rows[0]?.trendSeries?.map(d=>d.month) || [];
    const toOrder = rows.filter(p => orderQtyFor(p) > 0);
    const totalByCur = {};
    toOrder.forEach(p => { if (p.unitCostOriginal) { const c = p.currency||'ILS'; totalByCur[c] = (totalByCur[c]||0) + orderQtyFor(p)*p.unitCostOriginal; } });
    const grid = { gridTemplateColumns:`minmax(220px,1.4fr) ${months.length*24}px 70px 76px 170px 80px 110px` };
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <button type="button" onClick={()=>setVendor(null)} className={`inline-flex items-center gap-1 text-sm font-semibold ${isDarkMode?'text-blue-300':'text-blue-700'} hover:underline`}>
              <ChevronRight className="w-4 h-4"/> כל הספקים
            </button>
            <h3 className={`text-2xl font-bold ${strong}`}>{v.name}</h3>
            <p className={`text-sm ${muted}`}>{v.items.length} מוצרים · זמן אספקה מוגדר {v.lead} ח׳{v.pb?.mainCur && v.pb.mainCur!=='ILS' ? ` · מטבע ${v.pb.mainCur}` : ''}</p>
          </div>
          <div className="flex-1"/>
          <div className={`flex flex-wrap gap-5 rounded-xl border px-4 py-2.5 text-sm ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
            {[
              ['קניות 12 ח׳', v.pb?.spend12 ? formatShort(v.pb.spend12) : '—'],
              ['הזמנה אחרונה', v.lastPo ? isoToDisplay(v.lastPo) : '—'],
              ['חשבונית אחרונה', v.pb?.lastInv ? isoToDisplay(v.pb.lastInv) : '—'],
              ['מהזמנה עד חשבונית', v.pb?.avgLeadDays!=null ? `~${v.pb.avgLeadDays} יום` : '—'],
              ['הגיעו בזמן', v.rel?.onTimePct!=null ? `${v.rel.onTimePct}%` : '—'],
            ].map(([l,val]) => <div key={l} className="flex flex-col"><span className={`text-xs ${muted}`}>{l}</span><b className={strong}>{val}</b></div>)}
          </div>
        </div>

        {(v.ships.length>0 || v.ordersCount>0) && (
          <div className={`rounded-2xl border px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
            <b className={strong}>בדרך מהספק:</b>
            {v.ships.map(s => (
              <span key={s.id} className="flex items-center gap-2">
                <Truck className={`w-4 h-4 ${muted}`}/>
                <span className={strong}>{s.cont || (s.mode==='LCL'?'משלוח LCL':'משלוח')}</span>
                <span className={muted}>{s.stage.label}{s.arr?` · הגעה ${isoToDisplay(s.arr)}`:''}</span>
                {s.delayDays>0 && <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${procChipCls('watch',isDarkMode)}`}>נדחה ב-{s.delayDays} ימים</span>}
              </span>
            ))}
            {v.ordersCount>0 && <button type="button" onClick={()=>setViewMode('orders')} className={`font-semibold ${isDarkMode?'text-blue-300':'text-blue-700'} hover:underline`}>{v.ordersCount} שורות בהזמנות פתוחות{v.ordersLate?` · ${v.ordersLate} באיחור`:''}</button>}
          </div>
        )}

        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
          <div className={cardCls}>
            <div className="overflow-x-auto">
              <div style={{minWidth: 220 + months.length*24 + 600}}>
                <div className={`grid gap-3 items-center px-4 py-2.5 ${headCls}`} style={grid}>
                  {sortHead('vendorItems','name','מוצר')}
                  <div className="flex gap-0.5">{months.map(m => <span key={m} className="text-[10px] text-center" style={{width:22}}>{m.split('-')[0]}</span>)}</div>
                  {sortHead('vendorItems','avgMonthly','ממוצע',{firstDir:'desc'})}{sortHead('vendorItems','currentStock','מלאי',{firstDir:'desc'})}{sortHead('vendorItems','incomingQty','בדרך · הגעה',{firstDir:'desc'})}{sortHead('vendorItems','suggestedOrder','מומלץ',{firstDir:'desc'})}{sortHead('vendorItems','qty','להזמין',{firstDir:'desc'})}
                </div>
                {sortRows('vendorItems', rows, { incomingQty: p => p.incomingQty || null, qty: p => orderQtyFor(p) || null, suggestedOrder: p => p.currentStock!=null && p.suggestedOrder>0 ? p.suggestedOrder : null }).map(p => {
                  const eta = etaFor(p);
                  const q = orderQtyFor(p);
                  const edited = draftQty[p.key] != null;
                  return (
                    <div key={p.key} className={`grid gap-3 items-center px-4 py-2.5 border-t ${isDarkMode?'border-slate-700':'border-slate-100'} ${drawerKey===p.key?(isDarkMode?'bg-slate-700/50':'bg-blue-50/60'):''}`} style={grid}>
                      <button type="button" onClick={()=>setDrawerKey(p.key)} className="text-right min-w-0 group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                        <p className={`text-sm font-semibold truncate group-hover:underline ${strong}`} title={p.name}>{p.name}</p>
                        <p className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-xs font-mono ${muted}`}>{p.sku}</span>
                          {p.chip && <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded truncate ${procChipCls(p.chip.k, isDarkMode)}`}>{p.chip.t}</span>}
                        </p>
                      </button>
                      {renderSalesStrip(p.trendSeries||[], true)}
                      <div className={`text-sm font-semibold tabular-nums ${strong}`}>{p.avgMonthly>0?p.avgMonthly.toFixed(p.avgMonthly<10?1:0):'—'}</div>
                      <div className={`text-sm font-semibold tabular-nums ${p.currentStock!=null&&p.currentStock<=0?(isDarkMode?'text-red-300':'text-red-700'):strong}`}>{p.currentStock!=null?p.currentStock.toLocaleString():'—'}</div>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${strong}`}>{p.incomingQty>0?`${p.incomingQty.toLocaleString()} יח׳`:'—'}</p>
                        {p.incomingQty>0 && eta && <p className={`text-xs truncate ${eta.delayed?(isDarkMode?'text-red-300':'text-red-700'):muted}`} title={eta.src==='ship'?'לפי דוח המשלח':'לפי תאריך האספקה בהזמנה'}>{eta.cont?`${eta.cont} · `:''}{isoToDisplay(eta.iso)}{eta.delayed?' · באיחור':''}</p>}
                      </div>
                      <div className={`text-sm tabular-nums ${muted}`}>{p.currentStock!=null && p.suggestedOrder>0 ? p.suggestedOrder.toLocaleString() : '—'}</div>
                      <div className="flex items-center gap-1">
                        <label htmlFor={`dq-${p.key}`} className="sr-only">כמות להזמנה — {p.name}</label>
                        <input id={`dq-${p.key}`} type="number" min="0" inputMode="numeric" value={q||''} placeholder="0"
                          onChange={e=>setDraftFor(p, e.target.value)}
                          className={`w-20 px-2 py-1.5 rounded-lg border-2 text-center text-sm font-bold tabular-nums focus:outline-none focus:border-blue-500 ${edited?(isDarkMode?'border-blue-500 bg-blue-500/10 text-white':'border-blue-500 bg-blue-50 text-slate-900'):(isDarkMode?'border-slate-600 bg-slate-900 text-white':'border-slate-300 bg-white text-slate-900')}`}/>
                        {edited && <button type="button" onClick={()=>setDraftFor(p,'')} title="חזור לכמות המומלצת" aria-label="חזור לכמות המומלצת" className={`p-1 rounded ${muted} hover:text-blue-500`}><RefreshCw className="w-3.5 h-3.5"/></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className={`px-4 py-2.5 border-t text-xs ${isDarkMode?'border-slate-700 text-slate-400':'border-slate-100 text-slate-500'}`}>
              משבצת = יחידות שנמכרו בחודש (כהה יותר = יותר) · "מומלץ" מחושב אוטומטית · "להזמין" = הכמות שאתה קובע (כחול = שינית). לחיצה על שם מוצר פותחת את כל הפרטים.
            </p>
          </div>

          <aside aria-label="רשימה להזמנה ב-Priority" className={`rounded-2xl border p-4 space-y-3 2xl:sticky 2xl:top-4 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
            <h4 className={`font-bold ${strong}`}>רשימה להזמנה ב-Priority</h4>
            <p className={`text-xs leading-relaxed ${muted}`}>הכמויות מהטבלה. תקליד אותן בהזמנת הרכש ב-Priority — כשתטען שוב את קובץ ההזמנות הפתוחות, השורות יעברו אוטומטית ל"בדרך" והרשימה תתנקה.</p>
            <div className={`rounded-lg border divide-y text-sm max-h-80 overflow-y-auto ${isDarkMode?'border-slate-700 divide-slate-700':'border-slate-200 divide-slate-100'}`}>
              {toOrder.length ? toOrder.map(p => (
                <div key={p.key} className="flex items-center gap-2 px-3 py-2">
                  <span className={`font-mono text-xs shrink-0 ${muted}`}>{p.sku}</span>
                  <span className={`flex-1 truncate text-xs ${strong}`}>{p.name}</span>
                  <b className={`tabular-nums ${strong}`}>{orderQtyFor(p).toLocaleString()}</b>
                </div>
              )) : <p className={`px-3 py-3 text-xs ${muted}`}>אין כמויות להזמנה מהספק הזה</p>}
            </div>
            {Object.keys(totalByCur).length>0 && (
              <div className="flex justify-between text-sm"><span className={muted}>סה״כ משוער</span><b className={strong}>{Object.entries(totalByCur).map(([c,a])=>formatUnitCost(Math.round(a), c==='ILS'?null:c)).join(' + ')}</b></div>
            )}
            <button type="button" disabled={!toOrder.length} onClick={()=>copyVendorList(v)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-40 hover:bg-slate-800">
              {copiedVendor===v.name ? 'הועתק ✓' : copiedVendor==='error' ? 'ההעתקה נחסמה בדפדפן' : 'העתק רשימה (מק״ט · כמות · שם)'}
            </button>
            {v.draftCount>0 && <button type="button" onClick={()=>clearVendorDraft(v)} className={`w-full text-xs font-semibold ${isDarkMode?'text-slate-300':'text-slate-600'} hover:underline`}>אפס לכמויות המומלצות</button>}
          </aside>
        </div>
      </div>
    );
  };

  // ══ SHIPMENTS (forwarder report) ══
  const renderShipments = () => {
    const muted = isDarkMode?'text-slate-400':'text-slate-500';
    const strong = isDarkMode?'text-slate-100':'text-slate-800';
    const meta = filesMeta.shipments;
    const STAGES = ['בהכנה / ממתין', 'בדרך', 'בנמל'];
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl border px-5 py-4 flex flex-wrap items-center gap-4 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
          <Truck className="w-5 h-5 text-blue-500"/>
          <div className="flex-1 min-w-[240px]">
            <p className={`font-bold ${strong}`}>{meta ? `קובץ המשלח נטען ${new Date(meta.at).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}` : 'עוד לא נטען קובץ מהמשלח'}</p>
            <p className={`text-sm ${muted}`}>מעלים כל יום את האקסל שמגיע מהמשלח ("דוח הזמנות ללקוחות"). שינוי בתאריך ההגעה מסומן. הקובץ לא מפרט מוצרים — לכן מוצג מה שפתוח בהזמנות מאותו ספק.</p>
          </div>
          <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer ${meta?(isDarkMode?'border border-slate-600 text-slate-200 hover:bg-slate-700':'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50'):'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {fileBusy==='shipments'?<Loader2 className="w-4 h-4 animate-spin"/>:<Upload className="w-4 h-4"/>} {meta?'החלף בקובץ של היום':'העלה את קובץ המשלח'}
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={e=>handleProcFile(e,'shipments')}/>
          </label>
          {shipmentsEnriched.length>1 && (
            <label className={`flex items-center gap-2 text-sm ${muted}`}>
              מיון
              <select value={sortState.ships ? `${sortState.ships.key}:${sortState.ships.dir}` : ''} onChange={e=>{ const [k,d] = e.target.value.split(':'); setSort('ships', k||null, d); }}
                style={isDarkMode?{background:'#0f172a',color:'#f1f5f9'}:{}}
                className={`px-2 py-1.5 rounded-lg border text-sm ${isDarkMode?'border-slate-600':'border-slate-300 bg-white'}`}>
                <option value="">כמו בקובץ</option>
                <option value="arr:asc">הגעה — הקרוב קודם</option>
                <option value="arr:desc">הגעה — הרחוק קודם</option>
                <option value="delayDays:desc">הכי נדחו קודם</option>
                <option value="sup:asc">ספק (א–ת)</option>
                <option value="stage:desc">שלב — מתקדם קודם</option>
                <option value="cont:asc">מספר מכולה</option>
              </select>
            </label>
          )}
          {fileMsg?.slot==='shipments' && <p className={`w-full text-xs font-semibold ${fileMsg.kind==='ok'?(isDarkMode?'text-emerald-300':'text-emerald-700'):(isDarkMode?'text-red-300':'text-red-700')}`}>{fileMsg.text}</p>}
        </div>
        {sortRows('ships', shipmentsEnriched, { stage: s => s.stage.idx, delayDays: s => s.delayDays || null }).map(s => {
          const orders = s.matched ? ordersEnriched.filter(o => o.supplier === s.matched) : [];
          return (
            <section key={s.id} className={`rounded-2xl border p-5 space-y-4 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'} ${s.stage.idx===2?'opacity-75':''}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className={`font-mono text-lg font-bold ${strong}`}>{s.cont || 'ללא מספר מכולה'}</span>
                <span className={`text-sm ${muted}`}>{s.sup}</span>
                <span className={`text-sm ${muted}`}>{[s.mode, s.qty?`${s.qty} ${s.pkg||''}`.trim():'', s.from&&s.to?`מ-${s.from} ל-${s.to}`:''].filter(Boolean).join(' · ')}</span>
                {s.delayDays>0 && <span className={`text-xs font-semibold px-2 py-0.5 rounded ${procChipCls('watch',isDarkMode)}`}>נדחה ב-{s.delayDays} ימים (היה {isoToDisplay(s.change.from)})</span>}
                {s.delayDays<0 && <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isDarkMode?'bg-emerald-500/15 text-emerald-300':'bg-emerald-50 text-emerald-700'}`}>הוקדם ב-{-s.delayDays} ימים</span>}
                <div className="flex-1"/>
                <div className="text-left">
                  <p className={`text-xs ${muted}`}>הגעה משוערת</p>
                  <p className={`text-lg font-bold ${strong}`}>{s.arr ? isoToDisplay(s.arr) : 'לא ידוע'}{s.daysToArrival!=null && s.daysToArrival>=0 && s.stage.idx<2 ? <span className={`text-xs font-normal mr-1 ${muted}`}>(עוד {s.daysToArrival} ימים)</span> : null}</p>
                </div>
              </div>
              <div className="flex items-center" aria-label={`שלב: ${s.stage.label}`}>
                {STAGES.map((l,i) => (
                  <React.Fragment key={l}>
                    {i>0 && <div className={`flex-1 h-0.5 ${i<=s.stage.idx?'bg-blue-600':(isDarkMode?'bg-slate-700':'bg-slate-200')}`}/>}
                    <div className="flex flex-col items-center gap-1 px-2">
                      <span className={`w-3.5 h-3.5 rounded-full ${i<s.stage.idx?'bg-blue-600':i===s.stage.idx?'bg-blue-600 ring-4 ring-blue-500/25':(isDarkMode?'bg-slate-600':'bg-slate-300')}`}/>
                      <span className={`text-xs whitespace-nowrap ${i===s.stage.idx?`font-bold ${strong}`:muted}`}>{i===s.stage.idx?s.stage.label:l}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 text-sm`}>
                <div><p className={`text-xs ${muted}`}>הפלגה</p><p className={strong}>{s.dep?isoToDisplay(s.dep):'—'}</p></div>
                <div><p className={`text-xs ${muted}`}>אירוע אחרון אצל המשלח</p><p className={strong}>{s.event||'—'}</p></div>
                <div><p className={`text-xs ${muted}`}>אסמכתא</p><p className={strong}>{s.ref||'—'}{s.file?` · תיק ${s.file}`:''}</p></div>
                <div>
                  <label htmlFor={`shipsup-${s.id}`} className={`text-xs ${muted}`}>ספק ב-Priority</label>
                  <select id={`shipsup-${s.id}`} value={s.manual ? (shipSupOverride[s.sup]||'') : '__auto'} onChange={e=>setShipSupplier(s.sup, e.target.value)}
                    style={isDarkMode?{background:'#0f172a',color:'#f1f5f9'}:{}}
                    className={`block w-full mt-0.5 px-2 py-1.5 rounded-lg border text-sm ${isDarkMode?'border-slate-600':'border-slate-300 bg-white'}`}>
                    <option value="__auto">{matchShipSupplier(s.sup, knownSuppliers) ? `אוטומטי: ${matchShipSupplier(s.sup, knownSuppliers)}` : 'אוטומטי: לא זוהה'}</option>
                    <option value="">לא משויך</option>
                    {knownSuppliers.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <p className={`text-xs font-semibold mb-1.5 ${muted}`}>{s.matched ? `פתוח בהזמנות מ"${s.matched}" (${orders.length} שורות)` : 'שייך ספק כדי לראות מה כנראה במשלוח'}</p>
                {orders.length>0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {orders.slice(0,24).map(o => (
                      <span key={o.id} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${isDarkMode?'bg-slate-900/60 text-slate-200':'bg-slate-50 text-slate-700'}`}>
                        <span className={`font-mono ${muted}`}>{o.productKey!==o.productName?o.productKey:''}</span>{o.productName}<b>{o.orderedQty.toLocaleString()}</b>{o.poNumber && <span className={muted}>{o.poNumber}</span>}
                      </span>
                    ))}
                    {orders.length>24 && <span className={`text-xs ${muted}`}>ועוד {orders.length-24}</span>}
                  </div>
                )}
              </div>
            </section>
          );
        })}
        {!shipmentsEnriched.length && meta && <p className={`text-center py-10 text-sm ${muted}`}>אין משלוחים בקובץ</p>}
      </div>
    );
  };

  if (!salesData.length) return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className={`p-5 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
        <h3 className={`text-lg font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>כדי להתחיל, טען את הקבצים</h3>
        <p className={`text-sm mt-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>הכי חשוב: שורות חשבוניות מכירה (מה נמכר), יתרות מלאי וכרטיס פריט. השאר מוסיפים פרטים.</p>
      </div>
      {renderFilesPanel()}
    </div>
  );

  return (
    <>
    {/* AI Insight Modal */}
    {aiInsightOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div className={`rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden ${isDarkMode?'bg-slate-800 border border-slate-700':'bg-white'}`}>
          <div className={`p-5 border-b flex justify-between items-center ${isDarkMode?'border-slate-700 bg-slate-900/50':'border-slate-100 bg-gradient-to-l from-blue-50 to-white'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${isDarkMode?'bg-blue-500/20':'bg-blue-100'}`}><Sparkles className="w-5 h-5 text-blue-500"/></div>
              <h2 className={`text-lg font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>תובנות רכש AI</h2>
            </div>
            <button onClick={()=>setAiInsightOpen(false)} className={`p-2 rounded-full ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-100'}`}><X className={`w-5 h-5 ${isDarkMode?'text-slate-400':'text-slate-500'}`}/></button>
          </div>
          <div className="p-6 overflow-y-auto flex-1 text-right" dir="rtl">
            {aiInsightLoading ? (
              <div className="flex flex-col items-center py-12 gap-4">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin"/>
                <p className={`font-medium animate-pulse ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מנתח מלאי ורכש...</p>
              </div>
            ) : <p className={`whitespace-pre-wrap leading-relaxed text-sm ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{aiInsightText}</p>}
          </div>
          <div className={`p-4 border-t flex justify-end ${isDarkMode?'border-slate-700 bg-slate-900/30':'border-slate-100 bg-slate-50'}`}>
            <button onClick={()=>setAiInsightOpen(false)} className={`px-6 py-2 rounded-xl text-sm font-medium border ${isDarkMode?'border-slate-600 text-slate-300 hover:bg-slate-700':'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>סגור</button>
          </div>
        </div>
      </div>
    )}
    {renderProductDrawer()}
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Import banner */}
      {showBanner && importStats && (
        <div className={`flex flex-wrap items-center gap-3 px-5 py-3.5 rounded-2xl border animate-in fade-in slide-in-from-top-2 duration-300 ${isDarkMode?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          <Check className="w-5 h-5 shrink-0"/>
          <span className="font-medium text-sm">יובאו {importStats.total} פריטים מ-{invFileName}</span>
          <div className="flex gap-3 text-xs mr-auto">
            {importStats.withQty > 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-emerald-500/10':'bg-emerald-100'}`}>✓ {importStats.withQty} עם כמות מלאי</span>}
            {importStats.withCost > 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-blue-500/10':'bg-blue-100 text-blue-800'}`}>✓ {importStats.withCost} עם מחיר קניה</span>}
            {importStats.withMinStock > 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-orange-500/10':'bg-orange-100 text-orange-800'}`}>✓ {importStats.withMinStock} עם מינימום מלאי</span>}
            {importStats.withQty === 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-orange-500/10':'bg-orange-100 text-orange-800'}`}>⚠ אין עמודת כמות — הזן מלאי ידנית או ייצא "יתרות מלאי" מ-Priority</span>}
          </div>
          <button onClick={()=>setShowBanner(false)}><X className="w-4 h-4 opacity-50 hover:opacity-100"/></button>
        </div>
      )}

      {/* ── What needs action — four cards that also filter the table ── */}
      {(() => {
        const cardCls = (active) => `text-right flex flex-col gap-1.5 p-4 rounded-2xl border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active
          ? (isDarkMode?'bg-slate-800 border-slate-300 ring-1 ring-slate-300':'bg-white border-slate-900 ring-1 ring-slate-900')
          : (isDarkMode?'bg-slate-800 border-slate-700 hover:border-slate-500':'bg-white border-slate-200 hover:border-slate-400')}`;
        const lbl = `text-sm font-semibold flex items-center gap-2 ${isDarkMode?'text-slate-300':'text-slate-600'}`;
        const big = `text-3xl font-bold tabular-nums ${isDarkMode?'text-white':'text-slate-900'}`;
        const sub = `text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`;
        const small = `text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`;
        const isProducts = viewMode==='products';
        const pick = (key) => {
          if (key==='dead') { setActionFilter('all'); setViewMode('dead'); return; }
          setViewMode('products');
          setActionFilter(prev => (key==='all' || (prev===key && isProducts)) ? 'all' : key);
        };
        return (
          <section aria-label="מה דורש פעולה" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button type="button" onClick={()=>pick('order')} aria-pressed={isProducts&&actionFilter==='order'} className={cardCls(isProducts&&actionFilter==='order')}>
              <span className={lbl}><span className="w-2 h-2 rounded-full" style={{background:procDotColor.now}}/>להזמין</span>
              <span className="flex items-baseline gap-2"><span className={big}>{actionKpis.orderCount}</span><span className={sub}>מוצרים{actionKpis.orderCost>0?` · ${formatShort(actionKpis.orderCost)}`:''}</span></span>
              <span className={small}>{stockedCount>0 ? `${actionKpis.urgentCount} דחופים — המלאי ייגמר לפני שהזמנה תגיע` : 'העלה קובץ מלאי כדי לחשב'}</span>
            </button>
            <button type="button" onClick={()=>pick('late')} aria-pressed={isProducts&&actionFilter==='late'} className={cardCls(isProducts&&actionFilter==='late')}>
              <span className={lbl}><span className="w-2 h-2 rounded-full" style={{background:procDotColor.soon}}/>הזמנות באיחור</span>
              <span className="flex items-baseline gap-2"><span className={big}>{overdueOrders.length}</span><span className={sub}>הזמנות{actionKpis.lateValue>0?` · ${formatShort(actionKpis.lateValue)}`:''}</span></span>
              <span className={small}>{overdueOrders.length>0 ? 'תאריך האספקה עבר — כדאי להתקשר לספק' : 'אין הזמנות שעבר מועד האספקה שלהן'}</span>
            </button>
            <button type="button" onClick={()=>pick('dead')} aria-pressed={viewMode==='dead'} className={cardCls(viewMode==='dead')}>
              <span className={lbl}><span className="w-2 h-2 rounded-full" style={{background:procDotColor.unknown}}/>מלאי תקוע</span>
              <span className="flex items-baseline gap-2"><span className={big}>{formatShort(deadStockValue)}</span><span className={sub}>{deadStockData.length} פריטים</span></span>
              <span className={small}>לא נמכרו {deadStockDays} יום ומעלה</span>
            </button>
            <button type="button" onClick={()=>pick('all')} className={cardCls(false)}>
              <span className={lbl}><span className="w-2 h-2 rounded-full" style={{background:'#1F5FBF'}}/>ימי מלאי</span>
              <span className="flex items-baseline gap-2"><span className={big}>{actionKpis.daysOfInventory ?? '—'}</span><span className={sub}>ימים{actionKpis.stockValue>0?` · שווי ${formatShort(actionKpis.stockValue)}`:''}</span></span>
              <span className={small}>לחיצה מציגה את כל המוצרים</span>
            </button>
          </section>
        );
      })()}

      {/* ── Planning settings: one summary line; uploads & parameters open on demand ── */}
      <section aria-label="הגדרות תכנון" className={`rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
          <button type="button" onClick={()=>setSettingsOpen(v=>!v)} aria-expanded={settingsOpen}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-semibold ${isDarkMode?'border-slate-600 text-slate-200 hover:bg-slate-700':'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            <SlidersHorizontal className="w-4 h-4"/> קבצים והגדרות תכנון
            <ChevronDown className={`w-4 h-4 transition-transform ${settingsOpen?'rotate-180':''}`}/>
          </button>
          <span><b className={isDarkMode?'text-slate-200':'text-slate-800'}>מלאי יעד</b> {monthsToStock} ח׳</span>
          <span className="opacity-40">|</span>
          <span><b className={isDarkMode?'text-slate-200':'text-slate-800'}>זמן אספקה</b> {leadTime} ח׳{Object.keys(leadTimeMap).length>0?` · ${Object.keys(leadTimeMap).length} ספקים עם זמן משלהם`:''}</span>
          <span className="opacity-40">|</span>
          <span><b className={isDarkMode?'text-slate-200':'text-slate-800'}>בסיס ממוצע</b> {avgWindowMonths===0?'כל הנתונים':`${avgWindowMonths} ח׳`}</span>
          <span className="opacity-40">|</span>
          <span><b className={isDarkMode?'text-slate-200':'text-slate-800'}>קבצים</b> {filesSummary.loaded}/{filesSummary.total} טעונים</span>
          <div className="flex-1"/>
          {filesSummary.stale.length>0 && (
            <button type="button" onClick={()=>setSettingsOpen(true)} title={filesSummary.stale.join(', ')} className={`text-xs font-semibold px-2 py-1 rounded ${procChipCls('watch', isDarkMode)}`}>{filesSummary.stale.length===1?`"${filesSummary.stale[0]}" לא עודכן`:`${filesSummary.stale.length} קבצים לא עודכנו`}</button>
          )}
          {!invSlots.product && !invSlots.masterCard && stockedCount===0 && (
            <button type="button" onClick={()=>setSettingsOpen(true)} className={`text-xs font-semibold px-2 py-1 rounded ${procChipCls('watch', isDarkMode)}`}>לא נטען קובץ מלאי</button>
          )}
          {completeness.total>0 && completeness.withStock>0 && completeness.withStock<completeness.total && (
            <button type="button" onClick={()=>setSettingsOpen(true)} className={`text-xs font-semibold px-2 py-1 rounded ${procChipCls('watch', isDarkMode)}`}>{completeness.total-completeness.withStock} מוצרים בלי מלאי</button>
          )}
          {completeness.total>0 && completeness.withCost<completeness.total && (
            <button type="button" onClick={()=>setSettingsOpen(true)} className={`text-xs font-semibold px-2 py-1 rounded ${procChipCls('watch', isDarkMode)}`}>{completeness.total-completeness.withCost} מוצרים בלי מחיר קניה</button>
          )}
        </div>
        {settingsOpen && (
          <div className={`border-t p-4 space-y-4 ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
      {renderFilesPanel()}
      {/* Planning parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Planning config */}
        <div className={`p-5 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <h3 className={`font-bold text-sm mb-4 flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><SlidersHorizontal className="w-4 h-4 text-blue-500"/> פרמטרי תכנון</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>מלאי יעד (חודשים)</span>
                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-lg ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}>{monthsToStock}</span>
              </div>
              <input type="range" min={1} max={6} step={1} value={monthsToStock} onChange={e=>setMonthsToStock(+e.target.value)} className="w-full accent-blue-500"/>
              <div className="flex justify-between mt-0.5">{[1,2,3,4,5,6].map(n=><span key={n} className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-300'}`}>{n}</span>)}</div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>זמן אספקה כללי (חודשים)</span>
                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-lg ${isDarkMode?'bg-emerald-500/20 text-emerald-300':'bg-emerald-50 text-emerald-700'}`}>{leadTime}</span>
              </div>
              <input type="range" min={0} max={4} step={1} value={leadTime} onChange={e=>setLeadTime(+e.target.value)} className="w-full accent-emerald-500"/>
              <div className="flex justify-between mt-0.5">{[0,1,2,3,4].map(n=><span key={n} className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-300'}`}>{n}</span>)}</div>
              <p className={`text-[10px] mt-1.5 ${isDarkMode?'text-slate-600':'text-slate-400'}`}>
                זה הערך שחל כברירת מחדל. ניתן להגדיר זמן אספקה שונה לכל ספק בלשונית "לפי ספק" — הוא יקבל עדיפות על הערך הזה.
              </p>
            </div>
            {/* Average window */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>בסיס ממוצע</span>
                <span className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                  {avgWindowMonths===0?'כל הנתונים':avgWindowMonths+' חודשים אחרונים'}
                </span>
              </div>
              <div className={`flex rounded-xl p-1 ${isDarkMode?'bg-slate-900':'bg-slate-100'}`}>
                {[[6,'6 ח׳'],[12,'12 ח׳'],[18,'18 ח׳'],[24,'24 ח׳'],[0,'הכל']].map(([v,label])=>(
                  <button key={v} onClick={()=>setAvgWindowMonths(v)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${avgWindowMonths===v
                      ?(isDarkMode?'bg-blue-600 text-white shadow-md':'bg-blue-600 text-white shadow-md')
                      :(isDarkMode?'text-slate-400 hover:text-slate-200':'text-slate-500 hover:text-slate-700')}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className={`text-[10px] mt-1.5 ${isDarkMode?'text-slate-600':'text-slate-400'}`}>
                {avgWindowMonths===0?'ממוצע על כל היסטוריית המכירות':'ממוצע על '+avgWindowMonths+' החודשים האחרונים בלבד'}
              </p>
            </div>
            <div className={`text-xs px-3 py-2.5 rounded-xl border ${isDarkMode?'bg-slate-700/50 border-slate-600 text-slate-300':'bg-slate-50 border-slate-200 text-slate-600'}`}>
              <span className="font-bold">נוסחה: </span>להזמין = ביקוש צפוי ל(זמן אספקה + חודשי מלאי) + מלאי בטחון − (מלאי קיים + בדרך), מעוגל ל-MOQ
              <p className={`mt-1 text-[10px] ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                ביקוש צפוי = ממוצע חודשי × מקדם העונתיות של כל חודש קרוב (כשיש 2+ שנות נתונים) · מלאי בטחון = הגבוה מבין החישוב הסטטיסטי (98% ל-A, 95% ל-B, 90% ל-C) לבין מינימום המלאי מ-Priority · זמן אספקה לפי ספק
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Free period comparison toggle */}
      <button onClick={()=>setShowProcCompare(p=>!p)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors ${showProcCompare?(isDarkMode?'bg-blue-500/20 border-blue-500/30 text-blue-300':'bg-blue-50 border-blue-200 text-blue-700'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white bg-slate-800':'border-slate-200 text-slate-500 hover:text-slate-700 bg-white')}`}>
        <Sliders className="w-3.5 h-3.5"/> השוואת תקופות לביקוש
      </button>

      {showProcCompare && procCompareStats && (
        <div className={`p-6 rounded-2xl border animate-in fade-in duration-300 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <h3 className={`font-bold flex items-center gap-2 mb-4 ${isDarkMode?'text-white':'text-slate-800'}`}><Sliders className="w-5 h-5 text-blue-500"/>השוואת תקופות — האם הביקוש השתנה?</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {[['א',procPeriodA,setProcPeriodA],['ב',procPeriodB,setProcPeriodB]].map(([label,period,setPeriod])=>(
              <div key={label} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${isDarkMode?'bg-slate-900 border-slate-700':'bg-slate-50 border-slate-200'}`}>
                <span className={`text-xs font-bold shrink-0 px-2 py-1 rounded-lg ${label==='א'?(isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-100 text-blue-700'):(isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-200 text-slate-600')}`}>תקופה {label}</span>
                <select value={period.start} onChange={e=>setPeriod(p=>({...p,start:e.target.value}))} style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}} className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded flex-1 ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                  {procAvailableMonths.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                <span className={isDarkMode?'text-slate-600':'text-slate-300'}>—</span>
                <select value={period.end} onChange={e=>setPeriod(p=>({...p,end:e.target.value}))} style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}} className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded flex-1 ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                  {procAvailableMonths.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {[['א',procCompareStats.a],['ב',procCompareStats.b]].map(([label,data])=>(
              <div key={label} className={`p-4 rounded-xl border ${isDarkMode?'bg-slate-900/50 border-slate-700':'bg-slate-50 border-slate-200'}`}>
                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${label==='א'?(isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-100 text-blue-700'):(isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-200 text-slate-600')}`}>תקופה {label}</span>
                <div className="flex items-center justify-between mt-3">
                  <div>
                    <p className={`text-xs mb-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>כמות שנמכרה</p>
                    <span className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{data.qty.toLocaleString()}</span>
                  </div>
                  <div className="text-left">
                    <p className={`text-xs mb-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>הכנסה</p>
                    <span className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{formatShort(data.revenue)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl mb-5 text-sm font-bold ${procCompareStats.qtyDelta>=0?(isDarkMode?'bg-emerald-500/10 text-emerald-300':'bg-emerald-50 text-emerald-700'):(isDarkMode?'bg-red-500/10 text-red-300':'bg-red-50 text-red-700')}`}>
            {procCompareStats.qtyDelta>=0?<ArrowUpRight className="w-4 h-4"/>:<ArrowDownRight className="w-4 h-4"/>}
            הביקוש (כמות) {procCompareStats.qtyDelta>=0?'עלה':'ירד'} ב-{Math.abs(procCompareStats.qtyDelta).toFixed(0)}% בתקופה א' לעומת ב'
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[['א',procCompareStats.a],['ב',procCompareStats.b]].map(([label,data])=>(
              <div key={label}>
                <p className={`text-xs font-bold mb-2 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מוצרים מובילים בכמות — תקופה {label}</p>
                {data.top.length===0 ? <p className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-400'}`}>אין נתונים</p> : (
                  <div className="space-y-1.5">
                    {data.top.map((t,i) => (
                      <div key={i} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                        <span className={`truncate ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{t.name}</span>
                        <span className={`font-bold shrink-0 ${isDarkMode?'text-blue-400':'text-blue-600'}`}>{t.qty.toLocaleString()} יח'</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Completeness Panel */}
      {products.length > 0 && (
        <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <div className={`px-5 py-3 border-b flex items-center justify-between ${isDarkMode?'border-slate-700 bg-slate-900/40':'border-slate-100 bg-slate-50'}`}>
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 ${isDarkMode?'text-slate-400':'text-slate-500'}`}/>
              <span className={`text-sm font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>שלמות נתונים</span>
              <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>— {completeness.total} פריטים סה"כ</span>
            </div>
            {completeness.noData > 0 && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${isDarkMode?'bg-orange-500/15 text-orange-400':'bg-orange-50 text-orange-700'}`}>
                ⚠ {completeness.noData} פריטים ללא נתונים
              </span>
            )}
          </div>
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label:'מלאי נוכחי', count:completeness.withStock, total:completeness.total, pct:completeness.stockPct, tip:'הזן מלאי בטבלה או יבא מ-Priority', color:'blue' },
              { label:'מחיר קניה',  count:completeness.withCost,  total:completeness.total, pct:completeness.costPct,  tip:'הזן דרך קובץ LOGPART-2 מ-Priority', color:'emerald' },
              { label:'הכיסוי מלא', count:completeness.withAll,   total:completeness.total, pct:completeness.allPct,   tip:'מלאי + מחיר — נדרש לחישוב מלא', color:'violet' },
            ].map(({ label, count, total, pct, tip, color }) => (
              <div key={label} title={tip} className="space-y-1.5 cursor-help">
                <div className="flex justify-between items-center">
                  <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{label}</span>
                  <span className={`text-xs font-bold ${
                    pct >= 80 ? (isDarkMode?'text-emerald-400':'text-emerald-600') :
                    pct >= 50 ? (isDarkMode?'text-orange-400':'text-orange-600') :
                                (isDarkMode?'text-red-400':'text-red-600')}`}>
                    {count}/{total} ({pct}%)
                  </span>
                </div>
                <div className={`h-2 rounded-full overflow-hidden ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: pct+'%',
                      background: pct >= 80
                        ? '#2E8B57'
                        : pct >= 50 ? '#D9822B' : '#C8322B'
                    }}/>
                </div>
                {pct < 100 && <p className={`text-[10px] ${isDarkMode?'text-slate-600':'text-slate-400'}`}>{tip}</p>}
              </div>
            ))}
          </div>
          {completeness.withOrders > 0 && (
            <div className={`px-5 py-2.5 border-t text-xs flex items-center gap-2 ${isDarkMode?'border-slate-700 bg-blue-500/5 text-blue-400':'border-slate-100 bg-blue-50 text-blue-700'}`}>
              <Package className="w-3.5 h-3.5 shrink-0"/>
              {completeness.withOrders} מוצרים עם הזמנות פתוחות בדרך — מחושבות אוטומטית בכיסוי
            </div>
          )}
        </div>
      )}

          </div>
        )}
      </section>

      {/* ABC-XYZ Legend */}
      {showLegend && (
        <div className={`rounded-2xl border p-5 animate-in fade-in slide-in-from-top-2 duration-300 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
          <h3 className={`font-bold text-sm mb-4 flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
            <Info className="w-4 h-4 text-blue-500"/> מקרא ניתוח ABC-XYZ
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ABC explanation */}
            <div>
              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>ABC — לפי ערך כספי</p>
              <div className="space-y-2">
                {[
                  {cls:'A', xyz:'', color:'amber', text:'~80% מסה"כ ההכנסה — פריטי ליבה. רכש קפדני, מלאי גבוה, בקרה שוטפת'},
                  {cls:'B', xyz:'', color:'blue',  text:'~15% מסה"כ — חשוב אבל לא קריטי. רכש סדיר, מלאי סביר'},
                  {cls:'C', xyz:'', color:'gray',  text:'~5% בלבד — שקול הפחתת סוגים, הזמנה לפי דרישה בלבד'},
                ].map(r=>(
                  <div key={r.cls} className="flex items-start gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold border shrink-0 mt-0.5 ${r.cls==='A'?(isDarkMode?'bg-orange-500/20 text-orange-300 border-orange-500/30':'bg-orange-50 text-orange-700 border-orange-200'):r.cls==='B'?(isDarkMode?'bg-blue-500/20 text-blue-300 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-200'):(isDarkMode?'bg-slate-600/40 text-slate-400 border-slate-600':'bg-slate-100 text-slate-500 border-slate-200')}`}>{r.cls}</span>
                    <p className={`text-xs ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* XYZ explanation */}
            <div>
              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>XYZ — לפי יציבות ביקוש</p>
              <div className="space-y-2">
                {[
                  {xyz:'X', color:'emerald', cv:'CV ≤ 0.5', text:'ביקוש קבוע וצפוי — ניתן להזמין אוטומטית'},
                  {xyz:'Y', color:'amber',   cv:'CV 0.5–1.0', text:'ביקוש משתנה — דרוש מלאי בטחון גבוה יותר'},
                  {xyz:'Z', color:'red',     cv:'CV > 1.0', text:'ביקוש אי-סדיר — הזמנה לפי דרישה, סיכון גבוה'},
                ].map(r=>(
                  <div key={r.xyz} className="flex items-start gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold border shrink-0 mt-0.5 ${r.xyz==='X'?(isDarkMode?'bg-emerald-500/20 text-emerald-300 border-emerald-500/30':'bg-emerald-50 text-emerald-700 border-emerald-200'):r.xyz==='Y'?(isDarkMode?'bg-orange-500/20 text-orange-300 border-orange-500/30':'bg-orange-50 text-orange-700 border-orange-200'):(isDarkMode?'bg-red-500/20 text-red-300 border-red-500/30':'bg-red-50 text-red-700 border-red-200')}`}>{r.xyz}</span>
                    <div>
                      <span className={`text-[10px] font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{r.cv} · </span>
                      <span className={`text-xs ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{r.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Combined matrix */}
          <div className={`mt-4 pt-4 border-t ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
            <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>השילובים הקריטיים</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                {combo:'AX', bg:isDarkMode?'bg-emerald-900/30 border-emerald-700':'bg-emerald-50 border-emerald-200', text:isDarkMode?'text-emerald-300':'text-emerald-800', desc:'אידאלי — רכש אוטומטי בכמות קבועה'},
                {combo:'AZ', bg:isDarkMode?'bg-red-900/30 border-red-700':'bg-red-50 border-red-200', text:isDarkMode?'text-red-300':'text-red-800', desc:'דחוף — ערך גבוה + ביקוש לא צפוי = סיכון גדול'},
                {combo:'CZ', bg:isDarkMode?'bg-slate-700/50 border-slate-600':'bg-slate-100 border-slate-200', text:isDarkMode?'text-slate-400':'text-slate-600', desc:'שקול ביטול — ערך נמוך + ביקוש כאוטי'},
              ].map(r=>(
                <div key={r.combo} className={`p-3 rounded-xl border ${r.bg}`}>
                  <span className={`font-bold text-sm ${r.text}`}>{r.combo}</span>
                  <p className={`text-xs mt-1 ${r.text}`}>{r.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* View tabs — grouped by purpose: decide · follow up · analyze */}
      <div className="flex items-center gap-3 flex-wrap">
        <div role="tablist" aria-label="תצוגות רכש" className={`flex flex-wrap items-center gap-1 rounded-xl p-1 border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
          {(() => {
            const lateCount = overdueOrders.length;
            const priceUp = priceChanges.filter(p=>p.priceChangePct>0).length + poPriceDeviations.filter(o=>o.poPriceDiffPct>0).length;
            const urgentSched = scheduleData.filter(p=>p.urgency==='critical'||p.urgency==='urgent').length;
            const activeShipCount = shipmentsEnriched.filter(x=>x.stage.idx<2).length;
            const shipDelayedCount = shipmentsEnriched.filter(x=>x.stage.idx<2 && x.delayDays>0).length;
            const groups = [
              ['החלטות', [['suppliers','ספקים',null], ['products','כל המוצרים',null], ['schedule','לוח זמנים', urgentSched>0?{n:urgentSched,k:'now'}:null]]],
              ['מעקב', [['shipments','משלוחים בדרך', shipDelayedCount>0?{n:`${shipDelayedCount} נדחו`,k:'watch'}:(activeShipCount?{n:activeShipCount,k:'muted'}:null)], ['orders','הזמנות פתוחות', lateCount>0?{n:`${lateCount} באיחור`,k:'now'}:(openOrders.length?{n:openOrders.length,k:'muted'}:null)], ['prices','מחירי רכש', priceUp>0?{n:`${priceUp} עליות`,k:'watch'}:null]]],
              ['ניתוח', [['whatif','תרחיש',null], ['dead','מלאי תקוע', deadStockData.length?{n:deadStockData.length,k:'muted'}:null]]],
            ];
            return groups.map(([gLabel, tabs], gi) => (
              <React.Fragment key={gLabel}>
                {gi>0 && <span aria-hidden="true" className={`w-px h-6 mx-1 ${isDarkMode?'bg-slate-700':'bg-slate-200'}`}/>}
                <span className={`text-xs px-1.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{gLabel}</span>
                {tabs.map(([mode,label,badge]) => (
                  <button key={mode} type="button" role="tab" aria-selected={viewMode===mode}
                    onClick={() => { setViewMode(mode); if (mode!=='products') setActionFilter('all'); if (mode==='suppliers' && viewMode==='suppliers') setVendor(null); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${viewMode===mode
                      ? (isDarkMode?'bg-slate-200 text-slate-900':'bg-slate-900 text-white')
                      : (isDarkMode?'text-slate-300 hover:bg-slate-700':'text-slate-600 hover:bg-slate-100')}`}>
                    {label}
                    {badge && <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${viewMode===mode?'bg-white/20 text-inherit':procChipCls(badge.k, isDarkMode)}`}>{badge.n}</span>}
                  </button>
                ))}
              </React.Fragment>
            ));
          })()}
        </div>
        <div className="flex-1"/>
        <button type="button" onClick={generateProcurementInsight}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${isDarkMode?'border-slate-600 text-slate-200 hover:bg-slate-700':'border-slate-300 text-slate-700 bg-white hover:bg-slate-50'}`}>
          <Sparkles className="w-4 h-4"/> תובנות רכש AI
        </button>
      </div>

      {/* Suppliers: list → supplier page */}
      {viewMode==='suppliers' && renderVendors()}

      {/* Shipments from the forwarder's daily file */}
      {viewMode==='shipments' && renderShipments()}

      {/* Product table — shown only in products mode */}
      {/* ══ OPEN ORDERS VIEW ══ */}
      {viewMode==='orders' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">

          {/* Header + Add button */}
          <div className={`p-5 rounded-2xl border flex items-center justify-between gap-3 flex-wrap ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${isDarkMode?'bg-blue-500/15':'bg-blue-50'}`}><ShoppingCart className="w-5 h-5 text-blue-500"/></div>
              <div>
                <p className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>הזמנות רכש פתוחות</p>
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מה שהוזמן ועוד לא הגיע — מחושב אוטומטית בהמלצות הרכש</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Import from Priority — shows filename when present, with replace/remove */}
              {ordersFileName ? (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isDarkMode?'border-emerald-700 bg-emerald-900/20':'border-emerald-200 bg-emerald-50'}`}>
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0"/>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium truncate max-w-[200px] ${isDarkMode?'text-emerald-300':'text-emerald-700'}`}>{ordersFileName}</p>
                    <p className={`text-[10px] ${isDarkMode?'text-emerald-500/70':'text-emerald-600/70'}`}>{openOrders.filter(o=>o.fromPriority).length} הזמנות מ-Priority</p>
                  </div>
                  <label className={`p-1.5 rounded-lg cursor-pointer transition-colors shrink-0 ${isDarkMode?'text-slate-400 hover:bg-slate-700':'text-slate-500 hover:bg-slate-100'}`} title="החלף קובץ">
                    {ordersLoading?<Loader2 className="w-4 h-4 animate-spin"/>:<RefreshCw className="w-4 h-4"/>}
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handlePriorityOrdersUpload} className="hidden" disabled={ordersLoading}/>
                  </label>
                  <button onClick={clearPriorityOrders} title="הסר הזמנות שיובאו מ-Priority (הזמנות שהוספו ידנית יישארו)" className={`p-1.5 rounded-lg shrink-0 ${isDarkMode?'text-red-400 hover:bg-red-500/10':'text-red-500 hover:bg-red-50'}`}><Trash2 className="w-4 h-4"/></button>
                </div>
              ) : (
                <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${isDarkMode?'border-emerald-700 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40':'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                  {ordersLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                  ייבוא מ-Priority
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handlePriorityOrdersUpload} className="hidden" disabled={ordersLoading}/>
                </label>
              )}
              <button onClick={()=>{setShowAddOrder(true);setEditOrderId(null);setOrderForm({productKey:'',productName:'',supplier:'',orderedQty:'',orderDate:new Date().toISOString().slice(0,10),expectedDate:'',status:'ordered',poNumber:'',notes:''}); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/20">
                <Check className="w-4 h-4"/> + הוסף ידנית
              </button>
            </div>
          </div>

          {/* Upload error */}
          {ordersUploadError && (
            <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-xs font-medium ${isDarkMode?'bg-red-500/10 text-red-300 border border-red-500/20':'bg-red-50 text-red-700 border border-red-200'}`}>
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5"/>
              <span className="flex-1">{ordersUploadError}</span>
              <button onClick={()=>setOrdersUploadError(null)} className="shrink-0 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5"/></button>
            </div>
          )}

          {/* Priority import banner */}
          {importBanner && (
            <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl border animate-in fade-in duration-200 ${isDarkMode?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              <Check className="w-5 h-5 shrink-0"/>
              <div className="flex-1">
                <span className="font-medium text-sm">יובאו {importBanner.count} שורות הזמנה מ-Priority</span>
                {importBanner.skipped > 0 && <span className={`text-xs mr-2 ${isDarkMode?'text-emerald-500':'text-emerald-600'}`}>({importBanner.skipped} שורות דולגו — יתרה 0)</span>}
              </div>
              <span className={`text-xs ${isDarkMode?'text-emerald-500':'text-emerald-600'}`}>הזמנות קודמות מ-Priority הוחלפו</span>
              <button onClick={()=>setImportBanner(null)}><X className="w-4 h-4 opacity-50 hover:opacity-100"/></button>
            </div>
          )}

          {/* Add / Edit form */}
          {showAddOrder && (
            <div className={`p-5 rounded-2xl border-2 border-blue-500/30 animate-in fade-in duration-200 ${isDarkMode?'bg-slate-800':'bg-blue-50/30'}`}>
              <h3 className={`font-bold text-sm mb-4 ${isDarkMode?'text-white':'text-slate-800'}`}>{editOrderId ? 'עריכת הזמנה' : 'הזמנה חדשה'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {field:'productName', label:'שם מוצר *', placeholder:'בחר מוצר...', type:'datalist', options: [...new Set(salesData.map(d=>d.description).filter(Boolean))].sort()},
                  {field:'supplier', label:'ספק', placeholder:'שם ספק', type:'text'},
                  {field:'orderedQty', label:'כמות שהוזמנה *', placeholder:'0', type:'number'},
                  {field:'orderDate', label:'תאריך הזמנה', placeholder:'', type:'date'},
                  {field:'expectedDate', label:'תאריך אספקה צפוי', placeholder:'', type:'date'},
                  {field:'poNumber', label:'מספר הזמנה / PO', placeholder:'PO-001', type:'text'},
                ].map(f => (
                  <div key={f.field}>
                    <label className={`block text-xs font-medium mb-1 ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{f.label}</label>
                    {f.type==='datalist' ? (
                      <div className="relative">
                        <input list={`dl-${f.field}`} value={orderForm[f.field]} onChange={e=>setOrderForm(p=>({...p,[f.field]:e.target.value, productKey:e.target.value}))}
                          placeholder={f.placeholder}
                          style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#334155'}:{}}
                          className={`w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'border-slate-700 text-white placeholder-slate-500':'border-slate-200 bg-white'}`}/>
                        <datalist id={`dl-${f.field}`}>{f.options.map(o=><option key={o} value={o}/>)}</datalist>
                      </div>
                    ) : (
                      <input type={f.type} value={orderForm[f.field]} onChange={e=>setOrderForm(p=>({...p,[f.field]:e.target.value}))}
                        placeholder={f.placeholder}
                        style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#334155',colorScheme:'dark'}:{}}
                        className={`w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'border-slate-700 text-white placeholder-slate-500':'border-slate-200 bg-white'}`}/>
                    )}
                  </div>
                ))}
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDarkMode?'text-slate-300':'text-slate-600'}`}>סטטוס</label>
                  <select value={orderForm.status} onChange={e=>setOrderForm(p=>({...p,status:e.target.value}))}
                    style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#334155'}:{}}
                    className={`w-full px-3 py-2 rounded-xl border text-sm focus:outline-none ${isDarkMode?'border-slate-700':'border-slate-200 bg-white'}`}>
                    <option value="ordered">הוזמן</option>
                    <option value="in_transit">בדרך</option>
                    <option value="delayed">מאחר</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <label className={`block text-xs font-medium mb-1 ${isDarkMode?'text-slate-300':'text-slate-600'}`}>הערות</label>
                <input type="text" value={orderForm.notes} onChange={e=>setOrderForm(p=>({...p,notes:e.target.value}))} placeholder="הערות נוספות..."
                  style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#334155'}:{}}
                  className={`w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'border-slate-700 text-white placeholder-slate-500':'border-slate-200 bg-white'}`}/>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={()=>{setShowAddOrder(false);setEditOrderId(null);}} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${isDarkMode?'border-slate-600 text-slate-300 hover:bg-slate-700':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>ביטול</button>
                <button onClick={()=>{
                  if(editOrderId){
                    saveOrders(openOrders.map(o=>o.id===editOrderId?{...o,...orderForm,orderedQty:parseFloat(orderForm.orderedQty)||0,productKey:orderForm.productKey||orderForm.productName}:o));
                    setEditOrderId(null); setShowAddOrder(false);
                  } else { addOrder(); }
                }} disabled={!orderForm.productName||!orderForm.orderedQty}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition-colors shadow-md shadow-blue-500/20">
                  {editOrderId?'עדכן':'הוסף הזמנה'}
                </button>
              </div>
            </div>
          )}

          {/* Orders list */}
          {openOrders.length === 0 ? (
            <div className={`flex flex-col items-center py-16 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              <ShoppingCart className={`w-12 h-12 mb-3 ${isDarkMode?'text-slate-600':'text-slate-300'}`}/>
              <p className={`font-medium ${isDarkMode?'text-white':'text-slate-800'}`}>אין הזמנות פתוחות</p>
              <p className={`text-sm mt-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>לחץ "+ הוסף הזמנה" להוספת הזמנה שבדרך</p>
            </div>
          ) : (
            <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              {/* Summary bar */}
              <div className={`px-5 py-3 border-b flex flex-wrap items-center gap-4 ${isDarkMode?'border-slate-700 bg-slate-900/40':'border-slate-100 bg-slate-50'}`}>
                <span className={`text-xs font-medium ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{openOrders.length} הזמנות פתוחות</span>
                {overdueOrders.length>0 && (
                  <button onClick={()=>setShowOverdueOnly(v=>!v)}
                    title="הזמנות שתאריך האספקה הצפוי שלהן כבר עבר — לחץ להציג רק אותן"
                    className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg border transition-colors ${showOverdueOnly?'bg-red-600 text-white border-red-600':(isDarkMode?'bg-red-500/15 text-red-300 border-red-500/30':'bg-red-50 text-red-700 border-red-200')}`}>
                    {overdueOrders.length} באיחור{showOverdueOnly?' · מציג רק אותן':''}
                  </button>
                )}
                {[['ordered','הוזמן','#3b82f6'],['in_transit','בדרך','#10b981'],['delayed','מאחר','#ef4444']].map(([s,l,color])=>{
                  const n = openOrders.filter(o=>o.status===s).length;
                  return n>0 ? <span key={s} className="flex items-center gap-1 text-xs font-medium" style={{color}}><span className="w-2 h-2 rounded-full" style={{background:color}}/>{l}: {n}</span> : null;
                })}
                <div className="mr-auto flex items-center gap-4">
                  <span className={`text-xs font-bold ${isDarkMode?'text-blue-300':'text-blue-700'}`}>
                    {openOrders.reduce((a,o)=>a+(o.orderedQty||0),0).toLocaleString()} יח' בדרך
                  </span>
                  {ordersEnriched.some(o=>o.valueILS>0) && (
                    <span className={`text-xs font-bold ${isDarkMode?'text-emerald-400':'text-emerald-700'}`}>
                      {formatCurrency(ordersEnriched.reduce((a,o)=>a+(o.valueILS||0),0))} שווי
                    </span>
                  )}
                  {ordersBlockedCurrencies.length>0 && (
                    <span title={`הזמנות ב-${ordersBlockedCurrencies.join('/')} לא נכללות בסה"כ — הזן שער חליפין ב-⚙️ הגדרות, או קבע מטבע לספק בתצוגת "ספקים"`}
                      className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg ${isDarkMode?'bg-orange-500/15 text-orange-300':'bg-orange-50 text-orange-700'}`}>
                      <TriangleAlert className="w-3 h-3"/> חסר שער ל-{ordersBlockedCurrencies.join('/')}
                    </span>
                  )}
                </div>
              </div>
              {/* Cash flow forecast — expected payment load by month, from open orders */}
              <div className={`px-5 py-4 border-b ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <h4 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
                    <Wallet className="w-4 h-4 text-emerald-500"/>תחזית תזרים — הזמנות פתוחות לפי חודש
                  </h4>
                  <span className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                    סה"כ: <b className={isDarkMode?'text-emerald-400':'text-emerald-600'}>₪{cashFlowForecast.totalValue.toLocaleString()}</b>
                    {cashFlowForecast.noDateCount>0 && <span className="mr-2 opacity-70">· {cashFlowForecast.noDateCount} הזמנות ללא תאריך הזמנה או אספקה (₪{cashFlowForecast.noDateValue.toLocaleString()}, לא מופיעות בגרף)</span>}
                  </span>
                </div>
                {cashFlowForecast.data.length > 0 ? (
                  <>
                    <div style={{width:'100%', height:180}}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={cashFlowForecast.data} margin={{top:5,right:5,bottom:0,left:-15}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode?'#334155':'#e2e8f0'} vertical={false}/>
                          <XAxis dataKey="month" tick={{fontSize:10, fill:isDarkMode?'#94a3b8':'#64748b'}} axisLine={false} tickLine={false}/>
                          <YAxis tick={{fontSize:10, fill:isDarkMode?'#94a3b8':'#64748b'}} axisLine={false} tickLine={false} width={50} tickFormatter={v=>formatShort(v)}/>
                          <RechartsTooltip
                            content={({active, payload, label}) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0]?.payload; if (!row) return null;
                              return (
                                <div style={{background:isDarkMode?'#1e293b':'#fff', border:`1px solid ${isDarkMode?'#334155':'#e2e8f0'}`, borderRadius:8, fontSize:12, padding:'8px 10px', direction:'rtl'}}>
                                  <p style={{color:isDarkMode?'#e2e8f0':'#1e293b', fontWeight:'bold', marginBottom:4}}>{label}</p>
                                  {row.actual>0 && <p style={{color:isDarkMode?'#93c5fd':'#1d4ed8'}}>בתאריך ידוע: {formatCurrency(row.actual)}</p>}
                                  {row.estimated>0 && <p style={{color:isDarkMode?'#fcd34d':'#b45309'}}>מוערך (הזמנה+זמן אספקה): {formatCurrency(row.estimated)}</p>}
                                  <p style={{color:isDarkMode?'#cbd5e1':'#334155', marginTop:2}}>{row.count} הזמנות · סה"כ {formatCurrency(row.value)}</p>
                                  <p style={{color:isDarkMode?'#6ee7b7':'#059669', fontSize:11, marginTop:2}}>מצטבר: {formatCurrency(row.cumulative)}</p>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="actual" name="תאריך אספקה ידוע" stackId="cf" fill="#3b82f6" radius={[0,0,0,0]}/>
                          <Bar dataKey="estimated" name="מוערך (הזמנה + זמן אספקה)" stackId="cf" fill="#f59e0b" fillOpacity={0.6} radius={[4,4,0,0]}/>
                          <Line type="monotone" dataKey="cumulative" name="מצטבר" stroke="#10b981" strokeWidth={2} dot={{r:3}}/>
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className={`flex items-center gap-4 mt-1 text-[11px] ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:'#3b82f6'}}/>תאריך אספקה ידוע</span>
                      {cashFlowForecast.anyEstimated && <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:'#f59e0b', opacity:0.6}}/>מוערך מתאריך הזמנה + זמן אספקה</span>}
                    </div>
                  </>
                ) : (
                  <p className={`text-xs py-4 text-center ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
                    אין מספיק תאריכים (לא תאריך אספקה ולא תאריך הזמנה) כדי לבנות תחזית — מלא לפחות תאריך הזמנה בהזמנות הידניות, או ודא שהעמודה מזוהה בקובץ שמיובא מ-Priority.
                  </p>
                )}
                <p className={`text-[11px] mt-1.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
                  כשאין תאריך אספקה צפוי בפועל, המשבצת מוערכת מתאריך ההזמנה + זמן האספקה (ספציפי לספק אם הוגדר, אחרת הסליידר הגלובלי) · תחזית תכנונית, לא כולל תנאי תשלום/אשראי ספק
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full text-sm text-right min-w-[780px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                  <thead className={`text-[11px] font-semibold uppercase tracking-widest ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                    <tr>
                      {sortTh('orders','productName','מוצר',{className:'px-4 py-3 min-w-[160px]'})}
                      {sortTh('orders','productKey','מק"ט')}
                      {sortTh('orders','supplier','ספק')}
                      {sortTh('orders','poNumber','PO')}
                      {sortTh('orders','orderedQty','יתרה לאספקה',{firstDir:'desc'})}
                      {sortTh('orders','unitPriceOriginal',"מחיר יח'",{firstDir:'desc'})}
                      {sortTh('orders','valueILS','שווי ₪',{firstDir:'desc'})}
                      {sortTh('orders','orderDate','הוזמן')}
                      {sortTh('orders','expectedDate','אספקה צפויה')}
                      {sortTh('orders','status','סטטוס')}
                      <th className="px-4 py-3">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {sortRows('orders', sortedOpenOrders, { productKey: o => o.productKey!==o.productName ? o.productKey : null, status: o => ({ordered:'הוזמן',in_transit:'בדרך',delayed:'מאחר'}[o.status]||o.status) }).map(order => {
                      const statusStyle = {
                        ordered:    isDarkMode?'bg-blue-500/20 text-blue-300 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-200',
                        in_transit: isDarkMode?'bg-emerald-500/20 text-emerald-300 border-emerald-500/30':'bg-emerald-50 text-emerald-700 border-emerald-200',
                        delayed:    isDarkMode?'bg-red-500/20 text-red-300 border-red-500/30':'bg-red-50 text-red-700 border-red-200',
                      }[order.status] || '';
                      const statusLabel = {ordered:'הוזמן',in_transit:'בדרך',delayed:'מאחר'}[order.status]||order.status;
                      const isOverdue = order.isOverdue;
                      return (
                        <tr key={order.id} className={`transition-all ${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'} ${isOverdue?(isDarkMode?'bg-red-900/10':'bg-red-50/40'):''}`}>
                          <td className="px-4 py-3.5">
                            <p className={`font-medium text-sm ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{order.productName}</p>
                            {order.notes && <p className={`text-xs mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{order.notes}</p>}
                          </td>
                          <td className={`px-4 py-3.5 text-xs font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{order.productKey!==order.productName?order.productKey:'—'}</td>
                          <td className={`px-4 py-3.5 text-sm ${isDarkMode?'text-slate-300':'text-slate-600'}`}>{order.supplier||'—'}</td>
                          <td className={`px-4 py-3.5 text-xs font-mono font-bold ${isDarkMode?'text-blue-400':'text-blue-700'}`}>{order.poNumber||'—'}</td>
                          <td className="px-4 py-3.5">
                            <span className={`font-bold text-sm tabular-nums ${isDarkMode?'text-blue-300':'text-blue-700'}`}>{order.orderedQty.toLocaleString()}</span>
                            <span className={`text-xs mr-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>יח'</span>
                          </td>
                          <td className={`px-4 py-3.5 text-xs tabular-nums ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                            {order.unitPriceOriginal!=null ? formatUnitCost(order.unitPriceOriginal, order.currency) : '—'}
                            {order.poPriceDiffPct!=null && Math.abs(order.poPriceDiffPct)>=3 && (
                              <div title={`מחיר בכרטיס הפריט: ${formatUnitCost(order.catalogCost, order.currency)}`}
                                className={`text-[10px] font-bold ${order.poPriceDiffPct>0?'text-red-500':'text-emerald-500'}`}>
                                {order.poPriceDiffPct>0?'↑':'↓'}{Math.abs(order.poPriceDiffPct).toFixed(0)}% מהקטלוג
                              </div>
                            )}
                          </td>
                          <td className={`px-4 py-3.5 text-sm tabular-nums ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>
                            {order.valueILS!=null ? (
                              <span title={order.costConverted?`הומר מ-${order.currency} לפי השער שהוגדר בהגדרות`:undefined}>
                                {formatCurrency(order.valueILS)}{order.costConverted && <span className="text-[10px] font-normal opacity-60 mr-1">≈{currencySymbol(order.costConverted)}</span>}
                              </span>
                            ) : order.costCurrencyBlocked ? (
                              <span title="חסר שער חליפין בהגדרות" className={isDarkMode?'text-orange-400':'text-orange-600'}>⚠ {order.costCurrencyBlocked}</span>
                            ) : '—'}
                          </td>
                          <td className={`px-4 py-3.5 text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{order.orderDate||'—'}</td>
                          <td className={`px-4 py-3.5 text-xs ${isOverdue?'text-red-500 font-bold':(isDarkMode?'text-slate-400':'text-slate-500')}`}>
                            {order.expectedDate||'—'}
                            {isOverdue && <div className="text-[10px]">באיחור {order.daysLate} ימים</div>}
                          </td>
                          <td className="px-4 py-3.5">
                            <select value={order.status} onChange={e=>updateOrder(order.id,'status',e.target.value)}
                              style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#334155'}:{}}
                              className={`text-xs px-2 py-1 rounded-lg border font-medium ${statusStyle}`}>
                              <option value="ordered">הוזמן</option>
                              <option value="in_transit">בדרך</option>
                              <option value="delayed">מאחר</option>
                            </select>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <button onClick={()=>{setEditOrderId(order.id);setOrderForm({...order,orderedQty:order.orderedQty.toString()});setShowAddOrder(true);}}
                                className={`p-1.5 rounded-lg transition-colors ${isDarkMode?'text-slate-400 hover:bg-slate-700':'text-slate-400 hover:bg-slate-100'}`} title="ערוך">
                                <Settings className="w-3.5 h-3.5"/>
                              </button>
                              <button onClick={()=>{ if(window.confirm('סמן כהתקבל וסגור הזמנה?')) receiveOrder(order.id); }}
                                className={`p-1.5 rounded-lg transition-colors text-emerald-500 hover:bg-emerald-500/10`} title="סמן כהתקבל">
                                <Check className="w-3.5 h-3.5"/>
                              </button>
                              <button onClick={()=>{ if(window.confirm('מחק הזמנה?')) deleteOrder(order.id); }}
                                className={`p-1.5 rounded-lg transition-colors text-red-400 hover:bg-red-500/10`} title="מחק">
                                <Trash2 className="w-3.5 h-3.5"/>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={`px-5 py-3 border-t text-xs flex items-center gap-2 ${isDarkMode?'border-slate-700 text-slate-500':'border-slate-100 text-slate-400'}`}>
                <Info className="w-3.5 h-3.5 shrink-0"/>
                ✓ = סמן כהתקבל (מסיר מהרשימה) | כמויות בדרך מחושבות אוטומטית בהמלצות הרכש ובלוח הזמנים
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ SCHEDULE VIEW ══ */}
      {viewMode==='schedule' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className={`p-5 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className="flex items-center gap-3 mb-1">
              <div className={`p-2.5 rounded-xl ${isDarkMode?'bg-blue-500/15':'bg-blue-50'}`}><Calendar className="w-5 h-5 text-blue-500"/></div>
              <div>
                <p className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>לוח זמנים לרכש</p>
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מתי להזמין כל מוצר — לפי כיסוי (מלאי + בדרך) פחות זמן האספקה של הספק שלו</p>
              </div>
            </div>
          </div>
          {scheduleData.length === 0 ? (
            <div className={`flex flex-col items-center py-16 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              <Check className="w-12 h-12 text-emerald-500 mb-3 opacity-60"/>
              <p className={`font-medium ${isDarkMode?'text-white':'text-slate-800'}`}>אין הזמנות דחופות</p>
              <p className={`text-sm mt-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>הזן מלאי נוכחי במוצרים כדי לראות לוח זמנים</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[['critical','הזמן עכשיו','#C8322B'],['urgent','הזמן תוך שבוע','#D9822B'],['soon','הזמן תוך שבועיים','#D9822B'],['planned','תכנן לחודש הבא','#1F5FBF'],['later','אין צורך דחוף','#2E8B57']].map(([urg, label, color]) => {
                const items = scheduleData.filter(p=>p.urgency===urg);
                if (!items.length) return null;
                return (
                  <div key={urg} className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                    <div className="px-5 py-3 flex items-center gap-3" style={{borderRight:`4px solid ${color}`}}>
                      <span className="font-bold text-sm" style={{color}}>{label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium`} style={{background:color+'22',color}}>{items.length} מוצרים</span>
                    </div>
                    <div className="divide-y" style={{borderColor: isDarkMode?'rgba(51,65,85,0.5)':'#f1f5f9'}}>
                      {items.map(p => (
                        <div key={p.key} className={`px-5 py-3 flex items-center gap-4 flex-wrap ${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-medium text-sm truncate ${isDarkMode?'text-slate-200':'text-slate-800'}`}>{p.name}</span>
                              <ABCBadge cls={p.abc} xyz={p.xyz} abcXyz={p.abcXyz}/>
                              {p.supplier && <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.supplier}</span>}
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-xs flex-wrap">
                              <span className={isDarkMode?'text-slate-400':'text-slate-500'}>מלאי: <strong>{p.currentStock?.toLocaleString()}</strong> יח'</span>
                              <span className={isDarkMode?'text-slate-400':'text-slate-500'}>כיסוי: <strong>{p.effectiveCoverDays}</strong> יום{p.incomingQty>0?' (כולל בדרך)':''}</span>
                              <span className={isDarkMode?'text-slate-400':'text-slate-500'}>זמן אספקה: <strong>{p.effectiveLeadTime}</strong> ח'{p.leadTimeOverridden?' (לפי ספק)':''}</span>
                              <span className={isDarkMode?'text-slate-400':'text-slate-500'}>ממוצע: <strong>{p.avgMonthly.toFixed(0)}</strong>/חודש</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 flex-wrap">
                            {p.daysUntilOrder < 0
                              ? <span className="text-xs font-bold text-red-500">באיחור של {Math.abs(p.daysUntilOrder)} יום!</span>
                              : p.daysUntilOrder === 0
                              ? <span className="text-xs font-bold text-red-500">הזמן היום!</span>
                              : <span className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>הזמן עד {p.orderByDate.toLocaleDateString('he-IL',{day:'numeric',month:'short'})}</span>
                            }
                            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm border-2`}
                              style={{background:color+'18', borderColor:color, color}}>
                              <ShoppingCart className="w-3.5 h-3.5"/>
                              {p.suggestedOrder.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ WHAT-IF VIEW ══ */}
      {viewMode==='whatif' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Config */}
          <div className={`p-5 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2.5 rounded-xl ${isDarkMode?'bg-blue-500/15':'bg-blue-50'}`}><Activity className="w-5 h-5 text-blue-500"/></div>
              <div>
                <p className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>תרחיש ביקוש</p>
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מה יקרה להזמנות אם הביקוש ישתנה?</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex-1 min-w-[200px]">
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>שינוי בביקוש</span>
                  <span className={`text-lg font-bold px-3 py-0.5 rounded-lg ${whatIfMultiplier>1?(isDarkMode?'bg-emerald-500/20 text-emerald-300':'bg-emerald-50 text-emerald-700'):(isDarkMode?'bg-red-500/20 text-red-300':'bg-red-50 text-red-700')}`}>
                    {whatIfMultiplier>1?'+':''}{Math.round((whatIfMultiplier-1)*100)}%
                  </span>
                </div>
                <input type="range" min={0.5} max={2.0} step={0.05} value={whatIfMultiplier}
                  onChange={e=>setWhatIfMultiplier(parseFloat(e.target.value))}
                  className="w-full accent-blue-500"/>
                <div className="flex justify-between text-xs mt-1">
                  {[-50,-25,0,'+25','+50','+100'].map((l,i)=>(
                    <span key={i} className={isDarkMode?'text-slate-600':'text-slate-400'}>{l}%</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {[0.7,0.85,1.0,1.2,1.5,2.0].map(v=>(
                  <button key={v} onClick={()=>setWhatIfMultiplier(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${whatIfMultiplier===v?(isDarkMode?'bg-blue-500/20 border-blue-500 text-blue-300':'bg-blue-50 border-blue-400 text-blue-700'):(isDarkMode?'border-slate-700 text-slate-400':'border-slate-200 text-slate-500')}`}>
                    {v>1?'+':''}{Math.round((v-1)*100)}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Impact summary */}
          {whatIfProducts.length > 0 && (() => {
            const totalBase = products.reduce((a,p)=>a+p.suggestedOrder,0);
            const totalAdj  = whatIfProducts.reduce((a,p)=>a+p.adjOrder,0);
            const totalCostBase = products.reduce((a,p)=>a+(p.orderCost||0),0);
            const totalCostAdj  = whatIfProducts.reduce((a,p)=>a+(p.adjOrder*(p.unitCost||0)),0);
            return (
              <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4`}>
                {[
                  {label:'יחידות (בסיס)', val:totalBase.toLocaleString(), sub:'הזמנה רגילה'},
                  {label:'יחידות (תרחיש)', val:totalAdj.toLocaleString(), sub:`שינוי: ${totalAdj>totalBase?'+':''}${(totalAdj-totalBase).toLocaleString()}`, color: totalAdj>totalBase?'text-orange-500':'text-emerald-500'},
                  {label:'עלות (בסיס)', val:formatShort(totalCostBase), sub:''},
                  {label:'עלות (תרחיש)', val:formatShort(totalCostAdj), sub:`${totalCostAdj>totalCostBase?'+':''}${formatShort(totalCostAdj-totalCostBase)}`, color: totalCostAdj>totalCostBase?'text-orange-500':'text-emerald-500'},
                ].map(k=>(
                  <div key={k.label} className={`p-4 rounded-xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
                    <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{k.label}</p>
                    <p className={`font-bold text-lg mt-1 ${k.color||''} ${isDarkMode&&!k.color?'text-white':'text-slate-800'}`}>{k.val}</p>
                    {k.sub && <p className={`text-xs mt-0.5 font-medium ${k.color||''}`}>{k.sub}</p>}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Products table */}
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className={`px-5 py-3 border-b ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
              <h3 className={`font-bold text-sm ${isDarkMode?'text-white':'text-slate-800'}`}>השפעה לפי מוצר — תרחיש {whatIfMultiplier>1?'+':''}{Math.round((whatIfMultiplier-1)*100)}%</h3>
            </div>
            <div className="overflow-x-auto">
              <table className={`w-full text-sm text-right min-w-[600px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                <thead className={`text-[11px] font-semibold uppercase tracking-widest ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                  <tr>
                    {sortTh('whatIf','name','מוצר',{className:'px-4 py-3'})}{sortTh('whatIf','abc','ABC',{className:'px-4 py-3'})}{sortTh('whatIf','avgMonthly','ממוצע בסיס',{className:'px-4 py-3',firstDir:'desc'})}{sortTh('whatIf','adjAvg','ממוצע תרחיש',{className:'px-4 py-3',firstDir:'desc'})}{sortTh('whatIf','adjCovDays','כיסוי (יום)',{className:'px-4 py-3'})}{sortTh('whatIf','suggestedOrder','הזמנה בסיס',{className:'px-4 py-3',firstDir:'desc'})}
                    {sortTh('whatIf','adjOrder','הזמנה תרחיש',{className:`px-4 py-3 font-bold ${isDarkMode?'text-blue-400':'text-blue-700'}`,firstDir:'desc'})}
                    {sortTh('whatIf','orderDelta','שינוי',{className:'px-4 py-3',firstDir:'desc'})}
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                  {sortRows('whatIf', whatIfProducts).slice(0,50).map(p=>(
                    <tr key={p.key} className={`${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'} ${p.orderDelta>0?(isDarkMode?'':'bg-orange-50/30'):''}`}>
                      <td className="px-4 py-3">
                        <p className={`font-medium text-sm truncate max-w-[180px] ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{p.name}</p>
                      </td>
                      <td className="px-4 py-3"><ABCBadge cls={p.abc} xyz={p.xyz} abcXyz={p.abcXyz}/></td>
                      <td className={`px-4 py-3 tabular-nums ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{p.avgMonthly.toFixed(1)}</td>
                      <td className={`px-4 py-3 tabular-nums font-medium ${isDarkMode?'text-white':'text-slate-800'}`}>{p.adjAvg.toFixed(1)}</td>
                      <td className={`px-4 py-3 tabular-nums text-xs ${p.adjCovDays!=null&&p.adjCovDays<30?(isDarkMode?'text-red-400':'text-red-600'):(isDarkMode?'text-slate-400':'text-slate-500')}`}>
                        {p.adjCovDays??'—'}
                      </td>
                      <td className={`px-4 py-3 tabular-nums ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{p.suggestedOrder}</td>
                      <td className={`px-4 py-3 tabular-nums font-bold ${isDarkMode?'text-blue-300':'text-blue-700'}`}>{p.adjOrder}</td>
                      <td className="px-4 py-3">
                        {p.orderDelta !== 0 && (
                          <span className={`text-xs font-bold ${p.orderDelta>0?(isDarkMode?'text-orange-400':'text-orange-600'):(isDarkMode?'text-emerald-400':'text-emerald-600')}`}>
                            {p.orderDelta>0?'+':''}{p.orderDelta}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══ PURCHASE PRICES VIEW ══ */}
      {viewMode==='prices' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className={`p-5 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${isDarkMode?'bg-emerald-500/15':'bg-emerald-50'}`}><DollarSign className="w-5 h-5 text-emerald-500"/></div>
              <div>
                <p className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>מחירי רכש והוצאות לספקים</p>
                {onOpenSupplierAnalytics && <button type="button" onClick={onOpenSupplierAnalytics} className={`text-xs font-semibold ${isDarkMode?'text-blue-300':'text-blue-700'} hover:underline`}>לניתוח ההוצאות המלא לפי חודשים ←</button>}
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>שינויי מחיר קניה, הזמנות שמחירן חורג מהקטלוג, ומגמת ההוצאה לכל ספק</p>
              </div>
            </div>
          </div>

          {/* 1) Catalog price changes */}
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className={`px-5 py-3 border-b ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
              <h3 className={`font-bold text-sm ${isDarkMode?'text-white':'text-slate-800'}`}>שינויי מחיר קניה ({priceChanges.length})</h3>
              <p className={`text-[11px] mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>משווה את "מחיר קניה אחרון" בכל ייבוא של כרטיס פריט לייבוא הקודם. השפעה חודשית = שינוי המחיר × כמות ממוצעת לחודש.</p>
            </div>
            {priceChanges.length===0 ? (
              <p className={`px-5 py-8 text-center text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
                עדיין אין שינויי מחיר. ההיסטוריה נבנית מעכשיו: בכל פעם שתייבא כרטיס פריט עם מחירים חדשים, השינוי יופיע כאן.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className={`w-full text-sm text-right min-w-[700px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                  <thead className={`text-[11px] font-semibold sticky top-0 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                    <tr>{sortTh('priceChanges','name','מוצר',{className:'px-4 py-2.5'})}{sortTh('priceChanges','supplier','ספק',{className:'px-4 py-2.5'})}{sortTh('priceChanges','prevPrice','מחיר קודם',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('priceChanges','unitCostOriginal','מחיר נוכחי',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('priceChanges','priceChangePct','שינוי',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('priceChanges','monthlyImpactILS','השפעה חודשית ₪',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('priceChanges','priceChangedAt','תאריך',{className:'px-4 py-2.5',firstDir:'desc'})}</tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {sortRows('priceChanges', priceChanges).map(p => (
                      <tr key={p.key} className={isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'}>
                        <td className="px-4 py-2.5"><p className={`font-medium text-sm truncate max-w-[220px] ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{p.name}</p>{p.sku&&p.sku!==p.name&&<p className={`text-[10px] font-mono ${isDarkMode?'text-slate-600':'text-slate-400'}`}>{p.sku}</p>}</td>
                        <td className="px-4 py-2.5 text-xs">{p.supplier||'—'}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">{formatUnitCost(p.prevPrice, p.currency)}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums font-bold">{formatUnitCost(p.unitCostOriginal, p.currency)}</td>
                        <td className={`px-4 py-2.5 text-xs font-bold tabular-nums ${p.priceChangePct>0?'text-red-500':'text-emerald-500'}`}>{p.priceChangePct>0?'+':''}{p.priceChangePct.toFixed(1)}%</td>
                        <td className={`px-4 py-2.5 text-xs tabular-nums ${p.monthlyImpactILS>0?'text-red-500':p.monthlyImpactILS<0?'text-emerald-500':''}`}>{p.monthlyImpactILS!=null && Math.round(p.monthlyImpactILS)!==0 ? `${p.monthlyImpactILS>0?'+':''}${formatCurrency(p.monthlyImpactILS)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{p.priceChangedAt ? new Date(p.priceChangedAt).toLocaleDateString('he-IL') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 2) Open POs priced away from the catalog */}
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className={`px-5 py-3 border-b ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
              <h3 className={`font-bold text-sm ${isDarkMode?'text-white':'text-slate-800'}`}>הזמנות פתוחות במחיר שונה מהקטלוג ({poPriceDeviations.length})</h3>
              <p className={`text-[11px] mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>מחיר יחידה בהזמנה (שווי יתרה ÷ כמות) לעומת "מחיר קניה אחרון" בכרטיס הפריט · מוצגות סטיות של 3% ומעלה</p>
            </div>
            {poPriceDeviations.length===0 ? (
              <p className={`px-5 py-8 text-center text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין הזמנות פתוחות עם סטיית מחיר (או שחסר מחיר בהזמנות / בכרטיס הפריט)</p>
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className={`w-full text-sm text-right min-w-[640px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                  <thead className={`text-[11px] font-semibold sticky top-0 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                    <tr>{sortTh('poDev','productName','מוצר',{className:'px-4 py-2.5'})}{sortTh('poDev','supplier','ספק',{className:'px-4 py-2.5'})}{sortTh('poDev','poNumber','PO',{className:'px-4 py-2.5'})}{sortTh('poDev','unitPriceOriginal','מחיר בהזמנה',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('poDev','catalogCost','מחיר בקטלוג',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('poDev','poPriceDiffPct','סטייה',{className:'px-4 py-2.5',firstDir:'desc'})}</tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {sortRows('poDev', poPriceDeviations).map(o => (
                      <tr key={o.id} className={isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'}>
                        <td className={`px-4 py-2.5 text-sm font-medium truncate max-w-[220px] ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{o.productName}</td>
                        <td className="px-4 py-2.5 text-xs">{o.supplier||'—'}</td>
                        <td className="px-4 py-2.5 text-xs font-mono">{o.poNumber||'—'}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums font-bold">{formatUnitCost(o.unitPriceOriginal, o.currency)}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">{formatUnitCost(o.catalogCost, o.currency)}</td>
                        <td className={`px-4 py-2.5 text-xs font-bold tabular-nums ${o.poPriceDiffPct>0?'text-red-500':'text-emerald-500'}`}>{o.poPriceDiffPct>0?'+':''}{o.poPriceDiffPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3) Supplier spend trend */}
          <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className={`px-5 py-3 border-b ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
              <h3 className={`font-bold text-sm ${isDarkMode?'text-white':'text-slate-800'}`}>מגמת הוצאה לספקים</h3>
              <p className={`text-[11px] mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>מקובץ ההוצאות בלשונית "ספקים" · 3 החודשים האחרונים לעומת 3 שלפניהם</p>
            </div>
            {supplierSpend.length===0 ? (
              <p className={`px-5 py-8 text-center text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>לא נטען קובץ הוצאות לספקים — טען אותו בלשונית "ספקים" כדי לראות את מגמת ההוצאה</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className={`w-full text-sm text-right min-w-[640px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                  <thead className={`text-[11px] font-semibold sticky top-0 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                    <tr>{sortTh('supSpend','name','ספק',{className:'px-4 py-2.5'})}{sortTh('supSpend','last12','12 חודשים',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('supSpend','last3','3 חודשים אחרונים',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('supSpend','prev3','3 חודשים קודמים',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('supSpend','changePct','שינוי',{className:'px-4 py-2.5',firstDir:'desc'})}{sortTh('supSpend','trend','מגמה',{className:'px-4 py-2.5',firstDir:'desc'})}</tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {sortRows('supSpend', supplierSpend, { trend: x => x.changePct }).map(x => (
                      <tr key={x.name} className={isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'}>
                        <td className={`px-4 py-2.5 text-sm font-medium ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{x.name}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums font-bold">{formatShort(x.last12)}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">{formatShort(x.last3)}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">{formatShort(x.prev3)}</td>
                        <td className={`px-4 py-2.5 text-xs font-bold tabular-nums ${x.changePct==null?'':x.changePct>0?'text-red-500':'text-emerald-500'}`}>{x.changePct==null?'—':`${x.changePct>0?'+':''}${x.changePct.toFixed(0)}%`}</td>
                        <td className="px-4 py-2.5"><MiniSparkline data={x.sparkline}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dead Stock View */}
      {viewMode==='dead' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Config + KPIs */}
          <div className={`p-5 rounded-2xl border flex flex-wrap items-center gap-5 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${isDarkMode?'bg-red-500/15':'bg-red-50'}`}>
                <Trash2 className="w-5 h-5 text-red-500"/>
              </div>
              <div>
                <p className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>פריטים מתים / איטיים</p>
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>פריטים עם מלאי שלא נמכרו בתקופה שנבחרה — כולל פריטים שיש במלאי ולא נמכרו אף פעם</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mr-auto flex-wrap">
              <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>לא נמכר מעל:</span>
              <div className={`flex rounded-lg p-1 ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                {[30,60,90,180].map(d=>(
                  <button key={d} onClick={()=>setDeadStockDays(d)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${deadStockDays===d?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-slate-800'):(isDarkMode?'text-slate-400':'text-slate-500')}`}>
                    {d} יום
                  </button>
                ))}
              </div>
              {deadStockValue > 0 && (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-bold ${isDarkMode?'bg-red-500/10 border-red-500/20 text-red-300':'bg-red-50 border-red-200 text-red-700'}`}>
                  <DollarSign className="w-4 h-4"/>
                  {formatShort(deadStockValue)} מלאי תקוע
                </div>
              )}
            </div>
          </div>

          {deadStockData.length === 0 ? (
            <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              <Check className="w-12 h-12 text-emerald-500 mb-3 opacity-60"/>
              <p className={`font-medium ${isDarkMode?'text-white':'text-slate-800'}`}>אין פריטים מתים!</p>
              <p className={`text-sm mt-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>כל הפריטים עם מלאי נמכרו בתוך {deadStockDays} הימים האחרונים</p>
            </div>
          ) : (
            <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              <div className={`px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                  <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
                    <Trash2 className="w-4 h-4 text-red-400"/> {deadStockData.length} פריטים לא זזים
                  </h3>
                  {deadStockData.some(p=>p.costCurrencyBlocked) && (
                    <span title="חלק מהפריטים בעלות במטבע זר בלי שער מוגדר — הערך שלהם לא נכלל בסה״כ" className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg ${isDarkMode?'bg-orange-500/15 text-orange-300':'bg-orange-50 text-orange-700'}`}>
                      <TriangleAlert className="w-3 h-3"/> יש פריטים בערך לא ידוע (מטבע זר)
                    </span>
                  )}
                </div>
                <button onClick={() => {
                  setTimeout(() => {
                    try {
                      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>פריטים מתים</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml></head><body>`;
                      html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri;font-size:11px;direction:rtl">`;
                      html += `<thead><tr style="background:#1e293b;color:#fff"><th>מוצר</th><th>מק"ט</th><th>ABC</th><th>ימים ללא מכירה</th><th>מלאי נוכחי</th><th>עלות יחידה ₪</th><th style="background:#dc2626">ערך מלאי תקוע ₪</th><th>ספק</th></tr></thead><tbody>`;
                      deadStockData.forEach(p => {
                        html += `<tr style="background:#fff7f7"><td>${p.name}</td><td>${p.sku||''}</td><td style="text-align:center;font-weight:bold">${p.abc}</td><td style="text-align:center;color:#dc2626;font-weight:bold">${p.neverSold?'לא נמכר כלל':(p.daysSince??'לא ידוע')}</td><td style="text-align:center">${p.currentStock??'לא ידוע'}</td><td style="text-align:center">${p.unitCost?'₪'+p.unitCost:''}</td><td style="text-align:center;font-weight:bold;color:#dc2626">${p.stockValue>0?'₪'+Math.round(p.stockValue).toLocaleString():''}</td><td>${p.supplier||''}</td></tr>`;
                      });
                      html += `<tr style="background:#fee2e2;font-weight:bold"><td colspan="6">סה"כ ערך מלאי תקוע</td><td style="text-align:center;color:#dc2626">₪${Math.round(deadStockValue).toLocaleString()}</td><td></td></tr>`;
                      html += `</tbody></table></body></html>`;
                      const blob = new Blob(['﻿'+html],{type:'application/vnd.ms-excel;charset=utf-8'});
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.style.display='none'; a.href=url;
                      a.setAttribute('download','פריטים_מתים_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.xls');
                      document.body.appendChild(a); a.click();
                      setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},200);
                    } catch(e){console.error(e);}
                  },30);
                }} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${isDarkMode?'bg-red-900/20 border-red-800 text-red-400 hover:bg-red-900/40':'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
                  <Download className="w-3.5 h-3.5"/> ייצוא לאקסל
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full text-sm text-right min-w-[700px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                  <thead className={`text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                    <tr>
                      {sortTh('dead','name','מוצר',{className:'px-4 py-3 min-w-[180px]'})}
                      {sortTh('dead','abc','ABC')}
                      {sortTh('dead','daysSince','ימים ללא מכירה',{className:'px-4 py-3 whitespace-nowrap',firstDir:'desc'})}
                      {sortTh('dead','currentStock','מלאי נוכחי',{className:'px-4 py-3 whitespace-nowrap',firstDir:'desc'})}
                      {sortTh('dead','unitCost','מחיר קניה',{className:'px-4 py-3 whitespace-nowrap',firstDir:'desc'})}
                      {sortTh('dead','stockValue','ערך תקוע',{className:`px-4 py-3 whitespace-nowrap font-bold ${isDarkMode?'text-red-400':'text-red-700'}`,firstDir:'desc'})}
                      {sortTh('dead','supplier','ספק')}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {sortRows('dead', deadStockData, { daysSince: p => p.neverSold ? 1e9 : p.daysSince }).map(p => (
                      <tr key={p.key} className={`transition-all ${isDarkMode?'hover:bg-red-900/10':'hover:bg-red-50/50'}`}>
                        <td className="px-4 py-3.5">
                          <p className={`font-medium text-sm truncate max-w-[200px] ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{p.name}</p>
                          {p.sku&&p.sku!==p.name&&<p className={`text-xs font-mono ${isDarkMode?'text-slate-600':'text-slate-400'}`}>{p.sku}</p>}
                        </td>
                        <td className="px-4 py-3.5"><ABCBadge cls={p.abc} xyz={p.xyz} abcXyz={p.abcXyz}/></td>
                        <td className="px-4 py-3.5">
                          <span className={`font-bold tabular-nums px-2.5 py-1 rounded-lg text-sm
                            ${p.neverSold||(p.daysSince||0)>180?(isDarkMode?'bg-red-500/20 text-red-300':'bg-red-100 text-red-700')
                              :(p.daysSince||0)>90?(isDarkMode?'bg-orange-500/20 text-orange-300':'bg-orange-100 text-orange-700')
                              :(isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-100 text-slate-600')}`}>
                            {p.neverSold ? 'לא נמכר כלל' : `${p.daysSince??'—'} יום`}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`font-bold tabular-nums ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.currentStock?.toLocaleString()??'—'}</span>
                          <span className={`text-xs mr-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>יח'</span>
                        </td>
                        <td className="px-4 py-3.5">
                          {p.unitCost ? <span className={`text-sm ${isDarkMode?'text-slate-300':'text-slate-600'}`}>₪{p.unitCost.toLocaleString()}</span> : <span className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-400'}`}>—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          {p.stockValue > 0
                            ? <span className={`font-bold text-sm ${isDarkMode?'text-red-400':'text-red-600'}`}>₪{Math.round(p.stockValue).toLocaleString()}</span>
                            : <span className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-400'}`}>אין מחיר</span>
                          }
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-xs truncate block max-w-[120px] ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{p.supplier||'—'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`border-t-2 ${isDarkMode?'border-slate-600 bg-slate-900/50':'border-slate-200 bg-slate-50'}`}>
                      <td colSpan={5} className={`px-4 py-3 text-sm font-bold ${isDarkMode?'text-slate-300':'text-slate-700'}`}>
                        סה"כ ערך מלאי תקוע
                      </td>
                      <td className={`px-4 py-3 font-bold text-base tabular-nums ${isDarkMode?'text-red-400':'text-red-600'}`}>
                        {formatShort(deadStockValue)}
                      </td>
                      <td/>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Footer tip */}
              <div className={`px-5 py-3 border-t text-xs flex items-center gap-2 ${isDarkMode?'border-slate-700 text-slate-500':'border-slate-100 text-slate-400'}`}>
                <Info className="w-3.5 h-3.5 shrink-0"/>
                פריטים ללא עלות יחידה לא יציגו ערך — העלה קובץ כרטיס פריטים מ-Priority כדי לחשב ערך מלאי מלא
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode==='products' && (
        <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
        <div className={`px-5 py-4 border-b flex flex-wrap justify-between items-center gap-3 ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className={`text-base font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
              {{all:'כל המוצרים', order:'מוצרים להזמנה', late:'מוצרים עם הזמנה באיחור'}[actionFilter]||'כל המוצרים'}
              <span className={`text-xs font-normal ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{filtered.length.toLocaleString()} מוצרים · לחיצה על שורה פותחת פרטים</span>
              {(riskFilter!=='all'||abcFilter!=='all'||actionFilter!=='all'||familyFilter) && (
                <button type="button" onClick={()=>{setRiskFilter('all');setAbcFilter('all');setActionFilter('all');setFamilyFilter('');}}
                  className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-normal ${isDarkMode?'bg-slate-700 text-slate-200 hover:bg-slate-600':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                  <X className="w-3 h-3"/> נקה סינון
                </button>
              )}
            </h3>
            <div role="group" aria-label="סינון לפי סיווג ABC" className={`flex rounded-lg p-1 text-xs ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
              {[['all','כל הסיווגים'],['A','A'],['B','B'],['C','C']].map(([k,l])=>(
                <button type="button" key={k} onClick={()=>setAbcFilter(k)} aria-pressed={abcFilter===k} className={`px-2.5 py-1 rounded-md transition-all font-semibold ${abcFilter===k?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-slate-800'):(isDarkMode?'text-slate-400':'text-slate-500')}`}>{l}</button>
              ))}
            </div>
            {familyOptions.length>1 && (
              <select aria-label="סינון לפי משפחת מוצר" value={familyFilter} onChange={e=>setFamilyFilter(e.target.value)}
                style={isDarkMode?{background:'#334155',color:'#f1f5f9'}:{}}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${isDarkMode?'border-slate-600':'bg-slate-100 border-slate-200 text-slate-700'}`}>
                <option value="">כל המשפחות</option>
                {familyOptions.map(([f,n]) => <option key={f} value={f}>{f} ({n})</option>)}
              </select>
            )}
            <button type="button" onClick={()=>setShowLegend(p=>!p)} aria-expanded={showLegend}
              className={`flex items-center gap-1.5 text-xs font-semibold ${isDarkMode?'text-blue-300 hover:text-blue-200':'text-blue-700 hover:text-blue-800'}`}>
              <Info className="w-3.5 h-3.5"/> מה זה A/B/C?
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {blockedCurrencies.length>0 && (
              <div title={`מוצרים בעלות ${blockedCurrencies.join('/')} לא נכללים בסכומים (עלות הזמנה, ערך מלאי) — הזן שער חליפין ב-⚙️ הגדרות כדי לכלול אותם`}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-semibold ${procChipCls('watch', isDarkMode)}`}>
                חסר שער ל-{blockedCurrencies.join('/')}
              </div>
            )}
            <div className="relative">
              <Search className={`absolute right-3 top-2.5 w-3.5 h-3.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
              <input type="search" aria-label="חיפוש מוצר או מק״ט" placeholder="חיפוש מוצר או מק״ט (* = כל טקסט)" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                className={`pl-4 pr-9 py-2 border rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
            </div>
            <button
              disabled={exporting || !filtered.length}
              onClick={() => {
                if (exporting || !filtered.length) return;
                setExporting(true);
                setTimeout(() => {
                  try {
                    const riskColor = { critical:'#fee2e2', low:'#fef9c3', ok:'#f0fdf4', unknown:'#ffffff' };
                    const riskText  = { critical:'⛔ קריטי', low:'⚠ נמוך', ok:'✅ תקין', unknown:'—' };
                    const abcBg     = { A:'#fef3c7', B:'#dbeafe', C:'#f1f5f9' };
                    const abcFg     = { A:'#92400e', B:'#1e40af', C:'#475569' };

                    const cols = [
                      { label:'מק"ט',           key: p => p.sku||p.name },
                      { label:'תאור מוצר',      key: p => p.name },
                      { label:'ספק',            key: p => p.supplier||'' },
                      { label:'ABC',            key: p => p.abc, style: p => `background:${abcBg[p.abc]||'#fff'};color:${abcFg[p.abc]||'#000'};font-weight:bold;text-align:center` },
                      { label:'ממוצע/חודש',    key: p => p.avgMonthly.toFixed(1), style: p => 'text-align:center' },
                      { label:'מגמה %',         key: p => p.trend ? p.trend.toFixed(0)+'%' : '—', style: p => `color:${p.trend>5?'#16a34a':p.trend<-5?'#dc2626':'#64748b'};font-weight:${Math.abs(p.trend||0)>5?'bold':'normal'};text-align:center` },
                      { label:'מלאי נוכחי',     key: p => p.currentStock??'—', style: p => p.currentStock!==null&&p.currentStock<=0?'color:#dc2626;font-weight:bold;text-align:center':'text-align:center' },
                      { label:'מינימום',        key: p => p.minStock??'—', style: () => 'text-align:center' },
                      { label:'כיסוי', key: p => p.coverageDays!=null?`${p.coverageDays} יום (${p.coverageMonths?.toFixed(1)} ח')`:'—', style: () => 'text-align:center;white-space:nowrap' },
                      { label:'סטטוס',          key: p => riskText[p.risk]||'—', style: () => 'text-align:center' },
                      { label:"להזמין (יח')",   key: p => p.suggestedOrder||'✅', style: p => `font-weight:bold;font-size:13px;text-align:center;color:${p.risk==='critical'?'#dc2626':p.risk==='low'?'#d97706':p.suggestedOrder>0?'#1d4ed8':'#16a34a'};background:${p.suggestedOrder>0?(p.risk==='critical'?'#fecaca':p.risk==='low'?'#fef3c7':'#dbeafe'):'#dcfce7'}` },
                      { label:'עלות הזמנה ₪',  key: p => p.orderCost?'₪'+Math.round(p.orderCost).toLocaleString():'', style: () => 'text-align:center' },
                      { label:'מחיר קניה ₪',   key: p => p.unitCost?'₪'+p.unitCost:'', style: () => 'text-align:center' },
                      { label:'הכנסה ₪',       key: p => '₪'+Math.round(p.totalRev).toLocaleString(), style: () => 'text-align:center' },
                    ];

                    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>תכנון רכש</x:Name>
<x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml>
</head><body>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri,Arial;font-size:11px;direction:rtl">
<thead><tr style="background:#1e293b;color:#fff;font-weight:bold;font-size:12px">`;
                    cols.forEach(col => { html += `<th style="background:#1e293b;color:#fff;font-weight:bold;padding:8px 10px;border:1px solid #3b82f6;white-space:nowrap">${col.label}</th>`; });
                    html += '</tr></thead><tbody>';

                    filtered.forEach((p, i) => {
                      const bg = riskColor[p.risk] || (i%2===0?'#ffffff':'#f8fafc');
                      html += `<tr style="background:${bg}">`;
                      cols.forEach(col => {
                        const val = col.key(p);
                        const style = col.style ? col.style(p) : '';
                        html += `<td style="padding:6px 10px;border:1px solid #e2e8f0;${style}">${val}</td>`;
                      });
                      html += '</tr>';
                    });

                    html += `</tbody></table>
<br/><table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;font-family:Calibri;font-size:11px;direction:rtl">
<tr><th style="background:#1e293b;color:#fff;padding:6px 12px" colspan="2">מקרא</th></tr>
<tr><td style="background:#fee2e2;padding:6px 12px">⛔ אדום</td><td style="padding:6px 12px">מלאי קריטי — פחות מזמן האספקה / יתרה שלילית</td></tr>
<tr><td style="background:#fef9c3;padding:6px 12px">⚠ צהוב</td><td style="padding:6px 12px">מלאי נמוך — פחות ממלאי היעד</td></tr>
<tr><td style="background:#f0fdf4;padding:6px 12px">✅ ירוק</td><td style="padding:6px 12px">מלאי תקין — אין צורך בהזמנה</td></tr>
</table></body></html>`;

                    const blob = new Blob(['\ufeff'+html], { type:'application/vnd.ms-excel;charset=utf-8' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.setAttribute('download', 'תכנון_רכש_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.xls');
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
                  } catch(e) {
                    console.error('Export failed:', e);
                  } finally {
                    setExporting(false);
                  }
                }, 30);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-colors disabled:opacity-50 ${isDarkMode?'bg-emerald-900/20 border-emerald-800 text-emerald-400 hover:bg-emerald-900/40':'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Download className="w-3.5 h-3.5"/>}
              {exporting ? 'מכין...' : 'ייצוא Excel'}
            </button>
            <button onClick={generatePDFReport} disabled={pdfGenerating}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-colors disabled:opacity-50 ${isDarkMode?'bg-red-900/20 border-red-800 text-red-400 hover:bg-red-900/40':'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}
            >
              {pdfGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <FileText className="w-3.5 h-3.5"/>}
              {pdfGenerating ? 'מכין...' : 'דוח PDF למנהל'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table data-proctable className={`text-sm text-right ${isDarkMode?'text-slate-300':'text-slate-600'}`} style={{tableLayout:'fixed', width: PROC_COL_KEYS.reduce((s,k)=>s+(colWidths[k]||PROC_COL_DEFAULTS[k]),0)}}>
            <colgroup>{PROC_COL_KEYS.map(k=><col key={k} data-colkey={k} style={{width: colWidths[k]||PROC_COL_DEFAULTS[k]}}/>)}</colgroup>
            <thead className={`text-xs uppercase tracking-wide sticky top-0 z-10 ${isDarkMode?'bg-slate-900/95 text-slate-400 backdrop-blur':'bg-slate-50/95 text-slate-500 backdrop-blur'}`}>
              {renderProcTableHeader(filtered)}
            </thead>
            <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
              {visibleProducts.map(renderProductRow)}
              {!filtered.length&&<tr><td colSpan={PROC_COL_KEYS.length} className={`px-4 py-16 text-center text-sm ${isDarkMode?'text-slate-600':'text-slate-400'}`}>לא נמצאו מוצרים</td></tr>}
              {visibleCount < filtered.length && (
                <tr ref={loadMoreSentinelRef}><td colSpan={PROC_COL_KEYS.length} className={`px-4 py-4 text-center text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>טוען עוד מוצרים…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visibleCount < filtered.length && (
          <div className={`px-5 py-2 text-xs text-center border-t ${isDarkMode?'border-slate-700 text-slate-500':'border-slate-100 text-slate-400'}`}>
            מציג {visibleCount.toLocaleString()} מתוך {filtered.length.toLocaleString()} מוצרים — גלול למטה לעוד
          </div>
        )}
        <div className={`px-5 py-3 border-t flex flex-wrap gap-4 text-xs ${isDarkMode?'border-slate-700 text-slate-500':'border-slate-100 text-slate-400'}`}>
          {[['now','המלאי ייגמר לפני שהזמנה חדשה תגיע'],['soon','צריך להזמין, אבל יש עוד זמן'],['watch','אין מה להזמין — לוודא שההזמנה שבדרך מגיעה'],['ok','מלאי מספיק']].map(([k,t]) => (
            <span key={k} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:procDotColor[k]}}/><b className={isDarkMode?'text-slate-300':'text-slate-600'}>{PROC_STATUS_LABEL[k]}</b> {t}</span>
          ))}
          <span className="mr-auto">לחיצה על המלאי עורכת אותו · נשמר אוטומטית</span>
        </div>
      </div>
      )} {/* end viewMode === products */}
    </div>
    </>
  );
};


// ─── SETTINGS MODAL ────────────────────────────────────
const SettingsModal = ({ isOpen, onClose, apiKey, onSave, isDarkMode, exchangeRates, onSaveRates }) => {
  const [localKey, setLocalKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // {type:'success'|'error', text}
  const [localRates, setLocalRates] = useState({ EUR:'', USD:'' });
  const [ratesSaved, setRatesSaved] = useState(false);
  const [trashItems, setTrashItems] = useState([]); // recoverable recently-deleted datasets

  useEffect(() => { setLocalKey(apiKey); }, [apiKey, isOpen]);
  useEffect(() => {
    if (isOpen) setLocalRates({ EUR: exchangeRates?.EUR ?? '', USD: exchangeRates?.USD ?? '' });
  }, [isOpen, exchangeRates]);

  const handleSaveRates = () => {
    const next = {};
    const eur = parseFloat(localRates.EUR); if (!isNaN(eur) && eur > 0) next.EUR = eur;
    const usd = parseFloat(localRates.USD); if (!isNaN(usd) && usd > 0) next.USD = usd;
    try { localStorage.setItem('exchangeRates', JSON.stringify(next)); } catch { /* shown below via state anyway */ }
    onSaveRates(next);
    setRatesSaved(true);
    setTimeout(() => setRatesSaved(false), 1500);
  };

  // All localStorage keys this app writes to — kept as one explicit list so
  // backup/restore is a single, predictable operation instead of needing to
  // know which keys exist. (Deliberately excludes nothing — including the
  // Gemini key, since the person who can already open Settings already has it.)
  // localStorage-only keys. The four heaviest datasets (IDB_KEYS) live in
  // IndexedDB instead — see the IndexedDB section near the top of the file —
  // and are handled separately below in diagnostics/export/import.
  const BACKUP_KEYS = [
    'salesFileNames','suppliersFileNames',
    'procurementStock','procurementCost','procurementMinStock','procurementSupplier',
    'procurementMOQ','procurementCurrency','procurementLeadTime','procurementColWidths',
    'procurementInvSlots','procurementImportedFiles','inventoryFileName','openOrders','ordersFileName',
    'customerMonthlyFileName','customerProductFileName',
    'savedViews','excludeCurrentMonth','theme','geminiApiKey','exchangeRates','lastBackupDate',
  ];

  // Storage diagnostic — shows exactly what's eating into storage, split
  // between localStorage (small settings/maps) and IndexedDB (the heavy
  // datasets), since "it's full" is otherwise a black box with no way to
  // tell what to clear.
  const KEY_LABELS = {
    dashboardSalesData:'מכירות', dashboardSuppliersData:'ספקים (טבלת רכש)',
    salesFileNames:'שמות קובצי מכירות', suppliersFileNames:'שמות קובצי ספקים',
    procurementStock:'מלאי (רכש)', procurementCost:'עלות (רכש)', procurementMinStock:'מלאי מינ\' (רכש)',
    procurementSupplier:'ספק לכל מוצר (רכש)', procurementMOQ:'MOQ (רכש)', procurementCurrency:'מטבע (רכש)',
    procurementLeadTime:'זמן אספקה (רכש)', procurementColWidths:'רוחב עמודות (רכש)',
    procurementInvSlots:'קבצי מלאי שיובאו (רכש)', procurementImportedFiles:'(ישן — לא בשימוש)',
    inventoryFileName:'שם קובץ מלאי', openOrders:'הזמנות פתוחות', ordersFileName:'שם קובץ הזמנות פתוחות',
    customerMonthlyData:'מכירות ללקוח בחתך חודשי', customerProductData:'מכירות ללקוח לפי מוצר',
    customerMonthlyFileName:'שם קובץ לקוחות חודשי', customerProductFileName:'שם קובץ לקוחות-מוצר',
    savedViews:'תצוגות שמורות', excludeCurrentMonth:'הגדרת חודש נוכחי', theme:'ערכת נושא', geminiApiKey:'מפתח Gemini',
    exchangeRates:'שערי חליפין', lastBackupDate:'תאריך גיבוי אחרון',
  };
  const [showStorageDetail, setShowStorageDetail] = useState(false);
  const [idbUsage, setIdbUsage] = useState({ items: [], totalBytes: 0 });
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const items = [];
      let totalBytes = 0;
      for (const key of IDB_KEYS) {
        try {
          const v = await idbGet(key);
          if (v !== null) {
            const bytes = JSON.stringify(v).length * 2;
            totalBytes += bytes;
            items.push({ key, label: KEY_LABELS[key]||key, bytes });
          }
        } catch {}
      }
      items.sort((a,b)=>b.bytes-a.bytes);
      setIdbUsage({ items, totalBytes });
    })();
  }, [isOpen]);
  const storageUsage = useMemo(() => {
    const items = [];
    let totalAppBytes = 0, totalAllBytes = 0;
    for (let i=0; i<localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      const bytes = (k.length + v.length) * 2; // rough UTF-16 estimate
      totalAllBytes += bytes;
      if (BACKUP_KEYS.includes(k)) { totalAppBytes += bytes; items.push({ key:k, label:KEY_LABELS[k]||k, bytes }); }
    }
    items.sort((a,b)=>b.bytes-a.bytes);
    return { items, totalAppBytes, totalAllBytes };
  }, [isOpen]);
  const formatBytes = (b) => b<1024 ? `${b}B` : b<1024*1024 ? `${(b/1024).toFixed(0)}KB` : `${(b/1024/1024).toFixed(2)}MB`;

  const handleExportAll = async () => {
    const data = {};
    BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v!==null) data[k] = v; });
    // Heavy datasets come from IndexedDB and get embedded as actual JS values
    // (not pre-stringified) — JSON.stringify(payload) below serializes the
    // whole thing in one pass either way.
    // A failed read must NOT silently produce a backup file that's missing
    // the sales data — the person would only discover that when restoring.
    const exportFailed = [];
    for (const key of IDB_KEYS) {
      try { const v = await idbGet(key); if (v !== null) data[key] = v; } catch { exportFailed.push(KEY_LABELS[key]||key); }
    }
    if (exportFailed.length > 0) {
      const proceed = window.confirm(`שים לב: הנתונים הבאים לא נקראו ולא ייכללו בקובץ הגיבוי:\n• ${exportFailed.join('\n• ')}\n\nלהמשיך בכל זאת בגיבוי חלקי?`);
      if (!proceed) { setImportStatus({ type:'error', text:'הייצוא בוטל — נסה לרענן את הדף ולייצא שוב.' }); return; }
    }
    const payload = { app:'BizDataPro', version:2, exportedAt:new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.style.display='none'; a.href=url;
    a.setAttribute('download', 'BizDataPro_גיבוי_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.json');
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    // Used by the "back up your data" reminder banner in the header
    try { localStorage.setItem('lastBackupDate', new Date().toISOString()); } catch { /* reminder metadata only */ }
    setImportStatus({ type:'success', text:'קובץ הגיבוי נוצר והורד ✓' });
  };

  const handleImportAll = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let parsed;
      try {
        parsed = JSON.parse(ev.target.result);
        if (!parsed?.data || typeof parsed.data !== 'object') throw new Error('invalid');
      } catch {
        setImportStatus({ type:'error', text:'קובץ לא תקין — זה לא קובץ גיבוי של BizData Pro' });
        return;
      }
      // Each key is written independently — a failure on one must not silently
      // abort the rest, and the person needs to actually see what didn't make
      // it rather than just getting a generic success message while data
      // quietly went missing. Heavy datasets (IDB_KEYS) go to IndexedDB;
      // older backups (version 1) may have them as JSON strings in
      // localStorage-style entries, so both string and pre-parsed forms are handled.
      const failed = [];
      for (const [k,v] of Object.entries(parsed.data)) {
        if (IDB_KEYS.includes(k)) {
          try {
            const value = typeof v === 'string' ? JSON.parse(v) : v;
            await idbSet(k, value);
          } catch { failed.push(k); }
        } else if (BACKUP_KEYS.includes(k)) {
          try { localStorage.setItem(k, v); }
          catch { failed.push(k); }
        }
      }
      if (failed.length === 0) {
        try { localStorage.setItem('lastBackupDate', new Date().toISOString()); } catch { /* reminder metadata only */ }
        setImportStatus({ type:'success', text:'הנתונים יובאו! טוען מחדש...' });
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setImportStatus({ type:'error', text:`חלק מהנתונים לא יובאו: ${failed.join(', ')}. נסה לפנות מקום ולייבא שוב.` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSave = () => {
    const trimmed = localKey.trim();
    localStorage.setItem('geminiApiKey', trimmed);
    onSave(trimmed);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1000);
  };

  const handleClear = () => {
    setLocalKey('');
    localStorage.removeItem('geminiApiKey');
    onSave('');
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ${isDarkMode?'bg-slate-800 border border-slate-700':'bg-white'}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${isDarkMode?'border-slate-700 bg-slate-900/40':'border-slate-100 bg-slate-50'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDarkMode?'bg-slate-700':'bg-white border border-slate-200'}`}>
              <Settings className="w-5 h-5 text-slate-500"/>
            </div>
            <h2 className={`font-bold text-lg ${isDarkMode?'text-white':'text-slate-800'}`}>הגדרות</h2>
          </div>
          <button onClick={onClose} className={`p-2 rounded-full transition-colors ${isDarkMode?'hover:bg-slate-700 text-slate-400':'hover:bg-slate-100 text-slate-500'}`}>
            <X className="w-5 h-5"/>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* API Key section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Bot className={`w-4 h-4 ${isDarkMode?'text-blue-400':'text-blue-600'}`}/>
              <label className={`text-sm font-medium ${isDarkMode?'text-slate-200':'text-slate-700'}`}>
                מפתח Gemini API
              </label>
              {apiKey && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isDarkMode?'bg-emerald-500/20 text-emerald-400':'bg-emerald-100 text-emerald-700'}`}>
                  ✓ פעיל
                </span>
              )}
            </div>

            <div className={`flex gap-2 p-3 rounded-xl border ${isDarkMode?'bg-slate-900 border-slate-700':'bg-slate-50 border-slate-200'}`}>
              <input
                type={showKey ? 'text' : 'password'}
                value={localKey}
                onChange={e => setLocalKey(e.target.value)}
                placeholder="AIza..."
                dir="ltr"
                className={`flex-1 bg-transparent border-none focus:ring-0 text-sm font-mono outline-none ${isDarkMode?'text-white placeholder-slate-600':'text-slate-800 placeholder-slate-400'}`}
              />
              <button onClick={() => setShowKey(p => !p)}
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${isDarkMode?'text-slate-500 hover:text-slate-300':'text-slate-400 hover:text-slate-700'}`}
                title={showKey ? 'הסתר' : 'הצג'}>
                {showKey ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
              </button>
            </div>

            <p className={`mt-2 text-xs leading-relaxed ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
              המפתח נשמר רק בדפדפן שלך (localStorage) — לא עובר לשרת ולא נשלח לשום מקום חוץ מ-Google.
            </p>

            {/* How to get a key */}
            <div className={`mt-3 p-3 rounded-xl border text-xs leading-relaxed ${isDarkMode?'bg-blue-500/8 border-blue-500/20 text-blue-300':'bg-blue-50 border-blue-100 text-blue-700'}`}>
              <p className="font-medium mb-1">איך מקבלים מפתח?</p>
              <p>1. נכנסים ל-<span className="font-mono">aistudio.google.com</span></p>
              <p>2. לוחצים "Get API Key" → "Create API key"</p>
              <p>3. מעתיקים והודבקים כאן</p>
              <p className="mt-1 opacity-70">Gemini API חינמי עד מגבלה נדיבה מאוד לשימוש אישי.</p>
            </div>
          </div>

          {/* Exchange rates — unlocks margin for products whose cost is in EUR/USD */}
          <div className={`pt-5 border-t ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className={`w-4 h-4 ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}/>
              <label className={`text-sm font-medium ${isDarkMode?'text-slate-200':'text-slate-700'}`}>שערי חליפין (₪ ליחידת מטבע)</label>
            </div>
            <p className={`text-xs leading-relaxed mb-3 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
              מוצרים שהעלות שלהם ב-€ או $ לא נכללים בחישוב הרווח כשאין שער. הזן שער עדכני (מספיק לעדכן פעם בחודש) והרווח יחושב גם להם. השאר ריק כדי לא להמיר.
            </p>
            <div className="flex gap-2 items-end">
              {[['EUR','€ יורו'],['USD','$ דולר']].map(([code,label]) => (
                <div key={code} className="flex-1">
                  <label className={`block text-[11px] font-medium mb-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{label}</label>
                  <input type="number" step="0.01" min="0" dir="ltr" placeholder="—"
                    value={localRates[code]}
                    onChange={e=>setLocalRates(p=>({...p,[code]:e.target.value}))}
                    style={isDarkMode?{background:'#0f172a',color:'#f1f5f9',borderColor:'#334155'}:{}}
                    className={`w-full px-3 py-2 rounded-xl border text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isDarkMode?'border-slate-700':'border-slate-200 bg-slate-50'}`}/>
                </div>
              ))}
              <button onClick={handleSaveRates}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${ratesSaved?'bg-emerald-500 text-white':(isDarkMode?'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30':'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200')}`}>
                {ratesSaved ? '✓' : 'שמור שערים'}
              </button>
            </div>
          </div>

          {/* Backup & Restore */}
          <div className={`pt-5 border-t ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
            <div className="flex items-center gap-2 mb-2">
              <FileSpreadsheet className={`w-4 h-4 ${isDarkMode?'text-purple-400':'text-purple-600'}`}/>
              <label className={`text-sm font-medium ${isDarkMode?'text-slate-200':'text-slate-700'}`}>גיבוי ושחזור נתונים</label>
            </div>
            <p className={`text-xs leading-relaxed mb-3 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
              שומר את כל הנתונים (מכירות, רכש, לקוחות, הגדרות) לקובץ אחד. שמור אותו בגוגל דרייב (או כל מקום אחר), וייבא אותו במחשב אחר כדי לקבל את כל המידע שלך בלי קשר ל-localStorage של אותו מחשב.
            </p>
            <div className="flex gap-2">
              <button onClick={handleExportAll}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${isDarkMode?'bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20':'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'}`}>
                <Download className="w-4 h-4"/> ייצוא לקובץ
              </button>
              <label className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${isDarkMode?'bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700':'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                <Upload className="w-4 h-4"/> ייבוא מקובץ
                <input type="file" accept=".json" onChange={handleImportAll} className="hidden"/>
              </label>
            </div>
            {importStatus && (
              <p className={`text-xs mt-2 font-medium ${importStatus.type==='success'?(isDarkMode?'text-emerald-400':'text-emerald-600'):(isDarkMode?'text-red-400':'text-red-600')}`}>
                {importStatus.text}
              </p>
            )}
            <p className={`text-[11px] mt-2 ${isDarkMode?'text-slate-600':'text-slate-400'}`}>
              ⚠ ייבוא קובץ גיבוי מחליף את הנתונים הקיימים במחשב הזה.
            </p>
          </div>

          {/* Storage diagnostic */}
          <div className={`pt-5 border-t ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
            <button onClick={()=>setShowStorageDetail(p=>!p)} className="w-full flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className={`w-4 h-4 ${isDarkMode?'text-cyan-400':'text-cyan-600'}`}/>
                <span className={`text-sm font-medium ${isDarkMode?'text-slate-200':'text-slate-700'}`}>נפח אחסון</span>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${isDarkMode?'text-slate-500':'text-slate-400'} ${showStorageDetail?'rotate-180':''}`}/>
            </button>
            <p className={`text-xs mt-2 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
              הגדרות (localStorage): <span className="font-bold">{formatBytes(storageUsage.totalAppBytes)}</span>
              {' · '}נתונים כבדים (IndexedDB): <span className="font-bold">{formatBytes(idbUsage.totalBytes)}</span>
            </p>
            <p className={`text-[11px] mt-1 ${isDarkMode?'text-slate-600':'text-slate-500'}`}>
              מכירות, ספקים, וקבצי לקוחות נשמרים ב-IndexedDB — אחסון בנפח גדול בהרבה (תלוי בדיסק הפנוי), שלא כפוף למגבלת ~5-10MB של localStorage.
            </p>
            {showStorageDetail && (
              <div className="mt-3 space-y-1.5">
                {idbUsage.items.map(it => (
                  <div key={it.key} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${isDarkMode?'bg-cyan-500/5':'bg-cyan-50'}`}>
                    <span className={isDarkMode?'text-slate-300':'text-slate-600'}>{it.label} <span className={`text-[10px] ${isDarkMode?'text-cyan-500':'text-cyan-600'}`}>IndexedDB</span></span>
                    <span className={`font-bold tabular-nums ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{formatBytes(it.bytes)}</span>
                  </div>
                ))}
                {storageUsage.items.filter(it=>it.bytes>0).map(it => (
                  <div key={it.key} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                    <span className={isDarkMode?'text-slate-300':'text-slate-600'}>{it.label}</span>
                    <span className={`font-bold tabular-nums ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{formatBytes(it.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t flex gap-3 ${isDarkMode?'border-slate-700 bg-slate-900/30':'border-slate-100 bg-slate-50'}`}>
          {apiKey && (
            <button onClick={handleClear}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isDarkMode?'text-red-400 hover:bg-red-500/10':'text-red-600 hover:bg-red-50'}`}>
              מחק מפתח
            </button>
          )}
          <div className="flex gap-2 mr-auto">
            <button onClick={onClose}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${isDarkMode?'border-slate-600 text-slate-300 hover:bg-slate-700':'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              ביטול
            </button>
            <button onClick={handleSave} disabled={localKey.trim()===apiKey}
              className={`px-5 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 ${saved?'bg-emerald-500 text-white':'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {saved ? '✓ נשמר!' : 'שמור'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// ─── SHARED GEMINI HELPER ──────────────────────────────────────────
// Tries models in order — if one fails moves to the next automatically
const GEMINI_MODELS = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview',
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
];

const callGemini = async (prompt, apiKey) => {
  if (!apiKey) throw new Error('לא הוגדר API Key. פתח ⚙️ הגדרות והכנס מפתח Gemini.');
  let lastErr = '';
  // Try both API versions
  const apiVersions = ['v1beta', 'v1'];
  for (const model of GEMINI_MODELS) {
    for (const ver of apiVersions) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${apiKey}`,
          { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ contents:[{ parts:[{ text:prompt }] }] }) }
        );
        const d = await res.json();
        if (!res.ok) {
          const msg = d?.error?.message || `HTTP ${res.status}`;
          lastErr = `[${ver}/${model}] ${msg}`;
          // Bad key — stop immediately
          if (res.status === 400 || res.status === 403) throw new Error(lastErr);
          continue;
        }
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
        lastErr = `[${ver}/${model}] תשובה ריקה`;
      } catch(e) {
        if (e.message.startsWith('[')) { lastErr = e.message; }
        else lastErr = `[${ver}/${model}] ${e.message}`;
        // Re-throw on auth errors
        if (lastErr.includes('403') || lastErr.includes('400')) throw new Error(lastErr);
      }
    }
  }
  throw new Error(lastErr || 'כל המודלים נכשלו');
};

// ─── MAIN APP ─────────────────────────────────────────
const App = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => typeof window!=='undefined' && localStorage.getItem('theme')==='dark');
  const [apiKey, setApiKey] = useState(() => typeof window!=='undefined' ? (localStorage.getItem('geminiApiKey')||'') : '');
  // Manual exchange rates (₪ per 1 unit of foreign currency) — lets margin be
  // computed for products whose cost is in EUR/USD instead of blocking them.
  const [exchangeRates, setExchangeRates] = useState(() => { try { return JSON.parse(localStorage.getItem('exchangeRates')||'{}'); } catch { return {}; } });
  // Backup reminder — until cloud sync exists, the JSON export is the only
  // safety net, so the app nudges when it's been 7+ days since the last one.
  const [backupReminderDays, setBackupReminderDays] = useState(null); // null = hidden; -1 = never backed up; n = days since last
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auto-collapse on mobile
  useEffect(() => {
    const checkMobile = () => {
      if (window.innerWidth < 768) { setIsSidebarCollapsed(true); }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // These four heavy datasets live in IndexedDB (see IDB_KEYS above), not
  // localStorage — they're the ones that can realistically grow into the
  // megabytes on a real business (years of transactions, hundreds of
  // customers × products). They start empty and load asynchronously below;
  // a short loading screen covers that gap on first paint.
  const [salesFileData, setSalesData] = useState([]); // rows from uploaded monthly files only
  // Sales-invoice lines saved by the procurement page (Priority sync or uploaded lines file).
  const [procSalesLines, setProcSalesLines] = useState([]);
  useEffect(() => { idbGet('procSalesLines').then(v => { if (Array.isArray(v)) setProcSalesLines(v); }).catch(() => {}); }, []);
  // What every tab shows: months covered by the invoice lines come from them, older months from the files.
  const salesData = useMemo(() => mergeLinesIntoMonthly(salesFileData, procSalesLines, { includeExtra: true }), [salesFileData, procSalesLines]);
  const salesLinesRange = useMemo(() => linesRange(procSalesLines), [procSalesLines]);
  // Customer cards pulled from Priority (city, agent, payment terms, customer since)
  const [priorityCustomers, setPriorityCustomers] = useState({});
  const [syncRequest, setSyncRequest] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => { try { return Number(localStorage.getItem('prioritySyncAt')) || null; } catch { return null; } });
  const requestPrioritySync = () => { setSyncRequest({ ts: Date.now() }); setActiveTab('procurement'); };
  useEffect(() => { idbGet('priorityCustomers').then(v => { if (v && typeof v === 'object') setPriorityCustomers(v); }).catch(() => {}); }, []);
  // Customer data — two independent, optional files (see parseCustomerMonthlyFile/
  // parseCustomerProductFile): one gives the time dimension, the other the product mix.
  const [customerMonthlyData, setCustomerMonthlyData] = useState([]);
  const [customerProductData, setCustomerProductData] = useState([]);
  const customerMonthlyEff = useMemo(() => customerMonthlyFromLines(customerMonthlyData, procSalesLines), [customerMonthlyData, procSalesLines]);
  const customerProductEff = useMemo(() => { const fromLines = customerProductsFromLines(procSalesLines); return fromLines.length ? fromLines : customerProductData; }, [customerProductData, procSalesLines]);
  const [customerMonthlyFileName, setCustomerMonthlyFileName] = useState(() => localStorage.getItem('customerMonthlyFileName')||'');
  const [customerProductFileName, setCustomerProductFileName] = useState(() => localStorage.getItem('customerProductFileName')||'');
  // Cost & currency per SKU — owned here (not inside ProcurementPage) so the
  // "מכירות" tab can compute margin/profit using the same data Procurement imports.
  const [costMap, setCostMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementCost')||'{}'); } catch { return {}; } });
  const [currencyMap, setCurrencyMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementCurrency')||'{}'); } catch { return {}; } });
  const [suppliersData, setSuppliersData] = useState([]);
  const [salesFileNames, setSalesFileNames] = useState(() => { try { return JSON.parse(localStorage.getItem('salesFileNames')||'[]'); } catch { return []; } });
  const [suppliersFileNames, setSuppliersFileNames] = useState(() => { try { return JSON.parse(localStorage.getItem('suppliersFileNames')||'[]'); } catch { return []; } });
  const [idbReady, setIdbReady] = useState(false);
  const [idbLoadFailed, setIdbLoadFailed] = useState([]); // IDB_KEYS whose load threw — auto-save is blocked for these

  // Load the four heavy datasets from IndexedDB on mount. If they're not there
  // yet but a legacy copy exists in localStorage (from before this migration),
  // move it over once — this immediately frees up the localStorage quota that
  // was the actual cause of "browser storage full" errors, without the person
  // needing to re-upload anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const setters = { dashboardSalesData:setSalesData, dashboardSuppliersData:setSuppliersData, customerMonthlyData:setCustomerMonthlyData, customerProductData:setCustomerProductData };
      // Keys whose read from IndexedDB actually FAILED (threw) — as opposed to
      // simply having no data yet. A failed read must block the auto-save
      // effects below, or an in-memory empty [] would overwrite real persisted
      // data on the very next render. This is the data-loss vector the old
      // silent `catch {}` here used to leave open.
      const failedKeys = [];
      for (const key of IDB_KEYS) {
        try {
          let value = await idbGet(key);
          if (value === null) {
            const legacy = localStorage.getItem(key);
            if (legacy !== null) {
              try { value = JSON.parse(legacy); } catch { value = null; }
              if (value !== null) {
                try { await idbSet(key, value); localStorage.removeItem(key); } catch {}
              }
            }
          }
          if (!cancelled && value !== null) setters[key](value);
        } catch { failedKeys.push(key); }
      }
      // Purge expired trash (deleted-data safety copies older than 7 days)
      for (const key of IDB_KEYS) {
        try {
          const t = await idbGet('_trash_' + key);
          if (t?.deletedAt && Date.now() - t.deletedAt > 7*24*60*60*1000) await idbDelete('_trash_' + key);
        } catch { /* trash cleanup is best-effort only */ }
      }
      if (!cancelled) { setIdbLoadFailed(failedKeys); setIdbReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  // One-time cleanup: 'procurementImportedFiles' was replaced by 'procurementInvSlots'
  // in an earlier update, but the old key was never actively removed — for anyone
  // who used the app before that change, it can still be sitting in localStorage
  // as a full duplicate of inventory data, quietly eating into the storage quota
  // that newer, larger uploads (like customer files) then run out of.
  useEffect(() => {
    if (localStorage.getItem('procurementImportedFiles') !== null) {
      localStorage.removeItem('procurementImportedFiles');
    }
  }, []);
  const [storageWarning, setStorageWarning] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key:'total', direction:'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  // One-shot handoff: lets the Sales tab send a product name to ProcurementPage's
  // own search box and jump there, so users can go straight from "what sold well"
  // to "what's its ABC/seasonality/reorder status" without retyping anything.
  const [procurementJumpTo, setProcurementJumpTo] = useState(null); // {term, ts}
  const jumpToProcurement = (name) => { setProcurementJumpTo({ term:name, ts:Date.now() }); setActiveTab('procurement'); };
  const jumpToSales = (name) => { setActiveTab('sales'); setSalesViewMode('byProduct'); setSearchTerm(name); };

  const [globalQuery, setGlobalQuery] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  // ─── Global search — searches products (sales) and suppliers at once ───
  const globalSearchResults = useMemo(() => {
    const q = globalQuery.trim();
    if (q.length < 2) return { products: [], suppliers: [] };
    const productNames = [...new Set(salesData.map(d=>d.description).filter(Boolean))];
    const supplierNames = [...new Set(suppliersData.map(d=>d.supplier).filter(Boolean))];
    return {
      products: productNames.filter(n=>smartMatch(n,q)).slice(0,5),
      suppliers: supplierNames.filter(n=>smartMatch(n,q)).slice(0,5),
    };
  }, [globalQuery, salesData, suppliersData]);
  useEffect(() => {
    if (!globalSearchOpen) return;
    const close = (e) => { if (!e.target.closest('[data-global-search]')) setGlobalSearchOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [globalSearchOpen]);

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatThinking, setChatThinking] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);

  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  // Global setting: most customers are invoiced only at month-end/start of next
  // month, so the most recent calendar month is structurally incomplete at any
  // point before that invoicing run finishes. When on, this excludes the latest
  // month from average/trend/forecast/churn math everywhere — Sales, Procurement,
  // and Customers — while still showing it in tables/charts (just not letting it
  // skew calculations that assume a complete month).
  const [excludeCurrentMonth, setExcludeCurrentMonth] = useState(() => {
    const v = localStorage.getItem('excludeCurrentMonth');
    return v===null ? true : v==='true';
  });
  useEffect(() => { localStorage.setItem('excludeCurrentMonth', String(excludeCurrentMonth)); }, [excludeCurrentMonth]);
  const [notifications, setNotifications] = useState([]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({ date:true, sku:true, description:true, quantity:true, total:true });

  const [availableDates, setAvailableDates] = useState([]);
  const [dateFilter, setDateFilter] = useState({ start:'', end:'' });
  // Free period comparison — compare any two custom date ranges side by side,
  // independent of the YoY/quarterly views (which compare fixed calendar periods).
  const [showFreeCompare, setShowFreeCompare] = useState(false);
  const [periodA, setPeriodA] = useState({ start:'', end:'' });
  const [periodB, setPeriodB] = useState({ start:'', end:'' });
  useEffect(() => {
    if (!showFreeCompare || !availableDates.length || periodA.start) return;
    const end = availableDates[availableDates.length-1];
    const aStart = availableDates[Math.max(0, availableDates.length-3)];
    const bEnd = availableDates[Math.max(0, availableDates.length-4)] || availableDates[0];
    const bStart = availableDates[Math.max(0, availableDates.length-6)];
    setPeriodA({ start:aStart, end });
    setPeriodB({ start:bStart, end:bEnd });
  }, [showFreeCompare, availableDates]);
  const [drillDownMonth, setDrillDownMonth] = useState(null);
  const [showYoY, setShowYoY] = useState(false);
  const [chartMetricRight, setChartMetricRight] = useState('quantity'); // 'quantity' | 'margin' (sales only)
  const [chartGranularity, setChartGranularity] = useState('month'); // 'month' | 'quarter'

  const [selectedProduct, setSelectedProduct] = useState([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [pieMetric, setPieMetric] = useState('total');

  // Persist
  const save = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); setStorageWarning(false); } catch { setStorageWarning(true); } };
  // dashboardSalesData/dashboardSuppliersData are IDB_KEYS (see IndexedDB section
  // above) — too large for localStorage on real datasets. The filename lists
  // stay tiny and stay in localStorage via save().
  useEffect(() => {
    if (!idbReady) return; // avoid overwriting IDB with the initial empty [] before the load effect has run
    if (idbLoadFailed.includes('dashboardSalesData')) return; // load failed — writing now would overwrite real data with the empty in-memory state
    idbSet('dashboardSalesData', salesFileData).then(()=>setStorageWarning(false)).catch(()=>setStorageWarning(true));
    save('salesFileNames', salesFileNames);
  }, [salesFileData, salesFileNames, idbReady, idbLoadFailed]);
  useEffect(() => {
    if (!idbReady) return;
    if (idbLoadFailed.includes('dashboardSuppliersData')) return;
    idbSet('dashboardSuppliersData', suppliersData).then(()=>setStorageWarning(false)).catch(()=>setStorageWarning(true));
    save('suppliersFileNames', suppliersFileNames);
  }, [suppliersData, suppliersFileNames, idbReady, idbLoadFailed]);

  // Backup reminder check — runs after load, and re-runs when Settings closes
  // (exporting a backup there updates lastBackupDate and should hide the banner).
  useEffect(() => {
    if (!idbReady || settingsOpen) return;
    const hasData = salesData.length>0 || suppliersData.length>0 || customerMonthlyData.length>0;
    if (!hasData) { setBackupReminderDays(null); return; }
    try {
      const snooze = localStorage.getItem('backupReminderSnoozedUntil');
      if (snooze && Date.now() < +snooze) { setBackupReminderDays(null); return; }
      const last = localStorage.getItem('lastBackupDate');
      if (!last) { setBackupReminderDays(-1); return; }
      const days = Math.floor((Date.now() - new Date(last).getTime()) / (24*60*60*1000));
      setBackupReminderDays(days >= 7 ? days : null);
    } catch { setBackupReminderDays(null); }
  }, [idbReady, settingsOpen, salesData, suppliersData, customerMonthlyData]);
  const snoozeBackupReminder = () => {
    try { localStorage.setItem('backupReminderSnoozedUntil', String(Date.now() + 3*24*60*60*1000)); } catch { /* snooze is cosmetic */ }
    setBackupReminderDays(null);
  };

  // Toggle theme
  const toggleTheme = () => { const n=!isDarkMode; setIsDarkMode(n); localStorage.setItem('theme',n?'dark':'light'); };

  // XLSX + ExcelJS loader
  useEffect(() => {
    if (window.XLSX) setXlsxLoaded(true);
    else {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.async = true; s.onload = () => setXlsxLoaded(true);
      document.body.appendChild(s);
    }
    // Pre-load ExcelJS so the procurement export is instant
    if (!window.ExcelJS) {
      const s2 = document.createElement('script');
      s2.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s2.async = true;
      document.body.appendChild(s2);
    }
    // jsPDF for the manager PDF report
    if (!window.jspdf) {
      const s3 = document.createElement('script');
      s3.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s3.async = true;
      document.body.appendChild(s3);
    }
    // html2canvas — jsPDF's built-in fonts have no Hebrew glyphs, so the PDF
    // report is built by rendering a styled HTML element and rasterizing it
    // into the PDF as an image instead, which preserves Hebrew/RTL correctly.
    if (!window.html2canvas) {
      const s4 = document.createElement('script');
      s4.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s4.async = true;
      document.body.appendChild(s4);
    }
  }, []);

  // Dates
  useEffect(() => {
    const dates = [...new Set([...salesData,...suppliersData].map(d=>d.date).filter(Boolean))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    setAvailableDates(dates);
    if (dates.length>0 && (!dateFilter.start||!dateFilter.end)) setDateFilter({ start:dates[0], end:dates[dates.length-1] });
    setCurrentPage(1); setDrillDownMonth(null);
  }, [salesData, suppliersData]);

  const activeData = useMemo(() => activeTab==='sales'?salesData:activeTab==='suppliers'?suppliersData:[], [activeTab,salesData,suppliersData]);
  const activeFileNames = useMemo(() => activeTab==='sales'?salesFileNames:activeTab==='suppliers'?suppliersFileNames:[], [activeTab,salesFileNames,suppliersFileNames]);

  const readFile = (file) => new Promise(resolve => {
    if (file.name.match(/\.xlsx?$/) && window.XLSX) {
      const r = new FileReader();
      r.onload = (e) => {
        try {
          const wb = window.XLSX.read(e.target.result, {type:'binary'});
          const json = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
          const keys = Object.keys(json[0]||{});
          const type = keys.some(k=>k.includes('ספק')||k.includes('הוצאה')) ? 'suppliers' : 'sales';
          resolve({ data:json, type, fileName:file.name, isExcel:true });
        } catch { resolve({ data:[], type:'unknown', fileName:file.name, error:true }); }
      };
      r.readAsBinaryString(file);
    } else {
      const r = new FileReader();
      r.onload = (e) => { const {data,type}=parseCSV(e.target.result); resolve({data,type,fileName:file.name}); };
      r.readAsText(file);
    }
  });

  const handleFileUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files); if (!files.length) return;
    setLoading(true);
    const results = await Promise.all(files.map(f=>readFile(f)));
    const newSales=[], newSup=[], newSF=[], newSupF=[];
    results.forEach(({data,type,fileName,error}) => {
      if (error||!data.length) return;
      const processed = data.map((row,i)=>processRow(row,i,fileName,type)).filter(item=>item.description||item.total!==0);
      if (type==='suppliers') { newSup.push(...processed); newSupF.push(fileName); }
      else { newSales.push(...processed); newSF.push(fileName); }
    });
    if (newSales.length) { setSalesData(p=>[...p,...newSales]); setSalesFileNames(p=>[...new Set([...p,...newSF])]); }
    if (newSup.length) { setSuppliersData(p=>[...p,...newSup]); setSuppliersFileNames(p=>[...new Set([...p,...newSupF])]); }
    setLoading(false); e.target.value='';
  }, [salesData, suppliersData, activeTab]);

  const [undoToast, setUndoToast] = useState(null); // {label, onUndo}
  const undoTimerRef = useRef(null);
  const showUndoToast = (label, onUndo) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ label, onUndo });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 10000);
  };

  const handleClearData = () => {
    // overview + procurement = clear everything, like summary
    const clearBoth = activeTab==='summary' || activeTab==='overview' || activeTab==='procurement';
    const keys = clearBoth ? ['sales','suppliers'] : [activeTab];
    keys.forEach(k => {
      if (k==='sales') {
        trashSet('dashboardSalesData', salesFileData, { fileNames: salesFileNames });
        setSalesData([]); setSalesFileNames([]);
        idbDelete('dashboardSalesData').catch(()=>{}); localStorage.removeItem('dashboardSalesData'); localStorage.removeItem('salesFileNames');
      } else if (k==='suppliers') {
        trashSet('dashboardSuppliersData', suppliersData, { fileNames: suppliersFileNames });
        setSuppliersData([]); setSuppliersFileNames([]);
        idbDelete('dashboardSuppliersData').catch(()=>{}); localStorage.removeItem('dashboardSuppliersData'); localStorage.removeItem('suppliersFileNames');
      }
    });
    setAvailableDates([]); setDateFilter({start:'',end:''}); resetFilters(); setDrillDownMonth(null);
    showUndoToast(
      clearBoth ? 'הנתונים נמחקו' : (keys[0]==='sales' ? 'נתוני המכירות נמחקו' : 'נתוני הרכש נמחקו'),
      async () => {
        for (const k of keys) {
          const key = k==='sales' ? 'dashboardSalesData' : 'dashboardSuppliersData';
          const t = await trashGet(key);
          if (t?.value) {
            if (k==='sales') { setSalesData(t.value); setSalesFileNames(t.extra?.fileNames||[]); }
            else { setSuppliersData(t.value); setSuppliersFileNames(t.extra?.fileNames||[]); }
            await idbSet(key, t.value);
            await trashClear(key);
          }
        }
        setUndoToast(null);
      }
    );
  };

  const resetFilters = () => {
    if (availableDates.length>0) setDateFilter({start:availableDates[0],end:availableDates[availableDates.length-1]});
    setSearchTerm(''); setSelectedProduct([]); setSelectedSku(''); setSelectedSupplier(''); setDrillDownMonth(null);
  };

  // ─── Customer file uploads (independent, optional) ───
  const [customerUploadLoading, setCustomerUploadLoading] = useState({ monthly:false, product:false });
  const [customerUploadError, setCustomerUploadError] = useState(null); // {slot, text}
  const [customerUploadSuccess, setCustomerUploadSuccess] = useState(null); // slot key, auto-clears
  const readXlsxRows = (file) => new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('XLSX not loaded')); return; }
    const r = new FileReader();
    r.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, {type:'binary'});
        resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''}));
      } catch (err) { reject(err); }
    };
    r.onerror = reject;
    r.readAsBinaryString(file);
  });
  const handleCustomerMonthlyUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setCustomerUploadLoading(p=>({...p, monthly:true}));
    setCustomerUploadError(null);
    try {
      const rows = await readXlsxRows(file);
      const parsed = parseCustomerMonthlyFile(rows);
      if (!parsed.length) {
        setCustomerUploadError({ slot:'monthly', text:'לא זוהו שורות בקובץ — ודא שזה הקובץ "מכירות ללקוח בחתך חודשי" ושיש בו עמודות שם לקוח, חודש והכנסה.' });
      } else {
        setCustomerMonthlyData(parsed);
        setCustomerMonthlyFileName(file.name);
        // Persisting can fail independently of parsing (most often the storage
        // quota being full) — that must NOT be silently swallowed, or the data
        // looks fine on screen right now but is actually gone on next
        // refresh/export, with no warning at all. This now goes to IndexedDB
        // (much larger quota than localStorage) rather than localStorage.
        try {
          await idbSet('customerMonthlyData', parsed);
          localStorage.setItem('customerMonthlyFileName', file.name);
          setCustomerUploadSuccess('monthly');
          setTimeout(() => setCustomerUploadSuccess(s => s==='monthly' ? null : s), 4000);
        } catch {
          setCustomerUploadError({ slot:'monthly', text:'הקובץ נטען למסך אבל לא נשמר בדפדפן — נסה שוב או נקה מקום בדיסק.' });
        }
      }
    } catch {
      setCustomerUploadError({ slot:'monthly', text:'לא הצלחתי לקרוא את הקובץ — ודא שזה קובץ Excel (.xlsx/.xls) תקין.' });
    }
    setCustomerUploadLoading(p=>({...p, monthly:false}));
    e.target.value = '';
  };
  const handleCustomerProductUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setCustomerUploadLoading(p=>({...p, product:true}));
    setCustomerUploadError(null);
    try {
      const rows = await readXlsxRows(file);
      const parsed = parseCustomerProductFile(rows);
      if (!parsed.length) {
        setCustomerUploadError({ slot:'product', text:'לא זוהו שורות בקובץ — ודא שזה הקובץ "מכירות ללקוח לפי מוצר" ושיש בו עמודות שם לקוח, מוצר וכמות/הכנסה.' });
      } else {
        setCustomerProductData(parsed);
        setCustomerProductFileName(file.name);
        try {
          await idbSet('customerProductData', parsed);
          localStorage.setItem('customerProductFileName', file.name);
          setCustomerUploadSuccess('product');
          setTimeout(() => setCustomerUploadSuccess(s => s==='product' ? null : s), 4000);
        } catch {
          setCustomerUploadError({ slot:'product', text:'הקובץ נטען למסך אבל לא נשמר בדפדפן — נסה שוב או נקה מקום בדיסק.' });
        }
      }
    } catch {
      setCustomerUploadError({ slot:'product', text:'לא הצלחתי לקרוא את הקובץ — ודא שזה קובץ Excel (.xlsx/.xls) תקין.' });
    }
    setCustomerUploadLoading(p=>({...p, product:false}));
    e.target.value = '';
  };
  const clearCustomerMonthly = () => {
    trashSet('customerMonthlyData', customerMonthlyData, { fileName: customerMonthlyFileName });
    setCustomerMonthlyData([]); setCustomerMonthlyFileName('');
    idbDelete('customerMonthlyData').catch(()=>{}); localStorage.removeItem('customerMonthlyData'); localStorage.removeItem('customerMonthlyFileName');
    showUndoToast('נתוני לקוחות (חודשי) נמחקו', async () => {
      const t = await trashGet('customerMonthlyData');
      if (t?.value) {
        setCustomerMonthlyData(t.value); setCustomerMonthlyFileName(t.extra?.fileName||'');
        await idbSet('customerMonthlyData', t.value);
        localStorage.setItem('customerMonthlyFileName', t.extra?.fileName||'');
        await trashClear('customerMonthlyData');
      }
      setUndoToast(null);
    });
  };
  const clearCustomerProduct = () => {
    trashSet('customerProductData', customerProductData, { fileName: customerProductFileName });
    setCustomerProductData([]); setCustomerProductFileName('');
    idbDelete('customerProductData').catch(()=>{}); localStorage.removeItem('customerProductData'); localStorage.removeItem('customerProductFileName');
    showUndoToast('נתוני לקוחות (מוצרים) נמחקו', async () => {
      const t = await trashGet('customerProductData');
      if (t?.value) {
        setCustomerProductData(t.value); setCustomerProductFileName(t.extra?.fileName||'');
        await idbSet('customerProductData', t.value);
        localStorage.setItem('customerProductFileName', t.extra?.fileName||'');
        await trashClear('customerProductData');
      }
      setUndoToast(null);
    });
  };

  // Remove the rows of ONE uploaded file (rows carry the file name at the end of their id).
  const removeDataFile = (kind, name) => {
    const isSales = kind === 'sales';
    const data = isSales ? salesFileData : suppliersData;
    const names = isSales ? salesFileNames : suppliersFileNames;
    const key = isSales ? 'dashboardSalesData' : 'dashboardSuppliersData';
    trashSet(key, data, { fileNames: names });
    const kept = data.filter(r => !String(r.id||'').endsWith('-' + name));
    const keptNames = names.filter(n => n !== name);
    if (isSales) { setSalesData(kept); setSalesFileNames(keptNames); } else { setSuppliersData(kept); setSuppliersFileNames(keptNames); }
    showUndoToast(`הקובץ ${name} נמחק`, async () => {
      const t = await trashGet(key);
      if (t?.value) {
        if (isSales) { setSalesData(t.value); setSalesFileNames(t.extra?.fileNames||[]); }
        else { setSuppliersData(t.value); setSuppliersFileNames(t.extra?.fileNames||[]); }
        await trashClear(key);
      }
      setUndoToast(null);
    });
  };
  const otherSources = useMemo(() => {
    const out = [];
    const count = (data, n) => data.reduce((c, r) => c + (String(r.id||'').endsWith('-' + n) ? 1 : 0), 0);
    salesFileNames.forEach(n => out.push({ id:'s:'+n, name:n, label:'מכירות חודשיות לפי מוצר (לשונית מכירות)', detail:`${count(salesFileData, n).toLocaleString()} שורות`, onDelete:() => removeDataFile('sales', n) }));
    suppliersFileNames.forEach(n => out.push({ id:'p:'+n, name:n, label:'הוצאות לפי ספק (לשונית ספקים)', detail:`${count(suppliersData, n).toLocaleString()} שורות`, onDelete:() => removeDataFile('suppliers', n) }));
    if (customerMonthlyFileName && customerMonthlyData.length) out.push({ id:'cm', name:customerMonthlyFileName, label:'מכירות ללקוח בחתך חודשי (לשונית לקוחות)', detail:`${customerMonthlyData.length.toLocaleString()} שורות`, onDelete:clearCustomerMonthly });
    if (customerProductFileName && customerProductData.length) out.push({ id:'cp', name:customerProductFileName, label:'מכירות ללקוח לפי מוצר (לשונית לקוחות)', detail:`${customerProductData.length.toLocaleString()} שורות`, onDelete:clearCustomerProduct });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesFileNames, suppliersFileNames, salesFileData, suppliersData, customerMonthlyFileName, customerMonthlyData, customerProductFileName, customerProductData]);

  // ─── Saved views — remembers a filter combo (tab + date range + product/supplier) ───
  const [savedViews, setSavedViews] = useState(() => { try { return JSON.parse(localStorage.getItem('savedViews')||'[]'); } catch { return []; } });
  const [showSavedViews, setShowSavedViews] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) return;
    const view = { id:Date.now(), name, activeTab, dateFilter, selectedProduct, selectedSku, selectedSupplier };
    const next = [...savedViews, view];
    setSavedViews(next);
    localStorage.setItem('savedViews', JSON.stringify(next));
    setNewViewName('');
  };
  const applySavedView = (view) => {
    setActiveTab(view.activeTab);
    setDateFilter(view.dateFilter||{start:'',end:''});
    setSelectedProduct(view.selectedProduct||[]);
    setSelectedSku(view.selectedSku||'');
    setSelectedSupplier(view.selectedSupplier||'');
    setDrillDownMonth(null);
    setShowSavedViews(false);
  };
  const deleteSavedView = (id) => {
    const next = savedViews.filter(v=>v.id!==id);
    setSavedViews(next);
    localStorage.setItem('savedViews', JSON.stringify(next));
  };
  useEffect(() => {
    if (!showSavedViews) return;
    const close = (e) => { if (!e.target.closest('[data-saved-views]')) setShowSavedViews(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showSavedViews]);

  const setQuickDate = (n) => {
    if (!availableDates.length) return;
    const sorted = [...availableDates];
    const end = sorted[sorted.length-1];
    let start = sorted[0];
    if (n==='year') { const y=end.split('-')[1]; const f=sorted.find(d=>d.endsWith(y)); if(f) start=f; }
    else if (n) { start = sorted[Math.max(0,sorted.length-n)]; }
    setDateFilter({start,end});
  };

  const handleExport = () => {
    if (!window.XLSX) return;
    const data = activeTab==='summary'
      ? (summaryData?.chart||[]).map(m=>({'תאריך':m.name,'הכנסות':m.revenue,'הוצאות':m.expenses,'רווח':m.profit}))
      : filteredData.map(r => activeTab==='sales' ? {'תאריך':r.date,'מוצר':r.description,'מק"ט':r.sku,'כמות':r.quantity,'סכום':r.total} : {'תאריך':r.date,'ספק':r.supplier,'כמות':r.quantity,'סכום':r.total});
    if (!data.length) return;
    const ws=window.XLSX.utils.json_to_sheet(data);
    const wb=window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb,ws,'Data');
    window.XLSX.writeFile(wb,`${activeTab}_export.xlsx`);
  };

  const uniqueItems = useMemo(() => ({
    products: [...new Set(salesData.map(d=>d.description).filter(Boolean))].sort(),
    skus: [...new Set(salesData.map(d=>d.sku).filter(Boolean))].sort(),
    suppliers: [...new Set(suppliersData.map(d=>d.supplier).filter(Boolean))].sort()
  }), [salesData, suppliersData]);

  const filteredData = useMemo(() => {
    if (activeTab==='summary'||activeTab==='overview') return [];
    let data = activeData;
    if (drillDownMonth) {
      data = data.filter(d=>d.date===drillDownMonth);
    } else {
      const s=dateFilter.start?getDateVal(dateFilter.start):0, e=dateFilter.end?getDateVal(dateFilter.end):999999;
      data = data.filter(d=>{ const v=getDateVal(d.date); return v>=s&&v<=e; });
    }
    if (activeTab==='sales') {
      if (selectedProduct.length>0) data=data.filter(d=>selectedProduct.includes(d.description));
      if (selectedSku) data=data.filter(d=>d.sku===selectedSku);
    } else {
      if (selectedSupplier) data=data.filter(d=>d.supplier===selectedSupplier);
    }
    if (searchTerm) { data=data.filter(d=>smartMatch(d.description,searchTerm)||smartMatch(d.sku,searchTerm)||smartMatch(d.supplier,searchTerm)); }
    return data.sort((a,b)=>{
      let va=a[sortConfig.key], vb=b[sortConfig.key];
      if (sortConfig.key==='date') { va=getDateVal(a.date); vb=getDateVal(b.date); }
      else { va=sortKeyOf(va); vb=sortKeyOf(vb); if (va===null||vb===null) return va===vb?0:va===null?1:-1; }
      const c = compareSortKeys(va, vb);
      return sortConfig.direction==='asc' ? c : -c;
    });
  }, [activeData, searchTerm, sortConfig, dateFilter, selectedProduct, selectedSku, selectedSupplier, activeTab, drillDownMonth]);

  const summaryData = useMemo(() => {
    if (activeTab!=='summary') return null;
    const s=dateFilter.start?getDateVal(dateFilter.start):0, e=dateFilter.end?getDateVal(dateFilter.end):999999;
    const inR = d=>{ const v=getDateVal(d.date); return v>=s&&v<=e; };
    const fs=salesData.filter(inR), fsu=suppliersData.filter(inR);
    const map={};
    fs.forEach(d=>{ map[d.date]=map[d.date]||{revenue:0,expenses:0}; map[d.date].revenue+=d.total; });
    fsu.forEach(d=>{ map[d.date]=map[d.date]||{revenue:0,expenses:0}; map[d.date].expenses+=d.total; });
    const chart = Object.entries(map).map(([name,v])=>({name,...v,profit:v.revenue-v.expenses,order:getDateVal(name)})).sort((a,b)=>a.order-b.order);
    const totalIncome=fs.reduce((a,c)=>a+c.total,0), totalExpenses=fsu.reduce((a,c)=>a+c.total,0);
    const totalProfit=totalIncome-totalExpenses, profitMargin=totalIncome>0?(totalProfit/totalIncome)*100:0;
    return { chart, totalIncome, totalExpenses, totalProfit, profitMargin };
  }, [activeTab, salesData, suppliersData, dateFilter]);

  const paginatedData = useMemo(() => filteredData.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage), [filteredData, currentPage]);
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  useEffect(() => setCurrentPage(1), [activeTab, searchTerm, dateFilter, selectedProduct, selectedSku, selectedSupplier, drillDownMonth]);

  const calcTrend = (data) => {
    let months=[...new Set(data.map(d=>d.date))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    // Skip the latest month if it's flagged as not-yet-fully-invoiced — comparing
    // a partial month against a complete one would show a false decline.
    if (excludeCurrentMonth && months.length>2) months = months.slice(0,-1);
    if (months.length<2) return 0;
    const last=data.filter(d=>d.date===months[months.length-1]).reduce((a,c)=>a+c.total,0);
    const prev=data.filter(d=>d.date===months[months.length-2]).reduce((a,c)=>a+c.total,0);
    return prev===0?100:((last-prev)/prev)*100;
  };

  const stats = useMemo(() => {
    if (activeTab==='summary'||activeTab==='overview') return null;
    const totalAmount=filteredData.reduce((a,c)=>a+c.total,0);
    const totalQuantity=filteredData.reduce((a,c)=>a+c.quantity,0);
    const uniqueCount=new Set(filteredData.map(d=>activeTab==='sales'?d.sku:d.supplier)).size;
    const mc=monthsDiff(dateFilter.start||availableDates[0], dateFilter.end||availableDates[availableDates.length-1]);
    const trend=calcTrend(filteredData);
    const alerts=[];
    if (trend>20) alerts.push({id:1,type:'success',text:`עלייה של ${trend.toFixed(0)}% החודש!`});
    if (trend<-20) alerts.push({id:2,type:'warning',text:`ירידה של ${Math.abs(trend).toFixed(0)}% החודש`});
    return { totalAmount, totalQuantity, uniqueCount, avgAmount:mc>0?totalAmount/mc:0, avgQuantity:mc>0?totalQuantity/mc:0, monthsCount:mc, trend, alerts };
  }, [filteredData, dateFilter, availableDates, activeTab, excludeCurrentMonth]);

  useEffect(() => { if (stats?.alerts) setNotifications(stats.alerts); }, [stats]);

  const chartData = useMemo(() => {
    if (activeTab==='summary'||activeTab==='overview') return null;
    const mm={};
    filteredData.forEach(d=>{ if(!d.date)return; mm[d.date]=mm[d.date]||{total:0,quantity:0,costKnownRev:0,costKnownCost:0}; mm[d.date].total+=d.total; mm[d.date].quantity+=d.quantity;
      if(activeTab==='sales'&&selectedProduct.length>0){ mm[d.date][d.description]=(mm[d.date][d.description]||0)+d.total; mm[d.date][`${d.description}_q`]=(mm[d.date][`${d.description}_q`]||0)+d.quantity; }
      if(activeTab==='sales') {
        const unitCost = costMap[d.sku]??costMap[d.description]??null;
        const currency = currencyMap[d.sku]??currencyMap[d.description]??null;
        if (unitCost!=null && (!currency||currency==='ILS')) {
          mm[d.date].costKnownRev += d.total;
          mm[d.date].costKnownCost += (d.quantity||0)*unitCost;
        }
      }
    });
    const monthly = Object.entries(mm).map(([name,v])=>({
      name, ...v, order:getDateVal(name),
      marginPct: v.costKnownRev>0 ? ((v.costKnownRev-v.costKnownCost)/v.costKnownRev*100) : null,
      ...(selectedProduct.length>0?selectedProduct.reduce((a,p)=>({...a,[p]:v[p]||0,[`${p}_q`]:v[`${p}_q`]||0}),{}):{})
    })).sort((a,b)=>a.order-b.order);
    const avgTotal = monthly.length ? monthly.reduce((s,m)=>s+m.total,0)/monthly.length : 0;
    const em={};
    const kf=activeTab==='sales'?'description':'supplier';
    filteredData.forEach(d=>{ const n=d[kf]; em[n]=em[n]||{total:0,quantity:0}; em[n].total+=d.total; em[n].quantity+=d.quantity; });
    const vk=(activeTab==='suppliers'||pieMetric==='total')?'total':'quantity';
    let pie=Object.entries(em).map(([name,v])=>({name,...v,value:v[vk]})).sort((a,b)=>b.value-a.value);
    if(!selectedProduct.length&&!selectedSupplier) pie=pie.slice(0,5);
    return { monthly, pie, avgTotal };
  }, [filteredData, activeTab, selectedProduct, selectedSupplier, pieMetric, costMap, currencyMap]);

  // Main trend chart can show monthly or quarterly grouping (selected products
  // breakdown only really makes sense monthly, so quarterly falls back to the
  // simple total/quantity/margin view).
  const chartDisplayData = useMemo(() => {
    if (!chartData) return null;
    if (chartGranularity==='month' || (activeTab==='sales'&&selectedProduct.length>0)) return chartData.monthly;
    const qMap = {};
    chartData.monthly.forEach(m => {
      const parts = m.name.split('-');
      if (parts.length<2) return;
      const mNum = HebrewMonthsReverse[parts[0]];
      const year = parseInt(parts[1]) + 2000;
      if (!mNum || isNaN(year)) return;
      const q = Math.ceil(mNum/3);
      const key = year+'-Q'+q;
      if (!qMap[key]) qMap[key] = { name:key, total:0, quantity:0, costKnownRev:0, costKnownCost:0, order:year*10+q };
      qMap[key].total += m.total||0;
      qMap[key].quantity += m.quantity||0;
      qMap[key].costKnownRev += m.costKnownRev||0;
      qMap[key].costKnownCost += m.costKnownCost||0;
    });
    return Object.values(qMap).sort((a,b)=>a.order-b.order).map(q=>({
      ...q, marginPct: q.costKnownRev>0 ? ((q.costKnownRev-q.costKnownCost)/q.costKnownRev*100) : null,
    }));
  }, [chartData, chartGranularity, activeTab, selectedProduct]);

  const generateAI = async () => {
    setAiModalOpen(true); setAiLoading(true); setAiReport('');
    const prompt = activeTab==='summary'
      ? `נתח: הכנסות ${formatCurrency(summaryData?.totalIncome)}, הוצאות ${formatCurrency(summaryData?.totalExpenses)}, רווח ${formatCurrency(summaryData?.totalProfit)} (${summaryData?.profitMargin.toFixed(1)}%). תן 3 תובנות קצרות בעברית.`
      : `נתח ${activeTab==='sales'?'מכירות':'ספקים'}: סה"כ ${formatCurrency(stats?.totalAmount)}, מגמה: ${chartData?.monthly.map(m=>`${m.name}:${formatCurrency(m.total||m.sales)}`).join(', ')}. תן תובנות קצרות בעברית.`;
    try {
      const text = await callGemini(prompt, apiKey);
      setAiReport(text);
    } catch(e) {
      setAiReport('❌ ' + e.message + '\n\nבדוק שהמפתח תקין (⚙️ הגדרות) ושיש גישה לאינטרנט.');
    } finally { setAiLoading(false); }
  };

  const sendChat = useCallback(async (text) => {
    setChatMessages(p=>[...p,{role:'user',content:text}]); setChatThinking(true);
    try {
      // ── Smart context builder ───────────────────────────────────
      const lowerQ = text.toLowerCase();
      const totalSales = salesData.reduce((a,c)=>a+c.total,0);
      const totalExp   = suppliersData.reduce((a,c)=>a+c.total,0);
      const months     = [...new Set(salesData.map(d=>d.date).filter(Boolean))].length;
      const allMonthsSorted = [...new Set(salesData.map(d=>d.date).filter(Boolean))].sort((a,b)=>getDateVal(a)-getDateVal(b));
      const trend = (() => { if(allMonthsSorted.length<2)return''; const last=salesData.filter(d=>d.date===allMonthsSorted[allMonthsSorted.length-1]).reduce((a,c)=>a+c.total,0); const prev=salesData.filter(d=>d.date===allMonthsSorted[allMonthsSorted.length-2]).reduce((a,c)=>a+c.total,0); return prev>0?' מגמה: '+((last-prev)/prev*100).toFixed(0)+'% לעומת חודש קודם':''; })();

      // Build product map for smart lookup
      const prodMap = salesData.reduce((m,d)=>{ if(!d.description)return m; if(!m[d.description])m[d.description]={total:0,qty:0,byMonth:{}}; m[d.description].total+=d.total; m[d.description].qty+=d.quantity||0; m[d.description].byMonth[d.date]=(m[d.description].byMonth[d.date]||0)+(d.quantity||0); return m; },{});
      const supMap  = suppliersData.reduce((m,d)=>{ if(!d.supplier)return m; m[d.supplier]=(m[d.supplier]||0)+d.total; return m; },{});

      // Detect mentioned products/suppliers (partial match, min 3 chars)
      const mentionedProds = Object.keys(prodMap).filter(n=>n.length>=3&&lowerQ.includes(n.substring(0,Math.min(n.length,6)).toLowerCase())).slice(0,3);
      const mentionedSups  = Object.keys(supMap).filter(n=>n.length>=3&&lowerQ.includes(n.substring(0,Math.min(n.length,6)).toLowerCase())).slice(0,2);

      // Build focused context
      let specificCtx = '';
      if(mentionedProds.length > 0) {
        specificCtx += '\n== מוצרים שצוינו ==\n';
        mentionedProds.forEach(name => {
          const p = prodMap[name];
          const monthlyStr = Object.entries(p.byMonth).sort((a,b)=>getDateVal(a[0])-getDateVal(b[0])).slice(-6).map(([m,q])=>m+': '+q).join(', ');
          specificCtx += ['• ',name,': סה"כ ',formatCurrency(p.total),' | כמות ',p.qty.toLocaleString(),' יח\' | חודשים: ',monthlyStr,'\n'].join('');
        });
      }
      if(mentionedSups.length > 0) {
        specificCtx += '\n== ספקים שצוינו ==\n';
        mentionedSups.forEach(name => specificCtx += '• '+name+': '+formatCurrency(supMap[name])+'\n');
      }

      // Top products & suppliers summary
      const topProds = Object.entries(prodMap).sort((a,b)=>b[1].total-a[1].total).slice(0,5).map(([n,v])=>n+': '+formatCurrency(v.total)).join(', ');
      const topSups  = Object.entries(supMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([n,v])=>n+': '+formatCurrency(v)).join(', ');

      const dataCtx = salesData.length > 0
        ? '=== נתוני העסק ===\n'
          +'• סה"כ מכירות: '+formatCurrency(totalSales)+trend+'\n'
          +'• סה"כ הוצאות: '+formatCurrency(totalExp)+'\n'
          +'• רווח גולמי: '+formatCurrency(totalSales-totalExp)+' ('+(totalSales>0?((totalSales-totalExp)/totalSales*100).toFixed(1):0)+'%)\n'
          +'• תקופה: '+months+' חודשים | חודש אחרון: '+(allMonthsSorted[allMonthsSorted.length-1]||'')+'\n'
          +'• מוצרים מובילים: '+(topProds||'אין')+'\n'
          +'• ספקים מובילים: '+(topSups||'אין')+'\n'
          +specificCtx
          +'=================\n'
        : '';
      if (!apiKey) {
        setChatMessages(p=>[...p,{role:'assistant',content:'⚠️ לא הוגדר API Key. פתח ⚙️ הגדרות והכנס מפתח Gemini.'}]);
        setChatThinking(false); return;
      }
      const prompt = dataCtx + 'שאלת המשתמש: ' + text + '\nענה בעברית בצורה ברורה וקצרה. אם הנתונים רלוונטיים לשאלה — השתמש בהם.';
      const reply = await callGemini(prompt, apiKey);
      setChatMessages(p=>[...p,{role:'assistant',content:reply}]);
    } catch(e) { setChatMessages(p=>[...p,{role:'assistant',content:'❌ '+e.message}]); } finally { setChatThinking(false); }
  }, [salesData, suppliersData, apiKey]);


  // YoY comparison data — works for both "מכירות" and "רכש וספקים"
  const yoyData = useMemo(() => {
    if (!showYoY || (activeTab !== 'sales' && activeTab !== 'suppliers')) return null;
    const startVal = dateFilter.start ? getDateVal(dateFilter.start) : 0;
    const endVal   = dateFilter.end   ? getDateVal(dateFilter.end)   : 999999;
    const inR = d => { const v = getDateVal(d.date); return v >= startVal && v <= endVal; };
    const data = activeData.filter(inR);
    const yearMap = {};
    data.forEach(item => {
      if (!item.date) return;
      const [month, ys] = item.date.split('-');
      const year = parseInt(ys) + 2000;
      if (!yearMap[year]) yearMap[year] = {};
      yearMap[year][month] = (yearMap[year][month] || 0) + item.total;
    });
    const years = Object.keys(yearMap).map(Number).sort((a,b)=>b-a).slice(0,2);
    if (years.length < 2 || years[0] === years[1]) return null;
    const [curY, prevY] = years;
    const monthOrder = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
    const rows = monthOrder.map(m => ({
      name: m,
      [curY]:  yearMap[curY]?.[m]  || 0,
      [prevY]: yearMap[prevY]?.[m] || 0,
    })).filter(d => d[curY] > 0 || d[prevY] > 0);
    return { rows, curY, prevY };
  }, [showYoY, activeTab, activeData, dateFilter]);

  // ─── Free period comparison — any two custom date ranges, side by side ───
  const freeCompareStats = useMemo(() => {
    if (!showFreeCompare || !periodA.start || !periodB.start) return null;
    const calc = (period) => {
      const startVal = getDateVal(period.start), endVal = getDateVal(period.end||period.start);
      const rows = activeData.filter(d => { const v=getDateVal(d.date); return v>=startVal && v<=endVal; });
      const revenue = rows.reduce((a,c)=>a+c.total,0);
      const qty = rows.reduce((a,c)=>a+c.quantity,0);
      const byName = {};
      const nameKey = activeTab==='sales' ? 'description' : 'supplier';
      rows.forEach(r => { const n=r[nameKey]; if(!n) return; byName[n]=(byName[n]||0)+r.total; });
      const top = Object.entries(byName).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,total])=>({name,total}));
      return { revenue, qty, top, count: rows.length };
    };
    const a = calc(periodA), b = calc(periodB);
    const revDelta = b.revenue>0 ? ((a.revenue-b.revenue)/b.revenue*100) : (a.revenue>0?100:0);
    const qtyDelta = b.qty>0 ? ((a.qty-b.qty)/b.qty*100) : (a.qty>0?100:0);
    return { a, b, revDelta, qtyDelta };
  }, [showFreeCompare, periodA, periodB, activeData, activeTab]);

  // Quarterly analysis
  const quarterlyData = useMemo(() => {
    if (activeTab !== 'sales') return null;
    const startVal = dateFilter.start ? getDateVal(dateFilter.start) : 0;
    const endVal   = dateFilter.end   ? getDateVal(dateFilter.end)   : 999999;
    const inR = d => { const v=getDateVal(d.date); return v>=startVal && v<=endVal; };
    const data = salesData.filter(inR);
    if (!data.length) return null;
    const qMap = {};
    data.forEach(item => {
      const parts = (item.date||'').split('-');
      if (parts.length < 2) return;
      const mNum = HebrewMonthsReverse[parts[0]];
      const year = parseInt(parts[1]) + 2000;
      if (!mNum || isNaN(year)) return;
      const q = Math.ceil(mNum / 3);
      const key = year + '-Q' + q;
      qMap[key] = (qMap[key]||0) + item.total;
    });
    const years = [...new Set(Object.keys(qMap).map(k=>parseInt(k.split('-')[0])))].sort((a,b)=>b-a).slice(0,2);
    if (!years.length) return null;
    const [curY, prevY] = years;
    const rows = [1,2,3,4].map(q => ({
      name: 'Q'+q,
      [curY]:  qMap[curY+'-Q'+q]  || 0,
      [prevY]: qMap[prevY+'-Q'+q] || 0,
    })).filter(r => r[curY] > 0 || r[prevY] > 0);
    if (!rows.length) return null;
    const totals = { [curY]: rows.reduce((a,r)=>a+r[curY],0), [prevY]: rows.reduce((a,r)=>a+r[prevY],0) };
    const growth = totals[prevY] > 0 ? ((totals[curY]-totals[prevY])/totals[prevY]*100) : 0;
    return { rows, curY, prevY, totals, growth };
  }, [activeTab, salesData, dateFilter]);

  // ─── Aggregated "by product" view for the Sales tab ─────────────
  // Same revenue-Pareto ABC + coefficient-of-variation XYZ methodology used in
  // ProcurementPage, computed independently here over the currently filtered
  // sales rows — so this works even without ever opening "תכנון רכש".
  const productAggregates = useMemo(() => {
    if (activeTab !== 'sales') return [];
    const map = {};
    filteredData.forEach(row => {
      const key = row.sku||row.description; if (!key) return;
      if (!map[key]) map[key] = { sku:row.sku||'', name:row.description||key, monthlyData:{}, totalQty:0, totalRev:0 };
      map[key].totalQty += row.quantity||0;
      map[key].totalRev += row.total||0;
      if (row.date) map[key].monthlyData[row.date] = (map[key].monthlyData[row.date]||0)+(row.total||0);
    });
    const list = Object.values(map);
    const totalRev = list.reduce((a,c)=>a+c.totalRev,0);
    const sorted = [...list].sort((a,b)=>b.totalRev-a.totalRev);
    let cumulative = 0;
    sorted.forEach(p => {
      const pct = totalRev>0 ? (p.totalRev/totalRev)*100 : 0;
      cumulative += pct;
      p.revPct = pct;
      p.abc = cumulative<=80 ? 'A' : cumulative<=95 ? 'B' : 'C';
      const vals = Object.values(p.monthlyData);
      const months = Object.keys(p.monthlyData).sort((a,b)=>getDateVal(a)-getDateVal(b));
      const mean = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
      const variance = vals.length>1 ? vals.reduce((s,v)=>s+Math.pow(v-mean,2),0)/vals.length : 0;
      const cv = mean>0 ? Math.sqrt(variance)/mean : 0;
      p.xyz = cv<=0.5 ? 'X' : cv<=1.0 ? 'Y' : 'Z';
      const recent = months.slice(-3).reduce((s,m)=>s+p.monthlyData[m],0);
      const prev   = months.slice(-6,-3).reduce((s,m)=>s+p.monthlyData[m],0);
      p.trend = prev>0 ? ((recent-prev)/prev*100) : (recent>0 ? 100 : 0);
      p.avgMonthly = months.length ? p.totalRev/months.length : 0;
      // Margin — cost in ₪ (or unspecified currency) is used as-is. Cost in
      // EUR/USD is converted with the manual exchange rate from Settings when
      // one is set; without a rate the product stays flagged instead of
      // silently mixing currencies into one ₪ margin.
      const unitCostRaw = costMap[p.sku]??costMap[p.name]??null;
      const currency = currencyMap[p.sku]??currencyMap[p.name]??null;
      const isForeign = currency && currency!=='ILS';
      const rate = !isForeign ? 1 : (exchangeRates?.[currency]>0 ? exchangeRates[currency] : null);
      const costUsable = unitCostRaw!=null && rate!=null;
      p.unitCost = costUsable ? unitCostRaw*rate : null;
      p.costConverted = costUsable && isForeign ? currency : null; // margin computed via manual rate
      p.costCurrencyBlocked = unitCostRaw!=null && !costUsable ? currency : null;
      p.margin = costUsable ? p.totalRev - p.totalQty*p.unitCost : null;
      p.marginPct = (costUsable && p.totalRev>0) ? (p.margin/p.totalRev*100) : null;
    });
    return sorted;
  }, [activeTab, filteredData, costMap, currencyMap, exchangeRates]);

  const [salesViewMode, setSalesViewMode] = useState('transactions'); // 'transactions' | 'byProduct'
  const [productAbcFilter, setProductAbcFilter] = useState('all'); // 'all'|'A'|'B'|'C'
  const [productSortConfig, setProductSortConfig] = useState({ key:'totalRev', direction:'desc' });
  const sortedProductAggregates = useMemo(() => {
    const base = productAbcFilter==='all' ? productAggregates : productAggregates.filter(p=>p.abc===productAbcFilter);
    return [...base].sort((a,b)=>{
      const va=a[productSortConfig.key], vb=b[productSortConfig.key];
      const aEmpty = va===null||va===undefined; const bEmpty = vb===null||vb===undefined;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof va==='string'||typeof vb==='string') {
        const cmp = String(va).localeCompare(String(vb),'he');
        return productSortConfig.direction==='asc' ? cmp : -cmp;
      }
      return productSortConfig.direction==='asc' ? (va<vb?-1:va>vb?1:0) : (va>vb?-1:va<vb?1:0);
    });
  }, [productAggregates, productSortConfig, productAbcFilter]);
  const [productPage, setProductPage] = useState(1);
  useEffect(() => setProductPage(1), [productAggregates, productAbcFilter]);
  const productTotalPages = Math.ceil(sortedProductAggregates.length / itemsPerPage) || 1;
  const paginatedProducts = useMemo(() => sortedProductAggregates.slice((productPage-1)*itemsPerPage, productPage*itemsPerPage), [sortedProductAggregates, productPage]);
  const requestProductSort = (key) => setProductSortConfig(p=>({ key, direction:p.key===key&&p.direction==='asc'?'desc':'asc' }));
  // Trend chart popup for the "by product" sales view — built from full salesData
  // (not the currently filtered rows), so the chart always shows up to 12 months
  // of real history regardless of whatever date range is active in the table.
  const [salesTrendHover, setSalesTrendHover] = useState(null); // {key, rect}
  useEffect(() => {
    if (!salesTrendHover) return;
    const close = () => setSalesTrendHover(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [salesTrendHover]);
  const getProductMonthlyRevenue = useCallback((p) => {
    const rows = salesData.filter(d => (p.sku && d.sku===p.sku) || (!p.sku && d.description===p.name));
    const byMonth = {};
    rows.forEach(d => { if (!d.date) return; byMonth[d.date]=(byMonth[d.date]||0)+(d.total||0); });
    const months = Object.keys(byMonth).sort((a,b)=>getDateVal(a)-getDateVal(b)).slice(-12);
    return months.map(m=>({ month:m, total:byMonth[m] }));
  }, [salesData]);
  const SalesTrendButton = (p) => {
    const trendCls = !p.trend?(isDarkMode?'text-slate-500':'text-slate-400'):p.trend>0?'text-emerald-500':'text-red-500';
    const isOpen = salesTrendHover?.key===(p.sku||p.name);
    return (
      <span className="relative inline-block" style={{lineHeight:0}}>
        <button
          onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();const k=p.sku||p.name;setSalesTrendHover(prev=>prev?.key===k?null:{key:k,rect:r});}}
          className={`flex items-center gap-1 text-xs font-bold whitespace-nowrap rounded px-1 -mx-1 transition-opacity ${trendCls} ${isOpen?'opacity-100 underline':'hover:opacity-70'}`}
          title="לחץ לגרף מגמה">
          {p.trend>5?<ArrowUpRight className="w-3.5 h-3.5"/>:p.trend<-5?<ArrowDownRight className="w-3.5 h-3.5"/>:<Minus className="w-3.5 h-3.5"/>}
          {p.trend?`${Math.abs(p.trend).toFixed(0)}%`:'—'}
        </button>
        {isOpen && (() => {
          const series = getProductMonthlyRevenue(p);
          const avg = series.length ? series.reduce((s,d)=>s+d.total,0)/series.length : 0;
          return (
          <div className={`rounded-2xl border shadow-2xl text-right ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}
            onClick={e=>e.stopPropagation()}
            style={{
              position:'fixed', zIndex:9999, width: Math.min(440, window.innerWidth-16), padding:'16px', lineHeight:'normal',
              ...(salesTrendHover?.rect ? {
                ...(salesTrendHover.rect.top > 350
                  ? { bottom: window.innerHeight - salesTrendHover.rect.top + 8 }
                  : { top: salesTrendHover.rect.bottom + 8 }),
                ...(()=>{
                  const popupW = Math.min(440, window.innerWidth - 16);
                  const wantedRight = window.innerWidth - salesTrendHover.rect.right + 8;
                  const right = Math.max(8, Math.min(wantedRight, window.innerWidth - popupW - 8));
                  return { right };
                })(),
              } : { top:100, right:8 })
            }}>
            <div className="flex items-center justify-between mb-2 gap-3">
              <p className={`text-sm font-bold shrink-0 ${isDarkMode?'text-white':'text-slate-800'}`}>📈 גרף הכנסה — 12 חודשים</p>
              <button onClick={e=>{e.stopPropagation();setSalesTrendHover(null);}}
                className={`shrink-0 p-1 rounded-full transition-colors ${isDarkMode?'hover:bg-slate-700 text-slate-400 hover:text-white':'hover:bg-slate-100 text-slate-400 hover:text-slate-700'}`}>
                <X className="w-4 h-4"/>
              </button>
            </div>
            <p className={`text-xs truncate mb-3 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{p.name}</p>
            {!series.length ? (
              <p className={`text-xs py-8 text-center ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין מספיק נתונים להצגת גרף</p>
            ) : (
              <>
                <div style={{width: Math.min(408, window.innerWidth-48), height:200}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{top:5,right:5,bottom:0,left:-15}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode?'#334155':'#e2e8f0'} vertical={false}/>
                      <XAxis dataKey="month" tick={{fontSize:10, fill:isDarkMode?'#94a3b8':'#64748b'}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10, fill:isDarkMode?'#94a3b8':'#64748b'}} axisLine={false} tickLine={false} width={32} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
                      <RechartsTooltip
                        content={({active, payload, label}) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload;
                          if (!row) return null;
                          const diff = avg>0 ? Math.round((row.total/avg - 1)*100) : null;
                          return (
                            <div style={{background:isDarkMode?'#1e293b':'#fff', border:`1px solid ${isDarkMode?'#334155':'#e2e8f0'}`, borderRadius:8, fontSize:12, padding:'8px 10px', direction:'rtl'}}>
                              <p style={{color:isDarkMode?'#e2e8f0':'#1e293b', fontWeight:'bold', marginBottom:4}}>{label}</p>
                              <p style={{color:isDarkMode?'#cbd5e1':'#334155'}}>{formatCurrency(row.total)}</p>
                              {diff!=null && <p style={{color: diff>=0?'#10b981':'#ef4444', fontSize:11, marginTop:2}}>{diff>=0?'+':''}{diff}% מהממוצע ({formatShort(avg)})</p>}
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="total" name="הכנסה" radius={[4,4,0,0]}>
                        {series.map((d,i)=>(
                          <Cell key={i} fill={d.total >= avg ? '#10b981' : (isDarkMode?'#475569':'#cbd5e1')}/>
                        ))}
                      </Bar>
                      {avg>0 && <Line type="monotone" dataKey={()=>avg} stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={false} name="ממוצע" isAnimationActive={false}/>}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className={`flex items-center justify-between mt-2 text-[11px] ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:'#10b981'}}/>מעל הממוצע</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed" style={{borderColor:'#3b82f6'}}/>ממוצע ({formatShort(avg)})</span>
                </div>
              </>
            )}
          </div>
          );
        })()}
      </span>
    );
  };
  const hasAnyMargin = productAggregates.some(p=>p.margin!=null);
  const productAbcCounts = useMemo(() => ({
    A: productAggregates.filter(p=>p.abc==='A').length,
    B: productAggregates.filter(p=>p.abc==='B').length,
    C: productAggregates.filter(p=>p.abc==='C').length,
  }), [productAggregates]);
  const hasBlockedCurrency = productAggregates.some(p=>p.costCurrencyBlocked);

  const requestSort = (key) => setSortConfig(p=>({ key, direction:p.key===key&&p.direction==='asc'?'desc':'asc' }));

  const navItems = [
    { id:'overview', label:'סקירה כללית', icon:Home, color:'text-sky-400' },
    { id:'sales', label:'מכירות', icon:TrendingUp, color:'text-blue-400' },
    { id:'customers', label:'לקוחות', icon:User, color:'text-pink-400' },
    // "רכש וספקים" and "תכנון רכש" are one screen now; the old spend analytics stay reachable from "מחירי רכש".
    { id:'procurement', label:'רכש', icon:ShoppingCart, color:'text-orange-400' },
    { id:'summary', label:'רווח והפסד', icon:BarChart3, color:'text-violet-400' },
  ];

  if (!idbReady) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${isDarkMode?'bg-slate-950':'bg-slate-50'}`} dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className={`w-8 h-8 animate-spin ${isDarkMode?'text-blue-400':'text-blue-600'}`}/>
          <p className={`text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>טוען נתונים...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen font-sans transition-colors duration-300 ${isDarkMode?'bg-slate-950 text-slate-100':'bg-slate-50 text-slate-800'}`} dir="rtl">
      <SettingsModal isOpen={settingsOpen} onClose={()=>setSettingsOpen(false)} apiKey={apiKey} onSave={setApiKey} isDarkMode={isDarkMode} exchangeRates={exchangeRates} onSaveRates={setExchangeRates}/>
      <AIModal isOpen={aiModalOpen} onClose={()=>setAiModalOpen(false)} loading={aiLoading} report={aiReport} isDarkMode={isDarkMode}/>
      <ClearModal isOpen={clearModalOpen} onClose={()=>setClearModalOpen(false)} onConfirm={handleClearData} type={activeTab} isDarkMode={isDarkMode}/>

      {/* Undo toast — appears after clearing a dataset, active for 10s */}
      {undoToast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border animate-in fade-in slide-in-from-bottom-2 duration-200 ${isDarkMode?'bg-slate-800 border-slate-700 text-slate-200':'bg-slate-900 border-slate-700 text-slate-100'}`}>
          <Trash2 className="w-4 h-4 text-red-400 shrink-0"/>
          <span className="text-sm">{undoToast.label}</span>
          <button onClick={undoToast.onUndo} className="text-sm font-bold text-blue-400 hover:text-blue-300 shrink-0">שחזר</button>
          <button onClick={()=>setUndoToast(null)} className="opacity-50 hover:opacity-100 shrink-0"><X className="w-3.5 h-3.5"/></button>
        </div>
      )}

      {/* FAB Chat */}
      <div className="fixed bottom-6 left-6 z-40">
        {!chatOpen && <button onClick={()=>setChatOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-xl hover:scale-105 transition-all shadow-blue-500/30"><MessageSquare className="w-6 h-6"/></button>}
        <ChatWindow isOpen={chatOpen} onClose={()=>setChatOpen(false)} onSend={sendChat} messages={chatMessages} thinking={chatThinking} isDarkMode={isDarkMode}/>
      </div>

      {/* Mobile overlay */}
      {isMobileMenuOpen && <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={()=>setIsMobileMenuOpen(false)}/>}

      {/* Sidebar */}
      <div className={`flex-shrink-0 flex flex-col transition-all duration-300 border-l
        ${isSidebarCollapsed?'w-[68px]':'w-60'}
        ${isDarkMode?'bg-slate-900 border-slate-800':'bg-slate-900 border-slate-800'}
        max-md:fixed max-md:top-0 max-md:right-0 max-md:h-full max-md:z-40
        ${isMobileMenuOpen?'max-md:translate-x-0':'max-md:translate-x-full'}
        max-md:!w-64 max-md:transition-transform`}>
        <div className="p-4 flex items-center justify-between border-b border-white/10 h-16">
          <div className={`flex items-center gap-2.5 ${isSidebarCollapsed?'justify-center w-full':''}`}>
            <div className="bg-blue-600 p-1.5 rounded-lg shrink-0"><LayoutDashboard className="w-4 h-4 text-white"/></div>
            {!isSidebarCollapsed && <span className="text-white font-bold tracking-tight text-lg">BizData <span className="text-blue-400 text-xs font-normal">PRO</span></span>}
          </div>
          {!isSidebarCollapsed && <button onClick={()=>setIsSidebarCollapsed(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"><ChevronRight className="w-4 h-4"/></button>}
        </div>
        <nav className="flex-1 p-3 space-y-1 pt-4">
          {isSidebarCollapsed && <button onClick={()=>setIsSidebarCollapsed(false)} className="w-full flex justify-center p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl mb-3"><ChevronLeft className="w-4 h-4"/></button>}
          {navItems.map(item=>(
            <button key={item.id} onClick={()=>{setActiveTab(item.id);resetFilters();setIsMobileMenuOpen(false);}}
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-200 ${isSidebarCollapsed?'justify-center':''} ${activeTab===item.id?'bg-white/10 text-white':'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
              <item.icon className={`w-5 h-5 shrink-0 ${activeTab===item.id?item.color:''}`}/>
              {!isSidebarCollapsed && <span className="text-sm font-medium">{item.label}</span>}
              {!isSidebarCollapsed && activeTab===item.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400"/>}
            </button>
          ))}
        </nav>
        <div className={`p-3 border-t border-white/10 space-y-2`}>
          <button type="button" onClick={requestPrioritySync} title="מושך מכירות, לקוחות, מלאי, הזמנות רכש וחשבוניות ספק מ-Priority"
            className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors group hover:bg-white/10 ${isSidebarCollapsed?'justify-center':''}`}>
            <Activity className="w-5 h-5 text-emerald-400 shrink-0 group-hover:text-emerald-300"/>
            {!isSidebarCollapsed && <span className="text-sm font-medium text-slate-300 group-hover:text-white text-right">סנכרן מ-Priority{lastSyncAt && <span className="block text-[11px] text-slate-500">לאחרונה {new Date(lastSyncAt).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>}</span>}
          </button>
          <label className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors group ${isSidebarCollapsed?'justify-center':''} ${loading?'opacity-50':'hover:bg-white/10'}`}>
            {loading?<Loader2 className="w-5 h-5 animate-spin text-blue-400 shrink-0"/>:<Upload className="w-5 h-5 text-blue-400 shrink-0 group-hover:text-blue-300"/>}
            {!isSidebarCollapsed && <span className="text-sm font-medium text-slate-300 group-hover:text-white">טען קבצים</span>}
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={handleFileUpload} className="hidden" disabled={loading}/>
          </label>
          {storageWarning && !isSidebarCollapsed && <div className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg flex items-center gap-2"><AlertTriangle className="w-3 h-3 shrink-0"/>אחסון מלא</div>}
          {(salesData.length>0||suppliersData.length>0) && (
            <button onClick={()=>setClearModalOpen(true)} className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-red-400 hover:bg-red-400/10 transition-colors ${isSidebarCollapsed?'justify-center':''}`}>
              <Trash2 className="w-5 h-5 shrink-0"/>
              {!isSidebarCollapsed && <span className="text-sm font-medium">נקה נתונים</span>}
            </button>
          )}
          {!isSidebarCollapsed && typeof __BUILD_TIME__ !== 'undefined' && <p className="px-2.5 text-[10px] text-slate-600" title="אם התאריך כאן ישן — רענן את הדף (Ctrl+Shift+R)">גרסה {new Date(__BUILD_TIME__).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        {/* Header */}
        <header className={`px-6 py-0 h-16 flex items-center justify-between border-b z-10 transition-colors ${isDarkMode?'bg-slate-900 border-slate-800':'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3">
            <h1 className={`text-lg font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>
              {navItems.find(n=>n.id===activeTab)?.label}
            </h1>
            {activeTab!=='overview'&&activeTab!=='summary'&&activeFileNames.length>0 && (
              <div className="flex items-center gap-1.5">
                {activeFileNames.slice(0,2).map((n,i)=>(
                  <span key={i} className={`px-2 py-0.5 rounded-md text-[10px] border flex items-center gap-1 ${isDarkMode?'bg-slate-800 border-slate-700 text-slate-400':'bg-slate-100 border-slate-200 text-slate-500'}`}>
                    <FileSpreadsheet className="w-2.5 h-2.5 text-emerald-500"/>{n.slice(0,12)}{n.length>12?'…':''}
                  </span>
                ))}
                {activeFileNames.length>2 && <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>+{activeFileNames.length-2}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Global search — across products (sales) and suppliers */}
            <div className="relative hidden md:block" data-global-search>
              <Search className={`absolute right-3 top-2.5 w-3.5 h-3.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
              <input type="text" value={globalQuery}
                onChange={e=>{setGlobalQuery(e.target.value); setGlobalSearchOpen(true);}}
                onFocus={()=>setGlobalSearchOpen(true)}
                placeholder="חיפוש מוצר / ספק בכל האפליקציה..."
                className={`pr-9 pl-3 py-2 border rounded-xl text-xs w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-800 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
              {globalSearchOpen && globalQuery.trim().length>=2 && (
                <div className={`absolute left-0 top-full mt-1.5 w-72 rounded-xl shadow-2xl border p-2 z-50 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
                  {globalSearchResults.products.length===0 && globalSearchResults.suppliers.length===0 ? (
                    <p className={`text-xs text-center py-3 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>לא נמצאו תוצאות</p>
                  ) : (
                    <>
                      {globalSearchResults.products.length>0 && (
                        <div className="mb-2">
                          <p className={`text-[10px] font-bold px-2 mb-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>מוצרים</p>
                          {globalSearchResults.products.map(name => (
                            <div key={name} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs group ${isDarkMode?'hover:bg-slate-700/50':'hover:bg-slate-50'}`}>
                              <span className={`flex-1 truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{name}</span>
                              <button onClick={()=>{jumpToSales(name); setGlobalSearchOpen(false); setGlobalQuery('');}} className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}>מכירות</button>
                              <button onClick={()=>{jumpToProcurement(name); setGlobalSearchOpen(false); setGlobalQuery('');}} className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${isDarkMode?'bg-orange-500/20 text-orange-300':'bg-orange-50 text-orange-700'}`}>רכש</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {globalSearchResults.suppliers.length>0 && (
                        <div>
                          <p className={`text-[10px] font-bold px-2 mb-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>ספקים</p>
                          {globalSearchResults.suppliers.map(name => (
                            <button key={name} onClick={()=>{setActiveTab('suppliers'); setSelectedSupplier(name); setGlobalSearchOpen(false); setGlobalQuery('');}}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-right ${isDarkMode?'hover:bg-slate-700/50 text-slate-200':'hover:bg-slate-50 text-slate-700'}`}>
                              <Truck className="w-3 h-3 shrink-0 opacity-50"/>
                              <span className="flex-1 truncate">{name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {/* Quick date filters */}
            {availableDates.length>0 && (
              <div className={`hidden xl:flex items-center p-1 rounded-lg border gap-0.5 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-slate-100 border-slate-200'}`}>
                {[[3,'3 חודשים'],['year','השנה'],[null,'הכל']].map(([f,l])=>(
                  <button key={l} onClick={()=>setQuickDate(f)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isDarkMode?'text-slate-400 hover:bg-slate-700 hover:text-white':'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'}`}>{l}</button>
                ))}
              </div>
            )}
            <button onClick={()=>setExcludeCurrentMonth(p=>!p)}
              title="חלק מהלקוחות מתחייבים רק בסוף/תחילת חודש, אז החודש הנוכחי בדרך כלל חסר. כשמופעל, האפליקציה מתעלמת מהחודש האחרון בחישובי ממוצע/מגמה/תחזית/נטישה (אבל עדיין מציגה אותו בטבלאות וגרפים)."
              className={`flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${excludeCurrentMonth?(isDarkMode?'bg-orange-500/10 border-orange-500/30 text-orange-300':'bg-orange-50 border-orange-200 text-orange-700'):(isDarkMode?'border-slate-700 text-slate-500 hover:text-slate-300':'border-slate-200 text-slate-400 hover:text-slate-600')}`}>
              <Calendar className="w-3.5 h-3.5 shrink-0"/>
              <span className="hidden sm:inline whitespace-nowrap">חודש נוכחי לא סופי</span>
              <div className={`relative w-7 h-4 rounded-full shrink-0 transition-colors ${excludeCurrentMonth?'bg-orange-500':(isDarkMode?'bg-slate-600':'bg-slate-300')}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${excludeCurrentMonth?'translate-x-0.5':'translate-x-3.5'}`}/>
              </div>
            </button>
            {/* Backup reminder — a small header button instead of a full-width banner on every page */}
            {backupReminderDays !== null && idbLoadFailed.length === 0 && (
              <button type="button" onClick={()=>setSettingsOpen(true)}
                title={backupReminderDays === -1 ? 'עדיין לא יצרת קובץ גיבוי. הנתונים שמורים רק בדפדפן הזה — ניקוי היסטוריה או תקלה ימחקו אותם.' : `עברו ${backupReminderDays} ימים מהגיבוי האחרון`}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold ${isDarkMode?'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25':'bg-orange-50 text-orange-800 hover:bg-orange-100'}`}>
                <FileSpreadsheet className="w-3.5 h-3.5"/>{backupReminderDays === -1 ? 'אין גיבוי' : `גיבוי לפני ${backupReminderDays} ימים`}
              </button>
            )}
            {/* One menu for the rarely-used controls: theme, notifications, settings, backup */}
            <div className="relative">
              <button type="button" onClick={()=>setHeaderMenuOpen(p=>!p)} aria-expanded={headerMenuOpen} aria-label="עוד — מצב כהה, התראות, הגדרות"
                className={`relative p-2.5 rounded-xl transition-all ${isDarkMode?'bg-slate-800 text-slate-300 hover:bg-slate-700':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                <MoreHorizontal className="w-4 h-4"/>
                {(notifications.length>0 || !apiKey) && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 rounded-full"/>}
              </button>
              {headerMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={()=>setHeaderMenuOpen(false)}/>
                  <div role="menu" className={`absolute left-0 mt-2 w-80 rounded-xl shadow-2xl border p-2 z-50 animate-in fade-in zoom-in duration-150 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
                    <button role="menuitem" type="button" onClick={()=>{toggleTheme(); setHeaderMenuOpen(false);}}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-right ${isDarkMode?'text-slate-200 hover:bg-slate-700':'text-slate-700 hover:bg-slate-50'}`}>
                      {isDarkMode?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}{isDarkMode?'מצב בהיר':'מצב כהה'}
                    </button>
                    <button role="menuitem" type="button" onClick={()=>{setSettingsOpen(true); setHeaderMenuOpen(false);}}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-right ${isDarkMode?'text-slate-200 hover:bg-slate-700':'text-slate-700 hover:bg-slate-50'}`}>
                      <Settings className="w-4 h-4"/>הגדרות, שערי מטבע וגיבוי
                      {!apiKey && <span className={`mr-auto whitespace-nowrap text-[11px] font-semibold px-1.5 py-0.5 rounded ${isDarkMode?'bg-orange-500/15 text-orange-300':'bg-orange-50 text-orange-800'}`}>חסר מפתח AI</span>}
                    </button>
                    {backupReminderDays !== null && (
                      <button role="menuitem" type="button" onClick={()=>{snoozeBackupReminder(); setHeaderMenuOpen(false);}}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-right ${isDarkMode?'text-slate-200 hover:bg-slate-700':'text-slate-700 hover:bg-slate-50'}`}>
                        <Bell className="w-4 h-4"/>הזכר לי לגבות בעוד 3 ימים
                      </button>
                    )}
                    <div className={`mt-1 pt-2 border-t px-3 ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
                      <p className={`text-xs font-semibold mb-2 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>התראות</p>
                      {notifications.length>0 ? notifications.map(n=>(
                        <div key={n.id} className={`p-2 rounded-lg text-xs flex items-start gap-2 mb-1.5 ${n.type==='success'?(isDarkMode?'bg-emerald-500/10 text-emerald-300':'bg-emerald-50 text-emerald-800'):n.type==='warning'?(isDarkMode?'bg-orange-500/10 text-orange-300':'bg-orange-50 text-orange-800'):(isDarkMode?'bg-blue-500/10 text-blue-300':'bg-blue-50 text-blue-800')}`}>
                          {n.text}
                        </div>
                      )) : <p className={`text-xs pb-2 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין התראות</p>}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button type="button" onClick={generateAI} className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">
              <Sparkles className="w-4 h-4"/>
              <span className="hidden sm:inline">תובנות AI</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="relative flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
          {/* IDB load failure — surfaced loudly instead of silently losing data */}
          {idbLoadFailed.length > 0 && (
            <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl border-2 ${isDarkMode?'bg-red-500/10 border-red-500/40 text-red-300':'bg-red-50 border-red-300 text-red-800'}`}>
              <TriangleAlert className="w-5 h-5 shrink-0 mt-0.5"/>
              <div className="flex-1 text-sm">
                <p className="font-bold">חלק מהנתונים לא נטענו מהאחסון המקומי</p>
                <p className="text-xs mt-1 opacity-80">
                  קריאה מ-IndexedDB נכשלה עבור: {idbLoadFailed.map(k=>({dashboardSalesData:'מכירות',dashboardSuppliersData:'רכש וספקים',customerMonthlyData:'לקוחות (חודשי)',customerProductData:'לקוחות (מוצרים)'}[k]||k)).join(', ')}.
                  כדי להגן על הנתונים השמורים, שינויים בנתונים אלה <b>לא נשמרים</b> כרגע. רענן את הדף — ברוב המקרים זו תקלה חולפת. אם זה חוזר, ייצא גיבוי ממחשב אחר או בדוק שהדפדפן לא במצב פרטי.
                </p>
              </div>
              <button onClick={()=>window.location.reload()} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold ${isDarkMode?'bg-red-500/20 hover:bg-red-500/30':'bg-red-100 hover:bg-red-200'}`}>רענן דף</button>
            </div>
          )}
          {/* Overview */}
          {activeTab==='overview' && (
            <OverviewPage salesData={salesData} suppliersData={suppliersData} dateFilter={dateFilter} availableDates={availableDates} isDarkMode={isDarkMode} setActiveTab={setActiveTab} excludeCurrentMonth={excludeCurrentMonth}/>
          )}

          {/* Customers */}
          {activeTab==='customers' && (
            <CustomersPage
              monthlyData={customerMonthlyEff}
              productData={customerProductEff}
              priorityRange={salesLinesRange}
              customerCards={priorityCustomers}
              onSyncPriority={requestPrioritySync}
              lastSyncAt={lastSyncAt}
              fileCounts={{ monthly: customerMonthlyData.length, product: customerProductData.length }}
              isDarkMode={isDarkMode}
              fileNames={{ monthly:customerMonthlyFileName, product:customerProductFileName }}
              onUploadMonthly={handleCustomerMonthlyUpload}
              onUploadProduct={handleCustomerProductUpload}
              onClearMonthly={clearCustomerMonthly}
              onClearProduct={clearCustomerProduct}
              loading={customerUploadLoading}
              uploadError={customerUploadError}
              uploadSuccess={customerUploadSuccess}
              onDismissError={()=>setCustomerUploadError(null)}
              excludeCurrentMonth={excludeCurrentMonth}
            />
          )}

          {/* Procurement Planning */}
          {activeTab==='procurement' && (
            <ProcurementPage syncRequest={syncRequest} onSyncRequestHandled={()=>setSyncRequest(null)} onSyncDone={setLastSyncAt} onSalesLinesChange={setProcSalesLines} onCustomersChange={setPriorityCustomers} salesData={salesFileData} suppliersData={suppliersData} onOpenSupplierAnalytics={()=>setActiveTab('suppliers')} isDarkMode={isDarkMode} apiKey={apiKey} costMap={costMap} setCostMap={setCostMap} currencyMap={currencyMap} setCurrencyMap={setCurrencyMap} exchangeRates={exchangeRates} jumpTo={procurementJumpTo} onJumpToSales={jumpToSales} excludeCurrentMonth={excludeCurrentMonth} otherSources={otherSources} />
          )}

          {/* Summary */}
          {activeTab==='summary' && (
            summaryData ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <KPICard title="הכנסות" formatted={formatShort(summaryData.totalIncome)} icon={DollarSign} color="blue" isDarkMode={isDarkMode}/>
                  <KPICard title="הוצאות" formatted={formatShort(summaryData.totalExpenses)} icon={Wallet} color="red" isDarkMode={isDarkMode}/>
                  <KPICard title="רווח נקי" formatted={formatShort(summaryData.totalProfit)} icon={Activity} color={summaryData.totalProfit>=0?'green':'red'} subtext={`${summaryData.profitMargin.toFixed(1)}% מרווח`} isDarkMode={isDarkMode}/>
                </div>
                <div className={`p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                  <div className="flex justify-between items-center mb-5">
                    <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><BarChart3 className="w-5 h-5 text-indigo-500"/>ניתוח רווח והפסד</h3>
                    <button onClick={handleExport} className={`p-2 rounded-lg ${isDarkMode?'hover:bg-slate-700 text-slate-400':'hover:bg-slate-100 text-slate-500'}`}><Download className="w-4 h-4"/></button>
                  </div>
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={summaryData.chart} margin={{top:10,right:20,left:0,bottom:5}}>
                      <defs>
                        <linearGradient id="gradP" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.12}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode?'#334155':'#f1f5f9'}/>
                      <XAxis dataKey="name" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickMargin={8}/>
                      <YAxis stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v/1000}k`}/>
                      <RechartsTooltip formatter={v=>formatCurrency(v)} contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#fff':'#0f172a'}}/>
                      <Legend iconType="circle" wrapperStyle={{paddingTop:'16px',fontSize:'12px'}}/>
                      <Bar dataKey="income" name="הכנסות" fill="#3b82f6" radius={[4,4,0,0]} barSize={24}/>
                      <Bar dataKey="expenses" name="הוצאות" fill="#ef4444" radius={[4,4,0,0]} barSize={24}/>
                      <Area type="monotone" dataKey="profit" name="רווח נקי" stroke="#10b981" fill="url(#gradP)" strokeWidth={2.5} dot={false}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-96 text-center animate-in fade-in zoom-in duration-500">
                <div className="relative mb-4">
                  <div className={`absolute inset-0 rounded-full blur-2xl opacity-40 ${isDarkMode?'bg-blue-600':'bg-blue-300'}`}/>
                  <div className={`relative p-6 rounded-full ${isDarkMode?'bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700':'bg-gradient-to-br from-slate-50 to-white border border-slate-100'}`}><BarChart3 className={`w-12 h-12 ${isDarkMode?'text-slate-500':'text-slate-300'}`}/></div>
                </div>
                <h3 className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>אין נתונים לסיכום</h3>
                <p className={`mt-2 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>טען קבצי מכירות וספקים כדי לראות סיכום פיננסי.</p>
              </div>
            )
          )}

          {/* Sales / Suppliers */}
          {(activeTab==='sales'||activeTab==='suppliers') && (
            activeData.length===0 ? <EmptyState onUpload={handleFileUpload} loading={loading} isDarkMode={isDarkMode} activeTab={activeTab} onSync={requestPrioritySync}/> : (
              <div className="space-y-6 animate-in fade-in duration-400">
                {activeTab==='sales' && <PrioritySyncBar isDarkMode={isDarkMode} range={salesLinesRange} lastSyncAt={lastSyncAt} onSync={requestPrioritySync} what="נתוני המכירות"/>}
                {/* Filters Bar */}
                <div className={`p-4 rounded-2xl border flex flex-wrap gap-3 items-center ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                  <div className={`p-2 rounded-xl ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}><Filter className={`w-4 h-4 ${isDarkMode?'text-slate-300':'text-slate-500'}`}/></div>
                  {activeTab==='sales' ? (
                    <>
                      <div className="w-64"><Autocomplete options={uniqueItems.products} value={selectedProduct} onChange={v=>{setSelectedProduct(v);setSelectedSku('');}} placeholder="בחר מוצרים..." icon={Box} multiple maxSelections={5} isDarkMode={isDarkMode}/></div>
                      <div className="w-44"><Autocomplete options={uniqueItems.skus} value={selectedSku} onChange={v=>{setSelectedSku(v);setSelectedProduct([]);}} placeholder="מק״ט..." icon={Tag} isDarkMode={isDarkMode}/></div>
                    </>
                  ) : (
                    <div className="w-72"><Autocomplete options={uniqueItems.suppliers} value={selectedSupplier} onChange={setSelectedSupplier} placeholder="בחר ספק..." icon={Truck} isDarkMode={isDarkMode}/></div>
                  )}
                  {/* Date range */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${isDarkMode?'bg-slate-900 border-slate-700':'bg-slate-50 border-slate-200'}`}>
                    <Calendar className={`w-4 h-4 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
                    <select value={dateFilter.start} onChange={e=>setDateFilter(p=>({...p,start:e.target.value}))}
                      style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}}
                      className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                      {availableDates.map(d=><option key={d} value={d} style={isDarkMode?{background:'#1e293b',color:'#f8fafc'}:{}}>{d}</option>)}
                    </select>
                    <span className={isDarkMode?'text-slate-600':'text-slate-300'}>—</span>
                    <select value={dateFilter.end} onChange={e=>setDateFilter(p=>({...p,end:e.target.value}))}
                      style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}}
                      className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                      {availableDates.map(d=><option key={d} value={d} style={isDarkMode?{background:'#1e293b',color:'#f8fafc'}:{}}>{d}</option>)}
                    </select>
                  </div>
                  {(selectedProduct.length>0||selectedSku||selectedSupplier||searchTerm||drillDownMonth) && (
                    <button onClick={resetFilters} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${isDarkMode?'bg-red-500/10 text-red-400 hover:bg-red-500/20':'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                      <X className="w-3.5 h-3.5"/> נקה
                    </button>
                  )}
                  {/* Saved views */}
                  <div className="relative" data-saved-views>
                    <button onClick={()=>setShowSavedViews(p=>!p)} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-colors ${isDarkMode?'bg-orange-500/10 border-orange-500/40 text-orange-300 hover:bg-orange-500/20':'bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100'}`}>
                      <Star className="w-3.5 h-3.5 fill-current"/> תצוגות שמורות {savedViews.length>0?`(${savedViews.length})`:''}
                    </button>
                    {showSavedViews && (
                      <div className={`absolute left-0 top-full mt-1.5 w-72 rounded-xl shadow-2xl border p-3 z-50 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <input type="text" value={newViewName} onChange={e=>setNewViewName(e.target.value)} placeholder="שם לתצוגה הנוכחית..."
                            onKeyDown={e=>{if(e.key==='Enter') saveCurrentView();}}
                            className={`flex-1 px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
                          <button onClick={saveCurrentView} disabled={!newViewName.trim()} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}>שמור</button>
                        </div>
                        {savedViews.length===0 ? (
                          <p className={`text-xs text-center py-2 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין תצוגות שמורות עדיין</p>
                        ) : (
                          <div className="space-y-1 max-h-56 overflow-y-auto">
                            {savedViews.map(v => (
                              <div key={v.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs group ${isDarkMode?'hover:bg-slate-700/50':'hover:bg-slate-50'}`}>
                                <button onClick={()=>applySavedView(v)} className={`flex-1 text-right truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>
                                  ⭐ {v.name}
                                  <span className={`mr-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>· {v.activeTab==='sales'?'מכירות':'ספקים'}</span>
                                </button>
                                <button onClick={()=>deleteSavedView(v.id)} className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode?'text-red-400 hover:bg-red-500/10':'text-red-500 hover:bg-red-50'}`}>
                                  <Trash2 className="w-3 h-3"/>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* KPIs */}
                {stats && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KPICard title={activeTab==='sales'?'הכנסות':'הוצאות'} formatted={formatShort(stats.totalAmount)} icon={activeTab==='sales'?DollarSign:Wallet} color={activeTab==='sales'?'blue':'red'} trend={stats.trend} isDarkMode={isDarkMode}/>
                    <KPICard title="ממוצע חודשי" formatted={formatShort(stats.avgAmount)} icon={Activity} color="amber" subtext={`${stats.monthsCount} חודשים`} isDarkMode={isDarkMode}/>
                    <KPICard title="כמות" formatted={stats.totalQuantity.toLocaleString()} icon={Package} color="green" isDarkMode={isDarkMode}/>
                    <KPICard title={activeTab==='sales'?'מוצרים':'ספקים'} formatted={stats.uniqueCount.toLocaleString()} icon={activeTab==='sales'?Box:Truck} color="purple" isDarkMode={isDarkMode}/>
                  </div>
                )}

                {/* Charts */}
                {chartData && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Trend Chart */}
                    <div className={`lg:col-span-2 p-6 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                      <div className="flex justify-between items-center mb-5 flex-wrap gap-2">
                        <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><Calendar className="w-5 h-5 text-blue-500"/>{activeTab==='sales'?'מגמות מכירות':'מגמות הוצאות'}</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          {!showYoY && !(activeTab==='sales'&&selectedProduct.length>0) && (
                            <div className={`flex rounded-lg p-1 text-xs ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                              {[['month','חודשי'],['quarter','רבעוני']].map(([k,l])=>(
                                <button key={k} onClick={()=>setChartGranularity(k)} className={`px-2.5 py-1 rounded-md transition-all ${chartGranularity===k?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-blue-700'):'text-slate-500'}`}>{l}</button>
                              ))}
                            </div>
                          )}
                          {activeTab==='sales' && hasAnyMargin && !showYoY && (
                            <div className={`flex rounded-lg p-1 text-xs ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                              {[['quantity','כמות'],['margin','רווח %']].map(([k,l])=>(
                                <button key={k} onClick={()=>setChartMetricRight(k)} className={`px-2.5 py-1 rounded-md transition-all ${chartMetricRight===k?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-blue-700'):'text-slate-500'}`}>{l}</button>
                              ))}
                            </div>
                          )}
                          {(activeTab==='sales'||activeTab==='suppliers') && (
                            <button onClick={()=>setShowYoY(p=>!p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${showYoY?(isDarkMode?'bg-blue-500/20 border-blue-500/30 text-blue-300':'bg-blue-50 border-blue-200 text-blue-700'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white':'border-slate-200 text-slate-500 hover:text-slate-700')}`}>
                              <BarChart3 className="w-3.5 h-3.5"/> שנה/שנה
                            </button>
                          )}
                          {(activeTab==='sales'||activeTab==='suppliers') && (
                            <button onClick={()=>setShowFreeCompare(p=>!p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${showFreeCompare?(isDarkMode?'bg-purple-500/20 border-purple-500/30 text-purple-300':'bg-purple-50 border-purple-200 text-purple-700'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white':'border-slate-200 text-slate-500 hover:text-slate-700')}`}>
                              <Sliders className="w-3.5 h-3.5"/> השוואת תקופות
                            </button>
                          )}
                          {drillDownMonth && !showYoY && <button onClick={()=>setDrillDownMonth(null)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}><MousePointerClick className="w-3 h-3"/>{drillDownMonth}<X className="w-3 h-3 ml-1"/></button>}
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={300}>
                        {showYoY && yoyData ? (
                          <ComposedChart data={yoyData.rows} margin={{top:5,right:5,left:0,bottom:5}}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode?'#334155':'#f1f5f9'}/>
                            <XAxis dataKey="name" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickMargin={8}/>
                            <YAxis stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v/1000}k`}/>
                            <RechartsTooltip formatter={v=>formatCurrency(v)} contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#fff':'#0f172a'}}/>
                            <Legend iconType="circle" wrapperStyle={{paddingTop:'12px',fontSize:'12px'}}/>
                            <Bar dataKey={yoyData.curY} name={`${yoyData.curY}`} fill="#3b82f6" radius={[4,4,0,0]} barSize={18}/>
                            {yoyData.prevY && <Bar dataKey={yoyData.prevY} name={`${yoyData.prevY}`} fill={isDarkMode?'#475569':'#cbd5e1'} radius={[4,4,0,0]} barSize={18}/>}
                          </ComposedChart>
                        ) : (
                        <ComposedChart data={chartDisplayData} onClick={d=>{ if(d?.activeLabel && chartGranularity==='month') setDrillDownMonth(p=>p===d.activeLabel?null:d.activeLabel); }} style={{cursor: chartGranularity==='month'?'pointer':'default'}}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode?'#334155':'#f1f5f9'}/>
                          <XAxis dataKey="name" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickMargin={8}/>
                          <YAxis yAxisId="left" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v/1000}k`}/>
                          {activeTab==='sales' && <YAxis yAxisId="right" orientation="right" stroke={chartMetricRight==='margin'?'#a855f7':'#10b981'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={chartMetricRight==='margin'?(v=>`${v}%`):undefined}/>}
                          <RechartsTooltip cursor={{fill:isDarkMode?'#334155':'#f8fafc',opacity:0.5}} formatter={(v,n)=>n.includes('כמות')?v.toLocaleString():n==='רווח %'?(v!=null?`${v.toFixed(1)}%`:'—'):n==='ממוצע'?formatCurrency(v):formatCurrency(v)} contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#fff':'#0f172a'}}/>
                          <Legend iconType="circle" wrapperStyle={{paddingTop:'12px',fontSize:'12px'}}/>
                          {activeTab==='sales'&&selectedProduct.length>0 ? selectedProduct.map((p,i)=>(
                            <React.Fragment key={p}>
                              <Bar yAxisId="left" dataKey={p} name={p} stackId="a" fill={COLORS[i%COLORS.length]} radius={i===selectedProduct.length-1?[3,3,0,0]:[0,0,0,0]}/>
                              <Line yAxisId="right" type="monotone" dataKey={`${p}_q`} name={`${p} כמות`} stroke={COLORS[i%COLORS.length]} strokeDasharray="4 2" strokeWidth={2} dot={false}/>
                            </React.Fragment>
                          )) : activeTab==='sales' ? (
                            <>
                              <Bar yAxisId="left" dataKey="total" name="סכום" fill="#3b82f6" radius={[4,4,0,0]} barSize={28}/>
                              {chartMetricRight==='margin' && hasAnyMargin
                                ? <Line yAxisId="right" type="monotone" dataKey="marginPct" name="רווח %" stroke="#a855f7" strokeWidth={2.5} dot={false} activeDot={{r:5}} connectNulls/>
                                : <Line yAxisId="right" type="monotone" dataKey="quantity" name="כמות" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{r:5}}/>}
                            </>
                          ) : (
                            <Bar yAxisId="left" dataKey="total" name="סכום" fill="#ef4444" radius={[4,4,0,0]} barSize={28}/>
                          )}
                        </ComposedChart>
                        )}
                      </ResponsiveContainer>
                    </div>

                    {/* Pie Chart */}
                    <div className={`p-6 rounded-2xl border flex flex-col ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><PieChartIcon className="w-5 h-5 text-emerald-500"/>{activeTab==='sales'?'מובילים':'ספקים'}</h3>
                        {activeTab==='sales' && (
                          <div className={`flex rounded-lg p-1 text-xs ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                            {[['total','₪'],['quantity','כמות']].map(([k,l])=>(
                              <button key={k} onClick={()=>setPieMetric(k)} className={`px-2.5 py-1 rounded-md transition-all ${pieMetric===k?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-blue-700'):'text-slate-500'}`}>{l}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-h-[250px]">
                        {chartData.pie.length>0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <defs>
                                {COLORS.map((c,i) => (
                                  <linearGradient key={i} id={`pieGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={c} stopOpacity={1}/>
                                    <stop offset="100%" stopColor={c} stopOpacity={0.65}/>
                                  </linearGradient>
                                ))}
                              </defs>
                              <Pie data={chartData.pie} cx="50%" cy="45%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" stroke="none" style={{cursor:'pointer'}}
                                onClick={(d)=>{
                                  if (!d?.name) return;
                                  if (activeTab==='sales') setSelectedProduct(prev => prev.length===1&&prev[0]===d.name ? [] : [d.name]);
                                  else setSelectedSupplier(prev => prev===d.name ? '' : d.name);
                                }}>
                                {chartData.pie.map((_,i)=><Cell key={i} fill={`url(#pieGrad${i%COLORS.length})`}/>)}
                              </Pie>
                              <RechartsTooltip
                                formatter={(v,n,p)=>[p.payload.total?formatCurrency(p.payload.total):'', p.payload.name]}
                                contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#f1f5f9':'#0f172a'}}
                                itemStyle={{color:isDarkMode?'#94a3b8':'#64748b'}}
                                labelStyle={{color:isDarkMode?'#f1f5f9':'#0f172a',fontWeight:500}}
                              />
                              <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{fontSize:'11px',paddingTop:'12px',cursor:'pointer'}} onClick={(d)=>{
                                if (!d?.value) return;
                                if (activeTab==='sales') setSelectedProduct(prev => prev.length===1&&prev[0]===d.value ? [] : [d.value]);
                                else setSelectedSupplier(prev => prev===d.value ? '' : d.value);
                              }}/>
                            </PieChart>
                          </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-slate-400"><PieChartIcon className="w-10 h-10 opacity-20"/></div>}
                      </div>
                      <p className={`text-[11px] text-center mt-2 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>לחיצה על פרוסה מסננת את הטבלה</p>
                    </div>
                  </div>
                )}

                {/* Free period comparison */}
                {showFreeCompare && freeCompareStats && (
                  <div className={`p-6 rounded-2xl border animate-in fade-in duration-300 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                    <h3 className={`font-bold flex items-center gap-2 mb-4 ${isDarkMode?'text-white':'text-slate-800'}`}><Sliders className="w-5 h-5 text-purple-500"/>השוואת תקופות חופשית</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                      {[['א',periodA,setPeriodA,'blue'],['ב',periodB,setPeriodB,'slate']].map(([label,period,setPeriod,color])=>(
                        <div key={label} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${isDarkMode?'bg-slate-900 border-slate-700':'bg-slate-50 border-slate-200'}`}>
                          <span className={`text-xs font-bold shrink-0 px-2 py-1 rounded-lg ${color==='blue'?(isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-100 text-blue-700'):(isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-200 text-slate-600')}`}>תקופה {label}</span>
                          <select value={period.start} onChange={e=>setPeriod(p=>({...p,start:e.target.value}))} style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}} className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded flex-1 ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                            {availableDates.map(d=><option key={d} value={d}>{d}</option>)}
                          </select>
                          <span className={isDarkMode?'text-slate-600':'text-slate-300'}>—</span>
                          <select value={period.end} onChange={e=>setPeriod(p=>({...p,end:e.target.value}))} style={isDarkMode?{background:'#0f172a',color:'#f8fafc'}:{}} className={`text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer rounded flex-1 ${isDarkMode?'text-white':'text-slate-700 bg-transparent'}`}>
                            {availableDates.map(d=><option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                      {[
                        { label:'א', data:freeCompareStats.a, otherData:freeCompareStats.b, color:'blue' },
                        { label:'ב', data:freeCompareStats.b, otherData:freeCompareStats.a, color:'slate' },
                      ].map(({label,data,otherData,color}) => {
                        const revDelta = otherData.revenue>0 ? ((data.revenue-otherData.revenue)/otherData.revenue*100) : (data.revenue>0?100:0);
                        const qtyDelta = otherData.qty>0 ? ((data.qty-otherData.qty)/otherData.qty*100) : (data.qty>0?100:0);
                        return (
                          <div key={label} className={`p-4 rounded-xl border ${isDarkMode?'bg-slate-900/50 border-slate-700':'bg-slate-50 border-slate-200'}`}>
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${color==='blue'?(isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-100 text-blue-700'):(isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-200 text-slate-600')}`}>תקופה {label}</span>
                            <div className="flex items-center justify-between mt-3">
                              <div>
                                <p className={`text-xs mb-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{activeTab==='sales'?'הכנסה':'הוצאה'}</p>
                                <span className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{formatShort(data.revenue)}</span>
                                <span className={`text-xs font-bold flex items-center gap-1 mt-0.5 ${revDelta>=0?'text-emerald-500':'text-red-500'}`}>
                                  {revDelta>=0?<ArrowUpRight className="w-3 h-3"/>:<ArrowDownRight className="w-3 h-3"/>}
                                  {Math.abs(revDelta).toFixed(0)}%
                                </span>
                              </div>
                              <div className="text-left">
                                <p className={`text-xs mb-1 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>כמות</p>
                                <span className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{data.qty.toLocaleString()}</span>
                                <span className={`text-xs font-bold flex items-center gap-1 mt-0.5 justify-end ${qtyDelta>=0?'text-emerald-500':'text-red-500'}`}>
                                  {qtyDelta>=0?<ArrowUpRight className="w-3 h-3"/>:<ArrowDownRight className="w-3 h-3"/>}
                                  {Math.abs(qtyDelta).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[['א',freeCompareStats.a],['ב',freeCompareStats.b]].map(([label,data])=>(
                        <div key={label}>
                          <p className={`text-xs font-bold mb-2 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מובילים — תקופה {label}</p>
                          {data.top.length===0 ? <p className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-400'}`}>אין נתונים</p> : (
                            <div className="space-y-1.5">
                              {data.top.map((t,i) => (
                                <div key={i} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                                  <span className={`truncate ${isDarkMode?'text-slate-300':'text-slate-700'}`}>{t.name}</span>
                                  <span className={`font-bold shrink-0 ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatShort(t.total)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quarterly Analysis */}
                {activeTab==='sales' && quarterlyData && (
                  <div className={`p-6 rounded-2xl border animate-in fade-in duration-400 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                    <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                      <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
                        <Activity className="w-5 h-5 text-violet-500"/> ניתוח רבעוני
                      </h3>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block"/>
                          <span className={isDarkMode?'text-slate-400':'text-slate-500'}>{quarterlyData.curY}</span>
                          <span className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{formatShort(quarterlyData.totals[quarterlyData.curY])}</span>
                        </div>
                        {quarterlyData.prevY && <div className="flex items-center gap-2">
                          <span className={`w-3 h-3 rounded-sm inline-block ${isDarkMode?'bg-slate-600':'bg-slate-300'}`}/>
                          <span className={isDarkMode?'text-slate-400':'text-slate-500'}>{quarterlyData.prevY}</span>
                          <span className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{formatShort(quarterlyData.totals[quarterlyData.prevY])}</span>
                        </div>}
                        {quarterlyData.growth !== 0 && (
                          <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${quarterlyData.growth>=0?(isDarkMode?'bg-emerald-500/10 text-emerald-400':'bg-emerald-50 text-emerald-700'):(isDarkMode?'bg-red-500/10 text-red-400':'bg-red-50 text-red-700')}`}>
                            {quarterlyData.growth>=0?<ArrowUpRight className="w-3 h-3"/>:<ArrowDownRight className="w-3 h-3"/>}
                            {Math.abs(quarterlyData.growth).toFixed(1)}% YoY
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      {quarterlyData.rows.map(r => {
                        const diff = quarterlyData.prevY && r[quarterlyData.prevY]>0 ? ((r[quarterlyData.curY]-r[quarterlyData.prevY])/r[quarterlyData.prevY]*100) : null;
                        return (
                          <div key={r.name} className={`p-4 rounded-xl border ${isDarkMode?'bg-slate-700/50 border-slate-600':'bg-slate-50 border-slate-200'}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-xs font-bold ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{r.name}</span>
                              {diff !== null && <span className={`text-xs font-bold ${diff>=0?'text-emerald-500':'text-red-500'}`}>{diff>=0?'+':''}{diff.toFixed(0)}%</span>}
                            </div>
                            <div className={`text-lg font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{formatShort(r[quarterlyData.curY])}</div>
                            {quarterlyData.prevY && <div className={`text-xs mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{quarterlyData.prevY}: {formatShort(r[quarterlyData.prevY])}</div>}
                            <div className={`mt-3 h-1.5 rounded-full overflow-hidden ${isDarkMode?'bg-slate-600':'bg-slate-200'}`}>
                              <div className="h-full bg-blue-500 rounded-full" style={{width: quarterlyData.totals[quarterlyData.curY]>0 ? `${(r[quarterlyData.curY]/quarterlyData.totals[quarterlyData.curY]*100).toFixed(0)}%` : '0%'}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={quarterlyData.rows} margin={{top:5,right:5,left:0,bottom:5}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode?'#334155':'#f1f5f9'}/>
                        <XAxis dataKey="name" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:12}} axisLine={false} tickLine={false}/>
                        <YAxis stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v/1000}k`}/>
                        <RechartsTooltip formatter={v=>formatCurrency(v)} contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#fff':'#0f172a'}}/>
                        <Legend iconType="circle" wrapperStyle={{fontSize:'12px',paddingTop:'8px'}}/>
                        <Bar dataKey={quarterlyData.curY} name={`${quarterlyData.curY}`} fill="#3b82f6" radius={[4,4,0,0]} barSize={32}/>
                        {quarterlyData.prevY && <Bar dataKey={quarterlyData.prevY} name={`${quarterlyData.prevY}`} fill={isDarkMode?'#475569':'#cbd5e1'} radius={[4,4,0,0]} barSize={32}/>}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* View toggle — only relevant for sales (margin/ABC needs cost data, suppliers tab has no margin concept) */}
                {activeTab==='sales' && (
                  <div className="flex items-center gap-2">
                    <button onClick={()=>setSalesViewMode('transactions')} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${salesViewMode==='transactions'?(isDarkMode?'bg-blue-500/20 border-blue-500/30 text-blue-300':'bg-blue-50 border-blue-200 text-blue-700'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white':'border-slate-200 text-slate-500 hover:text-slate-700')}`}>
                      <FileText className="w-3.5 h-3.5"/> פירוט עסקאות
                    </button>
                    <button onClick={()=>setSalesViewMode('byProduct')} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${salesViewMode==='byProduct'?(isDarkMode?'bg-blue-500/20 border-blue-500/30 text-blue-300':'bg-blue-50 border-blue-200 text-blue-700'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white':'border-slate-200 text-slate-500 hover:text-slate-700')}`}>
                      <Box className="w-3.5 h-3.5"/> לפי מוצר
                    </button>
                  </div>
                )}

                {/* Table — raw transactions */}
                {!(activeTab==='sales' && salesViewMode==='byProduct') && (
                <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                  <div className={`px-5 py-4 border-b flex flex-wrap justify-between items-center gap-3 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                    <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><FileText className="w-4 h-4 text-slate-400"/> פירוט עסקאות <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500'}`}>{filteredData.length.toLocaleString()}</span></h3>
                    <div className="flex items-center gap-2">
                      {/* Column visibility */}
                      <div className="relative">
                        <button onClick={()=>setShowColumnMenu(p=>!p)} className={`p-2 rounded-xl ${isDarkMode?'bg-slate-700 text-slate-300 hover:bg-slate-600':'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}><Settings className="w-4 h-4"/></button>
                        {showColumnMenu && (
                          <div className={`absolute left-0 top-full mt-1.5 w-44 rounded-xl shadow-xl border p-2 z-50 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
                            {Object.entries({date:'תאריך',sku:'מק״ט',description:'תיאור',quantity:'כמות',total:'סכום'}).map(([k,l])=>(
                              <button key={k} onClick={()=>setVisibleColumns(p=>({...p,[k]:!p[k]}))} className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${isDarkMode?'hover:bg-slate-700 text-slate-300':'hover:bg-slate-50 text-slate-700'}`}>
                                {l}{visibleColumns[k]?<Eye className="w-3.5 h-3.5 text-blue-500"/>:<EyeOff className="w-3.5 h-3.5 text-slate-400"/>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={handleExport} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${isDarkMode?'bg-emerald-900/20 border-emerald-800 text-emerald-400 hover:bg-emerald-900/40':'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>
                        <Download className="w-3.5 h-3.5"/><span className="hidden sm:inline">ייצוא</span>
                      </button>
                      <div className="relative">
                        <Search className={`absolute right-3 top-2.5 w-3.5 h-3.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
                        <input type="text" placeholder="חיפוש... (השתמש ב * להשלמה, למשל: מנוע*1000)" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                          className={`pl-4 pr-9 py-2 border rounded-xl text-xs w-40 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[460px]">
                    <table className={`w-full text-sm text-right ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                      <thead className={`text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                        <tr>
                          {visibleColumns.date && <th className={`px-5 py-3.5 cursor-pointer select-none hover:text-blue-500 transition-colors`} onClick={()=>requestSort('date')}>תאריך<SortIcon colKey="date" sortConfig={sortConfig}/></th>}
                          {visibleColumns.sku && activeTab==='sales' && <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestSort('sku')}>מק״ט<SortIcon colKey="sku" sortConfig={sortConfig}/></th>}
                          {visibleColumns.description && <th className={`px-5 py-3.5 cursor-pointer select-none hover:text-blue-500`} onClick={()=>requestSort(activeTab==='sales'?'description':'supplier')}>{activeTab==='sales'?'מוצר':'ספק'}<SortIcon colKey={activeTab==='sales'?'description':'supplier'} sortConfig={sortConfig}/></th>}
                          {visibleColumns.quantity && <th className={`px-5 py-3.5 cursor-pointer select-none hover:text-blue-500`} onClick={()=>requestSort('quantity')}>כמות<SortIcon colKey="quantity" sortConfig={sortConfig}/></th>}
                          {visibleColumns.total && <th className={`px-5 py-3.5 cursor-pointer select-none hover:text-blue-500`} onClick={()=>requestSort('total')}>סכום<SortIcon colKey="total" sortConfig={sortConfig}/></th>}
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                        {paginatedData.length>0 ? paginatedData.map(row=>(
                          <tr key={row.id} className={`transition-colors ${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50/80'}`}>
                            {visibleColumns.date && <td className={`px-5 py-3.5 text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{row.date}</td>}
                            {visibleColumns.sku && activeTab==='sales' && <td className={`px-5 py-3.5 font-mono text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{row.sku}</td>}
                            {visibleColumns.description && <td className={`px-5 py-3.5 font-medium ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{activeTab==='sales'?row.description:row.supplier}</td>}
                            {visibleColumns.quantity && <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded-md text-xs font-medium ${isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-100 text-slate-600'}`}>{row.quantity}</span></td>}
                            {visibleColumns.total && <td className={`px-5 py-3.5 font-bold tabular-nums ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatCurrency(row.total)}</td>}
                          </tr>
                        )) : <tr><td colSpan={5} className={`px-5 py-16 text-center text-sm ${isDarkMode?'text-slate-600':'text-slate-400'}`}>לא נמצאו נתונים</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className={`px-5 py-3.5 border-t flex justify-between items-center text-xs ${isDarkMode?'bg-slate-900/30 border-slate-700 text-slate-500':'bg-slate-50 border-slate-100 text-slate-500'}`}>
                    <span>מציג {filteredData.length>0?(currentPage-1)*itemsPerPage+1:0}–{Math.min(currentPage*itemsPerPage,filteredData.length)} מתוך {filteredData.length.toLocaleString()}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1} className={`p-1.5 rounded-lg disabled:opacity-30 ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-200'}`}><ChevronRight className="w-3.5 h-3.5"/></button>
                      <span className="font-mono px-2">{currentPage}/{totalPages||1}</span>
                      <button onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages||!totalPages} className={`p-1.5 rounded-lg disabled:opacity-30 ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-200'}`}><ChevronLeft className="w-3.5 h-3.5"/></button>
                    </div>
                  </div>
                </div>
                )}

                {/* Table — aggregated by product (ABC-XYZ, trend, margin) */}
                {activeTab==='sales' && salesViewMode==='byProduct' && (
                <div className={`rounded-2xl border overflow-hidden ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                  <div className={`px-5 py-4 border-b flex flex-wrap justify-between items-center gap-3 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                    <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><Box className="w-4 h-4 text-slate-400"/> מוצרים <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500'}`}>{sortedProductAggregates.length.toLocaleString()}</span></h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`flex rounded-lg p-1 text-xs ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
                        {[['all','הכל',null],['A','A',productAbcCounts.A],['B','B',productAbcCounts.B],['C','C',productAbcCounts.C]].map(([k,l,count])=>(
                          <button key={k} onClick={()=>setProductAbcFilter(k)} className={`px-2.5 py-1 rounded-md transition-all ${productAbcFilter===k?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-blue-700'):'text-slate-500'}`}>{l}{count!=null?` (${count})`:''}</button>
                        ))}
                      </div>
                      <div className="relative">
                        <Search className={`absolute right-3 top-2.5 w-3.5 h-3.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
                        <input type="text" placeholder="חיפוש מוצר..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                          className={`pl-4 pr-9 py-2 border rounded-xl text-xs w-40 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
                      </div>
                    </div>
                  </div>
                  {hasBlockedCurrency && (
                    <div className={`px-5 py-2 text-xs flex items-center gap-2 ${isDarkMode?'bg-orange-500/10 text-orange-400':'bg-orange-50 text-orange-700'}`}>
                      <TriangleAlert className="w-3.5 h-3.5"/> חלק מהמוצרים מיובאים בעלות במטבע שאינו ₪ — הרווח לא חושב להם. הזן שער חליפין ב-⚙️ הגדרות והרווח יחושב גם להם
                    </div>
                  )}
                  {/* Legend — explains ABC/XYZ, margin, and the time scope behind the numbers */}
                  <div className={`px-5 py-2.5 border-b flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] ${isDarkMode?'border-slate-700 text-slate-500':'border-slate-100 text-slate-400'}`}>
                    <span><span className="font-bold text-orange-500">A</span>=80% מההכנסה · <span className="font-bold text-blue-500">B</span>=עד 95% · <span className="font-bold text-slate-400">C</span>=שאר 5%</span>
                    <span>X/Y/Z = יציבות ביקוש (יציב→לא צפוי)</span>
                    {hasAnyMargin && <span>רווח = הכנסה − (כמות × עלות) · תיאורטי, לא כולל הוצאות תפעול · ≈€/≈$ = עלות שהומרה לפי שער מההגדרות</span>}
                    <span>כמות והכנסה: לפי טווח התאריכים שנבחר מעל הטבלה · גרף המגמה (בלחיצה על %) מציג תמיד 12 חודשים אחרונים בפועל</span>
                  </div>
                  <div className="overflow-x-auto max-h-[460px]">
                    <table className={`w-full text-sm text-right ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                      <thead className={`text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                        <tr>
                          <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('name')}>מוצר<SortIcon colKey="name" sortConfig={productSortConfig}/></th>
                          <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('abc')}>ABC<SortIcon colKey="abc" sortConfig={productSortConfig}/></th>
                          <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('totalQty')}>כמות<SortIcon colKey="totalQty" sortConfig={productSortConfig}/></th>
                          <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('totalRev')}>הכנסה<SortIcon colKey="totalRev" sortConfig={productSortConfig}/></th>
                          <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('trend')}>מגמה<SortIcon colKey="trend" sortConfig={productSortConfig}/></th>
                          {hasAnyMargin && <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('margin')}>רווח גולמי<SortIcon colKey="margin" sortConfig={productSortConfig}/></th>}
                          {hasAnyMargin && <th className="px-5 py-3.5 cursor-pointer select-none hover:text-blue-500" onClick={()=>requestProductSort('marginPct')}>% רווח<SortIcon colKey="marginPct" sortConfig={productSortConfig}/></th>}
                          <th className="px-5 py-3.5"></th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                        {paginatedProducts.length>0 ? paginatedProducts.map(p=>(
                          <tr key={p.sku||p.name} className={`transition-colors ${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50/80'}`}>
                            <td className={`px-5 py-3.5 font-medium ${isDarkMode?'text-slate-100':'text-slate-800'}`}>
                              {p.name}
                              {p.sku && <span className={`ml-2 text-xs font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.sku}</span>}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex items-center justify-center px-1.5 h-6 rounded-lg text-xs font-bold ${p.abc==='A'?(isDarkMode?'bg-orange-500/20 text-orange-400':'bg-orange-100 text-orange-700'):p.abc==='B'?(isDarkMode?'bg-blue-500/20 text-blue-400':'bg-blue-100 text-blue-700'):(isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500')}`} title={`${p.revPct.toFixed(1)}% מההכנסות · ${p.xyz==='X'?'ביקוש יציב':p.xyz==='Y'?'ביקוש משתנה':'ביקוש לא צפוי'} (CV)`}>{p.abc}{p.xyz}</span>
                            </td>
                            <td className="px-5 py-3.5">{p.totalQty.toLocaleString()}</td>
                            <td className={`px-5 py-3.5 font-bold tabular-nums ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatCurrency(p.totalRev)}</td>
                            <td className="px-5 py-3.5">
                              {SalesTrendButton(p)}
                            </td>
                            {hasAnyMargin && <td className={`px-5 py-3.5 font-bold tabular-nums ${p.margin==null?(isDarkMode?'text-slate-600':'text-slate-300'):p.margin>=0?(isDarkMode?'text-emerald-400':'text-emerald-600'):'text-red-500'}`} title={p.costConverted?`עלות ב-${p.costConverted} — הומרה לפי השער שהוגדר בהגדרות`:undefined}>{p.margin!=null?<>{formatCurrency(p.margin)}{p.costConverted && <span className="text-[10px] font-normal opacity-60 mr-1">≈{currencySymbol(p.costConverted)}</span>}</>:(p.costCurrencyBlocked?`⚠ ${p.costCurrencyBlocked}`:'—')}</td>}
                            {hasAnyMargin && <td className={`px-5 py-3.5 text-xs font-medium ${p.marginPct==null?(isDarkMode?'text-slate-600':'text-slate-300'):p.marginPct>=0?'text-emerald-500':'text-red-500'}`}>{p.marginPct!=null?`${p.marginPct.toFixed(1)}%`:'—'}</td>}
                            <td className="px-5 py-3.5">
                              <button onClick={()=>jumpToProcurement(p.name)} title="עבור לתכנון רכש למוצר הזה — מלאי, כיסוי, תחזית ועונתיות"
                                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${isDarkMode?'text-orange-400 hover:bg-orange-500/10':'text-orange-600 hover:bg-orange-50'}`}>
                                <ShoppingCart className="w-3.5 h-3.5"/> רכש
                              </button>
                            </td>
                          </tr>
                        )) : <tr><td colSpan={hasAnyMargin?8:6} className={`px-5 py-16 text-center text-sm ${isDarkMode?'text-slate-600':'text-slate-400'}`}>לא נמצאו נתונים</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className={`px-5 py-3.5 border-t flex justify-between items-center text-xs ${isDarkMode?'bg-slate-900/30 border-slate-700 text-slate-500':'bg-slate-50 border-slate-100 text-slate-500'}`}>
                    <span>מציג {sortedProductAggregates.length>0?(productPage-1)*itemsPerPage+1:0}–{Math.min(productPage*itemsPerPage,sortedProductAggregates.length)} מתוך {sortedProductAggregates.length.toLocaleString()}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>setProductPage(p=>Math.max(1,p-1))} disabled={productPage===1} className={`p-1.5 rounded-lg disabled:opacity-30 ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-200'}`}><ChevronRight className="w-3.5 h-3.5"/></button>
                      <span className="font-mono px-2">{productPage}/{productTotalPages||1}</span>
                      <button onClick={()=>setProductPage(p=>Math.min(productTotalPages,p+1))} disabled={productPage===productTotalPages||!productTotalPages} className={`p-1.5 rounded-lg disabled:opacity-30 ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-200'}`}><ChevronLeft className="w-3.5 h-3.5"/></button>
                    </div>
                  </div>
                </div>
                )}
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
