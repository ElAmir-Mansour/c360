'use client';

/**
 * Integration observability dashboard — `/lex/admin/integrations/observability`.
 *
 * A tenant-wide SLO / traffic surface (#16): a window selector (1h / 24h / 7d), a
 * KPI strip (connectors reporting, total calls, blended error rate, SLO breaches)
 * derived from the metrics rollup, and the per-connector {@link ConnectorMetricsGrid}
 * (calls, error rate, p50/p95 latency, sync throughput, SLO target + breach badge,
 * and a real per-operation latency sparkline on expand).
 *
 * Reads gated on `lex:integration:read`. This surface is read-only — replay lives
 * in the event inspector. Mirrors the sibling DLQ / pending-changes pages:
 * PermissionRedirect, back link, PageHeader, KpiCard strip, SectionCard,
 * bilingual labels (Arabic-first), react-query, RTL via `dir`/`lang`.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivitySquare, AlertOctagon, ArrowLeft, ArrowRight, Percent, Plug } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { KpiCard } from '@/components/shared/kpi-card';
import { SectionCard } from '@/components/suites/section-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { getMetricsOverviewResult, METRICS_WINDOWS, type MetricsWindow } from '@/lib/lex/integrations';
import { useObservabilityLabels, windowLabel } from '../_lib/observability-labels';
import { ConnectorMetricsGrid } from '../_components/connector-metrics-grid';

const LIST_ROUTE = '/lex/admin/integrations';
const OVERVIEW_KEY = 'lex-integration-metrics-overview';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function ObservabilityPage() {
  const t = useObservabilityLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;

  const [window, setWindow] = useState<MetricsWindow>('24h');

  // The KPI strip reuses the same rollup the grid reads (react-query de-dupes).
  const overviewQuery = useQuery({
    queryKey: [OVERVIEW_KEY, window],
    queryFn: () => getMetricsOverviewResult(window),
    staleTime: 15_000,
  });

  const rows = useMemo(() => overviewQuery.data?.rows ?? [], [overviewQuery.data]);
  const metricsDegraded = overviewQuery.data?.degraded ?? false;

  const stats = useMemo(() => {
    let calls = 0;
    let errored = 0;
    let breaches = 0;
    for (const r of rows) {
      calls += r.calls;
      errored += r.calls * r.error_rate;
      if (r.slo_breached) breaches += 1;
    }
    const errorRate = calls > 0 ? errored / calls : 0;
    return {
      connectors: rows.length,
      calls,
      errorRatePct: `${(errorRate * 100).toFixed(1)}%`,
      errorRateValue: errorRate * 100,
      breaches,
    };
  }, [rows]);
  const selectedWindow = windowLabel(t, window);
  const breachShare = percent(stats.breaches, stats.connectors);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [OVERVIEW_KEY] });
    void qc.invalidateQueries({ queryKey: ['lex-integration-metrics'] });
  };

  return (
    <PermissionRedirect permission="lex:integration:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 h-8 px-2 text-muted-foreground">
            <Link href={LIST_ROUTE}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {t.backToList}
            </Link>
          </Button>

          <PageHeader
            eyebrow={t.obsTab}
            title={t.obsTitle}
            description={t.obsSubtitle}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Select value={window} onValueChange={(v) => setWindow(v as MetricsWindow)}>
                  <SelectTrigger className="h-9 w-[12rem]" aria-label={t.windowLabel}>
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
                <Button variant="outline" size="sm" onClick={refresh} disabled={overviewQuery.isFetching}>
                  {t.refresh}
                </Button>
              </div>
            }
          />
        </div>

        {metricsDegraded ? (
          <Alert variant="warning">
            <AlertOctagon className="h-4 w-4" />
            <AlertTitle>{t.metricsUnavailable}</AlertTitle>
            <AlertDescription>{t.metricsUnavailableHint}</AlertDescription>
          </Alert>
        ) : null}

        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          data-testid="integration-observability-kpi-grid"
        >
          <KpiCard
            appearance="operational"
            title={t.kpiConnectors}
            value={stats.connectors}
            tone="teal"
            icon={Plug}
            loading={overviewQuery.isLoading}
            isError={metricsDegraded}
            detail={t.windowLabel}
            detailValue={selectedWindow}
            href="#integration-observability-records"
          />
          <KpiCard
            appearance="operational"
            title={t.kpiCalls}
            value={stats.calls.toLocaleString()}
            tone="emerald"
            icon={ActivitySquare}
            loading={overviewQuery.isLoading}
            isError={metricsDegraded}
            detail={t.windowLabel}
            detailValue={selectedWindow}
            href="#integration-observability-records"
          />
          <KpiCard
            appearance="operational"
            title={t.kpiErrorRate}
            value={stats.errorRatePct}
            tone="gold"
            icon={Percent}
            loading={overviewQuery.isLoading}
            isError={metricsDegraded}
            progress={stats.errorRateValue}
            progressLabel={t.kpiCalls}
            detail={t.windowLabel}
            detailValue={selectedWindow}
            href="#integration-observability-records"
          />
          <KpiCard
            appearance="operational"
            title={t.kpiBreaches}
            value={stats.breaches}
            tone="rose"
            icon={AlertOctagon}
            loading={overviewQuery.isLoading}
            isError={metricsDegraded}
            progress={breachShare}
            progressLabel={t.kpiConnectors}
            detail={t.windowLabel}
            detailValue={`${breachShare}%`}
            href="#integration-observability-records"
          />
        </div>

        <div id="integration-observability-records" className="scroll-mt-24">
          <SectionCard title={t.gridTitle} description={t.gridSubtitle}>
            <ConnectorMetricsGrid window={window} />
          </SectionCard>
        </div>
      </div>
    </PermissionRedirect>
  );
}
