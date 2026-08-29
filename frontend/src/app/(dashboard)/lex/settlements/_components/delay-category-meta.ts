/**
 * Delay-category iconography / tonal metadata (timeline feature #5).
 *
 * Maps each {@link DelayCategory} to a stable lucide icon + a `DetailStatCard`
 * tone so every place that surfaces a delay category (event badges, the
 * by-category breakdown #3, cross-matter dashboard #15, …) renders the same
 * icon and colour without re-deriving it. The TEXT of the category still comes
 * from `delayCategoryLabel(L, category)` in `./labels` — this module only owns
 * the *visual* facet so it stays locale-agnostic.
 *
 * `tone` values are constrained to the shared `StatTone` palette
 * (see `@/components/shared/stat-card`): one of
 * `neutral | emerald | gold | sky | rose | slate`. The four categories use four
 * distinct tones so they are visually separable in a single list.
 */

import { Briefcase, Building2, Landmark, UserSearch, type LucideIcon } from 'lucide-react';
import type { StatTone } from '@/components/shared/stat-card';
import { DELAY_CATEGORY_VALUES, type DelayCategory } from '@/lib/lex/settlements';

export interface DelayCategoryMeta {
  /** Lucide icon representing the category. */
  icon: LucideIcon;
  /** Shared `DetailStatCard` / KPI tone for the category accent. */
  tone: StatTone;
  /**
   * Extra utility classes to layer onto the category `Badge`. Keeps the badge
   * outline-flavoured but tints border/text/background to match `tone`.
   */
  badgeClassName: string;
}

/**
 * Stable per-category visual metadata. Distinct tone + icon per category so a
 * mixed delay list is scannable. Tones are drawn from the shared `StatTone`
 * palette (no `amber`/`violet` — those are not part of the palette; `gold` is
 * the amber-flavoured tone).
 */
export const DELAY_CATEGORY_META: Record<DelayCategory, DelayCategoryMeta> = {
  // Courts / judiciary — the institutional, primary-leaning tone.
  court: {
    icon: Landmark,
    tone: 'slate',
    badgeClassName:
      'border-primary/30 bg-primary/10 text-primary',
  },
  // Government / regulatory bodies — brand Spring Teal.
  government: {
    icon: Building2,
    tone: 'teal',
    badgeClassName:
      'border-brand-teal-300 bg-brand-teal-50 text-brand-teal-700 dark:border-brand-teal-500/40 dark:bg-brand-teal-500/10 dark:text-brand-teal-300',
  },
  // Internal department dependency — warm amber/gold.
  department: {
    icon: Briefcase,
    tone: 'gold',
    badgeClassName:
      'border-warning-300 bg-warning-50 text-warning-700 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300',
  },
  // External expert / specialist — brand La Rioja accent (not a breach, so no
  // rose/red signal; the chartreuse accent keeps it as a distinct 4th category).
  expert: {
    icon: UserSearch,
    tone: 'neutral',
    badgeClassName:
      'border-brand-accent-300 bg-brand-accent-50 text-brand-accent-700 dark:border-brand-accent-500/40 dark:bg-brand-accent-500/10 dark:text-brand-accent-300',
  },
};

/** Neutral fallback for an unknown / future category token. */
const FALLBACK_META: DelayCategoryMeta = {
  icon: Briefcase,
  tone: 'slate',
  badgeClassName: 'border-border/80 bg-card/70 text-foreground',
};

/**
 * Resolve the visual metadata for a delay category. Accepts a raw string so it
 * is safe against forward-compatible / unknown backend tokens, returning a
 * neutral fallback instead of throwing.
 */
export function delayCategoryMeta(category: string): DelayCategoryMeta {
  return DELAY_CATEGORY_META[category as DelayCategory] ?? FALLBACK_META;
}

/** Re-export the canonical ordering for callers that iterate all categories. */
export const DELAY_CATEGORIES = DELAY_CATEGORY_VALUES;
