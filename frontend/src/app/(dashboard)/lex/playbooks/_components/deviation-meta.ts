/**
 * Shared, framework-agnostic presentation helpers for clause-deviation review.
 *
 * This is the single source of truth for mapping a deviation's `kind` /
 * `severity` and a compliance `score` onto the suite's visual vocabulary —
 * shadcn {@link Badge} variants and the Stream-E {@link StatTone} accent palette
 * — so every playbooks feature agent (catalog needs-review badges, the
 * compliance portfolio, the deviation table, the dry-run preview, …) renders the
 * SAME tone for the same data instead of re-deriving it inline.
 *
 * Pure + self-contained: no React, no backend types. Inputs are plain strings /
 * numbers (the raw backend tokens), so this module compiles independently of the
 * API client and `types/suites.ts`. Unknown tokens fall back to a neutral
 * variant/tone rather than throwing.
 */

import type { BadgeProps } from '@/components/ui/badge';
import type { StatTone } from '@/components/shared/stat-card';

/** Badge variant union, derived from the shadcn `Badge` component. */
export type BadgeVariant = BadgeProps['variant'];

/** The kind of deviation a clause exhibits relative to its playbook standard. */
export type DeviationKind = 'missing' | 'altered' | 'extra';

/** Risk severity assigned to a deviation. */
export type DeviationSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Map a deviation `kind` token onto a Badge variant:
 *   - `missing`  → `destructive` (a required standard clause is absent)
 *   - `altered`  → `warning`     (present but diverges from the standard)
 *   - `extra`    → `secondary`   (an unexpected, non-standard clause)
 *   - anything else → `outline`  (neutral fallback)
 *
 * Accepts a loose `string` (raw backend token) so callers don't have to
 * pre-narrow to {@link DeviationKind}.
 */
export function kindBadgeVariant(kind: string): BadgeVariant {
  switch (kind) {
    case 'missing':
      return 'destructive';
    case 'altered':
      return 'warning';
    case 'extra':
      return 'secondary';
    default:
      return 'outline';
  }
}

/**
 * Map a deviation `severity` token onto a Badge variant:
 *   - `critical` / `high` → `destructive`
 *   - `medium`           → `warning`
 *   - `low`              → `secondary`
 *   - anything else      → `outline` (neutral fallback)
 */
export function severityBadgeVariant(severity: string): BadgeVariant {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'destructive';
    case 'medium':
      return 'warning';
    case 'low':
      return 'secondary';
    default:
      return 'outline';
  }
}

/**
 * Map a 0–100 compliance score onto a {@link StatTone} accent for KPI / stat
 * surfaces:
 *   - `< 60`  → `rose`    (failing / high-risk portfolio entry)
 *   - `< 85`  → `gold`    (needs attention)
 *   - `>= 85` → `emerald` (healthy)
 *
 * Non-finite input is treated as the lowest band (`rose`).
 */
export function complianceTone(score: number): StatTone {
  const value = Number.isFinite(score) ? score : 0;
  if (value < 60) {
    return 'rose';
  }
  if (value < 85) {
    return 'gold';
  }
  return 'emerald';
}

/**
 * Normalize a similarity / compliance / threshold value to an integer percent in
 * `[0, 100]`. Backends return these either as a 0–1 fraction or an already-scaled
 * 0–100 percent; a value `<= 1` is treated as a fraction and multiplied by 100.
 * Non-finite input clamps to `0`.
 *
 * Mirrors the historic inline `clampPercent` in `deviation-review.tsx` so the two
 * stay byte-for-byte consistent.
 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}
