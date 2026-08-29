'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, Crosshair, Plus, Search, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PermissionGate } from '@/components/auth/permission-gate';
import { DataTable } from '@/components/shared/data-table/data-table';
import { StatTile } from '@/components/shared/stat-tile';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { useDataTable } from '@/hooks/use-data-table';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { THREAT_TYPE_OPTIONS } from '@/lib/cyber-threats';
import { chartVar, normalizeSeverity, severityVar, statusVar } from '@/lib/design-tokens';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams, FilterConfig } from '@/types/table';
import type { NamedCount, Threat, ThreatStats, ThreatTrendPoint } from '@/types/cyber';

import { getThreatColumns } from './_components/threat-columns';
import { IndicatorCheckDialog } from './_components/indicator-check-dialog';
import { CreateThreatDialog } from './_components/create-threat-dialog';
import { useThreatLabels } from './_lib/threats-i18n';

function fetchThreats(params: FetchParams): Promise<PaginatedResponse<Threat>> {
  return apiGet<PaginatedResponse<Threat>>(API_ENDPOINTS.CYBER_THREATS, flattenParams(params));
}

/**
 * Stable categorical slot per threat type → `--chart-N` token (via chartVar).
 * Keeps each type's bar a consistent, theme-aware color without hardcoded hex;
 * `other`/unknown fall back to the neutral status token.
 */
const THREAT_TYPE_CHART_INDEX: Record<string, number> = {
  malware: 0,
  apt: 3,
  brute_force: 4,
  ddos: 1,
  insider_threat: 2,
  ransomware: 5,
  zero_day: 2,
  phishing: 0,
  botnet: 3,
};

export default function CyberThreatsPage() {
  const router = useRouter();
  const t = useThreatLabels();
  const [indicatorCheckOpen, setIndicatorCheckOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const THREAT_FILTERS: FilterConfig[] = [
    {
      key: 'severity',
      label: t.filters.severity,
      type: 'multi-select',
      options: [
        { label: t.filters.critical, value: 'critical' },
        { label: t.filters.high, value: 'high' },
        { label: t.filters.medium, value: 'medium' },
        { label: t.filters.low, value: 'low' },
      ],
    },
    {
      key: 'status',
      label: t.filters.status,
      type: 'multi-select',
      options: [
        { label: t.filters.statusActive, value: 'active' },
        { label: t.filters.statusContained, value: 'contained' },
        { label: t.filters.statusEradicated, value: 'eradicated' },
        { label: t.filters.statusMonitoring, value: 'monitoring' },
        { label: t.filters.statusClosed, value: 'closed' },
      ],
    },
    {
      key: 'type',
      label: t.filters.type,
      type: 'multi-select',
      options: THREAT_TYPE_OPTIONS,
    },
  ];

  const { tableProps, refetch } = useDataTable<Threat>({
    fetchFn: fetchThreats,
    queryKey: 'cyber-threats',
    defaultPageSize: 25,
    defaultSort: { column: 'last_seen_at', direction: 'desc' },
    wsTopics: ['cyber.threat.detected', 'cyber.threat.updated'],
  });

  const statsQuery = useQuery({
    queryKey: ['cyber-threat-stats'],
    queryFn: () => apiGet<{ data: ThreatStats }>(API_ENDPOINTS.CYBER_THREAT_STATS),
  });
  const trendQuery = useQuery({
    queryKey: ['cyber-threat-trend'],
    queryFn: () => apiGet<{ data: ThreatTrendPoint[] }>(API_ENDPOINTS.CYBER_THREAT_STATS_TREND),
  });

  const stats = statsQuery.data?.data;
  const trendPoints = useMemo(() => trendQuery.data?.data ?? [], [trendQuery.data]);
  const activeDelta = useMemo(
    () => computePercentDelta(trendPoints.map((point) => point.active)),
    [trendPoints],
  );

  const columns = useMemo(
    () => getThreatColumns({
      labels: t.columns,
      onViewDetail: (threat) => router.push(`${ROUTES.CYBER_THREATS}/${threat.id}`),
    }),
    [router, t.columns],
  );

  const criticalHighCount = sumCounts(
    stats?.by_severity ?? [],
    ['critical', 'high'],
  );

  const byTypeChart = (stats?.by_type ?? []).map((entry) => ({
    name: titleizeCount(entry.name),
    count: entry.count,
  }));
  const byTypeColors = (stats?.by_type ?? []).map((entry) => {
    const key = entry.name.toLowerCase().replace(/\s+/g, '_');
    const index = THREAT_TYPE_CHART_INDEX[key];
    // `other`/unknown types stay neutral; known types map to a stable
    // categorical `--chart-N` token so the palette re-themes in dark mode.
    return index === undefined ? statusVar('neutral') : chartVar(index);
  });
  const bySeverityChart = (stats?.by_severity ?? []).map((entry) => ({
    name: titleizeCount(entry.name),
    value: entry.count,
    color: severityVar(normalizeSeverity(entry.name)),
  }));

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.page.eyebrow}
          title={t.page.title}
          description={t.page.description}
          tags={[
            { label: t.page.tagActive(stats?.active ?? 0), tone: (stats?.active ?? 0) > 0 ? 'danger' : 'neutral', icon: <Shield className="h-3.5 w-3.5" aria-hidden /> },
            { label: t.page.tagIocs(stats?.indicators_total ?? 0), tone: 'info' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIndicatorCheckOpen(true)}>
                <Search className="me-1.5 h-3.5 w-3.5" />
                {t.page.checkIndicators}
              </Button>
              <PermissionGate permission="cyber:write">
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.page.newThreat}
                </Button>
              </PermissionGate>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            size="lg"
            label={t.page.kpiActiveThreats}
            value={stats?.active ?? 0}
            delta={{ value: activeDelta, label: t.page.kpiActiveChange, percent: true }}
            icon={Activity}
            tone="danger"
            loading={statsQuery.isLoading || trendQuery.isLoading}
            className=""
          />
          <StatTile
            size="lg"
            label={t.page.kpiCriticalHigh}
            value={criticalHighCount}
            icon={ShieldAlert}
            tone="warning"
            loading={statsQuery.isLoading}
            className=""
          />
          <StatTile
            size="lg"
            label={t.page.kpiIocsTracked}
            value={stats?.indicators_total ?? 0}
            icon={Crosshair}
            tone="info"
            loading={statsQuery.isLoading}
            className=""
          />
          <StatTile
            size="lg"
            label={t.page.kpiContainedThisMonth}
            value={stats?.contained_this_month ?? 0}
            icon={ShieldCheck}
            tone="success"
            loading={statsQuery.isLoading}
            className=""
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <BarChart
            title={t.page.chartThreatsByType}
            data={byTypeChart}
            xKey="name"
            yKeys={[{ key: 'count', label: t.page.chartThreatsSeriesLabel, color: chartVar(5) }]}
            cellColors={byTypeColors}
            loading={statsQuery.isLoading}
            error={statsQuery.error instanceof Error ? statsQuery.error.message : undefined}
            onRetry={() => void statsQuery.refetch()}
            height={280}
            showLegend={false}
          />
          <PieChart
            title={t.page.chartThreatsBySeverity}
            data={bySeverityChart}
            loading={statsQuery.isLoading}
            error={statsQuery.error instanceof Error ? statsQuery.error.message : undefined}
            onRetry={() => void statsQuery.refetch()}
            centerLabel={t.page.chartSeverityCenter}
            centerValue={String(stats?.total ?? 0)}
            height={280}
          />
        </div>

        <DataTable
          columns={columns}
          filters={THREAT_FILTERS}
          searchPlaceholder={t.page.searchPlaceholder}
          emptyState={{
            icon: Shield,
            title: t.page.emptyTitle,
            description: t.page.emptyDescription,
          }}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`${ROUTES.CYBER_THREATS}/${row.id}`)}
          {...tableProps}
        />
      </div>

      <CreateThreatDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(threat) => {
          void statsQuery.refetch();
          void trendQuery.refetch();
          refetch();
          router.push(`${ROUTES.CYBER_THREATS}/${threat.id}`);
        }}
      />
      <IndicatorCheckDialog
        open={indicatorCheckOpen}
        onOpenChange={setIndicatorCheckOpen}
      />
    </PermissionRedirect>
  );
}

function flattenParams(params: FetchParams): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };

  for (const [key, value] of Object.entries(params.filters ?? {})) {
    flat[key] = value;
  }

  return flat;
}

function sumCounts(items: NamedCount[], names: string[]): number {
  const set = new Set(names);
  return items.reduce((total, item) => (
    set.has(item.name) ? total + item.count : total
  ), 0);
}

function computePercentDelta(values: number[]): number {
  if (values.length < 8) {
    return 0;
  }
  const current = values[values.length - 1] ?? 0;
  const prior = values[values.length - 8] ?? 0;
  if (prior === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - prior) / prior) * 100;
}

function titleizeCount(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
