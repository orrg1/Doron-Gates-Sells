import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter, ArrowUpDown, ArrowUp, ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot, Loader2, FileText, Check, Trash2, Truck, Wallet, LayoutDashboard, FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight, PieChart as PieChartIcon, BarChart3, Download, MousePointerClick, Clock, MessageSquare, Send, Moon, Sun } from 'lucide-react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Area } from 'recharts';

// --- הגדרות API של GEMINI ---
const apiKey = ""; // הדבק כאן את המפתח שלך

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

const Card = ({ title, value, subtext, icon: Icon, color, trend, isDarkMode }) => (
  <div className={`p-6 rounded-xl shadow-sm border flex items-center justify-between hover:shadow-md transition-all duration-300 h-full relative overflow-hidden group ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-100 text-slate-800'}`}>
    <div className={`absolute top-0 right-0 w-1 h-full ${color.replace('bg-', 'bg-').replace('text-', '')}`}></div>
    <div className="flex-1 min-w-0 z-10">
      <p className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{title}</p>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="flex items-center gap-2 mt-2">
          {trend !== undefined && trend !== null && !isNaN(trend) && (
              <span className={`text-xs font-bold flex items-center px-2 py-0.5 rounded-full ${trend >= 0 ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700') : (isDarkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700')}`}>
                  {trend >= 0 ? <TrendingUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />}
                  {Math.abs(trend).toFixed(1)}%
              </span>
          )}
          {subtext && <p className={`text-xs truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} title={subtext}>{subtext}</p>}
      </div>
    </div>
    <div className={`p-3 rounded-xl shrink-0 ml-4 self-start shadow-inner ${isDarkMode ? 'bg-slate-700' : 'bg-slate-50'} group-hover:scale-110 transition-transform`}>
      <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-').replace('500', '600')}`} />
    </div>
  </div>
);

const CustomPieTooltip = ({ active, payload, isDarkMode }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className={`p-3 border shadow-xl rounded-lg text-right z-50 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
        <p className={`font-bold mb-2 border-b pb-1 ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>{data.name}</p>
        <div className="space-y-1 text-sm">
          {data.quantity !== undefined && (
             <div className="flex justify-between gap-4">
                <span className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>כמות:</span>
                <span className="font-medium text-blue-500">{data.quantity}</span>
             </div>
          )}
          <div className="flex justify-between gap-4">
            <span className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>סכום:</span>
            <span className="font-medium text-emerald-500">{formatCurrency(data.total)}</span>
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
        className={`relative flex items-center flex-wrap gap-2 w-full pl-8 pr-10 py-2.5 border rounded-xl focus-within:ring-2 focus-within:ring-indigo-500/50 focus-within:border-indigo-500 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'} ${isLimitReached && !isOpen ? (isDarkMode ? 'border-orange-500/50 bg-orange-900/10' : 'border-orange-200 bg-orange-50') : ''}`}
        onClick={() => document.getElementById(`input-${placeholder}`)?.focus()}
      >
        {Icon && <Icon className={`absolute right-3 top-3 w-4 h-4 pointer-events-none z-10 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />}
        {multiple && Array.isArray(value) && value.map(val => (
            <span key={val} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full animate-in fade-in zoom-in duration-200 border shadow-sm ${isDarkMode ? 'bg-indigo-900/50 text-indigo-200 border-indigo-800' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                <span className="max-w-[120px] truncate" title={val}>{val}</span>
                <X className="w-3 h-3 cursor-pointer hover:text-red-500 transition-colors" onClick={(e) => removeTag(val, e)} />
            </span>
        ))}
        <input
          id={`input-${placeholder}`}
          type="text"
          className={`flex-1 bg-transparent border-none focus:ring-0 text-sm min-w-[80px] ${isDarkMode ? 'text-white placeholder-slate-500' : 'text-slate-700 placeholder-slate-400'}`}
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
        <div className={`absolute z-50 w-full mt-2 border rounded-xl shadow-xl max-h-60 overflow-y-auto text-right overflow-hidden ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => {
              const isSelected = multiple ? value.includes(opt) : value === opt;
              return (
                <div
                  key={idx}
                  className={`px-4 py-2.5 cursor-pointer text-sm transition-colors flex items-center justify-between border-b last:border-0 ${isDarkMode ? 'border-slate-700/50 hover:bg-slate-700' : 'border-slate-50 hover:bg-slate-50'} ${
                    isSelected ? (isDarkMode ? 'bg-indigo-900/30 text-indigo-300' : 'bg-indigo-50 text-indigo-700 font-medium') : (isDarkMode ? 'text-slate-300' : 'text-slate-700')
                  }`}
                  onClick={() => handleSelect(opt)}
                >
                  <span>{opt}</span>
                  {isSelected && <Check className="w-4 h-4 text-indigo-500" />}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
                <div className="p-8 flex flex-col items-center text-center">
                    <div className={`p-4 rounded-full mb-6 ${isDarkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
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
            <div className="p-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex justify-between items-center shadow-md">
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
                            : 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-bl-none'
                        }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-end">
                        <div className={`p-3 rounded-2xl rounded-bl-none flex gap-1.5 ${isDarkMode ? 'bg-slate-800' : 'bg-indigo-50'}`}>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
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
                    className={`flex-1 border rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${isDarkMode ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                />
                <button 
                    type="submit" 
                    disabled={isThinking || !input.trim()}
                    className={`p-2.5 rounded-full text-white transition-all transform active:scale-95 ${isThinking || !input.trim() ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-lg'}`}
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
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
  // State for Dark Mode
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
  
  // AI & Chat
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatThinking, setIsChatThinking] = useState(false);

  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  
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
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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
    <div className={`flex min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`} dir="rtl">
      
      <AIReportModal isOpen={aiModalOpen} onClose={() => setAiModalOpen(false)} isLoading={aiLoading} report={aiReport} />
      <ClearDataModal isOpen={clearModalOpen} onClose={() => setClearModalOpen(false)} onConfirm={handleClearData} type={activeTab} isDarkMode={isDarkMode} />
      
      {/* Chat Button */}
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
            isDarkMode={isDarkMode}
          />
      </div>

      {/* Sidebar */}
      <div className={`w-20 lg:w-64 flex flex-col flex-shrink-0 transition-all duration-300 border-l ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 text-white border-slate-700'}`}>
        <div className={`p-4 lg:p-6 flex items-center justify-center lg:justify-start gap-3 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-700'}`}>
            <div className="bg-blue-600 p-2 rounded-lg"><LayoutDashboard className="w-6 h-6 text-white" /></div>
            <span className={`text-xl font-bold hidden lg:block ${isDarkMode ? 'text-white' : 'text-white'}`}>BizData</span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
            <button onClick={() => { setActiveTab('sales'); resetAllFilters(); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${activeTab === 'sales' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
                <TrendingUp className="w-5 h-5" />
                <span className="hidden lg:block font-medium">מכירות</span>
            </button>
            <button onClick={() => { setActiveTab('suppliers'); resetAllFilters(); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${activeTab === 'suppliers' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
                <Truck className="w-5 h-5" />
                <span className="hidden lg:block font-medium">רכש וספקים</span>
            </button>
             <button onClick={() => { setActiveTab('summary'); resetAllFilters(); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${activeTab === 'summary' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
                <BarChart3 className="w-5 h-5" />
                <span className="hidden lg:block font-medium">סיכום פיננסי</span>
            </button>
        </nav>
        <div className={`p-4 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-700'}`}>
            <div className="flex flex-col gap-4">
                <label className={`flex items-center justify-center lg:justify-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${loading ? 'opacity-50' : 'hover:bg-white/10'} ${isDarkMode ? 'bg-slate-900 text-slate-300' : 'bg-slate-800 text-slate-300'}`}>
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className={`px-8 py-5 flex justify-between items-center shadow-sm z-10 border-b transition-colors ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex flex-col gap-1">
                <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                    {activeTab === 'sales' ? 'דשבורד מכירות' : activeTab === 'suppliers' ? 'דשבורד רכש וספקים' : 'סיכום רווח והפסד'}
                </h1>
                {activeTab !== 'summary' && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        {activeFileNames.length > 0 ? activeFileNames.map((n, i) => (
                            <span key={i} className={`px-2 py-0.5 rounded text-xs border flex items-center gap-1 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
                                <FileSpreadsheet className="w-3 h-3 text-green-500"/>
                                <span className="max-w-[150px] truncate" title={n}>{n}</span>
                            </span>
                        )) : <span className="text-slate-400 italic">אין קבצים</span>}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-4">
                {availableDates.length > 0 && (
                    <div className="flex items-center gap-2">
                         <div className={`hidden md:flex border rounded-lg p-1 text-xs shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                            <button onClick={() => setQuickDate(3)} className={`px-3 py-1 rounded transition-colors font-medium ${isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-50'}`}>3 חודשים</button>
                            <div className={`w-px my-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                            <button onClick={() => setQuickDate('year')} className={`px-3 py-1 rounded transition-colors font-medium ${isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-50'}`}>השנה</button>
                            <div className={`w-px my-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                            <button onClick={() => setQuickDate(null)} className={`px-3 py-1 rounded transition-colors font-medium ${isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-50'}`}>הכל</button>
                        </div>

                        <div className={`hidden md:flex items-center px-3 py-1.5 rounded-lg border text-sm ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                            <span className="text-slate-500 ml-2"><Calendar className="w-4 h-4" /></span>
                            <select value={dateFilter.start} onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className={`bg-transparent font-bold cursor-pointer text-sm border-none focus:ring-0 ${isDarkMode ? 'text-white' : 'text-slate-700'}`}>{availableDates.map(d => <option key={`s${d}`} value={d} className={isDarkMode ? 'bg-slate-800' : ''}>{d}</option>)}</select>
                            <span className="mx-2 text-slate-400">-</span>
                            <select value={dateFilter.end} onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className={`bg-transparent font-bold cursor-pointer text-sm border-none focus:ring-0 ${isDarkMode ? 'text-white' : 'text-slate-700'}`}>{availableDates.map(d => <option key={`e${d}`} value={d} className={isDarkMode ? 'bg-slate-800' : ''}>{d}</option>)}</select>
                        </div>
                    </div>
                )}
                <button onClick={toggleTheme} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'bg-slate-800 text-yellow-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
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
                            <Card title="סה״כ הכנסות" value={formatCurrency(summaryData.totalIncome)} subtext="מסה״כ המכירות" icon={DollarSign} color="bg-blue-500" isDarkMode={isDarkMode} />
                            <Card title="סה״כ הוצאות" value={formatCurrency(summaryData.totalExpenses)} subtext="מסה״כ הספקים" icon={Wallet} color="bg-red-500" isDarkMode={isDarkMode} />
                            <Card title="רווח נקי" value={formatCurrency(summaryData.totalProfit)} subtext={`${summaryData.profitMargin.toFixed(1)}% אחוז רווח`} icon={Activity} color={summaryData.totalProfit >= 0 ? "bg-emerald-500" : "bg-red-600"} isDarkMode={isDarkMode} />
                        </div>
                        <div className={`p-6 rounded-xl border shadow-sm h-[450px] ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                            <h3 className={`text-lg font-bold mb-6 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><BarChart3 className="w-5 h-5 text-violet-500" />הכנסות מול הוצאות ורווח</h3>
                            <div style={{ width: '100%', height: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={summaryData.chart}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#334155' : '#e2e8f0'} />
                                        <XAxis dataKey="name" stroke="#64748b" />
                                        <YAxis stroke="#64748b" />
                                        <RechartsTooltip formatter={(val) => formatCurrency(val)} contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', color: isDarkMode ? '#fff' : '#000' }} />
                                        <Legend />
                                        <Bar dataKey="income" name="הכנסות" fill="#3b82f6" barSize={20} radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="expenses" name="הוצאות" fill="#ef4444" barSize={20} radius={[4, 4, 0, 0]} />
                                        <Line type="monotone" dataKey="profit" name="רווח נקי" stroke="#10b981" strokeWidth={3} dot={{r:4}} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                 ) : <div className="text-center py-20 text-slate-400">אין נתונים להצגת סיכום. נא לטעון קבצי מכירות וספקים.</div>
            ) : (
            <>
            <div className={`p-4 rounded-xl shadow-sm border flex flex-col lg:flex-row gap-4 items-center ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <div className="flex items-center gap-2 text-slate-500 font-medium text-sm whitespace-nowrap min-w-fit"><Filter className="w-4 h-4" /> סינון:</div>
                {activeTab === 'sales' ? (
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                        <Autocomplete options={uniqueItems.products} value={selectedProduct} onChange={(val) => { setSelectedProduct(val); setSelectedSku(''); }} placeholder="בחר מוצרים..." icon={Box} multiple={true} maxSelections={5} isDarkMode={isDarkMode} />
                        <Autocomplete options={uniqueItems.skus} value={selectedSku} onChange={(val) => { setSelectedSku(val); setSelectedProduct([]); }} placeholder="בחר מק״ט..." icon={Tag} isDarkMode={isDarkMode} />
                    </div>
                ) : (
                    <div className="flex-1 w-full">
                        <Autocomplete options={uniqueItems.suppliers} value={selectedSupplier} onChange={setSelectedSupplier} placeholder="בחר ספק..." icon={Truck} isDarkMode={isDarkMode} />
                    </div>
                )}
                {(selectedProduct.length > 0 || selectedSku || selectedSupplier || searchTerm) && (
                    <button onClick={resetAllFilters} className="px-4 py-2 text-red-600 bg-red-50/10 hover:bg-red-100/20 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
                        נקה סינון
                    </button>
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
                    isDarkMode={isDarkMode}
                />
                <Card title="ממוצע חודשי" value={formatCurrency(stats.avgAmount)} subtext={`לפי ${stats.monthsCount} חודשים`} icon={Activity} color="bg-amber-500" isDarkMode={isDarkMode} />
                <Card title={activeTab === 'sales' ? 'כמות יחידות' : 'כמות שורות רכש'} value={stats.totalQuantity.toLocaleString()} subtext="סה״כ בסינון" icon={Package} color="bg-emerald-500" isDarkMode={isDarkMode} />
                <Card title="ממוצע כמות" value={avgList ? (
                        <div className="flex flex-col gap-1 mt-1 max-h-[80px] overflow-y-auto custom-scrollbar pr-1">
                            {avgList.map(item => (
                                <div key={item.name} className={`flex justify-between text-xs border-b pb-1 ${isDarkMode ? 'border-slate-700' : 'border-slate-50'}`}>
                                    <span className="truncate w-20" title={item.name}>{item.name}</span>
                                    <span className="font-bold">{Math.round(item.quantity / stats.monthsCount)}</span>
                                </div>
                            ))}
                        </div>
                    ) : Math.round(stats.avgQuantity).toLocaleString()} subtext={avgList ? 'פירוט לפי פריט' : 'ממוצע חודשי כללי'} icon={Layers} color="bg-cyan-500" isDarkMode={isDarkMode} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className={`p-6 rounded-xl border shadow-sm min-h-[450px] ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                    <h3 className={`text-lg font-bold mb-6 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><Calendar className="w-5 h-5 text-blue-500" />{activeTab === 'sales' ? 'מכירות לפי חודש' : 'הוצאות לפי חודש'}</h3>
                    <div style={{ width: '100%', height: '400px' }}>
                        {chartData && chartData.monthly.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData.monthly} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#334155' : '#e2e8f0'} />
                                <XAxis dataKey="name" stroke="#64748b" />
                                <YAxis yAxisId="left" stroke="#3b82f6" tickFormatter={(val) => `₪${val/1000}k`} />
                                {activeTab === 'sales' && <YAxis yAxisId="right" orientation="right" stroke="#10b981" />}
                                <RechartsTooltip formatter={(val, name) => name.includes('כמות') ? val : formatCurrency(val)} contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', color: isDarkMode ? '#fff' : '#000' }} />
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
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-400">אין נתונים להצגה</div>
                        )}
                    </div>
                </div>

                <div className={`p-6 rounded-xl border shadow-sm flex flex-col min-h-[450px] ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                    <div className="flex justify-between items-start mb-6">
                        <h3 className={`text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><TrendingUp className="w-5 h-5 text-emerald-500" />{activeTab === 'sales' ? (selectedProduct.length > 0 ? 'התפלגות נבחרים' : 'מוצרים מובילים') : 'ספקים מובילים'}</h3>
                        {activeTab === 'sales' && (
                            <div className={`flex rounded-lg p-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                                <button onClick={() => setPieMetric('total')} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pieMetric === 'total' ? (isDarkMode ? 'bg-slate-600 text-white' : 'bg-white shadow text-blue-700') : 'text-slate-500'}`}>סכום</button>
                                <button onClick={() => setPieMetric('quantity')} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pieMetric === 'quantity' ? (isDarkMode ? 'bg-slate-600 text-white' : 'bg-white shadow text-blue-700') : 'text-slate-500'}`}>כמות</button>
                            </div>
                        )}
                    </div>
                    <div className="h-96 flex items-center justify-center flex-1">
                        {chartData && chartData.pie.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={chartData.pie} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={5} dataKey="value">
                                        {chartData.pie.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                    </Pie>
                                    <RechartsTooltip content={<CustomPieTooltip isDarkMode={isDarkMode} />} />
                                    <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: '11px', maxHeight: '300px', overflowY: 'auto' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <p className="text-slate-400">אין נתונים להצגה</p>}
                    </div>
                </div>
            </div>

            <div className={`rounded-xl border shadow-sm overflow-hidden ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <div className={`p-6 border-b flex flex-col sm:flex-row justify-between items-center gap-4 ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                    <div className="flex items-center gap-3">
                        <h3 className={`text-lg font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}><FileText className="w-5 h-5 text-slate-400" /> פירוט עסקאות</h3>
                        {drillDownMonth && (
                             <span className="flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium animate-in fade-in slide-in-from-left-4">
                                <MousePointerClick className="w-4 h-4" />
                                מסונן לפי: {drillDownMonth}
                                <button onClick={() => setDrillDownMonth(null)} className="hover:bg-blue-200 rounded-full p-0.5 mr-1"><X className="w-3 h-3" /></button>
                             </span>
                        )}
                    </div>
                    <div className="flex gap-3 items-center">
                        <button onClick={handleExport} className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium border ${isDarkMode ? 'bg-emerald-900/20 border-emerald-800 text-emerald-400 hover:bg-emerald-900/40' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'}`}>
                            <Download className="w-4 h-4" /> ייצוא לאקסל
                        </button>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                            <input 
                                type="text" 
                                placeholder="חיפוש בטבלה..." 
                                className={`w-full pl-4 pr-10 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${isDarkMode ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400' : 'bg-slate-50 border-slate-200 text-slate-900'}`} 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className={`w-full text-sm text-right ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                        <thead className={`font-medium ${isDarkMode ? 'bg-slate-900/50 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                            <tr>
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-500" onClick={() => requestSort('date')}>תאריך</th>
                                {activeTab === 'sales' && <th className="px-6 py-3">מק״ט</th>}
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-500" onClick={() => requestSort(activeTab === 'sales' ? 'description' : 'supplier')}>
                                    {activeTab === 'sales' ? 'מוצר' : 'ספק'}
                                </th>
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-500" onClick={() => requestSort('quantity')}>כמות</th>
                                <th className="px-6 py-3 cursor-pointer hover:text-blue-500" onClick={() => requestSort('total')}>סכום</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${isDarkMode ? 'divide-slate-700' : 'divide-slate-100'}`}>
                            {paginatedData.length > 0 ? paginatedData.map((row) => (
                                <tr key={row.id} className={`transition-colors ${isDarkMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50'}`}>
                                    <td className="px-6 py-4 whitespace-nowrap">{row.date}</td>
                                    {activeTab === 'sales' && <td className="px-6 py-4 font-mono text-xs opacity-70">{row.sku}</td>}
                                    <td className={`px-6 py-4 font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{activeTab === 'sales' ? row.description : row.supplier}</td>
                                    <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs font-bold ${isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{row.quantity}</span></td>
                                    <td className={`px-6 py-4 font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{formatCurrency(row.total)}</td>
                                </tr>
                            )) : <tr><td colSpan="5" className="px-6 py-12 text-center opacity-50">לא נמצאו נתונים</td></tr>}
                        </tbody>
                    </table>
                </div>
                <div className={`px-6 py-4 border-t text-xs flex justify-between items-center ${isDarkMode ? 'bg-slate-900/30 border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                    <span>מציג {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredData.length)} מתוך {filteredData.length} רשומות</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-200'} ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}><ChevronRight className="w-4 h-4" /></button>
                        <span>עמוד {currentPage} מתוך {totalPages || 1}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-200'} ${currentPage === totalPages || totalPages === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}><ChevronLeft className="w-4 h-4" /></button>
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
