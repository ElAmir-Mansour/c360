'use client';

import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  BookOpen,
  Eye,
  Edit,
  Plus,
  ShieldAlert,
  Users,
  Key,
  Lock,
  AlertTriangle,
  Wrench,
  CheckCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { useVcisoLabels, useVcisoAwarenessListLabels, type VcisoAwarenessListLabels } from '../_lib/vciso-i18n';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { buildSuiteQueryParams } from '@/lib/suite-api';
import { API_ENDPOINTS } from '@/lib/constants';
import { awarenessStatusConfig, iamFindingStatusConfig } from '@/lib/status-configs';
import { formatDate, truncate, titleCase } from '@/lib/format';
import { chartVar, statusVar } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/api';
import type { FilterConfig, RowAction } from '@/types/table';
import type {
  VCISOAwarenessProgram,
  VCISOIAMFinding,
  VCISOIAMSummary,
} from '@/types/cyber';

import { AwarenessFormDialog } from './_components/awareness-form-dialog';
import { AwarenessDetailPanel } from './_components/awareness-detail-panel';
import { IAMFindingDetailPanel } from './_components/iam-finding-detail-panel';

// ── Color constants (token-driven, non-textual) ──────────────────────────────

const IAM_TYPE_COLORS: Record<string, string> = {
  mfa_gap: chartVar(0),
  orphaned_account: chartVar(1),
  privileged_access: chartVar(2),
  sod_violation: chartVar(3),
  stale_access: chartVar(4),
  excessive_permissions: chartVar(5),
};

const AWARENESS_TYPE_BADGE_CLASSES: Record<string, string> = {
  training: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  phishing_simulation: 'bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300',
  policy_attestation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

const IAM_FINDING_TYPE_BADGE_CLASSES: Record<string, string> = {
  mfa_gap: 'bg-error-100 text-error-700 dark:bg-error-700/30 dark:text-error-300',
  orphaned_account: 'bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300',
  privileged_access: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  sod_violation: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
  stale_access: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  excessive_permissions: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
};

// ── Filters ──────────────────────────────────────────────────────────────────

function buildAwarenessFilters(al: VcisoAwarenessListLabels): FilterConfig[] {
  return [
    {
      key: 'type',
      label: al.awarenessFilters.type,
      type: 'select',
      options: [
        { label: al.awarenessFilters.typeOptions.training, value: 'training' },
        { label: al.awarenessFilters.typeOptions.phishing_simulation, value: 'phishing_simulation' },
        { label: al.awarenessFilters.typeOptions.policy_attestation, value: 'policy_attestation' },
      ],
    },
    {
      key: 'status',
      label: al.awarenessFilters.status,
      type: 'select',
      options: [
        { label: al.awarenessFilters.statusOptions.scheduled, value: 'scheduled' },
        { label: al.awarenessFilters.statusOptions.active, value: 'active' },
        { label: al.awarenessFilters.statusOptions.completed, value: 'completed' },
      ],
    },
  ];
}

function buildIamFilters(al: VcisoAwarenessListLabels): FilterConfig[] {
  return [
    {
      key: 'type',
      label: al.iamFilters.type,
      type: 'select',
      options: [
        { label: al.iamFilters.typeOptions.mfa_gap, value: 'mfa_gap' },
        { label: al.iamFilters.typeOptions.orphaned_account, value: 'orphaned_account' },
        { label: al.iamFilters.typeOptions.privileged_access, value: 'privileged_access' },
        { label: al.iamFilters.typeOptions.sod_violation, value: 'sod_violation' },
        { label: al.iamFilters.typeOptions.stale_access, value: 'stale_access' },
        { label: al.iamFilters.typeOptions.excessive_permissions, value: 'excessive_permissions' },
      ],
    },
    {
      key: 'severity',
      label: al.iamFilters.severity,
      type: 'select',
      options: [
        { label: al.iamFilters.severityOptions.critical, value: 'critical' },
        { label: al.iamFilters.severityOptions.high, value: 'high' },
        { label: al.iamFilters.severityOptions.medium, value: 'medium' },
        { label: al.iamFilters.severityOptions.low, value: 'low' },
        { label: al.iamFilters.severityOptions.info, value: 'info' },
      ],
    },
    {
      key: 'status',
      label: al.iamFilters.status,
      type: 'select',
      options: [
        { label: al.iamFilters.statusOptions.open, value: 'open' },
        { label: al.iamFilters.statusOptions.in_progress, value: 'in_progress' },
        { label: al.iamFilters.statusOptions.resolved, value: 'resolved' },
        { label: al.iamFilters.statusOptions.accepted, value: 'accepted' },
      ],
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function completionColor(rate: number): string {
  const pct = rate * 100;
  if (pct >= 80) return 'text-primary';
  if (pct >= 60) return 'text-warning-700 dark:text-warning-300';
  return 'text-status-error';
}

function passRateColor(rate: number): string {
  const pct = rate * 100;
  if (pct >= 90) return 'text-primary';
  if (pct >= 70) return 'text-warning-700 dark:text-warning-300';
  return 'text-status-error';
}

// ── Columns ──────────────────────────────────────────────────────────────────

function getAwarenessColumns(al: VcisoAwarenessListLabels): ColumnDef<VCISOAwarenessProgram>[] {
  const typeLabels = al.awarenessFilters.typeOptions as Record<string, string>;
  return [
    {
      accessorKey: 'name',
      header: al.awarenessColumns.name,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'type',
      header: al.awarenessColumns.type,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            'text-xs',
            AWARENESS_TYPE_BADGE_CLASSES[row.original.type] ?? '',
          )}
        >
          {typeLabels[row.original.type] ?? titleCase(row.original.type)}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: al.awarenessColumns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={awarenessStatusConfig} />
      ),
    },
    {
      accessorKey: 'total_users',
      header: al.awarenessColumns.totalUsers,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.total_users.toLocaleString()}</span>
      ),
    },
    {
      accessorKey: 'completion_rate',
      header: al.awarenessColumns.completionRate,
      enableSorting: true,
      cell: ({ row }) => {
        const pct = Math.round(row.original.completion_rate * 100);
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  pct >= 80
                    ? 'bg-primary'
                    : pct >= 60
                      ? 'bg-severity-medium'
                      : 'bg-severity-critical',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={cn('text-xs font-medium tabular-nums', completionColor(row.original.completion_rate))}>
              {pct}%
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'pass_rate',
      header: al.awarenessColumns.passRate,
      enableSorting: true,
      cell: ({ row }) => {
        const pct = Math.round(row.original.pass_rate * 100);
        return (
          <span className={cn('text-sm font-medium', passRateColor(row.original.pass_rate))}>
            {pct}%
          </span>
        );
      },
    },
    {
      accessorKey: 'start_date',
      header: al.awarenessColumns.startDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.start_date)}
        </span>
      ),
    },
    {
      accessorKey: 'end_date',
      header: al.awarenessColumns.endDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.end_date)}
        </span>
      ),
    },
  ];
}

function getIAMFindingColumns(al: VcisoAwarenessListLabels): ColumnDef<VCISOIAMFinding>[] {
  const typeLabels = al.iamTypeChart as Record<string, string>;
  return [
    {
      accessorKey: 'title',
      header: al.iamColumns.title,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.title}</span>
      ),
    },
    {
      accessorKey: 'type',
      header: al.iamColumns.type,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            'text-xs',
            IAM_FINDING_TYPE_BADGE_CLASSES[row.original.type] ?? '',
          )}
        >
          {typeLabels[row.original.type] ?? titleCase(row.original.type)}
        </Badge>
      ),
    },
    {
      accessorKey: 'severity',
      header: al.iamColumns.severity,
      enableSorting: true,
      cell: ({ row }) => (
        <SeverityIndicator severity={row.original.severity as Severity} />
      ),
    },
    {
      accessorKey: 'affected_users',
      header: al.iamColumns.affectedUsers,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.affected_users.toLocaleString()}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: al.iamColumns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={iamFindingStatusConfig} />
      ),
    },
    {
      accessorKey: 'remediation',
      header: al.iamColumns.remediation,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground max-w-[120px] sm:max-w-[200px] truncate block">
          {row.original.remediation ? truncate(row.original.remediation, 60) : '--'}
        </span>
      ),
    },
    {
      accessorKey: 'discovered_at',
      header: al.iamColumns.discoveredAt,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.discovered_at)}
        </span>
      ),
    },
  ];
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AwarenessIAMPage() {
  const tv = useVcisoLabels();
  const al = useVcisoAwarenessListLabels();
  // Awareness state
  const [selectedProgram, setSelectedProgram] = useState<VCISOAwarenessProgram | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editProgram, setEditProgram] = useState<VCISOAwarenessProgram | null>(null);

  // IAM state
  const [selectedFinding, setSelectedFinding] = useState<VCISOIAMFinding | null>(null);

  // ── IAM Summary ────────────────────────────────────────────
  const {
    data: iamSummaryEnvelope,
    isLoading: iamSummaryLoading,
    error: iamSummaryError,
    mutate: refetchIAMSummary,
  } = useRealtimeData<{ data: VCISOIAMSummary }>(API_ENDPOINTS.CYBER_VCISO_IAM_SUMMARY, {
    wsTopics: ['vciso.iam'],
  });
  const iamSummary = iamSummaryEnvelope?.data;

  // ── Awareness Table ────────────────────────────────────────
  const {
    tableProps: awarenessTableProps,
    refetch: refetchAwareness,
  } = useDataTable<VCISOAwarenessProgram>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOAwarenessProgram>>(
        API_ENDPOINTS.CYBER_VCISO_AWARENESS,
        buildSuiteQueryParams(params),
      ),
    queryKey: 'vciso-awareness',
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['vciso.awareness'],
  });

  // ── IAM Findings Table ─────────────────────────────────────
  const {
    tableProps: iamTableProps,
    refetch: refetchIAM,
  } = useDataTable<VCISOIAMFinding>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOIAMFinding>>(
        API_ENDPOINTS.CYBER_VCISO_IAM_FINDINGS,
        buildSuiteQueryParams(params),
      ),
    queryKey: 'vciso-iam-findings',
    defaultSort: { column: 'discovered_at', direction: 'desc' },
    wsTopics: ['vciso.iam'],
  });

  // ── IAM Mutations ──────────────────────────────────────────
  const remediateMutation = useApiMutation<VCISOIAMFinding, Record<string, unknown>>(
    'put',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_IAM_FINDINGS}/${(variables as Record<string, string>).id}`,
    {
      successMessage: al.toasts.remediating,
      invalidateKeys: ['vciso-iam-findings', API_ENDPOINTS.CYBER_VCISO_IAM_SUMMARY],
      onSuccess: () => {
        refetchIAM();
        void refetchIAMSummary();
      },
    },
  );

  const acceptMutation = useApiMutation<VCISOIAMFinding, Record<string, unknown>>(
    'put',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_IAM_FINDINGS}/${(variables as Record<string, string>).id}`,
    {
      successMessage: al.toasts.accepted,
      invalidateKeys: ['vciso-iam-findings', API_ENDPOINTS.CYBER_VCISO_IAM_SUMMARY],
      onSuccess: () => {
        refetchIAM();
        void refetchIAMSummary();
      },
    },
  );

  // ── Columns ────────────────────────────────────────────────
  const awarenessColumns = useMemo(() => getAwarenessColumns(al), [al]);
  const iamColumns = useMemo(() => getIAMFindingColumns(al), [al]);
  const awarenessFilters = useMemo(() => buildAwarenessFilters(al), [al]);
  const iamFilters = useMemo(() => buildIamFilters(al), [al]);

  // ── Awareness Row Actions ──────────────────────────────────
  const awarenessRowActions: RowAction<VCISOAwarenessProgram>[] = [
    {
      label: al.awarenessActions.viewDetails,
      icon: Eye,
      onClick: (row) => setSelectedProgram(row),
    },
    {
      label: al.awarenessActions.edit,
      icon: Edit,
      onClick: (row) => {
        setEditProgram(row);
        setShowCreateDialog(true);
      },
    },
  ];

  // ── IAM Row Actions ────────────────────────────────────────
  const iamRowActions: RowAction<VCISOIAMFinding>[] = [
    {
      label: al.iamActions.view,
      icon: Eye,
      onClick: (row) => setSelectedFinding(row),
    },
    {
      label: al.iamActions.remediate,
      icon: Wrench,
      onClick: (row) => remediateMutation.mutate({ id: row.id, status: 'in_progress' }),
      hidden: (row) => row.status === 'resolved' || row.status === 'in_progress',
    },
    {
      label: al.iamActions.accept,
      icon: CheckCircle,
      onClick: (row) => acceptMutation.mutate({ id: row.id, status: 'accepted' }),
      hidden: (row) => row.status === 'accepted' || row.status === 'resolved',
    },
  ];

  // ── IAM PieChart data ──────────────────────────────────────
  const iamPieData = useMemo(() => {
    if (!iamSummary?.by_type) return [];
    const chartLabels = al.iamTypeChart as Record<string, string>;
    return Object.entries(iamSummary.by_type)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({
        name: chartLabels[type] ?? titleCase(type),
        value: count,
        color: IAM_TYPE_COLORS[type] ?? statusVar('neutral'),
      }));
  }, [iamSummary, al]);

  const handleRefreshAll = () => {
    refetchAwareness();
    refetchIAM();
    void refetchIAMSummary();
  };

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={tv.pages.awareness.title}
          description={tv.pages.awareness.description}
          actions={
            <Button onClick={() => { setEditProgram(null); setShowCreateDialog(true); }}>
              <Plus className="me-2 h-4 w-4" />
              {al.createProgram}
            </Button>
          }
        />

        <Tabs defaultValue="awareness" className="space-y-4">
          <TabsList>
            <TabsTrigger value="awareness">{al.tabs.awareness}</TabsTrigger>
            <TabsTrigger value="iam">{al.tabs.iam}</TabsTrigger>
          </TabsList>

          {/* ── Security Awareness Tab ───────────────────────────── */}
          <TabsContent value="awareness" className="space-y-4">
            <DataTable
              columns={awarenessColumns}
              filters={awarenessFilters}
              rowActions={awarenessRowActions}
              searchPlaceholder={al.search.awareness}
              emptyState={{
                icon: BookOpen,
                title: al.empty.awarenessTitle,
                description: al.empty.awarenessDesc,
                action: {
                  label: al.createProgram,
                  onClick: () => { setEditProgram(null); setShowCreateDialog(true); },
                  icon: Plus,
                },
              }}
              onRowClick={(row) => setSelectedProgram(row)}
              getRowId={(row) => row.id}
              enableColumnToggle
              stickyHeader
              {...awarenessTableProps}
            />
          </TabsContent>

          {/* ── Identity & Access Governance Tab ─────────────────── */}
          <TabsContent value="iam" className="space-y-6">
            {/* KPI Row */}
            {iamSummaryError ? (
              <ErrorState
                message={al.iamError}
                onRetry={() => void refetchIAMSummary()}
              />
            ) : iamSummaryLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <LoadingSkeleton key={i} variant="card" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* MFA Coverage Gauge */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        {al.charts.mfaCoverage}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                      <GaugeChart
                        value={iamSummary?.mfa_coverage_percent ?? 0}
                        max={100}
                        thresholds={{ good: 80, warning: 60 }}
                        label={al.charts.coverage}
                        size={160}
                        format="percentage"
                      />
                    </CardContent>
                  </Card>

                  <KpiCard
                    title={tv.pages.awareness.privilegedAccounts}
                    value={iamSummary?.privileged_accounts ?? 0}
                    icon={Key}
                    tone="sky"
                    description={tv.pages.awareness.privilegedDesc}
                  />

                  <KpiCard
                    title={tv.pages.awareness.orphanedAccounts}
                    value={iamSummary?.orphaned_accounts ?? 0}
                    icon={Users}
                    tone="rose"
                    description={tv.pages.awareness.orphanedDesc}
                    className={
                      (iamSummary?.orphaned_accounts ?? 0) > 0
                        ? 'border-warning-300 dark:border-warning-800'
                        : ''
                    }
                  />

                  <KpiCard
                    title={tv.pages.awareness.staleAccess}
                    value={iamSummary?.stale_access_count ?? 0}
                    icon={AlertTriangle}
                    tone="rose"
                    description={tv.pages.awareness.staleDesc}
                    className={
                      (iamSummary?.stale_access_count ?? 0) > 0
                        ? 'border-error-100 dark:border-error-700'
                        : ''
                    }
                  />
                </div>

                {/* Findings by Type Chart */}
                {iamPieData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                        {al.charts.findingsByType}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <PieChart
                        data={iamPieData}
                        innerRadius={50}
                        outerRadius={90}
                        height={240}
                        showLegend
                        centerValue={String(iamSummary?.total_findings ?? 0)}
                        centerLabel={al.charts.total}
                      />
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {/* IAM Findings Table */}
            <DataTable
              columns={iamColumns}
              filters={iamFilters}
              rowActions={iamRowActions}
              searchPlaceholder={al.search.iam}
              emptyState={{
                icon: ShieldAlert,
                title: al.empty.iamTitle,
                description: al.empty.iamDesc,
              }}
              onRowClick={(row) => setSelectedFinding(row)}
              getRowId={(row) => row.id}
              enableColumnToggle
              stickyHeader
              {...iamTableProps}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Awareness Detail Panel ───────────────────────────── */}
      {selectedProgram && (
        <AwarenessDetailPanel
          open={!!selectedProgram}
          onOpenChange={(o) => {
            if (!o) setSelectedProgram(null);
          }}
          program={selectedProgram}
        />
      )}

      {/* ── Create/Edit Program Dialog ───────────────────────── */}
      <AwarenessFormDialog
        open={showCreateDialog}
        onOpenChange={(o) => {
          setShowCreateDialog(o);
          if (!o) setEditProgram(null);
        }}
        onCreated={handleRefreshAll}
        program={editProgram}
      />

      {/* ── IAM Finding Detail Panel ─────────────────────────── */}
      {selectedFinding && (
        <IAMFindingDetailPanel
          open={!!selectedFinding}
          onOpenChange={(o) => {
            if (!o) setSelectedFinding(null);
          }}
          finding={selectedFinding}
        />
      )}
    </PermissionRedirect>
  );
}
