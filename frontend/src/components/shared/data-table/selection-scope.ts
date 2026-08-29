/**
 * Selection scope for the shared DataTable "select all N matching" affordance
 * (item #8) — the standard Gmail-style extension of a fully-selected page to
 * every row matching the current server-side filters.
 *
 * The scope is a discriminated union:
 *
 *   { mode: 'page',         ids }                       — explicit row ids
 *   { mode: 'all-matching', filterQuery, excludedIds }  — "everything matching
 *     this filter map", minus rows the user unchecked after extending
 *
 * The reducer here is pure (unit-tested in selection-scope.test.ts); the
 * DataTable owns dispatching:
 *
 *   - page-selection-changed  — the row-checkbox state changed. In page mode it
 *     simply replaces the id list; in all-matching mode unchecked page rows are
 *     recorded in excludedIds (re-checked rows are removed again), and clearing
 *     the whole page (e.g. the header checkbox) collapses the scope entirely.
 *   - select-all-matching     — the banner button; captures the filter map.
 *   - filters-changed         — the page's filters/search changed, which
 *     invalidates an "all matching" claim; the scope collapses to empty.
 *   - clear                   — explicit reset (banner button / bulk done).
 *
 * Everything is opt-in: pages that never pass `selectAllMatching` to DataTable
 * keep the historical ids-only selection behavior untouched.
 */

/** The filter map captured by an all-matching scope (page-owned filters plus
 *  the free-text search under the `search` key). */
export type SelectionFilterQuery = Record<string, string | string[]>;

export type SelectionScope =
  | { mode: "page"; ids: string[] }
  | {
      mode: "all-matching";
      filterQuery: SelectionFilterQuery;
      excludedIds: string[];
    };

/** The empty scope every table starts from (and collapses back to). */
export const EMPTY_SELECTION_SCOPE: SelectionScope = { mode: "page", ids: [] };

export type SelectionScopeAction =
  | {
      type: "page-selection-changed";
      /** Every currently-selected row id (TanStack rowSelection truthy keys). */
      selectedIds: string[];
      /** The ids of the rows rendered on the current page. */
      pageIds: string[];
    }
  | { type: "select-all-matching"; filterQuery: SelectionFilterQuery }
  | { type: "filters-changed"; filterQuery: SelectionFilterQuery }
  | { type: "clear" };

/**
 * Drop empty values ("" / [] / null-ish), sort keys and array members, so two
 * filter maps that mean the same thing compare (and serialize) identically.
 */
export function normalizeFilterQuery(
  query: SelectionFilterQuery,
): SelectionFilterQuery {
  const normalized: SelectionFilterQuery = {};
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (value !== "") normalized[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      normalized[key] = [...value].sort();
    }
  }
  return normalized;
}

/** Structural equality of two filter maps after normalization. */
export function filterQueriesEqual(
  a: SelectionFilterQuery,
  b: SelectionFilterQuery,
): boolean {
  return (
    JSON.stringify(normalizeFilterQuery(a)) ===
    JSON.stringify(normalizeFilterQuery(b))
  );
}

/**
 * Effective number of selected rows: explicit ids in page mode, the server
 * total minus exclusions in all-matching mode (floored at zero — exclusions can
 * momentarily reference rows that left the result set).
 */
export function countScopeSelected(
  scope: SelectionScope,
  totalRows: number,
): number {
  if (scope.mode === "page") return scope.ids.length;
  return Math.max(totalRows - scope.excludedIds.length, 0);
}

/** True when the scope selects nothing (given the current server total). */
export function isScopeEmpty(scope: SelectionScope, totalRows: number): boolean {
  return countScopeSelected(scope, totalRows) === 0;
}

export function selectionScopeReducer(
  state: SelectionScope,
  action: SelectionScopeAction,
): SelectionScope {
  switch (action.type) {
    case "page-selection-changed": {
      if (state.mode === "all-matching") {
        // Unchecking every visible row (e.g. the header checkbox) is a clear,
        // not "exclude the whole page": collapse the extended selection.
        if (action.selectedIds.length === 0) return EMPTY_SELECTION_SCOPE;
        const selected = new Set(action.selectedIds);
        const excluded = new Set(state.excludedIds);
        for (const id of action.pageIds) {
          if (selected.has(id)) excluded.delete(id);
          else excluded.add(id);
        }
        return { ...state, excludedIds: [...excluded] };
      }
      return { mode: "page", ids: [...action.selectedIds] };
    }
    case "select-all-matching":
      return {
        mode: "all-matching",
        filterQuery: normalizeFilterQuery(action.filterQuery),
        excludedIds: [],
      };
    case "filters-changed": {
      if (state.mode !== "all-matching") return state;
      if (filterQueriesEqual(state.filterQuery, action.filterQuery)) {
        return state;
      }
      // The filter the user extended over no longer holds — an all-matching
      // scope must never silently target a different result set.
      return EMPTY_SELECTION_SCOPE;
    }
    case "clear":
      return EMPTY_SELECTION_SCOPE;
    default:
      return state;
  }
}
