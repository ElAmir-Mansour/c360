'use client';

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { LineChart } from '@/components/shared/charts/line-chart';
import type { AlertTimelineData } from '@/types/cyber';
import { useCyberDashboardLabels } from '../_lib/cyber-i18n';

interface AlertTimelineChartProps {
  data?: AlertTimelineData;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

/**
 * Alert Volume (24h). The card header supplies the title, so this component
 * renders ONLY the plot.
 *
 * The 24h window returns ~25 hourly buckets, so `chartData` is rarely empty —
 * but every bucket can be zero when no alerts landed. A flat zero-line reads as
 * a broken chart, so the shared `LineChart` (via `isEmptyChartData`) surfaces
 * the ChartContainer empty state for an all-zero series. We pass an explicit,
 * labelled "no activity" message and a defined `height` so the
 * ResponsiveContainer always resolves a measurable parent.
 */
export function AlertTimelineChart({ data, loading, error, onRetry }: AlertTimelineChartProps) {
  const t = useCyberDashboardLabels();
  const chartData = useMemo(() => {
    if (!data?.points) return [];
    return data.points.map((pt) => ({
      hour: format(parseISO(pt.bucket), 'HH:mm'),
      count: pt.count,
    }));
  }, [data]);

  return (
    <LineChart
      data={chartData}
      xKey="hour"
      yKeys={[{ key: 'count', label: t.alertVolumeSeriesLabel, color: 'hsl(var(--chart-2))' }]}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyMessage={t.alertVolumeEmpty}
      height={220}
      showGrid
      showLegend={false}
    />
  );
}
