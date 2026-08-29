'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { DSPMKpiCards } from './_components/dspm-kpi-cards';
import { ClassificationChart } from './_components/classification-chart';
import { buildDataAssetColumns } from './_components/data-asset-columns';
import { ScanTriggerDialog } from './_components/scan-trigger-dialog';
import { useDspmLabels } from './_lib/dspm-i18n';
import type { DataAsset, DSPMDashboard, ShadowDetectionResult } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

const EMPTY_DASHBOARD: DSPMDashboard = {
  total_data_assets: 0,
  pii_assets_count: 0,
  high_risk_assets_count: 0,
  avg_posture_score: 0,
  avg_risk_score: 0,
  unencrypted_count: 0,
  no_access_control_count: 0,
  internet_facing_count: 0,
  classification_breakdown: {},
  exposure_breakdown: {},
  top_risky_assets: [],
  recent_scans: [],
  pii_type_frequency: {},
};

export default function CyberDspmPage() {
  const [scanOpen, setScanOpen] = useState(false);
  const t = useDspmLabels();
  const tOverview = t.overview;

  const {
    data: dashEnvelope,
    isLoading: dashLoading,
    error: dashError,
    mutate: refetchDash,
  } = useRealtimeData<{ data: DSPMDashboard }>(API_ENDPOINTS.CYBER_DSPM_DASHBOARD, {
    pollInterval: 120000,
  });

  const { tableProps, refetch } = useDataTable<DataAsset>({
    queryKey: 'cyber-dspm',
    fetchFn: (params: FetchParams) => {
      const { filters, ...rest } = params;
      return apiGet<PaginatedResponse<DataAsset>>(API_ENDPOINTS.CYBER_DSPM_DATA_ASSETS, { ...rest, ...filters } as Record<string, unknown>);
    },
    defaultSort: { column: 'risk_score', direction: 'desc' },
  });
  const shadowQuery = useQuery({
    queryKey: ['cyber-dspm-shadow-copies'],
    queryFn: () => apiGet<{ data: ShadowDetectionResult }>(API_ENDPOINTS.CYBER_DSPM_SHADOW_COPIES),
    staleTime: 120000,
  });

  // Degrade gracefully: when the dashboard query errors or returns nothing, fall
  // back to a zeroed posture object so the colored summary tiles + structure still
  // render (matching the dspm/assets sibling) instead of collapsing to a bare error.
  const dashboard: DSPMDashboard = dashEnvelope?.data ?? EMPTY_DASHBOARD;
  const dashboardUnavailable = !dashLoading && (Boolean(dashError) || !dashEnvelope?.data);
  const shadowResult = shadowQuery.data?.data;
  const shadowMatches = shadowResult?.matches ?? [];
  const highRiskShare = dashboard.total_data_assets > 0
    ? Math.round((dashboard.high_risk_assets_count / dashboard.total_data_assets) * 100)
    : 0;
  const piiCoverage = dashboard.total_data_assets > 0
    ? Math.round((dashboard.pii_assets_count / dashboard.total_data_assets) * 100)
    : 0;

  const dataAssetColumns = buildDataAssetColumns(t.columns);

  const filters = [
    {
      key: 'classification',
      label: tOverview.filters.classification,
      type: 'multi-select' as const,
      options: ['public', 'internal', 'confidential', 'restricted', 'top_secret'].map((c) => ({
        label: c.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: c,
      })),
    },
    {
      key: 'asset_type',
      label: tOverview.filters.assetType,
      type: 'multi-select' as const,
      options: ['database', 'cloud_storage', 'file_server', 'api'].map((ty) => ({
        label: ty.replace(/_/g, ' '),
        value: ty,
      })),
    },
    {
      key: 'encrypted',
      label: tOverview.filters.encrypted,
      type: 'multi-select' as const,
      options: [
        { label: tOverview.filters.encryptedOption, value: 'true' },
        { label: tOverview.filters.unencryptedOption, value: 'false' },
      ],
    },
  ];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={tOverview.eyebrow}
          title={tOverview.title}
          description={tOverview.description}
          tags={[
            {
              label: dashboardUnavailable ? tOverview.dataAssetsTag : tOverview.dataAssetsCountTag(dashboard.total_data_assets.toLocaleString()),
              tone: 'info',
              icon: <Database className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              label: !dashboardUnavailable && dashboard.unencrypted_count > 0 ? tOverview.unencryptedTag(dashboard.unencrypted_count) : tOverview.encryptionTracked,
              tone: !dashboardUnavailable && dashboard.unencrypted_count > 0 ? 'danger' : 'success',
            },
          ]}
          actions={
            <Button size="sm" onClick={() => setScanOpen(true)}>
              <ScanSearch className="me-1.5 h-3.5 w-3.5" />
              {tOverview.triggerScan}
            </Button>
          }
        />

        {dashLoading ? (
          <div className="space-y-6">
            <LoadingSkeleton variant="kpi" count={6} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <LoadingSkeleton variant="chart" />
              <LoadingSkeleton variant="chart" />
              <LoadingSkeleton variant="chart" />
            </div>
          </div>
        ) : (
          <>
            {dashboardUnavailable ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-300/50 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700/50 dark:bg-warning-700/10 dark:text-warning-300"
              >
                <span>
                  {tOverview.postureUnavailable}
                </span>
                <Button variant="outline" size="sm" onClick={() => void refetchDash()}>
                  <ScanSearch className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {tOverview.retry}
                </Button>
              </div>
            ) : null}

            <DSPMKpiCards dashboard={dashboard} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Classification chart */}
              <div className="card p-5">
                <ClassificationChart data={dashboard.classification_breakdown} />
              </div>

              {/* Posture bars */}
              <div className="card p-5">
                <h3 className="mb-4 text-sm font-semibold">{tOverview.postureOverview}</h3>
                <div className="space-y-3">
                  {[
                    {
                      key: 'pii_coverage',
                      label: tOverview.piiCoverage,
                      value: piiCoverage,
                      good: true,
                    },
                    {
                      key: 'encryption_coverage',
                      label: tOverview.encryptionCoverage,
                      value: dashboard.total_data_assets > 0
                        ? Math.round(((dashboard.total_data_assets - dashboard.unencrypted_count) / dashboard.total_data_assets) * 100)
                        : 100,
                      good: true,
                    },
                    {
                      key: 'access_control',
                      label: tOverview.accessControl,
                      value: dashboard.total_data_assets > 0
                        ? Math.round(((dashboard.total_data_assets - dashboard.no_access_control_count) / dashboard.total_data_assets) * 100)
                        : 100,
                      good: true,
                    },
                    {
                      key: 'high_risk_assets',
                      label: tOverview.highRiskAssets,
                      value: highRiskShare,
                      good: false,
                    },
                  ].map(({ key, label, value, good }) => {
                    const isGood = good ? value >= 80 : value <= 20;
                    const barColor = isGood ? 'bg-primary' : value >= 50 ? 'bg-severity-medium' : 'bg-severity-critical';
                    return (
                      <div key={key}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium">{value}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${value}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scan activity */}
              <div className="card p-5">
                <h3 className="mb-4 text-sm font-semibold">{tOverview.scanActivity}</h3>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center">
                    <span className="text-3xl font-bold text-status-info">{(dashboard.recent_scans ?? []).length}</span>
                    <span className="text-xs text-muted-foreground">{tOverview.scans30d}</span>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                  {tOverview.continuousNote}
                </div>
                <Button className="mt-4 w-full" variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                  <ScanSearch className="me-1.5 h-3.5 w-3.5" />
                  {tOverview.runNewScan}
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="card">
          <div className="border-b border-[color:var(--panel-border)] px-5 py-4">
            <h3 className="text-sm font-semibold">{tOverview.shadowCopyTitle}</h3>
            <p className="text-xs text-muted-foreground">{tOverview.shadowCopyDescription}</p>
          </div>
          <div className="p-5">
            {shadowQuery.isLoading ? (
              <LoadingSkeleton variant="table-row" count={3} />
            ) : shadowQuery.error ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-300/50 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700/50 dark:bg-warning-700/10 dark:text-warning-300"
              >
                <span>{tOverview.shadowUnavailable}</span>
                <Button variant="outline" size="sm" onClick={() => void shadowQuery.refetch()}>
                  <ScanSearch className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {tOverview.retry}
                </Button>
              </div>
            ) : shadowMatches.length === 0 ? (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                {shadowResult?.summary ?? tOverview.shadowEmpty}
              </div>
            ) : (
              <div className="space-y-3">
                {shadowResult?.summary ? (
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                    {shadowResult.summary}
                  </div>
                ) : null}
                {shadowMatches.slice(0, 6).map((match) => (
                  <div key={`${match.source_asset_id}-${match.target_asset_id}-${match.fingerprint}`} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">
                          {match.source_asset_name}.{match.source_table} → {match.target_asset_name}.{match.target_table}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tOverview.matchSuffix(match.match_type.replace(/_/g, ' '), Math.round(match.similarity * 100))}
                        </p>
                      </div>
                      <div className="text-end text-xs text-muted-foreground">
                        <div>{tOverview.sources}: {shadowResult?.sources_count ?? 0}</div>
                        <div>{tOverview.tables}: {shadowResult?.tables_count ?? 0}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Data Assets Table */}
        <div className="card">
          <div className="border-b border-[color:var(--panel-border)] px-5 py-4">
            <h3 className="text-sm font-semibold">{tOverview.dataAssetsTitle}</h3>
            <p className="text-xs text-muted-foreground">{tOverview.dataAssetsSubtitle}</p>
          </div>
          <div className="p-5">
            {tableProps.isLoading ? (
              <LoadingSkeleton variant="table-row" count={6} />
            ) : tableProps.error ? (
              <ErrorState message={tOverview.dataAssetsLoadError} onRetry={refetch} />
            ) : (
              <DataTable
                {...tableProps}
                columns={dataAssetColumns}
                filters={filters}
                onSortChange={() => undefined}
                searchPlaceholder={tOverview.searchAssets}
                emptyState={{
                  icon: Database,
                  title: tOverview.noAssetsTitle,
                  description: tOverview.noAssetsDescription,
                  action: { label: tOverview.triggerScan, onClick: () => setScanOpen(true) },
                }}
              />
            )}
          </div>
        </div>

        <ScanTriggerDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onSuccess={() => { refetch(); void refetchDash(); }}
        />
      </div>
    </PermissionRedirect>
  );
}
