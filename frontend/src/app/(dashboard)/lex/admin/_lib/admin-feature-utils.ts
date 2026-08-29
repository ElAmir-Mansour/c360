'use client';

export type AdminDatasetFormat = 'csv' | 'json';

export interface AdminIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  area: string;
  title: string;
  description: string;
  href?: string;
}

export interface AdminTimelineEvent {
  id: string;
  label: string;
  at: string;
  actor?: string;
  detail?: string;
}

export interface ImportPreview<T> {
  rows: T[];
  errors: string[];
}

export const MIME_PRESETS = {
  documents: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  images: ['image/png', 'image/jpeg', 'image/webp'],
  spreadsheets: [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
} as const;

export const COMMON_LEGAL_TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Africa/Cairo',
  'Europe/London',
  'UTC',
] as const;

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportJson<T>(filename: string, rows: T[]): void {
  downloadText(filename, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[]): string {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (keys.length === 0) return '';
  return [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\n');
}

export function exportCsv<T extends Record<string, unknown>>(filename: string, rows: T[]): void {
  downloadText(filename, toCsv(rows), 'text/csv;charset=utf-8');
}

export async function parseImportFile(file: File): Promise<ImportPreview<Record<string, unknown>>> {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.json')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return { rows: [], errors: ['JSON import must be an array of records.'] };
      return { rows: parsed.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object'), errors: [] };
    } catch (error) {
      return { rows: [], errors: [error instanceof Error ? error.message : 'Invalid JSON file.'] };
    }
  }

  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return { rows: [], errors: ['CSV file is empty.'] };
  const headers = headerLine.split(',').map((h) => h.trim()).filter(Boolean);
  const rows = lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? '']));
  });
  return { rows, errors: [] };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function parseFileSize(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) return 0;
  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multiplier = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.round(amount * multiplier);
}

/** Bilingual labels for {@link buildRecordTimeline}. Defaults to English. */
export interface RecordTimelineLabels {
  created: string;
  updated: string;
  restored: string;
}

const DEFAULT_TIMELINE_LABELS: RecordTimelineLabels = {
  created: 'Created',
  updated: 'Updated',
  restored: 'Restored from version',
};

export function buildRecordTimeline(
  record: {
    created_at?: string;
    updated_at?: string;
    metadata?: Record<string, unknown>;
  },
  labels: RecordTimelineLabels = DEFAULT_TIMELINE_LABELS,
): AdminTimelineEvent[] {
  const events: AdminTimelineEvent[] = [];
  if (record.created_at) {
    events.push({ id: 'created', label: labels.created, at: record.created_at });
  }
  if (record.updated_at && record.updated_at !== record.created_at) {
    events.push({ id: 'updated', label: labels.updated, at: record.updated_at });
  }
  const restoredAt = record.metadata?.restored_at;
  if (typeof restoredAt === 'string') {
    events.push({ id: 'restored', label: labels.restored, at: restoredAt });
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

export function findOverlappingSegments(
  segments: Array<{ profile: string; day_of_week: number; start_minute: number; end_minute: number }>,
): string[] {
  const errors: string[] = [];
  const grouped = new Map<string, Array<{ start: number; end: number }>>();
  for (const seg of segments) {
    const key = `${seg.profile}:${seg.day_of_week}`;
    const list = grouped.get(key) ?? [];
    list.push({ start: seg.start_minute, end: seg.end_minute });
    grouped.set(key, list);
  }
  for (const [key, list] of grouped.entries()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].start < sorted[index - 1].end) {
        errors.push(`Overlapping working-hour segments in ${key}.`);
        break;
      }
    }
  }
  return errors;
}

export function addWorkingDays(start: Date, days: number, weekend = new Set([5, 6])): Date {
  const result = new Date(start);
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (!weekend.has(result.getDay())) remaining -= 1;
  }
  return result;
}

export function localSnapshotKey(namespace: string, id: string): string {
  return `clario360.lexAdmin.snapshots.${namespace}.${id}`;
}

export function writeSnapshot<T>(namespace: string, id: string, value: T): void {
  if (typeof window === 'undefined') return;
  const key = localSnapshotKey(namespace, id);
  try {
    const raw = window.localStorage.getItem(key);
    const current = raw ? (JSON.parse(raw) as T[]) : [];
    window.localStorage.setItem(key, JSON.stringify([value, ...current].slice(0, 10)));
  } catch {
    window.localStorage.setItem(key, JSON.stringify([value]));
  }
}

export function readSnapshots<T>(namespace: string, id: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(localSnapshotKey(namespace, id));
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
