import type { WorkPeriod } from './schemas';

export const DEFAULT_WORK_PERIOD: WorkPeriod = { every: 1, unit: 'months', startsOn: '2026-01-01' };

export type PeriodRange = { start: string; end: string };

const DAY_MS = 86_400_000;

type DateParts = { year: number; month: number; day: number };

function parts(key: string): DateParts {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return { year, month, day };
}

const toDayNumber = ({ year, month, day }: DateParts) => Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);

function fromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function addMonths(anchor: DateParts, months: number): DateParts {
  const total = anchor.year * 12 + (anchor.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(anchor.day, lastDay) };
}

export function localDateKey(when: string | Date): string {
  const date = new Date(when);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function periodInDays(anchor: number, length: number, day: number): PeriodRange {
  const start = anchor + Math.floor((day - anchor) / length) * length;
  return { start: fromDayNumber(start), end: fromDayNumber(start + length - 1) };
}

function periodInMonths(anchor: DateParts, length: number, date: DateParts): PeriodRange {
  const monthsApart = (date.year - anchor.year) * 12 + (date.month - anchor.month);
  const steps = Math.floor(monthsApart / length);
  const startsAfterDate = toDayNumber(addMonths(anchor, steps * length)) > toDayNumber(date);
  const index = startsAfterDate ? steps - 1 : steps;
  const start = addMonths(anchor, index * length);
  const next = addMonths(anchor, (index + 1) * length);
  return { start: fromDayNumber(toDayNumber(start)), end: fromDayNumber(toDayNumber(next) - 1) };
}

export function periodOf(period: WorkPeriod, dateKey: string): PeriodRange {
  const anchor = parts(period.startsOn);
  const date = parts(dateKey);
  if (period.unit === 'months') return periodInMonths(anchor, period.every, date);
  const length = period.unit === 'weeks' ? period.every * 7 : period.every;
  return periodInDays(toDayNumber(anchor), length, toDayNumber(date));
}

const isWithin = ({ start, end }: PeriodRange, dateKey: string) => dateKey >= start && dateKey <= end;

export function isInCurrentPeriod(period: WorkPeriod, when: string, now: Date): boolean {
  return isWithin(periodOf(period, localDateKey(now)), localDateKey(when));
}

const shownDate = (key: string, options: Intl.DateTimeFormatOptions) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });

export function dateLabel(key: string): string {
  return shownDate(key, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function periodLabel({ start, end }: PeriodRange): string {
  if (start === end) return dateLabel(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${shownDate(start, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} to ${dateLabel(end)}`;
}

export function describePeriod({ every, unit }: WorkPeriod): string {
  const singular = unit.slice(0, -1);
  return every === 1 ? `Every ${singular}` : `Every ${every} ${unit}`;
}
