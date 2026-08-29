'use client';

import { LineChart } from '@/components/shared/charts/line-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/components/providers/locale-provider';
import type { AIDriftReport } from '@/types/ai-governance';

interface DriftChartProps {
  latest: AIDriftReport | null;
  history: AIDriftReport[];
}

function driftVariant(value?: string) {
  switch (value) {
    case 'significant':
      return 'destructive';
    case 'moderate':
      return 'warning';
    case 'low':
      return 'secondary';
    default:
      return 'success';
  }
}

export function DriftChart({ latest, history }: DriftChartProps) {
  const t = useT('admin');
  const enumLabel = (prefix: string, s: string) => {
    const key = `${prefix}.${s}`;
    const v = t(key);
    return v === key ? s : v;
  };
  const psiData = history
    .slice()
    .reverse()
    .map((item) => ({
      period: new Date(item.period_end).toLocaleDateString(),
      output_psi: item.output_psi ?? 0,
      confidence_psi: item.confidence_psi ?? 0,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{t('dc.psiTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            data={psiData}
            xKey="period"
            yKeys={[
              { key: 'output_psi', label: t('dc.outputPsi'), color: 'hsl(var(--chart-3))' },
              { key: 'confidence_psi', label: t('dc.confidencePsi'), color: 'hsl(var(--chart-6))', dashed: true },
            ]}
            height={320}
          />
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{t('dc.latestReport')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {latest ? (
            <>
              <div className="flex items-center justify-between">
                <Badge variant={driftVariant(latest.output_drift_level)}>{enumLabel('dc.dl', latest.output_drift_level ?? 'none')}</Badge>
                <div className="text-sm text-muted-foreground">
                  {t('dc.alerts', { n: latest.alert_count })}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="text-muted-foreground">{t('dc.currentVolume')}</div>
                  <div className="mt-1 text-xl font-semibold">{latest.current_volume.toLocaleString()}</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="text-muted-foreground">{t('dc.p95Latency')}</div>
                  <div className="mt-1 text-xl font-semibold">
                    {latest.current_p95_latency_ms ? `${Math.round(latest.current_p95_latency_ms)} ms` : t('dc.na')}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {latest.alerts.map((alert, index) => (
                  <div key={`${alert.type}-${index}`} className="rounded-lg border border-border/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{alert.type}</p>
                      <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'}>{enumLabel('dc.sev', alert.severity)}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{alert.message}</p>
                    {alert.recommended ? <p className="mt-2 text-sm">{alert.recommended}</p> : null}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('dc.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
