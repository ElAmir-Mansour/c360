/**
 * FEATURE 4 — Saved views + URL-synced filters for the Settlements / ADR list.
 *
 * Two cooperating pieces, both feature-local to the settlements surface:
 *
 *   1. {@link useSettlementFilters} — a thin façade over the URL search params
 *      (via next/navigation) that mirrors the slice of `useDataTable` the list
 *      page needs for filter handling (`filters` / `setFilter` / `clearFilters`)
 *      plus an `applyView` that swaps a whole filter + sort preset atomically and
 *      an `activeView` id that tells the page which preset is currently active.
 *      It is intentionally compatible with the `DataTable` `activeFilters` /
 *      `onFilterChange` / `onClearFilters` contract so the integrator can hand
 *      these straight to `<DataTable>` and `<SavedViewsBar>`.
 *
 *   2. {@link SETTLEMENT_SAVED_VIEWS} + {@link useSettlementSavedViews} — the
 *      curated preset chips ("Pending my approval", "Negotiating", "High value",
 *      "Executed") with a bilingual (EN + MSA) label hook. Presets are pure data
 *      (status filters and/or a sort directive), so a `.ts` file is sufficient —
 *      the label hook returns plain strings, never JSX.
 *
 * Owns its own labels per the lex bilingual contract (`../../_lib/lex-i18n.ts`):
 * a `LexBilingual<SettlementViewLabels>` bundle (EN + professional MSA) resolved
 * against the active locale.
 *
 * URL model (matches `useDataTable`):
 *   - Filter keys (`status`, `method`) live as their own search params.
 *   - Reserved table params (`page`, `per_page`, `sort`, `order`, `search`) are
 *     preserved across filter edits; `applyView` is the only operation that may
 *     also set `sort` / `order` (for the "High value" preset, which sorts by
 *     descending settlement value rather than narrowing status).
 *   - Every mutation resets `page` to 1.
 */

'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type { SettlementMethod, SettlementStatus } from '@/lib/lex/settlements';

// ---------------------------------------------------------------------------
// URL param model
// ---------------------------------------------------------------------------

/** Search-param keys treated as table state (kept intact across filter edits). */
const RESERVED_PARAMS = ['page', 'per_page', 'sort', 'order', 'search'] as const;
type ReservedParam = (typeof RESERVED_PARAMS)[number];
const RESERVED_PARAM_SET = new Set<string>(RESERVED_PARAMS);

/** Filterable list columns the settlements backend understands. */
export const SETTLEMENT_FILTER_KEYS = ['status', 'method'] as const;
export type SettlementFilterKey = (typeof SETTLEMENT_FILTER_KEYS)[number];

/** The map shape consumed by `DataTable` (`activeFilters`) and `SavedViewsBar`. */
export type SettlementFilters = Record<string, string | string[]>;

type SearchParamsLike = ReturnType<typeof useSearchParams>;

// ---------------------------------------------------------------------------
// Saved-view preset model
// ---------------------------------------------------------------------------

/** Stable identifiers for the curated presets (also the chip keys). */
export const SETTLEMENT_SAVED_VIEW_IDS = [
  'pending-my-approval',
  'negotiating',
  'high-value',
  'executed',
] as const;
export type SettlementSavedViewId = (typeof SETTLEMENT_SAVED_VIEW_IDS)[number];

/**
 * A curated settlements view. `filters` are status/method narrowings applied as
 * search params; `sort`/`order` (optional) drive presets like "High value" that
 * reorder rather than filter. The shape `filters` carries is exactly what
 * `applyView` and `SavedViewsBar.onApply` expect.
 */
export interface SettlementSavedView {
  id: SettlementSavedViewId;
  filters: SettlementFilters;
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * The four presets requested for the settlements surface:
 *   - "Pending my approval" → status = pending_approval
 *   - "Negotiating"         → status = negotiating
 *   - "High value"          → sort by value desc (no status narrowing)
 *   - "Executed"            → status = executed
 */
export const SETTLEMENT_SAVED_VIEWS: readonly SettlementSavedView[] = [
  {
    id: 'pending-my-approval',
    filters: { status: 'pending_approval' satisfies SettlementStatus },
  },
  {
    id: 'negotiating',
    filters: { status: 'negotiating' satisfies SettlementStatus },
  },
  {
    id: 'high-value',
    filters: {},
    sort: 'value',
    order: 'desc',
  },
  {
    id: 'executed',
    filters: { status: 'executed' satisfies SettlementStatus },
  },
] as const;

// ---------------------------------------------------------------------------
// Bilingual labels (feature-local, per the lex i18n contract)
// ---------------------------------------------------------------------------

export interface SettlementViewLabels {
  /** Display label per preset id (chip caption). */
  presets: Record<SettlementSavedViewId, string>;
  /** Labels forwarded to <SavedViewsBar> for its save/list affordances. */
  bar: {
    save: string;
    saved: string;
    empty: string;
  };
  /** Strings for an (optional) preset chip row the integrator may render. */
  presetRow: {
    label: string;
    clear: string;
  };
}

const viewLabels: LexBilingual<SettlementViewLabels> = {
  en: {
    presets: {
      'pending-my-approval': 'Pending my approval',
      negotiating: 'Negotiating',
      'high-value': 'High value',
      executed: 'Executed',
    },
    bar: {
      save: 'Save current view',
      saved: 'Saved views',
      empty: 'No saved views yet',
    },
    presetRow: {
      label: 'Quick views',
      clear: 'Clear filters',
    },
  },
  ar: {
    presets: {
      'pending-my-approval': 'بانتظار اعتمادي',
      negotiating: 'قيد التفاوض',
      'high-value': 'عالية القيمة',
      executed: 'منفّذة',
    },
    bar: {
      save: 'حفظ العرض الحالي',
      saved: 'العروض المحفوظة',
      empty: 'لا توجد عروض محفوظة بعد',
    },
    presetRow: {
      label: 'عروض سريعة',
      clear: 'مسح المرشّحات',
    },
  },
};

/** Pure resolver (non-React / tests, English default). */
export function resolveSettlementViewLabels(locale: AppLocale = 'en'): SettlementViewLabels {
  return resolveLexBilingual(viewLabels, locale);
}

/** Bilingual-label hook for the saved-view chips + the SavedViewsBar copy. */
export function useSettlementSavedViews(): SettlementViewLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSettlementViewLabels(locale), [locale]);
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function getParam(searchParams: SearchParamsLike, key: string): string | null {
  if (!searchParams || typeof searchParams.get !== 'function') {
    return null;
  }
  return searchParams.get(key);
}

/** Reconstruct the active (non-reserved) filter map from the current URL. */
function readFilters(searchParams: SearchParamsLike): SettlementFilters {
  const filters: SettlementFilters = {};
  if (!searchParams || typeof searchParams.forEach !== 'function') {
    return filters;
  }
  searchParams.forEach((value, key) => {
    if (RESERVED_PARAM_SET.has(key)) {
      return;
    }
    const existing = filters[key];
    if (existing === undefined) {
      filters[key] = value;
    } else if (Array.isArray(existing)) {
      filters[key] = [...existing, value];
    } else {
      filters[key] = [existing, value];
    }
  });
  return filters;
}

/** Carry forward only the reserved table params (optionally dropping some). */
function carryReserved(
  searchParams: SearchParamsLike,
  next: URLSearchParams,
  skip: ReadonlySet<ReservedParam> = new Set(),
): void {
  for (const key of RESERVED_PARAMS) {
    if (skip.has(key)) {
      continue;
    }
    const value = getParam(searchParams, key);
    if (value) {
      next.set(key, value);
    }
  }
}

function appendFilters(next: URLSearchParams, filters: SettlementFilters): void {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== '') {
          next.append(key, entry);
        }
      });
    } else {
      next.set(key, value);
    }
  }
}

/** Structural equality for the filter maps (order-insensitive, array-aware). */
function filtersEqual(a: SettlementFilters, b: SettlementFilters): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) {
    return false;
  }
  return ak.every((key) => {
    const av = a[key];
    const bv = b[key];
    if (av === undefined || bv === undefined) {
      return false;
    }
    if (Array.isArray(av) || Array.isArray(bv)) {
      const aa = (Array.isArray(av) ? [...av] : [av]).sort();
      const ba = (Array.isArray(bv) ? [...bv] : [bv]).sort();
      return aa.length === ba.length && aa.every((v, i) => v === ba[i]);
    }
    return av === bv;
  });
}

// ---------------------------------------------------------------------------
// useSettlementFilters
// ---------------------------------------------------------------------------

export interface UseSettlementFiltersReturn {
  /** Active non-reserved filter map, ready for `DataTable.activeFilters` / `SavedViewsBar.activeFilters`. */
  filters: SettlementFilters;
  /** Set/replace/remove a single filter key (DataTable `onFilterChange`). Resets page. */
  setFilter: (key: string, value: string | string[] | undefined) => void;
  /** Remove every filter, preserving reserved table params (DataTable `onClearFilters`). Resets page. */
  clearFilters: () => void;
  /**
   * Apply a saved view's full filter set atomically. Accepts either a curated
   * {@link SettlementSavedView} or the raw param map handed back by
   * `SavedViewsBar.onApply`. Reserved params are preserved except `sort`/`order`,
   * which the view may override; page resets to 1.
   */
  applyView: (view: SettlementSavedView | SettlementFilters) => void;
  /** Id of the curated preset whose filter+sort exactly matches the URL, else undefined. */
  activeView: SettlementSavedViewId | undefined;
}

/**
 * useSettlementFilters reads/writes the settlements list filters (status,
 * method) and saved-view sort directives to the URL via next/navigation. It is a
 * drop-in for the page's existing `useDataTable`-derived filter handling: the
 * returned `filters` feeds `DataTable.activeFilters` / `SavedViewsBar`, and
 * `setFilter` / `clearFilters` map onto `DataTable.onFilterChange` /
 * `onClearFilters`. (`useDataTable` derives the same `activeFilters` from the URL
 * independently, so both stay consistent — this hook centralises the WRITE side
 * plus the preset semantics.)
 */
export function useSettlementFilters(): UseSettlementFiltersReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = pathname ?? '';

  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const push = useCallback(
    (next: URLSearchParams) => {
      next.set('page', '1');
      const query = next.toString();
      router.push(query ? `${currentPath}?${query}` : currentPath);
    },
    [router, currentPath],
  );

  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) => {
      const next = new URLSearchParams();
      carryReserved(searchParams, next, new Set(['page']));
      // Re-emit every existing non-reserved filter except the one being changed.
      appendFilters(
        next,
        Object.fromEntries(Object.entries(filters).filter(([k]) => k !== key)),
      );
      if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        appendFilters(next, { [key]: value });
      }
      push(next);
    },
    [searchParams, filters, push],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams();
    carryReserved(searchParams, next, new Set(['page']));
    push(next);
  }, [searchParams, push]);

  const applyView = useCallback(
    (view: SettlementSavedView | SettlementFilters) => {
      const isPreset = isSavedView(view);
      const viewFilters: SettlementFilters = isPreset ? view.filters : view;
      const sort = isPreset ? view.sort : undefined;
      const order = isPreset ? view.order : undefined;

      const next = new URLSearchParams();
      // Preserve per_page / search; let the view own sort + order + page.
      carryReserved(searchParams, next, new Set(['page', 'sort', 'order']));
      if (sort) {
        next.set('sort', sort);
        next.set('order', order ?? 'desc');
      } else {
        // A non-sort preset keeps the user's current sort/order.
        const currentSort = getParam(searchParams, 'sort');
        const currentOrder = getParam(searchParams, 'order');
        if (currentSort) next.set('sort', currentSort);
        if (currentOrder) next.set('order', currentOrder);
      }
      appendFilters(next, viewFilters);
      push(next);
    },
    [searchParams, push],
  );

  const activeView = useMemo<SettlementSavedViewId | undefined>(() => {
    const sort = getParam(searchParams, 'sort');
    const order = getParam(searchParams, 'order');
    const match = SETTLEMENT_SAVED_VIEWS.find((view) => {
      if (!filtersEqual(view.filters, filters)) {
        return false;
      }
      if (view.sort) {
        return view.sort === sort && (view.order ?? 'desc') === (order ?? undefined);
      }
      return true;
    });
    return match?.id;
  }, [searchParams, filters]);

  return { filters, setFilter, clearFilters, applyView, activeView };
}

function isSavedView(value: SettlementSavedView | SettlementFilters): value is SettlementSavedView {
  return (
    typeof (value as SettlementSavedView).id === 'string' &&
    'filters' in value &&
    SETTLEMENT_SAVED_VIEW_IDS.includes((value as SettlementSavedView).id)
  );
}

// Re-export the filter value enums for callers that build option lists.
export type { SettlementMethod, SettlementStatus };
