'use client';

import { useMemo } from 'react';
import { Gauge, ListChecks, ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import type {
  DRAssuranceAssessmentReport,
  DRAssuranceControlInfo,
  DRAssuranceFinding,
  DRAssuranceSeverity,
  DRAssuranceVerdict,
} from '@/lib/clario-dr';
import {
  useComplianceLabels,
  type CompliancePostureLabels,
} from './compliance-labels';
import {
  ComplianceRagPill,
  ComplianceVerdictBadge,
  ragToTone,
  rollupRag,
  verdictToRag,
} from './compliance-rag';

function verdictLabelFor(L: CompliancePostureLabels): Record<DRAssuranceVerdict, string> {
  return {
    satisfied: L.verdictSatisfied,
    partial: L.verdictPartial,
    failed: L.verdictFailed,
  };
}

function severityLabelFor(L: CompliancePostureLabels): Record<DRAssuranceSeverity, string> {
  return {
    warning: L.severityWarning,
    high: L.severityHigh,
    critical: L.severityCritical,
  };
}

/**
 * Internal DR assurance posture.
 *
 * Maps the assurance control catalogue (`DRAssuranceControlInfo[]`, from
 * `useDRAssuranceControls`) onto the latest group assessment
 * (`DRAssuranceAssessmentReport`, from `useDRAssuranceLatest`). RAG status,
 * weighted score, and the satisfied/partial/failed tally come straight from the
 * stored assessment; the "what is missing" drill-down lists the real
 * `findings[]` (code / title / verdict / severity / message / recommendation)
 * and the assessment's `recommendations[]`. The catalogue size is shown so an
 * operator can see coverage. No fabricated fields.
 */
export function AssurancePosturePanel({
  headingId,
  controls,
  report,
  selectedGroupId,
  selectedGroupName,
  loading,
  error,
  onRetry,
}: {
  /** Id for the heading so the parent `<section>` can label itself. */
  headingId?: string;
  controls: DRAssuranceControlInfo[];
  report: DRAssuranceAssessmentReport | null | undefined;
  selectedGroupId: string | null;
  selectedGroupName: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const L = useComplianceLabels();
  const assessment = report?.assessment ?? null;
  const findings: DRAssuranceFinding[] = useMemo(() => report?.findings ?? [], [report?.findings]);
  const recommendations = useMemo(
    () => report?.recommendations ?? [],
    [report?.recommendations],
  );

  const rag = useMemo(
    () =>
      rollupRag({
        assessed: assessment !== null,
        compliant: assessment?.verdict === 'satisfied',
        failed: assessment?.failed,
        partial: assessment?.partial,
      }),
    [assessment],
  );

  const score = assessment ? Math.round(assessment.score) : null;

  if (loading && controls.length === 0 && !report) {
    return <LoadingSkeleton variant="card" count={1} />;
  }

  if (error && controls.length === 0 && !report) {
    return <ErrorState message={L.assuranceLoadError} onRetry={onRetry} />;
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle id={headingId} className="text-base">
              {L.assuranceHeading}
            </CardTitle>
            <CardDescription>{L.assuranceDescription}</CardDescription>
          </div>
          <ComplianceRagPill rag={rag} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="normal-case">
            <ListChecks className="me-1 h-3.5 w-3.5" aria-hidden />
            {controls.length} {L.controlsLabel.toLowerCase()}
          </Badge>
          <span className="text-caption text-content-muted">
            {L.targetLabel}: {selectedGroupName ?? selectedGroupId ?? L.noGroupSelected}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {!selectedGroupId ? (
          <EmptyState
            icon={ShieldCheck}
            title={L.noGroupSelected}
            description={L.noGroupTooltip}
          />
        ) : !report ? (
          <EmptyState
            icon={ShieldCheck}
            title={L.noAssuranceTitle}
            description={L.noAssuranceDescription}
          />
        ) : (
          <>
            <div className="space-y-3">
              {/* Weighted-score tile: RAG-toned via the documented red→rose /
                  amber→gold / green→emerald bridge (`ragToTone`); value neutral. */}
              <DetailStatCard
                tone={ragToTone(rag)}
                icon={Gauge}
                label={L.scoreLabel}
                value={`${score}%`}
              />
              <Progress
                value={score ?? 0}
                className="h-2"
                indicatorClassName={cn(
                  rag === 'green' && 'bg-state-success',
                  rag === 'amber' && 'bg-state-warning',
                  rag === 'red' && 'bg-state-error',
                )}
              />
              {assessment ? (
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-content-muted">
                  <div className="flex items-center gap-1">
                    <dt className="font-medium">{assessment.satisfied}</dt>
                    <dd>{L.satisfiedCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="font-medium">{assessment.partial}</dt>
                    <dd>{L.partialCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="font-medium">{assessment.failed}</dt>
                    <dd>{L.failedCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="font-medium">{assessment.total_checks}</dt>
                    <dd>{L.controlsLabel.toLowerCase()}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            <AssuranceDrilldown findings={findings} recommendations={recommendations} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AssuranceDrilldown({
  findings,
  recommendations,
}: {
  findings: DRAssuranceFinding[];
  recommendations: string[];
}) {
  const L = useComplianceLabels();
  const missingCount = findings.length;

  if (missingCount === 0 && recommendations.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-outline px-3 py-2 text-caption text-content-muted">
        {L.noFindings}
      </p>
    );
  }

  return (
    <Accordion type="single" collapsible className="rounded-card border border-outline">
      <AccordionItem value="assurance-missing" className="border-b-0">
        <AccordionTrigger className="px-3 text-sm">
          <span className="flex items-center gap-2">
            {L.whatsMissing}
            {missingCount > 0 ? (
              <Badge variant="warning" className="normal-case">
                {missingCount}
              </Badge>
            ) : null}
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-3">
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-overline font-semibold uppercase tracking-caps text-content-muted">
                {L.findingsHeading}
              </h4>
              {findings.length === 0 ? (
                <p className="rounded-card border border-dashed border-outline px-3 py-2 text-caption text-content-muted">
                  {L.noFindings}
                </p>
              ) : (
                <ul className="space-y-2">
                  {findings.map((finding) => (
                    <FindingRow key={`finding-${finding.code}`} finding={finding} />
                  ))}
                </ul>
              )}
            </div>

            {recommendations.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-overline font-semibold uppercase tracking-caps text-content-muted">
                  {L.recommendationsHeading}
                </h4>
                <ul className="space-y-1.5">
                  {recommendations.map((recommendation, index) => (
                    <li
                      key={`rec-${index}`}
                      className="flex items-start gap-2 rounded-card border border-outline px-3 py-2 text-caption text-content-secondary"
                    >
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden />
                      <span className="min-w-0">{recommendation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function FindingRow({ finding }: { finding: DRAssuranceFinding }) {
  const L = useComplianceLabels();
  const verdictLabel = verdictLabelFor(L);
  const severityLabel = severityLabelFor(L);
  return (
    <li className="flex items-start justify-between gap-3 rounded-card border border-outline px-3 py-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-content-muted">{finding.code}</span>
          <span className="text-sm font-medium">{finding.title}</span>
          <Badge variant="outline" className="normal-case">
            {severityLabel[finding.severity] ?? finding.severity}
          </Badge>
        </div>
        {finding.message ? (
          <p className="text-caption text-content-muted">{finding.message}</p>
        ) : null}
        {finding.recommendation ? (
          <p className="text-caption text-content-secondary">
            <span className="font-medium">{L.recommendationLabel}: </span>
            {finding.recommendation}
          </p>
        ) : null}
      </div>
      <ComplianceVerdictBadge
        rag={verdictToRag(finding.verdict)}
        label={verdictLabel[finding.verdict] ?? finding.verdict}
      />
    </li>
  );
}
