/**
 * Feature #11 — legal-entity facet + per-entity rollup for the contracts
 * list workspace (`/lex/contracts`).
 *
 * Three concerns live here so the page and the presentational components in
 * `../_components/contracts-entity-rollup.tsx` stay thin:
 *
 *   1. {@link useOrgEntityOptions} — `{ label, value }` facet options for the
 *      'Legal entity' select filter, sourced from the EXISTING
 *      `lexAdminApi.listOrgEntities` client (GET /org-entities). Labels resolve
 *      the bilingual `name` payload through `resolveLocalized` for the active
 *      locale. The chosen value is wired by the page as the `org_entity_id`
 *      list filter, which `fetchSuitePaginated` forwards verbatim and the
 *      backend `parseContractListFilters` already accepts.
 *
 *   2. {@link useEntityRollup} — per-entity subtotals `{ count,
 *      total_value_by_currency }` from the NEW GET /contracts/entity-rollup
 *      endpoint, scoped to the SAME filter surface the table currently shows
 *      (the backend parses the identical query vocabulary as the list). The
 *      panel and the portfolio-TCV footer both call this hook; identical query
 *      keys let TanStack Query dedupe them into a single request.
 *
 *   3. {@link sumRollupValueByCurrency} — pure aggregation of the bucket
 *      subtotals into a portfolio total-contract-value map, per currency (no
 *      cross-currency conversion is attempted — amounts are reported per ISO
 *      code, SAR first).
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { API_ENDPOINTS } from '@/lib/constants';
import { resolveLocalized } from '@/lib/i18n/localized';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import { fetchSuiteData } from '@/lib/suite-api';
import type { LocalizedText } from '@/types/forms';

/* ------------------------------------------------------------------------- *
 * Wire types — mirror backend/internal/lex/model/contract_entity_rollup.go.
 * ------------------------------------------------------------------------- */

/**
 * One per-org-entity aggregate bucket. Contracts without an `org_entity_id`
 * fall into a single "unassigned" bucket where `entity_id` / `entity_code` /
 * `entity_name` are absent, so bucket counts always reconcile with the
 * filtered list total.
 */
export interface ContractEntityRollupRow {
  entity_id?: string | null;
  entity_code?: string | null;
  /** Bilingual legal_org_entities.name payload ({ar,en}); nil on dangling links. */
  entity_name?: LocalizedText | null;
  count: number;
  /** Contract value subtotals keyed by ISO 4217 currency code. */
  total_value_by_currency: Record<string, number>;
}

/** Envelope for GET /contracts/entity-rollup. */
export interface ContractEntityRollup {
  tenant_id: string;
  generated_at: string;
  /** Echo of the effective list filters (labelling the roll-up scope). */
  filters: Record<string, string>;
  /** Contract count across all buckets (== filtered list total). */
  total: number;
  items: ContractEntityRollupRow[];
}

/* ------------------------------------------------------------------------- *
 * Rollup query (GET /contracts/entity-rollup).
 * ------------------------------------------------------------------------- */

/** The list scope the rollup mirrors: the table's active filters + search. */
export interface EntityRollupScope {
  /** `activeFilters` from `useDataTable` (values may be multi-select arrays). */
  filters: Record<string, string | string[]>;
  /** Debounce-agnostic search term (`searchValue` from `useDataTable`). */
  search?: string;
}

/**
 * Normalize the table's active filter map into the flat query-string record
 * the rollup endpoint parses (same vocabulary as the contract list: status /
 * type / risk_level / department / tag / owner_user_id / org_entity_id /
 * expiring_in_days / search). Arrays collapse to comma-joined strings exactly
 * like `buildSuiteQueryParams`; empty values are dropped. Unknown keys are
 * forwarded and ignored server-side, keeping this future-proof against new
 * facets.
 */
export function buildEntityRollupQuery(scope: EntityRollupScope): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(scope.filters ?? {})) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    query[key] = Array.isArray(value) ? value.join(',') : value;
  }
  const search = scope.search?.trim();
  if (search) {
    query.search = search;
  }
  return query;
}

/** Raw fetcher for GET /contracts/entity-rollup (suite `{data}` envelope). */
export function fetchContractEntityRollup(
  query: Record<string, string>,
): Promise<ContractEntityRollup> {
  return fetchSuiteData<ContractEntityRollup>(
    `${API_ENDPOINTS.LEX_CONTRACTS}/entity-rollup`,
    query,
  );
}

/**
 * Per-entity contract subtotals over the current table scope. Keyed on the
 * normalized query so pagination-only changes never refetch, while any filter
 * or search change re-rolls the aggregates alongside the list.
 */
export function useEntityRollup(scope: EntityRollupScope) {
  const { filters, search } = scope;
  const query = useMemo(
    () => buildEntityRollupQuery({ filters, search }),
    [filters, search],
  );
  return useQuery({
    queryKey: ['lex-contracts', 'entity-rollup', query],
    queryFn: () => fetchContractEntityRollup(query),
    staleTime: 30_000,
  });
}

/**
 * Portfolio TCV: sum every bucket's per-currency subtotal into one map. No
 * cross-currency conversion — each ISO code keeps its own line, SAR sorted
 * first (then alphabetical) to match the KSA-first formatting posture.
 */
export function sumRollupValueByCurrency(
  items: readonly ContractEntityRollupRow[] | undefined,
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const item of items ?? []) {
    for (const [currency, amount] of Object.entries(item.total_value_by_currency ?? {})) {
      if (!Number.isFinite(amount)) continue;
      totals.set(currency, (totals.get(currency) ?? 0) + amount);
    }
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => {
      if (a.currency === 'SAR') return -1;
      if (b.currency === 'SAR') return 1;
      return a.currency.localeCompare(b.currency);
    });
}

/* ------------------------------------------------------------------------- *
 * 'Legal entity' facet options (GET /org-entities — existing client).
 * ------------------------------------------------------------------------- */

export interface EntityFacetOption {
  label: string;
  value: string;
}

/**
 * Display name for an org entity in the active locale: bilingual name first,
 * falling back to the master-data `code`, then the id (never an empty label).
 */
export function orgEntityDisplayName(
  entity: Pick<OrgEntity, 'id' | 'code' | 'name'>,
  locale: 'en' | 'ar',
): string {
  return resolveLocalized(entity.name, locale) || entity.code || entity.id;
}

/**
 * Facet options for the 'Legal entity' select filter. Reuses the existing
 * `lexAdminApi.listOrgEntities` client (registry pages cap at one master-data
 * page of 500 — tenants hold tens of entities, not hundreds). Inactive
 * entities stay listed so historical contracts remain filterable; options are
 * sorted client-side by resolved label for a stable, locale-aware menu.
 */
export function useOrgEntityOptions(): {
  options: EntityFacetOption[];
  isLoading: boolean;
  isError: boolean;
} {
  const { locale } = useLocaleOrDefault();
  const query = useQuery({
    queryKey: ['lex-org-entities', 'facet-options'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500 }),
    staleTime: 5 * 60_000,
  });
  const options = useMemo(() => {
    const rows = query.data?.data ?? [];
    return rows
      .map((row) => ({ label: orgEntityDisplayName(row, locale), value: row.id }))
      .sort((a, b) => a.label.localeCompare(b.label, locale === 'ar' ? 'ar' : 'en'));
  }, [query.data, locale]);
  return { options, isLoading: query.isLoading, isError: query.isError };
}
