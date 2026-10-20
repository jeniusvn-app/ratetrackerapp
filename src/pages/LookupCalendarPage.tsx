import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthContext';
import { useRoomTypes } from '@/lib/useRoomTypes';
import type { DailyRate, Hotel, RoomType } from '@/types';
import { formatVND, toISODate, toDMY, dateRangeISO } from '@/lib/format';
import { Button, Select, Card, Field, EmptyState, Badge } from '@/components/ui';
import { ExportModal } from '@/components/ExportModal';

type View = 'calendar' | 'table';

interface DayCell {
  date: string;
  roomType: string | null;
  rateCode: string | null;
  selling: number | null;
  net: number | null;
  b2b: number | null;
}

export function LookupCalendarPage() {
  const { hotels } = useAuth();
  const [hotelId, setHotelId] = useState<string>('');
  const [roomTypeId, setRoomTypeId] = useState<string>('all');
  const [view, setView] = useState<View>('calendar');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [rates, setRates] = useState<DailyRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const { roomTypes } = useRoomTypes(hotelId || null);

  useEffect(() => {
    if (hotels.length && !hotelId) setHotelId(hotels[0].id);
  }, [hotels, hotelId]);

  useEffect(() => {
    setRoomTypeId('all');
  }, [hotelId]);

  const monthStart = toISODate(new Date(month.getFullYear(), month.getMonth(), 1));
  const monthEnd = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  const loadRates = useCallback(async () => {
    if (!hotelId) return setRates([]);
    setLoading(true);
    const { data, error } = await supabase
      .from('daily_rates')
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('date', monthStart)
      .lte('date', monthEnd);
    if (!error) setRates((data as DailyRate[]) || []);
    setLoading(false);
  }, [hotelId, monthStart, monthEnd]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  // Re-fetch when Page 4 (or Page 3 approval) bumps the daily_rates version.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'rt_daily_rates_version') loadRates();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadRates]);

  // Build map: date -> rate_code -> DailyRate, filtered by room type
  const ratesByDate = useMemo(() => {
    const map = new Map<string, DailyRate[]>();
    for (const r of rates) {
      if (roomTypeId !== 'all' && r.room_type_id !== roomTypeId) continue;
      const arr = map.get(r.date) || [];
      arr.push(r);
      map.set(r.date, arr);
    }
    return map;
  }, [rates, roomTypeId]);

  const rtById = useMemo(() => {
    const m = new Map<string, RoomType>();
    roomTypes.forEach((rt) => m.set(rt.id, rt));
    return m;
  }, [roomTypes]);

  // For each day, pick cell: if a single room type selected, use its rates (first rate_code per day);
  // if "All", pick the lowest selling price across all room types per day.
  const cellForDate = useCallback(
    (dateISO: string): DayCell => {
      const arr = ratesByDate.get(dateISO) || [];
      if (arr.length === 0)
        return { date: dateISO, roomType: null, rateCode: null, selling: null, net: null, b2b: null };
      let pick: DailyRate | null = null;
      if (roomTypeId === 'all') {
        // lowest selling price — B2B price is NEVER considered in this benchmark
        pick = arr.reduce((best, r) => {
          if (!best) return r;
          return Number(r.selling_price) < Number(best.selling_price) ? r : best;
        }, null as DailyRate | null);
      } else {
        pick = arr[0];
      }
      if (!pick)
        return { date: dateISO, roomType: null, rateCode: null, selling: null, net: null, b2b: null };
      return {
        date: dateISO,
        roomType: rtById.get(pick.room_type_id)?.name || null,
        rateCode: pick.rate_code,
        selling: Number(pick.selling_price),
        net: Number(pick.net_price),
        b2b: pick.b2b_price != null ? Number(pick.b2b_price) : null,
      };
    },
    [ratesByDate, roomTypeId, rtById],
  );

  // Calendar grid (week starts Monday)
  const gridDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDay = (first.getDay() + 6) % 7; // 0 = Monday
    const start = new Date(first);
    start.setDate(first.getDate() - startDay);
    const days: { iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({ iso: toISODate(d), inMonth: d.getMonth() === month.getMonth() });
    }
    return days;
  }, [month]);

  const hotelName = useMemo(
    () => hotels.find((h) => h.id === hotelId)?.name || '',
    [hotels, hotelId],
  );

  // Export rows (Page 1 structure)
  const exportRows = useMemo(() => {
    const rows: Record<string, string | number>[] = [];
    const range = dateRangeISO(monthStart, monthEnd);
    for (const date of range) {
      const arr = ratesByDate.get(date) || [];
      const filtered = roomTypeId === 'all' ? arr : arr.filter((r) => r.room_type_id === roomTypeId);
      if (filtered.length === 0) {
        rows.push({
          date: toDMY(date),
          room_type: '',
          rate_code: '',
          selling_price: '',
          net_price: '',
          b2b_price: '',
        });
      } else {
        for (const r of filtered) {
          rows.push({
            date: toDMY(r.date),
            room_type: rtById.get(r.room_type_id)?.name || '',
            rate_code: r.rate_code,
            selling_price: formatVND(Number(r.selling_price)),
            net_price: formatVND(Number(r.net_price)),
            b2b_price: r.b2b_price != null ? formatVND(Number(r.b2b_price)) : '',
          });
        }
      }
    }
    return rows;
  }, [ratesByDate, roomTypeId, rtById, monthStart, monthEnd]);

  // Table view rows
  const tableRows = useMemo(() => {
    const rows: {
      date: string;
      roomType: string;
      rateCode: string;
      selling: number | null;
      net: number | null;
      b2b: number | null;
    }[] = [];
    const range = dateRangeISO(monthStart, monthEnd);
    for (const date of range) {
      const arr = ratesByDate.get(date) || [];
      const filtered = roomTypeId === 'all' ? arr : arr.filter((r) => r.room_type_id === roomTypeId);
      if (filtered.length === 0) {
        rows.push({ date, roomType: '', rateCode: '', selling: null, net: null, b2b: null });
      } else if (roomTypeId === 'all') {
        const c = cellForDate(date);
        rows.push({
          date,
          roomType: c.roomType || '',
          rateCode: c.rateCode || '',
          selling: c.selling,
          net: c.net,
          b2b: c.b2b,
        });
      } else {
        for (const r of filtered) {
          rows.push({
            date: r.date,
            roomType: rtById.get(r.room_type_id)?.name || '',
            rateCode: r.rate_code,
            selling: Number(r.selling_price),
            net: Number(r.net_price),
            b2b: r.b2b_price != null ? Number(r.b2b_price) : null,
          });
        }
      }
    }
    return rows;
  }, [ratesByDate, roomTypeId, rtById, monthStart, monthEnd, cellForDate]);

  const weekDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  const fmtMonth = `${month.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}`;

  return (
    <div className="space-y-4 fade-in">
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Khách sạn">
            <Select value={hotelId} onChange={setHotelId} disabled={!hotels.length}>
              {hotels.length === 0 && <option value="">— Không có khách sạn —</option>}
              {hotels.map((h: Hotel) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Loại phòng">
            <Select value={roomTypeId} onChange={setRoomTypeId}>
              <option value="all">Tất cả loại phòng</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hiển thị">
            <div className="flex bg-navy-50 rounded-lg p-1 border border-navy-100">
              <button
                onClick={() => setView('calendar')}
                className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
                  view === 'calendar' ? 'bg-white text-navy-800 shadow-sm font-semibold' : 'text-navy-500'
                }`}
              >
                Lịch
              </button>
              <button
                onClick={() => setView('table')}
                className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
                  view === 'table' ? 'bg-white text-navy-800 shadow-sm font-semibold' : 'text-navy-500'
                }`}
              >
                Bảng
              </button>
            </div>
          </Field>
          <div className="flex items-end">
            <Button variant="gold" className="w-full" onClick={() => setExportOpen(true)}>
              Xuất dữ liệu
            </Button>
          </div>
        </div>
      </Card>

      {view === 'calendar' ? (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              Tháng trước
            </Button>
            <h2 className="text-base font-semibold text-navy-800 capitalize">{fmtMonth}</h2>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              Tháng sau
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {weekDays.map((w, i) => (
              <div
                key={w}
                className={`text-center text-xs font-semibold py-1.5 uppercase ${
                  i === 5 ? 'text-amber-700' : 'text-navy-500'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {gridDays.map(({ iso, inMonth }) => {
              const cell = cellForDate(iso);
              const dayNum = new Date(iso + 'T00:00:00').getDate();
              const isToday = iso === toISODate(new Date());
              const dow = new Date(iso + 'T00:00:00').getDay(); // 0=Sun, 6=Sat
              const isSaturday = dow === 6;
              return (
                <div
                  key={iso}
                  className={`min-h-[96px] sm:min-h-[112px] rounded-lg border p-1.5 flex flex-col ${
                    inMonth
                      ? isSaturday
                        ? 'bg-amber-50/60 border-amber-100'
                        : 'bg-white border-navy-100'
                      : isSaturday
                        ? 'bg-amber-50/30 border-amber-50'
                        : 'bg-navy-50/40 border-navy-50'
                  } ${isToday ? 'ring-2 ring-gold-500' : ''}`}
                >
                  <div
                    className={`text-[11px] font-semibold mb-1 ${
                      inMonth ? (isSaturday ? 'text-amber-700' : 'text-navy-700') : 'text-navy-300'
                    }`}
                  >
                    {dayNum}
                  </div>
                  {cell.selling !== null ? (
                    <div className="space-y-0.5 flex-1">
                      <div className="mono-num text-xs sm:text-sm font-semibold text-navy-800 leading-tight">
                        {formatVND(cell.selling)}
                      </div>
                      <div className="mono-num text-[10px] sm:text-[11px] text-navy-500 leading-tight">
                        {formatVND(cell.net)}
                      </div>
                      <div className="mono-num text-[10px] sm:text-[11px] text-gold-600 leading-tight">
                        {cell.b2b !== null ? formatVND(cell.b2b) : '—'}
                      </div>
                      {roomTypeId === 'all' && cell.roomType && (
                        <div className="text-[9px] sm:text-[10px] text-navy-400 truncate mt-0.5">
                          {cell.roomType}
                        </div>
                      )}
                      {cell.rateCode && (
                        <div className="mt-0.5">
                          <Badge tone="neutral">{cell.rateCode}</Badge>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-navy-300 flex-1">—</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-navy-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-gold-500" /> Hôm nay
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm bg-amber-50 border border-amber-100" /> Thứ 7
            </span>
            <span>
              <span className="font-semibold">Dòng 1:</span> Giá bán ·{' '}
              <span className="font-semibold">Dòng 2:</span> Giá net ·{' '}
              <span className="font-semibold text-gold-600">Dòng 3:</span> Giá B2B
            </span>
            {roomTypeId === 'all' && (
              <span>Hiển thị giá bán thấp nhất mỗi ngày (tất cả loại phòng) — không tính giá B2B</span>
            )}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="bg-navy-100 text-navy-700">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold w-32">Ngày</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Loại phòng</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Rate code</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Giá bán</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Giá net</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Giá B2B</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState message="Không có dữ liệu giá trong tháng này" />
                    </td>
                  </tr>
                )}
                {tableRows.map((r, i) => (
                  <tr
                    key={i}
                    className={i % 2 ? 'bg-navy-50/40' : 'bg-white'}
                  >
                    <td className="px-4 py-2.5 text-navy-700">{toDMY(r.date)}</td>
                    <td className="px-4 py-2.5 text-navy-700">{r.roomType || '—'}</td>
                    <td className="px-4 py-2.5">
                      {r.rateCode ? <Badge tone="neutral">{r.rateCode}</Badge> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right mono-num font-semibold text-navy-800">
                      {r.selling !== null ? formatVND(r.selling) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right mono-num text-navy-600">
                      {r.net !== null ? formatVND(r.net) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right mono-num text-gold-600">
                      {r.b2b !== null ? formatVND(r.b2b) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        hotelName={hotelName}
        defaultStart={monthStart}
        defaultEnd={monthEnd}
        columns={[
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Room Type', key: 'room_type', width: 22 },
          { header: 'Rate Code', key: 'rate_code', width: 14 },
          { header: 'Selling Price', key: 'selling_price', width: 18 },
          { header: 'Net Price', key: 'net_price', width: 18 },
          { header: 'B2B Price', key: 'b2b_price', width: 18 },
        ]}
        rows={exportRows}
        filename={`lookup_${hotelName.replace(/\s+/g, '_')}_${monthStart}_${monthEnd}`}
      />
    </div>
  );
}
