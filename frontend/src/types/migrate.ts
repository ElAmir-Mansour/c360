export type MigrateStrategy =
  | 'rehost'
  | 'replatform'
  | 'repurchase'
  | 'refactor'
  | 'retire'
  | 'retain';

export type MigrateWorkloadStatus =
  | 'discovered'
  | 'assessed'
  | 'planned'
  | 'in_migration'
  | 'cutover'
  | 'validated'
  | 'live'
  | 'decommissioned'
  | 'rolled_back';

export type MigrateMoveGroupStatus =
  | 'draft'
  | 'completeness_issue'
  | 'ready'
  | 'approval_pending'
  | 'approved'
  | 'rejected';

export type MigrateWaveStatus =
  | 'planned'
  | 'ready'
  | 'in_progress'
  | 'cutover'
  | 'completed'
  | 'paused'
  | 'rolled_back';

export type MigrateDecision = 'pending' | 'approved' | 'rejected' | 'go' | 'no_go';
export type MigrateCheckKind = 'readiness' | 'validation' | 'rollback_success';
export type MigrateCheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'overridden';
export type MigrateWindowType = 'maintenance' | 'off_peak' | 'planned_downtime';

export interface MigrateProductCapability {
  id: string;
  label: string;
  description?: string;
  entitlement_key: string;
  enabled: boolean;
}

export interface MigrateProduct {
  id: string;
  name: string;
  entitlement_key: string;
  entitlement_state: string;
  entitlement_reason?: string;
  licensed: boolean;
  capabilities: MigrateProductCapability[];
}

export interface MigrateProgram {
  id: string;
  tenant_id: string;
  reference: string;
  name: string;
  description: string;
  owner: string;
  status: string;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface MigrateWorkloadDependency {
  app_key: string;
  criticality: string;
}

export interface MigrateWorkload {
  id: string;
  tenant_id: string;
  program_id: string;
  app_key: string;
  name: string;
  source_environment: string;
  target_cloud: string;
  target_account: string;
  strategy: MigrateStrategy;
  owner_name: string;
  owner_contact: string;
  tier: string;
  status: MigrateWorkloadStatus;
  readiness_score: number;
  dependencies: MigrateWorkloadDependency[];
  move_group_id?: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface MigrateMoveGroup {
  id: string;
  tenant_id: string;
  program_id: string;
  reference: string;
  name: string;
  description: string;
  constraints: string;
  status: MigrateMoveGroupStatus;
  completeness_status: string;
  completeness_findings: string[];
  row_version: number;
  workloads?: MigrateWorkload[];
}

// ── Workflow-backed approvals (Wave 5, H2) ────────────────────────────────────
// Migrate move-group approvals are decided through the SHARED workflow engine, not
// a local status flip. These mirror the migrate-side projections (ApprovalBinding /
// ApprovalStatus) returned by the request-approval / sync-approval endpoints.

export type MigrateApprovalSubjectType = 'move_group' | 'gate' | 'rollback_plan';

export type MigrateApprovalBindingStatus =
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type MigrateApprovalDecisionOutcome = 'approved' | 'rejected';

// The workflow-engine instance status the binding is tied to.
export type MigrateWorkflowInstanceStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'suspended';

// MigrateApprovalBinding links a migrate approval subject to a workflow-engine
// approval instance and the terminal decision it drove. decision/rationale/
// decided_by/decided_at are present only once the workflow has decided.
export interface MigrateApprovalBinding {
  id: string;
  tenant_id: string;
  program_id: string;
  subject_type: MigrateApprovalSubjectType;
  subject_id: string;
  workflow_instance_id: string;
  workflow_definition_id: string;
  workflow_step_id?: string;
  status: MigrateApprovalBindingStatus;
  decision?: MigrateApprovalDecisionOutcome;
  rationale?: string;
  decided_by?: string;
  decided_at?: string;
  requested_by?: string;
  created_at: string;
  updated_at: string;
}

// MigrateApprovalStatus is the response of POST /move-groups/{id}/request-approval:
// the move group plus its bound workflow approval instance state. workflow_status
// is the live instance status; decided reports whether a terminal decision landed.
export interface MigrateApprovalStatus {
  move_group: MigrateMoveGroup;
  binding?: MigrateApprovalBinding;
  workflow_status?: MigrateWorkflowInstanceStatus | string;
  decided: boolean;
}

export interface MigrateWave {
  id: string;
  tenant_id: string;
  program_id: string;
  reference: string;
  name: string;
  description: string;
  sequence: number;
  status: MigrateWaveStatus;
  parent_runbook_id?: string | null;
  planned_duration_seconds: number;
  actual_duration_seconds?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  // dr_runbook_id is the REAL parent runbook generated in the DR Runbook Studio
  // engine (Wave 2). When present, the wave has a generated cutover runbook.
  dr_runbook_id?: string | null;
  dr_topology_group_id?: string | null;
  runbook_generated_at?: string | null;
  row_version: number;
  move_groups?: MigrateMoveGroup[];
}

export interface MigrateCutoverWindow {
  id: string;
  tenant_id: string;
  program_id: string;
  wave_id: string;
  reference: string;
  name: string;
  window_type: MigrateWindowType;
  starts_at: string;
  ends_at: string;
  constraints: string;
  decision: MigrateDecision;
  // rationale is the recorded go/no-go decision rationale (present once a go/no-go
  // decision has been made). Omitted by the backend when empty.
  rationale?: string;
  runbook_run_id?: string | null;
  dr_runbook_id?: string | null;
  dr_run_id?: string | null;
  row_version: number;
}

export interface MigrateRollbackPlan {
  id?: string;
  window_id: string;
  strategy: string;
  procedures: string;
  success_criteria: string;
  runbook_id?: string | null;
  decision?: MigrateDecision;
  row_version?: number;
}

export interface MigrateGateCheck {
  id: string;
  window_id: string;
  kind: MigrateCheckKind;
  name: string;
  check_type: string;
  status: MigrateCheckStatus;
  evidence: string;
  result: string;
  required: boolean;
}

export interface MigrateConnector {
  id: string;
  name: string;
  provider: string;
  endpoint_url: string;
  auth_type: 'none' | 'bearer' | 'basic';
  secret_ref?: string;
  enabled: boolean;
}

// MigrateConnectorInvocationSource records what drove a connector invocation: a
// manual per-window invocation, or an AUTOMATED runbook task the DR engine ran
// during a live cutover / rollback run (Wave 6, P10a).
export type MigrateConnectorInvocationSource = 'manual' | 'cutover_run' | 'rollback_run';

export interface MigrateConnectorInvocation {
  id: string;
  tenant_id: string;
  connector_id: string;
  window_id: string;
  idempotency_key: string;
  action: string;
  request_body?: Record<string, unknown>;
  status: string;
  http_status?: number;
  response_body?: string;
  error_message?: string;
  // source + run provenance (Wave 6, P10a): present when the invocation was driven
  // by a runbook task during a cutover/rollback run. task_key ties the invocation
  // back to the exact automated task the DR engine executed.
  source: MigrateConnectorInvocationSource;
  dr_run_id?: string | null;
  dr_task_id?: string | null;
  task_key?: string;
  created_at: string;
  updated_at: string;
}

export interface MigratePortfolioSummary {
  total_workloads: number;
  by_strategy: Record<string, number>;
  by_status: Record<string, number>;
  by_tier: Record<string, number>;
  readiness_average: number;
}

export interface MigrateCriticalPath {
  total_seconds: number;
  path: string[];
  milestones: Array<{ label: string; offset_seconds: number; completion_percent: number }>;
}

export interface MigrateAuditEvent {
  id: string;
  action: string;
  subject_type: string;
  summary: string;
  detail?: Record<string, unknown>;
  occurred_at: string;
}

// MigrateWaveStatusView is the per-wave progress rollup the command center / exec
// summary render: %complete (from the wave lifecycle status), planned vs actual
// duration + variance, and — when a live cutover run exists — its run status.
export interface MigrateWaveStatusView {
  wave_id: string;
  reference: string;
  name: string;
  sequence: number;
  status: MigrateWaveStatus;
  completion_percent: number;
  planned_duration_seconds: number;
  actual_duration_seconds?: number | null;
  variance_seconds: number;
  run_status?: string;
  run_started_at?: string | null;
}

export interface MigrateCommandCenter {
  program: MigrateProgram;
  summary: MigratePortfolioSummary;
  move_groups: MigrateMoveGroup[];
  waves: MigrateWave[];
  upcoming_windows: MigrateCutoverWindow[];
  critical_path: MigrateCriticalPath;
  readiness_blockers: MigrateGateCheck[];
  recent_audit: MigrateAuditEvent[];
  variance_seconds: number;
  wave_statuses: MigrateWaveStatusView[];
}

// MigrateProgramStatusSummary is the concise, read-only exec/stakeholder view of a
// program: overall %complete, per-wave rollups, open blockers, current run, and the
// program-level schedule variance.
export interface MigrateProgramStatusSummary {
  program: MigrateProgram;
  total_workloads: number;
  readiness_average: number;
  wave_count: number;
  completed_waves: number;
  overall_percent: number;
  variance_seconds: number;
  blocker_count: number;
  waves: MigrateWaveStatusView[];
  blockers: MigrateGateCheck[];
  current_run?: MigrateWaveStatusView | null;
}

// ── Dependency graph (Wave 4, P4) ─────────────────────────────────────────────
// The wave's move-group / workload dependency graph in a react-flow-renderable
// shape: nodes carry id/label/status/type, edges carry source/target/type.
export type MigrateDepNodeType = 'move_group' | 'workload' | 'dr_site';
export type MigrateDepEdgeType = 'contains' | 'dependency' | 'sequence' | 'replication';

export interface MigrateDepGraphNode {
  id: string;
  type: MigrateDepNodeType;
  label: string;
  status: string;
  move_group_id?: string;
  app_key?: string;
  duration_seconds?: number;
  dr_topology_group_id?: string;
  role?: string;
}

export interface MigrateDepGraphEdge {
  id: string;
  source: string;
  target: string;
  type: MigrateDepEdgeType;
  label?: string;
  health?: string;
}

export interface MigrateDependencyGraph {
  wave_id: string;
  wave_reference: string;
  nodes: MigrateDepGraphNode[];
  edges: MigrateDepGraphEdge[];
  topo_order: string[];
  has_cycle: boolean;
}

// ── DR runbook bridge (Wave 2) ────────────────────────────────────────────────
// These types mirror the Migrate-side projections returned by the wave runbook
// generation/fetch endpoints. The DR Runbook Studio engine remains the system of
// record; Migrate persists the linkage (a binding) and hydrates the live runbook
// + run state for rendering.

export type MigrateRunbookBindingRole = 'parent' | 'child' | 'rollback';
export type MigrateRunbookBindingSource = 'generated' | 'authored' | 'imported';
export type MigrateRunbookBindingStatus =
  | 'generated'
  | 'running'
  | 'completed'
  | 'failed'
  | 'superseded';

// MigrateRunbookBinding is the persisted, queryable link from a Migrate wave /
// move group to a DR Runbook Studio runbook (and, once started, its run). It makes
// the previously-inert dr_runbook_id a real reference.
export interface MigrateRunbookBinding {
  id: string;
  tenant_id: string;
  program_id: string;
  wave_id?: string | null;
  window_id?: string | null;
  move_group_id?: string | null;
  dr_runbook_id: string;
  dr_run_id?: string | null;
  role: MigrateRunbookBindingRole;
  parent_binding_id?: string | null;
  source: MigrateRunbookBindingSource;
  status: MigrateRunbookBindingStatus;
  ordinal: number;
  detail?: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

// MigrateDRTask is the Migrate-side projection of a DR Studio task in the live
// runbook (or run). predecessors are the task keys it depends on (the DAG edges).
export interface MigrateDRTask {
  id: string;
  task_key: string;
  name: string;
  task_type: string;
  // required marks a task the run must complete for the run to reach 'completed'.
  required: boolean;
  owner: string;
  team: string;
  planned_duration_seconds: number;
  predecessors: string[];
}

// MigrateDRRunbook is the live DR Studio runbook hydrated from the engine.
export interface MigrateDRRunbook {
  id: string;
  name: string;
  description: string;
  status: string;
  source: string;
  tasks: MigrateDRTask[];
}

// MigrateDRRunProjection mirrors the studio run projection (elapsed-vs-planned).
export interface MigrateDRRunProjection {
  planned_critical_path_seconds: number;
  elapsed_seconds: number;
  completed_tasks: number;
  total_tasks: number;
  remaining_critical_path_seconds: number;
  projected_finish_seconds: number;
  on_track: boolean;
  variance_seconds: number;
}

// MigrateDRTaskRun is the per-task execution state of a live DR run. The gate on
// cutover/rollback completion is computed from these rows (a required task counts
// only when its status is 'complete'). The DR engine's own run status is the
// authoritative terminal signal; these rows drive per-task rendering + controls.
export interface MigrateDRTaskRun {
  task_id: string;
  status: string;
  actual_duration_seconds?: number | null;
}

// MigrateDRRunLiveState is the live state of a started DR run, returned only when
// the wave's runbook has an active run (dr_run_id) the engine could hydrate.
export interface MigrateDRRunLiveState {
  run_id: string;
  runbook_id: string;
  status: string;
  mode: string;
  planned_critical_path_seconds: number;
  frontier: string[];
  projection: MigrateDRRunProjection;
  tasks: MigrateDRTask[];
  // task_runs is the per-task run state (present once a run has started); it maps
  // task_id → status so the live view can render each task's execution status and
  // enable/disable the complete/skip/fail controls against the real frontier.
  task_runs?: MigrateDRTaskRun[];
}

// MigrateWaveRunbook is the response of POST /waves/{id}/generate-runbook and
// GET /waves/{id}/runbook: the parent binding, the per-move-group child bindings,
// and (when reachable) the hydrated live parent runbook + run state.
export interface MigrateWaveRunbook {
  wave_id: string;
  parent: MigrateRunbookBinding;
  children: MigrateRunbookBinding[];
  runbook?: MigrateDRRunbook | null;
  live_state?: MigrateDRRunLiveState | null;
}

// ── DR run execution (Wave 3) ────────────────────────────────────────────────
// The cutover / rollback LIVE RUN types. Execution goes through the existing DR
// Runbook Studio engine (the migrate backend proxies StartRun/ActOnTask/GetRun);
// these are the Migrate-side projections the run views render.

// MigrateDRTaskAction is the verb proxied to the DR Studio task-action endpoint
// (tasks/{taskID}:complete|skip|fail).
export type MigrateDRTaskAction = 'complete' | 'skip' | 'fail';

// MigrateRollbackRunStatus tracks the lifecycle of an executed rollback DR run as
// observed from the DR engine.
export type MigrateRollbackRunStatus = 'running' | 'completed' | 'failed' | 'aborted';

// MigrateRollbackRun is the trigger-decision provenance row for one executed
// rollback: who triggered it, why, against which window/wave, and the isolated DR
// rollback runbook + run it drove.
export interface MigrateRollbackRun {
  id: string;
  tenant_id: string;
  program_id: string;
  window_id: string;
  wave_id: string;
  rollback_plan_id?: string | null;
  binding_id?: string | null;
  dr_runbook_id: string;
  dr_run_id: string;
  triggered_by: string;
  reason: string;
  status: MigrateRollbackRunStatus;
  created_at: string;
  updated_at: string;
}

// MigrateWindowRun is the response of the cutover execution endpoints
// (POST .../start-run, POST .../tasks/{id}:action, GET .../run): the window's
// runbook binding, any rollback-run provenance, and the live DR run state
// hydrated from the engine (present once a run has been started).
export interface MigrateWindowRun {
  window_id: string;
  wave_id: string;
  binding?: MigrateRunbookBinding | null;
  rollback_run?: MigrateRollbackRun | null;
  live_state?: MigrateDRRunLiveState | null;
}

// MigrateRollbackRunView is the response of GET .../rollback/run: the rollback-run
// provenance plus its live DR run state (null before a rollback has been executed
// or when the DR engine is momentarily unreachable for hydration).
export interface MigrateRollbackRunView {
  rollback_run: MigrateRollbackRun | null;
  live_state: MigrateDRRunLiveState | null;
}

// ── Structured evidence report (Wave 6, P10b) ─────────────────────────────────
// The response of GET /programs/{id}/evidence-report (?format=json): a SECTIONED,
// regulator-ready document — the program, a summary rollup, and per-wave slices
// (move groups + runbook binding + each window's gate decisions/evidence + the
// cutover run's REAL per-task outcomes), plus the workflow approvals, the rollback
// runs' provenance, and the connector invocations the runs drove. This is a
// structured aggregate, NOT a flat audit-row dump. ?format=pdf renders the same
// document. These mirror the backend EvidenceReport JSON exactly.

// MigrateTaskOutcome is one runbook task's outcome in a cutover run, hydrated from
// the DR engine.
export interface MigrateTaskOutcome {
  task_key: string;
  name: string;
  task_type: string;
  required: boolean;
  status: string;
}

// MigrateCutoverRunEvidence records a live cutover run's identity, terminal status,
// and per-task outcomes (present only when the DR engine could be reached; the
// dr_run_id/tasks are omitted otherwise).
export interface MigrateCutoverRunEvidence {
  dr_runbook_id: string;
  dr_run_id?: string;
  status: string;
  tasks?: MigrateTaskOutcome[];
}

// MigrateWindowEvidence is one cutover window's evidence slice: the window (with
// its go/no-go decision + rationale), its gate checks with recorded evidence, and
// the cutover run's per-task outcomes.
export interface MigrateWindowEvidence {
  window: MigrateCutoverWindow;
  gate_checks: MigrateGateCheck[];
  cutover_run?: MigrateCutoverRunEvidence;
}

// MigrateWaveEvidence is one wave's slice: its move groups (with workloads), the
// runbook binding provenance, and each window's evidence.
export interface MigrateWaveEvidence {
  wave: MigrateWave;
  move_groups: MigrateMoveGroup[];
  runbook_binding?: MigrateRunbookBinding;
  windows: MigrateWindowEvidence[];
}

// MigrateApprovalEvidence is one workflow-backed approval binding, projected to the
// reviewer-facing fields (who requested, who decided, the outcome).
export interface MigrateApprovalEvidence {
  subject_type: MigrateApprovalSubjectType;
  subject_id: string;
  workflow_instance_id: string;
  workflow_definition_id: string;
  status: MigrateApprovalBindingStatus;
  decision?: MigrateApprovalDecisionOutcome;
  rationale?: string;
  requested_by?: string;
  decided_by?: string;
  decided_at?: string;
}

// MigrateRollbackEvidence is one executed rollback's provenance + outcome.
export interface MigrateRollbackEvidence {
  window_id: string;
  wave_id: string;
  dr_runbook_id: string;
  dr_run_id: string;
  triggered_by: string;
  reason: string;
  status: MigrateRollbackRunStatus;
  created_at: string;
}

// MigrateConnectorEvidence is one connector invocation a cutover/rollback run drove
// (or a manual invocation) with its outcome — proof the integration actually ran.
export interface MigrateConnectorEvidence {
  connector_id: string;
  window_id: string;
  action: string;
  source: MigrateConnectorInvocationSource;
  status: string;
  http_status?: number;
  dr_run_id?: string;
  task_key?: string;
  error_message?: string;
  created_at: string;
}

// MigrateEvidenceSummary is the at-a-glance rollup a reviewer reads first.
export interface MigrateEvidenceSummary {
  wave_count: number;
  move_group_count: number;
  workload_count: number;
  window_count: number;
  cutover_run_count: number;
  rollback_run_count: number;
  completed_waves: number;
  rolled_back_waves: number;
  approval_count: number;
  connector_invocation_count: number;
  gate_checks_recorded: number;
  go_decisions: number;
  no_go_decisions: number;
}

// MigrateEvidenceReport is the top-level structured evidence document.
export interface MigrateEvidenceReport {
  generated_at: string;
  program: MigrateProgram;
  summary: MigrateEvidenceSummary;
  waves: MigrateWaveEvidence[];
  approvals: MigrateApprovalEvidence[];
  rollbacks: MigrateRollbackEvidence[];
  connector_invocations: MigrateConnectorEvidence[];
}
