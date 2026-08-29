import type { CalendarEvent } from '@/components/shared/event-calendar';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type { LegalCase } from '@/lib/lex/cases';
import type { CaseLabels } from '../labels';

export type DeadlineLabels = CaseLabels['deadlines'];

export type CaseDeadlineRisk = 'overdue' | 'urgent' | 'soon' | 'scheduled' | 'none';

export interface CaseDeadline {
  id: string;
  caseId: string;
  caseTitle: string;
  title: string;
  kind: string;
  date: string;
  daysUntil: number;
  risk: Exclude<CaseDeadlineRisk, 'none'>;
}

export interface CaseDeadlineSummary {
  risk: CaseDeadlineRisk;
  label: string;
  description: string;
  nextDeadline?: CaseDeadline;
  overdue: number;
  urgent: number;
  soon: number;
  total: number;
}

export interface CaseDeadlinePortfolio {
  rowsWithDeadlines: number;
  totalDeadlines: number;
  overdue: number;
  urgent: number;
  soon: number;
  nextDeadline?: CaseDeadline;
  deadlines: CaseDeadline[];
}

const MS_PER_DAY = 86_400_000;
const METADATA_DATE_KEYS = new Set([
  'deadline',
  'deadline_at',
  'deadline_date',
  'due_at',
  'due_date',
  'filing_deadline',
  'hearing_date',
  'next_hearing',
  'next_hearing_date',
  'objection_deadline',
  'report_due_date',
  'response_deadline',
]);

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysUntil(date: Date, today = new Date()): number {
  return Math.ceil((startOfLocalDay(date).getTime() - startOfLocalDay(today).getTime()) / MS_PER_DAY);
}

function parseDeadlineDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function riskForDays(delta: number): Exclude<CaseDeadlineRisk, 'none'> {
  if (delta < 0) return 'overdue';
  if (delta <= 7) return 'urgent';
  if (delta <= 30) return 'soon';
  return 'scheduled';
}

function formatMetadataLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function metadataDateEntries(metadata: Record<string, unknown> | null | undefined): Array<{ key: string; value: Date }> {
  if (!metadata) {
    return [];
  }

  const entries: Array<{ key: string; value: Date }> = [];
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.toLowerCase();
    const looksLikeDeadline =
      METADATA_DATE_KEYS.has(normalizedKey) ||
      normalizedKey.endsWith('_deadline') ||
      normalizedKey.endsWith('_due_date') ||
      normalizedKey.endsWith('_hearing_date');

    if (!looksLikeDeadline) {
      continue;
    }

    const parsed = parseDeadlineDate(value);
    if (parsed) {
      entries.push({ key, value: parsed });
    }
  }
  return entries;
}

function addDeadline(
  output: CaseDeadline[],
  legalCase: LegalCase,
  caseTitle: string,
  kind: string,
  title: string,
  rawDate: unknown,
  idSeed: string,
) {
  const parsed = parseDeadlineDate(rawDate);
  if (!parsed) {
    return;
  }
  const delta = daysUntil(parsed);
  output.push({
    id: `${legalCase.id}:${idSeed}:${parsed.toISOString()}`,
    caseId: legalCase.id,
    caseTitle,
    title,
    kind,
    date: parsed.toISOString(),
    daysUntil: delta,
    risk: riskForDays(delta),
  });
}

export function collectCaseDeadlines(
  legalCase: LegalCase,
  locale: AppLocale,
  fallbackTitle: string,
  labels: DeadlineLabels,
): CaseDeadline[] {
  const caseTitle = resolveLocalized(legalCase.title, locale) || fallbackTitle;
  const deadlines: CaseDeadline[] = [];

  for (const task of legalCase.tasks ?? []) {
    if (task.status === 'done' || task.status === 'cancelled') {
      continue;
    }
    addDeadline(
      deadlines,
      legalCase,
      caseTitle,
      labels.kindTask,
      task.title,
      task.due_date,
      `task:${task.id}`,
    );
  }

  for (const hearing of legalCase.hearings ?? []) {
    addDeadline(
      deadlines,
      legalCase,
      caseTitle,
      labels.kindHearing,
      hearing.location ? labels.hearingAt(hearing.location) : labels.courtHearing,
      hearing.hearing_date,
      `hearing:${hearing.id}`,
    );
  }

  for (const entry of metadataDateEntries(legalCase.metadata)) {
    addDeadline(
      deadlines,
      legalCase,
      caseTitle,
      formatMetadataLabel(entry.key),
      formatMetadataLabel(entry.key),
      entry.value,
      `metadata:${entry.key}`,
    );
  }

  const unique = new Map<string, CaseDeadline>();
  for (const deadline of deadlines) {
    const key = `${deadline.kind}:${deadline.title}:${deadline.date}`;
    if (!unique.has(key)) {
      unique.set(key, deadline);
    }
  }

  return Array.from(unique.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

export function summarizeCaseDeadlines(deadlines: CaseDeadline[], labels: DeadlineLabels): CaseDeadlineSummary {
  const overdue = deadlines.filter((deadline) => deadline.risk === 'overdue').length;
  const urgent = deadlines.filter((deadline) => deadline.risk === 'urgent').length;
  const soon = deadlines.filter((deadline) => deadline.risk === 'soon').length;
  const nextDeadline = deadlines.find((deadline) => deadline.daysUntil >= 0) ?? deadlines[0];

  if (overdue > 0) {
    return {
      risk: 'overdue',
      label: labels.overdueLabel(overdue),
      description: nextDeadline ? nextDeadline.title : labels.deadlineElapsed,
      nextDeadline,
      overdue,
      urgent,
      soon,
      total: deadlines.length,
    };
  }
  if (urgent > 0) {
    return {
      risk: 'urgent',
      label: labels.dueIn7d(urgent),
      description: nextDeadline ? nextDeadline.title : labels.immediateDeadline,
      nextDeadline,
      overdue,
      urgent,
      soon,
      total: deadlines.length,
    };
  }
  if (soon > 0) {
    return {
      risk: 'soon',
      label: labels.dueIn30d(soon),
      description: nextDeadline ? nextDeadline.title : labels.upcomingDeadline,
      nextDeadline,
      overdue,
      urgent,
      soon,
      total: deadlines.length,
    };
  }
  if (deadlines.length > 0) {
    return {
      risk: 'scheduled',
      label: labels.scheduled,
      description: nextDeadline ? nextDeadline.title : labels.futureDeadline,
      nextDeadline,
      overdue,
      urgent,
      soon,
      total: deadlines.length,
    };
  }
  return {
    risk: 'none',
    label: labels.noVisible,
    description: labels.noDeadlineFields,
    overdue: 0,
    urgent: 0,
    soon: 0,
    total: 0,
  };
}

export function buildDeadlinePortfolio(
  rows: LegalCase[],
  locale: AppLocale,
  fallbackTitle: string,
  labels: DeadlineLabels,
): CaseDeadlinePortfolio {
  const deadlines = rows.flatMap((row) => collectCaseDeadlines(row, locale, fallbackTitle, labels));
  const overdue = deadlines.filter((deadline) => deadline.risk === 'overdue').length;
  const urgent = deadlines.filter((deadline) => deadline.risk === 'urgent').length;
  const soon = deadlines.filter((deadline) => deadline.risk === 'soon').length;

  return {
    rowsWithDeadlines: new Set(deadlines.map((deadline) => deadline.caseId)).size,
    totalDeadlines: deadlines.length,
    overdue,
    urgent,
    soon,
    nextDeadline: deadlines.find((deadline) => deadline.daysUntil >= 0) ?? deadlines[0],
    deadlines,
  };
}

export function deadlineToCalendarEvent(deadline: CaseDeadline): CalendarEvent {
  const severity =
    deadline.risk === 'overdue'
      ? 'critical'
      : deadline.risk === 'urgent'
        ? 'high'
        : deadline.risk === 'soon'
          ? 'medium'
          : 'info';

  return {
    id: deadline.id,
    date: deadline.date,
    title: deadline.caseTitle,
    severity,
    kind: deadline.kind,
    meta: deadline.title,
  };
}
