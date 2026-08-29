'use client';

import { useState, useMemo } from 'react';
import {
  Plus,
  FileText,
  ShieldAlert,
  Sparkles,
  CheckCircle,
  Eye,
  Send,
  Archive,
  BookOpen,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/common/page-header';
import { useVcisoLabels } from '../_lib/vciso-i18n';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { StatusBadge } from '@/components/shared/status-badge';
import { KpiCard } from '@/components/shared/kpi-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailPanel } from '@/components/shared/detail-panel';
import { Separator } from '@/components/ui/separator';
import { policyStatusConfig, policyExceptionStatusConfig } from '@/lib/status-configs';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDate, titleCase, truncate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ColumnDef } from '@tanstack/react-table';
import type { PaginatedResponse } from '@/types/api';
import type { FilterConfig } from '@/types/table';
import type {
  VCISOPolicy,
  VCISOPolicyException,
  PolicyDomain,
  PolicyStatus,
} from '@/types/cyber';

import { PolicyFormDialog } from './_components/policy-form-dialog';
import { PolicyDetailPanel } from './_components/policy-detail-panel';
import { ExceptionFormDialog } from './_components/exception-form-dialog';
import { PolicyDraftGenerator } from './_components/policy-draft-generator';

// ─── KPI Stats ────────────────────────────────────────────────────────────────

interface PolicyStatsResponse {
  total: number;
  by_status: Record<string, number>;
}

function PolicyKpiCards() {
  const tv = useVcisoLabels();
  const { data: envelope, isLoading } = useRealtimeData<{ data: PolicyStatsResponse }>(
    `${API_ENDPOINTS.CYBER_VCISO_POLICIES}/stats`,
    { wsTopics: ['vciso.policies'], pollInterval: 60_000 },
  );
  const raw = envelope?.data;
  const data = raw
    ? {
        total: raw.total ?? 0,
        published: raw.by_status?.published ?? 0,
        in_review: raw.by_status?.review ?? 0,
        overdue_reviews: 0,
        active_exceptions: 0,
      }
    : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard
        title={tv.pages.policies.totalPolicies}
        value={data?.total ?? 0}
        icon={FileText}
        tone="sky"
        loading={isLoading}
      />
      <KpiCard
        title={tv.pages.policies.published}
        value={data?.published ?? 0}
        icon={BookOpen}
        tone="emerald"
        loading={isLoading}
      />
      <KpiCard
        title={tv.pages.policies.inReview}
        value={data?.in_review ?? 0}
        icon={Eye}
        tone="slate"
        loading={isLoading}
      />
      <KpiCard
        title={tv.pages.policies.overdueReviews}
        value={data?.overdue_reviews ?? 0}
        icon={AlertTriangle}
        tone="rose"
        loading={isLoading}
      />
      <KpiCard
        title={tv.pages.policies.activeExceptions}
        value={data?.active_exceptions ?? 0}
        icon={ShieldAlert}
        tone="rose"
        loading={isLoading}
      />
    </div>
  );
}

// ─── Policies Tab ─────────────────────────────────────────────────────────────

function PoliciesTab({
  onCreatePolicy,
  allPolicies,
}: {
  onCreatePolicy: () => void;
  allPolicies: VCISOPolicy[];
}) {
  const tv = useVcisoLabels();
  const tp = tv.pages.policies;
  const [detailPolicy, setDetailPolicy] = useState<VCISOPolicy | null>(null);
  const [editPolicy, setEditPolicy] = useState<VCISOPolicy | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    policy: VCISOPolicy;
    type: 'submit_review' | 'publish' | 'retire';
    title: string;
    description: string;
  } | null>(null);

  const table = useDataTable<VCISOPolicy>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOPolicy>>(API_ENDPOINTS.CYBER_VCISO_POLICIES, params),
    queryKey: 'vciso-policies',
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['vciso.policies'],
  });

  const statusMutation = useApiMutation<VCISOPolicy, { status: PolicyStatus }>(
    'put',
    (variables) => {
      // We store the policy id in a ref via the confirmAction state
      const policyId = confirmAction?.policy.id;
      return `${API_ENDPOINTS.CYBER_VCISO_POLICIES}/${policyId}/status`;
    },
    {
      invalidateKeys: ['vciso-policies'],
      onSuccess: () => {
        setConfirmAction(null);
        table.refetch();
      },
    },
  );

  const filters: FilterConfig[] = [
    {
      key: 'status',
      label: tp.filters.status,
      type: 'select',
      options: [
        { label: tp.statusOptions.draft, value: 'draft' },
        { label: tp.statusOptions.review, value: 'review' },
        { label: tp.statusOptions.approved, value: 'approved' },
        { label: tp.statusOptions.published, value: 'published' },
        { label: tp.statusOptions.retired, value: 'retired' },
      ],
    },
    {
      key: 'domain',
      label: tp.filters.domain,
      type: 'select',
      options: (Object.keys(tp.domains) as PolicyDomain[]).map((value) => ({
        label: (tp.domains as Record<string, string>)[value],
        value,
      })),
    },
  ];

  const columns: ColumnDef<VCISOPolicy>[] = [
    {
      id: 'title',
      header: tp.columns.title,
      accessorKey: 'title',
      enableSorting: true,
      cell: ({ row }) => (
        <button
          className="font-semibold text-sm hover:underline text-start max-w-[180px] sm:max-w-[280px] truncate block"
          onClick={(e) => {
            e.stopPropagation();
            setDetailPolicy(row.original);
          }}
        >
          {row.original.title}
        </button>
      ),
    },
    {
      id: 'domain',
      header: tp.columns.domain,
      accessorKey: 'domain',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">
          {(tp.domains as Record<string, string>)[row.original.domain] ?? titleCase(row.original.domain)}
        </Badge>
      ),
    },
    {
      id: 'version',
      header: tp.columns.version,
      accessorKey: 'version',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.version}</span>
      ),
    },
    {
      id: 'status',
      header: tp.columns.status,
      accessorKey: 'status',
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={policyStatusConfig}
          size="sm"
        />
      ),
    },
    {
      id: 'owner_name',
      header: tp.columns.owner,
      accessorKey: 'owner_name',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.owner_name}</span>
      ),
    },
    {
      id: 'review_due',
      header: tp.columns.reviewDue,
      accessorKey: 'review_due',
      enableSorting: true,
      cell: ({ row }) => {
        const isOverdue = new Date(row.original.review_due) < new Date();
        return (
          <span
            className={cn(
              'text-sm',
              isOverdue && 'text-status-error font-medium',
            )}
          >
            {formatDate(row.original.review_due)}
          </span>
        );
      },
    },
    {
      id: 'exceptions_count',
      header: tp.columns.exceptions,
      accessorKey: 'exceptions_count',
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className={cn(
            'text-sm',
            row.original.exceptions_count > 0
              ? 'font-medium text-severity-high'
              : 'text-muted-foreground',
          )}
        >
          {row.original.exceptions_count}
        </span>
      ),
    },
    {
      id: 'updated_at',
      header: tp.columns.updated,
      accessorKey: 'updated_at',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.updated_at)}
        </span>
      ),
    },
  ];

  const rowActions = (policy: VCISOPolicy) => {
    const actions = [
      {
        label: tv.common.viewDetails,
        icon: Eye,
        onClick: (p: VCISOPolicy) => setDetailPolicy(p),
      },
    ];

    if (policy.status === 'draft' || policy.status === 'approved') {
      actions.push({
        label: tv.common.edit,
        icon: FileText,
        onClick: (p: VCISOPolicy) => setEditPolicy(p),
      });
    }

    if (policy.status === 'draft') {
      actions.push({
        label: tp.actions.submitReview,
        icon: Send,
        onClick: (p: VCISOPolicy) =>
          setConfirmAction({
            policy: p,
            type: 'submit_review',
            title: tp.confirm.submitReviewTitle,
            description: tp.confirm.submitReviewDesc(p.title),
          }),
      });
    }

    if (policy.status === 'approved') {
      actions.push({
        label: tp.actions.publish,
        icon: CheckCircle,
        onClick: (p: VCISOPolicy) =>
          setConfirmAction({
            policy: p,
            type: 'publish',
            title: tp.confirm.publishTitle,
            description: tp.confirm.publishDesc(p.title),
          }),
      });
    }

    if (policy.status === 'published') {
      actions.push({
        label: tp.actions.retire,
        icon: Archive,
        onClick: (p: VCISOPolicy) =>
          setConfirmAction({
            policy: p,
            type: 'retire',
            title: tp.confirm.retireTitle,
            description: tp.confirm.retireDesc(p.title),
          }),
      });
    }

    return actions;
  };

  const handleStatusChange = async () => {
    if (!confirmAction) return;
    const statusMap: Record<string, PolicyStatus> = {
      submit_review: 'review',
      publish: 'published',
      retire: 'retired',
    };
    statusMutation.mutate({ status: statusMap[confirmAction.type] });
  };

  return (
    <>
      <DataTable
        {...table.tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        onRowClick={(policy) => setDetailPolicy(policy)}
        searchPlaceholder={tp.search.policies}
        searchSlot={
          <SearchInput
            value={table.tableProps.searchValue ?? ''}
            onChange={table.tableProps.onSearchChange ?? (() => undefined)}
            placeholder={tp.search.policies}
            loading={table.tableProps.isLoading}
          />
        }
        emptyState={{
          icon: FileText,
          title: tp.empty.policiesTitle,
          description: tp.empty.policiesDesc,
          action: {
            label: tp.createPolicy,
            onClick: onCreatePolicy,
            icon: Plus,
          },
        }}
      />

      {/* Detail Panel */}
      {detailPolicy && (
        <PolicyDetailPanel
          policy={detailPolicy}
          open={!!detailPolicy}
          onClose={() => setDetailPolicy(null)}
          onEdit={() => {
            setEditPolicy(detailPolicy);
            setDetailPolicy(null);
          }}
          onRefresh={() => {
            table.refetch();
            setDetailPolicy(null);
          }}
        />
      )}

      {/* Edit Dialog */}
      {editPolicy && (
        <PolicyFormDialog
          open={!!editPolicy}
          onOpenChange={(o) => !o && setEditPolicy(null)}
          policy={editPolicy}
          onSuccess={() => table.refetch()}
        />
      )}

      {/* Confirm Status Change */}
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          onOpenChange={(o) => !o && setConfirmAction(null)}
          title={confirmAction.title}
          description={confirmAction.description}
          confirmLabel={confirmAction.title}
          onConfirm={handleStatusChange}
          loading={statusMutation.isPending}
        />
      )}
    </>
  );
}

// ─── Exceptions Tab ───────────────────────────────────────────────────────────

function ExceptionsTab({
  onCreateException,
  allPolicies,
}: {
  onCreateException: () => void;
  allPolicies: VCISOPolicy[];
}) {
  const tv = useVcisoLabels();
  const tp = tv.pages.policies;
  const [viewException, setViewException] = useState<VCISOPolicyException | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    exception: VCISOPolicyException;
    type: 'approve' | 'reject';
  } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');

  const table = useDataTable<VCISOPolicyException>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOPolicyException>>(
        API_ENDPOINTS.CYBER_VCISO_POLICY_EXCEPTIONS,
        params,
      ),
    queryKey: 'vciso-policy-exceptions',
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['vciso.policy-exceptions'],
  });

  const decideMutation = useApiMutation<
    VCISOPolicyException,
    { status: string; decision_notes?: string }
  >(
    'put',
    () =>
      `${API_ENDPOINTS.CYBER_VCISO_POLICY_EXCEPTIONS}/${confirmAction?.exception.id}/decision`,
    {
      invalidateKeys: ['vciso-policy-exceptions', 'vciso-policies'],
      onSuccess: () => {
        toast.success(
          confirmAction?.type === 'approve'
            ? tp.exceptionApprovedToast
            : tp.exceptionRejectedToast,
        );
        setConfirmAction(null);
        setDecisionNotes('');
        table.refetch();
      },
    },
  );

  const filters: FilterConfig[] = [
    {
      key: 'status',
      label: tp.filters.status,
      type: 'select',
      options: [
        { label: tp.exceptionStatusOptions.pending, value: 'pending' },
        { label: tp.exceptionStatusOptions.approved, value: 'approved' },
        { label: tp.exceptionStatusOptions.rejected, value: 'rejected' },
        { label: tp.exceptionStatusOptions.expired, value: 'expired' },
      ],
    },
  ];

  const columns: ColumnDef<VCISOPolicyException>[] = [
    {
      id: 'title',
      header: tp.exceptionColumns.title,
      accessorKey: 'title',
      enableSorting: true,
      cell: ({ row }) => (
        <button
          className="font-semibold text-sm hover:underline text-start max-w-[140px] sm:max-w-[240px] truncate block"
          onClick={(e) => {
            e.stopPropagation();
            setViewException(row.original);
          }}
        >
          {row.original.title}
        </button>
      ),
    },
    {
      id: 'policy_title',
      header: tp.exceptionColumns.policy,
      accessorKey: 'policy_title',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm max-w-[120px] sm:max-w-[200px] truncate block">
          {row.original.policy_title}
        </span>
      ),
    },
    {
      id: 'status',
      header: tp.exceptionColumns.status,
      accessorKey: 'status',
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={policyExceptionStatusConfig}
          size="sm"
        />
      ),
    },
    {
      id: 'requested_by_name',
      header: tp.exceptionColumns.requestedBy,
      accessorKey: 'requested_by_name',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.requested_by_name}</span>
      ),
    },
    {
      id: 'compensating_controls',
      header: tp.exceptionColumns.compensatingControls,
      accessorKey: 'compensating_controls',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground max-w-[120px] sm:max-w-[200px] truncate block">
          {truncate(row.original.compensating_controls, 60)}
        </span>
      ),
    },
    {
      id: 'expires_at',
      header: tp.exceptionColumns.expiresAt,
      accessorKey: 'expires_at',
      enableSorting: true,
      cell: ({ row }) => {
        const isExpired = new Date(row.original.expires_at) < new Date();
        return (
          <span
            className={cn(
              'text-sm',
              isExpired && row.original.status === 'approved'
                ? 'text-status-error font-medium'
                : 'text-muted-foreground',
            )}
          >
            {formatDate(row.original.expires_at)}
          </span>
        );
      },
    },
    {
      id: 'created_at',
      header: tp.exceptionColumns.created,
      accessorKey: 'created_at',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
  ];

  const rowActions = (exception: VCISOPolicyException) => {
    const actions = [
      {
        label: tv.common.viewDetails,
        icon: Eye,
        onClick: (ex: VCISOPolicyException) => setViewException(ex),
      },
    ];

    if (exception.status === 'pending') {
      actions.push(
        {
          label: tv.common.approve,
          icon: CheckCircle,
          onClick: (ex: VCISOPolicyException) =>
            setConfirmAction({ exception: ex, type: 'approve' }),
        },
        {
          label: tv.common.reject,
          icon: ShieldAlert,
          onClick: (ex: VCISOPolicyException) =>
            setConfirmAction({ exception: ex, type: 'reject' }),
        },
      );
    }

    return actions;
  };

  const handleDecision = async () => {
    if (!confirmAction) return;
    decideMutation.mutate({
      status: confirmAction.type === 'approve' ? 'approved' : 'rejected',
      decision_notes: decisionNotes.trim() || undefined,
    });
  };

  return (
    <>
      <DataTable
        {...table.tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        onRowClick={(exception) => setViewException(exception)}
        searchPlaceholder={tp.search.exceptions}
        searchSlot={
          <SearchInput
            value={table.tableProps.searchValue ?? ''}
            onChange={table.tableProps.onSearchChange ?? (() => undefined)}
            placeholder={tp.search.exceptions}
            loading={table.tableProps.isLoading}
          />
        }
        emptyState={{
          icon: ShieldAlert,
          title: tp.empty.exceptionsTitle,
          description: tp.empty.exceptionsDesc,
          action: {
            label: tp.requestException,
            onClick: onCreateException,
            icon: Plus,
          },
        }}
      />

      {/* Exception Detail Panel */}
      {viewException && (
        <ExceptionDetailView
          exception={viewException}
          open={!!viewException}
          onClose={() => setViewException(null)}
          onApprove={() =>
            setConfirmAction({ exception: viewException, type: 'approve' })
          }
          onReject={() =>
            setConfirmAction({ exception: viewException, type: 'reject' })
          }
        />
      )}

      {/* Confirm Decision */}
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          onOpenChange={(o) => {
            if (!o) {
              setConfirmAction(null);
              setDecisionNotes('');
            }
          }}
          title={
            confirmAction.type === 'approve'
              ? tp.confirm.approveExceptionTitle
              : tp.confirm.rejectExceptionTitle
          }
          description={
            confirmAction.type === 'approve'
              ? tp.confirm.approveExceptionDesc(confirmAction.exception.title)
              : tp.confirm.rejectExceptionDesc(confirmAction.exception.title)
          }
          confirmLabel={confirmAction.type === 'approve' ? tv.common.approve : tv.common.reject}
          variant={confirmAction.type === 'reject' ? 'destructive' : 'default'}
          onConfirm={handleDecision}
          loading={decideMutation.isPending}
        />
      )}
    </>
  );
}

// ─── Exception Detail View (inline panel) ────────────────────────────────────

function ExceptionDetailView({
  exception,
  open,
  onClose,
  onApprove,
  onReject,
}: {
  exception: VCISOPolicyException;
  open: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const tv = useVcisoLabels();
  const tp = tv.pages.policies;
  const isExpired =
    new Date(exception.expires_at) < new Date() &&
    exception.status === 'approved';

  return (
    <DetailPanel
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={exception.title}
      description={tp.exceptionDetail.forPrefix(exception.policy_title)}
      width="xl"
    >
      <div className="space-y-6">
        {/* Status and Actions */}
        <div className="flex items-center justify-between">
          <StatusBadge
            status={exception.status}
            config={policyExceptionStatusConfig}
            size="lg"
          />
          {exception.status === 'pending' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onReject}>
                {tv.common.reject}
              </Button>
              <Button size="sm" onClick={onApprove}>
                <CheckCircle className="me-1.5 h-3.5 w-3.5" />
                {tv.common.approve}
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {/* Metadata */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {tp.exceptionDetail.requestedBy}
            </p>
            <p className="text-sm">{exception.requested_by_name}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {tv.common.created}
            </p>
            <p className="text-sm">{formatDate(exception.created_at)}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {tp.exceptionColumns.expiresAt}
            </p>
            <p
              className={cn(
                'text-sm',
                isExpired && 'text-status-error font-medium',
              )}
            >
              {formatDate(exception.expires_at)}
              {isExpired && tp.exceptionDetail.expiredSuffix}
            </p>
          </div>

          {exception.approved_by_name && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {tp.exceptionDetail.decisionBy}
              </p>
              <p className="text-sm">{exception.approved_by_name}</p>
            </div>
          )}
        </div>

        <Separator />

        {/* Description */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{tv.common.description}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {exception.description}
          </p>
        </div>

        {/* Justification */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{tp.exceptionDetail.justification}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {exception.justification}
          </p>
        </div>

        {/* Compensating Controls */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{tp.exceptionDetail.compensatingControls}</h3>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm whitespace-pre-wrap">
              {exception.compensating_controls}
            </p>
          </div>
        </div>

        {/* Decision Notes */}
        {exception.decision_notes && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{tp.exceptionDetail.decisionNotes}</h3>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm whitespace-pre-wrap">
                {exception.decision_notes}
              </p>
            </div>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VCISOPoliciesPage() {
  const tv = useVcisoLabels();
  const tp = tv.pages.policies;
  const [activeTab, setActiveTab] = useState('policies');
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);
  const [createExceptionOpen, setCreateExceptionOpen] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftDomain, setDraftDomain] = useState<PolicyDomain | undefined>();

  // Fetch all policies for the exception form's policy selector
  const { data: allPoliciesData } = useRealtimeData<PaginatedResponse<VCISOPolicy>>(
    API_ENDPOINTS.CYBER_VCISO_POLICIES,
    {
      params: { per_page: 200 },
      wsTopics: ['vciso.policies'],
    },
  );
  const allPolicies = allPoliciesData?.data ?? [];

  const handleSaveDraftFromGenerator = (content: string, domain: PolicyDomain) => {
    setDraftContent(content);
    setDraftDomain(domain);
    setCreatePolicyOpen(true);
  };

  const headerActions = useMemo(() => {
    if (activeTab === 'policies') {
      return (
        <Button onClick={() => setCreatePolicyOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {tp.createPolicy}
        </Button>
      );
    }
    if (activeTab === 'exceptions') {
      return (
        <Button onClick={() => setCreateExceptionOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {tp.requestException}
        </Button>
      );
    }
    return null;
  }, [activeTab, tp]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={tv.pages.policies.title}
          description={tv.pages.policies.description}
          actions={headerActions}
        />

        <PolicyKpiCards />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="policies" className="gap-1.5">
              <FileText className="h-4 w-4" />
              {tp.tabs.policies}
            </TabsTrigger>
            <TabsTrigger value="exceptions" className="gap-1.5">
              <ShieldAlert className="h-4 w-4" />
              {tp.tabs.exceptions}
            </TabsTrigger>
            <TabsTrigger value="ai-draft" className="gap-1.5">
              <Sparkles className="h-4 w-4" />
              {tp.tabs.aiDraft}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="mt-6">
            <PoliciesTab
              onCreatePolicy={() => setCreatePolicyOpen(true)}
              allPolicies={allPolicies}
            />
          </TabsContent>

          <TabsContent value="exceptions" className="mt-6">
            <ExceptionsTab
              onCreateException={() => setCreateExceptionOpen(true)}
              allPolicies={allPolicies}
            />
          </TabsContent>

          <TabsContent value="ai-draft" className="mt-6">
            <PolicyDraftGenerator onSaveAsDraft={handleSaveDraftFromGenerator} />
          </TabsContent>
        </Tabs>

        {/* Create / Edit Policy Dialog */}
        <PolicyFormDialog
          open={createPolicyOpen}
          onOpenChange={(o) => {
            setCreatePolicyOpen(o);
            if (!o) {
              setDraftContent('');
              setDraftDomain(undefined);
            }
          }}
          onSuccess={() => {
            setDraftContent('');
            setDraftDomain(undefined);
          }}
          initialContent={draftContent}
          initialDomain={draftDomain}
        />

        {/* Create Exception Dialog */}
        <ExceptionFormDialog
          open={createExceptionOpen}
          onOpenChange={setCreateExceptionOpen}
          policies={allPolicies}
          onSuccess={() => {}}
        />
      </div>
    </PermissionRedirect>
  );
}
