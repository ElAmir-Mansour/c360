'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2 } from 'lucide-react';
import {
  PostImplementationReviewPanel,
  gateIndexForStatus,
  isTerminalFailure,
  type PIRGate,
  type PIRGateKey,
  type PIRGateOutcome,
} from '@/components/product';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchDRFailoverAttestation,
  fetchDRFailoverSteps,
  type DRFailoverRun,
  type DRFailoverStep,
} from '@/lib/clario-dr';
import { useDRLabels } from '../../_lib/dr-i18n';
import { usePIRReviewLabels } from './prove-labels';

/**
 * PIRReview
 * =========
 * Renders the design-system `PostImplementationReviewPanel` for a selected
 * terminal (completed/attested/failed) failover run. The operator picks a run
 * from the runs feed; this component fetches that run's real execution steps
 * (`fetchDRFailoverSteps`) and immutable attestation (`fetchDRFailoverAttestation`)
 * and derives the four-gate outcome strip honestly from the step records and the
 * run status — no fabricated outcomes.
 *
 * Per the console design, the PIR's reviewer-authored `issues` and follow-up
 * `actionItems` are honestly-empty arrays (the backend emits no such records),
 * so the panel shows its empty states for those sections rather than inventing
 * content.
 */

/** Terminal run statuses for which a post-implementation review is meaningful. */
const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'ATTESTED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
]);

/** Map a backend step name to the PIR gate it belongs to (null = non-gate step). */
function gateForStep(step: string): PIRGateKey | null {
  const lower = step.toLowerCase();
  if (lower.startsWith('gate1')) return 'validate';
  if (lower.startsWith('gate2')) return 'approve';
  if (lower.startsWith('gate3')) return 'execute';
  if (lower.startsWith('gate4')) return 'attest';
  return null;
}

const GATE_ORDER: PIRGateKey[] = ['validate', 'approve', 'execute', 'attest'];
const GATE_INDEX: Record<PIRGateKey, number> = { validate: 0, approve: 1, execute: 2, attest: 3 };

/**
 * Derive the four-gate outcome strip from the real step records, falling back to
 * the run status for gates that emitted no step record yet.
 */
function deriveGates(
  run: DRFailoverRun,
  steps: DRFailoverStep[],
  signedOffBy: (approver: string) => string,
): PIRGate[] {
  // Collect step statuses per gate.
  const byGate = new Map<PIRGateKey, DRFailoverStep[]>();
  for (const step of steps) {
    const gate = gateForStep(step.step);
    if (!gate) continue;
    const list = byGate.get(gate) ?? [];
    list.push(step);
    byGate.set(gate, list);
  }

  const clearedGates = gateIndexForStatus(run.status); // [0..4]
  const runFailed = isTerminalFailure(run.status);

  return GATE_ORDER.map((gate) => {
    const gateSteps = byGate.get(gate) ?? [];
    let outcome: PIRGateOutcome;

    if (gateSteps.length > 0) {
      const anyFailed = gateSteps.some((step) => step.status.toLowerCase() === 'failed');
      const allPassed = gateSteps.every((step) => step.status.toLowerCase() === 'passed');
      outcome = anyFailed ? 'failed' : allPassed ? 'passed' : 'pending';
    } else if (clearedGates > GATE_INDEX[gate]) {
      // The run status has progressed past this gate even without a step record.
      outcome = 'passed';
    } else if (runFailed) {
      // A failed run never reached this gate.
      outcome = 'skipped';
    } else {
      outcome = 'pending';
    }

    const detail =
      gate === 'approve' && run.approved_by ? signedOffBy(run.approved_by) : undefined;

    return { key: gate, outcome, detail };
  });
}

export function PIRReview({ runs }: { runs: DRFailoverRun[] }) {
  const { pirLabels } = useDRLabels();
  const L = usePIRReviewLabels();
  const terminalRuns = useMemo(
    () => runs.filter((run) => TERMINAL_RUN_STATUSES.has(run.status.toUpperCase())),
    [runs],
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const effectiveRunId = selectedRunId ?? terminalRuns[0]?.id ?? null;
  const selectedRun = terminalRuns.find((run) => run.id === effectiveRunId) ?? null;

  const stepsQuery = useQuery<DRFailoverStep[]>({
    queryKey: ['clario-dr', 'failover-run-steps', effectiveRunId],
    queryFn: () => fetchDRFailoverSteps(effectiveRunId!),
    enabled: Boolean(effectiveRunId),
    refetchInterval: 120_000,
  });

  const attestationQuery = useQuery({
    queryKey: ['clario-dr', 'failover-run-attestation', effectiveRunId],
    queryFn: () => fetchDRFailoverAttestation(effectiveRunId!),
    enabled: Boolean(effectiveRunId),
    refetchInterval: 120_000,
    // Drill runs and failed runs may have no sealed attestation — treat a miss as
    // "no attestation" rather than retrying a 404.
    retry: false,
  });

  if (terminalRuns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L.panelTitle}</CardTitle>
          <CardDescription>{L.emptyDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            <CalendarCheck2 className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">{L.emptyNotice}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const steps = stepsQuery.data ?? [];
  const gates = selectedRun ? deriveGates(selectedRun, steps, L.signedOffBy) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-1.5">
          <CardTitle className="text-base">{L.panelTitle}</CardTitle>
          <CardDescription>{L.selectDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 sm:max-w-md">
            <label htmlFor="pir-run-select" className="text-caption font-medium text-muted-foreground">
              {L.runSelectLabel}
            </label>
            <Select
              value={effectiveRunId ?? undefined}
              onValueChange={(value) => setSelectedRunId(value)}
            >
              <SelectTrigger id="pir-run-select" aria-label={L.runSelectLabel}>
                <SelectValue placeholder={L.runSelectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {terminalRuns.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.id} · {run.mode} · {run.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedRun ? null : stepsQuery.isLoading && steps.length === 0 ? (
        <LoadingSkeleton variant="card" count={2} />
      ) : stepsQuery.error && steps.length === 0 ? (
        <ErrorState
          message={L.stepsLoadError}
          onRetry={() => void stepsQuery.refetch()}
        />
      ) : (
        <PostImplementationReviewPanel
          run={selectedRun}
          attestation={attestationQuery.data ?? undefined}
          steps={steps}
          gates={gates}
          issues={[]}
          actionItems={[]}
          labels={pirLabels}
          stepLabels={L.stepLabels}
        />
      )}
    </div>
  );
}
