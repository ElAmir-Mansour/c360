'use client';

/**
 * ConnectorMetricsGrid (#16) — the per-connector SLO/traffic table for the
 * observability dashboard.
 *
 * Rows come from the tenant rollup (`getMetricsOverviewResult`): each connector's
 * calls, error rate, p95 latency and SLO-breach flag. For the richer figures the
 * rollup does NOT carry (p50, throughput, per-op breakdown) the grid lazily pulls
 * the full per-connector snapshot (`getMetrics(id, window)`) — one query per row,
 * de-duped by react-query — and renders an expandable detail panel with the
 * latency distribution across operations as a small {@link TrendSparkline} (a real
 * series, not a synthetic one) plus a by-operation table.
 *
 * Read-only: this surface has no mutating affordance (replay lives in the event
 * inspector). Reads degrade gracefully through an explicit degraded flag for the
 * rollup and `null` for per-row snapshots. RTL via `dir`.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Activity, AlertOctagon, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import {
  getMetrics,
  getMetricsOverviewResult,
  type ConnectorMetrics,
  type MetricsWindow,
  type OverviewMetrics,
} from '@/lib/lex/integrations';
import { kindMeta } from '../_lib/integration-kinds';
import {
  fillObservabilityToken,
  useObservabilityLabels,
  type ObservabilityLabels,
} from '../_lib/observability-labels';

const OVERVIEW_KEY = 'lex-integration-metrics-overview';
const METRICS_KEY = 'lex-integration-metrics';

interface ConnectorMetricsGridProps {
  /** Active rolling window; per-row detail snapshots are scoped to it. */
  window: MetricsWindow;
}

const BASE = '/lex/admin/integrations';

/** Render a [0,1] fraction as a percent string with one decimal. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function SloBadge({ breached, target, t }: { breached: boolean; target?: number; t: ObservabilityLabels }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <StatusBadge
        status={breached ? 'breached' : 'met'}
        size="sm"
        config={{
          met: { label: t.sloMet, color: 'green', icon: CheckCircle2 },
          breached: { label: t.sloBreached, color: 'red', icon: AlertOctagon },
        }}
      />
      {typeof target === 'number' ? (
        <span className="text-caption tabular-nums text-muted-foreground">
          {fillObservabilityToken(t.sloTarget, { n: target })}
        </span>
      ) : null}
    </span>
  );
}

export function ConnectorMetricsGrid({ window }: ConnectorMetricsGridProps) {
  const t = useObservabilityLabels();
  const { locale, direction } = useLocaleOrDefault();

  const overviewQuery = useQuery({
    queryKey: [OVERVIEW_KEY, window],
    queryFn: () => getMetricsOverviewResult(window),
    staleTime: 15_000,
  });

  const rows = useMemo<OverviewMetrics[]>(() => overviewQuery.data?.rows ?? [], [overviewQuery.data]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Lazy per-connector detail snapshots — only fetched for expanded rows so the
  // grid stays cheap. getMetrics never throws (returns null).
  const expandedIds = useMemo(() => rows.map((r) => r.endpoint_id).filter((id) => expanded.has(id)), [rows, expanded]);

  const detailQueries = useQueries({
    queries: expandedIds.map((id) => ({
      queryKey: [METRICS_KEY, id, window],
      queryFn: () => getMetrics(id, window),
      staleTime: 15_000,
    })),
  });

  const detailById = useMemo(() => {
    const m = new Map<string, ConnectorMetrics | null>();
    expandedIds.forEach((id, i) => m.set(id, detailQueries[i]?.data ?? null));
    return m;
  }, [expandedIds, detailQueries]);

  if (overviewQuery.isLoading) {
    return <LoadingSkeleton variant="table-row" count={5} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title={t.metricsUnavailable}
        description={t.metricsUnavailableHint}
        size="compact"
      />
    );
  }

  return (
    <div className="overflow-x-auto" dir={direction} lang={locale}>
      <table className="table-premium w-full text-sm">
        <thead>
          <tr>
            <th className="w-8" aria-hidden />
            <th className="text-start">{t.colConnector}</th>
            <th className="text-start">{t.colKind}</th>
            <th className="text-end">{t.colCalls}</th>
            <th className="text-end">{t.colErrorRate}</th>
            <th className="text-end">{t.colLatencyP95}</th>
            <th className="text-end">{t.colSlo}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meta = kindMeta(row.kind);
            const isOpen = expanded.has(row.endpoint_id);
            const detail = detailById.get(row.endpoint_id);
            // A real latency series: p95 across the connector's operations.
            const sparkData = (detail?.by_op ?? []).map((op) => ({
              label: op.op,
              value: op.p95_ms,
            }));
            return (
              <Fragment key={row.endpoint_id}>
                <tr>
                  <td className="align-middle">
                    <button
                      type="button"
                      onClick={() => toggle(row.endpoint_id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      aria-label={isOpen ? t.hidePayload : t.showPayload}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                      )}
                    </button>
                  </td>
                  <td className="max-w-[14rem] truncate">
                    <Link
                      href={`${BASE}/${row.endpoint_id}`}
                      className="font-medium text-foreground hover:underline"
                      title={row.name || row.endpoint_id}
                    >
                      {row.name || row.endpoint_id}
                    </Link>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <meta.icon className="h-3.5 w-3.5" aria-hidden />
                      {resolveLocalized(meta.name, locale)}
                    </span>
                  </td>
                  <td className="text-end tabular-nums">{row.calls.toLocaleString()}</td>
                  <td
                    className={cn(
                      'text-end tabular-nums',
                      row.error_rate > 0 ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    {pct(row.error_rate)}
                  </td>
                  <td className="text-end tabular-nums">
                    {fillObservabilityToken(t.msUnit, { n: row.latency_p95_ms })}
                  </td>
                  <td className="text-end">
                    <SloBadge breached={row.slo_breached} t={t} />
                  </td>
                </tr>
                {isOpen ? (
                  <tr>
                    <td colSpan={7} className="bg-muted/20">
                      <div className="space-y-4 px-3 py-3">
                        {/* Headline figures the rollup row doesn't carry. */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <Stat href={`#connector-operations-${row.endpoint_id}`} label={t.metricLatencyP50} value={detail ? fillObservabilityToken(t.msUnit, { n: detail.latency_p50_ms }) : '—'} />
                          <Stat href={`#connector-operations-${row.endpoint_id}`} label={t.metricLatencyP95} value={detail ? fillObservabilityToken(t.msUnit, { n: detail.latency_p95_ms }) : '—'} />
                          <Stat href={`#connector-operations-${row.endpoint_id}`} label={t.metricThroughput} value={detail ? fillObservabilityToken(t.recordsUnit, { n: detail.sync_throughput }) : '—'} />
                          <Stat href={`#connector-operations-${row.endpoint_id}`} label={t.colErrors} value={detail ? detail.errors.toLocaleString() : '—'} />
                        </div>

                        {/* Latency distribution across operations (real series). */}
                        {sparkData.length > 0 ? (
                          <div className="space-y-1">
                            <p className="text-caption font-medium text-muted-foreground">{t.colTrend}</p>
                            <TrendSparkline data={sparkData} height={48} showAxis className="max-w-md" />
                          </div>
                        ) : null}

                        {/* By-operation breakdown. */}
                        <div id={`connector-operations-${row.endpoint_id}`} className="scroll-mt-24 space-y-1">
                          <p className="text-caption font-medium text-muted-foreground">{t.byOpTitle}</p>
                          {detail && detail.by_op.length > 0 ? (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-start font-medium">{t.byOpColOp}</th>
                                  <th className="text-end font-medium">{t.byOpColCalls}</th>
                                  <th className="text-end font-medium">{t.byOpColErrorRate}</th>
                                  <th className="text-end font-medium">{t.byOpColP95}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.by_op.map((op) => (
                                  <tr key={op.op}>
                                    <td className="py-1" dir="ltr">{op.op}</td>
                                    <td className="py-1 text-end tabular-nums">{op.calls.toLocaleString()}</td>
                                    <td className={cn('py-1 text-end tabular-nums', op.error_rate > 0 && 'text-destructive')}>
                                      {pct(op.error_rate)}
                                    </td>
                                    <td className="py-1 text-end tabular-nums">
                                      {fillObservabilityToken(t.msUnit, { n: op.p95_ms })}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-caption text-muted-foreground">{t.byOpEmpty}</p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-background px-3 py-2 outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-overline uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </Link>
  );
}

export default ConnectorMetricsGrid;
