'use client';

/**
 * Agenda view for the Unified Legal Calendar.
 *
 * Upcoming-first list grouped by day. Each day header shows the DUAL
 * Gregorian + Hijri date (`useLexFormat.formatDual`) plus a KSA holiday badge
 * when applicable. Rows carry a per-source left rail, severity dot, a type pill
 * and a relative "due in / ago" hint, all locale + RTL aware. Click-through
 * navigates to the owning entity.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { format, isToday } from 'date-fns';
import { CalendarOff, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLexFormat, isKsaHoliday } from '@/lib/lex/ksa';
import type { LegalCalendarEvent } from '../_lib/calendar-events';
import type { CalendarLabels } from '../_lib/calendar-i18n';
import { SEVERITY_DOT, SEVERITY_PILL, TYPE_RAIL } from './calendar-tokens';

interface CalendarAgendaProps {
  events: LegalCalendarEvent[];
  labels: CalendarLabels;
}

interface AgendaDay {
  key: string;
  date: Date;
  items: LegalCalendarEvent[];
}

export function CalendarAgenda({ events, labels }: CalendarAgendaProps) {
  const f = useLexFormat();

  const groups = useMemo<AgendaDay[]>(() => {
    const map = new Map<string, AgendaDay>();
    const sorted = [...events]
      .map((event) => ({ event, date: new Date(event.date) }))
      .filter(({ date }) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const { event, date } of sorted) {
      const key = format(date, 'yyyy-MM-dd');
      const bucket = map.get(key);
      if (bucket) bucket.items.push(event);
      else map.set(key, { key, date, items: [event] });
    }
    return Array.from(map.values());
  }, [events]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/30 px-6 py-16 text-center">
        <CalendarOff className="h-7 w-7 text-muted-foreground/60" aria-hidden />
        <p className="text-sm text-muted-foreground">{labels.agenda.empty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const holiday = isKsaHoliday(group.date);
        const holidayName = holiday ? holiday.name[f.locale] : undefined;
        return (
          <div key={group.key} className="flex flex-col gap-2 motion-safe:animate-fade-up">
            <div className="flex flex-wrap items-baseline gap-2 border-b border-border/50 pb-1.5">
              <span className="text-sm font-semibold capitalize text-foreground">
                {f.formatDual(group.date)}
              </span>
              {isToday(group.date) && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-overline font-semibold uppercase text-primary">
                  {labels.agenda.today}
                </span>
              )}
              {holidayName && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-overline font-medium text-warning-700 dark:bg-warning-800/30 dark:text-warning-300">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {holidayName}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {group.items.map((event) => (
                <AgendaRow key={event.id} event={event} labels={labels} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaRow({ event, labels }: { event: LegalCalendarEvent; labels: CalendarLabels }) {
  const f = useLexFormat();
  return (
    <Link
      href={event.href}
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-s-2 border-border/60 bg-card/60 px-3 py-2.5',
        'transition-all duration-fast ease-standard',
        'hover:border-primary/30 hover:bg-primary/[0.04] hover:shadow-elevation-1',
        TYPE_RAIL[event.type],
      )}
    >
      <span
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[event.severity])}
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{event.title}</span>
        {event.meta && (
          <span className="truncate text-xs text-muted-foreground">{event.meta}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-overline font-medium',
            SEVERITY_PILL[event.severity],
          )}
        >
          {labels.type[event.type]}
        </span>
        <span className="text-overline tabular-nums text-muted-foreground">
          {f.formatRelative(event.date)}
        </span>
      </span>
    </Link>
  );
}
