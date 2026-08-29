'use client';

import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ShieldAlert,
  Plus,
  Eye,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Target,
  TrendingDown,
  Building2,
  BarChart3,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { useVcisoLabels, useVcisoRiskListLabels, type VcisoRiskListLabels } from '../_lib/vciso-i18n';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { buildSuiteQueryParams } from '@/lib/suite-api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { riskStatusConfig, riskTreatmentConfig } from '@/lib/status-configs';
import type { PaginatedResponse } from '@/types/api';
import type { FilterConfig, RowAction } from '@/types/table';
import type {
  VCISORiskEntry,
  VCISORiskStats,
} from '@/types/cyber';

import { RiskDetailPanel } from './_components/risk-detail-panel';
import { RiskFormDialog } from './_components/risk-form-dialog';
import { RiskAcceptanceDialog } from './_components/risk-acceptance-dialog';

// ── Helpers ──────────────────────────────────────────────────────────────────

function residualScoreColor(score: number): string {
  if (score <= 30) return 'bg-primary/15 text-primary';
  if (score <= 60) return 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300';
  return 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300';
}

// ── Filters ──────────────────────────────────────────────────────────────────

function buildRiskFilters(tl: VcisoRiskListLabels): FilterConfig[] {
  return [
    {
      key: 'status',
      label: tl.filters.status,
      type: 'select',
      options: [
        { label: tl.filters.statusOptions.open, value: 'open' },
        { label: tl.filters.statusOptions.mitigated, value: 'mitigated' },
        { label: tl.filters.statusOptions.accepted, value: 'accepted' },
        { label: tl.filters.statusOptions.closed, value: 'closed' },
      ],
    },
    {
      key: 'treatment',
      label: tl.filters.treatment,
      type: 'select',
      options: [
        { label: tl.filters.treatmentOptions.mitigate, value: 'mitigate' },
        { label: tl.filters.treatmentOptions.transfer, value: 'transfer' },
        { label: tl.filters.treatmentOptions.accept, value: 'accept' },
        { label: tl.filters.treatmentOptions.avoid, value: 'avoid' },
      ],
    },
    {
      key: 'likelihood',
      label: tl.filters.likelihood,
      type: 'select',
      options: [
        { label: tl.filters.levelOptions.low, value: 'low' },
        { label: tl.filters.levelOptions.medium, value: 'medium' },
        { label: tl.filters.levelOptions.high, value: 'high' },
        { label: tl.filters.levelOptions.critical, value: 'critical' },
      ],
    },
    {
      key: 'impact',
      label: tl.filters.impact,
      type: 'select',
      options: [
        { label: tl.filters.levelOptions.low, value: 'low' },
        { label: tl.filters.levelOptions.medium, value: 'medium' },
        { label: tl.filters.levelOptions.high, value: 'high' },
        { label: tl.filters.levelOptions.critical, value: 'critical' },
      ],
    },
  ];
}

// ── Columns ──────────────────────────────────────────────────────────────────

function levelLabel(tl: VcisoRiskListLabels, value: string): string {
  const map = tl.filters.levelOptions as Record<string, string>;
  return map[value] ?? value;
}

function getRiskColumns(tl: VcisoRiskListLabels): ColumnDef<VCISORiskEntry>[] {
  return [
    {
      accessorKey: 'title',
      header: tl.columns.title,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.title}</span>
      ),
    },
    {
      accessorKey: 'category',
      header: tl.columns.category,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.category}
        </Badge>
      ),
    },
    {
      accessorKey: 'likelihood',
      header: tl.columns.likelihood,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{levelLabel(tl, row.original.likelihood)}</span>
      ),
    },
    {
      accessorKey: 'impact',
      header: tl.columns.impact,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{levelLabel(tl, row.original.impact)}</span>
      ),
    },
    {
      accessorKey: 'inherent_score',
      header: tl.columns.inherent,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.inherent_score}</span>
      ),
    },
    {
      accessorKey: 'residual_score',
      header: tl.columns.residual,
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold',
            residualScoreColor(row.original.residual_score),
          )}
        >
          {row.original.residual_score}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: tl.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={riskStatusConfig} />
      ),
    },
    {
      accessorKey: 'treatment',
      header: tl.columns.treatment,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.treatment} config={riskTreatmentConfig} />
      ),
    },
    {
      accessorKey: 'owner_name',
      header: tl.columns.owner,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.owner_name || tl.unassigned}</span>
      ),
    },
    {
      accessorKey: 'review_date',
      header: tl.columns.reviewDate,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.review_date ? formatDate(row.original.review_date) : '--'}
        </span>
      ),
    },
  ];
}

function getAcceptanceColumns(tl: VcisoRiskListLabels): ColumnDef<VCISORiskEntry>[] {
  return [
    {
      accessorKey: 'title',
      header: tl.columns.title,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.title}</span>
      ),
    },
    {
      accessorKey: 'category',
      header: tl.columns.category,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.category}
        </Badge>
      ),
    },
    {
      accessorKey: 'residual_score',
      header: tl.columns.residualScore,
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold',
            residualScoreColor(row.original.residual_score),
          )}
        >
          {row.original.residual_score}
        </span>
      ),
    },
    {
      accessorKey: 'acceptance_rationale',
      header: tl.columns.rationale,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground max-w-[160px] sm:max-w-[250px] truncate block">
          {row.original.acceptance_rationale || '--'}
        </span>
      ),
    },
    {
      accessorKey: 'acceptance_approved_by_name',
      header: tl.columns.approvedBy,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.acceptance_approved_by_name || '--'}
        </span>
      ),
    },
    {
      accessorKey: 'acceptance_expiry',
      header: tl.columns.expiry,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.acceptance_expiry
            ? formatDate(row.original.acceptance_expiry)
            : tl.noExpiry}
        </span>
      ),
    },
    {
      accessorKey: 'owner_name',
      header: tl.columns.owner,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.owner_name || tl.unassigned}</span>
      ),
    },
  ];
}

// ── Likelihood / Impact score mapping for heat matrix ────────────────────────

const LIKELIHOOD_VALUES = ['low', 'medium', 'high', 'critical'];
const IMPACT_VALUES = ['low', 'medium', 'high', 'critical'];

function getHeatColor(likelihoodIdx: number, impactIdx: number): string {
  const score = (likelihoodIdx + 1) * (impactIdx + 1);
  if (score <= 4) return 'bg-primary/15 text-primary border-primary/30';
  if (score <= 9) return 'bg-warning-100 text-warning-700 border-warning-300 dark:bg-warning-800/40 dark:text-warning-300 dark:border-warning-800';
  if (score <= 16) return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900';
  return 'bg-error-100 text-error-700 border-error-100 dark:bg-error-700/40 dark:text-error-300 dark:border-error-700';
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function RiskRegisterPage() {
  const tv = useVcisoLabels();
  const tl = useVcisoRiskListLabels();
  const [selectedRisk, setSelectedRisk] = useState<VCISORiskEntry | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [acceptTarget, setAcceptTarget] = useState<VCISORiskEntry | null>(null);
  const [closeTarget, setCloseTarget] = useState<VCISORiskEntry | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<VCISORiskEntry | null>(null);

  const levelLabels = useMemo(
    () => [
      tl.filters.levelOptions.low,
      tl.filters.levelOptions.medium,
      tl.filters.levelOptions.high,
      tl.filters.levelOptions.critical,
    ],
    [tl],
  );

  // ── Stats ───────────────────────────────────────────────
  const {
    data: statsEnvelope,
    isLoading: statsLoading,
  } = useRealtimeData<{ data: VCISORiskStats }>(API_ENDPOINTS.CYBER_VCISO_RISKS_STATS, {
    wsTopics: ['vciso.risks'],
  });
  const stats = statsEnvelope?.data;

  // ── Risk Register Table ─────────────────────────────────
  const {
    tableProps,
    refetch,
  } = useDataTable<VCISORiskEntry>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISORiskEntry>>(
        API_ENDPOINTS.CYBER_VCISO_RISKS,
        buildSuiteQueryParams(params),
      ),
    queryKey: 'vciso-risks',
    defaultSort: { column: 'residual_score', direction: 'desc' },
    wsTopics: ['vciso.risks'],
  });

  // ── Acceptance Table (filtered by status=accepted) ──────
  const {
    tableProps: acceptanceTableProps,
    refetch: refetchAcceptance,
  } = useDataTable<VCISORiskEntry>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISORiskEntry>>(
        API_ENDPOINTS.CYBER_VCISO_RISKS,
        {
          ...buildSuiteQueryParams(params),
          status: 'accepted',
        },
      ),
    queryKey: 'vciso-risks-accepted',
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['vciso.risks'],
  });

  // ── Business Impact data ────────────────────────────────
  const {
    data: allRisksData,
    isLoading: allRisksLoading,
    error: allRisksError,
    mutate: refetchAllRisks,
  } = useRealtimeData<PaginatedResponse<VCISORiskEntry>>(API_ENDPOINTS.CYBER_VCISO_RISKS, {
    params: { per_page: 500 },
    wsTopics: ['vciso.risks'],
  });

  // ── Close risk mutation ─────────────────────────────────
  const closeMutation = useApiMutation<VCISORiskEntry, Record<string, unknown>>(
    'put',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_RISKS}/${(variables as Record<string, string>).id}`,
    {
      successMessage: tl.toasts.closed,
      invalidateKeys: ['vciso-risks', 'vciso-risks-accepted', API_ENDPOINTS.CYBER_VCISO_RISKS_STATS],
      onSuccess: () => {
        setCloseTarget(null);
        refetch();
      },
    },
  );

  // ── Revoke acceptance mutation ──────────────────────────
  const revokeMutation = useApiMutation<VCISORiskEntry, Record<string, unknown>>(
    'put',
    (variables) => `${API_ENDPOINTS.CYBER_VCISO_RISKS}/${(variables as Record<string, string>).id}`,
    {
      successMessage: tl.toasts.revoked,
      invalidateKeys: ['vciso-risks', 'vciso-risks-accepted', API_ENDPOINTS.CYBER_VCISO_RISKS_STATS],
      onSuccess: () => {
        setRevokeTarget(null);
        refetch();
        refetchAcceptance();
      },
    },
  );

  // ── Columns ─────────────────────────────────────────────
  const riskColumns = useMemo(() => getRiskColumns(tl), [tl]);
  const acceptanceColumns = useMemo(() => getAcceptanceColumns(tl), [tl]);
  const riskFilters = useMemo(() => buildRiskFilters(tl), [tl]);

  // ── Row actions ─────────────────────────────────────────
  const riskRowActions: RowAction<VCISORiskEntry>[] = [
    {
      label: tl.actions.viewDetails,
      icon: Eye,
      onClick: (row) => setSelectedRisk(row),
    },
    {
      label: tl.actions.acceptRisk,
      icon: CheckCircle,
      onClick: (row) => setAcceptTarget(row),
      hidden: (row) => row.status === 'accepted' || row.status === 'closed',
    },
    {
      label: tl.actions.closeRisk,
      icon: XCircle,
      variant: 'destructive',
      onClick: (row) => setCloseTarget(row),
      hidden: (row) => row.status === 'closed',
    },
  ];

  const acceptanceRowActions: RowAction<VCISORiskEntry>[] = [
    {
      label: tl.actions.viewDetails,
      icon: Eye,
      onClick: (row) => setSelectedRisk(row),
    },
    {
      label: tl.actions.revokeAcceptance,
      icon: XCircle,
      variant: 'destructive',
      onClick: (row) => setRevokeTarget(row),
    },
  ];

  // ── Business Impact: group by department ────────────────
  const departmentGroups = useMemo(() => {
    const risks = allRisksData?.data ?? [];
    const groups = new Map<string, VCISORiskEntry[]>();
    for (const risk of risks) {
      const dept = risk.department || tl.unassigned;
      const existing = groups.get(dept);
      if (existing) {
        existing.push(risk);
      } else {
        groups.set(dept, [risk]);
      }
    }
    return Array.from(groups.entries())
      .sort(([, a], [, b]) => b.length - a.length);
  }, [allRisksData, tl.unassigned]);

  // ── Heat matrix data ───────────────────────────────────
  const heatMatrix = useMemo(() => {
    const risks = allRisksData?.data ?? [];
    const matrix: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
    for (const risk of risks) {
      const li = LIKELIHOOD_VALUES.indexOf(risk.likelihood);
      const ii = IMPACT_VALUES.indexOf(risk.impact);
      if (li >= 0 && ii >= 0) {
        matrix[li][ii]++;
      }
    }
    return matrix;
  }, [allRisksData]);

  const handleRefreshAll = () => {
    refetch();
    refetchAcceptance();
    void refetchAllRisks();
  };

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          title={tv.pages.riskRegister.title}
          description={tv.pages.riskRegister.description}
          actions={
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="me-2 h-4 w-4" />
              {tl.addRisk}
            </Button>
          }
        />

        {/* KPI Stats Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={tv.pages.riskRegister.totalRisks}
            value={stats?.total ?? 0}
            icon={ShieldAlert}
            tone="sky"
            loading={statsLoading}
            description={tv.pages.riskRegister.totalRisksDesc}
          />
          <KpiCard
            title={tv.pages.riskRegister.avgResidualScore}
            value={stats?.avg_residual_score?.toFixed(1) ?? '0'}
            icon={Target}
            tone="rose"
            loading={statsLoading}
            description={tv.pages.riskRegister.avgResidualDesc}
          />
          <KpiCard
            title={tv.pages.riskRegister.overdueReviews}
            value={stats?.overdue_reviews ?? 0}
            icon={Clock}
            tone="rose"
            loading={statsLoading}
            description={tv.pages.riskRegister.overdueDesc}
          />
          <KpiCard
            title={tv.pages.riskRegister.acceptedRisks}
            value={stats?.accepted_count ?? 0}
            icon={CheckCircle}
            tone="emerald"
            loading={statsLoading}
            description={tv.pages.riskRegister.acceptedDesc}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="register" className="space-y-4">
          <TabsList>
            <TabsTrigger value="register">{tl.tabs.register}</TabsTrigger>
            <TabsTrigger value="acceptance">{tl.tabs.acceptance}</TabsTrigger>
            <TabsTrigger value="impact">{tl.tabs.impact}</TabsTrigger>
          </TabsList>

          {/* ── Risk Register Tab ──────────────────────────────── */}
          <TabsContent value="register" className="space-y-4">
            <DataTable
              columns={riskColumns}
              filters={riskFilters}
              rowActions={riskRowActions}
              searchPlaceholder={tl.search.risks}
              emptyState={{
                icon: ShieldAlert,
                title: tl.empty.risksTitle,
                description: tl.empty.risksDesc,
                action: {
                  label: tl.addRisk,
                  onClick: () => setShowCreateDialog(true),
                  icon: Plus,
                },
              }}
              onRowClick={(row) => setSelectedRisk(row)}
              getRowId={(row) => row.id}
              enableColumnToggle
              stickyHeader
              {...tableProps}
            />
          </TabsContent>

          {/* ── Risk Acceptance Tab ────────────────────────────── */}
          <TabsContent value="acceptance" className="space-y-4">
            <DataTable
              columns={acceptanceColumns}
              rowActions={acceptanceRowActions}
              searchPlaceholder={tl.search.accepted}
              emptyState={{
                icon: CheckCircle,
                title: tl.empty.acceptedTitle,
                description: tl.empty.acceptedDesc,
              }}
              onRowClick={(row) => setSelectedRisk(row)}
              getRowId={(row) => row.id}
              enableColumnToggle
              stickyHeader
              {...acceptanceTableProps}
            />
          </TabsContent>

          {/* ── Business Impact Tab ───────────────────────────── */}
          <TabsContent value="impact" className="space-y-6">
            {allRisksError ? (
              <ErrorState
                message={tl.impact.failedLoad}
                onRetry={() => void refetchAllRisks()}
              />
            ) : allRisksLoading ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <>
                {/* Risk Heat Matrix */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BarChart3 className="h-5 w-5 text-muted-foreground" />
                      {tl.impact.heatMatrix}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="p-2 text-xs text-muted-foreground text-start">
                              {tl.impact.likelihoodImpact}
                            </th>
                            {levelLabels.map((label) => (
                              <th
                                key={`impact-${label}`}
                                className="p-2 text-xs font-medium text-center text-muted-foreground min-w-[90px]"
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {levelLabels.slice()
                            .reverse()
                            .map((label, reversedIdx) => {
                              const likelihoodIdx = 4 - reversedIdx;
                              return (
                                <tr key={`likelihood-${label}`}>
                                  <td className="p-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                                    {label}
                                  </td>
                                  {levelLabels.map((impactLabel, impactIdx) => {
                                    const count = heatMatrix[likelihoodIdx][impactIdx];
                                    return (
                                      <td key={`cell-${impactLabel}`} className="p-1">
                                        <div
                                          className={cn(
                                            'flex items-center justify-center rounded-lg border p-3 text-sm font-bold transition-colors',
                                            count > 0
                                              ? getHeatColor(likelihoodIdx, impactIdx)
                                              : 'bg-muted/30 text-muted-foreground border-transparent',
                                          )}
                                        >
                                          {count}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Department Groups */}
                <div className="space-y-4">
                  <h3 className="text-h4 font-semibold flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    {tl.impact.risksByDept}
                  </h3>

                  {departmentGroups.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center text-muted-foreground text-sm">
                        {tl.impact.noRisksDisplay}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {departmentGroups.map(([department, risks]) => {
                        const avgResidual =
                          risks.length > 0
                            ? risks.reduce((sum, r) => sum + r.residual_score, 0) / risks.length
                            : 0;
                        const criticalCount = risks.filter(
                          (r) => r.residual_score > 60,
                        ).length;
                        const services = new Set<string>();
                        for (const r of risks) {
                          for (const s of r.business_services) {
                            services.add(s);
                          }
                        }

                        return (
                          <Card key={department}>
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-semibold">
                                  {department}
                                </CardTitle>
                                <Badge variant="secondary" className="text-xs">
                                  {tl.riskCount(risks.length)}
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                                <div>
                                  <p className="text-xs text-muted-foreground">{tl.impact.avgResidual}</p>
                                  <p
                                    className={cn(
                                      'text-lg font-bold',
                                      avgResidual <= 30
                                        ? 'text-primary'
                                        : avgResidual <= 60
                                          ? 'text-warning-700 dark:text-warning-300'
                                          : 'text-status-error',
                                    )}
                                  >
                                    {avgResidual.toFixed(1)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">{tl.impact.critical}</p>
                                  <p
                                    className={cn(
                                      'text-lg font-bold',
                                      criticalCount > 0
                                        ? 'text-status-error'
                                        : 'text-primary',
                                    )}
                                  >
                                    {criticalCount}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">{tl.impact.services}</p>
                                  <p className="text-lg font-bold text-status-info">
                                    {services.size}
                                  </p>
                                </div>
                              </div>

                              {services.size > 0 && (
                                <>
                                  <Separator />
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1.5">
                                      {tl.impact.businessServices}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                      {Array.from(services)
                                        .slice(0, 5)
                                        .map((s) => (
                                          <Badge
                                            key={s}
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {s}
                                          </Badge>
                                        ))}
                                      {services.size > 5 && (
                                        <Badge variant="secondary" className="text-xs">
                                          {tl.moreCount(services.size - 5)}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* Top risks in department */}
                              <Separator />
                              <div>
                                <p className="text-xs text-muted-foreground mb-1.5">
                                  {tl.impact.topRisks}
                                </p>
                                <div className="space-y-1.5">
                                  {risks
                                    .sort((a, b) => b.residual_score - a.residual_score)
                                    .slice(0, 3)
                                    .map((r) => (
                                      <div
                                        key={r.id}
                                        className="flex items-center justify-between text-sm cursor-pointer hover:bg-muted/40 rounded-lg px-2 py-1 transition-colors"
                                        onClick={() => setSelectedRisk(r)}
                                      >
                                        <span className="truncate me-2">{r.title}</span>
                                        <span
                                          className={cn(
                                            'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold',
                                            residualScoreColor(r.residual_score),
                                          )}
                                        >
                                          {r.residual_score}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Detail Panel ──────────────────────────────────────── */}
      {selectedRisk && (
        <RiskDetailPanel
          open={!!selectedRisk}
          onOpenChange={(o) => {
            if (!o) setSelectedRisk(null);
          }}
          risk={selectedRisk}
          onUpdated={handleRefreshAll}
        />
      )}

      {/* ── Create Dialog ─────────────────────────────────────── */}
      <RiskFormDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleRefreshAll}
      />

      {/* ── Accept Risk Dialog ────────────────────────────────── */}
      {acceptTarget && (
        <RiskAcceptanceDialog
          open={!!acceptTarget}
          onOpenChange={(o) => {
            if (!o) setAcceptTarget(null);
          }}
          risk={acceptTarget}
          onAccepted={handleRefreshAll}
        />
      )}

      {/* ── Close Risk Confirm ────────────────────────────────── */}
      <ConfirmDialog
        open={!!closeTarget}
        onOpenChange={(o) => {
          if (!o) setCloseTarget(null);
        }}
        title={tv.pages.riskRegister.closeRisk}
        description={tl.confirm.closeDesc(closeTarget?.title ?? '')}
        confirmLabel={tv.pages.riskRegister.closeRisk}
        variant="destructive"
        loading={closeMutation.isPending}
        onConfirm={async () => {
          if (closeTarget) {
            closeMutation.mutate({
              id: closeTarget.id,
              title: closeTarget.title,
              description: closeTarget.description,
              category: closeTarget.category,
              department: closeTarget.department,
              inherent_score: closeTarget.inherent_score,
              residual_score: closeTarget.residual_score,
              likelihood: closeTarget.likelihood,
              impact: closeTarget.impact,
              treatment: closeTarget.treatment,
              owner_id: closeTarget.owner_id || undefined,
              owner_name: closeTarget.owner_name,
              review_date: closeTarget.review_date || undefined,
              business_services: closeTarget.business_services,
              controls: closeTarget.controls,
              tags: closeTarget.tags,
              treatment_plan: closeTarget.treatment_plan,
              acceptance_rationale: closeTarget.acceptance_rationale || undefined,
              acceptance_expiry: closeTarget.acceptance_expiry || undefined,
              status: 'closed',
            });
          }
        }}
      />

      {/* ── Revoke Acceptance Confirm ─────────────────────────── */}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(o) => {
          if (!o) setRevokeTarget(null);
        }}
        title={tv.pages.riskRegister.revokeAcceptance}
        description={tl.confirm.revokeDesc(revokeTarget?.title ?? '')}
        confirmLabel={tl.actions.revokeAcceptance}
        variant="destructive"
        loading={revokeMutation.isPending}
        onConfirm={async () => {
          if (revokeTarget) {
            revokeMutation.mutate({
              id: revokeTarget.id,
              title: revokeTarget.title,
              description: revokeTarget.description,
              category: revokeTarget.category,
              department: revokeTarget.department,
              inherent_score: revokeTarget.inherent_score,
              residual_score: revokeTarget.residual_score,
              likelihood: revokeTarget.likelihood,
              impact: revokeTarget.impact,
              treatment: revokeTarget.treatment,
              owner_id: revokeTarget.owner_id || undefined,
              owner_name: revokeTarget.owner_name,
              review_date: revokeTarget.review_date || undefined,
              business_services: revokeTarget.business_services,
              controls: revokeTarget.controls,
              tags: revokeTarget.tags,
              treatment_plan: revokeTarget.treatment_plan,
              status: 'open',
            });
          }
        }}
      />
    </PermissionRedirect>
  );
}
