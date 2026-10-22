import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BedDouble,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CalendarRange,
  CalendarDays,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRoomTypes } from '@/lib/useRoomTypes';
import { useAuth } from '@/auth/AuthContext';
import type { RoomType } from '@/types';
import { Card, Field, EmptyState, Badge } from '@/components/ui';
import { formatVND, toISODate, toDMY } from '@/lib/format';

const WEEKDAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

interface PickupRecord {
  id: string;
  booking_id: string | null;
  source: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  room_type: string | null;
  room_rate: number | null;
  nights: number | null;
  room_revenue: number | null;
  status: string | null;
  booked_datetime: string | null;
  created_at: string;
  quantity: number | null;
  hotel_id: string | null;
  cancel_date: string | null;
}

function roomNights(r: PickupRecord): number {
  const qty = Number(r.quantity) || 1;
  const n = Number(r.nights) || 0;
  return qty * n;
}

function parseBookedDateTime(raw: unknown): Date | null {
  if (raw instanceof Date) return raw;
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, d, mo, y, h, mi, s] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const md = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (md) {
    const [, d, mo, y] = md;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

interface DayCellData {
  date: string;
  soldRooms: number;
  totalRooms: number;
  occupancy: number;
  pickup24h: number;
  adr: number;
  cancelRns: number;
  perRoomType: { roomType: string; sold: number; capacity: number; occupancy: number }[];
}

export function MiniRMSAnalytics({ hotelId, manualSold }: { hotelId: string; manualSold: Map<string, number> }) {
  const { roomTypes } = useRoomTypes(hotelId || null);
  const [inventory, setInventory] = useState<Map<string, number>>(new Map());
  const [records, setRecords] = useState<PickupRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Date range + source filter for Lead Time / LOS analytics
  const [analyticsFrom, setAnalyticsFrom] = useState('');
  const [analyticsTo, setAnalyticsTo] = useState('');
  const [analyticsSource, setAnalyticsSource] = useState('all');

  // Load inventory from localStorage (single source of truth — set in Admin/Hotel Config)
  const loadInventory = useCallback(() => {
    if (!hotelId) {
      setInventory(new Map());
      return;
    }
    const raw = localStorage.getItem('mini_rms_physical_inventory');
    const allData: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
    const hotelInv = allData[hotelId] || {};
    const map = new Map<string, number>();
    roomTypes.forEach((rt) => {
      const cap = hotelInv[rt.id] ?? 0;
      if (cap > 0) map.set(rt.id, cap);
    });
    setInventory(map);
  }, [hotelId, roomTypes]);

  // Load all pickup records (date-range filtering happens client-side for analytics)
  const loadRecords = useCallback(async () => {
    if (!hotelId) {
      setRecords([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('pickup_records')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('arrival_date', { ascending: true });
    setRecords((data as PickupRecord[]) || []);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    loadInventory();
    loadRecords();
  }, [loadInventory, loadRecords]);

  const totalRooms = useMemo(() => {
    let sum = 0;
    inventory.forEach((cap) => (sum += cap));
    return sum;
  }, [inventory]);

  // Build 30-day arrival matrix (from full records set, filtered to next 30 days)
  const next30Start = useMemo(() => toISODate(new Date()), []);
  const next30End = useMemo(() => toISODate(new Date(Date.now() + 30 * 86400000)), []);
  const next30Records = useMemo(
    () => records.filter((r) => r.arrival_date && r.arrival_date >= next30Start && r.arrival_date <= next30End),
    [records, next30Start, next30End],
  );

  const dayCells = useMemo<DayCellData[]>(() => {
    const now = new Date();
    const cut24h = new Date(now.getTime() - 24 * 3600 * 1000);

    const cells: DayCellData[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const dateISO = toISODate(d);
      const dayRecs = next30Records.filter((r) => r.arrival_date === dateISO);
      const confirmed = dayRecs.filter((r) => r.status !== 'Cancelled');
      const cancelled = dayRecs.filter((r) => r.status === 'Cancelled');

      // Sold rooms = total quantity of confirmed bookings arriving this date
      const puSoldRooms = confirmed.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
      const manualSoldForDate = manualSold.get(dateISO) ?? 0;
      const soldRooms = Math.max(puSoldRooms, manualSoldForDate);
      const cancelRns = cancelled.reduce((s, r) => s + roomNights(r), 0);

      // 24h pickup: bookings booked in the last 24h that arrive on this date
      const pickup24h = confirmed
        .filter((r) => {
          const dt = r.booked_datetime ? parseBookedDateTime(r.booked_datetime) : null;
          return dt && dt >= cut24h;
        })
        .reduce((s, r) => s + roomNights(r), 0);

      // ADR from confirmed bookings
      const revenue = confirmed.reduce((s, r) => s + (Number(r.room_revenue) || 0), 0);
      const confirmedRNs = confirmed.reduce((s, r) => s + roomNights(r), 0);
      const adr = confirmedRNs > 0 ? revenue / confirmedRNs : 0;

      // Per room type breakdown — match by room_type name (pickup_records stores text, not id)
      const perRoomType = roomTypes.map((rt) => {
        const rtRecs = confirmed.filter((r) => (r.room_type || '').trim().toLowerCase() === rt.name.trim().toLowerCase());
        const sold = rtRecs.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
        const cap = inventory.get(rt.id) ?? 0;
        return { roomType: rt.name, sold, capacity: cap, occupancy: cap > 0 ? (sold / cap) * 100 : 0 };
      });

      const occupancy = totalRooms > 0 ? (soldRooms / totalRooms) * 100 : 0;

      cells.push({
        date: dateISO,
        soldRooms,
        totalRooms,
        occupancy,
        pickup24h,
        adr,
        cancelRns,
        perRoomType,
      });
    }
    return cells;
  }, [next30Records, roomTypes, inventory, totalRooms, manualSold]);

  // Source breakdown
  const sourceBreakdown = useMemo(() => {
    const confirmed = next30Records.filter((r) => r.status !== 'Cancelled');
    const totalRNs = confirmed.reduce((s, r) => s + roomNights(r), 0);
    const map = new Map<string, { rns: number; bookings: number; cancelRns: number; totalBookings: number }>();
    for (const r of next30Records) {
      const src = r.source || 'Không xác định';
      const cur = map.get(src) || { rns: 0, bookings: 0, cancelRns: 0, totalBookings: 0 };
      cur.totalBookings += 1;
      if (r.status === 'Cancelled') {
        cur.cancelRns += roomNights(r);
      } else {
        cur.rns += roomNights(r);
        cur.bookings += 1;
      }
      map.set(src, cur);
    }
    return Array.from(map.entries())
      .map(([source, v]) => ({
        source,
        rns: v.rns,
        bookings: v.bookings,
        cancelRns: v.cancelRns,
        totalBookings: v.totalBookings,
        cancelRate: v.totalBookings > 0 ? (v.cancelRns / (v.rns + v.cancelRns)) * 100 : 0,
        contribution: totalRNs > 0 ? (v.rns / totalRNs) * 100 : 0,
      }))
      .sort((a, b) => b.rns - a.rns);
  }, [next30Records]);

  // Room type performance table
  const roomTypePerformance = useMemo(() => {
    const confirmed = next30Records.filter((r) => r.status !== 'Cancelled');
    return roomTypes
      .map((rt) => {
        const rtRecs = confirmed.filter(
          (r) => (r.room_type || '').trim().toLowerCase() === rt.name.trim().toLowerCase(),
        );
        const sold = rtRecs.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
        const rns = rtRecs.reduce((s, r) => s + roomNights(r), 0);
        const revenue = rtRecs.reduce((s, r) => s + (Number(r.room_revenue) || 0), 0);
        const adr = rns > 0 ? revenue / rns : 0;
        const cap = inventory.get(rt.id) ?? 0;
        const occupancy = cap > 0 ? (sold / cap) * 100 : 0;
        return { roomType: rt.name, sold, rns, revenue, adr, capacity: cap, occupancy };
      })
      .sort((a, b) => b.rns - a.rns);
  }, [next30Records, roomTypes, inventory]);

  // Cancellation metrics
  const cancelMetrics = useMemo(() => {
    const confirmed = next30Records.filter((r) => r.status !== 'Cancelled');
    const cancelled = next30Records.filter((r) => r.status === 'Cancelled');
    const confirmedRNs = confirmed.reduce((s, r) => s + roomNights(r), 0);
    const cancelRNs = cancelled.reduce((s, r) => s + roomNights(r), 0);
    const totalRNs = confirmedRNs + cancelRNs;
    const cancelRate = totalRNs > 0 ? (cancelRNs / totalRNs) * 100 : 0;
    return { confirmedRNs, cancelRNs, totalRNs, cancelRate, cancelCount: cancelled.length };
  }, [next30Records]);

  // All sources for analytics filter dropdown
  const allSources = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.source && set.add(r.source));
    return Array.from(set).sort();
  }, [records]);

  // ============ LEAD TIME & LOS ANALYTICS (date-range + source filtered) ============
  const analyticsRecords = useMemo(() => {
    return records.filter((r) => {
      if (!r.arrival_date) return false;
      if (analyticsFrom && r.arrival_date < analyticsFrom) return false;
      if (analyticsTo && r.arrival_date > analyticsTo) return false;
      if (analyticsSource !== 'all' && (r.source || '') !== analyticsSource) return false;
      return true;
    });
  }, [records, analyticsFrom, analyticsTo, analyticsSource]);

  const leadTimeMetrics = useMemo(() => {
    const confirmed = analyticsRecords.filter((r) => r.status !== 'Cancelled');
    const pickupLeadDays: number[] = [];
    for (const r of confirmed) {
      if (!r.arrival_date || !r.booked_datetime) continue;
      const booked = parseBookedDateTime(r.booked_datetime);
      if (!booked) continue;
      const arrival = new Date(r.arrival_date + 'T00:00:00');
      const diff = Math.round((arrival.getTime() - booked.getTime()) / 86400000);
      if (diff >= 0) pickupLeadDays.push(diff);
    }
    const avgPickupLead = pickupLeadDays.length > 0
      ? pickupLeadDays.reduce((s, d) => s + d, 0) / pickupLeadDays.length
      : 0;

    const cancelled = analyticsRecords.filter((r) => r.status === 'Cancelled');
    const cancelLeadDays: number[] = [];
    for (const r of cancelled) {
      if (!r.arrival_date || !r.cancel_date) continue;
      const cancelDt = new Date(r.cancel_date + 'T00:00:00');
      if (isNaN(cancelDt.getTime())) continue;
      const arrival = new Date(r.arrival_date + 'T00:00:00');
      const diff = Math.round((arrival.getTime() - cancelDt.getTime()) / 86400000);
      if (diff >= 0) cancelLeadDays.push(diff);
    }
    const avgCancelLead = cancelLeadDays.length > 0
      ? cancelLeadDays.reduce((s, d) => s + d, 0) / cancelLeadDays.length
      : 0;

    const buckets = [
      { label: '0 - 3 ngày', min: 0, max: 3 },
      { label: '4 - 6 ngày', min: 4, max: 6 },
      { label: '7 - 14 ngày', min: 7, max: 14 },
      { label: '14 - 30 ngày', min: 14, max: 30 },
      { label: '30+ ngày', min: 31, max: Infinity },
    ];
    let dominant = '—';
    let maxCount = 0;
    for (const b of buckets) {
      const count = pickupLeadDays.filter((d) => d >= b.min && d <= b.max).length;
      if (count > maxCount) { maxCount = count; dominant = b.label; }
    }

    return {
      avgPickupLead,
      avgCancelLead,
      dominantWindow: dominant,
      pickupCount: pickupLeadDays.length,
      cancelCount: cancelLeadDays.length,
    };
  }, [analyticsRecords]);

  const losMetrics = useMemo(() => {
    const valid = analyticsRecords.filter((r) => r.arrival_date && r.departure_date);
    const losValues: number[] = [];
    for (const r of valid) {
      const arr = new Date((r.arrival_date as string) + 'T00:00:00');
      const dep = new Date((r.departure_date as string) + 'T00:00:00');
      const diff = Math.round((dep.getTime() - arr.getTime()) / 86400000);
      if (diff > 0) losValues.push(diff);
    }
    const total = losValues.length;
    const avgLos = total > 0 ? losValues.reduce((s, d) => s + d, 0) / total : 0;
    const oneNight = losValues.filter((d) => d === 1).length;
    const twoPlus = losValues.filter((d) => d >= 2).length;
    return {
      avgLos,
      total,
      oneNightPct: total > 0 ? (oneNight / total) * 100 : 0,
      twoPlusPct: total > 0 ? (twoPlus / total) * 100 : 0,
      oneNightCount: oneNight,
      twoPlusCount: twoPlus,
    };
  }, [analyticsRecords]);

  return (
    <div className="space-y-4">
      {totalRooms === 0 ? (
        <Card className="p-4">
          <EmptyState message="Vui lòng cấu hình số phòng vật lý trong trang Quản trị (Cấu hình khách sạn) để hiển thị lưới arrival và occupancy." />
        </Card>
      ) : (
        <>
          {/* ============ LEAD TIME & LOS ANALYTICS WITH DATE FILTER ============ */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm border-b border-navy-50 pb-2">
              <CalendarRange size={16} className="text-gold-600" />
              Phân tích Lead Time & LOS (Thời gian đặt trước & Độ dài lưu trú)
            </div>

            {/* Date range + source filter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <Field label="Từ ngày (Arrival)">
                <input
                  type="date"
                  value={analyticsFrom}
                  onChange={(e) => setAnalyticsFrom(e.target.value)}
                  className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                />
              </Field>
              <Field label="Đến ngày (Arrival)">
                <input
                  type="date"
                  value={analyticsTo}
                  onChange={(e) => setAnalyticsTo(e.target.value)}
                  className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                />
              </Field>
              <Field label="Kênh bán (OTA)">
                <select
                  value={analyticsSource}
                  onChange={(e) => setAnalyticsSource(e.target.value)}
                  className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                >
                  <option value="all">Tất cả kênh</option>
                  {allSources.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end">
                <button
                  onClick={() => { setAnalyticsFrom(''); setAnalyticsTo(''); setAnalyticsSource('all'); }}
                  className="text-sm text-navy-600 hover:text-navy-800 font-medium underline"
                >
                  Xóa bộ lọc
                </button>
              </div>
            </div>

            {/* Two metric cards side-by-side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Card 1: Lead Time Analysis */}
              <div className="rounded-xl border border-navy-200 bg-white p-4 space-y-3">
                <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
                  <Clock size={16} className="text-gold-600" />
                  Thời gian đặt phòng trước (Lead Time Analysis)
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between border-b border-navy-50 pb-2">
                    <span className="text-sm text-navy-600 font-medium">Lead Time Trung Bình (Pickup)</span>
                    <span className="text-lg font-semibold mono-num text-navy-800">
                      {leadTimeMetrics.pickupCount > 0 ? `${leadTimeMetrics.avgPickupLead.toFixed(1)} ngày` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-navy-50 pb-2">
                    <span className="text-sm text-navy-600 font-medium">Lead Time Hủy Trung Bình</span>
                    <span className="text-lg font-semibold mono-num text-red-600">
                      {leadTimeMetrics.cancelCount > 0 ? `${leadTimeMetrics.avgCancelLead.toFixed(1)} ngày` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-navy-600 font-medium">Cửa Sổ Đặt Phòng Phổ Biến</span>
                    <span className="text-base font-semibold text-gold-700 bg-gold-50 border border-gold-200 rounded-lg px-2.5 py-1">
                      {leadTimeMetrics.dominantWindow}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-navy-400">
                  Dựa trên {leadTimeMetrics.pickupCount} booking confirmed &amp; {leadTimeMetrics.cancelCount} booking đã hủy.
                </div>
              </div>

              {/* Card 2: LOS Analysis */}
              <div className="rounded-xl border border-navy-200 bg-white p-4 space-y-3">
                <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
                  <CalendarDays size={16} className="text-gold-600" />
                  Độ dài lưu trú (Length of Stay Analysis)
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between border-b border-navy-50 pb-2">
                    <span className="text-sm text-navy-600 font-medium">LOS Trung Bình</span>
                    <span className="text-lg font-semibold mono-num text-navy-800">
                      {losMetrics.total > 0 ? `${losMetrics.avgLos.toFixed(1)} đêm` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-navy-50 pb-2">
                    <span className="text-sm text-navy-600 font-medium">Tỷ Lệ Khách Ở 1 Đêm</span>
                    <span className="text-lg font-semibold mono-num text-navy-800">
                      {losMetrics.total > 0 ? `${losMetrics.oneNightPct.toFixed(0)}%` : '—'}
                      <span className="text-xs font-normal text-navy-400 ml-1.5">({losMetrics.oneNightCount} booking)</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-navy-600 font-medium">Tỷ Lệ Khách Ở 2+ Đêm</span>
                    <span className="text-lg font-semibold mono-num text-emerald-700">
                      {losMetrics.total > 0 ? `${losMetrics.twoPlusPct.toFixed(0)}%` : '—'}
                      <span className="text-xs font-normal text-navy-400 ml-1.5">({losMetrics.twoPlusCount} booking)</span>
                    </span>
                  </div>
                </div>
                <div className="text-xs text-navy-400">
                  Dựa trên {losMetrics.total} booking có ngày đến &amp; đi hợp lệ.
                </div>
              </div>
            </div>

            {analyticsRecords.length === 0 && (
              <div className="text-sm text-navy-400 text-center py-2">
                Không có dữ liệu trong khoảng ngày đã chọn. Hãy chọn lại hoặc xóa bộ lọc.
              </div>
            )}
          </Card>
          {/* ============ 30-DAY ARRIVAL CALENDAR GRID ============ */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
              <TrendingUp size={16} className="text-gold-600" />
              Lưới Arrival 30 ngày (Future Occupancy)
            </div>

            {loading ? (
              <EmptyState message="Đang tải dữ liệu pickup…" />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
                {dayCells.map((cell) => {
                  const dt = new Date(cell.date + 'T00:00:00');
                  const weekday = WEEKDAY_VI[dt.getDay()];
                  const isSaturday = dt.getDay() === 6;
                  return (
                    <div
                      key={cell.date}
                      className="rounded-lg border border-navy-200 bg-white p-2.5 flex flex-col gap-1 min-h-[120px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${isSaturday ? 'text-amber-700' : 'text-navy-700'}`}>
                          {weekday} {toDMY(cell.date).split('/')[0]}/{toDMY(cell.date).split('/')[1]}
                        </span>
                      </div>
                      <div className="text-sm font-bold mono-num text-navy-800">
                        {cell.soldRooms} / {cell.totalRooms}
                      </div>
                      <div className="text-[11px] text-navy-500">
                        Occ: <span className="font-semibold mono-num">{cell.occupancy.toFixed(0)}%</span>
                      </div>
                      <div className="text-[11px] text-emerald-600">
                        PU 24h: <span className="font-semibold mono-num">+{cell.pickup24h} RN</span>
                      </div>
                      <div className="text-[11px] text-navy-400">
                        ADR: <span className="mono-num">{cell.adr > 0 ? formatVND(Math.round(cell.adr)) : '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ============ SOURCE BREAKDOWN ============ */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
              <BarChart3 size={16} className="text-gold-600" />
              Phân bổ theo kênh bán (Source Breakdown — 30 ngày)
            </div>
            {sourceBreakdown.length === 0 ? (
              <EmptyState message="Không có dữ liệu booking trong 30 ngày tới." />
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-sm">
                  <thead className="bg-navy-50 text-navy-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Kênh bán</th>
                      <th className="text-right px-3 py-2 font-semibold">Room Nights</th>
                      <th className="text-right px-3 py-2 font-semibold">Bookings</th>
                      <th className="text-right px-3 py-2 font-semibold">Đóng góp %</th>
                      <th className="text-right px-3 py-2 font-semibold">Cancel RNs</th>
                      <th className="text-right px-3 py-2 font-semibold">Cancel Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceBreakdown.map((s) => (
                      <tr key={s.source} className="border-t border-navy-50">
                        <td className="px-3 py-2.5 text-navy-700 font-medium">{s.source}</td>
                        <td className="px-3 py-2.5 text-right mono-num text-navy-800 font-semibold">{s.rns}</td>
                        <td className="px-3 py-2.5 text-right mono-num text-navy-600">{s.bookings}</td>
                        <td className="px-3 py-2.5 text-right mono-num text-navy-600">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-navy-100 rounded-full overflow-hidden">
                              <div className="h-full bg-[#E9967A] rounded-full" style={{ width: `${s.contribution}%` }} />
                            </div>
                            <span>{s.contribution.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right mono-num text-red-600">{s.cancelRns}</td>
                        <td className="px-3 py-2.5 text-right mono-num">
                          {s.cancelRate > 35 ? (
                            <Badge tone="red">{s.cancelRate.toFixed(0)}% ⚠</Badge>
                          ) : (
                            <span className="text-navy-500">{s.cancelRate.toFixed(0)}%</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ============ ROOM TYPE PERFORMANCE ============ */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
              <BedDouble size={16} className="text-gold-600" />
              Hiệu suất theo loại phòng (Room Type Performance — 30 ngày)
            </div>
            {roomTypePerformance.length === 0 ? (
              <EmptyState message="Không có dữ liệu." />
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-sm">
                  <thead className="bg-navy-50 text-navy-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Loại phòng</th>
                      <th className="text-right px-3 py-2 font-semibold">Sold Rooms</th>
                      <th className="text-right px-3 py-2 font-semibold">Capacity</th>
                      <th className="text-right px-3 py-2 font-semibold">Occupancy</th>
                      <th className="text-right px-3 py-2 font-semibold">Room Nights</th>
                      <th className="text-right px-3 py-2 font-semibold">ADR</th>
                      <th className="text-right px-3 py-2 font-semibold">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomTypePerformance.map((rt, idx) => {
                      const isTop = idx === 0 && rt.rns > 0;
                      const isLow = idx === roomTypePerformance.length - 1 && rt.rns === 0;
                      return (
                        <tr key={rt.roomType} className="border-t border-navy-50">
                          <td className="px-3 py-2.5 text-navy-700 font-medium">{rt.roomType}</td>
                          <td className="px-3 py-2.5 text-right mono-num text-navy-800">{rt.sold}</td>
                          <td className="px-3 py-2.5 text-right mono-num text-navy-500">{rt.capacity}</td>
                          <td className="px-3 py-2.5 text-right mono-num text-navy-600">{rt.occupancy.toFixed(0)}%</td>
                          <td className="px-3 py-2.5 text-right mono-num text-navy-800 font-semibold">{rt.rns}</td>
                          <td className="px-3 py-2.5 text-right mono-num text-navy-600">
                            {rt.adr > 0 ? formatVND(Math.round(rt.adr)) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {isTop ? (
                              <Badge tone="green"><CheckCircle2 size={11} className="inline mr-1" />Top bán</Badge>
                            ) : isLow ? (
                              <Badge tone="neutral">Chưa bán</Badge>
                            ) : (
                              <span className="text-navy-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ============ CANCELLATION METRICS ============ */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
              <AlertTriangle size={16} className="text-red-500" />
              Chỉ số Huỷ phòng (Cancellation Metrics — 30 ngày)
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
                <div className="text-xs text-navy-500">Tổng Cancel RNs</div>
                <div className="text-lg font-bold mono-num text-red-600">{cancelMetrics.cancelRNs}</div>
              </div>
              <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
                <div className="text-xs text-navy-500">Tổng Confirmed RNs</div>
                <div className="text-lg font-bold mono-num text-emerald-600">{cancelMetrics.confirmedRNs}</div>
              </div>
              <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
                <div className="text-xs text-navy-500">Cancellation Rate</div>
                <div className={`text-lg font-bold mono-num ${cancelMetrics.cancelRate > 35 ? 'text-red-600' : 'text-navy-800'}`}>
                  {cancelMetrics.cancelRate.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
                <div className="text-xs text-navy-500">Số booking bị huỷ</div>
                <div className="text-lg font-bold mono-num text-navy-800">{cancelMetrics.cancelCount}</div>
              </div>
            </div>
            <div className="text-xs text-navy-400">
              {sourceBreakdown.filter((s) => s.cancelRate > 35).length > 0 ? (
                <>
                  <span className="text-red-600 font-semibold">Cảnh báo:</span> Các kênh có tỷ lệ huỷ &gt; 35%:{' '}
                  {sourceBreakdown
                    .filter((s) => s.cancelRate > 35)
                    .map((s) => `${s.source} (${s.cancelRate.toFixed(0)}%)`)
                    .join(', ')}
                </>
              ) : (
                'Không có kênh nào vượt ngưỡng huỷ 35%.'
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
