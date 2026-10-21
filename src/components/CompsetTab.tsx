import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  Save,
  Swords,
  Lightbulb,
  TrendingUp,
} from 'lucide-react';
import { DatePicker } from '@/components/DatePicker';
import { supabase } from '@/lib/supabase';
import { Button, Card, Field, EmptyState, Select } from '@/components/ui';
import { formatVND, toISODate, toDMY } from '@/lib/format';

const WEEKDAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

interface Competitor {
  id: string;
  hotel_id: string;
  name: string;
  room_type_match: string;
  default_hotel_link: string;
  display_order: number;
}

interface DailyEntry {
  id: string;
  hotel_id: string;
  competitor_id: string | null;
  date: string;
  entry_type: 'direct' | 'search';
  competitor_name: string;
  selling_rate: number | null;
  availability_status: string;
  pace_status: string | null;
}

interface ManualRoomsEntry {
  date: string;
  actual_rooms_sold: number;
  my_rate: number | null;
  manual_occupancy: number | null;
}

const PACE_OPTIONS = [
  { value: 'very_available', label: '🟢 Còn rất nhiều phòng (Bán chậm)' },
  { value: 'selling_fast', label: '🟡 Bán chạy / Đặt nhiều' },
  { value: 'sold_out', label: '🔴 Sold Out / Đã hết phòng' },
  { value: 'no_data', label: '⚪ Chưa có dữ liệu' },
];

const MAX_COMPETITORS = 5;

export function CompsetTab({ hotelId }: { hotelId: string }) {
  const [subTab, setSubTab] = useState<'setup' | 'tracker'>('setup');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [manualEntries, setManualEntries] = useState<Map<string, ManualRoomsEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Edit state for setup
  const [editComps, setEditComps] = useState<Competitor[]>([]);
  const [savingSetup, setSavingSetup] = useState(false);
  const [setupMsg, setSetupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Edit state for tracker
  const [entryDraft, setEntryDraft] = useState<Map<string, string>>(new Map());
  const [savingTracker, setSavingTracker] = useState(false);
  const [trackerMsg, setTrackerMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Default selected date = today
  useEffect(() => {
    if (!selectedDate) setSelectedDate(toISODate(new Date()));
  }, [selectedDate]);

  // Load competitors
  const loadCompetitors = useCallback(async () => {
    if (!hotelId) {
      setCompetitors([]);
      setEditComps([]);
      return;
    }
    const { data } = await supabase
      .from('compset_competitors')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('display_order', { ascending: true });
    const comps = (data as Competitor[]) || [];
    setCompetitors(comps);
    setEditComps(comps.length > 0 ? comps : []);
  }, [hotelId]);

  // Load daily entries
  const loadEntries = useCallback(async () => {
    if (!hotelId) {
      setEntries([]);
      return;
    }
    const today = toISODate(new Date());
    const endRange = toISODate(new Date(Date.now() + 365 * 86400000));
    const { data } = await supabase
      .from('compset_daily_entries')
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('date', today)
      .lte('date', endRange);
    setEntries((data as DailyEntry[]) || []);
  }, [hotelId]);

  // Load manual rooms sold (for my_rate and manual_occupancy)
  const loadManual = useCallback(async () => {
    if (!hotelId) {
      setManualEntries(new Map());
      return;
    }
    const today = toISODate(new Date());
    const endRange = toISODate(new Date(Date.now() + 365 * 86400000));
    const { data } = await supabase
      .from('manual_rooms_sold')
      .select('date, actual_rooms_sold, my_rate, manual_occupancy')
      .eq('hotel_id', hotelId)
      .gte('date', today)
      .lte('date', endRange);
    const map = new Map<string, ManualRoomsEntry>();
    ((data as ManualRoomsEntry[]) || []).forEach((row) => {
      map.set(row.date, row);
    });
    setManualEntries(map);
  }, [hotelId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCompetitors(), loadEntries(), loadManual()]).finally(() => setLoading(false));
  }, [loadCompetitors, loadEntries, loadManual]);

  // Sync entry draft from loaded entries
  useEffect(() => {
    const draft = new Map<string, string>();
    entries.forEach((e) => {
      const key = `${e.date}|${e.entry_type}|${e.competitor_id || e.competitor_name}`;
      if (e.selling_rate != null) draft.set(`${key}|rate`, String(e.selling_rate));
      if (e.availability_status) draft.set(`${key}|avail`, e.availability_status);
      if (e.pace_status) draft.set(`${key}|pace`, e.pace_status);
    });
    setEntryDraft(draft);
  }, [entries]);

  // ============ SETUP: Add/Remove/Edit competitors ============

  const addCompetitor = () => {
    if (editComps.length >= MAX_COMPETITORS) return;
    const newComp: Competitor = {
      id: `new-${Date.now()}`,
      hotel_id: hotelId,
      name: '',
      room_type_match: '',
      default_hotel_link: '',
      display_order: editComps.length,
    };
    setEditComps([...editComps, newComp]);
  };

  const removeCompetitor = (idx: number) => {
    setEditComps(editComps.filter((_, i) => i !== idx));
  };

  const updateCompetitor = (idx: number, field: keyof Competitor, value: string) => {
    setEditComps(editComps.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const saveSetup = async () => {
    setSavingSetup(true);
    setSetupMsg(null);
    try {
      // Delete existing competitors not in edit list (by id)
      const existingIds = competitors.map((c) => c.id);
      const keepIds = editComps.filter((c) => !c.id.startsWith('new-')).map((c) => c.id);
      const toDelete = existingIds.filter((id) => !keepIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('compset_competitors').delete().in('id', toDelete);
      }
      // Upsert competitors
      for (let i = 0; i < editComps.length; i++) {
        const c = editComps[i];
        if (!c.name.trim()) continue;
        const payload = {
          hotel_id: hotelId,
          name: c.name.trim(),
          room_type_match: c.room_type_match || '',
          default_hotel_link: c.default_hotel_link || '',
          display_order: i,
        };
        if (c.id.startsWith('new-')) {
          await supabase.from('compset_competitors').insert(payload);
        } else {
          await supabase.from('compset_competitors').update(payload).eq('id', c.id);
        }
      }
      setSetupMsg({ kind: 'ok', text: 'Đã lưu cấu hình Compset thành công.' });
      await loadCompetitors();
    } catch (e) {
      setSetupMsg({ kind: 'err', text: `Lỗi: ${(e as Error).message}` });
    }
    setSavingSetup(false);
  };

  // ============ TRACKER: Save entries ============

  const saveTrackerEntry = async (
    date: string,
    entryType: 'direct' | 'search',
    competitorId: string | null,
    competitorName: string,
  ) => {
    if (!hotelId) return;
    setSavingTracker(true);
    setTrackerMsg(null);
    const key = `${date}|${entryType}|${competitorId || competitorName}`;
    const rate = Number(entryDraft.get(`${key}|rate`) || 0) || null;
    const avail = entryDraft.get(`${key}|avail`) || 'available';
    const pace = entryDraft.get(`${key}|pace`) || null;

    const payload = {
      hotel_id: hotelId,
      date,
      entry_type: entryType,
      competitor_id: competitorId,
      competitor_name: competitorName,
      selling_rate: rate,
      availability_status: avail,
      pace_status: pace,
    };

    const { error } = await supabase
      .from('compset_daily_entries')
      .upsert(payload, { onConflict: 'hotel_id,date,competitor_id,entry_type' });

    if (error) {
      setTrackerMsg({ kind: 'err', text: `Lỗi: ${error.message}` });
    } else {
      setTrackerMsg({ kind: 'ok', text: `Đã lưu entry cho ${toDMY(date)}.` });
      await loadEntries();
    }
    setSavingTracker(false);
  };

  const saveManualEntry = async (date: string) => {
    if (!hotelId) return;
    setSavingTracker(true);
    setTrackerMsg(null);
    const rateKey = `${date}|my_rate`;
    const occKey = `${date}|manual_occ`;
    const soldKey = `${date}|manual_sold`;
    const myRate = Number(entryDraft.get(rateKey) || 0) || null;
    const manualOcc = Number(entryDraft.get(occKey) || 0) || null;
    const manualSold = Number(entryDraft.get(soldKey) || 0) || 0;

    const existing = manualEntries.get(date);
    const payload = {
      hotel_id: hotelId,
      date,
      actual_rooms_sold: existing?.actual_rooms_sold ?? manualSold,
      my_rate: myRate,
      manual_occupancy: manualOcc,
    };

    const { error } = await supabase
      .from('manual_rooms_sold')
      .upsert(payload, { onConflict: 'hotel_id,date' });

    if (error) {
      setTrackerMsg({ kind: 'err', text: `Lỗi: ${error.message}` });
    } else {
      setTrackerMsg({ kind: 'ok', text: `Đã lưu My Rate cho ${toDMY(date)}.` });
      await loadManual();
    }
    setSavingTracker(false);
  };

  // ============ CALCULATIONS for selected date ============

  const selectedDateData = useMemo(() => {
    if (!selectedDate) return null;
    const dayEntries = entries.filter((e) => e.date === selectedDate);

    // My rate
    const manual = manualEntries.get(selectedDate);
    const myRate = manual?.my_rate ?? null;

    // Direct compset rates (available only)
    const directEntries = dayEntries.filter((e) => e.entry_type === 'direct');
    const directAvail = directEntries.filter((e) => e.availability_status === 'available' && e.selling_rate != null);
    const directAdr = directAvail.length > 0
      ? directAvail.reduce((s, e) => s + (Number(e.selling_rate) || 0), 0) / directAvail.length
      : 0;

    // Search compset rates
    const searchEntries = dayEntries.filter((e) => e.entry_type === 'search');
    const searchWithRates = searchEntries.filter((e) => e.selling_rate != null);
    const searchAdr = searchWithRates.length > 0
      ? searchWithRates.reduce((s, e) => s + (Number(e.selling_rate) || 0), 0) / searchWithRates.length
      : 0;

    // Price Position Index
    const ppi = directAdr > 0 && myRate != null ? (myRate / directAdr) * 100 : 0;

    // Search compset pace: aggregate — if any direct comp name matches a search entry name, include its rate
    const directNames = new Set(directEntries.map((e) => e.competitor_name.toLowerCase()));

    // Determine scenario
    const myRateVal = myRate ?? 0;
    const isMyRateHigher = directAdr > 0 && myRateVal > directAdr;
    const isMyRateEqualOrLower = directAdr > 0 && myRateVal <= directAdr;
    const competitorsSoldOut = directEntries.length > 0 && directEntries.every((e) => e.availability_status === 'sold_out');
    const competitorsAvailable = directAvail.length > 0;
    const searchPace = searchEntries[0]?.pace_status || 'no_data';
    const searchVeryAvailable = searchPace === 'very_available';

    let scenario = 0;
    if (isMyRateHigher && competitorsAvailable) scenario = 1;
    else if (isMyRateHigher && competitorsSoldOut) scenario = 2;
    else if (isMyRateEqualOrLower && (searchVeryAvailable || competitorsAvailable)) scenario = 3;
    else if (isMyRateEqualOrLower && !competitorsAvailable && !searchVeryAvailable) scenario = 4;

    return {
      myRate: myRateVal,
      directAdr,
      searchAdr,
      ppi,
      scenario,
      directEntries,
      searchEntries,
      directNames,
    };
  }, [selectedDate, entries, manualEntries]);

  const SCENARIOS = [
    {
      num: 1,
      title: 'Kịch bản 1: Giá của bạn cao hơn Compset + Đối thủ còn rất nhiều phòng',
      diagnosis: 'Giá của bạn đang cao hơn mặt bằng chung. Khách hàng so sánh giá trên OTA và chọn đặt chỗ của đối thủ.',
      proposal: 'Giá của bạn đang cao hơn trung bình Compset và đối thủ vẫn còn nhiều phòng. Đề xuất: Cân nhắc giảm giá nhẹ về sát mức Direct Compset ADR để tăng cạnh tranh.',
      color: 'border-red-300 bg-red-50/60',
      activeColor: 'border-red-400 bg-red-50 shadow-md ring-2 ring-red-300/40',
    },
    {
      num: 2,
      title: 'Kịch bản 2: Giá của bạn cao hơn Compset BUT Đối thủ đã Sold out (hoặc sắp hết)',
      diagnosis: 'Nhu cầu thị trường tốt! Đối thủ giá rẻ đã bán hết phòng trước, bây giờ nhu cầu đang dồn về chỗ của bạn.',
      proposal: 'Đối thủ giá rẻ đã hết phòng! Nhu cầu thị trường đang dồn về bạn. Đề xuất: Giữ nguyên giá cao hoặc chỉ điều chỉnh giảm nhẹ, không cần xả giá gấp.',
      color: 'border-emerald-300 bg-emerald-50/60',
      activeColor: 'border-emerald-400 bg-emerald-50 shadow-md ring-2 ring-emerald-300/40',
    },
    {
      num: 3,
      title: 'Kịch bản 3: Giá của bạn bằng/rẻ hơn Compset + Đối thủ cũng ế (Còn rất nhiều phòng)',
      diagnosis: 'Nhu cầu toàn thị trường đang giảm (Low Market Demand). Ngày này cả khu vực đều vắng khách, không phải do giá của bạn đắt.',
      proposal: 'Toàn thị trường đang vắng khách (Compset cũng chưa bán được). Việc giảm giá sâu lúc này chưa chắc hiệu quả. Đề xuất: Tập trung đẩy mạnh bài viết bán gói Combo/Ưu đãi trên Zalo/Fanpage hoặc bật Last-Minute Deal trước 1 ngày.',
      color: 'border-amber-300 bg-amber-50/60',
      activeColor: 'border-amber-400 bg-amber-50 shadow-md ring-2 ring-amber-300/40',
    },
    {
      num: 4,
      title: 'Kịch bản 4: Giá bạn rẻ hơn Compset + Đối thủ vẫn bán được nhưng bạn Ế',
      diagnosis: 'Giá của bạn rất tốt so với thị trường nhưng vẫn chưa có khách. Vấn đề nằm ở Kênh bán, Hình ảnh hoặc Điểm đánh giá (Review).',
      proposal: 'Đề xuất kiểm tra lại: 1. Đã mở bán đầy đủ trên các sàn OTA chưa? 2. Hình ảnh/Điểm đánh giá review có bị giảm không? 3. Bài đăng Zalo/Fanpage có bị trôi không?',
      color: 'border-navy-300 bg-navy-50/60',
      activeColor: 'border-navy-400 bg-navy-50 shadow-md ring-2 ring-navy-300/40',
    },
  ];

  const setDraft = (key: string, value: string) => {
    setEntryDraft((prev) => new Map(prev).set(key, value));
  };

  const getDraft = (key: string): string => entryDraft.get(key) ?? '';

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex gap-1 bg-navy-50 rounded-xl p-1 border border-navy-100 w-fit">
        <button
          onClick={() => setSubTab('setup')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            subTab === 'setup' ? 'bg-white text-navy-800 shadow-sm' : 'text-navy-500 hover:text-navy-700 hover:bg-navy-100'
          }`}
        >
          <Building2 size={16} /> Compset Setup
        </button>
        <button
          onClick={() => setSubTab('tracker')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            subTab === 'tracker' ? 'bg-white text-navy-800 shadow-sm' : 'text-navy-500 hover:text-navy-700 hover:bg-navy-100'
          }`}
        >
          <Swords size={16} /> Rate Tracker & Action Insights
        </button>
      </div>

      {loading && <EmptyState message="Đang tải dữ liệu Compset…" />}

      {/* ============ SUB-TAB 1: COMPSET SETUP ============ */}
      {subTab === 'setup' && !loading && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold text-navy-800">Direct Compset (Tối đa {MAX_COMPETITORS} đối thủ)</div>
              <div className="text-xs text-navy-400 mt-0.5">Cấu hình danh sách đối thủ cạnh tranh trực tiếp.</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={addCompetitor} disabled={editComps.length >= MAX_COMPETITORS}>
                <Plus size={14} /> Thêm đối thủ
              </Button>
              <Button variant="gold" size="sm" onClick={saveSetup} disabled={savingSetup}>
                <Save size={14} /> {savingSetup ? 'Đang lưu…' : 'Lưu cấu hình'}
              </Button>
            </div>
          </div>

          {editComps.length === 0 ? (
            <EmptyState message="Chưa có đối thủ nào. Nhấn 'Thêm đối thủ' để bắt đầu." />
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="bg-navy-50 text-navy-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold w-8">#</th>
                    <th className="text-left px-3 py-2 font-semibold">Tên đối thủ</th>
                    <th className="text-left px-3 py-2 font-semibold">Room Type Match</th>
                    <th className="text-left px-3 py-2 font-semibold">Default Hotel Link</th>
                    <th className="w-12 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {editComps.map((c, idx) => (
                    <tr key={c.id} className="border-t border-navy-50">
                      <td className="px-3 py-2 text-navy-400 font-semibold">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          value={c.name}
                          onChange={(e) => updateCompetitor(idx, 'name', e.target.value)}
                          placeholder="VD: Khách sạn ABC"
                          className="w-full bg-white border border-navy-200 rounded-md px-2.5 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={c.room_type_match}
                          onChange={(e) => updateCompetitor(idx, 'room_type_match', e.target.value)}
                          placeholder="VD: Deluxe Double"
                          className="w-full bg-white border border-navy-200 rounded-md px-2.5 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={c.default_hotel_link}
                          onChange={(e) => updateCompetitor(idx, 'default_hotel_link', e.target.value)}
                          placeholder="VD: booking.com/abc"
                          className="w-full bg-white border border-navy-200 rounded-md px-2.5 py-1.5 text-sm text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => removeCompetitor(idx)}
                          className="p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600"
                          title="Xoá"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {setupMsg && (
            <div className={`text-sm ${setupMsg.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{setupMsg.text}</div>
          )}
        </Card>
      )}

      {/* ============ SUB-TAB 2: RATE TRACKER & ACTION INSIGHTS ============ */}
      {subTab === 'tracker' && !loading && (
        <>
          {/* Date selector — unlimited calendar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-navy-700">Chọn ngày:</span>
            <DatePicker
              value={selectedDate}
              onChange={(d) => setSelectedDate(d)}
              placeholder="Chọn ngày…"
            />
            {selectedDate && (
              <span className="text-xs text-navy-400">
                {WEEKDAY_VI[new Date(selectedDate + 'T00:00:00').getDay()]} {toDMY(selectedDate)}
              </span>
            )}
          </div>

          {/* SECTION A: DAILY MANUAL ENTRY MATRIX */}
          {selectedDate && (
            <Card className="p-4 space-y-4">
              <div className="text-sm font-semibold text-navy-800">Section A: Nhập liệu giá ngày {toDMY(selectedDate)}</div>

              {/* Row 1: My Hotel */}
              <div className="rounded-lg border border-gold-500/30 bg-gold-500/5 p-3 space-y-2">
                <div className="text-xs font-semibold text-gold-700 uppercase tracking-wide">Row 1: My Hotel</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="My Rate">
                    <input
                      type="number"
                      value={getDraft(`${selectedDate}|my_rate`)}
                      onChange={(e) => setDraft(`${selectedDate}|my_rate`, e.target.value)}
                      placeholder="0"
                      className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                    />
                  </Field>
                  <Field label="Manual Occupancy / Rooms Left">
                    <input
                      type="number"
                      value={getDraft(`${selectedDate}|manual_occ`)}
                      onChange={(e) => setDraft(`${selectedDate}|manual_occ`, e.target.value)}
                      placeholder="0"
                      className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button variant="gold" size="sm" onClick={() => saveManualEntry(selectedDate)} disabled={savingTracker}>
                      <Save size={14} /> Lưu My Hotel
                    </Button>
                  </div>
                </div>
              </div>

              {/* Row 2: Direct Compset */}
              <div className="rounded-lg border border-navy-200 bg-white p-3 space-y-2">
                <div className="text-xs font-semibold text-navy-600 uppercase tracking-wide">
                  Row 2: Direct Compset ({competitors.length}/{MAX_COMPETITORS})
                </div>
                {competitors.length === 0 ? (
                  <EmptyState message="Chưa cấu hình đối thủ. Vui lòng thêm đối thủ ở Sub-tab Compset Setup." />
                ) : (
                  <div className="overflow-x-auto thin-scroll">
                    <table className="w-full text-xs">
                      <thead className="bg-navy-50 text-navy-700">
                        <tr>
                          <th className="text-left px-2 py-2 font-semibold">Đối thủ</th>
                          <th className="text-center px-2 py-2 font-semibold">Selling Rate</th>
                          <th className="text-center px-2 py-2 font-semibold">Trạng thái</th>
                          <th className="w-16 px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {competitors.map((comp) => {
                          const key = `${selectedDate}|direct|${comp.id}`;
                          const avail = getDraft(`${key}|avail`) || 'available';
                          return (
                            <tr key={comp.id} className="border-t border-navy-50">
                              <td className="px-2 py-2 text-navy-700 font-medium">{comp.name}</td>
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="number"
                                  value={getDraft(`${key}|rate`)}
                                  onChange={(e) => setDraft(`${key}|rate`, e.target.value)}
                                  placeholder="0"
                                  className="w-20 text-center bg-white border border-navy-200 rounded-md px-1.5 py-1 text-xs text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
                                />
                              </td>
                              <td className="px-2 py-2 text-center">
                                <div className="inline-flex rounded-md overflow-hidden border border-navy-200">
                                  <button
                                    onClick={() => setDraft(`${key}|avail`, 'available')}
                                    className={`px-2 py-1 text-xs font-medium ${avail === 'available' ? 'bg-emerald-500 text-white' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
                                  >
                                    Available
                                  </button>
                                  <button
                                    onClick={() => setDraft(`${key}|avail`, 'sold_out')}
                                    className={`px-2 py-1 text-xs font-medium ${avail === 'sold_out' ? 'bg-red-500 text-white' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
                                  >
                                    Sold Out
                                  </button>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  onClick={() => saveTrackerEntry(selectedDate, 'direct', comp.id, comp.name)}
                                  disabled={savingTracker}
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
                )}
                {selectedDateData && selectedDateData.directAdr > 0 && (
                  <div className="text-xs font-semibold text-navy-700 bg-navy-50 rounded-md px-3 py-1.5">
                    Direct Compset ADR: <span className="mono-num text-navy-900">{formatVND(Math.round(selectedDateData.directAdr))}</span>
                    {' '}({selectedDateData.directEntries.filter((e) => e.availability_status === 'available').length} available)
                  </div>
                )}
              </div>

              {/* Row 3: Search Compset */}
              <div className="rounded-lg border border-navy-200 bg-white p-3 space-y-2">
                <div className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Row 3: Search Compset (Pace Dropdown)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Search Compset Pace Status">
                    <Select
                      value={getDraft(`${selectedDate}|search|search_comp|pace`) || 'no_data'}
                      onChange={(v) => setDraft(`${selectedDate}|search|search_comp|pace`, v)}
                    >
                      {PACE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Search Compset Rate (nếu khớp Direct Compset)">
                    <input
                      type="number"
                      value={getDraft(`${selectedDate}|search|search_comp|rate`)}
                      onChange={(e) => setDraft(`${selectedDate}|search|search_comp|rate`, e.target.value)}
                      placeholder="0 (tùy chọn)"
                      className="w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400"
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="subtle" size="sm" onClick={() => saveTrackerEntry(selectedDate, 'search', null, 'search_comp')} disabled={savingTracker}>
                    <Save size={14} /> Lưu Search Compset
                  </Button>
                  {selectedDateData && selectedDateData.searchAdr > 0 && (
                    <span className="text-xs font-semibold text-navy-700">
                      Search Compset ADR: <span className="mono-num text-navy-900">{formatVND(Math.round(selectedDateData.searchAdr))}</span>
                    </span>
                  )}
                </div>
              </div>

              {trackerMsg && (
                <div className={`text-sm ${trackerMsg.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{trackerMsg.text}</div>
              )}
            </Card>
          )}

          {/* SECTION B: OVERALL KPI CARDS */}
          {selectedDateData && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl bg-gradient-to-br from-gold-500/10 to-navy-50/40 border border-gold-500/20 px-4 py-3">
                <div className="text-xs text-navy-500 font-medium">My ADR</div>
                <div className="text-xl font-bold mono-num text-navy-900 mt-1">
                  {selectedDateData.myRate > 0 ? formatVND(Math.round(selectedDateData.myRate)) : '—'}
                </div>
              </div>
              <div className="rounded-xl bg-white border border-navy-100 px-4 py-3">
                <div className="text-xs text-navy-500 font-medium">Direct Compset ADR</div>
                <div className="text-xl font-bold mono-num text-navy-800 mt-1">
                  {selectedDateData.directAdr > 0 ? formatVND(Math.round(selectedDateData.directAdr)) : '—'}
                </div>
              </div>
              <div className="rounded-xl bg-white border border-navy-100 px-4 py-3">
                <div className="text-xs text-navy-500 font-medium">Search Compset ADR</div>
                <div className="text-xl font-bold mono-num text-navy-700 mt-1">
                  {selectedDateData.searchAdr > 0 ? formatVND(Math.round(selectedDateData.searchAdr)) : '—'}
                </div>
              </div>
              <div className={`rounded-xl border px-4 py-3 ${selectedDateData.ppi > 0 ? 'bg-navy-700 text-white border-navy-700' : 'bg-white border-navy-100'}`}>
                <div className={`text-xs font-medium ${selectedDateData.ppi > 0 ? 'text-navy-200' : 'text-navy-500'}`}>Price Position Index</div>
                <div className={`text-xl font-bold mono-num mt-1 ${selectedDateData.ppi > 0 ? 'text-white' : 'text-navy-400'}`}>
                  {selectedDateData.ppi > 0 ? `${selectedDateData.ppi.toFixed(0)}%` : '—'}
                </div>
              </div>
            </div>
          )}

          {/* SECTION C: 4-SCENARIO ACTIONABLE INSIGHT PLAYBOOK */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-navy-800 font-semibold text-sm">
              <Lightbulb size={16} className="text-gold-600" />
              Section C: Actionable Insight Playbook — 4 Kịch bản
            </div>
            <div className="text-xs text-navy-400">
              Ngày đang xem: <span className="font-semibold text-navy-700">{selectedDate ? toDMY(selectedDate) : '—'}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SCENARIOS.map((s) => {
                const isActive = selectedDateData?.scenario === s.num;
                return (
                  <div
                    key={s.num}
                    className={`rounded-xl border p-4 transition-all duration-300 ${
                      isActive ? s.activeColor : `opacity-50 ${s.color}`
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isActive ? 'bg-navy-700 text-white' : 'bg-navy-100 text-navy-500'
                      }`}>
                        {s.num}
                      </div>
                      <div className="text-sm font-semibold text-navy-800 leading-snug">{s.title}</div>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="font-semibold text-navy-700">Chẩn đoán: </span>
                        <span className="text-navy-600">{s.diagnosis}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-navy-700">Đề xuất: </span>
                        <span className="text-navy-600">{s.proposal}</span>
                      </div>
                    </div>
                    {isActive && (
                      <div className="mt-2 text-xs font-bold text-gold-700 flex items-center gap-1">
                        <TrendingUp size={12} /> Kịch bản phù hợp với ngày này
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mandatory disclaimer */}
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <span className="font-semibold">Lưu ý quan trọng:</span> Các kịch bản trên được hệ thống tổng hợp tự động dựa theo dữ liệu đầu vào và chỉ mang tính chất tham khảo. Quyết định điều chỉnh giá cuối cùng hoàn toàn thuộc về chủ khách sạn dựa trên tình hình thực tế.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
