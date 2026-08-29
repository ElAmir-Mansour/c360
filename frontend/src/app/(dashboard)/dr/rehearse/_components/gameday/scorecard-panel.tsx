'use client';

import { type ReactNode } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DRGameDayScorecard } from '@/types/clario-dr';
import { useGameDayLabels, type GameDayLabels } from './gameday-labels';

/** A completed game-day run that can be re-opened by its run id. */
export interface ScorecardRunOption {
  id: string;
  label: string;
}

export interface ScorecardPanelProps {
  /** The scorecard to render (live result or a re-opened prior run). */
  scorecard: DRGameDayScorecard | null;
  /** Completed runs the operator can re-open. */
  runOptions: ScorecardRunOption[];
  /** Currently selected run id (drives `useDRGameDayScorecard` upstream). */
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * Game-day scorecard reader. Shows the run rollup (status, safety verdict,
 * score, faults-reverted, pass tally) and a per-step table of detection /
 * recovery latency against the expected signal with a pass / fail outcome.
 *
 * The operator can re-open any completed run from the run picker (the page
 * drives `useDRGameDayScorecard(selectedRunId)` from that selection); a freshly
 * run scenario passes its scorecard straight in. Read-only — no `dr:write`
 * needed. Token-driven, bilingual, RTL-safe via logical spacing.
 */
export function ScorecardPanel({
  scorecard,
  runOptions,
  selectedRunId,
  onSelectRun,
  loading = false,
  error,
  onRetry,
}: ScorecardPanelProps) {
  const labels = useGameDayLabels();

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle className="text-base">{labels.scorecardHeading}</CardTitle>
          <CardDescription>{labels.scorecardDescription}</CardDescription>
        </div>
        {runOptions.length > 0 ? (
          <div className="min-w-0 space-y-1.5 sm:w-64">
            <Label htmlFor="gameday-scorecard-run" className="text-xs text-muted-foreground">
              {labels.scorecardRunSelectLabel}
            </Label>
            <Select value={selectedRunId ?? undefined} onValueChange={onSelectRun}>
              <SelectTrigger id="gameday-scorecard-run">
                <SelectValue placeholder={labels.scorecardRunSelectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {runOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading && !scorecard ? (
          <LoadingSkeleton variant="card" count={2} />
        ) : error && !scorecard ? (
          <ErrorState message={labels.errorDescription} onRetry={onRetry} />
        ) : !scorecard ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {labels.noScorecard}
          </p>
        ) : (
          <ScorecardBody scorecard={scorecard} labels={labels} />
        )}
      </CardContent>
    </Card>
  );
}

function ScorecardBody({
  scorecard,
  labels,
}: {
  scorecard: DRGameDayScorecard;
  labels: GameDayLabels;
}) {
  const { run, steps } = scorecard;
  const verdictKey = run.safety_verdict?.toLowerCase() ?? '';
  const statusKey = run.status?.toLowerCase() ?? '';

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Datum label={labels.runStatusLabel}>
          <Badge variant={statusVariant(statusKey)} className="normal-case">
            {labels.runStatus[statusKey] ?? run.status}
          </Badge>
        </Datum>
        <Datum label={labels.safetyVerdictLabel}>
          <span className="inline-flex items-center gap-1.5">
            <VerdictIcon verdict={verdictKey} />
            <Badge variant={verdictVariant(verdictKey)} className="normal-case">
              {labels.safetyVerdicts[verdictKey] ?? run.safety_verdict}
            </Badge>
          </span>
        </Datum>
        <Datum label={labels.scoreLabel}>
          <span className="text-lg font-semibold tabular-nums">
            {run.score == null ? '—' : run.score}
          </span>
        </Datum>
        <Datum label={labels.faultsRevertedLabel}>
          <span className="inline-flex items-center gap-1.5 text-sm">
            {run.all_faults_reverted ? (
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
            ) : (
              <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />
            )}
            {run.all_faults_reverted ? labels.faultsReverted : labels.faultsNotReverted}
          </span>
        </Datum>
      </dl>

      <p className="text-sm font-medium">{labels.stepSummary(run.steps_passed, run.steps_total)}</p>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{labels.stepResultsHeading}</h4>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.stepActionColumn}</TableHead>
                <TableHead>{labels.stepSignalColumn}</TableHead>
                <TableHead>{labels.stepDetectColumn}</TableHead>
                <TableHead>{labels.stepRecoverColumn}</TableHead>
                <TableHead>{labels.stepOutcomeColumn}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...steps]
                .sort((left, right) => left.step_index - right.step_index)
                .map((step) => (
                  <TableRow key={step.id}>
                    <TableCell>
                      <div className="font-medium">{step.action}</div>
                      <div className="text-xs text-muted-foreground">{step.target}</div>
                    </TableCell>
                    <TableCell>
                      <div>{step.expected_signal}</div>
                      {step.signal_observed && step.observed_signal ? (
                        <div className="text-xs text-muted-foreground">
                          {labels.observedSignalLabel}: {step.observed_signal}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {step.detection_latency_ms == null
                        ? '—'
                        : labels.millis(step.detection_latency_ms)}
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {step.recovery_latency_ms == null
                        ? '—'
                        : labels.millis(step.recovery_latency_ms)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={step.passed ? 'success' : 'destructive'} className="normal-case">
                        {step.passed ? labels.stepPassed : labels.stepFailed}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function Datum({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-overline font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: string }) {
  if (verdict === 'safe') return <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />;
  if (verdict === 'unsafe') return <XCircle className="h-4 w-4 text-destructive" aria-hidden />;
  return <ShieldAlert className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden />;
}

function verdictVariant(verdict: string): 'success' | 'destructive' | 'warning' {
  if (verdict === 'safe') return 'success';
  if (verdict === 'unsafe') return 'destructive';
  return 'warning';
}

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'outline' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'destructive';
  if (status === 'running' || status === 'pending') return 'warning';
  return 'outline';
}
