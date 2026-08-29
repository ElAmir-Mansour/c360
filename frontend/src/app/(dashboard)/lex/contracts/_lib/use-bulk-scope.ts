'use client';

/**
 * Bulk selection-scope translation for the ClarioLegal / Watheeq contracts list
 * (`/lex/contracts`, feature #8 select-all-matching).
 *
 * The shared DataTable surfaces the selection as a `SelectionScope`:
 *
 *   { mode: 'page',         ids }                      — explicit row ids
 *   { mode: 'all-matching', filterQuery, excludedIds } — everything matching
 *
 * The NEW bulk endpoints (`POST /contracts/bulk-status`, `POST
 * /contracts/bulk-analyze`) accept EITHER `{ contract_ids: [...] }` OR
 * `{ filter: {...} }` — never both — where `filter` carries the same query
 * params as the contract list, restricted server-side to the membership keys
 * (`search`, `status`, `type`, `risk_level`, `owner_user_id`, `department`,
 * `tag`, `expiring_in_days`); unknown keys are a 400 and the resolved set is
 * capped at 1000 (`service.MaxBulkContracts`).
 *
 * `useBulkScope().resolveBulkPayload(scope)` maps a scope onto that contract:
 *
 *   - page mode                      -> { contract_ids }
 *   - all-matching, expressible      -> { filter } (sanitized, server resolves)
 *   - all-matching, NOT expressible  -> the matching ids are resolved
 *     client-side through the SAME list endpoint the table reads
 *     (GET /contracts, created_at ASC pages), exclusions subtracted, and sent
 *     as { contract_ids }. "Not expressible" means the scope carries
 *     `excludedIds`, or filter keys the bulk endpoint rejects (e.g. the page's
 *     `expiry_from`/`expiry_to` inputs), or multi-value filters.
 *
 * Both paths enforce the 1000-target cap up front with a bilingual
 * `BulkScopeError` so the page can toast a clear message instead of a raw 400.
 *
 * Labels follow the canonical lex bilingual contract (`LexBilingual<T>`
 * resolved via `useLocaleOrDefault`); counts are formatted with `useLexFormat`
 * (Arabic-Indic digits under `ar`).
 */

import { useCallback, useMemo } from 'react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  countScopeSelected,
  type SelectionFilterQuery,
  type SelectionScope,
} from '@/components/shared/data-table/selection-scope';
import { API_ENDPOINTS } from '@/lib/constants';
import { useLexFormat } from '@/lib/lex/ksa';
import { fetchSuitePaginated } from '@/lib/suite-api';
import type { LexContract } from '@/types/suites';

import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Backend contract mirrors.
 * ------------------------------------------------------------------------- */

/** Mirrors `service.MaxBulkContracts` — the hard cap of one bulk batch. */
export const MAX_BULK_CONTRACT_TARGETS = 1000;

/** Mirrors the repository per-page clamp used for client-side id resolution. */
export const BULK_RESOLVE_PAGE_SIZE = 200;

/** Membership-defining filter keys `POST /contracts/bulk-*` accepts (mirrors
 *  `bulkFilterAllowedKeys` in contract_bulk_handler.go). */
export const BULK_FILTER_ALLOWED_KEYS = [
  'search',
  'status',
  'type',
  'risk_level',
  'owner_user_id',
  'department',
  'tag',
  'expiring_in_days',
] as const;

/** Presentation-only keys the backend accepts-and-drops; we drop them too. */
const BULK_FILTER_IGNORED_KEYS = new Set(['page', 'per_page', 'sort', 'order']);

const BULK_FILTER_ALLOWED_KEY_SET = new Set<string>(BULK_FILTER_ALLOWED_KEYS);

/** Request body scope of the two bulk endpoints: exactly one addressing mode. */
export type BulkContractScopePayload =
  | { contract_ids: string[] }
  | { filter: Record<string, string> };

/* ------------------------------------------------------------------------- *
 * Bilingual labels.
 * ------------------------------------------------------------------------- */

export interface BulkScopeLabels {
  tooMany: (total: string, max: string) => string;
  resolveFailed: string;
  nothingSelected: string;
}

export const bulkScopeLabels: LexBilingual<BulkScopeLabels> = {
  en: {
    tooMany: (total, max) =>
      `The current filter matches ${total} contracts; bulk actions are capped at ${max}. Narrow the filter and retry.`,
    resolveFailed:
      'Unable to resolve the matching contracts for this bulk action. Retry, or narrow the filter.',
    nothingSelected: 'Select at least one contract first.',
  },
  ar: {
    tooMany: (total, max) =>
      `يطابق المرشّح الحالي ${total} من العقود؛ الحد الأقصى للإجراءات الجماعية هو ${max}. ضيّق نطاق المرشّح وأعد المحاولة.`,
    resolveFailed:
      'تعذّر تحديد العقود المطابقة لهذا الإجراء الجماعي. أعد المحاولة أو ضيّق نطاق المرشّح.',
    nothingSelected: 'حدّد عقدًا واحدًا على الأقل أولًا.',
  },
};

/** Resolve the bulk-scope label bundle for the active locale. */
export function useBulkScopeLabels(): BulkScopeLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(bulkScopeLabels, locale), [locale]);
}

/** Typed failure the page can toast directly (`error.message` is localized). */
export class BulkScopeError extends Error {
  readonly code: 'too_many' | 'resolve_failed' | 'nothing_selected';

  constructor(
    message: string,
    code: 'too_many' | 'resolve_failed' | 'nothing_selected',
  ) {
    super(message);
    this.name = 'BulkScopeError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------------- *
 * Pure helpers (exported for unit tests).
 * ------------------------------------------------------------------------- */

export interface BulkFilterSanitization {
  /** Scalar filter object the bulk endpoints accept as-is. */
  filter: Record<string, string>;
  /** Keys the bulk endpoints cannot express (force client-side resolution). */
  unsupported: string[];
}

/**
 * Partition a table filter map into the scalar object `POST /contracts/bulk-*`
 * accepts and the keys it cannot express. Empty values are dropped (like the
 * backend does), presentation keys (page/sort/…) are ignored, single-element
 * arrays collapse to their scalar, and multi-value arrays or unknown keys
 * (e.g. `expiry_from`) land in `unsupported`.
 */
export function sanitizeBulkFilter(
  query: SelectionFilterQuery,
): BulkFilterSanitization {
  const filter: Record<string, string> = {};
  const unsupported: string[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (BULK_FILTER_IGNORED_KEYS.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const nonEmpty = values.filter(
      (value) => typeof value === 'string' && value.trim() !== '',
    );
    if (nonEmpty.length === 0) continue;
    if (!BULK_FILTER_ALLOWED_KEY_SET.has(key) || nonEmpty.length > 1) {
      unsupported.push(key);
      continue;
    }
    filter[key] = nonEmpty[0].trim();
  }
  return { filter, unsupported };
}

/** How a scope maps onto the bulk request body (pure; the hook executes it). */
export type BulkScopePlan =
  | { kind: 'ids'; contractIds: string[] }
  | { kind: 'filter'; filter: Record<string, string> }
  | {
      kind: 'resolve';
      filterQuery: SelectionFilterQuery;
      excludedIds: string[];
    };

export function planBulkScope(scope: SelectionScope): BulkScopePlan {
  if (scope.mode === 'page') {
    return { kind: 'ids', contractIds: [...scope.ids] };
  }
  const { filter, unsupported } = sanitizeBulkFilter(scope.filterQuery);
  if (unsupported.length === 0 && scope.excludedIds.length === 0) {
    return { kind: 'filter', filter };
  }
  return {
    kind: 'resolve',
    filterQuery: scope.filterQuery,
    excludedIds: [...scope.excludedIds],
  };
}

/** Split a captured filter map into `FetchParams`-shaped `search` + `filters`
 *  for the list endpoint (presentation keys dropped). */
export function splitScopeQuery(query: SelectionFilterQuery): {
  search?: string;
  filters: Record<string, string | string[]>;
} {
  const filters: Record<string, string | string[]> = {};
  let search: string | undefined;
  for (const [key, value] of Object.entries(query)) {
    if (BULK_FILTER_IGNORED_KEYS.has(key)) continue;
    if (key === 'search') {
      if (typeof value === 'string' && value !== '') search = value;
      continue;
    }
    filters[key] = value;
  }
  return { search, filters };
}

/* ------------------------------------------------------------------------- *
 * The hook.
 * ------------------------------------------------------------------------- */

export interface UseBulkScopeResult {
  /**
   * Translate a selection scope into the request body for
   * `POST /contracts/bulk-status` / `POST /contracts/bulk-analyze`.
   * Throws a localized {@link BulkScopeError} on an empty scope, on the
   * 1000-target cap, or when client-side id resolution fails.
   */
  resolveBulkPayload: (
    scope: SelectionScope,
  ) => Promise<BulkContractScopePayload>;
  /** Effective selected-row count for confirmations/toasts. */
  countScope: (scope: SelectionScope, totalRows: number) => number;
  labels: BulkScopeLabels;
}

export function useBulkScope(): UseBulkScopeResult {
  const labels = useBulkScopeLabels();
  const f = useLexFormat();

  const resolveBulkPayload = useCallback(
    async (scope: SelectionScope): Promise<BulkContractScopePayload> => {
      const plan = planBulkScope(scope);
      if (plan.kind === 'ids') {
        if (plan.contractIds.length === 0) {
          throw new BulkScopeError(labels.nothingSelected, 'nothing_selected');
        }
        return { contract_ids: plan.contractIds };
      }
      if (plan.kind === 'filter') {
        return { filter: plan.filter };
      }

      // Exclusions or filter keys the bulk endpoints can't express: resolve
      // the FULL matching id set through the same list endpoint the table
      // reads, so the target set can never drift from what the user saw.
      const { search, filters } = splitScopeQuery(plan.filterQuery);
      const ids: string[] = [];
      let page = 1;
      for (;;) {
        let result;
        try {
          result = await fetchSuitePaginated<LexContract>(
            API_ENDPOINTS.LEX_CONTRACTS,
            {
              page,
              per_page: BULK_RESOLVE_PAGE_SIZE,
              // created_at is immutable, so paging membership stays stable
              // (mirrors ContractBulkService.ResolveFilter server-side).
              sort: 'created_at',
              order: 'asc',
              search,
              filters,
            },
          );
        } catch {
          throw new BulkScopeError(labels.resolveFailed, 'resolve_failed');
        }
        const total = result.meta?.total ?? result.data.length;
        if (total > MAX_BULK_CONTRACT_TARGETS) {
          throw new BulkScopeError(
            labels.tooMany(
              f.formatNumber(total),
              f.formatNumber(MAX_BULK_CONTRACT_TARGETS),
            ),
            'too_many',
          );
        }
        for (const row of result.data) ids.push(row.id);
        // Done when a page under-fills or the full count is collected (rows
        // vanishing mid-walk under-fill a page; both exits terminate).
        if (result.data.length === 0 || ids.length >= total) break;
        page += 1;
      }

      const excluded = new Set(plan.excludedIds);
      const contractIds = ids.filter((id) => !excluded.has(id));
      if (contractIds.length === 0) {
        throw new BulkScopeError(labels.nothingSelected, 'nothing_selected');
      }
      return { contract_ids: contractIds };
    },
    [f, labels],
  );

  const countScope = useCallback(
    (scope: SelectionScope, totalRows: number) =>
      countScopeSelected(scope, totalRows),
    [],
  );

  return { resolveBulkPayload, countScope, labels };
}
