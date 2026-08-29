'use client';

import { useState } from 'react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import {
  CheckCircle2,
  Clock,
  FileWarning,
  Plus,
  ShieldOff,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AsyncRecordPicker } from '@/components/shared/forms/async-record-picker';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { toast } from 'sonner';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type {
  DSPMRiskException,
  DSPMExceptionType,
  DSPMApprovalStatus,
} from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import {
  loadDspmDataAssetOptions,
  loadDspmPolicyOptions,
  loadDspmRemediationOptions,
} from '../_components/exception-request-dialog';

const EXCEPTION_TYPE_COLORS: Record<string, string> = {
  posture_finding: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  policy_violation: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  overprivileged_access: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  exposure_risk: 'bg-severity-high/10 text-severity-high',
  encryption_gap: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
};

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  approved: 'bg-primary/15 text-primary',
  rejected: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  expired: 'bg-secondary text-foreground/70',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-primary/15 text-primary',
  expired: 'bg-secondary text-foreground/70',
  revoked: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  superseded: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
};

const EXCEPTION_TYPES: DSPMExceptionType[] = [
  'posture_finding', 'policy_violation', 'overprivileged_access', 'exposure_risk', 'encryption_gap',
];

function buildExceptionColumns(
  onApprove: (id: string) => Promise<void>,
  onReject: (id: string) => Promise<void>,
  labels: ReturnType<typeof useDspmLabels>['exceptions'],
): ColumnDef<DSPMRiskException>[] {
  return [
    {
      id: 'exception_type',
      accessorKey: 'exception_type',
      header: labels.colType,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => {
        const t = row.original.exception_type;
        return (
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${EXCEPTION_TYPE_COLORS[t] ?? 'bg-muted text-muted-foreground'}`}>
            {t.replace(/_/g, ' ')}
          </span>
        );
      },
      enableSorting: true,
    },
    {
      id: 'justification',
      accessorKey: 'justification',
      header: labels.colJustification,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => (
        <div>
          <p className="text-sm line-clamp-1">{row.original.justification}</p>
          {row.original.data_asset_id && (
            <p className="mt-0.5 text-xs text-muted-foreground">{labels.assetPrefix(`${row.original.data_asset_id.slice(0, 8)}...`)}</p>
          )}
          {row.original.policy_id && (
            <p className="mt-0.5 text-xs text-muted-foreground">{labels.policyPrefix(`${row.original.policy_id.slice(0, 8)}...`)}</p>
          )}
        </div>
      ),
    },
    {
      id: 'risk_level',
      accessorKey: 'risk_level',
      header: labels.colRiskLevel,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => {
        const level = row.original.risk_level;
        const color = level === 'critical' ? 'text-severity-critical' : level === 'high' ? 'text-severity-high' : level === 'medium' ? 'text-warning-700 dark:text-warning-300' : 'text-severity-info';
        return (
          <span className={`text-sm font-medium capitalize ${color}`}>{level}</span>
        );
      },
      enableSorting: true,
    },
    {
      id: 'requested_by',
      accessorKey: 'requested_by',
      header: labels.colRequestedBy,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => (
        <span className="text-sm text-muted-foreground">{row.original.requested_by}</span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.colStatus,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => {
        const status = row.original.status;
        return (
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground'}`}>
            {status}
          </span>
        );
      },
      enableSorting: true,
    },
    {
      id: 'approval_status',
      accessorKey: 'approval_status',
      header: labels.colApproval,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => {
        const approval = row.original.approval_status;
        return (
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${APPROVAL_STATUS_COLORS[approval] ?? 'bg-muted text-muted-foreground'}`}>
            {approval}
          </span>
        );
      },
      enableSorting: true,
    },
    {
      id: 'expires_at',
      accessorKey: 'expires_at',
      header: labels.colExpires,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => {
        const dt = row.original.expires_at;
        const isExpired = new Date(dt) < new Date();
        return (
          <span className={`text-xs ${isExpired ? 'text-status-error' : 'text-muted-foreground'}`}>
            {new Date(dt).toLocaleDateString()}
          </span>
        );
      },
      enableSorting: true,
    },
    {
      id: 'review_count',
      accessorKey: 'review_count',
      header: labels.colReviews,
      cell: ({ row }: { row: Row<DSPMRiskException> }) => (
        <span className="text-sm tabular-nums">{row.original.review_count}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }: { row: Row<DSPMRiskException> }) => {
        const exception = row.original;
        if (exception.approval_status !== 'pending') return null;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-primary hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                void onApprove(exception.id);
              }}
            >
              {labels.approve}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-status-error hover:text-status-error/80"
              onClick={(e) => {
                e.stopPropagation();
                void onReject(exception.id);
              }}
            >
              {labels.reject}
            </Button>
          </div>
        );
      },
    },
  ];
}

interface ExceptionForm {
  exception_type: DSPMExceptionType;
  justification: string;
  business_reason: string;
  compensating_controls: string;
  data_asset_id: string;
  policy_id: string;
  remediation_id: string;
  expires_at: string;
  risk_score: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  review_interval_days: string;
}

const INITIAL_FORM: ExceptionForm = {
  exception_type: 'posture_finding',
  justification: '',
  business_reason: '',
  compensating_controls: '',
  data_asset_id: '',
  policy_id: '',
  remediation_id: '',
  expires_at: '',
  risk_score: '50',
  risk_level: 'medium',
  review_interval_days: '90',
};

export default function RiskExceptionsPage() {
  const labels = useDspmLabels();
  const t = labels.exceptions;
  const pickerLabels = labels.exceptionDialog;
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<ExceptionForm>(INITIAL_FORM);
  const [creating, setCreating] = useState(false);

  const { tableProps, refetch, data } = useDataTable<DSPMRiskException>({
    queryKey: 'cyber-dspm-exceptions',
    fetchFn: (params: FetchParams) => {
      const { filters, ...rest } = params;
      return apiGet<PaginatedResponse<DSPMRiskException>>(API_ENDPOINTS.CYBER_DSPM_EXCEPTIONS, { ...rest, ...filters } as Record<string, unknown>);
    },
    defaultSort: { column: 'created_at', direction: 'desc' },
  });

  async function handleApprove(exceptionId: string) {
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_EXCEPTIONS + '/' + exceptionId + '/approve');
      toast.success(t.approvedToast);
      refetch();
    } catch {
      toast.error(t.approveFailed);
    }
  }

  async function handleReject(exceptionId: string) {
    const reason = window.prompt(t.rejectPrompt);
    if (!reason) return;
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_EXCEPTIONS + '/' + exceptionId + '/reject', { reason });
      toast.success(t.rejectedToast);
      refetch();
    } catch {
      toast.error(t.rejectFailed);
    }
  }

  const exceptionColumns = buildExceptionColumns(handleApprove, handleReject, t);

  const totalExceptions = tableProps.totalRows;
  const pendingCount = data.filter((e) => e.approval_status === 'pending').length;
  const approvedCount = data.filter((e) => e.approval_status === 'approved').length;
  const expiredCount = data.filter((e) => e.status === 'expired').length;

  const filters = [
    {
      key: 'approval_status',
      label: t.filterApprovalStatus,
      type: 'multi-select' as const,
      options: ['pending', 'approved', 'rejected', 'expired'].map((s) => ({
        label: s.charAt(0).toUpperCase() + s.slice(1),
        value: s,
      })),
    },
    {
      key: 'exception_type',
      label: t.filterExceptionType,
      type: 'multi-select' as const,
      options: EXCEPTION_TYPES.map((et) => ({
        label: et.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()),
        value: et,
      })),
    },
    {
      key: 'status',
      label: t.filterStatus,
      type: 'multi-select' as const,
      options: ['active', 'expired', 'revoked', 'superseded'].map((s) => ({
        label: s.charAt(0).toUpperCase() + s.slice(1),
        value: s,
      })),
    },
  ];

  async function handleCreateException() {
    if (!form.justification.trim()) {
      toast.error(t.justificationRequired);
      return;
    }
    if (!form.expires_at) {
      toast.error(t.expirationRequired);
      return;
    }
    setCreating(true);
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_EXCEPTIONS, {
        exception_type: form.exception_type,
        justification: form.justification,
        business_reason: form.business_reason || undefined,
        compensating_controls: form.compensating_controls || undefined,
        data_asset_id: form.data_asset_id || undefined,
        policy_id: form.policy_id || undefined,
        remediation_id: form.remediation_id || undefined,
        expires_at: new Date(form.expires_at).toISOString(),
        risk_score: parseInt(form.risk_score, 10) || 50,
        risk_level: form.risk_level,
        review_interval_days: parseInt(form.review_interval_days, 10) || 90,
      });
      toast.success(t.createdToast);
      setCreateOpen(false);
      setForm(INITIAL_FORM);
      refetch();
    } catch {
      toast.error(t.createFailed);
    } finally {
      setCreating(false);
    }
  }

  const kpis: Array<{ label: string; value: number; icon: typeof ShieldOff; tone: StatTone }> = [
    { label: t.kpiTotalExceptions, value: totalExceptions, icon: ShieldOff, tone: 'sky' },
    { label: t.kpiPendingReview, value: pendingCount, icon: Clock, tone: pendingCount > 0 ? 'gold' : 'emerald' },
    { label: t.kpiApproved, value: approvedCount, icon: CheckCircle2, tone: 'emerald' },
    { label: t.kpiExpired, value: expiredCount, icon: XCircle, tone: 'slate' },
  ];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t.requestException}
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="text-sm font-semibold">{t.registryTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.registrySubtitle}</p>
          </div>
          <div className="p-5">
            {tableProps.isLoading ? (
              <LoadingSkeleton variant="table-row" count={6} />
            ) : tableProps.error ? (
              <ErrorState message={t.loadError} onRetry={refetch} />
            ) : (
              <DataTable
                {...tableProps}
                columns={exceptionColumns}
                filters={filters}
                onSortChange={() => undefined}
                searchPlaceholder={t.searchPlaceholder}
                emptyState={{
                  icon: FileWarning,
                  title: t.noExceptionsTitle,
                  description: t.noExceptionsDescription,
                  action: { label: t.requestException, onClick: () => setCreateOpen(true) },
                }}
              />
            )}
          </div>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t.dialogTitle}</DialogTitle>
              <DialogDescription>
                {t.dialogDescription()}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
              <div className="space-y-2">
                <Label>{t.exceptionType}</Label>
                <Select value={form.exception_type} onValueChange={(v) => setForm({ ...form, exception_type: v as DSPMExceptionType })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCEPTION_TYPES.map((et) => (
                      <SelectItem key={et} value={et}>
                        {et.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase())}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exc-justification">{t.justification}</Label>
                <Input
                  id="exc-justification"
                  placeholder={t.justificationPlaceholder}
                  value={form.justification}
                  onChange={(e) => setForm({ ...form, justification: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exc-business-reason">{t.businessReason}</Label>
                <Input
                  id="exc-business-reason"
                  placeholder={t.businessReasonPlaceholder}
                  value={form.business_reason}
                  onChange={(e) => setForm({ ...form, business_reason: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exc-controls">{t.compensatingControls}</Label>
                <Input
                  id="exc-controls"
                  placeholder={t.compensatingControlsPlaceholder}
                  value={form.compensating_controls}
                  onChange={(e) => setForm({ ...form, compensating_controls: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="exc-asset-id">{t.dataAssetId}</Label>
                  <AsyncRecordPicker
                    id="exc-asset-id"
                    ariaLabel={t.dataAssetId}
                    queryKey={['cyber-dspm-exceptions-page-data-asset-picker']}
                    loadOptions={loadDspmDataAssetOptions}
                    value={form.data_asset_id}
                    onChange={(value) => setForm((current) => ({ ...current, data_asset_id: value }))}
                    allowClear
                    labels={{ select: pickerLabels.dataAssetIdPlaceholder }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exc-policy-id">{t.policyId}</Label>
                  <AsyncRecordPicker
                    id="exc-policy-id"
                    ariaLabel={t.policyId}
                    queryKey={['cyber-dspm-exceptions-page-policy-picker']}
                    loadOptions={loadDspmPolicyOptions}
                    value={form.policy_id}
                    onChange={(value) => setForm((current) => ({ ...current, policy_id: value }))}
                    allowClear
                    labels={{ select: pickerLabels.policyIdPlaceholder }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exc-remediation-id">{t.remediationId}</Label>
                <AsyncRecordPicker
                  id="exc-remediation-id"
                  ariaLabel={t.remediationId}
                  queryKey={['cyber-dspm-exceptions-page-remediation-picker']}
                  loadOptions={loadDspmRemediationOptions}
                  value={form.remediation_id}
                  onChange={(value) => setForm((current) => ({ ...current, remediation_id: value }))}
                  allowClear
                  labels={{ select: pickerLabels.remediationIdPlaceholder }}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t.riskLevel}</Label>
                  <Select value={form.risk_level} onValueChange={(v) => setForm({ ...form, risk_level: v as ExceptionForm['risk_level'] })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t.levelLow}</SelectItem>
                      <SelectItem value="medium">{t.levelMedium}</SelectItem>
                      <SelectItem value="high">{t.levelHigh}</SelectItem>
                      <SelectItem value="critical">{t.levelCritical}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exc-risk-score">{t.riskScore}</Label>
                  <Input
                    id="exc-risk-score"
                    type="number"
                    min="0"
                    max="100"
                    value={form.risk_score}
                    onChange={(e) => setForm({ ...form, risk_score: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="exc-expires">{t.expiresAt}</Label>
                  <Input
                    id="exc-expires"
                    type="date"
                    value={form.expires_at}
                    onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.reviewInterval}</Label>
                  <Select value={form.review_interval_days} onValueChange={(v) => setForm({ ...form, review_interval_days: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">{t.reviewDaysOption('30')}</SelectItem>
                      <SelectItem value="60">{t.reviewDaysOption('60')}</SelectItem>
                      <SelectItem value="90">{t.reviewDaysOption('90')}</SelectItem>
                      <SelectItem value="180">{t.reviewDaysOption('180')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                {t.cancel}
              </Button>
              <Button onClick={handleCreateException} disabled={creating}>
                {creating ? t.submitting : t.submitRequest}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionRedirect>
  );
}
