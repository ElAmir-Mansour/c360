'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart } from '@/components/shared/charts/line-chart';
import { EmptyState } from '@/components/common/empty-state';
import { CHART_COLORS, statusVar } from '@/lib/design-tokens';
import { timeAgo } from '@/lib/utils';
import { RotateCcw } from 'lucide-react';
import type { DrillOutcomeStats, DrillTrendBucket } from '../_lib/insights-aggregation';
import { useInsightsLabels } from './insights-labels';

/**
 * Drill cadence + pass-rate trend. The line plots per-month pass rate (%) and
 * drills-per-month from real `DRDrillResult.observed_at` / `passed`. Series
 * colors come from design-system tokens so the chart re-themes; no hex literals.
 *
 * RTL-safe (logical layout) and AA: the "last drill" relative time is exposed as
 * text, and the chart pairs the percent line with the raw drill count so the
 * cadence signal does not depend on color alone.
 */
export function DrillTrendSection({
  trend,
  outcomes,
  loading,
  error,
  onRetry,
}: {
  trend: DrillTrendBucket[];
  outcomes: DrillOutcomeStats;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const labels = useInsightsLabels();

  const data = trend.map((bucket) => ({
    label: bucket.label,
    passRate: bucket.passRate === null ? 0 : Math.round(bucket.passRate * 100),
    total: bucket.total,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.drillSectionTitle}</CardTitle>
        <CardDescription>{labels.drillSectionDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {outcomes.lastDrillAt ? (
          <p className="text-sm text-muted-foreground">
            {labels.drillLastRunLabel}:{' '}
            <span className="font-medium text-foreground">
              {timeAgo(outcomes.lastDrillAt)}
            </span>
          </p>
        ) : null}

        {!loading && !error && data.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title={labels.drillEmptyTitle}
            description={labels.drillEmptyDescription}
            size="compact"
          />
        ) : (
          <LineChart
            title={labels.drillTrendChartTitle}
            data={data}
            xKey="label"
            yKeys={[
              { key: 'passRate', label: labels.drillSeriesPassRate, color: CHART_COLORS[0] },
              { key: 'total', label: labels.drillSeriesTotal, color: statusVar('neutral'), dashed: true },
            ]}
            loading={loading}
            error={error}
            onRetry={onRetry}
            height={300}
            showLegend
          />
        )}
      </CardContent>
    </Card>
  );
}
