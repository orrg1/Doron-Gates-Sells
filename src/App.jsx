import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Upload, TrendingUp, Package, Calendar, DollarSign, Filter, ArrowUpDown, ArrowUp, ArrowDown, X, Tag, Box, ChevronDown, Activity, Layers, Sparkles, Bot, Loader2, FileText, Check, Trash2 } from 'lucide-react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// --- הגדרות API של GEMINI ---
const apiKey = "AIzaSyBliujKxcsP_R_nPl0dVRdffZHa3wCiodA"; // הדבק כאן את המפתח שלך

// --- עזרי תאריך ---
const HebrewMonthsMap = {
  0: 'ינו', 1: 'פבר', 2: 'מרץ', 3: 'אפר', 4: 'מאי', 5: 'יונ',
  6: 'יול', 7: 'אוג', 8: 'ספט', 9: 'אוק', 10: 'נוב', 11: 'דצמ'
};

const HebrewMonthsReverse = {
  'ינו': 1, 'פבר': 2, 'מרץ': 3, 'אפר': 4, 'מאי': 5, 'יונ': 6,
  'יול': 7, 'אוג': 8, 'ספט': 9, 'אוק': 10, 'נוב': 11, 'דצמ': 12
};

// המרת מספר אקסל לתאריך JS
const excelDateToJSDate = (serial) => {
   // Excel base date correction
   const utc_days  = Math.floor(serial - 25569);
   const utc_value = utc_days * 86400;                                        
   const date_info = new Date(utc_value * 1000);
   return date_info;
}

// פונקציה שמפרמטת כל סוג תאריך לפורמט האחיד "יול-25"
const normalizeDate = (val) => {
  if (!val) return '';
  
  // אם זה כבר בפורמט הנכון (טקסט עם מקף)
  if (typeof val === 'string' && val.includes('-') && isNaN(parseFloat(val))) {
    return val; 
  }

  let dateObj = null;

  // בדיקה אם זה מספר אקסל
  const numericVal = parseFloat(val);
  if (!isNaN(numericVal) && numericVal > 30000 && numericVal < 60000) {
    dateObj = excelDateToJSDate(numericVal);
  } else {
    // נסיון המרה סטנדרטי
    dateObj = new Date(val);
  }

  if (dateObj && !isNaN(dateObj.getTime())) {
    const month = HebrewMonthsMap[dateObj.getMonth()];
    const year = dateObj.getFullYear().toString().slice(-2);
    return `${month}-${year}`;
  }

  return val.toString(); // החזרת המקור אם נכשל
};

// פונקציית עזר לניתוח שורה בודדת ב-CSV
const parseCSVLine = (line) => {
  const row = [];
  let currentVal = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
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

// פונקציית ניתוח CSV חכמה
const parseCSV = (text) => {
  const lines = text.split('\n');
  
  // 1. חיפוש שורת הכותרות
  let headerRowIndex = -1;
  let headers = [];

  const knownHeaders = ['תאריך', 'חודש', 'מקט', 'מק"ט', "מק'ט", 'תיאור', 'תאור', 'כמות', 'סכום', 'הכנסה', 'מחיר', 'יחידה', "יח'"];

  // סריקת 30 השורות הראשונות למציאת הכותרות
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (!knownHeaders.some(k => line.includes(k))) continue;

    const parsedLine = parseCSVLine(line);
    const cleanLine = parsedLine.map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    
    const matchCount = cleanLine.filter(cell => 
      knownHeaders.some(k => cell.includes(k))
    ).length;

    if (matchCount >= 2) {
      headerRowIndex = i;
      headers = cleanLine;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // Fallback
    const firstNonEmpty = lines.findIndex(l => l.trim());
    if (firstNonEmpty === -1) return [];
    headerRowIndex = firstNonEmpty;
    headers = parseCSVLine(lines[firstNonEmpty]).map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  }

  // 2. ניתוח הנתונים
  const result = [];
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCSVLine(line);
    const row = {};
    let hasData = false;

    headers.forEach((header, index) => {
      if (!header) return; // דילוג על עמודות ריקות
      
      if (index < values.length) {
        const val = values[index];
        row[header] = val;
        if (val && val.trim()) hasData = true;
      }
    });

    if (hasData) result.push(row);
  }
  
  return result;
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#84cc16', '#f43f5e', '#06b6d4'];

const Card = ({ title, value, subtext, icon: Icon, color }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition-shadow h-full">
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
    </div>
    <div className={`p-3 rounded-full ${color} shrink-0 ml-4 self-start`}>
      <Icon className="w-6 h-6 text-white" />
    </div>
  </div>
);

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
    return { 
      m: HebrewMonthsReverse[parts[0]] || 1, 
      y: parseInt(parts[1]) + 2000 
    };
  };

  const start = parseDate(startStr);
  const end = parseDate(endStr);

  return ((end.y - start.y) * 12) + (end.m - start.m) + 1;
};

// רכיב Tooltip מותאם אישית לגרף העוגה
const CustomPieTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const formatCurrency = (val) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
    
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-right z-50">
        <p className="font-bold text-slate-800 mb-2 border-b border-slate-100 pb-1">{data.name}</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">כמות:</span>
            <span className="font-medium text-blue-600">{data.quantity}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">סכום:</span>
            <span className="font-medium text-emerald-600">{formatCurrency(data.revenue)}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

// רכיב השלמה אוטומטית
const Autocomplete = ({ options, value, onChange, placeholder, icon: Icon, multiple = false, maxSelections = Infinity }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!multiple) {
        setSearchTerm(value || '');
    }
  }, [value, multiple]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        if (!multiple) {
            if (!value) setSearchTerm('');
            else setSearchTerm(value);
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
    return options.filter(opt => 
      opt.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [options, searchTerm]);

  const handleSelect = (opt) => {
    if (multiple) {
      if (value.includes(opt)) {
        onChange(value.filter(v => v !== opt));
      } else {
        if (value.length < maxSelections) {
          onChange([...value, opt]);
        }
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
            onClick={(e) => { 
                e.stopPropagation();
                setSearchTerm(''); 
                onChange(multiple ? [] : ''); 
                if (!multiple) setIsOpen(false);
            }}
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
            filteredOptions.map((opt, idx) => {
              const isSelected = multiple ? value.includes(opt) : value === opt;
              return (
                <div
                  key={idx}
                  className={`px-4 py-2 cursor-pointer text-sm transition-colors flex items-center justify-between ${
                    isSelected ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => handleSelect(opt)}
                >
                  <span>{opt}</span>
                  {isSelected && <Check className="w-4 h-4 text-blue-600" />}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-3 text-sm text-slate-400 text-center">
              לא נמצאו תוצאות
            </div>
          )}
        </div>
      )}
      {isLimitReached && isOpen && (
         <div className="absolute z-50 w-full mt-1 bg-orange-50 border border-orange-200 text-orange-800 rounded-lg shadow-lg p-2 text-xs text-center">
           הגעת למגבלת 5 מוצרים. הסר מוצר כדי להוסיף חדש.
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

const App = () => {
  // טעינה מ-localStorage
  const [rawData, setRawData] = useState(() => {
    const savedData = localStorage.getItem('dashboardData');
    return savedData ? JSON.parse(savedData) : [];
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [loading, setLoading] = useState(false);
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');

  const [availableDates, setAvailableDates] = useState([]);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });

  const [selectedProduct, setSelectedProduct] = useState([]); 
  const [selectedSku, setSelectedSku] = useState(''); 
  
  const [pieMetric, setPieMetric] = useState('quantity'); 

  // אפקט מרכזי: שומר ב-localStorage ומחשב תאריכים
  useEffect(() => {
    if (rawData.length > 0) {
        localStorage.setItem('dashboardData', JSON.stringify(rawData));
        
        const dates = [...new Set(rawData.map(d => d.date).filter(Boolean))];
        const sortedDates = dates.sort((a, b) => getComparableDateValue(a) - getComparableDateValue(b));
        setAvailableDates(sortedDates);
        
        // אתחול טווח תאריכים רק אם לא נבחר כלום ורק בטעינה הראשונית של הנתונים
        if (sortedDates.length > 0 && (!dateFilter.start || !dateFilter.end)) {
            setDateFilter({ start: sortedDates[0], end: sortedDates[sortedDates.length - 1] });
        }
    }
  }, [rawData]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setXlsxLoaded(true);
    document.body.appendChild(script);
    if (window.XLSX) setXlsxLoaded(true);
  }, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);

    if (file.name.match(/\.xlsx?$/) && xlsxLoaded) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target.result;
        try {
          const workbook = window.XLSX.read(data, { type: 'binary' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = window.XLSX.utils.sheet_to_json(worksheet, { defval: "" });
          processData(jsonData, true); 
        } catch (error) {
          console.error("Error parsing Excel file", error);
          alert("שגיאה בקריאת קובץ האקסל");
        }
        setLoading(false);
      };
      reader.readAsBinaryString(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const parsed = parseCSV(text);
        processData(parsed, true); 
        setLoading(false);
      };
      reader.readAsText(file);
    }
  };

  const processData = (parsedRows, shouldAppend = false) => {
    const cleanData = parsedRows.map((row, index) => {
      const rawTotal = 
        row['סה"כ סכום'] || 
        row['סה""כ סכום'] || 
        row['סה״כ סכום'] || 
        row['הכנסה בשקלים'] || 
        row['הכנסה'] ||
        row['סה"כ'] || 
        '0';
      
      const total = parseFloat(rawTotal.toString().replace(/[^\d.-]/g, ''));
      const quantity = parseFloat(row['כמות'] || '0');

      const date = row['תאריך'] || row['חודש']; 
      const sku = row['מקט מוצר'] || row['מק\'ט'] || row['מקט'];
      const description = row['תיאור מוצר'] || row['תאור מוצר'] || row['תיאור'];

      const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}`;

      return {
        id: uniqueId,
        date: date,
        sku: sku,
        description: description,
        quantity: isNaN(quantity) ? 0 : quantity,
        total: isNaN(total) ? 0 : total,
        unit: row['יחידה'] || row['יח\'']
      };
    }).filter(item => item.description);
    
    setRawData(prev => shouldAppend ? [...prev, ...cleanData] : cleanData);
  };

  const clearData = () => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק את כל הנתונים?")) {
        setRawData([]);
        setAvailableDates([]);
        setDateFilter({ start: '', end: '' });
        setSelectedProduct([]);
        setSelectedSku('');
        localStorage.removeItem('dashboardData');
    }
  };

  const uniqueProducts = useMemo(() => {
    return [...new Set(rawData.map(item => item.description).filter(Boolean))].sort();
  }, [rawData]);

  const uniqueSkus = useMemo(() => {
    return [...new Set(rawData.map(item => item.sku).filter(Boolean))].sort();
  }, [rawData]);

  const { filteredData, stats, monthlyData, topProducts } = useMemo(() => {
    let data = rawData;

    const currentStart = dateFilter.start || availableDates[0];
    const currentEnd = dateFilter.end || availableDates[availableDates.length - 1];
    
    if (dateFilter.start && dateFilter.end) {
      const startVal = getComparableDateValue(dateFilter.start);
      const endVal = getComparableDateValue(dateFilter.end);
      data = data.filter(item => {
        const itemVal = getComparableDateValue(item.date);
        return itemVal >= startVal && itemVal <= endVal;
      });
    }

    if (selectedProduct.length > 0) {
      data = data.filter(item => selectedProduct.includes(item.description));
    }

    if (selectedSku) {
      data = data.filter(item => item.sku === selectedSku);
    }

    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      data = data.filter(item => 
        (item.description && item.description.toLowerCase().includes(lowerTerm)) ||
        (item.sku && item.sku.toLowerCase().includes(lowerTerm))
      );
    }

    // Sort for table
    data = [...data].sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];
      if (sortConfig.key === 'date') {
        valA = getComparableDateValue(a.date);
        valB = getComparableDateValue(b.date);
      }
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    const totalRevenue = data.reduce((acc, curr) => acc + curr.total, 0);
    const totalQuantity = data.reduce((acc, curr) => acc + curr.quantity, 0);
    const uniqueProductsCount = new Set(data.map(item => item.sku)).size;
    
    const monthsCount = getMonthsDifference(currentStart, currentEnd);
    const avgRevenue = monthsCount > 0 ? totalRevenue / monthsCount : 0;
    const avgQuantity = monthsCount > 0 ? totalQuantity / monthsCount : 0;

    // הכנת נתונים לגרף החודשי
    const monthsMap = {};
    
    data.forEach(item => {
      if (!item.date) return;
      const [monthStr] = item.date.split('-');
      if (!monthsMap[monthStr]) {
        monthsMap[monthStr] = { sales: 0, quantity: 0 };
      }
      monthsMap[monthStr].sales += item.total;
      monthsMap[monthStr].quantity += item.quantity;

      if (selectedProduct.length > 0) {
        if (!monthsMap[monthStr][item.description]) {
            monthsMap[monthStr][item.description] = 0;
        }
        monthsMap[monthStr][item.description] += item.total;

        const quantityKey = `${item.description}_quantity`;
        if (!monthsMap[monthStr][quantityKey]) {
            monthsMap[monthStr][quantityKey] = 0;
        }
        monthsMap[monthStr][quantityKey] += item.quantity;
      }
    });
    
    const monthlyChartData = Object.keys(monthsMap).map(key => {
        const monthEntry = {
            name: key,
            sales: monthsMap[key].sales,
            quantity: monthsMap[key].quantity,
            order: HebrewMonthsReverse[key] || 99
        };
        
        if (selectedProduct.length > 0) {
            selectedProduct.forEach(prod => {
                monthEntry[prod] = monthsMap[key][prod] || 0;
                monthEntry[`${prod}_quantity`] = monthsMap[key][`${prod}_quantity`] || 0;
            });
        }
        
        return monthEntry;
    }).sort((a, b) => a.order - b.order);

    const productMap = {};
    data.forEach(item => {
      if (!productMap[item.description]) productMap[item.description] = { revenue: 0, quantity: 0 };
      productMap[item.description].revenue += item.total;
      productMap[item.description].quantity += item.quantity;
    });

    let chartData = Object.keys(productMap)
      .map(key => ({
        name: key,
        revenue: productMap[key].revenue,
        quantity: productMap[key].quantity,
        value: pieMetric === 'quantity' ? productMap[key].quantity : productMap[key].revenue
      }));

    if (selectedProduct.length === 0) {
      chartData = chartData.sort((a, b) => b.value - a.value).slice(0, 5);
    } else {
      chartData = chartData.sort((a, b) => b.value - a.value);
    }

    return {
      filteredData: data,
      stats: { totalRevenue, totalQuantity, uniqueProducts: uniqueProductsCount, avgRevenue, avgQuantity, monthsCount },
      monthlyData: monthlyChartData,
      topProducts: chartData
    };
  }, [rawData, searchTerm, sortConfig, dateFilter, selectedProduct, selectedSku, availableDates, pieMetric]);

  const generateAIInsight = async () => {
    setAiModalOpen(true);
    setAiLoading(true);
    setAiReport('');

    const promptData = {
      totalRevenue: formatCurrency(stats.totalRevenue),
      totalQuantity: stats.totalQuantity,
      avgRevenue: formatCurrency(stats.avgRevenue),
      months: monthlyData.map(m => `${m.name}: ${formatCurrency(m.sales)} (${m.quantity} units)`).join(', '),
      topProducts: topProducts.map(p => `${p.name}: ${formatCurrency(p.revenue)}`).join(', '),
      filterContext: selectedProduct.length > 0 
        ? `מוצרים נבחרים: ${selectedProduct.join(', ')}` 
        : 'כל המוצרים'
    };

    const promptText = `
    פעל כאנליסט מכירות בכיר. נתח את הנתונים הבאים והפק דוח מנהלים קצר ותמציתי בעברית.
    
    הקשר הנתונים:
    ${promptData.filterContext}
    
    מדדים מרכזיים:
    - סה"כ הכנסות: ${promptData.totalRevenue}
    - כמות יחידות שנמכרה: ${promptData.totalQuantity}
    - ממוצע הכנסה חודשי: ${promptData.avgRevenue}
    
    נתונים חודשיים:
    ${promptData.months}
    
    מוצרים מובילים:
    ${promptData.topProducts}
    
    הדוח צריך לכלול:
    1. סיכום ביצועים כללי (חיובי/שלילי).
    2. זיהוי מגמות בולטות בגרף החודשי.
    3. תובנה לגבי המוצרים המובילים.
    4. המלצה עסקית אחת לפעולה מיידית.
    
    עצב את התשובה עם כותרות ורשימה ממוספרת לתוכן ברור וקריא.
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
      });

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "שגיאה בקבלת תשובה מה-AI.";
      setAiReport(text);
    } catch (error) {
      console.error("AI Error:", error);
      setAiReport("אירעה שגיאה בתקשורת עם השרת. אנא נסה שוב מאוחר יותר.");
    } finally {
      setAiLoading(false);
    }
  };

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(val);
  };

  const resetAllFilters = () => {
     if (availableDates.length > 0) {
        setDateFilter({ start: availableDates[0], end: availableDates[availableDates.length - 1] });
     }
     setSearchTerm('');
     setSelectedProduct([]); 
     setSelectedSku('');
  };

  const avgQuantityContent = selectedProduct.length > 0 ? (
    <div className="flex flex-col gap-2 text-sm mt-1 max-h-[110px] overflow-y-auto custom-scrollbar pr-1">
      {topProducts.map(p => (
        <div key={p.name} className="bg-slate-50 p-2 rounded border border-slate-100 hover:bg-white hover:shadow-sm transition-all">
          <div className="text-xs text-slate-700 font-medium mb-1 leading-snug">{p.name}</div>
          <div className="flex justify-between items-center">
             <span className="text-[10px] text-slate-500">ממוצע חודשי:</span>
             <span className="font-bold text-slate-800 text-sm">{Math.round(p.quantity / stats.monthsCount)}</span>
          </div>
        </div>
      ))}
    </div>
  ) : Math.round(stats.avgQuantity).toLocaleString();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans" dir="rtl">
      
      <AIReportModal isOpen={aiModalOpen} onClose={() => setAiModalOpen(false)} isLoading={aiLoading} report={aiReport} />

      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="bg-blue-600 p-2 rounded-lg">
              <TrendingUp className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">דשבורד מכירות ומלאי</h1>
              <p className="text-xs text-slate-500">ניתוח נתונים בזמן אמת</p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
             <button onClick={generateAIInsight} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 text-sm font-bold whitespace-nowrap">
               <Sparkles className="w-4 h-4 text-yellow-300" />
               <span>צור דוח תובנות AI</span>
             </button>
             <div className="w-px h-6 bg-slate-200 hidden sm:block mx-1"></div>
             
             {/* Clear Button */}
             {rawData.length > 0 && (
                <button onClick={clearData} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="נקה הכל">
                    <Trash2 className="w-5 h-5" />
                </button>
             )}

             {availableDates.length > 0 && (
               <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-sm">
                 <span className="px-2 text-slate-500 text-xs font-bold">תקופה:</span>
                 <select value={dateFilter.start} onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="bg-transparent border-none focus:ring-0 py-1 pr-1 pl-2 text-slate-700 font-medium cursor-pointer">
                   {availableDates.map(date => <option key={`start-${date}`} value={date}>{date}</option>)}
                 </select>
                 <div className="w-px h-4 bg-slate-300 mx-1"></div>
                 <span className="px-2 text-slate-500 text-xs font-bold">עד:</span>
                 <select value={dateFilter.end} onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="bg-transparent border-none focus:ring-0 py-1 pr-1 pl-2 text-slate-700 font-medium cursor-pointer">
                   {availableDates.map(date => <option key={`end-${date}`} value={date}>{date}</option>)}
                 </select>
               </div>
             )}
             <label className={`flex items-center gap-2 px-4 py-2 ${loading ? 'bg-slate-200 cursor-not-allowed' : 'bg-blue-50 hover:bg-blue-100'} text-blue-700 border border-blue-200 rounded-lg cursor-pointer transition-colors text-sm font-medium whitespace-nowrap`}>
              {loading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div> : <Upload className="w-4 h-4" />}
              <span>{loading ? 'טוען...' : 'טען קובץ'}</span>
              <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" disabled={loading} />
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Advanced Filters Bar */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
          <div className="flex items-center gap-2 text-slate-500 font-medium text-sm whitespace-nowrap">
            <Filter className="w-4 h-4" />
            סינון מתקדם:
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            {/* Product Filter Multi-Select */}
            <Autocomplete 
              options={uniqueProducts}
              value={selectedProduct}
              onChange={(val) => { setSelectedProduct(val); setSelectedSku(''); }}
              placeholder="חפש ובחר מוצרים..."
              icon={Box}
              multiple={true}
              maxSelections={5}
            />

            {/* SKU Filter Single-Select */}
            <Autocomplete 
              options={uniqueSkus}
              value={selectedSku}
              onChange={(val) => { setSelectedSku(val); setSelectedProduct([]); }}
              placeholder="חפש ובחר מק״ט..."
              icon={Tag}
            />
          </div>

          {(selectedProduct.length > 0 || selectedSku || searchTerm) && (
            <button 
              onClick={resetAllFilters}
              className="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              נקה סינון
            </button>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <Card 
            title="סה״כ הכנסות" 
            value={formatCurrency(stats.totalRevenue)} 
            subtext={selectedProduct.length > 0 ? 'עבור המוצרים שנבחרו' : selectedSku ? 'עבור המק״ט הנבחר' : `סה״כ בתקופה הנבחרת`}
            icon={DollarSign}
            color="bg-blue-500"
          />
          <Card 
            title="ממוצע הכנסה חודשי" 
            value={formatCurrency(stats.avgRevenue)} 
            subtext={`לפי ${stats.monthsCount} חודשים בטווח`}
            icon={Activity}
            color="bg-amber-500"
          />
          <Card 
            title="סה״כ פריטים" 
            value={stats.totalQuantity.toLocaleString()} 
            subtext="יחידות סה״כ בסינון הנוכחי"
            icon={Package}
            color="bg-emerald-500"
          />
          
          <Card 
            title="ממוצע כמות חודשי" 
            value={avgQuantityContent} 
            subtext={selectedProduct.length > 0 ? "פירוט ממוצע ליחידה לחודש" : "יחידות בממוצע לחודש"} 
            icon={Layers} 
            color="bg-cyan-500" 
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Sales & Quantity Chart */}
          <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              מכירות וכמות לפי חודש
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                {/* שימוש ב-ComposedChart כדי לשלב עמודות וקו */}
                <ComposedChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" />
                  
                  {/* ציר שמאלי - כסף (עמודות) */}
                  <YAxis yAxisId="left" stroke="#3b82f6" tickFormatter={(val) => `₪${val/1000}k`} />
                  
                  {/* ציר ימני - כמות (קו) */}
                  <YAxis yAxisId="right" orientation="right" stroke="#10b981" />
                  
                  <RechartsTooltip 
                    formatter={(value, name) => {
                      if (name.includes('כמות')) return value.toLocaleString();
                      return formatCurrency(value);
                    }}
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />

                  {/* אם יש מוצרים נבחרים - נציג עמודה נפרדת לכל מוצר (Stacked) */}
                  {selectedProduct.length > 0 ? (
                    <>
                        {/* עמודות הכנסה */}
                        {selectedProduct.map((prod, index) => (
                          <Bar 
                            key={prod}
                            yAxisId="left" 
                            dataKey={prod} // שם המוצר הוא המפתח
                            name={prod} 
                            stackId="a" // אותו ID גורם להם להערם זה על זה
                            fill={COLORS[index % COLORS.length]} 
                            radius={index === selectedProduct.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                          />
                        ))}
                        
                        {/* קווי כמות - קו לכל מוצר */}
                        {selectedProduct.map((prod, index) => (
                          <Line 
                            key={`${prod}_quantity`}
                            yAxisId="right" 
                            type="monotone" 
                            dataKey={`${prod}_quantity`} 
                            name={`${prod} (כמות)`} 
                            stroke={COLORS[index % COLORS.length]} 
                            strokeWidth={2}
                            strokeDasharray="5 5" // קו מקווקו להבדלה
                            dot={{ r: 3, fill: COLORS[index % COLORS.length] }}
                          />
                        ))}
                    </>
                  ) : (
                    <>
                        {/* ברירת מחדל - עמודה אחת לסה"כ מכירות וקו אחד לסה"כ כמות */}
                        <Bar yAxisId="left" dataKey="sales" name="מכירות (₪)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Line 
                            yAxisId="right" 
                            type="monotone" 
                            dataKey="quantity" 
                            name="סה״כ כמות (יח')" 
                            stroke="#10b981" 
                            strokeWidth={3}
                            dot={{ r: 4, fill: "#10b981" }}
                        />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Products Pie Chart */}
          <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex flex-col">
            <div className="flex justify-between items-start mb-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    {selectedProduct.length > 0 ? 'התפלגות מוצרים נבחרים' : '5 המוצרים המובילים'}
                </h3>
                
                {/* Toggle Buttons for Pie Chart */}
                <div className="flex bg-slate-100 rounded-lg p-1">
                    <button 
                        onClick={() => setPieMetric('revenue')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pieMetric === 'revenue' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        לפי סכום
                    </button>
                    <button 
                        onClick={() => setPieMetric('quantity')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pieMetric === 'quantity' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        לפי כמות
                    </button>
                </div>
            </div>

            <div className="h-64 flex items-center justify-center flex-1">
              {topProducts.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                        data={topProducts} 
                        cx="50%" 
                        cy="50%" 
                        innerRadius={60} 
                        outerRadius={80} 
                        paddingAngle={5} 
                        dataKey="value"
                    >
                      {topProducts.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    {/* שימוש ב-Tooltip המותאם אישית */}
                    <RechartsTooltip content={<CustomPieTooltip />} />
                    <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-400">אין נתונים להצגה בטווח הנבחר</p>
              )}
            </div>
          </div>
        </div>

        {/* Data Table Section */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">פירוט עסקאות</h3>
              {filteredData.length < rawData.length && (
                <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full font-medium">
                  מציג נתונים מסוננים
                </span>
              )}
            </div>
            
            <div className="relative w-full sm:w-72">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="חיפוש חופשי בטבלה..." 
                className="w-full pl-4 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-500 font-medium">
                <tr>
                  <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('date')}>
                    <div className="flex items-center gap-1">
                      תאריך
                      {sortConfig.key === 'date' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
                    </div>
                  </th>
                  <th className="px-6 py-3">מק״ט</th>
                  <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('description')}>
                    <div className="flex items-center gap-1">
                      תיאור מוצר
                      {sortConfig.key === 'description' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
                    </div>
                  </th>
                  <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('quantity')}>
                     <div className="flex items-center gap-1">
                      כמות
                      {sortConfig.key === 'quantity' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
                    </div>
                  </th>
                  <th className="px-6 py-3 cursor-pointer hover:text-blue-600" onClick={() => requestSort('total')}>
                     <div className="flex items-center gap-1">
                      סה״כ סכום
                      {sortConfig.key === 'total' && (sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredData.length > 0 ? (
                  filteredData.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{row.date}</td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">{row.sku}</td>
                      <td className="px-6 py-4 font-medium text-slate-800">{row.description}</td>
                      <td className="px-6 py-4 text-slate-600">
                        <span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold">
                          {row.quantity} {row.unit}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-800">{formatCurrency(row.total)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center text-slate-400">
                      לא נמצאו נתונים התואמים לטווח התאריכים או לחיפוש
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
            <span>מציג {filteredData.length} מתוך {rawData.length} רשומות</span>
            <span>סודר לפי: {sortConfig.key === 'total' ? 'סכום' : sortConfig.key === 'quantity' ? 'כמות' : sortConfig.key === 'date' ? 'תאריך' : 'תיאור'}</span>
          </div>
        </div>

      </main>
    </div>
  );
};

export default App;
