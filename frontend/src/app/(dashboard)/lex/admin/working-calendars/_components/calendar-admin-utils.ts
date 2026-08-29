'use client';

import type {
  AddCalendarHolidayPayload,
  CalendarHoliday,
  CalendarHolidayKind,
  CalendarProfile,
  CreateWorkingCalendarPayload,
  WorkingCalendar,
  WorkingHoursInput,
} from '@/lib/lex/admin';
import { CALENDAR_HOLIDAY_KINDS } from '@/lib/lex/admin';

export interface HolidayImportRow {
  date: string;
  kind: CalendarHolidayKind;
  name_en: string;
  name_ar: string;
}

export interface HolidayImportPreview {
  rows: HolidayImportRow[];
  errors: string[];
}

export interface TimezonePreview {
  valid: boolean;
  currentLabel?: string;
  winterOffset?: string;
  summerOffset?: string;
  observesDst?: boolean;
}

export interface SlaSimulationInput {
  start: string;
  workingDays: number;
  workingHours: number;
  timezone: string;
  ramadanStart?: string;
  ramadanEnd?: string;
  workingHoursRows: WorkingHoursInput[];
  holidays?: CalendarHoliday[];
}

export interface SlaSimulationResult {
  dueAt: string | null;
  averageDailyHours: number;
  requestedWorkingMinutes: number;
  warning?: string;
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_DAY_MINUTES = 8 * 60;

export function dateKey(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLocalDateTime(value: Date): string {
  const date = dateKey(value);
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${date} ${hours}:${minutes}`;
}

export function toDateTimeInputValue(value: Date): string {
  const date = dateKey(value);
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${date}T${hours}:${minutes}`;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function offsetLabel(timezone: string, value: Date): string | undefined {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
    });
    return formatter.formatToParts(value).find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return undefined;
  }
}

export function buildTimezonePreview(timezone: string): TimezonePreview {
  if (!timezone.trim() || !isValidTimezone(timezone.trim())) return { valid: false };
  const year = new Date().getFullYear();
  const winterOffset = offsetLabel(timezone, new Date(Date.UTC(year, 0, 15, 12, 0, 0)));
  const summerOffset = offsetLabel(timezone, new Date(Date.UTC(year, 6, 15, 12, 0, 0)));
  return {
    valid: true,
    currentLabel: offsetLabel(timezone, new Date()),
    winterOffset,
    summerOffset,
    observesDst: Boolean(winterOffset && summerOffset && winterOffset !== summerOffset),
  };
}

export function workingHoursInputFromCalendar(calendar: WorkingCalendar): WorkingHoursInput[] {
  return (calendar.working_hours ?? []).map((seg, index) => ({
    profile: seg.profile,
    day_of_week: seg.day_of_week,
    segment_index: seg.segment_index ?? index,
    start_minute: seg.start_minute,
    end_minute: seg.end_minute,
  }));
}

export function calendarClonePayload(calendar: WorkingCalendar): CreateWorkingCalendarPayload {
  return {
    name: `${calendar.name} Copy`,
    description: calendar.description ?? '',
    timezone: calendar.timezone,
    is_default: false,
    ramadan_start: calendar.ramadan_start ?? null,
    ramadan_end: calendar.ramadan_end ?? null,
    working_hours: workingHoursInputFromCalendar(calendar),
  };
}

export function holidayPayload(holiday: CalendarHoliday): AddCalendarHolidayPayload {
  return {
    date: holiday.date,
    kind: holiday.kind,
    name: holiday.name,
  };
}

export function parseHolidayImportRows(rawRows: Record<string, unknown>[]): HolidayImportPreview {
  const errors: string[] = [];
  const rows: HolidayImportRow[] = [];

  rawRows.forEach((raw, index) => {
    const line = index + 2;
    const date = readCell(raw, ['date', 'holiday_date']).slice(0, 10);
    const kindRaw = readCell(raw, ['kind', 'type']).toLowerCase();
    const kind = (kindRaw || 'official') as CalendarHolidayKind;
    const nameEn = readCell(raw, ['name_en', 'en', 'name', 'english_name']);
    const nameAr = readCell(raw, ['name_ar', 'ar', 'arabic_name']);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) {
      errors.push(`Row ${line}: date must be YYYY-MM-DD.`);
    }
    if (!CALENDAR_HOLIDAY_KINDS.includes(kind)) {
      errors.push(`Row ${line}: kind must be official, religious, or weekly.`);
    }
    if (!nameEn && !nameAr) {
      errors.push(`Row ${line}: provide name_en or name_ar.`);
    }

    rows.push({ date, kind, name_en: nameEn, name_ar: nameAr });
  });

  return { rows, errors };
}

function readCell(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return '';
}

export function holidayImportPayload(row: HolidayImportRow): AddCalendarHolidayPayload {
  return {
    date: new Date(`${row.date}T00:00:00`).toISOString(),
    kind: row.kind,
    name: { en: row.name_en, ar: row.name_ar },
  };
}

export function holidayTemplateCsv(): string {
  return [
    'date,kind,name_en,name_ar',
    '2026-09-23,official,National Day,اليوم الوطني',
    '2026-03-20,religious,Eid Al-Fitr,عيد الفطر',
  ].join('\n');
}

function profileForDate(value: Date, ramadanStart?: string, ramadanEnd?: string): CalendarProfile {
  const key = dateKey(value);
  if (ramadanStart && ramadanEnd && key >= ramadanStart.slice(0, 10) && key <= ramadanEnd.slice(0, 10)) {
    return 'ramadan';
  }
  return 'standard';
}

function segmentsForDate(value: Date, input: SlaSimulationInput): WorkingHoursInput[] {
  const holidayKeys = new Set((input.holidays ?? []).map((holiday) => dateKey(holiday.date)));
  if (holidayKeys.has(dateKey(value))) return [];

  const day = value.getDay();
  const profile = profileForDate(value, input.ramadanStart, input.ramadanEnd);
  const profileSegments = input.workingHoursRows.filter((seg) => seg.profile === profile && seg.day_of_week === day);
  const fallbackSegments =
    profile === 'ramadan'
      ? input.workingHoursRows.filter((seg) => seg.profile === 'standard' && seg.day_of_week === day)
      : [];
  return (profileSegments.length ? profileSegments : fallbackSegments).sort(
    (a, b) => a.start_minute - b.start_minute,
  );
}

function setMinutesOfDay(value: Date, minutes: number): Date {
  const next = new Date(value);
  next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return next;
}

function minuteOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

function nextDayStart(value: Date): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function averageDailyMinutes(segments: WorkingHoursInput[]): number {
  const perDay = new Map<number, number>();
  for (const seg of segments.filter((item) => item.profile === 'standard')) {
    perDay.set(seg.day_of_week, (perDay.get(seg.day_of_week) ?? 0) + Math.max(0, seg.end_minute - seg.start_minute));
  }
  const totals = Array.from(perDay.values()).filter((value) => value > 0);
  if (totals.length === 0) return DEFAULT_DAY_MINUTES;
  return Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length);
}

export function simulateSlaDueDate(input: SlaSimulationInput): SlaSimulationResult {
  if (!input.start || Number.isNaN(Date.parse(input.start))) {
    return {
      dueAt: null,
      averageDailyHours: averageDailyMinutes(input.workingHoursRows) / 60,
      requestedWorkingMinutes: 0,
      warning: 'Enter a valid start date and time.',
    };
  }

  const dayMinutes = averageDailyMinutes(input.workingHoursRows);
  let remaining = Math.max(0, Math.round(input.workingDays * dayMinutes + input.workingHours * 60));
  const requestedWorkingMinutes = remaining;
  if (remaining === 0) {
    return {
      dueAt: formatLocalDateTime(new Date(input.start)),
      averageDailyHours: dayMinutes / 60,
      requestedWorkingMinutes,
    };
  }

  let cursor = new Date(input.start);
  let guard = 0;

  while (remaining > 0 && guard < 370) {
    guard += 1;
    const segments = segmentsForDate(cursor, input);
    if (segments.length === 0) {
      cursor = nextDayStart(cursor);
      continue;
    }

    let advancedToday = false;
    for (const seg of segments) {
      const cursorMinute = minuteOfDay(cursor);
      if (cursorMinute >= seg.end_minute) continue;

      const segmentStart = cursorMinute < seg.start_minute ? setMinutesOfDay(cursor, seg.start_minute) : cursor;
      const available = seg.end_minute - minuteOfDay(segmentStart);
      if (available <= 0) continue;

      if (remaining <= available) {
        const due = new Date(segmentStart);
        due.setMinutes(due.getMinutes() + remaining);
        return {
          dueAt: formatLocalDateTime(due),
          averageDailyHours: dayMinutes / 60,
          requestedWorkingMinutes,
        };
      }

      remaining -= available;
      cursor = setMinutesOfDay(cursor, seg.end_minute);
      advancedToday = true;
    }

    cursor = advancedToday || minuteOfDay(cursor) >= (segments.at(-1)?.end_minute ?? 0) ? nextDayStart(cursor) : cursor;
  }

  return {
    dueAt: null,
    averageDailyHours: dayMinutes / 60,
    requestedWorkingMinutes,
    warning: 'The estimate could not find enough working time in the next 370 days.',
  };
}

export function monthStart(value: string): Date {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function daysInMonth(value: Date): Date[] {
  const year = value.getFullYear();
  const month = value.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => new Date(year, month, index + 1));
}

export function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}
