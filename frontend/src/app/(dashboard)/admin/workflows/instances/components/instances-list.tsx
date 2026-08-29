'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Activity, CheckCircle2, XOctagon, PauseCircle } from 'lucide-react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ErrorState } from '@/components/common/error-state';
import { useDataTable } from '@/hooks/use-data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { StartWorkflowDialog } from './start-workflow-dialog';
import { getAdminInstanceColumns } from './admin-instance-columns';
import { AdminWorkflowCancelDialog } from './admin-workflow-cancel-dialog';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  usePauseWorkflowInstance,
  useResumeWorkflowInstance,
  useRetryWorkflowInstance,
} from '@/hooks/use-workflow-instances-ext';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { WorkflowInstance } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import {
  createAdminWorkflowInstanceFilters,
  getAdminWorkflowLabels,
} from '../../tasks/_lib/admin-workflow-i18n';

const KPI_HOVER = '';

/** Fetch only the total count for a filtered instances slice (per_page=1). */
async function fetchInstanceTotal(params: Record<string, unknown>): Promise<number> {
  const resp = await apiGet<PaginatedResponse<WorkflowInstance>>(
    API_ENDPOINTS.WORKFLOWS_INSTANCES,
    { page: 1, per_page: 1, ...params },
  );
  return resp.meta?.total ?? 0;
}

export function InstancesList({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const router = useRouter();
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const labels = getAdminWorkflowLabels(locale);
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<WorkflowInstance | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  const pauseMutation = usePauseWorkflowInstance();
  const resumeMutation = useResumeWorkflowInstance();
  const retryMutation = useRetryWorkflowInstance();

  const summaryQueries = useQueries({
    queries: [
      {
        queryKey: ['workflow-instances', 'admin-summary', 'running'],
        queryFn: () => fetchInstanceTotal({ status: 'running' }),
        staleTime: 30_000,
      },
      {
        queryKey: ['workflow-instances', 'admin-summary', 'completed'],
        queryFn: () => fetchInstanceTotal({ status: 'completed' }),
        staleTime: 30_000,
      },
      {
        queryKey: ['workflow-instances', 'admin-summary', 'failed'],
        queryFn: () => fetchInstanceTotal({ status: 'failed' }),
        staleTime: 30_000,
      },
      {
        queryKey: ['workflow-instances', 'admin-summary', 'suspended'],
        queryFn: () => fetchInstanceTotal({ status: 'suspended' }),
        staleTime: 30_000,
      },
    ],
  });

  const [runningQ, completedQ, failedQ, suspendedQ] = summaryQueries;
  const summaryLoading = summaryQueries.some((q) => q.isLoading);
  const running = runningQ?.data ?? 0;
  const completed = completedQ?.data ?? 0;
  const failed = failedQ?.data ?? 0;
  const suspended = suspendedQ?.data ?? 0;

  const table = useDataTable<WorkflowInstance>({
    queryKey: 'workflow-instances',
    defaultPageSize: 25,
    defaultSort: { column: 'started_at', direction: 'desc' },
    fetchFn: (params) => {
      const startedRange =
        typeof params.filters?.started_at === 'string'
          ? params.filters.started_at.split(',')
          : [];

      return apiGet<PaginatedResponse<WorkflowInstance>>(
        API_ENDPOINTS.WORKFLOWS_INSTANCES,
        {
          page: params.page,
          per_page: params.per_page,
          sort: params.sort ?? 'started_at',
          order: params.order ?? 'desc',
          search: params.search,
          ...(params.filters?.status
            ? {
                status: Array.isArray(params.filters.status)
                  ? params.filters.status.join(',')
                  : params.filters.status,
              }
            : {}),
          ...(startedRange[0] ? { date_from: startedRange[0] } : {}),
          ...(startedRange[1] ? { date_to: startedRange[1] } : {}),
        },
      );
    },
  });

  const columns = getAdminInstanceColumns({
    locale,
    t,
    onView: (instance) => router.push(`/admin/workflows/instances/${instance.id}`),
    onCancel: (instance) => setCancelTarget(instance),
    onRetry: (instance) => retryMutation.mutate(instance.id),
    onPause: (instance) => pauseMutation.mutate(instance.id),
    onResume: (instance) => resumeMutation.mutate(instance.id),
  });

  if (table.error) {
    return (
      <div className="space-y-6">
        {!hideHeader && (
          <PageHeader
            eyebrow={t('td.eyebrow')}
            title={t('il.title')}
            description={t('il.descShort')}
          />
        )}
        <ErrorState message={t('il.failedLoad')} onRetry={() => table.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <PageHeader
          eyebrow={t('td.eyebrow')}
          title={t('il.title')}
          description={t('il.desc')}
          tags={[
            {
              label: t('il.runningCount', { n: running.toLocaleString() }),
              tone: running > 0 ? 'info' : 'neutral',
              icon: <Activity className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              label: t('il.failedCount', { n: failed.toLocaleString() }),
              tone: failed > 0 ? 'danger' : 'neutral',
            },
          ]}
          actions={
            <Button size="sm" onClick={() => setStartOpen(true)}>
              <Play className="me-1.5 h-3.5 w-3.5" />
              {t('il.startWorkflow')}
            </Button>
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('il.kpiRunning')}
          value={running}
          icon={Activity}
          tone="sky"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={t('il.kpiCompleted')}
          value={completed}
          icon={CheckCircle2}
          tone="emerald"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={t('il.kpiSuspended')}
          value={suspended}
          icon={PauseCircle}
          tone="gold"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={t('il.kpiFailed')}
          value={failed}
          icon={XOctagon}
          tone="rose"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
      </div>

      <DataTable
        columns={columns}
        filters={createAdminWorkflowInstanceFilters(locale)}
        emptyState={{
          icon: Activity,
          title: labels.instanceEmpty.title,
          description: labels.instanceEmpty.description,
        }}
        searchSlot={
          <SearchInput
            value={table.searchValue}
            onChange={table.setSearch}
            placeholder={t('il.searchPlaceholder')}
          />
        }
        {...table.tableProps}
        onRowClick={(row) => router.push(`/admin/workflows/instances/${row.id}`)}
      />

      {cancelTarget && (
        <AdminWorkflowCancelDialog
          instanceId={cancelTarget.id}
          definitionName={cancelTarget.definition_name ?? t('il.workflowFallback')}
          open={Boolean(cancelTarget)}
          onOpenChange={(open) => {
            if (!open) setCancelTarget(null);
          }}
          onSuccess={() => {
            setCancelTarget(null);
            queryClient.invalidateQueries({ queryKey: ['workflow-instances'] });
          }}
        />
      )}

      <StartWorkflowDialog open={startOpen} onOpenChange={setStartOpen} />
    </div>
  );
}
