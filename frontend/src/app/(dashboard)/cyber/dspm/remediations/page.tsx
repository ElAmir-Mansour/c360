'use client';

import { useRouter } from 'next/navigation';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  ShieldAlert,
  Timer,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMRemediation, DSPMRemediationStats, CyberSeverity, DSPMRemediationStatus, DSPMFindingType } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

const SEVERITY_COLORS: Record<CyberSeverity, string> = {
  critical: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  high: 'bg-severity-high/10 text-severity-high',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  low: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  info: 'bg-secondary text-foreground/70',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  in_progress: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  awaiting_approval: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  completed: 'bg-primary/15 text-primary',
  failed: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  cancelled: 'bg-secondary text-foreground/70',
  rolled_back: 'bg-severity-high/10 text-severity-high',
  exception_granted: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
};

function formatTimeRemaining(slaDueAt: string | undefined, slaBreached: boolean): string {
  if (slaBreached) return 'Breached';
  if (!slaDueAt) return '--';
  const now = new Date();
  const due = new Date(slaDueAt);
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return 'Breached';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h`;
}

function buildRemediationColumns(
  labels: ReturnType<typeof useDspmLabels>['remediations'],
): ColumnDef<DSPMRemediation>[] {
  return [
  {
    id: 'title',
    accessorKey: 'title',
    header: labels.colTitle,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => {
      const r = row.original;
      return (
        <div>
          <p className="text-sm font-medium">{r.title}</p>
          <Badge variant="outline" className="mt-0.5 text-xs capitalize">
            {r.finding_type.replace(/_/g, ' ')}
          </Badge>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    id: 'severity',
    accessorKey: 'severity',
    header: labels.colSeverity,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => {
      const sev = row.original.severity;
      return (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[sev] ?? 'bg-muted text-muted-foreground'}`}>
          {sev}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    id: 'data_asset_name',
    accessorKey: 'data_asset_name',
    header: labels.colAsset,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => (
      <span className="text-sm">{row.original.data_asset_name ?? '--'}</span>
    ),
    enableSorting: true,
  },
  {
    id: 'assigned_to',
    accessorKey: 'assigned_to',
    header: labels.colAssignee,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => (
      <span className="text-sm text-muted-foreground">{row.original.assigned_to ?? labels.unassigned}</span>
    ),
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: labels.colStatus,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => {
      const status = row.original.status;
      return (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground'}`}>
          {status.replace(/_/g, ' ')}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    id: 'sla',
    header: labels.colSla,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => {
      const r = row.original;
      const display = formatTimeRemaining(r.sla_due_at, r.sla_breached);
      const isBreached = display === 'Breached';
      return (
        <span className={`text-xs font-medium ${isBreached ? 'text-status-error' : 'text-muted-foreground'}`}>
          {isBreached ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {labels.breached}
            </span>
          ) : display}
        </span>
      );
    },
  },
  {
    id: 'steps_progress',
    header: labels.colSteps,
    cell: ({ row }: { row: Row<DSPMRemediation> }) => {
      const r = row.original;
      const progress = r.total_steps > 0 ? Math.round((r.current_step / r.total_steps) * 100) : 0;
      return (
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5 w-16" />
          <span className="text-xs tabular-nums text-muted-foreground">
            {r.current_step}/{r.total_steps}
          </span>
        </div>
      );
    },
  },
  ];
}

export default function RemediationsPage() {
  const router = useRouter();
  const t = useDspmLabels().remediations;
  const remediationColumns = buildRemediationColumns(t);

  const {
    data: statsEnvelope,
    isLoading: statsLoading,
    error: statsError,
    mutate: refetchStats,
  } = useRealtimeData<{ data: DSPMRemediationStats }>(API_ENDPOINTS.CYBER_DSPM_REMEDIATION_STATS, {
    pollInterval: 60000,
  });

  const { tableProps, refetch } = useDataTable<DSPMRemediation>({
    queryKey: 'cyber-dspm-remediations',
    fetchFn: (params: FetchParams) => {
      const { filters, ...rest } = params;
      return apiGet<PaginatedResponse<DSPMRemediation>>(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS, { ...rest, ...filters } as Record<string, unknown>);
    },
    defaultSort: { column: 'severity', direction: 'desc' },
  });

  const stats = statsEnvelope?.data;

  const kpis: Array<{ label: string; value: string | number; icon: typeof Wrench; tone: StatTone }> = [
    { label: t.kpiOpen, value: stats?.total_open ?? 0, icon: Wrench, tone: 'sky' },
    { label: t.kpiCriticalOpen, value: stats?.total_critical_open ?? 0, icon: Flame, tone: (stats?.total_critical_open ?? 0) > 0 ? 'rose' : 'emerald' },
    { label: t.kpiInProgress, value: stats?.total_in_progress ?? 0, icon: Loader2, tone: 'gold' },
    { label: t.kpiCompleted7d, value: stats?.completed_last_7_days ?? 0, icon: CheckCircle2, tone: 'emerald' },
    { label: t.kpiSlaBreaches, value: stats?.sla_breaches ?? 0, icon: AlertTriangle, tone: (stats?.sla_breaches ?? 0) > 0 ? 'rose' : 'emerald' },
    { label: t.kpiAvgResolution, value: `${(stats?.avg_resolution_hours ?? 0).toFixed(1)}h`, icon: Timer, tone: 'gold' },
  ];

  const filters = [
    {
      key: 'status',
      label: t.filterStatus,
      type: 'multi-select' as const,
      options: ['open', 'in_progress', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'rolled_back', 'exception_granted'].map((s) => ({
        label: s.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: s,
      })),
    },
    {
      key: 'severity',
      label: t.filterSeverity,
      type: 'multi-select' as const,
      options: ['critical', 'high', 'medium', 'low'].map((s) => ({
        label: s.charAt(0).toUpperCase() + s.slice(1),
        value: s,
      })),
    },
    {
      key: 'finding_type',
      label: t.filterFindingType,
      type: 'multi-select' as const,
      options: [
        'posture_gap', 'overprivileged_access', 'stale_access', 'classification_drift',
        'shadow_copy', 'policy_violation', 'encryption_missing', 'exposure_risk',
        'pii_unprotected', 'retention_expired', 'blast_radius_excessive',
      ].map((t) => ({
        label: t.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: t,
      })),
    },
  ];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
        />

        {statsLoading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : statsError ? (
          <ErrorState message={t.statsLoadError} onRetry={() => void refetchStats()} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
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

        {stats && (
          <Card>
            <CardContent className="p-5">
              <h3 className="mb-4 text-sm font-semibold">{t.riskReductionSummary}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/20 p-4 text-center">
                  <p className="text-xs text-muted-foreground">{t.totalRiskReduction}</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{stats.total_risk_reduction.toFixed(1)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t.bySeverity}</p>
                  <div className="space-y-1">
                    {Object.entries(stats.by_severity ?? {}).map(([sev, count]) => (
                      <div key={sev} className="flex items-center justify-between text-xs">
                        <span className="capitalize">{sev}</span>
                        <span className="font-medium tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t.byStatus}</p>
                  <div className="space-y-1">
                    {Object.entries(stats.by_status ?? {}).map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between text-xs">
                        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                        <span className="font-medium tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">{t.queueTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.queueSubtitle}</p>
          </div>
          <div className="p-5">
            {tableProps.isLoading ? (
              <LoadingSkeleton variant="table-row" count={6} />
            ) : tableProps.error ? (
              <ErrorState message={t.loadError} onRetry={refetch} />
            ) : (
              <DataTable
                {...tableProps}
                columns={remediationColumns}
                filters={filters}
                onSortChange={() => undefined}
                searchPlaceholder={t.searchPlaceholder}
                onRowClick={(row) => router.push(`/cyber/dspm/remediations/${row.id}`)}
                emptyState={{
                  icon: ShieldAlert,
                  title: t.noRemediationsTitle,
                  description: t.noRemediationsDescription,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </PermissionRedirect>
  );
}
