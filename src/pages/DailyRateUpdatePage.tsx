import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthContext';
import { useRoomTypes } from '@/lib/useRoomTypes';
import type { DailyRate, Hotel, PriceMatrix } from '@/types';
import { Button, Select, Card, Field, Badge, EmptyState, Modal, Input } from '@/components/ui';
import { formatVND, normCode, toDMY, toISODate, dateRangeISO, excelSerialToDate } from '@/lib/format';

/**
 * Page 4 — Cập nhật giá (Admin only).
 * The `dailyRatesVersion` in localStorage is bumped after every save/import so
 * Page 1 (Lookup Calendar) can detect the change and re-fetch when visited.
 */
const DAILY_RATES_VERSION_KEY = 'rt_daily_rates_version';

function bumpDailyRatesVersion() {
  try {
    const cur = Number(localStorage.getItem(DAILY_RATES_VERSION_KEY) || '0');
    localStorage.setItem(DAILY_RATES_VERSION_KEY, String(cur + 1));
  } catch {
    // ignore
  }
}

export function DailyRateUpdatePage() {
  const { hotels } = useAuth();
  const [hotelId, setHotelId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [rateCode, setRateCode] = useState('');
  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [endDate, setEndDate] = useState(toISODate(new Date()));
  const [sell, setSell] = useState('');
  const [net, setNet] = useState('');
  const [cms, setCms] = useState('');
  const [b2b, setB2b] = useState('');
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

  // Reset room type + rate code when hotel changes
  useEffect(() => {
    setRoomTypeId('');
    setRateCode('');
    setSell('');
    setNet('');
    setCms('');
    setB2b('');
  }, [hotelId]);

  // Load price_matrix for the selected hotel
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

  // Rate codes available for the selected room type, plus the special
  // "Dynamic" option that bypasses the price matrix lookup.
  // Normalization: .trim().toUpperCase() applied to every code.
  const rateCodes = useMemo(() => {
    const set = new Set<string>();
    matrix
      .filter((m) => m.room_type_id === roomTypeId)
      .forEach((m) => set.add(normCode(m.rate_code)));
    return Array.from(set);
  }, [matrix, roomTypeId]);

  const isDynamic = rateCode === 'Dynamic';

  // Re-render logic: when room type changes, auto-select the first rate code.
  useEffect(() => {
    if (rateCodes.length > 0) {
      setRateCode(rateCodes[0]);
    } else {
      setRateCode('');
      setSell('');
      setNet('');
      setCms('');
      setB2b('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomTypeId, rateCodes.join('|')]);

  // When rate code changes, auto-fill the price inputs from price_matrix.
  // "Dynamic" bypasses the matrix lookup and leaves the inputs blank for manual entry.
  // Normalization: .trim().toUpperCase() on comparison.
  useEffect(() => {
    if (isDynamic) {
      setSell('');
      setNet('');
      setCms('');
      setB2b('');
      return;
    }
    const m = matrix.find(
      (x) => x.room_type_id === roomTypeId && normCode(x.rate_code) === normCode(rateCode),
    );
    if (m) {
      setSell(String(Number(m.selling_price)));
      setNet(String(Number(m.net_price)));
      setCms(String(Number(m.cms_price)));
      setB2b(m.b2b_price != null ? String(Number(m.b2b_price)) : '');
    } else {
      setSell('');
      setNet('');
      setCms('');
      setB2b('');
    }
  }, [rateCode, roomTypeId, matrix, isDynamic]);

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
      .order('date', { ascending: false })
      .limit(200);
    setRows((data as DailyRate[]) || []);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const hotelName = hotels.find((h) => h.id === hotelId)?.name || '';
  const rtName = roomTypes.find((rt) => rt.id === roomTypeId)?.name || '';

  // ---------- Save (bulk UPSERT) ----------
  const save = async () => {
    setMsg(null);
    if (!hotelId || !roomTypeId || !rateCode || !startDate || !endDate) {
      setMsg({ kind: 'err', text: 'Vui lòng chọn đủ khách sạn, loại phòng, mã giá và ngày.' });
      return;
    }
    if (startDate > endDate) {
      setMsg({ kind: 'err', text: 'Từ ngày phải trước hoặc bằng Đến ngày.' });
      return;
    }
    if (isDynamic) {
      if (sell === '' || net === '' || cms === '') {
        setMsg({ kind: 'err', text: 'Vui lòng nhập đủ 3 mức giá (Giá bán, Giá thu về, Giá CMS).' });
        return;
      }
    } else {
      if (sell === '' || net === '' || cms === '') {
        setMsg({ kind: 'err', text: 'Vui lòng nhập đủ 3 mức giá (Giá bán, Giá thu về, Giá CMS).' });
        return;
      }
    }
    setSaving(true);
    const dates = dateRangeISO(startDate, endDate);
    // UPSERT via delete-then-insert for the same (hotel, room_type, rate_code, date range)
    await supabase
      .from('daily_rates')
      .delete()
      .eq('hotel_id', hotelId)
      .eq('room_type_id', roomTypeId)
      .eq('rate_code', rateCode)
      .gte('date', startDate)
      .lte('date', endDate);
    const insertRows = dates.map((d) => ({
      hotel_id: hotelId,
      room_type_id: roomTypeId,
      date: d,
      rate_code: rateCode,
      selling_price: Number(sell),
      net_price: Number(net),
      cms_price: Number(cms),
      b2b_price: b2b.trim() === '' ? null : Number(b2b) || null,
    }));
    const { error } = await supabase.from('daily_rates').insert(insertRows);
    if (error) {
      setMsg({ kind: 'err', text: `Lỗi lưu giá: ${error.message}` });
    } else {
      setMsg({
        kind: 'ok',
        text: `Đã lưu ${dates.length} ngày cho ${rtName} — ${rateCode}. Trang tra cứu sẽ cập nhật ngay.`,
      });
      bumpDailyRatesVersion();
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
    ws['!cols'] = [
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
    ];
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
        const sp =
          Number(String(r['Selling Price'] ?? r['selling_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const np =
          Number(String(r['Net Price'] ?? r['net_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const cp =
          Number(String(r['CMS Price'] ?? r['cms_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const b2bRaw = String(r['B2B Price'] ?? r['b2b_price'] ?? '').trim();
        const b2bVal = b2bRaw === '' ? null : Number(b2bRaw.replace(/[^\d.-]/g, '')) || null;
        const rt = roomTypes.find(
          (x) => x.name.trim().toLowerCase() === rtNameRaw.toLowerCase(),
        );
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
        setImportMsg({
          kind: 'err',
          text: 'Không có dòng hợp lệ. Kiểm tra tên loại phòng, mã giá và cột ngày.',
        });
        setImportBusy(false);
        return;
      }

      // UPSERT via delete-then-insert per (room_type_id, rate_code, date)
      for (const row of toInsert) {
        await supabase
          .from('daily_rates')
          .delete()
          .eq('hotel_id', row.hotel_id)
          .eq('room_type_id', row.room_type_id)
          .eq('rate_code', row.rate_code)
          .eq('date', row.date);
      }
      const { error } = await supabase.from('daily_rates').insert(toInsert);
      if (error) {
        setImportMsg({ kind: 'err', text: `Lỗi nhập: ${error.message}` });
      } else {
        const txt =
          skipped > 0
            ? `Đã nhập ${toInsert.length} dòng thành công (bỏ qua ${skipped} dòng không hợp lệ).`
            : `Đã nhập ${toInsert.length} dòng thành công.`;
        setImportMsg({ kind: 'ok', text: txt });
        bumpDailyRatesVersion();
        await loadRates();
      }
    } catch (e) {
      setImportMsg({ kind: 'err', text: `Lỗi đọc tập tin: ${(e as Error).message}` });
    }
    setImportBusy(false);
  };

  return (
    <div className="space-y-4 fade-in">
      {/* Bộ công cụ phân bổ giá tự động */}
      <Card className="p-4">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-navy-800">Bộ công cụ phân bổ giá tự động</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Khách sạn">
            <Select value={hotelId} onChange={setHotelId}>
              {hotels.map((h: Hotel) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Loại phòng" hint="Sắp xếp theo display_order">
            <Select value={roomTypeId} onChange={setRoomTypeId}>
              <option value="">— Chọn loại phòng —</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mã giá (Rate Code)" hint={isDynamic ? 'Nhập tay giá, không tra cứu ma trận' : undefined}>
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
          <div className="grid grid-cols-2 gap-2">
            <Field label="Từ ngày">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-white border border-navy-200 rounded-lg px-2 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
              />
            </Field>
            <Field label="Đến ngày">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-white border border-navy-200 rounded-lg px-2 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
              />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Field label="Giá bán (VND)">
            <Input value={sell} onChange={setSell} type="number" placeholder="990000" />
          </Field>
          <Field label="Giá thu về (VND)">
            <Input value={net} onChange={setNet} type="number" placeholder="841500" />
          </Field>
          <Field label="Giá CMS (VND)" hint={isDynamic ? 'Nhập tay' : 'Chỉ Admin xem được'}>
            <Input value={cms} onChange={setCms} type="number" placeholder="760000" />
          </Field>
          <Field label="Giá B2B (VND)" hint="Tuỳ chọn — để trống nếu không có">
            <Input value={b2b} onChange={setB2b} type="number" placeholder="750000" />
          </Field>
        </div>
        {isDynamic && (
          <div className="mt-2 text-xs text-gold-700 bg-gold-50 border border-gold-100 rounded-lg px-3 py-2">
            Đang ở chế độ Dynamic — bạn tự nhập các mức giá, không lấy từ ma trận giá. Nhấn “Lưu Lịch Giá” để lưu thẳng vào lịch giá với mã <span className="font-semibold">Dynamic</span>.
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

      {/* Bảng quản lý lịch giá */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-navy-800">Bảng quản lý lịch giá</h3>
          <span className="text-xs text-navy-400">{rows.length} dòng gần nhất</span>
        </div>
        <div className="overflow-x-auto thin-scroll">
          {rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                message={loading ? 'Đang tải dữ liệu…' : 'Chưa có lịch giá cho khách sạn này.'}
              />
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
                      <td className="px-3 py-2.5 mono-num text-navy-700 whitespace-nowrap">
                        {toDMY(r.date)}
                      </td>
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

      {/* Import modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Nhập Excel — Lịch giá hàng ngày"
      >
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
            className="block w-full text-sm text-navy-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gold-500 file:text-white file:font-medium file:cursor-pointer hover:file:bg-gold-600"
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
