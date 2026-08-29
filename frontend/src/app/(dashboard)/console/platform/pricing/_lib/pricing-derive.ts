// Pure, framework-free derivations for the calculator's storytelling surfaces
// (deal summary, savings callouts, tier cards). NO hooks, NO margin — every
// value here is derived from the MASKED ClientTier fields (total_monthly,
// contract_value, the three discounts). The internal margin block is never read
// or referenced here, so nothing in this module can leak margin regardless of
// caller permission.

import type { MessageKey } from '@/lib/i18n/messages';
import type { Guardrail, PricingModel, PricingTier, PricingTierRow } from './types';

/**
 * The internal margin FLOOR the guardrail enforces (mirrors the backend's ~10%
 * minimum realized margin). Used ONLY by the admin-only margin cockpit to draw
 * the gauge target and colour the OK / BELOW-FLOOR verdict. It is never read on
 * any client-facing surface.
 */
export const MARGIN_FLOOR = 0.1;

/**
 * The tier elevated as "Recommended / Most Popular" in the cards. Configurable
 * here (and overridable via a prop on the cards) so sales can re-point it
 * without a code hunt. Default: Professional.
 */
export const RECOMMENDED_TIER: PricingTier = 'professional';

/**
 * Known volume breakpoints (users OR cores) → volume-discount fraction. Mirrors
 * the backend's volume ladder; used ONLY for the client-facing "add N more to
 * unlock X%" nudge. The authoritative discount still comes from the server on
 * the next /compute — this is a hint, not a computation.
 */
export const VOLUME_BREAKPOINTS: { threshold: number; pct: number }[] = [
  { threshold: 25, pct: 0.05 },
  { threshold: 100, pct: 0.1 },
  { threshold: 250, pct: 0.15 },
];

/** i18n label key for a tier name. */
export const TIER_LABEL_KEY: Record<PricingTier, MessageKey> = {
  standard: 'platformConsole.pricing.tierStandard',
  growth: 'platformConsole.pricing.tierGrowth',
  professional: 'platformConsole.pricing.tierProfessional',
  customized: 'platformConsole.pricing.tierCustomized',
};

/** Short positioning line per tier (buyer-facing, one sentence). */
export const TIER_POSITIONING_KEY: Record<PricingTier, MessageKey> = {
  standard: 'platformConsole.pricing.cards.positionStandard',
  growth: 'platformConsole.pricing.cards.positionGrowth',
  professional: 'platformConsole.pricing.cards.positionProfessional',
  customized: 'platformConsole.pricing.cards.positionCustomized',
};

/**
 * The AI monthly allowance headline per tier (2M / 5M / 10M / Dedicated). A
 * client-facing feature descriptor derived purely from the tier identity — no
 * server field, no margin.
 */
export const TIER_AI_ALLOWANCE_KEY: Record<PricingTier, MessageKey> = {
  standard: 'platformConsole.pricing.cards.aiStandard',
  growth: 'platformConsole.pricing.cards.aiGrowth',
  professional: 'platformConsole.pricing.cards.aiProfessional',
  customized: 'platformConsole.pricing.cards.aiCustomized',
};

/**
 * Whether a tier is eligible for the premium deployment modes (On-Prem /
 * Air-Gapped). Standard is SaaS-only; the rest unlock managed deployment. Used
 * as a feature bullet.
 */
export function deploymentEligible(tier: PricingTier): boolean {
  return tier !== 'standard';
}

/**
 * Total discount for a tier = volume + term + sales. Each is stored as a
 * POSITIVE subtraction on the wire; the sum is the SAR the buyer saves off the
 * gross sub-total. Never negative.
 */
export function totalSavings(row: PricingTierRow): number {
  return (
    Math.max(0, row.volume_discount) +
    Math.max(0, row.term_discount) +
    Math.max(0, row.sales_discount)
  );
}

/**
 * Savings as a fraction of the gross sub-total (0-1). Guards a zero/negative
 * sub-total so the callout never divides by zero.
 */
export function savingsFraction(row: PricingTierRow): number {
  if (!row.sub_total || row.sub_total <= 0) return 0;
  const frac = totalSavings(row) / row.sub_total;
  return frac > 0 ? frac : 0;
}

/**
 * The volume driver currently in play for the active model (users on per_user,
 * cores on per_core). The single number the volume nudge reasons about.
 */
export function volumeDriver(
  model: PricingModel,
  users: number,
  cores: number,
): number {
  return model === 'per_core' ? cores : users;
}

export interface VolumeNudge {
  /** Additional units needed to reach the next breakpoint. */
  needed: number;
  /** The volume-discount fraction unlocked at that breakpoint. */
  pct: number;
  /** The breakpoint threshold itself. */
  threshold: number;
}

/**
 * If the current volume is BELOW the next breakpoint (and within a sensible
 * nudge window), return how many more units unlock the next tier of volume
 * discount. Returns null when already at/above the top breakpoint or when the
 * gap is too large to be a tasteful nudge.
 */
export function nextVolumeNudge(
  current: number,
  windowSize = 20,
): VolumeNudge | null {
  if (current <= 0) return null;
  for (const bp of VOLUME_BREAKPOINTS) {
    if (current < bp.threshold) {
      const needed = bp.threshold - current;
      if (needed > 0 && needed <= windowSize) {
        return { needed, pct: bp.pct, threshold: bp.threshold };
      }
      // Below this breakpoint but outside the nudge window — no nudge (and no
      // point checking higher breakpoints, they're even further away).
      return null;
    }
  }
  return null;
}

export interface DealSummary {
  totalMonthly: number;
  contractValue: number;
  /** total_monthly / volume driver, or null when the driver is 0. */
  perUnit: number | null;
  annualized: number;
}

/**
 * The headline figures a rep leads with for one tier. `perUnit` is monthly /
 * (users or cores); null when the driver is 0 (empty state).
 */
export function dealSummary(
  row: PricingTierRow,
  model: PricingModel,
  users: number,
  cores: number,
): DealSummary {
  const driver = volumeDriver(model, users, cores);
  return {
    totalMonthly: row.total_monthly,
    contractValue: row.contract_value,
    perUnit: driver > 0 ? row.total_monthly / driver : null,
    annualized: row.total_monthly * 12,
  };
}

/* ------------------------------------------------------------------------- *
 * COST-BREAKDOWN chart derivations (client-safe — MASKED fields only).
 *
 * Every value here reads ONLY the ClientTier line-items / discounts / totals.
 * The internal margin block is never touched, so the stacked-bar and waterfall
 * data can NEVER carry margin regardless of the caller's permissions.
 * ------------------------------------------------------------------------- */

/** One stacked-bar datum: a tier + its four positive cost segments. */
export interface CostBreakdownDatum {
  tier: PricingTier;
  base: number;
  ai: number;
  /** The model-conditional usage line (data storage OR VM infrastructure). */
  usage: number;
  setup: number;
}

/**
 * Build the stacked-bar dataset from the tier rows. The usage segment is
 * model-conditional: `data_storage` on per_user, `vm_infrastructure` on
 * per_core. Segments are floored at 0 so a stray negative never inverts a bar.
 */
export function costBreakdownData(
  rows: PricingTierRow[],
  model: PricingModel,
): CostBreakdownDatum[] {
  const usageKey = model === 'per_core' ? 'vm_infrastructure' : 'data_storage';
  return rows.map((r) => ({
    tier: r.tier,
    base: Math.max(0, r.line_items.base_charge),
    ai: Math.max(0, r.line_items.ai_allocation),
    usage: Math.max(0, r.line_items[usageKey]),
    setup: Math.max(0, r.line_items.deployment_setup_premium),
  }));
}

/** One waterfall step: a label, its delta (signed), and the running total. */
export interface WaterfallStep {
  key: 'subTotal' | 'discounts' | 'net' | 'vat' | 'total';
  /** The signed contribution of this step (negative for discounts). */
  delta: number;
  /** The cumulative running value after this step (for label placement). */
  running: number;
  /** For recharts floating bars: [start, end] of the visible segment. */
  range: [number, number];
  /** Whether this step is a total/anchor (drawn solid) vs a delta. */
  anchor: boolean;
}

/**
 * Build a per-tier waterfall from sub-total → (−discounts) → net → (+VAT) →
 * total. Uses ONLY masked fields. `range` gives recharts a floating [start,end]
 * so each delta bar hangs from the running total.
 */
export function waterfallSteps(row: PricingTierRow): WaterfallStep[] {
  const discounts = totalSavings(row); // positive magnitude
  const afterSub = row.sub_total;
  const afterNet = row.net_sub_total;
  const afterVat = row.net_sub_total + row.vat;

  return [
    {
      key: 'subTotal',
      delta: afterSub,
      running: afterSub,
      range: [0, afterSub],
      anchor: true,
    },
    {
      key: 'discounts',
      delta: -discounts,
      running: afterNet,
      range: [afterNet, afterSub],
      anchor: false,
    },
    {
      key: 'net',
      delta: afterNet,
      running: afterNet,
      range: [0, afterNet],
      anchor: true,
    },
    {
      key: 'vat',
      delta: row.vat,
      running: afterVat,
      range: [afterNet, afterVat],
      anchor: false,
    },
    {
      key: 'total',
      delta: row.total_monthly,
      running: row.total_monthly,
      range: [0, row.total_monthly],
      anchor: true,
    },
  ];
}

/* ------------------------------------------------------------------------- *
 * MARGIN-COCKPIT derivations (INTERNAL — reads the `internal` block).
 *
 * These are only ever consumed by the admin-only cockpit surface, which the
 * page gates on pricing:admin. They read `row.internal` legitimately: the
 * cockpit IS the internal surface.
 * ------------------------------------------------------------------------- */

/** The tiers whose guardrail verdict is BELOW FLOOR (internal rows only). */
export function belowFloorTiers(rows: PricingTierRow[]): PricingTier[] {
  return rows
    .filter((r) => r.internal && r.internal.guardrail !== 'OK')
    .map((r) => r.tier);
}

/** The guardrail verdict for a realized-margin fraction against the floor. */
export function marginVerdict(realizedMargin: number): Guardrail {
  return realizedMargin >= MARGIN_FLOOR ? 'OK' : 'BELOW FLOOR';
}
