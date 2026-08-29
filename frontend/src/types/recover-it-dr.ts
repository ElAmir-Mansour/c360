// Clario Recover — IT Disaster Recovery sub-solution workspace types.
//
// These mirror the `GET /api/recover/it-dr/overview` response published by the
// backend (Prompt 4). The overview is a read-only aggregation that COMPOSES the
// existing dr/* runbook-studio and drill-scheduler state — it owns no recovery
// logic. The field names match the Go `ITDROverview` JSON tags exactly.

/** One row of the runbook inventory. */
export interface ITDRRunbookSummary {
  id: string;
  name: string;
  status: string;
  source: string;
  group_id?: string;
  task_count: number;
  active_runs: number;
  updated_at: string;
}

/** The tenant's runbook inventory: a page plus the estate-wide breakdown. */
export interface ITDRRunbookInventory {
  total: number;
  page: number;
  per_page: number;
  by_status: Record<string, number>;
  items: ITDRRunbookSummary[];
}

/** The most recent rehearsal-mode run. */
export interface ITDRRehearsalRun {
  run_id: string;
  runbook_id: string;
  runbook_name: string;
  status: string;
  started_at: string;
  completed_at?: string;
  actual_duration_seconds?: number;
  planned_critical_path_seconds: number;
}

/** The soonest future scheduled drill (next rehearsal cadence to fire). */
export interface ITDRUpcomingRehearsal {
  schedule_id: string;
  name: string;
  group_id: string;
  profile: string;
  next_run: string;
}

/** One approval-gate task awaiting sign-off on an active run. */
export interface ITDRApprovalItem {
  run_id: string;
  runbook_id: string;
  runbook_name: string;
  task_id: string;
  task_name: string;
  run_mode: string;
  required_permission?: string;
  awaiting_since: string;
}

/** Approval gates currently blocking active runs. */
export interface ITDROpenApprovals {
  total: number;
  items: ITDRApprovalItem[];
}

/** One weighted contributor to the readiness score, with its basis. */
export interface ITDRReadinessComponent {
  key: string;
  label: string;
  weight: number;
  /** Attainment of this component, 0..1. */
  value: number;
  detail: string;
}

/** The IT DR readiness score (0..100) computed from real persisted state. */
export interface ITDRReadinessScore {
  score: number;
  components: ITDRReadinessComponent[];
}

/** The full `GET /api/recover/it-dr/overview` payload. */
export interface ITDROverview {
  sub_solution: string;
  readiness: ITDRReadinessScore;
  inventory: ITDRRunbookInventory;
  last_rehearsal?: ITDRRehearsalRun;
  upcoming_rehearsal?: ITDRUpcomingRehearsal;
  open_approvals: ITDROpenApprovals;
  generated_at: string;
}
