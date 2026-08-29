'use client';

import { useState } from 'react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import {
  BookOpen,
  CheckCircle2,
  Edit3,
  FlaskConical,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PolicyEditorForm } from '../_components/policy-editor-form';
import { PolicyImpactPreview } from '../_components/policy-impact-preview';
import { useDspmLabels } from '../_lib/dspm-i18n';
import { toast } from 'sonner';
import type {
  DSPMDataPolicy,
  DSPMPolicyImpact,
  DSPMPolicyViolation,
  DSPMPolicyCategory,
  DSPMPolicyEnforcement,
  CyberSeverity,
} from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

const CATEGORY_COLORS: Record<string, string> = {
  encryption: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  classification: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  retention: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  exposure: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  pii_protection: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300',
  access_review: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
  backup: 'bg-primary/15 text-primary',
  audit_logging: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
};

const ENFORCEMENT_COLORS: Record<string, string> = {
  alert: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  auto_remediate: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  block: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  high: 'bg-severity-high/10 text-severity-high',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  low: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  info: 'bg-secondary text-foreground/70',
};

const POLICY_CATEGORIES: DSPMPolicyCategory[] = [
  'encryption', 'classification', 'retention', 'exposure',
  'pii_protection', 'access_review', 'backup', 'audit_logging',
];

const ENFORCEMENT_OPTIONS: DSPMPolicyEnforcement[] = ['alert', 'auto_remediate', 'block'];
const SEVERITY_OPTIONS: CyberSeverity[] = ['critical', 'high', 'medium', 'low'];

function buildPolicyColumns(
  labels: ReturnType<typeof useDspmLabels>['dataPolicies'],
): ColumnDef<DSPMDataPolicy>[] {
  return [
  {
    id: 'name',
    accessorKey: 'name',
    header: labels.colName,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => (
      <div>
        <p className="text-sm font-medium">{row.original.name}</p>
        {row.original.description && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{row.original.description}</p>
        )}
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'category',
    accessorKey: 'category',
    header: labels.colCategory,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => {
      const cat = row.original.category;
      return (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${CATEGORY_COLORS[cat] ?? 'bg-muted text-muted-foreground'}`}>
          {cat.replace(/_/g, ' ')}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    id: 'enforcement',
    accessorKey: 'enforcement',
    header: labels.colEnforcement,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => {
      const enf = row.original.enforcement;
      return (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ENFORCEMENT_COLORS[enf] ?? 'bg-muted text-muted-foreground'}`}>
          {enf.replace(/_/g, ' ')}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    id: 'severity',
    accessorKey: 'severity',
    header: labels.colSeverity,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => {
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
    id: 'scope',
    header: labels.colScope,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => {
      const scopes = row.original.scope_classification ?? [];
      if (scopes.length === 0) return <span className="text-xs text-muted-foreground">{labels.scopeAll}</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {scopes.slice(0, 2).map((s) => (
            <Badge key={s} variant="outline" className="text-xs capitalize px-1.5 py-0">{s}</Badge>
          ))}
          {scopes.length > 2 && <Badge variant="outline" className="text-xs px-1.5 py-0">+{scopes.length - 2}</Badge>}
        </div>
      );
    },
  },
  {
    id: 'enabled',
    accessorKey: 'enabled',
    header: labels.colEnabled,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => (
      row.original.enabled
        ? <CheckCircle2 className="h-4 w-4 text-primary" />
        : <XCircle className="h-4 w-4 text-muted-foreground" />
    ),
  },
  {
    id: 'violation_count',
    accessorKey: 'violation_count',
    header: labels.colViolations,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => {
      const count = row.original.violation_count;
      return (
        <span className={`text-sm font-medium tabular-nums ${count > 0 ? 'text-status-error' : 'text-primary'}`}>
          {count}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    id: 'last_evaluated_at',
    accessorKey: 'last_evaluated_at',
    header: labels.colLastEvaluated,
    cell: ({ row }: { row: Row<DSPMDataPolicy> }) => {
      const dt = row.original.last_evaluated_at;
      return (
        <span className="text-xs text-muted-foreground">
          {dt ? new Date(dt).toLocaleDateString() : labels.never}
        </span>
      );
    },
    enableSorting: true,
  },
  ];
}

export default function DataPoliciesPage() {
  const t = useDspmLabels().dataPolicies;
  const policyColumns = buildPolicyColumns(t);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<DSPMDataPolicy | null>(null);
  const [updating, setUpdating] = useState(false);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [impact, setImpact] = useState<DSPMPolicyImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [evaluatingPolicyId, setEvaluatingPolicyId] = useState<string | null>(null);

  const { tableProps, refetch } = useDataTable<DSPMDataPolicy>({
    queryKey: 'cyber-dspm-policies',
    fetchFn: (params: FetchParams) => {
      const { filters, ...rest } = params;
      return apiGet<PaginatedResponse<DSPMDataPolicy>>(API_ENDPOINTS.CYBER_DSPM_DATA_POLICIES, { ...rest, ...filters } as Record<string, unknown>);
    },
    defaultSort: { column: 'name', direction: 'asc' },
  });

  const {
    data: violationsEnvelope,
    isLoading: violationsLoading,
    error: violationsError,
    mutate: refetchViolations,
  } = useRealtimeData<{ data: DSPMPolicyViolation[] }>(API_ENDPOINTS.CYBER_DSPM_POLICY_VIOLATIONS, {
    pollInterval: 120000,
  });

  const violations = violationsEnvelope?.data ?? [];
  const totalPolicies = tableProps.totalRows;
  const enabledCount = tableProps.data?.filter((p) => p.enabled).length ?? 0;
  const totalViolations = violations.length;

  const filters = [
    {
      key: 'category',
      label: t.filterCategory,
      type: 'multi-select' as const,
      options: POLICY_CATEGORIES.map((c) => ({
        label: c.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: c,
      })),
    },
    {
      key: 'enforcement',
      label: t.filterEnforcement,
      type: 'multi-select' as const,
      options: ENFORCEMENT_OPTIONS.map((e) => ({
        label: e.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: e,
      })),
    },
    {
      key: 'enabled',
      label: t.filterEnabled,
      type: 'multi-select' as const,
      options: [
        { label: t.enabledOption, value: 'true' },
        { label: t.disabledOption, value: 'false' },
      ],
    },
  ];

  async function handleCreatePolicy(data: {
    name: string;
    description: string;
    category: DSPMPolicyCategory;
    enforcement: DSPMPolicyEnforcement;
    severity: CyberSeverity;
    rule: Record<string, unknown>;
    scope_classification: string[];
    scope_asset_types: string[];
    enabled: boolean;
    compliance_frameworks: string[];
  }) {
    if (!data.name.trim()) {
      toast.error(t.nameRequired);
      return;
    }
    setCreating(true);
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_DATA_POLICIES, data);
      toast.success(t.createdToast);
      setCreateOpen(false);
      refetch();
    } catch {
      toast.error(t.createFailed);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdatePolicy(data: {
    name: string;
    description: string;
    category: DSPMPolicyCategory;
    enforcement: DSPMPolicyEnforcement;
    severity: CyberSeverity;
    rule: Record<string, unknown>;
    scope_classification: string[];
    scope_asset_types: string[];
    enabled: boolean;
    compliance_frameworks: string[];
  }) {
    if (!editingPolicy) return;
    if (!data.name.trim()) {
      toast.error(t.nameRequired);
      return;
    }
    setUpdating(true);
    try {
      await apiPut(API_ENDPOINTS.CYBER_DSPM_DATA_POLICY_DETAIL(editingPolicy.id), data);
      toast.success(t.updatedToast);
      setEditingPolicy(null);
      refetch();
    } catch {
      toast.error(t.updateFailed);
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeletePolicy(policy: DSPMDataPolicy) {
    setDeletingPolicyId(policy.id);
    try {
      await apiDelete(API_ENDPOINTS.CYBER_DSPM_DATA_POLICY_DETAIL(policy.id));
      toast.success(t.deletedToast);
      refetch();
      void refetchViolations();
    } catch {
      toast.error(t.deleteFailed);
    } finally {
      setDeletingPolicyId(null);
    }
  }

  async function handleDryRun(policy: DSPMDataPolicy) {
    setImpactLoading(true);
    try {
      const response = await apiPost<{ data: DSPMPolicyImpact }>(API_ENDPOINTS.CYBER_DSPM_DATA_POLICY_DRY_RUN(policy.id));
      setImpact(response.data);
      toast.success(t.dryRunToast);
    } catch {
      toast.error(t.dryRunFailed);
    } finally {
      setImpactLoading(false);
    }
  }

  async function handleEvaluate(policy: DSPMDataPolicy) {
    setEvaluatingPolicyId(policy.id);
    try {
      const response = await apiPost<{ data: DSPMPolicyViolation[]; total: number }>(API_ENDPOINTS.CYBER_DSPM_DATA_POLICY_EVALUATE(policy.id));
      toast.success(t.evaluateToast(response.total ?? response.data?.length ?? 0));
      refetch();
      void refetchViolations();
    } catch {
      toast.error(t.evaluateFailed);
    } finally {
      setEvaluatingPolicyId(null);
    }
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t.createPolicy}
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {([
            { label: t.kpiTotalPolicies, value: totalPolicies, icon: BookOpen, tone: 'sky' },
            { label: t.kpiEnabled, value: enabledCount, icon: CheckCircle2, tone: 'emerald' },
            {
              label: t.kpiActiveViolations,
              value: totalViolations,
              icon: ShieldAlert,
              tone: totalViolations > 0 ? 'rose' : 'emerald',
            },
          ] as Array<{ label: string; value: number; icon: typeof BookOpen; tone: StatTone }>).map((kpi) => (
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

        <div className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">{t.catalogTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.catalogSubtitle}</p>
          </div>
          <div className="p-5">
            {tableProps.isLoading ? (
              <LoadingSkeleton variant="table-row" count={6} />
            ) : tableProps.error ? (
              <ErrorState message={t.loadError} onRetry={refetch} />
            ) : (
                <DataTable
                  {...tableProps}
                  columns={policyColumns}
                  filters={filters}
                  rowActions={(policy) => [
                    {
                      label: t.actionEdit,
                      icon: Edit3,
                      onClick: () => {
                        setCreateOpen(false);
                        setEditingPolicy(policy);
                      },
                    },
                    {
                      label: t.actionDryRun,
                      icon: FlaskConical,
                      onClick: () => void handleDryRun(policy),
                    },
                    {
                      label: t.actionEvaluate,
                      icon: RefreshCw,
                      onClick: () => void handleEvaluate(policy),
                      disabled: () => evaluatingPolicyId === policy.id,
                    },
                    {
                      label: t.actionDelete,
                      icon: Trash2,
                      variant: 'destructive',
                      onClick: () => void handleDeletePolicy(policy),
                      disabled: () => deletingPolicyId === policy.id,
                    },
                  ]}
                  onSortChange={() => undefined}
                  searchPlaceholder={t.searchPlaceholder}
                emptyState={{
                  icon: BookOpen,
                  title: t.noPoliciesTitle,
                  description: t.noPoliciesDescription,
                  action: { label: t.createPolicy, onClick: () => setCreateOpen(true) },
                }}
              />
            )}
          </div>
        </div>

        <PolicyImpactPreview impact={impact} isLoading={impactLoading} />

        <div className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">{t.currentViolationsTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.currentViolationsSubtitle}</p>
          </div>
          <div className="p-5">
            {violationsLoading ? (
              <LoadingSkeleton variant="table-row" count={4} />
            ) : violationsError ? (
              <ErrorState message={t.violationsLoadError} onRetry={() => void refetchViolations()} />
            ) : violations.length === 0 ? (
              <EmptyState
                size="compact"
                icon={CheckCircle2}
                title={t.noActiveViolationsTitle}
                description={t.noActiveViolationsDescription}
              />
            ) : (
              <div className="space-y-3">
                {violations.slice(0, 20).map((v, idx) => (
                  <div key={`${v.policy_id}-${v.asset_id}-${idx}`} className="flex items-start justify-between rounded-lg border p-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{v.policy_name}</p>
                      <p className="text-xs text-muted-foreground">{v.description}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{v.asset_name}</Badge>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${CATEGORY_COLORS[v.category] ?? 'bg-muted text-muted-foreground'}`}>
                          {v.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[v.severity] ?? 'bg-muted text-muted-foreground'}`}>
                        {v.severity}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${ENFORCEMENT_COLORS[v.enforcement] ?? 'bg-muted text-muted-foreground'}`}>
                        {v.enforcement.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                ))}
                {violations.length > 20 && (
                  <p className="text-center text-xs text-muted-foreground">
                    {t.showingViolations(violations.length)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {createOpen && (
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-4 border-b pb-4">
              <h3 className="text-sm font-semibold">{t.createTitle}</h3>
              <p className="text-xs text-muted-foreground">
                {t.createSubtitle}
              </p>
            </div>
            <PolicyEditorForm
              onSubmit={handleCreatePolicy}
              onCancel={() => setCreateOpen(false)}
            />
          </div>
        )}

        {editingPolicy && (
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-4 border-b pb-4">
              <h3 className="text-sm font-semibold">{t.editTitle}</h3>
              <p className="text-xs text-muted-foreground">
                {t.editSubtitle}
              </p>
            </div>
            <PolicyEditorForm
              policy={editingPolicy}
              onSubmit={handleUpdatePolicy}
              onCancel={() => setEditingPolicy(null)}
            />
            {updating && <p className="mt-3 text-xs text-muted-foreground">{t.savingPolicy}</p>}
          </div>
        )}
      </div>
    </PermissionRedirect>
  );
}
