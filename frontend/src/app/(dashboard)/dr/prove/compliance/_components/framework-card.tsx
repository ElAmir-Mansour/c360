'use client';

import { useMemo } from 'react';
import { ClipboardCheck, FileText, Gauge, Loader2 } from 'lucide-react';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type {
  DRBCMAssessmentRunResponse,
  DRBCMControlResult,
  DRBCMGap,
  DRBCMPack,
  DRBCMVerdict,
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

function verdictLabelFor(L: CompliancePostureLabels): Record<DRBCMVerdict, string> {
  return {
    satisfied: L.verdictSatisfied,
    partial: L.verdictPartial,
    failed: L.verdictFailed,
  };
}

/**
 * One control-framework posture card.
 *
 * Maps a real published BCM pack (`DRBCMPack` — NCA ECC / SAMA BCM / internal
 * policy, whatever the backend publishes) onto its latest live assessment
 * (`DRBCMAssessmentRunResponse`, produced by `assessDRBCMPack`). The card renders
 * a RAG status (icon + text + `state-*` token), the weighted score, the
 * satisfied/partial/failed tally, and a "what is missing" drill-down assembled
 * entirely from the real `gaps[]` + `control_results[]` fields — no fabricated
 * control catalogue.
 *
 * The assess control is honestly disabled (keyboard-reachable tooltip) when the
 * operator lacks `dr:write` or when no group is selected.
 */
export function FrameworkCard({
  pack,
  assessment,
  selectedGroupId,
  selectedGroupName,
  canWrite,
  assessing,
  onAssess,
}: {
  pack: DRBCMPack;
  /** Latest assessment for THIS pack (matched by pack_key by the parent), or null. */
  assessment: DRBCMAssessmentRunResponse | null;
  selectedGroupId: string | null;
  selectedGroupName: string | null;
  canWrite: boolean;
  assessing: boolean;
  onAssess: (packKey: string) => void;
}) {
  const L = useComplianceLabels();
  const assessed = assessment !== null;
  const score = assessment ? Math.round(assessment.score) : null;

  const rag = useMemo(
    () =>
      rollupRag({
        assessed,
        compliant: assessment?.compliant,
        failed: assessment?.assessment.failed,
        partial: assessment?.assessment.partial,
      }),
    [assessed, assessment],
  );

  // "What is missing" = real mandatory gaps + any failed/partial control results.
  const gaps: DRBCMGap[] = assessment?.gaps ?? [];
  const outstandingControls = useMemo(
    () => (assessment?.controls ?? []).filter((control) => control.verdict !== 'satisfied'),
    [assessment?.controls],
  );
  const missingCount = gaps.length + outstandingControls.length;

  const assessDisabled = !canWrite || !selectedGroupId || assessing;
  const disabledReason = !canWrite ? L.noWriteTooltip : !selectedGroupId ? L.noGroupTooltip : null;

  const assessButton = (
    <Button
      type="button"
      size="sm"
      variant={assessed ? 'outline' : 'default'}
      className="w-full sm:w-auto"
      disabled={assessDisabled}
      onClick={() => onAssess(pack.key)}
    >
      {assessing ? (
        <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ClipboardCheck className="me-1.5 h-4 w-4" aria-hidden />
      )}
      {assessing ? L.assessingCta : assessed ? L.reassessCta : L.assessCta}
    </Button>
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{pack.title}</CardTitle>
            <CardDescription className="line-clamp-2">{pack.description}</CardDescription>
          </div>
          <ComplianceRagPill rag={rag} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="normal-case">
            {pack.authority}
          </Badge>
          <span className="text-caption text-content-muted">
            {pack.standard} · {L.versionLabel} {pack.version}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {assessment ? (
          <div className="space-y-3">
            {/* Weighted-score tile: RAG-toned via the documented red→rose / amber→gold
                / green→emerald bridge (`ragToTone`); the value stays neutral. */}
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
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-content-muted">
              <div className="flex items-center gap-1">
                <dt className="font-medium">{assessment.assessment.satisfied}</dt>
                <dd>{L.satisfiedCount}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="font-medium">{assessment.assessment.partial}</dt>
                <dd>{L.partialCount}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="font-medium">{assessment.assessment.failed}</dt>
                <dd>{L.failedCount}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="font-medium">{assessment.assessment.total_controls}</dt>
                <dd>{L.controlsLabel.toLowerCase()}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-card border border-dashed border-outline px-3 py-3 text-sm text-content-muted">
            <FileText className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">{L.notAssessedYet}</span>
          </div>
        )}

        {assessment ? (
          <FrameworkDrilldown
            packKey={pack.key}
            gaps={gaps}
            outstandingControls={outstandingControls}
            missingCount={missingCount}
          />
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="truncate text-caption text-content-muted">
            {L.targetLabel}: {selectedGroupName ?? selectedGroupId ?? L.noGroupSelected}
          </span>
          {disabledReason ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex focus-visible:outline-none">
                    {assessButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            assessButton
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FrameworkDrilldown({
  packKey,
  gaps,
  outstandingControls,
  missingCount,
}: {
  packKey: string;
  gaps: DRBCMGap[];
  outstandingControls: DRBCMControlResult[];
  missingCount: number;
}) {
  const L = useComplianceLabels();
  if (missingCount === 0) {
    return (
      <p className="rounded-card border border-dashed border-outline px-3 py-2 text-caption text-content-muted">
        {L.noGaps}
      </p>
    );
  }

  return (
    <Accordion type="single" collapsible className="rounded-card border border-outline">
      <AccordionItem value={`missing-${packKey}`} className="border-b-0">
        <AccordionTrigger className="px-3 text-sm">
          <span className="flex items-center gap-2">
            {L.whatsMissing}
            <Badge variant="warning" className="normal-case">
              {missingCount}
            </Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-3">
          <div className="space-y-4">
            {gaps.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-overline font-semibold uppercase tracking-caps text-content-muted">
                  {L.gapsHeading}
                </h4>
                <ul className="space-y-2">
                  {gaps.map((gap) => (
                    <GapRow key={`gap-${gap.code}`} gap={gap} />
                  ))}
                </ul>
              </div>
            ) : null}

            {outstandingControls.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-overline font-semibold uppercase tracking-caps text-content-muted">
                  {L.controlsHeading}
                </h4>
                <ul className="space-y-2">
                  {outstandingControls.map((control) => (
                    <ControlRow key={`ctrl-${control.code}`} control={control} />
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

function GapRow({ gap }: { gap: DRBCMGap }) {
  const L = useComplianceLabels();
  const verdictLabel = verdictLabelFor(L);
  return (
    <li className="flex items-start justify-between gap-3 rounded-card border border-outline px-3 py-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-content-muted">{gap.code}</span>
          <span className="text-sm font-medium">{gap.title}</span>
          {gap.mandatory ? (
            <Badge variant="outline" className="normal-case">
              {L.mandatoryTag}
            </Badge>
          ) : null}
        </div>
        {gap.reason ? (
          <p className="text-caption text-content-muted">
            <span className="font-medium">{L.reasonLabel}: </span>
            {gap.reason}
          </p>
        ) : null}
      </div>
      <ComplianceVerdictBadge rag={verdictToRag(gap.verdict)} label={verdictLabel[gap.verdict]} />
    </li>
  );
}

function ControlRow({ control }: { control: DRBCMControlResult }) {
  const L = useComplianceLabels();
  const verdictLabel = verdictLabelFor(L);
  return (
    <li className="flex items-start justify-between gap-3 rounded-card border border-outline px-3 py-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-content-muted">{control.code}</span>
          <span className="text-sm font-medium">{control.title}</span>
          {control.mandatory ? (
            <Badge variant="outline" className="normal-case">
              {L.mandatoryTag}
            </Badge>
          ) : null}
        </div>
        {control.reason ? (
          <p className="text-caption text-content-muted">
            <span className="font-medium">{L.reasonLabel}: </span>
            {control.reason}
          </p>
        ) : null}
      </div>
      <ComplianceVerdictBadge
        rag={verdictToRag(control.verdict)}
        label={verdictLabel[control.verdict]}
      />
    </li>
  );
}
