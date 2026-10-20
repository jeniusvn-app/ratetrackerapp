import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Download,
  Hotel as HotelIcon,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthContext';
import { useRoomTypes } from '@/lib/useRoomTypes';
import type { AppUser, Hotel, PriceMatrix, Role, RoomType } from '@/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
} from '@/components/ui';
import { formatVND, normCode } from '@/lib/format';
import { canAccessFullPuReport } from '@/auth/AuthContext';

type TabKey = 'hotels' | 'matrix' | 'users';

const TABS: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: 'hotels', label: 'Cấu hình khách sạn & loại phòng', icon: Building2 },
  { key: 'matrix', label: 'Cấu hình ma trận giá', icon: HotelIcon },
  { key: 'users', label: 'Tài khoản & phân quyền', icon: Users },
];

type Toast = { kind: 'ok' | 'err' | 'info'; text: string } | null;

export function SystemAdminPage() {
  const [tab, setTab] = useState<TabKey>('hotels');
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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
        <h1 className="text-lg font-semibold text-navy-800">Quản trị</h1>
      </div>

      <div className="flex flex-wrap gap-1 bg-white border border-navy-100 rounded-xl p-1 shadow-card">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-navy-700 text-white shadow-sm'
                  : 'text-navy-600 hover:bg-navy-50'
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'hotels' && <HotelsTab onToast={setToast} />}
      {tab === 'matrix' && <MatrixTab onToast={setToast} />}
      {tab === 'users' && <UsersTab onToast={setToast} />}
    </div>
  );
}

// ============================================================
// TAB 1: CẤU HÌNH KHÁCH SẠN & LOẠI PHÒNG (AUTO-SAVE REORDER)
// ============================================================

function HotelsTab({ onToast }: { onToast: (t: Toast) => void }) {
  const { allHotels, refreshHotels } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState('');
  const { roomTypes, reload: reloadRoomTypes } = useRoomTypes(selectedHotelId || null);

  const [hotelEdit, setHotelEdit] = useState<Hotel | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [hotelCode, setHotelCode] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelSaving, setHotelSaving] = useState(false);

  const [rtName, setRtName] = useState('');
  const [rtSaving, setRtSaving] = useState(false);

  const loadHotels = useCallback(async () => {
    await refreshHotels();
    const { data } = await supabase.from('hotels').select('*').order('name');
    setHotels((data as Hotel[]) || []);
  }, [refreshHotels]);

  useEffect(() => {
    loadHotels();
  }, [loadHotels]);

  useEffect(() => {
    if (hotels.length && !selectedHotelId) setSelectedHotelId(hotels[0].id);
  }, [hotels, selectedHotelId]);

  // ---------- Hotel CRUD ----------
  const openAddHotel = () => {
    setHotelEdit(null);
    setHotelName('');
    setHotelCode('');
    setHotelAddress('');
  };
  const openEditHotel = (h: Hotel) => {
    setHotelEdit(h);
    setHotelName(h.name);
    setHotelCode(h.code || '');
    setHotelAddress(h.address || '');
  };
  const saveHotel = async () => {
    if (!hotelName.trim()) {
      onToast({ kind: 'err', text: 'Tên khách sạn không được để trống.' });
      return;
    }
    setHotelSaving(true);
    try {
      if (hotelEdit) {
        const { error } = await supabase
          .from('hotels')
          .update({
            name: hotelName.trim(),
            code: hotelCode.trim() || null,
            address: hotelAddress.trim() || null,
          })
          .eq('id', hotelEdit.id);
        if (error) {
          onToast({ kind: 'err', text: `Lỗi khi cập nhật khách sạn: ${error.message}` });
        } else {
          onToast({ kind: 'ok', text: 'Đã cập nhật khách sạn thành công!' });
        }
      } else {
        const { error } = await supabase.from('hotels').insert([
          { name: hotelName.trim(), code: hotelCode.trim() || null, address: hotelAddress.trim() || null, is_active: true },
        ]);
        if (error) {
          onToast({ kind: 'err', text: `Lỗi khi thêm khách sạn: ${error.message}` });
        } else {
          onToast({ kind: 'ok', text: 'Thêm khách sạn mới thành công!' });
        }
      }
      setHotelEdit(null);
      setHotelName('');
      setHotelCode('');
      setHotelAddress('');
      await loadHotels();
    } catch (e) {
      onToast({ kind: 'err', text: `Lỗi khi thêm khách sạn: ${(e as Error).message}` });
    } finally {
      setHotelSaving(false);
    }
  };
  const deleteHotel = async (h: Hotel) => {
    if (!confirm(`Xoá khách sạn "${h.name}"? Tất cả loại phòng và giá liên quan cũng sẽ bị xoá.`)) return;
    const { error } = await supabase.from('hotels').delete().eq('id', h.id);
    if (error) onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    else {
      onToast({ kind: 'ok', text: `Đã xoá khách sạn "${h.name}".` });
      if (selectedHotelId === h.id) setSelectedHotelId('');
      await loadHotels();
    }
  };

  // ---------- Room Type CRUD ----------
  const addRoomType = async () => {
    if (!selectedHotelId || !rtName.trim()) {
      onToast({ kind: 'err', text: 'Chọn khách sạn và nhập tên loại phòng.' });
      return;
    }
    setRtSaving(true);
    const nextOrder = roomTypes.length > 0 ? Math.max(...roomTypes.map((r) => r.display_order)) + 1 : 1;
    const { error } = await supabase
      .from('room_types')
      .insert({ hotel_id: selectedHotelId, name: rtName.trim(), display_order: nextOrder });
    if (error) onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    else {
      onToast({ kind: 'ok', text: `Đã thêm loại phòng "${rtName.trim()}".` });
      setRtName('');
      await reloadRoomTypes();
    }
    setRtSaving(false);
  };

  const renameRoomType = async (rt: RoomType) => {
    const name = prompt('Tên loại phòng mới:', rt.name);
    if (!name || !name.trim()) return;
    const { error } = await supabase
      .from('room_types')
      .update({ name: name.trim() })
      .eq('id', rt.id);
    if (error) onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    else {
      onToast({ kind: 'ok', text: 'Đã đổi tên loại phòng.' });
      await reloadRoomTypes();
    }
  };

  const deleteRoomType = async (rt: RoomType) => {
    if (!confirm(`Xoá loại phòng "${rt.name}"? Các dòng giá liên quan cũng sẽ bị xoá.`)) return;
    const { error } = await supabase.from('room_types').delete().eq('id', rt.id);
    if (error) onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    else {
      onToast({ kind: 'ok', text: `Đã xoá loại phòng "${rt.name}".` });
      await reloadRoomTypes();
    }
  };

  // ---------- AUTO-SAVE REORDERING ----------
  // Swap display_order between two room types and persist immediately.
  const moveRoomType = async (index: number, direction: -1 | 1) => {
    if (!roomTypes.length) return;
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= roomTypes.length) return;
    const a = roomTypes[index];
    const b = roomTypes[swapIndex];
    // Optimistic: update both rows' display_order
    const { error: e1 } = await supabase
      .from('room_types')
      .update({ display_order: b.display_order })
      .eq('id', a.id);
    const { error: e2 } = await supabase
      .from('room_types')
      .update({ display_order: a.display_order })
      .eq('id', b.id);
    if (e1 || e2) {
      onToast({ kind: 'err', text: 'Lỗi khi cập nhật thứ tự.' });
    } else {
      onToast({ kind: 'info', text: 'Đã lưu thứ tự loại phòng.' });
    }
    await reloadRoomTypes();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Hotels list */}
      <Card className="p-4 lg:col-span-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-navy-800">Danh sách khách sạn</h2>
          <Button variant="gold" size="sm" onClick={openAddHotel}>
            <Plus size={14} /> Thêm
          </Button>
        </div>
        <div className="space-y-1.5">
          {hotels.length === 0 ? (
            <EmptyState message="Chưa có khách sạn nào." />
          ) : (
            hotels.map((h) => (
              <div
                key={h.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                  selectedHotelId === h.id
                    ? 'border-navy-300 bg-navy-50/60'
                    : 'border-navy-100 hover:bg-navy-50/40'
                }`}
              >
                <button
                  onClick={() => setSelectedHotelId(h.id)}
                  className="text-left text-sm font-medium text-navy-800 truncate"
                >
                  {h.name}
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditHotel(h)}
                    className="p-1.5 rounded-md text-navy-500 hover:bg-navy-100"
                    title="Sửa"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteHotel(h)}
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                    title="Xoá"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Room types for selected hotel */}
      <Card className="p-4 lg:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-navy-800">Loại phòng</h2>
        </div>
        <div className="flex gap-2 mb-3">
          <Input
            value={rtName}
            onChange={setRtName}
            placeholder="Tên loại phòng mới…"
            onEnter={addRoomType}
          />
          <Button variant="gold" onClick={addRoomType} disabled={rtSaving}>
            <Plus size={14} /> Thêm
          </Button>
        </div>

        {roomTypes.length === 0 ? (
          <EmptyState message="Chưa có loại phòng cho khách sạn này." />
        ) : (
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold w-12">Thứ tự</th>
                  <th className="text-left px-3 py-2 font-semibold">Tên loại phòng</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {roomTypes.map((rt, i) => (
                  <tr key={rt.id} className="border-t border-navy-50">
                    <td className="px-3 py-2.5 mono-num text-navy-500">{rt.display_order}</td>
                    <td className="px-3 py-2.5 text-navy-800 font-medium">{rt.name}</td>
                    <td className="px-3 py-2.5">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => moveRoomType(i, -1)}
                          disabled={i === 0}
                          title="Lên"
                        >
                          <ArrowUp size={14} /> Lên
                        </Button>
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => moveRoomType(i, 1)}
                          disabled={i === roomTypes.length - 1}
                          title="Xuống"
                        >
                          <ArrowDown size={14} /> Xuống
                        </Button>
                        <button
                          onClick={() => renameRoomType(rt)}
                          className="p-1.5 rounded-md text-navy-500 hover:bg-navy-100 ml-1"
                          title="Đổi tên"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteRoomType(rt)}
                          className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                          title="Xoá"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Hotel add/edit modal */}
      <Modal
        open={hotelEdit !== null || hotelName !== ''}
        onClose={() => {
          setHotelEdit(null);
          setHotelName('');
          setHotelCode('');
          setHotelAddress('');
        }}
        title={hotelEdit ? 'Sửa khách sạn' : 'Thêm khách sạn'}
        maxWidth="max-w-sm"
      >
        <div className="space-y-3">
          <Field label="Tên khách sạn">
            <Input
              value={hotelName}
              onChange={setHotelName}
              placeholder="VD: D'Lecia Hotel"
              autoFocus
              onEnter={saveHotel}
            />
          </Field>
          <Field label="Mã khách sạn (Code)" hint="Mã nội bộ, không bắt buộc">
            <Input
              value={hotelCode}
              onChange={setHotelCode}
              placeholder="VD: DLE"
            />
          </Field>
          <Field label="Địa chỉ" hint="Địa chỉ khách sạn, không bắt buộc">
            <Input
              value={hotelAddress}
              onChange={setHotelAddress}
              placeholder="VD: 123 Nguyễn Huệ, Q1, TP.HCM"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setHotelEdit(null);
                setHotelName('');
                setHotelCode('');
                setHotelAddress('');
              }}
            >
              Hủy
            </Button>
            <Button variant="gold" onClick={saveHotel} disabled={hotelSaving}>
              {hotelSaving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// TAB 2: CẤU HÌNH MA TRẬN GIÁ (RATE MATRIX CONFIG)
// ============================================================

interface MatrixRow extends PriceMatrix {}

function MatrixTab({ onToast }: { onToast: (t: Toast) => void }) {
  const { allHotels } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelId, setHotelId] = useState('');
  const { roomTypes, reload: reloadRoomTypes } = useRoomTypes(hotelId || null);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(false);

  // New row form
  const [newRoomTypeId, setNewRoomTypeId] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newSell, setNewSell] = useState('');
  const [newNet, setNewNet] = useState('');
  const [newCms, setNewCms] = useState('');
  const [newB2b, setNewB2b] = useState('');

  // Inline editing
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editSell, setEditSell] = useState('');
  const [editNet, setEditNet] = useState('');
  const [editCms, setEditCms] = useState('');
  const [editB2b, setEditB2b] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('hotels').select('*').order('name');
      setHotels((data as Hotel[]) || []);
    })();
  }, [allHotels]);

  useEffect(() => {
    if (hotels.length && !hotelId) setHotelId(hotels[0].id);
  }, [hotels, hotelId]);

  const loadMatrix = useCallback(async () => {
    if (!hotelId) return setMatrix([]);
    setLoading(true);
    const { data } = await supabase.from('price_matrix').select('*').eq('hotel_id', hotelId);
    setMatrix((data as MatrixRow[]) || []);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  // Order matrix rows by room type display_order, then rate_code.
  const orderedMatrix = useMemo(() => {
    const orderMap = new Map(roomTypes.map((rt, i) => [rt.id, i]));
    return [...matrix].sort((a, b) => {
      const ao = orderMap.get(a.room_type_id) ?? 9999;
      const bo = orderMap.get(b.room_type_id) ?? 9999;
      if (ao !== bo) return ao - bo;
      return normCode(a.rate_code).localeCompare(normCode(b.rate_code));
    });
  }, [matrix, roomTypes]);

  const rtNameById = useMemo(() => {
    const m = new Map<string, string>();
    roomTypes.forEach((rt) => m.set(rt.id, rt.name));
    return m;
  }, [roomTypes]);

  const addRow = async () => {
    if (!newRoomTypeId || !newCode.trim()) {
      onToast({ kind: 'err', text: 'Chọn loại phòng và nhập mã giá.' });
      return;
    }
    const payload = {
      hotel_id: hotelId,
      room_type_id: newRoomTypeId,
      rate_code: normCode(newCode),
      selling_price: Number(newSell) || 0,
      net_price: Number(newNet) || 0,
      cms_price: Number(newCms) || 0,
      b2b_price: newB2b.trim() === '' ? null : Number(newB2b) || null,
    };
    const { error } = await supabase.from('price_matrix').insert(payload);
    if (error) {
      onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
      return;
    }
    onToast({ kind: 'ok', text: 'Đã thêm dòng ma trận giá.' });
    setNewCode('');
    setNewSell('');
    setNewNet('');
    setNewCms('');
    setNewB2b('');
    await loadMatrix();
  };

  const startEdit = (r: MatrixRow) => {
    setEditId(r.id);
    setEditCode(r.rate_code);
    setEditSell(String(r.selling_price));
    setEditNet(String(r.net_price));
    setEditCms(String(r.cms_price));
    setEditB2b(r.b2b_price != null ? String(r.b2b_price) : '');
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditCode('');
    setEditSell('');
    setEditNet('');
    setEditCms('');
    setEditB2b('');
  };
  const saveEdit = async (r: MatrixRow) => {
    const { error } = await supabase
      .from('price_matrix')
      .update({
        rate_code: normCode(editCode),
        selling_price: Number(editSell) || 0,
        net_price: Number(editNet) || 0,
        cms_price: Number(editCms) || 0,
        b2b_price: editB2b.trim() === '' ? null : Number(editB2b) || null,
      })
      .eq('id', r.id);
    if (error) {
      onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
      return;
    }
    onToast({ kind: 'ok', text: 'Đã cập nhật dòng ma trận giá.' });
    cancelEdit();
    await loadMatrix();
  };
  const deleteRow = async (r: MatrixRow) => {
    if (!confirm(`Xoá dòng giá ${r.rate_code} — ${rtNameById.get(r.room_type_id) || '?'}?`)) return;
    const { error } = await supabase.from('price_matrix').delete().eq('id', r.id);
    if (error) onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    else {
      onToast({ kind: 'ok', text: 'Đã xoá dòng ma trận giá.' });
      await loadMatrix();
    }
  };

  // ---------- Excel template + bulk import ----------
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const downloadRateMatrixTemplate = () => {
    const rows = [
      ['Room Type Name', 'Rate Code', 'Selling Price', 'Net Price', 'CMS Price', 'B2B Price'],
      ['Deluxe Ocean View', 'BAR 1', 1200000, 1020000, 950000, 880000],
      ['Deluxe Garden View', 'BAR 2', 980000, 833000, 780000, ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ma Tran Gia');
    XLSX.writeFile(wb, 'Mau_Import_Ma_Tran_Gia.xlsx');
  };

  const handleImportRateMatrix = async (file: File) => {
    if (!hotelId) {
      onToast({ kind: 'err', text: 'Vui lòng chọn khách sạn trước khi import.' });
      return;
    }
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        onToast({ kind: 'err', text: 'File không chứa sheet dữ liệu.' });
        setImporting(false);
        return;
      }
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      if (json.length === 0) {
        onToast({ kind: 'err', text: 'File mẫu không có dòng dữ liệu nào.' });
        setImporting(false);
        return;
      }

      // Build a case-insensitive lookup by normalized room type name.
      const rtByName = new Map<string, { id: string; name: string }>();
      roomTypes.forEach((rt) => {
        rtByName.set(rt.name.trim().toLowerCase(), { id: rt.id, name: rt.name });
      });

      const seen = new Set<string>();
      const rows: {
        hotel_id: string;
        room_type_id: string;
        rate_code: string;
        selling_price: number;
        net_price: number;
        cms_price: number;
        b2b_price: number | null;
      }[] = [];
      const skipped: string[] = [];

      for (const raw of json) {
        const rtName = String(raw['Room Type Name'] ?? raw['room type name'] ?? '').trim();
        const rateCode = normCode(String(raw['Rate Code'] ?? raw['rate code'] ?? ''));
        const sell = Number(String(raw['Selling Price'] ?? raw['selling price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const net = Number(String(raw['Net Price'] ?? raw['net price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const cms = Number(String(raw['CMS Price'] ?? raw['cms price'] ?? '0').replace(/[^\d.-]/g, '')) || 0;
        const b2bRaw = String(raw['B2B Price'] ?? raw['b2b price'] ?? '').trim();
        const b2b = b2bRaw === '' ? null : Number(b2bRaw.replace(/[^\d.-]/g, '')) || null;

        if (!rtName || !rateCode) {
          skipped.push(`Dòng thiếu tên loại phòng hoặc mã giá`);
          continue;
        }
        const match = rtByName.get(rtName.toLowerCase());
        if (!match) {
          skipped.push(`Không tìm thấy loại phòng "${rtName}"`);
          continue;
        }
        const key = `${hotelId}|${match.id}|${rateCode}`;
        if (seen.has(key)) {
          // keep first occurrence; later duplicates skipped silently
          continue;
        }
        seen.add(key);
        rows.push({
          hotel_id: hotelId,
          room_type_id: match.id,
          rate_code: rateCode,
          selling_price: Math.max(sell, 0),
          net_price: Math.max(net, 0),
          cms_price: Math.max(cms, 0),
          b2b_price: b2b != null ? Math.max(b2b, 0) : null,
        });
      }

      if (rows.length === 0) {
        const hint = skipped.length ? ` (${skipped[0]})` : '';
        onToast({ kind: 'err', text: `Không có dòng hợp lệ để import${hint}.` });
        setImporting(false);
        return;
      }

      const { error } = await supabase
        .from('price_matrix')
        .upsert(
          rows.map((r) => ({
            hotel_id: r.hotel_id,
            room_type_id: r.room_type_id,
            rate_code: r.rate_code,
            selling_price: r.selling_price,
            net_price: r.net_price,
            cms_price: r.cms_price,
            b2b_price: r.b2b_price,
          })),
          { onConflict: 'hotel_id,room_type_id,rate_code' },
        );

      if (error) {
        onToast({ kind: 'err', text: `Lỗi import: ${error.message}` });
        setImporting(false);
        return;
      }

      onToast({
        kind: 'ok',
        text: `Import ma trận giá thành công (${rows.length} dòng)!`,
      });
      await loadMatrix();
    } catch (e) {
      onToast({ kind: 'err', text: `Lỗi đọc file: ${(e as Error).message}` });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleImportRateMatrix(f);
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-50">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-sm font-semibold text-navy-800">Cấu hình ma trận giá</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing || !hotelId}
                title="Nhập dữ liệu từ file Excel/CSV"
              >
                <Upload size={14} /> {importing ? 'Đang import…' : 'Import Excel'}
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={downloadRateMatrixTemplate}
                title="Tải file mẫu định dạng .xlsx"
              >
                <Download size={14} /> Tải file mẫu (.xlsx)
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onFilePicked}
              />
            </div>
          </div>
          <Field label="Khách sạn" className="w-56">
            <Select value={hotelId} onChange={setHotelId}>
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className="overflow-x-auto thin-scroll">
        {loading ? (
          <div className="p-4">
            <EmptyState message="Đang tải dữ liệu…" />
          </div>
        ) : orderedMatrix.length === 0 && roomTypes.length === 0 ? (
          <div className="p-4">
            <EmptyState message="Chưa có loại phòng. Hãy thêm loại phòng ở Tab 1 trước." />
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-navy-50 text-navy-700">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Loại phòng</th>
                <th className="text-left px-3 py-2 font-semibold">Mã Rate Code</th>
                <th className="text-right px-3 py-2 font-semibold">Giá bán</th>
                <th className="text-right px-3 py-2 font-semibold">Giá thu về</th>
                <th className="text-right px-3 py-2 font-semibold">Giá CMS</th>
                <th className="text-right px-3 py-2 font-semibold">Giá B2B</th>
                <th className="text-right px-3 py-2 font-semibold w-32">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {orderedMatrix.map((r) => {
                const editing = editId === r.id;
                return (
                  <tr key={r.id} className="border-t border-navy-50">
                    <td className="px-3 py-2.5 text-navy-800 font-medium">
                      {rtNameById.get(r.room_type_id) || '—'}
                    </td>
                    {editing ? (
                      <>
                        <td className="px-3 py-2.5">
                          <Input value={editCode} onChange={setEditCode} />
                        </td>
                        <td className="px-3 py-2.5">
                          <Input value={editSell} onChange={setEditSell} type="number" />
                        </td>
                        <td className="px-3 py-2.5">
                          <Input value={editNet} onChange={setEditNet} type="number" />
                        </td>
                        <td className="px-3 py-2.5">
                          <Input value={editCms} onChange={setEditCms} type="number" />
                        </td>
                        <td className="px-3 py-2.5">
                          <Input value={editB2b} onChange={setEditB2b} type="number" placeholder="—" />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="inline-flex gap-1">
                            <Button variant="gold" size="sm" onClick={() => saveEdit(r)} title="Lưu">
                              <Save size={14} /> Lưu
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={cancelEdit}
                              title="Hủy"
                            >
                              <X size={14} /> Hủy
                            </Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
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
                        <td className="px-3 py-2.5">
                          <div className="inline-flex gap-1">
                            <button
                              onClick={() => startEdit(r)}
                              className="p-1.5 rounded-md text-navy-500 hover:bg-navy-100"
                              title="Sửa"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => deleteRow(r)}
                              className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                              title="Xoá"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}

              {/* Add new row inline */}
              <tr className="border-t-2 border-navy-100 bg-navy-50/30">
                <td className="px-3 py-2.5">
                  <Select value={newRoomTypeId} onChange={setNewRoomTypeId}>
                    <option value="">— Chọn loại phòng —</option>
                    {roomTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-2.5">
                  <Input
                    value={newCode}
                    onChange={setNewCode}
                    placeholder="VD: BAR 1"
                    onEnter={addRow}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <Input value={newSell} onChange={setNewSell} type="number" placeholder="0" />
                </td>
                <td className="px-3 py-2.5">
                  <Input value={newNet} onChange={setNewNet} type="number" placeholder="0" />
                </td>
                <td className="px-3 py-2.5">
                  <Input value={newCms} onChange={setNewCms} type="number" placeholder="0" />
                </td>
                <td className="px-3 py-2.5">
                  <Input value={newB2b} onChange={setNewB2b} type="number" placeholder="—" onEnter={addRow} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Button variant="gold" size="sm" onClick={addRow}>
                    <Plus size={14} /> Thêm
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// TAB 3: TÀI KHOẢN & PHÂN QUYỀN (USERS & PERMISSIONS)
// ============================================================

interface UserFormState {
  id: string | null;
  username: string;
  password: string;
  email: string;
  role: Role;
  allowed: string[]; // hotel ids or ['*']
  canAccessPuReport: boolean;
  canUploadPuOnly: boolean;
}

type PuPerm = 'full' | 'upload_only' | 'none';

function puPermFromUser(u: AppUser): PuPerm {
  if (u.role === 'admin' || u.can_access_pu_report === true) return 'full';
  if (u.can_upload_pu_only === true) return 'upload_only';
  return 'none';
}

function puPermLabel(p: PuPerm): string {
  if (p === 'full') return 'Full quyền PU Report';
  if (p === 'upload_only') return 'Chỉ xem dữ liệu thô & Import';
  return 'Không có quyền PU Report';
}

function UsersTab({ onToast }: { onToast: (t: Toast) => void }) {
  const { user: currentUser, refreshHotels } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<UserFormState>({
    id: null,
    username: '',
    password: '',
    email: '',
    role: 'user',
    allowed: [],
    canAccessPuReport: false,
    canUploadPuOnly: false,
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [h, u] = await Promise.all([
      supabase.from('hotels').select('*').order('name'),
      supabase.from('app_users').select('*').order('created_at', { ascending: false }),
    ]);
    setHotels((h.data as Hotel[]) || []);
    setUsers((u.data as AppUser[]) || []);
    setLoading(false);
  }, []);

  // Fetch once on mount only. The hasFetchedRef guard prevents any re-fetch
  // triggered by parent re-renders or context value identity changes.
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    loadAll();
    refreshHotels();
  }, [loadAll, refreshHotels]);

  // Expose a manual reload that resets the guard so post-mutation refetches work.
  const reloadUsers = useCallback(async () => {
    hasFetchedRef.current = true;
    await loadAll();
  }, [loadAll]);

  const openAdd = () => {
    setForm({
      id: null,
      username: '',
      password: '',
      email: '',
      role: 'user',
      allowed: [],
      canAccessPuReport: false,
      canUploadPuOnly: false,
    });
    setModalOpen(true);
  };
  const openEdit = (u: AppUser) => {
    setForm({
      id: u.id,
      username: u.username,
      password: u.password,
      email: u.email || '',
      role: u.role,
      allowed: u.allowed_hotel_ids || [],
      canAccessPuReport: u.can_access_pu_report === true,
      canUploadPuOnly: u.can_upload_pu_only === true,
    });
    setModalOpen(true);
  };

  const toggleAllowed = (hid: string) => {
    if (form.role === 'admin') return; // admin always '*'
    setForm((f) => {
      const has = f.allowed.includes(hid);
      return { ...f, allowed: has ? f.allowed.filter((x) => x !== hid) : [...f.allowed, hid] };
    });
  };

  const saveUser = async () => {
    if (!form.username.trim()) {
      onToast({ kind: 'err', text: 'Tên đăng nhập không được để trống.' });
      return;
    }
    if (!form.password.trim()) {
      onToast({ kind: 'err', text: 'Mật khẩu không được để trống.' });
      return;
    }
    setSaving(true);
    const allowedHotels = form.role === 'admin' ? ['*'] : form.allowed;
    const payload = {
      username: form.username.trim(),
      password: form.password,
      email: form.email.trim() || null,
      role: form.role,
      allowed_hotel_ids: allowedHotels,
      can_access_pu_report: form.role === 'admin' ? true : form.canAccessPuReport,
      can_upload_pu_only: form.role === 'admin' ? false : form.canUploadPuOnly,
    };
    if (form.id) {
      const { error } = await supabase.from('app_users').update(payload).eq('id', form.id);
      if (error) {
        onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
        setSaving(false);
        return;
      }
      onToast({ kind: 'ok', text: 'Đã cập nhật tài khoản.' });
    } else {
      const { error } = await supabase.from('app_users').insert(payload);
      if (error) {
        onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
        setSaving(false);
        return;
      }
      onToast({ kind: 'ok', text: 'Đã tạo tài khoản mới.' });
    }
    setSaving(false);
    setModalOpen(false);
    await reloadUsers();
  };

  const deleteUser = async (u: AppUser) => {
    if (u.id === currentUser?.id) {
      onToast({ kind: 'err', text: 'Không thể xoá tài khoản đang đăng nhập.' });
      return;
    }
    if (!confirm(`Xoá tài khoản "${u.username}"?`)) return;
    const { error } = await supabase.from('app_users').delete().eq('id', u.id);
    if (error) onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    else {
      onToast({ kind: 'ok', text: `Đã xoá tài khoản "${u.username}".` });
      await reloadUsers();
    }
  };

  const updatePuPerm = async (u: AppUser, perm: PuPerm) => {
    if (u.role === 'admin') return;
    const canAccessPuReport = perm === 'full';
    const canUploadPuOnly = perm === 'upload_only';
    const { error } = await supabase
      .from('app_users')
      .update({ can_access_pu_report: canAccessPuReport, can_upload_pu_only: canUploadPuOnly })
      .eq('id', u.id);
    if (error) {
      onToast({ kind: 'err', text: `Lỗi: ${error.message}` });
    } else {
      onToast({ kind: 'ok', text: 'Đã cập nhật phân quyền tài khoản thành công' });
      await reloadUsers();
    }
  };

  const hotelNameById = useMemo(() => {
    const m = new Map<string, string>();
    hotels.forEach((h) => m.set(h.id, h.name));
    return m;
  }, [hotels]);

  const describeAllowed = (u: AppUser): string => {
    const ids = u.allowed_hotel_ids || [];
    if (ids.includes('*')) return 'Tất cả khách sạn';
    if (ids.length === 0) return '— Chưa gán —';
    return ids.map((id) => hotelNameById.get(id) || id).join(', ');
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-800">Tài khoản & phân quyền</h2>
        <Button variant="gold" size="sm" onClick={openAdd}>
          <Plus size={14} /> Thêm tài khoản
        </Button>
      </div>

      <div className="overflow-x-auto thin-scroll">
        {loading ? (
          <div className="p-4">
            <EmptyState message="Đang tải dữ liệu…" />
          </div>
        ) : users.length === 0 ? (
          <div className="p-4">
            <EmptyState message="Chưa có tài khoản nào." />
          </div>
        ) : (
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-navy-50 text-navy-700">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Tên đăng nhập</th>
                <th className="text-left px-3 py-2 font-semibold">Email thông báo</th>
                <th className="text-left px-3 py-2 font-semibold">Vai trò</th>
                <th className="text-left px-3 py-2 font-semibold">Khách sạn được xem</th>
                <th className="text-left px-3 py-2 font-semibold">PU Report</th>
                <th className="text-left px-3 py-2 font-semibold">Ngày tạo</th>
                <th className="text-right px-3 py-2 font-semibold w-24">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-navy-50">
                  <td className="px-3 py-2.5 font-medium text-navy-800">
                    {u.username}
                    {u.id === currentUser?.id && (
                      <span className="ml-2 text-xs text-gold-600">(bạn)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-navy-600 text-xs">{u.email || '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.role === 'admin' ? 'gold' : 'neutral'}>
                      {u.role === 'admin' ? 'Admin' : 'User'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-navy-600 text-xs">
                    {describeAllowed(u)}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.role === 'admin' ? (
                      <Badge tone="gold">Admin</Badge>
                    ) : (
                      <div className="space-y-1">
                        {(['full', 'upload_only', 'none'] as PuPerm[]).map((p) => {
                          const checked = puPermFromUser(u) === p;
                          return (
                            <label
                              key={p}
                              className="flex items-center gap-1.5 text-xs text-navy-700 cursor-pointer hover:text-navy-800"
                            >
                              <input
                                type="radio"
                                name={`pu-perm-${u.id}`}
                                checked={checked}
                                onChange={() => updatePuPerm(u, p)}
                                className="accent-gold-500"
                              />
                              {puPermLabel(p)}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 mono-num text-navy-500 text-xs whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-md text-navy-500 hover:bg-navy-100"
                        title="Sửa"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteUser(u)}
                        className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                        title="Xoá"
                        disabled={u.id === currentUser?.id}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Sửa tài khoản' : 'Thêm tài khoản'}
        maxWidth="max-w-lg"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tên đăng nhập">
              <Input
                value={form.username}
                onChange={(v) => setForm({ ...form, username: v })}
                placeholder="admin hoặc gm.dlecia"
              />
            </Field>
            <Field label="Mật khẩu">
              <Input
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                placeholder="••••••"
              />
            </Field>
          </div>
          <Field label="Email thông báo" hint="Email nhận thông báo yêu cầu đổi giá">
            <Input
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="gm.dlecia@gmail.com"
              type="email"
            />
          </Field>
          <Field label="Vai trò">
            <Select
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v as Role, allowed: v === 'admin' ? [] : form.allowed })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>

          {form.role === 'user' && (
            <Field label="Quyền truy cập PU Report" hint="Chọn mức phân quyền cho trang PU Report">
              <div className="space-y-1.5">
                {([
                  { v: 'full', label: 'Full quyền PU Report', desc: 'Xem KPIs, Smart Alerts, charts, dữ liệu thô & upload files' },
                  { v: 'upload_only', label: 'Chỉ xem dữ liệu thô & Import Data', desc: 'Chỉ xem bảng dữ liệu thô và import file (ẩn KPIs/ADR/Doanh thu)' },
                  { v: 'none', label: 'Không có quyền PU Report', desc: 'Không truy cập trang PU Report' },
                ] as { v: PuPerm; label: string; desc: string }[]).map((opt) => {
                  const checked =
                    opt.v === 'full'
                      ? form.canAccessPuReport
                      : opt.v === 'upload_only'
                        ? form.canUploadPuOnly && !form.canAccessPuReport
                        : !form.canAccessPuReport && !form.canUploadPuOnly;
                  return (
                    <label
                      key={opt.v}
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                        checked
                          ? 'border-gold-500/40 bg-gold-500/10 text-navy-800'
                          : 'border-navy-100 bg-navy-50/40 text-navy-700 hover:bg-navy-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pu-perm-form"
                        checked={checked}
                        onChange={() =>
                          setForm({
                            ...form,
                            canAccessPuReport: opt.v === 'full',
                            canUploadPuOnly: opt.v === 'upload_only',
                          })
                        }
                        className="accent-gold-500 mt-0.5"
                      />
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-navy-400 mt-0.5">{opt.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}

          {form.role === 'admin' ? (
            <div className="rounded-lg bg-gold-500/10 border border-gold-500/20 px-3 py-2 text-xs text-gold-700">
              Admin có quyền xem tất cả khách sạn (allowed_hotel_ids = ["*"]).
            </div>
          ) : (
            <Field label="Khách sạn được xem" hint="Chọn các khách sạn user này có thể truy cập">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-auto thin-scroll border border-navy-100 rounded-lg p-2">
                {hotels.map((h) => {
                  const checked = form.allowed.includes(h.id);
                  return (
                    <label
                      key={h.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-navy-50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAllowed(h.id)}
                        className="accent-navy-700"
                      />
                      <span className="text-navy-700">{h.name}</span>
                    </label>
                  );
                })}
                {hotels.length === 0 && (
                  <div className="text-xs text-navy-400 px-2 py-2">Chưa có khách sạn.</div>
                )}
              </div>
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Hủy
            </Button>
            <Button variant="gold" onClick={saveUser} disabled={saving}>
              {saving ? 'Đang lưu…' : form.id ? 'Cập nhật' : 'Tạo tài khoản'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
