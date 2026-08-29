'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListChecks,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/common/empty-state';
import { useDRDrillScheduleNextRuns } from '../../../_hooks/use-dr-queries';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import type { DRDrillResult, DRDrillSchedule } from '@/types/clario-dr';
import { useDrillCalendarLabels } from './drill-calendar-labels';
import {
  assessSchedule,
  compareByAttention,
  formatCadenceHorizon,
  summarizeCadence,
  type DrillCadenceAssessment,
  type DrillCadenceStatus,
} from './drill-cadence';
import { DrillCadenceBanner } from './drill-cadence-banner';

const STATUS_BADGE_VARIANT: Record<DrillCadenceStatus, NonNullable<BadgeProps['variant']>> = {
  overdue: 'destructive',
  due_soon: 'warning',
  on_track: 'success',
  paused: 'outline',
};

/** One plotted drill occurrence on the calendar grid. */
interface PlottedRun {
  scheduleId: string;
  scheduleName: string;
  at: string;
  status: DrillCadenceStatus;
}

/**
 * Per-schedule loader: calls {@link useDRDrillScheduleNextRuns} for a single
 * enabled schedule and lifts its resolved next-run timestamps to the parent.
 * Rendering one instance per schedule keeps React's hook order stable (each
 * schedule owns its own component instance and its own cache entry) while still
 * fanning out across every schedule on the calendar. Renders nothing.
 */
function ScheduleNextRunsLoader({
  scheduleId,
  count,
  onRuns,
}: {
  scheduleId: string;
  count: number;
  onRuns: (scheduleId: string, runs: string[]) => void;
}) {
  const query = useDRDrillScheduleNextRuns(scheduleId, count);
  const runs = query.data?.next_runs;

  useEffect(() => {
    if (runs) {
      onRuns(scheduleId, runs);
    }
  }, [scheduleId, runs, onRuns]);

  return null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Build the 6x7 day grid (leading/trailing days from adjacent months) for a month. */
function buildMonthDays(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay()); // back to the Sunday on/before the 1st
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    days.push(day);
  }
  return days;
}

function CadenceStatusBadge({ status }: { status: DrillCadenceStatus }) {
  const labels = useDrillCalendarLabels();
  return <Badge variant={STATUS_BADGE_VARIANT[status]}>{labels.status[status]}</Badge>;
}

/**
 * Drill calendar with cadence enforcement.
 *
 * - Plots upcoming runs (each schedule's `next_run` plus its
 *   {@link useDRDrillScheduleNextRuns} horizon) on a month grid, colour-coded by
 *   the owning schedule's cadence status.
 * - Lists every schedule with its cron cadence, next/last run, and an
 *   overdue / due-soon / on-track / paused badge derived from the REAL cadence +
 *   last result (no invented fields).
 * - Renders the cadence attention banner above the grid.
 *
 * Read-only surface (no write actions) so it is not gated by `dr:write`; the
 * page still wraps any write controls separately. Token-driven + RTL-safe.
 */
export function DrillCalendar({
  schedules,
  drillResults,
  now,
  loading = false,
  error = null,
  onRetry,
  nextRunsCount = 6,
}: {
  schedules: readonly DRDrillSchedule[];
  drillResults: readonly DRDrillResult[];
  /** Render clock; defaults to the mount instant. Pass a fixed value in tests. */
  now?: Date | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** How many upcoming occurrences to request per schedule. */
  nextRunsCount?: number;
}) {
  const labels = useDrillCalendarLabels();
  const nowMs = useMemo(
    () => (now === undefined ? Date.now() : typeof now === 'number' ? now : now.getTime()),
    [now],
  );
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);

  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date(nowMs)));
  const [nextRunsBySchedule, setNextRunsBySchedule] = useState<Record<string, string[]>>({});

  const handleRuns = useMemo(
    () => (scheduleId: string, runs: string[]) => {
      setNextRunsBySchedule((prev) => {
        const existing = prev[scheduleId];
        if (existing && existing.length === runs.length && existing.every((v, i) => v === runs[i])) {
          return prev;
        }
        return { ...prev, [scheduleId]: runs };
      });
    },
    [],
  );

  const assessments = useMemo<DrillCadenceAssessment[]>(
    () =>
      schedules
        .map((schedule) => assessSchedule(schedule, drillResults, nowMs))
        .sort(compareByAttention),
    [schedules, drillResults, nowMs],
  );

  const assessmentById = useMemo(() => {
    const map = new Map<string, DrillCadenceAssessment>();
    for (const a of assessments) map.set(a.scheduleId, a);
    return map;
  }, [assessments]);

  const summary = useMemo(() => summarizeCadence(assessments), [assessments]);
  const enabledCount = useMemo(
    () => schedules.filter((schedule) => schedule.enabled).length,
    [schedules],
  );

  // Plot upcoming runs: server next_run + fetched next-runs horizon, de-duped.
  const runsByDayKey = useMemo(() => {
    const map = new Map<string, PlottedRun[]>();
    const push = (scheduleId: string, scheduleName: string, status: DrillCadenceStatus, iso: string) => {
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return;
      const day = new Date(ms);
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const list = map.get(key) ?? [];
      if (list.some((run) => run.scheduleId === scheduleId && run.at === iso)) return;
      list.push({ scheduleId, scheduleName, at: iso, status });
      map.set(key, list);
    };

    for (const schedule of schedules) {
      const status = assessmentById.get(schedule.id)?.status ?? 'on_track';
      if (schedule.next_run) push(schedule.id, schedule.name, status, schedule.next_run);
      for (const iso of nextRunsBySchedule[schedule.id] ?? []) {
        push(schedule.id, schedule.name, status, iso);
      }
    }
    return map;
  }, [schedules, assessmentById, nextRunsBySchedule]);

  const monthDays = useMemo(() => buildMonthDays(monthAnchor), [monthAnchor]);
  const monthLabel = useMemo(() => formatDate(monthAnchor, 'MMMM yyyy'), [monthAnchor]);

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={CalendarClock}
            title={labels.errorTitle}
            description={labels.errorDescription}
            action={onRetry ? { label: labels.retry, onClick: onRetry } : undefined}
            size="compact"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {/* Fan-out loaders for enabled schedules — render nothing visible. */}
      {schedules
        .filter((schedule) => schedule.enabled)
        .map((schedule) => (
          <ScheduleNextRunsLoader
            key={schedule.id}
            scheduleId={schedule.id}
            count={nextRunsCount}
            onRuns={handleRuns}
          />
        ))}

      <CardHeader className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle className="text-base">{labels.title}</CardTitle>
        </div>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <DrillCadenceBanner summary={summary} totalEnabled={enabledCount} />

        {loading && schedules.length === 0 ? (
          <div
            className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner className="h-4 w-4" />
            <span>{labels.loading}</span>
          </div>
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
            size="compact"
          />
        ) : (
          <Tabs defaultValue="calendar">
            <TabsList>
              <TabsTrigger value="calendar">
                <CalendarDays className="me-2 h-4 w-4" aria-hidden />
                {labels.viewCalendarTab}
              </TabsTrigger>
              <TabsTrigger value="list">
                <ListChecks className="me-2 h-4 w-4" aria-hidden />
                {labels.viewListTab}
              </TabsTrigger>
            </TabsList>

            {/* ---- Calendar view -------------------------------------------- */}
            <TabsContent value="calendar">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{monthLabel}</h4>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMonthAnchor(startOfMonth(nowDate))}
                    >
                      {labels.today}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={labels.prevMonth}
                      onClick={() => setMonthAnchor((anchor) => addMonths(anchor, -1))}
                    >
                      <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={labels.nextMonth}
                      onClick={() => setMonthAnchor((anchor) => addMonths(anchor, 1))}
                    >
                      <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                    </Button>
                  </div>
                </div>

                <div
                  role="grid"
                  aria-label={labels.monthGridAriaLabel}
                  className="overflow-hidden rounded-xl border border-border/70"
                >
                  <div role="row" className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
                    {labels.weekdayHeaders.map((weekday) => (
                      <div
                        key={weekday}
                        role="columnheader"
                        className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
                      >
                        {weekday}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {monthDays.map((day) => {
                      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                      const dayRuns = runsByDayKey.get(key) ?? [];
                      const inMonth = day.getMonth() === monthAnchor.getMonth();
                      const isToday = sameDay(day, nowDate);
                      return (
                        <div
                          key={key}
                          role="gridcell"
                          aria-label={
                            dayRuns.length > 0
                              ? `${formatDate(day, 'EEEE, MMM d')} — ${labels.dayRunCount(dayRuns.length)}`
                              : formatDate(day, 'EEEE, MMM d')
                          }
                          className={cn(
                            'min-h-24 border-b border-e border-border/60 p-1.5 align-top',
                            inMonth ? 'bg-card' : 'bg-muted/20',
                          )}
                        >
                          <div
                            className={cn(
                              'mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                              inMonth ? 'text-foreground' : 'text-muted-foreground',
                              isToday && 'bg-primary text-primary-foreground font-semibold',
                            )}
                          >
                            {day.getDate()}
                          </div>
                          <ul className="space-y-1">
                            {dayRuns.slice(0, 3).map((run) => (
                              <li key={`${run.scheduleId}-${run.at}`}>
                                <span
                                  className={cn(
                                    'block truncate rounded-md border px-1.5 py-0.5 text-xs',
                                    run.status === 'overdue'
                                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                      : run.status === 'due_soon'
                                        ? 'border-amber-200 bg-amber-50 text-warning-700'
                                        : 'border-primary/20 bg-primary/10 text-primary',
                                  )}
                                  title={`${run.scheduleName} — ${formatDateTime(run.at)}`}
                                >
                                  {formatDate(run.at, 'HH:mm')} {run.scheduleName}
                                </span>
                              </li>
                            ))}
                            {dayRuns.length > 3 ? (
                              <li className="px-1.5 text-xs text-muted-foreground">
                                +{dayRuns.length - 3}
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ---- List view ----------------------------------------------- */}
            <TabsContent value="list">
              <ul className="space-y-2">
                {assessments.map((assessment) => {
                  const schedule = schedules.find((s) => s.id === assessment.scheduleId);
                  if (!schedule) return null;
                  const horizon = formatCadenceHorizon(assessment.boundarySeconds, labels.cadenceNow);
                  const horizonText =
                    assessment.status === 'overdue'
                      ? labels.overdueBy(horizon)
                      : assessment.status === 'paused'
                        ? null
                        : labels.dueIn(horizon);
                  return (
                    <li
                      key={assessment.scheduleId}
                      className="flex flex-col gap-2 rounded-xl border border-border/70 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-foreground">
                            {schedule.name}
                          </span>
                          <CadenceStatusBadge status={assessment.status} />
                          {horizonText ? (
                            <span className="text-xs text-muted-foreground">{horizonText}</span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {labels.cadencePrefix}: <code className="font-mono">{schedule.cron_expr}</code>
                          </span>
                          <span>
                            {labels.rtoObjectivePrefix}: {schedule.rto_objective_seconds}s
                          </span>
                          <span>{schedule.profile}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-0.5 text-xs text-muted-foreground sm:text-end">
                        <span>
                          {labels.nextRunPrefix}:{' '}
                          {assessment.nextRunAt ? formatDateTime(assessment.nextRunAt) : '—'}
                        </span>
                        <span>
                          {labels.lastRunPrefix}:{' '}
                          {assessment.lastCompletedAt
                            ? formatDateTime(assessment.lastCompletedAt)
                            : labels.neverRun}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
