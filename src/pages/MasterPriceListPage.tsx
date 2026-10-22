import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useAuth, isAdmin } from '@/auth/AuthContext';
import type { Hotel } from '@/types';
import {
  Button,
  Select,
  Card,
  Field,
  Badge,
  EmptyState,
  Modal,
} from '@/components/ui';
import { excelSerialToDate, formatVND, toDMY } from '@/lib/format';
import { ExportModal } from '@/components/ExportModal';

interface Row {
  hotel_name: string;
  ota_channel: string;
  room_type: string;
  rate_plan: string;
  rate_code: string;
  ref_selling_price: number;
  ref_net_price: number;
  approval_date: string | null;
}

/**
 * Multi-select dropdown with "Tất cả" (Select All) option.
 * Empty `selected` array means "Tất cả" — all options active.
 */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (s: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const all = selected.length === 0;
  const allChecked = options.length > 0 && selected.length === options.length;
  const indeterminate = selected.length > 0 && selected.length < options.length;

  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };

  const selectAll = () => {
    if (allChecked || indeterminate) onChange([]); // back to "Tất cả"
    else onChange([...options]);
  };

  const label_text = all ? 'Tất cả' : allChecked ? 'Tất cả' : `${selected.length} đã chọn`;

  return (
    <Field label={label}>
      <div className="relative w-full" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-left text-navy-800 hover:border-navy-300 focus:outline-none focus:ring-2 focus:ring-navy-400 flex items-center justify-between"
          type="button"
        >
          <span className="truncate">{label_text}</span>
          <span className="text-navy-300 text-xs ml-2">▾</span>
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-navy-100 rounded-lg shadow-pop max-h-64 overflow-auto thin-scroll fade-in">
            <label className="flex items-center gap-2 px-3 py-2 hover:bg-navy-50 cursor-pointer text-sm border-b border-navy-50 sticky top-0 bg-white">
              <input
                type="checkbox"
                checked={allChecked || all}
                ref={(el) => {
                  if (el) el.indeterminate = indeterminate;
                }}
                onChange={selectAll}
                className="accent-[#E9967A]"
              />
              <span className="font-medium text-navy-700">Tất cả</span>
            </label>
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-2 hover:bg-navy-50 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-[#E9967A]"
                />
                <span className="text-navy-700">{opt}</span>
              </label>
            ))}
            {options.length === 0 && (
              <div className="px-3 py-3 text-xs text-navy-400">Không có lựa chọn</div>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

export function MasterPriceListPage() {
  const { hotels, user } = useAuth();
  const admin = isAdmin(user);
  const [hotelId, setHotelId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const [selOta, setSelOta] = useState<string[]>([]);
  const [selRoom, setSelRoom] = useState<string[]>([]);
  const [selPlan, setSelPlan] = useState<string[]>([]);
  const [selCode, setSelCode] = useState<string[]>([]);

  const [importOpen, setImportOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (hotels.length && !hotelId) setHotelId(hotels[0].id);
  }, [hotels, hotelId]);

  // Reset filters when hotel changes
  useEffect(() => {
    setSelOta([]);
    setSelRoom([]);
    setSelPlan([]);
    setSelCode([]);
  }, [hotelId]);

  const hotelName = hotels.find((h) => h.id === hotelId)?.name || '';

  const load = useCallback(async () => {
    if (!hotelId || !hotelName) return setRows([]);
    setLoading(true);
    const { data, error } = await supabase
      .from('master_price_list')
      .select('*')
      .eq('hotel_name', hotelName)
      .order('id', { ascending: true }); // <--- BỔ SUNG DÒNG NÀY
    if (!error) setRows((data as Row[]) || []);
    else setRows([]);
    setLoading(false);
  }, [hotelId, hotelName]);

  useEffect(() => {
    load();
  }, [load]);

  // Unique option lists, preserving insertion order from imported Excel rows.
  // Room Types and Rate Plans are extracted 100% dynamically from master_price_list.
  const otaOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.ota_channel))), [rows]);
  const roomOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.room_type))), [rows]);
  const planOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.rate_plan))), [rows]);
  const codeOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.rate_code))), [rows]);

  const filtered = useMemo(() => {
    return rows.filter(
      (r) =>
        (selOta.length === 0 || selOta.includes(r.ota_channel)) &&
        (selRoom.length === 0 || selRoom.includes(r.room_type)) &&
        (selPlan.length === 0 || selPlan.includes(r.rate_plan)) &&
        (selCode.length === 0 || selCode.includes(r.rate_code)),
    );
  }, [rows, selOta, selRoom, selPlan, selCode]);

  // Active OTA channels: only those present in the filtered set.
  const activeOtas = useMemo(
    () => Array.from(new Set(filtered.map((r) => r.ota_channel))),
    [filtered],
  );

  // Group rows by (room_type, rate_plan, rate_code) — preserving original room order
const grouped = useMemo(() => {
  // Sort filtered rows by original array index to ensure same room types stay together
  const sortedFiltered = [...filtered];
  
  const map = new Map<string, Row[]>();
  const order: string[] = [];

  for (const r of sortedFiltered) {
    const key = `${r.room_type}||${r.rate_plan}||${r.rate_code}`;
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(r);
  }

  return order.map((k) => ({ key: k, rows: map.get(k)! }));
}, [filtered]);
  
  // Rowspan structure for the Loại phòng column.
  const roomTypeSpans = useMemo(() => {
    const out: number[] = [];
    let prevRoom = '';
    for (let i = 0; i < grouped.length; i++) {
      const rt = grouped[i].rows[0].room_type;
      if (rt !== prevRoom) {
        let count = 1;
        for (let j = i + 1; j < grouped.length; j++) {
          if (grouped[j].rows[0].room_type === rt) count++;
          else break;
        }
        out.push(count);
        prevRoom = rt;
      } else {
        out.push(0);
      }
    }
    return out;
  }, [grouped]);

  // Download a clean template (.xlsx) with header + one example row.
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'Hotel Name',
        'OTA Channel',
        'Room Type',
        'Rate Plan',
        'Rate Code',
        'Ref Selling Price',
        'Ref Net Price',
        'Approval Date',
      ],
      ["D'Lecia Hotel", 'Agoda', 'Superior Double', 'Room Only', 'BAR 1', 990000, 841500, '01/01/2026'],
    ]);
    ws['!cols'] = [
      { wch: 22 },
      { wch: 16 },
      { wch: 22 },
      { wch: 16 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arr], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau_bang_gia_master.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import Excel: clean 8-column format, serial-date fix, dedup via upsert.
  const handleImport = async (file: File) => {
    setImportBusy(true);
    setImportMsg(null);
    try {
      const buf = await file.arrayBuffer();
      // cellDates:true tells SheetJS to parse date cells into JS Date objects.
      const wb = XLSX.read(buf, { cellDates: true, raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      const upsertRows: Omit<Row, 'id'>[] = [];
      const seenKeys = new Set<string>();
      let skipped = 0;

      for (const r of json) {
        const hotelNameRaw = String(r['Hotel Name'] ?? r['hotel_name'] ?? '').trim();
        const ota = String(r['OTA Channel'] ?? r['ota_channel'] ?? '').trim();
        const roomType = String(r['Room Type'] ?? r['room_type'] ?? '').trim();
        const ratePlan = String(r['Rate Plan'] ?? r['rate_plan'] ?? '').trim();
        const rateCode = String(r['Rate Code'] ?? r['rate_code'] ?? '').trim();
        const sell =
          Number(String(r['Ref Selling Price'] ?? r['ref_selling_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const net =
          Number(String(r['Ref Net Price'] ?? r['ref_net_price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const dateRaw = r['Approval Date'] ?? r['approval_date'];
        // Serial date fix: detect Excel numeric serial dates and convert.
        const d = excelSerialToDate(dateRaw);

        if (!hotelNameRaw || !ota || !roomType || !ratePlan || !rateCode) {
          skipped++;
          continue;
        }

        const key = `${hotelNameRaw}||${ota}||${roomType}||${ratePlan}||${rateCode}`;
        if (seenKeys.has(key)) {
          skipped++;
          continue;
        }
        seenKeys.add(key);

        upsertRows.push({
          hotel_name: hotelNameRaw,
          ota_channel: ota,
          room_type: roomType,
          rate_plan: ratePlan,
          rate_code: rateCode,
          ref_selling_price: sell,
          ref_net_price: net,
          approval_date: d
            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            : null,
        });
      }

      if (upsertRows.length === 0) {
        setImportMsg({ kind: 'err', text: 'Không có dòng hợp lệ trong tập tin.' });
        setImportBusy(false);
        return;
      }

      // Unique key: [Hotel Name + OTA Channel + Room Type + Rate Plan + Rate Code]
      const { error } = await supabase.from('master_price_list').upsert(upsertRows, {
        onConflict: 'hotel_name,ota_channel,room_type,rate_plan,rate_code',
      });

      if (error) {
        setImportMsg({ kind: 'err', text: `Lỗi nhập dữ liệu: ${error.message}` });
      } else {
        const msg = skipped > 0
          ? `Đã nhập ${upsertRows.length} dòng thành công (bỏ qua ${skipped} dòng trùng/thiếu).`
          : `Đã nhập ${upsertRows.length} dòng thành công.`;
        setImportMsg({ kind: 'ok', text: msg });
        await load();
      }
    } catch (e) {
      setImportMsg({ kind: 'err', text: `Lỗi đọc tập tin: ${(e as Error).message}` });
    }
    setImportBusy(false);
  };

  // Export rows for the Export modal.
  const exportRows = useMemo(() => {
    return filtered.map((r) => ({
      hotel_name: r.hotel_name,
      ota_channel: r.ota_channel,
      room_type: r.room_type,
      rate_plan: r.rate_plan,
      rate_code: r.rate_code,
      selling_price: formatVND(r.ref_selling_price),
      net_price: formatVND(r.ref_net_price),
      approval_date: toDMY(r.approval_date),
    }));
  }, [filtered]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4 fade-in">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-navy-800">Bảng giá ma trận OTA</h2>
          <span className="text-xs text-navy-400">{filtered.length} dòng · {activeOtas.length} kênh OTA</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Khách sạn">
            <Select value={hotelId} onChange={setHotelId}>
              {hotels.map((h: Hotel) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <MultiSelect label="Kênh OTA" options={otaOptions} selected={selOta} onChange={setSelOta} />
          <MultiSelect label="Loại phòng" options={roomOptions} selected={selRoom} onChange={setSelRoom} />
          <MultiSelect label="Gói giá (Rate Plan)" options={planOptions} selected={selPlan} onChange={setSelPlan} />
          <MultiSelect label="Mã giá (Rate Code)" options={codeOptions} selected={selCode} onChange={setSelCode} />
        </div>

        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-navy-50">
          {admin && (
            <>
              <Button variant="gold" size="sm" onClick={() => setImportOpen(true)}>
                Nhập Excel
              </Button>
              <Button variant="secondary" size="sm" onClick={downloadTemplate}>
                Tải file mẫu (.xlsx)
              </Button>
            </>
          )}
          <div className="flex-1" />
          <Button variant="subtle" size="sm" onClick={() => setExportOpen(true)}>
            Xuất dữ liệu
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto thin-scroll">
          {filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                message={
                  loading
                    ? 'Đang tải dữ liệu…'
                    : admin
                      ? 'Chưa có dữ liệu bảng giá. Hãy nhấn "Nhập Excel" để tải lên.'
                      : 'Chưa có dữ liệu bảng giá cho khách sạn này.'
                }
              />
            </div>
          ) : (
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead className="bg-navy-100 text-navy-700">
                <tr>
                  <th
                    rowSpan={2}
                    className="text-left px-3 py-2.5 font-semibold border-r border-navy-200 sticky left-0 bg-navy-100 z-10 min-w-[160px]"
                  >
                    Loại phòng
                  </th>
                  <th
                    rowSpan={2}
                    className="text-left px-3 py-2.5 font-semibold border-r border-navy-200 min-w-[120px]"
                  >
                    Gói giá
                  </th>
                  <th
                    rowSpan={2}
                    className="text-left px-3 py-2.5 font-semibold border-r border-navy-200 min-w-[110px]"
                  >
                    Mã giá
                  </th>
                  {activeOtas.map((ota) => (
                    <th
                      key={ota}
                      colSpan={2}
                      className="text-center px-3 py-2 font-semibold border-r border-navy-200 min-w-[180px]"
                    >
                      {ota}
                    </th>
                  ))}
                  <th rowSpan={2} className="text-center px-3 py-2.5 font-semibold min-w-[110px]">
                    Ngày duyệt giá
                  </th>
                </tr>
                <tr>
                  {activeOtas.flatMap((ota) => [
                    <th
                      key={ota + '_s'}
                      className="text-right px-3 py-1.5 text-xs font-medium border-r border-navy-200"
                    >
                      Giá bán
                    </th>,
                    <th
                      key={ota + '_n'}
                      className="text-right px-3 py-1.5 text-xs font-medium border-r border-navy-200"
                    >
                      Giá thu về
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, i) => {
                  const span = roomTypeSpans[i];
                  return (
                    <tr key={g.key} className={i % 2 ? 'bg-navy-50/40' : 'bg-white'}>
                      {span > 0 && (
                        <td
                          rowSpan={span}
                          className="align-top px-3 py-2.5 font-semibold text-navy-800 border-r border-navy-100 sticky left-0 bg-inherit z-10"
                        >
                          {g.rows[0].room_type}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-navy-700 border-r border-navy-100">
                        {g.rows[0].rate_plan}
                      </td>
                      <td className="px-3 py-2.5 border-r border-navy-100">
                        <Badge tone="neutral">{g.rows[0].rate_code}</Badge>
                      </td>
                      {activeOtas.flatMap((ota) => {
                        const r = g.rows.find((x) => x.ota_channel === ota);
                        return [
                          <td
                            key={ota + '_s'}
                            className="px-3 py-2.5 text-right mono-num font-semibold text-navy-800 border-r border-navy-100"
                          >
                            {r ? formatVND(r.ref_selling_price) : '—'}
                          </td>,
                          <td
                            key={ota + '_n'}
                            className="px-3 py-2.5 text-right mono-num text-navy-600 border-r border-navy-100"
                          >
                            {r ? formatVND(r.ref_net_price) : '—'}
                          </td>,
                        ];
                      })}
                      <td className="px-3 py-2.5 text-center mono-num text-navy-600">
                        {toDMY(g.rows[0].approval_date) || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Nhập Excel — Bảng giá">
        <div className="space-y-4">
          <p className="text-sm text-navy-600">
            Chọn tập tin Excel (.xlsx) với 8 cột:{' '}
            <span className="mono-num text-xs">
              Hotel Name | OTA Channel | Room Type | Rate Plan | Rate Code | Ref Selling Price | Ref Net
              Price | Approval Date
            </span>
            . Các dòng trùng khóa (Khách sạn + OTA + Loại phòng + Gói giá + Mã giá) sẽ được cập nhật.
            Ngày ở dạng số serial Excel (vd: 46249) sẽ tự động chuyển sang dd/mm/yyyy.
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
            <Button
              variant="secondary"
              onClick={downloadTemplate}
            >
              Tải file mẫu
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importBusy}>
              Đóng
            </Button>
          </div>
        </div>
      </Modal>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        hotelName={hotelName}
        defaultStart={today}
        defaultEnd={today}
        columns={[
          { header: 'Khách sạn', key: 'hotel_name', width: 22 },
          { header: 'Kênh OTA', key: 'ota_channel', width: 16 },
          { header: 'Loại phòng', key: 'room_type', width: 22 },
          { header: 'Gói giá', key: 'rate_plan', width: 16 },
          { header: 'Mã giá', key: 'rate_code', width: 14 },
          { header: 'Giá bán', key: 'selling_price', width: 18 },
          { header: 'Giá thu về', key: 'net_price', width: 16 },
          { header: 'Ngày duyệt', key: 'approval_date', width: 16 },
        ]}
        rows={exportRows}
        filename={`bang_gia_master_${hotelName.replace(/\s+/g, '_')}`}
      />
    </div>
  );
}
