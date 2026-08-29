/**
 * Shared column-meta typing + label resolution for the full DataTable.
 *
 * Adds a typed `meta.label` to TanStack's ColumnDef (module augmentation) so
 * column authors can declare a human-friendly label independently of the
 * rendered header, and provides `getColumnLabel()` — the single source of truth
 * for the friendly name shown in the column-visibility menu, the column-header
 * menu, and the mobile card view.
 */
import type { Column, RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // TanStack requires the interface to redeclare its generics even when unused.
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * Human-friendly column name used in toolbar column toggles, header menus
     * and the stacked mobile view. Falls back to the header string, then to a
     * humanized column id.
     */
    label?: string;
  }
}

/** `updated_at` / `updatedAt` / `updated-at` -> `Updated At`. */
export function humanizeColumnId(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Friendly display label for a column:
 * `meta.label` ?? header (when it is a plain string) ?? humanized column id.
 */
export function getColumnLabel<TData, TValue>(
  column: Column<TData, TValue>,
): string {
  const meta = column.columnDef.meta;
  if (meta?.label) return meta.label;
  const header = column.columnDef.header;
  if (typeof header === "string" && header.trim().length > 0) return header;
  return humanizeColumnId(column.id);
}
