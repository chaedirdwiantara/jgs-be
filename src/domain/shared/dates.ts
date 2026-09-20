/**
 * Calendar-date arithmetic for `YYYY-MM-DD` strings.
 *
 * Rental dates are *calendar* dates in WIB, never instants: a rental that
 * starts "2026-09-17" starts on that day in Jakarta regardless of the server's
 * clock. Every helper here therefore works in UTC on a date-only string, which
 * has no DST and no zone to get wrong, and converts to Jakarta exactly once —
 * in `calendarDateInJakarta`.
 */

const TIME_ZONE = "Asia/Jakarta";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** `"2026-09-17"` + 3 → `"2026-09-20"`. Negative `days` walks backwards. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The last day of a rental, inclusive: a 1-day rental starting on the 17th ends
 * on the 17th, a 4-day one on the 20th. This is how the operator counts days —
 * "1 Sep – 4 Sep, 4 hari" — and what the return reminder keys off.
 */
export function rentalEndDate(startDate: string, durationDays: number): string {
  return addDays(startDate, durationDays - 1);
}

/** The calendar date it currently is in Jakarta, for an ISO instant. */
export function calendarDateInJakarta(isoInstant: string): string {
  // en-CA formats as YYYY-MM-DD, which is the one locale trick worth relying on.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoInstant));
}

const MONTHS_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** `"2026-09-17"` → `"Kamis, 17 Sep 2026"`. Tables, not Intl: no ICU surprises in a chat message. */
export function formatDateID(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = WEEKDAYS_ID[parsed.getUTCDay()];
  const month = MONTHS_ID[parsed.getUTCMonth()];
  return `${weekday}, ${parsed.getUTCDate()} ${month} ${parsed.getUTCFullYear()}`;
}

/** `1200000` → `"Rp 1.200.000"`. */
export function formatRupiah(amount: number): string {
  const digits = Math.round(Math.abs(amount)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "-" : ""}Rp ${grouped}`;
}
