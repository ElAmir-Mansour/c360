'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Activity, CheckCircle2, ListTodo, XOctagon } from 'lucide-react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { WorkflowCancelDialog } from '@/components/workflows/workflow-cancel-dialog';
import { getWorkflowInstanceColumns } from '@/components/workflows/workflow-instance-columns';
import { ErrorState } from '@/components/common/error-state';
import { showSuccess, showError } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { workflowInstanceFilters } from '@/components/workflows/workflow-instance-filters';
import { SearchInput } from '@/components/shared/forms/search-input';
import { StartWorkflowDialog } from '@/app/(dashboard)/admin/workflows/instances/components/start-workflow-dialog';
import { useWorkflowPageLabels } from './_lib/workflow-page-i18n';
import type { TaskCounts, WorkflowInstance } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';

const KPI_HOVER = '';

/** Fetch only the total count for a filtered instances slice (per_page=1). */
async function fetchInstanceTotal(params: Record<string, unknown>): Promise<number> {
  const resp = await apiGet<PaginatedResponse<WorkflowInstance>>(
    API_ENDPOINTS.WORKFLOWS_INSTANCES,
    { page: 1, per_page: 1, ...params },
  );
  return resp.meta?.total ?? 0;
}

export function WorkflowsPageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const labels = useWorkflowPageLabels();
  const { hasAnyPermission, hasPermission, user } = useAuth();
  // Operators (workflow:admin / workflow:incident) run the engine and see the
  // whole tenant; everyone else gets a list the API scopes to their own work.
  const isOperator = hasAnyPermission(['workflow:admin', 'workflow:incident']);
  const canStartWorkflow = hasPermission('workflow:write');
  const [cancelTarget, setCancelTarget] = useState<WorkflowInstance | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  const since24h = useMemo(
    () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const summaryQueries = useQueries({
    queries: [
      {
        queryKey: ['workflow-instances', 'summary', 'running'],
        queryFn: () => fetchInstanceTotal({ status: 'running' }),
        staleTime: 30_000,
      },
      {
        queryKey: ['workflow-instances', 'summary', 'failed'],
        queryFn: () => fetchInstanceTotal({ status: 'failed' }),
        staleTime: 30_000,
      },
      {
        queryKey: ['workflow-instances', 'summary', 'completed-24h'],
        queryFn: () => fetchInstanceTotal({ status: 'completed', date_from: since24h }),
        staleTime: 30_000,
      },
      {
        queryKey: ['workflow-instances', 'summary', 'failed-24h'],
        queryFn: () => fetchInstanceTotal({ status: 'failed', date_from: since24h }),
        staleTime: 30_000,
      },
    ],
  });

  const [runningQ, failedQ, completed24hQ, failed24hQ] = summaryQueries;
  const summaryLoading = summaryQueries.some((q) => q.isLoading);

  const { data: taskCounts } = useQuery<TaskCounts>({
    queryKey: [API_ENDPOINTS.WORKFLOWS_TASKS_COUNT],
    queryFn: () => apiGet<TaskCounts>(API_ENDPOINTS.WORKFLOWS_TASKS_COUNT),
    staleTime: 30_000,
  });

  const running = runningQ?.data ?? 0;
  const failed = failedQ?.data ?? 0;
  const completed24h = completed24hQ?.data ?? 0;
  const failed24h = failed24hQ?.data ?? 0;
  const settled24h = completed24h + failed24h;
  const successRate24h = settled24h > 0 ? Math.round((completed24h / settled24h) * 100) : null;
  const openTasks = (taskCounts?.pending ?? 0) + (taskCounts?.claimed_by_me ?? 0);

  const workflowsTable = useDataTable<WorkflowInstance>({
    queryKey: 'workflow-instances',
    defaultPageSize: 25,
    defaultSort: { column: 'started_at', direction: 'desc' },
    fetchFn: (params) => {
      const startedRange =
        typeof params.filters?.started_at === 'string'
          ? params.filters.started_at.split(',')
          : [];

      return apiGet<PaginatedResponse<WorkflowInstance>>('/api/v1/workflows/instances', {
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
      });
    },
  });

  const localizedFilters = useMemo(
    () =>
      workflowInstanceFilters.map((filter) => {
        if (filter.key === 'status') {
          return {
            ...filter,
            label: labels.workflows.statusFilter,
            options: filter.options?.map((option) => ({
              ...option,
              label: labels.statuses[option.value] ?? option.label,
            })),
          };
        }

        if (filter.key === 'started_at') {
          return { ...filter, label: labels.workflows.startedFilter };
        }

        return filter;
      }),
    [labels],
  );

  const retryMutation = useMutation({
    mutationFn: (instanceId: string) => apiPost(`/api/v1/workflows/instances/${instanceId}/retry`),
    onSuccess: () => {
      showSuccess(labels.common.retryInitiated);
      queryClient.invalidateQueries({ queryKey: ['workflow-instances'] });
    },
    onError: () => showError(labels.instance.failedToRetry),
  });

  const columns = getWorkflowInstanceColumns({
    onView: (instance) => router.push(`/workflows/${instance.id}`),
    onCancel: (instance) => setCancelTarget(instance),
    onRetry: (instance) => retryMutation.mutate(instance.id),
    labels,
    // Mirrors what the engine authorizes: an operator controls any instance,
    // everyone else only the ones they started. Without this the menu offers
    // cancel/retry that can only ever come back 403.
    canControl: (instance) => isOperator || (!!user?.id && instance.started_by === user.id),
  }).map((column) => {
    const headers: Record<string, string> = {
      definition_name: labels.workflows.columns.workflow,
      current_step: labels.workflows.columns.currentStep,
      status: labels.workflows.columns.status,
      started_at: labels.workflows.columns.started,
      duration: labels.workflows.columns.duration,
      started_by: labels.workflows.columns.startedBy,
    };
    return column.id && typeof column.header === 'string'
      ? { ...column, header: headers[column.id] ?? column.header }
      : column;
  });

  if (workflowsTable.error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.common.eyebrow}
          title={labels.workflows.title}
          description={isOperator ? labels.workflows.description : labels.workflows.scopedDescription}
        />
        <ErrorState message={labels.common.failedToLoadWorkflows} onRetry={() => workflowsTable.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.common.eyebrow}
        title={labels.workflows.title}
        description={isOperator ? labels.workflows.description : labels.workflows.scopedDescription}
        tags={[
          {
            label: labels.workflows.activeTag(running.toLocaleString()),
            tone: running > 0 ? 'info' : 'neutral',
            icon: <Activity className="h-3.5 w-3.5" aria-hidden />,
          },
          {
            label: labels.workflows.failedTag(failed.toLocaleString()),
            tone: failed > 0 ? 'danger' : 'neutral',
          },
        ]}
        actions={
          canStartWorkflow ? (
            <Button size="sm" onClick={() => setStartOpen(true)}>
              <Play className="me-1.5 h-3.5 w-3.5" />
              {labels.common.startWorkflow}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={labels.workflows.activeWorkflows}
          value={running}
          icon={Activity}
          tone="sky"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.workflows.successRate24h}
          value={successRate24h === null ? '—' : `${successRate24h}%`}
          description={labels.workflows.settledLast24h(settled24h.toLocaleString())}
          icon={CheckCircle2}
          tone="emerald"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.workflows.openTasks}
          value={openTasks}
          icon={ListTodo}
          tone="gold"
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.workflows.failedWorkflows}
          value={failed}
          icon={XOctagon}
          tone="rose"
          loading={summaryLoading}
          className={KPI_HOVER}
        />
      </div>

      <DataTable
        columns={columns}
        filters={localizedFilters}
        searchSlot={
          <SearchInput
            value={workflowsTable.searchValue}
            onChange={workflowsTable.setSearch}
            placeholder={labels.common.searchWorkflows}
          />
        }
        {...workflowsTable.tableProps}
        onRowClick={(row) => router.push(`/workflows/${row.id}`)}
      />

      {cancelTarget && (
        <WorkflowCancelDialog
          instanceId={cancelTarget.id}
          definitionName={cancelTarget.definition_name ?? labels.common.workflow}
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

      <StartWorkflowDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        onSuccess={(instance) => {
          queryClient.invalidateQueries({ queryKey: ['workflow-instances'] });
          router.push(`/workflows/${instance.id}`);
        }}
      />
    </div>
  );
}
