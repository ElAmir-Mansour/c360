'use client';

/**
 * <LexActivityTimeline> — human-readable audit storytelling for Lex.
 *
 * Turns a raw stream of audit events into a readable narrative: a vertical
 * timeline grouped by day (Today / Yesterday / localized date), with actor
 * avatars, a tone-colored connector rail, a humanized "<actor> <action>
 * <target>" line and a localized relative timestamp. Tones drive the dot + rail
 * color so a glance conveys good / warning / danger flow.
 *
 * This is the storytelling sibling of the settlements `SettlementAuditFeed`: it
 * follows the same icon-rail + actor-attribution language but is domain-agnostic
 * (any Lex domain feeds it pre-shaped `events`).
 *
 * Bilingual + RTL safe: day headers and relative time come from the shared
 * `useLexFormat()` (Hijri + Arabic-Indic digits in Arabic mode); the rail sits
 * on the inline-start edge so it mirrors correctly under RTL; directional
 * affordances use logical properties.
 */

import * as React from 'react';
import { useMemo } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  CircleDot,
  Clock,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getAvatarColor, getInitials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';

/* ------------------------------------------------------------------------- *
 * Event shape + tone taxonomy.
 * ------------------------------------------------------------------------- */

export type LexActivityTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface LexActivityEvent {
  id: string;
  actor: { name: string; avatar?: string };
  /** Verb phrase, already localized by the caller (e.g. "approved"). */
  action: string;
  /** Optional object of the action (e.g. case title / settlement ref). */
  target?: string;
  /** ISO timestamp. */
  at: string;
  /** Semantic tone for the dot + connector. Defaults to `neutral`. */
  tone?: LexActivityTone;
  /** Optional extra detail line (already localized). */
  detail?: string;
}

export interface LexActivityTimelineProps {
  events: LexActivityEvent[];
  /** Force a direction; otherwise inherits from the locale provider. */
  dir?: 'ltr' | 'rtl';
  /** Heading copy for the empty state (localized by caller). */
  emptyLabel?: string;
  className?: string;
}

/* Tone → dot chrome + rail color + fallback icon. Token-driven so it re-themes
 * in dark mode and matches the rest of the design system. */
const TONE_STYLE: Record<
  LexActivityTone,
  { dot: string; rail: string; icon: LucideIcon }
> = {
  neutral: {
    dot: 'bg-muted text-muted-foreground border-border',
    rail: 'bg-border',
    icon: CircleDot,
  },
  info: {
    dot: 'bg-info-50 text-info-700 border-info-300/60 dark:bg-info-700/15 dark:text-info-300',
    rail: 'bg-info-300/60 dark:bg-info-700/50',
    icon: Info,
  },
  success: {
    dot: 'bg-primary/10 text-primary border-primary/25',
    rail: 'bg-primary/40',
    icon: CheckCircle2,
  },
  warning: {
    dot: 'bg-warning-50 text-warning-700 border-warning-300/60 dark:bg-warning-700/15 dark:text-warning-300',
    rail: 'bg-warning-300/60 dark:bg-warning-700/50',
    icon: Clock,
  },
  danger: {
    dot: 'bg-error-50 text-error-700 border-error-300/60 dark:bg-error-700/15 dark:text-error-300',
    rail: 'bg-error-300/60 dark:bg-error-700/50',
    icon: AlertOctagon,
  },
};

/* ------------------------------------------------------------------------- *
 * Day grouping.
 * ------------------------------------------------------------------------- */

interface DayGroup {
  key: string;
  /** Resolved, localized header label (Today / Yesterday / date). */
  header: string;
  events: LexActivityEvent[];
}

/** Local-date key (YYYY-MM-DD) for grouping; tolerant of bad input. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/* ------------------------------------------------------------------------- *
 * Built-in EN/AR day labels (Today / Yesterday). Dates themselves come from
 * useLexFormat so Arabic mode renders Hijri + Arabic-Indic digits.
 * ------------------------------------------------------------------------- */

const DAY_LABELS = {
  en: { today: 'Today', yesterday: 'Yesterday', empty: 'No activity yet' },
  ar: { today: 'اليوم', yesterday: 'الأمس', empty: 'لا يوجد نشاط بعد' },
} as const;

export function LexActivityTimeline({
  events,
  dir,
  emptyLabel,
  className,
}: LexActivityTimelineProps) {
  const f = useLexFormat();
  const resolvedDir = dir ?? f.direction;
  const L = DAY_LABELS[f.locale === 'ar' ? 'ar' : 'en'];

  const groups = useMemo<DayGroup[]>(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );

    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = todayStart - 86_400_000;

    const map = new Map<string, LexActivityEvent[]>();
    for (const e of sorted) {
      const k = dayKey(e.at);
      const bucket = map.get(k);
      if (bucket) bucket.push(e);
      else map.set(k, [e]);
    }

    return [...map.entries()].map(([key, evs]) => {
      const sample = new Date(evs[0].at);
      const sampleStart = Number.isNaN(sample.getTime())
        ? NaN
        : startOfDay(sample);
      let header: string;
      if (sampleStart === todayStart) header = L.today;
      else if (sampleStart === yesterdayStart) header = L.yesterday;
      else if (Number.isNaN(sampleStart)) header = '—';
      else header = f.formatDate(sample);
      return { key, header, events: evs };
    });
  }, [events, f, L]);

  if (events.length === 0) {
    return (
      <div
        dir={resolvedDir}
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-10 text-center"
      >
        <CircleDot className="h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{emptyLabel ?? L.empty}</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div dir={resolvedDir} className={cn('space-y-6', className)}>
        {groups.map((group) => (
          <section key={group.key} aria-label={group.header}>
            <h3 className="mb-3 flex items-center gap-2 text-overline font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border/60" aria-hidden />
              <span className="shrink-0">{group.header}</span>
              <span className="h-px flex-1 bg-border/60" aria-hidden />
            </h3>
            <ol className="space-y-0">
              {group.events.map((event, idx) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  isLast={idx === group.events.length - 1}
                  formatRelative={f.formatRelative}
                  formatDate={f.formatDate}
                  index={idx}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------------- *
 * Row.
 * ------------------------------------------------------------------------- */

interface ActivityRowProps {
  event: LexActivityEvent;
  isLast: boolean;
  formatRelative: (date: Date | string) => string;
  formatDate: LexFormatter['formatDate'];
  index: number;
}

function ActivityRow({ event, isLast, formatRelative, formatDate, index }: ActivityRowProps) {
  const style = TONE_STYLE[event.tone ?? 'neutral'];
  const Icon = style.icon;

  const initials = getInitials(...splitName(event.actor.name));
  const colorClass = getAvatarColor(event.actor.name);
  const absolute = safeAbsolute(event.at, formatDate);

  return (
    <li
      className={cn(
        'relative flex gap-3 pb-5 last:pb-0',
        'motion-safe:animate-fade-up',
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      {/* Rail + dot */}
      <div className="relative flex flex-col items-center">
        <span
          className={cn(
            'z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
            style.dot,
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        {!isLast ? (
          <span
            className={cn('mt-1 w-px flex-1', style.rail)}
            aria-hidden
          />
        ) : null}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="min-w-0 text-sm leading-snug text-foreground" dir="auto">
            <span className="font-semibold">{event.actor.name}</span>{' '}
            <span className="text-muted-foreground">{event.action}</span>
            {event.target ? (
              <>
                {' '}
                <span className="font-medium text-foreground">{event.target}</span>
              </>
            ) : null}
          </p>
        </div>

        {event.detail ? (
          <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
            {event.detail}
          </p>
        ) : null}

        <div className="mt-1 flex items-center gap-2">
          <Avatar className="h-5 w-5 text-[10px]">
            {event.actor.avatar ? (
              <AvatarImage src={event.actor.avatar} alt={event.actor.name} />
            ) : null}
            <AvatarFallback className={cn(colorClass, 'font-medium text-white')}>
              {initials}
            </AvatarFallback>
          </Avatar>
          {absolute ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <time
                  dateTime={event.at}
                  className="cursor-default text-xs text-muted-foreground"
                >
                  {formatRelative(event.at)}
                </time>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{absolute}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">
              {formatRelative(event.at)}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------- *
 * Helpers.
 * ------------------------------------------------------------------------- */

/** Split a display name into [first, last] for initials. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return [parts[0] ?? '', parts.length > 1 ? parts[parts.length - 1] : ''];
}

/**
 * Best-effort absolute timestamp for the tooltip; null when unparseable.
 *
 * Routes through the locale-bound `formatDate` (from `useLexFormat`) so the
 * tooltip renders Arabic-Indic digits + the active locale in Arabic mode rather
 * than the host-default Western digits.
 */
function safeAbsolute(
  iso: string,
  formatDate: LexFormatter['formatDate'],
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const formatted = formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  return formatted || d.toISOString();
}
