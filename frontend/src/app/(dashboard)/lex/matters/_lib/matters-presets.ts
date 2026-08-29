/**
 * Quick-filter preset chips for the matters list (`/lex/matters`).
 *
 * Each preset is a named bundle of `activeFilters` entries that, when applied,
 * narrows the matter register to a common working slice (open intake, the review
 * queue, critical priority, the overdue tail, "mine", and the client-side
 * at-risk slice). This is a PURE, locale-agnostic module (no JSX, no hooks): it
 * owns the preset *data* and the matching logic only. JSX consumers resolve the
 * bilingual `labels` bundle through the active locale exactly like the other lex
 * label records, and feed the resulting filter map into the list page's
 * `setFilter`/`clearFilters` flow (clear-then-apply).
 *
 * ── FILTER KEYS ────────────────────────────────────────────────────────────
 * Keys mirror the matters list filters declared in `../page.tsx` and the keys
 * `useDataTable.activeFilters` exposes:
 *   • `status`   — scalar `LexMatterStatus` ('open', 'in_review', …).
 *   • `priority` — scalar `LexMatterPriority` ('critical', …).
 *   • `due_date` — a `date-range` filter. The DataTable date-range control
 *     serializes its value as a SINGLE comma-joined string `"<fromISO>,<toISO>"`
 *     (see `data-table-filter.tsx`), NOT two `_from`/`_to` keys. An empty side is
 *     left blank, so an open-ended "everything up to now" range is `",<nowISO>"`.
 *
 * ── "OVERDUE" SEMANTICS ────────────────────────────────────────────────────
 * Per `./matter-sla.tsx`, a matter is overdue/breached when its `due_date` is in
 * the PAST on a non-terminal matter. The closest server-expressible slice is a
 * `due_date` range bounded above by "now": `due_date = ",<nowISO>"`. Because the
 * upper bound is a RUNTIME value the static table cannot know, the preset stores
 * the {@link PRESET_NOW_SENTINEL} in the `to` position and {@link buildPresetFilters}
 * substitutes the live ISO timestamp at apply time (mirroring the `__ME__`
 * owner sentinel). NOTE: this is a coarse server-side approximation — it does NOT
 * apply the terminal-status exclusion or the critical-priority breach
 * short-circuit that `matterSlaTier` does; those refinements remain a client
 * concern (the `atRiskOnly` toggle / `compareMatterSla`). It is intentionally a
 * "due before now" range, not a faithful SLA-tier reproduction.
 *
 * ── "AT RISK" SEMANTICS ────────────────────────────────────────────────────
 * "At risk" is NOT a server filter. It is the derived SLA slice (overdue +
 * breached) computed client-side by `isMatterAtRisk`, surfaced on the list page
 * as the `atRiskOnly` toggle. Its preset carries `clientAtRisk: true` and an
 * EMPTY `filters` map; the integrator routes a click on this chip to the existing
 * `atRiskOnly` state rather than to `setFilter`. Keeping it in the same preset
 * list lets the chip row render and highlight uniformly.
 *
 * Every server filter value is a string so a preset maps 1:1 onto
 * `Record<string, string>` and onto the `activeFilters`
 * (`Record<string, string | string[]>`) the table exposes.
 */

import {
  AlertTriangle,
  CalendarClock,
  FolderOpen,
  Scale,
  SearchCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { LexMatterPriority, LexMatterStatus } from '@/types/suites';

/**
 * Sentinel placed in a preset's `owner_user_id` filter. It is substituted with
 * the signed-in user's id at apply time (see {@link buildPresetFilters}) because
 * the current user id is a RUNTIME value the static preset table cannot know.
 */
export const PRESET_CURRENT_USER_SENTINEL = '__ME__';

/**
 * Sentinel placed in the `to` side of a `due_date` range (the {@link OVERDUE}
 * preset). Substituted with the current ISO timestamp at apply time so the
 * "due before now" range tracks the live clock.
 */
export const PRESET_NOW_SENTINEL = '__NOW__';

/**
 * A quick-filter preset chip. `filters` is a flat `key → value` map applied as a
 * full replacement of the active server filter set (clear-then-apply on the list
 * page). `labels` follows the canonical lex bilingual shape (`{ en, ar }`) and is
 * the ONLY field JSX renders for text; `icon` is an optional lucide glyph accent.
 * `clientAtRisk` flags the chip that maps to the client-side at-risk toggle
 * instead of a server filter (its `filters` map is empty).
 */
export interface MatterPreset {
  /** Stable id (also used by {@link matchActivePreset} to flag the active chip). */
  id: string;
  /** Bilingual chip label — English + Modern Standard Arabic. */
  labels: { en: string; ar: string };
  /** Optional lucide icon rendered before the label (logical leading edge). */
  icon?: LucideIcon;
  /** Flat server filter set applied when the chip is selected (empty for at-risk). */
  filters: Record<string, string>;
  /**
   * When true this chip is NOT a server filter: the integrator routes it to the
   * existing `atRiskOnly` client toggle. `filters` is empty for such presets.
   */
  clientAtRisk?: boolean;
}

/* ------------------------------------------------------------------------- *
 * Strongly-typed filter-value witnesses. These keep the preset literals honest
 * against the backend enums (`status` must be a real `LexMatterStatus`, etc.)
 * without widening `MatterPreset.filters` away from `Record<string, string>`.
 * ------------------------------------------------------------------------- */

const STATUS_OPEN: LexMatterStatus = 'open';
const STATUS_IN_REVIEW: LexMatterStatus = 'in_review';
const PRIORITY_CRITICAL: LexMatterPriority = 'critical';

/**
 * The ordered quick-filter presets surfaced as chips on the matters list.
 *
 * Order: Open → In review → Critical → Overdue → My matters → At risk. The first
 * four/five are server-side single-key filters; "At risk" is the client-derived
 * SLA slice (see the module header).
 */
export const MATTER_PRESETS: MatterPreset[] = [
  {
    id: 'open',
    labels: { en: 'Open', ar: 'مفتوحة' },
    icon: FolderOpen,
    filters: { status: STATUS_OPEN },
  },
  {
    id: 'in_review',
    labels: { en: 'In review', ar: 'قيد المراجعة' },
    icon: SearchCheck,
    filters: { status: STATUS_IN_REVIEW },
  },
  {
    id: 'critical',
    labels: { en: 'Critical', ar: 'حرجة' },
    icon: Scale,
    filters: { priority: PRIORITY_CRITICAL },
  },
  {
    id: 'overdue',
    labels: { en: 'Overdue', ar: 'متأخّرة' },
    icon: CalendarClock,
    // date-range value is "<from>,<to>"; an empty `from` + `now` `to` ⇒ "due
    // before now". The PRESET_NOW_SENTINEL is resolved by buildPresetFilters.
    filters: { due_date: `,${PRESET_NOW_SENTINEL}` },
  },
  {
    id: 'my_matters',
    labels: { en: 'My matters', ar: 'قضاياي' },
    icon: UserRound,
    filters: { owner_user_id: PRESET_CURRENT_USER_SENTINEL },
  },
  {
    id: 'at_risk',
    labels: { en: 'At risk', ar: 'المعرّضة للخطر' },
    icon: AlertTriangle,
    // Client-side SLA slice (overdue + breached). No server filter — routed to
    // the list page's `atRiskOnly` toggle by the integrator.
    filters: {},
    clientAtRisk: true,
  },
];

/**
 * Resolve a preset's server filter set for application, substituting the runtime
 * sentinels: {@link PRESET_CURRENT_USER_SENTINEL} (anywhere it appears, e.g. in
 * `owner_user_id`) with `currentUserId`, and {@link PRESET_NOW_SENTINEL} (in the
 * `due_date` range `to` slot) with the current ISO timestamp. Returns a fresh
 * object (the source preset is never mutated). `clientAtRisk` presets have an
 * empty `filters` map, so this returns `{}` for them — the integrator must route
 * those to the `atRiskOnly` toggle rather than calling `setFilter`.
 *
 * `now` is injectable (ms epoch) for deterministic tests; defaults to
 * `Date.now()` so the overdue range tracks the live clock.
 */
export function buildPresetFilters(
  preset: MatterPreset,
  currentUserId: string,
  now: number = Date.now(),
): Record<string, string> {
  const nowIso = new Date(now).toISOString();
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(preset.filters)) {
    resolved[key] = value
      .replace(PRESET_CURRENT_USER_SENTINEL, currentUserId)
      .replace(PRESET_NOW_SENTINEL, nowIso);
  }
  return resolved;
}

/**
 * Return the id of the preset matching the current view, or `null` when none
 * matches. Used to highlight the active chip.
 *
 * Matching rules:
 *   • The `at_risk` (client) preset matches IFF `atRiskOnly` is true AND there
 *     are no server filters active (a pure at-risk view, no other narrowing).
 *   • A server preset matches IFF `atRiskOnly` is false AND its resolved filter
 *     set EXACTLY equals `activeFilters` (same key set, same scalar values).
 *
 * The `due_date` range is matched on its `from` bound and the *presence* of an
 * upper bound only — the live `now` upper bound drifts every render, so the
 * minute/second components must NOT be compared. We treat an `overdue` view as
 * active when the active `due_date` value has an empty `from` and a non-empty
 * `to` (`",<something>"`), which is the shape this module emits. Array-valued
 * (multi-select) active filters never equal a scalar preset value, so a
 * partially-overlapping or superset filter state correctly yields `null`.
 */
export function matchActivePreset(
  activeFilters: Record<string, string | string[]>,
  currentUserId: string,
  atRiskOnly: boolean,
): string | null {
  const activeKeys = Object.keys(activeFilters);

  // The client-side at-risk slice: toggle on, no server narrowing.
  if (atRiskOnly) {
    return activeKeys.length === 0 ? 'at_risk' : null;
  }

  for (const preset of MATTER_PRESETS) {
    if (preset.clientAtRisk) {
      continue;
    }
    const resolved = buildPresetFilters(preset, currentUserId);
    const presetKeys = Object.keys(resolved);
    if (presetKeys.length !== activeKeys.length) {
      continue;
    }
    const matches = presetKeys.every((key) => {
      const activeValue = activeFilters[key];
      if (typeof activeValue !== 'string') {
        // Array-valued (multi-select) active filters can never equal a scalar.
        return false;
      }
      // The overdue `due_date` upper bound is a live `now` that drifts, so
      // compare only the range *shape* ("empty from, present to") rather than
      // the exact timestamp.
      if (key === 'due_date' && resolved[key].startsWith(',')) {
        const [from, to] = activeValue.split(',');
        return from === '' && (to ?? '') !== '';
      }
      return activeValue === resolved[key];
    });
    if (matches) {
      return preset.id;
    }
  }
  return null;
}
