'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Edit, PlayCircle, Plus, TrendingUp, Trash2 } from 'lucide-react';
import { LineChart, chartVar } from '@/components/shared/charts';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/shared/kpi-card';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FilterConfig, RowAction } from '@/types/table';
import type { VisusKPIDefinition } from '@/types/suites';
import { KpiFormDialog } from './_components/kpi-form-dialog';
import {
  pickEnumLabel,
  useVisusEnumLabels,
  useVisusKpisPageLabels,
  useVisusListLabels,
} from '../_lib/visus-i18n';

export default function VisusKpisPage() {
  const t = useVisusListLabels().kpis;
  const p = useVisusKpisPageLabels();
  const enums = useVisusEnumLabels();
  const kpiFilters: FilterConfig[] = [
    {
      key: 'suite',
      label: p.filterSuite,
      type: 'select',
      options: [
        { label: pickEnumLabel(enums.suite, 'cyber'), value: 'cyber' },
        { label: pickEnumLabel(enums.suite, 'data'), value: 'data' },
        { label: pickEnumLabel(enums.suite, 'acta'), value: 'acta' },
        { label: pickEnumLabel(enums.suite, 'lex'), value: 'lex' },
        { label: pickEnumLabel(enums.suite, 'platform'), value: 'platform' },
        { label: pickEnumLabel(enums.suite, 'custom'), value: 'custom' },
      ],
    },
    {
      key: 'enabled',
      label: p.filterEnabled,
      type: 'select',
      options: [
        { label: pickEnumLabel(enums.enabledState, 'enabled'), value: 'true' },
        { label: pickEnumLabel(enums.enabledState, 'disabled'), value: 'false' },
      ],
    },
  ];
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VisusKPIDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VisusKPIDefinition | null>(null);

  const { tableProps, data, refetch } = useDataTable<VisusKPIDefinition>({
    queryKey: 'visus-kpis',
    fetchFn: (params) => enterpriseApi.visus.listKpis(params),
    defaultPageSize: 25,
    defaultSort: { column: 'name', direction: 'asc' },
  });

  const selected = selectedId ?? data[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ['visus-kpi-detail', selected],
    queryFn: () => enterpriseApi.visus.getKpi(selected!),
    enabled: Boolean(selected),
  });

  const createMutation = useMutation({
    mutationFn: enterpriseApi.visus.createKpi,
    onSuccess: async () => {
      showSuccess(p.toastCreated);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['visus-kpis'] });
      refetch();
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => enterpriseApi.visus.updateKpi(id, payload),
    onSuccess: async () => {
      showSuccess(p.toastUpdated);
      setEditTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visus-kpis'] }),
        queryClient.invalidateQueries({ queryKey: ['visus-kpi-detail', selected] }),
      ]);
      refetch();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.visus.deleteKpi(id),
    onSuccess: async () => {
      showSuccess(p.toastDeleted);
      if (deleteTarget?.id === selectedId) {
        setSelectedId(null);
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['visus-kpis'] });
      refetch();
    },
    onError: showApiError,
  });

  const snapshotMutation = useMutation({
    mutationFn: () => enterpriseApi.visus.triggerKpiSnapshot(),
    onSuccess: async () => {
      showSuccess(p.toastSnapshotStarted);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visus-kpis'] }),
        queryClient.invalidateQueries({ queryKey: ['visus-kpi-detail', selected] }),
      ]);
      refetch();
    },
    onError: showApiError,
  });

  const columns: ColumnDef<VisusKPIDefinition>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: p.colKpi,
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.description}</p>
        </div>
      ),
    },
    {
      id: 'suite',
      accessorKey: 'suite',
      header: p.colSuite,
      enableSorting: true,
      cell: ({ row }) => <Badge variant="outline">{pickEnumLabel(enums.suite, row.original.suite)}</Badge>,
    },
    {
      id: 'last_value',
      accessorKey: 'last_value',
      header: p.colLatest,
      enableSorting: true,
      cell: ({ row }) => <span className="text-sm">{row.original.last_value ?? '—'}</span>,
    },
    {
      id: 'last_status',
      accessorKey: 'last_status',
      header: p.colStatus,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.last_status)}>
          {pickEnumLabel(enums.kpiStatus, row.original.last_status ?? 'unknown')}
        </Badge>
      ),
    },
  ];

  const rowActions: RowAction<VisusKPIDefinition>[] = [
    {
      label: p.actionEdit,
      icon: Edit,
      onClick: (row) => setEditTarget(row),
    },
    {
      label: p.actionDelete,
      icon: Trash2,
      variant: 'destructive',
      onClick: (row) => setDeleteTarget(row),
    },
  ];

  const history = detailQuery.data?.history ?? [];
  const definition = detailQuery.data?.definition;

  return (
    <PermissionRedirect permission="visus:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.eyebrow}
          title={t.title}
          description={t.description}
          tags={[
            { label: t.tag(tableProps.totalRows), icon: <TrendingUp className="h-3.5 w-3.5" aria-hidden />, tone: 'primary' },
          ]}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending}>
                <PlayCircle className="me-2 h-4 w-4" />
                {snapshotMutation.isPending ? t.refreshing : t.runSnapshot}
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="me-2 h-4 w-4" />
                {t.create}
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <DataTable
            {...tableProps}
            columns={columns}
            filters={kpiFilters}
            rowActions={rowActions}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyState={{
              icon: TrendingUp,
              title: t.emptyTitle,
              description: t.emptyDescription,
            }}
          />
          <SectionCard title={definition?.name ?? p.detailTitleFallback} description={definition?.description ?? p.detailDescriptionFallback}>
            {definition ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <KpiCard title={p.latestValue} value={definition.last_value ?? 0} icon={TrendingUp} tone="emerald" />
                  <KpiCard title={p.target} value={definition.target_value ?? '—'} icon={PlayCircle} tone="sky" />
                </div>
                <div className="rounded-xl border p-4">
                  <p className="mb-3 text-sm font-medium">{p.history}</p>
                  {/* Shared wrapper: token axes/grid/tooltip + built-in loading /
                      empty states + RTL-aware axis orientation. chartVar(5)
                      preserves this chart's --chart-6 series hue. */}
                  <LineChart
                    data={history.map((point) => ({ at: point.created_at.slice(5, 10), value: point.value }))}
                    xKey="at"
                    yKeys={[{ key: 'value', label: definition.name, color: chartVar(5) }]}
                    height={256}
                    showLegend={false}
                    loading={detailQuery.isLoading}
                    emptyMessage={p.noSnapshotHistory}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{p.selectPrompt}</p>
            )}
          </SectionCard>
        </div>
      </div>

      <KpiFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={createMutation.isPending}
        onSubmit={async (payload) => {
          await createMutation.mutateAsync(payload);
        }}
      />

      <KpiFormDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        kpi={editTarget}
        pending={updateMutation.isPending}
        onSubmit={async (payload) => {
          if (!editTarget) return;
          await updateMutation.mutateAsync({ id: editTarget.id, payload });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={p.deleteTitle}
        description={p.deleteDescription(deleteTarget?.name ?? '')}
        confirmLabel={p.deleteConfirm}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteMutation.mutateAsync(deleteTarget.id);
        }}
      />
    </PermissionRedirect>
  );
}

function statusVariant(status: string | null | undefined): 'default' | 'warning' | 'destructive' | 'outline' {
  if (status === 'warning') return 'warning';
  if (status === 'critical') return 'destructive';
  if (status === 'normal') return 'default';
  return 'outline';
}
