'use client';

import { PieChart } from '@/components/shared/charts/pie-chart';
import { useDspmLabels } from '../_lib/dspm-i18n';

interface ClassificationChartProps {
  data: Record<string, number>;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  public: 'hsl(var(--status-success))',
  internal: 'hsl(var(--status-info))',
  confidential: 'hsl(var(--severity-medium))',
  restricted: 'hsl(var(--severity-critical))',
  top_secret: 'hsl(var(--status-pending))',
};

export function ClassificationChart({ data }: ClassificationChartProps) {
  const t = useDspmLabels().overview;
  if (!data || typeof data !== 'object') {
    return (
      <div>
        <h3 className="mb-3 text-sm font-semibold">{t.classificationBreakdown}</h3>
        <p className="text-xs text-muted-foreground">{t.noClassificationData}</p>
      </div>
    );
  }
  const chartData = Object.entries(data).map(([key, count]) => ({
    name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: count,
    color: CLASSIFICATION_COLORS[key] ?? 'hsl(var(--status-neutral))',
  }));

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{t.classificationBreakdown}</h3>
      <PieChart
        data={chartData}
        height={220}
        showLegend={false}
      />
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {chartData.map(({ name, value, color }) => (
          <div key={name} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{name}</span>
            <span className="ms-auto font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
