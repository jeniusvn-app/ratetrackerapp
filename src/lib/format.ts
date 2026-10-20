/** Format a number as VND currency with dot thousand separators. */
export function formatVND(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0đ';
  const rounded = Math.round(Number(value));
  return rounded.toLocaleString('de-DE').replace(/\./g, '.') + 'đ';
}

/** Format VND but only the number with dot separators (no đ suffix). */
export function formatVNDNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Math.round(Number(value)).toLocaleString('de-DE').replace(/\./g, '.');
}

/** Normalize a rate code for matching (trim + uppercase). */
export function normCode(s: string): string {
  return (s || '').trim().toUpperCase();
}

/** Convert "YYYY-MM-DD" -> "dd/mm/yyyy". */
export function toDMY(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Convert a Date or serial number to YYYY-MM-DD. */
export function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Detect Excel numeric serial date and convert to a Date.
 * Excel epoch: 1899-12-30 (serial 0). 25569 days between that and 1970-01-01.
 */
export function excelSerialToDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    if (value > 25559 && value < 60000) {
      // Likely serial date
      return new Date(Math.round((value - 25569) * 86400 * 1000));
    }
    return null;
  }
  const s = String(value).trim();
  // Already dd/mm/yyyy or yyyy-mm-dd?
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return new Date(`${dmy[3]}-${mm}-${dd}T00:00:00`);
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const mm = iso[2].padStart(2, '0');
    const dd = iso[3].padStart(2, '0');
    return new Date(`${iso[1]}-${mm}-${dd}T00:00:00`);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Inclusive date range array (YYYY-MM-DD). */
export function dateRangeISO(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  if (start > end) return out;
  const cur = new Date(start);
  while (cur <= end) {
    out.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Build the report header lines used in exports. */
export function reportHeaderLines(hotelName: string, startISO: string, endISO: string): string[] {
  return [
    (hotelName || '').toUpperCase(),
    'BÁO CÁO TRA CỨU GIÁ PHÒNG - RATETRACKER AI',
    `Giai đoạn: ${toDMY(startISO)} đến ${toDMY(endISO)}`,
  ];
}
