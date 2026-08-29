'use client';

/**
 * Dashboard Calendar panel — LEX-LD-GAP-DESIGN G5.
 *
 * The client's note on the mockup reads "add the old calendar view", so this
 * EMBEDS the Unified Legal Calendar rather than introducing a second one: the
 * event stream, its cross-source normalization and all of its calendar-specific
 * copy come from `lex/calendar`. Only the arrangement is new, and it is an
 * agenda rather than a month grid because the dashboard slot is a wide, short
 * band that a 6x7 grid degrades badly into.
 *
 * PURE PRESENTATION. Events arrive already normalized and locale-resolved by
 * `calendar-events.ts`; this file performs no data access of its own and never
 * re-derives an event from its source record. `now` is injected for the same
 * reason the calendar's own normalizers inject it — so relative-time copy and
 * today-marking stay deterministic for a whole mount.
 *
 * Copy ownership follows the `legal-director-i18n.ts` header contract: the
 * panel title and every calendar-specific label come from the already-registered
 * `lex.calendar` catalogue, while the neutral dashboard-shell states come from
 * `states.calendar` in the Legal Director catalogue.
 */

import * as React from 'react';
import Link from 'next/link';
import { format as formatDayKey, isSameDay } from 'date-fns';

import { isKsaHoliday, shapeDigits, useLexFormat } from '@/lib/lex/ksa';

import { useLegalDirectorDashboardLabels } from '../../../_lib/role-dashboards/legal-director-i18n';
import type { LegalCalendarEvent } from '../../../calendar/_lib/calendar-events';
import { useCalendarLabels } from '../../../calendar/_lib/calendar-i18n';
import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelActionLink } from './panel-action-link';
import { PanelShell } from './panel-shell';
import styles from './dashboard-calendar-panel.module.css';

export interface DashboardCalendarPanelProps {
  /**
   * Already-normalized calendar events. The order is irrelevant — the band
   * always presents them upcoming-first — but their contents are never altered.
   */
  events: LegalCalendarEvent[];
  /**
   * Maximum number of events the band renders. Anything beyond it is disclosed
   * as an overflow count rather than silently dropped. A limit of zero renders
   * the empty state.
   */
  limit?: number;
  /**
   * The caller's stable "now". Defaults to the current instant, matching the
   * single-`now`-per-mount convention the calendar orchestrator already uses.
   */
  now?: Date;
}

export interface DashboardCalendarPanelErrorProps {
  onRetry: () => void;
}

/** Events sharing one calendar day, in the order they were handed over. */
interface AgendaDay {
  key: string;
  date: Date;
  events: LegalCalendarEvent[];
}

interface AgendaBand {
  days: AgendaDay[];
  /** Dated events the limit excluded; surfaced to the reader, never hidden. */
  overflow: number;
}

const DEFAULT_EVENT_LIMIT = 6;

/**
 * Compact dual-calendar day header. The full calendar spells the year out; a
 * dashboard band only ever spans the near horizon, so the year is dropped and
 * the Hijri equivalent stays alongside it.
 */
const AGENDA_DATE_OPTIONS = { day: 'numeric', month: 'short' } as const;

/**
 * Sort upcoming-first, cap, then group by day. Overdue items sort to the top
 * for free, which is the behavior the full agenda already has. Unparseable
 * dates are dropped rather than rendered as an invalid day.
 */
function buildAgendaBand(events: LegalCalendarEvent[], limit: number): AgendaBand {
  const dated = events
    .map((event) => ({ event, date: new Date(event.date) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.date.getTime() - right.date.getTime());

  const cap = Number.isFinite(limit) ? Math.max(Math.trunc(limit), 0) : DEFAULT_EVENT_LIMIT;
  const shown = dated.slice(0, cap);
  const days = new Map<string, AgendaDay>();

  for (const { event, date } of shown) {
    const key = formatDayKey(date, 'yyyy-MM-dd');
    const day = days.get(key);
    if (day) {
      day.events.push(event);
    } else {
      days.set(key, { key, date, events: [event] });
    }
  }

  return { days: Array.from(days.values()), overflow: dated.length - shown.length };
}

/**
 * Ready panel. An events array that yields no dated rows is an explicit empty
 * state; a single event is ready data.
 */
export function DashboardCalendarPanel({
  events,
  limit = DEFAULT_EVENT_LIMIT,
  now,
}: DashboardCalendarPanelProps) {
  const labels = useLegalDirectorDashboardLabels();
  const calendar = useCalendarLabels();
  const formatter = useLexFormat();
  const baseId = React.useId();
  const reference = React.useMemo(() => now ?? new Date(), [now]);
  const band = React.useMemo(() => buildAgendaBand(events, limit), [events, limit]);

  if (band.days.length === 0) {
    return (
      <PanelShell
        title={calendar.title}
        className={styles.panel}
        action={<PanelActionLink href="/lex/calendar" label={labels.actions.viewAll} />}
      >
        <DashboardPrimitiveState state="empty" title={labels.states.calendar.empty} />
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title={calendar.title}
      className={styles.panel}
      action={<PanelActionLink href="/lex/calendar" label={labels.actions.viewAll} />}
    >
      <div dir={formatter.direction} data-dashboard-calendar-panel="">
        <ol className={styles.agenda} aria-label={calendar.title}>
          {band.days.map((day) => {
            const holiday = isKsaHoliday(day.date);
            const headerId = `${baseId}-${day.key}`;

            return (
              <li className={styles.day} key={day.key} data-agenda-day={day.key}>
                <p className={styles.dayHeader} id={headerId}>
                  <span className={styles.dayDate} dir="auto">
                    {formatter.formatDual(day.date, { dateOptions: AGENDA_DATE_OPTIONS })}
                  </span>
                  {isSameDay(day.date, reference) ? (
                    <span
                      className={`${styles.dayFlag} ${styles.today}`}
                      data-day-flag="today"
                    >
                      {calendar.agenda.today}
                    </span>
                  ) : null}
                  {holiday ? (
                    <span
                      className={`${styles.dayFlag} ${styles.holiday}`}
                      data-day-flag="holiday"
                      dir="auto"
                    >
                      {holiday.name[formatter.locale]}
                    </span>
                  ) : null}
                </p>

                <ul className={styles.events} aria-labelledby={headerId}>
                  {day.events.map((event) => (
                    <li className={styles.eventItem} key={event.id}>
                      <Link
                        href={event.href}
                        className={styles.event}
                        data-agenda-event={event.id}
                        data-severity={event.severity}
                        data-event-type={event.type}
                      >
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.body}>
                          <span className={styles.title} dir="auto">
                            {event.title}
                          </span>
                          {event.meta ? (
                            <span className={styles.meta} dir="auto">
                              {event.meta}
                            </span>
                          ) : null}
                        </span>
                        <span className={styles.trail}>
                          <span className={styles.typePill}>{calendar.type[event.type]}</span>
                          <span className={styles.time}>
                            {formatter.formatRelative(event.date, reference)}
                          </span>
                        </span>
                        {/* Severity is never carried by the rail colour alone. */}
                        <span className="sr-only">{calendar.severity[event.severity]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>

        {band.overflow > 0 ? (
          <Link
            href="/lex/calendar"
            className={styles.overflow}
            dir="auto"
            data-dashboard-calendar-overflow=""
          >
            {/*
             * `calendar.more` interpolates a raw count, so the already-built
             * string is re-shaped rather than re-formatted — Arabic still gets
             * Arabic-Indic digits without forking the calendar's own copy.
             */}
            {shapeDigits(calendar.more(band.overflow), formatter.locale)}
          </Link>
        ) : null}
      </div>
    </PanelShell>
  );
}

/** Loading companion kept outside the exact ready-panel data contract. */
export function DashboardCalendarPanelLoading() {
  const labels = useLegalDirectorDashboardLabels();
  const calendar = useCalendarLabels();

  return (
    <PanelShell title={calendar.title} className={styles.panel}>
      <DashboardPrimitiveState state="loading" label={labels.states.calendar.loading} />
    </PanelShell>
  );
}

/** Retryable error companion kept outside the exact ready-panel data contract. */
export function DashboardCalendarPanelError({ onRetry }: DashboardCalendarPanelErrorProps) {
  const labels = useLegalDirectorDashboardLabels();
  const calendar = useCalendarLabels();

  return (
    <PanelShell title={calendar.title} className={styles.panel}>
      <DashboardPrimitiveState
        state="error"
        title={labels.states.calendar.error}
        retryLabel={labels.actions.retry}
        onRetry={onRetry}
      />
    </PanelShell>
  );
}
