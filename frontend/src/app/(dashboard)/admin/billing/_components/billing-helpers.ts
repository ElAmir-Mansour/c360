import type { SubscriptionTier } from '@/types/tenant';

export type QuotaTone = 'primary' | 'warning' | 'danger' | 'muted';

/** Percent of a quota consumed, or null when the plan imposes no limit. */
export function quotaPercent(used: number, limit?: number | null): number | null {
  if (!limit || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** Severity tone for a quota meter: danger ≥95%, warning ≥80%, else primary. */
export function quotaTone(pct: number | null): QuotaTone {
  if (pct == null) return 'muted';
  if (pct >= 95) return 'danger';
  if (pct >= 80) return 'warning';
  return 'primary';
}

export const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  starter: 1,
  professional: 2,
  enterprise: 3,
};

/** Relationship of a candidate plan to the tenant's current plan. */
export function planRelation(
  current: SubscriptionTier,
  candidate: SubscriptionTier,
): 'current' | 'upgrade' | 'downgrade' {
  if (current === candidate) return 'current';
  return TIER_RANK[candidate] > TIER_RANK[current] ? 'upgrade' : 'downgrade';
}
