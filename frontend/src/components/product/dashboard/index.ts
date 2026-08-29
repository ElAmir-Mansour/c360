/**
 * ClarioDR recovery dashboards (Phase 3).
 *
 * Composable, token-driven, accessible, RTL-first product components wired to
 * the real `internal/dr` contract via `lib/clario-dr` (group-summary,
 * failover-run, replication-stream RPO/RTO, recovery-point validation).
 *
 * No page assembly here — the recovery-dashboard PROOF screen is Phase 4.
 */

export { RecoveryDashboard } from './recovery-dashboard';
export type {
  RecoveryDashboardProps,
  RecoveryDashboardLabels,
} from './recovery-dashboard';

export { MultiRunbookDashboard } from './multi-runbook-dashboard';
export type {
  MultiRunbookDashboardProps,
  MultiRunbookDashboardLabels,
} from './multi-runbook-dashboard';

export { RTOvsRTATracker } from './rto-vs-rta-tracker';
export type { RTOvsRTATrackerProps } from './rto-vs-rta-tracker';

export { RPOIndicator } from './rpo-indicator';
export type { RPOIndicatorProps } from './rpo-indicator';

export { RunbookProgressBar } from './runbook-progress-bar';
export type {
  RunbookProgressBarProps,
  RunbookGate,
} from './runbook-progress-bar';

export { RecoveryAnalyticsChart } from './recovery-analytics-chart';
export type {
  RecoveryAnalyticsChartProps,
  RecoveryAnalyticsPoint,
} from './recovery-analytics-chart';

export {
  evaluateRpo,
  evaluateRto,
  evaluateStreamRpo,
  formatDuration,
  gateIndexForStatus,
  isAwaitingApproval,
  isRunActive,
  isTerminalFailure,
  isTerminalSuccess,
  latestRun,
  activeRuns,
  toneForHealth,
  toneForRunStatus,
  toPercent,
  worstStreamByRpo,
  FAILOVER_RUN_STATES,
  RECOVERY_GATES,
} from './recovery-utils';
export type {
  FailoverRunState,
  RecoveryGate,
  RpoEvaluation,
  RtoEvaluation,
  StatusTone,
} from './recovery-utils';
