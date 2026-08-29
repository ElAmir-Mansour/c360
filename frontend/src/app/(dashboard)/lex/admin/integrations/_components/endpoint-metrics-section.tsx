'use client';

/**
 * EndpointMetricsSection (#16) — the per-endpoint SLO/metrics panel embedded on
 * the integration detail page.
 *
 * Reads the full per-connector snapshot (`getMetrics(id, window)`) for a window
 * (window selectable inline) and renders headline tiles (calls, error rate,
 * p50/p95 latency, sync throughput), an SLO target + breach badge, a real
 * per-operation latency {@link TrendSparkline}, and a by-operation table. Reads
 * degrade gracefully — the lib returns `null` on any failure, so the panel shows
 * an honest "metrics unavailable" state rather than crashing. RTL via `dir`.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2 } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { getMetrics, METRICS_WINDOWS, type MetricsWindow } from '@/lib/lex/integrations';
import { Activity } from 'lucide-react';
import {
  fillObservabilityToken,
  useObservabilityLabels,
  windowLabel,
} from '../_lib/observability-labels';

interface EndpointMetricsSectionProps {
  endpointId: string;
}

const METRICS_KEY = 'lex-integration-metrics';

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function EndpointMetricsSection({ endpointId }: EndpointMetricsSectionProps) {
  const t = useObservabilityLabels();
  const { locale, direction } = useLocaleOrDefault();
  const [window, setWindow] = useState<MetricsWindow>('24h');

  const q = useQuery({
    queryKey: [METRICS_KEY, endpointId, window],
    queryFn: () => getMetrics(endpointId, window),
    enabled: Boolean(endpointId),
    staleTime: 15_000,
  });

  const metrics = q.data;

  const sparkData = useMemo(
    () => (metrics?.by_op ?? []).map((op) => ({ label: op.op, value: op.p95_ms })),
    [metrics],
  );

  return (
    <div className="space-y-4" dir={direction} lang={locale}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t.endpointMetricsSubtitle}</p>
        <Select value={window} onValueChange={(v) => setWindow(v as MetricsWindow)}>
          <SelectTrigger className="h-8 w-[11rem]" aria-label={t.windowLabel}>
            <SelectValue placeholder={t.windowLabel} />
          </SelectTrigger>
          <SelectContent>
            {METRICS_WINDOWS.map((w) => (
              <SelectItem key={w} value={w}>
                {windowLabel(t, w)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {q.isLoading ? (
        <LoadingSkeleton variant="card" count={1} />
      ) : !metrics ? (
        <EmptyState
          icon={Activity}
          title={t.metricsUnavailable}
          description={t.metricsUnavailableHint}
          size="compact"
        />
      ) : (
        <div className="space-y-4">
          {/* SLO state banner. */}
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm',
              metrics.slo_breached
                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                : 'border-primary/30 bg-primary/5 text-primary',
            )}
          >
            {metrics.slo_breached ? (
              <AlertOctagon className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="font-medium">{metrics.slo_breached ? t.sloBreached : t.sloMet}</span>
            <span className="text-muted-foreground">
              · {fillObservabilityToken(t.sloTarget, { n: metrics.slo_target_pct })}
            </span>
          </div>

          {/* Headline tiles. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile href="#integration-endpoint-operation-metrics" label={t.metricCalls} value={metrics.calls.toLocaleString()} />
            <Tile
              href="#integration-endpoint-operation-metrics"
              label={t.metricErrorRate}
              value={pct(metrics.error_rate)}
              danger={metrics.error_rate > 0}
            />
            <Tile href="#integration-endpoint-operation-metrics" label={t.metricLatencyP50} value={fillObservabilityToken(t.msUnit, { n: metrics.latency_p50_ms })} />
            <Tile href="#integration-endpoint-operation-metrics" label={t.metricLatencyP95} value={fillObservabilityToken(t.msUnit, { n: metrics.latency_p95_ms })} />
            <Tile href="#integration-endpoint-operation-metrics" label={t.metricThroughput} value={fillObservabilityToken(t.recordsUnit, { n: metrics.sync_throughput })} />
          </div>

          {/* Per-operation latency sparkline (real series). */}
          {sparkData.length > 0 ? (
            <div className="space-y-1">
              <p className="text-caption font-medium text-muted-foreground">{t.colTrend}</p>
              <TrendSparkline data={sparkData} height={56} showAxis className="max-w-lg" />
            </div>
          ) : null}

          {/* By-operation breakdown. */}
          <div id="integration-endpoint-operation-metrics" className="scroll-mt-24 space-y-1">
            <p className="text-caption font-medium text-muted-foreground">{t.byOpTitle}</p>
            {metrics.by_op.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="table-premium w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-start">{t.byOpColOp}</th>
                      <th className="text-end">{t.byOpColCalls}</th>
                      <th className="text-end">{t.byOpColErrorRate}</th>
                      <th className="text-end">{t.byOpColP95}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.by_op.map((op) => (
                      <tr key={op.op}>
                        <td dir="ltr">{op.op}</td>
                        <td className="text-end tabular-nums">{op.calls.toLocaleString()}</td>
                        <td className={cn('text-end tabular-nums', op.error_rate > 0 && 'text-destructive')}>
                          {pct(op.error_rate)}
                        </td>
                        <td className="text-end tabular-nums">
                          {fillObservabilityToken(t.msUnit, { n: op.p95_ms })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-caption text-muted-foreground">{t.byOpEmpty}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, danger, href }: { label: string; value: string; danger?: boolean; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-background px-3 py-2 outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-overline uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-sm font-semibold tabular-nums',
          danger ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </Link>
  );
}

export default EndpointMetricsSection;
