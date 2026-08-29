'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, HardDrive, Lock, ShieldAlert, Fingerprint, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { buildDataAssetColumns } from '../_components/data-asset-columns';
import { ScanTriggerDialog } from '../_components/scan-trigger-dialog';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DataAsset, DSPMDashboard } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

export default function DataAssetsPage() {
  const router = useRouter();
  const t = useDspmLabels();
  const [scanOpen, setScanOpen] = useState(false);

  const {
    data: dashEnvelope,
    isLoading: dashLoading,
    error: dashError,
    mutate: refetchDash,
  } = useRealtimeData<{ data: DSPMDashboard }>(API_ENDPOINTS.CYBER_DSPM_DASHBOARD, {
    pollInterval: 120000,
  });

  const { tableProps, refetch } = useDataTable<DataAsset>({
    queryKey: 'cyber-dspm-assets',
    fetchFn: (params: FetchParams) => {
      const { filters, ...rest } = params;
      return apiGet<PaginatedResponse<DataAsset>>(API_ENDPOINTS.CYBER_DSPM_DATA_ASSETS, { ...rest, ...filters } as Record<string, unknown>);
    },
    defaultSort: { column: 'risk_score', direction: 'desc' },
  });
  const dataAssetColumns = buildDataAssetColumns(t.columns);

  const dashboard = dashEnvelope?.data;

  const totalAssets = dashboard?.total_data_assets ?? 0;
  const encryptedCount = totalAssets - (dashboard?.unencrypted_count ?? 0);
  const piiCount = dashboard?.pii_assets_count ?? 0;
  const highRiskCount = dashboard?.high_risk_assets_count ?? 0;

  const filters = [
    {
      key: 'classification',
      label: t.overview.filters.classification,
      type: 'multi-select' as const,
      options: ['public', 'internal', 'confidential', 'restricted', 'top_secret'].map((c) => ({
        label: c.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: c,
      })),
    },
    {
      key: 'asset_type',
      label: t.overview.filters.assetType,
      type: 'multi-select' as const,
      options: ['database', 'cloud_storage', 'file_server', 'api'].map((at) => ({
        label: at.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: at,
      })),
    },
    {
      key: 'encrypted',
      label: t.overview.filters.encrypted,
      type: 'multi-select' as const,
      options: [
        { label: t.overview.filters.encryptedOption, value: 'true' },
        { label: t.overview.filters.unencryptedOption, value: 'false' },
      ],
    },
  ];

  const kpis: Array<{ label: string; value: number; icon: typeof HardDrive; tone: StatTone }> = [
    { label: t.assetsPage.kpiTotalAssets, value: totalAssets, icon: HardDrive, tone: 'sky' },
    { label: t.assetsPage.kpiEncrypted, value: encryptedCount, icon: Lock, tone: 'emerald' },
    { label: t.assetsPage.kpiPiiAssets, value: piiCount, icon: Fingerprint, tone: piiCount > 0 ? 'rose' : 'emerald' },
    { label: t.assetsPage.kpiHighRisk, value: highRiskCount, icon: ShieldAlert, tone: highRiskCount > 0 ? 'rose' : 'emerald' },
  ];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.overview.dataAssetsTitle}
          description={t.assetsPage.description}
          actions={
            <Button size="sm" onClick={() => setScanOpen(true)}>
              <ScanSearch className="me-1.5 h-3.5 w-3.5" />
              {t.overview.triggerScan}
            </Button>
          }
        />

        {dashLoading ? (
          <LoadingSkeleton variant="card" count={4} />
        ) : dashError ? (
          <ErrorState message={t.assetsPage.statsLoadError} onRetry={() => void refetchDash()} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi) => (
              <StatCard
                key={kpi.label}
                label={kpi.label}
                value={kpi.value}
                icon={kpi.icon}
                tone={kpi.tone}
                className=""
              />
            ))}
          </div>
        )}

        <div className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">{t.overview.dataAssetsTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.overview.dataAssetsSubtitle}</p>
          </div>
          <div className="p-5">
            {tableProps.isLoading ? (
              <LoadingSkeleton variant="table-row" count={6} />
            ) : tableProps.error ? (
              <ErrorState message={t.overview.dataAssetsLoadError} onRetry={refetch} />
            ) : (
              <DataTable
                {...tableProps}
                columns={dataAssetColumns}
                filters={filters}
                onSortChange={() => undefined}
                searchPlaceholder={t.assetsPage.searchPlaceholder}
                onRowClick={(row) => router.push(`/cyber/dspm/assets/${row.id}`)}
                emptyState={{
                  icon: Database,
                  title: t.overview.noAssetsTitle,
                  description: t.overview.noAssetsDescription,
                  action: { label: t.overview.triggerScan, onClick: () => setScanOpen(true) },
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
