'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { AreaChart } from '@/components/shared/charts/area-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import type { AlertForecastPoint } from '@/types/cyber';
import { useCyberAnalyticsLabels } from '../_lib/analytics-i18n';

const HORIZON_DAYS = 30;

// Backend dto.ForecastResponse embeds GenericPredictionResponse + forecast field.
// We only read the forecast sub-object.
interface AlertForecastData {
  forecast?: {
    horizon_days?: number;
    points?: AlertForecastPoint[];
    anomaly_flag?: boolean;
  };
}

export function AlertVolumeForecast() {
  const t = useCyberAnalyticsLabels();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cyber-analytics-alert-forecast', HORIZON_DAYS],
    queryFn: () =>
      apiGet<{ data: AlertForecastData }>(API_ENDPOINTS.CYBER_ANALYTICS_ALERT_FORECAST, {
        horizon_days: HORIZON_DAYS,
      }),
    refetchInterval: 300000,
  });

  const points = data?.data?.forecast?.points ?? [];

  if (isLoading) {
    return <LoadingSkeleton variant="card" />;
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.alertForecastTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-muted-foreground">{t.alertForecastError}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.alertForecastTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t.alertForecastInsufficient}
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = points.map((p) => ({
    date: new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    predicted: p.value,
    lower: p.bounds.p10,
    upper: p.bounds.p90,
  }));

  return (
    <AreaChart
      title={t.alertForecastTitleWindow}
      data={chartData}
      xKey="date"
      yKeys={[
        { key: 'predicted', label: t.seriesPredicted, color: 'hsl(var(--chart-2))' },
        { key: 'upper', label: t.seriesUpperBound, color: 'hsl(var(--chart-2) / 0.55)' },
        { key: 'lower', label: t.seriesLowerBound, color: 'hsl(var(--chart-2) / 0.3)' },
      ]}
      stacked={false}
      height={320}
    />
  );
}
