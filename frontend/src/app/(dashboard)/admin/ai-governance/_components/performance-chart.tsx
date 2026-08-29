'use client';

import { LineChart } from '@/components/shared/charts/line-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/components/providers/locale-provider';
import type { AIPerformancePoint } from '@/types/ai-governance';

interface PerformanceChartProps {
  points: AIPerformancePoint[];
}

export function PerformanceChart({ points }: PerformanceChartProps) {
  const t = useT('admin');
  const chartData = points
    .slice()
    .reverse()
    .map((point) => ({
      period: new Date(point.period_start).toLocaleDateString(),
      volume: point.volume,
      avg_latency_ms: point.avg_latency_ms ?? 0,
      accuracy: point.accuracy ? Math.round(point.accuracy * 100) : 0,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{t('pc.volumeLatency')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            data={chartData}
            xKey="period"
            yKeys={[
              { key: 'volume', label: t('pc.seriesVolume'), color: 'hsl(var(--chart-2))' },
              { key: 'avg_latency_ms', label: t('pc.seriesAvgLatency'), color: 'hsl(var(--severity-critical))', dashed: true },
            ]}
            height={320}
          />
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{t('pc.accuracy')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            data={chartData}
            xKey="period"
            yKeys={[{ key: 'accuracy', label: t('pc.seriesAccuracy'), color: 'hsl(var(--chart-6))' }]}
            height={320}
          />
        </CardContent>
      </Card>
    </div>
  );
}
