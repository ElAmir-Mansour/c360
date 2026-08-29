'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import type { ThreatForecastItem } from '@/types/cyber';
import { useCyberAnalyticsLabels } from '../_lib/analytics-i18n';

const HORIZON_DAYS = 30;

interface TrendsResponse {
  items?: ThreatForecastItem[];
}

export function TechniqueTrends() {
  const t = useCyberAnalyticsLabels();
  const trendLabel = (trend: string): string =>
    trend === 'increasing'
      ? t.trendIncreasing
      : trend === 'decreasing'
        ? t.trendDecreasing
        : trend === 'stable'
          ? t.trendStable
          : trend;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cyber-analytics-technique-trends', HORIZON_DAYS],
    queryFn: () =>
      apiGet<{ data: TrendsResponse }>(API_ENDPOINTS.CYBER_ANALYTICS_TECHNIQUE_TRENDS, {
        horizon_days: HORIZON_DAYS,
      }),
    refetchInterval: 300000,
  });

  const items = data?.data?.items ?? [];

  if (isLoading) {
    return <LoadingSkeleton variant="card" />;
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.trendsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-muted-foreground">{t.trendsError}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.trendsTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t.trendsEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-start py-2 pe-4">{t.colTechnique}</th>
                  <th className="text-start py-2 pe-4">{t.colId}</th>
                  <th className="text-start py-2 pe-4">{t.colTrend}</th>
                  <th className="text-end py-2 pe-4">{t.colGrowth}</th>
                  <th className="text-end py-2">{t.colPredictedP50}</th>
                  <th className="text-end py-2">{t.colRangeP10P90}</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 20).map((item) => (
                  <tr key={item.technique_id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 pe-4 max-w-[120px] sm:max-w-[200px] truncate">{item.technique_name}</td>
                    <td className="py-2 pe-4">
                      <Badge variant="outline" className="text-xs">{item.technique_id}</Badge>
                    </td>
                    <td className="py-2 pe-4">
                      <span className="flex items-center gap-1">
                        {item.trend === 'increasing' && <ArrowUp className="h-3.5 w-3.5 text-error-500" />}
                        {item.trend === 'decreasing' && <ArrowDown className="h-3.5 w-3.5 text-primary" />}
                        {item.trend === 'stable' && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="text-xs capitalize">{trendLabel(item.trend)}</span>
                      </span>
                    </td>
                    <td className={`py-2 pe-4 text-end tabular-nums text-xs ${item.growth_rate > 0 ? 'text-status-error' : item.growth_rate < 0 ? 'text-primary' : ''}`}>
                      {item.growth_rate > 0 ? '+' : ''}{(item.growth_rate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 pe-2 text-end tabular-nums text-xs font-medium">
                      {item.forecast.p50.toFixed(0)}
                    </td>
                    <td className="py-2 text-end tabular-nums text-xs text-muted-foreground">
                      {item.forecast.p10.toFixed(0)}–{item.forecast.p90.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
