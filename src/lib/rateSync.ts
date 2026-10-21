import type { DateRange } from '@/types';
import { dateRangeISO } from '@/lib/format';

export const RATES_UPDATED_EVENT = 'rt-rates-updated';

/**
 * Notify the Calendar Page (and any other listener) that daily_rates changed.
 * Works within the same tab (unlike `storage` events) and across tabs.
 */
export function notifyRatesUpdated() {
  try {
    const cur = Number(localStorage.getItem('rt_daily_rates_version') || '0');
    localStorage.setItem('rt_daily_rates_version', String(cur + 1));
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(RATES_UPDATED_EVENT));
}

/**
 * Expand multiple DateRange objects into a deduplicated array of
 * 'YYYY-MM-DD' strings.
 */
export function expandDateRanges(ranges: DateRange[]): string[] {
  const set = new Set<string>();
  for (const r of ranges) {
    if (!r.start || !r.end || r.start > r.end) continue;
    for (const d of dateRangeISO(r.start, r.end)) set.add(d);
  }
  return Array.from(set).sort();
}

/**
 * Total number of days across all ranges (deduplicated).
 */
export function totalDaysInRanges(ranges: DateRange[]): number {
  return expandDateRanges(ranges).length;
}

/**
 * Derive the earliest start and latest end across ranges.
 * Returns { start, end } in YYYY-MM-DD or nulls if empty.
 */
export function rangeBounds(ranges: DateRange[]): { start: string | null; end: string | null } {
  const valid = ranges.filter((r) => r.start && r.end && r.start <= r.end);
  if (valid.length === 0) return { start: null, end: null };
  const start = valid.reduce((min, r) => (r.start < min ? r.start : min), valid[0].start);
  const end = valid.reduce((mx, r) => (r.end > mx ? r.end : mx), valid[0].end);
  return { start, end };
}
