import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { StatTone } from '@/components/shared/stat-card';

/**
 * Shared LEX governance-status mapping consumed by the regulations and
 * clause-library knowledge surfaces so both pages tone identically.
 *
 * Semantic tone vocabulary (restrained, RAG-aligned):
 *   pending_review → sky   (queued / awaiting triage)
 *   in_review      → gold  (time-bound review in flight)
 *   approved/active → emerald (health / cleared)
 *   rejected       → rose  (risk / blocked)
 *
 * The `Badge` UI primitive is frozen and has no `sky` variant, so `pending`
 * keeps the historic `outline` treatment while still carrying its semantic
 * `tone` for any tonal stat surface that wants the accent. The variant mapping
 * below is byte-identical to the two inline implementations it replaces.
 */
export function normalizeGovernanceStatus(status?: string | null): string {
  return status?.trim() || 'pending_review';
}

/** Map a normalized governance status to its restrained semantic tone. */
export function governanceTone(normalized: string): StatTone {
  switch (normalized) {
    case 'approved':
    case 'active':
      return 'emerald';
    case 'rejected':
      return 'rose';
    case 'in_review':
      return 'gold';
    case 'pending_review':
      return 'sky';
    default:
      return 'neutral';
  }
}

/** Map a normalized governance status to the frozen `Badge` variant. */
export function governanceBadgeVariant(normalized: string): BadgeProps['variant'] {
  switch (normalized) {
    case 'approved':
    case 'active':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'in_review':
    case 'pending_review':
      return 'warning';
    default:
      return 'outline';
  }
}

/**
 * Shared governance badge. The display label is resolved by the caller (each
 * knowledge surface keeps its own localized label table), so this component
 * owns only the status→variant mapping that must stay aligned across pages.
 */
export function GovernanceStatusBadge({
  status,
  label,
}: {
  status?: string | null;
  label: string;
}) {
  const normalized = normalizeGovernanceStatus(status);
  return <Badge variant={governanceBadgeVariant(normalized)}>{label}</Badge>;
}
