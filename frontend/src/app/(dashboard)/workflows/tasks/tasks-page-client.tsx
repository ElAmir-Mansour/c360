'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Hand, AlarmClock, ArrowUpCircle } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { TaskDelegateDialog } from '@/components/workflows/task-delegate-dialog';
import { getTaskColumns } from '@/components/workflows/task-table-columns';
import { ErrorState } from '@/components/common/error-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { SearchInput } from '@/components/shared/forms/search-input';
import { taskFilters, fetchRoleFilterOptions } from '@/components/workflows/task-filters';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useWorkflowPageLabels, type WorkflowPageLabels } from '../_lib/workflow-page-i18n';
import type { HumanTask, TaskCounts } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';

const KPI_HOVER = '';

const TAB_PARAMS: Record<string, Record<string, string>> = {
  all: { sort: 'created_at', order: 'desc' },
  pending: { status: 'pending' },
  claimed: { status: 'claimed' },
  completed: { status: 'completed' },
  overdue: { status: 'pending,claimed', sla_breached: 'true' },
};

const TASK_WS_TOPICS = [
  'task.assigned',
  'task.completed',
  'task.escalated',
  'task.overdue',
  'workflow.task.created',
  'workflow.task.completed',
  'workflow.task.escalated',
];

function LocalizedTaskStatusTabs({
  activeTab,
  onTabChange,
  counts,
  labels,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  counts?: TaskCounts;
  labels: WorkflowPageLabels;
}) {
  const allCount = counts
    ? (counts.pending ?? 0) +
      (counts.claimed_by_me ?? 0) +
      (counts.completed ?? 0) +
      (counts.overdue ?? 0) +
      (counts.escalated ?? 0)
    : undefined;

  const tabs = [
    { key: 'all', label: labels.tasks.list.all, count: allCount },
    { key: 'pending', label: labels.tasks.list.pending, count: counts?.pending },
    { key: 'claimed', label: labels.tasks.list.claimed, count: counts?.claimed_by_me },
    { key: 'completed', label: labels.tasks.list.completed, count: counts?.completed },
    { key: 'overdue', label: labels.tasks.list.overdue, count: counts?.overdue, urgent: true },
  ];

  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
              tab.urgent && (tab.count ?? 0) > 0 && 'text-destructive',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <Badge
                variant={tab.urgent && tab.count > 0 ? 'destructive' : 'secondary'}
                className="h-4 min-w-4 px-1 text-overline"
              >
                {tab.count}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} forceMount className="sr-only" />
      ))}
    </Tabs>
  );
}

export function WorkflowTasksPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? '/workflows/tasks';
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const labels = useWorkflowPageLabels();
  const activeTab = searchParams?.get('tab') ?? 'all';
  const [delegateTask, setDelegateTask] = useState<HumanTask | null>(null);

  const {
    data: counts,
    error: countsError,
    mutate: refetchCounts,
  } = useRealtimeData<TaskCounts>(API_ENDPOINTS.WORKFLOWS_TASKS_COUNT, {
    wsTopics: TASK_WS_TOPICS,
    pollInterval: 30000,
  });

  const { data: roleOptions = [] } = useQuery({
    queryKey: ['task-filter-roles'],
    queryFn: fetchRoleFilterOptions,
    staleTime: 60_000,
  });

  const claimTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiPost(`/api/v1/workflows/tasks/${taskId}/claim`),
    onSuccess: async () => {
      showSuccess(labels.tasks.list.claimedSuccess);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.WORKFLOWS_TASKS_COUNT] }),
      ]);
    },
    onError: (error: unknown) => {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? Number((error as { status?: number }).status)
          : undefined;

      if (status === 409) {
        showError(labels.tasks.list.claimedBySomeoneElse);
      } else if (status === 403) {
        showError(labels.tasks.list.missingClaimRole);
      } else {
        showError(labels.tasks.list.failedToClaim);
      }

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.WORKFLOWS_TASKS_COUNT] }),
      ]);
    },
  });

  const filters = useMemo(
    () =>
      taskFilters.map((filter) => {
        if (filter.key === 'priority') {
          return {
            ...filter,
            label: labels.tasks.list.priorityFilter,
            options: filter.options?.map((option) => ({
              ...option,
              label: labels.priorities[Number(option.value)] ?? option.label,
            })),
          };
        }

        if (filter.key === 'assignee_role') {
          return { ...filter, label: labels.tasks.list.roleFilter, options: roleOptions };
        }

        if (filter.key === 'sla_breached') {
          return {
            ...filter,
            label: labels.tasks.list.slaFilter,
            options: filter.options?.map((option) => ({
              ...option,
              label: option.value === 'true' ? labels.tasks.list.overdue : labels.tasks.list.onTime,
            })),
          };
        }

        return filter;
      }),
    [labels, roleOptions],
  );

  const taskTable = useDataTable<HumanTask>({
    queryKey: 'tasks',
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: TASK_WS_TOPICS,
    fetchFn: async (params) => {
      const filtersMap = params.filters ?? {};
      const queryParams: Record<string, unknown> = {
        ...TAB_PARAMS[activeTab],
        page: params.page,
        per_page: params.per_page,
        sort: params.sort ?? 'created_at',
        order: params.order ?? 'desc',
      };

      if (params.search) {
        queryParams.search = params.search;
      }

      for (const [key, value] of Object.entries(filtersMap)) {
        queryParams[key] = Array.isArray(value) ? value.join(',') : value;
      }

      return apiGet<PaginatedResponse<HumanTask>>(API_ENDPOINTS.WORKFLOWS_TASKS, queryParams);
    },
  });

  const columns = getTaskColumns({
    onOpen: (task) => router.push(`/workflows/tasks/${task.id}`),
    onClaim: (task) => claimTaskMutation.mutate(task.id),
    onDelegate: (task) => setDelegateTask(task),
    onViewWorkflow: (task) => router.push(`/workflows/${task.instance_id}`),
    currentUser: user,
    labels,
  }).map((column) => {
    const headers: Record<string, string> = {
      name: labels.tasks.list.columns.taskName,
      workflow_name: labels.tasks.list.columns.workflow,
      status: labels.tasks.list.columns.status,
      sla_deadline: labels.tasks.list.columns.dueDate,
      claimed_by: labels.tasks.list.columns.assigned,
      created_at: labels.tasks.list.columns.created,
    };
    return column.id && typeof column.header === 'string'
      ? { ...column, header: headers[column.id] ?? column.header }
      : column;
  });

  const handleTabChange = (tab: string) => {
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
    if (tab === 'all') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', tab);
    }
    nextParams.set('page', '1');
    router.push(`${currentPath}?${nextParams.toString()}`);
  };

  const countsLoading = !counts && !countsError;

  if (taskTable.error || countsError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.common.eyebrow}
          title={labels.tasks.list.title}
          description={labels.tasks.list.description}
        />
        <ErrorState
          message={labels.tasks.list.failedToLoad}
          onRetry={() => {
            void taskTable.refetch();
            void refetchCounts();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.common.eyebrow}
        title={labels.tasks.list.title}
        description={labels.tasks.list.description}
        tags={[
          {
            label: labels.tasks.list.pendingTag((counts?.pending ?? 0).toLocaleString()),
            tone: (counts?.pending ?? 0) > 0 ? 'warning' : 'neutral',
            icon: <Inbox className="h-3.5 w-3.5" aria-hidden />,
          },
          {
            label: labels.tasks.list.overdueTag((counts?.overdue ?? 0).toLocaleString()),
            tone: (counts?.overdue ?? 0) > 0 ? 'danger' : 'neutral',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={labels.tasks.list.pending}
          value={counts?.pending ?? 0}
          icon={Inbox}
          tone="gold"
          loading={countsLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.tasks.list.claimedByMe}
          value={counts?.claimed_by_me ?? 0}
          icon={Hand}
          tone="sky"
          loading={countsLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.tasks.list.overdue}
          value={counts?.overdue ?? 0}
          icon={AlarmClock}
          tone="rose"
          loading={countsLoading}
          className={KPI_HOVER}
        />
        <KpiCard
          title={labels.tasks.list.escalated}
          value={counts?.escalated ?? 0}
          icon={ArrowUpCircle}
          tone="rose"
          loading={countsLoading}
          className={KPI_HOVER}
        />
      </div>

      <LocalizedTaskStatusTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        counts={counts}
        labels={labels}
      />

      <DataTable
        columns={columns}
        filters={filters}
        searchSlot={
          <SearchInput
            value={taskTable.searchValue}
            onChange={taskTable.setSearch}
            placeholder={labels.tasks.list.searchPlaceholder}
          />
        }
        {...taskTable.tableProps}
        onRowClick={(row) => router.push(`/workflows/tasks/${row.id}`)}
      />

      {delegateTask && (
        <TaskDelegateDialog
          task={delegateTask}
          open={Boolean(delegateTask)}
          onOpenChange={(open) => {
            if (!open) {
              setDelegateTask(null);
            }
          }}
          onSuccess={() => {
            setDelegateTask(null);
            queryClient.invalidateQueries({ queryKey: ['tasks'] });
          }}
        />
      )}
    </div>
  );
}
