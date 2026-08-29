'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUp } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import type { ThreatForecastItem } from '@/types/cyber';
import { useCyberAnalyticsLabels } from '../_lib/analytics-i18n';

const HORIZON_DAYS = 7;

// The /threat-forecast endpoint calls PredictTechniqueTrends with a short
// 7-day horizon. We filter to increasing-only so this section is a distinct
// "imminent threat watchlist", as opposed to the 30-day TechniqueTrends table
// below which shows the full technique landscape.
interface ForecastResponse {
  items?: ThreatForecastItem[];
}

export function ThreatForecast() {
  const t = useCyberAnalyticsLabels();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cyber-analytics-threat-forecast', HORIZON_DAYS],
    queryFn: () =>
      apiGet<{ data: ForecastResponse }>(API_ENDPOINTS.CYBER_ANALYTICS_THREAT_FORECAST, {
        horizon_days: HORIZON_DAYS,
      }),
    refetchInterval: 300000,
  });

  // Only surface techniques predicted to grow — this distinguishes this section
  // from the broader 30-day TechniqueTrends table.
  const items = (data?.data?.items ?? []).filter((i) => i.trend === 'increasing');

  if (isLoading) {
    return <LoadingSkeleton variant="card" />;
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.forecastTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-muted-foreground">{t.forecastError}</span>
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
        <CardTitle className="text-base">{t.forecastTitle}</CardTitle>
        <CardDescription className="text-xs">
          {t.forecastDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t.forecastEmpty}
          </p>
        ) : (
          <div className="space-y-2 overflow-x-auto">
            <div className="grid min-w-[520px] grid-cols-5 border-b px-2 pb-1 text-xs font-medium text-muted-foreground">
              <span className="col-span-2">{t.colTechnique}</span>
              <span>{t.colGrowth}</span>
              <span className="text-end">{t.colPredictedP50}</span>
              <span className="text-end">{t.colRangeP10P90}</span>
            </div>
            {items.slice(0, 10).map((item) => (
              <div
                key={item.technique_id}
                className="grid min-w-[520px] grid-cols-5 items-center rounded px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <span className="col-span-2 flex items-center gap-1.5 truncate" title={item.technique_name}>
                  <ArrowUp className="h-3 w-3 shrink-0 text-error-500" />
                  <Badge variant="outline" className="text-xs">{item.technique_id}</Badge>
                  <span className="truncate">{item.technique_name}</span>
                </span>
                <span className="text-xs tabular-nums text-status-error">
                  +{(item.growth_rate * 100).toFixed(1)}%
                </span>
                <span className="text-end text-xs tabular-nums font-medium">
                  {item.forecast.p50.toFixed(0)}
                </span>
                <span className="text-end text-xs tabular-nums text-muted-foreground">
                  {item.forecast.p10.toFixed(0)}–{item.forecast.p90.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
