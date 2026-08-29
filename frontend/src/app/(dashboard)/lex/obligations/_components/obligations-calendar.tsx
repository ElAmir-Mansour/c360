/**
 * <ObligationsCalendar> — a domain-local, KSA-aware month calendar for the
 * Watheeq obligations surface.
 *
 * Why local (not the shared `EventCalendar`)? The shared calendar renders only
 * Gregorian day numbers and has no notion of the Hijri (Umm al-Qura) calendar or
 * Saudi public holidays — both of which the legal client requires. Rather than
 * mutate the shared primitive (consumed by other suites), this component owns the
 * legal-suite presentation: each day cell shows the Gregorian day number, the
 * Hijri day underneath (Arabic-Indic in `ar`), tints KSA weekends + holidays, and
 * marks recognized holidays (Founding Day, National Day, Eid al-Fitr/Adha) with a
 * dot + tooltip. Event pills are colour-coded by severity and SLA-aged badges
 * surface the most urgent obligations in the agenda.
 *
 * Everything routes through `useLexFormat()` so Arabic mode renders Hijri month
 * headers + Arabic-Indic digits, and `isKsaHoliday()` drives the holiday marks.
 * Bilingual + RTL safe via the active locale; the grid flips with `dir`.
 */

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, List, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SlaAgingBadge } from '@/components/lex/sla-aging-badge';
import { cn } from '@/lib/utils';
import { getHijriParts, isKsaHoliday, isKsaWeekend, useLexFormat } from '@/lib/lex/ksa';
import type { ObligationsCalendarLabels } from '../_lib/obligations-labels';

export type ObligationEventSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ObligationCalendarEvent {
  id: string;
  date: string | Date;
  title: string;
  severity?: ObligationEventSeverity;
  kind?: string;
  href?: string;
  meta?: string;
  /** When set, drives an SLA aging badge in the agenda row. */
  dueAt?: string | Date | null;
  /** Terminal status suppresses the SLA badge. */
  status?: string | null;
}

interface ObligationsCalendarProps {
  events: ObligationCalendarEvent[];
  labels: ObligationsCalendarLabels;
  dir: 'ltr' | 'rtl';
  className?: string;
}

/** Severity → dot tint (mirrors the shared severity ramp). */
const SEVERITY_DOT: Record<ObligationEventSeverity, string> = {
  critical: 'bg-error-500 dark:bg-error-300',
  high: 'bg-warning-500 dark:bg-warning-300',
  medium: 'bg-warning-500 dark:bg-warning-300',
  low: 'bg-brand-teal-500 dark:bg-brand-teal-400',
  info: 'bg-neutral-400 dark:bg-neutral-500',
};

/** Severity → agenda pill tint. */
const SEVERITY_PILL: Record<ObligationEventSeverity, string> = {
  critical: 'bg-error-100 text-error-600 dark:bg-error-700/30 dark:text-error-300',
  high: 'bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300',
  medium: 'bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300',
  low: 'bg-brand-teal-100 text-brand-teal-700 dark:bg-brand-teal-900/30 dark:text-brand-teal-300',
  info: 'bg-secondary text-foreground/70 dark:bg-muted/40 dark:text-foreground/60',
};

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

type DayEvent = ObligationCalendarEvent & { _date: Date; severity: ObligationEventSeverity };

export function ObligationsCalendar({ events, labels, dir, className }: ObligationsCalendarProps) {
  const f = useLexFormat();
  const isRtl = dir === 'rtl';
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [cursor, setCursor] = useState<Date>(() => {
    const first = events[0];
    return first ? startOfMonth(toDate(first.date)) : startOfMonth(new Date());
  });

  const normalized = useMemo<DayEvent[]>(() => {
    return events
      .map((event) => {
        const date = toDate(event.date);
        return Number.isNaN(date.getTime())
          ? null
          : { ...event, _date: date, severity: event.severity ?? 'info' };
      })
      .filter((event): event is DayEvent => event !== null);
  }, [events]);

  const monthDays = useMemo(() => {
    // KSA week starts on Sunday (weekStartsOn: 0).
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    for (const event of normalized) {
      const key = format(event._date, 'yyyy-MM-dd');
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [normalized]);

  const agendaGroups = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    for (const event of [...normalized].sort((a, b) => a._date.getTime() - b._date.getTime())) {
      const key = format(event._date, 'yyyy-MM-dd');
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    return Array.from(map.entries());
  }, [normalized]);

  // Hijri-aware month header: "September 2026 · صفر ١٤٤٨".
  const monthLabel = f.formatDate(cursor, { month: 'long', year: 'numeric' });
  const hijriMonthLabel = f.formatHijri(cursor, { month: 'long', year: 'numeric' });

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div dir={dir} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={labels.prev}
            onClick={() => setCursor((current) => addMonths(current, -1))}
          >
            <PrevIcon className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-[12rem] text-center">
            <span className="block text-sm font-semibold capitalize leading-tight">{monthLabel}</span>
            <span className="block text-[0.7rem] font-medium text-muted-foreground">{hijriMonthLabel}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={labels.next}
            onClick={() => setCursor((current) => addMonths(current, 1))}
          >
            <NextIcon className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-0.5">
          <Button
            type="button"
            variant={view === 'month' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            aria-pressed={view === 'month'}
            onClick={() => setView('month')}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {labels.month}
          </Button>
          <Button
            type="button"
            variant={view === 'agenda' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            aria-pressed={view === 'agenda'}
            onClick={() => setView('agenda')}
          >
            <List className="h-3.5 w-3.5" aria-hidden />
            {labels.agenda}
          </Button>
        </div>
      </div>

      {view === 'month' ? (
        <MonthGrid
          days={monthDays}
          cursor={cursor}
          eventsByDay={eventsByDay}
          labels={labels}
          isRtl={isRtl}
        />
      ) : (
        <AgendaList groups={agendaGroups} labels={labels} />
      )}

      {/* Legend so the holiday + weekend tinting is self-explanatory. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[0.7rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-success-500/70" aria-hidden />
          {labels.legendHoliday}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" aria-hidden />
          {labels.legendWeekend}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-success-500" aria-hidden />
          {labels.legendHijri}
        </span>
      </div>
    </div>
  );
}

function MonthGrid({
  days,
  cursor,
  eventsByDay,
  labels,
  isRtl,
}: {
  days: Date[];
  cursor: Date;
  eventsByDay: Map<string, DayEvent[]>;
  labels: ObligationsCalendarLabels;
  isRtl: boolean;
}) {
  const f = useLexFormat();

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 shadow-elevation-1">
      <div className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
        {labels.weekdays.map((weekday, index) => (
          <div
            key={`${weekday}-${index}`}
            className={cn(
              'px-2 py-1.5 text-center text-[0.7rem] font-medium uppercase tracking-wide',
              // Fri (5) + Sat (6) are the KSA weekend.
              index >= 5 ? 'text-success-700/80 dark:text-success-300/80' : 'text-muted-foreground',
            )}
          >
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDay.get(key) ?? [];
          const outside = !isSameMonth(day, cursor);
          const visible = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - visible.length;
          const holiday = isKsaHoliday(day);
          const weekend = isKsaWeekend(day);
          const hijri = getHijriParts(day);
          const today = isToday(day);

          return (
            <div
              key={key}
              className={cn(
                'min-h-[6rem] border-b border-border/60 p-1.5 transition-colors duration-fast',
                isRtl ? 'border-l' : 'border-r',
                '[&:nth-child(7n)]:border-x-0',
                outside && 'bg-muted/20',
                weekend && !outside && 'bg-muted/30',
                holiday && !outside && 'bg-success-50/70 dark:bg-success-700/15',
              )}
            >
              <div className="mb-1 flex items-start justify-between">
                {/* Holiday marker (start side) */}
                {holiday ? (
                  <span
                    className="mt-0.5 inline-flex items-center gap-1"
                    title={holiday.name[f.locale === 'ar' ? 'ar' : 'en']}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden />
                    <span className="max-w-[4.5rem] truncate text-[0.6rem] font-medium text-success-700 dark:text-success-300">
                      {holiday.name[f.locale === 'ar' ? 'ar' : 'en']}
                    </span>
                  </span>
                ) : (
                  <span aria-hidden />
                )}
                {/* Gregorian day + Hijri day stacked (end side) */}
                <span className="flex flex-col items-center leading-none">
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs',
                      outside ? 'text-muted-foreground/50' : 'text-foreground/80',
                      today && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {f.formatNumber(Number(format(day, 'd')))}
                  </span>
                  {hijri ? (
                    <span
                      className={cn(
                        'mt-0.5 text-[0.6rem] tabular-nums',
                        outside ? 'text-muted-foreground/40' : 'text-muted-foreground',
                      )}
                    >
                      {f.formatNumber(hijri.day)}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {visible.map((event) => (
                  <EventPill key={event.id} event={event} />
                ))}
                {overflow > 0 ? (
                  <span className="px-1 text-[0.7rem] text-muted-foreground">
                    {labels.more(f.formatNumber(overflow))}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventPill({ event }: { event: DayEvent }) {
  const inner = (
    <>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_DOT[event.severity])} aria-hidden />
      <span className="truncate">{event.title}</span>
    </>
  );
  const base =
    'flex w-full items-center gap-1 rounded px-1 py-0.5 text-start text-[0.72rem] leading-tight transition-colors hover:bg-accent/70';

  if (event.href) {
    return (
      <Link href={event.href} className={base} title={event.title}>
        {inner}
      </Link>
    );
  }
  return (
    <span className={base} title={event.title}>
      {inner}
    </span>
  );
}

function AgendaList({
  groups,
  labels,
}: {
  groups: [string, DayEvent[]][];
  labels: ObligationsCalendarLabels;
}) {
  const f = useLexFormat();

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
        {labels.noEvents}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([key, items]) => {
        const date = items[0]._date;
        const holiday = isKsaHoliday(date);
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold">
                {f.formatDate(date, { weekday: 'long', day: 'numeric', month: 'short' })}
              </span>
              <span className="text-xs text-muted-foreground">{f.formatHijri(date)}</span>
              {holiday ? (
                <span className="rounded-full bg-success-100 px-1.5 py-0.5 text-overline font-medium text-success-700 dark:bg-success-700/30 dark:text-success-300">
                  {holiday.name[f.locale === 'ar' ? 'ar' : 'en']}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              {items.map((event) => (
                <AgendaRow key={event.id} event={event} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaRow({ event }: { event: DayEvent }) {
  const inner = (
    <>
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[event.severity])} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{event.title}</span>
        {event.meta ? <span className="truncate text-xs text-muted-foreground">{event.meta}</span> : null}
      </span>
      {event.dueAt ? (
        <SlaAgingBadge dueAt={event.dueAt} status={event.status} size="sm" hideTiming />
      ) : null}
      {event.kind ? (
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
            SEVERITY_PILL[event.severity],
          )}
        >
          {event.kind}
        </span>
      ) : null}
    </>
  );
  const base =
    'flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-start transition-[box-shadow,border-color] duration-fast hover:border-primary/20 hover:bg-primary/5';

  if (event.href) {
    return (
      <Link href={event.href} className={base}>
        {inner}
      </Link>
    );
  }
  return <span className={cn(base, 'w-full')}>{inner}</span>;
}
