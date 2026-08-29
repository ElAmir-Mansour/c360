"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type Row,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTableSkeleton } from "./data-table-skeleton";
import { DataTableEmpty } from "./data-table-empty";
import { DataTableError } from "./data-table-error";
import {
  DataTableColumnHeader,
  DataTableResizeHandle,
} from "./data-table-column-header";
import { getColumnLabel } from "./column-meta";
import {
  useTablePrefs,
  hashTableSignature,
  type TableDensity,
} from "./use-table-prefs";
import { actionsColumn } from "./columns/common-columns";
import { SearchInput } from "@/components/shared/forms/search-input";
import {
  SavedViewsBar,
  type SavedViewsBarLabels,
} from "@/components/shared/saved-views-bar";
import {
  useApplySavedViewState,
  type SavedView,
  type SavedViewApplyState,
} from "@/hooks/use-saved-views";
import {
  DataTableSelectAllBanner,
  type SelectAllMatchingLabels,
} from "./data-table-select-all-banner";
import {
  EMPTY_SELECTION_SCOPE,
  countScopeSelected,
  normalizeFilterQuery,
  selectionScopeReducer,
  type SelectionFilterQuery,
  type SelectionScope,
} from "./selection-scope";
import { cn } from "@/lib/utils";
import type {
  FilterConfig,
  BulkAction,
  RowAction,
  EmptyStateConfig,
} from "@/types/table";

// Re-exported so callers wiring select-all-matching can import everything from
// the DataTable module (the canonical entry point).
export type { SelectionFilterQuery, SelectionScope } from "./selection-scope";
export type { SelectAllMatchingLabels } from "./data-table-select-all-banner";

/** Client-side row count above which `enableVirtual` switches to windowed rendering. */
const VIRTUAL_ROW_THRESHOLD = 100;

/** Structural columns that stay pinned at the logical start/end of the table. */
const PINNED_COLUMN_IDS = new Set(["select", "actions"]);

/** Config for the optional saved-views bar mounted above the toolbar (item 27). */
export interface DataTableSavedViewsConfig {
  /** Stable route key; views persist under localStorage `views:<routeKey>`. */
  routeKey: string;
  /** Applies a view's page-owned state (filters + sort) in one batch. Defaults
   *  to the `useDataTable` URL contract (single `router.push` replacing filter
   *  params and sort, preserving `per_page`/`search`, resetting `page`).
   *  Provide this when the page manages filters outside the URL. Hidden
   *  columns and density are always restored by the table itself. */
  onApplyState?: (state: SavedViewApplyState, view: SavedView) => void;
  /** Auto-apply the default view on pristine mounts (default true). */
  autoApplyDefault?: boolean;
  /** Label overrides; defaults are bilingual (en/ar). */
  labels?: SavedViewsBarLabels;
  className?: string;
}

/** Config for the opt-in "select all N matching" affordance (item #8). When a
 *  fully-selected page has more rows matching the server-side filters, a banner
 *  offers extending the selection to ALL of them; the resulting scope
 *  ({mode:'page'} | {mode:'all-matching'}) is surfaced through
 *  `onSelectionScopeChange` so bulk actions can address either explicit ids or
 *  the whole filtered set. Requires a stable `getRowId`. */
export interface DataTableSelectAllMatchingConfig {
  /** Filter map embedded into an all-matching scope. Defaults to
   *  `activeFilters` plus the current search value (under `search`). Provide it
   *  when the page's server query is keyed differently from `activeFilters`. */
  filterQuery?: SelectionFilterQuery;
  /** Label overrides; defaults are bilingual (en/ar). */
  labels?: SelectAllMatchingLabels;
  className?: string;
}

export interface DataTableProps<TData, TValue = unknown> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  totalRows: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSortChange: (column: string, direction: "asc" | "desc") => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  activeFilters?: Record<string, string | string[]>;
  onFilterChange?: (key: string, value: string | string[] | undefined) => void;
  onClearFilters?: () => void;
  enableSelection?: boolean;
  onSelectionChange?: (selectedIds: string[]) => void;
  getRowId?: (row: TData) => string;
  bulkActions?: BulkAction[];
  rowActions?: RowAction<TData>[] | ((row: TData) => RowAction<TData>[]);
  onRowClick?: (row: TData) => void;
  enableColumnToggle?: boolean;
  defaultHiddenColumns?: string[];
  /** Fires with the current hidden-column ids whenever the user toggles column
   *  visibility, so callers can persist the choice (e.g. to localStorage). */
  onHiddenColumnsChange?: (hiddenColumnIds: string[]) => void;
  enableExport?: boolean;
  onExport?: (format: "csv" | "json") => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyState?: EmptyStateConfig;
  stickyHeader?: boolean;
  /** Initial density. The toolbar density toggle (persisted per table) can
   *  override it; flipping this prop afterwards re-asserts it, so pages that
   *  own their own density control keep working. */
  compact?: boolean;
  striped?: boolean;
  className?: string;
  searchSlot?: React.ReactNode;
  /** Stable id for persisting column widths/order/density in localStorage
   *  (mirrors the keying idiom used for hidden columns). Defaults to the
   *  current pathname plus a hash of the column ids. */
  tableId?: string;
  /** Toolbar density toggle (comfortable/compact), persisted per table id. */
  enableDensityToggle?: boolean;
  /** Header-menu based column reordering (move toward logical start/end),
   *  persisted per table id. */
  enableColumnReorder?: boolean;
  /** Drag-to-resize column widths, persisted per table id. Individual columns
   *  can opt out via `enableResizing: false` on their ColumnDef. */
  enableColumnResize?: boolean;
  /** Windowed row rendering (TanStack Virtual) once client-side data exceeds
   *  {@link VIRTUAL_ROW_THRESHOLD} rows. Sticky header + selection keep working. */
  enableVirtual?: boolean;
  /** Max height (px) of the scroll viewport while virtualization is active. */
  virtualMaxHeight?: number;
  /** Mounts a SavedViewsBar above the toolbar: named, route-keyed snapshots of
   *  filters + sort + hidden columns + density (save / apply / rename / delete
   *  / default view). See {@link DataTableSavedViewsConfig}. */
  savedViews?: DataTableSavedViewsConfig;
  /** Enables the "select all N matching" banner + selection scope tracking.
   *  See {@link DataTableSelectAllMatchingConfig}. Pass `{}` for the defaults. */
  selectAllMatching?: DataTableSelectAllMatchingConfig;
  /** Fires whenever the selection scope changes (only while `selectAllMatching`
   *  is enabled). Pages hold the latest scope in state and hand it to
   *  scope-aware bulk actions (e.g. {contract_ids} vs {filter} payloads). */
  onSelectionScopeChange?: (scope: SelectionScope) => void;
  /** Bump (or change) this key to clear the row selection AND the selection
   *  scope from outside — e.g. after a bulk action completes. Optional and
   *  inert when it never changes. */
  selectionResetKey?: number | string;
}

export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  totalRows,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  sortColumn,
  sortDirection,
  onSortChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  activeFilters = {},
  onFilterChange,
  onClearFilters,
  enableSelection = false,
  onSelectionChange,
  getRowId,
  bulkActions,
  rowActions,
  onRowClick,
  enableColumnToggle = true,
  defaultHiddenColumns = [],
  onHiddenColumnsChange,
  enableExport = false,
  onExport,
  isLoading = false,
  error = null,
  onRetry,
  emptyState,
  stickyHeader = true,
  compact = false,
  striped = false,
  className,
  searchSlot,
  tableId,
  enableDensityToggle = true,
  enableColumnReorder = true,
  enableColumnResize = true,
  enableVirtual = false,
  virtualMaxHeight = 560,
  savedViews,
  selectAllMatching,
  onSelectionScopeChange,
  selectionResetKey,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    Object.fromEntries(defaultHiddenColumns.map((col) => [col, false])),
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [density, setDensity] = useState<TableDensity>(
    compact ? "compact" : "comfortable",
  );

  // Writing/reading direction — drives TanStack's resize-delta math so drag
  // handles behave correctly under the app's Arabic-default RTL layout. Read
  // in an effect (SSR-safe); no drag can happen before hydration anyway.
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  useEffect(() => {
    setDir(document.documentElement.dir === "rtl" ? "rtl" : "ltr");
  }, []);

  // ── Persisted per-table view prefs (density / column widths / column order).
  // Keyed like the hidden-columns persistence callers already use: one JSON
  // blob per table in localStorage. Hidden columns stay caller-owned through
  // defaultHiddenColumns/onHiddenColumnsChange, unchanged.
  const pathname = usePathname();
  const columnSignature = useMemo(
    () =>
      columns
        .map(
          (col) =>
            col.id ?? (col as { accessorKey?: string }).accessorKey ?? "",
        )
        .join("|"),
    [columns],
  );
  const resolvedTableId =
    tableId ?? `${pathname ?? "table"}#${hashTableSignature(columnSignature)}`;
  const { prefs, hydrated, updatePrefs } = useTablePrefs(resolvedTableId);

  // Apply persisted prefs once after hydration (server render uses defaults).
  const prefsAppliedRef = useRef(false);
  useEffect(() => {
    if (!hydrated || prefsAppliedRef.current) return;
    prefsAppliedRef.current = true;
    if (prefs.density) setDensity(prefs.density);
    if (Object.keys(prefs.columnSizing).length > 0) {
      setColumnSizing(prefs.columnSizing);
    }
    if (prefs.columnOrder.length > 0) setColumnOrder(prefs.columnOrder);
  }, [hydrated, prefs]);

  // Pages that own a density control drive it through the `compact` prop; when
  // that prop *changes*, adopt it (without persisting — the caller owns it).
  const prevCompactRef = useRef(compact);
  useEffect(() => {
    if (prevCompactRef.current === compact) return;
    prevCompactRef.current = compact;
    setDensity(compact ? "compact" : "comfortable");
  }, [compact]);

  // Emit the set of hidden column ids upward so callers can persist the user's
  // choice. VisibilityState only stores explicit entries; an entry of `false`
  // means hidden, so the hidden set is every key mapped to false.
  const emitHiddenColumns = (visibility: VisibilityState) => {
    if (!onHiddenColumnsChange) return;
    onHiddenColumnsChange(
      Object.entries(visibility)
        .filter(([, visible]) => visible === false)
        .map(([id]) => id),
    );
  };

  // Re-apply default hidden columns when their *content* changes after mount —
  // e.g. a persisted-prefs hook that hydrates from localStorage in an effect.
  // Guarded by content (not array identity) so a fresh array each render won't
  // thrash, and so it round-trips cleanly with user toggles persisted back.
  const appliedDefaultsRef = useRef<string>(
    [...defaultHiddenColumns].sort().join(","),
  );
  useEffect(() => {
    const key = [...defaultHiddenColumns].sort().join(",");
    if (key === appliedDefaultsRef.current) return;
    appliedDefaultsRef.current = key;
    setColumnVisibility(
      Object.fromEntries(defaultHiddenColumns.map((col) => [col, false])),
    );
  }, [defaultHiddenColumns]);

  const resolvedColumns = useMemo<ColumnDef<TData, TValue>[]>(() => {
    if (!rowActions) return columns;
    return [...columns, actionsColumn(rowActions) as ColumnDef<TData, TValue>];
  }, [columns, rowActions]);

  const defaultGetRowId = (row: TData): string =>
    (row as TData & { id?: string }).id ?? String(Math.random());
  const resolveRowId = getRowId ?? defaultGetRowId;

  // ── Select-all-matching (item #8): scope state next to (not instead of) the
  // historical rowSelection — fully opt-in via the `selectAllMatching` prop.
  const selectAllEnabled = selectAllMatching !== undefined;
  const [selectionScope, dispatchSelectionScope] = useReducer(
    selectionScopeReducer,
    EMPTY_SELECTION_SCOPE,
  );
  // Filter map an all-matching scope captures: caller-provided, or the page's
  // active filters plus the free-text search under the standard `search` key.
  const scopeFilterQuery = useMemo<SelectionFilterQuery>(
    () =>
      selectAllMatching?.filterQuery ?? {
        ...activeFilters,
        ...(searchValue ? { search: searchValue } : {}),
      },
    [selectAllMatching?.filterQuery, activeFilters, searchValue],
  );
  // Content signature so inline config objects don't retrigger effects.
  const scopeFilterSignature = useMemo(
    () => JSON.stringify(normalizeFilterQuery(scopeFilterQuery)),
    [scopeFilterQuery],
  );

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ?? defaultGetRowId,
    state: { rowSelection, columnVisibility, columnSizing, columnOrder },
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(next);
      const nextIds = Object.keys(next).filter((k) => next[k]);
      if (onSelectionChange) {
        onSelectionChange(nextIds);
      }
      if (selectAllEnabled) {
        dispatchSelectionScope({
          type: "page-selection-changed",
          selectedIds: nextIds,
          pageIds: data.map(resolveRowId),
        });
      }
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      setColumnVisibility(next);
      emitHiddenColumns(next);
    },
    onColumnSizingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnSizing) : updater;
      setColumnSizing(next);
      updatePrefs({ columnSizing: next });
    },
    onColumnOrderChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnOrder) : updater;
      setColumnOrder(next);
      updatePrefs({ columnOrder: next });
    },
    enableRowSelection: enableSelection,
    enableColumnResizing: enableColumnResize,
    columnResizeMode: "onChange",
    columnResizeDirection: dir,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.ceil(totalRows / pageSize),
  });

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection],
  );

  // ── Select-all-matching effects. All of them no-op unless the feature is on.
  // Surface scope changes to the page (latest-callback ref: an inline handler
  // must not retrigger the effect).
  const onSelectionScopeChangeRef = useRef(onSelectionScopeChange);
  onSelectionScopeChangeRef.current = onSelectionScopeChange;
  useEffect(() => {
    if (!selectAllEnabled) return;
    onSelectionScopeChangeRef.current?.(selectionScope);
  }, [selectAllEnabled, selectionScope]);

  // While an all-matching scope is live, rows arriving on OTHER pages must
  // render checked (minus exclusions): re-derive rowSelection from the scope
  // whenever the page's rows or the exclusions change. setRowSelection directly
  // (not via the table updater) so this sync never re-dispatches scope actions.
  const pageIdsSignature = useMemo(
    () => (selectAllEnabled ? data.map(resolveRowId).join(" ") : ""),
    // resolveRowId is stable per caller (getRowId prop or the default).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectAllEnabled, data, getRowId],
  );
  useEffect(() => {
    if (!selectAllEnabled || selectionScope.mode !== "all-matching") return;
    const excluded = new Set(selectionScope.excludedIds);
    const next: RowSelectionState = {};
    for (const row of data) {
      const id = resolveRowId(row);
      if (!excluded.has(id)) next[id] = true;
    }
    setRowSelection(next);
    onSelectionChange?.(Object.keys(next));
    // Signature stands in for data/resolveRowId; onSelectionChange is a
    // notification, not a dependency of what gets selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectAllEnabled, selectionScope, pageIdsSignature]);

  // Changing filters/search invalidates an "all matching" claim: collapse the
  // scope (the reducer verifies the query really changed) and uncheck rows.
  const prevScopeFilterSignatureRef = useRef(scopeFilterSignature);
  useEffect(() => {
    if (!selectAllEnabled) return;
    if (prevScopeFilterSignatureRef.current === scopeFilterSignature) return;
    prevScopeFilterSignatureRef.current = scopeFilterSignature;
    if (selectionScope.mode === "all-matching") {
      dispatchSelectionScope({
        type: "filters-changed",
        filterQuery: scopeFilterQuery,
      });
      setRowSelection({});
      onSelectionChange?.([]);
    }
    // Only the signature drives this; the rest are read-at-fire values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectAllEnabled, scopeFilterSignature]);

  // External reset: a changed key clears both the checkboxes and the scope
  // (pages bump it after a bulk action lands).
  const prevSelectionResetKeyRef = useRef(selectionResetKey);
  useEffect(() => {
    if (prevSelectionResetKeyRef.current === selectionResetKey) return;
    prevSelectionResetKeyRef.current = selectionResetKey;
    setRowSelection({});
    onSelectionChange?.([]);
    if (selectAllEnabled) dispatchSelectionScope({ type: "clear" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionResetKey]);

  const clearScopeSelection = () => {
    dispatchSelectionScope({ type: "clear" });
    setRowSelection({});
    onSelectionChange?.([]);
  };

  // ── Menu-based column reorder (logical start/end; RTL-aware because the
  // order array is logical). Hidden columns are skipped when picking the swap
  // target, and structural pinned columns (select/actions) are never crossed.
  const effectiveColumnOrder = useMemo(() => {
    const leafIds = table.getAllLeafColumns().map((col) => col.id);
    const ordered = columnOrder.filter((id) => leafIds.includes(id));
    const remaining = leafIds.filter((id) => !ordered.includes(id));
    return [...ordered, ...remaining];
    // getAllLeafColumns() identity follows resolvedColumns + columnOrder state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, columnOrder, resolvedColumns]);

  const findMoveTargetIndex = (
    columnId: string,
    direction: "start" | "end",
  ): number => {
    if (PINNED_COLUMN_IDS.has(columnId)) return -1;
    const index = effectiveColumnOrder.indexOf(columnId);
    if (index === -1) return -1;
    const step = direction === "start" ? -1 : 1;
    let cursor = index + step;
    while (cursor >= 0 && cursor < effectiveColumnOrder.length) {
      const candidate = effectiveColumnOrder[cursor];
      if (PINNED_COLUMN_IDS.has(candidate)) return -1;
      if (table.getColumn(candidate)?.getIsVisible()) return cursor;
      cursor += step;
    }
    return -1;
  };

  const moveColumn = (columnId: string, direction: "start" | "end") => {
    const index = effectiveColumnOrder.indexOf(columnId);
    const target = findMoveTargetIndex(columnId, direction);
    if (index === -1 || target === -1) return;
    const next = [...effectiveColumnOrder];
    next.splice(index, 1);
    next.splice(target, 0, columnId);
    table.setColumnOrder(next);
  };

  const hideColumn = (columnId: string) => {
    table.getColumn(columnId)?.toggleVisibility(false);
  };

  const handleDensityChange = (next: TableDensity) => {
    setDensity(next);
    updatePrefs({ density: next });
  };

  // ── Saved views (item 27): capture/restore the table's full view state.
  // Filters + sort are page-owned, so applying them delegates to
  // `savedViews.onApplyState` (or the shared batched-URL applier matching the
  // `useDataTable` contract); hidden columns and density are table-owned and
  // restored here directly.
  const applySavedViewStateToUrl = useApplySavedViewState();
  const hiddenColumnIds = useMemo(
    () =>
      Object.entries(columnVisibility)
        .filter(([, visible]) => visible === false)
        .map(([id]) => id),
    [columnVisibility],
  );
  const handleApplySavedView = (
    filters: Record<string, string | string[]>,
    view: SavedView,
  ) => {
    if (view.hiddenColumns) {
      const visibility = Object.fromEntries(
        view.hiddenColumns.map((id) => [id, false]),
      );
      setColumnVisibility(visibility);
      emitHiddenColumns(visibility);
    }
    if (view.density) handleDensityChange(view.density);
    const state: SavedViewApplyState = { filters, sort: view.sort };
    if (savedViews?.onApplyState) savedViews.onApplyState(state, view);
    else applySavedViewStateToUrl(state);
  };

  const hasActiveFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  const resolvedSearchSlot =
    searchSlot ??
    (onSearchChange ? (
      <SearchInput
        value={searchValue ?? ""}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
        loading={isLoading}
      />
    ) : undefined);

  const isCompact = density === "compact";
  const cellPadding = isCompact ? "px-3 py-1.5" : "px-4 py-3";

  // ── Row virtualization (item 29): windowed rendering for large client-side
  // datasets. The desktop wrapper becomes the bounded scroll viewport, so the
  // sticky header keeps sticking to it and row selection is untouched (rows
  // still come from the same row model).
  const rows = table.getRowModel().rows;
  const virtualActive =
    enableVirtual &&
    !isLoading &&
    !error &&
    rows.length > VIRTUAL_ROW_THRESHOLD;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: virtualActive ? rows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => (isCompact ? 40 : 56),
    overscan: 12,
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;

  const renderDesktopRow = (
    row: Row<TData>,
    rowIndex: number,
    measureRef?: (node: HTMLTableRowElement | null) => void,
  ) => (
    <TableRow
      key={row.id}
      ref={measureRef}
      data-index={rowIndex}
      data-state={row.getIsSelected() ? "selected" : undefined}
      aria-selected={row.getIsSelected()}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={cn(
        onRowClick && "cursor-pointer",
        striped && rowIndex % 2 === 1 && "bg-primary/[0.018]",
        "hover:bg-primary/[0.045]",
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          className={cn("whitespace-nowrap border-primary/10", cellPadding)}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );

  const renderVirtualRows = () => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    const totalSize = rowVirtualizer.getTotalSize();
    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
    const paddingBottom =
      virtualItems.length > 0
        ? totalSize - virtualItems[virtualItems.length - 1].end
        : 0;
    return (
      <>
        {paddingTop > 0 && (
          <tr aria-hidden="true">
            <td colSpan={visibleColumnCount} style={{ height: paddingTop }} />
          </tr>
        )}
        {virtualItems.map((virtualRow) =>
          renderDesktopRow(
            rows[virtualRow.index],
            virtualRow.index,
            rowVirtualizer.measureElement,
          ),
        )}
        {paddingBottom > 0 && (
          <tr aria-hidden="true">
            <td
              colSpan={visibleColumnCount}
              style={{ height: paddingBottom }}
            />
          </tr>
        )}
      </>
    );
  };

  return (
    <div className={cn("w-full space-y-3", className)}>
      {savedViews && (
        <SavedViewsBar
          routeKey={savedViews.routeKey}
          activeFilters={activeFilters}
          sort={
            sortColumn
              ? { column: sortColumn, direction: sortDirection ?? "desc" }
              : undefined
          }
          hiddenColumns={hiddenColumnIds}
          density={density}
          onApply={handleApplySavedView}
          autoApplyDefault={savedViews.autoApplyDefault}
          labels={savedViews.labels}
          className={savedViews.className}
        />
      )}
      <DataTableToolbar
        searchSlot={resolvedSearchSlot}
        filters={filters}
        activeFilters={activeFilters}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
        columns={table.getAllColumns()}
        columnVisibility={Object.fromEntries(
          table.getAllColumns().map((col) => [col.id, col.getIsVisible()]),
        )}
        onColumnVisibilityChange={(vis) => {
          setColumnVisibility(vis);
          emitHiddenColumns(vis);
        }}
        enableColumnToggle={enableColumnToggle}
        enableExport={enableExport}
        onExport={onExport}
        selectedCount={
          selectAllEnabled && selectionScope.mode === "all-matching"
            ? countScopeSelected(selectionScope, totalRows)
            : selectedIds.length
        }
        bulkActions={bulkActions}
        getSelectedIds={() => selectedIds}
        density={density}
        onDensityChange={enableDensityToggle ? handleDensityChange : undefined}
      />

      {selectAllEnabled && !error && (
        <DataTableSelectAllBanner
          scope={selectionScope}
          totalRows={totalRows}
          pageRowCount={rows.length}
          allPageRowsSelected={
            rows.length > 0 && table.getIsAllPageRowsSelected()
          }
          selectedCount={selectedIds.length}
          onSelectAllMatching={() =>
            dispatchSelectionScope({
              type: "select-all-matching",
              filterQuery: scopeFilterQuery,
            })
          }
          onClearSelection={clearScopeSelection}
          labels={selectAllMatching?.labels}
          className={selectAllMatching?.className}
        />
      )}

      <div className="data-table-shell w-full overflow-hidden rounded-xl border border-primary/20 border-t-[3px] border-t-brand-accent-500 bg-card shadow-none">
        <div
          ref={scrollContainerRef}
          className={cn(
            "hidden sm:block",
            virtualActive
              ? "overflow-auto overscroll-contain"
              : "overflow-x-auto",
          )}
          style={virtualActive ? { maxHeight: virtualMaxHeight } : undefined}
        >
          <Table>
            <TableHeader
              className={cn(
                "data-table-header bg-brand-primary-600 text-white",
                stickyHeader && "sticky top-0 z-10",
              )}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    const headerDef = header.column.columnDef.header;
                    const label = getColumnLabel(header.column);
                    // Rich header (sort button + column menu) for sortable
                    // columns and for plain string-labelled columns; component
                    // headers (e.g. the select-all checkbox) and intentionally
                    // empty headers keep rendering via flexRender.
                    const useRichHeader =
                      !header.isPlaceholder &&
                      (header.column.getCanSort() ||
                        (typeof headerDef === "string" &&
                          headerDef.trim() !== ""));
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "group/th relative whitespace-nowrap border-b border-white/10 bg-brand-primary-600 text-white/80 shadow-none backdrop-blur-none supports-[backdrop-filter]:bg-brand-primary-600",
                          cellPadding,
                        )}
                        style={{
                          width:
                            header.getSize() !== 150
                              ? header.getSize()
                              : undefined,
                        }}
                      >
                        {header.isPlaceholder ? null : useRichHeader ? (
                          <DataTableColumnHeader
                            column={header.column}
                            title={label}
                            onSortChange={onSortChange}
                            sortColumn={sortColumn}
                            sortDirection={sortDirection}
                            onMoveColumn={
                              enableColumnReorder ? moveColumn : undefined
                            }
                            canMoveStart={
                              enableColumnReorder &&
                              findMoveTargetIndex(header.column.id, "start") !==
                                -1
                            }
                            canMoveEnd={
                              enableColumnReorder &&
                              findMoveTargetIndex(header.column.id, "end") !==
                                -1
                            }
                            onHide={
                              enableColumnToggle && header.column.getCanHide()
                                ? hideColumn
                                : undefined
                            }
                          />
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                        <DataTableResizeHandle header={header} label={label} />
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody aria-busy={isLoading}>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={resolvedColumns.length} className="p-0">
                    <DataTableSkeleton
                      columns={columns.length}
                      rows={pageSize > 10 ? 10 : pageSize}
                      hasCheckbox={enableSelection}
                      hasActions={!!rowActions}
                    />
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={resolvedColumns.length}>
                    <DataTableError error={error} onRetry={onRetry} />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={resolvedColumns.length}>
                    {emptyState ? (
                      <DataTableEmpty
                        icon={emptyState.icon}
                        title={emptyState.title}
                        description={emptyState.description}
                        action={emptyState.action}
                        hasActiveFilters={hasActiveFilters}
                      />
                    ) : (
                      <DataTableEmpty hasActiveFilters={hasActiveFilters} />
                    )}
                  </TableCell>
                </TableRow>
              ) : virtualActive ? (
                renderVirtualRows()
              ) : (
                rows.map((row, rowIndex) => renderDesktopRow(row, rowIndex))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile (<640px): rows reflow to stacked label:value cards instead of
            horizontal scroll (WCAG 1.4.10 Reflow). */}
        <div className="divide-y divide-primary/10 bg-card sm:hidden">
          {isLoading ? (
            <div className="p-4">
              <DataTableSkeleton
                columns={1}
                rows={pageSize > 6 ? 6 : pageSize}
                hasCheckbox={false}
                hasActions={false}
              />
            </div>
          ) : error ? (
            <DataTableError error={error} onRetry={onRetry} />
          ) : rows.length === 0 ? (
            emptyState ? (
              <DataTableEmpty
                icon={emptyState.icon}
                title={emptyState.title}
                description={emptyState.description}
                action={emptyState.action}
                hasActiveFilters={hasActiveFilters}
              />
            ) : (
              <DataTableEmpty hasActiveFilters={hasActiveFilters} />
            )
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
                className={cn(
                  "data-table-mobile-row space-y-2 border-s-[3px] border-s-transparent p-4 transition-colors",
                  onRowClick &&
                    "cursor-pointer hover:border-s-brand-accent-500 hover:bg-primary/[0.045]",
                  row.getIsSelected() &&
                    "border-s-brand-accent-500 bg-primary/[0.07]",
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const header = cell.column.columnDef.header;
                  const label =
                    cell.column.columnDef.meta?.label ??
                    (typeof header === "string" && header.trim() !== ""
                      ? header
                      : undefined);
                  if (!label) {
                    return (
                      <div key={cell.id} className="flex justify-end">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={cell.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-primary/80">
                        {label}
                      </span>
                      <span className="min-w-0 text-end text-sm">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalRows={totalRows}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={pageSizeOptions}
          className="data-table-pagination border-t border-primary/10 bg-primary/[0.025] px-3"
        />
      </div>
    </div>
  );
}
