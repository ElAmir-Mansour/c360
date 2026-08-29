'use client';

/**
 * Visual timeline track (case-timeline feature #1).
 *
 * A self-contained, horizontal time-axis visualisation of a single matter's
 * lifecycle. It plots — as percentage offsets along one base bar — the matter's
 * `opened_at` (start), the latest meaningful horizon (estimated completion / due
 * date / today / the latest delay window end), and overlays:
 *   - a "today" marker line,
 *   - point markers for Opened / Estimated completion / Due (whichever exist),
 *   - per-category delay windows (opened → resolved|now), open delays rendered
 *     visually distinct (lighter + striped) from resolved ones,
 *   - the external-hold band (external_hold_since → now) when on hold.
 *
 * It owns NO data and no callbacks: everything derives from the `timeline` prop
 * (including `timeline.delay_events`, which `getTimeline` hydrates). Colours come
 * from the shared `StatTone` palette via `delayCategoryMeta` so a category looks
 * identical here, in event badges, and in the by-category breakdown (#3).
 *
 * RTL: the panel root sets `dir`. Positions are computed as a logical
 * `inset-inline-start` percentage (start = `opened_at`), so the track reads
 * correctly start→end in BOTH LTR and RTL without manual mirroring — the
 * browser's logical-property resolution flips `inset-inline-start` to the right
 * edge under `dir="rtl"`. Widths are direction-agnostic percentages.
 */

import { useMemo } from 'react';
import { CalendarClock, CalendarDays, Flag } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { CHART_COLORS, SEVERITY_COLORS } from '@/lib/design-tokens';
import type { StatTone } from '@/components/shared/stat-card';
import { delayCategoryMeta } from './delay-category-meta';
import { delayCategoryLabel, useSettlementLabels } from './labels';
import type { MatterTimeline } from '@/lib/lex/settlements';

/**
 * Map a shared `StatTone` to a concrete accent colour. These mirror the
 * `--kpi-accent` values the matching `.kpi-theme-*` classes set in globals.css,
 * so a category's track segment matches its stat-card / badge accent exactly.
 */
const TONE_COLOR: Record<StatTone, string> = {
  neutral: 'hsl(var(--muted-foreground))',
  emerald: SEVERITY_COLORS.low,
  gold: SEVERITY_COLORS.medium,
  sky: SEVERITY_COLORS.info,
  rose: SEVERITY_COLORS.critical,
  slate: CHART_COLORS[0],
  teal: CHART_COLORS[0],
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse an ISO string to epoch ms; returns NaN-safe `null` on bad/empty input. */
function toMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Clamp a 0..100 percentage so a stray value never escapes the track. */
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

interface TrackMarker {
  key: string;
  pct: number;
  label: string;
  dateLabel: string;
  icon: typeof Flag;
  color: string;
}

interface TrackSegment {
  key: string;
  category: string;
  startPct: number;
  widthPct: number;
  color: string;
  open: boolean;
  title: string;
}

export interface TimelineTrackProps {
  timeline: MatterTimeline;
  selectedCategory?: string | null;
}

export function TimelineTrack({ timeline, selectedCategory = null }: TimelineTrackProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.track;

  const model = useMemo(() => {
    const now = Date.now();
    const start = toMs(timeline.opened_at);

    // Without a start anchor there is nothing meaningful to plot.
    if (start === null) {
      return null;
    }

    const estimated = toMs(timeline.estimated_completion_date);
    const due = toMs(timeline.due_date);
    const holdSince = toMs(timeline.external_hold_since);
    const events = timeline.delay_events ?? [];

    // End horizon = the latest of {estimate, due, today, latest delay end}. If
    // none of the optional anchors exist we fall back to a sensible default
    // horizon (start + estimated_duration_days, else 30 days) so the bar always
    // has a non-zero span and we never divide by zero.
    const candidates: number[] = [now];
    if (estimated !== null) candidates.push(estimated);
    if (due !== null) candidates.push(due);
    for (const ev of events) {
      const evEnd = ev.resolved ? toMs(ev.resolved_at) ?? now : now;
      candidates.push(evEnd);
    }
    const fallbackHorizon =
      start +
      (timeline.estimated_duration_days != null
        ? timeline.estimated_duration_days * DAY_MS
        : 30 * DAY_MS);
    candidates.push(fallbackHorizon);

    let end = Math.max(...candidates);
    // Guarantee a strictly positive span even in degenerate cases.
    if (end <= start) {
      end = start + DAY_MS;
    }
    const span = end - start;
    const pctOf = (ms: number) => clampPct(((ms - start) / span) * 100);

    const markers: TrackMarker[] = [
      {
        key: 'opened',
        pct: pctOf(start),
        label: labels.opened,
        dateLabel: formatDateTime(timeline.opened_at),
        icon: Flag,
        color: TONE_COLOR.slate,
      },
    ];
    if (estimated !== null) {
      markers.push({
        key: 'estimated',
        pct: pctOf(estimated),
        label: labels.estimatedCompletion,
        dateLabel: formatDateTime(timeline.estimated_completion_date as string),
        icon: CalendarClock,
        color: TONE_COLOR.emerald,
      });
    }
    if (due !== null) {
      markers.push({
        key: 'due',
        pct: pctOf(due),
        label: labels.due,
        dateLabel: formatDateTime(timeline.due_date as string),
        icon: CalendarDays,
        color: TONE_COLOR.rose,
      });
    }

    const segments: TrackSegment[] = [];
    for (const ev of events) {
      const evStart = toMs(ev.opened_at);
      if (evStart === null) continue;
      const evEnd = ev.resolved ? toMs(ev.resolved_at) ?? now : now;
      const s = pctOf(evStart);
      const e = pctOf(Math.max(evEnd, evStart));
      const meta = delayCategoryMeta(ev.category);
      segments.push({
        key: ev.id,
        category: ev.category,
        startPct: s,
        widthPct: Math.max(e - s, 0.6), // keep sub-day windows visible
        color: TONE_COLOR[meta.tone],
        open: !ev.resolved,
        title: `${delayCategoryLabel(L, ev.category)} · ${
          ev.resolved ? L.timeline.resolved : L.timeline.open
        } · ${formatDateTime(ev.opened_at)}${
          ev.resolved && ev.resolved_at ? ` → ${formatDateTime(ev.resolved_at)}` : ''
        }`,
      });
    }

    // External-hold band (since → now), only when currently on hold.
    let holdBand: { startPct: number; widthPct: number; title: string } | null = null;
    if (timeline.external_hold && holdSince !== null) {
      const s = pctOf(holdSince);
      const e = pctOf(now);
      holdBand = {
        startPct: s,
        widthPct: Math.max(e - s, 0.6),
        title: `${labels.externalHold} · ${formatDateTime(timeline.external_hold_since as string)}`,
      };
    }

    const todayPct = pctOf(now);

    return {
      startLabel: formatDateTime(timeline.opened_at),
      endLabel: formatDateTime(new Date(end).toISOString()),
      markers,
      segments,
      holdBand,
      todayPct,
    };
  }, [timeline, labels, L]);

  if (!model) {
    return null;
  }

  const ariaLabel = `${labels.title}: ${model.startLabel} → ${model.endLabel}`;

  return (
    <section aria-label={ariaLabel} className="space-y-3">
      <p className="text-sm font-medium text-foreground">{labels.title}</p>

      {/* The track itself. min-height accommodates overlaid bands + the today line. */}
      <div className="relative">
        <div
          role="img"
          aria-label={ariaLabel}
          className="relative h-9 w-full rounded-full bg-muted/60"
        >
          {/* External-hold band (under delay segments). */}
          {model.holdBand ? (
            <div
              className="absolute inset-y-1.5 rounded-md border border-destructive/40 bg-destructive/15"
              style={{
                insetInlineStart: `${model.holdBand.startPct}%`,
                width: `${model.holdBand.widthPct}%`,
              }}
              title={model.holdBand.title}
              aria-hidden
            />
          ) : null}

          {/* Delay windows, coloured by category tone. Open delays are lighter
              and striped; resolved delays are solid. */}
          {model.segments
            .filter((seg) => !selectedCategory || (seg.category === selectedCategory && seg.open))
            .map((seg) => (
              <div
                key={seg.key}
                className="absolute inset-y-2 rounded"
                style={{
                  insetInlineStart: `${seg.startPct}%`,
                  width: `${seg.widthPct}%`,
                  backgroundColor: seg.open ? `${seg.color}40` : seg.color,
                  border: `1px solid ${seg.color}`,
                  backgroundImage: seg.open
                    ? `repeating-linear-gradient(45deg, ${seg.color}55 0, ${seg.color}55 3px, transparent 3px, transparent 7px)`
                    : undefined,
                }}
                title={seg.title}
                aria-hidden
              />
            ))}

          {/* Today marker line. */}
          <div
            className="absolute inset-y-0 z-10 w-px bg-foreground/70"
            style={{ insetInlineStart: `${model.todayPct}%` }}
            title={labels.today}
            aria-hidden
          />
          <span
            className="absolute z-10 -translate-x-1/2 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium leading-none text-background rtl:translate-x-1/2"
            style={{ insetInlineStart: `${model.todayPct}%`, top: '-1.25rem' }}
            aria-hidden
          >
            {labels.today}
          </span>
        </div>

        {/* Point markers (Opened / Estimated / Due) under the track. */}
        <div className="relative mt-7 h-px">
          {model.markers.map((m) => (
            <div
              key={m.key}
              className="absolute flex max-w-[40%] -translate-x-1/2 flex-col items-center gap-0.5 text-center rtl:translate-x-1/2"
              style={{ insetInlineStart: `${m.pct}%` }}
            >
              <m.icon className="h-3.5 w-3.5" style={{ color: m.color }} aria-hidden />
              <span className="whitespace-nowrap text-[11px] font-medium text-foreground">
                {m.label}
              </span>
              <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                {m.dateLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
