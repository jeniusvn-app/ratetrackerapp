import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, Plus, CalendarRange } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, isAdmin } from '@/auth/AuthContext';
import { useRoomTypes } from '@/lib/useRoomTypes';
import type { DateRange, Hotel, PriceMatrix, RateChangeRequest, RoomType } from '@/types';
import { Button, Select, Card, Field, Badge, EmptyState, Modal, Input } from '@/components/ui';
import { normCode, toDMY, dateRangeISO, toISODate } from '@/lib/format';
import { notifyRatesUpdated, expandDateRanges, totalDaysInRanges, rangeBounds } from '@/lib/rateSync';
import { sendTelegramMessage, sendRateRequestTelegramNotification } from '@/services/telegramService';

type Toast = { kind: 'ok' | 'err' | 'info'; text: string } | null;

export function RateRequestsPage() {
  const { user, hotels, allHotels } = useAuth();
  const admin = isAdmin(user);

  // Form state
  const [formHotelId, setFormHotelId] = useState('');
  const [dateRanges, setDateRanges] = useState<DateRange[]>([
    { start: toISODate(new Date()), end: toISODate(new Date()) },
  ]);
  const [rateCode, setRateCode] = useState('');
  const [selectedRoomTypeIds, setSelectedRoomTypeIds] = useState<string[]>([]);
  const [dynSell, setDynSell] = useState('');
  const [dynNet, setDynNet] = useState('');
  const [dynB2b, setDynB2b] = useState('');
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Admin filters
  const [filterHotel, setFilterHotel] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const [requests, setRequests] = useState<RateChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [confirm, setConfirm] = useState<RateChangeRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RateChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const { roomTypes } = useRoomTypes(formHotelId || null);
  const [rateCodes, setRateCodes] = useState<string[]>([]);

  useEffect(() => {
    if (hotels.length && !formHotelId) setFormHotelId(hotels[0].id);
  }, [hotels, formHotelId]);

  useEffect(() => {
    (async () => {
      if (!formHotelId) {
        setRateCodes([]);
        setRateCode('');
        return;
      }
      const { data } = await supabase
        .from('price_matrix')
        .select('rate_code')
        .eq('hotel_id', formHotelId);
      const set = new Set<string>();
      (data || []).forEach((r: { rate_code: string }) => set.add(normCode(r.rate_code)));
      const arr = Array.from(set);
      setRateCodes(arr);
      if (arr.length > 0) setRateCode(arr[0]);
      else setRateCode('Dynamic');
    })();
  }, [formHotelId]);

  const hotelNameById = useCallback(
    (id: string) => [...allHotels].find((h) => h.id === id)?.name || '',
    [allHotels],
  );

  const loadRequests = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('rate_change_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (filterHotel !== 'all') q = q.eq('hotel_id', filterHotel);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    const { data } = await q;
    setRequests((data as RateChangeRequest[]) || []);
    setLoading(false);
  }, [filterHotel, filterStatus]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const isDynamic = rateCode === 'Dynamic';
  const isOther = rateCode === 'Other';
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

  // ---------- Submit ----------
  const submit = async () => {
    setFormMsg(null);
    if (!formHotelId) {
      setFormMsg({ kind: 'err', text: 'Vui lòng chọn khách sạn.' });
      return;
    }
    if (isOther) {
      if (!otherText.trim()) {
        setFormMsg({ kind: 'err', text: 'Vui lòng nhập nội dung yêu cầu khác.' });
        return;
      }
    } else if (!rateCode) {
      setFormMsg({ kind: 'err', text: 'Vui lòng chọn mã giá.' });
      return;
    }
    const validRanges = dateRanges.filter((r) => r.start && r.end && r.start <= r.end);
    const dates = expandDateRanges(validRanges);
    if (!isOther && dates.length === 0) {
      setFormMsg({ kind: 'err', text: 'Vui lòng chọn ít nhất một giai đoạn ngày hợp lệ.' });
      return;
    }
    if (isDynamic) {
      if (selectedRoomTypeIds.length === 0) {
        setFormMsg({ kind: 'err', text: 'Vui lòng chọn ít nhất một loại phòng cho yêu cầu Dynamic.' });
        return;
      }
      if (dynSell === '' && dynNet === '' && dynB2b === '') {
        setFormMsg({ kind: 'err', text: 'Vui lòng nhập ít nhất một mức giá (Giá bán, Giá thu về hoặc Giá B2B).' });
        return;
      }
    }
    const bounds = rangeBounds(validRanges);
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      hotel_id: formHotelId,
      start_date: bounds.start,
      end_date: bounds.end,
      date_ranges: validRanges.length > 0 ? validRanges : null,
      rate_code: isOther ? null : rateCode,
      status: 'Pending',
      created_by_user_id: user?.id,
      room_type_ids: isDynamic ? selectedRoomTypeIds : null,
      selling_price: isDynamic && dynSell !== '' ? Number(dynSell) : null,
      net_price: isDynamic && dynNet !== '' ? Number(dynNet) : null,
      b2b_price: isDynamic && dynB2b !== '' ? Number(dynB2b) : null,
      other_text: isOther ? otherText.trim() : null,
    };
    const { error } = await supabase.from('rate_change_requests').insert(payload);
    if (error) {
      setFormMsg({ kind: 'err', text: `Lỗi lưu yêu cầu: ${error.message}` });
      setSubmitting(false);
      return;
    }
    const hotelName = hotelNameById(formHotelId);
    const effectiveDate = validRanges
      .map((r) => `${toDMY(r.start)} → ${toDMY(r.end)}`)
      .join('; ');
    const roomTypeSummary = isOther
      ? 'Yêu cầu khác'
      : isDynamic
        ? selectedRoomTypeIds
            .map((id) => roomTypes.find((rt) => rt.id === id)?.name || id.slice(0, 8))
            .join(', ')
        : rateCode;
    const newRate = isDynamic
      ? [dynSell, dynNet, dynB2b].filter((v) => v !== '').join(' / ') || null
      : null;
    const reasonText = isOther
      ? `Yêu cầu khác: ${otherText.trim()}`
      : isDynamic
        ? 'Yêu cầu giá Dynamic'
        : `Áp dụng mã giá ${rateCode}`;
    try {
      await sendRateRequestTelegramNotification({
        hotel_name: hotelName,
        room_type: roomTypeSummary,
        effective_date: effectiveDate || '—',
        old_rate: null,
        new_rate: newRate,
        requested_by: user?.username || '—',
        reason: reasonText,
        created_at: new Date().toISOString(),
      });
    } catch {
      // non-blocking
    }
    setFormMsg({ kind: 'ok', text: 'Gửi yêu cầu chỉnh giá thành công! Bạn có thể tạo tiếp yêu cầu mới.' });
    setToast({ kind: 'ok', text: 'Gửi yêu cầu chỉnh giá thành công! Bạn có thể tạo tiếp yêu cầu mới.' });
    setSelectedRoomTypeIds([]);
    setDynSell('');
    setDynNet('');
    setDynB2b('');
    setOtherText('');
    setDateRanges([{ start: toISODate(new Date()), end: toISODate(new Date()) }]);
    setSubmitting(false);
    await loadRequests();
    try {
      document.querySelector('[data-rate-request-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      // ignore
    }
  };

  // ---------- Approve & Apply ----------
  const approveAndApply = async (req: RateChangeRequest) => {
    setActingId(req.id);
    setToast(null);
    try {
      const normTarget = req.rate_code ? normCode(req.rate_code) : '';

      // "Other Request" — no rates to apply, just mark approved
      if (normTarget === 'OTHER' || (!req.rate_code && req.other_text)) {
        await supabase
          .from('rate_change_requests')
          .update({ status: 'Approved' })
          .eq('id', req.id);
        const dateText = req.date_ranges && req.date_ranges.length > 0
          ? req.date_ranges.map((r) => `${toDMY(r.start)} → ${toDMY(r.end)}`).join('; ')
          : '—';
        await sendTelegramMessage(
          `<b>YÊU CẦU ĐÃ ĐƯỢC DUYỆT</b>\n` +
            `<b>Khách sạn:</b> ${hotelNameById(req.hotel_id)}\n` +
            `<b>Loại:</b> Yêu cầu khác\n` +
            `<b>Nội dung:</b> ${req.other_text || '—'}\n` +
            `<b>Giai đoạn:</b> ${dateText}`,
        );
        setToast({ kind: 'ok', text: 'Đã duyệt yêu cầu khác.' });
        await loadRequests();
        return;
      }

      // Use date_ranges if available, else fall back to start_date/end_date
      const ranges: DateRange[] =
        req.date_ranges && req.date_ranges.length > 0
          ? req.date_ranges
          : [{ start: req.start_date || '', end: req.end_date || '' }];
      const dates = expandDateRanges(ranges);
      if (dates.length === 0) {
        setToast({ kind: 'err', text: 'Khoảng ngày không hợp lệ.' });
        setActingId(null);
        return;
      }

      const { data: rts } = await supabase
        .from('room_types')
        .select('*')
        .eq('hotel_id', req.hotel_id);
      const roomTypes = (rts as RoomType[]) || [];

      const { data: pm } = await supabase
        .from('price_matrix')
        .select('*')
        .eq('hotel_id', req.hotel_id);
      const matrix = (pm as PriceMatrix[]) || [];

      const rows: {
        hotel_id: string;
        room_type_id: string;
        date: string;
        rate_code: string;
        selling_price: number;
        net_price: number;
        cms_price: number;
        b2b_price: number | null;
      }[] = [];

      if (normTarget === 'DYNAMIC') {
        const dynRoomTypeIds: string[] = (req.room_type_ids as string[] | null) || [];
        const sellNum = req.selling_price != null ? Number(req.selling_price) : null;
        const netNum = req.net_price != null ? Number(req.net_price) : null;
        const b2bNum = req.b2b_price != null ? Number(req.b2b_price) : null;
        for (const rtId of dynRoomTypeIds) {
          for (const date of dates) {
            rows.push({
              hotel_id: req.hotel_id,
              room_type_id: rtId,
              date,
              rate_code: 'Dynamic',
              selling_price: sellNum ?? 0,
              net_price: netNum ?? 0,
              cms_price: 0,
              b2b_price: b2bNum,
            });
          }
        }
      } else {
        for (const rt of roomTypes) {
          const matches = matrix.filter(
            (m) => m.room_type_id === rt.id && normCode(m.rate_code) === normTarget,
          );
          for (const m of matches) {
            for (const date of dates) {
              rows.push({
                hotel_id: req.hotel_id,
                room_type_id: rt.id,
                date,
                rate_code: m.rate_code,
                selling_price: Number(m.selling_price),
                net_price: Number(m.net_price),
                cms_price: Number(m.cms_price),
                b2b_price: m.b2b_price != null ? Number(m.b2b_price) : null,
              });
            }
          }
        }
      }

      if (rows.length === 0) {
        await supabase
          .from('rate_change_requests')
          .update({ status: 'Approved' })
          .eq('id', req.id);
        await sendTelegramMessage(
          `<b>YÊU CẦU CHỈNH GIÁ ĐÃ ĐƯỢC DUYỆT</b>\n` +
            `<b>Khách sạn:</b> ${hotelNameById(req.hotel_id)}\n` +
            `<b>Mã giá:</b> ${req.rate_code}\n` +
            `<b>Giai đoạn:</b> ${ranges.map((r) => `${toDMY(r.start)} → ${toDMY(r.end)}`).join('; ')}\n` +
            `<b>Trạng thái:</b> Đã cập nhật vào lịch giá Trang 1!`,
        );
        setToast({ kind: 'info', text: 'Đã duyệt nhưng không có giá trong price_matrix để áp dụng.' });
        await loadRequests();
        setActingId(null);
        return;
      }

      // Native UPSERT — latest overwrite
      const { error: upsertErr } = await supabase
        .from('daily_rates')
        .upsert(rows, { onConflict: 'hotel_id,room_type_id,date,rate_code' });
      if (upsertErr) throw upsertErr;

      // Notify calendar page to re-fetch
      notifyRatesUpdated();

      await supabase
        .from('rate_change_requests')
        .update({ status: 'Approved' })
        .eq('id', req.id);

      await sendTelegramMessage(
        `<b>YÊU CẦU CHỈNH GIÁ ĐÃ ĐƯỢC DUYỆT</b>\n` +
          `<b>Khách sạn:</b> ${hotelNameById(req.hotel_id)}\n` +
          `<b>Mã giá:</b> ${req.rate_code}\n` +
          `<b>Giai đoạn:</b> ${ranges.map((r) => `${toDMY(r.start)} → ${toDMY(r.end)}`).join('; ')}\n` +
          `<b>Trạng thái:</b> Đã cập nhật vào lịch giá Trang 1!`,
      );

      setToast({ kind: 'ok', text: `Đã duyệt và áp dụng ${rows.length} bản ghi giá vào lịch.` });
      await loadRequests();
    } catch (e) {
      setToast({ kind: 'err', text: `Lỗi khi áp dụng: ${(e as Error).message}` });
    } finally {
      setActingId(null);
    }
  };

  // ---------- Reject ----------
  const openRejectModal = (req: RateChangeRequest) => {
    setRejectTarget(req);
    setRejectReason('');
  };
  const closeRejectModal = () => {
    setRejectTarget(null);
    setRejectReason('');
    setRejecting(false);
  };
  const confirmReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setToast({ kind: 'err', text: 'Vui lòng nhập lý do từ chối.' });
      return;
    }
    setRejecting(true);
    setToast(null);
    const { error } = await supabase
      .from('rate_change_requests')
      .update({
        status: 'Rejected',
        rejection_reason: rejectReason.trim(),
        reviewed_by: user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', rejectTarget.id);
    if (error) {
      setToast({ kind: 'err', text: `Lỗi khi cập nhật trạng thái: ${error.message}` });
      setRejecting(false);
      return;
    }
    try {
      const roomTypeSummary =
        !rejectTarget.rate_code && rejectTarget.other_text
          ? 'Yêu cầu khác'
          : rejectTarget.rate_code === 'Dynamic' && Array.isArray(rejectTarget.room_type_ids)
            ? rejectTarget.room_type_ids
                .map((id) => roomTypes.find((rt) => rt.id === id)?.name || id.slice(0, 8))
                .join(', ')
            : rejectTarget.rate_code;
      const ranges: DateRange[] =
        rejectTarget.date_ranges && rejectTarget.date_ranges.length > 0
          ? rejectTarget.date_ranges
          : [{ start: rejectTarget.start_date || '', end: rejectTarget.end_date || '' }];
      await sendTelegramMessage(
        `❌ <b>YÊU CẦU CHỈNH GIÁ ĐÃ BỊ TỪ CHỐI</b>\n` +
          `• Khách sạn: <b>${hotelNameById(rejectTarget.hotel_id)}</b>\n` +
          `• Loại phòng: <b>${roomTypeSummary}</b>\n` +
          `• Giai đoạn: ${ranges.map((r) => `${toDMY(r.start)} → ${toDMY(r.end)}`).join('; ')}\n` +
          `• Lý do từ chối: <i>${rejectReason.trim()}</i>`,
      );
    } catch {
      // non-blocking
    }
    setToast({ kind: 'ok', text: 'Đã từ chối yêu cầu chỉnh giá!' });
    closeRejectModal();
    await loadRequests();
  };

  const statusBadge = (s: string) => {
    if (s === 'Approved') return <Badge tone="green">Đã duyệt</Badge>;
    if (s === 'Rejected') return <Badge tone="red">Từ chối</Badge>;
    return <Badge tone="amber">Chờ duyệt</Badge>;
  };

  const formatRequestDateRange = (r: RateChangeRequest) => {
    if (!r.start_date && !r.end_date && (!r.date_ranges || r.date_ranges.length === 0)) {
      return '—';
    }
    const ranges: DateRange[] =
      r.date_ranges && r.date_ranges.length > 0
        ? r.date_ranges
        : [{ start: r.start_date || '', end: r.end_date || '' }];
    return ranges.map((rg) => `${toDMY(rg.start)} → ${toDMY(rg.end)}`).join('; ');
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!formMsg) return;
    const t = setTimeout(() => setFormMsg(null), 5000);
    return () => clearTimeout(t);
  }, [formMsg]);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === 'Pending').length,
    [requests],
  );

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-1" data-rate-request-form>
          <h2 className="text-base font-semibold text-navy-800 mb-3">Tạo yêu cầu chỉnh giá</h2>
          <div className="space-y-3">
            <Field label="Khách sạn">
              <Select value={formHotelId} onChange={setFormHotelId}>
                {hotels.map((h: Hotel) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Multi-date range selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-sm font-medium text-navy-700">
                  <CalendarRange size={15} className="text-gold-600 text-[#A85644]" />
                  Giai đoạn áp dụng{isOther && <span className="text-xs font-normal text-navy-400">(tuỳ chọn)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-navy-700 bg-navy-50 border border-navy-100 rounded-full px-2 py-0.5">
                    Tổng: {totalDays} ngày
                  </span>
                  <Button variant="subtle" size="sm" onClick={addRange}>
                    <Plus size={14} /> Thêm
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {dateRanges.map((range, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 bg-navy-50/50 border border-navy-100 rounded-lg p-1.5"
                  >
                    <span className="text-xs font-semibold text-navy-400 w-5 text-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 flex-1">
                      <input
                        type="date"
                        value={range.start}
                        onChange={(e) => updateRange(idx, 'start', e.target.value)}
                        className="w-full bg-white border border-navy-200 rounded-md px-2 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                      />
                      <input
                        type="date"
                        value={range.end}
                        onChange={(e) => updateRange(idx, 'end', e.target.value)}
                        className="w-full bg-white border border-navy-200 rounded-md px-2 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                      />
                    </div>
                    <button
                      onClick={() => removeRange(idx)}
                      disabled={dateRanges.length <= 1}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      title="Xoá giai đoạn này"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <Field label="Mã giá (Rate Code)" hint={isDynamic ? 'Nhập tay giá, không tra cứu ma trận' : isOther ? 'Nhập nội dung yêu cầu tự do' : 'VD: BAR 1, BAR 3, PEAK 1, BREAKFAST…'}>
              <Select value={rateCode} onChange={setRateCode}>
                {rateCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="Dynamic">Dynamic</option>
                <option value="Other">Yêu cầu khác (Other Request)</option>
              </Select>
            </Field>
            {isOther && (
              <Field label="Nội dung yêu cầu" hint="Nhập nội dung tự do, ví dụ: 1/11-3/11 flash sales">
                <textarea
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  placeholder="Nhập nội dung yêu cầu…"
                  rows={4}
                  className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400 resize-none"
                  autoFocus
                />
              </Field>
            )}
            {isDynamic && (
              <>
                <Field label="Chọn loại phòng" hint="Chọn một hoặc nhiều loại phòng">
                  <div className="space-y-1.5 max-h-40 overflow-y-auto thin-scroll rounded-lg border border-navy-200 p-2 bg-white">
                    {roomTypes.map((rt) => (
                      <label
                        key={rt.id}
                        className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer hover:bg-navy-50 rounded px-1.5 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRoomTypeIds.includes(rt.id)}
                          onChange={(e) => {
                            setSelectedRoomTypeIds((prev) =>
                              e.target.checked
                                ? [...prev, rt.id]
                                : prev.filter((x) => x !== rt.id),
                            );
                          }}
                          className="accent-[#E9967A]"
                        />
                        {rt.name}
                      </label>
                    ))}
                    {roomTypes.length === 0 && (
                      <div className="text-xs text-navy-400">Chưa có loại phòng cho khách sạn này.</div>
                    )}
                  </div>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Giá bán (VND)" hint="Tuỳ chọn">
                    <Input value={dynSell} onChange={setDynSell} type="number" placeholder="990000" />
                  </Field>
                  <Field label="Giá thu về (VND)" hint="Tuỳ chọn">
                    <Input value={dynNet} onChange={setDynNet} type="number" placeholder="841500" />
                  </Field>
                  <Field label="Giá B2B (VND)" hint="Tuỳ chọn">
                    <Input value={dynB2b} onChange={setDynB2b} type="number" placeholder="750000" />
                  </Field>
                </div>
                <div className="text-xs text-navy-400">Chỉ cần nhập ít nhất một mức giá.</div>
              </>
            )}
            {formMsg && (
              <div
                className={`text-sm rounded-lg px-3 py-2 ${
                  formMsg.kind === 'ok'
                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
                    : 'text-red-700 bg-red-50 border border-red-100'
                }`}
              >
                {formMsg.text}
              </div>
            )}
            <Button variant="gold" onClick={submit} disabled={submitting} className="w-full">
              {submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}
            </Button>
            <div className="text-xs text-navy-400 pt-1 flex items-center justify-between">
              <span>Loại phòng khả dụng: {roomTypes.length}</span>
              <span>Mã giá khả dụng: {rateCodes.length}</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="mr-auto flex items-baseline gap-2">
              <h2 className="text-base font-semibold text-navy-800">Lịch sử yêu cầu</h2>
              <span className="text-xs text-navy-400">{requests.length} yêu cầu · {pendingCount} chờ duyệt</span>
            </div>
            {admin && (
              <>
                <Field label="Khách sạn" className="w-48">
                  <Select value={filterHotel} onChange={setFilterHotel}>
                    <option value="all">Tất cả</option>
                    {hotels.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Trạng thái" className="w-40">
                  <Select value={filterStatus} onChange={setFilterStatus}>
                    <option value="all">Tất cả</option>
                    <option value="Pending">Chờ duyệt</option>
                    <option value="Approved">Đã duyệt</option>
                    <option value="Rejected">Từ chối</option>
                  </Select>
                </Field>
              </>
            )}
          </div>

          {requests.length === 0 ? (
            <EmptyState message={loading ? 'Đang tải dữ liệu…' : 'Chưa có yêu cầu nào được tạo.'} />
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="bg-navy-50 text-navy-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Khách sạn</th>
                    <th className="text-left px-3 py-2 font-semibold">Mã giá</th>
                    <th className="text-left px-3 py-2 font-semibold">Giai đoạn</th>
                    <th className="text-left px-3 py-2 font-semibold">Người gửi</th>
                    <th className="text-left px-3 py-2 font-semibold">Trạng thái</th>
                    <th className="text-left px-3 py-2 font-semibold">Ngày tạo</th>
                    {admin && <th className="text-right px-3 py-2 font-semibold">Hành động</th>}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-t border-navy-50">
                      <td className="px-3 py-2.5 text-navy-700">{hotelNameById(r.hotel_id)}</td>
                      <td className="px-3 py-2.5">
                        {r.rate_code === 'Other' || (!r.rate_code && r.other_text) ? (
                          <Badge tone="neutral">Yêu cầu khác</Badge>
                        ) : (
                          <Badge tone={r.rate_code === 'Dynamic' ? 'gold' : 'neutral'}>{r.rate_code}</Badge>
                        )}
                        {r.other_text && (
                          <div className="mt-1 text-xs text-navy-600 italic max-w-xs">
                            {r.other_text}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 mono-num text-navy-600 whitespace-nowrap">
                        {formatRequestDateRange(r)}
                      </td>
                      <td className="px-3 py-2.5 text-navy-600 text-xs">
                        {r.created_by_user_id ? r.created_by_user_id.slice(0, 8) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {statusBadge(r.status)}
                        {r.status === 'Rejected' && r.rejection_reason && (
                          <div className="mt-1 text-xs text-red-600 italic max-w-xs">
                            Lý do: {r.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 mono-num text-navy-500 text-xs whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString('vi-VN')}
                      </td>
                      {admin && (
                        <td className="px-3 py-2.5 text-right">
                          {r.status === 'Pending' ? (
                            <div className="inline-flex gap-2">
                              <Button variant="gold" size="sm" onClick={() => setConfirm(r)} disabled={actingId === r.id}>
                                Duyệt & Áp dụng giá
                              </Button>
                              <Button variant="danger" size="sm" onClick={() => openRejectModal(r)} disabled={actingId === r.id}>
                                Từ chối
                              </Button>
                            </div>
                          ) : (
                            <span className="text-navy-300 text-xs">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Confirmation modal */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Xác nhận phê duyệt" maxWidth="max-w-md">
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-navy-600">
              Bạn sắp <b>phê duyệt</b> và áp dụng giá cho yêu cầu sau:
            </p>
            <div className="rounded-lg bg-navy-50 border border-navy-100 p-3 text-sm space-y-1">
              <div>
                <span className="text-navy-500">Khách sạn:</span>{' '}
                <span className="font-semibold text-navy-800">{hotelNameById(confirm.hotel_id)}</span>
              </div>
              <div>
                <span className="text-navy-500">Loại:</span>{' '}
                <span className="font-semibold text-navy-800">
                  {!confirm.rate_code && confirm.other_text ? 'Yêu cầu khác' : confirm.rate_code}
                </span>
              </div>
              {!confirm.rate_code && confirm.other_text && (
                <div>
                  <span className="text-navy-500">Nội dung:</span>{' '}
                  <span className="text-navy-800">{confirm.other_text}</span>
                </div>
              )}
              {confirm.rate_code === 'Dynamic' && (
                <>
                  <div>
                    <span className="text-navy-500">Loại phòng:</span>{' '}
                    <span className="text-navy-800">
                      {Array.isArray(confirm.room_type_ids)
                        ? confirm.room_type_ids
                            .map((id) => roomTypes.find((rt) => rt.id === id)?.name || id.slice(0, 8))
                            .join(', ')
                        : '—'}
                    </span>
                  </div>
                  <div className="mono-num text-navy-800">
                    Giá bán: {confirm.selling_price != null ? confirm.selling_price.toLocaleString('vi-VN') + 'đ' : '—'} ·{' '}
                    Giá thu về: {confirm.net_price != null ? confirm.net_price.toLocaleString('vi-VN') + 'đ' : '—'} ·{' '}
                    Giá B2B: {confirm.b2b_price != null ? confirm.b2b_price.toLocaleString('vi-VN') + 'đ' : '—'}
                  </div>
                </>
              )}
              <div>
                <span className="text-navy-500">Giai đoạn:</span>{' '}
                <span className="mono-num text-navy-800">{formatRequestDateRange(confirm)}</span>
              </div>
            </div>
            <p className="text-xs text-navy-500">
              {!confirm.rate_code && confirm.other_text
                ? 'Đây là yêu cầu khác (không áp dụng giá tự động). Việc duyệt chỉ đánh dấu trạng thái thành Đã duyệt và gửi thông báo Telegram.'
                : confirm.rate_code === 'Dynamic'
                  ? 'Yêu cầu Dynamic sẽ áp dụng các mức giá người dùng nhập trực tiếp cho các loại phòng đã chọn, lưu vào daily_rates với mã Dynamic. Thông báo xác nhận sẽ được gửi qua Telegram.'
                  : 'Hệ thống sẽ tra cứu bảng giá (price_matrix) cho tất cả loại phòng của khách sạn, chuẩn hoá mã giá bằng .trim().toUpperCase(), định dạng ngày dạng YYYY-MM-DD, và đẩy vào daily_rates — cập nhật ngay trên Trang tra cứu. Thông báo xác nhận sẽ được gửi qua Telegram.'}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setConfirm(null)}>Hủy</Button>
              <Button
                variant="gold"
                onClick={async () => {
                  const req = confirm;
                  setConfirm(null);
                  await approveAndApply(req);
                }}
                disabled={actingId === confirm.id}
              >
                {actingId === confirm.id ? 'Đang áp dụng…' : 'Duyệt & Áp dụng giá'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Rejection modal */}
      <Modal open={!!rejectTarget} onClose={closeRejectModal} title="Từ Chối Yêu Cầu Chỉnh Giá" maxWidth="max-w-md">
        {rejectTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-navy-50 border border-navy-100 p-3 text-sm space-y-1">
              <div>
                <span className="text-navy-500">Khách sạn:</span>{' '}
                <span className="font-semibold text-navy-800">{hotelNameById(rejectTarget.hotel_id)}</span>
              </div>
              <div>
                <span className="text-navy-500">Loại:</span>{' '}
                <span className="font-semibold text-navy-800">
                  {!rejectTarget.rate_code && rejectTarget.other_text ? 'Yêu cầu khác' : rejectTarget.rate_code}
                </span>
              </div>
              {!rejectTarget.rate_code && rejectTarget.other_text && (
                <div>
                  <span className="text-navy-500">Nội dung:</span>{' '}
                  <span className="text-navy-800">{rejectTarget.other_text}</span>
                </div>
              )}
              {rejectTarget.rate_code === 'Dynamic' && Array.isArray(rejectTarget.room_type_ids) && (
                <div>
                  <span className="text-navy-500">Loại phòng:</span>{' '}
                  <span className="text-navy-800">
                    {rejectTarget.room_type_ids
                      .map((id) => roomTypes.find((rt) => rt.id === id)?.name || id.slice(0, 8))
                      .join(', ')}
                  </span>
                </div>
              )}
              <div>
                <span className="text-navy-500">Giai đoạn:</span>{' '}
                <span className="mono-num text-navy-800">{formatRequestDateRange(rejectTarget)}</span>
              </div>
            </div>
            <Field label="Lý do từ chối *" hint="Bắt buộc — ví dụ: Mức giá quá thấp so với khung giá sàn, Đã hết quỹ phòng…">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Nhập lý do từ chối…"
                rows={3}
                className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400 resize-none"
                autoFocus
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={closeRejectModal}>Hủy bỏ</Button>
              <Button variant="danger" onClick={confirmReject} disabled={rejecting}>
                {rejecting ? 'Đang xử lý…' : 'Xác nhận Từ chối'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
