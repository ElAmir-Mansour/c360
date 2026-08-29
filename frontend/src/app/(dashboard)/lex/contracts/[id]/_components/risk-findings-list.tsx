'use client';

import Link from 'next/link';
import { BookPlus, Eye, Sparkles } from 'lucide-react';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LexRiskLevel } from '@/types/suites';
import { toIndicatorSeverity } from './risk-severity';

/** A single actionable risk / missing-clause finding. */
export interface RiskFinding {
  /** Headline of the finding (e.g. "Missing limitation of liability"). */
  title: string;
  /** Severity / risk level driving the badge. */
  severity: LexRiskLevel | string | null | undefined;
  /** Suggested remediation. Optional — row still renders without it. */
  recommendation?: string | null;
  /** Optional longer description shown under the title. */
  description?: string | null;
  /** Optional clause type used to deep-link the clause library. */
  clauseType?: string | null;
  /** Stable key when title is not unique (e.g. clause_reference). */
  id?: string | null;
  /** Optional localized label for the severity token. */
  severityLabel?: string | null;
}

/** Bilingual copy for the findings rows, resolved by the parent detail page. */
export interface RiskFindingsListLabels {
  recommendationPrefix: string;
  addClause: string;
  draftWithAi: string;
  view: string;
}

const DEFAULT_FINDINGS_LABELS: RiskFindingsListLabels = {
  recommendationPrefix: 'Recommendation: ',
  addClause: 'Add clause',
  draftWithAi: 'Draft with AI',
  view: 'View',
};

export interface RiskFindingsListProps {
  /** Findings to render (key risks + missing-clause findings, consolidated). */
  findings: RiskFinding[];
  /** Contract id — used to scope the AI drafting / clause-library deep links. */
  contractId: string;
  /**
   * Switch the page to the analysis tab (for the "View" CTA). When omitted,
   * the View action is hidden.
   */
  onView?: (finding: RiskFinding) => void;
  /** Rendered when there are no findings. */
  emptyLabel?: string;
  /** Resolved bilingual copy for the row CTAs + recommendation prefix. */
  labels?: RiskFindingsListLabels;
  className?: string;
}

function findingKey(finding: RiskFinding, index: number): string {
  return finding.id ?? `${finding.title}-${finding.clauseType ?? 'na'}-${index}`;
}

/**
 * RiskFindingsList — actionable findings rows.
 *
 * Each row surfaces title + severity badge + recommendation alongside remediation
 * CTAs:
 *   • "Add clause"   → /lex/clause-library (Link)
 *   • "Draft with AI" → /lex/drafting       (Link, scoped to the contract)
 *   • "View"          → onView callback (switch to the analysis tab)
 *
 * Presentational only; consumes DS tokens, the shared SeverityIndicator and the
 * Button primitive. Hover motion comes from the global `.card-interactive`
 * transition tokens, which are prefers-reduced-motion safe.
 */
export function RiskFindingsList({
  findings,
  contractId,
  onView,
  emptyLabel = 'No risk findings — run analysis to surface clause-level risks.',
  labels = DEFAULT_FINDINGS_LABELS,
  className,
}: RiskFindingsListProps) {
  if (findings.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className={cn('space-y-3', className)}>
      {findings.map((finding, index) => {
        const clauseHref = finding.clauseType
          ? `/lex/clause-library?clause_type=${encodeURIComponent(finding.clauseType)}`
          : '/lex/clause-library';
        const draftHref = `/lex/drafting?contract_id=${encodeURIComponent(contractId)}`;
        return (
          <li
            key={findingKey(finding, index)}
            className="card p-4 transition-colors hover:border-primary/25"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{finding.title}</p>
                  <SeverityIndicator
                    severity={toIndicatorSeverity(finding.severity)}
                    showLabel={!finding.severityLabel}
                    size="sm"
                  />
                  {finding.severityLabel ? (
                    <span className="text-overline font-medium text-muted-foreground">
                      {finding.severityLabel}
                    </span>
                  ) : null}
                </div>
                {finding.description ? (
                  <p className="text-sm text-muted-foreground">{finding.description}</p>
                ) : null}
                {finding.recommendation ? (
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{labels.recommendationPrefix}</span>
                    <span className="text-muted-foreground">{finding.recommendation}</span>
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
              <Button size="sm" variant="outline" asChild>
                <Link href={clauseHref}>
                  <BookPlus className="me-1.5 h-3.5 w-3.5" />
                  {labels.addClause}
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={draftHref}>
                  <Sparkles className="me-1.5 h-3.5 w-3.5" />
                  {labels.draftWithAi}
                </Link>
              </Button>
              {onView ? (
                <Button size="sm" variant="ghost" onClick={() => onView(finding)}>
                  <Eye className="me-1.5 h-3.5 w-3.5" />
                  {labels.view}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
