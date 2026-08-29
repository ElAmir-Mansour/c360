'use client';

import { useEffect, useState } from 'react';
import {
  CalendarClock,
  ClipboardCheck,
  FileText,
  Hash,
  Loader2,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  DRBCMAssessmentRunResponse,
  DRBCMControlResult,
  DRBCMGap,
  DRBCMPack,
  DRBCMVerdict,
} from '@/lib/clario-dr';
import {
  useBCMAssessmentLabels,
  type BCMAssessmentLabels,
} from './prove-labels';

/**
 * BCMAssessmentPanel
 * ==================
 * Drives the real BCM (Business Continuity Management) compliance assessment for
 * the active protection group. Operators pick a published BCM pack
 * (`DRBCMPack`, from `useDRBCMPacks`) and run `assessDRBCMPack` via the shared
 * `useEvidenceActions().assessBcm`. The latest run response
 * (`DRBCMAssessmentRunResponse`) is shown with its weighted score, compliance
 * verdict, per-control verdicts, and mandatory gaps — consuming only the real
 * backend shapes (no invented fields).
 *
 * The assess control is honestly disabled (with a keyboard-reachable tooltip)
 * when the operator lacks `dr:write` or when no group is selected, matching the
 * console's permission model.
 */
export function BCMAssessmentPanel({
  packs,
  selectedGroupId,
  selectedGroupName,
  latestAssessment,
  loading,
  assessing,
  canWrite,
  error,
  onAssess,
  onRetry,
}: {
  packs: DRBCMPack[];
  selectedGroupId: string | null;
  selectedGroupName: string | null;
  latestAssessment: DRBCMAssessmentRunResponse | null;
  loading: boolean;
  assessing: boolean;
  canWrite: boolean;
  error: unknown;
  onAssess: (packKey: string) => void;
  onRetry: () => void;
}) {
  const L = useBCMAssessmentLabels();
  const [selectedPackKey, setSelectedPackKey] = useState<string | null>(null);

  // Default the pack selection to the first available pack once packs load.
  useEffect(() => {
    if (!selectedPackKey && packs.length > 0) {
      setSelectedPackKey(packs[0].key);
    }
  }, [packs, selectedPackKey]);

  if (loading && packs.length === 0 && !latestAssessment) {
    return <LoadingSkeleton variant="card" count={2} />;
  }

  if (error && packs.length === 0 && !latestAssessment) {
    return <ErrorState message={L.packsLoadError} onRetry={onRetry} />;
  }

  const activePack = packs.find((pack) => pack.key === selectedPackKey) ?? null;
  const assessmentDisabled = !canWrite || !selectedGroupId || !selectedPackKey || assessing;
  const disabledReason = !canWrite ? L.noWriteTooltip : !selectedGroupId ? L.noGroupTooltip : null;

  const assessButton = (
    <Button
      type="button"
      className="w-full sm:w-auto"
      disabled={assessmentDisabled}
      onClick={() => {
        if (selectedPackKey) onAssess(selectedPackKey);
      }}
    >
      {assessing ? (
        <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ClipboardCheck className="me-1.5 h-4 w-4" aria-hidden />
      )}
      {assessing ? L.assessing : L.assessCta}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1.5">
        <CardTitle className="text-base">{L.panelTitle}</CardTitle>
        <CardDescription>{L.panelDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">{formatError(error, L)}</span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor="bcm-pack-select" className="text-caption font-medium text-muted-foreground">
              {L.packSelectLabel}
            </label>
            <Select
              value={selectedPackKey ?? undefined}
              onValueChange={(value) => setSelectedPackKey(value)}
              disabled={packs.length === 0}
            >
              <SelectTrigger id="bcm-pack-select" aria-label={L.packSelectLabel}>
                <SelectValue
                  placeholder={packs.length === 0 ? L.noPacksAvailable : L.selectPack}
                />
              </SelectTrigger>
              <SelectContent>
                {packs.map((pack) => (
                  <SelectItem key={pack.key} value={pack.key}>
                    {pack.title} ({pack.standard} v{pack.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="truncate text-sm font-medium">
                  {activePack?.title ?? L.noPackSelected}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
                {activePack?.description ?? L.choosePack}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activePack ? (
                <Badge variant="outline" className="normal-case">
                  {activePack.authority}
                </Badge>
              ) : null}
              <span className="text-caption text-muted-foreground">
                {L.targetPrefix}: {selectedGroupName ?? selectedGroupId ?? L.noGroup}
              </span>
            </div>
          </div>
        </div>

        {latestAssessment ? (
          <AssessmentResult result={latestAssessment} labels={L} />
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">{L.runPrompt}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssessmentResult({
  result,
  labels: L,
}: {
  result: DRBCMAssessmentRunResponse;
  labels: BCMAssessmentLabels;
}) {
  const { assessment, score, compliant, controls, gaps } = result;
  const roundedScore = Math.round(score);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DetailStatCard tone="slate" icon={ScrollText} label={L.metricPack} value={assessment.pack_key} />
        <DetailStatCard tone="slate" icon={FileText} label={L.metricStandard} value={assessment.standard} />
        <DetailStatCard tone="sky" icon={Hash} label={L.metricControls} value={assessment.total_controls} />
        <DetailStatCard
          tone="gold"
          icon={CalendarClock}
          label={L.metricEvaluated}
          value={formatDateTime(assessment.created_at, L)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption font-medium text-muted-foreground">{L.weightedScore}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{roundedScore}%</span>
            <Badge variant={compliant ? 'success' : 'warning'} className="normal-case">
              {compliant ? L.compliant : L.gapsFound}
            </Badge>
          </div>
        </div>
        <Progress
          value={roundedScore}
          className="h-2"
          indicatorClassName={roundedScore < 100 ? 'bg-amber-500' : 'bg-primary'}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
          <span>
            {assessment.satisfied} {L.satisfiedSuffix}
          </span>
          <span>
            {assessment.partial} {L.partialSuffix}
          </span>
          <span>
            {assessment.failed} {L.failedSuffix}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-caption font-semibold uppercase tracking-caps text-muted-foreground">
            {L.controlVerdicts}
          </div>
          <ul className="space-y-2">
            {controls.length === 0 ? (
              <li className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                {L.noControlResults}
              </li>
            ) : (
              controls.map((control) => (
                <ControlRow key={control.code} control={control} labels={L} />
              ))
            )}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="text-caption font-semibold uppercase tracking-caps text-muted-foreground">
            {L.mandatoryGaps}
          </div>
          <ul className="space-y-2">
            {gaps.length === 0 ? (
              <li className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                {L.noMandatoryGaps}
              </li>
            ) : (
              gaps.map((gap) => <GapRow key={gap.code} gap={gap} labels={L} />)
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ControlRow({
  control,
  labels: L,
}: {
  control: DRBCMControlResult;
  labels: BCMAssessmentLabels;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-muted-foreground">{control.code}</span>
          <span className="truncate text-sm font-medium">{control.title}</span>
          {control.mandatory ? (
            <Badge variant="outline" className="normal-case">
              {L.mandatoryTag}
            </Badge>
          ) : null}
        </div>
        {control.reason ? (
          <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">{control.reason}</p>
        ) : null}
      </div>
      <VerdictBadge verdict={control.verdict} labels={L} />
    </li>
  );
}

function GapRow({ gap, labels: L }: { gap: DRBCMGap; labels: BCMAssessmentLabels }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/25">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-muted-foreground">{gap.code}</span>
          <span className="truncate text-sm font-medium">{gap.title}</span>
        </div>
        {gap.reason ? (
          <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">{gap.reason}</p>
        ) : null}
      </div>
      <VerdictBadge verdict={gap.verdict} labels={L} />
    </li>
  );
}

const VERDICT_VARIANT: Record<DRBCMVerdict, 'success' | 'warning' | 'destructive'> = {
  satisfied: 'success',
  partial: 'warning',
  failed: 'destructive',
};

function verdictLabelFor(L: BCMAssessmentLabels): Record<DRBCMVerdict, string> {
  return {
    satisfied: L.verdictSatisfied,
    partial: L.verdictPartial,
    failed: L.verdictFailed,
  };
}

function VerdictBadge({ verdict, labels: L }: { verdict: DRBCMVerdict; labels: BCMAssessmentLabels }) {
  return (
    <Badge variant={VERDICT_VARIANT[verdict]} className="shrink-0 normal-case">
      {verdictLabelFor(L)[verdict]}
    </Badge>
  );
}

function formatDateTime(value: string | Date | null | undefined, L: BCMAssessmentLabels) {
  if (!value) return L.notAvailable;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return L.notAvailable;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatError(error: unknown, L: BCMAssessmentLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return L.assessError;
}
