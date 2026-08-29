/**
 * Feature 9 — obligations command-center rollup for the contracts LIST page
 * (`/lex/contracts`).
 *
 * Data strategy — ONE batched call. The lex backend exposes only a single
 * `contract_id` filter on `GET /api/v1/lex/obligations` (no `contract_ids`
 * batch filter), so instead of N per-contract calls the rollup issues a single
 * tenant-wide `listObligations` fetch (sorted `due_date asc`, `per_page` at
 * the backend clamp of 200 — see `suiteapi.ParsePagination` maxPageSize) and
 * joins it to the visible contract rows client-side. TanStack Query dedupes
 * every consumer (table cells, KPI tile, right-rail panel) onto the SAME
 * cache entry via {@link OBLIGATIONS_ROLLUP_QUERY_KEY}, so the page performs
 * exactly one network request regardless of how many cells mount.
 *
 * Everything date-sensitive on the obligation side uses the backend-computed
 * `days_until_due` (stable per payload — no client clock in the hot path);
 * only the auto-renew opt-out countdown derives from the client clock, the
 * same way the sibling `ContractRenewalCell` does.
 *
 * Pure helpers are exported for unit tests (`use-obligations-rollup.test.ts`).
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import type { LexContract, LexObligation } from '@/types/suites';

/** Shared query key — every consumer dedupes onto one fetch. */
export const OBLIGATIONS_ROLLUP_QUERY_KEY = ['lex-contracts', 'obligations-rollup'] as const;

/** Backend `suiteapi.ParsePagination` clamps `per_page` to 200. */
export const OBLIGATIONS_ROLLUP_PAGE_SIZE = 200;

/** "Due soon" KPI horizon in days. */
export const OBLIGATIONS_DUE_SOON_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Non-terminal obligation statuses. `completed`, `waived`, and `cancelled`
 * are terminal and never count toward open/overdue rollups.
 */
const OPEN_OBLIGATION_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'in_progress',
  'blocked',
]);

/* ------------------------------------------------------------------------- *
 * Pure classification helpers (exported for tests).
 * ------------------------------------------------------------------------- */

/** Whether the obligation is still actionable (non-terminal status). */
export function isOpenObligation(obligation: LexObligation): boolean {
  return OPEN_OBLIGATION_STATUSES.has(obligation.status);
}

/** Open AND past due, per the backend-computed `days_until_due`. */
export function isOverdueObligation(obligation: LexObligation): boolean {
  return isOpenObligation(obligation) && obligation.days_until_due < 0;
}

/** Open AND due within `horizonDays` (inclusive), not yet overdue. */
export function isDueSoonObligation(
  obligation: LexObligation,
  horizonDays: number = OBLIGATIONS_DUE_SOON_DAYS,
): boolean {
  return (
    isOpenObligation(obligation) &&
    obligation.days_until_due >= 0 &&
    obligation.days_until_due <= horizonDays
  );
}

/* ------------------------------------------------------------------------- *
 * Per-contract counts index (backs the table cell).
 * ------------------------------------------------------------------------- */

export interface ContractObligationCounts {
  /** Non-terminal obligations linked to the contract. */
  open: number;
  /** Open obligations past their due date. */
  overdue: number;
  /** Open obligations due within {@link OBLIGATIONS_DUE_SOON_DAYS}. */
  dueSoon: number;
}

export const EMPTY_OBLIGATION_COUNTS: ContractObligationCounts = Object.freeze({
  open: 0,
  overdue: 0,
  dueSoon: 0,
});

/**
 * Reference-keyed memo so the O(n) index is built once per fetched payload,
 * no matter how many table cells consume it in the same render pass.
 */
const countsIndexCache = new WeakMap<
  readonly LexObligation[],
  ReadonlyMap<string, ContractObligationCounts>
>();

/** Build (or reuse) the contract-id → counts index for a fetched payload. */
export function buildObligationCountsIndex(
  obligations: readonly LexObligation[],
): ReadonlyMap<string, ContractObligationCounts> {
  const cached = countsIndexCache.get(obligations);
  if (cached) return cached;

  const index = new Map<string, ContractObligationCounts>();
  for (const obligation of obligations) {
    if (!obligation.contract_id || !isOpenObligation(obligation)) continue;
    const current =
      index.get(obligation.contract_id) ?? { open: 0, overdue: 0, dueSoon: 0 };
    current.open += 1;
    if (isOverdueObligation(obligation)) current.overdue += 1;
    if (isDueSoonObligation(obligation)) current.dueSoon += 1;
    index.set(obligation.contract_id, current);
  }
  countsIndexCache.set(obligations, index);
  return index;
}

/* ------------------------------------------------------------------------- *
 * Auto-renew opt-out countdown (contract-side, clock-based).
 * ------------------------------------------------------------------------- */

export interface AutoRenewCountdown {
  contract: LexContract;
  /** Opt-out deadline: `expiry_date - renewal_notice_days` days. */
  deadline: Date;
  /** Whole days from `now` to the deadline; negative once the window closed. */
  daysLeft: number;
}

/**
 * Opt-out deadline for one auto-renewing contract, or `null` when the
 * contract does not auto-renew / has no parseable expiry date.
 */
export function computeOptOutDeadline(
  contract: LexContract,
  now: Date = new Date(),
): AutoRenewCountdown | null {
  if (!contract.auto_renew || !contract.expiry_date) return null;
  const expiry = new Date(contract.expiry_date);
  if (Number.isNaN(expiry.getTime())) return null;
  const noticeDays = Math.max(0, contract.renewal_notice_days ?? 0);
  const deadline = new Date(expiry.getTime() - noticeDays * MS_PER_DAY);
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY);
  return { contract, deadline, daysLeft };
}

/**
 * Opt-out countdowns for every auto-renewing contract in the (filtered) set,
 * soonest deadline first.
 */
export function computeAutoRenewCountdowns(
  contracts: readonly LexContract[],
  now: Date = new Date(),
): AutoRenewCountdown[] {
  const entries: AutoRenewCountdown[] = [];
  for (const contract of contracts) {
    const entry = computeOptOutDeadline(contract, now);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

/* ------------------------------------------------------------------------- *
 * Filtered-set rollup (backs the KPI tile + right-rail panel).
 * ------------------------------------------------------------------------- */

export interface UpcomingObligationEntry {
  obligation: LexObligation;
  /** The visible contract row the obligation belongs to. */
  contract: LexContract;
}

export interface ObligationExposure {
  /** Sum of `total_value` over exposed SAR-denominated contracts. */
  sarTotal: number;
  /** Distinct contracts contributing to `sarTotal`. */
  contractCount: number;
  /** Exposed contracts excluded from the SAR total (foreign currency). */
  nonSarCount: number;
}

export interface ObligationsRollup {
  /** contract-id → open/overdue/due-soon counts (whole fetched payload). */
  counts: ReadonlyMap<string, ContractObligationCounts>;
  /** Open obligations across the visible contract set. */
  openTotal: number;
  /** Open + due within {@link OBLIGATIONS_DUE_SOON_DAYS}, visible set. */
  dueSoon: number;
  /** Open + past due, visible set. */
  overdue: number;
  /** Open obligations for visible contracts, most-overdue → soonest-due. */
  upcoming: UpcomingObligationEntry[];
  /** SAR exposure across the distinct contracts behind `upcoming`. */
  exposure: ObligationExposure;
  /** Auto-renew opt-out countdowns for the visible set, soonest first. */
  autoRenew: AutoRenewCountdown[];
}

/**
 * Join one fetched obligations payload against the visible (filtered)
 * contract rows. Pure — exported for tests.
 */
export function rollupObligations(
  obligations: readonly LexObligation[],
  contracts: readonly LexContract[],
  now: Date = new Date(),
): ObligationsRollup {
  const counts = buildObligationCountsIndex(obligations);
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));

  let openTotal = 0;
  let dueSoon = 0;
  let overdue = 0;
  const upcoming: UpcomingObligationEntry[] = [];

  for (const obligation of obligations) {
    if (!obligation.contract_id || !isOpenObligation(obligation)) continue;
    const contract = contractsById.get(obligation.contract_id);
    if (!contract) continue;
    openTotal += 1;
    if (isOverdueObligation(obligation)) overdue += 1;
    if (isDueSoonObligation(obligation)) dueSoon += 1;
    upcoming.push({ obligation, contract });
  }

  // Most overdue first, then soonest due — triage order for the panel.
  upcoming.sort((a, b) => a.obligation.days_until_due - b.obligation.days_until_due);

  // SAR exposure over the DISTINCT contracts carrying open obligations.
  // Foreign-currency values are counted separately, never summed into SAR.
  const exposedIds = new Set<string>();
  const exposure: ObligationExposure = { sarTotal: 0, contractCount: 0, nonSarCount: 0 };
  for (const entry of upcoming) {
    const { contract } = entry;
    if (exposedIds.has(contract.id)) continue;
    exposedIds.add(contract.id);
    if (contract.total_value == null) continue;
    if ((contract.currency || 'SAR') === 'SAR') {
      exposure.sarTotal += contract.total_value;
      exposure.contractCount += 1;
    } else {
      exposure.nonSarCount += 1;
    }
  }

  return {
    counts,
    openTotal,
    dueSoon,
    overdue,
    upcoming,
    exposure,
    autoRenew: computeAutoRenewCountdowns(contracts, now),
  };
}

/* ------------------------------------------------------------------------- *
 * Hooks.
 * ------------------------------------------------------------------------- */

function useObligationsRollupQuery() {
  return useQuery({
    queryKey: OBLIGATIONS_ROLLUP_QUERY_KEY,
    queryFn: () =>
      enterpriseApi.lex.listObligations({
        page: 1,
        per_page: OBLIGATIONS_ROLLUP_PAGE_SIZE,
        sort: 'due_date',
        order: 'asc',
      }),
    staleTime: 60_000,
  });
}

export interface UseObligationsRollupResult extends ObligationsRollup {
  isLoading: boolean;
  isError: boolean;
  /** True when the tenant has more obligations than one clamped page. */
  truncated: boolean;
}

/**
 * Full rollup over the currently visible (filtered) contract rows.
 * One shared fetch; recomputed only when the payload or rows change.
 */
export function useObligationsRollup(
  contracts: readonly LexContract[],
): UseObligationsRollupResult {
  const query = useObligationsRollupQuery();
  const obligations = query.data?.data;
  const total = query.data?.meta?.total ?? 0;

  const rollup = useMemo(
    () => rollupObligations(obligations ?? [], contracts),
    [obligations, contracts],
  );

  return {
    ...rollup,
    isLoading: query.isLoading,
    isError: query.isError,
    truncated: total > (obligations?.length ?? 0),
  };
}

export interface UseContractObligationCountsResult {
  counts: ContractObligationCounts;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Lean per-row lookup for the table cell. Shares the SAME cached fetch as
 * {@link useObligationsRollup}; the counts index is reference-memoized so
 * mounting one cell per row stays O(n) overall.
 */
export function useContractObligationCounts(
  contractId: string,
): UseContractObligationCountsResult {
  const query = useObligationsRollupQuery();
  const obligations = query.data?.data;

  const counts = useMemo(() => {
    if (!obligations) return EMPTY_OBLIGATION_COUNTS;
    return buildObligationCountsIndex(obligations).get(contractId) ?? EMPTY_OBLIGATION_COUNTS;
  }, [obligations, contractId]);

  return { counts, isLoading: query.isLoading, isError: query.isError };
}
