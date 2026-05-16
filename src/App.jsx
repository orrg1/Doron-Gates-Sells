import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter,
  ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot,
  Loader2, FileText, Check, Trash2, Truck, Wallet, LayoutDashboard,
  FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight,
  BarChart3, Download, MousePointerClick, MessageSquare, Send, Moon, Sun,
  Info, Bell, User, Settings, Eye, EyeOff, TrendingDown, Zap,
  PieChart as PieChartIcon, Target, ArrowUpRight, ArrowDownRight, Home
} from 'lucide-react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';

// ─── API ───────────────────────────────────────────────
const apiKey = "";

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
        <div className={`absolute z-50 w-full mt-1.5 border rounded-xl shadow-2xl max-h-52 overflow-y-auto text-right animate-in fade-in slide-in-from-top-1 duration-150
          ${isDarkMode?'bg-slate-800 border-slate-700':'bg-white border-slate-100'}`}>
          {filtered.length>0 ? filtered.map((opt,i)=>{
            const sel = multiple?value.includes(opt):value===opt;
            return <div key={i} className={`px-4 py-2.5 cursor-pointer text-sm flex items-center justify-between border-b last:border-0 transition-colors
              ${isDarkMode?'border-slate-700/50 hover:bg-slate-700':'border-slate-50 hover:bg-slate-50'}
              ${sel?(isDarkMode?'text-blue-300 bg-blue-900/20':'text-blue-700 bg-blue-50 font-medium'):(isDarkMode?'text-slate-300':'text-slate-700')}`}
              onClick={()=>handleSelect(opt)}>
              <span>{opt}</span>
              {sel && <Check className="w-4 h-4 text-blue-500"/>}
            </div>;
          }) : <div className={`px-4 py-3 text-sm text-center ${isDarkMode?'text-slate-500':'text-slate-400'}`}>לא נמצאו תוצאות</div>}
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
          האם למחוק את כל נתוני ה<strong>{type==='sales'?'מכירות':type==='suppliers'?'ספקים':'מערכת'}</strong>? פעולה זו אינה הפיכה.
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

// ─── MAIN APP ─────────────────────────────────────────
const App = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => typeof window!=='undefined' && localStorage.getItem('theme')==='dark');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

  // XLSX loader
  useEffect(() => {
    if (window.XLSX) { setXlsxLoaded(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.async = true; s.onload = () => setXlsxLoaded(true);
    document.body.appendChild(s);
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

  const handleFileUpload = async (e) => {
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
  };

  const handleClearData = () => {
    const keys = activeTab==='summary' ? ['sales','suppliers'] : [activeTab];
    keys.forEach(k => {
      if (k==='sales') { setSalesData([]); setSalesFileNames([]); localStorage.removeItem('dashboardSalesData'); localStorage.removeItem('salesFileNames'); }
      else { setSuppliersData([]); setSuppliersFileNames([]); localStorage.removeItem('dashboardSuppliersData'); localStorage.removeItem('suppliersFileNames'); }
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
    let prompt = activeTab==='summary'
      ? `נתח: הכנסות ${formatCurrency(summaryData?.totalIncome)}, הוצאות ${formatCurrency(summaryData?.totalExpenses)}, רווח ${formatCurrency(summaryData?.totalProfit)} (${summaryData?.profitMargin.toFixed(1)}%). תן 3 תובנות קצרות בעברית.`
      : `נתח ${activeTab==='sales'?'מכירות':'ספקים'}: סה"כ ${formatCurrency(stats?.totalAmount)}, מגמה: ${chartData?.monthly.map(m=>`${m.name}:${formatCurrency(m.total||m.sales)}`).join(', ')}. תן תובנות קצרות בעברית.`;
    try {
      const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) });
      const d=await res.json();
      setAiReport(d.candidates?.[0]?.content?.parts?.[0]?.text||'שגיאה.');
    } catch { setAiReport('שגיאת תקשורת.'); } finally { setAiLoading(false); }
  };

  const sendChat = async (text) => {
    setChatMessages(p=>[...p,{role:'user',content:text}]); setChatThinking(true);
    try {
      const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:`ענה בעברית: ${text}`}]}]}) });
      const d=await res.json();
      setChatMessages(p=>[...p,{role:'assistant',content:d.candidates?.[0]?.content?.parts?.[0]?.text||'לא הבנתי.'}]);
    } catch { setChatMessages(p=>[...p,{role:'assistant',content:'שגיאה.'}]); } finally { setChatThinking(false); }
  };

  const requestSort = (key) => setSortConfig(p=>({ key, direction:p.key===key&&p.direction==='asc'?'desc':'asc' }));

  const navItems = [
    { id:'overview', label:'סקירה כללית', icon:Home, color:'text-sky-400' },
    { id:'sales', label:'מכירות', icon:TrendingUp, color:'text-blue-400' },
    { id:'suppliers', label:'רכש וספקים', icon:Truck, color:'text-emerald-400' },
    { id:'summary', label:'רווח והפסד', icon:BarChart3, color:'text-violet-400' },
  ];

  return (
    <div className={`flex min-h-screen font-sans transition-colors duration-300 ${isDarkMode?'bg-slate-950 text-slate-100':'bg-slate-50 text-slate-800'}`} dir="rtl">
      <AIModal isOpen={aiModalOpen} onClose={()=>setAiModalOpen(false)} loading={aiLoading} report={aiReport} isDarkMode={isDarkMode}/>
      <ClearModal isOpen={clearModalOpen} onClose={()=>setClearModalOpen(false)} onConfirm={handleClearData} type={activeTab} isDarkMode={isDarkMode}/>

      {/* FAB Chat */}
      <div className="fixed bottom-6 left-6 z-40">
        {!chatOpen && <button onClick={()=>setChatOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-xl hover:scale-105 transition-all shadow-blue-500/30"><MessageSquare className="w-6 h-6"/></button>}
        <ChatWindow isOpen={chatOpen} onClose={()=>setChatOpen(false)} onSend={sendChat} messages={chatMessages} thinking={chatThinking} isDarkMode={isDarkMode}/>
      </div>

      {/* Sidebar */}
      <div className={`flex-shrink-0 flex flex-col transition-all duration-300 border-l ${isSidebarCollapsed?'w-[68px]':'w-60'} ${isDarkMode?'bg-slate-900 border-slate-800':'bg-slate-900 border-slate-800'}`}>
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
            <button key={item.id} onClick={()=>{setActiveTab(item.id);resetFilters();}}
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
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
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
            <button onClick={generateAI} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-blue-500/20 font-medium text-sm transition-all hover:-translate-y-0.5 active:scale-95">
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
                    <select value={dateFilter.start} onChange={e=>setDateFilter(p=>({...p,start:e.target.value}))} className={`bg-transparent text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer ${isDarkMode?'text-white':'text-slate-700'}`}>
                      {availableDates.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                    <span className={isDarkMode?'text-slate-600':'text-slate-300'}>—</span>
                    <select value={dateFilter.end} onChange={e=>setDateFilter(p=>({...p,end:e.target.value}))} className={`bg-transparent text-xs font-medium border-none focus:ring-0 p-0 cursor-pointer ${isDarkMode?'text-white':'text-slate-700'}`}>
                      {availableDates.map(d=><option key={d} value={d}>{d}</option>)}
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
                        {drillDownMonth && <button onClick={()=>setDrillDownMonth(null)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDarkMode?'bg-blue-500/20 text-blue-300':'bg-blue-50 text-blue-700'}`}><MousePointerClick className="w-3 h-3"/>{drillDownMonth}<X className="w-3 h-3 ml-1"/></button>}
                      </div>
                      <ResponsiveContainer width="100%" height={300}>
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
                              <RechartsTooltip formatter={(v,n,p)=>[p.payload.total?formatCurrency(p.payload.total):'', p.payload.name]} contentStyle={{backgroundColor:isDarkMode?'#1e293b':'#fff',borderColor:isDarkMode?'#334155':'#e2e8f0',borderRadius:'12px'}}/>
                              <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{fontSize:'11px',paddingTop:'12px'}}/>
                            </PieChart>
                          </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-slate-400"><PieChartIcon className="w-10 h-10 opacity-20"/></div>}
                      </div>
                    </div>
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
                      <thead className={`text-xs uppercase tracking-wide sticky top-0 z-10 ${isDarkMode?'bg-slate-900/95 text-slate-400 backdrop-blur':'bg-slate-50/95 text-slate-500 backdrop-blur'}`}>
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
