/**
 * Stat-tile derivation for the Lex matters list (`/lex/matters`).
 *
 * PURE, locale-agnostic module (no JSX, no hooks): it owns the *mapping* from a
 * matter report into the small numeric tile set the list-page KPI header renders.
 *
 * There is NO dedicated matter-stats endpoint on `enterpriseApi.lex` — the
 * per-status / per-type / per-priority counts come from `getMatterReport`, whose
 * server-side `by_status` map is keyed by the {@link LexMatterStatus} enum values.
 * We read those keys here so a single source of truth (the report) drives both the
 * table and the KPI tiles.
 *
 * `atRisk` is the one tile the report cannot supply: SLA risk is a client-derived
 * notion (see `_lib/matter-sla.tsx#isMatterAtRisk`) computed over the loaded rows,
 * so the integrator passes the pre-computed count in.
 */

import type { LexMatterReport, LexMatterStatus } from '@/types/suites';

/**
 * The numeric tile set rendered in the matters list KPI header. Every value is a
 * non-negative integer; missing report buckets collapse to `0`.
 */
export interface MatterStatTiles {
  /** Total matters matching the active report filters (`report.total`). */
  total: number;
  /** Matters in the `open` status bucket. */
  open: number;
  /** Matters in the `in_review` status bucket. */
  inReview: number;
  /** Matters in the `closed` status bucket. */
  closed: number;
  /** Client-derived count of SLA at-risk matters (passed in by the integrator). */
  atRisk: number;
}

// Status bucket keys mirror the `LexMatterStatus` enum values used as
// `report.by_status` keys server-side. Pinned to the enum so a rename surfaces
// as a type error rather than a silently-zero tile.
const STATUS_OPEN: LexMatterStatus = 'open';
const STATUS_IN_REVIEW: LexMatterStatus = 'in_review';
const STATUS_CLOSED: LexMatterStatus = 'closed';

/**
 * Derive the KPI tile counts for the matters list from a (possibly undefined)
 * matter report plus the client-computed SLA at-risk count.
 *
 * @param report      Result of `enterpriseApi.lex.getMatterReport(params)`, or
 *                    `undefined` while loading / on error — every tile is `0`.
 * @param atRiskCount Client-derived SLA at-risk total (see `matter-sla.tsx`).
 */
export function deriveMatterStatTiles(
  report: LexMatterReport | undefined,
  atRiskCount: number,
): MatterStatTiles {
  const byStatus = report?.by_status;
  return {
    total: report?.total ?? 0,
    open: byStatus?.[STATUS_OPEN] ?? 0,
    inReview: byStatus?.[STATUS_IN_REVIEW] ?? 0,
    closed: byStatus?.[STATUS_CLOSED] ?? 0,
    atRisk: atRiskCount,
  };
}
