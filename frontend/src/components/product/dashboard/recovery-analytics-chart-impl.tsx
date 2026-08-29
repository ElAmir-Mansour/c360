'use client';

import { memo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/shared/charts/chart-container';
import { ChartTooltip } from '@/components/shared/charts/chart-tooltip';
import { chartVar, statusVar } from '@/lib/design-tokens';
import { RECOVERY_CHART_HEIGHT } from './recovery-utils';

/**
 * Recovery analytics chart — recharts implementation (lazy-loaded behind the
 * `next/dynamic` wrapper in recovery-analytics-chart.tsx). Plots replication-lag
 * / RPO-seconds trend per measurement against the RPO objective reference line.
 *
 * Colours come from the token-backed CSS-var helpers (chartVar / statusVar) so
 * the series re-theme automatically in dark mode — no hardcoded hex.
 */

export interface RecoveryAnalyticsPoint {
  /** X-axis label (e.g. a formatted timestamp). */
  label: string;
  /** Observed RPO / data-loss window in seconds. */
  rpoSeconds: number;
  /** Observed apply lag in seconds. */
  lagSeconds?: number;
}

export interface RecoveryAnalyticsChartProps {
  data: RecoveryAnalyticsPoint[];
  /** RPO objective in seconds — drawn as a reference line. */
  objectiveSeconds: number;
  /** Series + axis labels (bilingual-ready). */
  labels: {
    rpo: string;
    lag: string;
    objective: string;
    empty: string;
  };
  yFormatter?: (value: number) => string;
  height?: number;
  className?: string;
}

function RecoveryAnalyticsChartImpl({
  data,
  objectiveSeconds,
  labels,
  yFormatter,
  height = RECOVERY_CHART_HEIGHT,
  className,
}: RecoveryAnalyticsChartProps) {
  return (
    <ChartContainer empty={data.length === 0} emptyMessage={labels.empty} height={height} className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={yFormatter}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip valueFormatter={yFormatter} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine
            y={objectiveSeconds}
            stroke={statusVar('warning')}
            strokeDasharray="6 4"
            label={{
              value: labels.objective,
              position: 'insideTopRight',
              fontSize: 11,
              fill: 'hsl(var(--muted-foreground))',
            }}
          />
          <Area
            type="monotone"
            dataKey="rpoSeconds"
            name={labels.rpo}
            stroke={chartVar(0)}
            fill={chartVar(0)}
            fillOpacity={0.15}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="lagSeconds"
            name={labels.lag}
            stroke={chartVar(5)}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export const RecoveryAnalyticsChart = memo(RecoveryAnalyticsChartImpl);
