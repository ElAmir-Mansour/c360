// Clario Recover — Audit trail & regulatory evidence types (Prompt 10).
//
// These mirror the `GET /api/recover/evidence[/{eventId}]` responses published by
// the backend (internal/recover/evidence.go + audit.go). Field names match the Go
// JSON tags exactly. Every value is computed from REAL persisted data — the
// append-only audit log, the EXISTING runbookstudio / cyber-recovery execution
// records, and the Metastore RTO seam; there are no placeholder/canned values.

/** One row of the "Prove" event list (a recovery event with audit history). */
export interface RecoverAuditEventSummary {
  event_id: string;
  /** it_dr | cloud_dr | cyber_recovery */
  sub_solution: string;
  action_count: number;
  latest_action: string;
  latest_actor: string;
  first_at: string;
  last_at: string;
}

/** The runbook executed + RTO-vs-RTA section of the evidence report. */
export interface RecoverRunbookExecution {
  run_id: string;
  runbook_id: string;
  runbook_name: string;
  mode: string;
  status: string;
  succeeded: boolean;
  started_at: string;
  completed_at?: string;
  /** RTO target (seconds), from the Metastore seam — never hardcoded. */
  rto_target_seconds: number;
  /** RTA actual (seconds); present only once the run completed. */
  rta_actual_seconds?: number;
  rta_breach: boolean;
  breach_seconds: number;
}

/** One cyber-recovery integrity-gate evaluation captured for the event. */
export interface RecoverIntegrityCheck {
  scan_id?: string;
  verdict: string;
  passed: boolean;
  detail?: string;
  checked_at: string;
  actor?: string;
}

/** One recorded authorized sign-off for the event. */
export interface RecoverApproval {
  action: string;
  approver_id?: string;
  approver: string;
  note?: string;
  /** Integrity scan the approval was pinned to (provenance), for cyber recovery. */
  scan_id?: string;
  approved_at: string;
}

/** One chronological action in the event's full timeline (append-only audit). */
export interface RecoverTimelineEntry {
  at: string;
  sub_solution: string;
  action: string;
  actor: string;
  summary: string;
  detail?: Record<string, unknown>;
}

/** The complete regulator-ready evidence report for one recovery event. */
export interface RecoverEvidenceReport {
  event_id: string;
  tenant_id: string;
  sub_solution: string;
  application_id?: string;
  application_key?: string;
  application_name?: string;
  recovery_tier?: string;
  runbook_execution?: RecoverRunbookExecution;
  approvals: RecoverApproval[];
  integrity_checks: RecoverIntegrityCheck[];
  timeline: RecoverTimelineEntry[];
  generated_at: string;
}
