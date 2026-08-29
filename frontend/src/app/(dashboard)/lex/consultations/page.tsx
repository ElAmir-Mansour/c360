'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Download,
  Gauge,
  LayoutGrid,
  List as ListIcon,
  MessagesSquare,
  Plus,
  Route as RouteIcon,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { DateRangePicker } from '@/components/shared/forms/date-range-picker';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { LexListShell } from '@/components/lex/list-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/shared/forms/form-field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { canAccessWith, LEX_ROUTE_PERMISSIONS } from '@/lib/permissions';
import { consultationTagLabel } from './_components/consultation-tag-i18n';
import { downloadBlob } from '@/lib/format';
import { showApiError, showSuccess, showWarning } from '@/lib/toast';
import { resolveLocalized } from '@/lib/i18n/localized';
import { fetchSuitePaginated } from '@/lib/suite-api';
import type { BulkAction, FetchParams } from '@/types/table';
import {
  CONSULTATION_PRIORITY_VALUES,
  CONSULTATION_STATUS_VALUES,
  CONSULTATION_TYPE_VALUES,
  consultationsApi,
  type ArchiveConsultationPayload,
  type BulkConsultationPayload,
  type ClassifyConsultationPayload,
  type Consultation,
  type ConsultationStatus,
  type RespondConsultationPayload,
  type RouteConsultationPayload,
} from '@/lib/lex/consultations';
import { formatConsultationToken, useConsultationLabels } from './_components/labels';
import {
  ConsultationsKpis,
  type ConsultationLifecycleTile,
  type ConsultationSlaTile,
  type ConsultationsStats,
} from './_components/consultations-kpis';
import {
  buildConsultationColumns,
  type ConsultationRowAction,
} from './_components/consultations-columns';
import { ConsultationsBoard } from './_components/consultations-board';
import {
  ConsultationArchiveDialog,
  ConsultationClassifyDialog,
  ConsultationRouteDialog,
  ConsultationRespondDialog,
} from './_components/consultation-dialogs';
import { useContractsControlLabels } from '../contracts/control/_lib/labels';

const BASE = '/api/v1/lex/consultations';

/* ------------------------------------------------------------------------- *
 * Saved-view presets (#5). A preset is just a set of filter overrides applied
 * relative to the current user. `null` clears the corresponding filter.
 * ------------------------------------------------------------------------- */
type SavedViewKey =
  | 'all'
  | 'assignedToMe'
  | 'awaitingMyResponse'
  | 'awaitingMyApproval';

/** Single-target dialog state for inline row-actions + board transitions (#7/#9). */
type ActiveDialog = 'classify' | 'route' | 'respond' | 'archive' | null;

/** Bulk dialog kind opened from the selection bar (#8). */
type BulkDialogKind = 'classify' | 'route' | 'archive' | 'tag' | 'delete' | null;

export default function LexConsultationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { hasPermission, user } = useAuth();
  const { locale } = useLocale();
  const labels = useConsultationLabels();
  const controlLabels = useContractsControlLabels();
  const archiveViewLabel =
    locale === 'ar' ? 'أرشيف الاستشارات' : 'Consultation archive';
  // Classification/routing/response mutations are edit operations. Previously
  // an add-only user saw these controls and received a backend 403.
  const canWrite = hasPermission('lex:consultation:edit');
  const canCreate = hasPermission('lex:consultation:add');
  // Destructive bulk delete mirrors the backend gate: mutate + the close verb.
  const canDelete = canWrite && hasPermission('lex:consultation:close');
  const canViewControlPanel = canAccessWith(
    hasPermission,
    LEX_ROUTE_PERMISSIONS['/lex/contracts/control'],
  );
  const currentUserId = user?.id ?? '';

  const [viewMode, setViewMode] = useState<'table' | 'board'>('table');

  // Inline single-target action state (#7).
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [actionTarget, setActionTarget] = useState<Consultation | null>(null);

  // Bulk state (#8).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialogKind>(null);
  const [bulkTags, setBulkTags] = useState('');

  const {
    tableProps,
    searchValue,
    setSearch,
    activeFilters,
    setFilter,
    clearFilters,
  } = useDataTable<Consultation>({
    queryKey: 'lex-consultations',
    fetchFn: (params) => fetchSuitePaginated<Consultation>(BASE, params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['lex.consultations'],
  });

  // The exact filter set powering the table; reused verbatim for the stats
  // query so the KPI cards reflect the SAME filtered dataset (#4).
  const statsFetchParams: FetchParams = useMemo(
    () => ({
      page: 1,
      per_page: 1,
      filters: Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
      search: searchValue || undefined,
    }),
    [activeFilters, searchValue],
  );

  const statsQuery = useQuery({
    queryKey: ['lex-consultations-stats', statsFetchParams],
    queryFn: () => consultationsApi.stats(statsFetchParams),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const tagsQuery = useQuery({
    queryKey: ['lex-consultations-tags'],
    queryFn: () => consultationsApi.listTags(),
    staleTime: 5 * 60_000,
  });

  // Dataset-wide stats (#4), with the two SLA-risk rollups (#3) and avg respond.
  const stats: ConsultationsStats = useMemo(() => {
    const s = statsQuery.data;
    return {
      total: s?.total ?? 0,
      open: s?.open ?? 0,
      responded: s?.responded ?? 0,
      approved: s?.approved ?? 0,
      breachingSoon: s?.due_soon ?? 0,
      breached: s?.breached ?? 0,
      avgRespondMinutes: s?.avg_respond_minutes ?? 0,
    };
  }, [statsQuery.data]);

  /* --------------------------------------------------------------------- *
   * Filter helpers. Each value rides FetchParams.filters as a string and
   * threads to BOTH the table and the stats query (shared `activeFilters`).
   * --------------------------------------------------------------------- */
  const activeSlaRisk = (activeFilters.sla_risk as ConsultationSlaTile | undefined) ?? null;
  const activeLifecycle = useMemo<ConsultationLifecycleTile | null>(() => {
    const status = activeFilters.status;
    if (status === undefined) return 'all';
    if (status === 'responded') return 'responded';
    if (Array.isArray(status)) {
      const key = status.join(',');
      if (key === 'submitted,classified,routed') return 'open';
      if (key === 'approved,archived') return 'approved';
    }
    return null;
  }, [activeFilters.status]);
  const activeTag = typeof activeFilters.tag === 'string' ? activeFilters.tag : undefined;
  const createdFrom = typeof activeFilters.created_from === 'string' ? activeFilters.created_from : undefined;
  const createdTo = typeof activeFilters.created_to === 'string' ? activeFilters.created_to : undefined;

  const setSlaRisk = (risk: ConsultationSlaTile | null) =>
    setFilter('sla_risk', risk ?? undefined);

  const setLifecycle = (scope: ConsultationLifecycleTile) => {
    switch (scope) {
      case 'all':
        setFilter('status', undefined);
        break;
      case 'open':
        setFilter('status', ['submitted', 'classified', 'routed']);
        break;
      case 'responded':
        setFilter('status', 'responded');
        break;
      case 'approved':
        setFilter('status', ['approved', 'archived']);
        break;
    }
  };

  const setTag = (tag: string | undefined) => setFilter('tag', tag);

  const dateRangeValue = useMemo(
    () => ({
      from: createdFrom ? new Date(createdFrom) : undefined,
      to: createdTo ? new Date(createdTo) : undefined,
    }),
    [createdFrom, createdTo],
  );

  const onDateRangeChange = (range: { from?: Date; to?: Date }) => {
    setFilter('created_from', range.from ? range.from.toISOString() : undefined);
    setFilter('created_to', range.to ? range.to.toISOString() : undefined);
  };

  // Which saved-view chip is active, derived from the live filters (#5).
  const activeSavedView: SavedViewKey = useMemo(() => {
    const advisor = activeFilters.advisor_id;
    const status = activeFilters.status;
    if (advisor === currentUserId && status === 'routed') return 'awaitingMyResponse';
    if (status === 'responded' && !advisor) return 'awaitingMyApproval';
    if (advisor === currentUserId) return 'assignedToMe';
    return 'all';
  }, [activeFilters, currentUserId]);

  const applySavedView = (view: SavedViewKey) => {
    switch (view) {
      case 'all':
        setFilter('advisor_id', undefined);
        setFilter('status', undefined);
        break;
      case 'assignedToMe':
        setFilter('advisor_id', currentUserId);
        setFilter('status', undefined);
        break;
      case 'awaitingMyResponse':
        setFilter('advisor_id', currentUserId);
        setFilter('status', 'routed');
        break;
      case 'awaitingMyApproval':
        // Awaiting approval is status-driven (no advisor constraint).
        setFilter('advisor_id', undefined);
        setFilter('status', 'responded');
        break;
    }
  };

  /**
   * Apply a persisted saved view (#17): clear the live filter set, then replay
   * each saved key. `<SavedViewsBar>` hands back the exact `activeFilters`
   * snapshot it captured, so this round-trips losslessly.
   */
  const applySavedFilters = (saved: Record<string, string | string[]>) => {
    clearFilters();
    for (const [key, value] of Object.entries(saved)) {
      setFilter(key, value);
    }
  };

  const savedViewBarLabels = useMemo(
    () => ({
      save: labels.savedViews.saveCurrent,
      saved: labels.savedViews.saved,
      empty: labels.savedViews.noneSaved,
    }),
    [labels.savedViews],
  );

  /* --------------------------------------------------------------------- *
   * Shared invalidation after a successful mutation.
   * --------------------------------------------------------------------- */
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['lex-consultations'] }),
      qc.invalidateQueries({ queryKey: ['lex-consultations-stats'] }),
      qc.invalidateQueries({ queryKey: ['lex-consultations-tags'] }),
    ]);
  };

  const closeAction = () => {
    setActiveDialog(null);
    setActionTarget(null);
  };

  /* --------------------------------------------------------------------- *
   * Single-target action mutations (#7).
   * --------------------------------------------------------------------- */
  const classifyMutation = useMutation({
    mutationFn: (payload: ClassifyConsultationPayload) =>
      consultationsApi.classify(actionTarget!.id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.classified);
      closeAction();
      await refresh();
    },
    onError: showApiError,
  });

  const routeMutation = useMutation({
    mutationFn: (payload: RouteConsultationPayload) =>
      consultationsApi.route(actionTarget!.id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.routed);
      closeAction();
      await refresh();
    },
    onError: showApiError,
  });

  const respondMutation = useMutation({
    mutationFn: (payload: RespondConsultationPayload) =>
      consultationsApi.respond(actionTarget!.id, { ...payload, locale }),
    onSuccess: async () => {
      showSuccess(labels.toast.responded);
      closeAction();
      await refresh();
    },
    onError: showApiError,
  });

  const archiveMutation = useMutation({
    mutationFn: (payload: ArchiveConsultationPayload) =>
      consultationsApi.archive(actionTarget!.id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.archived);
      closeAction();
      await refresh();
    },
    onError: showApiError,
  });

  const onRowAction = (consultation: Consultation, action: ConsultationRowAction) => {
    if (action === 'open') {
      router.push(`/lex/consultations/${consultation.id}`);
      return;
    }
    if (!canWrite) return;
    setActionTarget(consultation);
    setActiveDialog(action);
  };

  // Board "advance to status" → open the dialog that performs that transition.
  const onBoardAdvance = (consultation: Consultation, targetStatus: ConsultationStatus) => {
    if (!canWrite) return;
    const map: Partial<Record<ConsultationStatus, ActiveDialog>> = {
      classified: 'classify',
      routed: 'route',
      responded: 'respond',
      archived: 'archive',
    };
    const dialog = map[targetStatus] ?? null;
    if (!dialog) return;
    setActionTarget(consultation);
    setActiveDialog(dialog);
  };

  /* --------------------------------------------------------------------- *
   * Bulk mutation (#8). One call per action; reports partial outcomes.
   * --------------------------------------------------------------------- */
  const bulkMutation = useMutation({
    mutationFn: (payload: BulkConsultationPayload) => consultationsApi.bulk(payload),
    onSuccess: async (result) => {
      if (result.failed.length > 0) {
        showWarning(
          labels.bulk.selected(result.succeeded.length),
          result.failed.map((f) => `${f.id}: ${f.error}`).join('; '),
        );
      } else {
        showSuccess(labels.bulk.selected(result.succeeded.length));
      }
      setBulkDialog(null);
      setBulkTags('');
      setSelectedIds([]);
      await refresh();
    },
    onError: showApiError,
  });

  const bulkActions: BulkAction[] = useMemo(() => {
    if (!canWrite) return [];
    const actions: BulkAction[] = [
      {
        label: labels.bulk.bulkClassify,
        icon: TagIcon,
        onClick: async () => setBulkDialog('classify'),
      },
      {
        label: labels.bulk.bulkRoute,
        icon: RouteIcon,
        onClick: async () => setBulkDialog('route'),
      },
      {
        label: labels.bulk.bulkTag,
        icon: TagIcon,
        onClick: async () => setBulkDialog('tag'),
      },
      {
        label: labels.bulk.bulkArchive,
        icon: Archive,
        onClick: async () => setBulkDialog('archive'),
      },
    ];
    if (canDelete) {
      actions.push({
        label: labels.bulk.bulkDelete,
        icon: Trash2,
        variant: 'destructive',
        onClick: async () => setBulkDialog('delete'),
      });
    }
    return actions;
  }, [canWrite, canDelete, labels.bulk]);

  /* --------------------------------------------------------------------- *
   * Export current filtered list as CSV (bonus).
   * --------------------------------------------------------------------- */
  const [exporting, setExporting] = useState(false);
  const exportList = async () => {
    setExporting(true);
    try {
      const res = await consultationsApi.list({
        page: 1,
        per_page: 1000,
        sort: tableProps.sortColumn,
        order: tableProps.sortDirection,
        search: searchValue || undefined,
        filters: Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
      });
      const rows = res.data;
      const header = [
        labels.columns.number,
        labels.columns.title,
        labels.columns.type,
        labels.columns.status,
        labels.columns.priority,
        labels.columns.advisor,
        labels.columns.updated,
      ];
      const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      const lines = rows.map((c) =>
        [
          c.consultation_number,
          resolveLocalized(c.title, locale) || c.consultation_number,
          labels.filters.typeOptions[c.type] ?? formatConsultationToken(c.type),
          labels.filters.statusOptions[c.status] ?? c.status,
          labels.filters.priorityOptions[c.priority] ?? c.priority,
          c.advisor_name || labels.detail.unassigned,
          c.updated_at,
        ]
          .map((cell) => esc(String(cell ?? '')))
          .join(','),
      );
      const csv = [header.map(esc).join(','), ...lines].join('\n');
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `consultations-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      showApiError(err);
    } finally {
      setExporting(false);
    }
  };

  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select' as const,
        options: CONSULTATION_STATUS_VALUES.map((value) => ({
          label: labels.filters.statusOptions[value] ?? formatConsultationToken(value),
          value,
        })),
      },
      {
        key: 'type',
        label: labels.filters.type,
        type: 'select' as const,
        options: CONSULTATION_TYPE_VALUES.map((value) => ({
          label: labels.filters.typeOptions[value] ?? formatConsultationToken(value),
          value,
        })),
      },
      {
        key: 'priority',
        label: labels.filters.priority,
        type: 'select' as const,
        options: CONSULTATION_PRIORITY_VALUES.map((value) => ({
          label: labels.filters.priorityOptions[value] ?? formatConsultationToken(value),
          value,
        })),
      },
    ],
    [labels.filters],
  );

  const columns = useMemo(
    () => buildConsultationColumns({ labels, locale, onRowAction }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, locale, canWrite],
  );

  const savedViewChips: Array<{ key: SavedViewKey; label: string }> = [
    { key: 'all', label: labels.savedViews.all },
    { key: 'assignedToMe', label: labels.savedViews.assignedToMe },
    { key: 'awaitingMyResponse', label: labels.savedViews.awaitingMyResponse },
    { key: 'awaitingMyApproval', label: labels.savedViews.awaitingMyApproval },
  ];

  const tagSuggestions = tagsQuery.data ?? [];

  // Reset selection whenever the visible dataset changes meaningfully.
  useEffect(() => {
    setSelectedIds([]);
  }, [activeFilters, searchValue]);

  const bulkTargetCount = selectedIds.length;

  return (
    <LexRouteGuard route="/lex/consultations">
      <LexListShell
        title={labels.pageTitle}
        description={labels.pageDescription}
        eyebrow={labels.eyebrow}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/lex/consultations/archive">
                <Archive className="me-1.5 h-4 w-4" aria-hidden />
                {archiveViewLabel}
              </Link>
            </Button>
            {canViewControlPanel ? (
              <Button variant="outline" asChild>
                <Link href="/lex/contracts/control">
                  <Gauge className="me-1.5 h-4 w-4" aria-hidden />
                  {controlLabels.page.navShort}
                </Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void exportList()}
              disabled={exporting}
              className="motion-safe:duration-fast motion-safe:ease-emphasized"
            >
              <Download className="me-1.5 h-4 w-4" />
              {labels.analytics.exportList}
            </Button>
            {canCreate ? (
              <Button
                asChild
                className="motion-safe:duration-fast motion-safe:ease-emphasized"
              >
                <Link href="/lex/consultations/new">
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {labels.create}
                </Link>
              </Button>
            ) : null}
          </div>
        }
        kpi={
          <ConsultationsKpis
            stats={stats}
            loading={statsQuery.isLoading && !statsQuery.data}
            activeSlaRisk={activeSlaRisk}
            activeLifecycle={activeLifecycle}
            onSlaTileClick={setSlaRisk}
            onLifecycleTileClick={setLifecycle}
          />
        }
        filters={
          <div className="space-y-4">
            {/* Saved-view presets (#5/#17) + date range (#10) + view toggle (#9). */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {savedViewChips.map((chip) => (
                  <Button
                    key={chip.key}
                    size="sm"
                    variant={activeSavedView === chip.key ? 'default' : 'outline'}
                    onClick={() => applySavedView(chip.key)}
                    className="motion-safe:duration-fast"
                  >
                    {chip.label}
                  </Button>
                ))}
                <SavedViewsBar
                  namespace="lex-consultations"
                  activeFilters={activeFilters}
                  onApply={applySavedFilters}
                  labels={savedViewBarLabels}
                />
              </div>

              <div className="flex items-center gap-3">
                <DateRangePicker value={dateRangeValue} onChange={onDateRangeChange} />
                {createdFrom || createdTo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFilter('created_from', undefined);
                      setFilter('created_to', undefined);
                    }}
                  >
                    <X className="me-1.5 h-3.5 w-3.5" />
                    {labels.dateRange.clear}
                  </Button>
                ) : null}

                <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background/40 p-1">
                  <Button
                    size="sm"
                    variant={viewMode === 'table' ? 'default' : 'ghost'}
                    onClick={() => setViewMode('table')}
                  >
                    <ListIcon className="me-1.5 h-4 w-4" />
                    {labels.board.table}
                  </Button>
                  <Button
                    size="sm"
                    variant={viewMode === 'board' ? 'default' : 'ghost'}
                    onClick={() => setViewMode('board')}
                  >
                    <LayoutGrid className="me-1.5 h-4 w-4" />
                    {labels.board.board}
                  </Button>
                </div>
              </div>
            </div>

            {/* Tag filter chips (#12). */}
            {tagSuggestions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {labels.tags.filterByTag}:
                </span>
                {tagSuggestions.map((tag) => (
                  <Badge
                    key={tag}
                    role="button"
                    tabIndex={0}
                    // User-authored tags can be Arabic or Latin; `dir="auto"`
                    // lets each chip pick its own base direction under RTL.
                    dir="auto"
                    variant={activeTag === tag ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setTag(activeTag === tag ? undefined : tag)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setTag(activeTag === tag ? undefined : tag);
                      }
                    }}
                  >
                    {consultationTagLabel(tag, locale)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        }
        framedBody={false}
      >
        {viewMode === 'board' ? (
          <ConsultationsBoard
            labels={labels}
            locale={locale}
            loading={tableProps.isLoading}
            onSelect={(c) => router.push(`/lex/consultations/${c.id}`)}
            onAdvance={onBoardAdvance}
          />
        ) : (
          <DataTable
            {...tableProps}
            columns={columns}
            filters={filters}
            getRowId={(row) => row.id}
            enableSelection={canWrite}
            onSelectionChange={setSelectedIds}
            bulkActions={bulkActions}
            // Premium table options aligned with the service-desk list
            // convention: stable per-table prefs id (density / column widths /
            // order persistence), sticky header, striped rows, and the toolbar
            // density + column-visibility toggles. `{...tableProps}` still
            // carries loading / error / retry, so all three states are handled.
            tableId="lex-consultations"
            stickyHeader
            striped
            enableDensityToggle
            enableColumnToggle
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={labels.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: MessagesSquare,
              title: labels.emptyTitle,
              description: labels.emptyDescription,
              action: canCreate
                ? {
                    label: labels.create,
                    onClick: () => router.push('/lex/consultations/new'),
                    icon: Plus,
                  }
                : undefined,
            }}
          />
        )}

        {/* Manual "Clear selection" affordance (#8). */}
        {bulkTargetCount > 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{labels.bulk.selected(bulkTargetCount)}</span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              {labels.bulk.clearSelection}
            </Button>
          </div>
        ) : null}

        {/* ----- Single-target action dialogs (#7 / board #9) ----- */}
        {canWrite && actionTarget ? (
          <>
            <ConsultationClassifyDialog
              open={activeDialog === 'classify'}
              currentType={actionTarget.type}
              currentPriority={actionTarget.priority}
              loading={classifyMutation.isPending}
              onOpenChange={(o) => (o ? undefined : closeAction())}
              onSubmit={(payload) => classifyMutation.mutate(payload)}
            />
            <ConsultationRouteDialog
              open={activeDialog === 'route'}
              loading={routeMutation.isPending}
              onOpenChange={(o) => (o ? undefined : closeAction())}
              onSubmit={(payload) => routeMutation.mutate(payload)}
            />
            <ConsultationRespondDialog
              open={activeDialog === 'respond'}
              loading={respondMutation.isPending}
              consultationId={actionTarget.id}
              slaResponseDueAt={actionTarget.sla_response_due_at}
              onOpenChange={(o) => (o ? undefined : closeAction())}
              onSubmit={(payload) => respondMutation.mutate(payload)}
            />
            <ConsultationArchiveDialog
              open={activeDialog === 'archive'}
              loading={archiveMutation.isPending}
              onOpenChange={(o) => (o ? undefined : closeAction())}
              onSubmit={(payload) => archiveMutation.mutate(payload)}
            />
          </>
        ) : null}

        {/* ----- Bulk dialogs (#8) ----- */}
        {canWrite ? (
          <>
            <ConsultationClassifyDialog
              open={bulkDialog === 'classify'}
              currentType="general"
              currentPriority="medium"
              loading={bulkMutation.isPending}
              onOpenChange={(o) => (o ? undefined : setBulkDialog(null))}
              onSubmit={(payload) =>
                bulkMutation.mutate({
                  action: 'classify',
                  ids: selectedIds,
                  type: payload.type,
                  priority: payload.priority,
                })
              }
            />
            <ConsultationRouteDialog
              open={bulkDialog === 'route'}
              loading={bulkMutation.isPending}
              onOpenChange={(o) => (o ? undefined : setBulkDialog(null))}
              onSubmit={(payload) =>
                bulkMutation.mutate({
                  action: 'route',
                  ids: selectedIds,
                  advisor_id: payload.advisor_id,
                  advisor_name: payload.advisor_name ?? undefined,
                })
              }
            />
            <ConsultationArchiveDialog
              open={bulkDialog === 'archive'}
              loading={bulkMutation.isPending}
              onOpenChange={(o) => (o ? undefined : setBulkDialog(null))}
              onSubmit={(payload) =>
                bulkMutation.mutate({
                  action: 'archive',
                  ids: selectedIds,
                  reason: payload.reason,
                })
              }
            />

            {/* Bulk tag — no shared dialog exists, so a minimal inline one. */}
            <Dialog
              open={bulkDialog === 'tag'}
              onOpenChange={(o) => {
                if (!o) {
                  setBulkDialog(null);
                  setBulkTags('');
                }
              }}
            >
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{labels.bulk.bulkTag}</DialogTitle>
                  <DialogDescription>{labels.tags.addTag}</DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const tags = bulkTags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean);
                    if (tags.length === 0) return;
                    bulkMutation.mutate({
                      action: 'tag',
                      ids: selectedIds,
                      tags,
                      tag_mode: 'add',
                    });
                  }}
                >
                  <FormField name="tags" label={labels.tags.addTag}>
                    <Input
                      id="tags"
                      value={bulkTags}
                      onChange={(e) => setBulkTags(e.target.value)}
                      placeholder={labels.form.tagsPlaceholder}
                    />
                  </FormField>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setBulkDialog(null);
                        setBulkTags('');
                      }}
                    >
                      {labels.dialogs.cancel}
                    </Button>
                    <Button type="submit" disabled={bulkMutation.isPending}>
                      {labels.bulk.apply}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <ConfirmDialog
              open={bulkDialog === 'delete'}
              onOpenChange={(o) => (o ? undefined : setBulkDialog(null))}
              title={labels.bulk.bulkDelete}
              description={labels.confirm.deleteDescription(labels.bulk.selected(bulkTargetCount))}
              confirmLabel={labels.bulk.apply}
              variant="destructive"
              loading={bulkMutation.isPending}
              onConfirm={async () => {
                await bulkMutation.mutateAsync({ action: 'delete', ids: selectedIds });
              }}
            />
          </>
        ) : null}

      </LexListShell>
    </LexRouteGuard>
  );
}
