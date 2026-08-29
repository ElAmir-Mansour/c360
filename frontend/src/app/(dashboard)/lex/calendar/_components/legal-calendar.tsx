'use client';

/**
 * Unified Legal Calendar — orchestrator (feature #15).
 *
 * Aggregates EVERY dated entity across the lex suite onto one timeline:
 *   hearings · contract renewals/expiries · signature deadlines · obligations ·
 *   settlement milestones · service-desk SLAs.
 *
 * Each source is its own react-query query (via `useQueries`) so a single
 * failing source degrades gracefully instead of blanking the whole surface.
 * Results are normalized to the canonical {@link LegalCalendarEvent} shape,
 * filtered client-side by type + severity chips, and rendered as a month grid
 * (dual Gregorian + Hijri labels, KSA holiday shading) or an agenda list.
 *
 * Fully bilingual (own label bundle) + RTL safe: `dir` is set on the top-level
 * container and all directional iconography mirrors with the locale direction.
 */

import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  List,
  PartyPopper,
  Layers,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat, isKsaHoliday } from '@/lib/lex/ksa';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexEmptyState } from '@/components/lex/empty-state';
import { LexListSkeleton } from '@/components/lex/list-skeleton';

import {
  EVENT_SEVERITIES,
  EVENT_TYPES,
  fetchContractEvents,
  fetchHearingEvents,
  fetchObligationEvents,
  fetchServiceSlaEvents,
  fetchSettlementMilestoneEvents,
  fetchSignatureEvents,
  type LegalCalendarEvent,
  type LegalEventSeverity,
  type LegalEventType,
} from '../_lib/calendar-events';
import { useCalendarLabels } from '../_lib/calendar-i18n';
import { CalendarMonthGrid } from './calendar-month-grid';
import { CalendarAgenda } from './calendar-agenda';
import { CalendarFilters } from './calendar-filters';

type CalendarView = 'month' | 'agenda';
type CalendarKpiScope = 'all' | 'overdue' | 'week' | 'month' | 'holidays';

const STALE_MS = 60_000;

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function LegalCalendar() {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useCalendarLabels();
  const isRtl = direction === 'rtl';

  // A single, stable "now" per mount keeps proximity-severity deterministic
  // across the six normalizers and avoids re-render churn.
  const now = useMemo(() => new Date(), []);

  const [view, setView] = useState<CalendarView>('month');
  const [kpiScope, setKpiScope] = useState<CalendarKpiScope>('all');
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(now));
  const [activeTypes, setActiveTypes] = useState<Set<LegalEventType>>(() => new Set());
  const [activeSeverities, setActiveSeverities] = useState<Set<LegalEventSeverity>>(
    () => new Set(),
  );

  // Six independent, isolation-tolerant queries — one per dated source.
  const results = useQueries({
    queries: [
      {
        queryKey: ['lex-calendar', 'hearings', locale],
        queryFn: () => fetchHearingEvents(locale),
        staleTime: STALE_MS,
      },
      {
        queryKey: ['lex-calendar', 'contracts'],
        queryFn: () => fetchContractEvents(now),
        staleTime: STALE_MS,
      },
      {
        queryKey: ['lex-calendar', 'signatures'],
        queryFn: () => fetchSignatureEvents(now),
        staleTime: STALE_MS,
      },
      {
        queryKey: ['lex-calendar', 'obligations'],
        queryFn: () => fetchObligationEvents(),
        staleTime: STALE_MS,
      },
      {
        queryKey: ['lex-calendar', 'settlements'],
        queryFn: () => fetchSettlementMilestoneEvents(now),
        staleTime: STALE_MS,
      },
      {
        queryKey: ['lex-calendar', 'service-sla'],
        queryFn: () => fetchServiceSlaEvents(),
        staleTime: STALE_MS,
      },
    ],
  });

  const isLoading = results.some((r) => r.isLoading);
  // Only a TOTAL outage (every source failed) is fatal; partial failures
  // degrade quietly so the calendar still shows what it could load.
  const allFailed = results.length > 0 && results.every((r) => r.isError);

  const allEvents = useMemo<LegalCalendarEvent[]>(() => {
    const merged: LegalCalendarEvent[] = [];
    for (const result of results) {
      if (result.data) merged.push(...result.data);
    }
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(',')]);

  // Counts over the FULL set (so chips always show the source totals).
  const typeCounts = useMemo(() => countBy(allEvents, (e) => e.type, EVENT_TYPES), [allEvents]);
  const severityCounts = useMemo(
    () => countBy(allEvents, (e) => e.severity, EVENT_SEVERITIES),
    [allEvents],
  );

  const filtered = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const weekStart = startOfWeek(now, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 0 });
    return allEvents.filter((event) => {
      if (activeTypes.size > 0 && !activeTypes.has(event.type)) return false;
      if (activeSeverities.size > 0 && !activeSeverities.has(event.severity)) return false;
      const date = new Date(event.date);
      if (Number.isNaN(date.getTime())) return kpiScope === 'all';
      if (kpiScope === 'overdue') return date < now;
      if (kpiScope === 'week') return date >= weekStart && date <= weekEnd;
      if (kpiScope === 'month') return date >= monthStart && date <= monthEnd;
      return true;
    });
  }, [activeSeverities, activeTypes, allEvents, cursor, kpiScope, now]);

  const kpis = useMemo<LexKpiItem[]>(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const weekStart = startOfWeek(now, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 0 });

    let overdue = 0;
    let thisWeek = 0;
    let thisMonth = 0;
    for (const event of allEvents) {
      const date = new Date(event.date);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getTime() < now.getTime()) overdue += 1;
      if (date >= weekStart && date <= weekEnd) thisWeek += 1;
      if (date >= monthStart && date <= monthEnd) thisMonth += 1;
    }

    // KSA holidays falling within the visible month.
    let holidays = 0;
    for (
      let d = startOfMonth(cursor);
      d <= monthEnd;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      if (isKsaHoliday(d)) holidays += 1;
    }
    const eventTotal = allEvents.length;
    const overdueShare = percent(overdue, eventTotal);
    const weekShare = percent(thisWeek, eventTotal);
    const monthShare = percent(thisMonth, eventTotal);
    const monthLabel = f.formatDate(cursor, { month: 'long', year: 'numeric' });

    return [
      {
        id: 'total',
        label: labels.kpis.total,
        value: eventTotal,
        theme: 'primary',
        icon: Layers,
        description: labels.description,
        detail: labels.kpis.thisMonth,
        detailValue: monthLabel,
        onAction: () => setKpiScope('all'),
        pressed: kpiScope === 'all',
      },
      {
        id: 'overdue',
        label: labels.kpis.overdue,
        value: overdue,
        theme: 'red',
        icon: AlarmClock,
        trendGoodWhenDown: true,
        description: labels.kpis.overdue,
        progress: overdueShare,
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${overdueShare}%`,
        onAction: () => {
          setKpiScope('overdue');
          setView('agenda');
        },
        pressed: kpiScope === 'overdue',
      },
      {
        id: 'week',
        label: labels.kpis.thisWeek,
        value: thisWeek,
        theme: 'amber',
        icon: CalendarClock,
        description: labels.kpis.thisWeek,
        progress: weekShare,
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${weekShare}%`,
        onAction: () => {
          setKpiScope('week');
          setView('agenda');
        },
        pressed: kpiScope === 'week',
      },
      {
        id: 'month',
        label: labels.kpis.thisMonth,
        value: thisMonth,
        theme: 'teal',
        icon: CalendarRange,
        description: monthLabel,
        progress: monthShare,
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${monthShare}%`,
        onAction: () => setKpiScope('month'),
        pressed: kpiScope === 'month',
      },
      {
        id: 'holidays',
        label: labels.kpis.holidays,
        value: holidays,
        theme: 'emerald',
        icon: PartyPopper,
        description: labels.kpis.holidays,
        detail: labels.kpis.thisMonth,
        detailValue: monthLabel,
        onAction: () => {
          setKpiScope('holidays');
          setView('month');
        },
        pressed: kpiScope === 'holidays',
      },
    ];
  }, [allEvents, cursor, now, labels, f, kpiScope]);

  const toggleType = (type: LegalEventType) =>
    setActiveTypes((prev) => toggle(prev, type));
  const toggleSeverity = (severity: LegalEventSeverity) =>
    setActiveSeverities((prev) => toggle(prev, severity));
  const clearFilters = () => {
    setActiveTypes(new Set());
    setActiveSeverities(new Set());
  };

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const hasFilters = activeTypes.size > 0 || activeSeverities.size > 0;

  if (allFailed) {
    return (
      <div dir={direction} className="space-y-6">
        <PageHeader
          eyebrow={labels.eyebrow}
          title={labels.title}
          description={labels.description}
        />
        <div className="card p-0">
          <LexEmptyState
            icon={CalendarOff}
            title={labels.error.title}
            description={labels.error.description}
            action={{
              label: labels.error.retry,
              onClick: () => {
                results.forEach((r) => {
                  void r.refetch();
                });
              },
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div dir={direction} className="space-y-6">
      <PageHeader
        eyebrow={labels.eyebrow}
        title={labels.title}
        description={labels.description}
      />

      <LexKpiStrip items={kpis} />

      <CalendarFilters
        labels={labels}
        typeCounts={typeCounts}
        severityCounts={severityCounts}
        activeTypes={activeTypes}
        activeSeverities={activeSeverities}
        onToggleType={toggleType}
        onToggleSeverity={toggleSeverity}
        onClear={clearFilters}
      />

      <div className="card p-4 sm:p-5">
        {/* Toolbar: month nav (month view only) + view toggle */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {view === 'month' ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={labels.views.month}
                onClick={() => setCursor((c) => addMonths(c, -1))}
              >
                <PrevIcon className="h-4 w-4 motion-safe:transition-transform" aria-hidden />
              </Button>
              <span className="min-w-[10rem] text-center text-sm font-semibold capitalize tabular-nums">
                {f.formatDate(cursor, { month: 'long', year: 'numeric' })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={labels.views.month}
                onClick={() => setCursor((c) => addMonths(c, 1))}
              >
                <NextIcon className="h-4 w-4 motion-safe:transition-transform" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ms-1 h-8 px-2.5 text-xs"
                onClick={() => setCursor(startOfMonth(now))}
              >
                {labels.legend.today}
              </Button>
            </div>
          ) : (
            <span className="text-sm font-semibold text-foreground">
              {labels.views.agenda}
            </span>
          )}

          <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-0.5">
            <ViewToggle
              active={view === 'month'}
              icon={CalendarDays}
              label={labels.views.month}
              onClick={() => setView('month')}
            />
            <ViewToggle
              active={view === 'agenda'}
              icon={List}
              label={labels.views.agenda}
              onClick={() => setView('agenda')}
            />
          </div>
        </div>

        {/* Legend */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.7rem] text-muted-foreground">
          <LegendDot className="bg-warning-300" label={labels.legend.holiday} />
          <LegendDot className="bg-primary" label={labels.legend.today} />
          <LegendDot className="bg-primary/30" label={labels.legend.weekend} />
        </div>

        {isLoading && allEvents.length === 0 ? (
          <LexListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <LexEmptyState
            icon={CalendarDays}
            title={labels.empty.title}
            description={hasFilters ? labels.empty.filtered : labels.empty.description}
            action={
              hasFilters
                ? { label: labels.filters.clear, onClick: clearFilters }
                : undefined
            }
          />
        ) : view === 'month' ? (
          <CalendarMonthGrid
            cursor={cursor}
            events={filtered}
            labels={labels}
            isRtl={isRtl}
          />
        ) : (
          <CalendarAgenda events={filtered} labels={labels} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Local presentational helpers
 * ------------------------------------------------------------------------- */

function ViewToggle({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof CalendarDays;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium',
        'transition-colors duration-fast ease-standard',
        active
          ? 'bg-primary/10 text-primary shadow-elevation-1'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2.5 w-2.5 rounded-full', className)} aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * Pure utilities
 * ------------------------------------------------------------------------- */

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function countBy<T, K extends string>(
  items: T[],
  key: (item: T) => K,
  keys: readonly K[],
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
