/**
 * advisor-format.ts — pure, deterministic helpers for the recovery-tier &
 * objective-fit advisor surface.
 *
 * Everything here reads ONLY real fields from the `@/types/clario-dr` shapes
 * (`DRObjectiveFit`, `DRRecoveryTierRecommendation`, `DRRecoveryTierProfile`,
 * `DRProtectedSite`). No fields are invented. The remediation text is derived
 * from the real recommendation/objective-fit fields (tier strategy, the
 * `requires_cyber_vault` / `requires_clean_room` flags, the validation cadence,
 * the RTO/RPO objectives and any server-supplied warnings) so the advisory copy
 * is faithful to what the backend actually returned.
 *
 * Kept hook-free and SVG-free so it is unit-testable in isolation and importable
 * from both the protect and readiness routes.
 */

import type {
  DRObjectiveFit,
  DRProtectedSite,
  DRRecoveryTierProfile,
  DRRecoveryTierRecommendation,
  DRRecoveryTierRecommendationRequest,
} from '@/types/clario-dr';

/** Severity tone used by the advisor badges/cards (maps to design-system colours). */
export type AdvisorTone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

/**
 * Objective-fit verdict, normalized from the backend's free-form
 * `DRObjectiveFit.status` string. The recovery service emits `met` / `at_risk` /
 * `not_achievable` (plus synonyms); anything unrecognized is surfaced as
 * `unknown` rather than being silently coerced to a pass.
 */
export type ObjectiveFitVerdict = 'met' | 'at_risk' | 'not_achievable' | 'unknown';

/** Lower-case + underscore-collapse a backend status string. */
export function normalizeStatus(status?: string | null): string {
  return (status ?? '').toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Map a raw `DRObjectiveFit.status` onto a stable verdict. Treats the common
 * backend spellings as equivalent so the UI tone is deterministic.
 */
export function objectiveFitVerdict(fit?: DRObjectiveFit | null): ObjectiveFitVerdict {
  if (!fit) return 'unknown';
  const status = normalizeStatus(fit.status);
  if (status === 'met' || status === 'ok' || status === 'achievable' || status === 'pass' || status === 'passed') {
    return 'met';
  }
  if (
    status === 'not_achievable' ||
    status === 'unachievable' ||
    status === 'breached' ||
    status === 'fail' ||
    status === 'failed'
  ) {
    return 'not_achievable';
  }
  if (status === 'at_risk' || status === 'warning' || status === 'degraded' || status === 'marginal') {
    return 'at_risk';
  }
  return 'unknown';
}

/** Tone for an objective-fit verdict (also accounting for any warnings). */
export function objectiveFitTone(fit?: DRObjectiveFit | null): AdvisorTone {
  const verdict = objectiveFitVerdict(fit);
  if (verdict === 'not_achievable') return 'critical';
  if (verdict === 'at_risk') return 'warning';
  if (verdict === 'met') {
    return (fit?.warnings?.length ?? 0) > 0 ? 'warning' : 'success';
  }
  return 'neutral';
}

/** Short human label for an objective-fit verdict. */
export function objectiveFitLabel(fit?: DRObjectiveFit | null): string {
  switch (objectiveFitVerdict(fit)) {
    case 'met':
      return 'Objectives met';
    case 'at_risk':
      return 'Objectives at risk';
    case 'not_achievable':
      return 'Objectives not achievable';
    default:
      return 'Objective fit unknown';
  }
}

/**
 * Format a seconds duration as a compact recovery objective, e.g. `30s`,
 * `15m`, `2h 30m`, `1d 6h`. `null`/`NaN`/negative renders the `naLabel`.
 */
export function formatObjectiveDuration(seconds?: number | null, naLabel = 'n/a'): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds) || seconds < 0) {
    return naLabel;
  }
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/** A single derived remediation step shown under the advisory card. */
export interface AdvisorRemediation {
  /** Stable key for React lists. */
  key: string;
  /** Short imperative remediation sentence derived from a real field. */
  text: string;
  /** Tone driving the marker colour. */
  tone: AdvisorTone;
}

/**
 * The recommendation carries either the per-site `DRRecoveryTierRecommendation`
 * (from `DRProtectedSite.recovery_tier_recommendation`) or the catalog
 * `DRRecoveryTierProfile` (from `fetchDRRecoveryTiers` / `recommendDRRecoveryTier`).
 * Both expose the same governing fields under slightly different names; this
 * normalizes them so the remediation derivation reads one shape.
 */
export interface NormalizedTier {
  tier: string;
  strategy: string;
  rtoSeconds: number;
  rpoSeconds: number;
  validationCadenceSeconds: number;
  requiresCyberVault: boolean;
  requiresCleanRoom: boolean;
  capabilities: string[];
  notes: string[];
}

export function normalizeRecommendation(
  rec?: DRRecoveryTierRecommendation | null,
): NormalizedTier | null {
  if (!rec) return null;
  return {
    tier: rec.tier,
    strategy: rec.strategy,
    rtoSeconds: rec.rto_objective_seconds,
    rpoSeconds: rec.rpo_objective_seconds,
    validationCadenceSeconds: rec.validation_cadence_seconds,
    requiresCyberVault: rec.requires_cyber_vault,
    requiresCleanRoom: rec.requires_clean_room,
    capabilities: rec.capabilities ?? [],
    notes: rec.notes ?? [],
  };
}

export function normalizeTierProfile(
  profile?: DRRecoveryTierProfile | null,
): NormalizedTier | null {
  if (!profile) return null;
  return {
    tier: profile.tier,
    strategy: profile.recommended_strategy,
    rtoSeconds: profile.rto_seconds,
    rpoSeconds: profile.rpo_seconds,
    validationCadenceSeconds: profile.minimum_validation_cadence_seconds,
    requiresCyberVault: profile.requires_cyber_vault,
    requiresCleanRoom: profile.requires_clean_room,
    capabilities: profile.capabilities ?? [],
    notes: profile.notes ?? [],
  };
}

/**
 * Derive concrete remediation steps from the REAL recommendation + objective-fit
 * fields. Each line is grounded in a field the backend actually returned:
 *
 *  - the recommended tier strategy (e.g. "Adopt the warm-standby strategy"),
 *  - the immutable cyber-vault requirement (`requires_cyber_vault`),
 *  - the clean-room requirement (`requires_clean_room`),
 *  - the validation cadence (`validation_cadence_seconds`),
 *  - the RTO/RPO objectives the tier is sized for, and
 *  - any server-supplied objective-fit warnings.
 *
 * Returns an empty list when there is nothing to act on (objectives already met
 * with no warnings and no recommendation).
 */
export function deriveRemediations(
  tier: NormalizedTier | null,
  fit?: DRObjectiveFit | null,
): AdvisorRemediation[] {
  const steps: AdvisorRemediation[] = [];
  const verdict = objectiveFitVerdict(fit);
  const fitTone: AdvisorTone = verdict === 'not_achievable' ? 'critical' : verdict === 'at_risk' ? 'warning' : 'info';

  if (tier) {
    if (tier.strategy) {
      steps.push({
        key: 'strategy',
        text: `Adopt the ${prettify(tier.strategy)} strategy for the ${prettify(tier.tier)} tier to size replication for a ${formatObjectiveDuration(
          tier.rtoSeconds,
        )} RTO / ${formatObjectiveDuration(tier.rpoSeconds)} RPO target.`,
        tone: fitTone,
      });
    }

    if (tier.requiresCyberVault) {
      steps.push({
        key: 'cyber-vault',
        text: 'Provision an immutable cyber-vault copy: this tier requires WORM-locked, isolated recovery points to meet its ransomware posture.',
        tone: 'warning',
      });
    }

    if (tier.requiresCleanRoom) {
      steps.push({
        key: 'clean-room',
        text: 'Enable clean-room validation so recovery points are malware-scanned in isolation before this tier is certified recoverable.',
        tone: 'warning',
      });
    }

    if (tier.validationCadenceSeconds > 0) {
      steps.push({
        key: 'validation-cadence',
        text: `Validate recovery points at least every ${formatObjectiveDuration(
          tier.validationCadenceSeconds,
        )} to satisfy this tier's minimum validation cadence.`,
        tone: 'info',
      });
    }

    for (const [index, note] of tier.notes.entries()) {
      if (note.trim()) {
        steps.push({ key: `note-${index}`, text: note, tone: 'info' });
      }
    }
  }

  for (const [index, warning] of (fit?.warnings ?? []).entries()) {
    if (warning.trim()) {
      steps.push({ key: `warning-${index}`, text: warning, tone: fitTone });
    }
  }

  return steps;
}

/**
 * Build the `recommendDRRecoveryTier` request payload from a site's measured
 * objectives. Reads only real `DRProtectedSite` fields; criticality flags are
 * inferred conservatively from the tightness of the objectives (sub-minute RPO
 * ⇒ mission critical; sub-hour RTO ⇒ business critical) so the recommender has
 * enough signal without inventing data the API does not carry.
 */
export function buildRecommendationRequest(
  site: Pick<DRProtectedSite, 'rto_objective_seconds' | 'rpo_objective_seconds'>,
): DRRecoveryTierRecommendationRequest {
  const rto = Math.max(0, site.rto_objective_seconds || 0);
  const rpo = Math.max(0, site.rpo_objective_seconds || 0);
  return {
    rto_seconds: rto,
    rpo_seconds: rpo,
    business_critical: rto > 0 && rto <= 3_600,
    mission_critical: rpo > 0 && rpo <= 60,
  };
}

/** Title-case a snake/kebab/space identifier for display (e.g. `warm_standby` → `Warm standby`). */
export function prettify(value?: string | null): string {
  const normalized = normalizeStatus(value).replace(/-/g, '_');
  if (!normalized) return 'n/a';
  const spaced = normalized.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Map an advisor tone to design-system badge variant keys. */
export function badgeVariantForTone(
  tone: AdvisorTone,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'destructive';
    case 'info':
      return 'default';
    default:
      return 'outline';
  }
}
