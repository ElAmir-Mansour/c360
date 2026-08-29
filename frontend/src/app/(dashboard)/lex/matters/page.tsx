'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlignJustify,
  BarChart3,
  ClipboardList,
  Download,
  Eye,
  Handshake,
  LayoutGrid,
  LayoutTemplate,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  SearchCheck,
  SlidersHorizontal,
  Table2,
  Trash2,
  UserCog,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { HelpTip } from '@/components/shared/help-tip';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { StatTile } from '@/components/shared/stat-tile';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SearchInput } from '@/components/shared/forms/search-input';
import { RelativeTime } from '@/components/shared/relative-time';
import { LexPriorityChip, LexStatusChip } from '@/components/lex/status-chip';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { useOptimisticMutation } from '@/hooks/use-optimistic-mutation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { useCommandPaletteStore } from '@/stores/command-palette-store';
import { enterpriseApi } from '@/lib/enterprise';
import { cn } from '@/lib/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { useUndoToast } from '@/lib/undo-toast';
import type { PaginatedResponse } from '@/types/api';
import type { BulkAction, FetchParams } from '@/types/table';
import type {
  LexMatter,
  LexMatterConflictCheckResult,
  LexMatterReport,
  LexTriageMatterPayload,
} from '@/types/suites';
import { MatterBoard } from './_components/matter-board';
import {
  MatterBulkReassignDialog,
  MatterBulkStatusDialog,
} from './_components/matter-bulk-dialogs';
import { MatterFormDialog } from './_components/matter-form-dialog';
import { MatterStatusDialog } from './_components/matter-status-dialog';
import { MatterTriageDialog } from './_components/matter-triage-dialog';
import { MatterTemplateGallery } from './_components/matter-templates';
import { MatterAnalyticsPanel } from './_components/matter-analytics';
import {
  DueDateEditCell,
  OwnerEditCell,
  PriorityEditCell,
} from './_components/inline-edit-cells';
import { MatterPreviewDrawer } from './_components/matter-preview-drawer';
import {
  MatterSlaBadge,
  compareMatterSla,
  isMatterAtRisk,
} from './_lib/matter-sla';
import {
  MATTER_PRESETS,
  buildPresetFilters,
  matchActivePreset,
  type MatterPreset,
} from './_lib/matters-presets';
import { deriveMatterStatTiles } from './_lib/matter-stats';
import { useMatterViewPrefs } from './_lib/use-matter-view-prefs';
import {
  MATTER_PRIORITY_OPTIONS,
  MATTER_STATUS_OPTIONS,
  MATTER_STATUS_TRANSITIONS,
  MATTER_TYPE_OPTIONS,
  type MatterLabels,
  useMatterLabels,
} from './_components/labels';

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export default function LexMattersPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, user } = useAuth();
  const currentUserId = user?.id ?? '';
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  // §9 — "matters" is the cross-domain legal-work view (predominantly cases);
  // gate viewing on lex:case:view and mutation on lex:case:edit. The scheme has
  // no dedicated lex:matter verb; `lex:*` wildcard still satisfies both.
  const canWrite = hasPermission('lex:case:edit');
  const matterLabels = useMatterLabels();
  const labels = matterLabels.list;

  const matterFilters = useMemo(
    () => [
      {
        key: 'status',
        label: matterLabels.filters.status,
        type: 'select' as const,
        options: MATTER_STATUS_OPTIONS.map((value) => ({
          label: matterLabels.filters.statusOptions[value],
          value,
        })),
      },
      {
        key: 'type',
        label: matterLabels.filters.type,
        type: 'select' as const,
        options: MATTER_TYPE_OPTIONS.map((value) => ({
          label: matterLabels.filters.typeOptions[value],
          value,
        })),
      },
      {
        key: 'priority',
        label: matterLabels.filters.priority,
        type: 'select' as const,
        options: MATTER_PRIORITY_OPTIONS.map((value) => ({
          label: matterLabels.filters.priorityOptions[value],
          value,
        })),
      },
      {
        key: 'due_date',
        label: matterLabels.filtersExtra.dueDate,
        type: 'date-range' as const,
      },
    ],
    [matterLabels],
  );

  const [conflictDraft, setConflictDraft] = useState({
    contractTitle: '',
    counterparty: '',
    description: '',
    title: '',
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LexMatter | null>(null);
  const [statusTarget, setStatusTarget] = useState<LexMatter | null>(null);
  const [triageTarget, setTriageTarget] = useState<LexMatter | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LexMatter | null>(null);
  const {
    view: viewMode,
    setView: setViewMode,
    density,
    setDensity,
    hiddenColumns,
    setHiddenColumns,
  } = useMatterViewPrefs();
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);

  // Page-local strings that don't belong in the shared labels module (which is
  // owned elsewhere); kept inline per the integrator label contract.
  const pageStrings = useMemo(
    () =>
      locale === 'ar'
        ? {
            eyebrow: 'الأعمال القانونية',
            loadErrorTitle: 'تعذّر تحميل القضايا',
            loadError: 'حدث خطأ أثناء تحميل سجل القضايا. حاول مرة أخرى.',
            slaColumn: 'المهلة',
            atRiskFilter: 'المعرّضة للخطر',
            newFromTemplate: 'من قالب',
            analytics: 'التحليلات',
            density: 'الكثافة',
            comfortable: 'مريحة',
            compact: 'مدمجة',
            kpiTotal: 'الإجمالي',
            kpiOpen: 'مفتوحة',
            kpiInReview: 'قيد المراجعة',
            kpiClosed: 'مغلقة',
            kpiAtRisk: 'المعرّضة للخطر',
            kpiShare: 'حصة القضايا',
            kpiCurrentReport: 'التقرير الحالي',
            cmdCreate: 'إنشاء قضية',
            cmdTemplate: 'قضية جديدة من قالب',
            cmdFilterAtRisk: 'تصفية: المعرّضة للخطر',
            cmdFilterMine: 'تصفية: قضاياي',
            cmdFilterReview: 'تصفية: قيد المراجعة',
            cmdBulkReassign: 'إعادة تعيين المحددة',
            cmdExport: 'تصدير المحددة (CSV)',
            cmdSection: 'القضايا',
            bulkStatusScheduled: (count: number) => `سيتم تحديث حالة ${count} قضية.`,
            bulkStatusScheduledHint: 'يمكنك التراجع قبل التنفيذ.',
          }
        : {
            eyebrow: 'Legal work',
            loadErrorTitle: 'Unable to load matters',
            loadError: 'Something went wrong while loading the matter register. Please try again.',
            slaColumn: 'SLA',
            atRiskFilter: 'At risk',
            newFromTemplate: 'From template',
            analytics: 'Analytics',
            density: 'Density',
            comfortable: 'Comfortable',
            compact: 'Compact',
            kpiTotal: 'Total',
            kpiOpen: 'Open',
            kpiInReview: 'In review',
            kpiClosed: 'Closed',
            kpiAtRisk: 'At risk',
            kpiShare: 'Matter share',
            kpiCurrentReport: 'Current report',
            cmdCreate: 'Create matter',
            cmdTemplate: 'New matter from template',
            cmdFilterAtRisk: 'Filter: At risk',
            cmdFilterMine: 'Filter: My matters',
            cmdFilterReview: 'Filter: In review',
            cmdBulkReassign: 'Bulk reassign selected',
            cmdExport: 'Export selected (CSV)',
            cmdSection: 'Matters',
            bulkStatusScheduled: (count: number) =>
              `Status will change for ${count} matter${count === 1 ? '' : 's'}.`,
            bulkStatusScheduledHint: 'You can undo before it runs.',
          },
    [locale],
  );

  const {
    data,
    tableProps,
    searchValue,
    setSearch,
    activeFilters,
    clearFilters,
  } = useDataTable<LexMatter>({
    queryKey: 'lex-matters',
    fetchFn: enterpriseApi.lex.listMatters,
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['lex.matters'],
  });

  // Reconstruct the active FetchParams so the analytics report + server-side
  // export mirror exactly the filters/search/sort the user is viewing.
  const reportParams: FetchParams = useMemo(
    () => ({
      page: 1,
      per_page: 200,
      sort: tableProps.sortColumn,
      order: tableProps.sortDirection,
      search: searchValue || undefined,
      filters: Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
    }),
    [tableProps.sortColumn, tableProps.sortDirection, searchValue, activeFilters],
  );

  // Server-accurate KPI counts: the matter report mirrors the active
  // filters/search/sort, so the Total/Open/In review/Closed tiles reflect the
  // whole filtered register (not just the current page) and stay consistent
  // with the inline analytics view.
  const { data: matterReport } = useQuery<LexMatterReport>({
    queryKey: ['lex-matter-report', reportParams],
    queryFn: () => enterpriseApi.lex.getMatterReport(reportParams),
  });

  // "At risk" quick filter: derived SLA tier (overdue/breached). When active we
  // also sort the rendered rows most-urgent-first via the shared comparator.
  const atRiskCount = useMemo(() => data.filter((matter) => isMatterAtRisk(matter)).length, [data]);
  const displayData = useMemo(() => {
    if (!atRiskOnly) {
      return data;
    }
    return [...data].filter((matter) => isMatterAtRisk(matter)).sort((a, b) => compareMatterSla(a, b));
  }, [data, atRiskOnly]);

  const refreshMatters = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-matters'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  // Apply a saved view's filter set atomically: reserved table params are kept,
  // every existing filter key is replaced by the saved params, and page resets.
  const applySavedView = useCallback(
    (params: Record<string, string | string[]>) => {
      const next = new URLSearchParams();
      for (const key of ['per_page', 'sort', 'order', 'search'] as const) {
        const value = searchParams?.get(key);
        if (value) {
          next.set(key, value);
        }
      }
      next.set('page', '1');
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          value.forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }
      const query = next.toString();
      router.push(query ? `${pathname ?? ''}?${query}` : pathname ?? '');
    },
    [router, pathname, searchParams],
  );

  // Quick-filter preset chips. A server preset is applied with the same
  // clear-then-set flow as saved views (turning the client at-risk toggle OFF);
  // the at-risk chip is a pure client slice routed to the `atRiskOnly` toggle
  // (and clears server filters) since its filter map is empty.
  const activePresetId = useMemo(
    () => matchActivePreset(activeFilters, currentUserId, atRiskOnly),
    [activeFilters, currentUserId, atRiskOnly],
  );

  const applyPreset = useCallback(
    (preset: MatterPreset) => {
      if (preset.clientAtRisk) {
        clearFilters();
        setAtRiskOnly(true);
        return;
      }
      setAtRiskOnly(false);
      // Apply atomically via the saved-view URL builder (one router.push that
      // keeps reserved params, replaces every filter, resets page) rather than
      // clearFilters()+setFilter() — chained pushes read a stale searchParams
      // snapshot and would not actually clear the prior filters.
      applySavedView(buildPresetFilters(preset, currentUserId));
    },
    [clearFilters, applySavedView, currentUserId],
  );

  const applyPresetById = useCallback(
    (id: string) => {
      const preset = MATTER_PRESETS.find((candidate) => candidate.id === id);
      if (preset) {
        applyPreset(preset);
      }
    },
    [applyPreset],
  );

  // Seed a sensible default-hidden set (lower-value columns) on first ever visit
  // only — i.e. when there is no persisted view-prefs blob yet. Reading storage
  // presence directly (rather than the hydrated `hiddenColumns`, which starts
  // empty pre-hydration) avoids clobbering a returning user's saved choice,
  // including one where they deliberately revealed every column.
  const seededHiddenRef = useRef(false);
  useEffect(() => {
    if (seededHiddenRef.current) return;
    seededHiddenRef.current = true;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(VIEW_PREFS_STORAGE_KEY) === null) {
      setHiddenColumns(DEFAULT_HIDDEN_COLUMNS);
    }
    // Runs once after mount; intentionally not reactive to hiddenColumns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collect every cached `lex-matters` list key so optimistic updates and
  // rollback touch whichever filter/sort/page variant is currently mounted.
  const matterListKeys = useCallback(
    () =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['lex-matters'] })
        .map((query) => query.queryKey as unknown[]),
    [queryClient],
  );

  const applyStatusToCache = useCallback(
    (prev: PaginatedResponse<LexMatter> | undefined, vars: { matterId: string; status: string }) => {
      if (!prev?.data) {
        return prev;
      }
      return {
        ...prev,
        data: prev.data.map((matter) =>
          matter.id === vars.matterId ? { ...matter, status: vars.status } : matter,
        ),
      };
    },
    [],
  );

  const statusMutation = useOptimisticMutation<{ matterId: string; status: string }, LexMatter>({
    mutationFn: ({ matterId, status }) =>
      enterpriseApi.lex.updateMatterStatus(matterId, { status }),
    queryKeys: matterListKeys(),
    applyOptimistic: applyStatusToCache,
    onSuccess: () => {
      showSuccess(matterLabels.toast.statusUpdated);
      setStatusTarget(null);
    },
    onError: showApiError,
    invalidateKeys: [['lex-matters'], ['lex-overview']],
  });

  const triageMutation = useMutation({
    mutationFn: ({ matter, payload }: { matter: LexMatter; payload: LexTriageMatterPayload }) =>
      enterpriseApi.lex.triageMatter(matter.id, payload),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.triaged);
      setTriageTarget(null);
      await refreshMatters();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteMatter(id),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.deleted);
      setDeleteTarget(null);
      await refreshMatters();
    },
    onError: showApiError,
  });

  // Board drag-and-drop: validate the target against MATTER_STATUS_TRANSITIONS
  // before reusing the optimistic status mutation.
  const handleBoardMove = useCallback(
    (matterId: string, toStatus: string) => {
      const matter = data.find((candidate) => candidate.id === matterId);
      if (!matter || matter.status === toStatus) {
        return;
      }
      const allowed = MATTER_STATUS_TRANSITIONS[matter.status] ?? [];
      if (!allowed.includes(toStatus)) {
        showApiError(
          new Error(
            matterLabels.view.transitionNotAllowed(
              statusLabel(matterLabels, matter.status),
              statusLabel(matterLabels, toStatus),
            ),
          ),
        );
        return;
      }
      statusMutation.mutate({ matterId, status: toStatus });
    },
    [data, matterLabels, statusMutation],
  );

  // Exemplar wiring for undoToast: the bulk status change is scheduled behind
  // a 6s undo window. Eligible ids are snapshotted at schedule time (selection
  // may change while the toast is pending) and the mutation only fires if the
  // user does not undo.
  const undoToast = useUndoToast();

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ status, ids }: { status: string; ids: string[] }) => {
      await Promise.all(ids.map((id) => enterpriseApi.lex.updateMatterStatus(id, { status })));
      return ids.length;
    },
    onSuccess: async (count) => {
      showSuccess(matterLabels.bulk.statusUpdated(count));
      await refreshMatters();
    },
    onError: showApiError,
  });

  const bulkReassignMutation = useMutation({
    mutationFn: async (owner: { ownerUserId: string; ownerName: string }) => {
      const eligible = data.filter((matter) => selectedIds.includes(matter.id));
      await Promise.all(
        eligible.map((matter) =>
          enterpriseApi.lex.updateMatter(matter.id, {
            owner_user_id: owner.ownerUserId,
            owner_name: owner.ownerName,
          }),
        ),
      );
      return eligible.length;
    },
    onSuccess: async (count) => {
      showSuccess(matterLabels.bulk.ownerReassigned(count));
      setBulkReassignOpen(false);
      await refreshMatters();
    },
    onError: showApiError,
  });

  const exportSelectedMatters = useCallback(() => {
    const rows = data.filter((matter) => selectedIds.includes(matter.id));
    const headers = ['matter_number', 'title', 'status', 'type', 'priority', 'owner_name', 'due_date'];
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      headers.join(','),
      ...rows.map((matter) =>
        [
          matter.matter_number,
          matter.title,
          matter.status,
          matter.type,
          matter.priority,
          matter.owner_name,
          matter.due_date,
        ]
          .map(escape)
          .join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `matters-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [data, selectedIds]);

  const bulkActions: BulkAction[] = canWrite
    ? [
        {
          label: matterLabels.bulk.exportSelected,
          icon: Download,
          onClick: async () => {
            exportSelectedMatters();
          },
        },
        {
          label: matterLabels.bulk.changeStatus,
          icon: RefreshCw,
          onClick: async () => {
            setBulkStatusOpen(true);
          },
        },
        {
          label: matterLabels.bulk.reassignOwner,
          icon: UserCog,
          onClick: async () => {
            setBulkReassignOpen(true);
          },
        },
      ]
    : [
        {
          label: matterLabels.bulk.exportSelected,
          icon: Download,
          onClick: async () => {
            exportSelectedMatters();
          },
        },
      ];

  const columns: ColumnDef<LexMatter>[] = [
    selectColumn<LexMatter>(),
    {
      id: 'title',
      accessorKey: 'title',
      header: labels.columns.matter,
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <Link
            href={`/lex/matters/${row.original.id}`}
            className="font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
            dir="auto"
          >
            {row.original.title}
          </Link>
          <p className="text-xs text-muted-foreground" dir="auto">
            {row.original.matter_number ?? typeLabel(matterLabels, row.original.type ?? 'general')}
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
          domain="matter"
          labels={matterLabels.filters.statusOptions}
          size="sm"
        />
      ),
    },
    {
      id: 'type',
      accessorKey: 'type',
      header: labels.columns.type,
      enableSorting: true,
      cell: ({ row }) => <Badge variant="outline">{typeLabel(matterLabels, row.original.type)}</Badge>,
    },
    {
      id: 'priority',
      accessorKey: 'priority',
      header: labels.columns.priority,
      enableSorting: true,
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <PriorityEditCell matter={row.original} canWrite={canWrite} />
        </div>
      ),
    },
    {
      id: 'sla',
      header: pageStrings.slaColumn,
      enableSorting: false,
      cell: ({ row }) => <MatterSlaBadge matter={row.original} size="sm" />,
    },
    {
      id: 'owner_name',
      accessorKey: 'owner_name',
      header: labels.columns.owner,
      enableSorting: true,
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <OwnerEditCell matter={row.original} canWrite={canWrite} />
        </div>
      ),
    },
    {
      id: 'requester',
      accessorKey: 'requester_name',
      header: labels.columns.requester,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" dir="auto">{row.original.requester_name ?? labels.notCaptured}</span>
      ),
    },
    {
      id: 'contracts',
      header: labels.columns.linkedContracts,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" dir="auto">
          {row.original.contracts?.[0]?.contract_title ?? linkedContractCount(matterLabels, row.original.contracts)}
        </span>
      ),
    },
    {
      id: 'due_date',
      accessorKey: 'due_date',
      header: labels.columns.due,
      enableSorting: true,
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <DueDateEditCell matter={row.original} canWrite={canWrite} />
        </div>
      ),
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
        const matter = row.original;
        const statusOptions = MATTER_STATUS_TRANSITIONS[matter.status] ?? [];
        return (
          <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={labels.columns.actions}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href={`/lex/matters/${matter.id}`}>
                  <Eye className="me-2 h-4 w-4" />
                  {labels.rowActions.view}
                </Link>
              </DropdownMenuItem>
              {canWrite ? (
                <>
                  <DropdownMenuItem onClick={() => setEditTarget(matter)}>
                    <Pencil className="me-2 h-4 w-4" />
                    {labels.rowActions.edit}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTriageTarget(matter)}>
                    <SlidersHorizontal className="me-2 h-4 w-4" />
                    {labels.rowActions.triage}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={statusOptions.length === 0}
                    onClick={() => setStatusTarget(matter)}
                  >
                    <RefreshCw className="me-2 h-4 w-4" />
                    {labels.rowActions.changeStatus}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(matter)}>
                    <Trash2 className="me-2 h-4 w-4" />
                    {labels.rowActions.delete}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const triageItems = data
    .filter((matter) => ['intake', 'open', 'in_review', 'waiting_on_business', 'on_hold'].includes(matter.status))
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
    .slice(0, 5);
  const triageCounts = countByStatus(data);
  // Server-accurate KPI tiles derived from the matter report (Total / Open /
  // In review / Closed) plus the client-derived at-risk count. Each tile is
  // clickable and applies the matching preset (status presets, or the at-risk
  // toggle). The intake card below keeps its own live page-scoped counts.
  const statTiles = useMemo(
    () => deriveMatterStatTiles(matterReport, atRiskCount),
    [matterReport, atRiskCount],
  );
  const kpiTiles = useMemo(
    () => {
      const total = Math.max(0, statTiles.total);
      const openShare = percent(statTiles.open, total);
      const reviewShare = percent(statTiles.inReview, total);
      const closedShare = percent(statTiles.closed, total);
      const riskShare = percent(statTiles.atRisk, total);
      return [
        {
          key: 'total' as const,
          title: pageStrings.kpiTotal,
          value: statTiles.total,
          tone: 'teal' as const,
          icon: ClipboardList,
          progress: total > 0 ? 100 : 0,
          progressLabel: pageStrings.kpiShare,
          detail: pageStrings.kpiCurrentReport,
          detailValue: f.formatNumber(statTiles.total),
          presetId: null,
        },
        {
          key: 'open' as const,
          title: pageStrings.kpiOpen,
          value: statTiles.open,
          tone: 'teal' as const,
          icon: SearchCheck,
          progress: openShare,
          progressLabel: pageStrings.kpiShare,
          detail: pageStrings.kpiOpen,
          detailValue: `${f.formatNumber(openShare)}%`,
          presetId: 'open',
        },
        {
          key: 'in_review' as const,
          title: pageStrings.kpiInReview,
          value: statTiles.inReview,
          tone: 'gold' as const,
          icon: BarChart3,
          progress: reviewShare,
          progressLabel: pageStrings.kpiShare,
          detail: pageStrings.kpiInReview,
          detailValue: `${f.formatNumber(reviewShare)}%`,
          presetId: 'in_review',
        },
        {
          key: 'closed' as const,
          title: pageStrings.kpiClosed,
          value: statTiles.closed,
          tone: 'emerald' as const,
          icon: Handshake,
          progress: closedShare,
          progressLabel: pageStrings.kpiShare,
          detail: pageStrings.kpiClosed,
          detailValue: `${f.formatNumber(closedShare)}%`,
          presetId: null,
        },
        {
          key: 'at_risk' as const,
          title: pageStrings.kpiAtRisk,
          value: statTiles.atRisk,
          tone: 'rose' as const,
          icon: SearchCheck,
          progress: riskShare,
          progressLabel: pageStrings.kpiShare,
          detail: pageStrings.kpiAtRisk,
          detailValue: `${f.formatNumber(riskShare)}%`,
          presetId: 'at_risk',
        },
      ];
    },
    [statTiles, pageStrings, f],
  );
  // Command-palette contributions scoped to this page: registered on mount and
  // torn down on unmount so they don't leak to other routes. Re-registers when
  // its closures change (selection guard for bulk reassign, write gating).
  useEffect(() => {
    const commands = [
      ...(canWrite
        ? [
            {
              id: 'lex-matters:create',
              label: pageStrings.cmdCreate,
              section: pageStrings.cmdSection,
              icon: Plus,
              run: () => setCreateOpen(true),
            },
            {
              id: 'lex-matters:template',
              label: pageStrings.cmdTemplate,
              section: pageStrings.cmdSection,
              icon: LayoutTemplate,
              run: () => setTemplateOpen(true),
            },
          ]
        : []),
      {
        id: 'lex-matters:filter-at-risk',
        label: pageStrings.cmdFilterAtRisk,
        section: pageStrings.cmdSection,
        icon: SearchCheck,
        run: () => applyPresetById('at_risk'),
      },
      {
        id: 'lex-matters:filter-mine',
        label: pageStrings.cmdFilterMine,
        section: pageStrings.cmdSection,
        icon: SearchCheck,
        run: () => applyPresetById('my_matters'),
      },
      {
        id: 'lex-matters:filter-review',
        label: pageStrings.cmdFilterReview,
        section: pageStrings.cmdSection,
        icon: SearchCheck,
        run: () => applyPresetById('in_review'),
      },
      ...(canWrite
        ? [
            {
              id: 'lex-matters:bulk-reassign',
              label: pageStrings.cmdBulkReassign,
              section: pageStrings.cmdSection,
              icon: UserCog,
              run: () => {
                if (selectedIds.length > 0) {
                  setBulkReassignOpen(true);
                }
              },
            },
          ]
        : []),
      {
        id: 'lex-matters:export',
        label: pageStrings.cmdExport,
        section: pageStrings.cmdSection,
        icon: Download,
        run: () => exportSelectedMatters(),
      },
    ];
    return useCommandPaletteStore.getState().registerCommands(commands);
  }, [canWrite, pageStrings, applyPresetById, selectedIds.length, exportSelectedMatters]);

  const conflictMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.checkMatterConflict({
        title: conflictDraft.title,
        description: conflictDraft.description,
        counterparty: conflictDraft.counterparty,
        contract_title: conflictDraft.contractTitle,
      }),
    onError: showApiError,
  });
  const conflictCheckDisabled = conflictDraft.title.trim().length < 3 || conflictMutation.isPending;

  return (
    <LexRouteGuard requirement="lex:case:view">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={pageStrings.eyebrow}
          title={labels.title}
          description={labels.description}
          actions={
            canWrite ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setTemplateOpen(true)}>
                  <LayoutTemplate className="me-1.5 h-4 w-4" />
                  {pageStrings.newFromTemplate}
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.newMatter}
                </Button>
              </div>
            ) : undefined
          }
        />
        <div className="matter-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpiTiles.map((tile) => {
            const presetActive = tile.presetId !== null && tile.presetId === activePresetId;
            return (
              <StatTile
                key={tile.key}
                label={tile.title}
                value={f.formatNumber(tile.value)}
                themeClass={
                  tile.tone === 'gold'
                    ? 'kpi-theme-amber'
                    : tile.tone === 'emerald'
                      ? 'kpi-theme-emerald'
                      : tile.tone === 'rose'
                        ? 'kpi-theme-red'
                        : 'kpi-theme-primary'
                }
                icon={tile.icon}
                progress={tile.progress}
                progressLabel={tile.progressLabel}
                detail={tile.detail}
                detailValue={tile.detailValue}
                size="md"
                appearance="operational"
                className={cn(
                  'matter-kpi-card',
                  presetActive && 'ring-2 ring-ring',
                )}
                onAction={() => {
                  if (tile.presetId) {
                    applyPresetById(tile.presetId);
                  } else {
                    setAtRiskOnly(false);
                    clearFilters();
                  }
                }}
                pressed={presetActive}
              />
            );
          })}
        </div>
        <SectionCard
          title={matterLabels.intake.title}
          description={matterLabels.intake.description}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {(matterFilters[0].options ?? []).map((option) => (
              <div key={option.value} className="rounded-lg border px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{option.label}</p>
                <p className="mt-2 text-2xl font-semibold">{f.formatNumber(triageCounts[option.value] ?? 0)}</p>
              </div>
            ))}
          </div>
          {triageItems.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-5">
              {triageItems.map((matter) => (
                <div
                  key={matter.id}
                  className="rounded-lg border px-4 py-3 transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" dir="auto">{matter.title}</p>
                      <p className="text-xs text-muted-foreground" dir="auto">{matter.requester_name ?? matter.department ?? matterLabels.intake.noRequester}</p>
                    </div>
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <LexStatusChip
                      value={matter.status}
                      domain="matter"
                      labels={matterLabels.filters.statusOptions}
                      size="sm"
                    />
                    <LexPriorityChip
                      value={matter.priority}
                      labels={matterLabels.filters.priorityOptions}
                      size="sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>
        <SectionCard
          title={matterLabels.conflict.title}
          description={matterLabels.conflict.description}
        >
          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="matter-conflict-title">{matterLabels.conflict.matterTitle}</Label>
                <Input
                  id="matter-conflict-title"
                  value={conflictDraft.title}
                  onChange={(event) =>
                    setConflictDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder={matterLabels.list.titlePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="matter-conflict-counterparty">{matterLabels.conflict.counterparty}</Label>
                <Input
                  id="matter-conflict-counterparty"
                  value={conflictDraft.counterparty}
                  onChange={(event) =>
                    setConflictDraft((current) => ({ ...current, counterparty: event.target.value }))
                  }
                  placeholder={matterLabels.conflict.counterpartyPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="matter-conflict-contract">{matterLabels.conflict.contract}</Label>
                <Input
                  id="matter-conflict-contract"
                  value={conflictDraft.contractTitle}
                  onChange={(event) =>
                    setConflictDraft((current) => ({ ...current, contractTitle: event.target.value }))
                  }
                  placeholder={matterLabels.conflict.contractPlaceholder}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="matter-conflict-description">{matterLabels.conflict.context}</Label>
                <Textarea
                  id="matter-conflict-description"
                  value={conflictDraft.description}
                  onChange={(event) =>
                    setConflictDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder={matterLabels.conflict.contextPlaceholder}
                  rows={3}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  disabled={conflictCheckDisabled}
                  onClick={() => void conflictMutation.mutate()}
                >
                  <SearchCheck className="me-1.5 h-4 w-4" />
                  {matterLabels.conflict.run}
                </Button>
              </div>
            </div>
            <MatterConflictResult labels={matterLabels} result={conflictMutation.data ?? null} loading={conflictMutation.isPending} />
          </div>
        </SectionCard>
        {/* Feature 1: quick-filter preset chips. The at-risk chip carries a live
            count and is routed to the client `atRiskOnly` toggle; the rest apply
            server filters via clear-then-set. */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={labels.title}>
          {MATTER_PRESETS.map((preset) => {
            const PresetIcon = preset.icon;
            const presetActive = activePresetId === preset.id;
            const showCount = preset.clientAtRisk && atRiskCount > 0;
            return (
              <Button
                key={preset.id}
                type="button"
                variant={presetActive ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 gap-1.5"
                aria-pressed={presetActive}
                onClick={() => applyPreset(preset)}
              >
                {PresetIcon ? <PresetIcon className="h-4 w-4" /> : null}
                {preset.labels[locale === 'ar' ? 'ar' : 'en']}
                {showCount ? (
                  <Badge
                    variant={presetActive ? 'destructive' : 'secondary'}
                    className="ms-1 px-1.5 tabular-nums"
                  >
                    {f.formatNumber(atRiskCount)}
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SavedViewsBar
            namespace="lex-matters"
            activeFilters={activeFilters}
            onApply={applySavedView}
            labels={{
              save: matterLabels.savedViews.save,
              saved: matterLabels.savedViews.saved,
              empty: matterLabels.savedViews.empty,
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'table' ? (
              <div
                className="inline-flex items-center gap-1 rounded-lg border p-0.5"
                role="group"
                aria-label={pageStrings.density}
              >
                <Button
                  type="button"
                  variant={density === 'comfortable' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 gap-1.5"
                  aria-pressed={density === 'comfortable'}
                  onClick={() => setDensity('comfortable')}
                >
                  <AlignJustify className="h-4 w-4" />
                  {pageStrings.comfortable}
                </Button>
                <Button
                  type="button"
                  variant={density === 'compact' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 gap-1.5"
                  aria-pressed={density === 'compact'}
                  onClick={() => setDensity('compact')}
                >
                  <Menu className="h-4 w-4" />
                  {pageStrings.compact}
                </Button>
              </div>
            ) : null}
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
                {matterLabels.view.table}
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
                {matterLabels.view.board}
              </Button>
              <Button
                type="button"
                variant={viewMode === 'analytics' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5"
                aria-pressed={viewMode === 'analytics'}
                onClick={() => setViewMode('analytics')}
              >
                <BarChart3 className="h-4 w-4" />
                {pageStrings.analytics}
              </Button>
            </div>
            <HelpTip
              title={{ en: 'Working with matter views', ar: 'التعامل مع طرق عرض القضايا' }}
              content={{
                en: 'Switch between table, board, and analytics views. The board groups matters by status — drag a card between columns to update it. Preset chips apply common filters in one click, and saved views remember your frequent filter combinations.',
                ar: 'بدّل بين عرض الجدول واللوحة والتحليلات. تجمّع اللوحة القضايا حسب الحالة — اسحب البطاقة بين الأعمدة لتحديثها. تُطبّق شرائح الإعدادات المسبقة عوامل التصفية الشائعة بنقرة واحدة، وتتذكر طرق العرض المحفوظة تركيبات التصفية المتكررة.',
              }}
            />
          </div>
        </div>

        {viewMode === 'analytics' ? (
          <MatterAnalyticsPanel params={reportParams} />
        ) : viewMode === 'board' ? (
          tableProps.isLoading && data.length === 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {MATTER_STATUS_OPTIONS.slice(0, 5).map((status) => (
                <div key={status} className="w-72 shrink-0 space-y-3">
                  <div className="h-1 w-full rounded-full bg-muted" aria-hidden />
                  <LoadingSkeleton variant="list" count={3} label={labels.searchPlaceholder} />
                </div>
              ))}
            </div>
          ) : tableProps.error && data.length === 0 ? (
            <ErrorState
              title={pageStrings.loadErrorTitle}
              message={pageStrings.loadError}
              error={tableProps.error}
              onRetry={() => tableProps.onRetry?.()}
            />
          ) : (
            <MatterBoard
              matters={displayData}
              labels={matterLabels}
              dir={direction}
              onMove={canWrite ? handleBoardMove : undefined}
              isMoving={statusMutation.isPending}
              canWrite={canWrite}
            />
          )
        ) : (
          <DataTable
            {...tableProps}
            data={displayData}
            columns={columns}
            filters={matterFilters}
            enableSelection
            getRowId={(row) => row.id}
            onSelectionChange={setSelectedIds}
            bulkActions={bulkActions}
            compact={density === 'compact'}
            enableDensityToggle={false}
            stickyHeader
            striped
            tableId="lex-matters-table"
            enableColumnToggle
            defaultHiddenColumns={hiddenColumns}
            onHiddenColumnsChange={setHiddenColumns}
            onRowClick={(row) => setPreviewId(row.id)}
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

        <MatterPreviewDrawer
          matterId={previewId}
          open={previewId !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewId(null);
          }}
          onTriage={
            canWrite
              ? (id) => {
                  const matter = data.find((candidate) => candidate.id === id);
                  if (matter) {
                    setPreviewId(null);
                    setTriageTarget(matter);
                  }
                }
              : undefined
          }
          onChangeStatus={
            canWrite
              ? (id) => {
                  const matter = data.find((candidate) => candidate.id === id);
                  if (matter) {
                    setPreviewId(null);
                    setStatusTarget(matter);
                  }
                }
              : undefined
          }
        />

        {canWrite ? (
          <>
            <MatterBulkStatusDialog
              open={bulkStatusOpen}
              count={selectedIds.length}
              loading={bulkStatusMutation.isPending}
              labels={matterLabels}
              onOpenChange={setBulkStatusOpen}
              onSubmit={(status) => {
                const ids = data
                  .filter(
                    (matter) =>
                      selectedIds.includes(matter.id) &&
                      (MATTER_STATUS_TRANSITIONS[matter.status] ?? []).includes(status),
                  )
                  .map((matter) => matter.id);
                setBulkStatusOpen(false);
                if (ids.length === 0) {
                  showApiError(new Error(matterLabels.bulk.nothingApplicable));
                  return;
                }
                undoToast({
                  message: pageStrings.bulkStatusScheduled(ids.length),
                  description: pageStrings.bulkStatusScheduledHint,
                  action: () => bulkStatusMutation.mutate({ status, ids }),
                });
              }}
            />
            <MatterBulkReassignDialog
              open={bulkReassignOpen}
              count={selectedIds.length}
              loading={bulkReassignMutation.isPending}
              labels={matterLabels}
              onOpenChange={setBulkReassignOpen}
              onSubmit={(owner) => bulkReassignMutation.mutate(owner)}
            />
          </>
        ) : null}

        {canWrite ? (
          <>
            <MatterFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => void refreshMatters()} />
            <MatterTemplateGallery
              open={templateOpen}
              onOpenChange={setTemplateOpen}
              onCreated={(matter) => {
                void refreshMatters();
                router.push(`/lex/matters/${matter.id}`);
              }}
            />
            {editTarget ? (
              <MatterFormDialog
                open
                matter={editTarget}
                onOpenChange={(open) => {
                  if (!open) setEditTarget(null);
                }}
                onSaved={() => void refreshMatters()}
              />
            ) : null}
            {statusTarget ? (
              <MatterStatusDialog
                open
                loading={statusMutation.isPending}
                options={MATTER_STATUS_TRANSITIONS[statusTarget.status] ?? []}
                onOpenChange={(open) => {
                  if (!open) setStatusTarget(null);
                }}
                onSubmit={(status) => statusMutation.mutate({ matterId: statusTarget.id, status })}
              />
            ) : null}
            {triageTarget ? (
              <MatterTriageDialog
                open
                matter={triageTarget}
                loading={triageMutation.isPending}
                onOpenChange={(open) => {
                  if (!open) setTriageTarget(null);
                }}
                onSubmit={(payload) => triageMutation.mutate({ matter: triageTarget, payload })}
              />
            ) : null}
            <ConfirmDialog
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              title={matterLabels.confirm.deleteTitle}
              description={matterLabels.confirm.deleteDescription(deleteTarget?.title ?? '')}
              confirmLabel={matterLabels.confirm.deleteConfirm}
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

/**
 * localStorage key the `useMatterViewPrefs` hook persists under. Mirrored here
 * (not exported by the hook) only to detect a first-ever visit so the
 * default-hidden column seed never clobbers a returning user's saved choice.
 */
const VIEW_PREFS_STORAGE_KEY = 'lex-matters:view-prefs';

/**
 * Lower-value columns hidden by default on the matters table to keep the initial
 * view focused (matter / status / priority / SLA / owner / due / updated). Users
 * can re-reveal any of these via the DataTable column toggle; their choice is
 * persisted by `useMatterViewPrefs`.
 */
const DEFAULT_HIDDEN_COLUMNS = ['type', 'requester', 'contracts'];

function MatterConflictResult({
  labels,
  loading,
  result,
}: {
  labels: MatterLabels;
  loading: boolean;
  result: LexMatterConflictCheckResult | null;
}) {
  const f = useLexFormat();
  if (loading) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">{labels.conflict.inProgressTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{labels.conflict.inProgressDescription}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">{labels.conflict.emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {labels.conflict.emptyDescription}
        </p>
      </div>
    );
  }

  const issues = [...result.conflicts, ...result.warnings];

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{labels.conflict.resultTitle}</p>
          <p className="text-xs text-muted-foreground">
            {labels.conflict.checkedAt} {f.formatDual(result.checked_at, { dateOptions: { hour: '2-digit', minute: '2-digit' } })}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={result.conflicts.length > 0 ? 'destructive' : 'outline'}>
            {f.formatNumber(result.conflicts.length)} {labels.conflict.conflicts}
          </Badge>
          <Badge variant={result.warnings.length > 0 ? 'warning' : 'outline'}>
            {f.formatNumber(result.warnings.length)} {labels.conflict.warnings}
          </Badge>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {issues.length > 0 ? (
          issues.map((issue, index) => (
            <div key={`${issue.severity}-${issue.matter_id ?? issue.contract_id ?? index}`} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {issue.matter_title ?? issue.contract_title ?? labels.conflict.potentialMatch}
                </p>
                <Badge variant={issue.severity === 'conflict' ? 'destructive' : 'warning'}>
                  {issue.severity === 'conflict' ? labels.conflict.conflictSeverity : labels.conflict.warningSeverity}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{issue.reasons.join(', ')}</p>
              {issue.matched_terms?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {issue.matched_terms.map((term) => (
                    <Badge key={term} variant="outline">
                      {term}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{labels.conflict.noIssues}</p>
        )}
      </div>
    </div>
  );
}

function statusLabel(labels: MatterLabels, status: string): string {
  return labels.filters.statusOptions[status] ?? formatToken(status);
}

function typeLabel(labels: MatterLabels, type: string): string {
  return labels.filters.typeOptions[type] ?? formatToken(type);
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

function linkedContractCount(labels: MatterLabels, contracts: LexMatter['contracts']): string {
  const count = contracts?.length ?? 0;
  if (count === 0) {
    return labels.list.notLinked;
  }
  return labels.list.linkedCount(count);
}

function priorityRank(priority: string): number {
  switch (priority) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
    default:
      return 4;
  }
}

function countByStatus(matters: LexMatter[]): Record<string, number> {
  return matters.reduce<Record<string, number>>((acc, matter) => {
    acc[matter.status] = (acc[matter.status] ?? 0) + 1;
    return acc;
  }, {});
}
