/**
 * Board-view support for the contracts list: the lifecycle column order and the
 * allowed status-transition map. The transition map mirrors the one enforced on
 * the contract detail page (`[id]/page.tsx`) so a drag-to-move on the board only
 * attempts transitions the backend will accept.
 */
import type { LexContractStatus } from '@/types/suites';

/** Lifecycle columns rendered (left → right) on the contracts board. */
export const CONTRACT_BOARD_COLUMN_ORDER: LexContractStatus[] = [
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
  'suspended',
  'expired',
  'renewed',
  'terminated',
  'cancelled',
];

/** Allowed forward/back transitions per status (mirrors the detail page). */
export const CONTRACT_STATUS_TRANSITIONS: Record<LexContractStatus, LexContractStatus[]> = {
  draft: ['internal_review', 'cancelled'],
  internal_review: ['legal_review', 'draft'],
  legal_review: ['negotiation', 'internal_review', 'draft'],
  negotiation: ['pending_signature', 'cancelled', 'draft'],
  pending_signature: ['cancelled'],
  active: ['suspended', 'terminated', 'expired', 'renewed'],
  suspended: ['active', 'terminated'],
  expired: ['renewed'],
  terminated: [],
  renewed: [],
  cancelled: [],
};

/** True when `to` is a permitted next status from `from`. */
export function isAllowedContractTransition(
  from: LexContractStatus,
  to: LexContractStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return (CONTRACT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Semantic accent color per board column, keyed by status. Tones follow the
 * platform vocabulary: in-flight review states ride the brand teals
 * (`brand-teal` → `brand-primary`, progressing deeper toward sign-off),
 * time-pressured states (`negotiation`, `pending_signature`, `suspended`) ride
 * `warning`, healthy states (`active`, `renewed`) ride `success` (emerald),
 * terminal `expired`/`terminated` ride the semantic `error` ramp, and inert
 * draft/cancelled states stay neutral (muted).
 */
export const CONTRACT_BOARD_COLUMN_COLOR: Record<LexContractStatus, string> = {
  draft: 'bg-muted-foreground/40',
  internal_review: 'bg-brand-teal-500/70',
  legal_review: 'bg-brand-primary-600/70',
  negotiation: 'bg-warning-300/70',
  pending_signature: 'bg-warning-500/70',
  active: 'bg-success-500/70',
  suspended: 'bg-warning-500/70',
  expired: 'bg-error-300/70',
  renewed: 'bg-success-300/70',
  terminated: 'bg-error-500/60',
  cancelled: 'bg-muted-foreground/40',
};
