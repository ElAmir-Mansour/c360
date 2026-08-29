'use client';

/**
 * Competent Courts — tenant-maintained reference list (feedback items 5 and 6).
 *
 * Item 6 arrived as eight empty quotation marks: the customer's court list did
 * not survive the copy. Rather than invent Saudi court names, this screen exists
 * so the customer can enter their own the moment they have them, and so the
 * empty state says plainly that nothing is configured yet.
 *
 * It also surfaces the free-text `competent_court` strings written before the
 * reference list existed. They are shown exactly as entered, with case counts,
 * so an administrator can reconcile them by hand. Nothing is auto-mapped and
 * nothing is discarded.
 */

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, History, PencilLine, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LegalCourt } from '@/lib/lex/cases';
import type { FilterConfig, RowAction } from '@/types/table';
import { useAdminCommonLabels } from '../_lib/admin-labels';
import { CourtFormDialog } from './_components/court-form-dialog';
import {
  LEX_COURTS_QUERY_KEY,
  LEX_COURT_LEGACY_QUERY_KEY,
  lexCourtsApi,
  type LegacyCourtValue,
} from './_lib/courts-api';
import { useCourtLabels } from './_lib/courts-labels';

/** Reflects `active` on the row without a second vocabulary of statuses. */
function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function LexCourtsAdminPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useCourtLabels();
  const common = useAdminCommonLabels();
  const format = useLexFormat();
  const qc = useQueryClient();
  // Same gate as the sibling reference-data screens (classifications, service
  // catalog, attachment policies). The backend enforces it independently.
  const canWrite = hasPermission('lex:catalog:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<{ en: string; ar: string } | null>(null);
  const [editing, setEditing] = useState<LegalCourt | null>(null);
  const [deleting, setDeleting] = useState<LegalCourt | null>(null);

  const {
    tableProps,
    totalRows,
    searchValue,
    setSearch,
    activeFilters,
    setFilter,
    clearFilters,
  } = useDataTable<LegalCourt>({
    queryKey: LEX_COURTS_QUERY_KEY,
    fetchFn: (params) => lexCourtsApi.list(params),
    defaultPageSize: 25,
    defaultSort: { column: 'sort', direction: 'asc' },
  });

  const rows = tableProps.data;

  const legacyQuery = useQuery({
    queryKey: [LEX_COURT_LEGACY_QUERY_KEY],
    queryFn: () => lexCourtsApi.legacyValues(),
    staleTime: 60_000,
  });
  const legacyValues: LegacyCourtValue[] = legacyQuery.data ?? [];

  const stats = useMemo(() => {
    const active = rows.filter((court) => court.active).length;
    return { total: totalRows, active, legacy: legacyValues.length };
  }, [rows, totalRows, legacyValues.length]);
  const activeShare = percent(stats.active, rows.length);

  const del = useMutation({
    mutationFn: (id: string) => lexCourtsApi.remove(id),
    onSuccess: async () => {
      showSuccess(t.toast.deleted);
      await qc.invalidateQueries({ queryKey: [LEX_COURTS_QUERY_KEY] });
      setDeleting(null);
    },
    onError: showApiError,
  });

  const courtLabel = (court: LegalCourt): string =>
    resolveLocalized(court.name, locale) || court.code || t.unnamed;

  /**
   * Every Lex KPI tile has to lead somewhere — `clickable-stat-tiles.test.ts`
   * fails on a tile that only displays a number. Each tile here filters the
   * register below it and scrolls to it, so the count and the rows behind the
   * count are one gesture apart.
   */
  const reveal = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const activeOnly = activeFilters.active === 'true';
  const showAllCourts = () => {
    clearFilters();
    reveal('court-records');
  };
  const showActiveCourts = () => {
    setFilter('active', activeOnly ? undefined : 'true');
    reveal('court-records');
  };
  const showLegacyValues = () => reveal('court-legacy-values');

  const statusFilters: FilterConfig[] = useMemo(
    () => [
      {
        key: 'active',
        label: t.filters.status,
        type: 'select',
        options: [
          { label: t.filters.activeOnly, value: 'true' },
          { label: t.filters.inactiveOnly, value: 'false' },
        ],
      },
    ],
    [t],
  );

  const columns: ColumnDef<LegalCourt>[] = [
    {
      id: 'name',
      header: t.columns.name,
      cell: ({ row }) => <p className="font-medium">{courtLabel(row.original)}</p>,
    },
    {
      id: 'code',
      accessorKey: 'code',
      header: t.columns.code,
      enableSorting: true,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      id: 'status',
      accessorKey: 'active',
      header: t.columns.status,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={row.original.active ? 'default' : 'outline'}>
            {row.original.active ? common.active : common.inactive}
          </Badge>
          {row.original.is_system ? <Badge variant="outline">{t.systemBadge}</Badge> : null}
        </div>
      ),
    },
    {
      id: 'sort',
      accessorKey: 'sort',
      header: t.columns.sort,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{format.formatNumber(row.original.sort)}</span>
      ),
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: t.columns.updated,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{format.formatDate(row.original.updated_at)}</span>
      ),
    },
  ];

  const rowActions: RowAction<LegalCourt>[] = [
    { label: common.edit, icon: PencilLine, onClick: (row) => setEditing(row) },
    { label: common.delete, icon: Trash2, variant: 'destructive', onClick: (row) => setDeleting(row) },
  ];

  const openCreate = (seed?: { en: string; ar: string }) => {
    setCreateSeed(seed ?? null);
    setCreateOpen(true);
  };

  return (
    <LexAccessGuard routeKey="/lex/admin/courts" resourceName={t.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            canWrite ? (
              <Button onClick={() => openCreate()}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {t.create}
              </Button>
            ) : undefined
          }
        />

        <div className="court-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={Building2}
            loading={tableProps.isLoading}
            detail={t.statsDetail.registry}
            detailValue={t.statsDetail.courts}
            size="md"
            appearance="operational"
            className="court-kpi-card"
            onAction={showAllCourts}
          />
          <StatTile
            label={t.stats.active}
            value={stats.active}
            themeClass="kpi-theme-emerald"
            icon={CheckCircle2}
            loading={tableProps.isLoading}
            progress={activeShare}
            progressLabel={t.statsDetail.activeShare}
            detail={t.statsDetail.registry}
            detailValue={`${activeShare}%`}
            size="md"
            appearance="operational"
            onAction={showActiveCourts}
            pressed={activeOnly}
            className="court-kpi-card"
          />
          <StatTile
            label={t.stats.legacy}
            value={stats.legacy}
            themeClass="kpi-theme-amber"
            icon={History}
            loading={legacyQuery.isLoading}
            error={legacyQuery.isError}
            detail={t.statsDetail.unreconciled}
            detailValue={t.legacy.title}
            size="md"
            appearance="operational"
            className="court-kpi-card"
            onAction={showLegacyValues}
          />
        </div>

        <div id="court-records" className="scroll-mt-24">
          <DataTable
            {...tableProps}
            columns={columns}
            filters={statusFilters}
            getRowId={(row) => row.id}
            rowActions={canWrite ? rowActions : undefined}
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={t.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: Building2,
              title: t.emptyTitle,
              // The single worst outcome here is a silent empty select. Say what
              // is happening, and offer the fix to whoever can actually apply it.
              description: canWrite ? t.emptyDescription : t.emptyDescriptionReadOnly,
              ...(canWrite
                ? { action: { label: t.create, onClick: () => openCreate(), icon: Plus } }
                : {}),
            }}
          />
        </div>

        <div id="court-legacy-values" className="scroll-mt-24">
          <SectionCard
            title={t.legacy.title}
            description={t.legacy.description}
            isLoading={legacyQuery.isLoading}
            isEmpty={!legacyQuery.isLoading && !legacyQuery.isError && legacyValues.length === 0}
            emptyState={
              <p className="py-6 text-center text-sm text-muted-foreground">{t.legacy.empty}</p>
            }
          >
            {legacyQuery.isError ? (
              <p role="alert" className="text-sm text-muted-foreground">
                {t.legacy.loadError}
              </p>
            ) : (
              <div className="space-y-3">
                <div
                  className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                  role="note"
                >
                  <span className="block font-medium text-foreground">{t.legacy.noteTitle}</span>
                  <span className="mt-1 block">{t.legacy.note}</span>
                </div>
                <ul className="divide-y rounded-md border">
                  {legacyValues.map((legacy) => (
                    <li
                      key={legacy.value}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                      data-testid="legacy-court-value"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{legacy.value}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.legacy.caseCount(format.formatNumber(legacy.cases))}
                        </p>
                      </div>
                      {canWrite ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openCreate({ en: '', ar: legacy.value })}
                        >
                          <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
                          {t.legacy.createFrom}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        </div>

        <CourtFormDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setCreateSeed(null);
          }}
          initialNameEn={createSeed?.en}
          initialNameAr={createSeed?.ar}
        />
        <CourtFormDialog
          open={editing != null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          court={editing}
        />

        <ConfirmDialog
          open={deleting != null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title={t.confirmDeleteTitle}
          description={deleting ? t.confirmDeleteDescription(courtLabel(deleting)) : ''}
          variant="destructive"
          confirmLabel={common.delete}
          cancelLabel={common.cancel}
          loading={del.isPending}
          onConfirm={async () => {
            if (deleting) await del.mutateAsync(deleting.id);
          }}
        />
      </div>
    </LexAccessGuard>
  );
}
