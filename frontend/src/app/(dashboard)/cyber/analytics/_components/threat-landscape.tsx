'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { KpiCard } from '@/components/shared/kpi-card';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { chartVar, normalizeSeverity, severityVar } from '@/lib/design-tokens';
import type { AnalyticsLandscape } from '@/types/cyber';
import { useCyberAnalyticsLabels } from '../_lib/analytics-i18n';

export function ThreatLandscape() {
  const t = useCyberAnalyticsLabels();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cyber-analytics-landscape'],
    queryFn: () => apiGet<{ data: AnalyticsLandscape }>(API_ENDPOINTS.CYBER_ANALYTICS_LANDSCAPE),
    refetchInterval: 120000,
  });

  const landscape = data?.data;

  const byTypeChart = (landscape?.by_type ?? []).map((entry, i) => ({
    name: entry.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: entry.count,
    color: chartVar(i),
  }));
  const bySevChart = (landscape?.by_severity ?? []).map((entry) => ({
    name: entry.name.charAt(0).toUpperCase() + entry.name.slice(1),
    value: entry.count,
    color: severityVar(normalizeSeverity(entry.name)),
  }));

  if (isError) {
    return (
      <div className="space-y-4">
        <h3 className="text-h4 font-semibold">{t.landscapeHeading}</h3>
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-muted-foreground">{t.landscapeError}</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t.retry}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-h4 font-semibold">{t.landscapeHeading}</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          title={t.kpiActiveThreats}
          value={landscape?.active_threat_count ?? 0}
          iconColor="text-severity-critical"
          loading={isLoading}
        />
        <KpiCard
          title={t.kpiTotalIocs}
          value={landscape?.indicators_total ?? 0}
          iconColor="text-status-info"
          loading={isLoading}
        />
        <KpiCard
          title={t.kpiTopThreatType}
          value={landscape?.top_threat_type?.replace(/_/g, ' ') ?? '—'}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PieChart
          title={t.chartThreatsByType}
          data={byTypeChart}
          loading={isLoading}
          height={280}
          centerLabel={t.centerTypes}
          centerValue={String(landscape?.by_type?.length ?? 0)}
        />
        <PieChart
          title={t.chartThreatsBySeverity}
          data={bySevChart}
          loading={isLoading}
          height={280}
          centerLabel={t.centerThreats}
          centerValue={String(landscape?.total_threats ?? 0)}
        />
      </div>
    </div>
  );
}
