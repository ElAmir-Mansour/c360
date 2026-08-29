'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Wrench, CheckCircle, Clock, PlayCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { apiGet } from '@/lib/api';
import { buildSuiteQueryParams } from '@/lib/suite-api';
import { API_ENDPOINTS } from '@/lib/constants';
import { getRemediationColumns } from './_components/remediation-columns';
import { RemediationCreateDialog } from './_components/remediation-create-dialog';
import { RemediationApproveDialog } from './_components/remediation-approve-dialog';
import type { RemediationAction, RemediationStats } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import { useRemediationLabels } from './_lib/remediation-i18n';

const STATUS_FILTERS = [
  'draft', 'pending_approval', 'approved', 'rejected', 'dry_run_running',
  'dry_run_completed', 'executing', 'executed', 'verified', 'closed',
];

export default function CyberRemediationPage() {
  const router = useRouter();
  const t = useRemediationLabels();
  const [createOpen, setCreateOpen] = useState(false);
  const [approveAction, setApproveAction] = useState<RemediationAction | null>(null);
  const [approveMode, setApproveMode] = useState<'approve' | 'reject'>('approve');

  const { data: statsEnvelope, mutate: refetchStats } = useRealtimeData<{ data: RemediationStats }>(
    API_ENDPOINTS.CYBER_REMEDIATION_STATS,
    { pollInterval: 60000 },
  );
  const stats = statsEnvelope?.data;

  const { tableProps, refetch } = useDataTable<RemediationAction>({
    queryKey: 'cyber-remediation',
    fetchFn: (params: FetchParams) =>
      apiGet<PaginatedResponse<RemediationAction>>(API_ENDPOINTS.CYBER_REMEDIATION, buildSuiteQueryParams(params)),
    wsTopics: ['remediation.created', 'remediation.status_changed'],
    defaultSort: { column: 'created_at', direction: 'desc' },
  });

  const kpis = [
    {
      label: t.list.kpiPendingApproval,
      value: stats?.pending_approval ?? 0,
      icon: Clock,
      color: 'text-warning-700 dark:text-warning-300',
      bg: 'bg-warning-50 dark:bg-warning-800/20',
    },
    {
      label: t.list.kpiExecuting,
      value: stats?.executing ?? 0,
      icon: PlayCircle,
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-950/20',
    },
    {
      label: t.list.kpiTotalActions,
      value: stats?.total ?? 0,
      icon: Wrench,
      color: 'text-muted-foreground',
      bg: 'bg-muted/30',
    },
    {
      label: t.list.kpiVerifiedClosed,
      value: (stats?.verified ?? 0) + (stats?.closed ?? 0),
      icon: CheckCircle,
      color: 'text-primary',
      bg: 'bg-primary/10 dark:bg-brand-primary-800/20',
    },
  ];

  const columns = getRemediationColumns({
    labels: t,
    onApprove: (action) => {
      setApproveAction(action);
      setApproveMode('approve');
    },
    onExecute: (action) => {
      router.push(`/cyber/remediation/${action.id}`);
    },
  });

  const filters = [
    {
      key: 'status',
      label: t.list.filterStatus,
      type: 'multi-select' as const,
      options: STATUS_FILTERS.map((s) => ({ label: t.lifecycleStatus[s] ?? s.replace(/_/g, ' '), value: s })),
    },
    {
      key: 'severity',
      label: t.list.filterSeverity,
      type: 'multi-select' as const,
      options: ['critical', 'high', 'medium', 'low'].map((s) => ({ label: s, value: s })),
    },
    {
      key: 'type',
      label: t.list.filterType,
      type: 'multi-select' as const,
      options: ['patch', 'config_change', 'block_ip', 'isolate_asset', 'firewall_rule', 'access_revoke', 'certificate_renew', 'custom'].map((ty) => ({
        label: ty.replace(/_/g, ' '),
        value: ty,
      })),
    },
  ];

  const handleSuccess = () => {
    refetch();
    void refetchStats();
  };

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.list.title}
          description={t.list.description}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t.list.newAction}
            </Button>
          }
        />

        {/* KPI Summary */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`flex items-center gap-3 rounded-xl border p-4 ${bg}`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Status breakdown bar */}
        {stats && (
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.list.byStatus}</p>
            <div className="flex items-center gap-4 flex-wrap">
              {([
                { label: t.list.statusPending, value: stats.pending_approval, color: 'bg-warning-500 text-warning-700' },
                { label: t.list.statusExecuting, value: stats.executing, color: 'bg-blue-500 text-blue-700' },
                { label: t.list.statusVerified, value: stats.verified, color: 'bg-primary text-primary' },
                { label: t.list.statusFailed, value: stats.failed, color: 'bg-error-500 text-error-600' },
                { label: t.list.statusRolledBack, value: stats.rolled_back, color: 'bg-orange-500 text-orange-700' },
                { label: t.list.statusClosed, value: stats.closed, color: 'bg-neutral-ink/35 text-foreground' },
              ]).map(({ label, value, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${color.split(' ')[0]}`} />
                  <span className="text-sm font-medium">{label}</span>
                  <span className={`text-sm font-bold ${color.split(' ')[1]}`}>{value}</span>
                </div>
              ))}
              {(stats.rolled_back > 0 || stats.verification_failed > 0) && (
                <div className="ms-auto flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t.list.issues(stats.rolled_back + stats.verification_failed)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Table */}
        {tableProps.isLoading ? (
          <LoadingSkeleton variant="table-row" count={8} />
        ) : tableProps.error ? (
          <ErrorState message={t.list.loadError} onRetry={refetch} />
        ) : (
          <DataTable
            {...tableProps}
            columns={columns}
            filters={filters}
            onSortChange={() => undefined}
            searchPlaceholder={t.list.searchPlaceholder}
            emptyState={{
              icon: Wrench,
              title: t.list.emptyTitle,
              description: t.list.emptyDescription,
              action: { label: t.list.newAction, onClick: () => setCreateOpen(true) },
            }}
          />
        )}

        <RemediationCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={handleSuccess}
        />

        {approveAction && (
          <RemediationApproveDialog
            open={!!approveAction}
            onOpenChange={(o) => { if (!o) setApproveAction(null); }}
            action={approveAction}
            mode={approveMode}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </PermissionRedirect>
  );
}
