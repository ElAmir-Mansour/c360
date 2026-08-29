'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  LayoutGrid,
  List,
  Plus,
  Scan,
  Upload,
  ShieldAlert,
  Tag,
  Trash2,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ExportMenu } from '@/components/cyber/export-menu';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { apiGet, apiPut, apiDelete } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { PaginatedResponse } from '@/types/api';
import type { BulkAction, FetchParams } from '@/types/table';
import type { CyberAsset } from '@/types/cyber';

import { AssetKpiCards } from './_components/asset-kpi-cards';
import { getAssetColumns } from './_components/asset-columns';
import { getAssetFilters, flattenAssetFetchParams } from './_components/asset-filters';
import { AssetGridView } from './_components/asset-grid-view';
import { AssetTrendCharts } from './_components/asset-trend-charts';
import { CreateAssetDialog } from './_components/create-asset-dialog';
import { EditAssetDialog } from './_components/edit-asset-dialog';
import { DeleteAssetDialog } from './_components/delete-asset-dialog';
import { TagManagementDialog } from './_components/tag-management-dialog';
import { BulkTagDialog } from './_components/bulk-tag-dialog';
import { ScanDialog } from './_components/scan-dialog';
import { ScanScheduleDialog } from './_components/scan-schedule-dialog';
import { BulkImportDialog } from './_components/bulk-import-dialog';
import { AddRelationshipDialog } from './_components/add-relationship-dialog';
import { useAssetLabels } from './_lib/assets-i18n';

type ViewMode = 'table' | 'grid';

function fetchAssets(params: FetchParams): Promise<PaginatedResponse<CyberAsset>> {
  return apiGet<PaginatedResponse<CyberAsset>>(API_ENDPOINTS.CYBER_ASSETS, flattenAssetFetchParams(params));
}

export default function AssetsPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('cyber:write');
  const t = useAssetLabels();

  const [view, setView] = useState<ViewMode>('table');
  const [createOpen, setCreateOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CyberAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CyberAsset | null>(null);
  const [tagTarget, setTagTarget] = useState<CyberAsset | null>(null);
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);
  const [relationshipTarget, setRelationshipTarget] = useState<CyberAsset | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { tableProps, data, totalRows, activeFilters, refetch } = useDataTable<CyberAsset>({
    fetchFn: fetchAssets,
    queryKey: 'cyber-assets',
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['asset.created', 'asset.updated', 'asset.deleted', 'vulnerability.created'],
  });

  const columns = getAssetColumns({
    labels: t,
    onEdit: canWrite ? setEditTarget : undefined,
    onDelete: canWrite ? setDeleteTarget : undefined,
    onTag: canWrite ? setTagTarget : undefined,
    onRelationship: canWrite ? setRelationshipTarget : undefined,
  });

  const handleBulkComplete = useCallback(async () => {
    setSelectedIds([]);
    await refetch();
  }, [refetch]);

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!canWrite) return [];
    return [
      {
        label: t.bulk.bulkTag,
        icon: Tag,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          setBulkTagIds(ids);
        },
      },
      {
        label: t.bulk.setActive,
        icon: ShieldCheck,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          let updated = 0;
          for (const id of ids) {
            try {
              await apiPut(`${API_ENDPOINTS.CYBER_ASSETS}/${id}`, { status: 'active' });
              updated++;
            } catch {
              // continue on individual failures
            }
          }
          toast.success(t.bulk.setActiveDone(updated));
          await handleBulkComplete();
        },
      },
      {
        label: t.bulk.decommission,
        icon: ShieldOff,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          let updated = 0;
          for (const id of ids) {
            try {
              await apiPut(`${API_ENDPOINTS.CYBER_ASSETS}/${id}`, { status: 'decommissioned' });
              updated++;
            } catch {
              // continue on individual failures
            }
          }
          toast.success(t.bulk.decommissionedDone(updated));
          await handleBulkComplete();
        },
      },
      {
        label: t.bulk.deleteSelected,
        icon: Trash2,
        variant: 'destructive',
        confirmMessage: t.bulk.deleteConfirm,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          await apiDelete(API_ENDPOINTS.CYBER_ASSETS_BULK);
          toast.success(t.bulk.deletedDone(ids.length));
          await handleBulkComplete();
        },
      },
    ];
  }, [canWrite, handleBulkComplete, t]);

  const emptyState = {
    icon: ShieldAlert,
    title: t.list.emptyTitle,
    description: t.list.emptyDescription,
    action: { label: t.list.createAsset, onClick: () => setCreateOpen(true) },
  };

  // Build current filter params for export
  const exportFilters = useMemo(() => {
    const filters: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(activeFilters ?? {})) {
      if (value) filters[key] = value;
    }
    return filters;
  }, [activeFilters]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.list.eyebrow}
          title={t.list.title}
          description={t.list.description}
          tags={[
            { label: t.list.tagAttackSurface, tone: 'primary', icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> },
            { label: t.list.tagContinuousDiscovery, tone: 'info' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex rounded-md border">
                <Button
                  variant={view === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-r-none border-r px-2"
                  aria-label={t.list.tableView}
                  aria-pressed={view === 'table'}
                  onClick={() => setView('table')}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={view === 'grid' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-l-none px-2"
                  aria-label={t.list.gridView}
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>

              {/* Export */}
              <ExportMenu
                entityType="assets"
                baseUrl={API_ENDPOINTS.CYBER_ASSETS}
                currentFilters={exportFilters}
                totalCount={totalRows}
                enabledFormats={['csv', 'json']}
                selectedCount={selectedIds.length}
              />

              {/* Actions */}
              <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                <Scan className="me-1.5 h-3.5 w-3.5" />
                {t.list.scan}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
                {t.list.schedule}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
                <Upload className="me-1.5 h-3.5 w-3.5" />
                {t.list.import}
              </Button>
              {canWrite && (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.list.addAsset}
                </Button>
              )}
            </div>
          }
        />

        <AssetKpiCards />

        {/* Asset Trend Charts */}
        <AssetTrendCharts />

        {view === 'table' ? (
          <DataTable
            columns={columns}
            filters={getAssetFilters(t)}
            searchPlaceholder={t.list.searchPlaceholder}
            emptyState={emptyState}
            getRowId={(row) => row.id}
            enableColumnToggle
            enableSelection={canWrite}
            onSelectionChange={setSelectedIds}
            bulkActions={bulkActions}
            {...tableProps}
          />
        ) : (
          <div className="space-y-4">
            {tableProps.isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted" />
                ))}
              </div>
            ) : data.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title={t.list.emptyTitle}
                description={t.list.emptyDescriptionGrid}
                action={{ label: t.list.createAsset, onClick: () => setCreateOpen(true) }}
              />
            ) : (
              <AssetGridView
                assets={data}
                onEdit={canWrite ? setEditTarget : undefined}
                onDelete={canWrite ? setDeleteTarget : undefined}
                onTag={canWrite ? setTagTarget : undefined}
              />
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateAssetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => refetch()}
      />
      <ScanDialog open={scanOpen} onOpenChange={setScanOpen} />
      <ScanScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <BulkImportDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSuccess={() => refetch()}
      />
      {editTarget && (
        <EditAssetDialog
          open={!!editTarget}
          onOpenChange={(o) => { if (!o) setEditTarget(null); }}
          asset={editTarget}
          onSuccess={() => { setEditTarget(null); refetch(); }}
        />
      )}
      {deleteTarget && (
        <DeleteAssetDialog
          open={!!deleteTarget}
          onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
          asset={deleteTarget}
          onSuccess={() => { setDeleteTarget(null); refetch(); }}
        />
      )}
      {tagTarget && (
        <TagManagementDialog
          open={!!tagTarget}
          onOpenChange={(o) => { if (!o) setTagTarget(null); }}
          asset={tagTarget}
          onSuccess={() => { setTagTarget(null); refetch(); }}
        />
      )}
      {bulkTagIds.length > 0 && (
        <BulkTagDialog
          open={bulkTagIds.length > 0}
          onOpenChange={(o) => { if (!o) setBulkTagIds([]); }}
          assetIds={bulkTagIds}
          onSuccess={() => { setBulkTagIds([]); handleBulkComplete(); }}
        />
      )}
      {relationshipTarget && (
        <AddRelationshipDialog
          open={!!relationshipTarget}
          onOpenChange={(o) => { if (!o) setRelationshipTarget(null); }}
          asset={relationshipTarget}
          onSuccess={() => { setRelationshipTarget(null); refetch(); }}
        />
      )}
    </PermissionRedirect>
  );
}
