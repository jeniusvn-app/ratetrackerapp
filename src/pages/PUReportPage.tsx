import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  Clock,
  CalendarDays,
  Download,
  FileText,
  History,
  Layers,
  TrendingUp,
  Upload,
  BarChart2,
  LineChart,
  Swords,
  ClipboardList,
  Save,
  XCircle,
  Database,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { supabase } from '@/lib/supabase';
import { useAuth, canAccessFullPuReport, getMiniRmsAccess } from '@/auth/AuthContext';
import { Badge, Button, Card, EmptyState, Field, Modal, Select } from '@/components/ui';
import { formatVND, toDMY, toISODate, excelSerialToDate } from '@/lib/format';
import type { Hotel } from '@/types';
import { MiniRMSAnalytics } from '@/components/MiniRMSAnalytics';
import { CompsetTab } from '@/components/CompsetTab';
import { DatePicker } from '@/components/DatePicker';

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
  cancel_date: string | null;
}

type Mode = 'gross' | 'net' | 'cancel';
type Toast = { kind: 'ok' | 'err' | 'info'; text: string } | null;

const WEEKDAY_VI = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

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

// Enforce logical consistency: Arrival must be >= BookedDatetime.
// Records where Arrival precedes BookedDatetime are invalid legacy entries.
function isValidArrivalBooked(r: PickupRecord): boolean {
  if (!r.arrival_date || !r.booked_datetime) return true;
  const booked = parseBookedDateTime(r.booked_datetime);
  if (!booked) return true;
  return r.arrival_date >= toISODate(booked);
}

// Compute peak booking hour range from a set of records
function computePeakHour(recs: PickupRecord[]): { range: string; nights: number; bookings: number } | null {
  const buckets = new Map<string, { nights: number; bookings: number }>();
  for (const r of recs) {
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
  const endHour = String(Number(top.hour.split(':')[0]) + 1).padStart(2, '0');
  return { range: `${top.hour} - ${endHour}:00`, nights: top.nights, bookings: top.bookings };
}

// Compute top source by room nights from a set of records
function computeTopSource(recs: PickupRecord[]): { source: string; nights: number } | null {
  const map = new Map<string, number>();
  for (const r of recs) {
    const src = r.source || 'Không xác định';
    map.set(src, (map.get(src) || 0) + roomNights(r));
  }
  let best: { source: string; nights: number } | null = null;
  for (const [source, nights] of map) {
    if (!best || nights > best.nights) best = { source, nights };
  }
  return best;
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

// ---------- Cancellation Sample Excel generator ----------
function buildCancellationSampleRows(): (string | number)[][] {
  return [
    ['Code', 'Room Type', 'Rate', 'Arrival', 'Departure', 'Reason', 'Source', 'Cancelled Date'],
    ['5526503577', 'Economy Double', '445054', '19/01', '20/01', 'Customer Request', 'BOOKING.COM', '02/10/2026'],
    ['5526503580', 'Deluxe City View', '1250000', '20/01', '23/01', 'Price too high', 'Traveloka', '03/10/2026'],
    ['5526503582', 'Suite', '2100000', '21/01', '23/01', 'Schedule change', 'AGODA', '05/10/2026'],
  ];
}

function downloadCancellationSampleExcel() {
  const rows = buildCancellationSampleRows();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 20 }, { wch: 18 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cancellation Sample');
  XLSX.writeFile(wb, 'Mau_Bao_Cao_Cancellation_Sample.xlsx');
}

// ---------- Analytics helpers ----------
interface DayAgg {
  date: string;
  nights: number;
  revenue: number;
  cancelCount: number;
  adr: number;
}

interface SourceAggRow {
  source: string;
  nights: number;
  revenue: number;
  adr: number;
  cancelCount: number;
  cancelNights: number;
  peakRange: string | null;
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
  const isUploadOnly = !isFullAccess && getMiniRmsAccess(user) === 'data_only';
  const canSeeRevenue = isFullAccess;
  const [activeTab, setActiveTab] = useState<'pu' | 'analytics' | 'compset'>('pu');

  const [records, setRecords] = useState<PickupRecord[]>([]);
  const [logs, setLogs] = useState<PickupImportLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfSelection, setPdfSelection] = useState({ block1: true, block2: true, block3: true });
  const block1Ref = useRef<HTMLDivElement | null>(null);
  const block2Ref = useRef<HTMLDivElement | null>(null);
  const block3Ref = useRef<HTMLDivElement | null>(null);

  // Hotel filter (single-select) with click-outside dropdown
  const [selectedHotelId, setSelectedHotelId] = useState<string>('');
  const [hotelOpen, setHotelOpen] = useState(false);
  const hotelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hotelOpen) return;
    const handler = (e: MouseEvent) => {
      if (hotelRef.current && !hotelRef.current.contains(e.target as Node)) {
        setHotelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [hotelOpen]);

  // Manual rooms sold (lifted state — shared between Tab 1 and Tab 2)
  const [manualSold, setManualSold] = useState<Map<string, number>>(new Map());
  const [manualDraft, setManualDraft] = useState<Map<string, string>>(new Map());
  const [savingManual, setSavingManual] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Load manual rooms sold for 30-day window
  const loadManualSold = useCallback(async () => {
    if (!selectedHotelId) {
      setManualSold(new Map());
      return;
    }
    const today = toISODate(new Date());
    const end30 = toISODate(new Date(Date.now() + 30 * 86400000));
    const { data } = await supabase
      .from('manual_rooms_sold')
      .select('date, actual_rooms_sold')
      .eq('hotel_id', selectedHotelId)
      .gte('date', today)
      .lte('date', end30);
    const map = new Map<string, number>();
    ((data as { date: string; actual_rooms_sold: number }[]) || []).forEach((row) => {
      map.set(row.date, row.actual_rooms_sold);
    });
    setManualSold(map);
  }, [selectedHotelId]);

  useEffect(() => {
    loadManualSold();
  }, [loadManualSold]);

  // Sync manual draft when manualSold changes
  useEffect(() => {
    const draft = new Map<string, string>();
    manualSold.forEach((v, k) => draft.set(k, String(v)));
    setManualDraft(draft);
  }, [manualSold]);

  // Save manual rooms sold for a single date
  const saveManualSold = async (date: string) => {
    if (!selectedHotelId) return;
    setSavingManual(true);
    setManualMsg(null);
    const val = Number(manualDraft.get(date) || 0) || 0;
    const { error } = await supabase
      .from('manual_rooms_sold')
      .upsert({ hotel_id: selectedHotelId, date, actual_rooms_sold: val }, { onConflict: 'hotel_id,date' });
    if (error) {
      setManualMsg({ kind: 'err', text: `Lỗi lưu rooms sold: ${error.message}` });
    } else {
      setManualSold((prev) => new Map(prev).set(date, val));
      setManualMsg({ kind: 'ok', text: `Đã lưu rooms sold cho ${toDMY(date)}.` });
    }
    setSavingManual(false);
  };

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
  const cancelFileRef = useRef<HTMLInputElement | null>(null);
  const [sampleDropdownOpen, setSampleDropdownOpen] = useState(false);
  const sampleDropdownRef = useRef<HTMLDivElement>(null);

  // 30-day date list for manual rooms sold grid
  const manualDates = useMemo(() => {
    const arr: string[] = [];
    const now = new Date();
    for (let i = 0; i < 30; i++) arr.push(toISODate(new Date(now.getTime() + i * 86400000)));
    return arr;
  }, []);

  // PU sold counts per date (from records, for the manual grid)
  const puSoldByDate = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      if (r.status === 'Cancelled' || !r.arrival_date) return;
      const cur = map.get(r.arrival_date) ?? 0;
      map.set(r.arrival_date, cur + (Number(r.quantity) || 1));
    });
    return map;
  }, [records]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    let recQuery = supabase.from('pickup_records').select('*').order('created_at', { ascending: false }).limit(2000);
    if (selectedHotelId) {
      recQuery = recQuery.eq('hotel_id', selectedHotelId);
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
  }, [selectedHotelId]);

  // Default hotel selection: first assigned hotel sorted alphabetically
  useEffect(() => {
    if (hotels.length > 0 && !selectedHotelId) {
      const sorted = [...hotels].sort((a, b) => a.name.localeCompare(b.name));
      setSelectedHotelId(sorted[0].id);
    }
  }, [hotels, selectedHotelId]);

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
        // Validate logical consistency: Arrival must be >= BookedDatetime
        if (bookedDate && arrDate && toISODate(arrDate) < toISODate(bookedDate)) {
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
        hotel_id: selectedHotelId || null,
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

  const onCancelFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleCancellationImport(f);
  };

  // Close sample dropdown on outside click
  useEffect(() => {
    if (!sampleDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (sampleDropdownRef.current && !sampleDropdownRef.current.contains(e.target as Node)) {
        setSampleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sampleDropdownOpen]);

  // ---------- Cancellation Import & Reconciliation ----------
  const handleCancellationImport = async (file: File) => {
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

      interface CancelRow {
        code: string;
        roomType: string;
        rate: number;
        arrival: string;
        departure: string;
        source: string;
        cancelledDate: string | null;
      }

      const cancelRows: CancelRow[] = [];
      let skipped = 0;
      for (const raw of json) {
        const code = String(raw['Code'] ?? raw['code'] ?? raw['Booking ID'] ?? raw['booking_id'] ?? '').trim();
        const roomType = String(raw['Room Type'] ?? raw['room_type'] ?? '').trim();
        const rate = Number(String(raw['Rate'] ?? raw['Room Rate'] ?? raw['room_rate'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const arrivalRaw = raw['Arrival'] ?? raw['arrival'];
        const departureRaw = raw['Departure'] ?? raw['departure'];
        const source = String(raw['Source'] ?? raw['source'] ?? '').trim();
        const cancelledRaw = raw['Cancelled Date'] ?? raw['cancelled_date'] ?? raw['Cancel Date'] ?? raw['cancel_date'] ?? null;

        const arrDate = arrivalRaw ? excelSerialToDate(arrivalRaw) : null;
        const depDate = departureRaw ? excelSerialToDate(departureRaw) : null;
        const cancelDate = cancelledRaw ? excelSerialToDate(cancelledRaw) : null;

        if (!code) {
          skipped++;
          continue;
        }

        cancelRows.push({
          code,
          roomType: roomType.toLowerCase().trim(),
          rate,
          arrival: arrDate ? toISODate(arrDate) : '',
          departure: depDate ? toISODate(depDate) : '',
          source: source.toLowerCase().trim(),
          cancelledDate: cancelDate ? toISODate(cancelDate) : null,
        });
      }

      if (cancelRows.length === 0) {
        setToast({ kind: 'err', text: `Không có dòng hợp lệ.${skipped ? ` Bỏ qua ${skipped} dòng.` : ''}` });
        setImporting(false);
        return;
      }

      // Load all existing pickup records for the selected hotel to match against
      const matchQuery = selectedHotelId
        ? supabase.from('pickup_records').select('*').eq('hotel_id', selectedHotelId)
        : supabase.from('pickup_records').select('*');
      const { data: existing } = await matchQuery;
      const existingRecs = (existing as PickupRecord[]) || [];

      let matched = 0;
      let unmatched = 0;

      for (const cr of cancelRows) {
        // Match by Code (booking_id), Room Type, Rate, Arrival, Departure, and Source
        const match = existingRecs.find((r) => {
          if ((r.booking_id || '').trim() !== cr.code) return false;
          if ((r.room_type || '').toLowerCase().trim() !== cr.roomType) return false;
          if (Number(r.room_rate) !== cr.rate) return false;
          if (cr.arrival && (r.arrival_date || '') !== cr.arrival) return false;
          if (cr.departure && (r.departure_date || '') !== cr.departure) return false;
          if (cr.source && ((r.source || '').toLowerCase().trim() !== cr.source)) return false;
          return true;
        });

        if (match) {
          const { error: updErr } = await supabase
            .from('pickup_records')
            .update({ status: 'Cancelled', cancel_date: cr.cancelledDate })
            .eq('id', match.id);
          if (updErr) {
            // Continue even if one update fails
          } else {
            matched++;
          }
        } else {
          unmatched++;
        }
      }

      setToast({
        kind: matched > 0 ? 'ok' : 'info',
        text: `Đã xử lý ${cancelRows.length} dòng hủy. Khớp ${matched} booking, không khớp ${unmatched}.${skipped ? ` Bỏ qua ${skipped} dòng.` : ''}`,
      });
      await loadAll();
    } catch (e) {
      setToast({ kind: 'err', text: `Lỗi đọc file hủy: ${(e as Error).message}` });
    } finally {
      setImporting(false);
      if (cancelFileRef.current) cancelFileRef.current.value = '';
    }
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

  // ============ BLOCK 1 & 2: REAL-TIME 24H (fixed rolling window, ignores date picker) ============
  // Strict rolling window: BookedDatetime >= (now - 24h)
  const cut24h = useMemo(() => new Date(Date.now() - 24 * 3600 * 1000), []);
  const recent24 = useMemo(
    () =>
      records.filter((r) => {
        if (!isValidArrivalBooked(r)) return false;
        const dt = r.booked_datetime ? parseBookedDateTime(r.booked_datetime) : new Date(r.created_at);
        if (!dt) return false;
        return dt >= cut24h;
      }),
    [records, cut24h],
  );

  // Block 1: 24h overview KPIs
  const overview24h = useMemo(() => {
    const confirmed = recent24.filter((r) => r.status !== 'Cancelled');
    const nights = recent24.reduce((s, r) => s + roomNights(r), 0);
    const revenue = confirmed.reduce((s, r) => s + (Number(r.room_revenue) || 0), 0);
    const confirmedNights = confirmed.reduce((s, r) => s + roomNights(r), 0);
    const adr = confirmedNights > 0 ? revenue / confirmedNights : 0;
    const peak = computePeakHour(recent24);
    const topSrc = computeTopSource(recent24);
    const agg = aggregateByArrival(recent24);
    let peakArrival: DayAgg | null = null;
    for (const v of agg.values()) {
      if (!peakArrival || v.nights > peakArrival.nights) peakArrival = v;
    }
    const todayISO = toISODate(new Date());
    const tomorrowISO = toISODate(new Date(Date.now() + 86400000));
    const getLine = (dateISO: string): string => {
      const a = agg.get(dateISO);
      if (!a) return '0 đêm phòng — ADR: 0đ — Doanh thu: 0đ — Cancellation: 0';
      return `${a.nights} đêm phòng — ADR: ${formatVND(Math.round(a.adr))} — Doanh thu: ${formatVND(Math.round(a.revenue))} — Cancellation: ${a.cancelCount}`;
    };
    return {
      nights,
      revenue,
      adr,
      peak,
      topSrc,
      peakArrival: peakArrival
        ? { date: peakArrival.date, label: `${toDMY(peakArrival.date)} | ${peakArrival.nights} đêm phòng — ADR: ${formatVND(Math.round(peakArrival.adr))} — Doanh thu: ${formatVND(Math.round(peakArrival.revenue))} — Cancellation: ${peakArrival.cancelCount}` }
        : null,
      today: getLine(todayISO),
      tomorrow: getLine(tomorrowISO),
    };
  }, [recent24]);

  // Block 2: Source analytics 24h table
  const source24hRows = useMemo<SourceAggRow[]>(() => {
    interface InternalRow extends SourceAggRow {
      _hourBuckets: Map<string, number>;
    }
    const map = new Map<string, InternalRow>();
    for (const r of recent24) {
      const src = r.source || 'Không xác định';
      const rn = roomNights(r);
      const isCancel = r.status === 'Cancelled';
      const dt = r.booked_datetime ? parseBookedDateTime(r.booked_datetime) : null;
      const hourKey = dt ? `${String(dt.getHours()).padStart(2, '0')}:00` : null;
      const cur = map.get(src) || {
        source: src, nights: 0, revenue: 0, adr: 0, cancelCount: 0, cancelNights: 0, peakRange: null,
        _hourBuckets: new Map<string, number>(),
      };
      cur.nights += rn;
      if (isCancel) { cur.cancelCount += 1; cur.cancelNights += rn; }
      else { cur.revenue += Number(r.room_revenue) || 0; }
      if (hourKey) cur._hourBuckets.set(hourKey, (cur._hourBuckets.get(hourKey) || 0) + rn);
      map.set(src, cur);
    }
    const rows: SourceAggRow[] = [];
    for (const v of map.values()) {
      v.adr = v.nights > 0 ? v.revenue / v.nights : 0;
      let topHour: { hour: string; nights: number } | null = null;
      for (const [hour, nights] of v._hourBuckets) {
        if (!topHour || nights > topHour.nights) topHour = { hour, nights };
      }
      if (topHour) {
        const endH = String(Number(topHour.hour.split(':')[0]) + 1).padStart(2, '0');
        v.peakRange = `${topHour.hour} - ${endH}:00`;
      }
      const { _hourBuckets, ...rest } = v;
      void _hourBuckets;
      rows.push(rest);
    }
    rows.sort((a, b) => b.nights - a.nights);
    return rows;
  }, [recent24]);

  // ============ BLOCK 3: CUSTOM PERIOD ANALYTICS (uses date picker, falls back to 24h) ============
  const hasPeriod = fromDate !== '' || toDate !== '';
  const periodHeader = hasPeriod
    ? `Thống kê theo giai đoạn đặt: ${fromDate ? toDMY(fromDate) : '…'} - ${toDate ? toDMY(toDate) : '…'}`
    : 'Thống kê 24h vừa qua';

  const periodRecords = useMemo(() => {
    if (!hasPeriod) return recent24;
    return records.filter((r) => {
      if (!isValidArrivalBooked(r)) return false;
      if (mode === 'net' && r.status !== 'Confirmed') return false;
      if (mode === 'cancel' && r.status !== 'Cancelled') return false;
      const booked = r.booked_datetime ? parseBookedDateTime(r.booked_datetime) : null;
      const bookedISO = booked ? toISODate(booked) : '';
      if (fromDate && bookedISO && bookedISO < fromDate) return false;
      if (toDate && bookedISO && bookedISO > toDate) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (roomTypeFilter.length > 0 && !roomTypeFilter.includes(r.room_type || '')) return false;
      return true;
    });
  }, [hasPeriod, recent24, records, mode, fromDate, toDate, sourceFilter, roomTypeFilter]);

  const periodStats = useMemo(() => {
    const confirmed = periodRecords.filter((r) => r.status !== 'Cancelled');
    const nights = periodRecords.reduce((s, r) => s + roomNights(r), 0);
    const revenue = confirmed.reduce((s, r) => s + (Number(r.room_revenue) || 0), 0);
    const confirmedNights = confirmed.reduce((s, r) => s + roomNights(r), 0);
    const adr = confirmedNights > 0 ? revenue / confirmedNights : 0;
    const topSource = computeTopSource(periodRecords);
    const peak = computePeakHour(periodRecords);
    return { nights, revenue, adr, count: confirmed.length, topSource, peak };
  }, [periodRecords]);

  // Block 3: Arrival distribution matrix within the booked period
  const periodArrivalMatrix = useMemo(() => {
    const agg = aggregateByArrival(periodRecords);
    return Array.from(agg.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [periodRecords]);

  // ---------- Pagination (uses `filtered` for the data table) ----------
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

  const selectedHotelName = useMemo(() => {
    return hotels.find((h) => h.id === selectedHotelId)?.name || '';
  }, [selectedHotelId, hotels]);

  const handleExportPDF = async () => {
    if (!pdfSelection.block1 && !pdfSelection.block2 && !pdfSelection.block3) {
      setToast({ kind: 'err', text: 'Vui lòng chọn ít nhất một khối để xuất PDF.' });
      return;
    }
    setPdfExporting(true);
    setToast({ kind: 'info', text: 'Đang tạo file PDF...' });
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;

      const now = new Date();
      const ts = `${toDMY(toISODate(now))} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const hotelName = selectedHotelName || 'Tất cả khách sạn';

      const renderHeader = () => {
        pdf.setFillColor(26, 31, 59);
        pdf.rect(0, 0, pageWidth, 50, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.text('BÁO CÁO PICKUP REPORT', margin, 22);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Khách sạn: ${hotelName}`, margin, 36);
        pdf.text(`Xuất lúc: ${ts}`, pageWidth - margin - 120, 36);
      };

      let yCursor = 70;

      const addCanvasToPDF = async (el: HTMLDivElement | null, title: string) => {
        if (!el) return;
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = pageWidth - margin * 2;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        pdf.setTextColor(26, 31, 59);
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text(title, margin, yCursor);
        yCursor += 10;

        if (yCursor + imgHeight > pageHeight - margin) {
          pdf.addPage();
          renderHeader();
          yCursor = 70;
        }
        pdf.addImage(imgData, 'PNG', margin, yCursor, imgWidth, imgHeight);
        yCursor += imgHeight + 15;
      };

      renderHeader();

      if (pdfSelection.block1) {
        await addCanvasToPDF(block1Ref.current, 'Tổng quan 24h (Real-time)');
      }
      if (pdfSelection.block2) {
        if (yCursor + 100 > pageHeight - margin) {
          pdf.addPage();
          renderHeader();
          yCursor = 70;
        }
        await addCanvasToPDF(block2Ref.current, 'Thống kê theo nguồn 24h (Real-time)');
      }
      if (pdfSelection.block3) {
        if (yCursor + 100 > pageHeight - margin) {
          pdf.addPage();
          renderHeader();
          yCursor = 70;
        }
        await addCanvasToPDF(block3Ref.current, periodHeader);
      }

      const dateStr = toISODate(now).replace(/-/g, '');
      const safeHotel = hotelName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      pdf.save(`Bao_Cao_Pickup_${safeHotel}_${dateStr}.pdf`);
      setToast({ kind: 'ok', text: 'Đã xuất file PDF thành công!' });
      setPdfModalOpen(false);
    } catch (e) {
      setToast({ kind: 'err', text: `Lỗi khi xuất file PDF: ${(e as Error).message}` });
    } finally {
      setPdfExporting(false);
    }
  };

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
        <h1 className="text-lg font-semibold text-navy-800">MiniRMS</h1>
      </div>

      {/* ============ TAB NAVIGATION (Level 1 — Main Tabs) ============ */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setActiveTab('pu')}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm transition-all duration-200 border ${
            activeTab === 'pu'
              ? 'bg-[#E9967A] text-black font-semibold shadow-md shadow-[#E9967A]/25 border-[#D98265]'
              : 'bg-[#FFE4C4] hover:bg-[#FFDAB9] text-black font-medium border-[#FFE4C4]'
          }`}
        >
          <BarChart3 size={18} className={activeTab === 'pu' ? 'text-black' : 'text-black/50'} />
          Data & PU Report
        </button>
        {isFullAccess && (
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm transition-all duration-200 border ${
            activeTab === 'analytics'
              ? 'bg-[#E9967A] text-black font-semibold shadow-md shadow-[#E9967A]/25 border-[#D98265]'
              : 'bg-[#FFE4C4] hover:bg-[#FFDAB9] text-black font-medium border-[#FFE4C4]'
          }`}
        >
          <LineChart size={18} className={activeTab === 'analytics' ? 'text-black' : 'text-black/50'} />
          Analytics
        </button>
        )}
        {isFullAccess && (
        <button
          onClick={() => setActiveTab('compset')}
          className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm transition-all duration-200 border ${
            activeTab === 'compset'
              ? 'bg-[#E9967A] text-black font-semibold shadow-md shadow-[#E9967A]/25 border-[#D98265]'
              : 'bg-[#FFE4C4] hover:bg-[#FFDAB9] text-black font-medium border-[#FFE4C4]'
          }`}
        >
          <Swords size={18} className={activeTab === 'compset' ? 'text-black' : 'text-black/50'} />
          Compset
        </button>
        )}
      </div>

      {/* ============ SHARED HOTEL SELECTOR (all tabs) ============ */}
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Khách sạn" className="w-full max-w-md">
          <div className="relative" ref={hotelRef}>
            <button
              type="button"
              onClick={() => setHotelOpen(!hotelOpen)}
              className="flex items-center justify-between w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-navy-400"
            >
              <span className="truncate">
                {selectedHotelId
                  ? [...hotels].find((h) => h.id === selectedHotelId)?.name || 'Khách sạn'
                  : 'Chọn khách sạn…'}
              </span>
              <svg className={`w-4 h-4 text-black/50 transition-transform ${hotelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {hotelOpen && (
              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto thin-scroll rounded-lg border border-navy-200 bg-white shadow-pop space-y-0.5 p-1.5">
                {hotels.length === 0 && (
                  <div className="text-xs text-navy-400 px-2 py-1.5">Chưa có khách sạn được gán.</div>
                )}
                {[...hotels]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((h: Hotel) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        setSelectedHotelId(h.id);
                        setPage(1);
                        setHotelOpen(false);
                      }}
                      className={`flex items-center gap-2 w-full text-sm text-left cursor-pointer hover:bg-navy-50 rounded px-2 py-1.5 ${selectedHotelId === h.id ? 'bg-[#FFE4C4] text-black font-semibold' : 'text-black'}`}
                    >
                      {selectedHotelId === h.id && <span className="w-1.5 h-1.5 rounded-full bg-[#E9967A] flex-shrink-0" />}
                      {h.name}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </Field>
      </div>

      {activeTab === 'analytics' && isFullAccess && selectedHotelId && (
        <MiniRMSAnalytics hotelId={selectedHotelId} manualSold={manualSold} />
      )}
      {activeTab === 'analytics' && !isFullAccess && (
        <Card className="p-4">
          <EmptyState message="Bạn không có quyền truy cập tab Analytics & MiniRMS." />
        </Card>
      )}

      {activeTab === 'compset' && isFullAccess && selectedHotelId && (
        <CompsetTab hotelId={selectedHotelId} />
      )}
      {activeTab === 'compset' && !isFullAccess && (
        <Card className="p-4">
          <EmptyState message="Bạn không có quyền truy cập tab Compset." />
        </Card>
      )}

      {activeTab === 'pu' && (<>

      {/* ============ CENTRAL DATA INPUT HUB ============ */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm border-b border-navy-50 pb-2">
          <Database size={16} className="text-gold-600" />
          Trung tâm nhập dữ liệu — 3 module
        </div>

        {/* Module 1 & 2: Import buttons */}
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
          <Button variant="secondary" onClick={() => cancelFileRef.current?.click()} disabled={importing}>
            <XCircle size={16} /> Import Booking Hủy (Cancelled)
          </Button>
          <input
            ref={cancelFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onCancelFilePicked}
          />
          {isFullAccess && (
            <Button variant="secondary" onClick={() => setPdfModalOpen(true)} disabled={pdfExporting}>
              <FileText size={16} /> {pdfExporting ? 'Đang tạo PDF…' : 'Xuất PDF'}
            </Button>
          )}
          <div className="relative" ref={sampleDropdownRef}>
            <Button variant="secondary" onClick={() => setSampleDropdownOpen((v) => !v)}>
              <Download size={16} /> Tải file Excel dữ liệu mẫu
            </Button>
            {sampleDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 bg-white rounded-lg border border-navy-200 shadow-pop py-1 min-w-[260px] fade-in">
                <button
                  onClick={() => { downloadSampleExcel(); setSampleDropdownOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2"
                  style={{ color: '#123C69' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#EEE2DC'; e.currentTarget.style.color = '#AC3B61'; const svg = e.currentTarget.querySelector('svg'); if (svg) svg.style.color = '#AC3B61'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = '#123C69'; const svg = e.currentTarget.querySelector('svg'); if (svg) svg.style.color = '#123C69'; }}
                >
                  <Download size={14} style={{ color: '#123C69' }} />
                  File báo cáo Pickup mẫu
                </button>
                <button
                  onClick={() => { downloadCancellationSampleExcel(); setSampleDropdownOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 border-t border-navy-50"
                  style={{ color: '#123C69' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#EEE2DC'; e.currentTarget.style.color = '#AC3B61'; const svg = e.currentTarget.querySelector('svg'); if (svg) svg.style.color = '#AC3B61'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = '#123C69'; const svg = e.currentTarget.querySelector('svg'); if (svg) svg.style.color = '#123C69'; }}
                >
                  <Download size={14} style={{ color: '#123C69' }} />
                  File báo cáo Cancellation mẫu
                </button>
              </div>
            )}
          </div>
          <Button variant="subtle" onClick={() => setHistoryOpen(true)}>
            <History size={16} /> Lịch sử cập nhật
          </Button>
          <span className="ml-auto text-xs text-navy-400">{records.length} dòng pickup đã lưu</span>
        </div>

        {/* Module 3: Manual Actual Rooms Sold — 30-day grid */}
        <div className="rounded-lg border border-navy-200 bg-white p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-navy-600 uppercase tracking-wide">
            <ClipboardList size={14} className="text-gold-600" />
            Module 3: Nhập thủ công Rooms Sold thực tế (30 ngày)
          </div>
          {manualMsg && (
            <div className={`text-xs ${manualMsg.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{manualMsg.text}</div>
          )}
          <div className="overflow-x-auto thin-scroll max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-navy-50 text-navy-700 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-2 font-semibold">Ngày đến</th>
                  <th className="text-left px-2 py-2 font-semibold">Thứ</th>
                  <th className="text-right px-2 py-2 font-semibold">PU Sold</th>
                  <th className="text-center px-2 py-2 font-semibold">Manual Rooms Sold</th>
                  <th className="text-right px-2 py-2 font-semibold">Effective Sold</th>
                  <th className="w-12 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {manualDates.map((d) => {
                  const dt = new Date(d + 'T00:00:00');
                  const weekday = WEEKDAY_VI[dt.getDay()] || '—';
                  const isSaturday = dt.getDay() === 6;
                  const pu = puSoldByDate.get(d) ?? 0;
                  const manual = Number(manualDraft.get(d) || 0) || 0;
                  const effective = Math.max(pu, manual);
                  return (
                    <tr key={d} className={`border-t border-navy-50 ${isSaturday ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-2 py-1.5 mono-num text-navy-700 whitespace-nowrap">{toDMY(d)}</td>
                      <td className={`px-2 py-1.5 ${isSaturday ? 'text-amber-700 font-semibold' : 'text-navy-600'}`}>{weekday}</td>
                      <td className="px-2 py-1.5 text-right mono-num text-navy-500">{pu}</td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          value={manualDraft.get(d) ?? ''}
                          onChange={(e) => setManualDraft((prev) => new Map(prev).set(d, e.target.value))}
                          placeholder="0"
                          className="w-20 text-center bg-white border border-navy-200 rounded-md px-1.5 py-1 text-xs text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right mono-num font-semibold text-navy-800">{effective}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => saveManualSold(d)}
                          disabled={savingManual}
                          className="p-1 rounded-md text-navy-400 hover:bg-navy-100 hover:text-navy-700"
                          title="Lưu"
                        >
                          <Save size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                  mode === m.key ? 'bg-[#E9967A] text-black shadow-sm' : 'text-black hover:bg-[#FFE4C4]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* ============ BLOCK 1: REAL-TIME 24H OVERVIEW ============ */}
        {isFullAccess && (
        <div ref={block1Ref} className="rounded-xl border border-gold-500/30 bg-gradient-to-br from-gold-500/10 to-navy-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-gold-700 font-semibold text-sm">
            <TrendingUp size={16} /> Tổng quan 24h (Real-time)
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg bg-white/70 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">Tổng PU Room Nights (24h)</div>
              <div className="text-lg font-bold mono-num text-navy-800">{overview24h.nights}</div>
            </div>
            <div className="rounded-lg bg-white/70 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">Tổng Doanh thu (24h)</div>
              <div className="text-lg font-bold mono-num text-navy-800">{formatVND(Math.round(overview24h.revenue))}</div>
            </div>
            <div className="rounded-lg bg-white/70 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">ADR trung bình (24h)</div>
              <div className="text-lg font-bold mono-num text-navy-800">{formatVND(Math.round(overview24h.adr))}</div>
            </div>
            <div className="rounded-lg bg-white/70 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">Khung giờ PU nhiều nhất</div>
              <div className="text-sm font-bold mono-num text-navy-800">{overview24h.peak ? overview24h.peak.range : '—'}</div>
              {overview24h.peak && <div className="text-xs mono-num text-navy-500">{overview24h.peak.nights} đêm phòng · {overview24h.peak.bookings} booking</div>}
            </div>
          </div>
          <div className="text-sm text-navy-800 space-y-1.5">
            {overview24h.topSrc && (
              <div className="flex items-start gap-2">
                <BarChart3 size={15} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="text-navy-500">Top Nguồn 24h:</span>{' '}
                  <span className="font-semibold">{overview24h.topSrc.source}</span>
                  <span className="text-navy-400"> · {overview24h.topSrc.nights} đêm phòng</span>
                </span>
              </div>
            )}
            {overview24h.peakArrival && (
              <div className="flex items-start gap-2">
                <CalendarClock size={15} className="text-gold-600 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="text-navy-500">Ngày đến được đặt nhiều nhất:</span>{' '}
                  <span className="font-semibold">{overview24h.peakArrival.label}</span>
                </span>
              </div>
            )}
            <div className="flex items-start gap-2">
              <CalendarClock size={15} className="text-navy-500 mt-0.5 flex-shrink-0" />
              <span>
                <span className="text-navy-500">Hôm nay:</span>{' '}
                <span className="font-semibold mono-num">{overview24h.today}</span>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CalendarClock size={15} className="text-navy-500 mt-0.5 flex-shrink-0" />
              <span>
                <span className="text-navy-500">Ngày mai:</span>{' '}
                <span className="font-semibold mono-num">{overview24h.tomorrow}</span>
              </span>
            </div>
          </div>
        </div>
        )}

        {/* ============ BLOCK 2: REAL-TIME 24H SOURCE ANALYTICS ============ */}
        {isFullAccess && (
        <div ref={block2Ref} className="rounded-xl border border-navy-200 bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 text-navy-700 font-semibold text-sm">
            <Layers size={16} /> Thống kê theo nguồn 24h (Real-time)
          </div>
          {source24hRows.length === 0 ? (
            <EmptyState message="Không có dữ liệu PU trong 24h qua." />
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-xs">
                <thead className="bg-navy-50 text-navy-700">
                  <tr>
                    <th className="text-left px-2.5 py-2 font-semibold">Nguồn</th>
                    <th className="text-right px-2.5 py-2 font-semibold">Room Nights</th>
                    <th className="text-right px-2.5 py-2 font-semibold">ADR</th>
                    <th className="text-right px-2.5 py-2 font-semibold">Doanh thu</th>
                    <th className="text-right px-2.5 py-2 font-semibold">Hủy phòng</th>
                    <th className="text-left px-2.5 py-2 font-semibold whitespace-nowrap">Khung giờ đặt nhiều nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {source24hRows.map((row) => (
                    <tr key={row.source} className="border-t border-navy-50">
                      <td className="px-2.5 py-2 font-medium text-navy-800">{row.source}</td>
                      <td className="px-2.5 py-2 text-right mono-num text-navy-700">{row.nights}</td>
                      <td className="px-2.5 py-2 text-right mono-num text-navy-600">{formatVND(Math.round(row.adr))}</td>
                      <td className="px-2.5 py-2 text-right mono-num font-semibold text-navy-800">{formatVND(Math.round(row.revenue))}</td>
                      <td className="px-2.5 py-2 text-right mono-num text-red-600">
                        {row.cancelCount > 0 ? `${row.cancelCount} (${row.cancelNights} đêm phòng)` : '0'}
                      </td>
                      <td className="px-2.5 py-2 mono-num text-navy-600 whitespace-nowrap">{row.peakRange || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {/* ============ BLOCK 3: CUSTOM PERIOD ANALYTICS ============ */}
        {isFullAccess && (
        <div ref={block3Ref} className="rounded-xl border border-navy-300 bg-white p-4 space-y-4">
          <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
            <CalendarDays size={16} /> {periodHeader}
          </div>

          {/* Period filter bar */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-3">
              <Field label="Từ ngày đặt">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                  className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                />
              </Field>
            </div>
            <div className="lg:col-span-3">
              <Field label="Đến ngày đặt">
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                  className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                />
              </Field>
            </div>
            <div className="lg:col-span-3">
              <Field label="Kênh bán (Source)">
                <Select
                  value={sourceFilter}
                  onChange={(v) => { setSourceFilter(v); setPage(1); }}
                >
                  <option value="all">Tất cả kênh</option>
                  {allSources.map((s) => (
                    <option key={s} value={s}>{s}</option>
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
                        className="accent-[#E9967A]"
                      />
                      {rt}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          {/* Period KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">Tổng Room Nights</div>
              <div className="text-lg font-bold mono-num text-navy-800">{periodStats.nights}</div>
            </div>
            <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">Tổng Doanh thu</div>
              <div className="text-lg font-bold mono-num text-navy-800">{formatVND(Math.round(periodStats.revenue))}</div>
            </div>
            <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">ADR trung bình</div>
              <div className="text-lg font-bold mono-num text-navy-800">{formatVND(Math.round(periodStats.adr))}</div>
            </div>
            <div className="rounded-lg bg-navy-50 border border-navy-100 px-3 py-2.5">
              <div className="text-xs text-navy-500">Top Nguồn</div>
              <div className="text-sm font-bold text-navy-800">{periodStats.topSource ? periodStats.topSource.source : '—'}</div>
              {periodStats.topSource && <div className="text-xs mono-num text-navy-500">{periodStats.topSource.nights} đêm phòng</div>}
            </div>
          </div>

          {/* Peak booking hour for period */}
          {periodStats.peak && (
            <div className="rounded-lg bg-navy-50 border border-navy-100 px-4 py-3 text-sm text-navy-700 flex items-center gap-3">
              <Clock size={16} className="text-navy-600 flex-shrink-0" />
              <span>
                <span className="text-navy-500">Khung giờ PU nhiều nhất:</span>{' '}
                <span className="font-semibold mono-num text-navy-800">{periodStats.peak.range}</span>
                <span className="text-navy-400 mx-1">·</span>
                <span className="mono-num">{periodStats.peak.nights} đêm phòng · {periodStats.peak.bookings} booking</span>
              </span>
            </div>
          )}

          {/* Arrival distribution matrix */}
          {periodArrivalMatrix.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-navy-600 uppercase tracking-wide">Phân bổ PU theo ngày đến (Arrival)</div>
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-xs">
                  <thead className="bg-navy-50 text-navy-700">
                    <tr>
                      <th className="text-left px-2.5 py-2 font-semibold">Ngày đến</th>
                      <th className="text-left px-2.5 py-2 font-semibold">Thứ</th>
                      <th className="text-right px-2.5 py-2 font-semibold">Room Nights</th>
                      <th className="text-right px-2.5 py-2 font-semibold">Doanh thu</th>
                      <th className="text-right px-2.5 py-2 font-semibold">ADR</th>
                      <th className="text-right px-2.5 py-2 font-semibold pr-4">Hủy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodArrivalMatrix.map((d) => {
                      const dt = new Date(d.date + 'T00:00:00');
                      const weekday = WEEKDAY_VI[dt.getDay()] || '—';
                      const isSaturday = dt.getDay() === 6;
                      return (
                        <tr key={d.date} className={`border-t border-navy-50 ${isSaturday ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-2.5 py-2 mono-num text-navy-700 whitespace-nowrap">{toDMY(d.date)}</td>
                          <td className={`px-2.5 py-2 ${isSaturday ? 'text-amber-700 font-semibold' : 'text-navy-600'}`}>{weekday}</td>
                          <td className="px-2.5 py-2 text-right mono-num text-navy-700">{d.nights}</td>
                          <td className="px-2.5 py-2 text-right mono-num font-semibold text-navy-800">{formatVND(Math.round(d.revenue))}</td>
                          <td className="px-2.5 py-2 text-right mono-num text-navy-600">{formatVND(Math.round(d.adr))}</td>
                          <td className="px-2.5 py-2 text-right mono-num text-red-600 pr-4">{d.cancelCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState message="Không có dữ liệu trong giai đoạn đã chọn." />
          )}
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
                  <th className="text-left px-3 py-2 font-semibold">Ngày hủy</th>
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
                      <td className="px-3 py-2.5 mono-num text-navy-500 text-xs whitespace-nowrap">
                        {r.cancel_date ? toDMY(r.cancel_date) : '—'}
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

      </>
      )}

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

      {/* PDF Export Modal */}
      <Modal
        open={pdfModalOpen}
        onClose={() => !pdfExporting && setPdfModalOpen(false)}
        title="Tùy Chọn Xuất Báo Cáo PDF"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="subtle" size="sm" onClick={() => setPdfSelection({ block1: true, block2: true, block3: true })}>
              Chọn tất cả
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setPdfSelection({ block1: false, block2: false, block3: false })}>
              Bỏ chọn
            </Button>
          </div>
          <div className="space-y-2.5">
            <label className="flex items-center gap-3 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded-lg px-3 py-2.5">
              <input
                type="checkbox"
                checked={pdfSelection.block1}
                onChange={(e) => setPdfSelection((p) => ({ ...p, block1: e.target.checked }))}
                className="accent-[#E9967A] w-4 h-4"
              />
              <TrendingUp size={16} className="text-gold-600" />
              Tổng quan 24h (Real-time)
            </label>
            <label className="flex items-center gap-3 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded-lg px-3 py-2.5">
              <input
                type="checkbox"
                checked={pdfSelection.block2}
                onChange={(e) => setPdfSelection((p) => ({ ...p, block2: e.target.checked }))}
                className="accent-[#E9967A] w-4 h-4"
              />
              <Layers size={16} className="text-navy-600" />
              Thống kê theo nguồn 24h (Real-time)
            </label>
            <label className="flex items-center gap-3 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded-lg px-3 py-2.5">
              <input
                type="checkbox"
                checked={pdfSelection.block3}
                onChange={(e) => setPdfSelection((p) => ({ ...p, block3: e.target.checked }))}
                className="accent-[#E9967A] w-4 h-4"
              />
              <CalendarDays size={16} className="text-navy-600" />
              Thống kê theo giai đoạn đặt
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-navy-100">
            <Button variant="secondary" onClick={() => setPdfModalOpen(false)} disabled={pdfExporting}>
              Hủy
            </Button>
            <Button variant="gold" onClick={handleExportPDF} disabled={pdfExporting}>
              <FileText size={16} /> {pdfExporting ? 'Đang tạo PDF…' : 'Xuất PDF ngay'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
