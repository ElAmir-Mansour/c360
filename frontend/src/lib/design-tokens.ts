/**
 * Design tokens — single source of truth for data-visualization colors.
 *
 * Tailwind utility classes (`bg-severity-critical`, `text-status-error`, …) and
 * CSS variables (`--severity-*`, `--status-*`, `--chart-*`) are the preferred
 * way to apply these colors and automatically re-theme in dark mode.
 *
 * BUT: SVG presentation attributes (recharts `fill`, d3, `<canvas>`) cannot
 * resolve `var(--x)`. For those contexts, import the resolved values here.
 * Keep these in sync with the `:root` block in `src/app/globals.css`.
 */

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type StatusTone =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral'
  | 'pending';

/** Resolved hex values (light theme) — for SVG/canvas/recharts.
 *  Mirrors the --severity-* vars in globals.css. `low` is emerald (not the leaf
 *  brand green) and `info` is a true blue, so neither collides with the brand. */
export const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#10b981', // emerald — distinct from the leaf-green brand accent
  info: '#0c89e9', // true blue — distinct from the teal brand
};

/** Mirrors the --status-* vars in globals.css. `success` is emerald so a green
 *  success chip is never read as a brand-green highlight. */
export const STATUS_COLORS: Record<StatusTone, string> = {
  success: '#10b981', // emerald
  warning: '#f59e0b',
  error: '#dc2626',
  info: '#0c89e9',
  neutral: '#6C7874', // Grey Dark
  pending: '#8b5cf6',
};

/** Categorical chart series — anchored by Deep Teal, then five semantic hues
 *  selected for accessible categorical encoding. Mirrors the --chart-1..6 vars
 *  in globals.css (light theme). */
export const CHART_COLORS: string[] = [
  '#005E5E', // 1 — Deep Teal (brand)
  '#619b27', // 2 — leaf green (deepened to clear 3:1 on white)
  '#c47f08', // 3 — amber (deepened to clear 3:1 on white)
  '#9f51d6', // 4 — violet
  '#1979e6', // 5 — blue
  '#dd2c85', // 6 — magenta
];

/**
 * CSS-var reference for use in inline `style` (where var() *does* resolve) and
 * className-free DOM styling. Re-themes in dark mode automatically.
 */
export const severityVar = (level: SeverityLevel): string =>
  `hsl(var(--severity-${level}))`;

export const statusVar = (tone: StatusTone): string =>
  `hsl(var(--status-${tone}))`;

export const chartVar = (index: number): string =>
  `hsl(var(--chart-${(index % 6) + 1}))`;

/** Tailwind class helpers — re-theme automatically. */
export const severityBgClass: Record<SeverityLevel, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
  info: 'bg-severity-info',
};

export const severityTextClass: Record<SeverityLevel, string> = {
  critical: 'text-severity-critical',
  high: 'text-severity-high',
  medium: 'text-severity-medium',
  low: 'text-severity-low',
  info: 'text-severity-info',
};

/** Resolve a free-form severity string to a known level (safe fallback). */
export function normalizeSeverity(value?: string | null): SeverityLevel {
  switch ((value ?? '').toLowerCase()) {
    case 'critical':
    case 'crit':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
    case 'moderate':
    case 'med':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

/** Hex for a severity string (SVG/canvas safe). */
export function severityHex(value?: string | null): string {
  return SEVERITY_COLORS[normalizeSeverity(value)];
}
