import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  Save,
  Swords,
  Lightbulb,
  TrendingUp,
  Activity,
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
  search_row_index: number | null;
}

interface ManualRoomsEntry {
  date: string;
  actual_rooms_sold: number;
  my_rate: number | null;
  manual_occupancy: number | null;
}

const PACE_OPTIONS = [
  { value: 'fast', label: '🟢 Đang bán nhanh / Fast Pace' },
  { value: 'normal', label: '🟡 Bán bình thường / Normal Pace' },
  { value: 'slow', label: '🔴 Bán chậm / Slow Pace' },
  { value: 'sold_out', label: '⚫ Sold Out / Đã hết phòng' },
];

const PACE_LABELS: Record<string, string> = {
  fast: 'Bán nhanh',
  normal: 'Bình thường',
  slow: 'Bán chậm',
  sold_out: 'Sold Out',
};

const PACE_COLORS: Record<string, string> = {
  fast: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  normal: 'text-amber-700 bg-amber-50 border-amber-200',
  slow: 'text-red-700 bg-red-50 border-red-200',
  sold_out: 'text-navy-700 bg-navy-100 border-navy-200',
};

const MAX_COMPETITORS = 5;
const MAX_SEARCH_ROWS = 5;

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
      // Direct entries keyed by competitor_id
      if (e.entry_type === 'direct') {
        const key = `${e.date}|direct|${e.competitor_id}`;
        if (e.selling_rate != null) draft.set(`${key}|rate`, String(e.selling_rate));
        if (e.availability_status) draft.set(`${key}|avail`, e.availability_status);
        if (e.pace_status) draft.set(`${key}|pace`, e.pace_status);
      }
      // Search entries keyed by search_row_index
      if (e.entry_type === 'search') {
        const rowIdx = e.search_row_index ?? 0;
        const key = `${e.date}|search|${rowIdx}`;
        if (e.competitor_name) draft.set(`${key}|name`, e.competitor_name);
        if (e.pace_status) draft.set(`${key}|pace`, e.pace_status);
        if (e.selling_rate != null) draft.set(`${key}|rate`, String(e.selling_rate));
      }
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
      const existingIds = competitors.map((c) => c.id);
      const keepIds = editComps.filter((c) => !c.id.startsWith('new-')).map((c) => c.id);
      const toDelete = existingIds.filter((id) => !keepIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('compset_competitors').delete().in('id', toDelete);
      }
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

  const saveDirectEntry = async (date: string, competitorId: string, competitorName: string) => {
    if (!hotelId) return;
    setSavingTracker(true);
    setTrackerMsg(null);
    const key = `${date}|direct|${competitorId}`;
    const rate = Number(entryDraft.get(`${key}|rate`) || 0) || null;
    const avail = entryDraft.get(`${key}|avail`) || 'available';
    const pace = entryDraft.get(`${key}|pace`) || 'normal';

    const payload = {
      hotel_id: hotelId,
      date,
      entry_type: 'direct' as const,
      competitor_id: competitorId,
      competitor_name: competitorName,
      selling_rate: rate,
      availability_status: pace === 'sold_out' ? 'sold_out' : 'available',
      pace_status: pace,
      search_row_index: 0,
    };

    const { error } = await supabase
      .from('compset_daily_entries')
      .upsert(payload, { onConflict: 'hotel_id,date,entry_type,competitor_id' });

    if (error) {
      setTrackerMsg({ kind: 'err', text: `Lỗi: ${error.message}` });
    } else {
      setTrackerMsg({ kind: 'ok', text: `Đã lưu Direct entry cho ${competitorName}.` });
      await loadEntries();
    }
    setSavingTracker(false);
  };

  const saveSearchRow = async (date: string, rowIdx: number) => {
    if (!hotelId) return;
    setSavingTracker(true);
    setTrackerMsg(null);
    const key = `${date}|search|${rowIdx}`;
    const name = entryDraft.get(`${key}|name`) || '';
    const pace = entryDraft.get(`${key}|pace`) || 'normal';
    const rate = Number(entryDraft.get(`${key}|rate`) || 0) || null;

    if (!name.trim()) {
      setTrackerMsg({ kind: 'err', text: 'Vui lòng nhập tên đối thủ Search Compset.' });
      setSavingTracker(false);
      return;
    }

    const payload = {
      hotel_id: hotelId,
      date,
      entry_type: 'search' as const,
      competitor_id: null,
      competitor_name: name.trim(),
      selling_rate: rate,
      availability_status: pace === 'sold_out' ? 'sold_out' : 'available',
      pace_status: pace,
      search_row_index: rowIdx,
    };

    const { error } = await supabase
      .from('compset_daily_entries')
      .upsert(payload, { onConflict: 'hotel_id,date,entry_type,search_row_index' });

    if (error) {
      setTrackerMsg({ kind: 'err', text: `Lỗi: ${error.message}` });
    } else {
      setTrackerMsg({ kind: 'ok', text: `Đã lưu Search entry "${name.trim()}" cho ${toDMY(date)}.` });
      await loadEntries();
    }
    setSavingTracker(false);
  };

  const saveAllSearchRows = async (date: string) => {
    if (!hotelId) return;
    setSavingTracker(true);
    setTrackerMsg(null);
    let errors = 0;
    let saved = 0;

    for (let i = 1; i <= MAX_SEARCH_ROWS; i++) {
      const key = `${date}|search|${i}`;
      const name = entryDraft.get(`${key}|name`) || '';
      if (!name.trim()) continue;

      const pace = entryDraft.get(`${key}|pace`) || 'normal';
      const rate = Number(entryDraft.get(`${key}|rate`) || 0) || null;

      const payload = {
        hotel_id: hotelId,
        date,
        entry_type: 'search' as const,
        competitor_id: null,
        competitor_name: name.trim(),
        selling_rate: rate,
        availability_status: pace === 'sold_out' ? 'sold_out' : 'available',
        pace_status: pace,
        search_row_index: i,
      };

      const { error } = await supabase
        .from('compset_daily_entries')
        .upsert(payload, { onConflict: 'hotel_id,date,entry_type,search_row_index' });

      if (error) errors++;
      else saved++;
    }

    if (errors > 0) {
      setTrackerMsg({ kind: 'err', text: `Lỗi lưu ${errors} dòng Search.` });
    } else if (saved > 0) {
      setTrackerMsg({ kind: 'ok', text: `Đã lưu ${saved} dòng Search Compset cho ${toDMY(date)}.` });
    } else {
      setTrackerMsg({ kind: 'err', text: 'Không có dòng nào để lưu. Vui lòng nhập tên đối thủ.' });
    }
    await loadEntries();
    setSavingTracker(false);
  };

  const saveManualEntry = async (date: string) => {
    if (!hotelId) return;
    setSavingTracker(true);
    setTrackerMsg(null);
    const rateKey = `${date}|my_rate`;
    const occKey = `${date}|manual_occ`;
    const myRate = Number(entryDraft.get(rateKey) || 0) || null;
    const manualOcc = Number(entryDraft.get(occKey) || 0) || null;

    const existing = manualEntries.get(date);
    const payload = {
      hotel_id: hotelId,
      date,
      actual_rooms_sold: existing?.actual_rooms_sold ?? 0,
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
    const myOccupancy = manual?.manual_occupancy ?? null;

    // Direct compset entries
    const directEntries = dayEntries.filter((e) => e.entry_type === 'direct');
    const directWithRates = directEntries.filter((e) => e.pace_status !== 'sold_out' && e.selling_rate != null);
    const directAdr = directWithRates.length > 0
      ? directWithRates.reduce((s, e) => s + (Number(e.selling_rate) || 0), 0) / directWithRates.length
      : 0;

    // Search compset entries
    const searchEntries = dayEntries.filter((e) => e.entry_type === 'search');
    const searchWithRates = searchEntries.filter((e) => e.selling_rate != null);
    const searchAdr = searchWithRates.length > 0
      ? searchWithRates.reduce((s, e) => s + (Number(e.selling_rate) || 0), 0) / searchWithRates.length
      : 0;

    // Price Position Index
    const ppi = directAdr > 0 && myRate != null ? (myRate / directAdr) * 100 : 0;

    // Direct compset names (for matching search rate eligibility)
    const directNames = new Set(directEntries.map((e) => e.competitor_name.toLowerCase()));

    // ============ COMBINED PACE ANALYSIS ============
    // Collect pace from both direct and search entries
    const allPaceStatuses: string[] = [];
    directEntries.forEach((e) => {
      if (e.pace_status) allPaceStatuses.push(e.pace_status);
    });
    searchEntries.forEach((e) => {
      if (e.pace_status) allPaceStatuses.push(e.pace_status);
    });

    const totalComps = allPaceStatuses.length;
    const fastCount = allPaceStatuses.filter((p) => p === 'fast').length;
    const slowCount = allPaceStatuses.filter((p) => p === 'slow').length;
    const soldOutCount = allPaceStatuses.filter((p) => p === 'sold_out').length;
    const normalCount = allPaceStatuses.filter((p) => p === 'normal').length;

    // Majority thresholds
    const majoritySoldOutOrFast = totalComps > 0 && (soldOutCount + fastCount) >= Math.ceil(totalComps / 2);
    const majoritySlow = totalComps > 0 && slowCount >= Math.ceil(totalComps / 2);
    const majorityFast = totalComps > 0 && fastCount >= Math.ceil(totalComps / 2);

    // Determine scenario
    const myRateVal = myRate ?? 0;
    const isMyRateHigher = directAdr > 0 && myRateVal > directAdr;
    const isMyRateEqualOrLower = directAdr > 0 && myRateVal <= directAdr;
    const isMyRateLower = directAdr > 0 && myRateVal < directAdr;

    // My hotel occupancy is slow (low rooms sold or low occupancy)
    const myHotelSlow = myOccupancy != null && myOccupancy >= 0 && myOccupancy < 30;

    let scenario = 0;
    if (isMyRateHigher && (majoritySlow || (totalComps > 0 && !majoritySoldOutOrFast))) {
      // Scenario 1: High Rate + Comps Available/Slow
      scenario = 1;
    } else if (isMyRateHigher && majoritySoldOutOrFast) {
      // Scenario 2: High Rate + Comps Sold Out / Fast
      scenario = 2;
    } else if (isMyRateEqualOrLower && majoritySlow) {
      // Scenario 3: Equal/Lower Rate + Market Slow
      scenario = 3;
    } else if (isMyRateLower && majorityFast && myHotelSlow) {
      // Scenario 4: Lower Rate + Comps Selling Fast BUT You are Slow
      scenario = 4;
    } else if (isMyRateHigher && totalComps === 0) {
      // Fallback: high rate but no comp data
      scenario = 1;
    }

    return {
      myRate: myRateVal,
      directAdr,
      searchAdr,
      ppi,
      scenario,
      directEntries,
      searchEntries,
      directNames,
      totalComps,
      fastCount,
      slowCount,
      soldOutCount,
      normalCount,
      myOccupancy,
    };
  }, [selectedDate, entries, manualEntries]);

  const SCENARIOS = [
    {
      num: 1,
      title: 'Kịch bản 1: Giá cao hơn Compset, đối thủ còn nhiều phòng',
      diagnosis: 'Giá bán có thể chưa đủ cạnh tranh so với thị trường.',
      proposal: 'Rà soát mức giá, chất lượng sản phẩm và chính sách bán so với Compset. Cân nhắc điều chỉnh giá hoặc bổ sung ưu đãi nếu Pickup chưa đạt kỳ vọng.',
      color: 'border-red-300 bg-red-50/60',
      activeColor: 'border-red-400 bg-red-50 shadow-md ring-2 ring-red-300/40',
    },
    {
      num: 2,
      title: 'Kịch bản 2: Giá cao hơn Compset, đối thủ đã hết phòng hoặc sắp hết',
      diagnosis: 'Có thể xuất hiện cơ hội tăng giá khi nguồn cung cạnh tranh giảm.',
      proposal: 'Theo dõi nhu cầu và tốc độ Pickup. Cân nhắc giữ giá hoặc điều chỉnh tăng phù hợp nếu tình hình đặt phòng tích cực, tránh giảm giá không cần thiết.',
      color: 'border-emerald-300 bg-emerald-50/60',
      activeColor: 'border-emerald-400 bg-emerald-50 shadow-md ring-2 ring-emerald-300/40',
    },
    {
      num: 3,
      title: 'Kịch bản 3: Giá bằng hoặc thấp hơn Compset, đối thủ còn nhiều phòng',
      diagnosis: 'Tình hình đặt phòng có thể chịu ảnh hưởng từ nhu cầu thị trường thấp hoặc các yếu tố ngoài giá bán.',
      proposal: 'Kiểm tra xu hướng Pickup, khả năng hiển thị và hiệu quả các kênh bán. Cân nhắc triển khai ưu đãi hoặc gói dịch vụ phù hợp thay vì tiếp tục giảm giá sâu.',
      color: 'border-amber-300 bg-amber-50/60',
      activeColor: 'border-amber-400 bg-amber-50 shadow-md ring-2 ring-amber-300/40',
    },
    {
      num: 4,
      title: 'Giá thấp hơn Compset, đối thủ vẫn bán tốt hoặc đã hết phòng nhưng khách sạn Pickup thấp',
      diagnosis: 'Giá bán có tính cạnh tranh nhưng chưa chuyển hóa thành lượng đặt phòng tương xứng.',
      proposal: 'Kiểm tra tình trạng mở bán, khả năng hiển thị trên OTA, chất lượng hình ảnh, nội dung, điểm đánh giá và chính sách đặt phòng để xác định những điểm cần cải thiện.',
      color: 'border-navy-300 bg-navy-50/60',
      activeColor: 'border-navy-400 bg-navy-50 shadow-md ring-2 ring-navy-300/40',
    },
  ];

  const setDraft = (key: string, value: string) => {
    setEntryDraft((prev) => new Map(prev).set(key, value));
  };

  const getDraft = (key: string): string => entryDraft.get(key) ?? '';

  // Market pace summary text
  const marketPaceSummary = useMemo(() => {
    if (!selectedDateData || selectedDateData.totalComps === 0) return null;
    const { fastCount, slowCount, soldOutCount, normalCount, totalComps } = selectedDateData;
    const parts: string[] = [];
    if (fastCount > 0) parts.push(`${fastCount}/${totalComps} bán nhanh`);
    if (normalCount > 0) parts.push(`${normalCount}/${totalComps} bình thường`);
    if (slowCount > 0) parts.push(`${slowCount}/${totalComps} bán chậm`);
    if (soldOutCount > 0) parts.push(`${soldOutCount}/${totalComps} sold out`);
    return parts.join(' · ');
  }, [selectedDateData]);

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation (Level 2) */}
      <div className="flex flex-wrap gap-2.5 pt-3 border-t border-slate-200/70">
        <button
          onClick={() => setSubTab('setup')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-all duration-200 ${
            subTab === 'setup'
              ? 'bg-blue-50/80 text-[#0f172a] font-semibold border-2 border-[#1e293b] shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 font-medium border border-slate-200'
          }`}
        >
          <Building2 size={16} className={subTab === 'setup' ? 'text-[#1e293b]' : 'text-slate-400'} />
          Compset Setup
        </button>
        <button
          onClick={() => setSubTab('tracker')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-all duration-200 ${
            subTab === 'tracker'
              ? 'bg-blue-50/80 text-[#0f172a] font-semibold border-2 border-[#1e293b] shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-50 font-medium border border-slate-200'
          }`}
        >
          <Swords size={16} className={subTab === 'tracker' ? 'text-[#1e293b]' : 'text-slate-400'} />
          Rate Tracker & Action Insights
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

              {/* Row 2: Direct Compset — with Pace Status dropdown */}
              <div className="rounded-lg border border-navy-200 bg-white p-3 space-y-2">
                <div className="text-xs font-semibold text-navy-600 uppercase tracking-wide">
                  Row 2: Direct Compset ({competitors.length}/{MAX_COMPETITORS}) — Rate + Availability + Pace
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
                          <th className="text-center px-2 py-2 font-semibold">Tốc độ bán (Pace)</th>
                          <th className="w-16 px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {competitors.map((comp) => {
                          const key = `${selectedDate}|direct|${comp.id}`;
                          const pace = getDraft(`${key}|pace`) || 'normal';
                          return (
                            <tr key={comp.id} className="border-t border-navy-50">
                              <td className="px-2 py-2 text-navy-700 font-medium">{comp.name}</td>
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="number"
                                  value={getDraft(`${key}|rate`)}
                                  onChange={(e) => setDraft(`${key}|rate`, e.target.value)}
                                  placeholder="0"
                                  disabled={pace === 'sold_out'}
                                  className={`w-20 text-center bg-white border border-navy-200 rounded-md px-1.5 py-1 text-xs text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400 ${
                                    pace === 'sold_out' ? 'opacity-40 cursor-not-allowed bg-navy-50' : ''
                                  }`}
                                />
                              </td>
                              <td className="px-2 py-2 text-center">
                                <div className="inline-flex items-center gap-1">
                                  <select
                                    value={pace}
                                    onChange={(e) => setDraft(`${key}|pace`, e.target.value)}
                                    className={`text-xs rounded-md border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-navy-400 cursor-pointer ${
                                      PACE_COLORS[pace] || 'border-navy-200 bg-white text-navy-700'
                                    }`}
                                  >
                                    {PACE_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  onClick={() => saveDirectEntry(selectedDate, comp.id, comp.name)}
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
                    {' '}({selectedDateData.directEntries.filter((e) => e.pace_status !== 'sold_out').length} available)
                  </div>
                )}
              </div>

              {/* Row 3: Search Compset — 5-row multi-hotel grid */}
              <div className="rounded-lg border border-navy-200 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs font-semibold text-navy-600 uppercase tracking-wide">
                    Row 3: Search Compset — Theo dõi tối đa {MAX_SEARCH_ROWS} đối thủ
                  </div>
                  <Button variant="gold" size="sm" onClick={() => saveAllSearchRows(selectedDate)} disabled={savingTracker}>
                    <Save size={14} /> {savingTracker ? 'Đang lưu…' : 'Lưu tất cả Search'}
                  </Button>
                </div>
                <div className="overflow-x-auto thin-scroll">
                  <table className="w-full text-xs">
                    <thead className="bg-navy-50 text-navy-700">
                      <tr>
                        <th className="text-left px-2 py-2 font-semibold w-8">#</th>
                        <th className="text-left px-2 py-2 font-semibold">Tên đối thủ (Search)</th>
                        <th className="text-center px-2 py-2 font-semibold">Tốc độ bán (Pace)</th>
                        <th className="text-center px-2 py-2 font-semibold">Selling Rate (nếu khớp Direct)</th>
                        <th className="w-12 px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: MAX_SEARCH_ROWS }, (_, i) => i + 1).map((rowIdx) => {
                        const key = `${selectedDate}|search|${rowIdx}`;
                        const name = getDraft(`${key}|name`);
                        const pace = getDraft(`${key}|pace`) || 'normal';
                        const rate = getDraft(`${key}|rate`);
                        // Rate field only active if name matches a Direct Compset
                        const matchedDirectComp = selectedDateData?.directNames.has(name.trim().toLowerCase());
                        return (
                          <tr key={rowIdx} className="border-t border-navy-50">
                            <td className="px-2 py-2 text-navy-400 font-semibold">{rowIdx}</td>
                            <td className="px-2 py-2">
                              <input
                                value={name}
                                onChange={(e) => setDraft(`${key}|name`, e.target.value)}
                                placeholder={`VD: Hotel ${String.fromCharCode(64 + rowIdx)}`}
                                className="w-full bg-white border border-navy-200 rounded-md px-2 py-1 text-xs text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
                              />
                              {matchedDirectComp && (
                                <span className="text-[10px] text-emerald-600 font-medium ml-1">✓ Khớp Direct</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <select
                                value={pace}
                                onChange={(e) => setDraft(`${key}|pace`, e.target.value)}
                                className={`text-xs rounded-md border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-navy-400 cursor-pointer ${
                                  PACE_COLORS[pace] || 'border-navy-200 bg-white text-navy-700'
                                }`}
                              >
                                {PACE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="number"
                                value={rate}
                                onChange={(e) => setDraft(`${key}|rate`, e.target.value)}
                                placeholder={matchedDirectComp ? 'Nhập giá' : 'Chỉ khi khớp Direct'}
                                disabled={!matchedDirectComp}
                                className={`w-24 text-center bg-white border border-navy-200 rounded-md px-1.5 py-1 text-xs text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400 ${
                                  !matchedDirectComp ? 'opacity-40 cursor-not-allowed bg-navy-50' : 'border-emerald-200 bg-emerald-50/30'
                                }`}
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => saveSearchRow(selectedDate, rowIdx)}
                                disabled={savingTracker || !name.trim()}
                                className="p-1 rounded-md text-navy-400 hover:bg-navy-100 hover:text-navy-700 disabled:opacity-30"
                                title="Lưu dòng này"
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

                {/* Market pace summary badge */}
                {marketPaceSummary && selectedDateData && (
                  <div className="flex items-center gap-2 bg-navy-50 rounded-lg px-3 py-2 text-xs">
                    <Activity size={14} className="text-navy-600 flex-shrink-0" />
                    <span className="font-semibold text-navy-700">Tổng quan Tốc độ Thị trường:</span>
                    <span className="text-navy-800 font-medium">{marketPaceSummary}</span>
                    {selectedDateData.fastCount > selectedDateData.slowCount && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                        <TrendingUp size={10} /> Thị trường đang nóng
                      </span>
                    )}
                    {selectedDateData.slowCount > selectedDateData.fastCount && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                        Thị trường đang chậm
                      </span>
                    )}
                  </div>
                )}

                {selectedDateData && selectedDateData.searchAdr > 0 && (
                  <div className="text-xs font-semibold text-navy-700">
                    Search Compset ADR: <span className="mono-num text-navy-900">{formatVND(Math.round(selectedDateData.searchAdr))}</span>
                  </div>
                )}
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
              Kịch bản đề xuất
            </div>
            <div className="text-xs text-navy-400">
              Ngày đang xem: <span className="font-semibold text-navy-700">{selectedDate ? toDMY(selectedDate) : '—'}</span>
              {selectedDateData && selectedDateData.totalComps > 0 && (
                <span className="ml-2 text-navy-500">
                  · {selectedDateData.totalComps} đối thủ có dữ liệu pace
                </span>
              )}
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
              <span className="font-semibold">Lưu ý quan trọng:</span> Các nhận định và gợi ý hành động được hệ thống đưa ra dựa trên dữ liệu hiện có, nhằm hỗ trợ người dùng nhận diện dấu hiệu bất thường và xác định hướng phân tích tiếp theo. Đây không phải kết luận chắc chắn về nguyên nhân. Người dùng cần xem xét thêm tình hình thực tế, các yếu tố liên quan và bối cảnh vận hành trước khi đưa ra quyết định.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
