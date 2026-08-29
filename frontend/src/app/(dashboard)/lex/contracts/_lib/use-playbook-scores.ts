/**
 * Playbook compliance scores for the contracts list (`/lex/contracts`) —
 * feature #4 "Playbook score column".
 *
 * One shared react-query fetch of the playbook portfolio
 * (`enterpriseApi.lex.getPlaybookPortfolio()` → WTQ-RSK-02 #2) joined to the
 * contract rows by `contract_id`. The portfolio endpoint only returns contracts
 * with a MATCHED active playbook, so a missing join entry is the semantic
 * "off-playbook" state — the column renders it neutrally, it never means an
 * error.
 *
 * This module is the PURE/data half of the feature (hook + threshold logic +
 * the bulk deviation-export helper). The presentational cell, the quick-filter
 * chip, and the toast-wired bulk action live in
 * `../_components/contract-playbook-cell.tsx`.
 *
 * Backend contract notes:
 *   - `compliance_score` is 0..100 (risk-weighted share of standard clauses;
 *     see backend `model.PlaybookComplianceRow`).
 *   - The endpoint clamps `per_page` to 100 and the live aggregate scans at
 *     most `service.PortfolioMaxScan` (200) contracts, flagging `truncated`.
 *     The query therefore pulls up to two pages inside ONE react-query entry
 *     and surfaces a combined `truncated` flag for the integrator to warn on.
 */

'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import { downloadBlob } from '@/lib/format';
import type { LexPlaybookPortfolioRow } from '@/types/suites';

/* ------------------------------------------------------------------------- *
 * Thresholds + tone classification (pure, unit-tested).
 * ------------------------------------------------------------------------- */

/** Scores at or above this are compliant ("ok" tone). Also the default quick-filter threshold. */
export const PLAYBOOK_OK_THRESHOLD = 90;

/** Scores at or above this (but below {@link PLAYBOOK_OK_THRESHOLD}) are "warn"; below is "danger". */
export const PLAYBOOK_WARN_THRESHOLD = 70;

/**
 * Visual tone of a compliance score:
 *   - `ok`     — score ≥ 90.
 *   - `warn`   — 70 ≤ score < 90.
 *   - `danger` — score < 70.
 *   - `none`   — no matched playbook (null/undefined/non-finite): off-playbook.
 */
export type PlaybookComplianceTone = 'ok' | 'warn' | 'danger' | 'none';

/**
 * Clamp + round a raw backend compliance score onto the displayed 0–100
 * integer scale. Returns `null` for unset/non-finite values so callers can
 * render the off-playbook affordance (mirrors `formatRiskScore` in
 * `contract-risk-cell.tsx`).
 */
export function normalizeComplianceScore(score?: number | null): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Classify a compliance score into its {@link PlaybookComplianceTone}. */
export function playbookComplianceTone(score?: number | null): PlaybookComplianceTone {
  const normalized = normalizeComplianceScore(score);
  if (normalized === null) return 'none';
  if (normalized >= PLAYBOOK_OK_THRESHOLD) return 'ok';
  if (normalized >= PLAYBOOK_WARN_THRESHOLD) return 'warn';
  return 'danger';
}

/**
 * Quick-filter predicate: `true` when the contract HAS a playbook score and it
 * sits strictly below `threshold`. Off-playbook contracts are NOT below
 * threshold (they have nothing to comply with), so the quick filter never
 * sweeps them in.
 */
export function isBelowPlaybookThreshold(
  score?: number | null,
  threshold: number = PLAYBOOK_OK_THRESHOLD,
): boolean {
  const normalized = normalizeComplianceScore(score);
  return normalized !== null && normalized < threshold;
}

/**
 * Below-threshold quick-filter helper: narrow a loaded page of contracts to
 * those whose joined compliance score is below `threshold`. The playbook score
 * is a CLIENT-side join (the contracts endpoint knows nothing about it), so
 * this filters the rows the table has already loaded — the integrator swaps it
 * in for `tableProps.data` while the chip is active.
 */
export function filterBelowPlaybookThreshold<T extends { id: string }>(
  rows: T[],
  scoresById: ReadonlyMap<string, LexPlaybookPortfolioRow>,
  threshold: number = PLAYBOOK_OK_THRESHOLD,
): T[] {
  return rows.filter((row) =>
    isBelowPlaybookThreshold(scoresById.get(row.id)?.compliance_score, threshold),
  );
}

/* ------------------------------------------------------------------------- *
 * Portfolio fetch (one react-query entry shared by every cell + the chip).
 * ------------------------------------------------------------------------- */

/** Query key for the shared portfolio fetch (exported for tests/invalidation). */
export const LEX_PLAYBOOK_PORTFOLIO_QUERY_KEY = ['lex-playbook-portfolio'] as const;

/** Server-clamped page size (backend caps `per_page` at 100). */
const PORTFOLIO_PAGE_SIZE = 100;

/** Server scan cap is `PortfolioMaxScan = 200`, i.e. at most two pages. */
const PORTFOLIO_MAX_PAGES = 2;

interface PortfolioSnapshot {
  rows: LexPlaybookPortfolioRow[];
  truncated: boolean;
}

/**
 * Pull the full (scan-capped) portfolio inside a single query function so the
 * whole list surface shares ONE cache entry regardless of how many cells
 * render. Combined `truncated` covers both the server scan cap and any rows
 * beyond the page budget.
 */
async function fetchPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const first = await enterpriseApi.lex.getPlaybookPortfolio({
    page: 1,
    per_page: PORTFOLIO_PAGE_SIZE,
  });
  const rows = [...first.data];
  let truncated = first.truncated;
  const perPage = first.per_page > 0 ? first.per_page : PORTFOLIO_PAGE_SIZE;
  const totalPages = Math.ceil(first.total / perPage);
  for (let page = 2; page <= totalPages && page <= PORTFOLIO_MAX_PAGES; page += 1) {
    const next = await enterpriseApi.lex.getPlaybookPortfolio({
      page,
      per_page: PORTFOLIO_PAGE_SIZE,
    });
    rows.push(...next.data);
    truncated = truncated || next.truncated;
  }
  if (rows.length < first.total) {
    truncated = true;
  }
  return { rows, truncated };
}

export interface UsePlaybookScoresResult {
  /** Portfolio rows keyed by `contract_id` (absent key = off-playbook). */
  scoresById: ReadonlyMap<string, LexPlaybookPortfolioRow>;
  /** Raw compliance score for a contract, or `null` when off-playbook. */
  getScore: (contractId: string) => number | null;
  /** Full portfolio row for a contract (playbook name, deviation counts…). */
  getRow: (contractId: string) => LexPlaybookPortfolioRow | undefined;
  /** Initial fetch in flight — cells render a skeleton, not "off-playbook". */
  isLoading: boolean;
  /** Fetch failed — cells degrade to the neutral state (no error per row). */
  isError: boolean;
  /** Server capped the candidate scan; scores may be missing for some rows. */
  truncated: boolean;
}

/**
 * Shared portfolio-score lookup for the contracts list. Fetched once per mount
 * cycle (60s staleTime) and joined by `contract_id`; every consumer of the same
 * query key deduplicates onto this single request.
 */
export function usePlaybookScores(): UsePlaybookScoresResult {
  const query = useQuery({
    queryKey: LEX_PLAYBOOK_PORTFOLIO_QUERY_KEY,
    queryFn: fetchPortfolioSnapshot,
    staleTime: 60_000,
  });

  const scoresById = useMemo(() => {
    const map = new Map<string, LexPlaybookPortfolioRow>();
    for (const row of query.data?.rows ?? []) {
      map.set(row.contract_id, row);
    }
    return map as ReadonlyMap<string, LexPlaybookPortfolioRow>;
  }, [query.data]);

  const getRow = useCallback(
    (contractId: string) => scoresById.get(contractId),
    [scoresById],
  );

  const getScore = useCallback(
    (contractId: string) => scoresById.get(contractId)?.compliance_score ?? null,
    [scoresById],
  );

  return {
    scoresById,
    getScore,
    getRow,
    isLoading: query.isLoading,
    isError: query.isError,
    truncated: query.data?.truncated ?? false,
  };
}

/* ------------------------------------------------------------------------- *
 * Bulk "Export deviations" helper.
 * ------------------------------------------------------------------------- */

export interface DeviationExportSummary {
  /** CSV reports successfully downloaded. */
  exported: number;
  /** Selected contracts skipped because they have no matched playbook. */
  skippedOffPlaybook: number;
  /** Contracts whose export request failed (network / server error). */
  failed: number;
}

/**
 * Export the clause-deviation CSV report for every selected contract that has
 * a matched playbook, via the existing per-contract export endpoint
 * (`GET /contracts/{id}/clause-deviations/export`, read tier — no mutation).
 * Off-playbook selections are skipped (there is no playbook to deviate from),
 * and per-contract failures are counted rather than aborting the batch.
 * Requests run sequentially to stay polite to the gateway on large selections.
 */
export async function exportDeviationsForContracts(
  contractIds: string[],
  scoresById: ReadonlyMap<string, LexPlaybookPortfolioRow>,
): Promise<DeviationExportSummary> {
  const summary: DeviationExportSummary = {
    exported: 0,
    skippedOffPlaybook: 0,
    failed: 0,
  };
  for (const contractId of contractIds) {
    const row = scoresById.get(contractId);
    if (!row) {
      summary.skippedOffPlaybook += 1;
      continue;
    }
    try {
      const blob = await enterpriseApi.lex.exportContractClauseDeviations(contractId);
      downloadBlob(blob, `clause-deviations-${contractId}.csv`);
      summary.exported += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
