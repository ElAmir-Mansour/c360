'use client';

/**
 * Timeline overview block (part of the case-timeline panel split).
 *
 * Presentational: renders the "Case timeline" SectionCard — four DetailStatCards
 * (estimated duration / completion, open delay days, external-hold chip), a
 * projected-vs-actual completion indicator (#4), a visual timeline track (#1),
 * an open-delay by-category breakdown (#3), the external-hold detail banner, and
 * the "Set estimate" / "External hold" action buttons. It owns NO data: the
 * parent shell passes the resolved `timeline` (incl. `delay_events`) and the two
 * callbacks that open the (shell-owned) dialogs. Action buttons only render when
 * `canWrite` is true.
 */

import { useState } from 'react';
import { CalendarClock, Clock, Hand, Pause, PlayCircle, Timer } from 'lucide-react';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { delayCategoryLabel, useSettlementLabels } from './labels';
import { TimelineTrack } from './timeline-track';
import { DelayBreakdown } from './delay-breakdown';
import type { MatterTimeline } from '@/lib/lex/settlements';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A risk band drives both the badge tone and which projection label we show. */
type ProjectionStatus = 'on_track' | 'at_risk' | 'overdue';

/**
 * Derive a projected completion + an at-a-glance risk status from a timeline.
 *
 * Projected completion = the planned completion (estimated_completion_date, else
 * opened_at + estimated_duration_days) pushed out by `open_delay_days`. When no
 * estimate exists we fall back to the due date so a status can still be derived.
 *
 * Thresholds (documented):
 *   - Overdue : a due_date exists AND either (a) the projected completion lands
 *               strictly after it, or (b) the due_date is already in the past.
 *   - At risk : open_delay_days > 0, OR the matter is on external hold, OR the
 *               projected completion lands within a 7-day cushion of the due_date
 *               (i.e. projected >= due_date - 7 days). The cushion flags matters
 *               that are tracking to finish right up against (or just before) the
 *               deadline with no slack.
 *   - On track: none of the above.
 */
function deriveProjection(timeline: MatterTimeline): {
  status: ProjectionStatus;
  projectedMs: number | null;
} {
  const now = Date.now();
  const openDelayMs = Math.max(0, timeline.open_delay_days) * DAY_MS;

  const opened = Date.parse(timeline.opened_at);
  const estimatedCompletion = timeline.estimated_completion_date ? Date.parse(timeline.estimated_completion_date) : NaN;
  const dueMs = timeline.due_date ? Date.parse(timeline.due_date) : NaN;

  // Planned completion before accounting for accrued delay.
  let plannedMs = NaN;
  if (!Number.isNaN(estimatedCompletion)) {
    plannedMs = estimatedCompletion;
  } else if (!Number.isNaN(opened) && timeline.estimated_duration_days != null) {
    plannedMs = opened + timeline.estimated_duration_days * DAY_MS;
  } else if (!Number.isNaN(dueMs)) {
    plannedMs = dueMs;
  }

  const projectedMs = Number.isNaN(plannedMs) ? null : plannedMs + openDelayMs;
  const hasDue = !Number.isNaN(dueMs);

  // Overdue: due date already passed, or projection lands past the due date.
  if (hasDue && (dueMs < now || (projectedMs !== null && projectedMs > dueMs))) {
    return { status: 'overdue', projectedMs };
  }

  // At risk: accrued delay, external hold, or projected within 7d cushion of due.
  const cushionMs = 7 * DAY_MS;
  const nearDue = hasDue && projectedMs !== null && projectedMs >= dueMs - cushionMs;
  if (timeline.open_delay_days > 0 || timeline.external_hold || nearDue) {
    return { status: 'at_risk', projectedMs };
  }

  return { status: 'on_track', projectedMs };
}

const PROJECTION_TONE: Record<ProjectionStatus, StatTone> = {
  on_track: 'emerald',
  at_risk: 'gold', // palette has no `amber`; `gold` is the amber-flavoured tone
  overdue: 'rose',
};

const PROJECTION_BADGE_CLASS: Record<ProjectionStatus, string> = {
  on_track:
    'border-success-300 bg-success-50 text-success-700 dark:border-success-500/40 dark:bg-success-500/10 dark:text-success-300',
  at_risk:
    'border-warning-300 bg-warning-50 text-warning-700 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300',
  overdue: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
};

export interface TimelineOverviewProps {
  timeline: MatterTimeline;
  canWrite: boolean;
  /** Open the "set estimated duration" dialog (owned by the shell). */
  onSetEstimate: () => void;
  /** Open the "external hold" dialog (owned by the shell). */
  onToggleHold: () => void;
}

export function TimelineOverview({ timeline, canWrite, onSetEstimate, onToggleHold }: TimelineOverviewProps) {
  const L = useSettlementLabels();
  const labels = L.timeline;
  const [delayCategory, setDelayCategory] = useState<string | null>(null);

  const projection = deriveProjection(timeline);
  const projectionLabel =
    projection.status === 'overdue'
      ? labels.projection.overdue
      : projection.status === 'at_risk'
        ? labels.projection.atRisk
        : labels.projection.onTrack;

  return (
    <SectionCard
      title={labels.title}
      description={labels.description}
      actions={
        canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onSetEstimate}>
              <Timer className="me-1.5 h-3.5 w-3.5" />
              {labels.setEstimate}
            </Button>
            <Button size="sm" variant="outline" onClick={onToggleHold}>
              {timeline.external_hold ? (
                <PlayCircle className="me-1.5 h-3.5 w-3.5" />
              ) : (
                <Pause className="me-1.5 h-3.5 w-3.5" />
              )}
              {labels.toggleHold}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailStatCard
          label={labels.estimatedDuration}
          value={
            timeline.estimated_duration_days != null
              ? labels.days(timeline.estimated_duration_days)
              : labels.notEstimated
          }
          tone="teal"
          icon={Clock}
          href="#settlement-timeline-details"
        />
        <DetailStatCard
          label={labels.estimatedCompletion}
          value={
            timeline.estimated_completion_date
              ? formatDateTime(timeline.estimated_completion_date)
              : labels.notEstimated
          }
          tone="slate"
          icon={CalendarClock}
          badge={
            <Badge variant="outline" className={cn('whitespace-nowrap', PROJECTION_BADGE_CLASS[projection.status])}>
              {projectionLabel}
            </Badge>
          }
          href="#settlement-timeline-details"
        />
        <DetailStatCard
          label={labels.openDelayDays}
          value={String(timeline.open_delay_days)}
          tone={timeline.open_delay_days > 0 ? 'rose' : 'emerald'}
          icon={Hand}
          href="#settlement-timeline-details"
        />
        <DetailStatCard
          label={labels.externalHold}
          value={
            <Badge variant={timeline.external_hold ? 'destructive' : 'outline'}>
              {timeline.external_hold ? labels.onHold : labels.notOnHold}
            </Badge>
          }
          tone={timeline.external_hold ? 'rose' : 'emerald'}
          href="#settlement-timeline-details"
        />
      </div>

      {/* Projection line — only meaningful copy when delay has been accrued. */}
      {projection.projectedMs !== null ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {labels.projection.projectedCompletion}:{' '}
          <span className="font-medium text-foreground">
            {formatDateTime(new Date(projection.projectedMs).toISOString())}
          </span>
          {timeline.open_delay_days > 0 ? (
            <span className="ms-1">· {labels.projection.adjustedForDelay(timeline.open_delay_days)}</span>
          ) : null}
        </p>
      ) : null}

      {/* Visual timeline track (#1). */}
      <div id="settlement-timeline-details" className="scroll-mt-24 mt-6 border-t pt-5">
        <TimelineTrack timeline={timeline} selectedCategory={delayCategory} />
      </div>

      {/* Open-delay by-category breakdown (#3). */}
      <div className="mt-6 border-t pt-5">
        <DelayBreakdown
          timeline={timeline}
          selectedCategory={delayCategory}
          onSelectCategory={(category) => {
            setDelayCategory(category);
            document.getElementById('settlement-timeline-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      </div>

      {timeline.external_hold ? (
        <div className="mt-4 rounded-lg border px-4 py-3 ps-5 relative overflow-hidden">
          <span className="absolute inset-y-0 start-0 w-1 bg-destructive/60" aria-hidden />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              {labels.holdCategory}:{' '}
              <span className="font-medium text-foreground">
                {timeline.external_hold_category
                  ? delayCategoryLabel(L, timeline.external_hold_category)
                  : labels.notOnHold}
              </span>
            </span>
            {timeline.external_hold_since ? (
              <span className="text-muted-foreground">
                {labels.holdSince}:{' '}
                <span className="font-medium text-foreground">{formatDateTime(timeline.external_hold_since)}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
