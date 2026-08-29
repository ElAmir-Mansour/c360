import type { DRFailoverRun, DRFailoverStep } from '@/types/clario-dr';
import {
  gateIndexForStatus,
  isTerminalFailure,
  isTerminalSuccess,
  type PIRGate,
  type PIRGateKey,
} from '@/components/product';

/**
 * UI-only derivations for the live execution view (`/dr/runs/[id]`).
 *
 * The backend models a failover run as a status + an ordered list of
 * `DRFailoverStep` rows; it does NOT emit a separate four-gate outcome object.
 * The design-system `PostImplementationReviewPanel` and four-gate visual expect
 * a `PIRGate[]`, so we derive it honestly from the REAL run status and step
 * rows. No fields are invented — every input comes from `DRFailoverRun` /
 * `DRFailoverStep`.
 */

const GATE_ORDER: PIRGateKey[] = ['validate', 'approve', 'execute', 'attest'];

/** Whether a run is in a terminal (no-longer-advancing) state. */
export function isTerminalRun(run: DRFailoverRun): boolean {
  return isTerminalSuccess(run.status) || isTerminalFailure(run.status);
}

/**
 * Derive the four-gate outcome from the run status and emitted steps.
 *
 *  - Gates fully cleared (index below the run's current gate index) => `passed`.
 *  - The gate the run is currently parked at => `pending`.
 *  - On a terminal FAILURE, the current gate is `failed` and later gates are
 *    `skipped`.
 *  - On a terminal SUCCESS, every gate up to and including attest is `passed`.
 *
 * Step rows refine the gate detail (e.g. a failed step name surfaces in the
 * gate's note).
 */
export function deriveFailoverGates(
  run: DRFailoverRun,
  steps: DRFailoverStep[],
): PIRGate[] {
  const gateIndex = gateIndexForStatus(run.status);
  const success = isTerminalSuccess(run.status);
  const failure = isTerminalFailure(run.status);
  const failedStep = steps.find((step) => normalize(step.status) === 'failed');

  return GATE_ORDER.map((key, index) => {
    if (success) {
      return { key, outcome: 'passed' as const, detail: gateDetail(run, key) };
    }

    if (index < gateIndex) {
      return { key, outcome: 'passed' as const, detail: gateDetail(run, key) };
    }

    if (index === gateIndex) {
      if (failure) {
        return {
          key,
          outcome: 'failed' as const,
          detail: failedStep ? `Failed at step: ${failedStep.step}` : run.last_error ?? gateDetail(run, key),
        };
      }
      return { key, outcome: 'pending' as const, detail: gateDetail(run, key) };
    }

    // index > gateIndex
    if (failure) {
      return { key, outcome: 'skipped' as const };
    }
    return { key, outcome: 'pending' as const };
  });
}

function gateDetail(run: DRFailoverRun, key: PIRGateKey): string | undefined {
  if (key === 'approve' && run.approved_by) {
    return `Approved by ${run.approved_by}`;
  }
  return undefined;
}

function normalize(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '_');
}
