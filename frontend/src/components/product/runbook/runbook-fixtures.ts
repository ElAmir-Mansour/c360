/**
 * runbook-fixtures.ts — sample data for the runbook task-flow story + tests.
 * ==========================================================================
 *
 * ORIGINAL ClarioDR content built on the REAL DR shapes (`DRRunbookTask`,
 * `DRRunbookTaskRun`, `DRRunbookProjection`). The dependency set is hand-built so
 * the critical path is KNOWN and the task-flow test can assert it exactly:
 *
 *   detect → quiesce → snapshot ─┐
 *                                ├→ approve → boot-db → boot-app → verify → attest
 *            notify-stakeholders ┘  (comms, off the critical path)
 *
 * planned durations (seconds), critical chain (longest planned path):
 *   detect(60) → quiesce(120) → snapshot(420) → approve(300) → boot-db(540)
 *   → boot-app(360) → verify(180) → attest(90)  =  2070s
 * The comms task `notify` (90s, predecessor detect) is a parallel branch that is
 * NOT on the critical path.
 */

import type {
  DRRunbookTask,
  DRRunbookTaskRun,
  DRRunbookProjection,
} from '@/types/clario-dr';

const NOW = '2026-06-15T09:00:00Z';

function task(
  partial: Pick<
    DRRunbookTask,
    'id' | 'task_key' | 'name' | 'task_type' | 'owner' | 'team' | 'instructions' | 'planned_duration_seconds' | 'predecessors'
  > &
    Partial<DRRunbookTask>,
): DRRunbookTask {
  return {
    tenant_id: 'tenant-clario-dr',
    runbook_id: 'rb-regional-failover',
    required: true,
    automation_action: '',
    params: undefined,
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

/**
 * A regional failover runbook. IDs are stable so the critical-path assertion is
 * deterministic. The longest planned-duration chain is the failover spine.
 */
export const sampleRunbookTasks: DRRunbookTask[] = [
  task({
    id: 'task-detect',
    task_key: 'detect',
    name: 'Confirm primary-site outage',
    task_type: 'manual',
    owner: 'On-call SRE',
    team: 'Resilience Operations',
    instructions:
      'Validate the primary region is unreachable across health probes and confirm the declaration with the incident commander.',
    planned_duration_seconds: 60,
    predecessors: [],
  }),
  task({
    id: 'task-notify',
    task_key: 'notify',
    name: 'Notify stakeholders of failover start',
    task_type: 'comms',
    required: false,
    owner: 'Incident Commander',
    team: 'Communications',
    instructions:
      'Page the recovery bridge and post the failover declaration to the status channel and the regulator notification list.',
    planned_duration_seconds: 90,
    predecessors: ['task-detect'],
  }),
  task({
    id: 'task-quiesce',
    task_key: 'quiesce',
    name: 'Quiesce primary writes',
    task_type: 'automated',
    owner: 'Recovery Orchestrator',
    team: 'Platform',
    instructions: 'Freeze application writes and flush the replication journal.',
    automation_action: 'dr:quiesce-writes',
    planned_duration_seconds: 120,
    predecessors: ['task-detect'],
  }),
  task({
    id: 'task-snapshot',
    task_key: 'snapshot',
    name: 'Seal app-consistent recovery point',
    task_type: 'automated',
    owner: 'Recovery Orchestrator',
    team: 'Platform',
    instructions:
      'Trigger an application-consistent barrier and seal an immutable recovery point at the latest applied sequence.',
    automation_action: 'dr:seal-recovery-point',
    planned_duration_seconds: 420,
    predecessors: ['task-quiesce'],
  }),
  task({
    id: 'task-approve',
    task_key: 'approve',
    name: 'Approve cutover to recovery region',
    task_type: 'approval_gate',
    owner: 'DR Authoriser',
    team: 'Risk & Governance',
    instructions:
      'Review the sealed recovery point, RPO, and clean-room scan, then authorise the cutover.',
    automation_action: 'dr:failover',
    planned_duration_seconds: 300,
    predecessors: ['task-snapshot'],
  }),
  task({
    id: 'task-boot-db',
    task_key: 'boot-db',
    name: 'Boot data tier in recovery region',
    task_type: 'automated',
    owner: 'Recovery Orchestrator',
    team: 'Platform',
    instructions: 'Promote replicas and boot the database tier in boot order.',
    automation_action: 'dr:boot-tier',
    planned_duration_seconds: 540,
    predecessors: ['task-approve'],
  }),
  task({
    id: 'task-boot-app',
    task_key: 'boot-app',
    name: 'Boot application tier',
    task_type: 'automated',
    owner: 'Recovery Orchestrator',
    team: 'Platform',
    instructions: 'Boot the application tier once the data tier is healthy.',
    automation_action: 'dr:boot-tier',
    planned_duration_seconds: 360,
    predecessors: ['task-boot-db'],
  }),
  task({
    id: 'task-verify',
    task_key: 'verify',
    name: 'Verify recovered services',
    task_type: 'manual',
    owner: 'On-call SRE',
    team: 'Resilience Operations',
    instructions:
      'Run end-to-end smoke checks against the recovered services and confirm traffic is serving from the recovery region.',
    planned_duration_seconds: 180,
    predecessors: ['task-boot-app'],
  }),
  task({
    id: 'task-attest',
    task_key: 'attest',
    name: 'Emit immutable recovery attestation',
    task_type: 'milestone',
    owner: 'Recovery Orchestrator',
    team: 'Risk & Governance',
    instructions:
      'Write the tamper-evident attestation (RTO objective vs actual, RPO) to the hash-chained ledger.',
    automation_action: 'dr:attest',
    planned_duration_seconds: 90,
    predecessors: ['task-verify'],
  }),
];

/** The KNOWN critical path (task IDs) for the sample runbook above. */
export const sampleCriticalPathIds = [
  'task-detect',
  'task-quiesce',
  'task-snapshot',
  'task-approve',
  'task-boot-db',
  'task-boot-app',
  'task-verify',
  'task-attest',
];

/** Planned critical-path duration (seconds) for the sample runbook. */
export const sampleCriticalPathSeconds = 2070;

/** A partial live run — the spine through `approve` has executed. */
export const sampleTaskRuns: DRRunbookTaskRun[] = [
  {
    id: 'tr-detect',
    tenant_id: 'tenant-clario-dr',
    run_id: 'run-1',
    task_id: 'task-detect',
    status: 'complete',
    acted_by: 'sre@clario.dev',
    started_at: '2026-06-15T09:00:00Z',
    finished_at: '2026-06-15T09:00:55Z',
    actual_duration_seconds: 55,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'tr-notify',
    tenant_id: 'tenant-clario-dr',
    run_id: 'run-1',
    task_id: 'task-notify',
    status: 'complete',
    acted_by: 'ic@clario.dev',
    actual_duration_seconds: 80,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'tr-quiesce',
    tenant_id: 'tenant-clario-dr',
    run_id: 'run-1',
    task_id: 'task-quiesce',
    status: 'complete',
    actual_duration_seconds: 130,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'tr-snapshot',
    tenant_id: 'tenant-clario-dr',
    run_id: 'run-1',
    task_id: 'task-snapshot',
    status: 'running',
    started_at: '2026-06-15T09:03:00Z',
    created_at: NOW,
    updated_at: NOW,
  },
];

/**
 * A sample live projection for the summary strip — the real backend
 * `RunProjection` fields. 3 of 9 tasks complete (detect, notify, quiesce);
 * snapshot is in flight. Projected finish = elapsed 240 + remaining critical
 * path 1710 = 1950s, under the planned 2070s → on track (variance −120s).
 */
export const sampleProjection: DRRunbookProjection = {
  planned_critical_path_seconds: sampleCriticalPathSeconds,
  elapsed_seconds: 240,
  completed_tasks: 3,
  total_tasks: 9,
  remaining_critical_path_seconds: 1710,
  projected_finish_seconds: 1950,
  projected_finish_at: '2026-06-15T09:32:30Z',
  on_track: true,
  variance_seconds: -120,
};

/** English copy for the task-flow labels. */
export const runbookTaskFlowLabelsEn = {
  listAriaLabel: 'Recovery runbook task flow',
  sequence: 'Step',
  task: 'Task',
  owner: 'Owner',
  team: 'Team',
  action: 'Action',
  planned: 'Planned',
  actual: 'Actual',
  dependencies: 'Depends on',
  noDependencies: 'No dependencies',
  criticalPath: 'Critical path',
  onCriticalPath: 'on the critical path',
  required: 'Required',
  optional: 'Optional',
  totalTasks: 'Tasks',
  criticalPathDuration: 'Critical path',
  completed: 'Completed',
  projectedFinish: 'Projected finish',
  onTrack: 'on track',
  behindSchedule: 'behind',
  emptyTitle: 'No tasks in this runbook',
  emptyDescription: 'Author or import tasks to build the recovery task flow.',
  taskTypes: {
    manual: 'Manual',
    automated: 'Automated',
    approval_gate: 'Approval gate',
    comms: 'Comms',
    milestone: 'Milestone',
  },
  statuses: {
    pending: 'Pending',
    runnable: 'Runnable',
    running: 'Running',
    complete: 'Complete',
    skipped: 'Skipped',
    failed: 'Failed',
    blocked: 'Blocked',
  },
} as const;

/** Arabic copy for the task-flow labels (RTL surface). */
export const runbookTaskFlowLabelsAr = {
  listAriaLabel: 'تدفّق مهام دليل التعافي',
  sequence: 'الخطوة',
  task: 'المهمة',
  owner: 'المسؤول',
  team: 'الفريق',
  action: 'الإجراء',
  planned: 'المخطّط',
  actual: 'الفعلي',
  dependencies: 'يعتمد على',
  noDependencies: 'لا توجد تبعيات',
  criticalPath: 'المسار الحرج',
  onCriticalPath: 'على المسار الحرج',
  required: 'إلزامي',
  optional: 'اختياري',
  totalTasks: 'المهام',
  criticalPathDuration: 'المسار الحرج',
  completed: 'مكتملة',
  projectedFinish: 'الإنهاء المتوقّع',
  onTrack: 'ضمن الخطة',
  behindSchedule: 'متأخّر',
  emptyTitle: 'لا توجد مهام في هذا الدليل',
  emptyDescription: 'أنشئ المهام أو استوردها لبناء تدفّق مهام التعافي.',
  taskTypes: {
    manual: 'يدوي',
    automated: 'آلي',
    approval_gate: 'بوابة موافقة',
    comms: 'اتصالات',
    milestone: 'مَعلم',
  },
  statuses: {
    pending: 'قيد الانتظار',
    runnable: 'قابلة للتنفيذ',
    running: 'قيد التنفيذ',
    complete: 'مكتملة',
    skipped: 'تم التخطّي',
    failed: 'فشلت',
    blocked: 'محظورة',
  },
} as const;
