'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Fingerprint, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PermissionGate } from '@/components/auth/permission-gate';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { apiDelete, apiGet, apiPut } from '@/lib/api';
import {
  exportIndicatorsAsCsv,
  exportIndicatorsAsJson,
  exportIndicatorsAsStix,
  INDICATOR_SOURCE_OPTIONS,
} from '@/lib/cyber-indicators';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { INDICATOR_TYPE_OPTIONS } from '@/lib/cyber-threats';
import type { PaginatedResponse } from '@/types/api';
import type { BulkAction, FetchParams, FilterConfig } from '@/types/table';
import type { IndicatorStats as IndicatorStatsType, ThreatIndicator } from '@/types/cyber';
import { Button } from '@/components/ui/button';

import { AddIndicatorDialog } from './_components/add-indicator-dialog';
import { BulkImportDialog } from './_components/bulk-import-dialog';
import { getIndicatorColumns } from './_components/indicator-columns';
import { IndicatorDetailPanel } from './_components/indicator-detail-panel';
import { IndicatorStats } from './_components/indicator-stats';
import { IndicatorCheckDialog } from '../threats/_components/indicator-check-dialog';
import { useIndicatorLabels, type indicatorLabels } from './_lib/indicators-i18n';

type IndicatorFilterLabels = (typeof indicatorLabels)['en']['filters'];

function buildIndicatorFilters(labels: IndicatorFilterLabels): FilterConfig[] {
  return [
    {
      key: 'type',
      label: labels.type,
      type: 'multi-select',
      options: INDICATOR_TYPE_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
      })),
    },
    {
      key: 'source',
      label: labels.source,
      type: 'multi-select',
      options: INDICATOR_SOURCE_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
      })),
    },
    {
      key: 'severity',
      label: labels.severity,
      type: 'multi-select',
      options: [
        { label: labels.critical, value: 'critical' },
        { label: labels.high, value: 'high' },
        { label: labels.medium, value: 'medium' },
        { label: labels.low, value: 'low' },
      ],
    },
    {
      key: 'active',
      label: labels.active,
      type: 'select',
      options: [
        { label: labels.activeOnly, value: 'true' },
        { label: labels.inactiveOnly, value: 'false' },
      ],
    },
    {
      key: 'linked',
      label: labels.threatLink,
      type: 'select',
      options: [
        { label: labels.linked, value: 'true' },
        { label: labels.unlinked, value: 'false' },
      ],
    },
    {
      key: 'confidence_range',
      label: labels.confidence,
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      valueSuffix: '%',
    },
  ];
}

async function fetchIndicators(params: FetchParams): Promise<PaginatedResponse<ThreatIndicator>> {
  return apiGet<PaginatedResponse<ThreatIndicator>>(
    API_ENDPOINTS.CYBER_INDICATORS,
    flattenIndicatorParams(params),
  );
}

export default function CyberIndicatorsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('cyber:write');
  const t = useIndicatorLabels();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tableResetKey, setTableResetKey] = useState(0);
  const [detailIndicator, setDetailIndicator] = useState<ThreatIndicator | null>(null);
  const [editorIndicator, setEditorIndicator] = useState<ThreatIndicator | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [indicatorCheckOpen, setIndicatorCheckOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ThreatIndicator | null>(null);

  const { tableProps, refetch } = useDataTable<ThreatIndicator>({
    fetchFn: fetchIndicators,
    queryKey: 'cyber-indicators',
    defaultPageSize: 25,
    defaultSort: { column: 'last_seen_at', direction: 'desc' },
    wsTopics: ['cyber.indicator.created', 'cyber.indicator.updated'],
  });

  const statsQuery = useQuery({
    queryKey: ['cyber-indicator-stats'],
    queryFn: () => apiGet<{ data: IndicatorStatsType }>(API_ENDPOINTS.CYBER_INDICATORS_STATS),
  });

  const handleMutationComplete = useCallback(async () => {
    setSelectedIds([]);
    setTableResetKey((value) => value + 1);
    await refetch();
    void statsQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ['cyber-indicator-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['cyber-indicator-enrichment'] });
    void queryClient.invalidateQueries({ queryKey: ['cyber-indicator-matches'] });
  }, [refetch, statsQuery, queryClient]);

  const selectedIndicators = useMemo(
    () => tableProps.data.filter((item) => selectedIds.includes(item.id)),
    [selectedIds, tableProps.data],
  );

  const columns = useMemo(
    () => getIndicatorColumns({
      canWrite,
      labels: t.columns,
      onView: setDetailIndicator,
      onEdit: (indicator) => {
        setEditorIndicator(indicator);
        setEditorOpen(true);
      },
      onDelete: setDeleteTarget,
      onToggleActive: async (indicator, active) => {
        try {
          await apiPut(API_ENDPOINTS.CYBER_INDICATOR_STATUS(indicator.id), { active });
          toast.success(active ? t.bulk.indicatorActivated : t.bulk.indicatorDeactivated);
          await handleMutationComplete();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t.bulk.updateFailed);
        }
      },
      onOpenThreat: (indicator) => {
        if (indicator.threat_id) {
          router.push(`${ROUTES.CYBER_THREATS}/${indicator.threat_id}`);
        }
      },
    }),
    [canWrite, router, handleMutationComplete, t.columns, t.bulk],
  );

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!canWrite) {
      return [];
    }

    return [
      {
        label: t.bulk.activateSelected,
        onClick: async (ids) => {
          await Promise.all(ids.map((id) => apiPut(API_ENDPOINTS.CYBER_INDICATOR_STATUS(id), { active: true })));
          toast.success(t.bulk.activated(ids.length));
          await handleMutationComplete();
        },
      },
      {
        label: t.bulk.deactivateSelected,
        onClick: async (ids) => {
          await Promise.all(ids.map((id) => apiPut(API_ENDPOINTS.CYBER_INDICATOR_STATUS(id), { active: false })));
          toast.success(t.bulk.deactivated(ids.length));
          await handleMutationComplete();
        },
      },
      {
        label: t.bulk.exportCsv,
        onClick: async () => {
          exportIndicatorsAsCsv(selectedIndicators);
        },
      },
      {
        label: t.bulk.exportJson,
        onClick: async () => {
          exportIndicatorsAsJson(selectedIndicators);
        },
      },
      {
        label: t.bulk.exportStix,
        onClick: async () => {
          exportIndicatorsAsStix(selectedIndicators);
        },
      },
      {
        label: t.bulk.deleteSelected,
        variant: 'destructive',
        onClick: async (ids) => {
          await Promise.all(ids.map((id) => apiDelete(API_ENDPOINTS.CYBER_INDICATOR_DETAIL(id))));
          toast.success(t.bulk.deleted(ids.length));
          if (detailIndicator && ids.includes(detailIndicator.id)) {
            setDetailIndicator(null);
          }
          await handleMutationComplete();
        },
      },
    ];
  }, [canWrite, detailIndicator, selectedIndicators, handleMutationComplete, t.bulk]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.page.eyebrow}
          title={t.page.title}
          description={t.page.description}
          tags={
            statsQuery.data?.data
              ? [
                  {
                    label: t.page.indicatorsTag(statsQuery.data.data.total.toLocaleString()),
                    tone: 'info',
                    icon: <Fingerprint className="h-3.5 w-3.5" aria-hidden />,
                  },
                  {
                    label: t.page.activeTag(statsQuery.data.data.active.toLocaleString()),
                    tone: 'success',
                  },
                ]
              : undefined
          }
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setIndicatorCheckOpen(true)}>
                <Search className="me-2 h-4 w-4" />
                {t.page.checkIndicators}
              </Button>
              <PermissionGate permission="cyber:write">
                <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
                  <FileUp className="me-2 h-4 w-4" />
                  {t.page.bulkImport}
                </Button>
                <Button
                  onClick={() => {
                    setEditorIndicator(null);
                    setEditorOpen(true);
                  }}
                >
                  <Plus className="me-2 h-4 w-4" />
                  {t.page.addIndicator}
                </Button>
              </PermissionGate>
            </div>
          )}
        />

        <IndicatorStats stats={statsQuery.data?.data} loading={statsQuery.isLoading} />

        <DataTable
          key={tableResetKey}
          {...tableProps}
          columns={columns}
          filters={buildIndicatorFilters(t.filters)}
          searchPlaceholder={t.page.searchPlaceholder}
          getRowId={(row) => row.id}
          onRowClick={(row) => setDetailIndicator(row)}
          enableSelection={canWrite}
          onSelectionChange={setSelectedIds}
          bulkActions={bulkActions}
          emptyState={{
            icon: Fingerprint,
            title: t.page.emptyTitle,
            description: t.page.emptyDescription,
          }}
        />
      </div>

      <AddIndicatorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        indicator={editorIndicator}
        onSuccess={(indicator) => {
          setEditorIndicator(indicator);
          setDetailIndicator(indicator);
          void handleMutationComplete();
        }}
      />

      <BulkImportDialog
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        onSuccess={() => {
          void handleMutationComplete();
        }}
      />

      <IndicatorCheckDialog
        open={indicatorCheckOpen}
        onOpenChange={setIndicatorCheckOpen}
      />

      <IndicatorDetailPanel
        open={Boolean(detailIndicator)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailIndicator(null);
          }
        }}
        indicator={detailIndicator}
        onEdit={(indicator) => {
          setEditorIndicator(indicator);
          setEditorOpen(true);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title={t.page.deleteTitle}
        description={t.page.deleteDescription}
        confirmLabel={t.page.deleteConfirm}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) {
            return;
          }
          await apiDelete(API_ENDPOINTS.CYBER_INDICATOR_DETAIL(deleteTarget.id));
          toast.success(t.page.indicatorDeleted);
          if (detailIndicator?.id === deleteTarget.id) {
            setDetailIndicator(null);
          }
          setDeleteTarget(null);
          await handleMutationComplete();
        }}
      />
    </PermissionRedirect>
  );
}

function flattenIndicatorParams(params: FetchParams): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };

  for (const [key, value] of Object.entries(params.filters ?? {})) {
    if (!value) {
      continue;
    }
    if (key === 'confidence_range' && typeof value === 'string') {
      const [minRaw, maxRaw] = value.split(',');
      const min = Number(minRaw);
      const max = Number(maxRaw);
      if (Number.isFinite(min)) {
        flat.min_confidence = min / 100;
      }
      if (Number.isFinite(max)) {
        flat.max_confidence = max / 100;
      }
      continue;
    }
    flat[key] = Array.isArray(value) ? value.join(',') : value;
  }

  return flat;
}
