// Clario Recover — CYBER RECOVERY workspace types.
//
// These mirror the payloads published by the backend Cyber Recovery workspace
// (internal/recover/cyberrecovery) under /api/recover/cyber-recovery. The
// workspace composes the existing dr/* services (clean room, ransomware
// detection, clean points) and drives the clean-room RECOVERY FLOW with its
// MANDATORY integrity gate.

/** State-machine position of a clean-room recovery flow. */
export type CyberRecoveryPhase =
  | 'clean_point_selected'
  | 'provisioning'
  | 'provisioned'
  | 'recovering'
  | 'recovered'
  | 'integrity_checking'
  | 'integrity_passed'
  | 'integrity_failed'
  | 'awaiting_approval'
  | 'approved'
  | 'returned_to_production'
  | 'aborted';

/** Recovery target a clean point is provisioned to. */
export type CyberRecoveryTargetKind = 'clean_room' | 'bare_metal' | 'isolated_vpc';

/** Clean-room scan verdict. */
export type CyberRecoveryVerdict = 'clean' | 'malware' | 'integrity_failed' | 'error';

/** A last-known-good restore candidate with its clean-room freshness. */
export interface CyberCleanPoint {
  id: string;
  group_id: string;
  marker_lsn: string;
  sealed_at: string;
  is_validated: boolean;
  legal_hold: boolean;
  latest_scan_verdict?: CyberRecoveryVerdict | string;
  latest_scan_at?: string;
}

/** A ransomware early-warning signal projection. */
export interface CyberRansomwareSignal {
  id: string;
  stream_id: string;
  kind: string;
  severity: string;
  ratio: number;
  threshold: number;
  detail?: string;
  observed_at: string;
}

/** One clean-room recovery flow. */
export interface CyberRecoveryFlow {
  id: string;
  tenant_id: string;
  clean_point_id: string;
  group_id: string;
  target_label: string;
  target_kind: CyberRecoveryTargetKind;
  phase: CyberRecoveryPhase;
  runbook_run_id?: string;
  integrity_scan_id?: string;
  integrity_verdict?: CyberRecoveryVerdict | string;
  integrity_checked_at?: string;
  integrity_detail?: string;
  approved_by?: string;
  approved_by_email?: string;
  approved_at?: string;
  approval_note?: string;
  approved_for_scan_id?: string;
  returned_by?: string;
  returned_at?: string;
  abort_reason?: string;
  version: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

/** One append-only phase-transition event. */
export interface CyberRecoveryEvent {
  id: string;
  tenant_id: string;
  flow_id: string;
  from_phase: CyberRecoveryPhase | '';
  to_phase: CyberRecoveryPhase;
  actor_id?: string;
  actor_email?: string;
  detail?: Record<string, unknown>;
  created_at: string;
}

/** A flow plus its append-only transition history. */
export interface CyberRecoveryFlowDetail {
  flow: CyberRecoveryFlow;
  events: CyberRecoveryEvent[];
}

/** The live Cyber Recovery dashboard payload. */
export interface CyberRecoveryOverview {
  clean_points: CyberCleanPoint[];
  latest_clean_point?: CyberCleanPoint;
  clean_point_freshness_seconds?: number;
  ransomware_signals: CyberRansomwareSignal[];
  confirmed_ransomware_signals: number;
  flows: CyberRecoveryFlow[];
  active_flows: number;
  flows_awaiting_approval: number;
  generated_at: string;
}

/** Request body to start a flow from a clean point. */
export interface SelectCleanPointRequest {
  clean_point_id: string;
  target_label: string;
  target_kind?: CyberRecoveryTargetKind;
}
