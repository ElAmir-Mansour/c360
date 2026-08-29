'use client';

/**
 * ClarioDR recovery dashboards — gallery (Storybook-ready demos).
 * ==============================================================
 *
 * Composable, dependency-free demos for the Phase-3 recovery dashboards. This
 * file is NOT imported by any route (so it never ships in the app bundle) and is
 * NOT a test (so Vitest does not collect it). It (a) documents intended usage and
 * (b) drops straight into a Storybook/gallery harness:
 *
 *   - the default export is a gallery descriptor (`title` + named `stories`),
 *   - each named export is a ready-to-render demo component.
 *
 * Wrap any demo in a `LocaleProvider` (+ `next-themes` ThemeProvider) to see the
 * bilingual / light-dark / RTL behaviour; pass `locale="ar"` for RTL.
 *
 * The sample data below uses the REAL `internal/dr` shapes (DRGroupSummary,
 * DRFailoverRun, DRStreamSummary, DRRecoveryPointSummary) — never a faked
 * contract — so the demos exercise exactly what production renders.
 */

import type {
  DRFailoverRun,
  DRGroupSummary,
  DRRecoveryPointSummary,
  DRStreamSummary,
} from '@/lib/clario-dr';
import { RecoveryDashboard, type RecoveryDashboardLabels } from './recovery-dashboard';
import { MultiRunbookDashboard, type MultiRunbookDashboardLabels } from './multi-runbook-dashboard';
import { RTOvsRTATracker } from './rto-vs-rta-tracker';
import { RPOIndicator } from './rpo-indicator';
import { RunbookProgressBar } from './runbook-progress-bar';
import type { RecoveryAnalyticsPoint } from './recovery-analytics-chart';

/* -------------------------------------------------------------------------- */
/* Original sample data — real DR shapes (ClarioDR "Najd" sovereign group).    */
/* -------------------------------------------------------------------------- */

export const sampleStreams: DRStreamSummary[] = [
  {
    stream_id: 'stream-najd-core-db',
    site_id: 'site-riyadh-primary',
    site_name: 'Riyadh Primary',
    site_kind: 'on_prem',
    status: 'streaming',
    health: 'healthy',
    applied_seq: 4_812_309,
    source_lsn: '0/3A1F8C0',
    applied_at: '2026-06-15T08:41:12Z',
    last_error: null,
    rpo_seconds: 18,
    lag_seconds: 12,
    has_data: true,
    breaches_rpo: false,
    rpo_objective_seconds: 60,
    measured_at: '2026-06-15T08:41:20Z',
  },
  {
    stream_id: 'stream-najd-ledger',
    site_id: 'site-jeddah-edge',
    site_name: 'Jeddah Edge',
    site_kind: 'colo',
    status: 'degraded',
    health: 'warning',
    applied_seq: 1_209_884,
    source_lsn: '0/2B0A110',
    applied_at: '2026-06-15T08:40:02Z',
    last_error: null,
    rpo_seconds: 54,
    lag_seconds: 47,
    has_data: true,
    breaches_rpo: false,
    rpo_objective_seconds: 60,
    measured_at: '2026-06-15T08:41:20Z',
  },
  {
    stream_id: 'stream-najd-object-store',
    site_id: 'site-dammam-vault',
    site_name: 'Dammam Vault',
    site_kind: 'sovereign_cloud',
    status: 'error',
    health: 'critical',
    applied_seq: 88_120,
    source_lsn: '0/19FE220',
    applied_at: '2026-06-15T08:33:51Z',
    last_error: 'apply worker stalled: checksum retry budget exhausted',
    rpo_seconds: 312,
    lag_seconds: 298,
    has_data: true,
    breaches_rpo: true,
    rpo_objective_seconds: 120,
    measured_at: '2026-06-15T08:41:20Z',
  },
];

export const sampleRecoveryPoint: DRRecoveryPointSummary = {
  id: 'rp-najd-2026-06-15-0830',
  marker_lsn: '0/3A1F8C0',
  rpo_seconds: 18,
  validation_ratio: 0.97,
  is_validated: true,
  legal_hold: true,
  content_hash: 'sha256:9f2c1ab44e7d0c5e8b1a6f3d2c9e0a7b4d8f1e6c3a2b9d0e5f4c7a1b8d6e2f3c',
  sealed_at: '2026-06-15T08:30:00Z',
  retention_until: '2033-06-15T08:30:00Z',
};

export const sampleGroupSummary: DRGroupSummary = {
  generated_at: '2026-06-15T08:41:25Z',
  group_id: 'grp-najd-sovereign',
  name: 'Najd Sovereign Core',
  health: 'warning',
  member_count: 3,
  stream_count: 3,
  replication_percent: 91,
  rpo_objective_seconds: 60,
  rto_objective_seconds: 900,
  worst_live_rpo: sampleStreams[2],
  rpo_breaches: [sampleStreams[2]],
  latest_recovery_point: sampleRecoveryPoint,
  failover_readiness: {
    status: 'ready_with_warnings',
    can_failover: true,
    blocking_reasons: [],
    warning_reasons: ['Dammam Vault stream is breaching RPO'],
  },
  members: sampleStreams.map((stream, index) => ({
    group_id: 'grp-najd-sovereign',
    site_id: stream.site_id,
    site_name: stream.site_name,
    site_kind: stream.site_kind,
    boot_order: index + 1,
    stream,
  })),
  recent_runs: [],
};

export const sampleActiveRun: DRFailoverRun = {
  id: 'run-najd-drill-0915',
  tenant_id: 'tnt-clario-najd',
  group_id: 'grp-najd-sovereign',
  mode: 'drill',
  status: 'AWAITING_APPROVAL',
  recovery_point_id: 'rp-najd-2026-06-15-0830',
  rto_objective_seconds: 900,
  initiated_by: 'recovery-lead@najd.gov.sa',
  approved_by: null,
  initiated_at: '2026-06-15T08:36:00Z',
  completed_at: null,
  rto_actual_seconds: null,
  last_error: null,
  claimed_at: '2026-06-15T08:36:04Z',
  updated_at: '2026-06-15T08:40:55Z',
};

export const sampleRuns: DRFailoverRun[] = [
  sampleActiveRun,
  {
    id: 'run-najd-live-0712',
    tenant_id: 'tnt-clario-najd',
    group_id: 'grp-najd-ledger',
    mode: 'live',
    status: 'EXECUTING',
    recovery_point_id: 'rp-ledger-0700',
    rto_objective_seconds: 600,
    initiated_by: 'oncall@najd.gov.sa',
    approved_by: 'cio@najd.gov.sa',
    initiated_at: '2026-06-15T07:12:00Z',
    completed_at: null,
    rto_actual_seconds: null,
    last_error: null,
    claimed_at: '2026-06-15T07:12:08Z',
    updated_at: '2026-06-15T08:39:00Z',
  },
  {
    id: 'run-najd-drill-0540',
    tenant_id: 'tnt-clario-najd',
    group_id: 'grp-edge-services',
    mode: 'drill',
    status: 'COMPLETED',
    recovery_point_id: 'rp-edge-0530',
    rto_objective_seconds: 1_200,
    initiated_by: 'platform-sre@najd.gov.sa',
    approved_by: 'platform-sre@najd.gov.sa',
    initiated_at: '2026-06-15T05:40:00Z',
    completed_at: '2026-06-15T05:58:30Z',
    rto_actual_seconds: 1_110,
    last_error: null,
    claimed_at: '2026-06-15T05:40:05Z',
    updated_at: '2026-06-15T05:58:30Z',
  },
  {
    id: 'run-najd-live-0210',
    tenant_id: 'tnt-clario-najd',
    group_id: 'grp-payments',
    mode: 'live',
    status: 'ROLLED_BACK',
    recovery_point_id: 'rp-pay-0200',
    rto_objective_seconds: 480,
    initiated_by: 'oncall@najd.gov.sa',
    approved_by: 'cio@najd.gov.sa',
    initiated_at: '2026-06-15T02:10:00Z',
    completed_at: '2026-06-15T02:31:00Z',
    rto_actual_seconds: 1_260,
    last_error: 'health probe failed on payments-gateway after cutover',
    claimed_at: '2026-06-15T02:10:03Z',
    updated_at: '2026-06-15T02:31:00Z',
  },
];

export const sampleAnalytics: RecoveryAnalyticsPoint[] = [
  { label: '08:00', rpoSeconds: 22, lagSeconds: 15 },
  { label: '08:10', rpoSeconds: 31, lagSeconds: 24 },
  { label: '08:20', rpoSeconds: 48, lagSeconds: 41 },
  { label: '08:30', rpoSeconds: 76, lagSeconds: 70 },
  { label: '08:40', rpoSeconds: 312, lagSeconds: 298 },
];

/* -------------------------------------------------------------------------- */
/* English label sets.                                                         */
/* -------------------------------------------------------------------------- */

export const recoveryDashboardLabelsEn: RecoveryDashboardLabels = {
  groupLabel: 'Protection group',
  generatedAtLabel: 'Generated',
  members: 'Members',
  streams: 'Streams',
  replication: 'Replication',
  recoveryPoints: 'Latest RPO',
  runProgressTitle: 'Recovery run progress',
  runProgressDescription: 'Validate -> Approve -> Execute -> Attest',
  noActiveRunTitle: 'No recovery run in flight',
  noActiveRunDescription: 'Start a failover drill or live recovery to track gate progress here.',
  rtoTitle: 'RTO vs RTA',
  liveStatusTitle: 'Live recovery status',
  analyticsTitle: 'Replication-lag trend',
  analyticsDescription: 'Per-interval RPO against the objective reference line.',
  recoveryPointTitle: 'Recovery-point validation',
  recoveryPointValidated: 'Validated',
  recoveryPointUnvalidated: 'Unvalidated',
  recoveryPointLegalHold: 'Legal hold',
  noRecoveryPoint: 'No sealed recovery point yet',
  streamHealthTitle: 'Stream health',
  noStreams: 'No replication streams',
  gates: { validate: 'Validate', approve: 'Approve', execute: 'Execute', attest: 'Attest' },
  rto: {
    title: 'RTO vs RTA',
    objective: 'Objective (RTO)',
    actual: 'Actual (RTA)',
    elapsed: 'Elapsed',
    onTarget: 'On target',
    atRisk: 'At risk',
    breached: 'Breached',
    overrunSuffix: '{value} over target',
    remainingSuffix: '{value} to spare',
    notStarted: 'Not started',
  },
  rpo: {
    title: 'Replication / RPO',
    objective: 'objective',
    lag: 'Apply lag',
    withinObjective: 'Within objective',
    approaching: 'Approaching',
    breached: 'Breached',
    valueCaption: 'Current data-loss window',
  },
  runStatusLabels: {
    INITIATED: 'Initiated',
    QUIESCING: 'Quiescing',
    SYNC_CONFIRMED: 'Sync confirmed',
    AWAITING_APPROVAL: 'Awaiting approval',
    APPROVED: 'Approved',
    EXECUTING: 'Executing',
    VALIDATING: 'Validating',
    ATTESTED: 'Attested',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    ROLLED_BACK: 'Rolled back',
  },
  healthLabels: {
    healthy: 'Healthy',
    warning: 'Watch',
    critical: 'Critical',
    paused: 'Paused',
    streaming: 'Streaming',
    degraded: 'Degraded',
    error: 'Error',
  },
  analytics: { rpo: 'RPO (s)', lag: 'Lag (s)', objective: 'RPO objective', empty: 'No samples yet' },
  naLabel: 'n/a',
};

export const multiRunbookLabelsEn: MultiRunbookDashboardLabels = {
  title: 'Concurrent recovery events',
  subtitle: 'Every in-flight and recent failover run, one screen.',
  activeRuns: 'Active',
  breachedRuns: 'Breached',
  totalRuns: 'Total',
  colRun: 'Run',
  colGroup: 'Group',
  colMode: 'Mode',
  colStatus: 'Status',
  colProgress: 'Gate progress',
  colRto: 'RTO vs RTA',
  colAction: 'Open run',
  rtoObjectivePrefix: 'target',
  selectRunLabel: 'Open recovery run',
  empty: 'No recovery runs',
  emptyDescription: 'Failover drills and live recoveries will appear here as they are initiated.',
  gates: { validate: 'Validate', approve: 'Approve', execute: 'Execute', attest: 'Attest' },
  gateStateLabels: {
    done: 'Cleared',
    current: 'In progress',
    awaitingApproval: 'Awaiting approval',
    failed: 'Failed',
    pending: 'Pending',
  },
  runStatusLabels: recoveryDashboardLabelsEn.runStatusLabels,
  modeLabels: { drill: 'Drill', live: 'Live', test: 'Test' },
  naLabel: 'n/a',
};

/* -------------------------------------------------------------------------- */
/* Demo components.                                                            */
/* -------------------------------------------------------------------------- */

export function RecoveryDashboardDemo() {
  return (
    <RecoveryDashboard
      summary={sampleGroupSummary}
      activeRun={sampleActiveRun}
      streams={sampleStreams}
      recoveryPoint={sampleRecoveryPoint}
      analyticsData={sampleAnalytics}
      elapsedSeconds={295}
      labels={recoveryDashboardLabelsEn}
    />
  );
}

export function MultiRunbookDashboardDemo() {
  return (
    <MultiRunbookDashboard
      runs={sampleRuns}
      selectedRunId="run-najd-drill-0915"
      onSelectRun={(run) => console.info('select run', run.id)}
      labels={multiRunbookLabelsEn}
    />
  );
}

export function RTOvsRTABreachDemo() {
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
      <RTOvsRTATracker objectiveSeconds={900} actualSeconds={1_110} labels={recoveryDashboardLabelsEn.rto} />
      <RTOvsRTATracker objectiveSeconds={900} actualSeconds={620} labels={recoveryDashboardLabelsEn.rto} />
      <RTOvsRTATracker objectiveSeconds={900} elapsedSeconds={840} labels={recoveryDashboardLabelsEn.rto} />
      <RTOvsRTATracker objectiveSeconds={900} labels={recoveryDashboardLabelsEn.rto} />
    </div>
  );
}

export function RPOIndicatorDemo() {
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
      {sampleStreams.map((stream) => (
        <RPOIndicator
          key={stream.stream_id}
          rpoSeconds={stream.rpo_seconds}
          objectiveSeconds={stream.rpo_objective_seconds}
          lagSeconds={stream.lag_seconds}
          breachesRpo={stream.breaches_rpo}
          labels={recoveryDashboardLabelsEn.rpo}
        />
      ))}
    </div>
  );
}

export function RunbookProgressDemo() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      {(['SYNC_CONFIRMED', 'AWAITING_APPROVAL', 'EXECUTING', 'COMPLETED', 'ROLLED_BACK'] as const).map(
        (status) => (
          <RunbookProgressBar
            key={status}
            gates={[
              { key: 'validate', label: 'Validate' },
              { key: 'approve', label: 'Approve' },
              { key: 'execute', label: 'Execute' },
              { key: 'attest', label: 'Attest' },
            ]}
            status={status}
            statusLabel={recoveryDashboardLabelsEn.runStatusLabels?.[status]}
            ariaLabel={`Recovery progress ${status}`}
            stateLabels={multiRunbookLabelsEn.gateStateLabels}
          />
        ),
      )}
    </div>
  );
}

const gallery = {
  title: 'Product/Recovery Dashboards',
  stories: {
    RecoveryDashboard: RecoveryDashboardDemo,
    MultiRunbookDashboard: MultiRunbookDashboardDemo,
    RTOvsRTATracker: RTOvsRTABreachDemo,
    RPOIndicator: RPOIndicatorDemo,
    RunbookProgressBar: RunbookProgressDemo,
  },
};

export default gallery;
