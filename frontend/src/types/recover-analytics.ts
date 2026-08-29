// Clario Recover — Unified RTO/RTA & recovery analytics types (Prompt 8).
//
// These mirror the `GET /api/recover/analytics` response published by the backend
// and documented in RECOVER_ANALYTICS_CONTRACT.md. Every metric is computed from
// REAL persisted execution records (runbookstudio runs joined to applications via
// the Metastore runbook link) and the RTO TARGET from the Metastore seam — there
// are no placeholder/canned values. The field names match the Go JSON tags exactly.

/** One real recovery/rehearsal execution captured against an application. */
export interface RecoverRecoveryEvent {
  event_id: string;
  /** runbook_run | drill | failover */
  source: string;
  runbook_id?: string;
  mode: string;
  status: string;
  succeeded: boolean;
  /** RTA (seconds); present only once the event reached a completed state. */
  rta_actual_seconds?: number;
  started_at: string;
  completed_at?: string;
}

/** Per-application RTO-vs-RTA view. */
export interface RecoverApplicationAnalytics {
  application_id: string;
  app_key: string;
  name: string;
  recovery_tier: string;
  /** RTO target (seconds), sourced from the Metastore seam — never hardcoded. */
  rto_target_seconds: number;
  /** RTA of the most recent completed recovery event (seconds), if any. */
  latest_rta_seconds?: number;
  /** True when latest_rta_seconds exceeds rto_target_seconds. */
  rta_breach: boolean;
  /** How far the latest RTA exceeded the target (seconds); 0 when within/uncaptured. */
  breach_seconds: number;
  execution_count: number;
  success_count: number;
  /** Per-application readiness (0..100). */
  readiness: number;
  events: RecoverRecoveryEvent[];
}

/** Multi-application recovery progress across the portfolio. */
export interface RecoverRecoveryProgress {
  total_applications: number;
  recovered: number;
  at_risk: number;
  untested: number;
  in_progress: number;
  /** recovered / total_applications (0..1). */
  completion_ratio: number;
}

/** One flagged problem area, ranked by severity (higher = worse). */
export interface RecoverBottleneck {
  /** rto_breach | failing_recovery | untested_application */
  kind: string;
  application_id?: string;
  app_key?: string;
  label: string;
  detail: string;
  /** 0..1 ranking weight (higher = worse). */
  severity: number;
}

/** One historical portfolio-readiness capture, for the readiness trend. */
export interface RecoverReadinessTrendPoint {
  score: number;
  application_count: number;
  breaching_count: number;
  captured_at: string;
}

/** The full `GET /api/recover/analytics` payload. */
export interface RecoverAnalytics {
  /** Portfolio readiness score (0..100). */
  portfolio_readiness: number;
  progress: RecoverRecoveryProgress;
  applications: RecoverApplicationAnalytics[];
  bottlenecks: RecoverBottleneck[];
  readiness_trend: RecoverReadinessTrendPoint[];
  generated_at: string;
}
