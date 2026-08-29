/**
 * Chart palette for the contracts ANALYTICS view
 * (`contracts-analytics-view.tsx` + its chart subcomponents).
 *
 * One consistent categorical assignment across the four charts, bound to the
 * design-system tokens via `@/lib/design-tokens` (`hsl(var(--chart-N))` /
 * `hsl(var(--severity-*))`) so every color re-themes automatically in dark
 * mode — the same source the shared chart wrappers and the Legal-Affairs
 * report charts draw from.
 *
 * Assignment is FIXED (color follows the measure, never a rank):
 *   - spend by type       -> chart-1 (brand teal)
 *   - spend by department -> chart-5 (blue)
 *   - expiry cliff        -> chart-3 (amber — a risk-adjacent surface)
 *   - risk distribution   -> the reserved severity palette (never reused as a
 *     categorical series), with a muted ink for the "none" bucket.
 *
 * Each bar chart is single-hue (magnitude job), so identity is carried by the
 * category axis labels — never by color alone.
 *
 * Pure constants / pure functions only (no hooks, no Date.now), safe inside
 * `useMemo` and `React.memo` children.
 */

import { chartVar, severityVar, type SeverityLevel } from '@/lib/design-tokens';

/** Spend-by-type bars — brand teal (`--chart-1`). */
export const SPEND_BY_TYPE_COLOR = chartVar(0);

/** Spend-by-department bars — blue (`--chart-5`). */
export const SPEND_BY_DEPARTMENT_COLOR = chartVar(4);

/** Expiry-cliff bars — amber (`--chart-3`), fitting a renewal-risk surface. */
export const EXPIRY_CLIFF_COLOR = chartVar(2);

/** Severity tokens for the known risk-level slice keys. */
const RISK_SEVERITY: Record<string, SeverityLevel> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/**
 * Color for one risk-distribution donut slice. Known severities ride the
 * reserved severity ramp; the "none" bucket (and any unknown backend extra)
 * renders in muted ink so it never competes with a real severity.
 */
export function riskSliceColor(key: string): string {
  const severity = RISK_SEVERITY[key];
  if (severity) return severityVar(severity);
  return 'hsl(var(--muted-foreground))';
}
