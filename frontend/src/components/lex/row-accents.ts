/**
 * rowAccentClass — color-coded, elevated row styling for Lex list/table rows.
 *
 * Returns a single Tailwind class string that gives a table/board row:
 *   - a left (inline-start) accent bar tinted to the row's status/priority/severity,
 *   - a very faint matching background wash, and
 *   - a motion-safe hover lift (translate + elevation-2) at fast speed.
 *
 * Colours are driven entirely by the shared design-system semantic tokens
 * (`--ds-success-500`, `--ds-warning-500`, `--ds-error-500`, `--ds-info-500`,
 * `--ds-brand-primary`, `--ds-neutral-400`) so rows re-theme in dark mode and stay
 * consistent with `.badge-*`, `SeverityIndicator`, and the rest of the suite.
 *
 * RTL-safe: the accent bar uses the logical `border-s-*` (inline-start) edge, so it
 * flips automatically to the right in Arabic mode.
 *
 * Tailwind needs to see complete, literal class strings at build time, so each tone
 * is spelled out in full below (never string-interpolated). To apply the accent on a
 * `<tr>`, the row also needs `border-s-4` width to be present — it is included here.
 */

/** Which dimension the value belongs to. Picks the value→tone mapping table. */
export type RowAccentKind = 'status' | 'priority' | 'severity';

/**
 * Canonical tones. Each maps to one design-system semantic colour. `primary`
 * (brand) is used for in-progress/active states; `neutral` for inert/closed ones.
 */
type AccentTone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';

/**
 * Full, literal Tailwind class strings per tone. Spelled out so Tailwind's JIT
 * scanner can statically detect them. Each is: inline-start accent bar (border-s-4 +
 * coloured edge) + faint background wash + the shared hover-lift transition.
 *
 * The hover lift mirrors `SeverityIndicator` / `.card-interactive`: gated under
 * `motion-safe:` so it is inert under `prefers-reduced-motion` (WCAG 2.3.3).
 */
const TONE_CLASS: Record<AccentTone, string> = {
  success:
    'border-s-4 border-s-success-500 bg-success-500/[0.04] ' +
    'transition-[box-shadow,background-color] duration-fast ease-standard ' +
    'hover:shadow-[var(--ds-elevation-2)]',
  warning:
    'border-s-4 border-s-warning-500 bg-warning-500/5 ' +
    'transition-[box-shadow,background-color] duration-fast ease-standard ' +
    'hover:shadow-[var(--ds-elevation-2)]',
  danger:
    'border-s-4 border-s-error-500 bg-error-500/5 ' +
    'transition-[box-shadow,background-color] duration-fast ease-standard ' +
    'hover:shadow-[var(--ds-elevation-2)]',
  info:
    'border-s-4 border-s-info-500 bg-info-500/[0.04] ' +
    'transition-[box-shadow,background-color] duration-fast ease-standard ' +
    'hover:shadow-[var(--ds-elevation-2)]',
  primary:
    'border-s-4 border-s-[hsl(var(--ds-brand-primary))] bg-[hsl(var(--ds-brand-primary)/0.04)] ' +
    'transition-[box-shadow,background-color] duration-fast ease-standard ' +
    'hover:shadow-[var(--ds-elevation-2)]',
  neutral:
    'border-s-4 border-s-neutral-400 bg-transparent ' +
    'transition-[box-shadow,background-color] duration-fast ease-standard ' +
    'hover:shadow-[var(--ds-elevation-2)]',
};

/**
 * Maps the lower-cased value to a tone, per dimension. Keys cover the common Lex
 * vocabularies across cases, requests, settlements, investigations, consultations,
 * and compliance. Synonyms collapse to the same tone (e.g. `in_progress` ≡
 * `active` ≡ `negotiating` → brand/primary). Unknown values fall back to neutral.
 */
const STATUS_TONE: Record<string, AccentTone> = {
  // ---- terminal / positive resolutions ----
  approved: 'success',
  resolved: 'success',
  closed_won: 'success',
  executed: 'success',
  completed: 'success',
  signed: 'success',
  active: 'success',
  compliant: 'success',
  passed: 'success',
  granted: 'success',
  fulfilled: 'success',
  done: 'success',

  // ---- in-progress / active (brand) ----
  in_progress: 'primary',
  in_review: 'primary',
  under_review: 'primary',
  reviewing: 'primary',
  negotiating: 'primary',
  proposed: 'primary',
  drafting: 'primary',
  draft: 'primary',
  ongoing: 'primary',
  processing: 'primary',
  assigned: 'primary',
  acknowledged: 'primary',
  // consultation lifecycle (classified → routed → responded)
  classified: 'primary',
  routed: 'primary',
  responded: 'primary',
  // signature envelope mid-flight (sent → viewed)
  sent: 'info',
  viewed: 'info',

  // ---- waiting / attention (warning) ----
  pending: 'warning',
  pending_approval: 'warning',
  awaiting_approval: 'warning',
  pending_requester_approval: 'warning',
  pending_provider_approval: 'warning',
  on_hold: 'warning',
  hold: 'warning',
  blocked: 'warning',
  escalated: 'warning',
  open: 'warning',
  new: 'warning',
  submitted: 'warning',
  waiting: 'warning',
  waiting_on_business: 'warning',

  // ---- negative / failure (danger) ----
  rejected: 'danger',
  abandoned: 'danger',
  cancelled: 'danger',
  canceled: 'danger',
  closed_lost: 'danger',
  overdue: 'danger',
  breached: 'danger',
  failed: 'danger',
  non_compliant: 'danger',
  withdrawn: 'danger',
  expired: 'danger',
  terminated: 'danger',
  declined: 'danger',

  // ---- inert / closed (neutral) ----
  closed: 'neutral',
  archived: 'neutral',
  inactive: 'neutral',
  void: 'neutral',
  superseded: 'neutral',
  waived: 'neutral',
  intake: 'neutral',
};

const PRIORITY_TONE: Record<string, AccentTone> = {
  critical: 'danger',
  urgent: 'danger',
  highest: 'danger',
  high: 'warning',
  elevated: 'warning',
  medium: 'info',
  normal: 'info',
  standard: 'info',
  moderate: 'info',
  low: 'neutral',
  lowest: 'neutral',
  none: 'neutral',
};

const SEVERITY_TONE: Record<string, AccentTone> = {
  critical: 'danger',
  high: 'danger',
  major: 'danger',
  medium: 'warning',
  moderate: 'warning',
  warning: 'warning',
  low: 'info',
  minor: 'info',
  info: 'info',
  informational: 'info',
  trivial: 'neutral',
  negligible: 'neutral',
};

const TONE_BY_KIND: Record<RowAccentKind, Record<string, AccentTone>> = {
  status: STATUS_TONE,
  priority: PRIORITY_TONE,
  severity: SEVERITY_TONE,
};

/**
 * Resolve the accent class string for a row.
 *
 * @param kind  Which dimension `value` belongs to.
 * @param value The raw status/priority/severity (case-insensitive; `-`/spaces are
 *              normalised to `_` so `"In Progress"`, `"in-progress"` and
 *              `"in_progress"` all match).
 * @returns A literal Tailwind class string (left accent bar + tint + hover lift).
 *          Unknown values resolve to the neutral tone, so a row always gets a
 *          consistent, well-formed accent.
 */
export function rowAccentClass(kind: RowAccentKind, value: string | null | undefined): string {
  const normalized = (value ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const tone = TONE_BY_KIND[kind][normalized] ?? 'neutral';
  return TONE_CLASS[tone];
}
