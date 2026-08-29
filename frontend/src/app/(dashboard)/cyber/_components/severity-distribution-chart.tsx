'use client';

import { useMemo } from 'react';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { normalizeSeverity, severityVar } from '@/lib/design-tokens';
import type { SeverityDistribution } from '@/types/cyber';
import { useCyberDashboardLabels, useCyberSeverityLabels } from '../_lib/cyber-i18n';

interface SeverityDistributionChartProps {
  data?: SeverityDistribution;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

export function SeverityDistributionChart({ data, loading, error, onRetry }: SeverityDistributionChartProps) {
  const t = useCyberDashboardLabels();
  const severityLabels = useCyberSeverityLabels();
  const { chartData, total } = useMemo(() => {
    if (!data?.counts) return { chartData: [], total: 0 };
    const items = Object.entries(data.counts).map(([name, value]) => ({
      name: severityLabels[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: severityVar(normalizeSeverity(name)),
    }));
    return { chartData: items, total: data.total };
  }, [data, severityLabels]);

  return (
    <PieChart
      data={chartData}
      centerLabel={t.severityTotalCenter}
      centerValue={String(total)}
      loading={loading}
      error={error}
      onRetry={onRetry}
      height={220}
      showLegend
      innerRadius={55}
      outerRadius={90}
    />
  );
}
