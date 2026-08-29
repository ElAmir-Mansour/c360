import type { StatusChipProps } from '@/components/shared/status-chip';
import type {
  DRFailoverRun,
  DRFailoverRunSummary,
  DRStreamSummary,
  DRStreamRPO,
} from '@/lib/clario-dr';

/**
 * recovery-utils
 * ==============
 * Pure, token-aware helpers shared by the ClarioDR recovery dashboards. These
 * functions normalise the real `internal/dr` contract — failover-run states,
 * RTO objective-vs-actual, replication-stream RPO/lag — into presentation
 * primitives (StatusChip tones, percentages, human durations) WITHOUT inventing
 * any data. Every label is passed through callers' i18n; only structural
 * mappings (state -> gate index, breach math) live here.
 */

/**
 * Default recovery-analytics chart canvas height (px). Defined here — a
 * recharts-free module — so both the chart impl (default prop) and the lazy
 * wrapper's loading placeholder reserve the SAME height (no CLS) without the
 * wrapper statically importing the impl and defeating the code-split.
 */
export const RECOVERY_CHART_HEIGHT = 280;

/** Canonical failover-run FSM order from `internal/dr` failover_run.status. */
export const FAILOVER_RUN_STATES = [
  'INITIATED',
  'QUIESCING',
  'SYNC_CONFIRMED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'VALIDATING',
  'ATTESTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
] as const;

export type FailoverRunState = (typeof FAILOVER_RUN_STATES)[number];

export type StatusTone = NonNullable<StatusChipProps['tone']>;

/**
 * The four operator-facing recovery gates. A run advances Validate -> Approve
 * -> Execute -> Attest; the index a status maps to drives the progress widget.
 */
export const RECOVERY_GATES = ['validate', 'approve', 'execute', 'attest'] as const;
export type RecoveryGate = (typeof RECOVERY_GATES)[number];

const STATUS_TO_GATE_INDEX: Record<string, number> = {
  INITIATED: 0,
  QUIESCING: 0,
  SYNC_CONFIRMED: 1,
  AWAITING_APPROVAL: 1,
  APPROVED: 2,
  EXECUTING: 2,
  VALIDATING: 2,
  ATTESTED: 3,
  COMPLETED: 4,
  FAILED: 0,
  CANCELLED: 0,
  ROLLED_BACK: 0,
};

/** Number of gates [0..4] a run has cleared. COMPLETED clears all four. */
export function gateIndexForStatus(status: string | null | undefined): number {
  if (!status) return 0;
  return STATUS_TO_GATE_INDEX[status.toUpperCase()] ?? 0;
}

const TERMINAL_FAIL_STATES = new Set(['FAILED', 'CANCELLED', 'ROLLED_BACK']);
const TERMINAL_SUCCESS_STATES = new Set(['ATTESTED', 'COMPLETED']);
const ACTIVE_STATES = new Set([
  'INITIATED',
  'QUIESCING',
  'SYNC_CONFIRMED',
  'APPROVED',
  'EXECUTING',
  'VALIDATING',
]);

export function isTerminalFailure(status: string | null | undefined): boolean {
  return Boolean(status) && TERMINAL_FAIL_STATES.has(String(status).toUpperCase());
}

export function isTerminalSuccess(status: string | null | undefined): boolean {
  return Boolean(status) && TERMINAL_SUCCESS_STATES.has(String(status).toUpperCase());
}

export function isAwaitingApproval(status: string | null | undefined): boolean {
  return String(status ?? '').toUpperCase() === 'AWAITING_APPROVAL';
}

export function isRunActive(status: string | null | undefined): boolean {
  const upper = String(status ?? '').toUpperCase();
  return ACTIVE_STATES.has(upper) || upper === 'AWAITING_APPROVAL';
}

/** Map a failover-run status to a StatusChip tone (never color-only — pair w/ label). */
export function toneForRunStatus(status: string | null | undefined): StatusTone {
  const upper = String(status ?? '').toUpperCase();
  if (TERMINAL_FAIL_STATES.has(upper)) return 'danger';
  if (upper === 'COMPLETED' || upper === 'ATTESTED') return 'success';
  if (upper === 'AWAITING_APPROVAL') return 'warning';
  if (ACTIVE_STATES.has(upper)) return 'info';
  return 'neutral';
}

/** Map a stream / group health string to a StatusChip tone. */
export function toneForHealth(health: string | null | undefined): StatusTone {
  switch (String(health ?? '').toLowerCase()) {
    case 'healthy':
    case 'streaming':
    case 'completed':
    case 'passed':
      return 'success';
    case 'warning':
    case 'watch':
    case 'degraded':
    case 'seeding':
      return 'warning';
    case 'critical':
    case 'error':
    case 'failed':
      return 'danger';
    case 'paused':
      return 'neutral';
    default:
      return 'info';
  }
}

/**
 * RTO objective-vs-actual evaluation. `breached` is true when a *recorded*
 * actual exceeds the objective. While a run is still in flight (no actual yet)
 * we project elapsed time against the objective so the tracker can warn early.
 */
export interface RtoEvaluation {
  objectiveSeconds: number;
  actualSeconds: number | null;
  /** Live elapsed projection used when no actual has been sealed yet. */
  elapsedSeconds: number | null;
  /** The figure to chart against the objective (actual, else elapsed). */
  effectiveSeconds: number | null;
  /** actual > objective — a hard breach backed by a sealed measurement. */
  breached: boolean;
  /** effective >= objective but not yet a sealed breach — an at-risk warning. */
  atRisk: boolean;
  /** effective / objective, clamped to [0, ∞). */
  ratio: number;
  /** Seconds remaining against the objective (negative once overrun). */
  remainingSeconds: number | null;
  tone: StatusTone;
}

export function evaluateRto(
  objectiveSeconds: number,
  actualSeconds: number | null | undefined,
  elapsedSeconds: number | null | undefined = null,
): RtoEvaluation {
  const objective = Math.max(0, objectiveSeconds || 0);
  const actual =
    actualSeconds === undefined || actualSeconds === null ? null : Math.max(0, actualSeconds);
  const elapsed =
    elapsedSeconds === undefined || elapsedSeconds === null ? null : Math.max(0, elapsedSeconds);
  const effective = actual ?? elapsed;

  const breached = actual !== null && objective > 0 && actual > objective;
  const atRisk =
    !breached && effective !== null && objective > 0 && effective >= objective;
  const ratio = effective !== null && objective > 0 ? effective / objective : 0;
  const remaining = effective !== null && objective > 0 ? objective - effective : null;

  const tone: StatusTone = breached
    ? 'danger'
    : atRisk
      ? 'warning'
      : actual !== null
        ? 'success'
        : 'info';

  return {
    objectiveSeconds: objective,
    actualSeconds: actual,
    elapsedSeconds: elapsed,
    effectiveSeconds: effective,
    breached,
    atRisk,
    ratio,
    remainingSeconds: remaining,
    tone,
  };
}

/** RPO breach evaluation against an objective (replication-stream contract). */
export interface RpoEvaluation {
  rpoSeconds: number | null;
  objectiveSeconds: number;
  lagSeconds: number | null;
  breached: boolean;
  ratio: number;
  tone: StatusTone;
}

export function evaluateRpo(
  rpoSeconds: number | null | undefined,
  objectiveSeconds: number,
  lagSeconds: number | null | undefined = null,
  breachesRpo?: boolean,
): RpoEvaluation {
  const rpo = rpoSeconds === undefined || rpoSeconds === null ? null : Math.max(0, rpoSeconds);
  const objective = Math.max(0, objectiveSeconds || 0);
  const lag = lagSeconds === undefined || lagSeconds === null ? null : Math.max(0, lagSeconds);
  const breached =
    breachesRpo ?? (rpo !== null && objective > 0 && rpo > objective);
  const ratio = rpo !== null && objective > 0 ? rpo / objective : 0;
  const tone: StatusTone = breached
    ? 'danger'
    : ratio >= 0.8
      ? 'warning'
      : rpo === null
        ? 'neutral'
        : 'success';

  return { rpoSeconds: rpo, objectiveSeconds: objective, lagSeconds: lag, breached, ratio, tone };
}

/** Human-readable, RTL-safe duration. Returns the supplied `naLabel` for nulls. */
export function formatDuration(
  seconds: number | null | undefined,
  naLabel = 'n/a',
): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return naLabel;
  const value = Math.max(0, seconds);
  if (value < 60) return `${Math.round(value)}s`;
  const mins = Math.floor(value / 60);
  const remSec = Math.round(value % 60);
  if (mins < 60) return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

/** Clamp + round a 0..1 ratio to an integer percent. */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/** Most recent run, by `initiated_at`, from a failover-run list. */
export function latestRun<T extends DRFailoverRun | DRFailoverRunSummary>(
  runs: readonly T[] | undefined,
): T | null {
  if (!runs?.length) return null;
  return [...runs].sort(
    (a, b) => new Date(b.initiated_at).getTime() - new Date(a.initiated_at).getTime(),
  )[0];
}

/** A run is "in flight" (drill or live) when it has not reached a terminal state. */
export function activeRuns<T extends DRFailoverRun | DRFailoverRunSummary>(
  runs: readonly T[] | undefined,
): T[] {
  return (runs ?? []).filter((run) => isRunActive(run.status));
}

/** Pick the worst (highest-ratio / breaching) stream for a focus widget. */
export function worstStreamByRpo(
  streams: readonly DRStreamSummary[] | undefined,
): DRStreamSummary | null {
  if (!streams?.length) return null;
  return [...streams].sort((a, b) => {
    if (a.breaches_rpo !== b.breaches_rpo) return a.breaches_rpo ? -1 : 1;
    return (b.rpo_seconds ?? 0) - (a.rpo_seconds ?? 0);
  })[0];
}

/** Normalise a live `DRStreamRPO` reading into the breach evaluation shape. */
export function evaluateStreamRpo(
  reading: DRStreamRPO,
  objectiveSeconds: number,
): RpoEvaluation {
  return evaluateRpo(reading.rpo_seconds, objectiveSeconds, reading.lag_seconds);
}
