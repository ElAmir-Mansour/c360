'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Eye,
  Folder,
  Loader2,
} from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  SimpleTable,
  type Column,
} from '@/components/shared/simple-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { userDisplayName } from '@/lib/enterprise/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { ArchivedFilterRail } from './_components/archived-filter-rail';
import { useArchivedLabels } from './_lib/archived-labels';
import {
  type ArchivedContract,
  useArchivedContracts,
  useArchivedFilters,
  useUnarchiveContract,
} from './_lib/use-archived-contracts';

const STATUS_TONES: Record<string, string> = {
  active: 'bg-success-50 text-success-700',
  renewed: 'bg-success-50 text-success-700',
  pending_signature: 'bg-warning-50 text-warning-700',
  internal_review: 'bg-warning-50 text-warning-700',
  legal_review: 'bg-warning-50 text-warning-700',
  negotiation: 'bg-warning-50 text-warning-700',
  expired: 'bg-destructive/10 text-destructive',
  terminated: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-destructive/10 text-destructive',
};

type ArchiveTableRow = ArchivedContract & Record<string, unknown>;

function ArchivedContractsView() {
  const labels = useArchivedLabels();
  const { locale } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('lex:contract:edit');
  const {
    filters,
    patch,
    reset,
    page,
    setPage,
    perPage,
    setPerPage,
    query,
    activeFilterCount,
    isSearchDebouncing,
  } = useArchivedFilters();
  const archiveQuery = useArchivedContracts(query);
  const statsQuery = useQuery({
    queryKey: ['lex-contracts', 'stats'],
    queryFn: () => enterpriseApi.lex.getContractStats(),
    staleTime: 60_000,
  });
  const restoreMutation = useUnarchiveContract();
  const [restoreTarget, setRestoreTarget] = useState<ArchivedContract | null>(null);
  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-contract-archive'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => archiveQuery.data?.data ?? [], [archiveQuery.data?.data]);
  const total = archiveQuery.data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const stats = statsQuery.data;
  const byStatus = stats?.by_status ?? {};
  const users = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data?.data]);
  const userNamesByID = useMemo(
    () => new Map(users.map((user) => [user.id, userDisplayName(user)])),
    [users],
  );

  const kpis = [
    {
      label: labels.kpis.total,
      value: total,
      icon: Folder,
      iconClass: 'bg-clario-tint text-clario-primary',
      valueClass: 'text-clario-ink',
      href: '/lex/contracts/archived',
      loading: archiveQuery.isLoading,
    },
    {
      label: labels.kpis.active,
      value: byStatus.active ?? 0,
      icon: Folder,
      iconClass: 'bg-success-50 text-success-700',
      valueClass: 'text-success-700',
      href: '/lex/contracts?status=active',
      loading: statsQuery.isLoading,
    },
    {
      label: labels.kpis.expiring,
      value: stats?.expiring_30_days ?? 0,
      icon: Folder,
      iconClass: 'bg-warning-50 text-warning-700',
      valueClass: 'text-warning-700',
      href: '/lex/contracts?expiring_in_days=30',
      loading: statsQuery.isLoading,
    },
    {
      label: labels.kpis.expired,
      value: byStatus.expired ?? 0,
      icon: Folder,
      iconClass: 'bg-destructive/10 text-destructive',
      valueClass: 'text-destructive',
      href: '/lex/contracts?status=expired',
      loading: statsQuery.isLoading,
    },
  ];

  const restore = async (contract: ArchivedContract) => {
    try {
      await restoreMutation.mutateAsync(contract.id);
      showSuccess(labels.toast.restored);
      if (rows.length === 1 && page > 1) setPage(page - 1);
      setRestoreTarget(null);
    } catch (error) {
      showApiError(error);
      throw error;
    }
  };

  const archiveColumns: Column<ArchiveTableRow>[] = [
    {
      key: 'contract_number',
      header: labels.columns.reference,
      render: (contract) => (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 font-bold text-success-700"
          asChild
        >
          <Link href={`/lex/contracts/${contract.id}`}>
            {contract.contract_number || contract.id.slice(0, 12)}
          </Link>
        </Button>
      ),
    },
    {
      key: 'title',
      header: labels.columns.contract,
      render: (contract) => <span className="font-bold">{contract.title}</span>,
    },
    {
      key: 'party_b_name',
      header: labels.columns.counterparty,
      render: (contract) => contract.party_b_name || '—',
    },
    {
      key: 'type',
      header: labels.columns.type,
      className: 'text-clario-muted',
      render: (contract) => labels.filters.typeOptions[contract.type] ?? contract.type,
    },
    {
      key: 'effective_date',
      header: labels.columns.startDate,
      className: 'tabular-nums',
      render: (contract) =>
        formatDate(contract.effective_date ?? contract.created_at, locale),
    },
    {
      key: 'expiry_date',
      header: labels.columns.endDate,
      className: 'tabular-nums',
      render: (contract) => formatDate(contract.expiry_date, locale),
    },
    {
      key: 'status',
      header: labels.columns.status,
      render: (contract) => (
        <span
          className={cn(
            'inline-flex rounded px-2 py-0.5 text-xs font-bold',
            STATUS_TONES[contract.status] ?? 'bg-clario-tint text-clario-muted',
          )}
        >
          {labels.filters.statusOptions[contract.status] ?? contract.status}
        </span>
      ),
    },
    {
      key: 'owner_name',
      header: labels.columns.owner,
      render: (contract) => contract.owner_name || shortID(contract.owner_user_id),
    },
    {
      key: 'archive_date',
      header: labels.columns.archived,
      className: 'tabular-nums',
      render: (contract) => (
        <div>
          <span className="block">{formatDateTime(contract.archive_date, locale)}</span>
          {contract.archived_by ? (
            <span className="block text-xs text-clario-muted">
              {userNamesByID.get(contract.archived_by) ?? shortID(contract.archived_by)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'archive_reason',
      header: labels.columns.reason,
      className: 'max-w-56',
      render: (contract) => (
        <span className="line-clamp-2" title={contract.archive_reason ?? undefined}>
          {contract.archive_reason || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: labels.columns.actions,
      render: (contract) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            asChild
          >
            <Link
              href={`/lex/contracts/${contract.id}`}
              aria-label={`${labels.rowActions.view}: ${contract.title}`}
            >
              <Eye className="h-4 w-4 text-success-600" />
            </Link>
          </Button>
          {canWrite ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`${labels.rowActions.unarchive}: ${contract.title}`}
              onClick={() => setRestoreTarget(contract)}
              disabled={restoreMutation.isPending && restoreMutation.variables === contract.id}
            >
              {restoreMutation.isPending && restoreMutation.variables === contract.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-clario-muted" />
              ) : (
                <ArchiveRestore className="h-4 w-4 text-clario-muted" />
              )}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 text-clario-ink">
      <PageHeader
        eyebrow={labels.eyebrow}
        title={labels.title}
        description={labels.description}
        breadcrumb={
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            <Link href="/lex" className="text-clario-muted hover:text-clario-ink">
              {labels.breadcrumbs.home}
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-clario-muted rtl:rotate-180" aria-hidden />
            <Link href="/lex/contracts" className="text-clario-muted hover:text-clario-ink">
              {labels.breadcrumbs.contracts}
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-clario-muted rtl:rotate-180" aria-hidden />
            <span className="font-bold">{labels.breadcrumbs.archive}</span>
          </nav>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/lex/contracts">
              <ChevronLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
              {labels.actions.backToContracts}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link
              key={kpi.label}
              href={kpi.href}
              aria-label={`${kpi.label}: ${kpi.value}`}
              className="flex min-h-32 items-center justify-between rounded-2xl border border-clario-border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-clario-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <div>
                <p className="text-sm text-clario-muted">{kpi.label}</p>
                <p className={cn('mt-4 text-3xl font-bold tabular-nums', kpi.valueClass)}>
                  {kpi.loading ? '—' : kpi.value}
                </p>
              </div>
              <span className={cn('grid h-11 w-11 place-items-center rounded-lg', kpi.iconClass)}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>

      <ArchivedFilterRail
        filters={filters}
        users={users}
        usersLoading={usersQuery.isLoading}
        activeFilterCount={activeFilterCount}
        onPatch={patch}
        onReset={reset}
      />

      <section className="overflow-hidden rounded-2xl border border-clario-border bg-white shadow-sm">
        {archiveQuery.isLoading || isSearchDebouncing ? (
          <Skeleton.Table rows={5} cols={11} className="border-0" />
        ) : archiveQuery.isError ? (
          <ErrorState
            message={labels.error}
            error={archiveQuery.error}
            onRetry={() => void archiveQuery.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Archive}
            title={labels.empty.title}
            description={labels.empty.description}
            size="compact"
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <SimpleTable<ArchiveTableRow>
                columns={archiveColumns}
                data={rows as ArchiveTableRow[]}
                getRowKey={(contract) => contract.id}
                ariaLabel={labels.title}
                className="rounded-none border-0 shadow-none"
              />
            </div>

            <div className="divide-y divide-clario-border lg:hidden">
              {rows.map((contract) => (
                <article key={contract.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-start font-bold text-success-700"
                        asChild
                      >
                        <Link href={`/lex/contracts/${contract.id}`}>
                          {contract.contract_number || contract.id.slice(0, 12)}
                        </Link>
                      </Button>
                      <h3 className="mt-1 font-bold">{contract.title}</h3>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded px-2 py-0.5 text-xs font-bold',
                        STATUS_TONES[contract.status] ?? 'bg-clario-tint text-clario-muted',
                      )}
                    >
                      {labels.filters.statusOptions[contract.status] ?? contract.status}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-xs text-clario-muted">
                    <div>
                      <dt>{labels.columns.counterparty}</dt>
                      <dd className="mt-1 text-sm text-clario-ink">{contract.party_b_name || '—'}</dd>
                    </div>
                    <div>
                      <dt>{labels.columns.type}</dt>
                      <dd className="mt-1 text-sm text-clario-ink">
                        {labels.filters.typeOptions[contract.type] ?? contract.type}
                      </dd>
                    </div>
                    <div>
                      <dt>{labels.columns.startDate}</dt>
                      <dd className="mt-1 text-sm tabular-nums text-clario-ink">
                        {formatDate(contract.effective_date ?? contract.created_at, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt>{labels.columns.endDate}</dt>
                      <dd className="mt-1 text-sm tabular-nums text-clario-ink">
                        {formatDate(contract.expiry_date, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt>{labels.columns.owner}</dt>
                      <dd className="mt-1 text-sm text-clario-ink">
                        {contract.owner_name || shortID(contract.owner_user_id)}
                      </dd>
                    </div>
                    <div>
                      <dt>{labels.columns.archived}</dt>
                      <dd className="mt-1 text-sm tabular-nums text-clario-ink">
                        {formatDateTime(contract.archive_date, locale)}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt>{labels.columns.reason}</dt>
                      <dd className="mt-1 text-sm text-clario-ink">
                        {contract.archive_reason || '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      asChild
                    >
                      <Link href={`/lex/contracts/${contract.id}`}>
                        <Eye className="me-2 h-4 w-4" />
                        {labels.rowActions.view}
                      </Link>
                    </Button>
                    {canWrite ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setRestoreTarget(contract)}
                        disabled={restoreMutation.isPending && restoreMutation.variables === contract.id}
                      >
                        {restoreMutation.isPending && restoreMutation.variables === contract.id ? (
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArchiveRestore className="me-2 h-4 w-4" />
                        )}
                        {labels.rowActions.unarchive}
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <footer className="flex flex-col gap-4 border-t border-clario-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-sm text-clario-muted">{labels.resultCount(from, to, total)}</p>
                <label className="flex items-center gap-2 text-sm text-clario-muted">
                  <span>{labels.pagination.rowsPerPage}</span>
                  <select
                    aria-label={labels.pagination.rowsPerPage}
                    value={perPage}
                    onChange={(event) => setPerPage(Number(event.target.value))}
                    className="h-9 rounded-md border border-clario-border bg-white px-2 text-clario-ink"
                  >
                    {[10, 25, 50].map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" />
                  {labels.pagination.previous}
                </Button>
                {paginationItems(page, totalPages).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span key={`ellipsis-${index}`} className="w-7 text-center text-clario-muted" aria-hidden>
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === page ? 'default' : 'outline'}
                      size="sm"
                      className="w-9 px-0"
                      aria-label={`${item}`}
                      aria-current={item === page ? 'page' : undefined}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                >
                  {labels.pagination.next}
                  <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" />
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open && !restoreMutation.isPending) setRestoreTarget(null);
        }}
        title={labels.restoreConfirm.title}
        description={labels.restoreConfirm.description(restoreTarget?.title ?? '')}
        confirmLabel={labels.restoreConfirm.confirm}
        cancelLabel={labels.restoreConfirm.cancel}
        loading={restoreMutation.isPending}
        onConfirm={async () => {
          if (restoreTarget) await restore(restoreTarget);
        }}
      />
    </div>
  );
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatDateTime(value: string | null | undefined, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortID(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function paginationItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'ellipsis', totalPages];
  if (page >= totalPages - 3) {
    return [1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages];
}

export default function ArchivedContractsPage() {
  return (
    <LexRouteGuard route="/lex/contracts/archived">
      <ArchivedContractsView />
    </LexRouteGuard>
  );
}
