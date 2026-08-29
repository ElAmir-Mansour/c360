'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Clock3, FileWarning, ShieldAlert } from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import type { LexSignatureEnvelope } from '@/types/suites';
import { resolveSignatureLabels } from './labels';

type RiskMode = 'list' | 'calendar';
type RiskLevel = 'overdue' | 'soon' | 'later' | 'none';
type RiskFilter = 'overdue' | 'soon' | 'providerIssues' | 'custodyMissing';

interface SignatureRiskCenterProps {
  envelopes: LexSignatureEnvelope[];
  locale: string;
  onOpenEnvelope: (id: string) => void;
  triggerAria: (title: string) => string;
}

const RISK_COPY = {
  en: {
    title: 'Deadline Risk Center',
    description: 'Due dates, expiry dates, provider signals, and custody gaps from the loaded table rows.',
    loadedRows: 'Loaded rows',
    fallbackNote:
      'Overdue, provider issue, and custody-missing totals are loaded-row fallbacks because the list API does not expose those analytics yet.',
    list: 'List',
    calendar: 'Calendar',
    overdue: 'Overdue',
    dueSoon: 'Due soon',
    providerIssues: 'Provider issues',
    missingCustody: 'Missing custody',
    noRisks: 'No deadline, provider, or custody risks in the loaded rows.',
    due: 'Due',
    expires: 'Expires',
    noDeadline: 'No deadline',
    today: 'Today',
    tomorrow: 'Tomorrow',
    daysLeft: (days: number) => `${days} days left`,
    daysOverdue: (days: number) => `${days} days overdue`,
    providerIssue: 'Provider issue',
    custodyMissing: 'Custody missing',
  },
  ar: {
    title: 'مركز مخاطر المواعيد',
    description: 'المواعيد النهائية والانتهاء وإشارات المزوّد وفجوات العهدة من صفوف الجدول المحملة.',
    loadedRows: 'الصفوف المحملة',
    fallbackNote:
      'إجماليات التأخر ومشكلات المزوّد ونقص العهدة تعتمد على الصفوف المحملة لأن واجهة القائمة لا توفر هذه التحليلات بعد.',
    list: 'قائمة',
    calendar: 'تقويم',
    overdue: 'متأخر',
    dueSoon: 'قريب',
    providerIssues: 'مشكلات المزوّد',
    missingCustody: 'عهدة ناقصة',
    noRisks: 'لا توجد مخاطر مواعيد أو مزوّد أو عهدة في الصفوف المحملة.',
    due: 'مستحق',
    expires: 'ينتهي',
    noDeadline: 'بلا موعد',
    today: 'اليوم',
    tomorrow: 'غدًا',
    daysLeft: (days: number) => `باقي ${days} يوم`,
    daysOverdue: (days: number) => `متأخر ${days} يوم`,
    providerIssue: 'مشكلة مزوّد',
    custodyMissing: 'عهدة ناقصة',
  },
} as const;

export function SignatureRiskCenter({
  envelopes,
  locale,
  onOpenEnvelope,
  triggerAria,
}: SignatureRiskCenterProps) {
  const [mode, setMode] = useState<RiskMode>('list');
  const [riskFilter, setRiskFilter] = useState<RiskFilter | null>(null);
  const copy = locale === 'ar' ? RISK_COPY.ar : RISK_COPY.en;
  // Envelope-status badge text resolves through the canonical signature status
  // map (labels.ts) so it localizes; formatToken stays as the unknown-token net.
  const statusOptions = useMemo(
    () => resolveSignatureLabels(locale === 'ar' ? 'ar' : 'en').filters.statusOptions,
    [locale],
  );
  const now = useMemo(() => new Date(), []);

  const riskRows = useMemo(
    () =>
      envelopes
        .map((envelope) => toRiskRow(envelope, now))
        .filter((row) => row.level !== 'none' || row.providerIssue || row.custodyMissing)
        .sort(compareRiskRows),
    [envelopes, now],
  );

  const summary = useMemo(
    () => ({
      overdue: riskRows.filter((row) => row.level === 'overdue').length,
      soon: riskRows.filter((row) => row.level === 'soon').length,
      providerIssues: riskRows.filter((row) => row.providerIssue).length,
      custodyMissing: riskRows.filter((row) => row.custodyMissing).length,
    }),
    [riskRows],
  );

  const calendarDays = useMemo(() => buildCalendarDays(now, 14), [now]);
  const visibleRiskRows = useMemo(() => {
    if (riskFilter === 'overdue') return riskRows.filter((row) => row.level === 'overdue');
    if (riskFilter === 'soon') return riskRows.filter((row) => row.level === 'soon');
    if (riskFilter === 'providerIssues') return riskRows.filter((row) => row.providerIssue);
    if (riskFilter === 'custodyMissing') return riskRows.filter((row) => row.custodyMissing);
    return riskRows;
  }, [riskFilter, riskRows]);

  const selectRisk = (filter: RiskFilter) => {
    setRiskFilter((current) => (current === filter ? null : filter));
    setMode('list');
  };

  return (
    <section className="surface-card rounded-3xl p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{copy.title}</h2>
            <Badge variant="outline" className="gap-1">
              <FileWarning className="h-3.5 w-3.5" />
              {copy.loadedRows}
            </Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{copy.description}</p>
        </div>
        <div className="inline-flex w-fit items-center gap-1 rounded-lg border p-0.5">
          <Button
            type="button"
            variant={mode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5"
            aria-pressed={mode === 'list'}
            onClick={() => setMode('list')}
          >
            <Clock3 className="h-4 w-4" />
            {copy.list}
          </Button>
          <Button
            type="button"
            variant={mode === 'calendar' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5"
            aria-pressed={mode === 'calendar'}
            onClick={() => setMode('calendar')}
          >
            <CalendarDays className="h-4 w-4" />
            {copy.calendar}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <RiskStat icon={AlertTriangle} label={copy.overdue} value={summary.overdue} tone="danger" active={riskFilter === 'overdue'} onClick={() => selectRisk('overdue')} />
        <RiskStat icon={Clock3} label={copy.dueSoon} value={summary.soon} tone="warning" active={riskFilter === 'soon'} onClick={() => selectRisk('soon')} />
        <RiskStat icon={ShieldAlert} label={copy.providerIssues} value={summary.providerIssues} tone="danger" active={riskFilter === 'providerIssues'} onClick={() => selectRisk('providerIssues')} />
        <RiskStat icon={FileWarning} label={copy.missingCustody} value={summary.custodyMissing} tone="warning" active={riskFilter === 'custodyMissing'} onClick={() => selectRisk('custodyMissing')} />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{copy.fallbackNote}</p>

      {visibleRiskRows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          {copy.noRisks}
        </div>
      ) : mode === 'list' ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {(riskFilter ? visibleRiskRows : visibleRiskRows.slice(0, 8)).map((row) => (
            <button
              key={row.envelope.id}
              type="button"
              className="rounded-lg border bg-background/50 px-4 py-3 text-start transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenEnvelope(row.envelope.id)}
              aria-label={triggerAria(row.envelope.title)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.envelope.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.deadline ? (
                      <>
                        {row.deadlineKind === 'due' ? copy.due : copy.expires}: {formatDateTime(row.deadline)}
                      </>
                    ) : (
                      copy.noDeadline
                    )}
                  </p>
                </div>
                <StatusBadge
                  status={row.envelope.status}
                  label={statusOptions[row.envelope.status] ?? unknownStatusLabel(row.envelope.status, locale)}
                  size="sm"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.level !== 'none' ? (
                  <Badge variant={row.level === 'overdue' ? 'destructive' : row.level === 'soon' ? 'warning' : 'outline'}>
                    {deadlineLabel(row.daysUntil, copy)}
                  </Badge>
                ) : null}
                {row.providerIssue ? <Badge variant="destructive">{copy.providerIssue}</Badge> : null}
                {row.custodyMissing ? <Badge variant="warning">{copy.custodyMissing}</Badge> : null}
                {row.deadline ? (
                  <span className="text-xs text-muted-foreground">
                    <RelativeTime date={row.deadline} />
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-7">
          {calendarDays.map((day) => {
            const dayRows = visibleRiskRows.filter((row) => row.deadline && sameDay(row.deadline, day.date));
            return (
              <button
                key={day.key}
                type="button"
                className={cn(
                  'min-h-[7.5rem] rounded-lg border bg-background/50 p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  dayRows.length > 0 && 'border-primary/30 bg-primary/5',
                )}
                disabled={dayRows.length === 0}
                onClick={() => {
                  const first = dayRows[0];
                  if (first) {
                    onOpenEnvelope(first.envelope.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{day.weekday}</p>
                    <p className="text-lg font-semibold tabular-nums">{day.day}</p>
                  </div>
                  {dayRows.length > 0 ? (
                    <Badge variant="secondary" className="tabular-nums">
                      {dayRows.length}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 space-y-1">
                  {dayRows.slice(0, 2).map((row) => (
                    <p key={row.envelope.id} className="truncate text-xs font-medium">
                      {row.envelope.title}
                    </p>
                  ))}
                  {dayRows.length > 2 ? (
                    <p className="text-xs text-muted-foreground">+{dayRows.length - 2}</p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RiskStat({
  icon: Icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number;
  tone: 'danger' | 'warning';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${value}`}
      title={statisticHint(label)}
      className={cn(
        'h-auto flex-col items-stretch rounded-lg bg-background/50 px-4 py-3 text-start font-normal hover:border-primary/30 hover:bg-primary/5',
        active && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <Icon className={cn('h-4 w-4', tone === 'danger' ? 'text-destructive' : 'text-warning-700 dark:text-warning-300')} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </Button>
  );
}

interface RiskRow {
  envelope: LexSignatureEnvelope;
  deadline: string | null;
  deadlineKind: 'due' | 'expires';
  daysUntil: number | null;
  level: RiskLevel;
  providerIssue: boolean;
  custodyMissing: boolean;
}

function toRiskRow(envelope: LexSignatureEnvelope, now: Date): RiskRow {
  const deadlineKind = envelope.due_at ? 'due' : 'expires';
  const deadline = envelope.due_at ?? envelope.expires_at ?? null;
  const daysUntil = deadline ? calendarDayDiff(new Date(deadline), now) : null;
  const level = classifyDeadline(envelope, daysUntil);

  return {
    envelope,
    deadline,
    deadlineKind,
    daysUntil,
    level,
    providerIssue: hasSignatureProviderIssue(envelope),
    custodyMissing: isSignatureCustodyMissing(envelope),
  };
}

function compareRiskRows(left: RiskRow, right: RiskRow): number {
  const rank = (row: RiskRow) => {
    if (row.level === 'overdue') return 0;
    if (row.providerIssue) return 1;
    if (row.custodyMissing) return 2;
    if (row.level === 'soon') return 3;
    return 4;
  };
  const rankDelta = rank(left) - rank(right);
  if (rankDelta !== 0) return rankDelta;
  return dateValue(left.deadline) - dateValue(right.deadline);
}

function classifyDeadline(envelope: LexSignatureEnvelope, daysUntil: number | null): RiskLevel {
  if (daysUntil == null || isTerminalWithoutCustodyNeed(envelope.status)) {
    return 'none';
  }
  if (daysUntil < 0) {
    return 'overdue';
  }
  if (daysUntil <= 7) {
    return 'soon';
  }
  return 'later';
}

function isTerminalWithoutCustodyNeed(status: string): boolean {
  return ['signed', 'declined', 'expired', 'cancelled'].includes(status);
}

export function isSignatureCustodyMissing(envelope: LexSignatureEnvelope): boolean {
  return envelope.status === 'signed' && (envelope.custody_evidence?.length ?? 0) === 0;
}

export function hasSignatureProviderIssue(envelope: LexSignatureEnvelope): boolean {
  if (['declined', 'expired', 'cancelled'].includes(envelope.status) && envelope.provider !== 'native') {
    return true;
  }
  return (envelope.events ?? []).some((event) => {
    const value = `${event.event_type ?? ''} ${event.provider_status ?? ''}`.toLowerCase();
    return ['fail', 'error', 'reject', 'declin', 'timeout', 'expired'].some((token) => value.includes(token));
  });
}

export function isSignatureExpiringSoon(envelope: LexSignatureEnvelope, now = new Date()): boolean {
  const deadline = envelope.due_at ?? envelope.expires_at;
  if (!deadline || isTerminalWithoutCustodyNeed(envelope.status)) {
    return false;
  }
  const daysUntil = calendarDayDiff(new Date(deadline), now);
  return daysUntil >= 0 && daysUntil <= 7;
}

export function isSignatureOverdue(envelope: LexSignatureEnvelope, now = new Date()): boolean {
  const deadline = envelope.due_at ?? envelope.expires_at;
  if (!deadline || isTerminalWithoutCustodyNeed(envelope.status)) {
    return false;
  }
  return calendarDayDiff(new Date(deadline), now) < 0;
}

function deadlineLabel(daysUntil: number | null, copy: typeof RISK_COPY.en | typeof RISK_COPY.ar): string {
  if (daysUntil == null) return copy.noDeadline;
  if (daysUntil < 0) return copy.daysOverdue(Math.abs(daysUntil));
  if (daysUntil === 0) return copy.today;
  if (daysUntil === 1) return copy.tomorrow;
  return copy.daysLeft(daysUntil);
}

function buildCalendarDays(now: Date, count: number): Array<{ key: string; date: Date; weekday: string; day: string }> {
  const start = startOfDay(now);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      key: date.toISOString().slice(0, 10),
      date,
      weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
      day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    };
  });
}

function sameDay(value: string, day: Date): boolean {
  const parsed = new Date(value);
  return startOfDay(parsed).valueOf() === startOfDay(day).valueOf();
}

function calendarDayDiff(value: Date, now: Date): number {
  const target = startOfDay(value).valueOf();
  const today = startOfDay(now).valueOf();
  return Math.round((target - today) / 86_400_000);
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dateValue(value?: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function unknownStatusLabel(value: string, locale: string): string {
  if (locale === 'ar') return 'حالة غير معروفة';
  return value.replace(/_/g, ' ');
}
