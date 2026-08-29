/**
 * Pure derivation helpers for the contracts ANALYTICS view
 * (`_components/contracts-analytics-view.tsx`).
 *
 * Everything here is a pure function over the upgraded
 * `GET /reports/contracts-analytics` payload (`LexContractAnalyticsReport` v2
 * fields) plus the page's `activeFilters`, so the chart components stay thin
 * and the aggregation logic is unit-testable without a DOM (see
 * `contracts-analytics.test.ts`).
 *
 * No hooks, no `Date.now()`, no locale access — label resolution and number
 * formatting stay in the components (via `useLexFormat`), these helpers only
 * shape data.
 */

import type {
  LexExpiryCliffPoint,
  LexReportQuery,
  LexValueBucket,
} from '@/lib/lex/reports';

/**
 * Sentinel row key for the folded long-tail bucket produced by
 * {@link deriveSpendRows}. Components map it to a localized "Other" label.
 */
export const SPEND_OTHER_KEY = '__other__';

/** Canonical risk-level ordering (most→least severe) for the risk donut. */
export const RISK_LEVEL_ORDER = ['critical', 'high', 'medium', 'low', 'none'] as const;

/**
 * The page filter keys the analytics endpoint understands. Everything else in
 * `activeFilters` (risk_level, tag, owner_user_id, expiry window, search, …)
 * cannot scope the server-side rollup and is surfaced to the user as
 * "not applied" instead of being silently dropped.
 */
const ANALYTICS_FILTER_KEYS = ['department', 'status', 'type'] as const;
type AnalyticsFilterKey = (typeof ANALYTICS_FILTER_KEYS)[number];

function isAnalyticsFilterKey(key: string): key is AnalyticsFilterKey {
  return (ANALYTICS_FILTER_KEYS as readonly string[]).includes(key);
}

/** Result of mapping the list page's filter state onto the analytics query. */
export interface ContractAnalyticsScope {
  /** Query for `lexReportsApi.getContractAnalytics` (department/status/type). */
  query: LexReportQuery;
  /**
   * Active filter keys that could NOT be applied to the analytics rollup
   * (sorted for a stable identity). Non-empty means the charts are scoped more
   * broadly than the table.
   */
  unsupportedKeys: string[];
}

/**
 * Map the list page's `activeFilters` (from `useDataTable`) onto the analytics
 * report query. Only single-valued department/status/type filters translate;
 * multi-valued or unknown keys are reported back via `unsupportedKeys`.
 */
export function toContractAnalyticsScope(
  activeFilters: Record<string, string | string[]>,
): ContractAnalyticsScope {
  const query: LexReportQuery = {};
  const unsupported: string[] = [];

  for (const [key, raw] of Object.entries(activeFilters)) {
    const values = Array.isArray(raw) ? raw : [raw];
    const nonEmpty = values.filter((v) => typeof v === 'string' && v !== '');
    if (nonEmpty.length === 0) continue;
    // The endpoint takes exactly one value per dimension; a multi-select can't
    // be expressed, so it degrades to "not applied" rather than a silent pick.
    if (isAnalyticsFilterKey(key) && nonEmpty.length === 1) {
      query[key] = nonEmpty[0];
    } else {
      unsupported.push(key);
    }
  }

  unsupported.sort();
  return { query, unsupportedKeys: unsupported };
}

/** One chart row of a spend rollup (value bar + count carried for tooltips). */
export interface SpendRow {
  /** Raw backend key ('' for unattributed), or {@link SPEND_OTHER_KEY}. */
  key: string;
  count: number;
  value: number;
}

/**
 * Shape a spend rollup (`spend_by_type` / `spend_by_department`) into chart
 * rows: sorted by value descending, with anything beyond `maxRows - 1` folded
 * into a single {@link SPEND_OTHER_KEY} tail row so the bar chart stays legible
 * (a 9th series is never a new hue — it folds into "Other").
 */
export function deriveSpendRows(
  buckets: LexValueBucket[] | null | undefined,
  maxRows = 8,
): SpendRow[] {
  if (!buckets || buckets.length === 0 || maxRows < 1) return [];

  const sorted = buckets
    .map((b) => ({ key: b.key, count: b.count, value: b.total_value }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.key.localeCompare(b.key));

  if (sorted.length <= maxRows) return sorted;

  const head = sorted.slice(0, maxRows - 1);
  const tail = sorted.slice(maxRows - 1);
  head.push({
    key: SPEND_OTHER_KEY,
    count: tail.reduce((sum, row) => sum + row.count, 0),
    value: tail.reduce((sum, row) => sum + row.value, 0),
  });
  return head;
}

/** Headline totals over the leading months of the expiry cliff. */
export interface ExpiryCliffSummary {
  /** Months actually summed (min(horizon, series length)). */
  months: number;
  count: number;
  value: number;
}

/**
 * Sum the first `horizonMonths` months of the (dense, chronologically sorted)
 * expiry-cliff series into a headline "next N months" figure.
 */
export function summarizeExpiryCliff(
  points: LexExpiryCliffPoint[] | null | undefined,
  horizonMonths = 12,
): ExpiryCliffSummary {
  const window = (points ?? []).slice(0, Math.max(0, horizonMonths));
  return {
    months: window.length,
    count: window.reduce((sum, p) => sum + p.count, 0),
    value: window.reduce((sum, p) => sum + p.value, 0),
  };
}

/** One ordered slice of the risk-distribution donut. */
export interface RiskSlice {
  /** Normalized risk-level key (e.g. 'critical', 'high', … or a backend extra). */
  key: string;
  count: number;
}

/**
 * Order a `by_risk_level` map (from `GET /contracts/stats`) into donut slices:
 * canonical severity order first, any unknown backend keys appended
 * alphabetically, zero-count levels dropped (an empty slice is legend noise).
 */
export function deriveRiskSlices(
  byRiskLevel: Record<string, number> | null | undefined,
): RiskSlice[] {
  if (!byRiskLevel) return [];
  const known = new Set<string>(RISK_LEVEL_ORDER);
  const slices: RiskSlice[] = [];

  for (const key of RISK_LEVEL_ORDER) {
    const count = byRiskLevel[key];
    if (typeof count === 'number' && count > 0) slices.push({ key, count });
  }
  const extras = Object.keys(byRiskLevel)
    .filter((key) => !known.has(key) && byRiskLevel[key] > 0)
    .sort();
  for (const key of extras) slices.push({ key, count: byRiskLevel[key] });

  return slices;
}

/** One currency line of the multi-currency total-value split. */
export interface CurrencyTotal {
  currency: string;
  value: number;
}

/**
 * Order the `total_value_by_currency` split for display: SAR first (Watheeq is
 * SAR-first), then by value descending, capped at `limit` lines.
 */
export function deriveCurrencyTotals(
  byCurrency: Record<string, number> | null | undefined,
  limit = 3,
): CurrencyTotal[] {
  if (!byCurrency) return [];
  return Object.entries(byCurrency)
    .filter(([, value]) => typeof value === 'number' && value !== 0)
    .map(([currency, value]) => ({ currency, value }))
    .sort((a, b) => {
      if (a.currency === 'SAR' && b.currency !== 'SAR') return -1;
      if (b.currency === 'SAR' && a.currency !== 'SAR') return 1;
      return b.value - a.value;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Parse an expiry-cliff "YYYY-MM" month token into a Date pinned to the 1st at
 * local midnight (safe for `Intl` month/year formatting). Returns null for
 * malformed tokens so callers can fall back to the raw string.
 */
export function parseCliffMonth(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return new Date(year, monthIndex, 1);
}
