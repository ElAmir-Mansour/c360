'use client';

import { useQuery } from '@tanstack/react-query';
import { Workflow, CheckCircle, XCircle, Play, Clock, AlertTriangle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { KpiCard } from '@/components/shared/kpi-card';
import { useT } from '@/components/providers/locale-provider';
import type { TaskCounts } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';

interface InstanceCountResponse extends PaginatedResponse<unknown> {
  total: number;
}

function useInstanceCount(status?: string) {
  return useQuery({
    queryKey: ['workflow-analytics-count', status ?? 'all'],
    queryFn: () =>
      apiGet<InstanceCountResponse>('/api/v1/workflows/instances', {
        per_page: 1,
        page: 1,
        ...(status ? { status } : {}),
      }),
    staleTime: 60_000,
  });
}

export function WorkflowKpiCards() {
  const t = useT('admin');
  const { data: allData, isLoading: allLoading } = useInstanceCount();
  const { data: runningData, isLoading: runningLoading } = useInstanceCount('running');
  const { data: completedData, isLoading: completedLoading } = useInstanceCount('completed');
  const { data: failedData, isLoading: failedLoading } = useInstanceCount('failed');

  const { data: taskCounts, isLoading: tasksLoading } = useQuery({
    queryKey: ['workflow-analytics-tasks'],
    queryFn: () => apiGet<TaskCounts>('/api/v1/workflows/tasks/count'),
    staleTime: 30_000,
  });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <KpiCard
        title={t('wk.totalInstances')}
        value={allData?.total ?? 0}
        icon={Workflow}
        tone="sky"
        loading={allLoading}
      />
      <KpiCard
        title={t('wk.running')}
        value={runningData?.total ?? 0}
        icon={Play}
        tone="gold"
        loading={runningLoading}
      />
      <KpiCard
        title={t('wk.completed')}
        value={completedData?.total ?? 0}
        icon={CheckCircle}
        tone="emerald"
        loading={completedLoading}
      />
      <KpiCard
        title={t('wk.failed')}
        value={failedData?.total ?? 0}
        icon={XCircle}
        tone="rose"
        loading={failedLoading}
      />
      <KpiCard
        title={t('wk.pendingTasks')}
        value={taskCounts?.pending ?? 0}
        icon={Clock}
        tone="gold"
        loading={tasksLoading}
      />
      <KpiCard
        title={t('wk.overdueTasks')}
        value={taskCounts?.overdue ?? 0}
        icon={AlertTriangle}
        tone="rose"
        loading={tasksLoading}
      />
    </div>
  );
}
