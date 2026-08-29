/**
 * ClarioDR product components — Phase-3 barrel.
 * =============================================
 * The single import surface for the recovery (ClarioDR) product building blocks:
 * dashboards, the recovery node-map, the runbook task-flow, and the
 * records/attestation surfaces. Everything here is composable, token-driven,
 * accessible, and bilingual/RTL-ready, wired to the REAL `internal/dr` contract
 * via `@/lib/clario-dr` + `@/types/clario-dr`.
 *
 * No page assembly lives here — the recovery-dashboard PROOF screen is Phase 4.
 * This barrel only re-exports the leaf modules so Phase 4 (and stories/tests)
 * can `import { ... } from '@/components/product'`.
 *
 * Collision note: `dashboard` and `records` each export a `formatDuration`
 * helper with DIFFERENT signatures/output (recovery-utils takes an `naLabel`
 * and renders "n/a"/"s/m/h"; records renders zero-padded "0s"/"01m 05s"). They
 * are intentionally distinct, so a bare `export *` would be an ambiguous
 * re-export. Each is surfaced under an explicit, unambiguous name here
 * (`formatRecoveryDuration` / `formatRecordDuration`) and the full helper
 * modules remain reachable namespaced (`recoveryUtils.*`, `recordFormat.*`).
 */

// ---------------------------------------------------------------------------
// Node map (no name collisions with the other sub-barrels).
// ---------------------------------------------------------------------------
export * from './nodemap';

// ---------------------------------------------------------------------------
// Runbook task-flow (no name collisions with the other sub-barrels).
// ---------------------------------------------------------------------------
export * from './runbook';

// ---------------------------------------------------------------------------
// Recovery dashboards.
// Flatten everything except the colliding `formatDuration` (re-exported below
// under an explicit name + via the `recoveryUtils` namespace).
// ---------------------------------------------------------------------------
export { RecoveryDashboard } from './dashboard/recovery-dashboard';
export type {
  RecoveryDashboardProps,
  RecoveryDashboardLabels,
} from './dashboard/recovery-dashboard';

export { MultiRunbookDashboard } from './dashboard/multi-runbook-dashboard';
export type {
  MultiRunbookDashboardProps,
  MultiRunbookDashboardLabels,
} from './dashboard/multi-runbook-dashboard';

export { RTOvsRTATracker } from './dashboard/rto-vs-rta-tracker';
export type { RTOvsRTATrackerProps } from './dashboard/rto-vs-rta-tracker';

export { RPOIndicator } from './dashboard/rpo-indicator';
export type { RPOIndicatorProps } from './dashboard/rpo-indicator';

export { RunbookProgressBar } from './dashboard/runbook-progress-bar';
export type {
  RunbookProgressBarProps,
  RunbookGate,
} from './dashboard/runbook-progress-bar';

export { RecoveryAnalyticsChart } from './dashboard/recovery-analytics-chart';
export type {
  RecoveryAnalyticsChartProps,
  RecoveryAnalyticsPoint,
} from './dashboard/recovery-analytics-chart';

export {
  evaluateRpo,
  evaluateRto,
  evaluateStreamRpo,
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
  // Disambiguated re-export of the recovery-utils duration formatter.
  formatDuration as formatRecoveryDuration,
} from './dashboard/recovery-utils';
export type {
  FailoverRunState,
  RecoveryGate,
  RpoEvaluation,
  RtoEvaluation,
  StatusTone,
} from './dashboard/recovery-utils';

// ---------------------------------------------------------------------------
// Records / attestation surfaces.
// Flatten everything except the colliding `formatDuration` (re-exported below
// under an explicit name + via the `recordFormat` namespace).
// ---------------------------------------------------------------------------
export { AuditTrailTable } from './records/audit-trail-table';
export type {
  AuditTrailTableProps,
  AuditTrailLabels,
  AuditChainVerdict,
  AuditEntryTypeMeta,
} from './records/audit-trail-table';

export { PostImplementationReviewPanel } from './records/post-implementation-review-panel';
export type {
  PostImplementationReviewPanelProps,
  PIRLabels,
  PIRGate,
  PIRGateKey,
  PIRGateOutcome,
  PIRIssue,
  PIRActionItem,
} from './records/post-implementation-review-panel';

export { IntegrationCardsGrid } from './records/integration-cards-grid';
export type {
  IntegrationCardsGridProps,
  IntegrationCardsLabels,
  IntegrationDescriptor,
  IntegrationStatus,
} from './records/integration-cards-grid';

export {
  shortenHash,
  formatTimestamp,
  formatInteger,
  formatRatioPercent,
  // Disambiguated re-export of the records duration formatter.
  formatDuration as formatRecordDuration,
} from './records/format';

// ---------------------------------------------------------------------------
// Namespaced helper modules — full surfaces preserved for callers that want
// the original `formatDuration` name (and to keep the two helper families
// clearly attributed).
// ---------------------------------------------------------------------------
export * as recoveryUtils from './dashboard/recovery-utils';
export * as recordFormat from './records/format';
