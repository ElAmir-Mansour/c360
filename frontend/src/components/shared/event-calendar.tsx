"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Locale } from "date-fns";
import { ar as arLocale, enUS as enLocale } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type EventSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface CalendarEvent {
  id: string;
  date: string | Date;
  title: string;
  severity?: EventSeverity;
  kind?: string;
  href?: string;
  meta?: string;
}

interface EventCalendarProps {
  events: CalendarEvent[];
  onSelectEvent?: (id: string) => void;
  initialView?: "month" | "agenda";
  dir?: "ltr" | "rtl";
  locale?: "en" | "ar";
  className?: string;
}

// Palette mirrors @/components/shared/severity-indicator.tsx (dot + pill variants).
const severityDot: Record<EventSeverity, string> = {
  critical: "bg-error-500 dark:bg-error-300",
  high: "bg-warning-500 dark:bg-warning-300",
  medium: "bg-yellow-500 dark:bg-yellow-400",
  low: "bg-blue-500 dark:bg-blue-400",
  info: "bg-neutral-400 dark:bg-neutral-500",
};

const severityPill: Record<EventSeverity, string> = {
  critical: "bg-error-100 text-error-600 dark:bg-error-700/30 dark:text-error-300",
  high: "bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  info: "bg-secondary text-foreground/70 dark:bg-neutral-ink dark:text-foreground/55",
};

const T = {
  en: {
    month: "Month",
    agenda: "Agenda",
    prev: "Previous month",
    next: "Next month",
    noEvents: "No events scheduled",
    more: (n: number) => `+${n} more`,
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  ar: {
    month: "شهر",
    agenda: "قائمة",
    prev: "الشهر السابق",
    next: "الشهر التالي",
    noEvents: "لا توجد أحداث مجدولة",
    more: (n: number) => `+${n} المزيد`,
    weekdays: ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"],
  },
} as const;

function toDate(value: string | Date): Date {
  return typeof value === "string" ? parseISO(value) : value;
}

export function EventCalendar({
  events,
  onSelectEvent,
  initialView = "month",
  dir = "ltr",
  locale = "en",
  className,
}: EventCalendarProps): JSX.Element {
  const [view, setView] = useState<"month" | "agenda">(initialView);
  const [cursor, setCursor] = useState<Date>(() => {
    const first = events[0];
    return first ? startOfMonth(toDate(first.date)) : startOfMonth(new Date());
  });

  const t = T[locale];
  const dfLocale = locale === "ar" ? arLocale : enLocale;
  const isRtl = dir === "rtl";

  // Normalise events once: parse dates, default severity, drop invalid.
  const normalized = useMemo(() => {
    return events
      .map((e) => {
        const d = toDate(e.date);
        return Number.isNaN(d.getTime())
          ? null
          : { ...e, _date: d, severity: e.severity ?? "info" };
      })
      .filter((e): e is CalendarEvent & { _date: Date; severity: EventSeverity } => e !== null);
  }, [events]);

  // Month grid: full weeks covering the visible month.
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, (CalendarEvent & { _date: Date; severity: EventSeverity })[]>();
    for (const e of normalized) {
      const key = format(e._date, "yyyy-MM-dd");
      const bucket = map.get(key);
      if (bucket) bucket.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [normalized]);

  // Agenda groups: ascending by date.
  const agendaGroups = useMemo(() => {
    const map = new Map<string, (CalendarEvent & { _date: Date; severity: EventSeverity })[]>();
    for (const e of [...normalized].sort((a, b) => a._date.getTime() - b._date.getTime())) {
      const key = format(e._date, "yyyy-MM-dd");
      const bucket = map.get(key);
      if (bucket) bucket.push(e);
      else map.set(key, [e]);
    }
    return Array.from(map.entries());
  }, [normalized]);

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div dir={dir} className={cn("flex flex-col gap-3", className)}>
      {/* Header: title + nav + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t.prev}
            onClick={() => setCursor((c) => addMonths(c, -1))}
          >
            <PrevIcon className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-semibold capitalize">
            {format(cursor, "MMMM yyyy", { locale: dfLocale })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t.next}
            onClick={() => setCursor((c) => addMonths(c, 1))}
          >
            <NextIcon className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-0.5">
          <Button
            type="button"
            variant={view === "month" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            aria-pressed={view === "month"}
            onClick={() => setView("month")}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {t.month}
          </Button>
          <Button
            type="button"
            variant={view === "agenda" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            aria-pressed={view === "agenda"}
            onClick={() => setView("agenda")}
          >
            <List className="h-3.5 w-3.5" aria-hidden />
            {t.agenda}
          </Button>
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid
          days={monthDays}
          cursor={cursor}
          eventsByDay={eventsByDay}
          weekdays={t.weekdays}
          moreLabel={t.more}
          onSelectEvent={onSelectEvent}
          isRtl={isRtl}
        />
      ) : (
        <AgendaList
          groups={agendaGroups}
          emptyLabel={t.noEvents}
          dfLocale={dfLocale}
          onSelectEvent={onSelectEvent}
        />
      )}
    </div>
  );
}

type DayEvent = CalendarEvent & { _date: Date; severity: EventSeverity };

function MonthGrid({
  days,
  cursor,
  eventsByDay,
  weekdays,
  moreLabel,
  onSelectEvent,
  isRtl,
}: {
  days: Date[];
  cursor: Date;
  eventsByDay: Map<string, DayEvent[]>;
  weekdays: readonly string[];
  moreLabel: (n: number) => string;
  onSelectEvent?: (id: string) => void;
  isRtl: boolean;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
        {weekdays.map((w) => (
          <div
            key={w}
            className="px-2 py-1.5 text-center text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const outside = !isSameMonth(day, cursor);
          const visible = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - visible.length;
          return (
            <div
              key={key}
              className={cn(
                "min-h-[5.5rem] border-b border-border/60 p-1.5",
                isRtl ? "border-l" : "border-r",
                "[&:nth-child(7n)]:border-x-0",
                outside && "bg-muted/20",
              )}
            >
              <div className="mb-1 flex justify-end">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs",
                    outside ? "text-muted-foreground/50" : "text-foreground/70",
                    isToday(day) && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {visible.map((e) => (
                  <EventPill key={e.id} event={e} onSelectEvent={onSelectEvent} />
                ))}
                {overflow > 0 && (
                  <span className="px-1 text-[0.7rem] text-muted-foreground">
                    {moreLabel(overflow)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventPill({
  event,
  onSelectEvent,
}: {
  event: DayEvent;
  onSelectEvent?: (id: string) => void;
}): JSX.Element {
  const inner = (
    <>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", severityDot[event.severity])} aria-hidden />
      <span className="truncate">{event.title}</span>
    </>
  );
  const base =
    "flex w-full items-center gap-1 rounded px-1 py-0.5 text-start text-[0.72rem] leading-tight transition-colors hover:bg-accent/70";

  if (event.href) {
    return (
      <Link href={event.href} className={base} title={event.title}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={base}
      title={event.title}
      onClick={() => onSelectEvent?.(event.id)}
    >
      {inner}
    </button>
  );
}

function AgendaList({
  groups,
  emptyLabel,
  dfLocale,
  onSelectEvent,
}: {
  groups: [string, DayEvent[]][];
  emptyLabel: string;
  dfLocale: Locale;
  onSelectEvent?: (id: string) => void;
}): JSX.Element {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([key, items]) => {
        const date = items[0]._date;
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold capitalize">
                {format(date, "EEEE, MMM d", { locale: dfLocale })}
              </span>
              {isToday(date) && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-overline font-medium text-primary">
                  {format(date, "yyyy", { locale: dfLocale })}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {items.map((e) => (
                <AgendaRow key={e.id} event={e} onSelectEvent={onSelectEvent} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaRow({
  event,
  onSelectEvent,
}: {
  event: DayEvent;
  onSelectEvent?: (id: string) => void;
}): JSX.Element {
  const inner = (
    <>
      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", severityDot[event.severity])} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{event.title}</span>
        {event.meta && (
          <span className="truncate text-xs text-muted-foreground">{event.meta}</span>
        )}
      </span>
      {event.kind && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium capitalize",
            severityPill[event.severity],
          )}
        >
          {event.kind}
        </span>
      )}
    </>
  );
  const base =
    "flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-start transition-colors hover:border-primary/20 hover:bg-primary/5";

  if (event.href) {
    return (
      <Link href={event.href} className={base}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cn(base, "w-full")}
      onClick={() => onSelectEvent?.(event.id)}
    >
      {inner}
    </button>
  );
}
