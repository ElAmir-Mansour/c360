import type { DRFailoverRun } from '@/types/clario-dr';
import {
  gateIndexForStatus,
  isAwaitingApproval,
  isTerminalFailure,
  isTerminalSuccess,
} from '@/components/product';

/**
 * Pure derivations for the `/dr/runs/[id]` incident-command (war-room) view.
 *
 * The backend models a run as a `status` (the canonical failover FSM) plus an
 * ordered list of step rows. The war-room needs two presentation derivations the
 * backend does NOT emit directly:
 *
 *  1. the NEXT REQUIRED ACTION — which operator CTA (if any) the current FSM
 *     state calls for; and
 *  2. the four-gate LIVE TIMELINE state (validate -> approve -> execute ->
 *     attest) with the current/next gate emphasised.
 *
 * Both are derived honestly from the real `run.status` via the canonical FSM
 * helpers in `@/components/product` (no re-encoding of the state machine, no
 * invented run fields).
 */

/** The single operator action the live run state calls for, if any. */
export type RunNextActionKind = 'approve' | 'cancel' | 'rollback' | 'none';

export interface RunNextAction {
  kind: RunNextActionKind;
  /** True once the run is terminal — the PIR summary takes over, no CTA. */
  terminal: boolean;
  /** True for a failed/cancelled/rolled-back run (drives the rollback affordance). */
  failed: boolean;
}

/**
 * Derive the next required operator action from the live run status.
 *
 *  - `AWAITING_APPROVAL`            -> `approve` (the prominent primary CTA).
 *  - terminal FAILURE               -> `rollback` (cancel / roll back affordance).
 *  - any other in-flight state      -> `cancel` (stop the in-flight run).
 *  - terminal SUCCESS               -> `none` (PIR summary takes over).
 */
export function deriveNextAction(run: DRFailoverRun): RunNextAction {
  const success = isTerminalSuccess(run.status);
  const failure = isTerminalFailure(run.status);
  const terminal = success || failure;

  if (success) {
    return { kind: 'none', terminal: true, failed: false };
  }
  if (failure) {
    return { kind: 'rollback', terminal: true, failed: true };
  }
  if (isAwaitingApproval(run.status)) {
    return { kind: 'approve', terminal: false, failed: false };
  }
  return { kind: 'cancel', terminal, failed: false };
}

/** The four operator-facing recovery gates, in advance order. */
export const WAR_ROOM_GATES = ['validate', 'approve', 'execute', 'attest'] as const;
export type WarRoomGateKey = (typeof WAR_ROOM_GATES)[number];

/** Live status of a single gate in the timeline. */
export type WarRoomGateState = 'done' | 'current' | 'next' | 'pending' | 'failed' | 'skipped';

export interface WarRoomGate {
  key: WarRoomGateKey;
  state: WarRoomGateState;
}

/**
 * Derive the live four-gate timeline state from the run status.
 *
 * `gateIndexForStatus` returns how many gates the run has cleared (0..4):
 *  - gates strictly below the index are `done`;
 *  - the gate AT the index is `current` (in progress / parked) — unless the run
 *    failed there, in which case it is `failed`;
 *  - the gate immediately after the current one is `next` (emphasised);
 *  - later gates are `pending`, or `skipped` on a terminal failure;
 *  - a terminal SUCCESS marks every gate `done`.
 */
export function deriveGateTimeline(run: DRFailoverRun): WarRoomGate[] {
  const success = isTerminalSuccess(run.status);
  const failure = isTerminalFailure(run.status);
  const index = gateIndexForStatus(run.status);

  return WAR_ROOM_GATES.map((key, i): WarRoomGate => {
    if (success) {
      return { key, state: 'done' };
    }
    if (i < index) {
      return { key, state: 'done' };
    }
    if (i === index) {
      return { key, state: failure ? 'failed' : 'current' };
    }
    if (failure) {
      return { key, state: 'skipped' };
    }
    if (i === index + 1) {
      return { key, state: 'next' };
    }
    return { key, state: 'pending' };
  });
}
