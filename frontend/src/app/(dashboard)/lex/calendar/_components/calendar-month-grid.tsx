'use client';

/**
 * Month grid for the Unified Legal Calendar — the flagship surface.
 *
 * Beyond the shared EventCalendar grid this adds, per the feature spec:
 *   - DUAL day labels: Gregorian day number + the Umm al-Qura Hijri day, both
 *     locale-shaped (Arabic-Indic digits in ar) via `useLexFormat`.
 *   - KSA holiday SHADING: national + Eid days carry a warm tint, a small dot,
 *     and a title tooltip with the bilingual holiday name (`isKsaHoliday`).
 *   - Weekend (Fri/Sat) tint so the KSA working week reads correctly.
 *   - RTL-correct cell borders + day-number alignment (logical, mirrors with dir).
 *
 * Severity dot + per-source left rail come from the shared calendar tokens.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { cn } from '@/lib/utils';
import { useLexFormat, isKsaHoliday, isKsaWeekend, getHijriParts } from '@/lib/lex/ksa';
import type { AppLocale } from '@/lib/i18n';
import type { LegalCalendarEvent } from '../_lib/calendar-events';
import type { CalendarLabels } from '../_lib/calendar-i18n';
import { SEVERITY_DOT, TYPE_RAIL } from './calendar-tokens';

interface CalendarMonthGridProps {
  cursor: Date;
  events: LegalCalendarEvent[];
  labels: CalendarLabels;
  isRtl: boolean;
}

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

export function CalendarMonthGrid({
  cursor,
  events,
  labels,
  isRtl,
}: CalendarMonthGridProps) {
  const f = useLexFormat();
  const locale = f.locale;

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, LegalCalendarEvent[]>();
    for (const event of events) {
      const date = new Date(event.date);
      if (Number.isNaN(date.getTime())) continue;
      const key = dayKey(date);
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    // Within a day, surface the most severe first.
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
    for (const bucket of map.values()) {
      bucket.sort((a, b) => order[a.severity] - order[b.severity]);
    }
    return map;
  }, [events]);

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card/40 shadow-elevation-1">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
        {labels.weekdays.map((weekday, index) => (
          <div
            key={weekday}
            className={cn(
              'px-2 py-2 text-center text-[0.7rem] font-semibold uppercase tracking-wide',
              // Fri (5) + Sat (6) are the KSA weekend — tint the header too.
              index >= 5 ? 'text-primary/70' : 'text-muted-foreground',
            )}
          >
            {weekday}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day) => (
          <DayCell
            key={dayKey(day)}
            day={day}
            cursor={cursor}
            events={eventsByDay.get(dayKey(day)) ?? []}
            labels={labels}
            isRtl={isRtl}
            locale={locale}
            formatNumber={f.formatNumber}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  day,
  cursor,
  events,
  labels,
  isRtl,
  locale,
  formatNumber,
}: {
  day: Date;
  cursor: Date;
  events: LegalCalendarEvent[];
  labels: CalendarLabels;
  isRtl: boolean;
  locale: AppLocale;
  formatNumber: (value: number | string) => string;
}) {
  const outside = !isSameMonth(day, cursor);
  const today = isToday(day);
  const holiday = isKsaHoliday(day);
  const weekend = isKsaWeekend(day);
  const hijri = getHijriParts(day);
  const holidayName = holiday ? holiday.name[locale] : undefined;

  const visible = events.slice(0, 3);
  const overflow = events.length - visible.length;

  return (
    <div
      className={cn(
        'group relative min-h-[6.5rem] border-b border-border/60 p-1.5',
        isRtl ? 'border-l' : 'border-r',
        '[&:nth-child(7n)]:border-e-0',
        outside && 'bg-muted/20',
        weekend && !outside && 'bg-primary/[0.035]',
        holiday && !outside && 'bg-warning-50/80 dark:bg-warning-800/20',
      )}
      title={holidayName}
    >
      {/* Holiday glow accent on the top edge */}
      {holiday && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-warning-300/80 to-transparent"
        />
      )}

      {/* Day header: Gregorian (primary) + Hijri (secondary), dual labels */}
      <div className="mb-1 flex items-start justify-between gap-1">
        <div className="flex min-w-0 flex-col leading-none">
          {hijri && (
            <span
              className={cn(
                'text-[0.62rem] tabular-nums',
                outside ? 'text-muted-foreground/40' : 'text-muted-foreground/70',
              )}
            >
              {formatNumber(hijri.day)}
            </span>
          )}
        </div>
        <span
          className={cn(
            'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1 text-xs tabular-nums',
            outside ? 'text-muted-foreground/45' : 'font-medium text-foreground/80',
            today && 'bg-[image:var(--ds-gradient-primary)] font-semibold text-primary-foreground',
          )}
        >
          {formatNumber(Number(format(day, 'd')))}
        </span>
      </div>

      {/* Holiday name chip */}
      {holiday && !outside && holidayName && (
        <div className="mb-1 flex items-center gap-1 truncate rounded px-1 py-0.5 text-[0.62rem] font-medium text-warning-700 dark:text-warning-300">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" aria-hidden />
          <span className="truncate" title={holidayName}>
            {holidayName}
          </span>
        </div>
      )}

      {/* Events */}
      <div className="flex flex-col gap-0.5">
        {visible.map((event) => (
          <EventPill key={event.id} event={event} />
        ))}
        {overflow > 0 && (
          <span className="px-1 text-[0.68rem] font-medium text-muted-foreground">
            {labels.more(overflow)}
          </span>
        )}
      </div>
    </div>
  );
}

function EventPill({ event }: { event: LegalCalendarEvent }) {
  return (
    <Link
      href={event.href}
      title={event.title}
      className={cn(
        'flex w-full items-center gap-1.5 rounded border-s-2 bg-card/70 px-1.5 py-0.5',
        'text-start text-[0.72rem] leading-tight',
        'transition-colors duration-fast ease-standard hover:bg-accent/70',
        TYPE_RAIL[event.type],
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_DOT[event.severity])} aria-hidden />
      <span className="truncate text-foreground/85">{event.title}</span>
    </Link>
  );
}
