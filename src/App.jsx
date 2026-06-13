import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter,
  ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot,
  Loader2, FileText, Check, Trash2, Truck, Wallet, LayoutDashboard,
  FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight,
  BarChart3, Download, MousePointerClick, MessageSquare, Send, Moon, Sun,
  Info, Bell, User, Settings, Eye, EyeOff, TrendingDown, Zap,
  PieChart as PieChartIcon, Target, ArrowUpRight, ArrowDownRight, Home,
  ShoppingCart, ClipboardList, Sliders, TriangleAlert, Star, CircleDot,
  Minus, RefreshCw, SlidersHorizontal
} from 'lucide-react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';

// ─── API ───────────────────────────────────────────────
// API key is managed via the settings modal (stored in localStorage)

// ─── HELPERS ───────────────────────────────────────────
const HebrewMonthsMap = {
  0:'ינו',1:'פבר',2:'מרץ',3:'אפר',4:'מאי',5:'יונ',
  6:'יול',7:'אוג',8:'ספט',9:'אוק',10:'נוב',11:'דצמ'
};
const HebrewMonthsReverse = {
  'ינו':1,'פבר':2,'מרץ':3,'אפר':4,'מאי':5,'יונ':6,
  'יול':7,'אוג':8,'ספט':9,'אוק':10,'נוב':11,'דצמ':12
};

const formatCurrency = (val) => {
  if (isNaN(val)) return '₪0';
  return new Intl.NumberFormat('he-IL', { style:'currency', currency:'ILS', maximumFractionDigits:0 }).format(val);
};

const formatShort = (val) => {
  if (isNaN(val)) return '₪0';
  if (Math.abs(val) >= 1_000_000) return `₪${(val/1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `₪${(val/1_000).toFixed(0)}K`;
  return formatCurrency(val);
};

const excelDateToJS = (serial) => new Date((Math.floor(serial - 25569)) * 86400 * 1000);

const normalizeDate = (val) => {
  if (!val) return '';
  if (typeof val === 'string' && val.includes('-') && isNaN(parseFloat(val))) return val;
  const n = parseFloat(val);
  const d = (!isNaN(n) && n > 30000 && n < 60000) ? excelDateToJS(n) : new Date(val);
  if (d && !isNaN(d.getTime())) return `${HebrewMonthsMap[d.getMonth()]}-${d.getFullYear().toString().slice(-2)}`;
  return String(val);
};

const getDateVal = (s) => {
  if (!s || typeof s !== 'string') return 0;
  const [m, y] = s.split('-');
  return ((parseInt(y)+2000) * 100) + (HebrewMonthsReverse[m] || 0);
};

const monthsDiff = (a, b) => {
  if (!a || !b) return 1;
  const p = (d) => { const [m,y]=d.split('-'); return { m:HebrewMonthsReverse[m]||1, y:parseInt(y)+2000 }; };
  const s=p(a), e=p(b);
  return ((e.y-s.y)*12)+(e.m-s.m)+1;
};

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
  const points = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
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
    amber: { bg: isDarkMode ? 'bg-amber-500/10' : 'bg-amber-50', icon: 'text-amber-500', accent: '#f59e0b', border: isDarkMode ? 'border-amber-500/20' : 'border-amber-100' },
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
const OverviewPage = ({ salesData, suppliersData, dateFilter, availableDates, isDarkMode, setActiveTab }) => {
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
    const months = [...new Set(data.map(d=>d.date))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    if (months.length < 2) return 0;
    const last = data.filter(d=>d.date===months[months.length-1]).reduce((a,c)=>a+c[key],0);
    const prev = data.filter(d=>d.date===months[months.length-2]).reduce((a,c)=>a+c[key],0);
    return prev===0 ? 100 : ((last-prev)/prev)*100;
  };

  const revTrend = calcTrend(filteredSales, 'total');
  const profitTrend = monthlyData.length>=2 ? (monthlyData[monthlyData.length-1].profit - monthlyData[monthlyData.length-2].profit) / Math.abs(monthlyData[monthlyData.length-2].profit||1) * 100 : 0;

  const sparkRevenue = monthlyData.slice(-8).map(m => ({ value: m.revenue }));
  const sparkProfit = monthlyData.slice(-8).map(m => ({ value: m.profit }));

  const noData = salesData.length === 0 && suppliersData.length === 0;

  if (noData) return (
    <div className="flex flex-col items-center justify-center h-96 text-center animate-in fade-in zoom-in">
      <div className={`p-6 rounded-full mb-4 ${isDarkMode?'bg-slate-800':'bg-slate-100'}`}>
        <Home className={`w-12 h-12 ${isDarkMode?'text-slate-600':'text-slate-300'}`} />
      </div>
      <h3 className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>ברוך הבא ל-BizData Pro</h3>
      <p className={`mt-2 max-w-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>טען קבצים בלשוניות מכירות או ספקים כדי לראות את ה-Overview המלא</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="הכנסות" formatted={formatShort(totalRevenue)} icon={DollarSign} color="blue" trend={revTrend} sparkData={sparkRevenue} isDarkMode={isDarkMode} onClick={() => setActiveTab('sales')} />
        <KPICard title="הוצאות" formatted={formatShort(totalExpenses)} icon={Wallet} color="red" isDarkMode={isDarkMode} onClick={() => setActiveTab('suppliers')} />
        <KPICard title="רווח נקי" formatted={formatShort(netProfit)} icon={TrendingUp} color={netProfit>=0?'green':'red'} trend={profitTrend} sparkData={sparkProfit} isDarkMode={isDarkMode} onClick={() => setActiveTab('summary')} />
        <KPICard title="מכירות יחידות" formatted={totalUnits.toLocaleString()} icon={Package} color="amber" subtext={`${margin.toFixed(1)}% מרווח`} isDarkMode={isDarkMode} />
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
              <YAxis stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v/1000}k`} />
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
                {margin.toFixed(1)}%
              </text>
            </svg>
            <span className={`text-sm ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מתוך ₪{(totalRevenue/1000).toFixed(0)}K הכנסות</span>
          </div>

          {/* Quick stats */}
          <div className="space-y-3 mt-auto">
            {[
              { label: 'פריטים ייחודיים', val: new Set(filteredSales.map(d=>d.description)).size, color: 'text-blue-500' },
              { label: 'ספקים פעילים', val: new Set(filteredSuppliers.map(d=>d.supplier)).size, color: 'text-emerald-500' },
              { label: 'חודשי נתונים', val: new Set([...filteredSales,...filteredSuppliers].map(d=>d.date)).size, color: 'text-amber-500' },
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
              <Zap className="w-5 h-5 text-amber-500" /> מוצרים מובילים
            </h3>
            <button onClick={() => setActiveTab('sales')} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isDarkMode?'text-blue-400 hover:bg-blue-500/10':'text-blue-600 hover:bg-blue-50'}`}>
              הצג הכל ←
            </button>
          </div>
          <div className="space-y-3">
            {topProducts.length === 0 ? <p className={`text-sm text-center py-6 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין נתוני מכירות</p> :
            topProducts.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${i===0?(isDarkMode?'bg-amber-500/20 text-amber-400':'bg-amber-100 text-amber-700'):(isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500')}`}>{i+1}</span>
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
const EmptyState = ({ onUpload, loading, isDarkMode }) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in zoom-in duration-500">
    <div className={`p-8 rounded-3xl mb-6 ${isDarkMode?'bg-slate-800':'bg-slate-100'}`}>
      <FileSpreadsheet className={`w-14 h-14 ${isDarkMode?'text-slate-600':'text-slate-300'}`} />
    </div>
    <h3 className={`text-2xl font-bold mb-2 ${isDarkMode?'text-white':'text-slate-800'}`}>אין נתונים עדיין</h3>
    <p className={`max-w-xs mb-8 text-sm leading-relaxed ${isDarkMode?'text-slate-400':'text-slate-500'}`}>
      טען קבצי Excel או CSV של מכירות / ספקים כדי להתחיל
    </p>
    <label className="group flex items-center gap-3 px-7 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl cursor-pointer transition-all hover:scale-105 shadow-lg shadow-blue-500/25 font-medium">
      {loading ? <Loader2 className="w-5 h-5 animate-spin"/> : <Upload className="w-5 h-5"/>}
      בחר קבצים
      <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onUpload} className="hidden" disabled={loading}/>
    </label>
    <p className="mt-3 text-xs text-slate-400">.xlsx, .xls, .csv</p>
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
  const filtered = useMemo(() => !search ? options : options.filter(o=>o.toString().toLowerCase().includes(search.toLowerCase())), [options, search]);
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


// ─── PRIORITY OPEN ORDERS PARSER ──────────────────────────────────
const parsePriorityOrders = (rows) => {
  if (!rows.length) return [];
  const norm = s => (s||'').toString().trim();
  const headers = Object.keys(rows[0]).map(norm);

  // Detect columns by header name
  const findCol = (...variants) => {
    for (const v of variants) {
      const idx = headers.findIndex(h => h.includes(v));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colPO    = findCol('הזמנה');
  const colSKU   = findCol('מק"ט', "מק'ט", 'מקט');
  const colName  = findCol('תאור מוצר', 'תיאור מוצר');
  const colQty   = findCol('יתרה לאספקה');   // remaining qty — not ordered qty!
  const colVal   = findCol('שווי יתרה', 'שווי');
  const colDate  = findCol('ת. הזמנה', 'תאריך הזמנה');
  const colSup   = findCol('שם ספק', 'ספק', 'שם יצרן');

  // Convert Excel serial date → dd/mm/yyyy
  const excelToDate = (serial) => {
    const n = parseFloat(serial);
    if (isNaN(n) || n < 30000 || n > 70000) return serial?.toString() || '';
    const dt = new Date((n - 25569) * 86400 * 1000);
    return dt.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
  };

  const result = [];
  rows.forEach(row => {
    const vals = Object.values(row).map(v => norm(String(v)));
    const sku  = colSKU  !== -1 ? vals[colSKU]  : '';
    const name = colName !== -1 ? vals[colName] : '';
    if (!sku && !name) return;

    const qtyRaw = colQty !== -1 ? parseFloat(vals[colQty]) : NaN;
    const qty = isNaN(qtyRaw) || qtyRaw <= 0 ? 0 : qtyRaw;
    if (qty <= 0) return; // skip rows with no remaining qty

    const valRaw = colVal !== -1 ? parseFloat(vals[colVal]) : NaN;

    result.push({
      id:          Date.now().toString(36) + Math.random().toString(36).slice(2),
      poNumber:    colPO   !== -1 ? vals[colPO]   : '',
      productKey:  sku || name,
      productName: name || sku,
      supplier:    colSup  !== -1 ? vals[colSup]  : '',
      orderedQty:  qty,
      orderDate:   colDate !== -1 ? excelToDate(vals[colDate]) : '',
      expectedDate:'',
      status:      'ordered',
      notes:       '',
      value:       isNaN(valRaw) ? 0 : valRaw,
      fromPriority: true,
    });
  });
  return result;
};

// ─── INVENTORY FILE PARSER ─────────────────────────────
const parseInventoryFile = (rows) => {
  // Column name variants — Priority "יתרות מלאי" uses: מק'ט (B), תאור מוצר (C), יתרה (J)
  // Priority "כרטיס פריטים" uses: מק"ט (A), תאור (B), מחיר קניה אחרון (AI), עלות ש"ח (AN)
  const COL = {
    sku:      ["מק'ט",'מק"ט','מקט','sku','item number','item','barcode','ברקוד','קוד פריט','קוד מוצר','מספר פריט'],
    name:     ['תאור מוצר','תיאור מוצר','תאור','תיאור','שם מוצר','שם פריט','item name','description','פריט','שם'],
    status:   ['סטטוס','status'],
    managed:  ['מנוהל מלאי'],
    quantity: ['יתרה','יתרה במלאי','יתרת מלאי','כמות במלאי','כמות מלאי','מלאי','qty','stock','quantity','כמות בסטוק'],
    minStock: ['כמות מינימום למלאי','מינימום למלאי','מינימום מלאי','min stock','מינ מלאי','רמת הזמנה'],
    cost:     ['מחיר קניה אחרון','מחיר קניה','עלות ש"ח','עלות שח','עלות','unit cost','cost','מחיר ספק'],
    costAlt:  ['עלות ש"ח','עלות שח','עלות כוללת'],
    supplier: ['שם ספק','ספק','supplier'],
  };
  const norm = (s) => (s||'').toString().trim().replace(/\s+/g,' ');
  const findCol = (headers, variants) => {
    for (const v of variants) {
      const idx = headers.findIndex(h => norm(h) === v);
      if (idx !== -1) return idx;
    }
    for (const v of variants) {
      const idx = headers.findIndex(h => norm(h).includes(v));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]).map(norm);

  const skuIdx      = findCol(headers, COL.sku);
  const nameIdx     = findCol(headers, COL.name);
  const statusIdx   = findCol(headers, COL.status);
  const managedIdx  = findCol(headers, COL.managed);
  const qtyIdx      = findCol(headers, COL.quantity);
  const minStockIdx = findCol(headers, COL.minStock);
  const costIdx     = findCol(headers, COL.cost);
  const costAltIdx  = findCol(headers, COL.costAlt);
  const supplierIdx = findCol(headers, COL.supplier);

  // Priority master (כרטיס פריטים) = has SKU + cost but NO quantity column
  const isPriorityMaster = skuIdx !== -1 && costIdx !== -1 && qtyIdx === -1;

  const result = [];
  rows.forEach(row => {
    const vals = Object.values(row).map(v => norm(String(v)));
    const sku  = skuIdx  !== -1 ? vals[skuIdx]  : '';
    const name = nameIdx !== -1 ? vals[nameIdx] : '';
    if (!sku && !name) return;

    if (isPriorityMaster) {
      const status  = statusIdx  !== -1 ? vals[statusIdx]  : '';
      const managed = managedIdx !== -1 ? vals[managedIdx] : '';
      if (status && status !== 'פעיל') return;
      if (managed && managed !== 'Y') return;
    }

    // Quantity — ALLOW NEGATIVE (backorder/deficit), only skip if absent
    const qtyRaw = qtyIdx !== -1 ? parseFloat(vals[qtyIdx].replace(/[^\d.-]/g,'')) : NaN;
    const qty = isNaN(qtyRaw) ? null : qtyRaw;
    if (!isPriorityMaster && qty === null) return;

    const c1 = costIdx    !== -1 ? parseFloat(vals[costIdx].replace(/[^\d.-]/g,''))    : NaN;
    const c2 = costAltIdx !== -1 ? parseFloat(vals[costAltIdx].replace(/[^\d.-]/g,'')) : NaN;
    const cost = (!isNaN(c1) && c1 > 0) ? c1 : ((!isNaN(c2) && c2 > 0) ? c2 : null);

    const minRaw = minStockIdx !== -1 ? parseFloat(vals[minStockIdx].replace(/[^\d.-]/g,'')) : NaN;
    const minStock = (!isNaN(minRaw) && minRaw > 0) ? minRaw : null;

    const supplier = supplierIdx !== -1 ? vals[supplierIdx] : null;
    result.push({ sku: sku||name, name: name||sku, quantity: qty, cost, minStock, supplier });
  });
  return result;
};

// ─── PROCUREMENT PAGE ──────────────────────────────────
const ProcurementPage = ({ salesData, isDarkMode, apiKey }) => {
  const [stockMap, setStockMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementStock')||'{}'); } catch { return {}; } });
  const [costMap,  setCostMap]  = useState(() => { try { return JSON.parse(localStorage.getItem('procurementCost') ||'{}'); } catch { return {}; } });
  const [minStockMap, setMinStockMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementMinStock')||'{}'); } catch { return {}; } });
  const [supplierMap, setSupplierMap] = useState(() => { try { return JSON.parse(localStorage.getItem('procurementSupplier')||'{}'); } catch { return {}; } });
  const [monthsToStock, setMonthsToStock] = useState(2);
  const [leadTime, setLeadTime] = useState(1);
  const [abcFilter, setAbcFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key:'totalRev', direction:'desc' });
  const [editingStock, setEditingStock] = useState(null);
  const [invLoading, setInvLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [invFileName, setInvFileName] = useState(() => localStorage.getItem('inventoryFileName')||'');
  const [importStats, setImportStats] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [importBanner, setImportBanner] = useState(null); // {count, skipped}
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [deadStockDays, setDeadStockDays] = useState(90); // threshold in days
  const [whatIfMultiplier, setWhatIfMultiplier] = useState(1.2); // +20% default
  const [whatIfActive, setWhatIfActive] = useState(false);
  const [openOrders, setOpenOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('openOrders')||'[]'); } catch { return []; }
  });
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [editOrderId, setEditOrderId] = useState(null);
  const [orderForm, setOrderForm] = useState({ productKey:'', productName:'', supplier:'', orderedQty:'', orderDate:'', expectedDate:'', status:'ordered', poNumber:'', notes:'' });
  const [aiInsightOpen, setAiInsightOpen] = useState(false);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [aiInsightText, setAiInsightText] = useState('');
  const [viewMode, setViewMode] = useState('products'); // 'products' | 'suppliers'
  const [expandedSuppliers, setExpandedSuppliers] = useState(new Set());

  const toggleSupplier = (name) => setExpandedSuppliers(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  // ── Import open orders from Priority Excel ──────────────────────
  const handlePriorityOrdersUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setOrdersLoading(true);
    const process = (rows) => {
      const parsed = parsePriorityOrders(rows);
      if (!parsed.length) { setOrdersLoading(false); return; }
      // Remove existing fromPriority orders and replace with new import
      const manual = openOrders.filter(o => !o.fromPriority);
      const merged = [...manual, ...parsed];
      saveOrders(merged);
      setImportBanner({ count: parsed.length, skipped: rows.length - parsed.length });
      setTimeout(() => setImportBanner(null), 6000);
      setOrdersLoading(false);
      setViewMode('orders');
    };
    if (file.name.match(/\.xlsx?$/) && window.XLSX) {
      const r = new FileReader();
      r.onload = ev => {
        try {
          const wb = window.XLSX.read(ev.target.result, { type: 'binary' });
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          process(rows);
        } catch { setOrdersLoading(false); }
      };
      r.readAsBinaryString(file);
    } else {
      const r = new FileReader();
      r.onload = ev => {
        const lines = ev.target.result.split('\n').filter(l => l.trim());
        if (!lines.length) { setOrdersLoading(false); return; }
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

  const saveStock = (key, val) => {
    const n = parseFloat(val);
    const updated = { ...stockMap, [key]: isNaN(n) ? 0 : n };
    setStockMap(updated);
    localStorage.setItem('procurementStock', JSON.stringify(updated));
  };

  const generateProcurementInsight = async () => {
    if (!apiKey) { setAiInsightText('⚠️ הוסף API Key של Gemini בתחילת הקובץ.'); setAiInsightOpen(true); return; }
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
        +'תן: 1) עדיפויות 2) אזהרות 3) המלצה לשיפור.';
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key='+apiKey,
        { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) });
      if (!res.ok) { const e=await res.json().catch(()=>({})); setAiInsightText('שגיאת API: '+(e?.error?.message||res.status)); setAiInsightLoading(false); return; }
      const d = await res.json();
      setAiInsightText(d.candidates?.[0]?.content?.parts?.[0]?.text || 'לא קיבלתי תשובה.');
    } catch(e) { setAiInsightText('שגיאה: '+e.message); }
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
  const receiveOrder = (id) => saveOrders(openOrders.filter(o=>o.id!==id)); // remove when received

  // Map incoming quantities by product key for use in calculations
  const incomingMap = useMemo(() => {
    const map = {};
    openOrders.filter(o=>o.status!=='received').forEach(o => {
      const k = o.productKey||o.productName;
      map[k] = (map[k]||0) + (o.orderedQty||0);
    });
    return map;
  }, [openOrders]);

  const handleInvUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setInvLoading(true);
    const applyRows = (rows) => {
      const parsed = parseInventoryFile(rows);
      if (!parsed.length) { setInvLoading(false); return; }
      const ns = {...stockMap}, nc = {...costMap}, nm = {...minStockMap}, nsup = {...supplierMap};
      parsed.forEach(item => {
        const k = item.sku||item.name;
        if (item.quantity !== null) ns[k] = item.quantity;
        if (item.cost !== null) nc[k] = item.cost;
        if (item.minStock !== null) nm[k] = item.minStock;
        if (item.supplier) nsup[k] = item.supplier;
      });
      setStockMap(ns); setCostMap(nc); setMinStockMap(nm); setSupplierMap(nsup);
      localStorage.setItem('procurementStock', JSON.stringify(ns));
      localStorage.setItem('procurementCost', JSON.stringify(nc));
      localStorage.setItem('procurementMinStock', JSON.stringify(nm));
      localStorage.setItem('procurementSupplier', JSON.stringify(nsup));
      localStorage.setItem('inventoryFileName', file.name);
      setInvFileName(file.name);
      const withQty = parsed.filter(p=>p.quantity!==null).length;
      const withCost = parsed.filter(p=>p.cost!==null).length;
      const withMinStock = parsed.filter(p=>p.minStock!==null).length;
      setImportStats({ total: parsed.length, withQty, withCost, withMinStock });
      setShowBanner(true);
      setTimeout(() => setShowBanner(false), 7000);
      setInvLoading(false);
    };
    if (file.name.match(/\.xlsx?$/) && window.XLSX) {
      const r = new FileReader();
      r.onload = (ev) => { try { const wb=window.XLSX.read(ev.target.result,{type:'binary'}); applyRows(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})); } catch { setInvLoading(false); } };
      r.readAsBinaryString(file);
    } else {
      const r = new FileReader();
      r.onload = (ev) => {
        const lines = ev.target.result.split('\n').filter(l=>l.trim());
        if (!lines.length) { setInvLoading(false); return; }
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

  const clearInventory = () => {
    setStockMap({}); setCostMap({}); setMinStockMap({}); setSupplierMap({});
    setInvFileName(''); setImportStats(null);
    localStorage.removeItem('procurementStock'); localStorage.removeItem('procurementCost');
    localStorage.removeItem('procurementMinStock'); localStorage.removeItem('procurementSupplier');
    localStorage.removeItem('inventoryFileName');
  };

  const products = useMemo(() => {
    if (!salesData.length) return [];
    const map = {};
    salesData.forEach(row => {
      const key = row.sku||row.description; if (!key) return;
      if (!map[key]) map[key] = { sku:row.sku||'', name:row.description||key, monthlyData:{}, totalQty:0, totalRev:0 };
      map[key].totalQty += row.quantity||0;
      map[key].totalRev += row.total||0;
      if (row.date) map[key].monthlyData[row.date] = (map[key].monthlyData[row.date]||0)+(row.quantity||0);
    });
    const allMonths = [...new Set(salesData.map(d=>d.date).filter(Boolean))].sort((a,b)=>getDateVal(a)-getDateVal(b));
    const totalRev = Object.values(map).reduce((a,c)=>a+c.totalRev,0);
    let cumulative = 0;
    const sorted = Object.values(map).sort((a,b)=>b.totalRev-a.totalRev);
    sorted.forEach(p => {
      const pct = totalRev>0?(p.totalRev/totalRev)*100:0;
      cumulative += pct; p.revPct=pct;
      p.abc = cumulative<=80?'A':cumulative<=95?'B':'C';
    });
    return sorted.map(p => {
      const key = p.sku||p.name;
      // Use only months where this product actually sold (not all dataset months)
      // This prevents newly-added or seasonal products from appearing with inflated averages
      // ── Smart average: trim outlier months, flag limited data ──
      const activeVals = Object.values(p.monthlyData).filter(v => v > 0);
      let avgMonthly, avgDataMonths, isLimitedData;
      if (activeVals.length === 0) {
        avgMonthly = 0; avgDataMonths = 0; isLimitedData = true;
      } else if (activeVals.length <= 2) {
        // Too few months — use raw average but flag as unreliable
        avgMonthly = activeVals.reduce((a,b)=>a+b,0) / activeVals.length;
        avgDataMonths = activeVals.length;
        isLimitedData = true;
      } else {
        // Trimmed mean: exclude months with sales < 20% of median (one-off anomaly months)
        const sorted = [...activeVals].sort((a,b)=>a-b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const threshold = median * 0.20;
        const trimmed = activeVals.filter(v => v >= threshold);
        const finalVals = trimmed.length >= 2 ? trimmed : activeVals; // fallback if over-trimmed
        avgMonthly = finalVals.reduce((a,b)=>a+b,0) / finalVals.length;
        avgDataMonths = finalVals.length;
        isLimitedData = finalVals.length < 3;
      }
      const sparkline = allMonths.slice(-6).map(m=>({m, v:p.monthlyData[m]||0}));
      const last3 = allMonths.slice(-3).reduce((a,m)=>a+(p.monthlyData[m]||0),0)/3;
      const prev3 = allMonths.slice(-6,-3).reduce((a,m)=>a+(p.monthlyData[m]||0),0)/3;
      const trend = prev3>0?((last3-prev3)/prev3)*100:0;
      // match by key, sku, or name
      const currentStock = stockMap[key]??stockMap[p.sku]??stockMap[p.name]??null;
      const unitCost     = costMap[key]??costMap[p.sku]??costMap[p.name]??null;
      const minStock     = minStockMap[key]??minStockMap[p.sku]??minStockMap[p.name]??null;
      const supplier     = supplierMap[key]??supplierMap[p.sku]??supplierMap[p.name]??null;
      const avgDaily      = avgMonthly / 30;
      const coverageMonths = (currentStock!==null&&avgMonthly>0)?currentStock/avgMonthly:null;
      const coverageDays   = (currentStock!==null&&avgDaily>0)?Math.round(currentStock/avgDaily):null;
      // Forecast next month — weighted average of last 3 months adjusted by trend
      const recent3 = allMonths.slice(-3);
      const recent3Avg = recent3.reduce((s,m)=>s+(p.monthlyData[m]||0),0) / Math.max(recent3.length,1);
      const trendFactor = Math.max(0.7, Math.min(1.6, 1 + (trend||0)/200));
      const forecastNext = Math.round(recent3Avg * trendFactor);
      // Seasonality index — average per calendar month vs overall annual average
      const MONTH_ABBR = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
      const monthlyAvgs = MONTH_ABBR.map(mName => {
        const vals = Object.entries(p.monthlyData).filter(([d])=>d.startsWith(mName+'-')).map(([,v])=>v);
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
      });
      const annualAvg = monthlyAvgs.reduce((a,b)=>a+b,0)/12 || 1;
      const seasonalityIdx = monthlyAvgs.map(v => +(v/annualAvg).toFixed(2));
      // ── XYZ classification: Coefficient of Variation ──────────────
      const allSaleVals = Object.values(p.monthlyData).filter(v=>v>0);
      const meanForCV = avgMonthly || 1;
      const variance = allSaleVals.length > 1
        ? allSaleVals.reduce((s,v)=>s+Math.pow(v-meanForCV,2),0) / allSaleVals.length
        : 0;
      const stdDev = Math.sqrt(variance);
      const cv = meanForCV > 0 ? stdDev / meanForCV : 0;
      const xyz = cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z';
      const abcXyz = (p.abc||'C') + xyz;

      // ── Safety Stock: 95% service level (Z=1.65) ────────────────
      const safetyStock = Math.ceil(1.65 * stdDev * Math.sqrt(Math.max(leadTime, 0.5)));

      // ── Lifecycle: compare last 3 vs previous 3 months ──────────
      const lcRecent = allMonths.slice(-3).reduce((s,m)=>s+(p.monthlyData[m]||0),0)/3;
      const lcPrev   = allMonths.slice(-6,-3).reduce((s,m)=>s+(p.monthlyData[m]||0),0)/3;
      const lcTrend  = lcPrev>0 ? (lcRecent-lcPrev)/lcPrev*100 : 0;
      const lifecycle = lcTrend > 20 ? 'growing' : lcTrend > -20 ? 'stable' : lcTrend > -50 ? 'declining' : 'dying';

      // ── Incoming orders (already on the way) ────────────────────
      const incomingQty = incomingMap[key] ?? incomingMap[p.sku] ?? incomingMap[p.name] ?? 0;
      const effectiveStock = (currentStock??0) + incomingQty;
      const effectiveCoverDays = avgDaily > 0 ? Math.round(effectiveStock / avgDaily) : null;
      // ── Suggested order: includes safety stock ───────────────────
      const targetStock  = minStock ?? (monthsToStock * avgMonthly);
      const baseOrder = (monthsToStock+leadTime)*avgMonthly + safetyStock - effectiveStock;
      const suggestedOrder = Math.max(0, Math.ceil(baseOrder));
      const orderCost = (suggestedOrder>0&&unitCost)?suggestedOrder*unitCost:null;
      const risk = currentStock!==null
        ? (currentStock <= 0 ? 'critical'  // negative or zero stock
          : coverageMonths < leadTime ? 'critical'
          : (minStock ? currentStock < minStock : coverageMonths < monthsToStock) ? 'low' : 'ok')
        : 'unknown';
      return { ...p, key, avgMonthly, avgDataMonths, isLimitedData, avgDaily, sparkline, trend, forecastNext, seasonalityIdx, monthlyAvgs, cv, stdDev, xyz, abcXyz, safetyStock, lifecycle, currentStock, unitCost, minStock, supplier, coverageMonths, coverageDays, incomingQty, effectiveStock, effectiveCoverDays, suggestedOrder, orderCost, risk };
    });
  }, [salesData, stockMap, costMap, minStockMap, supplierMap, monthsToStock, leadTime, incomingMap]);

  const filtered = useMemo(() => {
    let data = products;
    if (abcFilter!=='all') data=data.filter(p=>p.abc===abcFilter);
    if (searchTerm) data=data.filter(p=>p.name.toLowerCase().includes(searchTerm.toLowerCase())||p.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    return data.sort((a,b)=>{
      let va=a[sortConfig.key]??-Infinity, vb=b[sortConfig.key]??-Infinity;
      return sortConfig.direction==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0);
    });
  }, [products, abcFilter, searchTerm, sortConfig]);

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

    return products
      .filter(p => {
        // Find last sale date for this product
        const saleDates = Object.entries(p.monthlyData)
          .filter(([,v])=>v>0)
          .map(([d])=>toDate(d))
          .filter(Boolean);
        if (!saleDates.length) return p.currentStock > 0; // never sold but has stock
        const lastSale = new Date(Math.max(...saleDates.map(d=>d.getTime())));
        return lastSale < threshold && (p.currentStock === null || p.currentStock > 0);
      })
      .map(p => {
        const saleDates = Object.entries(p.monthlyData)
          .filter(([,v])=>v>0)
          .map(([d])=>toDate(d))
          .filter(Boolean);
        const lastSaleDate = saleDates.length
          ? new Date(Math.max(...saleDates.map(d=>d.getTime())))
          : null;
        const daysSince = lastSaleDate
          ? Math.round((latestDate-lastSaleDate)/(24*60*60*1000))
          : null;
        const stockValue = (p.currentStock??0) * (p.unitCost??0);
        return { ...p, lastSaleDate, daysSince, stockValue };
      })
      .sort((a,b) => (b.stockValue||0)-(a.stockValue||0));
  }, [products, salesData, deadStockDays]);

  const deadStockValue = useMemo(() =>
    deadStockData.reduce((a,p)=>a+(p.stockValue||0),0), [deadStockData]);

  // ── Procurement schedule: when to order each product ──────────
  const scheduleData = useMemo(() => {
    const today = new Date();
    const leadDays = leadTime * 30;
    return products
      .filter(p => p.currentStock !== null && p.avgMonthly > 0 && p.suggestedOrder > 0)
      .map(p => {
        const daysUntilOrder = (p.coverageDays||0) - leadDays;
        const orderByDate = new Date(today.getTime() + daysUntilOrder*24*60*60*1000);
        const urgency = daysUntilOrder <= 0 ? 'critical' : daysUntilOrder <= 7 ? 'urgent' : daysUntilOrder <= 14 ? 'soon' : daysUntilOrder <= 30 ? 'planned' : 'later';
        return { ...p, daysUntilOrder: Math.round(daysUntilOrder), orderByDate, urgency };
      })
      .sort((a,b) => a.daysUntilOrder - b.daysUntilOrder);
  }, [products, leadTime]);

  // ── What-If: recalculate with demand multiplier ─────────────
  const whatIfProducts = useMemo(() => {
    if (!whatIfActive) return [];
    return products.map(p => {
      const adjAvg = p.avgMonthly * whatIfMultiplier;
      const adjSS  = Math.ceil(1.65 * (p.stdDev||0) * Math.sqrt(Math.max(leadTime,0.5)) * Math.sqrt(whatIfMultiplier));
      const adjOrder = Math.max(0, Math.ceil((monthsToStock+leadTime)*adjAvg + adjSS - (p.currentStock??0)));
      const adjCovDays = (p.currentStock!==null && adjAvg>0) ? Math.round(p.currentStock/(adjAvg/30)) : null;
      return { ...p, adjAvg, adjOrder, adjCovDays, orderDelta: adjOrder - p.suggestedOrder };
    }).filter(p => p.adjOrder > 0 || p.suggestedOrder > 0);
  }, [products, whatIfMultiplier, whatIfActive, monthsToStock, leadTime]);

  const reqSort = (key) => setSortConfig(p=>({key, direction:p.key===key&&p.direction==='desc'?'asc':'desc'}));
  const abcCounts = useMemo(()=>({ A:products.filter(p=>p.abc==='A').length, B:products.filter(p=>p.abc==='B').length, C:products.filter(p=>p.abc==='C').length }), [products]);
  const riskCounts = useMemo(()=>({ critical:products.filter(p=>p.risk==='critical').length, low:products.filter(p=>p.risk==='low').length }), [products]);
  const totalOrderUnits = useMemo(()=>filtered.reduce((a,p)=>a+p.suggestedOrder,0),[filtered]);
  const totalOrderCost  = useMemo(()=>filtered.reduce((a,p)=>a+(p.orderCost||0),0),[filtered]);
  const stockedCount = useMemo(()=>products.filter(p=>p.currentStock!==null).length,[products]);

  // Group products-to-order by supplier — must be after filtered
  const supplierGroups = useMemo(() => {
    const groups = {};
    filtered.forEach(p => {
      const sup = p.supplier || 'ספק לא ידוע';
      if (!groups[sup]) groups[sup] = { name: sup, items: [], totalUnits: 0, totalCost: 0, criticalCount: 0 };
      groups[sup].items.push(p);
      groups[sup].totalUnits += p.suggestedOrder;
      groups[sup].totalCost  += p.orderCost || 0;
      if (p.risk === 'critical') groups[sup].criticalCount++;
    });
    return Object.values(groups)
      .filter(g => g.totalUnits > 0)
      .sort((a, b) => b.totalCost - a.totalCost || b.totalUnits - a.totalUnits);
  }, [filtered]);

  const ABCBadge = ({cls, xyz, abcXyz}) => {
    const abcStyle = {
      A: isDarkMode?'bg-amber-500/20 text-amber-300 border-amber-500/40':'bg-amber-50 text-amber-700 border-amber-300',
      B: isDarkMode?'bg-blue-500/20 text-blue-300 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-200',
      C: isDarkMode?'bg-slate-600/40 text-slate-400 border-slate-600':'bg-slate-100 text-slate-500 border-slate-200',
    };
    const xyzStyle = {
      X: isDarkMode?'text-emerald-400':'text-emerald-600',
      Y: isDarkMode?'text-amber-400':'text-amber-600',
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
  const RiskBadge = ({risk, months, days}) => {
    if (risk==='unknown') return <span className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-400'}`}>—</span>;
    const label = days != null
      ? <><span className="font-bold">{days} יום</span><span className="opacity-60 mr-1"> ({months?.toFixed(1)} ח')</span></>
      : <span className="font-bold">{months?.toFixed(1)} ח'</span>;
    if (risk==='critical') return <span className="flex items-center gap-1 text-xs text-red-500 whitespace-nowrap"><TriangleAlert className="w-3 h-3 shrink-0"/>{label}</span>;
    if (risk==='low')      return <span className="flex items-center gap-1 text-xs text-amber-500 whitespace-nowrap"><AlertTriangle className="w-3 h-3 shrink-0"/>{label}</span>;
    return <span className={`flex items-center gap-1 text-xs whitespace-nowrap ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}><Check className="w-3 h-3 shrink-0"/>{label}</span>;
  };
  const MiniSparkline = ({data}) => {
    if (!data||data.length<2) return null;
    const vals=data.map(d=>d.v), min=Math.min(...vals), max=Math.max(...vals), range=max-min||1;
    const w=60, h=24;
    const pts=vals.map((v,i)=>`${(i/(vals.length-1))*w},${h-((v-min)/range)*(h-4)-2}`).join(' ');
    return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><polyline points={pts} fill="none" stroke={vals[vals.length-1]>=vals[0]?'#10b981':'#ef4444'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
  };

  const MONTH_FULL_LABELS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const SeasonalityBar = ({idx, avgs}) => {
    if (!idx || idx.every(v=>v===1||v===0)) return null;
    const maxVal = avgs ? Math.max(...avgs, 0.1) : 1;
    return (
      <div className="flex gap-[3px] mt-2 items-end" title="עונתיות חודשית">
        {idx.map((v,i) => {
          const qty = avgs ? Math.round(avgs[i]) : 0;
          const barH = avgs ? Math.max(4, Math.round((avgs[i]/maxVal)*20)) : Math.max(4, Math.round(v*10));
          const color = v >= 1.3 ? '#10b981' : v >= 1.1 ? '#34d399' : v >= 0.9 ? '#94a3b8' : v >= 0.7 ? '#fbbf24' : '#f87171';
          const label = MONTH_FULL_LABELS[i] + ': ' + (qty > 0 ? qty.toLocaleString() + " יח'" : 'אין מכירות');
          return (
            <div key={i} title={label} style={{
              width:'12px', minWidth:'12px', height:barH+'px',
              borderRadius:'3px', background:color,
              opacity: v===0 ? 0.2 : 0.85, cursor:'help',
              transition:'opacity 0.15s'
            }}/>
          );
        })}
      </div>
    );
  };

  if (!salesData.length) return (
    <div className="flex flex-col items-center justify-center h-96 text-center">
      <div className={`p-6 rounded-full mb-4 ${isDarkMode?'bg-slate-800':'bg-slate-100'}`}><ShoppingCart className={`w-12 h-12 ${isDarkMode?'text-slate-600':'text-slate-300'}`}/></div>
      <h3 className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>אין נתוני מכירות</h3>
      <p className={`mt-2 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>טען קבצי מכירות כדי לתכנן את הרכש</p>
    </div>
  );

  return (
    <>
    {/* AI Insight Modal */}
    {aiInsightOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div className={`rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden ${isDarkMode?'bg-slate-800 border border-slate-700':'bg-white'}`}>
          <div className={`p-5 border-b flex justify-between items-center ${isDarkMode?'border-slate-700 bg-slate-900/50':'border-slate-100 bg-gradient-to-l from-violet-50 to-white'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${isDarkMode?'bg-violet-500/20':'bg-violet-100'}`}><Sparkles className="w-5 h-5 text-violet-500"/></div>
              <h2 className={`text-lg font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>תובנות רכש AI</h2>
            </div>
            <button onClick={()=>setAiInsightOpen(false)} className={`p-2 rounded-full ${isDarkMode?'hover:bg-slate-700':'hover:bg-slate-100'}`}><X className={`w-5 h-5 ${isDarkMode?'text-slate-400':'text-slate-500'}`}/></button>
          </div>
          <div className="p-6 overflow-y-auto flex-1 text-right" dir="rtl">
            {aiInsightLoading ? (
              <div className="flex flex-col items-center py-12 gap-4">
                <Loader2 className="w-10 h-10 text-violet-500 animate-spin"/>
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
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Import banner */}
      {showBanner && importStats && (
        <div className={`flex flex-wrap items-center gap-3 px-5 py-3.5 rounded-2xl border animate-in fade-in slide-in-from-top-2 duration-300 ${isDarkMode?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300':'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          <Check className="w-5 h-5 shrink-0"/>
          <span className="font-medium text-sm">יובאו {importStats.total} פריטים מ-{invFileName}</span>
          <div className="flex gap-3 text-xs mr-auto">
            {importStats.withQty > 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-emerald-500/10':'bg-emerald-100'}`}>✓ {importStats.withQty} עם כמות מלאי</span>}
            {importStats.withCost > 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-blue-500/10':'bg-blue-100 text-blue-800'}`}>✓ {importStats.withCost} עם מחיר קניה</span>}
            {importStats.withMinStock > 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-amber-500/10':'bg-amber-100 text-amber-800'}`}>✓ {importStats.withMinStock} עם מינימום מלאי</span>}
            {importStats.withQty === 0 && <span className={`px-2 py-1 rounded-lg ${isDarkMode?'bg-amber-500/10':'bg-amber-100 text-amber-800'}`}>⚠ אין עמודת כמות — הזן מלאי ידנית או ייצא "יתרות מלאי" מ-Priority</span>}
          </div>
          <button onClick={()=>setShowBanner(false)}><X className="w-4 h-4 opacity-50 hover:opacity-100"/></button>
        </div>
      )}

      {/* Top row: upload + config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inventory upload */}
        <div className={`p-5 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          <h3 className={`font-bold text-sm mb-3 flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><Package className="w-4 h-4 text-amber-500"/> מלאי נוכחי</h3>
          {invFileName ? (
            <div className="space-y-3">
              <div className={`flex items-center gap-3 p-3 rounded-xl ${isDarkMode?'bg-slate-700/50':'bg-slate-50'}`}>
                <FileSpreadsheet className="w-5 h-5 text-emerald-500 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{invFileName}</p>
                  <p className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{stockedCount} מוצרים עם מלאי</p>
                </div>
                <button onClick={clearInventory} className={`p-1.5 rounded-lg ${isDarkMode?'text-red-400 hover:bg-red-500/10':'text-red-500 hover:bg-red-50'}`}><Trash2 className="w-4 h-4"/></button>
              </div>
              <label className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-dashed border-2 cursor-pointer text-xs font-medium transition-colors ${isDarkMode?'border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-400':'border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600'}`}>
                {invLoading?<Loader2 className="w-4 h-4 animate-spin"/>:<RefreshCw className="w-4 h-4"/>} עדכן קובץ מלאי
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleInvUpload} className="hidden" disabled={invLoading}/>
              </label>
            </div>
          ) : (
            <label className={`flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all group ${isDarkMode?'border-slate-600 hover:border-amber-500/50 hover:bg-amber-500/5':'border-slate-200 hover:border-amber-400 hover:bg-amber-50'}`}>
              {invLoading ? <Loader2 className="w-8 h-8 animate-spin text-amber-500"/> : (
                <div className={`p-3 rounded-xl ${isDarkMode?'bg-slate-700 group-hover:bg-amber-500/20':'bg-slate-100 group-hover:bg-amber-100'}`}><Upload className={`w-6 h-6 ${isDarkMode?'text-slate-400 group-hover:text-amber-400':'text-slate-400 group-hover:text-amber-600'}`}/></div>
              )}
              <div className="text-center">
                <p className={`font-medium text-sm ${isDarkMode?'text-slate-300':'text-slate-700'}`}>העלה קובץ מלאי</p>
                <p className={`text-xs mt-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>Excel / CSV · זיהוי אוטומטי של עמודות</p>
                <p className={`text-xs mt-0.5 ${isDarkMode?'text-slate-600':'text-slate-300'}`}>מק"ט / שם מוצר / כמות / מחיר עלות</p>
              </div>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleInvUpload} className="hidden" disabled={invLoading}/>
            </label>
          )}
          {!invFileName && <p className={`text-xs mt-2 text-center ${isDarkMode?'text-slate-600':'text-slate-400'}`}>אפשר גם להזין ידנית — לחץ על שדה בטבלה</p>}
        </div>

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
                <span className={`text-xs font-medium ${isDarkMode?'text-slate-300':'text-slate-600'}`}>זמן אספקה (חודשים)</span>
                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-lg ${isDarkMode?'bg-emerald-500/20 text-emerald-300':'bg-emerald-50 text-emerald-700'}`}>{leadTime}</span>
              </div>
              <input type="range" min={0} max={4} step={1} value={leadTime} onChange={e=>setLeadTime(+e.target.value)} className="w-full accent-emerald-500"/>
              <div className="flex justify-between mt-0.5">{[0,1,2,3,4].map(n=><span key={n} className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-300'}`}>{n}</span>)}</div>
            </div>
            <div className={`text-xs px-3 py-2.5 rounded-xl border ${isDarkMode?'bg-slate-700/50 border-slate-600 text-slate-300':'bg-slate-50 border-slate-200 text-slate-600'}`}>
              <span className="font-bold">נוסחה: </span>להזמין = ({monthsToStock} + {leadTime}) × ממוצע חודשי − מלאי קיים
            </div>
          </div>
        </div>
      </div>

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
                    <span className={`px-2 py-0.5 rounded text-xs font-bold border shrink-0 mt-0.5 ${r.cls==='A'?(isDarkMode?'bg-amber-500/20 text-amber-300 border-amber-500/30':'bg-amber-50 text-amber-700 border-amber-200'):r.cls==='B'?(isDarkMode?'bg-blue-500/20 text-blue-300 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-200'):(isDarkMode?'bg-slate-600/40 text-slate-400 border-slate-600':'bg-slate-100 text-slate-500 border-slate-200')}`}>{r.cls}</span>
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
                    <span className={`px-2 py-0.5 rounded text-xs font-bold border shrink-0 mt-0.5 ${r.xyz==='X'?(isDarkMode?'bg-emerald-500/20 text-emerald-300 border-emerald-500/30':'bg-emerald-50 text-emerald-700 border-emerald-200'):r.xyz==='Y'?(isDarkMode?'bg-amber-500/20 text-amber-300 border-amber-500/30':'bg-amber-50 text-amber-700 border-amber-200'):(isDarkMode?'bg-red-500/20 text-red-300 border-red-500/30':'bg-red-50 text-red-700 border-red-200')}`}>{r.xyz}</span>
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

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="מוצרי A" formatted={abcCounts.A.toString()} icon={Star}        color="amber"  subtext="~80% מההכנסה" isDarkMode={isDarkMode}/>
        <KPICard title="מוצרי B" formatted={abcCounts.B.toString()} icon={CircleDot}   color="blue"   subtext="~15% מההכנסה" isDarkMode={isDarkMode}/>
        <KPICard title="מוצרי C" formatted={abcCounts.C.toString()} icon={Minus}       color="purple" subtext="~5% מההכנסה"  isDarkMode={isDarkMode}/>
        <KPICard title="סיכון מלאי" formatted={(riskCounts.critical+riskCounts.low).toString()} icon={riskCounts.critical>0?TriangleAlert:AlertTriangle} color={riskCounts.critical>0?'red':riskCounts.low>0?'amber':'green'} subtext={stockedCount>0?`${riskCounts.critical} קריטי · ${riskCounts.low} נמוך`:'העלה מלאי לחישוב'} isDarkMode={isDarkMode}/>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-3">
        <div className={`flex rounded-xl p-1 border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
          {[['products', ClipboardList, 'לפי מוצר'], ['suppliers', Truck, 'לפי ספק'], ['orders', ShoppingCart, 'הזמנות פתוחות'], ['schedule', Calendar, 'לוח זמנים'], ['whatif', Activity, 'תרחיש'], ['dead', Trash2, 'פריטים מתים']].map(([mode, Icon, label]) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${viewMode===mode
                ? (isDarkMode?'bg-slate-700 text-white shadow-sm':'bg-slate-900 text-white shadow-sm')
                : (isDarkMode?'text-slate-400 hover:text-slate-200':'text-slate-500 hover:text-slate-700')}`}>
              <Icon className="w-4 h-4"/>{label}
              {mode==='suppliers' && supplierGroups.length>0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${viewMode==='suppliers'?'bg-white/20 text-white':'bg-blue-100 text-blue-700'}`}>{supplierGroups.length}</span>
              )}
              {mode==='orders' && openOrders.length>0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${viewMode==='orders'?'bg-blue-300/30 text-blue-100':'bg-blue-100 text-blue-700'}`}>{openOrders.length}</span>
              )}
              {mode==='schedule' && scheduleData.filter(p=>p.urgency==='critical'||p.urgency==='urgent').length>0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${viewMode==='schedule'?'bg-red-300/30 text-red-200':'bg-red-100 text-red-700'}`}>{scheduleData.filter(p=>p.urgency==='critical'||p.urgency==='urgent').length}</span>
              )}
              {mode==='dead' && deadStockData.length>0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${viewMode==='dead'?'bg-red-400/30 text-red-200':'bg-red-100 text-red-700'}`}>{deadStockData.length}</span>
              )}
            </button>
          ))}
        </div>
        <button onClick={generateProcurementInsight}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white rounded-xl font-medium text-sm transition-all hover:-translate-y-0.5 active:scale-95 shadow-lg shadow-violet-500/20">
          <Sparkles className="w-4 h-4 text-yellow-200 animate-pulse"/> תובנות רכש AI
        </button>
        {viewMode==='suppliers' && supplierGroups.length>0 && (
          <div className="flex items-center gap-3">
            <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>
              {supplierGroups.reduce((a,g)=>a+g.totalUnits,0).toLocaleString()} יח' · {formatShort(supplierGroups.reduce((a,g)=>a+g.totalCost,0))} סה"כ
            </span>
            <button
              onClick={() => {
                setTimeout(() => {
                  try {
                    const riskColor = { critical:'#fee2e2', low:'#fef9c3', ok:'#f0fdf4', unknown:'#ffffff' };
                    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>הזמנות לספקים</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml></head><body>`;
                    supplierGroups.forEach(grp => {
                      html += `<h3 style="font-family:Calibri;font-size:14px;font-weight:bold;margin-top:20px;color:#1e293b">הזמנה מ: ${grp.name}</h3>`;
                      html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri;font-size:11px;direction:rtl;margin-bottom:8px">`;
                      html += `<thead><tr style="background:#1e293b;color:#fff"><th>מק"ט</th><th>תאור מוצר</th><th>ABC</th><th>ממוצע/חודש</th><th>מלאי נוכחי</th><th>כיסוי</th><th style="background:#1d4ed8">להזמין (יח')</th><th>מחיר קניה ₪</th><th>עלות הזמנה ₪</th></tr></thead><tbody>`;
                      grp.items.filter(p=>p.suggestedOrder>0).forEach(p => {
                        const bg = riskColor[p.risk]||'#fff';
                        html += `<tr style="background:${bg}"><td>${p.sku||p.name}</td><td>${p.name}</td><td style="text-align:center;font-weight:bold">${p.abc}</td><td style="text-align:center">${p.avgMonthly.toFixed(1)}</td><td style="text-align:center">${p.currentStock??'—'}</td><td style="text-align:center">${p.coverageDays!=null?p.coverageDays+' יום':'—'}</td><td style="text-align:center;font-weight:bold;font-size:13px;background:${p.risk==='critical'?'#fecaca':p.risk==='low'?'#fef3c7':'#dbeafe'};color:${p.risk==='critical'?'#dc2626':p.risk==='low'?'#d97706':'#1d4ed8'}">${p.suggestedOrder.toLocaleString()}</td><td style="text-align:center">${p.unitCost?'₪'+p.unitCost:''}</td><td style="text-align:center">${p.orderCost?'₪'+Math.round(p.orderCost).toLocaleString():''}</td></tr>`;
                      });
                      html += `<tr style="background:#f8fafc;font-weight:bold"><td colspan="6" style="text-align:right">סה"כ מ${grp.name}</td><td style="text-align:center;color:#1d4ed8">${grp.totalUnits.toLocaleString()}</td><td></td><td style="text-align:center;color:#16a34a">${grp.totalCost>0?'₪'+Math.round(grp.totalCost).toLocaleString():''}</td></tr>`;
                      html += `</tbody></table><br/>`;
                    });
                    html += `</body></html>`;
                    const blob = new Blob(['\ufeff'+html], {type:'application/vnd.ms-excel;charset=utf-8'});
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.style.display='none';
                    a.href=url;
                    a.setAttribute('download', 'הזמנות_ספקים_'+new Date().toLocaleDateString('he-IL').replace(/\//g,'-')+'.xls');
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
                  } catch(e) { console.error(e); }
                }, 30);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${isDarkMode?'bg-emerald-900/20 border-emerald-800 text-emerald-400 hover:bg-emerald-900/40':'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
            >
              <Download className="w-3.5 h-3.5"/> ייצוא הזמנות
            </button>
          </div>
        )}
      </div>

      {/* Supplier view */}
      {viewMode==='suppliers' && (
        <div className="space-y-3 animate-in fade-in duration-300">
          {supplierGroups.length === 0 ? (
            <div className={`flex flex-col items-center justify-center py-16 rounded-2xl border ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
              <Truck className={`w-10 h-10 mb-3 ${isDarkMode?'text-slate-600':'text-slate-300'}`}/>
              <p className={`text-sm ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין פריטים להזמנה כרגע</p>
            </div>
          ) : supplierGroups.map(grp => {
            const isOpen = expandedSuppliers.has(grp.name);
            const critItems = grp.items.filter(p=>p.risk==='critical'&&p.suggestedOrder>0);
            const lowItems  = grp.items.filter(p=>p.risk==='low'&&p.suggestedOrder>0);
            const okItems   = grp.items.filter(p=>p.risk!=='critical'&&p.risk!=='low'&&p.suggestedOrder>0);
            return (
              <div key={grp.name} className={`rounded-2xl border overflow-hidden transition-all ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
                {/* Supplier header */}
                <button onClick={()=>toggleSupplier(grp.name)} className="w-full text-right">
                  <div className={`px-5 py-4 flex items-center gap-4 transition-colors ${isDarkMode?'hover:bg-slate-700/50':'hover:bg-slate-50'}`}>
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}>
                      {grp.name.slice(0,2)}
                    </div>
                    {/* Name + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>{grp.name}</span>
                        {grp.criticalCount>0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">{grp.criticalCount} קריטי</span>}
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{grp.items.filter(p=>p.suggestedOrder>0).length} פריטים להזמנה</span>
                        {grp.totalCost>0 && <span className={`text-xs font-medium ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatShort(grp.totalCost)} עלות כוללת</span>}
                      </div>
                    </div>
                    {/* Total units badge */}
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm shrink-0 ${isDarkMode?'bg-blue-500/15 text-blue-300':'bg-blue-50 text-blue-700'}`}>
                      <ShoppingCart className="w-4 h-4"/>
                      {grp.totalUnits.toLocaleString()} יח'
                    </div>
                    {/* Expand arrow */}
                    <ChevronDown className={`w-5 h-5 shrink-0 transition-transform duration-200 ${isDarkMode?'text-slate-500':'text-slate-400'} ${isOpen?'rotate-180':''}`}/>
                  </div>
                </button>

                {/* Expanded items */}
                {isOpen && (
                  <div className={`border-t ${isDarkMode?'border-slate-700':'border-slate-100'}`}>
                    {/* Critical items */}
                    {critItems.length>0 && (
                      <div>
                        <div className={`px-5 py-2 text-xs font-bold flex items-center gap-2 ${isDarkMode?'bg-red-900/20 text-red-400':'bg-red-50 text-red-700'}`}>
                          <TriangleAlert className="w-3 h-3"/> קריטי — הזמן מיד
                        </div>
                        {critItems.map(p => (
                          <div key={p.key} className={`flex items-center gap-4 px-5 py-3 border-b last:border-0 ${isDarkMode?'border-slate-700/50 bg-red-900/5':'border-slate-100 bg-red-50/30'}`}>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.name}</p>
                              <div className="flex items-center gap-3 mt-0.5">
                                {p.sku&&p.sku!==p.name&&<span className={`text-xs font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.sku}</span>}
                                <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>ממוצע: {p.avgMonthly.toFixed(1)}/חודש</span>
                                {p.currentStock!==null&&<span className={`text-xs ${p.currentStock<=0?'text-red-500 font-bold':'text-slate-400'}`}>מלאי: {p.currentStock}</span>}
                              </div>
                            </div>
                            {p.unitCost&&<span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>₪{p.unitCost}/יח'</span>}
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 text-red-700 font-bold text-sm shrink-0">
                              <ShoppingCart className="w-3.5 h-3.5"/>{p.suggestedOrder.toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Low items */}
                    {lowItems.length>0 && (
                      <div>
                        <div className={`px-5 py-2 text-xs font-bold flex items-center gap-2 ${isDarkMode?'bg-amber-900/20 text-amber-400':'bg-amber-50 text-amber-700'}`}>
                          <AlertTriangle className="w-3 h-3"/> מלאי נמוך
                        </div>
                        {lowItems.map(p => (
                          <div key={p.key} className={`flex items-center gap-4 px-5 py-3 border-b last:border-0 ${isDarkMode?'border-slate-700/50':'border-slate-100'}`}>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.name}</p>
                              <div className="flex items-center gap-3 mt-0.5">
                                {p.sku&&p.sku!==p.name&&<span className={`text-xs font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.sku}</span>}
                                <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>ממוצע: {p.avgMonthly.toFixed(1)}/חודש</span>
                                {p.currentStock!==null&&<span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>מלאי: {p.currentStock}</span>}
                              </div>
                            </div>
                            {p.unitCost&&<span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>₪{p.unitCost}/יח'</span>}
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 font-bold text-sm shrink-0">
                              <ShoppingCart className="w-3.5 h-3.5"/>{p.suggestedOrder.toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* OK items */}
                    {okItems.length>0 && (
                      <div>
                        <div className={`px-5 py-2 text-xs font-bold flex items-center gap-2 ${isDarkMode?'bg-slate-700/50 text-slate-400':'bg-slate-50 text-slate-500'}`}>
                          <Package className="w-3 h-3"/> להזמין מראש
                        </div>
                        {okItems.map(p => (
                          <div key={p.key} className={`flex items-center gap-4 px-5 py-3 border-b last:border-0 ${isDarkMode?'border-slate-700/50':'border-slate-100'}`}>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.name}</p>
                              <div className="flex items-center gap-3 mt-0.5">
                                {p.sku&&p.sku!==p.name&&<span className={`text-xs font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{p.sku}</span>}
                                <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>ממוצע: {p.avgMonthly.toFixed(1)}/חודש</span>
                              </div>
                            </div>
                            {p.unitCost&&<span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>₪{p.unitCost}/יח'</span>}
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 font-bold text-sm shrink-0">
                              <ShoppingCart className="w-3.5 h-3.5"/>{p.suggestedOrder.toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Supplier total footer */}
                    <div className={`flex justify-between items-center px-5 py-3 ${isDarkMode?'bg-slate-700/30':'bg-slate-50'}`}>
                      <span className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>סה"כ הזמנה מ{grp.name}</span>
                      <div className="flex items-center gap-4">
                        {grp.totalCost>0&&<span className={`text-sm font-bold ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>{formatShort(grp.totalCost)}</span>}
                        <span className={`font-bold text-sm ${isDarkMode?'text-white':'text-slate-800'}`}>{grp.totalUnits.toLocaleString()} יח'</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
              {/* Import from Priority */}
              <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors ${isDarkMode?'border-emerald-700 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40':'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                {ordersLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                ייבוא מ-Priority
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handlePriorityOrdersUpload} className="hidden" disabled={ordersLoading}/>
              </label>
              <button onClick={()=>{setShowAddOrder(true);setEditOrderId(null);setOrderForm({productKey:'',productName:'',supplier:'',orderedQty:'',orderDate:new Date().toISOString().slice(0,10),expectedDate:'',status:'ordered',poNumber:'',notes:''}); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-500/20">
                <Check className="w-4 h-4"/> + הוסף ידנית
              </button>
            </div>
          </div>

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
                {[['ordered','הוזמן','#3b82f6'],['in_transit','בדרך','#10b981'],['delayed','מאחר','#ef4444']].map(([s,l,color])=>{
                  const n = openOrders.filter(o=>o.status===s).length;
                  return n>0 ? <span key={s} className="flex items-center gap-1 text-xs font-medium" style={{color}}><span className="w-2 h-2 rounded-full" style={{background:color}}/>{l}: {n}</span> : null;
                })}
                <div className="mr-auto flex items-center gap-4">
                  <span className={`text-xs font-bold ${isDarkMode?'text-blue-300':'text-blue-700'}`}>
                    {openOrders.reduce((a,o)=>a+(o.orderedQty||0),0).toLocaleString()} יח' בדרך
                  </span>
                  {openOrders.some(o=>o.value>0) && (
                    <span className={`text-xs font-bold ${isDarkMode?'text-emerald-400':'text-emerald-700'}`}>
                      ₪{Math.round(openOrders.reduce((a,o)=>a+(o.value||0),0)).toLocaleString()} שווי
                    </span>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full text-sm text-right min-w-[700px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                  <thead className={`text-[11px] font-semibold uppercase tracking-widest ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                    <tr>
                      <th className="px-4 py-3 min-w-[160px]">מוצר</th>
                      <th className="px-4 py-3">מק"ט</th>
                      <th className="px-4 py-3">PO</th>
                      <th className="px-4 py-3">יתרה לאספקה</th>
                      <th className="px-4 py-3">שווי ₪</th>
                      <th className="px-4 py-3">הוזמן</th>
                      <th className="px-4 py-3">אספקה צפויה</th>
                      <th className="px-4 py-3">סטטוס</th>
                      <th className="px-4 py-3">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {openOrders.map(order => {
                      const statusStyle = {
                        ordered:    isDarkMode?'bg-blue-500/20 text-blue-300 border-blue-500/30':'bg-blue-50 text-blue-700 border-blue-200',
                        in_transit: isDarkMode?'bg-emerald-500/20 text-emerald-300 border-emerald-500/30':'bg-emerald-50 text-emerald-700 border-emerald-200',
                        delayed:    isDarkMode?'bg-red-500/20 text-red-300 border-red-500/30':'bg-red-50 text-red-700 border-red-200',
                      }[order.status] || '';
                      const statusLabel = {ordered:'הוזמן',in_transit:'בדרך',delayed:'מאחר'}[order.status]||order.status;
                      const isOverdue = order.expectedDate && new Date(order.expectedDate) < new Date();
                      return (
                        <tr key={order.id} className={`transition-all ${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'} ${isOverdue?(isDarkMode?'bg-red-900/10':'bg-red-50/40'):''}`}>
                          <td className="px-4 py-3.5">
                            <p className={`font-medium text-sm ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{order.productName}</p>
                            {order.notes && <p className={`text-xs mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{order.notes}</p>}
                          </td>
                          <td className={`px-4 py-3.5 text-xs font-mono ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{order.productKey!==order.productName?order.productKey:'—'}</td>
                          <td className={`px-4 py-3.5 text-xs font-mono font-bold ${isDarkMode?'text-blue-400':'text-blue-700'}`}>{order.poNumber||'—'}</td>
                          <td className="px-4 py-3.5">
                            <span className={`font-bold text-sm tabular-nums ${isDarkMode?'text-blue-300':'text-blue-700'}`}>{order.orderedQty.toLocaleString()}</span>
                            <span className={`text-xs mr-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>יח'</span>
                          </td>
                          <td className={`px-4 py-3.5 text-sm tabular-nums ${isDarkMode?'text-emerald-400':'text-emerald-600'}`}>
                            {order.value > 0 ? '₪'+Math.round(order.value).toLocaleString() : '—'}
                          </td>
                          <td className={`px-4 py-3.5 text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>{order.orderDate||'—'}</td>
                          <td className={`px-4 py-3.5 text-xs ${isOverdue?'text-red-500 font-bold':(isDarkMode?'text-slate-400':'text-slate-500')}`}>
                            {order.expectedDate||'—'}{isOverdue?' ⚠️':''}
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
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>מתי להזמין כל מוצר — לפי כיסוי מלאי + זמן אספקה ({leadTime} חודש)</p>
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
              {[['critical','⛔ הזמן עכשיו','#ef4444'],['urgent','⚡ הזמן תוך שבוע','#f59e0b'],['soon','📅 הזמן תוך שבועיים','#3b82f6'],['planned','🗓 תכנן לחודש הבא','#8b5cf6'],['later','✅ אין צורך דחוף','#10b981']].map(([urg, label, color]) => {
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
                              <span className={isDarkMode?'text-slate-400':'text-slate-500'}>כיסוי: <strong>{p.coverageDays}</strong> יום</span>
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
              <div className={`p-2.5 rounded-xl ${isDarkMode?'bg-violet-500/15':'bg-violet-50'}`}><Activity className="w-5 h-5 text-violet-500"/></div>
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
                  className="w-full accent-violet-500"/>
                <div className="flex justify-between text-xs mt-1">
                  {[-50,-25,0,'+25','+50','+100'].map((l,i)=>(
                    <span key={i} className={isDarkMode?'text-slate-600':'text-slate-400'}>{l}%</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {[0.7,0.85,1.0,1.2,1.5,2.0].map(v=>(
                  <button key={v} onClick={()=>setWhatIfMultiplier(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${whatIfMultiplier===v?(isDarkMode?'bg-violet-500/20 border-violet-500 text-violet-300':'bg-violet-50 border-violet-400 text-violet-700'):(isDarkMode?'border-slate-700 text-slate-400':'border-slate-200 text-slate-500')}`}>
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
                  {label:'יחידות (תרחיש)', val:totalAdj.toLocaleString(), sub:`שינוי: ${totalAdj>totalBase?'+':''}${(totalAdj-totalBase).toLocaleString()}`, color: totalAdj>totalBase?'text-amber-500':'text-emerald-500'},
                  {label:'עלות (בסיס)', val:formatShort(totalCostBase), sub:''},
                  {label:'עלות (תרחיש)', val:formatShort(totalCostAdj), sub:`${totalCostAdj>totalCostBase?'+':''}${formatShort(totalCostAdj-totalCostBase)}`, color: totalCostAdj>totalCostBase?'text-amber-500':'text-emerald-500'},
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
                    <th className="px-4 py-3">מוצר</th>
                    <th className="px-4 py-3">ABC</th>
                    <th className="px-4 py-3">ממוצע בסיס</th>
                    <th className="px-4 py-3">ממוצע תרחיש</th>
                    <th className="px-4 py-3">כיסוי (יום)</th>
                    <th className="px-4 py-3">הזמנה בסיס</th>
                    <th className={`px-4 py-3 font-bold ${isDarkMode?'text-violet-400':'text-violet-700'}`}>הזמנה תרחיש</th>
                    <th className="px-4 py-3">שינוי</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                  {whatIfProducts.slice(0,50).map(p=>(
                    <tr key={p.key} className={`${isDarkMode?'hover:bg-slate-700/30':'hover:bg-slate-50'} ${p.orderDelta>0?(isDarkMode?'':'bg-amber-50/30'):''}`}>
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
                      <td className={`px-4 py-3 tabular-nums font-bold ${isDarkMode?'text-violet-300':'text-violet-700'}`}>{p.adjOrder}</td>
                      <td className="px-4 py-3">
                        {p.orderDelta !== 0 && (
                          <span className={`text-xs font-bold ${p.orderDelta>0?(isDarkMode?'text-amber-400':'text-amber-600'):(isDarkMode?'text-emerald-400':'text-emerald-600')}`}>
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
                <p className={`text-xs ${isDarkMode?'text-slate-400':'text-slate-500'}`}>פריטים עם מלאי שלא נמכרו בתקופה שנבחרה</p>
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
                    <Trash2 className="w-4 h-4 text-red-400"/> {deadStockData.length} פריטים לא זמים
                  </h3>
                </div>
                <button onClick={() => {
                  setTimeout(() => {
                    try {
                      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>פריטים מתים</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml></head><body>`;
                      html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri;font-size:11px;direction:rtl">`;
                      html += `<thead><tr style="background:#1e293b;color:#fff"><th>מוצר</th><th>מק"ט</th><th>ABC</th><th>ימים ללא מכירה</th><th>מלאי נוכחי</th><th>עלות יחידה ₪</th><th style="background:#dc2626">ערך מלאי תקוע ₪</th><th>ספק</th></tr></thead><tbody>`;
                      deadStockData.forEach(p => {
                        html += `<tr style="background:#fff7f7"><td>${p.name}</td><td>${p.sku||''}</td><td style="text-align:center;font-weight:bold">${p.abc}</td><td style="text-align:center;color:#dc2626;font-weight:bold">${p.daysSince??'לא ידוע'}</td><td style="text-align:center">${p.currentStock??'לא ידוע'}</td><td style="text-align:center">${p.unitCost?'₪'+p.unitCost:''}</td><td style="text-align:center;font-weight:bold;color:#dc2626">${p.stockValue>0?'₪'+Math.round(p.stockValue).toLocaleString():''}</td><td>${p.supplier||''}</td></tr>`;
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
                      <th className="px-4 py-3 min-w-[180px]">מוצר</th>
                      <th className="px-4 py-3">ABC</th>
                      <th className="px-4 py-3 whitespace-nowrap">ימים ללא מכירה</th>
                      <th className="px-4 py-3 whitespace-nowrap">מלאי נוכחי</th>
                      <th className="px-4 py-3 whitespace-nowrap">מחיר קניה</th>
                      <th className={`px-4 py-3 whitespace-nowrap font-bold ${isDarkMode?'text-red-400':'text-red-700'}`}>ערך תקוע</th>
                      <th className="px-4 py-3">ספק</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
                    {deadStockData.map(p => (
                      <tr key={p.key} className={`transition-all ${isDarkMode?'hover:bg-red-900/10':'hover:bg-red-50/50'}`}>
                        <td className="px-4 py-3.5">
                          <p className={`font-medium text-sm truncate max-w-[200px] ${isDarkMode?'text-slate-100':'text-slate-800'}`}>{p.name}</p>
                          {p.sku&&p.sku!==p.name&&<p className={`text-xs font-mono ${isDarkMode?'text-slate-600':'text-slate-400'}`}>{p.sku}</p>}
                        </td>
                        <td className="px-4 py-3.5"><ABCBadge cls={p.abc} xyz={p.xyz} abcXyz={p.abcXyz}/></td>
                        <td className="px-4 py-3.5">
                          <span className={`font-bold tabular-nums px-2.5 py-1 rounded-lg text-sm
                            ${(p.daysSince||0)>180?(isDarkMode?'bg-red-500/20 text-red-300':'bg-red-100 text-red-700')
                              :(p.daysSince||0)>90?(isDarkMode?'bg-amber-500/20 text-amber-300':'bg-amber-100 text-amber-700')
                              :(isDarkMode?'bg-slate-700 text-slate-300':'bg-slate-100 text-slate-600')}`}>
                            {p.daysSince??'—'} יום
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
            <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}>
              <ClipboardList className="w-4 h-4 text-slate-400"/> טבלת רכש
              <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${isDarkMode?'bg-slate-700 text-slate-400':'bg-slate-100 text-slate-500'}`}>{filtered.length}</span>
            </h3>
            <div className={`flex rounded-lg p-1 text-xs ${isDarkMode?'bg-slate-700':'bg-slate-100'}`}>
              {[['all','הכל'],['A','A'],['B','B'],['C','C']].map(([k,l])=>(
                <button key={k} onClick={()=>setAbcFilter(k)} className={`px-2.5 py-1 rounded-md transition-all font-medium ${abcFilter===k?(isDarkMode?'bg-slate-600 text-white shadow':'bg-white shadow text-slate-800'):(isDarkMode?'text-slate-400':'text-slate-500')}`}>{l}</button>
              ))}
            </div>
            <button onClick={()=>setShowLegend(p=>!p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${showLegend?(isDarkMode?'bg-slate-700 border-slate-500 text-white':'bg-slate-200 border-slate-300 text-slate-800'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white':'border-slate-200 text-slate-500 hover:text-slate-700')}`}>
              <Info className="w-3.5 h-3.5"/> מקרא ABC-XYZ
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {totalOrderUnits>0 && (
              <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border font-medium ${isDarkMode?'bg-blue-500/10 border-blue-500/20 text-blue-300':'bg-blue-50 border-blue-100 text-blue-700'}`}>
                <ShoppingCart className="w-3.5 h-3.5"/>
                {totalOrderUnits.toLocaleString()} יח\'
                {totalOrderCost>0 && <span className={`mr-1 pr-1 border-r ${isDarkMode?'border-blue-500/30':'border-blue-200'}`}>{formatShort(totalOrderCost)}</span>}
              </div>
            )}
            <div className="relative">
              <Search className={`absolute right-3 top-2.5 w-3.5 h-3.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}/>
              <input type="text" placeholder="חיפוש..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                className={`pl-4 pr-9 py-2 border rounded-xl text-xs w-36 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
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
          </div>
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className={`w-full text-sm text-right min-w-[900px] ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
            <thead className={`text-xs uppercase tracking-wide sticky top-0 z-10 ${isDarkMode?'bg-slate-900/95 text-slate-400 backdrop-blur':'bg-slate-50/95 text-slate-500 backdrop-blur'}`}>
              <tr>
                <th className="px-4 py-3.5 min-w-[180px]">מוצר</th>
                <th className="px-4 py-3.5 cursor-pointer hover:text-blue-500 select-none whitespace-nowrap" onClick={()=>reqSort('abc')}>ABC ↕</th>
                <th className="px-4 py-3.5 cursor-pointer hover:text-blue-500 select-none whitespace-nowrap" onClick={()=>reqSort('avgMonthly')}>ממוצע / תחזית ↕</th>
                <th className="px-4 py-3.5 cursor-pointer hover:text-blue-500 select-none whitespace-nowrap" onClick={()=>reqSort('trend')}>מגמה ↕</th>
                <th className="px-4 py-3.5 whitespace-nowrap">מלאי עכשיו</th>
                <th className="px-4 py-3.5 cursor-pointer hover:text-blue-500 select-none whitespace-nowrap" onClick={()=>reqSort('coverageDays')}>כיסוי ↕</th>
                <th className={`px-4 py-3.5 cursor-pointer select-none whitespace-nowrap font-bold ${isDarkMode?'text-blue-400 hover:text-blue-300':'text-blue-700 hover:text-blue-600'}`} onClick={()=>reqSort('suggestedOrder')}>להזמין ↕</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode?'divide-slate-700/50':'divide-slate-100'}`}>
              {filtered.map(p => {
                const isEditing = editingStock===p.key;
                const rowBg = p.risk==='critical'?(isDarkMode?'bg-red-900/10':'bg-red-50/60'):p.risk==='low'?(isDarkMode?'bg-amber-900/5':'bg-amber-50/30'):'';
                return (
                  <tr key={p.key} className={`transition-all duration-150 group cursor-default ${isDarkMode?'hover:bg-slate-700/50':'hover:bg-blue-50/40'} ${rowBg}`}>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`font-medium text-sm ${isDarkMode?'text-slate-100':'text-slate-800'} truncate`} title={p.name}>{p.name}</p>
                        {p.lifecycle==='growing'  && <span title="צמיחה" className="text-xs">🚀</span>}
                        {p.lifecycle==='declining' && <span title="דעיכה" className="text-xs">⚠️</span>}
                        {p.lifecycle==='dying'     && <span title="גוסס" className="text-xs">🔴</span>}
                        {p.incomingQty>0 && <span title={`בדרך: ${p.incomingQty} יח'`} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}>📦 {p.incomingQty}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {p.sku&&p.sku!==p.name&&<span className={`text-xs font-mono ${isDarkMode?'text-slate-600':'text-slate-400'}`}>{p.sku}</span>}
                        {p.supplier&&<span className={`text-xs ${isDarkMode?'text-slate-600':'text-slate-400'} truncate max-w-[100px]`} title={p.supplier}>{p.supplier}</span>}
                      </div>
                      <SeasonalityBar idx={p.seasonalityIdx} avgs={p.monthlyAvgs}/>
                    </td>
                    <td className="px-4 py-3.5"><ABCBadge cls={p.abc} xyz={p.xyz} abcXyz={p.abcXyz}/></td>
                    {/* Avg + Forecast combined */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className={`font-bold tabular-nums text-sm ${isDarkMode?'text-slate-200':'text-slate-700'}`}>{p.avgMonthly.toFixed(1)}</span>
                          <span className={`text-xs ${isDarkMode?'text-slate-500':'text-slate-400'}`}>יח'</span>
                          {p.isLimitedData && (
                            <span title={`נתונים מ-${p.avgDataMonths} חודשים בלבד — ממוצע לא אמין`}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help ${isDarkMode?'bg-amber-500/20 text-amber-400':'bg-amber-100 text-amber-700'}`}>
                              ⚠ {p.avgDataMonths}m
                            </span>
                          )}
                          {!p.isLimitedData && p.avgDataMonths > 0 && (
                            <span title={`ממוצע מבוסס על ${p.avgDataMonths} חודשים`}
                              className={`text-[10px] px-1 rounded cursor-help ${isDarkMode?'text-slate-600':'text-slate-400'}`}>
                              {p.avgDataMonths}m
                            </span>
                          )}
                        </div>
                        {p.forecastNext>0 && <div className={`text-xs flex items-center gap-1 ${isDarkMode?'text-blue-400':'text-blue-600'}`}>
                          <TrendingUp className="w-3 h-3"/>תחזית: {p.forecastNext}
                        </div>}
                        {p.safetyStock>0 && <div className={`text-xs flex items-center gap-1 ${isDarkMode?'text-purple-400':'text-purple-600'}`}
                          title="מלאי בטחון מחושב (95% רמת שירות)">
                          <Activity className="w-3 h-3"/>בטחון: {p.safetyStock}
                        </div>}
                      </div>
                    </td>
                    {/* Trend */}
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-bold whitespace-nowrap ${!p.trend?(isDarkMode?'text-slate-500':'text-slate-400'):p.trend>0?'text-emerald-500':'text-red-500'}`}>
                        {p.trend>5?<ArrowUpRight className="w-3.5 h-3.5"/>:p.trend<-5?<ArrowDownRight className="w-3.5 h-3.5"/>:<Minus className="w-3.5 h-3.5"/>}
                        {p.trend?`${Math.abs(p.trend).toFixed(0)}%`:'—'}
                      </span>
                    </td>
                    {/* Stock — editable, shows minStock hint below */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input type="number" autoFocus defaultValue={p.currentStock??''}
                          onBlur={e=>{saveStock(p.key,e.target.value);setEditingStock(null);}}
                          onKeyDown={e=>{if(e.key==='Enter'){saveStock(p.key,e.target.value);setEditingStock(null);}if(e.key==='Escape')setEditingStock(null);}}
                          style={isDarkMode?{background:'#1e293b',color:'#f1f5f9',borderColor:'#3b82f6'}:{}}
                          className="w-20 px-2 py-1.5 border-2 border-blue-500 rounded-lg text-xs text-right focus:outline-none" placeholder="0"
                        />
                      ) : (
                        <div>
                          <button onClick={()=>setEditingStock(p.key)}
                            className={`flex flex-col items-start px-3 py-2 rounded-xl text-xs border-2 transition-colors group-hover:border-blue-400
                              ${p.currentStock!==null
                                ?(p.currentStock<=0
                                  ?(isDarkMode?'border-red-500/60 bg-red-900/20 text-red-300':'border-red-300 bg-red-50 text-red-700')
                                  :(isDarkMode?'border-slate-700 bg-slate-700/50 text-slate-300':'border-slate-200 bg-white text-slate-700'))
                                :(isDarkMode?'border-dashed border-slate-700 text-slate-500 hover:text-blue-400':'border-dashed border-slate-300 text-slate-400 hover:text-blue-500')}`}
                            title="לחץ לעריכה">
                            {p.currentStock!==null ? (
                              <>
                                <span className={`font-bold tabular-nums text-base leading-tight ${p.currentStock<=0?(isDarkMode?'text-red-400':'text-red-600'):(isDarkMode?'text-white':'text-slate-800')}`}>
                                  {p.currentStock.toLocaleString()}
                                </span>
                                <span className={`text-[10px] mt-0.5 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>יח'{p.minStock?' · מינ׳ '+p.minStock:''}</span>
                              </>
                            ) : (
                              <span className="flex items-center gap-1 py-1"><RefreshCw className="w-3 h-3"/>הזן מלאי</span>
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge risk={p.risk} months={p.coverageMonths} days={p.coverageDays}/>
                      {p.coverageDays!==null && (
                        <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden w-16 ${isDarkMode?'bg-slate-700':'bg-slate-200'}`}>
                          <div className="h-full rounded-full transition-all duration-500" style={{
                            width: Math.min(100,(p.coverageDays/(monthsToStock*30+1)*100)).toFixed(0)+'%',
                            background: p.risk==='critical'?'#ef4444':p.risk==='low'?'#f59e0b':'#10b981'
                          }}/>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.suggestedOrder>0 ? (
                        <div className="flex flex-col items-start gap-1">
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold border-2 whitespace-nowrap
                            ${p.risk==='critical'
                              ?(isDarkMode?'bg-red-500/20 border-red-500 text-red-300':'bg-red-50 border-red-400 text-red-700')
                              :p.risk==='low'
                              ?(isDarkMode?'bg-amber-500/20 border-amber-500 text-amber-300':'bg-amber-50 border-amber-400 text-amber-700')
                              :(isDarkMode?'bg-blue-500/15 border-blue-500/50 text-blue-300':'bg-blue-50 border-blue-300 text-blue-700')}`}>
                            <ShoppingCart className="w-4 h-4"/>
                            <span className="text-base tabular-nums">{p.suggestedOrder.toLocaleString()}</span>
                            <span className="text-xs font-normal opacity-70">יח'</span>
                          </div>
                          {p.orderCost&&<span className={`text-xs px-1 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>{formatShort(p.orderCost)}</span>}
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border ${isDarkMode?'bg-emerald-500/10 border-emerald-500/20 text-emerald-400':'bg-emerald-50 border-emerald-200 text-emerald-600'}`}>
                          <Check className="w-3.5 h-3.5"/> מספיק
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length&&<tr><td colSpan={7} className={`px-4 py-16 text-center text-sm ${isDarkMode?'text-slate-600':'text-slate-400'}`}>לא נמצאו מוצרים</td></tr>}
            </tbody>
          </table>
        </div>
        <div className={`px-5 py-3 border-t flex flex-wrap gap-4 text-xs ${isDarkMode?'border-slate-700 text-slate-500':'border-slate-100 text-slate-400'}`}>
          <span><span className="font-bold text-amber-500">A</span> = 80%</span>
          <span><span className="font-bold text-blue-500">B</span> = 15%</span>
          <span><span className="font-bold text-slate-400">C</span> = 5%</span>
          <span className="flex items-center gap-1"><TriangleAlert className="w-3 h-3 text-red-500"/> קריטי: מלאי &lt; זמן אספקה</span>
          <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-500"/> נמוך: מלאי &lt; יעד</span>
          <span className="mr-auto italic">לחץ על מלאי לעריכה · נשמר אוטומטית</span>
        </div>
      </div>
      )} {/* end viewMode === products */}
    </div>
    </>
  );
};


// ─── SETTINGS MODAL ────────────────────────────────────
const SettingsModal = ({ isOpen, onClose, apiKey, onSave, isDarkMode }) => {
  const [localKey, setLocalKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setLocalKey(apiKey); }, [apiKey, isOpen]);

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

// ─── MAIN APP ─────────────────────────────────────────
const App = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => typeof window!=='undefined' && localStorage.getItem('theme')==='dark');
  const [apiKey, setApiKey] = useState(() => typeof window!=='undefined' ? (localStorage.getItem('geminiApiKey')||'') : '');
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

  const [salesData, setSalesData] = useState(() => { try { return JSON.parse(localStorage.getItem('dashboardSalesData')||'[]'); } catch { return []; } });
  const [suppliersData, setSuppliersData] = useState(() => { try { return JSON.parse(localStorage.getItem('dashboardSuppliersData')||'[]'); } catch { return []; } });
  const [salesFileNames, setSalesFileNames] = useState(() => { try { return JSON.parse(localStorage.getItem('salesFileNames')||'[]'); } catch { return []; } });
  const [suppliersFileNames, setSuppliersFileNames] = useState(() => { try { return JSON.parse(localStorage.getItem('suppliersFileNames')||'[]'); } catch { return []; } });

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key:'total', direction:'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatThinking, setChatThinking] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);

  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({ date:true, sku:true, description:true, quantity:true, total:true });

  const [availableDates, setAvailableDates] = useState([]);
  const [dateFilter, setDateFilter] = useState({ start:'', end:'' });
  const [drillDownMonth, setDrillDownMonth] = useState(null);
  const [showYoY, setShowYoY] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [pieMetric, setPieMetric] = useState('total');

  // Persist
  const save = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); setStorageWarning(false); } catch { setStorageWarning(true); } };
  useEffect(() => { save('dashboardSalesData', salesData); save('salesFileNames', salesFileNames); }, [salesData, salesFileNames]);
  useEffect(() => { save('dashboardSuppliersData', suppliersData); save('suppliersFileNames', suppliersFileNames); }, [suppliersData, suppliersFileNames]);

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

  const handleClearData = () => {
    // overview + procurement = clear everything, like summary
    const clearBoth = activeTab==='summary' || activeTab==='overview' || activeTab==='procurement';
    const keys = clearBoth ? ['sales','suppliers'] : [activeTab];
    keys.forEach(k => {
      if (k==='sales') {
        setSalesData([]); setSalesFileNames([]);
        localStorage.removeItem('dashboardSalesData'); localStorage.removeItem('salesFileNames');
      } else if (k==='suppliers') {
        setSuppliersData([]); setSuppliersFileNames([]);
        localStorage.removeItem('dashboardSuppliersData'); localStorage.removeItem('suppliersFileNames');
      }
    });
    setAvailableDates([]); setDateFilter({start:'',end:''}); resetFilters(); setDrillDownMonth(null);
  };

  const resetFilters = () => {
    if (availableDates.length>0) setDateFilter({start:availableDates[0],end:availableDates[availableDates.length-1]});
    setSearchTerm(''); setSelectedProduct([]); setSelectedSku(''); setSelectedSupplier(''); setDrillDownMonth(null);
  };

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
    if (searchTerm) { const l=searchTerm.toLowerCase(); data=data.filter(d=>(d.description||'').toLowerCase().includes(l)||(d.sku||'').toLowerCase().includes(l)||(d.supplier||'').toLowerCase().includes(l)); }
    return data.sort((a,b)=>{
      let va=a[sortConfig.key], vb=b[sortConfig.key];
      if (sortConfig.key==='date') { va=getDateVal(a.date); vb=getDateVal(b.date); }
      return sortConfig.direction==='asc' ? (va<vb?-1:va>vb?1:0) : (va>vb?-1:va<vb?1:0);
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
    const months=[...new Set(data.map(d=>d.date))].sort((a,b)=>getDateVal(a)-getDateVal(b));
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
  }, [filteredData, dateFilter, availableDates, activeTab]);

  useEffect(() => { if (stats?.alerts) setNotifications(stats.alerts); }, [stats]);

  const chartData = useMemo(() => {
    if (activeTab==='summary'||activeTab==='overview') return null;
    const mm={};
    filteredData.forEach(d=>{ if(!d.date)return; mm[d.date]=mm[d.date]||{total:0,quantity:0}; mm[d.date].total+=d.total; mm[d.date].quantity+=d.quantity;
      if(activeTab==='sales'&&selectedProduct.length>0){ mm[d.date][d.description]=(mm[d.date][d.description]||0)+d.total; mm[d.date][`${d.description}_q`]=(mm[d.date][`${d.description}_q`]||0)+d.quantity; }
    });
    const monthly = Object.entries(mm).map(([name,v])=>({name,...v,order:getDateVal(name),...(selectedProduct.length>0?selectedProduct.reduce((a,p)=>({...a,[p]:v[p]||0,[`${p}_q`]:v[`${p}_q`]||0}),{}):{})  })).sort((a,b)=>a.order-b.order);
    const em={};
    const kf=activeTab==='sales'?'description':'supplier';
    filteredData.forEach(d=>{ const n=d[kf]; em[n]=em[n]||{total:0,quantity:0}; em[n].total+=d.total; em[n].quantity+=d.quantity; });
    const vk=(activeTab==='suppliers'||pieMetric==='total')?'total':'quantity';
    let pie=Object.entries(em).map(([name,v])=>({name,...v,value:v[vk]})).sort((a,b)=>b.value-a.value);
    if(!selectedProduct.length&&!selectedSupplier) pie=pie.slice(0,5);
    return { monthly, pie };
  }, [filteredData, activeTab, selectedProduct, selectedSupplier, pieMetric]);

  const generateAI = async () => {
    setAiModalOpen(true); setAiLoading(true); setAiReport('');

    // Check API key first
    if (!apiKey) {
      setAiReport('⚠️ לא הוגדר API Key.\n\nלחץ על כפתור ⚙️ ההגדרות בכותרת → הכנס מפתח Gemini.');
      setAiLoading(false); return;
    }

    let prompt = activeTab==='summary'
      ? `נתח: הכנסות ${formatCurrency(summaryData?.totalIncome)}, הוצאות ${formatCurrency(summaryData?.totalExpenses)}, רווח ${formatCurrency(summaryData?.totalProfit)} (${summaryData?.profitMargin.toFixed(1)}%). תן 3 תובנות קצרות בעברית.`
      : `נתח ${activeTab==='sales'?'מכירות':'ספקים'}: סה"כ ${formatCurrency(stats?.totalAmount)}, מגמה: ${chartData?.monthly.map(m=>`${m.name}:${formatCurrency(m.total||m.sales)}`).join(', ')}. תן תובנות קצרות בעברית.`;

    // Try models in order until one works
    const models = [
      'gemini-2.5-flash-preview-05-20',  // newest
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-pro',
    ];
    let lastError = '';

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const d = await res.json();

        if (!res.ok) {
          const errMsg = d?.error?.message || `שגיאה ${res.status}`;
          lastError = `[${model}] ${errMsg}`;
          if (res.status === 400 || res.status === 403) break; // bad key — no point retrying
          continue; // model not found — try next
        }

        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) { setAiReport(text); setAiLoading(false); return; }
        lastError = `[${model}] תשובה ריקה`;
      } catch(e) {
        lastError = `[${model}] ${e.message}`;
      }
    }

    // All models failed
    setAiReport(
      `❌ שגיאה בחיבור ל-Gemini\n\n${lastError}\n\n` +
      `בדוק:\n• האם המפתח תקין? (⚙️ הגדרות)\n• האם יש גישה לאינטרנט?\n• כתובת ה-URL: generativelanguage.googleapis.com`
    );
    setAiLoading(false);
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
        setChatMessages(p=>[...p,{role:'assistant',content:'⚠️ לא הוגדר API Key. הוסף את מפתח Gemini בשורה apiKey בתחילת הקובץ.'}]);
        setChatThinking(false); return;
      }
      const prompt = dataCtx + 'שאלת המשתמש: ' + text + '\nענה בעברית בצורה ברורה וקצרה. אם הנתונים רלוונטיים לשאלה — השתמש בהם.';
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key='+apiKey, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) });
      if (!res.ok) { const err=await res.json().catch(()=>({})); setChatMessages(p=>[...p,{role:'assistant',content:'שגיאת API ('+res.status+'): '+(err?.error?.message||'בדוק את ה-API Key')}]); setChatThinking(false); return; }
      const d = await res.json();
      const reply = d.candidates?.[0]?.content?.parts?.[0]?.text;
      setChatMessages(p=>[...p,{role:'assistant',content:reply||'לא קיבלתי תשובה.'}]);
    } catch(e) { setChatMessages(p=>[...p,{role:'assistant',content:'שגיאה: '+e.message}]); } finally { setChatThinking(false); }
  }, [salesData, suppliersData]);


  // YoY comparison data
  const yoyData = useMemo(() => {
    if (!showYoY || activeTab !== 'sales') return null;
    const startVal = dateFilter.start ? getDateVal(dateFilter.start) : 0;
    const endVal   = dateFilter.end   ? getDateVal(dateFilter.end)   : 999999;
    const inR = d => { const v = getDateVal(d.date); return v >= startVal && v <= endVal; };
    const data = salesData.filter(inR);
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
  }, [showYoY, activeTab, salesData, dateFilter]);

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

  const requestSort = (key) => setSortConfig(p=>({ key, direction:p.key===key&&p.direction==='asc'?'desc':'asc' }));

  const navItems = [
    { id:'overview', label:'סקירה כללית', icon:Home, color:'text-sky-400' },
    { id:'sales', label:'מכירות', icon:TrendingUp, color:'text-blue-400' },
    { id:'suppliers', label:'רכש וספקים', icon:Truck, color:'text-emerald-400' },
    { id:'procurement', label:'תכנון רכש', icon:ShoppingCart, color:'text-amber-400' },
    { id:'summary', label:'רווח והפסד', icon:BarChart3, color:'text-violet-400' },
  ];

  return (
    <div className={`flex min-h-screen font-sans transition-colors duration-300 ${isDarkMode?'bg-slate-950 text-slate-100':'bg-slate-50 text-slate-800'}`} dir="rtl">
      <SettingsModal isOpen={settingsOpen} onClose={()=>setSettingsOpen(false)} apiKey={apiKey} onSave={setApiKey} isDarkMode={isDarkMode}/>
      <AIModal isOpen={aiModalOpen} onClose={()=>setAiModalOpen(false)} loading={aiLoading} report={aiReport} isDarkMode={isDarkMode}/>
      <ClearModal isOpen={clearModalOpen} onClose={()=>setClearModalOpen(false)} onConfirm={handleClearData} type={activeTab} isDarkMode={isDarkMode}/>

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
            {/* Quick date filters */}
            {availableDates.length>0 && (
              <div className={`hidden xl:flex items-center p-1 rounded-lg border gap-0.5 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-slate-100 border-slate-200'}`}>
                {[[3,'3M'],['year','השנה'],[null,'הכל']].map(([f,l])=>(
                  <button key={l} onClick={()=>setQuickDate(f)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isDarkMode?'text-slate-400 hover:bg-slate-700 hover:text-white':'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'}`}>{l}</button>
                ))}
              </div>
            )}
            <button onClick={toggleTheme} className={`p-2.5 rounded-xl transition-all ${isDarkMode?'bg-slate-800 text-yellow-400 hover:bg-slate-700':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {isDarkMode?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}
            </button>
            <div className="relative">
              <button onClick={()=>setShowNotifications(p=>!p)} className={`p-2.5 rounded-xl relative ${isDarkMode?'bg-slate-800 text-slate-300 hover:bg-slate-700':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                <Bell className="w-4 h-4"/>
                {notifications.length>0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full animate-pulse"/>}
              </button>
              {showNotifications && (
                <div className={`absolute left-0 mt-2 w-72 rounded-xl shadow-2xl border p-4 z-50 animate-in fade-in zoom-in duration-150 ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-200'}`}>
                  <h4 className={`font-bold text-sm mb-3 ${isDarkMode?'text-white':'text-slate-800'}`}>התראות</h4>
                  {notifications.length>0 ? notifications.map(n=>(
                    <div key={n.id} className={`p-2.5 rounded-lg text-xs flex items-start gap-2 mb-2 ${n.type==='success'?'bg-emerald-500/10 text-emerald-600':n.type==='warning'?'bg-red-500/10 text-red-600':'bg-blue-500/10 text-blue-600'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${n.type==='success'?'bg-emerald-500':n.type==='warning'?'bg-red-500':'bg-blue-500'}`}/>
                      {n.text}
                    </div>
                  )) : <p className={`text-xs text-center py-3 ${isDarkMode?'text-slate-500':'text-slate-400'}`}>אין התראות</p>}
                </div>
              )}
            </div>
            {/* Settings button — shows dot if no API key */}
            <button onClick={()=>setSettingsOpen(true)}
              className={`relative p-2.5 rounded-xl transition-all ${isDarkMode?'bg-slate-800 text-slate-300 hover:bg-slate-700':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              title="הגדרות">
              <Settings className="w-4 h-4"/>
              {!apiKey && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-400 rounded-full" title="מפתח AI לא מוגדר"/>}
            </button>
            <button onClick={generateAI} className="hidden sm:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-blue-500/20 font-medium text-sm transition-all hover:-translate-y-0.5 active:scale-95">
              <Sparkles className="w-4 h-4 text-yellow-200"/>
              <span className="hidden sm:inline">תובנות AI</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
          {/* Overview */}
          {activeTab==='overview' && (
            <OverviewPage salesData={salesData} suppliersData={suppliersData} dateFilter={dateFilter} availableDates={availableDates} isDarkMode={isDarkMode} setActiveTab={setActiveTab}/>
          )}

          {/* Procurement Planning */}
          {activeTab==='procurement' && (
            <ProcurementPage salesData={salesData} isDarkMode={isDarkMode} apiKey={apiKey} />
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
              <div className="flex flex-col items-center justify-center h-96 text-center">
                <div className={`p-6 rounded-full mb-4 ${isDarkMode?'bg-slate-800':'bg-slate-100'}`}><BarChart3 className={`w-12 h-12 ${isDarkMode?'text-slate-600':'text-slate-300'}`}/></div>
                <h3 className={`text-xl font-bold ${isDarkMode?'text-white':'text-slate-800'}`}>אין נתונים לסיכום</h3>
                <p className={`mt-2 ${isDarkMode?'text-slate-400':'text-slate-500'}`}>טען קבצי מכירות וספקים כדי לראות סיכום פיננסי.</p>
              </div>
            )
          )}

          {/* Sales / Suppliers */}
          {(activeTab==='sales'||activeTab==='suppliers') && (
            activeData.length===0 ? <EmptyState onUpload={handleFileUpload} loading={loading} isDarkMode={isDarkMode}/> : (
              <div className="space-y-6 animate-in fade-in duration-400">
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
                      <div className="flex justify-between items-center mb-5">
                        <h3 className={`font-bold flex items-center gap-2 ${isDarkMode?'text-white':'text-slate-800'}`}><Calendar className="w-5 h-5 text-blue-500"/>{activeTab==='sales'?'מגמות מכירות':'מגמות הוצאות'}</h3>
                        <div className="flex items-center gap-2">
                          {activeTab==='sales' && (
                            <button onClick={()=>setShowYoY(p=>!p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${showYoY?(isDarkMode?'bg-blue-500/20 border-blue-500/30 text-blue-300':'bg-blue-50 border-blue-200 text-blue-700'):(isDarkMode?'border-slate-700 text-slate-400 hover:text-white':'border-slate-200 text-slate-500 hover:text-slate-700')}`}>
                              <BarChart3 className="w-3.5 h-3.5"/> שנה/שנה
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
                        <ComposedChart data={chartData.monthly} onClick={d=>{ if(d?.activeLabel) setDrillDownMonth(p=>p===d.activeLabel?null:d.activeLabel); }} style={{cursor:'pointer'}}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode?'#334155':'#f1f5f9'}/>
                          <XAxis dataKey="name" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickMargin={8}/>
                          <YAxis yAxisId="left" stroke={isDarkMode?'#94a3b8':'#94a3b8'} tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`₪${v/1000}k`}/>
                          {activeTab==='sales' && <YAxis yAxisId="right" orientation="right" stroke="#10b981" tick={{fontSize:11}} axisLine={false} tickLine={false}/>}
                          <RechartsTooltip cursor={{fill:isDarkMode?'#334155':'#f8fafc',opacity:0.5}} formatter={(v,n)=>n.includes('כמות')?v.toLocaleString():formatCurrency(v)} contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#fff':'#0f172a'}}/>
                          <Legend iconType="circle" wrapperStyle={{paddingTop:'12px',fontSize:'12px'}}/>
                          {activeTab==='sales'&&selectedProduct.length>0 ? selectedProduct.map((p,i)=>(
                            <React.Fragment key={p}>
                              <Bar yAxisId="left" dataKey={p} name={p} stackId="a" fill={COLORS[i%COLORS.length]} radius={i===selectedProduct.length-1?[3,3,0,0]:[0,0,0,0]}/>
                              <Line yAxisId="right" type="monotone" dataKey={`${p}_q`} name={`${p} כמות`} stroke={COLORS[i%COLORS.length]} strokeDasharray="4 2" strokeWidth={2} dot={false}/>
                            </React.Fragment>
                          )) : activeTab==='sales' ? (
                            <>
                              <Bar yAxisId="left" dataKey="total" name="סכום" fill="#3b82f6" radius={[4,4,0,0]} barSize={28}/>
                              <Line yAxisId="right" type="monotone" dataKey="quantity" name="כמות" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{r:5}}/>
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
                              <Pie data={chartData.pie} cx="50%" cy="45%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" stroke="none">
                                {chartData.pie.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                              </Pie>
                              <RechartsTooltip
                                formatter={(v,n,p)=>[p.payload.total?formatCurrency(p.payload.total):'', p.payload.name]}
                                contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px',color:isDarkMode?'#f1f5f9':'#0f172a'}}
                                itemStyle={{color:isDarkMode?'#94a3b8':'#64748b'}}
                                labelStyle={{color:isDarkMode?'#f1f5f9':'#0f172a',fontWeight:500}}
                              />
                              <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{fontSize:'11px',paddingTop:'12px'}}/>
                            </PieChart>
                          </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-slate-400"><PieChartIcon className="w-10 h-10 opacity-20"/></div>}
                      </div>
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

                {/* Table */}
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
                        <input type="text" placeholder="חיפוש..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                          className={`pl-4 pr-9 py-2 border rounded-xl text-xs w-40 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode?'bg-slate-900 border-slate-700 text-white placeholder-slate-500':'bg-slate-50 border-slate-200'}`}/>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[460px]">
                    <table className={`w-full text-sm text-right ${isDarkMode?'text-slate-300':'text-slate-600'}`}>
                      <thead className={`text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10 ${isDarkMode?'bg-slate-900 text-slate-400':'bg-slate-100 text-slate-500'}`}>
                        <tr>
                          {visibleColumns.date && <th className={`px-5 py-3.5 cursor-pointer select-none hover:text-blue-500 transition-colors`} onClick={()=>requestSort('date')}>תאריך<SortIcon colKey="date" sortConfig={sortConfig}/></th>}
                          {visibleColumns.sku && activeTab==='sales' && <th className="px-5 py-3.5">מק״ט</th>}
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
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
