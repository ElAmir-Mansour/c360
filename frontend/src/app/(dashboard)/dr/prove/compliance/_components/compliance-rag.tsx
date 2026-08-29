'use client';

import { CheckCircle2, CircleHelp, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StatTone } from '@/components/shared/stat-card';
import type { DRAssuranceVerdict, DRBCMVerdict } from '@/lib/clario-dr';
import {
  useComplianceLabels,
  type CompliancePostureLabels,
} from './compliance-labels';

/**
 * RAG (red / amber / green / unknown) status vocabulary for the compliance
 * posture board.
 *
 * Accessibility: status is ALWAYS conveyed by a token-driven colour AND an icon
 * AND text (never colour alone), satisfying WCAG 2.1 AA 1.4.1. Colours are
 * design-system `state-*` tokens (success / warning / error / info) — no hex, no
 * arbitrary values. Spacing/borders use logical properties so the chip is
 * RTL-safe.
 */

export type ComplianceRag = 'green' | 'amber' | 'red' | 'unknown';

/**
 * Bridge the compliance RAG vocabulary onto the platform's semantic tonal
 * accent (`StatTone`) so scored posture tiles ride the materialized
 * `.kpi-theme-*` surfaces without clashing with the RAG `state-*` chips/pills.
 *
 * The mapping is the deliberate, documented alignment from the uplift plan:
 *   - red   → rose    (risk / non-compliant)
 *   - amber → gold    (caution / partial)
 *   - green → emerald (healthy / compliant)
 *   - unknown → neutral (no assessment yet — keeps the legacy flat tile)
 *
 * RAG status itself stays conveyed by the icon + text + `state-*` token on the
 * `ComplianceRagPill` / `ComplianceVerdictBadge` (WCAG 2.1 AA); the tone is a
 * decorative accent only, so the two systems read consistently rather than
 * competing.
 */
export function ragToTone(rag: ComplianceRag): StatTone {
  switch (rag) {
    case 'red':
      return 'rose';
    case 'amber':
      return 'gold';
    case 'green':
      return 'emerald';
    default:
      return 'neutral';
  }
}

interface RagMeta {
  icon: LucideIcon;
  label: string;
  srLabel: string;
  /** Foreground token. */
  text: string;
  /** Chip container token (border + tinted bg). */
  chip: string;
  /** Solid swatch token (used for the leading status dot). */
  dot: string;
}

/**
 * Build the locale-resolved RAG metadata map from the active compliance labels.
 * Icons + design-system `state-*` tokens are locale-invariant; only the visible
 * label and its screen-reader description vary by locale.
 */
function ragMetaFor(L: CompliancePostureLabels): Record<ComplianceRag, RagMeta> {
  return {
    green: {
      icon: CheckCircle2,
      label: L.ragGreen,
      srLabel: L.ragGreenSr,
      text: 'text-state-success',
      chip: 'border-state-success/40 bg-state-success/10 text-state-success',
      dot: 'bg-state-success',
    },
    amber: {
      icon: TriangleAlert,
      label: L.ragAmber,
      srLabel: L.ragAmberSr,
      text: 'text-state-warning',
      chip: 'border-state-warning/40 bg-state-warning/10 text-state-warning',
      dot: 'bg-state-warning',
    },
    red: {
      icon: XCircle,
      label: L.ragRed,
      srLabel: L.ragRedSr,
      text: 'text-state-error',
      chip: 'border-state-error/40 bg-state-error/10 text-state-error',
      dot: 'bg-state-error',
    },
    unknown: {
      icon: CircleHelp,
      label: L.ragUnknown,
      srLabel: L.ragUnknownSr,
      text: 'text-state-info',
      chip: 'border-state-info/40 bg-state-info/10 text-state-info',
      dot: 'bg-state-info',
    },
  };
}

/** Map a satisfied/partial/failed verdict to a RAG bucket. */
export function verdictToRag(verdict: DRBCMVerdict | DRAssuranceVerdict): ComplianceRag {
  switch (verdict) {
    case 'satisfied':
      return 'green';
    case 'partial':
      return 'amber';
    case 'failed':
      return 'red';
    default:
      return 'unknown';
  }
}

/**
 * Derive an overall RAG for a framework from its scored evidence. `failed > 0`
 * is the strongest signal (non-compliant); otherwise any `partial` downgrades to
 * amber; a fully-satisfied framework is green; absence of an assessment is
 * unknown.
 */
export function rollupRag(args: {
  assessed: boolean;
  compliant?: boolean;
  failed?: number;
  partial?: number;
}): ComplianceRag {
  if (!args.assessed) return 'unknown';
  if ((args.failed ?? 0) > 0) return 'red';
  if ((args.partial ?? 0) > 0) return 'amber';
  if (args.compliant) return 'green';
  // Assessed, no failures/partials recorded but not flagged compliant — treat as
  // amber rather than over-claiming green.
  return 'amber';
}

/**
 * The headline RAG status pill: a solid status dot + icon + the status word.
 * Used at the framework-card level.
 */
export function ComplianceRagPill({
  rag,
  className,
}: {
  rag: ComplianceRag;
  className?: string;
}) {
  const L = useComplianceLabels();
  const meta = ragMetaFor(L)[rag];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-caption font-semibold',
        meta.chip,
        className,
      )}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-pill', meta.dot)} aria-hidden />
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{meta.label}</span>
      <span className="sr-only">{meta.srLabel}</span>
    </span>
  );
}

/**
 * A compact verdict badge for per-control / per-finding rows. Conveys the
 * verdict by icon + word + token colour.
 */
export function ComplianceVerdictBadge({
  rag,
  label,
  className,
}: {
  rag: ComplianceRag;
  label: string;
  className?: string;
}) {
  const L = useComplianceLabels();
  const meta = ragMetaFor(L)[rag];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-caption font-medium',
        meta.chip,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  );
}
