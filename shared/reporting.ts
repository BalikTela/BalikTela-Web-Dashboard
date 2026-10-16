export const REPORTING_TIME_ZONE = 'Asia/Manila';
const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;

export interface ReportingWindow {
  start: string;
  endExclusive: string;
  startDate: string;
  endDate: string;
  label: string;
}
export interface ReportingPeriod extends ReportingWindow {
  timeZone: typeof REPORTING_TIME_ZONE;
  asOf: string;
  comparison: ReportingWindow | null;
  comparisonBasis: string;
  capacityMonths: number;
}

export class ReportingInputError extends Error { status = 400; }
export function manilaDate(value = new Date()) { return new Date(value.getTime() + OFFSET).toISOString().slice(0, 10); }
function midnight(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReportingInputError('Enter dates as YYYY-MM-DD.');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new ReportingInputError('Enter a valid calendar date.');
  return time - OFFSET;
}
function window(start: number, endExclusive: number): ReportingWindow {
  const startDate = manilaDate(new Date(start));
  const endDate = manilaDate(new Date(endExclusive - 1));
  const format = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: REPORTING_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(midnight(date)));
  return { start: new Date(start).toISOString(), endExclusive: new Date(endExclusive).toISOString(), startDate, endDate, label: `${format(startDate)} - ${format(endDate)}` };
}
export function inReportingWindow(timestamp: string, period: Pick<ReportingWindow, 'start' | 'endExclusive'>) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time >= Date.parse(period.start) && time < Date.parse(period.endExclusive);
}
export function proratedMonths(start: number, end: number) {
  let result = 0;
  for (let cursor = start; cursor < end;) {
    const local = new Date(cursor + OFFSET);
    const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - OFFSET;
    const first = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET;
    const stop = Math.min(end, next);
    result += (stop - cursor) / (next - first);
    cursor = stop;
  }
  return result;
}
export function resolveReportingPeriod(query: Record<string, unknown>, now = new Date(), firstRecordAt?: string): ReportingPeriod {
  for (const key of ['dateRange', 'startDate', 'endDate']) if (query[key] !== undefined && typeof query[key] !== 'string') throw new ReportingInputError(`Invalid ${key}.`);
  const range = String(query.dateRange ?? 'Last 90 days');
  if (range !== 'Custom range' && (query.startDate || query.endDate)) throw new ReportingInputError('Select Custom range when supplying start and end dates.');
  const today = manilaDate(now);
  const dayStart = midnight(today);
  const endNow = now.getTime() + 1;
  let start: number;
  let end = endNow;
  let comparison: ReportingWindow | null = null;
  let comparisonBasis = 'Immediately preceding window of equal elapsed duration';
  if (range === 'Last 30 days' || range === 'Last 90 days') {
    const days = range === 'Last 30 days' ? 30 : 90;
    start = dayStart - (days - 1) * DAY;
  } else if (range === 'Year to date') {
    start = midnight(`${today.slice(0, 4)}-01-01`);
    const year = Number(today.slice(0, 4)) - 1;
    const month = Number(today.slice(5, 7)) - 1;
    const day = Math.min(Number(today.slice(8)), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    const priorEnd = Date.UTC(year, month, day) - OFFSET + (endNow - dayStart);
    comparison = window(Date.UTC(year, 0, 1) - OFFSET, priorEnd);
    comparisonBasis = 'Previous year to the same Manila calendar date and time; leap day is clamped to February 28';
  } else if (range === 'Custom range') {
    if (!query.startDate || !query.endDate) throw new ReportingInputError('Select both a start date and an end date.');
    start = midnight(String(query.startDate));
    end = Math.min(midnight(String(query.endDate)) + DAY, endNow);
    if (String(query.endDate) > today) throw new ReportingInputError('The end date cannot be in the future.');
    if (start >= end) throw new ReportingInputError('The start date must be on or before the end date.');
  } else if (range === 'All time' || range === 'Pilot period') {
    const first = firstRecordAt && Number.isFinite(Date.parse(firstRecordAt)) ? manilaDate(new Date(firstRecordAt)) : `${today.slice(0, 4)}-01-01`;
    start = midnight(first > today ? today : first);
    comparisonBasis = 'No previous comparison for all-time reporting';
  } else throw new ReportingInputError('Unsupported reporting period.');
  if (end - start > 3660 * DAY) throw new ReportingInputError('Select a reporting window of ten years or less.');
  if (!comparison && range !== 'All time' && range !== 'Pilot period') comparison = window(start - (end - start), start);
  return { ...window(start, end), timeZone: REPORTING_TIME_ZONE, asOf: now.toISOString(), comparison, comparisonBasis, capacityMonths: proratedMonths(start, end) };
}

export interface ReportDocument {
  id: string;
  title: string;
  generatedAt: string;
  period: ReportingPeriod;
  scope: { role: string; aggregateOnly: boolean; canExport: boolean; description: string };
  filters: Array<{ label: string; value: string }>;
  summary: Array<{ label: string; value: string }>;
  columns: string[];
  rows: string[][];
  notes: string[];
}
