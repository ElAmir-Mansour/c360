'use client';

import { LineChart } from '@/components/shared/charts/line-chart';
import { EmptyState } from '@/components/common/empty-state';
import { LineChart as LineChartIcon } from 'lucide-react';
import { type QualityTrendPoint } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QualityTrendChartProps {
  trend: QualityTrendPoint[];
}

function formatTrendDay(value: string | number): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return String(value);
  }
}

export function QualityTrendChart({
  trend,
}: QualityTrendChartProps) {
  const labels = useDataLabels();

  // The trend endpoint aggregates dated quality results within the window; it
  // returns an empty array when no rules have run recently. Show an explicit
  // empty state rather than a blank "No data available" chart frame.
  if (trend.length === 0) {
    return (
      <EmptyState
        icon={LineChartIcon}
        size="compact"
        title={labels.quality.trendEmptyTitle}
        description={labels.quality.trendEmptyDesc}
      />
    );
  }

  return (
    <LineChart
      data={trend.map((point) => ({ day: point.day, score: point.score }))}
      xKey="day"
      yKeys={[{ key: 'score', label: labels.quality.qualityScoreSeries, color: 'hsl(var(--chart-2))' }]}
      xFormatter={formatTrendDay}
      height={320}
    />
  );
}
