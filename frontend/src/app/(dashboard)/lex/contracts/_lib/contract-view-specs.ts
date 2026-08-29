/**
 * Selectable register "views" behind the contracts KPI tiles (`/lex/contracts`).
 *
 * Every clickable tile in the portfolio grid stands for one slice of the
 * register. A slice is BOTH a filter set and an ordering: the count tile
 * "Out for signature" and the money tile "Value pending signature" narrow to the
 * exact same rows (`status=pending_signature`) and differ only in how those rows
 * are ranked (recently-updated vs. highest-value first). Modelling the sort as
 * part of a view's identity is what lets the two stay independently selectable —
 * without it, clicking either one lights up both.
 *
 * This is a PURE, locale-agnostic module (no JSX, no hooks): it owns the view
 * *data* plus the exact-match logic used to decide which tile reads as pressed.
 * The list page feeds a matched spec into its single-navigation
 * `replaceQuery` flow; clicking the already-selected tile clears back to the
 * unfiltered register (see the toggle in `page.tsx`).
 *
 * Filter keys mirror the backend contract query contract and the keys already
 * driving the list filters (`status`, `risk_level`, `expiring_in_days`), so a
 * spec maps 1:1 onto the `activeFilters` the table exposes.
 */

import type { LexContractStatus } from '@/types/suites';

/** Register ordering: a sortable column plus its direction. */
export interface ContractSortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

/**
 * The register's resting order (mirrors the `defaultSort` handed to
 * `useDataTable` on the list page). Filter-only views — the preset chips and the
 * count tiles — restore this ordering when selected, so exactly one tile can be
 * pressed at a time.
 */
export const CONTRACTS_DEFAULT_SORT: ContractSortSpec = {
  column: 'updated_at',
  direction: 'desc',
};

/**
 * One selectable slice. `sort` is optional and defaults to
 * {@link CONTRACTS_DEFAULT_SORT} both when applying and when matching.
 */
export interface ContractViewSpec {
  /** Flat filter set applied as a full replacement of the active filters. */
  filters: Record<string, string>;
  /** Ordering owned by the view; omitted means the register default. */
  sort?: ContractSortSpec;
}

/** The unfiltered register — the state every view toggles back to. */
export const CONTRACTS_ALL_VIEW: ContractViewSpec = { filters: {} };

const STATUS_ACTIVE: LexContractStatus = 'active';
const STATUS_PENDING_SIGNATURE: LexContractStatus = 'pending_signature';

/** Ids of the four money tiles in the portfolio grid's second row. */
export type ContractMoneyViewId =
  | 'portfolio'
  | 'expiring30'
  | 'expiring60'
  | 'pendingSignature';

/**
 * Slices behind the money tiles. Each mirrors the filter set its figure is
 * computed from (see `use-portfolio-kpis`), ranked so the rows driving the
 * headline surface first: by value for the portfolio/signature tiles, by
 * soonest expiry for the renewal windows.
 */
export const CONTRACT_MONEY_VIEWS: Record<ContractMoneyViewId, ContractViewSpec> = {
  portfolio: {
    filters: { status: STATUS_ACTIVE },
    sort: { column: 'total_value', direction: 'desc' },
  },
  expiring30: {
    filters: { status: STATUS_ACTIVE, expiring_in_days: '30' },
    sort: { column: 'expiry_date', direction: 'asc' },
  },
  expiring60: {
    filters: { status: STATUS_ACTIVE, expiring_in_days: '60' },
    sort: { column: 'expiry_date', direction: 'asc' },
  },
  pendingSignature: {
    filters: { status: STATUS_PENDING_SIGNATURE },
    sort: { column: 'total_value', direction: 'desc' },
  },
};

/**
 * True when the register currently shows exactly this view: the same filter set
 * (same keys, same scalar values) AND the same ordering.
 *
 * Matching is exact and order-independent. An array-valued active filter (a
 * multi-select) never matches a spec's scalar value, so a partially-overlapping
 * or superset filter state correctly yields `false` — a tile only reads as
 * pressed when the register really is showing its slice and nothing else.
 */
export function isContractViewActive(
  spec: ContractViewSpec,
  activeFilters: Record<string, string | string[]>,
  sort?: { column?: string; direction?: 'asc' | 'desc' },
): boolean {
  const specSort = spec.sort ?? CONTRACTS_DEFAULT_SORT;
  const column = sort?.column ?? CONTRACTS_DEFAULT_SORT.column;
  const direction = sort?.direction ?? CONTRACTS_DEFAULT_SORT.direction;
  if (column !== specSort.column || direction !== specSort.direction) {
    return false;
  }

  const specKeys = Object.keys(spec.filters);
  if (specKeys.length !== Object.keys(activeFilters).length) {
    return false;
  }
  return specKeys.every((key) => {
    const activeValue = activeFilters[key];
    return typeof activeValue === 'string' && activeValue === spec.filters[key];
  });
}

/**
 * The view as a standalone register URL. Only used where a tile has no
 * selection handler wired (the money strip rendered outside the list page), so
 * such a tile still navigates somewhere useful instead of going dead.
 */
export function contractViewHref(spec: ContractViewSpec): string {
  const params = new URLSearchParams(spec.filters);
  const sort = spec.sort ?? CONTRACTS_DEFAULT_SORT;
  params.set('sort', sort.column);
  params.set('order', sort.direction);
  return `/lex/contracts?${params.toString()}`;
}
