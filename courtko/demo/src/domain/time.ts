/**
 * Time helpers. Instants are epoch milliseconds (UTC). Local dates are 'YYYY-MM-DD' strings and
 * local times are minutes after local midnight. Venues carry an IANA zone plus a fixed UTC offset;
 * Asia/Manila is UTC+08:00 with no daylight saving time, so fixed-offset arithmetic is exact.
 * (Multi-country support would swap this module for a full IANA implementation.)
 */

export const MANILA_TZ = 'Asia/Manila';
export const MANILA_OFFSET_MIN = 480;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type LocalDate = string; // YYYY-MM-DD

export interface LocalParts {
  date: LocalDate;
  year: number;
  month: number; // 1-12
  day: number;
  dow: number; // 0 = Sunday
  minute: number; // minutes after local midnight
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function localParts(ms: number, offsetMin = MANILA_OFFSET_MIN): LocalParts {
  const d = new Date(ms + offsetMin * MINUTE);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    year,
    month,
    day,
    dow: d.getUTCDay(),
    minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function localDate(ms: number, offsetMin = MANILA_OFFSET_MIN): LocalDate {
  return localParts(ms, offsetMin).date;
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Converts a local wall-clock date + minute into a UTC instant. */
export function localToInstant(date: LocalDate, minuteOfDay: number, offsetMin = MANILA_OFFSET_MIN): number {
  if (!isLocalDate(date)) throw new RangeError(`invalid local date ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) + minuteOfDay * MINUTE - offsetMin * MINUTE;
}

export function startOfLocalDay(ms: number, offsetMin = MANILA_OFFSET_MIN): number {
  return localToInstant(localDate(ms, offsetMin), 0, offsetMin);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function dayOfWeek(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((localToInstant(b, 0, 0) - localToInstant(a, 0, 0)) / DAY);
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Philippine convention: 12:00 NN for noon and 12:00 MN for midnight; other times use AM/PM.
 */
export function formatMinuteOfDay(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  if (m === 0) return '12:00 MN';
  if (m === 720) return '12:00 NN';
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(mm)} ${suffix}`;
}

export function formatTime(ms: number, offsetMin = MANILA_OFFSET_MIN): string {
  return formatMinuteOfDay(localParts(ms, offsetMin).minute);
}

export function formatDateShort(dateOrMs: LocalDate | number, offsetMin = MANILA_OFFSET_MIN): string {
  const date = typeof dateOrMs === 'number' ? localDate(dateOrMs, offsetMin) : dateOrMs;
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${DOW_SHORT[dayOfWeek(date)]}, ${MONTH_SHORT[m - 1]} ${d}`;
}

export function formatDateLong(dateOrMs: LocalDate | number, offsetMin = MANILA_OFFSET_MIN): string {
  const date = typeof dateOrMs === 'number' ? localDate(dateOrMs, offsetMin) : dateOrMs;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${DOW_LONG[dayOfWeek(date)]}, ${MONTH_LONG[m - 1]} ${d}, ${y}`;
}

export function formatMonthDay(dateOrMs: LocalDate | number, offsetMin = MANILA_OFFSET_MIN): string {
  const date = typeof dateOrMs === 'number' ? localDate(dateOrMs, offsetMin) : dateOrMs;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

export function formatDateTime(ms: number, offsetMin = MANILA_OFFSET_MIN): string {
  return `${formatMonthDay(ms, offsetMin)}, ${formatTime(ms, offsetMin)}`;
}

export function formatTimeRange(startMs: number, endMs: number, offsetMin = MANILA_OFFSET_MIN): string {
  return `${formatTime(startMs, offsetMin)} – ${formatTime(endMs, offsetMin)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} min`;
}

export function formatRelative(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  const unit = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;
  let text: string;
  if (abs < MINUTE) text = 'less than a minute';
  else if (abs < HOUR) text = unit(Math.round(abs / MINUTE), 'minute');
  else if (abs < DAY) text = unit(Math.round(abs / HOUR), 'hour');
  else text = unit(Math.round(abs / DAY), 'day');
  return future ? `in ${text}` : `${text} ago`;
}

/** ISO 8601 UTC for API payloads and exports. */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function minuteLabelShort(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  if (h24 === 0) return '12 MN';
  if (h24 === 12) return '12 NN';
  return `${h24 % 12 === 0 ? 12 : h24 % 12}${h24 < 12 ? 'a' : 'p'}`;
}
