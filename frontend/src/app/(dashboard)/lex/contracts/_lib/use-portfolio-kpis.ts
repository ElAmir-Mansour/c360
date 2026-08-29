/**
 * Money-KPI data layer for the contracts list workspace (`/lex/contracts`).
 *
 * Feeds the {@link ../\_components/contract-money-kpis!ContractMoneyKpis} strip
 * with four portfolio-value figures:
 *
 *   1. Active portfolio value — EXACT, straight from the dashboard aggregate
 *      (`enterpriseApi.lex.getDashboard()` → `total_contract_value.by_currency`,
 *      which the backend computes as SUM(total_value) over ACTIVE contracts
 *      grouped by currency).
 *   2. Value expiring within 30 days,
 *   3. Value expiring within 60 days — the dashboard's expiring summaries carry
 *      no monetary fields, so these mirror the dashboard's expiring semantics
 *      (`status = active AND expiry_date <= today + N`) via the contracts list
 *      endpoint (`status=active&expiring_in_days=N`) and sum `total_value`
 *      per currency client-side.
 *   4. Value pending signature — same list endpoint with
 *      `status=pending_signature` (the contract FSM's own pending-signature
 *      state; the `/signatures/summary` envelope rollup is per-contract and
 *      carries no values).
 *
 * Sampling honesty: the list endpoint caps `per_page` at 200 (backend
 * `suiteapi.maxPageSize`), so buckets 2–4 sort by `total_value desc` and sum
 * the top {@link MONEY_KPI_SAMPLE_SIZE} rows. When a tenant has more matching
 * rows than the window, the bucket is flagged `partial` (the UI renders the
 * figure as a lower bound, "≥"). Amounts are summed PER CURRENCY — different
 * currencies are never added together; SAR is the primary display currency and
 * everything else surfaces as a sub-line.
 *
 * Pure helpers (`sumByCurrency`, `splitPrimary`, `deriveMoneyBucket`) are
 * exported for unit tests.
 */
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import type { PaginatedResponse } from '@/types/api';
import type { LexContractRecord } from '@/types/suites';

/** The primary display currency for the strip (SAR-first per KSA layer). */
export const PRIMARY_CURRENCY = 'SAR';

/**
 * Rows fetched per money bucket — the backend list cap (`maxPageSize = 200`).
 * Buckets sort `total_value desc` so a truncated window still captures the
 * largest amounts, keeping the "≥" lower bound tight.
 */
export const MONEY_KPI_SAMPLE_SIZE = 200;

/** Per-currency monetary sums keyed by upper-cased ISO 4217 code. */
export type CurrencyTotals = Record<string, number>;

/** A per-currency total split into the SAR figure + everything else. */
export interface MoneySplit {
  /** Total in {@link PRIMARY_CURRENCY}. Zero when no SAR-denominated value. */
  primary: number;
  /** Non-SAR currency totals, largest first. */
  others: Array<{ currency: string; amount: number }>;
}

/** One list-derived money bucket (expiring 30/60d, pending signature). */
export interface MoneyBucket extends MoneySplit {
  /** Rows actually summed (the sampling window). */
  sampled: number;
  /** Tenant-wide row count for the bucket filter (list `meta.total`). */
  totalContracts: number;
  /** True when `totalContracts` exceeded the sampling window. */
  partial: boolean;
  isLoading: boolean;
  isError: boolean;
}

/** The dashboard-exact active portfolio figure. */
export interface PortfolioValue extends MoneySplit {
  /** Count of active contracts (dashboard `kpis.active_contracts`). */
  activeContracts: number;
  isLoading: boolean;
  isError: boolean;
}

export interface PortfolioKpis {
  portfolio: PortfolioValue;
  expiring30: MoneyBucket;
  expiring60: MoneyBucket;
  pendingSignature: MoneyBucket;
}

/**
 * Sum contract values per currency. Null/non-finite/zero values are skipped;
 * currency codes are trimmed + upper-cased, with blank codes attributed to
 * {@link PRIMARY_CURRENCY} (the backend defaults contracts to SAR).
 */
export function sumByCurrency(
  rows: ReadonlyArray<Pick<LexContractRecord, 'total_value' | 'currency'>>,
): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const row of rows) {
    const amount =
      typeof row.total_value === 'number' ? row.total_value : Number(row.total_value ?? Number.NaN);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const currency = (row.currency ?? '').trim().toUpperCase() || PRIMARY_CURRENCY;
    totals[currency] = (totals[currency] ?? 0) + amount;
  }
  return totals;
}

/**
 * Split per-currency totals into the primary (SAR) figure and a largest-first
 * list of other currencies. Zero/non-finite entries are dropped so an all-SAR
 * portfolio renders no sub-line.
 */
export function splitPrimary(
  totals: CurrencyTotals,
  primary: string = PRIMARY_CURRENCY,
): MoneySplit {
  let primaryAmount = 0;
  const others: Array<{ currency: string; amount: number }> = [];
  for (const [rawCurrency, amount] of Object.entries(totals)) {
    if (!Number.isFinite(amount) || amount === 0) continue;
    const currency = rawCurrency.trim().toUpperCase() || primary;
    if (currency === primary) {
      primaryAmount += amount;
    } else {
      others.push({ currency, amount });
    }
  }
  others.sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
  return { primary: primaryAmount, others };
}

/**
 * Derive the displayable bucket figures from one contracts-list page. Pure —
 * the hook layers the query loading/error flags on top.
 */
export function deriveMoneyBucket(
  page: PaginatedResponse<LexContractRecord> | undefined,
): Omit<MoneyBucket, 'isLoading' | 'isError'> {
  const rows = page?.data ?? [];
  const totalContracts = page?.meta?.total ?? rows.length;
  return {
    ...splitPrimary(sumByCurrency(rows)),
    sampled: rows.length,
    totalContracts,
    partial: totalContracts > rows.length,
  };
}

/** Shared react-query staleness for the strip (matches the page's stats tiles). */
const MONEY_KPI_STALE_TIME = 60_000;

function fetchMoneyBucket(
  filters: Record<string, string>,
): Promise<PaginatedResponse<LexContractRecord>> {
  return enterpriseApi.lex.listContracts({
    page: 1,
    per_page: MONEY_KPI_SAMPLE_SIZE,
    sort: 'total_value',
    order: 'desc',
    filters,
  });
}

/**
 * Hook backing the contracts money-KPI strip. One dashboard query (exact
 * portfolio value) + three top-value list samples (expiring 30d / 60d and
 * pending signature), each independently loading/erroring so one failed tile
 * never blanks the strip.
 */
export function usePortfolioKpis(): PortfolioKpis {
  const dashboardQuery = useQuery({
    queryKey: ['lex-contracts', 'dashboard'],
    queryFn: () => enterpriseApi.lex.getDashboard(),
    staleTime: MONEY_KPI_STALE_TIME,
  });

  const expiring30Query = useQuery({
    queryKey: ['lex-contracts', 'money-kpis', 'expiring', 30],
    queryFn: () => fetchMoneyBucket({ status: 'active', expiring_in_days: '30' }),
    staleTime: MONEY_KPI_STALE_TIME,
  });

  const expiring60Query = useQuery({
    queryKey: ['lex-contracts', 'money-kpis', 'expiring', 60],
    queryFn: () => fetchMoneyBucket({ status: 'active', expiring_in_days: '60' }),
    staleTime: MONEY_KPI_STALE_TIME,
  });

  const pendingSignatureQuery = useQuery({
    queryKey: ['lex-contracts', 'money-kpis', 'pending-signature'],
    queryFn: () => fetchMoneyBucket({ status: 'pending_signature' }),
    staleTime: MONEY_KPI_STALE_TIME,
  });

  const dashboard = dashboardQuery.data;

  return useMemo<PortfolioKpis>(
    () => ({
      portfolio: {
        ...splitPrimary(dashboard?.total_contract_value?.by_currency ?? {}),
        activeContracts: dashboard?.kpis?.active_contracts ?? 0,
        isLoading: dashboardQuery.isLoading,
        isError: dashboardQuery.isError,
      },
      expiring30: {
        ...deriveMoneyBucket(expiring30Query.data),
        isLoading: expiring30Query.isLoading,
        isError: expiring30Query.isError,
      },
      expiring60: {
        ...deriveMoneyBucket(expiring60Query.data),
        isLoading: expiring60Query.isLoading,
        isError: expiring60Query.isError,
      },
      pendingSignature: {
        ...deriveMoneyBucket(pendingSignatureQuery.data),
        isLoading: pendingSignatureQuery.isLoading,
        isError: pendingSignatureQuery.isError,
      },
    }),
    [
      dashboard,
      dashboardQuery.isLoading,
      dashboardQuery.isError,
      expiring30Query.data,
      expiring30Query.isLoading,
      expiring30Query.isError,
      expiring60Query.data,
      expiring60Query.isLoading,
      expiring60Query.isError,
      pendingSignatureQuery.data,
      pendingSignatureQuery.isLoading,
      pendingSignatureQuery.isError,
    ],
  );
}
