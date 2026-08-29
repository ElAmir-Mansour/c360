'use client';

import { BarChart } from '@/components/shared/charts/bar-chart';
import type { AnalystWorkloadEntry } from '@/types/cyber';
import { useCyberDashboardLabels } from '../_lib/cyber-i18n';

interface AnalystWorkloadChartProps {
  data?: AnalystWorkloadEntry[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

export function AnalystWorkloadChart({ data, loading, error, onRetry }: AnalystWorkloadChartProps) {
  const t = useCyberDashboardLabels();
  const chartData = (data ?? []).map((entry) => ({
    name: entry.name.split(' ')[0], // First name only to save space
    open_assigned: entry.open_assigned,
    critical_open: entry.critical_open,
  }));

  return (
    <BarChart
      data={chartData}
      xKey="name"
      yKeys={[
        { key: 'open_assigned', label: t.workloadOpen, color: 'hsl(var(--chart-2))' },
        { key: 'critical_open', label: t.workloadCritical, color: 'hsl(var(--severity-critical))' },
      ]}
      layout="vertical"
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyMessage={t.workloadEmpty}
      height={260}
      showLegend
      showGrid
    />
  );
}
