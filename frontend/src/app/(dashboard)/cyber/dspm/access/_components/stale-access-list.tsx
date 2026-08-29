'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import type { StaleAccessResult } from '@/types/cyber';
import { useDspmLabels } from '../../_lib/dspm-i18n';

function formatIdentityType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Risk buckets ride the severity token ramp (re-themes in dark mode).
function riskColor(score: number): string {
  if (score >= 75) return 'text-severity-critical';
  if (score >= 50) return 'text-severity-high';
  if (score >= 25) return 'text-warning-700 dark:text-warning-300';
  return 'text-primary';
}

export function StaleAccessList() {
  const t = useDspmLabels().accessComponents;
  const {
    data: envelope,
    isLoading,
    error,
    mutate: refetch,
  } = useRealtimeData<{ data: StaleAccessResult[] }>(
    API_ENDPOINTS.CYBER_DSPM_ACCESS_STALE,
    { pollInterval: 60000 },
  );

  const results = envelope?.data ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t.staleTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingSkeleton variant="list-item" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t.staleTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            message={t.staleLoadError}
            onRetry={() => void refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">{t.staleTitle}</CardTitle>
        {results.length > 0 && (
          <Badge variant="warning">{results.length}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <div className="rounded-lg border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
            {t.staleEmpty}
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((result) => (
              <div
                key={result.identity_id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{result.identity_name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline">
                      {formatIdentityType(result.identity_type)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t.staleCount(result.stale_count)}
                    </span>
                  </div>
                </div>
                <div className="text-end">
                  <p className={`text-sm font-semibold tabular-nums ${riskColor(result.total_sensitivity_risk)}`}>
                    {Math.round(result.total_sensitivity_risk)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.sensitivityRisk}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
