'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { EmptyState } from '@/components/common/empty-state';
import { CHART_COLORS, statusVar } from '@/lib/design-tokens';
import { formatRecoveryDuration } from '@/components/product';
import { Timer } from 'lucide-react';
import type { RunDurationPoint } from '../_lib/insights-aggregation';
import { useInsightsLabels } from './insights-labels';

/**
 * Run-duration-vs-objective bar chart. Each terminal run contributes its actual
 * recovery time (real `rto_actual_seconds` / `completed_at - initiated_at`) and
 * its RTO objective, oldest run first. Colors come from design-system tokens
 * (`CHART_COLORS` / `statusVar`) so the chart re-themes; no hex literals here.
 *
 * Recharts cannot read CSS `var()` from SVG fills, so the token VALUES (resolved
 * hex from `@/lib/design-tokens`, the project's sanctioned SVG-color source) are
 * passed through — this is the established pattern across the dashboard charts.
 */
export function RunPerformanceSection({
  series,
  loading,
  error,
  onRetry,
}: {
  series: RunDurationPoint[];
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const labels = useInsightsLabels();

  const data = series.map((point) => ({
    label: point.label,
    actual: Math.round(point.actualSeconds),
    objective: Math.round(point.objectiveSeconds),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.runSectionTitle}</CardTitle>
        <CardDescription>{labels.runSectionDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {!loading && !error && data.length === 0 ? (
          <EmptyState
            icon={Timer}
            title={labels.runEmptyTitle}
            description={labels.runEmptyDescription}
            size="compact"
          />
        ) : (
          <BarChart
            title={labels.durationChartTitle}
            data={data}
            xKey="label"
            yKeys={[
              { key: 'actual', label: labels.durationSeriesActual, color: CHART_COLORS[0] },
              { key: 'objective', label: labels.durationSeriesObjective, color: statusVar('neutral') },
            ]}
            yFormatter={(value) => formatRecoveryDuration(value, labels.naLabel)}
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
