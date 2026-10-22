import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Plus, CalendarRange, CheckSquare, Square } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthContext';
import { useRoomTypes } from '@/lib/useRoomTypes';
import type { DailyRate, DateRange, Hotel, PriceMatrix, RoomType } from '@/types';
import { Button, Select, Card, Field, Badge, EmptyState, Modal, Input } from '@/components/ui';
import { formatVND, normCode, toDMY, toISODate, excelSerialToDate } from '@/lib/format';
import { notifyRatesUpdated, expandDateRanges, totalDaysInRanges } from '@/lib/rateSync';

interface RoomPriceOverride {
  roomTypeId: string;
  selling: string;
  net: string;
  cms: string;
  b2b: string;
}

export function DailyRateUpdatePage() {
  const { hotels } = useAuth();
  const [hotelId, setHotelId] = useState('');
  const [applyAllRoomTypes, setApplyAllRoomTypes] = useState(false);
  const [selectedRoomTypeIds, setSelectedRoomTypeIds] = useState<string[]>([]);
  const [rateCode, setRateCode] = useState('');
  const [dateRanges, setDateRanges] = useState<DateRange[]>([
    { start: toISODate(new Date()), end: toISODate(new Date()) },
  ]);
  // Day-of-week selection: [Sun, Mon, Tue, Wed, Thu, Fri, Sat] (JS getDay index)
  const [selectedDOW, setSelectedDOW] = useState<boolean[]>([true, true, true, true, true, true, true]);
  const DOW_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const [priceOverrides, setPriceOverrides] = useState<Map<string, RoomPriceOverride>>(new Map());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [rows, setRows] = useState<DailyRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { roomTypes } = useRoomTypes(hotelId || null);
  const [matrix, setMatrix] = useState<PriceMatrix[]>([]);

  useEffect(() => {
    if (hotels.length && !hotelId) setHotelId(hotels[0].id);
  }, [hotels, hotelId]);

  useEffect(() => {
    setApplyAllRoomTypes(false);
    setSelectedRoomTypeIds([]);
    setRateCode('');
    setPriceOverrides(new Map());
  }, [hotelId]);

  useEffect(() => {
    (async () => {
      if (!hotelId) {
        setMatrix([]);
        return;
      }
      const { data } = await supabase.from('price_matrix').select('*').eq('hotel_id', hotelId);
      setMatrix((data as PriceMatrix[]) || []);
    })();
  }, [hotelId]);

  // All rate codes available for the selected hotel (across all room types)
  const rateCodes = useMemo(() => {
    const set = new Set<string>();
    matrix.forEach((m) => set.add(normCode(m.rate_code)));
    return Array.from(set).sort();
  }, [matrix]);

  const isDynamic = rateCode === 'Dynamic';

  // Auto-select first rate code when hotel changes or codes load
  useEffect(() => {
    if (rateCodes.length > 0 && !rateCode) {
      setRateCode(rateCodes[0]);
    }
  }, [rateCodes, rateCode]);

  // When "Select All" is toggled, update the selected room type ids
  useEffect(() => {
    if (applyAllRoomTypes) {
      setSelectedRoomTypeIds(roomTypes.map((rt) => rt.id));
    } else {
      // keep existing manual selections when unchecking "all"
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyAllRoomTypes]);

  // Target room types for preview / save
  const targetRoomTypes: RoomType[] = useMemo(() => {
    if (applyAllRoomTypes) return roomTypes;
    return roomTypes.filter((rt) => selectedRoomTypeIds.includes(rt.id));
  }, [applyAllRoomTypes, roomTypes, selectedRoomTypeIds]);

  // Matrix lookup for the selected rate code, keyed by room_type_id
  const matrixByRoomType = useMemo(() => {
    const m = new Map<string, PriceMatrix>();
    if (isDynamic) return m;
    for (const p of matrix) {
      if (normCode(p.rate_code) === normCode(rateCode)) {
        m.set(p.room_type_id, p);
      }
    }
    return m;
  }, [matrix, rateCode, isDynamic]);

  // Build / refresh price overrides when rate code or target room types change.
  // For matrix-based codes, auto-fill from price_matrix. For Dynamic, start blank.
  const previewRows = useMemo<RoomPriceOverride[]>(() => {
    return targetRoomTypes.map((rt) => {
      const existing = priceOverrides.get(rt.id);
      if (existing) {
        return existing;
      }
      const m = matrixByRoomType.get(rt.id);
      if (m) {
        return {
          roomTypeId: rt.id,
          selling: String(Number(m.selling_price)),
          net: String(Number(m.net_price)),
          cms: String(Number(m.cms_price)),
          b2b: m.b2b_price != null ? String(Number(m.b2b_price)) : '',
        };
      }
      // Dynamic or no matrix match: blank for manual entry
      return { roomTypeId: rt.id, selling: '', net: '', cms: '', b2b: '' };
    });
  }, [targetRoomTypes, matrixByRoomType, priceOverrides, isDynamic]);

  const updateOverride = (roomTypeId: string, field: keyof RoomPriceOverride, value: string) => {
    setPriceOverrides((prev) => {
      const next = new Map(prev);
      const cur = next.get(roomTypeId) || {
        roomTypeId,
        selling: '',
        net: '',
        cms: '',
        b2b: '',
      };
      next.set(roomTypeId, { ...cur, [field]: value });
      return next;
    });
  };

  // Reset overrides when rate code changes
  useEffect(() => {
    setPriceOverrides(new Map());
  }, [rateCode]);

  const loadRates = useCallback(async () => {
    if (!hotelId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('daily_rates')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('updated_at', { ascending: false })
      .limit(200);
    setRows((data as DailyRate[]) || []);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const totalDays = useMemo(() => totalDaysInRanges(dateRanges), [dateRanges]);

  // ---------- Date range helpers ----------
  const updateRange = (idx: number, field: 'start' | 'end', value: string) => {
    setDateRanges((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };
  const addRange = () => {
    const last = dateRanges[dateRanges.length - 1];
    const nextStart = last?.end || toISODate(new Date());
    setDateRanges((prev) => [...prev, { start: nextStart, end: nextStart }]);
  };
  const removeRange = (idx: number) => {
    if (dateRanges.length <= 1) return;
    setDateRanges((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------- Room type selection helpers ----------
  const toggleRoomType = (rtId: string) => {
    setSelectedRoomTypeIds((prev) =>
      prev.includes(rtId) ? prev.filter((x) => x !== rtId) : [...prev, rtId],
    );
    if (applyAllRoomTypes) setApplyAllRoomTypes(false);
  };

  // ---------- Save (batch UPSERT across all target room types × dates) ----------
  const save = async () => {
    setMsg(null);
    if (!hotelId || !rateCode) {
      setMsg({ kind: 'err', text: 'Vui lòng chọn khách sạn và mã giá.' });
      return;
    }
    if (targetRoomTypes.length === 0) {
      setMsg({ kind: 'err', text: 'Vui lòng chọn ít nhất một loại phòng.' });
      return;
    }
    const allDates = expandDateRanges(dateRanges);
    if (allDates.length === 0) {
      setMsg({ kind: 'err', text: 'Vui lòng chọn ít nhất một giai đoạn ngày hợp lệ.' });
      return;
    }
    // Filter dates by selected days of the week
    const dates = allDates.filter((d) => {
      const dow = new Date(d + 'T00:00:00').getDay();
      return selectedDOW[dow];
    });
    if (dates.length === 0) {
      setMsg({ kind: 'err', text: 'Không có ngày nào trong giai đoạn khớp với thứ được chọn. Vui lòng tích ít nhất một thứ.' });
      return;
    }
    // Validate every target room type has required prices
    for (const p of previewRows) {
      if (p.selling === '' || p.net === '' || p.cms === '') {
        const rt = roomTypes.find((x) => x.id === p.roomTypeId);
        setMsg({
          kind: 'err',
          text: `Vui lòng nhập đủ 3 mức giá cho ${rt?.name || 'loại phòng'}.`,
        });
        return;
      }
    }
    setSaving(true);
    // Build consolidated batch: room types × dates
    const insertRows: {
      hotel_id: string;
      room_type_id: string;
      date: string;
      rate_code: string;
      selling_price: number;
      net_price: number;
      cms_price: number;
      b2b_price: number | null;
    }[] = [];
    for (const p of previewRows) {
      for (const d of dates) {
        insertRows.push({
          hotel_id: hotelId,
          room_type_id: p.roomTypeId,
          date: d,
          rate_code: rateCode,
          selling_price: Number(p.selling),
          net_price: Number(p.net),
          cms_price: Number(p.cms),
          b2b_price: p.b2b.trim() === '' ? null : Number(p.b2b) || null,
        });
      }
    }
    const { error } = await supabase
      .from('daily_rates')
      .upsert(insertRows, { onConflict: 'hotel_id,room_type_id,date,rate_code' });
    if (error) {
      setMsg({ kind: 'err', text: `Lỗi lưu giá: ${error.message}` });
    } else {
      const rtCount = targetRoomTypes.length;
      setMsg({
        kind: 'ok',
        text: `Đã lưu ${dates.length} ngày × ${rtCount} loại phòng (${insertRows.length} bản ghi) — ${rateCode}. Trang tra cứu sẽ cập nhật ngay.`,
      });
      notifyRatesUpdated();
      await loadRates();
    }
    setSaving(false);
  };

  // ---------- Template download ----------
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Room Type', 'Rate Code', 'Date', 'Selling Price', 'Net Price', 'CMS Price', 'B2B Price'],
      ['Superior Double', 'BAR 1', toDMY(toISODate(new Date())), 990000, 841500, 760000, 750000],
      ['Deluxe Twin', 'BAR 3', toDMY(toISODate(new Date())), 1100000, 935000, 850000, ''],
    ]);
    ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Rates');
    const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arr], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau_daily_rates.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Bulk Excel Import ----------
  const handleImport = async (file: File) => {
    setImportBusy(true);
    setImportMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true, raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      const toInsert: {
        hotel_id: string;
        room_type_id: string;
        date: string;
        rate_code: string;
        selling_price: number;
        net_price: number;
        cms_price: number;
        b2b_price: number | null;
      }[] = [];
      let skipped = 0;

      for (const r of json) {
        const rtNameRaw = String(r['Room Type'] ?? r['room_type'] ?? '').trim();
        const rc = normCode(String(r['Rate Code'] ?? r['rate_code'] ?? ''));
        const dateRaw = r['Date'] ?? r['date'];
        const d = excelSerialToDate(dateRaw);
        const sp = Number(String(r['Selling Price'] ?? r['selling_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const np = Number(String(r['Net Price'] ?? r['net_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const cp = Number(String(r['CMS Price'] ?? r['cms_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const b2bRaw = String(r['B2B Price'] ?? r['b2b_price'] ?? '').trim();
        const b2bVal = b2bRaw === '' ? null : Number(b2bRaw.replace(/[^\d.-]/g, '')) || null;
        const rt = roomTypes.find((x) => x.name.trim().toLowerCase() === rtNameRaw.toLowerCase());
        if (!rt || !d || !rc) {
          skipped++;
          continue;
        }
        toInsert.push({
          hotel_id: rt.hotel_id,
          room_type_id: rt.id,
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          rate_code: rc,
          selling_price: sp,
          net_price: np,
          cms_price: cp,
          b2b_price: b2bVal,
        });
      }

      if (toInsert.length === 0) {
        setImportMsg({ kind: 'err', text: 'Không có dòng hợp lệ. Kiểm tra tên loại phòng, mã giá và cột ngày.' });
        setImportBusy(false);
        return;
      }

      const { error } = await supabase
        .from('daily_rates')
        .upsert(toInsert, { onConflict: 'hotel_id,room_type_id,date,rate_code' });
      if (error) {
        setImportMsg({ kind: 'err', text: `Lỗi nhập: ${error.message}` });
      } else {
        const txt =
          skipped > 0
            ? `Đã nhập ${toInsert.length} dòng thành công (bỏ qua ${skipped} dòng không hợp lệ).`
            : `Đã nhập ${toInsert.length} dòng thành công.`;
        setImportMsg({ kind: 'ok', text: txt });
        notifyRatesUpdated();
        await loadRates();
      }
    } catch (e) {
      setImportMsg({ kind: 'err', text: `Lỗi đọc tập tin: ${(e as Error).message}` });
    }
    setImportBusy(false);
  };

  return (
    <div className="space-y-4 fade-in">
      <Card className="p-4">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-navy-800">Bộ công cụ phân bổ giá tự động</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
          <Field label="Khách sạn">
            <Select value={hotelId} onChange={setHotelId}>
              {hotels.map((h: Hotel) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mã giá (Rate Code)" hint={isDynamic ? 'Nhập tay giá, không tra cứu ma trận' : 'BAR Standard, Non-Refundable, Corporate, Early Bird…'}>
            <Select value={rateCode} onChange={setRateCode}>
              {rateCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {rateCodes.length === 0 && <option value="">— Không có mã giá —</option>}
              <option value="Dynamic">Dynamic</option>
            </Select>
          </Field>
        </div>

        {/* Room type selector with Select All */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-navy-700">Loại phòng áp dụng</label>
            <button
              onClick={() => setApplyAllRoomTypes((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                applyAllRoomTypes
                  ? 'bg-gold-50 border-gold-200 text-gold-700'
                  : 'bg-white border-navy-200 text-navy-600 hover:bg-navy-50'
              }`}
            >
              {applyAllRoomTypes ? <CheckSquare size={16} /> : <Square size={16} />}
              Tất cả loại phòng
            </button>
          </div>
          {!applyAllRoomTypes && (
            <div className="space-y-1.5 max-h-44 overflow-y-auto thin-scroll rounded-lg border border-navy-200 p-2 bg-white">
              {roomTypes.map((rt) => (
                <label
                  key={rt.id}
                  className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded px-1.5 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedRoomTypeIds.includes(rt.id)}
                    onChange={() => toggleRoomType(rt.id)}
                    className="accent-[#E9967A]"
                  />
                  {rt.name}
                </label>
              ))}
              {roomTypes.length === 0 && (
                <div className="text-xs text-navy-400">Chưa có loại phòng cho khách sạn này.</div>
              )}
            </div>
          )}
          {applyAllRoomTypes && (
            <div className="rounded-lg bg-gold-50 border border-gold-100 px-3 py-2 text-sm text-gold-700">
              Áp dụng cho tất cả {roomTypes.length} loại phòng của khách sạn.
            </div>
          )}
        </div>

        {/* Multi-date range selector */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium text-navy-700">
              <CalendarRange size={16} className="text-gold-600" />
              Giai đoạn áp dụng
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-700 bg-navy-50 border border-navy-100 rounded-full px-2.5 py-1">
                Tổng: {totalDays} ngày được chọn
              </span>
              <Button variant="subtle" size="sm" onClick={addRange}>
                <Plus size={14} /> Thêm giai đoạn
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {dateRanges.map((range, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 bg-navy-50/50 border border-navy-100 rounded-lg p-2"
              >
                <span className="text-xs font-semibold text-navy-400 w-6 text-center flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="grid grid-cols-2 gap-2 flex-1">
                  <div>
                    <label className="text-[10px] text-navy-400 uppercase tracking-wide">Từ ngày</label>
                    <input
                      type="date"
                      value={range.start}
                      onChange={(e) => updateRange(idx, 'start', e.target.value)}
                      className="w-full bg-white border border-navy-200 rounded-lg px-2 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-navy-400 uppercase tracking-wide">Đến ngày</label>
                    <input
                      type="date"
                      value={range.end}
                      onChange={(e) => updateRange(idx, 'end', e.target.value)}
                      className="w-full bg-white border border-navy-200 rounded-lg px-2 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeRange(idx)}
                  disabled={dateRanges.length <= 1}
                  className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                  title="Xoá giai đoạn này"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          {/* Day-of-week selector */}
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm font-medium text-navy-700">Áp dụng theo thứ trong tuần</label>
              <button
                onClick={() => setSelectedDOW([true, true, true, true, true, true, true])}
                className="text-xs text-navy-500 hover:text-navy-700 underline"
              >
                Chọn tất cả
              </button>
              <button
                onClick={() => setSelectedDOW([false, false, false, false, false, false, false])}
                className="text-xs text-navy-500 hover:text-navy-700 underline"
              >
                Bỏ tất cả
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {DOW_LABELS.map((label, dowIdx) => (
                <label
                  key={dowIdx}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${
                    selectedDOW[dowIdx]
                      ? 'bg-gold-50 border-gold-200 text-gold-700'
                      : 'bg-white border-navy-200 text-navy-400 hover:bg-navy-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedDOW[dowIdx]}
                    onChange={() =>
                      setSelectedDOW((prev) => prev.map((v, i) => (i === dowIdx ? !v : v)))
                    }
                    className="accent-[#E9967A]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {isDynamic && (
          <div className="mt-3 text-xs text-gold-700 bg-gold-50 border border-gold-100 rounded-lg px-3 py-2">
            Đang ở chế độ Dynamic — bạn tự nhập các mức giá cho từng loại phòng, không lấy từ ma trận giá. Nhấn "Lưu Lịch Giá" để lưu thẳng vào lịch giá với mã <span className="font-semibold">Dynamic</span>.
          </div>
        )}

        {/* Dynamic Pricing Preview — per room type with editable overrides */}
        {targetRoomTypes.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-navy-700">
                Xem trước & chỉnh giá theo loại phòng
              </div>
              <span className="text-xs text-navy-400">
                {targetRoomTypes.length} loại phòng × {totalDays} ngày = {targetRoomTypes.length * totalDays} bản ghi
              </span>
            </div>
            <div className="overflow-x-auto thin-scroll rounded-lg border border-navy-100">
              <table className="w-full text-sm">
                <thead className="bg-navy-50 text-navy-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Loại phòng</th>
                    <th className="text-right px-3 py-2 font-semibold">Giá bán</th>
                    <th className="text-right px-3 py-2 font-semibold">Giá thu về</th>
                    <th className="text-right px-3 py-2 font-semibold">Giá CMS</th>
                    <th className="text-right px-3 py-2 font-semibold">Giá B2B</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((p) => {
                    const rt = roomTypes.find((x) => x.id === p.roomTypeId);
                    const hasMatrix = !isDynamic && matrixByRoomType.has(p.roomTypeId);
                    return (
                      <tr key={p.roomTypeId} className="border-t border-navy-50">
                        <td className="px-3 py-2 text-navy-700 font-medium whitespace-nowrap">
                          {rt?.name || '—'}
                          {hasMatrix && (
                            <span className="ml-2 text-[10px] text-navy-400 font-normal">(từ ma trận)</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={p.selling}
                            onChange={(e) => updateOverride(p.roomTypeId, 'selling', e.target.value)}
                            placeholder="990000"
                            className="w-full bg-white border border-navy-200 rounded-md px-2 py-1.5 text-sm text-right mono-num text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={p.net}
                            onChange={(e) => updateOverride(p.roomTypeId, 'net', e.target.value)}
                            placeholder="841500"
                            className="w-full bg-white border border-navy-200 rounded-md px-2 py-1.5 text-sm text-right mono-num text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={p.cms}
                            onChange={(e) => updateOverride(p.roomTypeId, 'cms', e.target.value)}
                            placeholder="760000"
                            className="w-full bg-white border border-navy-200 rounded-md px-2 py-1.5 text-sm text-right mono-num text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={p.b2b}
                            onChange={(e) => updateOverride(p.roomTypeId, 'b2b', e.target.value)}
                            placeholder="—"
                            className="w-full bg-white border border-navy-200 rounded-md px-2 py-1.5 text-sm text-right mono-num text-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-navy-400">
              Giá được tự động điền từ ma trận giá (price_matrix) khi chọn mã giá. Bạn có thể chỉnh từng ô nếu cần ghi đè.
            </div>
          </div>
        )}

        {msg && (
          <div
            className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              msg.kind === 'ok'
                ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
                : 'text-red-700 bg-red-50 border border-red-100'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-navy-50">
          <Button variant="gold" onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu Lịch Giá'}
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Nhập Excel
          </Button>
          <Button variant="subtle" size="sm" onClick={downloadTemplate}>
            Tải file mẫu (.xlsx)
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-navy-800">Bảng quản lý lịch giá</h3>
          <span className="text-xs text-navy-400">{rows.length} dòng gần nhất</span>
        </div>
        <div className="overflow-x-auto thin-scroll">
          {rows.length === 0 ? (
            <div className="p-4">
              <EmptyState message={loading ? 'Đang tải dữ liệu…' : 'Chưa có lịch giá cho khách sạn này.'} />
            </div>
          ) : (
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Ngày</th>
                  <th className="text-left px-3 py-2 font-semibold">Loại phòng</th>
                  <th className="text-left px-3 py-2 font-semibold">Mã giá</th>
                  <th className="text-right px-3 py-2 font-semibold">Giá bán</th>
                  <th className="text-right px-3 py-2 font-semibold">Giá thu về</th>
                  <th className="text-right px-3 py-2 font-semibold">Giá CMS</th>
                  <th className="text-right px-3 py-2 font-semibold">Giá B2B</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rt = roomTypes.find((x) => x.id === r.room_type_id);
                  return (
                    <tr key={r.id} className="border-t border-navy-50">
                      <td className="px-3 py-2.5 mono-num text-navy-700 whitespace-nowrap">{toDMY(r.date)}</td>
                      <td className="px-3 py-2.5 text-navy-700">{rt?.name || '—'}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone="neutral">{r.rate_code}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right mono-num font-semibold text-navy-800">
                        {formatVND(Number(r.selling_price))}
                      </td>
                      <td className="px-3 py-2.5 text-right mono-num text-navy-600">
                        {formatVND(Number(r.net_price))}
                      </td>
                      <td className="px-3 py-2.5 text-right mono-num text-gold-600">
                        {formatVND(Number(r.cms_price))}
                      </td>
                      <td className="px-3 py-2.5 text-right mono-num text-navy-500">
                        {r.b2b_price != null ? formatVND(Number(r.b2b_price)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Nhập Excel — Lịch giá hàng ngày">
        <div className="space-y-4">
          <p className="text-sm text-navy-600">
            Tập tin Excel cần có các cột:{' '}
            <span className="mono-num text-xs">
              Room Type | Rate Code | Date | Selling Price | Net Price | CMS Price | B2B Price
            </span>
            . Cột <span className="mono-num">B2B Price</span> là tuỳ chọn (để trống nếu không có). Ngày có thể là số serial Excel (vd: 46249) hoặc dạng{' '}
            <span className="mono-num">dd/mm/yyyy</span>. Mã giá sẽ được chuẩn hoá bằng{' '}
            <span className="mono-num">.trim().toUpperCase()</span> trước khi lưu.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = '';
            }}
            className="block w-full text-sm text-black file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#E9967A] file:text-black file:font-medium file:cursor-pointer hover:file:bg-[#D98265]"
          />
          {importMsg && (
            <div
              className={`text-sm rounded-lg px-3 py-2 ${
                importMsg.kind === 'err'
                  ? 'text-red-700 bg-red-50 border border-red-100'
                  : 'text-emerald-700 bg-emerald-50 border border-emerald-100'
              }`}
            >
              {importMsg.text}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={downloadTemplate}>
              Tải file mẫu
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importBusy}>
              Đóng
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
