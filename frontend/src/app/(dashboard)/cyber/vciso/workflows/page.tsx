'use client';

import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Plus,
  Eye,
  Users,
  CheckCircle,
  XCircle,
  ArrowUpCircle,
  Shield,
  Clock,
  ClipboardCheck,
  AlertTriangle,
  GitPullRequestArrow,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import {
  useVcisoLabels,
  useVcisoWorkflowLabels,
  useVcisoWorkflowsListLabels,
  type VcisoWorkflowsListLabels,
} from '../_lib/vciso-i18n';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useDataTable } from '@/hooks/use-data-table';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { buildSuiteQueryParams } from '@/lib/suite-api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ownershipStatusConfig, approvalStatusConfig } from '@/lib/status-configs';
import type { PaginatedResponse } from '@/types/api';
import type { FilterConfig, RowAction } from '@/types/table';
import type {
  VCISOControlOwnership,
  VCISOApprovalRequest,
  ApprovalRequestType,
} from '@/types/cyber';

import { OwnershipFormDialog } from './_components/ownership-form-dialog';
import { OwnershipDetailPanel } from './_components/ownership-detail-panel';
import { ApprovalDetailPanel } from './_components/approval-detail-panel';
import { ApprovalActionDialog } from './_components/approval-action-dialog';
import { CreateApprovalDialog } from './_components/create-approval-dialog';

// Framework option values are proper product/standard names — kept verbatim.
const FRAMEWORK_VALUES = ['NIST 800-53', 'ISO 27001', 'CIS Controls', 'SOC 2', 'PCI DSS', 'HIPAA'];
const APPROVAL_TYPE_VALUES: ApprovalRequestType[] = [
  'risk_acceptance',
  'policy_exception',
  'remediation',
  'budget',
  'vendor_onboarding',
];
const PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'];

// ── Ownership Filters ────────────────────────────────────────────────────────

function buildOwnershipFilters(wl: VcisoWorkflowsListLabels): FilterConfig[] {
  return [
    {
      key: 'status',
      label: wl.ownershipFilters.status,
      type: 'select',
      options: [
        { label: wl.ownershipFilters.statusOptions.assigned, value: 'assigned' },
        { label: wl.ownershipFilters.statusOptions.pending_review, value: 'pending_review' },
        { label: wl.ownershipFilters.statusOptions.reviewed, value: 'reviewed' },
      ],
    },
    {
      key: 'framework',
      label: wl.ownershipFilters.framework,
      type: 'select',
      options: FRAMEWORK_VALUES.map((value) => ({ label: value, value })),
    },
  ];
}

// ── Approval Filters ─────────────────────────────────────────────────────────

function buildApprovalFilters(
  wl: VcisoWorkflowsListLabels,
  typeLabels: Record<string, string>,
  priorityLabels: Record<string, string>,
): FilterConfig[] {
  return [
    {
      key: 'type',
      label: wl.approvalFilters.type,
      type: 'select',
      options: APPROVAL_TYPE_VALUES.map((value) => ({ label: typeLabels[value] ?? value, value })),
    },
    {
      key: 'status',
      label: wl.approvalFilters.status,
      type: 'select',
      options: [
        { label: wl.approvalFilters.statusOptions.pending, value: 'pending' },
        { label: wl.approvalFilters.statusOptions.approved, value: 'approved' },
        { label: wl.approvalFilters.statusOptions.rejected, value: 'rejected' },
        { label: wl.approvalFilters.statusOptions.escalated, value: 'escalated' },
      ],
    },
    {
      key: 'priority',
      label: wl.approvalFilters.priority,
      type: 'select',
      options: PRIORITY_VALUES.map((value) => ({ label: priorityLabels[value] ?? value, value })),
    },
  ];
}

// ── Ownership Columns ────────────────────────────────────────────────────────

function getOwnershipColumns(wl: VcisoWorkflowsListLabels): ColumnDef<VCISOControlOwnership>[] {
  return [
    {
      accessorKey: 'control_name',
      header: wl.ownershipColumns.controlName,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.control_name}</span>
      ),
    },
    {
      accessorKey: 'framework',
      header: wl.ownershipColumns.framework,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.framework}
        </Badge>
      ),
    },
    {
      accessorKey: 'owner_name',
      header: wl.ownershipColumns.owner,
      enableSorting: true,
      cell: ({ row }) => <span className="text-sm">{row.original.owner_name}</span>,
    },
    {
      accessorKey: 'delegate_name',
      header: wl.ownershipColumns.delegate,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.delegate_name || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: wl.ownershipColumns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={ownershipStatusConfig} />
      ),
    },
    {
      accessorKey: 'last_reviewed_at',
      header: wl.ownershipColumns.lastReviewed,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.last_reviewed_at
            ? formatDate(row.original.last_reviewed_at)
            : wl.ownershipColumns.never}
        </span>
      ),
    },
    {
      accessorKey: 'next_review_date',
      header: wl.ownershipColumns.nextReview,
      enableSorting: true,
      cell: ({ row }) => {
        const isOverdue = new Date(row.original.next_review_date) < new Date();
        return (
          <span
            className={cn(
              'text-sm',
              isOverdue && 'text-status-error font-medium',
            )}
          >
            {formatDate(row.original.next_review_date)}
          </span>
        );
      },
    },
  ];
}

// ── Approval Columns ─────────────────────────────────────────────────────────

function getApprovalColumns(
  wl: VcisoWorkflowsListLabels,
  typeLabels: Record<string, string>,
): ColumnDef<VCISOApprovalRequest>[] {
  return [
    {
      accessorKey: 'title',
      header: wl.approvalColumns.title,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-foreground max-w-[140px] sm:max-w-[240px] truncate block">
          {row.original.title}
        </span>
      ),
    },
    {
      accessorKey: 'type',
      header: wl.approvalColumns.type,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {typeLabels[row.original.type] ?? titleCase(row.original.type)}
        </Badge>
      ),
    },
    {
      accessorKey: 'priority',
      header: wl.approvalColumns.priority,
      enableSorting: true,
      cell: ({ row }) => (
        <SeverityIndicator severity={row.original.priority as Severity} />
      ),
    },
    {
      accessorKey: 'status',
      header: wl.approvalColumns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={approvalStatusConfig} />
      ),
    },
    {
      accessorKey: 'requested_by_name',
      header: wl.approvalColumns.requestedBy,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.requested_by_name}</span>
      ),
    },
    {
      accessorKey: 'approver_name',
      header: wl.approvalColumns.approver,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.approver_name}</span>
      ),
    },
    {
      accessorKey: 'deadline',
      header: wl.approvalColumns.deadline,
      enableSorting: true,
      cell: ({ row }) => {
        const isOverdue =
          new Date(row.original.deadline) < new Date() &&
          row.original.status === 'pending';
        return (
          <span
            className={cn(
              'text-sm',
              isOverdue && 'text-status-error font-medium',
            )}
          >
            {formatDate(row.original.deadline)}
          </span>
        );
      },
    },
    {
      accessorKey: 'created_at',
      header: wl.approvalColumns.created,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
  ];
}

// ── Approval KPI Stats ───────────────────────────────────────────────────────

interface ApprovalStats {
  pending: number;
  overdue: number;
  approved_this_month: number;
  rejected_this_month: number;
}

function ApprovalKpiCards() {
  const tv = useVcisoLabels();
  const { data: allApprovals, isLoading } = useRealtimeData<
    PaginatedResponse<VCISOApprovalRequest>
  >(API_ENDPOINTS.CYBER_VCISO_APPROVALS, {
    params: { per_page: 500 },
    wsTopics: ['vciso.approvals'],
  });

  const stats = useMemo<ApprovalStats>(() => {
    const items = allApprovals?.data ?? [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let pending = 0;
    let overdue = 0;
    let approvedThisMonth = 0;
    let rejectedThisMonth = 0;

    for (const item of items) {
      if (item.status === 'pending') {
        pending++;
        if (new Date(item.deadline) < now) {
          overdue++;
        }
      }
      if (
        item.status === 'approved' &&
        item.decided_at &&
        new Date(item.decided_at) >= monthStart
      ) {
        approvedThisMonth++;
      }
      if (
        item.status === 'rejected' &&
        item.decided_at &&
        new Date(item.decided_at) >= monthStart
      ) {
        rejectedThisMonth++;
      }
    }

    return {
      pending,
      overdue,
      approved_this_month: approvedThisMonth,
      rejected_this_month: rejectedThisMonth,
    };
  }, [allApprovals]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title={tv.pages.workflows.pendingApprovals}
        value={stats.pending}
        icon={Clock}
        tone="gold"
        loading={isLoading}
        description={tv.pages.workflows.pendingDesc}
      />
      <KpiCard
        title={tv.pages.workflows.overdue}
        value={stats.overdue}
        icon={AlertTriangle}
        tone="rose"
        loading={isLoading}
        description={tv.pages.workflows.overdueDesc}
      />
      <KpiCard
        title={tv.pages.workflows.approvedThisMonth}
        value={stats.approved_this_month}
        icon={CheckCircle}
        tone="emerald"
        loading={isLoading}
        description={tv.pages.workflows.approvedDesc}
      />
      <KpiCard
        title={tv.pages.workflows.rejectedThisMonth}
        value={stats.rejected_this_month}
        icon={XCircle}
        tone="rose"
        loading={isLoading}
        description={tv.pages.workflows.rejectedDesc}
      />
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function VCISOWorkflowsPage() {
  const tv = useVcisoLabels();
  const wl = useVcisoWorkflowsListLabels();
  const wt = useVcisoWorkflowLabels();
  const typeLabels = wt.approvalTypes as Record<string, string>;
  const priorityLabels = wt.priorities as Record<string, string>;
  const [activeTab, setActiveTab] = useState('ownership');

  // ── Ownership state ────────────────────────────────
  const [showOwnershipForm, setShowOwnershipForm] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<VCISOControlOwnership | null>(null);
  const [selectedOwnership, setSelectedOwnership] = useState<VCISOControlOwnership | null>(null);
  const [markReviewedTarget, setMarkReviewedTarget] = useState<VCISOControlOwnership | null>(null);

  // ── Approval state ─────────────────────────────────
  const [showCreateApproval, setShowCreateApproval] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<VCISOApprovalRequest | null>(null);
  const [approvalAction, setApprovalAction] = useState<{
    approval: VCISOApprovalRequest;
    action: 'approve' | 'reject' | 'escalate';
  } | null>(null);

  // ── Ownership Table ────────────────────────────────
  const {
    tableProps: ownershipTableProps,
    refetch: refetchOwnership,
  } = useDataTable<VCISOControlOwnership>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOControlOwnership>>(
        API_ENDPOINTS.CYBER_VCISO_CONTROL_OWNERSHIP,
        buildSuiteQueryParams(params),
      ),
    queryKey: 'vciso-control-ownership',
    defaultSort: { column: 'next_review_date', direction: 'asc' },
    wsTopics: ['vciso.control-ownership'],
  });

  // ── Approval Table ─────────────────────────────────
  const {
    tableProps: approvalTableProps,
    refetch: refetchApprovals,
  } = useDataTable<VCISOApprovalRequest>({
    fetchFn: (params) =>
      apiGet<PaginatedResponse<VCISOApprovalRequest>>(
        API_ENDPOINTS.CYBER_VCISO_APPROVALS,
        buildSuiteQueryParams(params),
      ),
    queryKey: 'vciso-approvals',
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['vciso.approvals'],
  });

  // ── Mark Reviewed Mutation ─────────────────────────
  const markReviewedMutation = useApiMutation<Record<string, unknown>, Record<string, unknown>>(
    'post',
    (variables) =>
      `${API_ENDPOINTS.CYBER_VCISO_CONTROL_OWNERSHIP}/${(variables as Record<string, string>).id}/mark-reviewed`,
    {
      successMessage: wl.toasts.reviewed,
      invalidateKeys: ['vciso-control-ownership'],
      onSuccess: () => {
        setMarkReviewedTarget(null);
        refetchOwnership();
      },
    },
  );

  // ── Columns ────────────────────────────────────────
  const ownershipColumns = useMemo(() => getOwnershipColumns(wl), [wl]);
  const approvalColumns = useMemo(() => getApprovalColumns(wl, typeLabels), [wl, typeLabels]);
  const ownershipFilters = useMemo(() => buildOwnershipFilters(wl), [wl]);
  const approvalFilters = useMemo(
    () => buildApprovalFilters(wl, typeLabels, priorityLabels),
    [wl, typeLabels, priorityLabels],
  );

  // ── Ownership Row Actions ──────────────────────────
  const ownershipRowActions: RowAction<VCISOControlOwnership>[] = [
    {
      label: wl.ownershipActions.viewDetails,
      icon: Eye,
      onClick: (row) => setSelectedOwnership(row),
    },
    {
      label: wl.ownershipActions.reassign,
      icon: Users,
      onClick: (row) => setReassignTarget(row),
    },
    {
      label: wl.ownershipActions.markReviewed,
      icon: CheckCircle,
      onClick: (row) => setMarkReviewedTarget(row),
      hidden: (row) => row.status === 'reviewed',
    },
  ];

  // ── Approval Row Actions ───────────────────────────
  const approvalRowActions: RowAction<VCISOApprovalRequest>[] = [
    {
      label: wl.approvalActions.viewDetails,
      icon: Eye,
      onClick: (row) => setSelectedApproval(row),
    },
    {
      label: wl.approvalActions.approve,
      icon: CheckCircle,
      onClick: (row) => setApprovalAction({ approval: row, action: 'approve' }),
      hidden: (row) => row.status !== 'pending',
    },
    {
      label: wl.approvalActions.reject,
      icon: XCircle,
      variant: 'destructive',
      onClick: (row) => setApprovalAction({ approval: row, action: 'reject' }),
      hidden: (row) => row.status !== 'pending',
    },
    {
      label: wl.approvalActions.escalate,
      icon: ArrowUpCircle,
      onClick: (row) => setApprovalAction({ approval: row, action: 'escalate' }),
      hidden: (row) => row.status !== 'pending',
    },
  ];

  // ── Header actions based on tab ────────────────────
  const headerActions = useMemo(() => {
    if (activeTab === 'ownership') {
      return (
        <Button onClick={() => setShowOwnershipForm(true)}>
          <Plus className="me-2 h-4 w-4" />
          {wl.headerActions.assignOwnership}
        </Button>
      );
    }
    if (activeTab === 'approvals') {
      return (
        <Button onClick={() => setShowCreateApproval(true)}>
          <Plus className="me-2 h-4 w-4" />
          {wl.headerActions.newApproval}
        </Button>
      );
    }
    return null;
  }, [activeTab, wl]);

  const handleRefreshAll = () => {
    refetchOwnership();
    refetchApprovals();
  };

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          title={tv.pages.workflows.title}
          description={tv.pages.workflows.description}
          actions={headerActions}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="ownership" className="gap-1.5">
              <Shield className="h-4 w-4" />
              {wl.tabs.controlOwnership}
            </TabsTrigger>
            <TabsTrigger value="approvals" className="gap-1.5">
              <GitPullRequestArrow className="h-4 w-4" />
              {wl.tabs.approvalQueue}
            </TabsTrigger>
          </TabsList>

          {/* ── Control Ownership Tab ─────────────────────── */}
          <TabsContent value="ownership" className="mt-6 space-y-4">
            <DataTable
              columns={ownershipColumns}
              filters={ownershipFilters}
              rowActions={ownershipRowActions}
              searchPlaceholder={wl.search.controls}
              emptyState={{
                icon: Shield,
                title: wl.empty.ownershipTitle,
                description: wl.empty.ownershipDesc,
                action: {
                  label: wl.headerActions.assignOwnership,
                  onClick: () => setShowOwnershipForm(true),
                  icon: Plus,
                },
              }}
              onRowClick={(row) => setSelectedOwnership(row)}
              getRowId={(row) => row.id}
              enableColumnToggle
              stickyHeader
              {...ownershipTableProps}
            />
          </TabsContent>

          {/* ── Approval Queue Tab ────────────────────────── */}
          <TabsContent value="approvals" className="mt-6 space-y-6">
            {/* KPI Row */}
            <ApprovalKpiCards />

            {/* Approval Table */}
            <DataTable
              columns={approvalColumns}
              filters={approvalFilters}
              rowActions={approvalRowActions}
              searchPlaceholder={wl.search.approvals}
              emptyState={{
                icon: ClipboardCheck,
                title: wl.empty.approvalTitle,
                description: wl.empty.approvalDesc,
              }}
              onRowClick={(row) => setSelectedApproval(row)}
              getRowId={(row) => row.id}
              enableColumnToggle
              stickyHeader
              {...approvalTableProps}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Ownership Form Dialog (Create) ────────────── */}
      <OwnershipFormDialog
        open={showOwnershipForm}
        onOpenChange={setShowOwnershipForm}
        onSuccess={handleRefreshAll}
      />

      {/* ── Ownership Form Dialog (Reassign) ──────────── */}
      {reassignTarget && (
        <OwnershipFormDialog
          open={!!reassignTarget}
          onOpenChange={(o) => {
            if (!o) setReassignTarget(null);
          }}
          ownership={reassignTarget}
          onSuccess={handleRefreshAll}
        />
      )}

      {/* ── Ownership Detail Panel ────────────────────── */}
      {selectedOwnership && (
        <OwnershipDetailPanel
          open={!!selectedOwnership}
          onOpenChange={(o) => {
            if (!o) setSelectedOwnership(null);
          }}
          ownership={selectedOwnership}
          onReassign={() => {
            setReassignTarget(selectedOwnership);
            setSelectedOwnership(null);
          }}
          onMarkReviewed={() => {
            setMarkReviewedTarget(selectedOwnership);
            setSelectedOwnership(null);
          }}
        />
      )}

      {/* ── Mark Reviewed Confirm ─────────────────────── */}
      <ConfirmDialog
        open={!!markReviewedTarget}
        onOpenChange={(o) => {
          if (!o) setMarkReviewedTarget(null);
        }}
        title={tv.pages.workflows.markReviewed}
        description={wl.confirm.markReviewedDesc(markReviewedTarget?.control_name ?? '')}
        confirmLabel={wl.confirm.markReviewedConfirm}
        loading={markReviewedMutation.isPending}
        onConfirm={async () => {
          if (markReviewedTarget) {
            markReviewedMutation.mutate({ id: markReviewedTarget.id });
          }
        }}
      />

      {/* ── Approval Detail Panel ─────────────────────── */}
      {selectedApproval && (
        <ApprovalDetailPanel
          open={!!selectedApproval}
          onOpenChange={(o) => {
            if (!o) setSelectedApproval(null);
          }}
          approval={selectedApproval}
          onActionComplete={handleRefreshAll}
        />
      )}

      {/* ── Approval Action Dialog ────────────────────── */}
      {approvalAction && (
        <ApprovalActionDialog
          open={!!approvalAction}
          onOpenChange={(o) => {
            if (!o) setApprovalAction(null);
          }}
          approval={approvalAction.approval}
          action={approvalAction.action}
          onSuccess={handleRefreshAll}
        />
      )}

      {/* ── Create Approval Dialog ────────────────────── */}
      <CreateApprovalDialog
        open={showCreateApproval}
        onOpenChange={setShowCreateApproval}
        onSuccess={handleRefreshAll}
      />
    </PermissionRedirect>
  );
}
