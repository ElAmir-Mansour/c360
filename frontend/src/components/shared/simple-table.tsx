"use client";

import { cn } from "@/lib/utils";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import {
  TableSortHeader,
  type SortDirection,
  type SortState,
} from "@/components/ui/table-sort-header";

export type { SortDirection, SortState } from "@/components/ui/table-sort-header";

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  /** When true (and `onSortChange` is supplied) the header becomes sortable. */
  sortable?: boolean;
  /** Header/cell alignment. */
  align?: "left" | "right" | "center";
  /** Optional per-cell className. */
  className?: string;
}

interface SimpleTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  /** Current sort state; enables active styling + aria-sort on headers. */
  sort?: SortState;
  /** Fired when a sortable header is toggled. */
  onSortChange?: (column: string, direction: SortDirection) => void;
  /** Stable row key extractor; defaults to the row index. */
  getRowKey?: (item: T, index: number) => React.Key;
  onRowClick?: (item: T) => void;
  className?: string;
  /** Accessible label for the table. */
  ariaLabel?: string;
}

/**
 * Lightweight, accessible table. Renders a real `<table>` with proper roles and
 * the design-system `.table-premium` styling (sticky uppercase header with a
 * shadow under it, brand-tinted row hover that lifts the active row, token-bound
 * borders). When `onRowClick` is supplied, rows gain a clickable affordance
 * (pointer + hover emphasis/lift), become keyboard-operable (focusable, Enter/
 * Space activate) and show a token-driven focus-visible ring. Sorting is opt-in
 * per column and additive — the original `columns/data/loading/emptyMessage`
 * public contract is unchanged.
 *
 * Formerly exported as `DataTable` from `@/components/shared/data-table`; it was
 * renamed to `SimpleTable` so that path can resolve to the full-featured
 * DataTable in `@/components/shared/data-table/data-table`.
 */
export function SimpleTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyMessage = "No data found",
  sort,
  onSortChange,
  getRowKey,
  onRowClick,
  className,
  ariaLabel,
}: SimpleTableProps<T>) {
  const rows = Array.isArray(data) ? data : [];

  if (loading) {
    return (
      <div className={cn("w-full", className)}>
        <LoadingSkeleton variant="table" count={6} />
      </div>
    );
  }

  const alignClass = (align?: Column<T>["align"]) =>
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-start";

  return (
    <div
      // Keyboard-focusable so the scrollable region is reachable without a mouse
      // (WCAG 2.1.1) even when the table has no other focusable content.
      tabIndex={0}
      className={cn(
        "w-full overflow-auto rounded-card border border-border bg-card shadow-elevation-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <table className="table-premium" aria-label={ariaLabel} aria-busy={false}>
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = Boolean(col.sortable) && Boolean(onSortChange);
              if (sortable) {
                return (
                  <TableSortHeader
                    key={col.key}
                    column={col.key}
                    sort={sort}
                    onSortChange={onSortChange}
                    align={col.align}
                    className={col.className}
                  >
                    {col.header}
                  </TableSortHeader>
                );
              }
              return (
                <th
                  key={col.key}
                  scope="col"
                  // Strengthen the sticky-header treatment: a slightly heavier
                  // shadow sits under the header so body rows read as sliding
                  // beneath it (the .table-premium base provides elevation-1;
                  // this lifts active scrolling contrast to elevation-2).
                  className={cn(
                    "shadow-elevation-2",
                    alignClass(col.align),
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((item, idx) => {
              const handleClick = onRowClick
                ? () => onRowClick(item)
                : undefined;
              return (
                <tr
                  key={getRowKey ? getRowKey(item, idx) : idx}
                  // Mouse convenience only — the row is NOT given role="button"
                  // because its cells contain their own interactive controls
                  // (links/menus), and an interactive row nesting interactive
                  // children violates WCAG 4.1.2 (nested-interactive). Keyboard
                  // users operate the in-cell controls directly.
                  onClick={handleClick}
                  className={cn(
                    // Fast/standard motion for the base class's
                    // background/box-shadow transition.
                    "duration-fast ease-standard outline-none",
                    // Stronger hover emphasis signals the row is clickable.
                    handleClick &&
                      "cursor-pointer hover:!bg-primary/[0.07] hover:!shadow-elevation-2",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(alignClass(col.align), col.className)}
                    >
                      {col.render
                        ? col.render(item)
                        : String(item[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @deprecated Import `SimpleTable` instead. This alias exists only so legacy
 * imports of the light table keep compiling; `@/components/shared/data-table`
 * now resolves to the full-featured DataTable.
 */
export const DataTable = SimpleTable;
