'use client';

/**
 * health-sparkline — a compact per-connector uptime strip rendered inside each
 * endpoint row (Feature 6). It folds the recent {@link HealthCheckRecord} series
 * from `getHealthHistoryResult` into a row of fixed-width grade "ticks" (oldest
 * → newest), an uptime ratio, the relative last-checked time, and a degrade
 * indicator when the latest probe is worse than the prior one.
 *
 * Why discrete ticks (not a line chart): health history is a sequence of
 * categorical grades (healthy / degraded / down / …), not a continuous metric,
 * so a coloured uptime-bar reads more honestly at this size than an area
 * sparkline. The ticks are pure CSS — no chart library — which keeps the list
 * cheap to render across many cards. The brand `TrendSparkline` primitive is
 * reserved for continuous KPI trends elsewhere.
 *
 * RTL-safe: the strip is a flex row that follows the document `dir`, so in
 * Arabic the oldest tick still sits at the leading (start) edge and the newest
 * at the trailing edge — matching the textual "newest" affordance. All copy is
 * resolved from the labels module; nothing is hard-coded.
 */
import { ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheckRecord, IntegrationHealthGrade } from '@/lib/lex/integrations';
import { HEALTH_DOT_CLASS } from '../_lib/health-presentation';
import type { IntegrationsListLabels } from '../_lib/integrations-i18n';

interface HealthSparklineProps {
  /** Recent probe series, any order; this component sorts oldest → newest. */
  history: HealthCheckRecord[];
  labels: IntegrationsListLabels;
  /** True while the history query is in flight (renders a shimmer strip). */
  loading?: boolean;
  /** True when the history read failed; renders unavailable instead of no-history. */
  degraded?: boolean;
  /** Max ticks to render; older records collapse off the leading edge. */
  maxTicks?: number;
  className?: string;
}

/** Grades that count as "up" for the uptime ratio. */
const UP_GRADES: ReadonlySet<IntegrationHealthGrade> = new Set<IntegrationHealthGrade>([
  'healthy',
]);

/** Ordinal severity so we can detect a degrade (latest worse than previous). */
const GRADE_RANK: Record<IntegrationHealthGrade, number> = {
  healthy: 0,
  disabled: 1,
  unconfigured: 2,
  degraded: 3,
  down: 4,
};

function sortOldestFirst(history: HealthCheckRecord[]): HealthCheckRecord[] {
  return [...history].sort(
    (a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime(),
  );
}

export function HealthSparkline({
  history,
  labels: t,
  loading = false,
  degraded = false,
  maxTicks = 24,
  className,
}: HealthSparklineProps) {
  if (loading) {
    return (
      <div
        className={cn('flex items-center gap-1', className)}
        aria-hidden
        data-testid="health-sparkline-loading"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="h-4 w-1.5 animate-pulse rounded-sm bg-secondary"
          />
        ))}
      </div>
    );
  }

  if (degraded) {
    return (
      <p className={cn('text-caption text-warning-700 dark:text-warning-300', className)}>
        {t.healthUnavailableTitle}
      </p>
    );
  }

  if (history.length === 0) {
    return (
      <p className={cn('text-caption text-muted-foreground', className)}>
        {t.uptimeNoHistory}
      </p>
    );
  }

  const ordered = sortOldestFirst(history);
  const visible = ordered.slice(-maxTicks);

  const upCount = ordered.reduce(
    (n, rec) => n + (UP_GRADES.has(rec.grade) ? 1 : 0),
    0,
  );
  const uptimePct = Math.round((upCount / ordered.length) * 100);

  const latest = ordered[ordered.length - 1];
  const previous = ordered.length > 1 ? ordered[ordered.length - 2] : undefined;
  const worsening =
    previous !== undefined && GRADE_RANK[latest.grade] > GRADE_RANK[previous.grade];

  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      data-testid="health-sparkline"
    >
      {/* Tick strip — oldest (leading edge) → newest (trailing edge). */}
      <div
        className="flex items-end gap-1"
        role="img"
        aria-label={t.uptimeAria(uptimePct, visible.length)}
        title={t.uptimeAria(uptimePct, visible.length)}
      >
        {visible.map((rec, i) => (
          <span
            key={`${rec.checked_at}-${i}`}
            className={cn(
              'w-1.5 shrink-0 rounded-sm',
              HEALTH_DOT_CLASS[rec.grade],
              // Newest tick is the tallest to draw the eye to "now".
              i === visible.length - 1 ? 'h-4' : 'h-3.5',
            )}
            title={`${t.grade[rec.grade]}`}
          />
        ))}
      </div>

      {/* Caption: uptime % + degrade chip. */}
      <div className="flex items-center gap-1.5 text-caption leading-none text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground/80">
          {t.uptimeLabel(uptimePct)}
        </span>
        {worsening ? (
          <span
            className="badge-warning inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption font-semibold"
            title={t.degradeHint}
          >
            <ArrowDownRight className="h-3 w-3" aria-hidden />
            {t.degrading}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default HealthSparkline;
