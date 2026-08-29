/**
 * Shared SERIES PALETTE for the Legal-Affairs analytics chart suite.
 *
 * Every analytics chart (standard recharts wrappers AND the hand-rolled custom
 * SVG/CSS charts) pulls its colors from here so the 10-chart dashboard reads as
 * one consistent visual system. The palette is bound to the design-system HSL
 * tokens materialized in `globals.css` (`--chart-1..6`, `--severity-*`,
 * `--status-*`, `--ds-*`) so it re-themes automatically in dark mode.
 *
 * IMPORTANT — two color "flavors" are exported because there are two render
 * contexts:
 *
 *   1. `var()` strings (`hsl(var(--chart-1))`) — usable in inline `style`,
 *      CSS backgrounds, and recharts `fill`/`stroke` props (recharts forwards
 *      them straight to SVG attributes, and `hsl(var(--x))` DOES resolve there
 *      because recharts emits them as `style`/presentation attrs that the
 *      browser evaluates against the cascade). These re-theme in dark mode.
 *
 * All exports are PURE constants / pure functions (no Date.now / Math.random /
 * hooks) so callers can freely `useMemo` over them and charts stay
 * `React.memo`-friendly.
 */

/* ------------------------------------------------------------------ *
 * Categorical series ramp (brand-led, colorblind-aware ordering).
 * Mirrors design-tokens CHART_COLORS but as token refs (dark-mode safe).
 * ------------------------------------------------------------------ */

/** Six-stop categorical ramp as `var()` refs (re-theme in dark mode). */
export const SERIES_VARS: readonly string[] = [
  'hsl(var(--chart-1))', // brand blue
  'hsl(var(--chart-2))', // cyan
  'hsl(var(--chart-3))', // gold
  'hsl(var(--chart-4))', // violet
  'hsl(var(--chart-5))', // orange
  'hsl(var(--chart-6))', // teal
] as const;

/**
 * `seriesVar(i)` — categorical color for the i-th series, wrapping the 6-stop
 * ramp. Pure; safe in render and `useMemo`.
 */
export function seriesVar(index: number): string {
  const ramp = SERIES_VARS;
  return ramp[((index % ramp.length) + ramp.length) % ramp.length];
}

/* ------------------------------------------------------------------ *
 * Semantic accents — used by gauges, deltas, SLA pass/fail, funnels.
 * ------------------------------------------------------------------ */

/** Named semantic tones bound to design-system status/severity tokens. */
export const TONE = {
  /** Positive / on-target / closed / approved. */
  positive: 'hsl(var(--status-success))',
  /** Caution / pending / under-procedure. */
  warning: 'hsl(var(--status-warning))',
  /** Negative / breached / overdue. */
  negative: 'hsl(var(--status-error))',
  /** Informational / neutral series. */
  info: 'hsl(var(--status-info))',
  /** Muted / inactive / baseline. */
  muted: 'hsl(var(--ds-text-muted))',
  /** Brand primary accent. */
  brand: 'hsl(var(--chart-1))',
} as const;

export type ToneName = keyof typeof TONE;

/** Severity ramp (low → critical) for heat scales (heatmap / treemap depth). */
export const SEVERITY_RAMP: readonly string[] = [
  'hsl(var(--severity-low))',
  'hsl(var(--severity-medium))',
  'hsl(var(--severity-high))',
  'hsl(var(--severity-critical))',
] as const;

/**
 * `heatVar(value, max)` — map a count onto the 4-stop severity ramp for the
 * department×domain heatmap (and any other intensity surface). Pure; returns a
 * muted surface token for the zero/empty cell. Mirrors the cyber MITRE heatmap
 * heat ramp so the two heatmaps read consistently.
 */
export function heatVar(value: number, max: number): string {
  if (value <= 0 || max <= 0) return 'hsl(var(--muted))';
  const intensity = Math.min(value / max, 1);
  if (intensity < 0.25) return SEVERITY_RAMP[0];
  if (intensity < 0.5) return SEVERITY_RAMP[1];
  if (intensity < 0.75) return SEVERITY_RAMP[2];
  return SEVERITY_RAMP[3];
}

/* ------------------------------------------------------------------ *
 * Legal-status → tone maps. Lowercased status keys from the by_X buckets
 * are resolved to a stable color so the SAME status is the SAME color across
 * the donut, the funnel, the stacked bars, and the legends.
 * ------------------------------------------------------------------ */

/**
 * Canonical status → tone-name map for legal CASE / CONTRACT / CONSULTATION /
 * REQUEST statuses. Keys are normalized (lowercase, spaces/hyphens → `_`).
 * Anything unknown falls through to `info`.
 */
const STATUS_TONE: Record<string, ToneName> = {
  // closed / resolved / approved / active → positive
  closed: 'positive',
  resolved: 'positive',
  approved: 'positive',
  active: 'positive',
  signed: 'positive',
  completed: 'positive',
  won: 'positive',
  answered: 'positive',
  // in-flight / review / negotiation / pending → warning
  open: 'warning',
  pending: 'warning',
  pending_signature: 'warning',
  under_procedure: 'warning',
  under_review: 'warning',
  internal_review: 'warning',
  legal_review: 'warning',
  in_review: 'warning',
  negotiation: 'warning',
  in_progress: 'warning',
  on_hold: 'warning',
  // early lifecycle / informational → info
  draft: 'info',
  new: 'info',
  submitted: 'info',
  received: 'info',
  // adverse / breach / rejected / overdue → negative
  rejected: 'negative',
  breached: 'negative',
  overdue: 'negative',
  expired: 'negative',
  lost: 'negative',
  cancelled: 'negative',
  canceled: 'negative',
  terminated: 'negative',
};

/** Normalize a free-form status/key into a stable map key. */
export function normalizeStatusKey(value?: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

/** `statusTone(status)` → tone-name (defaults to `info`). Pure. */
export function statusToneName(status?: string | null): ToneName {
  return STATUS_TONE[normalizeStatusKey(status)] ?? 'info';
}

/** `toneFor(status)` → resolved `var()` color for a legal status. Pure. */
export function toneFor(status?: string | null): string {
  return TONE[statusToneName(status)];
}

/* ------------------------------------------------------------------ *
 * Severity → tone (for risk / breach severities used in some legends).
 * ------------------------------------------------------------------ */

const SEVERITY_TONE: Record<string, string> = {
  critical: 'hsl(var(--severity-critical))',
  high: 'hsl(var(--severity-high))',
  medium: 'hsl(var(--severity-medium))',
  low: 'hsl(var(--severity-low))',
  info: 'hsl(var(--severity-info))',
};

/** `severityTone(level)` → resolved `var()` color (defaults to info). Pure. */
export function severityTone(level?: string | null): string {
  return SEVERITY_TONE[normalizeStatusKey(level)] ?? SEVERITY_TONE.info;
}

/**
 * `gaugeTone(ratio, target)` — pick positive/warning/negative for a 0..1 gauge
 * value against a 0..1 target band. Used by the efficiency gauges + bullet.
 */
export function gaugeTone(ratio: number, target = 0.9): string {
  if (ratio >= target) return TONE.positive;
  if (ratio >= target * 0.8) return TONE.warning;
  return TONE.negative;
}

/** Muted surface/track color for empty cells, gauge tracks, gridlines. */
export const TRACK_COLOR = 'hsl(var(--muted))';
/** Hairline border color bound to the design system. */
export const HAIRLINE_COLOR = 'hsl(var(--border))';
