'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CheckCircle2,
  CircleSlash,
  History,
  Pencil,
  PencilLine,
  Plus,
  ScrollText,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import type { StatusConfig } from '@/lib/status-configs';
import type { FilterConfig, RowAction } from '@/types/table';
import {
  type RequestApprovalPolicy,
  lexRequestApprovalPoliciesApi,
} from '@/lib/lex/request-approval-policies';
import { lexRequestsApi } from '@/lib/lex/requests';
import {
  type RequestApprovalPolicyLabels,
  useRequestApprovalPolicyLabels,
} from './_labels';
import { PolicyFormDialog } from './_components/policy-form-dialog';
import { PolicyVersionsDialog } from './_components/policy-versions-dialog';
import { PolicyAuditDialog } from './_components/policy-audit-dialog';
import { RecommendTester } from './_components/recommend-tester';

const STATUS_OPTIONS = ['active', 'draft', 'archived'] as const;
const STAGE_OPTIONS = ['requester', 'provider'] as const;

export default function RequestApprovalPoliciesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = useRequestApprovalPolicyLabels();

  const canWrite = hasPermission('lex:approval:admin') || hasPermission('lex:approval:write');
  const canAdmin = hasPermission('lex:approval:admin');
  const canRestore = canWrite || canAdmin;
  const canDelete = canAdmin;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RequestApprovalPolicy | null>(null);
  const [versionsFor, setVersionsFor] = useState<RequestApprovalPolicy | null>(null);
  const [auditFor, setAuditFor] = useState<RequestApprovalPolicy | null>(null);
  const [archiving, setArchiving] = useState<RequestApprovalPolicy | null>(null);
  const [deleting, setDeleting] = useState<RequestApprovalPolicy | null>(null);

  const { tableProps, searchValue, setSearch } = useDataTable<RequestApprovalPolicy>({
    queryKey: 'lex-request-approval-policies',
    fetchFn: lexRequestApprovalPoliciesApi.listPolicies,
    defaultPageSize: 25,
    defaultSort: { column: 'priority', direction: 'desc' },
    wsTopics: ['lex.request-approval-policies'],
  });

  const servicesQuery = useQuery({
    queryKey: ['lex-request-approval-policy-services'],
    queryFn: () =>
      lexRequestsApi.listServices({ page: 1, per_page: 500, sort: 'code', order: 'asc' }),
  });
  const services = useMemo(() => servicesQuery.data?.data ?? [], [servicesQuery.data]);

  const statusConfig = useMemo<StatusConfig>(
    () => ({
      active: { label: labels.statusLabels.active, color: 'green', icon: CheckCircle2 },
      draft: { label: labels.statusLabels.draft, color: 'yellow', icon: PencilLine },
      archived: { label: labels.statusLabels.archived, color: 'gray', icon: CircleSlash },
    }),
    [labels],
  );

  const refreshPolicies = async () => {
    await queryClient.invalidateQueries({ queryKey: ['lex-request-approval-policies'] });
  };

  const archiveMutation = useMutation({
    mutationFn: (id: string) => lexRequestApprovalPoliciesApi.archivePolicy(id),
    onSuccess: async () => {
      showSuccess(labels.toast.archived);
      setArchiving(null);
      await refreshPolicies();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lexRequestApprovalPoliciesApi.deletePolicy(id),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      setDeleting(null);
      await refreshPolicies();
    },
    onError: showApiError,
  });

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select',
        options: STATUS_OPTIONS.map((status) => ({
          label: labels.statusLabels[status] ?? status,
          value: status,
        })),
      },
      {
        key: 'stage',
        label: labels.filters.stage,
        type: 'select',
        options: STAGE_OPTIONS.map((stage) => ({
          label: labels.stageLabels[stage] ?? stage,
          value: stage,
        })),
      },
    ],
    [labels],
  );

  const columns = useMemo<ColumnDef<RequestApprovalPolicy>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: labels.table.columns.name,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-[200px] space-y-1">
            <span className="font-medium">{row.original.name}</span>
            {row.original.description ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {row.original.description}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.table.columns.status,
        cell: ({ row }) => <StatusBadge status={row.original.status} config={statusConfig} />,
      },
      {
        id: 'scope',
        header: labels.table.columns.scope,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatScope(row.original, labels)}
          </span>
        ),
      },
      {
        id: 'route',
        header: labels.table.columns.route,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">
              {labels.modeLabels[row.original.mode] ?? row.original.mode}
            </Badge>
            <Badge variant="outline">{formatQuorum(row.original, labels)}</Badge>
          </div>
        ),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: labels.table.columns.priority,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm">{labels.table.priority(row.original.priority)}</span>
        ),
      },
      {
        id: 'version',
        header: labels.table.columns.version,
        cell: ({ row }) => (
          <Badge variant="secondary">{labels.table.versionLabel(row.original.version)}</Badge>
        ),
      },
      {
        id: 'updated',
        accessorKey: 'updated_at',
        header: labels.table.columns.updated,
        enableSorting: true,
        cell: ({ row }) => <RelativeTime date={row.original.updated_at} />,
      },
    ],
    [labels, statusConfig],
  );

  const rowActions = useMemo<RowAction<RequestApprovalPolicy>[]>(() => {
    const actions: RowAction<RequestApprovalPolicy>[] = [];
    if (canWrite) {
      actions.push({ label: labels.actions.edit, icon: Pencil, onClick: (row) => setEditing(row) });
    }
    actions.push({ label: labels.actions.versions, icon: History, onClick: (row) => setVersionsFor(row) });
    actions.push({ label: labels.actions.audit, icon: ScrollText, onClick: (row) => setAuditFor(row) });
    if (canWrite) {
      actions.push({
        label: labels.actions.archive,
        icon: Archive,
        hidden: (row) => row.status === 'archived',
        onClick: (row) => setArchiving(row),
      });
    }
    if (canDelete) {
      actions.push({
        label: labels.actions.delete,
        icon: Trash2,
        variant: 'destructive',
        onClick: (row) => setDeleting(row),
      });
    }
    return actions;
  }, [canWrite, canDelete, labels]);

  return (
    <LexAccessGuard routeKey="/lex/admin/request-approval-policies" resourceName={labels.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={labels.pageTitle}
          description={labels.pageDescription}
          actions={
            canWrite ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {labels.createPolicy}
              </Button>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
          <DataTable
            {...tableProps}
            columns={columns}
            filters={filters}
            getRowId={(row) => row.id}
            rowActions={rowActions}
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={labels.table.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: ShieldCheck,
              title: labels.table.emptyTitle,
              description: labels.table.emptyDescription,
            }}
          />

          <RecommendTester labels={labels} services={services} />
        </div>

        {canWrite ? (
          <>
            <PolicyFormDialog
              labels={labels}
              open={createOpen}
              onOpenChange={setCreateOpen}
              onSaved={refreshPolicies}
              services={services}
            />
            <PolicyFormDialog
              labels={labels}
              policy={editing}
              open={editing != null}
              onOpenChange={(o) => !o && setEditing(null)}
              onSaved={refreshPolicies}
              services={services}
            />
          </>
        ) : null}

        <PolicyVersionsDialog
          labels={labels}
          policy={versionsFor}
          open={versionsFor != null}
          onOpenChange={(o) => !o && setVersionsFor(null)}
          canRestore={canRestore}
          onRestored={refreshPolicies}
        />

        <PolicyAuditDialog
          labels={labels}
          policy={auditFor}
          open={auditFor != null}
          onOpenChange={(o) => !o && setAuditFor(null)}
        />

        <ConfirmDialog
          open={archiving != null}
          onOpenChange={(o) => !o && setArchiving(null)}
          title={labels.archiveConfirm.title}
          description={
            archiving
              ? labels.archiveConfirm.description(archiving.name)
              : labels.archiveConfirm.fallbackDescription
          }
          confirmLabel={labels.archiveConfirm.confirm}
          variant="destructive"
          loading={archiveMutation.isPending}
          onConfirm={async () => {
            if (archiving) {
              await archiveMutation.mutateAsync(archiving.id);
            }
          }}
        />

        <ConfirmDialog
          open={deleting != null}
          onOpenChange={(o) => !o && setDeleting(null)}
          title={labels.deleteConfirm.title}
          description={
            deleting
              ? labels.deleteConfirm.description(deleting.name)
              : labels.deleteConfirm.fallbackDescription
          }
          confirmLabel={labels.deleteConfirm.confirm}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={async () => {
            if (deleting) {
              await deleteMutation.mutateAsync(deleting.id);
            }
          }}
        />
      </div>
    </LexAccessGuard>
  );
}

/* ------------------------------ formatting ------------------------------ */

function formatScope(
  policy: RequestApprovalPolicy,
  labels: RequestApprovalPolicyLabels,
): string {
  const pieces = [
    policy.request_type?.trim()
      ? labels.scope.requestTypePrefix(policy.request_type)
      : labels.scope.anyRequestType,
    policy.stage ? labels.stageLabels[policy.stage] ?? policy.stage : labels.scope.anyStage,
    policy.department?.trim() || labels.scope.anyDepartment,
    formatValueRange(policy, labels),
  ];
  return pieces.join(labels.scope.separator);
}

function formatValueRange(
  policy: RequestApprovalPolicy,
  labels: RequestApprovalPolicyLabels,
): string {
  const currency = policy.currency || 'SAR';
  if (policy.min_value != null && policy.max_value != null) {
    return labels.scope.rangeValue(
      currency,
      policy.min_value.toLocaleString(),
      policy.max_value.toLocaleString(),
    );
  }
  if (policy.min_value != null) {
    return labels.scope.fromValue(currency, policy.min_value.toLocaleString());
  }
  if (policy.max_value != null) {
    return labels.scope.upToValue(currency, policy.max_value.toLocaleString());
  }
  return labels.scope.anyValue;
}

function formatQuorum(
  policy: RequestApprovalPolicy,
  labels: RequestApprovalPolicyLabels,
): string {
  if (policy.quorum === 'n_of_m') {
    return labels.quorumFormat.nOfM(policy.quorum_n ?? 1, policy.approvers.length);
  }
  return labels.quorumLabels[policy.quorum] ?? policy.quorum;
}
