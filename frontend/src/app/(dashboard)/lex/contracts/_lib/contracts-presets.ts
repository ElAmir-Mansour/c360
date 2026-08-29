/**
 * Quick-filter preset chips for the contracts list (`/lex/contracts`).
 *
 * Each preset is a named bundle of `activeFilters` entries that, when applied,
 * narrows the contract portfolio to a common working slice (active contracts,
 * imminent renewals, high-risk exposure, the signature queue, "mine"). This is a
 * PURE, locale-agnostic module (no JSX, no hooks): it owns the preset *data* and
 * the matching logic only. JSX consumers resolve the bilingual `labels` bundle
 * through the active locale exactly like the other lex label records, and feed
 * the resulting filter map into the list page's `setFilter`/`clearFilters` flow.
 *
 * Filter keys mirror the backend contract query contract and the keys already
 * driving the list page filters: `status`, `risk_level`, plus the renewal-window
 * key `expiring_in_days` and the ownership key `owner_user_id`. Every filter
 * value is a string so a preset maps 1:1 onto `Record<string, string>` and onto
 * the `activeFilters` (`Record<string, string | string[]>`) the table exposes.
 */

import {
  CalendarClock,
  CircleCheck,
  PenLine,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { LexContractStatus, LexRiskLevel } from '@/types/suites';

/**
 * Sentinel placed in a preset's `owner_user_id` filter. It is substituted with
 * the signed-in user's id at apply time (see {@link buildPresetFilters}) because
 * the current user id is a RUNTIME value the static preset table cannot know.
 */
export const PRESET_CURRENT_USER_SENTINEL = '__ME__';

/**
 * A quick-filter preset chip. `filters` is a flat `key → value` map applied as a
 * full replacement of the active filter set (clear-then-apply on the list page).
 * `labels` follows the canonical lex bilingual shape (`{ en, ar }`) and is the
 * ONLY field JSX renders for text; `icon` is an optional lucide glyph accent.
 */
export interface ContractPreset {
  /** Stable id (also used by {@link matchActivePreset} to flag the active chip). */
  id: string;
  /** Bilingual chip label — English + Modern Standard Arabic. */
  labels: { en: string; ar: string };
  /** Optional lucide icon rendered before the label (logical leading edge). */
  icon?: LucideIcon;
  /** Flat filter set applied when the chip is selected. */
  filters: Record<string, string>;
}

/* ------------------------------------------------------------------------- *
 * Strongly-typed filter-value witnesses. These keep the preset literals honest
 * against the backend enums (`status` must be a real `LexContractStatus`, etc.)
 * without widening `ContractPreset.filters` away from `Record<string, string>`.
 * ------------------------------------------------------------------------- */

const STATUS_ACTIVE: LexContractStatus = 'active';
const STATUS_PENDING_SIGNATURE: LexContractStatus = 'pending_signature';
const RISK_HIGH: LexRiskLevel = 'high';

/**
 * The ordered quick-filter presets surfaced as chips on the contracts list.
 *
 * NOTE on "High risk": the backend `risk_level` filter accepts a SINGLE level,
 * so this preset matches `high` only (not `high` + `critical`). If a combined
 * "high + critical" exposure slice is ever required, it must be modelled either
 * as a backend-supported multi-value filter (e.g. `risk_level=high,critical` or
 * a repeated key) or as a dedicated `risk_min` threshold param — at which point
 * `filters.risk_level` here would change shape. Documented intentionally so the
 * single-level limitation is a deliberate choice, not an oversight.
 */
export const CONTRACT_PRESETS: ContractPreset[] = [
  {
    id: 'active',
    labels: { en: 'Active', ar: 'نشطة' },
    icon: CircleCheck,
    filters: { status: STATUS_ACTIVE },
  },
  {
    id: 'expiring_30d',
    labels: { en: 'Expiring 30d', ar: 'تنتهي خلال 30 يومًا' },
    icon: CalendarClock,
    filters: { expiring_in_days: '30' },
  },
  {
    id: 'high_risk',
    labels: { en: 'High risk', ar: 'مخاطر مرتفعة' },
    icon: ShieldAlert,
    filters: { risk_level: RISK_HIGH },
  },
  {
    id: 'for_signature',
    labels: { en: 'For signature', ar: 'بانتظار التوقيع' },
    icon: PenLine,
    filters: { status: STATUS_PENDING_SIGNATURE },
  },
  {
    id: 'my_contracts',
    labels: { en: 'My contracts', ar: 'عقودي' },
    icon: UserRound,
    filters: { owner_user_id: PRESET_CURRENT_USER_SENTINEL },
  },
];

/**
 * Resolve a preset's filter set for application, substituting the
 * {@link PRESET_CURRENT_USER_SENTINEL} in `owner_user_id` with the runtime
 * `currentUserId`. Returns a fresh object (the source preset is never mutated).
 * Presets without the sentinel are returned as a shallow copy unchanged.
 */
export function buildPresetFilters(
  preset: ContractPreset,
  currentUserId: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(preset.filters)) {
    resolved[key] =
      value === PRESET_CURRENT_USER_SENTINEL ? currentUserId : value;
  }
  return resolved;
}

/**
 * Return the id of the preset whose resolved filter set EXACTLY matches the
 * supplied active filters (same key set, same scalar values), or `null` when no
 * preset matches. Used to highlight the currently-active chip.
 *
 * Matching is exact and order-independent: an array-valued active filter (e.g. a
 * multi-select) never matches a preset (whose values are all scalar strings), so
 * a partially-overlapping or superset filter state correctly yields `null`.
 */
export function matchActivePreset(
  activeFilters: Record<string, string | string[]>,
  currentUserId: string,
): string | null {
  const activeKeys = Object.keys(activeFilters);
  for (const preset of CONTRACT_PRESETS) {
    const resolved = buildPresetFilters(preset, currentUserId);
    const presetKeys = Object.keys(resolved);
    if (presetKeys.length !== activeKeys.length) {
      continue;
    }
    const matches = presetKeys.every((key) => {
      const activeValue = activeFilters[key];
      // Array-valued (multi-select) active filters can never equal a scalar
      // preset value, so they fall through to a non-match.
      return typeof activeValue === 'string' && activeValue === resolved[key];
    });
    if (matches) {
      return preset.id;
    }
  }
  return null;
}
