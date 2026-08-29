'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { chartVar, severityVar, statusVar, normalizeSeverity } from '@/lib/design-tokens';
import { API_ENDPOINTS } from '@/lib/constants';
import type { AssetStats } from '@/types/cyber';
import { useAssetLabels } from '../_lib/assets-i18n';
import { useCyberCriticalityLabels } from '../../_lib/cyber-i18n';

interface TrendDataPoint {
  label: string;
  value: number;
  color: string;
}

export function AssetTrendCharts() {
  const t = useAssetLabels();
  const critLabels = useCyberCriticalityLabels();
  const { data: envelope, isLoading } = useRealtimeData<{ data: AssetStats }>(
    API_ENDPOINTS.CYBER_ASSETS_STATS,
    { pollInterval: 120_000 },
  );
  const stats = envelope?.data;

  const typeData = useMemo<TrendDataPoint[]>(() => {
    if (!stats?.by_type) return [];
    return Object.entries(stats.by_type)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([type, count]) => ({
        label: t.typeLabels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value: count,
        color: type in TYPE_CHART_INDEX ? chartVar(TYPE_CHART_INDEX[type]) : statusVar('neutral'),
      }));
  }, [stats, t]);

  const critData = useMemo<TrendDataPoint[]>(() => {
    if (!stats?.by_criticality) return [];
    return ['critical', 'high', 'medium', 'low']
      .filter((k) => (stats.by_criticality[k] ?? 0) > 0)
      .map((k) => ({
        label: critLabels[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)),
        value: stats.by_criticality[k] ?? 0,
        color: severityVar(normalizeSeverity(k)),
      }));
  }, [stats, critLabels]);

  const total = stats?.total ?? 0;

  if (isLoading || !stats) return null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">{t.trend.byType}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2">
            {typeData.map((d) => (
              <div key={d.label} className="flex items-center gap-3">
                <span className="w-28 truncate text-xs text-muted-foreground">{d.label}</span>
                <div className="flex-1">
                  <div className="h-4 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${total > 0 ? Math.max((d.value / total) * 100, 2) : 0}%`,
                        backgroundColor: d.color,
                      }}
                    />
                  </div>
                </div>
                <span className="w-10 text-end text-xs font-medium tabular-nums">{d.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">{t.trend.byCriticality}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-end gap-4 justify-center h-32">
            {critData.map((d) => {
              const maxVal = Math.max(...critData.map((c) => c.value), 1);
              const heightPct = Math.max((d.value / maxVal) * 100, 8);
              return (
                <div key={d.label} className="flex flex-col items-center gap-1">
                  <span className="text-xs font-medium tabular-nums">{d.value}</span>
                  <div
                    className="w-12 rounded-t-md transition-all duration-500"
                    style={{ height: `${heightPct}%`, backgroundColor: d.color }}
                  />
                  <span className="text-overline text-muted-foreground">{d.label}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Stable categorical slot per asset type → `--chart-N` token (via chartVar),
 * so the type bars re-theme in dark mode instead of using hardcoded hex.
 * Criticality bars derive their color from the shared `--severity-*` ramp.
 */
const TYPE_CHART_INDEX: Record<string, number> = {
  server: 0,
  endpoint: 3,
  cloud_resource: 1,
  network_device: 4,
  iot_device: 5,
  application: 2,
  database: 0,
  container: 3,
};
