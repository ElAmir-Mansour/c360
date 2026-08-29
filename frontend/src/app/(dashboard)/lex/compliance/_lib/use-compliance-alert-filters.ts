/**
 * Saved views + URL-synced alert filters for the Watheeq (Lex) compliance
 * console (FEATURE 5).
 *
 * The compliance alerts table is driven by `useDataTable`, which already treats
 * the URL query string as the single source of truth for filters (it collects
 * every non-reserved search param into `activeFilters`). This hook layers a
 * narrow, strongly typed contract on top of that same URL model so the alert
 * filters (`status`, `severity`, and the date-bounded `created_after`) are
 * shareable + bookmarkable, and so a set of curated triage presets can be
 * applied / detected as the "active view".
 *
 * It deliberately mirrors `useDataTable`'s URL semantics VERBATIM (reserved
 * params are preserved, `page` resets to `1` on a filter change, array values
 * are written as repeated keys, empty values delete the key) so the page can
 * feed `filters` straight into `<DataTable activeFilters=...>` / `<SavedViewsBar
 * activeFilters=...>` and feed `applyView` into `<SavedViewsBar onApply=...>`
 * without any glue or divergence.
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`): the
 * preset labels live in a `LexBilingual<...>` bundle and are resolved through a
 * thin `useComplianceSavedViews()` hook. The `en` side reads naturally; the `ar`
 * side is professional MSA using the suite glossary
 * (الامتثال / تنبيه / لائحة / عقد / الحوكمة).
 */

'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Filter contract.
 *
 * These are the alert-table filter keys this hook owns in the URL. They are a
 * strict subset of the params `useDataTable` collects into `activeFilters`, so
 * the two stay perfectly aligned. `status` / `severity` map to the existing
 * `buildAlertFilters` select controls; `created_after` is an ISO-8601 lower
 * bound used by the date-bounded triage presets (e.g. "Resolved this week").
 * ------------------------------------------------------------------------- */

/** The query-string keys this hook reads/writes (a subset of the table filters). */
export const COMPLIANCE_ALERT_FILTER_KEYS = ['status', 'severity', 'created_after'] as const;

export type ComplianceAlertFilterKey = (typeof COMPLIANCE_ALERT_FILTER_KEYS)[number];

/**
 * The filter params shape shared across `useDataTable.activeFilters`,
 * `DataTable.activeFilters`, and `SavedViewsBar.activeFilters` / `onApply`.
 * A value is a single string, repeated strings (array), or absent.
 */
export type ComplianceAlertFilterParams = Record<string, string | string[]>;

/**
 * Reserved (non-filter) search params owned by `useDataTable` — kept verbatim
 * in sync with `RESERVED_SEARCH_PARAMS` there so filter writes never clobber
 * pagination / sort / search state.
 */
const RESERVED_SEARCH_PARAMS = ['page', 'per_page', 'sort', 'order', 'search'] as const;
const RESERVED_SEARCH_PARAM_SET = new Set<string>(RESERVED_SEARCH_PARAMS);

type SearchParamLike = ReturnType<typeof useSearchParams>;

function isEmptyValue(value: string | string[] | undefined): boolean {
  return (
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Clone the active search params into a mutable URLSearchParams (forEach-safe). */
function cloneSearchParams(searchParams: SearchParamLike): URLSearchParams {
  const params = new URLSearchParams();
  if (!searchParams) {
    return params;
  }
  if (typeof searchParams.forEach === 'function') {
    searchParams.forEach((value, key) => params.append(key, value));
    return params;
  }
  if (typeof searchParams.toString === 'function') {
    const raw = searchParams.toString();
    if (raw && raw !== '[object Object]') {
      return new URLSearchParams(raw);
    }
  }
  return params;
}

/**
 * Compare two filter param maps using the SAME normalization as
 * `SavedViewsBar`'s internal `paramsEqual` (order-independent keys, arrays
 * sorted, single values coerced to a one-element array). Empty values are
 * stripped first so `{}` equals `{ status: '' }`.
 */
export function complianceFilterParamsEqual(
  a: ComplianceAlertFilterParams,
  b: ComplianceAlertFilterParams,
): boolean {
  const clean = (input: ComplianceAlertFilterParams): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(input)) {
      if (isEmptyValue(value)) continue;
      const arr = Array.isArray(value) ? [...value] : [value];
      out[key] = arr.sort();
    }
    return out;
  };
  const ca = clean(a);
  const cb = clean(b);
  const ak = Object.keys(ca).sort();
  const bk = Object.keys(cb).sort();
  if (ak.length !== bk.length) return false;
  if (ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => {
    const av = ca[k];
    const bv = cb[k];
    return av.length === bv.length && av.every((v, i) => v === bv[i]);
  });
}

/* ------------------------------------------------------------------------- *
 * Triage presets.
 *
 * Each preset maps to concrete query params in the shared filter shape. They are
 * intentionally params the alert table understands: `status` / `severity` line
 * up with `buildAlertFilters`, and `created_after` is a dynamic ISO lower bound
 * (computed at apply-time, NOT baked in) so "Resolved this week" stays correct
 * across days. Labels are resolved separately via `useComplianceSavedViews()`.
 * ------------------------------------------------------------------------- */

export type ComplianceSavedViewId =
  | 'critical-open'
  | 'open-alerts'
  | 'investigating'
  | 'resolved-this-week';

export interface ComplianceSavedView {
  /** Stable id (used as React key and active-view discriminator). */
  readonly id: ComplianceSavedViewId;
  /**
   * Concrete params for this preset. `buildParams` is used instead of a static
   * object only when a value must be computed at apply-time (e.g. the start of
   * the current week for `created_after`); static presets supply `params`.
   */
  readonly params?: ComplianceAlertFilterParams;
  readonly buildParams?: () => ComplianceAlertFilterParams;
}

/** Start of the current ISO week (Monday 00:00 local), as an ISO-8601 string. */
function startOfThisWeekIso(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun … 6 = Sat
  const diffToMonday = (day + 6) % 7; // days since Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  return monday.toISOString();
}

/**
 * Curated compliance-alert triage presets, compatible with the saved-view
 * params shape. Order is the display order. Resolve display labels with
 * {@link useComplianceSavedViews}.
 */
export const COMPLIANCE_SAVED_VIEWS: readonly ComplianceSavedView[] = [
  { id: 'critical-open', params: { status: 'open', severity: 'critical' } },
  { id: 'open-alerts', params: { status: 'open' } },
  { id: 'investigating', params: { status: 'investigating' } },
  {
    id: 'resolved-this-week',
    buildParams: () => ({ status: 'resolved', created_after: startOfThisWeekIso() }),
  },
];

/** Resolve a preset's concrete params (running `buildParams` if present). */
export function resolveComplianceSavedViewParams(
  view: ComplianceSavedView,
): ComplianceAlertFilterParams {
  return view.buildParams ? view.buildParams() : view.params ?? {};
}

/* ------------------------------------------------------------------------- *
 * Bilingual preset labels.
 * ------------------------------------------------------------------------- */

export interface ComplianceSavedViewsLabels {
  /** Heading for the preset row (e.g. shown beside the chips). */
  presetsHeading: string;
  /** Accessible label for the "clear all filters" affordance. */
  clearAll: string;
  /** Per-preset display labels, keyed by preset id. */
  views: Record<ComplianceSavedViewId, string>;
}

export const complianceSavedViewsLabels: LexBilingual<ComplianceSavedViewsLabels> = {
  en: {
    presetsHeading: 'Quick triage',
    clearAll: 'Clear filters',
    views: {
      'critical-open': 'Critical & open',
      'open-alerts': 'Open alerts',
      investigating: 'Investigating',
      'resolved-this-week': 'Resolved this week',
    },
  },
  ar: {
    presetsHeading: 'فرز سريع',
    clearAll: 'مسح المرشّحات',
    views: {
      'critical-open': 'حرجة ومفتوحة',
      'open-alerts': 'التنبيهات المفتوحة',
      investigating: 'قيد التحقيق',
      'resolved-this-week': 'محلولة هذا الأسبوع',
    },
  },
};

/**
 * useComplianceSavedViews resolves the bilingual preset labels for the active
 * locale (defaults to English outside a LocaleProvider, matching the suite
 * convention). The integrator pairs each label with {@link COMPLIANCE_SAVED_VIEWS}
 * by id to render preset chips.
 */
export function useComplianceSavedViews(): ComplianceSavedViewsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(complianceSavedViewsLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * The hook.
 * ------------------------------------------------------------------------- */

export interface UseComplianceAlertFiltersResult {
  /**
   * The current alert filters read from the URL, in the shared
   * `Record<string, string | string[]>` shape. Feed straight into
   * `<DataTable activeFilters={filters}>` and `<SavedViewsBar activeFilters={filters}>`.
   */
  filters: ComplianceAlertFilterParams;
  /**
   * Set (or clear, with `undefined`) a single filter key in the URL. Mirrors
   * `useDataTable.setFilter`: resets `page` to `1`, preserves reserved params.
   * Wire to `<DataTable onFilterChange={setFilter}>`.
   */
  setFilter: (key: string, value: string | string[] | undefined) => void;
  /**
   * Remove all managed filter keys from the URL while preserving reserved
   * params (page reset to `1`). Wire to `<DataTable onClearFilters={clearFilters}>`.
   */
  clearFilters: () => void;
  /**
   * The id of the preset whose params match the current URL filters, or `null`.
   * Matching uses the same normalization as `SavedViewsBar`.
   */
  activeView: ComplianceSavedViewId | null;
  /**
   * Replace ALL managed filter keys with the given params atomically (one
   * navigation). Used for preset chips and `<SavedViewsBar onApply={applyView}>`.
   * Accepts a preset id or a raw params map.
   */
  applyView: (view: ComplianceSavedViewId | ComplianceAlertFilterParams) => void;
}

/**
 * useComplianceAlertFilters reads/writes the compliance-alert filters to the URL
 * query string (so views are shareable + bookmarkable) and exposes a clean
 * contract the page feeds into `useDataTable` / `DataTable` filters and
 * `SavedViewsBar`. It coordinates with `useDataTable` by using the IDENTICAL URL
 * model (same reserved params, same page reset, same array encoding), so both
 * can read the same `?status=...&severity=...` source of truth.
 */
export function useComplianceAlertFilters(): UseComplianceAlertFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? '';
  const searchParams = useSearchParams();

  const urlSearchParams = useMemo(() => cloneSearchParams(searchParams), [searchParams]);

  // Collect every non-reserved param as a filter (matches useDataTable exactly).
  const filters = useMemo<ComplianceAlertFilterParams>(() => {
    const out: ComplianceAlertFilterParams = {};
    urlSearchParams.forEach((value, key) => {
      if (RESERVED_SEARCH_PARAM_SET.has(key)) return;
      const existing = out[key];
      if (existing) {
        out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        out[key] = value;
      }
    });
    return out;
  }, [urlSearchParams]);

  const pushParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      router.push(query ? `${currentPath}?${query}` : currentPath);
    },
    [router, currentPath],
  );

  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) => {
      const params = cloneSearchParams(searchParams);
      if (isEmptyValue(value)) {
        params.delete(key);
      } else if (Array.isArray(value)) {
        params.delete(key);
        value.forEach((v) => params.append(key, v));
      } else {
        // Narrowed to a non-empty string by the guards above.
        params.set(key, value as string);
      }
      params.set('page', '1');
      pushParams(params);
    },
    [searchParams, pushParams],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    for (const key of RESERVED_SEARCH_PARAMS) {
      const value = urlSearchParams.get(key);
      if (value) params.set(key, value);
    }
    params.set('page', '1');
    pushParams(params);
  }, [urlSearchParams, pushParams]);

  const applyView = useCallback(
    (view: ComplianceSavedViewId | ComplianceAlertFilterParams) => {
      let nextFilters: ComplianceAlertFilterParams;
      if (typeof view === 'string') {
        const preset = COMPLIANCE_SAVED_VIEWS.find((v) => v.id === view);
        nextFilters = preset ? resolveComplianceSavedViewParams(preset) : {};
      } else {
        nextFilters = view;
      }

      // Start from reserved params only, then layer the view's filters on top so
      // applying a view fully replaces the managed filter state.
      const params = new URLSearchParams();
      for (const key of RESERVED_SEARCH_PARAMS) {
        const value = urlSearchParams.get(key);
        if (value) params.set(key, value);
      }
      for (const [key, value] of Object.entries(nextFilters)) {
        if (isEmptyValue(value)) continue;
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v));
        } else {
          // Narrowed to a non-empty string by the guards above.
          params.set(key, value as string);
        }
      }
      params.set('page', '1');
      pushParams(params);
    },
    [urlSearchParams, pushParams],
  );

  const activeView = useMemo<ComplianceSavedViewId | null>(() => {
    const match = COMPLIANCE_SAVED_VIEWS.find((view) =>
      complianceFilterParamsEqual(resolveComplianceSavedViewParams(view), filters),
    );
    return match?.id ?? null;
  }, [filters]);

  return { filters, setFilter, clearFilters, activeView, applyView };
}
