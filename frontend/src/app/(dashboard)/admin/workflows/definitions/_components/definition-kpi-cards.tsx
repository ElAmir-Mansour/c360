'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, History, Timer } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { KpiCard } from '@/components/shared/kpi-card';
import { formatDuration } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import type { WorkflowDefinition, WorkflowInstance } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';

interface CountResponse extends PaginatedResponse<unknown> {
  total: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Active (published) definitions — a quantity, so `sky`. */
function useActiveDefinitionsCount() {
  return useQuery({
    queryKey: ['workflow-definitions-kpi', 'active-count'],
    queryFn: () =>
      apiGet<CountResponse>(API_ENDPOINTS.WORKFLOWS_DEFINITIONS, {
        per_page: 1,
        page: 1,
        status: 'active',
      }),
    staleTime: 60_000,
  });
}

/** Definitions updated within the last 7 days — a recency/time signal, so `gold`. */
function useRecentEdits() {
  return useQuery({
    queryKey: ['workflow-definitions-kpi', 'recent-edits'],
    queryFn: async () => {
      const res = await apiGet<PaginatedResponse<WorkflowDefinition>>(
        API_ENDPOINTS.WORKFLOWS_DEFINITIONS,
        { per_page: 50, page: 1, sort: 'updated_at', order: 'desc' },
      );
      const cutoff = Date.now() - SEVEN_DAYS_MS;
      return (res.data ?? []).filter((d) => {
        const ts = d.updated_at ? new Date(d.updated_at).getTime() : NaN;
        return Number.isFinite(ts) && ts >= cutoff;
      }).length;
    },
    staleTime: 60_000,
  });
}

/**
 * Average execution time across recently completed instances — a duration, so
 * `gold`. Derived from `duration_ms` on completed instances; falls back to a
 * dash when no completed instances carry timing data.
 */
function useAvgExecTime() {
  return useQuery({
    queryKey: ['workflow-definitions-kpi', 'avg-exec-time'],
    queryFn: async () => {
      const res = await apiGet<PaginatedResponse<WorkflowInstance>>(
        API_ENDPOINTS.WORKFLOWS_INSTANCES,
        {
          per_page: 50,
          page: 1,
          status: 'completed',
          sort: 'started_at',
          order: 'desc',
        },
      );
      const durations = (res.data ?? [])
        .map((i) => i.duration_ms)
        .filter((d): d is number => typeof d === 'number' && d > 0);
      if (durations.length === 0) return null;
      const avgMs = durations.reduce((s, d) => s + d, 0) / durations.length;
      return Math.round(avgMs / 1000);
    },
    staleTime: 60_000,
  });
}

export function DefinitionKpiCards() {
  const t = useT('admin');
  const { data: activeData, isLoading: activeLoading } = useActiveDefinitionsCount();
  const { data: recentEdits, isLoading: recentLoading } = useRecentEdits();
  const { data: avgExecSeconds, isLoading: avgLoading } = useAvgExecTime();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard
        title={t('dkpi.activeTitle')}
        value={activeData?.total ?? 0}
        icon={CheckCircle2}
        tone="sky"
        loading={activeLoading}
        description={t('dkpi.activeDesc')}
      />
      <KpiCard
        title={t('dkpi.recentTitle')}
        value={recentEdits ?? 0}
        icon={History}
        tone="gold"
        loading={recentLoading}
        description={t('dkpi.recentDesc')}
      />
      <KpiCard
        title={t('dkpi.avgTitle')}
        value={avgExecSeconds != null ? formatDuration(avgExecSeconds) : '—'}
        icon={Timer}
        tone="gold"
        loading={avgLoading}
        description={t('dkpi.avgDesc')}
      />
    </div>
  );
}
