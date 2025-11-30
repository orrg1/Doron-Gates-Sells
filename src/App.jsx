import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter, ArrowUpDown, ArrowUp, ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot, Loader2, FileText, Check, Trash2, Truck, Wallet, LayoutDashboard, FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight, PieChart as PieChartIcon, BarChart3, Download, MousePointerClick, Clock, MessageSquare, Send } from 'lucide-react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Area } from 'recharts';

// --- הגדרות API של GEMINI ---
const apiKey = "AIzaSyBliujKxcsP_R_nPl0dVRdffZHa3wCiodA"; // הדבק כאן את המפתח שלך

// --- עזרי תאריך וכלליים ---
const HebrewMonthsMap = {
  0: 'ינו', 1: 'פבר', 2: 'מרץ', 3: 'אפר', 4: 'מאי', 5: 'יונ',
  6: 'יול', 7: 'אוג', 8: 'ספט', 9: 'אוק', 10: 'נוב', 11: 'דצמ'
};

const HebrewMonthsReverse = {
  'ינו': 1, 'פבר': 2, 'מרץ': 3, 'אפר': 4, 'מאי': 5, 'יונ': 6,
  'יול': 7, 'אוג': 8, 'ספט': 9, 'אוק': 10, 'נוב': 11, 'דצמ': 12
};

const formatCurrency = (val) => {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
};

const excelDateToJSDate = (serial) => {
   const utc_days  = Math.floor(serial - 25569);
   const utc_value = utc_days * 86400;                                        
   const date_info = new Date(utc_value * 1000);
   return date_info;
}

const normalizeDate = (val) => {
  if (!val) return '';
  if (typeof val === 'string' && val.includes('-') && isNaN(parseFloat(val))) return val; 
  let dateObj = null;
  const numericVal = parseFloat(val);
  if (!isNaN(numericVal) && numericVal > 30000 && numericVal < 60000) {
    dateObj = excelDateToJSDate(numericVal);
  } else {
    dateObj = new Date(val);
  }
  if (dateObj && !isNaN(dateObj.getTime())) {
    const month = HebrewMonthsMap[dateObj.getMonth()];
    const year = dateObj.getFullYear().toString().slice(-2);
    return `${month}-${year}`;
  }
  return val.toString();
};

const getComparableDateValue = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const parts = dateStr.split('-');
  if (parts.length < 2) return 0;
  const [monthStr, yearStr] = parts;
  const month = HebrewMonthsReverse[monthStr] || 0;
  const year = parseInt(yearStr) + 2000;
  return (year * 100) + month;
};

const getMonthsDifference = (startStr, endStr) => {
  if (!startStr || !endStr) return 1;
  const parseDate = (d) => {
    const parts = d.split('-');
    return { m: HebrewMonthsReverse[parts[0]] || 1, y: parseInt(parts[1]) + 2000 };
  };
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  return ((end.y - start.y) * 12) + (end.m - start.m) + 1;
};

// --- רכיבי UI ---

const Card = ({ title, value, subtext, icon: Icon, color, trend }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-shadow h-full relative overflow-hidden">
    <div className="flex-1 min-w-0 z-10">
      <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="flex items-center gap-2 mt-2">
          {trend !== undefined && trend !== null && (
              <span className={`text-xs font-bold flex items-center px-1.5 py-0.5 rounded ${trend >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {trend >= 0 ? <TrendingUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />}
                  {Math.abs(trend).toFixed(1)}%
              </span>
          )}
          {subtext && <p className="text-xs text-slate-400 truncate" title={subtext}>{subtext}</p>}
      </div>
    </div>
    <div className={`p-3 rounded-full ${color} shrink-0 ml-4 self-start`}>
      <Icon className="w-6 h-6 text-white" />
    </div>
  </div>
);

const CustomPieTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-right z-50">
        <p className="font-bold text-slate-800 mb-2 border-b border-slate-100 pb-1">{data.name}</p>
        <div className="space-y-1 text-sm">
          {data.quantity !== undefined && (
             <div className="flex justify-between gap-4">
                <span className="text-slate-500">כמות:</span>
                <span className="font-medium text-blue-600">{data.quantity}</span>
             </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">סכום:</span>
            <span className="font-medium text-emerald-600">{formatCurrency(data.total)}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

const Autocomplete = ({ options, value, onChange, placeholder, icon: Icon, multiple = false, maxSelections = Infinity }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!multiple) setSearchTerm(value || '');
  }, [value, multiple]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        if (!multiple) {
            if (!value) setSearchTerm(''); else setSearchTerm(value);
        } else {
            setSearchTerm('');
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, multiple]);

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    return options.filter(opt => opt.toString().toLowerCase().includes(searchTerm.toLowerCase()));
  }, [options, searchTerm]);

  const handleSelect = (opt) => {
    if (multiple) {
      if (value.includes(opt)) {
        onChange(value.filter(v => v !== opt));
      } else {
        if (value.length < maxSelections) onChange([...value, opt]);
      }
      setSearchTerm('');
    } else {
      onChange(opt);
      setSearchTerm(opt);
      setIsOpen(false);
    }
  };

  const removeTag = (tag, e) => {
    e.stopPropagation();
    onChange(value.filter(v => v !== tag));
  };

  const isLimitReached = multiple && value.length >= maxSelections;

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div 
        className={`relative flex items-center flex-wrap gap-2 w-full pl-8 pr-10 py-2 bg-slate-50 border ${isLimitReached && !isOpen ? 'border-orange-200 bg-orange-50' : 'border-slate-200'} rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${multiple ? 'min-h-[42px]' : ''}`}
        onClick={() => document.getElementById(`input-${placeholder}`)?.focus()}
      >
        {Icon && <Icon className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none z-10" />}
        {multiple && Array.isArray(value) && value.map(val => (
            <span key={val} className="flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full animate-in fade-in zoom-in duration-200 border border-blue-200 shadow-sm">
                <span className="max-w-[150px] truncate" title={val}>{val}</span>
                <X className="w-3 h-3 cursor-pointer hover:text-red-500 transition-colors" onClick={(e) => removeTag(val, e)} />
            </span>
        ))}
        <input
          id={`input-${placeholder}`}
          type="text"
          className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-700 placeholder-slate-400 min-w-[80px]"
          placeholder={multiple && value.length > 0 ? (isLimitReached ? "מקסימום נבחר" : "") : placeholder}
          value={searchTerm}
          disabled={isLimitReached}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
            if (!multiple && e.target.value === '') onChange('');
          }}
          onFocus={() => setIsOpen(true)}
        />
        {(searchTerm || (!multiple && value) || (multiple && value.length > 0)) ? (
          <button 
            onClick={(e) => { e.stopPropagation(); setSearchTerm(''); onChange(multiple ? [] : ''); if (!multiple) setIsOpen(false); }}
            className="absolute left-2 top-2.5 text-slate-400 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <ChevronDown className="absolute left-2 top-2.5 w-4 h-4 text-slate-300 pointer-events-none" />
        )}
      </div>
      {isOpen && !isLimitReached && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto text-right">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => (
              <div
                key={idx}
                className={`px-4 py-2 cursor-pointer text-sm transition-colors flex items-center justify-between ${ (multiple ? value.includes(opt) : value === opt) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50' }`}
                onClick={() => handleSelect(opt)}
              >
                <span>{opt}</span>
                {(multiple ? value.includes(opt) : value === opt) && <Check className="w-4 h-4 text-blue-600" />}
              </div>
            ))
          ) : <div className="px-4 py-3 text-sm text-slate-400 text-center">לא נמצאו תוצאות</div>}
        </div>
      )}
    </div>
  );
};

// AI Report Modal
const AIReportModal = ({ isOpen, onClose, isLoading, report }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-l from-indigo-50 to-white">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-lg"><Sparkles className="w-6 h-6 text-indigo-600" /></div>
            <h2 className="text-xl font-bold text-slate-800">דוח תובנות חכם</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 text-right" dir="rtl">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
              <p className="text-slate-500 font-medium animate-pulse">מנתח נתונים ומפיק דוח...</p>
            </div>
          ) : (
            <div className="prose prose-slate max-w-none">
              <div className="whitespace-pre-wrap text-slate-700 leading-relaxed font-medium">{report || "לא הצלחנו להפיק דוח כרגע. אנא נסה שוב."}</div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors shadow-sm">סגור</button>
        </div>
      </div>
    </div>
  );
};

// Chat Component
const AIChatWindow = ({ isOpen, onClose, onSend, messages, isThinking }) => {
    const messagesEndRef = useRef(null);
    const [input, setInput] = useState('');

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        if (isOpen) scrollToBottom();
    }, [messages, isOpen]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        onSend(input);
        setInput('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed bottom-20 left-6 z-50 w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Bot className="w-6 h-6 text-yellow-300" />
                    <h3 className="font-bold">צ׳אט עם הנתונים</h3>
                </div>
                <button onClick={onClose} className="hover:bg-white/20 rounded-full p-1 transition-colors">
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                {messages.length === 0 && (
                    <div className="text-center text-slate-400 text-sm mt-10">
                        <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>שאל כל דבר על הנתונים שלך!</p>
                        <p className="text-xs mt-1">"מי הספק הכי יקר?" "איזה מוצר נמכר הכי הרבה?"</p>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[80%] p-3 rounded-2xl text-sm shadow-sm ${
                            msg.role === 'user' 
                            ? 'bg-white border border-slate-100 text-slate-800 rounded-br-none' 
                            : 'bg-indigo-600 text-white rounded-bl-none'
                        }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-end">
                        <div className="bg-indigo-50 p-3 rounded-2xl rounded-bl-none flex gap-1">
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-3 border-t border-slate-100 bg-white flex gap-2">
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="הקלד שאלה..." 
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button 
                    type="submit" 
                    disabled={isThinking || !input.trim()}
                    className={`p-2 rounded-full text-white transition-all ${isThinking || !input.trim() ? 'bg-slate-300' : 'bg-indigo-600 hover:bg-indigo-700 shadow-md'}`}
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
        </div>
    );
};

// Clear Data Confirmation Modal
const ClearDataModal = ({ isOpen, onClose, onConfirm, type }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 flex flex-col items-center text-center">
                    <div className="bg-red-100 p-3 rounded-full mb-4">
                        <AlertTriangle className="w-8 h-8 text-red-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">מחיקת נתונים</h3>
                    <p className="text-slate-600 mb-6">
                        האם אתה בטוח שברצונך למחוק את כל נתוני ה<strong>{type === 'sales' ? 'מכירות' : (type === 'suppliers' ? 'רכש וספקים' : 'מערכת')}</strong>?<br/>
                        פעולה זו אינה הפיכה.
                    </p>
                    <div className="flex gap-3 w-full">
                        <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors">
                            ביטול
                        </button>
                        <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors">
                            מחק הכל
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- ניתוח קבצים ---
const parseCSVLine = (line) => {
  const row = [];
  let currentVal = '';
  let insideQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') { currentVal += '"'; i++; } else { insideQuotes = !insideQuotes; }
    } else if (char === ',' && !insideQuotes) {
      row.push(currentVal.trim());
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  row.push(currentVal.trim());
  return row;
};

const detectHeaders = (lines) => {
  let headerRowIndex = -1;
  let headers = [];
  const knownHeaders = [
    'תאריך', 'חודש', 'מקט', 'מק"ט', "מק'ט", 'תיאור', 'תאור', 'כמות', 'סכום', 'הכנסה', 'מחיר', 'יחידה', "יח'", 
    'ספק', 'שם ספק', 'שם הספק', 'Supplier', 'מס\' ספק', 'הוצאה'
  ];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (!knownHeaders.some(k => line.includes(k))) continue;
    const parsedLine = parseCSVLine(line);
    const cleanLine = parsedLine.map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    if (cleanLine.filter(cell => knownHeaders.some(k => cell.includes(k))).length >= 2) {
      headerRowIndex = i;
      headers = cleanLine;
      break;
    }
  }

  if (headerRowIndex === -1) {
    const firstNonEmpty = lines.findIndex(l => l.trim());
    if (firstNonEmpty === -1) return { index: -1, headers: [] };
    headerRowIndex = firstNonEmpty;
    headers = parseCSVLine(lines[firstNonEmpty]).map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  }

  return { index: headerRowIndex, headers };
};

const parseCSV = (text) => {
  const lines = text.split('\n');
  const { index: headerRowIndex, headers } = detectHeaders(lines);

  if (headerRowIndex === -1) return { data: [], type: 'unknown' };

  let fileType = 'sales';
  if (headers.some(h => h.includes('ספק') || h.includes('Supplier') || h.includes('הוצאה'))) {
    fileType = 'suppliers';
  }

  const result = [];
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCSVLine(line);
    const row = {};
    let hasData = false;
    headers.forEach((header, index) => {
      if (!header) return;
      if (index < values.length) {
        const val = values[index];
        row[header] = val;
        if (val && val.trim()) hasData = true;
      }
    });
    if (hasData) result.push(row);
  }
  return { data: result, type: fileType };
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#84cc16', '#f43f5e', '#06b6d4'];

const App = () => {
  // נתונים
  const [salesData, setSalesData] = useState(() => {
    try { const saved = localStorage.getItem('dashboardSalesData'); return saved ? JSON.parse(saved) : []; } catch (e) { return []; }
  });
  const [suppliersData, setSuppliersData] = useState(() => {
    try { const saved = localStorage.getItem('dashboardSuppliersData'); return saved ? JSON.parse(saved) : []; } catch (e) { return []; }
  });
  const [salesFileNames, setSalesFileNames] = useState(() => {
    try { const saved = localStorage.getItem('salesFileNames'); return saved ? JSON.parse(saved) : []; } catch (e) { return []; }
  });
  const [suppliersFileNames, setSuppliersFileNames] = useState(() => {
    try { const saved = localStorage.getItem('suppliersFileNames'); return saved ? JSON.parse(saved) : []; } catch (e) { return []; }
  });

  const [activeTab, setActiveTab] = useState('sales'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'total', direction: 'desc' });
  const [loading, setLoading] = useState(false);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  
  // Chat State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatThinking, setIsChatThinking] = useState(false);

  const [availableDates, setAvailableDates] = useState([]);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  
  // Drilldown State
  const [drillDownMonth, setDrillDownMonth] = useState(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  
  const [selectedProduct, setSelectedProduct] = useState([]); 
  const [selectedSku, setSelectedSku] = useState(''); 
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [pieMetric, setPieMetric] = useState('total');

  const saveToStorage = (key, data) => {
    try { localStorage.setItem(key, JSON.stringify(data)); setStorageWarning(false); } 
    catch (e) { console.error("Quota exceeded", e); setStorageWarning(true); }
  };

  useEffect(() => { saveToStorage('dashboardSalesData', salesData); saveToStorage('salesFileNames', salesFileNames); }, [salesData, salesFileNames]);
  useEffect(() => { saveToStorage('dashboardSuppliersData', suppliersData); saveToStorage('suppliersFileNames', suppliersFileNames); }, [suppliersData, suppliersFileNames]);

  const activeData = useMemo(() => {
    if (activeTab === 'sales') return salesData;
    if (activeTab === 'suppliers') return suppliersData;
    return []; 
  }, [activeTab, salesData, suppliersData]);

  const activeFileNames = useMemo(() => {
    if (activeTab === 'sales') return salesFileNames;
    if (activeTab === 'suppliers') return suppliersFileNames;
    return [];
  }, [activeTab, salesFileNames, suppliersFileNames]);

  useEffect(() => {
    const dates = [...new Set([...salesData, ...suppliersData].map(d => d.date).filter(Boolean))];
    const sortedDates = dates.sort((a, b) => getComparableDateValue(a) - getComparableDateValue(b));
    setAvailableDates(sortedDates);
    if (sortedDates.length > 0 && (!dateFilter.start || !dateFilter.end)) {
        setDateFilter({ start: sortedDates[0], end: sortedDates[sortedDates.length - 1] });
    }
    setCurrentPage(1);
    setDrillDownMonth(null); 
  }, [salesData, suppliersData]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setXlsxLoaded(true);
    document.body.appendChild(script);
    if (window.XLSX) setXlsxLoaded(true);
  }, []);

  const readFile = (file) => {
    return new Promise((resolve) => {
        if (file.name.match(/\.xlsx?$/) && window.XLSX) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const workbook = window.XLSX.read(e.target.result, { type: 'binary' });
                    const firstSheetName = workbook.SheetNames[0];
                    const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });
                    const keys = Object.keys(jsonData[0] || {});
                    let type = 'sales';
                    if (keys.some(k => k.includes('ספק') || k.includes('Supplier') || k.includes('הוצאה'))) type = 'suppliers';
                    resolve({ data: jsonData, type, fileName: file.name, isExcel: true });
                } catch (error) { resolve({ data: [], type: 'unknown', fileName: file.name, error: true }); }
            };
            reader.readAsBinaryString(file);
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                const { data, type } = parseCSV(e.target.result);
                resolve({ data, type, fileName: file.name, isExcel: false });
            };
            reader.readAsText(file);
        }
    });
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    setLoading(true);
    const newSales = [], newSuppliers = [], newSalesF = [], newSuppliersF = [];

    const results = await Promise.all(files.map(file => readFile(file)));

    results.forEach(({ data, type, fileName, error }) => {
        if (error || data.length === 0) return;
        const processed = data.map((row, index) => {
            const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}-${fileName}`;
            let date = '';
            if (row['שנה'] && row['חודש']) {
                const y = row['שנה'].toString().slice(-2);
                const m = row['חודש'];
                date = `${m}-${y}`; 
            } else {
                date = normalizeDate(row['תאריך'] || row['חודש']);
            }
            const rawTotal = row['סה"כ סכום'] || row['סה""כ סכום'] || row['הכנסה בשקלים'] || row['הוצאה משוערכת'] || row['הוצאה כולל מע\'מ'] || row['סה"כ'] || '0';
            const total = parseFloat(rawTotal.toString().replace(/[^\d.-]/g, ''));
            const quantity = parseFloat((row['כמות'] || '0').toString().replace(/[^\d.-]/g, ''));
            const sku = row['מקט מוצר'] || row['מק\'ט'] || row['מקט'] || row['מס\' ספק'] || '';
            const description = row['תיאור מוצר'] || row['תאור מוצר'] || row['שם ספק'] || row['שם הספק'] || ''; 
            const supplier = row['ספק'] || row['שם ספק'] || row['שם הספק'] || 'כללי';
            return { id: uniqueId, date, sku, description, quantity: isNaN(quantity) ? 0 : quantity, total: isNaN(total) ? 0 : total, unit: row['יחידה'] || row['יח\''], supplier };
        }).filter(item => item.description || item.total !== 0);

        if (type === 'suppliers') { newSuppliers.push(...processed); newSuppliersF.push(fileName); } 
        else { newSales.push(...processed); newSalesF.push(fileName); }
    });

    if (newSales.length > 0) {
        setSalesData(prev => [...prev, ...newSales]);
        setSalesFileNames(prev => [...new Set([...prev, ...newSalesF])]);
        if (activeTab !== 'sales' && newSuppliers.length === 0) setActiveTab('sales');
    }
    if (newSuppliers.length > 0) {
        setSuppliersData(prev => [...prev, ...newSuppliers]);
        setSuppliersFileNames(prev => [...new Set([...prev, ...newSuppliersF])]);
        if (activeTab !== 'suppliers' && newSales.length === 0) setActiveTab('suppliers');
    }
    setLoading(false);
    event.target.value = '';
  };

  const handleClearData = () => {
    if (activeTab === 'summary') {
        setSalesData([]); setSalesFileNames([]);
        setSuppliersData([]); setSuppliersFileNames([]);
        localStorage.removeItem('dashboardSalesData'); localStorage.removeItem('salesFileNames');
        localStorage.removeItem('dashboardSuppliersData'); localStorage.removeItem('suppliersFileNames');
    } else if (activeTab === 'sales') {
        setSalesData([]); setSalesFileNames([]);
        localStorage.removeItem('dashboardSalesData'); localStorage.removeItem('salesFileNames');
    } else {
        setSuppliersData([]); setSuppliersFileNames([]);
        localStorage.removeItem('dashboardSuppliersData'); localStorage.removeItem('suppliersFileNames');
    }
    setAvailableDates([]);
    setDateFilter({ start: '', end: '' });
    resetAllFilters();
    setDrillDownMonth(null);
  };

  const handleExport = () => {
    if (filteredData.length === 0 || !window.XLSX) return;
    
    const exportData = filteredData.map(item => {
        const base = { 'תאריך': item.date, 'סכום': item.total, 'כמות': item.quantity, 'יחידה': item.unit };
        if (activeTab === 'sales') return { ...base, 'מוצר': item.description, 'מק"ט': item.sku };
        return { ...base, 'ספק': item.supplier };
    });

    const ws = window.XLSX.utils.json_to_sheet(exportData);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Data");
    window.XLSX.writeFile(wb, `${activeTab}_export.xlsx`);
  };

  const uniqueItems = useMemo(() => {
    return {
      products: [...new Set(salesData.map(item => item.description).filter(Boolean))].sort(),
      skus: [...new Set(salesData.map(item => item.sku).filter(Boolean))].sort(),
      suppliers: [...new Set(suppliersData.map(item => item.supplier).filter(Boolean))].sort()
    };
  }, [salesData, suppliersData]);

  const filteredData = useMemo(() => {
    if (activeTab === 'summary') return []; 
    let data = activeData;
    
    if (drillDownMonth) {
        data = data.filter(item => item.date === drillDownMonth);
    } else {
        const startVal = dateFilter.start ? getComparableDateValue(dateFilter.start) : 0;
        const endVal = dateFilter.end ? getComparableDateValue(dateFilter.end) : 999999;
        data = data.filter(item => {
            const itemVal = getComparableDateValue(item.date);
            return itemVal >= startVal && itemVal <= endVal;
        });
    }

    if (activeTab === 'sales') {
        if (selectedProduct.length > 0) data = data.filter(item => selectedProduct.includes(item.description));
        if (selectedSku) data = data.filter(item => item.sku === selectedSku);
    } else {
        if (selectedSupplier) data = data.filter(item => item.supplier === selectedSupplier);
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      data = data.filter(item => 
        (item.description && item.description.toLowerCase().includes(lower)) ||
        (item.sku && item.sku.toLowerCase().includes(lower)) || 
        (item.supplier && item.supplier.toLowerCase().includes(lower))
      );
    }

    return data.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        if (sortConfig.key === 'date') { valA = getComparableDateValue(a.date); valB = getComparableDateValue(b.date); }
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });
  }, [activeData, searchTerm, sortConfig, dateFilter, selectedProduct, selectedSku, selectedSupplier, activeTab, drillDownMonth]);

  const summaryData = useMemo(() => {
      if (activeTab !== 'summary') return null;
      
      const startVal = dateFilter.start ? getComparableDateValue(dateFilter.start) : 0;
      const endVal = dateFilter.end ? getComparableDateValue(dateFilter.end) : 999999;
      const filterDate = (d) => { const val = getComparableDateValue(d.date); return val >= startVal && val <= endVal; }

      const filteredSales = salesData.filter(filterDate);
      const filteredSuppliers = suppliersData.filter(filterDate);

      const monthlySummary = {};
      
      filteredSales.forEach(item => {
          if (!monthlySummary[item.date]) monthlySummary[item.date] = { income: 0, expenses: 0, profit: 0 };
          monthlySummary[item.date].income += item.total;
      });
      filteredSuppliers.forEach(item => {
          if (!monthlySummary[item.date]) monthlySummary[item.date] = { income: 0, expenses: 0, profit: 0 };
          monthlySummary[item.date].expenses += item.total;
      });

      const chart = Object.keys(monthlySummary).map(date => {
          const { income, expenses } = monthlySummary[date];
          return { name: date, income, expenses, profit: income - expenses, order: getComparableDateValue(date) };
      }).sort((a, b) => a.order - b.order);

      const totalIncome = filteredSales.reduce((acc, curr) => acc + curr.total, 0);
      const totalExpenses = filteredSuppliers.reduce((acc, curr) => acc + curr.total, 0);
      const totalProfit = totalIncome - totalExpenses;
      const profitMargin = totalIncome > 0 ? (totalProfit / totalIncome) * 100 : 0;

      return { chart, totalIncome, totalExpenses, totalProfit, profitMargin };

  }, [activeTab, salesData, suppliersData, dateFilter]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  useEffect(() => setCurrentPage(1), [activeTab, searchTerm, dateFilter, selectedProduct, selectedSku, selectedSupplier, drillDownMonth]);

  const calculateTrend = (currentTotal, filteredData) => {
    if (filteredData.length === 0) return 0;
    const months = [...new Set(filteredData.map(d => d.date))].sort((a, b) => getComparableDateValue(a) - getComparableDateValue(b));
    if (months.length < 2) return 0;
    const lastMonth = months[months.length - 1];
    const prevMonth = months[months.length - 2];
    const lastMonthTotal = filteredData.filter(d => d.date === lastMonth).reduce((acc, curr) => acc + curr.total, 0);
    const prevMonthTotal = filteredData.filter(d => d.date === prevMonth).reduce((acc, curr) => acc + curr.total, 0);
    if (prevMonthTotal === 0) return 100; 
    return ((lastMonthTotal - prevMonthTotal) / prevMonthTotal) * 100;
  };

  const stats = useMemo(() => {
    if (activeTab === 'summary') return null;
    const totalAmount = filteredData.reduce((acc, curr) => acc + curr.total, 0);
    const totalQuantity = filteredData.reduce((acc, curr) => acc + curr.quantity, 0);
    const uniqueCount = new Set(filteredData.map(item => activeTab === 'sales' ? item.sku : item.supplier)).size;
    const monthsCount = getMonthsDifference(dateFilter.start || availableDates[0], dateFilter.end || availableDates[availableDates.length - 1]);
    const trend = calculateTrend(totalAmount, filteredData);
    return { totalAmount, totalQuantity, uniqueCount, avgAmount: monthsCount > 0 ? totalAmount / monthsCount : 0, avgQuantity: monthsCount > 0 ? totalQuantity / monthsCount : 0, monthsCount, trend };
  }, [filteredData, dateFilter, availableDates, activeTab]);

  const chartData = useMemo(() => {
    if (activeTab === 'summary') return null;
    const monthsMap = {};
    filteredData.forEach(item => {
        if (!item.date) return;
        const monthKey = item.date; 
        if (!monthsMap[monthKey]) monthsMap[monthKey] = { total: 0, quantity: 0 };
        monthsMap[monthKey].total += item.total;
        monthsMap[monthKey].quantity += item.quantity;
        if (activeTab === 'sales' && selectedProduct.length > 0) {
            if (!monthsMap[monthKey][item.description]) monthsMap[monthKey][item.description] = 0;
            monthsMap[monthKey][item.description] += item.total;
            const qKey = `${item.description}_quantity`;
            if (!monthsMap[monthKey][qKey]) monthsMap[monthKey][qKey] = 0;
            monthsMap[monthKey][qKey] += item.quantity;
        }
    });
    const monthly = Object.keys(monthsMap).map(key => ({ name: key, ...monthsMap[key], order: getComparableDateValue(key) })).sort((a, b) => a.order - b.order);

    const entityMap = {};
    const keyField = activeTab === 'sales' ? 'description' : 'supplier';
    filteredData.forEach(item => {
        const name = item[keyField];
        if (!entityMap[name]) entityMap[name] = { total: 0, quantity: 0 };
        entityMap[name].total += item.total;
        entityMap[name].quantity += item.quantity;
    });
    
    const valueKey = (activeTab === 'suppliers' || pieMetric === 'total') ? 'total' : 'quantity';
    let pie = Object.keys(entityMap).map(key => ({
        name: key, total: entityMap[key].total, quantity: entityMap[key].quantity,
        value: entityMap[key][valueKey]
    })).sort((a, b) => b.value - a.value);

    if (activeTab === 'sales' && selectedProduct.length === 0) pie = pie.slice(0, 5);
    if (activeTab === 'suppliers' && !selectedSupplier) pie = pie.slice(0, 5);

    return { monthly, pie };
  }, [filteredData, activeTab, selectedProduct, selectedSupplier, pieMetric]);

  const generateAIInsight = async () => {
    setAiModalOpen(true); setAiLoading(true); setAiReport('');
    let prompt = '';
    if (activeTab === 'summary') {
        prompt = `
        נתח את הדו"ח הפיננסי:
        סה"כ הכנסות: ${formatCurrency(summaryData.totalIncome)}
        סה"כ הוצאות: ${formatCurrency(summaryData.totalExpenses)}
        רווח נקי: ${formatCurrency(summaryData.totalProfit)} (${summaryData.profitMargin.toFixed(1)}%)
        נתונים חודשיים: ${summaryData.chart.map(m => `${m.name}: רווח ${formatCurrency(m.profit)}`).join(', ')}
        תן 3 תובנות עסקיות.
        `;
    } else {
        const context = activeTab === 'sales' ? 'מכירות' : 'רכש וספקים';
        const filterTxt = activeTab === 'sales' ? (selectedProduct.length > 0 ? `מוצרים: ${selectedProduct.join(', ')}` : 'כל המוצרים') : (selectedSupplier ? `ספק: ${selectedSupplier}` : 'כל הספקים');
        prompt = `
        נתח נתוני ${context}:
        הקשר: ${filterTxt}
        סה"כ: ${formatCurrency(stats.totalAmount)}
        מגמות: ${chartData.monthly.map(m => `${m.name}: ${formatCurrency(m.total)}`).join(', ')}
        מובילים: ${chartData.pie.map(p => `${p.name}: ${formatCurrency(p.total)}`).join(', ')}
        תן תובנות קצרות.
        `;
    }

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await res.json();
      setAiReport(data.candidates?.[0]?.content?.parts?.[0]?.text || "שגיאה.");
    } catch (e) { setAiReport("שגיאת תקשורת."); } finally { setAiLoading(false); }
  };

  // Handle Chat Messages
  const handleChatSend = async (text) => {
      setChatMessages(prev => [...prev, { role: 'user', content: text }]);
      setIsChatThinking(true);
      
      // Context building for Chat
      let contextData = '';
      if (activeTab === 'summary' && summaryData) {
          contextData = `נתונים פיננסיים: הכנסות ${formatCurrency(summaryData.totalIncome)}, הוצאות ${formatCurrency(summaryData.totalExpenses)}, רווח ${formatCurrency(summaryData.totalProfit)}.`;
      } else if (stats) {
          contextData = `נתוני ${activeTab === 'sales' ? 'מכירות' : 'ספקים'}: סה"כ ${formatCurrency(stats.totalAmount)}, כמות ${stats.totalQuantity}.`;
          const topItems = chartData.pie.slice(0, 3).map(i => `${i.name}: ${formatCurrency(i.total)}`).join(', ');
          contextData += ` מובילים: ${topItems}.`;
      }

      const prompt = `
      אתה עוזר עסקי חכם. ענה לשאלה הבאה על סמך הנתונים:
      הקשר נתונים נוכחי: ${contextData}
      שאלה: ${text}
      ענה בקצרה ובעברית.
      `;

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הבנתי, נסה שנית.";
        setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      } catch (e) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: "שגיאת תקשורת." }]);
      } finally {
        setIsChatThinking(false);
      }
  };

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const resetAllFilters = () => {
     if (availableDates.length > 0) {
        setDateFilter({ start: availableDates[0], end: availableDates[availableDates.length - 1] });
     }
     setSearchTerm(''); setSelectedProduct([]); setSelectedSku(''); setSelectedSupplier('');
     setDrillDownMonth(null);
  };

  const setQuickDate = (monthsBack) => {
      if (availableDates.length === 0) return;
      const sorted = [...availableDates];
      const end = sorted[sorted.length - 1];
      let start = sorted[0];
      
      if (monthsBack === 'year') {
          const lastDateParts = end.split('-'); 
          const year = lastDateParts[1];
          const startOfYear = sorted.find(d => d.endsWith(year));
          if (startOfYear) start = startOfYear;
      } else if (monthsBack) {
           const startIndex = Math.max(0, sorted.length - monthsBack);
           start = sorted[startIndex];
      }
      setDateFilter({ start, end });
  };

  const avgList = useMemo(() => {
    if (activeTab === 'sales' && selectedProduct.length > 0) return chartData.pie;
    return null;
  }, [activeTab, selectedProduct, chartData?.pie]);

  const handleChartClick = (data) => {
      if (data && data.activeLabel) {
          if (drillDownMonth === data.activeLabel) setDrillDownMonth(null);
          else setDrillDownMonth(data.activeLabel);
      }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-800" dir="rtl">
      <AIReportModal isOpen={aiModalOpen} onClose={() => setAiModalOpen(false)} isLoading={aiLoading} report={aiReport} />
      <ClearDataModal isOpen={clearModalOpen} onClose={() => setClearModalOpen(false)} onConfirm={handleClearData} type={activeTab} />
      
      {/* Chat Button and Window */}
      <div className="fixed bottom-6 left-6 z-40">
          {!chatOpen && (
              <button 
                onClick={() => setChatOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-xl transition-transform hover:scale-105 flex items-center gap-2"
              >
                  <MessageSquare className="w-6 h-6" />
              </button>
          )}
          <AIChatWindow 
            isOpen={chatOpen} 
            onClose={() => setChatOpen(false)} 
            onSend={handleChatSend} 
            messages={chatMessages} 
            isThinking={isChatThinking} 
          />
      </div>

      <div className="w-20 lg:w-64 bg-slate-900 text-white flex flex-col flex-shrink-0 transition-all duration-300">
        <div className="p-4 lg:p-6 flex items-center justify-center lg:justify-start gap-3 border-b border-slate-700">
            <div className="bg-blue-600 p-2 rounded-lg"><LayoutDashboard className="w-6 h-6" /></div>
            <span className="text-xl font-bold hidden lg:block">BizData</span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
            <button onClick={() => { setActiveTab('sales'); resetAllFilters(); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${activeTab === 'sales' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                <TrendingUp className="w-5 h-5" />
                <span className="hidden lg:block font-medium">מכירות</span>
            </button>
            <button onClick={() => { setActiveTab('suppliers'); resetAllFilters(); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${activeTab === 'suppliers' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                <Truck className="w-5 h-5" />
                <span className="hidden lg:block font-medium">רכש וספקים</span>
            </button>
             <button onClick={() => { setActiveTab('summary'); resetAllFilters(); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${activeTab === 'summary' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                <BarChart3 className="w-5 h-5" />
                <span className="hidden lg:block font-medium">סיכום פיננסי</span>
            </button>
        </nav>
        <div className="p-4 border-t border-slate-700">
            <div className="flex flex-col gap-4">
                <label className={`flex items-center justify-center lg:justify-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${loading ? 'bg-slate-800 opacity-50' : 'bg-slate-800 hover:bg-slate-700'} text-slate-300`}>
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                    <span className="hidden lg:block text-sm">טען קבצים</span>
                    <input type="file" accept=".csv, .xlsx, .xls" multiple onChange={handleFileUpload} className="hidden" disabled={loading} />
                </label>
                {(salesData.length > 0 || suppliersData.length > 0) && (
                    <button onClick={() => setClearModalOpen(true)} className="flex items-center justify-center lg:justify-start gap-3 p-3 rounded-xl hover:bg-red-900/30 text-red-400 hover:text-red-300 transition-colors">
                        <Trash2 className="w-5 h-5" />
                        <span className="hidden lg:block text-sm">נקה הכל</span>
                    </button>
                )}
                {storageWarning && <p className="text-xs text-red-400 text-center">שים לב: שטח הזיכרון מלא</p>}
            </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-8 py-5 flex justify-between items-center shadow-sm z-10">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-slate-800">
                    {activeTab === 'sales' ? 'דשבורד מכירות' : activeTab === 'suppliers' ? 'דשבורד רכש וספקים' : 'סיכום רווח והפסד'}
                </h1>
            </div>
            <div className="flex items-center gap-4">
                {availableDates.length > 0 && (
                    <div className="flex items-center gap-2">
                         <div className="hidden md:flex bg-white border border-slate-200 rounded-lg p-1 text-xs shadow-sm">
                            <button onClick={() => setQuickDate(3)} className="px-3 py-1 hover:bg-slate-50 rounded transition-colors text-slate-600 font-medium">3 חודשים</button>
                            <div className="w-px bg-slate-200 my-1"></div>
                            <button onClick={() => setQuickDate('year')} className="px-3 py-1 hover:bg-slate-50 rounded transition-colors text-slate-600 font-medium">השנה</button>
                            <div className="w-px bg-slate-200 my-1"></div>
                            <button onClick={() => setQuickDate(null)} className="px-3 py-1 hover:bg-slate-50 rounded transition-colors text-slate-600 font-medium">הכל</button>
                        </div>

                        <div className="hidden md:flex items-center bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-sm">
                            <span className="text-slate-500 ml-2"><Calendar className="w-4 h-4" /></span>
                            <select value={dateFilter.start} onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="bg-transparent font-bold cursor-pointer text-sm">{availableDates.map(d => <option key={`s${d}`} value={d}>{d}</option>)}</select>
                            <span className="mx-2 text-slate-400">-</span>
                            <select value={dateFilter.end} onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="bg-transparent font-bold cursor-pointer text-sm">{availableDates.map(d => <option key={`e${d}`} value={d}>{d}</option>)}</select>
                        </div>
                    </div>
                )}
                <button onClick={generateAIInsight} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg shadow-md text-sm font-bold hover:-translate-y-0.5 transition-all">
                    <Sparkles className="w-4 h-4 text-yellow-300" /> <span>תובנות AI</span>
                </button>
            </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 space-y-6">
            {activeTab === 'summary' ? (
                 summaryData ? (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card title="סה״כ הכנסות" value={formatCurrency(summaryData.totalIncome)} subtext="מסה״כ המכירות" icon={DollarSign} color="bg-blue-500" />
                            <Card title="סה״כ הוצאות" value={formatCurrency(summaryData.totalExpenses)} subtext="מסה״כ הספקים" icon={Wallet} color="bg-red-500" />
                            <Card title="רווח נקי" value={formatCurrency(summaryData.totalProfit)} subtext={`${summaryData.profitMargin.toFixed(1)}% אחוז רווח`} icon={Activity} color={summaryData.totalProfit >= 0 ? "bg-emerald-500" : "bg-red-600"} />
                        </div>
                        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm h-[450px]">
                            <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-500" />הכנסות מול הוצאות ורווח</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={summaryData.chart}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" />
                                    <YAxis />
                                    <RechartsTooltip formatter={(val) => formatCurrency(val)} />
                                    <Legend />
                                    <Bar dataKey="income" name="הכנסות" fill="#3b82f6" barSize={20} />
                                    <Bar dataKey="expenses" name="הוצאות" fill="#ef4444" barSize={20} />
                                    <Line type="monotone" dataKey="profit" name="רווח נקי" stroke="#10b981" strokeWidth={3} dot={{r:4}} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                 ) : <div className="text-center py-20 text-slate-400">אין נתונים להצגת סיכום. נא לטעון קבצי מכירות וספקים.</div>
            ) : (
            <>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col lg:flex-row gap-4 items-center">
                <div className="flex items-center gap-2 text-slate-500 font-medium text-sm whitespace-nowrap min-w-fit"><Filter className="w-4 h-4" /> סינון:</div>
                {activeTab === 'sales' ? (
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                        <Autocomplete options={uniqueItems.products} value={selectedProduct} onChange={(val) => { setSelectedProduct(val); setSelectedSku(''); }} placeholder="בחר מוצרים..." icon={Box} multiple={true} maxSelections={5} />
                        <Autocomplete options={uniqueItems.skus} value={selectedSku} onChange={(val) => { setSelectedSku(val); setSelectedProduct([]); }} placeholder="בחר מק״ט..." icon={Tag} />
                    </div>
                ) : (
                    <div className="flex-1 w-full">
                        <Autocomplete options={uniqueItems.suppliers} value={selectedSupplier} onChange={setSelectedSupplier} placeholder="בחר ספק..." icon={Truck} />
                    </div>
                )}
                {(selectedProduct.length > 0 || selectedSku || selectedSupplier || searchTerm) && (
                    <button onClick={resetAllFilters} className="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium">נקה סינון</button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card 
                    title={activeTab === 'sales' ? 'סה״כ הכנסות' : 'סה״כ הוצאות'} 
                    value={formatCurrency(stats.totalAmount)} 
                    subtext="בתקופה שנבחרה" 
                    icon={activeTab === 'sales' ? DollarSign : Wallet} 
                    color={activeTab === 'sales' ? 'bg-blue-500' : 'bg-red-500'} 
                    trend={stats.trend}
                />
                <Card title="ממוצע חודשי" value={formatCurrency(stats.avgAmount)} subtext={`לפי ${stats.monthsCount} חודשים`} icon={Activity} color="bg-amber-500" />
                <Card title={activeTab === 'sales' ? 'כמות יחידות' : 'כמות שורות רכש'} value={stats.totalQuantity.toLocaleString()} subtext="סה״כ בסינון" icon={Package} color="bg-emerald-500" />
                <Card title="ממוצע כמות" value={avgList ? (
                        <div className="flex flex-col gap-1 mt-1 max-h-[80px] overflow-y-auto custom-scrollbar pr-1">
                            {avgList.map(item => (
                                <div key={item.name} className="flex justify-between text-xs border-b border-slate-50 pb-1"><span className="truncate w-20" title={item.name}>{item.name}</span><span className="font-bold">{Math.round(item.quantity / stats.monthsCount)}</span></div>
                            ))}
                        </div>
                    ) : Math.round(stats.avgQuantity).toLocaleString()} subtext={avgList ? 'פירוט לפי פריט' : 'ממוצע חודשי כללי'} icon={Layers} color="bg-cyan-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm min-h-[450px]">
                    <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Calendar className="w-5 h-5 text-blue-500" />{activeTab === 'sales' ? 'מכירות לפי חודש' : 'הוצאות לפי חודש'}</h3>
                    <div className="h-96">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData.monthly} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" stroke="#64748b" />
                                <YAxis yAxisId="left" stroke="#3b82f6" tickFormatter={(val) => `₪${val/1000}k`} />
                                {activeTab === 'sales' && <YAxis yAxisId="right" orientation="right" stroke="#10b981" />}
                                <RechartsTooltip formatter={(val, name) => name.includes('כמות') ? val : formatCurrency(val)} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                <Legend />
                                {activeTab === 'sales' && selectedProduct.length > 0 ? (
                                    selectedProduct.map((p, i) => (
                                        <React.Fragment key={p}>
                                            <Bar yAxisId="left" dataKey={p} name={p} stackId="a" fill={COLORS[i % COLORS.length]} />
                                            <Line yAxisId="right" type="monotone" dataKey={`${p}_quantity`} name={`${p} (כמות)`} stroke={COLORS[i % COLORS.length]} strokeDasharray="3 3" dot={{r:3}} strokeWidth={2} />
                                        </React.Fragment>
                                    ))
                                ) : activeTab === 'sales' ? (
                                    <>
                                        <Bar yAxisId="left" dataKey="total" name="סכום" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                        <Line yAxisId="right" type="monotone" dataKey="quantity" name="כמות" stroke="#10b981" strokeWidth={3} />
                                    </>
                                ) : (
                                    <Bar yAxisId="left" dataKey="total" name="סכום" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                )}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex flex-col min-h-[450px]">
                    <div className="flex justify-between items-start mb-6">
                        <h3 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500" />{activeTab === 'sales' ? (selectedProduct.length > 0 ? 'התפלגות נבחרים' : 'מוצרים מובילים') : 'ספקים מובילים'}</h3>
                        {activeTab === 'sales' && (
                            <div className="flex bg-slate-100 rounded-lg p-1">
                                <button onClick={() => setPieMetric('total')} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pieMetric === 'total' ? 'bg-white shadow text-blue-700' : 'text-slate-500'}`}>סכום</button>
                                <button onClick={() => setPieMetric('quantity')} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pieMetric === 'quantity' ? 'bg-white shadow text-blue-700' : 'text-slate-500'}`}>כמות</button>
                            </div>
                        )}
                    </div>
                    <div className="h-96 flex items-center justify-center flex-1">
                        {chartData.pie.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={chartData.pie} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={5} dataKey="value">
                                        {chartData.pie.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                    </Pie>
                                    <RechartsTooltip content={<CustomPieTooltip />} />
                                    <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: '11px', maxHeight: '300px', overflowY: 'auto' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <p className="text-slate-400">אין נתונים להצגה</p>}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-slate-400" /> פירוט עסקאות</h3>
                        {drillDownMonth && (
                             <span className="flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium animate-in fade-in slide-in-from-left-4">
                                <MousePointerClick className="w-4 h-4" />
                                מסונן לפי: {drillDownMonth}
                                <button onClick={() => setDrillDownMonth(null)} className="hover:bg-blue-200 rounded-full p-0.5 mr-1"><X className="w-3 h-3" /></button>
                             </span>
                        )}
                    </div>
                    <div className="flex gap-3 items-center">
                        <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors text-sm font-medium border border-emerald-200">
                            <Download className="w-4 h-4" /> ייצוא לאקסל
                        </button>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                            <input type="text" placeholder="חיפוש בטבלה..." className="w-full pl-4 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                        <thead className="bg-slate-50 text-slate-500 font-medium">
                            <tr>
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('date')}>תאריך</th>
                                {activeTab === 'sales' && <th className="px-6 py-3">מק״ט</th>}
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort(activeTab === 'sales' ? 'description' : 'supplier')}>
                                    {activeTab === 'sales' ? 'מוצר' : 'ספק'}
                                </th>
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('quantity')}>כמות</th>
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('total')}>סכום</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedData.length > 0 ? paginatedData.map((row) => (
                                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{row.date}</td>
                                    {activeTab === 'sales' && <td className="px-6 py-4 font-mono text-xs text-slate-500">{row.sku}</td>}
                                    <td className="px-6 py-4 font-medium text-slate-800">{activeTab === 'sales' ? row.description : row.supplier}</td>
                                    <td className="px-6 py-4 text-slate-600"><span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold">{row.quantity}</span></td>
                                    <td className="px-6 py-4 font-bold text-slate-800">{formatCurrency(row.total)}</td>
                                </tr>
                            )) : <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400">לא נמצאו נתונים</td></tr>}
                        </tbody>
                    </table>
                </div>
                <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between items-center">
                    <span>מציג {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredData.length)} מתוך {filteredData.length} רשומות</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={`p-1 rounded hover:bg-slate-200 transition-colors ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}><ChevronRight className="w-4 h-4" /></button>
                        <span>עמוד {currentPage} מתוך {totalPages || 1}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className={`p-1 rounded hover:bg-slate-200 transition-colors ${currentPage === totalPages || totalPages === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}><ChevronLeft className="w-4 h-4" /></button>
                    </div>
                </div>
            </div>
            </>
            )}
        </main>
      </div>
    </div>
  );
};

export default App;
