import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Clock,
  Download,
  History,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useAuth, canAccessFullPuReport } from '@/auth/AuthContext';
import { Badge, Button, Card, EmptyState, Field, Modal, Select } from '@/components/ui';
import { formatVND, toDMY, toISODate, excelSerialToDate } from '@/lib/format';
import type { Hotel } from '@/types';

const STORAGE_BUCKET = 'pickup-reports';

/**
 * Page 5 — PU Report (Pickup Report).
 * Access: Admin role OR users with can_access_pu_report = true.
 *
 * Data model (append-only):
 *  - pickup_import_logs: one row per Excel import (audit trail).
 *  - pickup_records: raw reservation rows, APPENDED on every import.
 */

interface PickupImportLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  file_name: string;
  total_rows: number;
  imported_at: string;
}

interface AppUserInfo {
  id: string;
  username: string;
  email: string | null;
}

interface PickupRecord {
  id: string;
  import_id: string | null;
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
}

type Mode = 'gross' | 'net' | 'cancel';
type Toast = { kind: 'ok' | 'err' | 'info'; text: string } | null;

const WEEKDAY_VI = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Parse BookedDatetime that may be "DD/MM/YYYY HH:mm:ss" or an ISO string.
function parseBookedDateTime(raw: unknown): Date | null {
  if (raw instanceof Date) return raw;
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // DD/MM/YYYY HH:mm:ss or DD/MM/YYYY HH:mm
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, d, mo, y, h, mi, s] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  // DD/MM/YYYY (date only)
  const md = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (md) {
    const [, d, mo, y] = md;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// Room Nights for a record = quantity (default 1) * nights
function roomNights(r: PickupRecord): number {
  const qty = Number(r.quantity) || 1;
  const n = Number(r.nights) || 0;
  return qty * n;
}

// ---------- Sample Excel generator ----------
function buildSampleRows(): (string | number)[][] {
  const now = new Date();
  const today = toISODate(now);
  const tomorrow = toISODate(new Date(now.getTime() + 86400000));
  const d2 = toISODate(new Date(now.getTime() + 2 * 86400000));
  const d3 = toISODate(new Date(now.getTime() + 3 * 86400000));
  const in3 = toISODate(new Date(now.getTime() + 3 * 86400000));
  const in5 = toISODate(new Date(now.getTime() + 5 * 86400000));
  const in7 = toISODate(new Date(now.getTime() + 7 * 86400000));

  const iso = (s: string) => s;
  const bookedRecent = (minsAgo: number) =>
    new Date(now.getTime() - minsAgo * 60000).toISOString();

  return [
    ['Booking ID', 'Source', 'Arrival', 'Departure', 'Room Type', 'Room Rate', 'Nights', 'Room Revenue', 'Status', 'BookedDatetime'],
    ['BK-10001', 'BOOKING.COM', iso(today), iso(tomorrow), 'Economy Double', 680000, 1, 680000, 'Confirmed', bookedRecent(20)],
    ['BK-10002', 'Traveloka', iso(today), iso(in3), 'Deluxe City View', 1250000, 3, 3750000, 'Confirmed', bookedRecent(45)],
    ['BK-10003', 'AGODA', iso(tomorrow), iso(in3), 'Suite', 2100000, 2, 4200000, 'Confirmed', bookedRecent(120)],
    ['BK-10004', 'ZALO', iso(today), iso(tomorrow), 'Economy Double', 720000, 1, 720000, 'Cancelled', bookedRecent(180)],
    ['BK-10005', 'Walk In', iso(today), iso(tomorrow), 'Deluxe City View', 1180000, 1, 1180000, 'Confirmed', bookedRecent(300)],
    ['BK-10006', 'BOOKING.COM', iso(tomorrow), iso(in5), 'Deluxe City View', 1290000, 4, 5160000, 'Confirmed', bookedRecent(600)],
    ['BK-10007', 'Traveloka', iso(d2), iso(in5), 'Suite', 2050000, 3, 6150000, 'Cancelled', bookedRecent(720)],
    ['BK-10008', 'AGODA', iso(today), iso(in3), 'Economy Double', 690000, 3, 2070000, 'Confirmed', bookedRecent(900)],
    ['BK-10009', 'BOOKING.COM', iso(tomorrow), iso(in3), 'Suite', 2200000, 2, 4400000, 'Confirmed', bookedRecent(1100)],
    ['BK-10010', 'Walk In', iso(d3), iso(in5), 'Economy Double', 700000, 2, 1400000, 'Confirmed', bookedRecent(1300)],
    ['BK-10011', 'Traveloka', iso(today), iso(tomorrow), 'Suite', 2350000, 1, 2350000, 'Confirmed', bookedRecent(1440)],
    ['BK-10012', 'AGODA', iso(tomorrow), iso(in7), 'Deluxe City View', 1310000, 6, 7860000, 'Cancelled', bookedRecent(1500)],
    ['BK-10013', 'BOOKING.COM', iso(d2), iso(in3), 'Economy Double', 710000, 1, 710000, 'Confirmed', bookedRecent(2880)],
    ['BK-10014', 'ZALO', iso(today), iso(in3), 'Deluxe City View', 1200000, 3, 3600000, 'Confirmed', bookedRecent(4320)],
    ['BK-10015', 'Walk In', iso(tomorrow), iso(in3), 'Suite', 2180000, 2, 4360000, 'Confirmed', bookedRecent(5760)],
  ];
}

function downloadSampleExcel() {
  const rows = buildSampleRows();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 20 },
    { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 22 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pickup Sample');
  XLSX.writeFile(wb, 'Mau_Bao_Cao_Pickup_Sample.xlsx');
}

// ---------- Analytics helpers ----------
interface DayAgg {
  date: string;
  nights: number;
  revenue: number;
  cancelCount: number;
  adr: number;
}

function aggregateByArrival(records: PickupRecord[]): Map<string, DayAgg> {
  const map = new Map<string, DayAgg>();
  for (const r of records) {
    if (!r.arrival_date) continue;
    const key = r.arrival_date;
    const cur = map.get(key) || { date: key, nights: 0, revenue: 0, cancelCount: 0, adr: 0 };
    cur.nights += roomNights(r);
    if (r.status === 'Cancelled') {
      cur.cancelCount += 1;
    } else {
      cur.revenue += Number(r.room_revenue) || 0;
    }
    map.set(key, cur);
  }
  for (const v of map.values()) {
    const confirmedNights = records
      .filter((r) => r.arrival_date === v.date && r.status !== 'Cancelled')
      .reduce((s, r) => s + roomNights(r), 0);
    v.adr = confirmedNights > 0 ? v.revenue / confirmedNights : 0;
  }
  return map;
}

export function PUReportPage() {
  const { user, hotels } = useAuth();
  const isFullAccess = canAccessFullPuReport(user);
  const isUploadOnly = !isFullAccess && !!user && user.can_upload_pu_only === true;

  const [records, setRecords] = useState<PickupRecord[]>([]);
  const [logs, setLogs] = useState<PickupImportLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Hotel filter (multi-select, no "All Hotels" option)
  const [selectedHotelIds, setSelectedHotelIds] = useState<string[]>([]);

  // User lookup for upload history
  const [userMap, setUserMap] = useState<Map<string, AppUserInfo>>(new Map());

  // Filters
  const [mode, setMode] = useState<Mode>('gross');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<string[]>([]);

  // Pagination
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    let recQuery = supabase.from('pickup_records').select('*').order('created_at', { ascending: false }).limit(2000);
    if (selectedHotelIds.length > 0) {
      recQuery = recQuery.in('hotel_id', selectedHotelIds);
    }
    const [r, l, u] = await Promise.all([
      recQuery,
      supabase.from('pickup_import_logs').select('*').order('imported_at', { ascending: false }).limit(200),
      supabase.from('app_users').select('id, username, email'),
    ]);
    setRecords((r.data as PickupRecord[]) || []);
    setLogs((l.data as PickupImportLog[]) || []);
    const um = new Map<string, AppUserInfo>();
    ((u.data as AppUserInfo[]) || []).forEach((usr) => um.set(usr.id, usr));
    setUserMap(um);
    setLoading(false);
  }, [selectedHotelIds]);

  // Default hotel selection: first assigned hotel sorted alphabetically
  useEffect(() => {
    if (hotels.length > 0 && selectedHotelIds.length === 0) {
      const sorted = [...hotels].sort((a, b) => a.name.localeCompare(b.name));
      setSelectedHotelIds([sorted[0].id]);
    }
  }, [hotels, selectedHotelIds]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- Import (append-only) ----------
  const handleImport = async (file: File) => {
    setImporting(true);
    setToast(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        setToast({ kind: 'err', text: 'File không chứa sheet dữ liệu.' });
        setImporting(false);
        return;
      }
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (json.length === 0) {
        setToast({ kind: 'err', text: 'File không có dòng dữ liệu nào.' });
        setImporting(false);
        return;
      }

      const parsed: PickupRecord[] = [];
      let skipped = 0;
      for (const raw of json) {
        const bookingId = String(raw['Booking ID'] ?? raw['booking_id'] ?? '').trim();
        const source = String(raw['Source'] ?? raw['source'] ?? '').trim();
        const arrivalRaw = raw['Arrival'] ?? raw['arrival'];
        const departureRaw = raw['Departure'] ?? raw['departure'];
        const roomType = String(raw['Room Type'] ?? raw['room_type'] ?? '').trim();
        const roomRate = Number(String(raw['Room Rate'] ?? raw['room_rate'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const nights = Number(String(raw['Nights'] ?? raw['nights'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const roomRevenue = Number(String(raw['Room Revenue'] ?? raw['room_revenue'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const status = String(raw['Status'] ?? raw['status'] ?? '').trim();
        const bookedRaw = raw['BookedDatetime'] ?? raw['booked_datetime'] ?? raw['Booked Datetime'] ?? '';
        const quantity = Number(String(raw['Quantity'] ?? raw['quantity'] ?? raw['Qty'] ?? '1').replace(/[^\d.-]/g, '')) || 1;

        const arrDate = excelSerialToDate(arrivalRaw);
        const depDate = excelSerialToDate(departureRaw);
        const bookedDate = bookedRaw instanceof Date ? bookedRaw : parseBookedDateTime(bookedRaw);

        if (!bookingId || !arrDate || !depDate) {
          skipped++;
          continue;
        }
        parsed.push({
          id: '',
          import_id: null,
          booking_id: bookingId,
          source,
          arrival_date: toISODate(arrDate),
          departure_date: toISODate(depDate),
          room_type: roomType,
          room_rate: roomRate,
          nights,
          room_revenue: roomRevenue,
          status: status || 'Confirmed',
          booked_datetime: bookedDate ? bookedDate.toISOString() : null,
          created_at: new Date().toISOString(),
          quantity,
        });
      }

      if (parsed.length === 0) {
        setToast({ kind: 'err', text: `Không có dòng hợp lệ.${skipped ? ` Bỏ qua ${skipped} dòng.` : ''}` });
        setImporting(false);
        return;
      }

      // 1. Upload file to Storage bucket (audit archive)
      const storagePath = `${new Date().toISOString().replace(/[:.]/g, '-')}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
      if (uploadErr) {
        setToast({ kind: 'err', text: `Lỗi lưu file vào bucket: ${uploadErr.message}` });
        setImporting(false);
        return;
      }

      // 2. Insert import log (audit trail)
      const { data: logData, error: logErr } = await supabase
        .from('pickup_import_logs')
        .insert({
          user_id: user?.id ?? null,
          user_email: user?.email ?? null,
          file_name: file.name,
          total_rows: parsed.length,
        })
        .select()
        .maybeSingle();
      if (logErr || !logData) {
        setToast({ kind: 'err', text: `Lỗi ghi nhật ký import: ${logErr?.message || 'không xác định'}` });
        setImporting(false);
        return;
      }
      const importId = (logData as PickupImportLog).id;

      // 3. Append records (never overwrite)
      const rows = parsed.map((p) => ({
        import_id: importId,
        hotel_id: selectedHotelIds.length === 1 ? selectedHotelIds[0] : (selectedHotelIds.length > 0 ? selectedHotelIds[0] : null),
        booking_id: p.booking_id,
        source: p.source,
        arrival_date: p.arrival_date,
        departure_date: p.departure_date,
        room_type: p.room_type,
        room_rate: p.room_rate,
        nights: p.nights,
        room_revenue: p.room_revenue,
        status: p.status,
        booked_datetime: p.booked_datetime,
        quantity: p.quantity,
      }));
      const { error: insErr } = await supabase.from('pickup_records').insert(rows);
      if (insErr) {
        setToast({ kind: 'err', text: `Lỗi lưu dòng pickup: ${insErr.message}` });
        setImporting(false);
        return;
      }

      setToast({
        kind: 'ok',
        text: `Đã import ${parsed.length} dòng pickup${skipped ? ` (bỏ qua ${skipped} dòng)` : ''}. Dữ liệu đã được thêm vào.`,
      });
      await loadAll();
    } catch (e) {
      setToast({ kind: 'err', text: `Lỗi đọc file: ${(e as Error).message}` });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleImport(f);
  };

  // ---------- Derived: sources & room types for filter selectors ----------
  const allSources = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.source && set.add(r.source));
    return Array.from(set).sort();
  }, [records]);

  const allRoomTypes = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.room_type && set.add(r.room_type));
    return Array.from(set).sort();
  }, [records]);

  // ---------- Filtered records by mode + date range (BookedDatetime) + source + room types ----------
  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (mode === 'net' && r.status !== 'Confirmed') return false;
      if (mode === 'cancel' && r.status !== 'Cancelled') return false;
      // Date filter range applies to BookedDatetime
      const booked = r.booked_datetime ? parseBookedDateTime(r.booked_datetime) : null;
      const bookedISO = booked ? toISODate(booked) : '';
      if (fromDate && bookedISO && bookedISO < fromDate) return false;
      if (toDate && bookedISO && bookedISO > toDate) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (roomTypeFilter.length > 0 && !roomTypeFilter.includes(r.room_type || '')) return false;
      return true;
    });
  }, [records, mode, fromDate, toDate, sourceFilter, roomTypeFilter]);

  // ---------- 24h alert analytics ----------
  const last24hCut = startOfDay(new Date(Date.now() - 24 * 3600 * 1000));
  const recent24 = useMemo(
    () =>
      records.filter((r) => {
        const dt = r.booked_datetime ? new Date(r.booked_datetime) : new Date(r.created_at);
        return dt >= last24hCut;
      }),
    [records, last24hCut],
  );

  const alertLines = useMemo(() => {
    const agg = aggregateByArrival(recent24);
    const todayISO = toISODate(new Date());
    const tomorrowISO = toISODate(new Date(Date.now() + 86400000));

    // Top arrival date by total nights (gross) within recent 24h
    let top: DayAgg | null = null;
    for (const v of agg.values()) {
      if (!top || v.nights > top.nights) top = v;
    }
    const getLine = (dateISO: string): string => {
      const a = agg.get(dateISO);
      if (!a) return '0 phòng — ADR: 0đ — Doanh thu: 0đ — Cancellation: 0';
      return `${a.nights} phòng — ADR: ${formatVND(Math.round(a.adr))} — Doanh thu: ${formatVND(Math.round(a.revenue))} — Cancellation: ${a.cancelCount}`;
    };
    return {
      top: top
        ? `${toDMY(top.date)} | ${top.nights} phòng — ADR: ${formatVND(Math.round(top.adr))} — Doanh thu: ${formatVND(Math.round(top.revenue))} — Cancellation: ${top.cancelCount}`
        : '—',
      today: getLine(todayISO),
      tomorrow: getLine(tomorrowISO),
    };
  }, [recent24]);

  // ---------- Period summary ----------
  const periodSummary = useMemo(() => {
    const agg = aggregateByArrival(filtered);
    let top: DayAgg | null = null;
    for (const v of agg.values()) {
      if (!top || v.nights > top.nights) top = v;
    }
    return top
      ? `${toDMY(top.date)} | ADR: ${formatVND(Math.round(top.adr))} | Doanh thu: ${formatVND(Math.round(top.revenue))} | Cancellation: ${top.cancelCount}`
      : '—';
  }, [filtered]);

  // ---------- Pagination ----------
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ---------- Summary footer (Room Nights = quantity * nights) ----------
  const summary = useMemo(() => {
    let nights = 0;
    let revenue = 0;
    let count = 0;
    for (const r of filtered) {
      if (r.status === 'Cancelled') continue;
      nights += roomNights(r);
      revenue += Number(r.room_revenue) || 0;
      count++;
    }
    return { nights, revenue, adr: nights > 0 ? revenue / nights : 0, count };
  }, [filtered]);

  // ---------- Peak booking hour analysis (uses BookedDatetime) ----------
  const peakHour = useMemo(() => {
    const buckets = new Map<string, { nights: number; bookings: number }>();
    for (const r of filtered) {
      const dt = r.booked_datetime ? parseBookedDateTime(r.booked_datetime) : null;
      if (!dt) continue;
      const hh = String(dt.getHours()).padStart(2, '0');
      const key = `${hh}:00`;
      const cur = buckets.get(key) || { nights: 0, bookings: 0 };
      cur.nights += roomNights(r);
      cur.bookings += 1;
      buckets.set(key, cur);
    }
    let top: { hour: string; nights: number; bookings: number } | null = null;
    for (const [hour, v] of buckets) {
      if (!top || v.nights > top.nights) top = { hour, nights: v.nights, bookings: v.bookings };
    }
    if (!top) return null;
    const endHour = String((Number(top.hour.split(':')[0]) + 1)).padStart(2, '0');
    return { range: `${top.hour} - ${endHour}:00`, nights: top.nights, bookings: top.bookings };
  }, [filtered]);

  const toggleRoomType = (rt: string) => {
    setRoomTypeFilter((prev) => (prev.includes(rt) ? prev.filter((x) => x !== rt) : [...prev, rt]));
  };

  const modeOptions: { key: Mode; label: string }[] = [
    { key: 'gross', label: 'Gross Pickup' },
    { key: 'net', label: 'Net Pickup' },
    { key: 'cancel', label: 'Cancel' },
  ];

  return (
    <div className="space-y-4 fade-in">
      {toast && (
        <div
          className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-pop text-sm fade-in max-w-sm ${
            toast.kind === 'ok'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : toast.kind === 'err'
                ? 'bg-red-50 border border-red-200 text-red-800'
                : 'bg-navy-50 border border-navy-200 text-navy-800'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div>
        <h1 className="text-lg font-semibold text-navy-800">PU Report — Báo cáo Pickup</h1>
        <p className="text-xs text-navy-400 mt-0.5">
          Phân tích đặt phòng theo ngày đến, kênh bán và loại phòng. Mỗi lần import sẽ thêm dữ liệu mới (không ghi đè).
        </p>
      </div>

      {/* ============ SECTION 1: ANALYTICS ============ */}
      <Card className="p-4 space-y-4">
        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="gold" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload size={16} /> {importing ? 'Đang import…' : 'Import Báo Cáo Pickup'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFilePicked}
          />
          <Button variant="secondary" onClick={downloadSampleExcel}>
            <Download size={16} /> Tải file Excel dữ liệu mẫu
          </Button>
          <Button variant="subtle" onClick={() => setHistoryOpen(true)}>
            <History size={16} /> Lịch sử cập nhật
          </Button>
          <span className="ml-auto text-xs text-navy-400">{records.length} dòng pickup đã lưu</span>
        </div>

        {/* Hotel multi-select dropdown */}
        <div className="flex flex-wrap items-start gap-3">
          <Field label="Khách sạn (chọn một hoặc nhiều)" className="w-full max-w-md">
            <div className="relative">
              <details className="group">
                <summary className="flex items-center justify-between w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-navy-400 list-none">
                  <span className="truncate">
                    {selectedHotelIds.length === 0
                      ? 'Chọn khách sạn…'
                      : selectedHotelIds.length === 1
                        ? [...hotels].find((h) => h.id === selectedHotelIds[0])?.name || '1 khách sạn'
                        : `${selectedHotelIds.length} khách sạn đã chọn`}
                  </span>
                  <svg className="w-4 h-4 text-navy-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </summary>
                <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto thin-scroll rounded-lg border border-navy-200 bg-white shadow-pop space-y-0.5 p-1.5">
                  {hotels.length === 0 && (
                    <div className="text-xs text-navy-400 px-2 py-1.5">Chưa có khách sạn được gán.</div>
                  )}
                  {[...hotels]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((h: Hotel) => (
                      <label
                        key={h.id}
                        className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded px-2 py-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedHotelIds.includes(h.id)}
                          onChange={() => {
                            setSelectedHotelIds((prev) =>
                              prev.includes(h.id)
                                ? prev.filter((x) => x !== h.id)
                                : [...prev, h.id],
                            );
                            setPage(1);
                          }}
                          className="accent-gold-500"
                        />
                        {h.name}
                      </label>
                    ))}
                </div>
              </details>
            </div>
          </Field>
        </div>

        {/* Mode selector */}
        {isFullAccess && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-navy-700 uppercase tracking-wide">Chế độ xem</span>
          <div className="inline-flex bg-navy-50 rounded-lg p-1 gap-1">
            {modeOptions.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setMode(m.key);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === m.key ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-600 hover:bg-navy-100'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* 24h overview box */}
        {isFullAccess && (
        <div className="rounded-xl border border-gold-500/30 bg-gradient-to-br from-gold-500/10 to-navy-50/40 p-4 space-y-2">
          <div className="flex items-center gap-2 text-gold-700 font-semibold text-sm">
            <CalendarClock size={16} /> Tổng quan 24h gần nhất
          </div>
          <div className="text-sm text-navy-800 space-y-1.5">
            <div className="flex items-start gap-2">
              <CalendarClock size={15} className="text-gold-600 mt-0.5 flex-shrink-0" />
              <span>
                <span className="text-navy-500">Ngày đến được đặt nhiều nhất:</span>{' '}
                <span className="font-semibold">{alertLines.top}</span>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CalendarClock size={15} className="text-navy-500 mt-0.5 flex-shrink-0" />
              <span>
                <span className="text-navy-500">Hôm nay:</span>{' '}
                <span className="font-semibold mono-num">{alertLines.today}</span>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CalendarClock size={15} className="text-navy-500 mt-0.5 flex-shrink-0" />
              <span>
                <span className="text-navy-500">Ngày mai:</span>{' '}
                <span className="font-semibold mono-num">{alertLines.tomorrow}</span>
              </span>
            </div>
          </div>
        </div>
        )}

        {/* Peak booking hour card */}
        {isFullAccess && peakHour && (
        <div className="rounded-xl border border-navy-200 bg-white px-4 py-3 flex items-center gap-3">
          <Clock size={18} className="text-navy-600 flex-shrink-0" />
          <div className="text-sm text-navy-800">
            <span className="text-navy-500">Khung giờ PU nhiều nhất:</span>{' '}
            <span className="font-semibold mono-num text-navy-800">{peakHour.range}</span>
            <span className="text-navy-400 mx-1">·</span>
            <span className="mono-num">{peakHour.nights} phòng</span>
            <span className="text-navy-400 mx-1">·</span>
            <span className="mono-num">{peakHour.bookings} booking</span>
          </div>
        </div>
        )}

        {/* Period filter bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <Field label="Từ ngày (BookedDatetime)">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
              />
            </Field>
          </div>
          <div className="lg:col-span-3">
            <Field label="Đến ngày (BookedDatetime)">
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
              />
            </Field>
          </div>
          <div className="lg:col-span-3">
            <Field label="Kênh bán (Source)">
              <Select
                value={sourceFilter}
                onChange={(v) => {
                  setSourceFilter(v);
                  setPage(1);
                }}
              >
                <option value="all">Tất cả kênh</option>
                {allSources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="lg:col-span-3">
            <Field label="Loại phòng (Multi-select)">
              <div className="max-h-28 overflow-y-auto thin-scroll rounded-lg border border-navy-200 p-2 bg-white space-y-1">
                {allRoomTypes.length === 0 && (
                  <div className="text-xs text-navy-400">Chưa có loại phòng.</div>
                )}
                {allRoomTypes.map((rt) => (
                  <label
                    key={rt}
                    className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded px-1.5 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={roomTypeFilter.includes(rt)}
                      onChange={() => toggleRoomType(rt)}
                      className="accent-gold-500"
                    />
                    {rt}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </div>

        {/* Period summary */}
        {isFullAccess && (
        <div className="rounded-lg bg-navy-50 border border-navy-100 px-4 py-3 text-sm text-navy-700">
          <span className="text-navy-500">Top ngày được đặt nhiều nhất trong giai đoạn:</span>{' '}
          <span className="font-semibold mono-num text-navy-800">{periodSummary}</span>
        </div>
        )}
      </Card>

      {/* ============ SECTION 2: DATA MATRIX TABLE ============ */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-50 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-navy-800">Dữ liệu Pickup (sắp xếp theo cập nhật mới nhất)</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-navy-400">Số dòng/trang:</span>
            <Select
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
              className="w-24"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto thin-scroll">
          {loading ? (
            <div className="p-4">
              <EmptyState message="Đang tải dữ liệu…" />
            </div>
          ) : pageRows.length === 0 ? (
            <div className="p-4">
              <EmptyState message="Chưa có dòng pickup nào. Hãy import báo cáo pickup để bắt đầu." />
            </div>
          ) : (
            <table className="w-full text-sm min-w-[960px]">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Thời gian cập nhật</th>
                  <th className="text-left px-3 py-2 font-semibold">Ngày đến (Arrival)</th>
                  <th className="text-left px-3 py-2 font-semibold">Thứ</th>
                  <th className="text-left px-3 py-2 font-semibold">Kênh bán (Source)</th>
                  <th className="text-left px-3 py-2 font-semibold">Loại phòng</th>
                  <th className="text-right px-3 py-2 font-semibold">Room Nights</th>
                  {isFullAccess && <th className="text-right px-3 py-2 font-semibold">Doanh thu PU</th>}
                  {isFullAccess && <th className="text-right px-3 py-2 font-semibold">ADR trung bình</th>}
                  <th className="text-left px-3 py-2 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const arrDate = r.arrival_date ? new Date(r.arrival_date + 'T00:00:00') : null;
                  const weekday = arrDate ? WEEKDAY_VI[arrDate.getDay()] : '—';
                  const isSaturday = arrDate?.getDay() === 6;
                  const nights = roomNights(r);
                  const revenue = Number(r.room_revenue) || 0;
                  const adr = nights > 0 ? revenue / nights : 0;
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-navy-50 ${isSaturday ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="px-3 py-2.5 mono-num text-navy-500 text-xs whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString('vi-VN')}
                      </td>
                      <td className="px-3 py-2.5 mono-num text-navy-700 whitespace-nowrap">
                        {toDMY(r.arrival_date)}
                      </td>
                      <td className={`px-3 py-2.5 ${isSaturday ? 'text-amber-700 font-semibold' : 'text-navy-600'}`}>
                        {weekday}
                      </td>
                      <td className="px-3 py-2.5 text-navy-700">{r.source || '—'}</td>
                      <td className="px-3 py-2.5 text-navy-700">{r.room_type || '—'}</td>
                      <td className="px-3 py-2.5 text-right mono-num text-navy-700">{nights}</td>
                      {isFullAccess && (
                        <td className="px-3 py-2.5 text-right mono-num font-semibold text-navy-800">
                          {formatVND(revenue)}
                        </td>
                      )}
                      {isFullAccess && (
                        <td className="px-3 py-2.5 text-right mono-num text-navy-600">
                          {formatVND(Math.round(adr))}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        {r.status === 'Cancelled' ? (
                          <Badge tone="red">Cancelled</Badge>
                        ) : (
                          <Badge tone="green">Confirmed</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy-100 bg-navy-50/60 font-semibold">
                  <td colSpan={isFullAccess ? 5 : 4} className="px-3 py-3 text-navy-700 text-sm">
                    Tổng cộng ({summary.count} booking confirmed)
                  </td>
                  <td className="px-3 py-3 text-right mono-num text-navy-800">{summary.nights}</td>
                  {isFullAccess && (
                    <td className="px-3 py-3 text-right mono-num text-navy-800">{formatVND(Math.round(summary.revenue))}</td>
                  )}
                  {isFullAccess && (
                    <td className="px-3 py-3 text-right mono-num text-gold-600">{formatVND(Math.round(summary.adr))}</td>
                  )}
                  <td className="px-3 py-3" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Pagination controls */}
        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-navy-50 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-navy-400">
              Trang {safePage}/{totalPages} — {filtered.length} dòng
            </span>
            <div className="inline-flex gap-1">
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                ← Trước
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Sau →
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* History modal */}
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Lịch sử cập nhật (Nhật ký import)"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-3">
          {logs.length === 0 ? (
            <EmptyState message="Chưa có lần import nào." />
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="bg-navy-50 text-navy-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Thời gian import</th>
                    <th className="text-left px-3 py-2 font-semibold">Người dùng</th>
                    <th className="text-left px-3 py-2 font-semibold">Tên file</th>
                    <th className="text-right px-3 py-2 font-semibold">Số dòng thêm</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-navy-50">
                      <td className="px-3 py-2.5 mono-num text-navy-600 text-xs whitespace-nowrap">
                        {new Date(l.imported_at).toLocaleString('vi-VN')}
                      </td>
                      <td className="px-3 py-2.5 text-navy-700 text-xs">
                        {(() => {
                          if (l.user_email) return l.user_email;
                          if (l.user_id) {
                            const usr = userMap.get(l.user_id);
                            if (usr) return usr.email || usr.username;
                          }
                          return '—';
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-navy-700 text-xs">{l.file_name}</td>
                      <td className="px-3 py-2.5 text-right mono-num font-semibold text-navy-800">
                        {l.total_rows}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setHistoryOpen(false)}>
              Đóng
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
