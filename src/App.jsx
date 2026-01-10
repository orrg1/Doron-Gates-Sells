import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter, ArrowUpDown, ArrowUp, ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot, Loader2, FileText, Check, Trash2, Truck, Wallet, LayoutDashboard, FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight, PieChart as PieChartIcon, BarChart3, Download, MousePointerClick, Clock, MessageSquare, Send, Moon, Sun, Menu, Info, Bell, User, Settings, Eye, EyeOff } from 'lucide-react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Area } from 'recharts';

// --- הגדרות API ---
const apiKey = ""; // הדבק כאן את המפתח שלך

// --- עזרים כלליים ---
const HebrewMonthsMap = {
  0: 'ינו', 1: 'פבר', 2: 'מרץ', 3: 'אפר', 4: 'מאי', 5: 'יונ',
  6: 'יול', 7: 'אוג', 8: 'ספט', 9: 'אוק', 10: 'נוב', 11: 'דצמ'
};

const HebrewMonthsReverse = {
  'ינו': 1, 'פבר': 2, 'מרץ': 3, 'אפר': 4, 'מאי': 5, 'יונ': 6,
  'יול': 7, 'אוג': 8, 'ספט': 9, 'אוק': 10, 'נוב': 11, 'דצמ': 12
};

const formatCurrency = (val) => {
  if (isNaN(val)) return "₪0";
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
  return String(val);
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

const EmptyState = ({ onUpload, loading, isDarkMode }) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in zoom-in duration-500">
    <div className={`p-8 rounded-full mb-6 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
      <FileSpreadsheet className={`w-16 h-16 ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} />
    </div>
    <h3 className={`text-2xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>הדשבורד ריק כרגע</h3>
    <p className={`max-w-md mb-8 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
      טען קבצי אקסל או CSV של מכירות או ספקים כדי להתחיל לנתח את הנתונים שלך בצורה חכמה.
    </p>
    
    <label className={`group relative flex items-center gap-3 px-8 py-4 rounded-2xl cursor-pointer transition-all hover:scale-105 shadow-xl hover:shadow-2xl ${isDarkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
        <div className="absolute inset-0 bg-white/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-opacity"></div>
        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
        <span className="font-bold text-lg">בחר קבצים לטעינה</span>
        <input type="file" accept=".csv, .xlsx, .xls" multiple onChange={onUpload} className="hidden" disabled={loading} />
    </label>
    <p className="mt-4 text-xs text-slate-400">תומך בקבצי .xlsx, .xls, .csv</p>
  </div>
);

const Card = ({ title, value, subtext, icon: Icon, color, trend, isDarkMode }) => (
  <div className={`p-6 rounded-2xl shadow-sm border flex items-center justify-between hover:shadow-md transition-all duration-300 h-full relative overflow-hidden group hover:-translate-y-1 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-100 text-slate-800'}`}>
    <div className={`absolute top-0 right-0 w-1.5 h-full ${color.replace('bg-', 'bg-').replace('text-', '')}`}></div>
    <div className="flex-1 min-w-0 z-10">
      <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{title}</p>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="flex items-center gap-2 mt-2">
          {trend !== undefined && trend !== null && !isNaN(trend) && (
              <span className={`text-xs font-bold flex items-center px-2 py-0.5 rounded-full ${trend >= 0 ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700') : (isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700')}`}>
                  {trend >= 0 ? <TrendingUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />}
                  {Math.abs(trend).toFixed(1)}%
              </span>
          )}
          {subtext && <p className={`text-xs truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} title={subtext}>{subtext}</p>}
      </div>
    </div>
    <div className={`p-3 rounded-xl shrink-0 ml-4 self-start shadow-sm ${isDarkMode ? 'bg-slate-700/50' : 'bg-slate-50'} group-hover:scale-110 transition-transform duration-300`}>
      <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-').replace('500', '600')}`} />
    </div>
  </div>
);

const CustomPieTooltip = ({ active, payload, isDarkMode }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className={`p-4 border shadow-xl rounded-xl text-right z-50 backdrop-blur-md ${isDarkMode ? 'bg-slate-900/90 border-slate-700 text-white' : 'bg-white/95 border-slate-100 text-slate-800'}`}>
        <p className={`font-bold mb-3 border-b pb-2 ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>{data.name}</p>
        <div className="space-y-2 text-sm">
          {data.quantity !== undefined && (
             <div className="flex justify-between gap-8 items-center">
                <span className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>כמות:</span>
                <span className="font-bold font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded">{data.quantity.toLocaleString()}</span>
             </div>
          )}
          <div className="flex justify-between gap-8 items-center">
            <span className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>סכום:</span>
            <span className="font-bold font-mono text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">{formatCurrency(data.total)}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

const Autocomplete = ({ options, value, onChange, placeholder, icon: Icon, multiple = false, maxSelections = Infinity, isDarkMode }) => {
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
        className={`relative flex items-center flex-wrap gap-2 w-full pl-9 pr-4 py-2.5 border rounded-xl transition-all duration-200 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus-within:border-blue-500' : 'bg-white border-slate-200 text-slate-800 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100'} ${isLimitReached && !isOpen ? (isDarkMode ? 'border-orange-500/50 bg-orange-900/10' : 'border-orange-200 bg-orange-50') : ''}`}
        onClick={() => document.getElementById(`input-${placeholder}`)?.focus()}
      >
        {Icon && <Icon className={`absolute right-3 top-3 w-4 h-4 pointer-events-none z-10 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />}
        
        {multiple && Array.isArray(value) && value.map(val => (
            <span key={val} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg animate-in fade-in zoom-in duration-200 border shadow-sm ${isDarkMode ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/30' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                <span className="max-w-[120px] truncate" title={val}>{val}</span>
                <X className="w-3 h-3 cursor-pointer hover:text-red-500 transition-colors" onClick={(e) => removeTag(val, e)} />
            </span>
        ))}

        <input
          id={`input-${placeholder}`}
          type="text"
          className={`flex-1 bg-transparent border-none focus:ring-0 text-sm min-w-[80px] p-0 ${isDarkMode ? 'text-white placeholder-slate-500' : 'text-slate-700 placeholder-slate-400'}`}
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
            className="absolute left-2 top-3 text-slate-400 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <ChevronDown className={`absolute left-2 top-3 w-4 h-4 pointer-events-none ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} />
        )}
      </div>
      {isOpen && !isLimitReached && (
        <div className={`absolute z-50 w-full mt-2 border rounded-xl shadow-2xl max-h-60 overflow-y-auto text-right overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => {
              const isSelected = multiple ? value.includes(opt) : value === opt;
              return (
                <div
                  key={idx}
                  className={`px-4 py-3 cursor-pointer text-sm transition-colors flex items-center justify-between border-b last:border-0 ${isDarkMode ? 'border-slate-700/50 hover:bg-slate-700' : 'border-slate-50 hover:bg-slate-50'} ${
                    isSelected ? (isDarkMode ? 'bg-blue-900/20 text-blue-300' : 'bg-blue-50 text-blue-700 font-medium') : (isDarkMode ? 'text-slate-300' : 'text-slate-700')
                  }`}
                  onClick={() => handleSelect(opt)}
                >
                  <span>{opt}</span>
                  {isSelected && <Check className="w-4 h-4 text-blue-500" />}
                </div>
              );
            })
          ) : <div className={`px-4 py-3 text-sm text-center ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>לא נמצאו תוצאות</div>}
        </div>
      )}
    </div>
  );
};

// Clear Data Confirmation Modal
const ClearDataModal = ({ isOpen, onClose, onConfirm, type, isDarkMode }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className={`rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
                <div className="p-8 flex flex-col items-center text-center">
                    <div className={`p-4 rounded-full mb-6 ${isDarkMode ? 'bg-red-500/10' : 'bg-red-50'}`}>
                        <AlertTriangle className="w-10 h-10 text-red-500" />
                    </div>
                    <h3 className={`text-2xl font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>מחיקת נתונים</h3>
                    <p className={`mb-8 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        האם אתה בטוח שברצונך למחוק את כל נתוני ה<strong>{type === 'sales' ? 'מכירות' : (type === 'suppliers' ? 'רכש וספקים' : 'מערכת')}</strong>?<br/>
                        <span className="text-xs opacity-70">פעולה זו אינה הפיכה והנתונים יימחקו מהזיכרון.</span>
                    </p>
                    <div className="flex gap-4 w-full">
                        <button onClick={onClose} className={`flex-1 px-4 py-3 font-medium rounded-xl transition-colors ${isDarkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                            ביטול
                        </button>
                        <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 px-4 py-3 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20">
                            מחק הכל
                        </button>
                    </div>
                </div>
            </div>
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
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Sparkles className="w-6 h-6 text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">דוח תובנות חכם</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 text-right" dir="rtl">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
              <p className="text-slate-500 font-medium animate-pulse">מנתח נתונים ומפיק דוח...</p>
            </div>
          ) : (
            <div className="prose prose-slate max-w-none">
              <div className="whitespace-pre-wrap text-slate-700 leading-relaxed font-medium">
                {report || "לא הצלחנו להפיק דוח כרגע. אנא נסה שוב."}
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
};

// Chat Component
const AIChatWindow = ({ isOpen, onClose, onSend, messages, isThinking, isDarkMode }) => {
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
        <div className={`fixed bottom-24 left-6 z-50 w-96 h-[550px] rounded-2xl shadow-2xl border flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center shadow-md">
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-1.5 rounded-lg backdrop-blur-sm"><Bot className="w-5 h-5 text-white" /></div>
                    <div>
                        <h3 className="font-bold text-sm">העוזר החכם</h3>
                        <p className="text-[10px] opacity-80">שאל כל דבר על הנתונים שלך</p>
                    </div>
                </div>
                <button onClick={onClose} className="hover:bg-white/20 rounded-full p-1.5 transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Messages */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isDarkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
                {messages.length === 0 && (
                    <div className={`text-center text-sm mt-20 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">היי! אני כאן כדי לעזור.</p>
                        <p className="text-xs mt-2 opacity-70">נסה לשאול: "מה המגמה החודש?"<br/>או "מי הספק הכי גדול?"</p>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm shadow-sm leading-relaxed ${
                            msg.role === 'user' 
                            ? (isDarkMode ? 'bg-slate-700 text-white rounded-br-none border border-slate-600' : 'bg-white border border-slate-100 text-slate-800 rounded-br-none') 
                            : 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-bl-none'
                        }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-end">
                        <div className={`p-3 rounded-2xl rounded-bl-none flex gap-1.5 ${isDarkMode ? 'bg-slate-800' : 'bg-indigo-50'}`}>
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className={`p-3 border-t flex gap-2 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="הקלד שאלה..." 
                    className={`flex-1 border rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${isDarkMode ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                />
                <button 
                    type="submit" 
                    disabled={isThinking || !input.trim()}
                    className={`p-2.5 rounded-full text-white transition-all transform active:scale-95 ${isThinking || !input.trim() ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg'}`}
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
        </div>
    );
};

// --- לוגיקה ---

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
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
      if (typeof window !== 'undefined') {
          return localStorage.getItem('theme') === 'dark';
      }
      return false;
  });

  const toggleTheme = () => {
      const newMode = !isDarkMode;
      setIsDarkMode(newMode);
      localStorage.setItem('theme', newMode ? 'dark' : 'light');
  };

  // Sidebar State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Data State
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
  
  // AI & Modals
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  
  // Notifications State (NEW)
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Column Visibility State (NEW)
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    date: true, sku: true, description: true, quantity: true, total: true
  });
  
  const [availableDates, setAvailableDates] = useState([]);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [drillDownMonth, setDrillDownMonth] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  
  const [selectedProduct, setSelectedProduct] = useState([]); 
  const [selectedSku, setSelectedSku] = useState(''); 
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [pieMetric, setPieMetric] = useState('total');

  // Filter by Years State
  const [yearFilter, setYearFilter] = useState({ start: '', end: '' });

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

  // Extract available years from data
  const availableYears = useMemo(() => {
    const years = new Set();
    const dates = [...salesData, ...suppliersData].map(d => d.date).filter(Boolean);
    dates.forEach(d => {
        const parts = d.split('-');
        if (parts.length === 2) {
             // Assuming date format is Month-YY (e.g. "יול-25")
             const year = parseInt(parts[1]) + 2000;
             if (!isNaN(year)) years.add(year);
        }
    });
    return [...years].sort((a, b) => a - b);
  }, [salesData, suppliersData]);

  // Update date filter based on Year selection
  useEffect(() => {
    if (yearFilter.start && yearFilter.end && availableDates.length > 0) {
        // Find first month of start year
        const startYearShort = yearFilter.start.toString().slice(-2);
        const endYearShort = yearFilter.end.toString().slice(-2);
        
        // availableDates are sorted chronologically
        const startMonth = availableDates.find(d => d.endsWith(startYearShort));
        // Find last month of end year
        const endMonth = [...availableDates].reverse().find(d => d.endsWith(endYearShort));
        
        if (startMonth && endMonth) {
            setDateFilter({ start: startMonth, end: endMonth });
        }
    }
  }, [yearFilter, availableDates]);

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
        const base = {
            'תאריך': item.date,
            'סכום': item.total,
            'כמות': item.quantity,
            'יחידה': item.unit
        };
        if (activeTab === 'sales') {
            return { ...base, 'מוצר': item.description, 'מק"ט': item.sku };
        } else {
            return { ...base, 'ספק': item.supplier };
        }
    });

    if (activeTab === 'summary') {
        const summaryExport = summaryData.chart.map(item => ({
            'תאריך': item.name,
            'הכנסות': item.income,
            'הוצאות': item.expenses,
            'רווח נקי': item.profit
        }));
        const ws = window.XLSX.utils.json_to_sheet(summaryExport);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Summary");
        window.XLSX.writeFile(wb, `financial_summary_export.xlsx`);
        return;
    }

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
      
      const filterDate = (d) => {
          const val = getComparableDateValue(d.date);
          return val >= startVal && val <= endVal;
      }

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
          return {
              name: date,
              income,
              expenses,
              profit: income - expenses,
              order: getComparableDateValue(date)
          };
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
    
    // Auto-Generate Notifications logic
    const alerts = [];
    if (trend > 20) alerts.push({ id: 1, type: 'success', text: `עלייה מרשימה של ${trend.toFixed(0)}% במחזור החודש האחרון!` });
    if (trend < -20) alerts.push({ id: 2, type: 'warning', text: `ירידה של ${Math.abs(trend).toFixed(0)}% במחזור החודש האחרון.` });
    if (totalAmount > 1000000) alerts.push({ id: 3, type: 'info', text: 'חצית את רף המיליון ש"ח!' });

    return { totalAmount, totalQuantity, uniqueCount, avgAmount: monthsCount > 0 ? totalAmount / monthsCount : 0, avgQuantity: monthsCount > 0 ? totalQuantity / monthsCount : 0, monthsCount, trend, alerts };
  }, [filteredData, dateFilter, availableDates, activeTab]);

  useEffect(() => {
      if (stats?.alerts) setNotifications(stats.alerts);
  }, [stats]);

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
    const monthly = Object.keys(monthsMap).map(key => {
        const monthEntry = {
            name: key,
            sales: monthsMap[key].total,
            quantity: monthsMap[key].quantity,
            order: getComparableDateValue(key)
        };
        if (selectedProduct.length > 0) {
            selectedProduct.forEach(prod => {
                monthEntry[prod] = monthsMap[key][prod] || 0;
                monthEntry[`${prod}_quantity`] = monthsMap[key][`${prod}_quantity`] || 0;
            });
        }
        return monthEntry;
    }).sort((a, b) => a.order - b.order);

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
        name: key, total: entityMap[key].total, quantity: entityMap[key].quantity, value: entityMap[key][valueKey]
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
        נתח את הדו"ח הפיננסי הבא (רווח והפסד):
        סה"כ הכנסות: ${formatCurrency(summaryData.totalIncome)}
        סה"כ הוצאות: ${formatCurrency(summaryData.totalExpenses)}
        רווח נקי: ${formatCurrency(summaryData.totalProfit)} (${summaryData.profitMargin.toFixed(1)}%)
        נתונים חודשיים: ${summaryData.chart.map(m => `${m.name}: רווח ${formatCurrency(m.profit)}`).join(', ')}
        
        תן 3 תובנות עסקיות קצרות בעברית על המגמות והרווחיות.
        `;
    } else {
        const context = activeTab === 'sales' ? 'מכירות' : 'רכש';
        const filterTxt = activeTab === 'sales' ? (selectedProduct.length > 0 ? `מוצרים: ${selectedProduct.join(', ')}` : 'כל המוצרים') : (selectedSupplier ? `ספק: ${selectedSupplier}` : 'כל הספקים');
        prompt = `
        נתח נתוני ${context}:
        הקשר: ${filterTxt}
        סה"כ: ${formatCurrency(stats.totalAmount)}
        מגמות: ${chartData.monthly.map(m => `${m.name}: ${formatCurrency(m.sales)}`).join(', ')}
        מובילים: ${chartData.pie.map(p => `${p.name}: ${formatCurrency(p.total)}`).join(', ')}
        תן תובנות קצרות.
        `;
    }

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await res.json();
      setAiReport(data.candidates?.[0]?.content?.parts?.[0]?.text || "שגיאה.");
    } catch (e) { setAiReport("שגיאת תקשורת."); } finally { setAiLoading(false); }
  };

  const handleChatSend = async (text) => {
      setChatMessages(prev => [...prev, { role: 'user', content: text }]);
      setIsChatThinking(true);
      const prompt = `ענה בעברית לשאלה: ${text}`;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הבנתי.";
        setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      } catch (e) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: "שגיאה." }]);
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
     if (availableDates.length > 0) setDateFilter({ start: availableDates[0], end: availableDates[availableDates.length - 1] });
     setSearchTerm(''); setSelectedProduct([]); setSelectedSku(''); setSelectedSupplier(''); setDrillDownMonth(null);
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
    <div className={`flex min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-800'}`} dir="rtl">
      
      <AIReportModal isOpen={aiModalOpen} onClose={() => setAiModalOpen(false)} isLoading={aiLoading} report={aiReport} />
      <ClearDataModal isOpen={clearModalOpen} onClose={() => setClearModalOpen(false)} onConfirm={handleClearData} type={activeTab} isDarkMode={isDarkMode} />
      
      <div className="fixed bottom-6 left-6 z-40">
          {!chatOpen && <button onClick={() => setChatOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-xl hover:scale-105 transition-transform"><MessageSquare className="w-6 h-6" /></button>}
          <AIChatWindow isOpen={chatOpen} onClose={() => setChatOpen(false)} onSend={handleChatSend} messages={chatMessages} isThinking={isChatThinking} isDarkMode={isDarkMode} />
      </div>

      <div className={`flex-shrink-0 transition-all duration-300 border-l ${isSidebarCollapsed ? 'w-20' : 'w-64'} ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 text-white border-slate-800'}`}>
        <div className="p-4 flex items-center justify-between border-b border-white/10">
            <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center w-full' : ''}`}>
               <div className="bg-blue-600 p-2 rounded-lg shrink-0"><LayoutDashboard className="w-5 h-5 text-white" /></div>
               {!isSidebarCollapsed && <span className="text-xl font-bold text-white tracking-tight">BizData</span>}
            </div>
            <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
                {isSidebarCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
            {[
                { id: 'sales', label: 'מכירות', icon: TrendingUp, color: 'text-blue-400' },
                { id: 'suppliers', label: 'רכש וספקים', icon: Truck, color: 'text-emerald-400' },
                { id: 'summary', label: 'סיכום פיננסי', icon: BarChart3, color: 'text-violet-400' },
            ].map(tab => (
                <button 
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); resetAllFilters(); }} 
                    className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${activeTab === tab.id ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                >
                    <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? tab.color : 'group-hover:text-white transition-colors'}`} />
                    {!isSidebarCollapsed && <span className="font-medium">{tab.label}</span>}
                </button>
            ))}
        </nav>
        <div className={`p-4 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-700'}`}>
            <div className="flex flex-col gap-3">
                <label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 group ${loading ? 'opacity-50' : 'hover:bg-white/10'} ${isDarkMode ? 'bg-slate-900 text-slate-300' : 'bg-slate-800 text-slate-300'}`}>
                    {loading ? <Loader2 className="w-5 h-5 animate-spin text-blue-400" /> : <Upload className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />}
                    {!isSidebarCollapsed && <span className="text-sm font-medium text-slate-300 group-hover:text-white">טען קבצים</span>}
                    <input type="file" accept=".csv, .xlsx, .xls" multiple onChange={handleFileUpload} className="hidden" disabled={loading} />
                </label>
                {!isSidebarCollapsed && storageWarning && <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded-lg text-center flex items-center justify-center gap-1"><AlertTriangle className="w-3 h-3"/> שטח אחסון מלא</div>}
                {activeData.length > 0 && (
                     <button onClick={() => setClearModalOpen(true)} className={`flex items-center gap-3 p-3 rounded-xl transition-colors text-red-400 hover:bg-red-400/10 hover:text-red-300 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
                        <Trash2 className="w-5 h-5" />
                        {!isSidebarCollapsed && <span className="text-sm font-medium">נקה הכל</span>}
                    </button>
                )}
            </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className={`px-8 py-5 flex justify-between items-center shadow-sm z-10 border-b transition-colors ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex flex-col gap-1">
                <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                    {activeTab === 'sales' ? 'דשבורד מכירות' : activeTab === 'suppliers' ? 'דשבורד רכש וספקים' : 'סיכום רווח והפסד'}
                </h1>
                {activeTab !== 'summary' && activeFileNames.length === 0 && <div className="text-sm text-slate-400 mt-1 flex items-center gap-1"><Info className="w-3 h-3"/> טען קבצים כדי להתחיל</div>}
                {activeTab !== 'summary' && activeFileNames.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        {activeFileNames.map((n, i) => (
                            <span key={i} className={`px-2 py-0.5 rounded-md text-[11px] border flex items-center gap-1.5 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
                                <FileSpreadsheet className="w-3 h-3 text-emerald-500"/>
                                <span className="max-w-[100px] truncate" title={n}>{n}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3">
                 <button onClick={toggleTheme} className={`p-2.5 rounded-xl transition-all ${isDarkMode ? 'bg-slate-800 text-yellow-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'}`}>
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <div className="relative">
                    <button 
                        onClick={() => setShowNotifications(!showNotifications)}
                        className={`p-2.5 rounded-xl transition-all relative ${isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                        <Bell className="w-5 h-5" />
                        {notifications.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
                    </button>
                    {showNotifications && (
                        <div className={`absolute left-0 mt-2 w-72 rounded-xl shadow-2xl border p-4 z-50 animate-in fade-in zoom-in duration-200 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                            <h4 className="font-bold mb-3 text-sm">התראות חכמות</h4>
                            {notifications.length > 0 ? (
                                <div className="space-y-2">
                                    {notifications.map(n => (
                                        <div key={n.id} className={`p-2 rounded-lg text-xs flex items-center gap-2 ${n.type === 'success' ? 'bg-emerald-500/10 text-emerald-600' : n.type === 'warning' ? 'bg-red-500/10 text-red-600' : 'bg-blue-500/10 text-blue-600'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${n.type === 'success' ? 'bg-emerald-500' : n.type === 'warning' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                            {n.text}
                                        </div>
                                    ))}
                                </div>
                            ) : <div className="text-xs text-slate-400 text-center py-4">אין התראות חדשות</div>}
                        </div>
                    )}
                </div>
                <div className={`p-2.5 rounded-xl ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                    <User className="w-5 h-5" />
                </div>
                
                <div className={`h-8 w-px mx-1 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}></div>
                 {availableDates.length > 0 && (
                     <div className="hidden xl:flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                        {/* Year Selector */}
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                             <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>משנה:</span>
                             <select 
                                onChange={(e) => setYearFilter(prev => ({ ...prev, start: e.target.value }))}
                                className={`bg-transparent font-bold cursor-pointer text-sm border-none focus:ring-0 p-0 ${isDarkMode ? 'text-white' : 'text-slate-700'}`}
                             >
                                <option value="">בחר</option>
                                {availableYears.map(y => <option key={`start-${y}`} value={y} className={isDarkMode ? 'bg-slate-800' : ''}>{y}</option>)}
                             </select>
                             <div className={`w-px h-4 mx-2 ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`}></div>
                             <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>עד שנה:</span>
                             <select 
                                onChange={(e) => setYearFilter(prev => ({ ...prev, end: e.target.value }))}
                                className={`bg-transparent font-bold cursor-pointer text-sm border-none focus:ring-0 p-0 ${isDarkMode ? 'text-white' : 'text-slate-700'}`}
                             >
                                <option value="">בחר</option>
                                {availableYears.map(y => <option key={`end-${y}`} value={y} className={isDarkMode ? 'bg-slate-800' : ''}>{y}</option>)}
                             </select>
                        </div>
                        
                         <div className={`flex p-1 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                             {[3, 'year', null].map((filter, i) => (
                                 <button key={i} onClick={() => setQuickDate(filter)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!filter ? 'hover:bg-slate-100 dark:hover:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700'} ${isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                                     {filter === 3 ? '3 חודשים' : filter === 'year' ? 'השנה' : 'הכל'}
                                 </button>
                             ))}
                         </div>
                     </div>
                 )}
                 <button onClick={generateAIInsight} className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all hover:-translate-y-0.5 active:scale-95 font-medium text-sm">
                    <Sparkles className="w-4 h-4 text-yellow-200 animate-pulse" /> <span>תובנות</span>
                </button>
            </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8 scroll-smooth">
            {activeData.length === 0 && activeTab !== 'summary' ? (
                <EmptyState onUpload={handleFileUpload} loading={loading} isDarkMode={isDarkMode} />
            ) : activeTab === 'summary' ? (
                 summaryData ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card title="סה״כ הכנסות" value={formatCurrency(summaryData.totalIncome)} subtext="מסה״כ המכירות" icon={DollarSign} color="bg-blue-500" isDarkMode={isDarkMode} />
                            <Card title="סה״כ הוצאות" value={formatCurrency(summaryData.totalExpenses)} subtext="מסה״כ הספקים" icon={Wallet} color="bg-red-500" isDarkMode={isDarkMode} />
                            <Card title="רווח נקי" value={formatCurrency(summaryData.totalProfit)} subtext={`${summaryData.profitMargin.toFixed(1)}% אחוז רווח`} icon={Activity} color={summaryData.totalProfit >= 0 ? "bg-emerald-500" : "bg-red-600"} isDarkMode={isDarkMode} />
                        </div>
                        <div className={`p-6 rounded-2xl border shadow-sm h-[500px] transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className={`text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><BarChart3 className="w-5 h-5 text-indigo-500" /> ניתוח רווח והפסד</h3>
                                <button onClick={handleExport} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`} title="הורד דוח"><Download className="w-4 h-4"/></button>
                            </div>
                            <div style={{ width: '100%', height: '400px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={summaryData.chart} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#334155' : '#f1f5f9'} />
                                        <XAxis dataKey="name" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{fontSize: 12}} tickMargin={10} axisLine={false} tickLine={false} />
                                        <YAxis stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(val) => `₪${val/1000}k`} />
                                        <RechartsTooltip formatter={(val) => formatCurrency(val)} contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', color: isDarkMode ? '#fff' : '#0f172a', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Bar dataKey="income" name="הכנסות" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                                        <Bar dataKey="expenses" name="הוצאות" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={30} />
                                        <Area type="monotone" dataKey="profit" name="רווח נקי" stroke="#10b981" fillOpacity={1} fill="url(#colorProfit)" strokeWidth={3} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                 ) : <div className="flex flex-col items-center justify-center h-96 text-center animate-in fade-in zoom-in"><div className={`p-6 rounded-full mb-4 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}><BarChart3 className={`w-12 h-12 ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} /></div><h3 className={`text-xl font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>אין נתונים לסיכום</h3><p className={`mt-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>אנא טען קבצים בלשוניות המכירות והספקים כדי לראות את התמונה המלאה.</p></div>
            ) : (
            <>
            {/* Filters */}
            <div className={`p-4 rounded-2xl shadow-sm border flex flex-col xl:flex-row gap-4 items-center justify-between transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <div className="flex items-center gap-3 w-full xl:w-auto">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-500'}`}><Filter className="w-5 h-5" /></div>
                    {activeTab === 'sales' ? (
                        <div className="flex flex-col sm:flex-row gap-3 w-full">
                            <div className="w-full sm:w-64"><Autocomplete options={uniqueItems.products} value={selectedProduct} onChange={(val) => { setSelectedProduct(val); setSelectedSku(''); }} placeholder="בחר מוצרים..." icon={Box} multiple={true} maxSelections={5} isDarkMode={isDarkMode} /></div>
                            <div className="w-full sm:w-48"><Autocomplete options={uniqueItems.skus} value={selectedSku} onChange={(val) => { setSelectedSku(val); setSelectedProduct([]); }} placeholder="בחר מק״ט..." icon={Tag} isDarkMode={isDarkMode} /></div>
                        </div>
                    ) : (
                        <div className="w-full sm:w-80"><Autocomplete options={uniqueItems.suppliers} value={selectedSupplier} onChange={setSelectedSupplier} placeholder="בחר ספק..." icon={Truck} isDarkMode={isDarkMode} /></div>
                    )}
                </div>
                
                {(selectedProduct.length > 0 || selectedSku || selectedSupplier || searchTerm || drillDownMonth) && (
                    <button onClick={resetAllFilters} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isDarkMode ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                        <X className="w-4 h-4" /> נקה סינון
                    </button>
                )}
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <Card 
                    title={activeTab === 'sales' ? 'סה״כ הכנסות' : 'סה״כ הוצאות'} 
                    value={formatCurrency(stats.totalAmount)} 
                    subtext="בתקופה שנבחרה" 
                    icon={activeTab === 'sales' ? DollarSign : Wallet} 
                    color={activeTab === 'sales' ? 'bg-blue-500' : 'bg-red-500'} 
                    trend={stats.trend}
                    isDarkMode={isDarkMode}
                />
                <Card title="ממוצע חודשי" value={formatCurrency(stats.avgAmount)} subtext={`לפי ${stats.monthsCount} חודשים`} icon={Activity} color="bg-amber-500" isDarkMode={isDarkMode} />
                <Card title={activeTab === 'sales' ? 'כמות יחידות' : 'כמות שורות'} value={stats.totalQuantity.toLocaleString()} subtext="סה״כ בסינון" icon={Package} color="bg-emerald-500" isDarkMode={isDarkMode} />
                <Card title="ממוצע כמות" value={avgList ? (
                        <div className="flex flex-col gap-1.5 mt-2 max-h-[80px] overflow-y-auto custom-scrollbar pr-2">
                            {avgList.map(item => (
                                <div key={item.name} className={`flex justify-between items-center text-xs pb-1 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-100'}`}>
                                    <span className={`truncate w-24 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`} title={item.name}>{item.name}</span>
                                    <span className={`font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{Math.round(item.quantity / stats.monthsCount)}</span>
                                </div>
                            ))}
                        </div>
                    ) : Math.round(stats.avgQuantity).toLocaleString()} subtext={avgList ? 'פירוט לפי פריט' : 'ממוצע חודשי כללי'} icon={Layers} color="bg-cyan-500" isDarkMode={isDarkMode} />
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Trend Chart (2/3 width) */}
                <div className={`lg:col-span-2 p-6 rounded-2xl border shadow-sm min-h-[450px] transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className={`text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><Calendar className="w-5 h-5 text-blue-500" />{activeTab === 'sales' ? 'מגמות מכירות' : 'מגמות הוצאות'}</h3>
                        {drillDownMonth && (
                             <button onClick={() => setDrillDownMonth(null)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDarkMode ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
                                <MousePointerClick className="w-3 h-3" />
                                {drillDownMonth} <X className="w-3 h-3 ml-1" />
                             </button>
                        )}
                    </div>
                    <div style={{ width: '100%', height: '350px' }}>
                        {chartData && chartData.monthly.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData.monthly} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#334155' : '#f1f5f9'} />
                                <XAxis dataKey="name" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{fontSize: 12}} tickMargin={10} axisLine={false} tickLine={false} />
                                <YAxis yAxisId="left" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(val) => `₪${val/1000}k`} />
                                {activeTab === 'sales' && <YAxis yAxisId="right" orientation="right" stroke="#10b981" axisLine={false} tickLine={false} tick={{fontSize: 12}} />}
                                <RechartsTooltip cursor={{ fill: isDarkMode ? '#334155' : '#f1f5f9', opacity: 0.4 }} formatter={(val, name) => name.includes('כמות') ? val : formatCurrency(val)} contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', color: isDarkMode ? '#fff' : '#0f172a', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                                <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px' }} />
                                {activeTab === 'sales' && selectedProduct.length > 0 ? (
                                    selectedProduct.map((p, i) => (
                                        <React.Fragment key={p}>
                                            <Bar yAxisId="left" dataKey={p} name={p} stackId="a" fill={COLORS[i % COLORS.length]} radius={i === selectedProduct.length - 1 ? [4, 4, 0, 0] : [0,0,0,0]} />
                                            <Line yAxisId="right" type="monotone" dataKey={`${p}_quantity`} name={`${p} (כמות)`} stroke={COLORS[i % COLORS.length]} strokeDasharray="3 3" strokeWidth={2} dot={{r:3, strokeWidth:0}} activeDot={{r:5}} />
                                        </React.Fragment>
                                    ))
                                ) : activeTab === 'sales' ? (
                                    <>
                                        <Bar yAxisId="left" dataKey="total" name="סכום" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
                                        <Line yAxisId="right" type="monotone" dataKey="quantity" name="כמות" stroke="#10b981" strokeWidth={3} dot={{r:4, fill:'#10b981', strokeWidth:2, stroke:'#fff'}} activeDot={{r:6}} />
                                    </>
                                ) : (
                                    <Bar yAxisId="left" dataKey="total" name="סכום" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={32} />
                                )}
                            </ComposedChart>
                        </ResponsiveContainer>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <BarChart3 className="w-12 h-12 mb-2 opacity-20" />
                                <p>אין נתונים להצגה</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Pie Chart (1/3 width) */}
                <div className={`p-6 rounded-2xl border shadow-sm flex flex-col min-h-[450px] transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                    <div className="flex flex-col gap-4 mb-4">
                        <h3 className={`text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><TrendingUp className="w-5 h-5 text-emerald-500" />{activeTab === 'sales' ? (selectedProduct.length > 0 ? 'התפלגות נבחרים' : 'מוצרים מובילים') : 'ספקים מובילים'}</h3>
                        {activeTab === 'sales' && (
                            <div className={`flex self-start rounded-lg p-1 text-xs ${isDarkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                                <button onClick={() => setPieMetric('total')} className={`px-3 py-1.5 rounded-md transition-all ${pieMetric === 'total' ? (isDarkMode ? 'bg-slate-600 text-white shadow' : 'bg-white shadow text-blue-700') : 'text-slate-500'}`}>סכום</button>
                                <button onClick={() => setPieMetric('quantity')} className={`px-3 py-1.5 rounded-md transition-all ${pieMetric === 'quantity' ? (isDarkMode ? 'bg-slate-600 text-white shadow' : 'bg-white shadow text-blue-700') : 'text-slate-500'}`}>כמות</button>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-h-[300px]">
                        {chartData && chartData.pie.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={chartData.pie} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={4} dataKey="value" stroke="none">
                                        {chartData.pie.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                    </Pie>
                                    <RechartsTooltip content={<CustomPieTooltip isDarkMode={isDarkMode} />} />
                                    <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '11px', paddingTop: '20px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <div className="flex flex-col items-center justify-center h-full text-slate-400"><PieChartIcon className="w-12 h-12 mb-2 opacity-20" /><p>אין נתונים להצגה</p></div>}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className={`rounded-2xl border shadow-sm overflow-hidden transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <div className={`p-6 border-b flex flex-col sm:flex-row justify-between items-center gap-4 sticky top-0 z-10 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                    <h3 className={`text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><FileText className="w-5 h-5 text-slate-400" /> פירוט עסקאות</h3>
                    <div className="flex gap-3 items-center w-full sm:w-auto">
                        <div className="relative">
                            <button onClick={() => setShowColumnMenu(!showColumnMenu)} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="הגדרות תצוגה"><Settings className="w-4 h-4"/></button>
                            {showColumnMenu && (
                                <div className={`absolute left-0 mt-2 w-48 rounded-xl shadow-xl border p-2 z-50 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                                    <div className="text-xs font-bold mb-2 px-2 opacity-50">עמודות להצגה</div>
                                    {Object.keys(visibleColumns).map(col => (
                                        <button key={col} onClick={() => setVisibleColumns(prev => ({...prev, [col]: !prev[col]}))} className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}>
                                            <span>{col === 'date' ? 'תאריך' : col === 'sku' ? 'מק״ט' : col === 'description' ? 'תיאור' : col === 'quantity' ? 'כמות' : 'סכום'}</span>
                                            {visibleColumns[col] ? <Eye className="w-3 h-3 text-blue-500" /> : <EyeOff className="w-3 h-3 text-slate-400" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button onClick={handleExport} className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl transition-colors text-sm font-medium border ${isDarkMode ? 'bg-emerald-900/20 border-emerald-800 text-emerald-400 hover:bg-emerald-900/40' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'}`}>
                            <Download className="w-4 h-4" /> <span className="hidden sm:inline">ייצוא לאקסל</span>
                        </button>
                        <div className="relative flex-1 sm:w-64">
                            <Search className={`absolute right-3 top-2.5 w-4 h-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                            <input 
                                type="text" 
                                placeholder="חיפוש בטבלה..." 
                                className={`w-full pl-4 pr-10 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm transition-colors ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900'}`} 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[500px]">
                    <table className={`w-full text-sm text-right ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                        <thead className={`font-medium text-xs uppercase tracking-wider sticky top-0 z-10 ${isDarkMode ? 'bg-slate-900/90 text-slate-400 backdrop-blur' : 'bg-slate-50/90 text-slate-500 backdrop-blur'}`}>
                            <tr>
                                {visibleColumns.date && <th className="px-6 py-4 cursor-pointer hover:text-blue-500 transition-colors" onClick={() => requestSort('date')}>תאריך</th>}
                                {visibleColumns.sku && activeTab === 'sales' && <th className="px-6 py-4">מק״ט</th>}
                                {visibleColumns.description && <th className="px-6 py-4 cursor-pointer hover:text-blue-500 transition-colors" onClick={() => requestSort(activeTab === 'sales' ? 'description' : 'supplier')}>
                                    {activeTab === 'sales' ? 'מוצר' : 'ספק'}
                                </th>}
                                {visibleColumns.quantity && <th className="px-6 py-4 cursor-pointer hover:text-blue-500 transition-colors" onClick={() => requestSort('quantity')}>כמות</th>}
                                {visibleColumns.total && <th className="px-6 py-4 cursor-pointer hover:text-blue-500 transition-colors" onClick={() => requestSort('total')}>סכום</th>}
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700/50' : 'divide-slate-100'}`}>
                            {paginatedData.length > 0 ? paginatedData.map((row) => (
                                <tr key={row.id} className={`transition-colors ${isDarkMode ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'}`}>
                                    {visibleColumns.date && <td className="px-6 py-4 whitespace-nowrap">{row.date}</td>}
                                    {visibleColumns.sku && activeTab === 'sales' && <td className="px-6 py-4 font-mono text-xs opacity-60">{row.sku}</td>}
                                    {visibleColumns.description && <td className={`px-6 py-4 font-medium ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{activeTab === 'sales' ? row.description : row.supplier}</td>}
                                    {visibleColumns.quantity && <td className="px-6 py-4"><span className={`px-2.5 py-1 rounded-md text-xs font-bold ${isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{row.quantity}</span></td>}
                                    {visibleColumns.total && <td className={`px-6 py-4 font-bold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatCurrency(row.total)}</td>}
                                </tr>
                            )) : <tr><td colSpan="5" className="px-6 py-20 text-center opacity-50">לא נמצאו נתונים התואמים לחיפוש</td></tr>}
                        </tbody>
                    </table>
                </div>
                <div className={`px-6 py-4 border-t text-xs flex justify-between items-center ${isDarkMode ? 'bg-slate-900/30 border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                    <span>מציג {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredData.length)} מתוך {filteredData.length} רשומות</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700 disabled:opacity-30' : 'hover:bg-slate-200 disabled:opacity-30'}`}><ChevronRight className="w-4 h-4" /></button>
                        <span className="font-mono">{currentPage} / {totalPages || 1}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700 disabled:opacity-30' : 'hover:bg-slate-200 disabled:opacity-30'}`}><ChevronLeft className="w-4 h-4" /></button>
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
