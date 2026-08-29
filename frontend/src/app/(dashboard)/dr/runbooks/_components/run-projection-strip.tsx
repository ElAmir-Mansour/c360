'use client';

import { Clock, GitBranch, Hourglass, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDurationSeconds } from '@/components/product';
import type { DRRunbookProjection } from '@/types/clario-dr';
import { useRunbookPageLabels } from './runbook-page-labels';

/**
 * Live run-projection strip. Consumes the server-computed
 * {@link DRRunbookProjection} from `DRRunbookLiveState` DIRECTLY — the backend
 * already projects the finish + the on-track verdict over the live sub-DAG of
 * outstanding work (see the `DRRunbookProjection` JSDoc), so nothing is
 * re-derived here. It surfaces the facets the DS `RunbookTaskFlow` summary strip
 * does not (elapsed, remaining critical path, signed variance + the on-track
 * verdict), pairing the variance colour token with an explicit ahead/behind label
 * so meaning never relies on colour alone (WCAG 2.1 AA). Numeric values render in
 * an explicit LTR run so durations read correctly under RTL.
 */
export function RunProjectionStrip({ projection }: { projection: DRRunbookProjection }) {
  const labels = useRunbookPageLabels();

  const variance = projection.variance_seconds;
  const ahead = variance <= 0;
  const varianceLabel = ahead ? labels.projectionAhead : labels.projectionBehind;
  const VarianceIcon = ahead ? TrendingDown : TrendingUp;
  const varianceMagnitude = formatDurationSeconds(Math.abs(variance));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{labels.projectionHeading}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProjectionTile
            icon={<Clock className="h-4 w-4" aria-hidden />}
            label={labels.projectionElapsed}
            value={formatDurationSeconds(projection.elapsed_seconds)}
          />
          <ProjectionTile
            icon={<Hourglass className="h-4 w-4" aria-hidden />}
            label={labels.projectionRemaining}
            value={formatDurationSeconds(projection.remaining_critical_path_seconds)}
          />
          <ProjectionTile
            icon={<GitBranch className="h-4 w-4" aria-hidden />}
            label={labels.projectionVariance}
            value={varianceMagnitude}
          />
          <div
            className={cn(
              'flex flex-col gap-1 rounded-card border p-3',
              ahead
                ? 'border-state-success/40 bg-state-success/5'
                : 'border-state-error/40 bg-state-error/5',
            )}
            data-testid="run-projection-verdict"
            data-on-track={projection.on_track ? 'true' : 'false'}
          >
            <span className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-content-muted">
              <VarianceIcon
                className={cn('h-4 w-4', ahead ? 'text-state-success' : 'text-state-error')}
                aria-hidden
              />
              {labels.projectionVariance}
            </span>
            <span
              className={cn(
                'text-body font-semibold',
                ahead ? 'text-state-success' : 'text-state-error',
              )}
            >
              {varianceLabel}
            </span>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function ProjectionTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-outline-subtle p-3">
      <dt className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-content-muted">
        {icon}
        {label}
      </dt>
      <dd className="text-body font-semibold tabular-nums text-content-primary" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
