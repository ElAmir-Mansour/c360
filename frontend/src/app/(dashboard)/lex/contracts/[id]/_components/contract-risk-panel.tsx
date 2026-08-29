'use client';

import { Button } from '@/components/ui/button';

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import type { LexRiskLevel } from '@/types/suites';
import { toIndicatorSeverity } from './risk-severity';

/** Bilingual copy the panel renders, resolved by the parent detail page. */
export interface ContractRiskPanelLabels {
  ariaLabel: string;
  riskScore: string;
  /** Wraps the localized severity label, e.g. "High risk" / "مخاطر مرتفعة". */
  riskSuffix: (severity: string) => string;
  clausesReviewed: string;
  missingClauses: string;
  complianceFlags: string;
}

export interface ContractRiskPanelProps {
  /** Authoritative risk score (e.g. 57). When null/undefined, shown as "—". */
  score: number | null | undefined;
  /** Authoritative severity / risk level (critical | high | medium | low | none). */
  severity: LexRiskLevel | string | null | undefined;
  /** Localized severity label resolved by the parent (e.g. "High" / "مرتفع"). */
  severityLabel?: string | null;
  /** Resolved bilingual copy for the panel chrome. */
  labels: ContractRiskPanelLabels;
  /** One-line risk summary / rationale. Optional. */
  summary?: string | null;
  /** Count of clauses reviewed in the latest analysis. */
  clausesReviewed?: number | null;
  /** Count of missing / recommended clauses flagged. */
  missingClauses?: number | null;
  /** Count of open compliance flags. */
  complianceFlags?: number | null;
  onOpenScore: () => void;
  onOpenClauses: () => void;
  onOpenMissingClauses: () => void;
  onOpenComplianceFlags: () => void;
  className?: string;
}

/** Score band drives the accent ring/background tone of the panel. */
function scoreTone(score: number | null | undefined): {
  ring: string;
  scoreText: string;
} {
  if (score == null) {
    return { ring: 'border-border/70', scoreText: 'text-muted-foreground' };
  }
  if (score >= 70) {
    return {
      ring: 'border-error-500/40',
      scoreText: 'text-error-700 dark:text-error-300',
    };
  }
  if (score >= 40) {
    return {
      ring: 'border-warning-500/40',
      scoreText: 'text-warning-700 dark:text-warning-300',
    };
  }
  return {
    ring: 'border-success-500/40',
    scoreText: 'text-success-700 dark:text-success-300',
  };
}

function CountChip({
  label,
  value,
  onAction,
  className = 'badge-neutral',
}: {
  label: string;
  value: number;
  onAction: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className={cn('badge-base h-auto font-normal transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <span className="font-bold tabular-nums">{value}</span>
      <span className="font-medium opacity-80">{label}</span>
    </Button>
  );
}

/**
 * ContractRiskPanel — single authoritative risk display.
 *
 * Replaces the triplicated risk presentation (metric card, brief panel, and
 * analysis summary) with one panel that surfaces severity + score + a one-line
 * set of drivers/counts. Purely presentational; consumes DS tokens, badges and
 * the shared SeverityIndicator. Motion is opacity/transform-light and respects
 * prefers-reduced-motion via the global `.card` transition tokens.
 */
export function ContractRiskPanel({
  score,
  severity,
  severityLabel,
  labels,
  summary,
  clausesReviewed,
  missingClauses,
  complianceFlags,
  onOpenScore,
  onOpenClauses,
  onOpenMissingClauses,
  onOpenComplianceFlags,
  className,
}: ContractRiskPanelProps) {
  const tone = scoreTone(score ?? null);
  const indicatorSeverity = toIndicatorSeverity(severity);
  const hasCounts =
    (clausesReviewed != null && clausesReviewed > 0) ||
    (missingClauses != null && missingClauses > 0) ||
    (complianceFlags != null && complianceFlags > 0);

  return (
    <div
      className={cn('card border-s-4 p-5', tone.ring, className)}
      role="group"
      aria-label={labels.ariaLabel}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onOpenScore}
            className="h-auto flex-col items-center justify-center rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-center font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn('text-[2rem] font-bold leading-none tabular-nums', tone.scoreText)}>
              {score == null ? '—' : formatNumber(score)}
            </span>
            <span className="mt-1 text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">
              {labels.riskScore}
            </span>
          </Button>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityIndicator severity={indicatorSeverity} size="md" />
              {severity ? (
                <span className="text-sm font-semibold text-foreground">
                  {labels.riskSuffix(severityLabel ?? String(severity))}
                </span>
              ) : null}
            </div>
            {summary ? (
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{summary}</p>
            ) : null}
          </div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {indicatorSeverity === 'low' || indicatorSeverity === 'info' ? (
            <ShieldCheck className="h-4 w-4" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden />
          )}
        </div>
      </div>

      {hasCounts ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
          {clausesReviewed != null && clausesReviewed > 0 ? (
            <CountChip label={labels.clausesReviewed} value={clausesReviewed} onAction={onOpenClauses} />
          ) : null}
          {missingClauses != null && missingClauses > 0 ? (
            <CountChip
              label={labels.missingClauses}
              value={missingClauses}
              onAction={onOpenMissingClauses}
              className="badge-warning"
            />
          ) : null}
          {complianceFlags != null && complianceFlags > 0 ? (
            <CountChip
              label={labels.complianceFlags}
              value={complianceFlags}
              onAction={onOpenComplianceFlags}
              className="badge-danger"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
