'use client';

import { LineChart } from '@/components/shared/charts/line-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useT } from '@/components/providers/locale-provider';
import type { AIShadowComparison } from '@/types/ai-governance';

interface ShadowComparisonChartProps {
  latest: AIShadowComparison | null;
  history: AIShadowComparison[];
}

function recommendationVariant(value: string) {
  switch (value) {
    case 'promote':
      return 'success';
    case 'reject':
      return 'destructive';
    case 'keep_shadow':
      return 'warning';
    default:
      return 'secondary';
  }
}

export function ShadowComparisonChart({ latest, history }: ShadowComparisonChartProps) {
  const t = useT('admin');
  const recLabel = (s: string) => {
    const key = `scc.rec.${s}`;
    const v = t(key);
    return v === key ? s : v;
  };
  const chartData = history
    .slice()
    .reverse()
    .map((item) => ({
      period: new Date(item.period_end).toLocaleDateString(),
      agreement_rate: Math.round(item.agreement_rate * 100),
      disagreements: item.disagreement_count,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{t('scc.agreement')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            data={chartData}
            xKey="period"
            yKeys={[
              { key: 'agreement_rate', label: t('scc.agreementPct'), color: 'hsl(var(--chart-6))' },
              { key: 'disagreements', label: t('scc.disagreements'), color: 'hsl(var(--severity-critical))', dashed: true },
            ]}
            yFormatter={(value) => `${Math.round(value)}`}
            height={320}
          />
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>{t('scc.latestRec')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {latest ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <Badge variant={recommendationVariant(latest.recommendation)}>{recLabel(latest.recommendation)}</Badge>
                <div className="text-sm text-muted-foreground">
                  {t('scc.agreementValue', { pct: Math.round(latest.agreement_rate * 100) })}
                </div>
              </div>
              <p className="text-sm leading-6">{latest.recommendation_reason}</p>
              <div className="rounded-xl border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('scc.useCase')}</TableHead>
                      <TableHead>{t('scc.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {latest.divergence_samples.slice(0, 5).map((sample) => (
                      <TableRow key={sample.prediction_id}>
                        <TableCell className="font-medium">{sample.use_case}</TableCell>
                        <TableCell className="text-muted-foreground">{sample.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('scc.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
