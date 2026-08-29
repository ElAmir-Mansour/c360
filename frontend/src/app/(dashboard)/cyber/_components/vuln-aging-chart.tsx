'use client';

import { useMemo } from 'react';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { useCyberDashboardLabels, useCyberSeverityLabels } from '../_lib/cyber-i18n';
interface VulnAgingChartProps {
  data?: VulnerabilityAgingReport;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

// The aging report is optionally returned from a separate endpoint.
// Accept raw AgingBucket[] too.
export interface VulnerabilityAgingReport {
  buckets: Array<{
    label: string;
    by_severity: Record<string, { count: number }>;
    total: number;
  }>;
  total_open: number;
  avg_age_days: number;
}

export function VulnAgingChart({ data, loading, error, onRetry }: VulnAgingChartProps) {
  const t = useCyberDashboardLabels();
  const severityLabels = useCyberSeverityLabels();
  const chartData = useMemo(() => {
    if (!data?.buckets) return [];
    return data.buckets.map((b) => ({
      bucket: b.label,
      critical: b.by_severity['critical']?.count ?? 0,
      high: b.by_severity['high']?.count ?? 0,
      medium: b.by_severity['medium']?.count ?? 0,
      low: b.by_severity['low']?.count ?? 0,
    }));
  }, [data]);

  return (
    <BarChart
      data={chartData}
      xKey="bucket"
      yKeys={[
        { key: 'critical', label: t.workloadCritical, color: 'hsl(var(--severity-critical))' },
        { key: 'high', label: severityLabels.high, color: 'hsl(var(--severity-high))' },
        { key: 'medium', label: severityLabels.medium, color: 'hsl(var(--severity-medium))' },
        { key: 'low', label: severityLabels.low, color: 'hsl(var(--severity-low))' },
      ]}
      stacked
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyMessage={t.vulnAgingEmpty}
      height={220}
      showLegend
    />
  );
}
