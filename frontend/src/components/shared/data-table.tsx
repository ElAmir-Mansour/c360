/**
 * Canonical resolution for `@/components/shared/data-table`.
 *
 * Historically this file held a lightweight 180-line table whose `DataTable`
 * export collided with the full-featured DataTable that lives in
 * `./data-table/data-table`. The light table now lives at
 * `@/components/shared/simple-table` (exported as `SimpleTable`), and this
 * module re-exports the FULL DataTable so the previously ambiguous import path
 * resolves to the real one.
 *
 * - Need the rich table (server pagination, filters, selection, virtual rows,
 *   column resize/reorder/density)? -> `import { DataTable } from "@/components/shared/data-table";`
 * - Need the tiny presentational table? -> `import { SimpleTable } from "@/components/shared/simple-table";`
 */
export { DataTable, type DataTableProps } from "./data-table/data-table";
