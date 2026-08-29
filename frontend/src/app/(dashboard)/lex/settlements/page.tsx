'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  Handshake,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Send,
  ShieldAlert,
  Table2,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { RelativeTime } from '@/components/shared/relative-time';
import { LexStatusChip } from '@/components/lex/status-chip';
import { StatTile } from '@/components/shared/stat-tile';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLexFormat } from '@/lib/lex/ksa';
import type { BulkAction, FetchParams } from '@/types/table';
import {
  isSettlementMutable,
  settlementsApi,
  formatSettlementValue,
  type Settlement,
  type SettlementStatus,
} from '@/lib/lex/settlements';
import { SettlementFormDialog } from './_components/settlement-form-dialog';
import { SettlementBoard } from './_components/settlement-board';
import { SettlementBoardSurface } from './_components/settlement-board-surface';
import { SettlementApproverQueue } from './_components/settlement-approver-queue';
import {
  SettlementAnalyticsPanel,
  useSettlementReport,
} from './_components/settlement-analytics';
import {
  SettlementAgingBadge,
  compareSettlementAging,
  isSettlementAtRisk,
} from './_lib/settlement-sla';
import { exportSettlementsCsv } from './_lib/settlement-export';
import {
  SETTLEMENT_SAVED_VIEWS,
  useSettlementFilters,
  useSettlementSavedViews,
} from './_lib/use-settlement-views';
import {
  SETTLEMENT_METHOD_OPTIONS,
  SETTLEMENT_STATUS_OPTIONS,
  settlementMethodLabel,
  settlementStatusLabel,
  useSettlementLabels,
} from './_components/labels';

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export default function LexSettlementsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission, hasAnyPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const L = useSettlementLabels();
  const labels = L.list;
  // §9/§18.4 — settlement create CTA + board advance + submit map to the
  // settlement add/edit verbs; the approver queue gates on the approve verb.
  const canWrite = hasAnyPermission(['lex:settlement:add', 'lex:settlement:edit']);
  const canApprove = hasPermission('lex:settlement:approve');

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Settlement | null>(null);
  const [submitTarget, setSubmitTarget] = useState<Settlement | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'board'>('table');
  const [atRiskOnly, setAtRiskOnly] = useState(false);

  const {
    data,
    tableProps,
    totalRows,
    searchValue,
    setSearch,
    activeFilters,
    sortColumn,
    sortDirection,
  } = useDataTable<Settlement>({
    queryKey: 'lex-settlements',
    fetchFn: settlementsApi.list,
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['lex.settlements'],
  });

  // FEATURE 4 — saved views + URL-synced filter writes (presets + SavedViewsBar).
  const { filters: viewFilters, applyView, activeView } = useSettlementFilters();
  const viewLabels = useSettlementSavedViews();

  // Page-local strings that don't belong in the shared (read-only) labels module.
  const pageStrings = useMemo(
    () =>
      locale === 'ar'
        ? {
            eyebrow: 'المجموعة القانونية',
            aging: 'التقادم',
            atRiskFilter: 'المعرّضة للخطر',
            table: 'جدول',
            board: 'لوحة',
            export: 'تصدير',
            exported: (n: number) => `تم تصدير ${n} تسوية`,
          }
        : {
            eyebrow: 'Legal Suite',
            aging: 'Aging',
            atRiskFilter: 'At risk',
            table: 'Table',
            board: 'Board',
            export: 'Export',
            exported: (n: number) => `Exported ${n} settlement${n === 1 ? '' : 's'}`,
          },
    [locale],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['lex-settlements'] });
  };

  const submitMutation = useMutation({
    mutationFn: (id: string) => settlementsApi.submitForApproval(id),
    onSuccess: async () => {
      showSuccess(L.toast.submitted);
      setSubmitTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settlementsApi.remove(id),
    onSuccess: async () => {
      showSuccess(L.toast.deleted);
      setDeleteTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  // FEATURE 2 — board drag-to-advance. Only drag-eligible transitions reach
  // here (validated inside SettlementBoard). The single one-shot API is
  // submit-for-approval; other eligible transitions (proposed→negotiating,
  // rejected→negotiating) have no dedicated endpoint and route the user to the
  // detail page to record terms / re-open.
  const boardMoveMutation = useMutation({
    mutationFn: (id: string) => settlementsApi.submitForApproval(id),
    onSuccess: async (_data, id) => {
      showSuccess(L.toast.submitted);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-settlements'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-settlement', id] }),
      ]);
    },
    onError: showApiError,
  });

  const handleAdvance = useCallback(
    (settlement: Settlement, toStatus: SettlementStatus) => {
      if (toStatus === 'pending_approval') {
        boardMoveMutation.mutate(settlement.id);
        return;
      }
      // proposed→negotiating / rejected→negotiating: no one-shot API; the move
      // is recorded on the detail page (record terms / re-open).
      router.push(`/lex/settlements/${settlement.id}`);
    },
    [boardMoveMutation, router],
  );

  // FEATURE 6 — CSV export of the currently loaded register.
  const handleExport = useCallback(
    (rows: readonly Settlement[]) => {
      const count = exportSettlementsCsv(rows, {
        locale,
        statusLabel: (status) => settlementStatusLabel(L, status as SettlementStatus),
        methodLabel: (method) => settlementMethodLabel(L, method as Settlement['method']),
      });
      showSuccess(pageStrings.exported(count));
    },
    [locale, L, pageStrings],
  );

  // FEATURE 5 — bulk actions over selected rows.
  const bulkActions: BulkAction[] = useMemo(() => {
    const actions: BulkAction[] = [
      {
        label: pageStrings.export,
        icon: Download,
        onClick: async (ids) => {
          const selected = data.filter((row) => ids.includes(row.id));
          handleExport(selected);
        },
      },
    ];
    if (canWrite) {
      actions.unshift({
        label: labels.rowActions.submit,
        icon: Send,
        onClick: async (ids) => {
          const eligible = data.filter(
            (row) => ids.includes(row.id) && isSettlementMutable(row.status),
          );
          if (eligible.length === 0) {
            showApiError(new Error(L.confirm.submitDescription));
            return;
          }
          await Promise.all(eligible.map((row) => settlementsApi.submitForApproval(row.id)));
          showSuccess(L.toast.submitted);
          await refresh();
        },
      });
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, data, handleExport, labels.rowActions.submit, pageStrings.export, L]);

  // FEATURES 1 + 3 — server-accurate report scoped to the active filters/search,
  // so KPI tiles + analytics reflect the WHOLE filtered portfolio (not just the
  // loaded page the old countByStatus(data) summed). Both the KPI row and the
  // collapsible analytics panel share this one cached fetch per filter set.
  const reportParams = useMemo<FetchParams>(
    () => ({
      page: 1,
      per_page: 200,
      sort: sortColumn,
      order: sortDirection,
      search: searchValue || undefined,
      filters: Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
    }),
    [sortColumn, sortDirection, searchValue, activeFilters],
  );
  const { data: report, isLoading: reportLoading } = useSettlementReport(reportParams);
  const settlementTotal = report?.total ?? totalRows;
  const negotiatingCount = report?.by_status?.negotiating ?? 0;
  const pendingApprovalCount = report?.by_status?.pending_approval ?? 0;
  const executedCount = report?.by_status?.executed ?? 0;
  const negotiatingShare = percent(negotiatingCount, settlementTotal);
  const pendingApprovalShare = percent(pendingApprovalCount, settlementTotal);
  const executedShare = percent(executedCount, settlementTotal);

  // FEATURE 7 — "At risk" quick filter: derived staleness tier (stale/overdue),
  // sorted most-stale-first when active.
  const atRiskCount = useMemo(() => data.filter((s) => isSettlementAtRisk(s)).length, [data]);
  const displayData = useMemo(() => {
    if (!atRiskOnly) {
      return data;
    }
    return [...data].filter((s) => isSettlementAtRisk(s)).sort((a, b) => compareSettlementAging(a, b));
  }, [data, atRiskOnly]);

  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: L.filters.status,
        type: 'select' as const,
        options: SETTLEMENT_STATUS_OPTIONS.map((value) => ({
          label: L.filters.statusOptions[value],
          value,
        })),
      },
      {
        key: 'method',
        label: L.filters.method,
        type: 'select' as const,
        options: SETTLEMENT_METHOD_OPTIONS.map((value) => ({
          label: L.filters.methodOptions[value],
          value,
        })),
      },
    ],
    [L],
  );

  const columns: ColumnDef<Settlement>[] = useMemo(
    () => [
      {
        id: 'title',
        accessorKey: 'title',
        header: labels.columns.title,
        enableSorting: true,
        cell: ({ row }) => (
          <div>
            <Link
              href={`/lex/settlements/${row.original.id}`}
              className="font-medium hover:underline"
              dir="auto"
            >
              {row.original.title}
            </Link>
            <p className="text-xs text-muted-foreground" dir="auto">
              {row.original.reference || labels.notSet}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.columns.status,
        enableSorting: true,
        cell: ({ row }) => (
          <LexStatusChip
            value={row.original.status}
            domain="settlement"
            labels={L.filters.statusOptions}
            size="sm"
          />
        ),
      },
      {
        id: 'method',
        accessorKey: 'method',
        header: labels.columns.method,
        enableSorting: true,
        cell: ({ row }) => <Badge variant="outline">{settlementMethodLabel(L, row.original.method)}</Badge>,
      },
      {
        id: 'value',
        accessorKey: 'value',
        header: labels.columns.value,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.value != null
              ? formatSettlementValue(row.original.value, row.original.currency)
              : labels.noValue}
          </span>
        ),
      },
      {
        id: 'counterparty',
        accessorKey: 'counterparty_name',
        header: labels.columns.counterparty,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground" dir="auto">
            {row.original.counterparty_name || labels.notSet}
          </span>
        ),
      },
      {
        id: 'aging',
        header: pageStrings.aging,
        enableSorting: false,
        cell: ({ row }) => <SettlementAgingBadge settlement={row.original} size="sm" />,
      },
      {
        id: 'updated_at',
        accessorKey: 'updated_at',
        header: labels.columns.updated,
        enableSorting: true,
        cell: ({ row }) => <RelativeTime date={row.original.updated_at} />,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={labels.columns.actions}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href={`/lex/settlements/${settlement.id}`}>
                    <Eye className="me-2 h-4 w-4" />
                    {labels.rowActions.view}
                  </Link>
                </DropdownMenuItem>
                {canWrite ? (
                  <>
                    <DropdownMenuItem
                      disabled={!isSettlementMutable(settlement.status)}
                      onClick={() => setSubmitTarget(settlement)}
                    >
                      <Send className="me-2 h-4 w-4" />
                      {labels.rowActions.submit}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(settlement)}>
                      <Trash2 className="me-2 h-4 w-4" />
                      {labels.rowActions.delete}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [L, labels, canWrite, pageStrings.aging],
  );

  return (
    <LexRouteGuard route="/lex/settlements">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={pageStrings.eyebrow}
          title={labels.title}
          description={labels.description}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => handleExport(data)} disabled={data.length === 0}>
                <Download className="me-1.5 h-4 w-4" />
                {pageStrings.export}
              </Button>
              {canWrite ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.newSettlement}
                </Button>
              ) : null}
            </div>
          }
        />

        {/* FEATURE 1 — KPIs driven by the server report (whole filtered portfolio,
            not just the loaded page). Falls back to totalRows for the count until
            the report resolves. */}
        <div className="settlement-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={L.stats.total}
            value={f.formatNumber(settlementTotal)}
            themeClass="kpi-theme-primary"
            icon={Handshake}
            progress={settlementTotal > 0 ? 100 : 0}
            progressLabel={L.statDetails.portfolioShare}
            detail={L.statDetails.matchingFilters}
            detailValue={f.formatNumber(settlementTotal)}
            loading={reportLoading}
            size="md"
            appearance="operational"
            className="settlement-kpi-card"
            onAction={() => setViewMode('table')}
          />
          <StatTile
            label={L.stats.negotiating}
            value={f.formatNumber(negotiatingCount)}
            themeClass="kpi-theme-amber"
            icon={Send}
            progress={negotiatingShare}
            progressLabel={L.statDetails.negotiationShare}
            detail={L.stats.negotiating}
            detailValue={`${f.formatNumber(negotiatingShare)}%`}
            loading={reportLoading}
            size="md"
            appearance="operational"
            className="settlement-kpi-card"
            onAction={() => applyView({ ...viewFilters, status: 'negotiating' })}
            pressed={viewFilters.status === 'negotiating'}
          />
          <StatTile
            label={L.stats.pendingApproval}
            value={f.formatNumber(pendingApprovalCount)}
            themeClass="kpi-theme-amber"
            icon={ShieldAlert}
            progress={pendingApprovalShare}
            progressLabel={L.statDetails.approvalShare}
            detail={L.stats.pendingApproval}
            detailValue={`${f.formatNumber(pendingApprovalShare)}%`}
            loading={reportLoading}
            size="md"
            appearance="operational"
            className="settlement-kpi-card"
            onAction={() => applyView({ ...viewFilters, status: 'pending_approval' })}
            pressed={viewFilters.status === 'pending_approval'}
          />
          <StatTile
            label={L.stats.executed}
            value={f.formatNumber(executedCount)}
            themeClass="kpi-theme-emerald"
            icon={Handshake}
            progress={executedShare}
            progressLabel={L.statDetails.executionShare}
            detail={L.stats.executed}
            detailValue={`${f.formatNumber(executedShare)}%`}
            loading={reportLoading}
            size="md"
            appearance="operational"
            className="settlement-kpi-card"
            onAction={() => applyView({ ...viewFilters, status: 'executed' })}
            pressed={viewFilters.status === 'executed'}
          />
        </div>

        {/* FEATURE 3 — collapsible settlement analytics (default collapsed; only
            fetches on expand). Shares the report cache with the KPI tiles. */}
        <SettlementAnalyticsPanel params={reportParams} defaultCollapsed />

        {/* FEATURE 8 — approver queue (self-gated; renders null when !canApprove). */}
        <SettlementApproverQueue canApprove={canApprove} />

        {/* FEATURE 4 + 7 — saved views, presets, at-risk quick filter, view toggle. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SavedViewsBar
              namespace="lex-settlements"
              activeFilters={viewFilters}
              onApply={applyView}
              labels={{
                save: viewLabels.bar.save,
                saved: viewLabels.bar.saved,
                empty: viewLabels.bar.empty,
              }}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {SETTLEMENT_SAVED_VIEWS.map((view) => (
                <Button
                  key={view.id}
                  type="button"
                  size="sm"
                  variant={activeView === view.id ? 'secondary' : 'outline'}
                  aria-pressed={activeView === view.id}
                  className="h-8"
                  onClick={() => applyView(view)}
                >
                  {viewLabels.presets[view.id]}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={atRiskOnly ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 gap-1.5"
              aria-pressed={atRiskOnly}
              onClick={() => setAtRiskOnly((prev) => !prev)}
            >
              <ShieldAlert className="h-4 w-4" />
              {pageStrings.atRiskFilter}
              {atRiskCount > 0 ? (
                <Badge variant={atRiskOnly ? 'destructive' : 'secondary'} className="ms-1 px-1.5 tabular-nums">
                  {atRiskCount}
                </Badge>
              ) : null}
            </Button>
            <div className="inline-flex items-center gap-1 rounded-lg border p-0.5">
              <Button
                type="button"
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5"
                aria-pressed={viewMode === 'table'}
                onClick={() => setViewMode('table')}
              >
                <Table2 className="h-4 w-4" />
                {pageStrings.table}
              </Button>
              <Button
                type="button"
                variant={viewMode === 'board' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5"
                aria-pressed={viewMode === 'board'}
                onClick={() => setViewMode('board')}
              >
                <LayoutGrid className="h-4 w-4" />
                {pageStrings.board}
              </Button>
            </div>
          </div>
        </div>

        {viewMode === 'board' ? (
          // FEATURE 4 (item #4) — the board view now shares the table's full
          // loading / error / empty state coverage via the framed surface.
          <SettlementBoardSurface
            title={pageStrings.board}
            count={f.formatNumber(displayData.length)}
            loading={Boolean(tableProps.isLoading) && data.length === 0}
            error={tableProps.error}
            onRetry={tableProps.onRetry}
            empty={displayData.length === 0}
            emptyIcon={Handshake}
            emptyTitle={labels.emptyTitle}
            emptyDescription={labels.emptyDescription}
            onCreate={canWrite ? () => setCreateOpen(true) : undefined}
            createLabel={labels.newSettlement}
            createIcon={Plus}
          >
            <SettlementBoard
              settlements={displayData}
              canWrite={canWrite}
              dir={direction}
              onAdvance={canWrite ? handleAdvance : undefined}
              isMoving={boardMoveMutation.isPending}
            />
          </SettlementBoardSurface>
        ) : (
          <DataTable
            {...tableProps}
            data={displayData}
            columns={columns}
            filters={filters}
            enableSelection
            getRowId={(row) => row.id}
            bulkActions={bulkActions}
            striped
            stickyHeader
            enableColumnToggle
            enableDensityToggle
            tableId="lex-settlements"
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={labels.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: Handshake,
              title: labels.emptyTitle,
              description: labels.emptyDescription,
            }}
          />
        )}

        {canWrite ? (
          <SettlementFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onSaved={(settlement) => router.push(`/lex/settlements/${settlement.id}`)}
          />
        ) : null}

        {canWrite ? (
          <>
            <ConfirmDialog
              open={submitTarget !== null}
              onOpenChange={(open) => {
                if (!open) setSubmitTarget(null);
              }}
              title={L.confirm.submitTitle}
              description={L.confirm.submitDescription}
              confirmLabel={L.confirm.submitConfirm}
              loading={submitMutation.isPending}
              onConfirm={() => {
                if (submitTarget) {
                  submitMutation.mutate(submitTarget.id);
                }
              }}
            />
            <ConfirmDialog
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              title={L.confirm.deleteTitle}
              description={L.confirm.deleteDescription(deleteTarget?.title ?? '')}
              confirmLabel={L.confirm.deleteConfirm}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id);
                }
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}
