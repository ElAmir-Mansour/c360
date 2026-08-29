'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AreaChart } from '@/components/shared/charts/area-chart';
import { useDspmLabels } from '../_lib/dspm-i18n';

interface BurndownDataPoint {
  date: string;
  open: number;
  closed: number;
}

interface RemediationBurndownChartProps {
  data: BurndownDataPoint[];
}

function formatDate(value: string | number): string {
  const d = new Date(String(value));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RemediationBurndownChart({ data }: RemediationBurndownChartProps) {
  const t = useDspmLabels().burndown;
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">{t.noData}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Remediation Burndown (30 Days)</CardTitle>
      </CardHeader>
      <CardContent>
        <AreaChart
          data={data as unknown as Array<Record<string, unknown>>}
          xKey="date"
          yKeys={[
            { key: 'open', label: t.seriesOpen, color: 'hsl(var(--severity-high))' },
            { key: 'closed', label: t.seriesClosed, color: 'hsl(var(--status-success))' },
          ]}
          height={300}
          showLegend={true}
          xFormatter={formatDate}
        />
      </CardContent>
    </Card>
  );
}
