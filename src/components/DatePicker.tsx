import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { toISODate, toDMY } from '@/lib/format';

const WEEKDAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MONTH_VI = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
  'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
  'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

export function DatePicker({
  value,
  onChange,
  placeholder = 'Chọn ngày…',
}: {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (value) return new Date(value + 'T00:00:00');
    return new Date();
  });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setViewDate(new Date(value + 'T00:00:00'));
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedDate = value ? new Date(value + 'T00:00:00') : null;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const days: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const prevYear = () => setViewDate(new Date(year - 1, month, 1));
  const nextYear = () => setViewDate(new Date(year + 1, month, 1));

  const selectDate = (d: Date) => {
    onChange(toISODate(d));
    setOpen(false);
  };

  const todayISO = toISODate(new Date());

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 cursor-pointer hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-navy-400"
      >
        <Calendar size={16} className="text-navy-400" />
        <span className={value ? '' : 'text-navy-300'}>
          {value ? toDMY(value) : placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 bg-white border border-navy-200 rounded-xl shadow-pop p-3 w-[320px]">
          {/* Header with month/year nav */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <button onClick={prevYear} className="p-1 rounded-md text-navy-400 hover:bg-navy-50 hover:text-navy-700" title="Năm trước">
                <ChevronLeft size={14} />
                <ChevronLeft size={14} className="-ml-2" />
              </button>
              <button onClick={prevMonth} className="p-1 rounded-md text-navy-400 hover:bg-navy-50 hover:text-navy-700" title="Tháng trước">
                <ChevronLeft size={16} />
              </button>
            </div>
            <span className="text-sm font-semibold text-navy-800">
              {MONTH_VI[month]} {year}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={nextMonth} className="p-1 rounded-md text-navy-400 hover:bg-navy-50 hover:text-navy-700" title="Tháng sau">
                <ChevronRight size={16} />
              </button>
              <button onClick={nextYear} className="p-1 rounded-md text-navy-400 hover:bg-navy-50 hover:text-navy-700" title="Năm sau">
                <ChevronRight size={14} />
                <ChevronRight size={14} className="-ml-2" />
              </button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_VI.map((w) => (
              <div key={w} className="text-center text-[10px] font-semibold text-navy-400 py-1">{w}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              if (!d) return <div key={i} />;
              const dISO = toISODate(d);
              const isSelected = selectedDate && dISO === toISODate(selectedDate);
              const isToday = dISO === todayISO;
              const isSaturday = d.getDay() === 6;
              return (
                <button
                  key={i}
                  onClick={() => selectDate(d)}
                  className={`text-center text-xs rounded-md py-1.5 transition-colors ${
                    isSelected
                      ? 'bg-[#E9967A] text-black font-bold'
                      : isToday
                        ? 'bg-navy-100 text-navy-800 font-semibold'
                        : isSaturday
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-navy-700 hover:bg-navy-50'
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 pt-2 border-t border-navy-50 text-center">
            <button
              onClick={() => selectDate(new Date())}
              className="text-xs text-navy-500 hover:text-navy-800 font-medium"
            >
              Hôm nay ({toDMY(todayISO)})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
