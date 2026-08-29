/**
 * Shared compliance-score thresholds for the Watheeq (Lex) suite.
 *
 * Single source of truth for the score bands used by BOTH the command-center
 * hero posture panel (`_components/command-hero.tsx`) and the compliance page's
 * score gauge (`compliance/_components/compliance-charts.tsx`), so the two
 * surfaces can never disagree about what "healthy" means.
 *
 * Band semantics (matching the shared gauge primitives, which color the arc
 * with `pct >= good → success`, `pct >= warning → warning`, else error):
 *
 *   - Healthy:  score >= good  (>= 90%)
 *   - Watch:    warning <= score < good  (75-89%)
 *   - At risk:  score < warning  (< 75%)
 */

/** Percentage thresholds (of 100) for the compliance-score tone bands. */
export const COMPLIANCE_SCORE_THRESHOLDS = { good: 90, warning: 75 } as const;

/** The portfolio compliance-score target, in percent. */
export const COMPLIANCE_SCORE_TARGET = 90;
