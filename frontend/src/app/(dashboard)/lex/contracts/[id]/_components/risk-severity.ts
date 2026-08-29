import type { Severity } from '@/components/shared/severity-indicator';

/**
 * Map a Lex risk level / severity string onto a SeverityIndicator `Severity`.
 *
 * Mirrors the page-local `normalizeRiskSeverity` helper so the new risk
 * components stay decoupled from the page module while rendering identical
 * severity treatments. `none` and unknown values fall back to `info`.
 */
export function toIndicatorSeverity(value: string | null | undefined): Severity {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}
