export type DRJsonValue =
  | string
  | number
  | boolean
  | null
  | DRJsonValue[]
  | { [key: string]: DRJsonValue };

export type DRTimestamp = string;

export interface DRFailoverReadiness {
  status: string;
  can_failover: boolean;
  blocking_reasons: string[];
  warning_reasons: string[];
  active_run?: DRFailoverRunSummary | null;
}

export interface DRPosture {
  generated_at: DRTimestamp;
  overall_health: string;
  site_count: number;
  group_count: number;
  stream_count: number;
  recovery_point_count: number;
  streams_by_status: Record<string, number>;
  worst_live_rpo?: DRStreamSummary | null;
  rpo_breaches: DRStreamSummary[];
  attention: DRAttentionItem[];
  groups: DRGroupRollup[];
  recent_runs: DRFailoverRunSummary[];
}

export interface DRReplicationSummary {
  generated_at: DRTimestamp;
  overall_health: string;
  total_streams: number;
  streams_by_status: Record<string, number>;
  worst_live_rpo?: DRStreamSummary | null;
  rpo_breaches: DRStreamSummary[];
  streams: DRStreamSummary[];
}

export interface DRGroupSummary {
  generated_at: DRTimestamp;
  group_id: string;
  name: string;
  health: string;
  member_count: number;
  stream_count: number;
  replication_percent: number;
  rpo_objective_seconds: number;
  rto_objective_seconds: number;
  worst_live_rpo?: DRStreamSummary | null;
  rpo_breaches: DRStreamSummary[];
  latest_recovery_point?: DRRecoveryPointSummary | null;
  failover_readiness?: DRFailoverReadiness;
  members: DRGroupMemberSummary[];
  recent_runs: DRFailoverRunSummary[];
}

export interface DRGroupRollup {
  group_id: string;
  name: string;
  health: string;
  member_count: number;
  stream_count: number;
  replication_percent: number;
  rpo_objective_seconds: number;
  rto_objective_seconds: number;
  worst_live_rpo?: DRStreamSummary | null;
  latest_recovery_point?: DRRecoveryPointSummary | null;
  failover_readiness?: DRFailoverReadiness;
  last_run?: DRFailoverRunSummary | null;
}

export interface DRGroupMemberSummary {
  group_id: string;
  site_id: string;
  site_name?: string | null;
  site_kind?: string | null;
  boot_order: number;
  stream?: DRStreamSummary | null;
}

export interface DRStreamSummary {
  stream_id: string;
  site_id: string;
  site_name?: string | null;
  site_kind?: string | null;
  status: string;
  health: string;
  applied_seq: number;
  source_lsn?: string | null;
  applied_at?: DRTimestamp | null;
  last_error?: string | null;
  rpo_seconds?: number | null;
  lag_seconds?: number | null;
  has_data: boolean;
  breaches_rpo: boolean;
  rpo_objective_seconds: number;
  measured_at: DRTimestamp;
}

export interface DRRecoveryPointSummary {
  id: string;
  marker_lsn: string;
  rpo_seconds: number;
  validation_ratio?: number | null;
  is_validated: boolean;
  legal_hold: boolean;
  content_hash: string;
  sealed_at: DRTimestamp;
  retention_until: DRTimestamp;
}

export interface DRFailoverRunSummary {
  run_id: string;
  group_id: string;
  mode: string;
  status: string;
  rto_objective_seconds: number;
  rto_actual_seconds?: number | null;
  met_rto?: boolean | null;
  initiated_at: DRTimestamp;
  completed_at?: DRTimestamp | null;
  last_error?: string | null;
}

export interface DRAttentionItem {
  severity: string;
  kind: string;
  resource_type: string;
  resource_id: string;
  message: string;
}

export interface DRRecoveryTierRecommendation {
  tier: string;
  strategy: string;
  rto_objective_seconds: number;
  rpo_objective_seconds: number;
  validation_cadence_seconds: number;
  requires_cyber_vault: boolean;
  requires_clean_room: boolean;
  capabilities?: string[];
  notes?: string[];
}

export interface DRObjectiveFit {
  status: string;
  rto_objective_seconds: number;
  rpo_objective_seconds: number;
  warnings?: string[];
}

export interface DRProtectedSite {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  primary_endpoint: string;
  rto_objective_seconds: number;
  rpo_objective_seconds: number;
  recovery_tier_recommendation?: DRRecoveryTierRecommendation | null;
  objective_fit?: DRObjectiveFit | null;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export type DRSite = DRProtectedSite;

export interface DRCreateSiteRequest {
  name: string;
  kind: string;
  primary_endpoint: string;
  rto_objective_seconds: number;
  rpo_objective_seconds: number;
}

export interface DRConsistencyGroup {
  id: string;
  tenant_id: string;
  name: string;
  created_at: DRTimestamp;
}

export interface DRCreateGroupRequest {
  name: string;
}

export interface DRConsistencyGroupMember {
  group_id: string;
  site_id: string;
  boot_order: number;
}

export interface DRAddGroupMemberRequest {
  site_id: string;
  boot_order: number;
}

export interface DRReplicationStream {
  id: string;
  tenant_id: string;
  site_id: string;
  status: string;
  applied_seq: number;
  source_lsn?: string | null;
  applied_at?: DRTimestamp | null;
  last_error?: string | null;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRCreateStreamRequest {
  site_id: string;
  status: string;
}

export interface DRStreamRPO {
  stream_id: string;
  site_id: string;
  status: string;
  applied_seq: number;
  source_lsn?: string | null;
  rpo_seconds: number;
  lag_seconds: number;
  has_data: boolean;
  applied_at?: DRTimestamp | null;
  measured_at: DRTimestamp;
}

export interface DRRecoveryPoint {
  id: string;
  tenant_id: string;
  group_id: string;
  marker_lsn: string;
  rpo_seconds: number;
  object_keys: Record<string, string>;
  content_hash: string;
  validation_ratio?: number | null;
  is_validated: boolean;
  legal_hold: boolean;
  sealed_at: DRTimestamp;
  retention_until: DRTimestamp;
}

export interface DRSealRecoveryPointRequest {
  retention_until?: DRTimestamp;
}

export interface DRJournalTargetRequest {
  at?: DRTimestamp;
  lsn?: string;
  seq?: number;
}

export interface DRMaterializeJournalRecoveryPointRequest extends DRJournalTargetRequest {
  retention_until: DRTimestamp;
}

export interface DRNetworkMapping {
  id: string;
  tenant_id: string;
  group_id: string;
  profile: string;
  primary_cidr: string;
  recovery_cidr: string;
}

export interface DRCreateNetworkMappingRequest {
  profile: string;
  primary_cidr: string;
  recovery_cidr: string;
}

export interface DRHealthProbe {
  type?: string;
  target?: string;
  expected?: string;
  timeout?: string;
  retries?: number;
}

export interface DRRecoveryTarget {
  id: string;
  tenant_id: string;
  group_id: string;
  site_id: string;
  boot_order: number;
  recovery_endpoint?: string | null;
  health_probe: DRHealthProbe;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRFailoverRun {
  id: string;
  tenant_id: string;
  group_id: string;
  mode: string;
  status: string;
  recovery_point_id?: string | null;
  rto_objective_seconds: number;
  initiated_by: string;
  approved_by?: string | null;
  initiated_at: DRTimestamp;
  completed_at?: DRTimestamp | null;
  rto_actual_seconds?: number | null;
  last_error?: string | null;
  claimed_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
  /** Optional backend approval detail, when the API exposes a gate body. */
  approval_reason?: string | null;
  approval_quorum_status?: string | null;
  approval_quorum?: DRApprovalQuorumState | null;
  approval?: DRApprovalGateState | null;
}

export interface DRApprovalDecisionRequest {
  reason?: string;
}

export interface DRApprovalQuorumState {
  status?: string | null;
  required?: number | null;
  received?: number | null;
  remaining?: number | null;
}

export interface DRApprovalGateState {
  reason?: string | null;
  body?: string | null;
  quorum_status?: string | null;
  quorum?: DRApprovalQuorumState | null;
}

export interface DRCreateFailoverRunRequest {
  group_id: string;
  mode: string;
  recovery_point_id?: string | null;
  journal_target?: DRJournalTargetRequest | null;
  rto_objective_seconds: number;
}

export interface DRFailoverStep {
  id: string;
  run_id: string;
  step: string;
  status: string;
  detail?: Record<string, DRJsonValue>;
  started_at: DRTimestamp;
  finished_at?: DRTimestamp | null;
}

export interface DRAttestation {
  id: string;
  tenant_id: string;
  run_id: string;
  rto_objective_seconds: number;
  rto_actual_seconds: number;
  rpo_seconds: number;
  validation_ratio: number;
  report_object_key: string;
  content_hash: string;
  created_at: DRTimestamp;
}

export type DRRehearsalProofKind = 'gameday' | 'runbook-runs' | 'failover-runs';

export interface DRRehearsalRunRef {
  type: string;
  id: string;
  group_id?: string;
  scenario_id?: string;
  runbook_id?: string;
  mode?: string;
  status?: string;
}

export interface DRRehearsalScope {
  name: string;
  environment?: string;
  system_ids?: string[];
}

export interface DRRehearsalSystemRef {
  id: string;
  name?: string;
  kind?: string;
  critical?: boolean;
}

export interface DRRehearsalRunbookRef {
  id?: string;
  name?: string;
  version?: string;
  content_hash?: string;
  source?: string;
}

export interface DRRehearsalTargets {
  rto_target_seconds?: number;
  rto_actual_seconds?: number | null;
  rpo_target_seconds?: number;
  rpo_actual_seconds?: number | null;
  rto_met?: boolean | null;
  rpo_met?: boolean | null;
}

export interface DRRehearsalApprovalRef {
  id?: string;
  action?: string;
  approver?: string;
  approved_at?: DRTimestamp;
  source?: string;
}

export interface DRRehearsalHealthCheck {
  name: string;
  target?: string;
  status: string;
  passed: boolean;
  checked_at: DRTimestamp;
  detail?: string;
  evidence_id?: string;
  finished_at?: DRTimestamp | null;
}

export interface DRRehearsalIntegrityVerdict {
  source: string;
  verdict: string;
  passed: boolean;
  checked_at: DRTimestamp;
  evidence_id?: string;
  detail?: string;
}

export interface DRRehearsalTeardownStatus {
  status: string;
  failback_id?: string;
  completed_at?: DRTimestamp | null;
  detail?: string;
}

export interface DRRehearsalEvidenceReportRef {
  id: string;
  hash: string;
  algorithm: string;
  generated_at?: DRTimestamp;
  source?: string;
}

export interface DRRehearsalProvenance {
  source: string;
  live: boolean;
  seeded: boolean;
  demo: boolean;
  captured_from?: string;
  recorded_by?: string;
  captured_at: DRTimestamp;
  notes?: string;
}

export interface DRRehearsalProof {
  schema_version: string;
  id: string;
  tenant_id: string;
  run: DRRehearsalRunRef;
  scope: DRRehearsalScope;
  systems: DRRehearsalSystemRef[];
  runbook: DRRehearsalRunbookRef;
  targets: DRRehearsalTargets;
  approval_refs: DRRehearsalApprovalRef[];
  started_at: DRTimestamp;
  completed_at?: DRTimestamp | null;
  health_checks: DRRehearsalHealthCheck[];
  integrity_verdicts: DRRehearsalIntegrityVerdict[];
  failback_teardown: DRRehearsalTeardownStatus;
  evidence_report?: DRRehearsalEvidenceReportRef | null;
  overall_verdict: string;
  provenance: DRRehearsalProvenance;
  envelope_hash: string;
  generated_at: DRTimestamp;
}

export interface DRAgent {
  id: string;
  tenant_id: string;
  site_id?: string | null;
  status: string;
  mtls_thumbprint?: string | null;
  cert_serial?: string | null;
  cert_issued_at?: DRTimestamp | null;
  cert_expires_at?: DRTimestamp | null;
  cert_revoked_at?: DRTimestamp | null;
  cert_revoked_reason?: string | null;
  last_seen_at?: DRTimestamp | null;
  created_at: DRTimestamp;
}

export interface DRCreateAgentRequest {
  site_id?: string | null;
}

export interface DRAgentEnrollmentTokenRequest {
  tenant_id?: string;
  site_id?: string;
  purpose?: string;
  ttl_seconds?: number;
}

export interface DRAgentEnrollmentToken {
  jwt: string;
  jti: string;
  agent_id: string;
  tenant_id: string;
  site_id?: string | null;
  purpose: string;
  expires_at: DRTimestamp;
}

export interface DRAgentEnrollRequest {
  token: string;
  csr_pem: string;
  tenant_id?: string;
  site_id?: string;
}

export interface DRAgentEnrollResponse {
  cert_pem: string;
  ca_chain_pem: string;
  serial: string;
  expires_at: DRTimestamp;
  agent_id: string;
  tenant_id: string;
  site_id?: string | null;
}

export interface DRRecoveryTierProfile {
  tier: string;
  rto_seconds: number;
  rpo_seconds: number;
  recommended_strategy: string;
  minimum_validation_cadence_seconds: number;
  requires_cyber_vault: boolean;
  requires_clean_room: boolean;
  capabilities: string[];
  notes: string[];
}

export interface DRRecoveryTierRecommendationRequest {
  rto_seconds: number;
  rpo_seconds: number;
  business_critical?: boolean;
  mission_critical?: boolean;
  regulated_data?: boolean;
  ransomware_sensitive?: boolean;
}

export type DRBCMRuleKind =
  | 'drill_recency'
  | 'rto_met'
  | 'rpo_met'
  | 'recovery_point_validated'
  | 'immutability_enabled'
  | 'clean_room_verified'
  | 'attestation_issued'
  | 'group_configured';

export type DRBCMEvidenceKind =
  | 'drill'
  | 'attestation'
  | 'recovery_point'
  | 'failover'
  | 'clean_room'
  | 'group_topology';

export interface DRBCMRule {
  kind: DRBCMRuleKind;
  window_days?: number;
  min_count?: number;
  rto_objective_seconds?: number;
  rpo_objective_seconds?: number;
  min_ratio?: number;
  partial_tolerance?: number;
}

export interface DRBCMControl {
  code: string;
  title: string;
  description: string;
  required_evidence: DRBCMEvidenceKind[];
  rule: DRBCMRule;
  weight: number;
  mandatory: boolean;
}

export interface DRBCMPack {
  key: string;
  standard: string;
  version: string;
  authority: string;
  title: string;
  description: string;
  controls: DRBCMControl[];
}

export type DRBCMVerdict = 'satisfied' | 'partial' | 'failed';

export interface DRBCMControlResult {
  code: string;
  title: string;
  verdict: DRBCMVerdict;
  reason: string;
  mandatory: boolean;
  weight: number;
  evidence_refs?: string[];
}

export interface DRBCMGap {
  code: string;
  title: string;
  verdict: DRBCMVerdict;
  reason: string;
  mandatory: boolean;
}

export interface DRBCMAssessment {
  pack_key: string;
  standard: string;
  group_id: string;
  score: number;
  compliant: boolean;
  total_controls: number;
  satisfied: number;
  partial: number;
  failed: number;
  control_results: DRBCMControlResult[];
  gaps: DRBCMGap[];
  evaluated_at: DRTimestamp;
}

export interface DRBCMStoredAssessment {
  id: string;
  tenant_id: string;
  group_id: string;
  pack_key: string;
  standard: string;
  pack_version: string;
  score: number;
  compliant: boolean;
  total_controls: number;
  satisfied: number;
  partial: number;
  failed: number;
  created_by: string;
  created_at: DRTimestamp;
}

export interface DRBCMStoredControlResult {
  id: string;
  assessment_id: string;
  tenant_id: string;
  control_code: string;
  control_title: string;
  verdict: DRBCMVerdict;
  reason: string;
  mandatory: boolean;
  weight: number;
  evidence_refs: string[];
}

export interface DRBCMAssessmentRunResponse {
  assessment: DRBCMStoredAssessment;
  score: number;
  compliant: boolean;
  controls: DRBCMControlResult[];
  gaps: DRBCMGap[];
}

export interface DRBCMAssessmentReport {
  assessment: DRBCMStoredAssessment;
  control_results: DRBCMStoredControlResult[];
  gaps: DRBCMGap[];
}

export interface DRBYOKKey {
  id: string;
  tenant_id: string;
  key_version: number;
  provider: string;
  reference: string;
  state: string;
  created_at: DRTimestamp;
  activated_at?: DRTimestamp | null;
  retired_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
}

export interface DRBYOKEnrollRequest {
  provider: string;
  reference: string;
}

export interface DRBYOKCustodyEntry {
  id: string;
  tenant_id: string;
  seq: number;
  action: string;
  kek_version: number;
  dek_id?: string;
  detail?: string;
  prev_hash: string;
  entry_hash: string;
  created_at: DRTimestamp;
}

export interface DRBYOKCustodyLog {
  entries: DRBYOKCustodyEntry[];
  intact: boolean;
  broken_seq: number;
  merkle_root: string;
}

export interface DRAttestationLedgerEntry {
  id: string;
  tenant_id: string;
  seq: number;
  entry_type: string;
  subject_id: string;
  payload: DRJsonValue;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  anchored_root?: string | null;
  created_at: DRTimestamp;
}

export interface DRAttestationLedgerFilters {
  type?: string;
  subject?: string;
  limit?: number;
}

export interface DRAttestationLedgerVerifyResult {
  intact: boolean;
  entries_checked: number;
  first_broken_seq?: number;
  reason?: string;
  head_hash?: string;
}

export interface DRAttestationLedgerCheckpoint {
  id: string;
  tenant_id: string;
  from_seq: number;
  to_seq: number;
  merkle_root: string;
  entry_count: number;
  worm_object_key?: string;
  worm_version_id?: string;
  created_at: DRTimestamp;
}

export interface DRAttestationLedgerProofNode {
  hash: string;
  left: boolean;
}

export interface DRAttestationLedgerInclusionProof {
  seq: number;
  leaf_index: number;
  leaf_hash: string;
  path: DRAttestationLedgerProofNode[];
  root: string;
  from_seq: number;
  to_seq: number;
}

export type DRCyberVaultProvider =
  | 'generic'
  | 'aws_backup'
  | 'azure_backup'
  | 'gcp_backup_dr'
  | 's3_object_lock';

export type DRCyberVaultVerdict = 'satisfied' | 'partial' | 'failed';
export type DRCyberVaultFindingSeverity = 'warning' | 'high';

export interface DRCyberVaultApprovalPolicy {
  require_restore_approval: boolean;
  restore_approvers: number;
  require_destructive_approval: boolean;
  destructive_approvers: number;
  separation_of_duties: boolean;
}

export interface DRCyberVaultRetentionPolicy {
  minimum_days: number;
  required_minimum_days?: number;
}

export interface DRCyberVaultIsolationPolicy {
  cross_account: boolean;
  disjoint_admins: boolean;
  source_admin_denied: boolean;
}

export interface DRCyberVaultPosture {
  id?: string;
  name?: string;
  provider: DRCyberVaultProvider | string;
  primary_region?: string;
  replica_regions?: string[];
  immutability_enabled: boolean;
  vault_lock_enabled: boolean;
  encryption_enabled: boolean;
  customer_managed_key: boolean;
  approval: DRCyberVaultApprovalPolicy;
  retention: DRCyberVaultRetentionPolicy;
  isolation: DRCyberVaultIsolationPolicy;
  last_restore_test_at?: DRTimestamp;
  last_restore_test_passed: boolean;
  restore_test_window_days?: number;
  break_glass_enabled: boolean;
  break_glass_mfa: boolean;
  break_glass_last_tested_at?: DRTimestamp;
  break_glass_test_window_days?: number;
}

export interface DRCyberVault {
  id?: string;
  tenant_id?: string;
  group_id?: string;
  provider: DRCyberVaultProvider | string;
  name: string;
  external_id?: string;
  posture: DRCyberVaultPosture;
  created_at?: DRTimestamp;
  updated_at?: DRTimestamp;
}

export interface DRCyberVaultFinding {
  code: string;
  title: string;
  verdict: DRCyberVaultVerdict;
  severity: DRCyberVaultFindingSeverity;
  weight: number;
  message: string;
  remediation: string;
}

export interface DRCyberVaultPostureAssessment {
  vault_id?: string;
  provider: DRCyberVaultProvider | string;
  score: number;
  verdict: DRCyberVaultVerdict;
  total_controls: number;
  satisfied: number;
  partial: number;
  failed: number;
  findings: DRCyberVaultFinding[];
  evaluated_at: DRTimestamp;
}

export interface DRCyberVaultStoredPostureAssessment {
  ID: string;
  TenantID: string;
  GroupID: string;
  VaultID: string;
  Provider: DRCyberVaultProvider | string;
  Posture: DRCyberVaultPosture;
  Assessment: DRCyberVaultPostureAssessment;
  Score: number;
  Verdict: DRCyberVaultVerdict;
  EvaluatedAt: DRTimestamp;
  CreatedAt: DRTimestamp;
}

export interface DRCyberVaultListResponse {
  vaults: DRCyberVault[];
  count: number;
}

export interface DRCyberVaultAssessmentListResponse {
  assessments: DRCyberVaultStoredPostureAssessment[];
  count: number;
}

export type DRAssuranceVerdict = 'satisfied' | 'partial' | 'failed';
export type DRAssuranceSeverity = 'warning' | 'high' | 'critical';

export interface DRAssuranceControlInfo {
  code: string;
  title: string;
  weight: number;
  fail_severity: DRAssuranceSeverity;
}

export interface DRAssuranceStoredAssessment {
  id: string;
  tenant_id: string;
  group_id: string;
  profile_id?: string;
  workload_id?: string;
  score: number;
  verdict: DRAssuranceVerdict;
  total_checks: number;
  satisfied: number;
  partial: number;
  failed: number;
  created_by: string;
  created_at: DRTimestamp;
}

export interface DRAssuranceCheckResult {
  code: string;
  title: string;
  verdict: DRAssuranceVerdict;
  severity?: DRAssuranceSeverity;
  weight: number;
  message?: string;
  recommendation?: string;
  evidence_refs?: string[];
}

export interface DRAssuranceStoredResult {
  id: string;
  assessment_id: string;
  tenant_id: string;
  code: string;
  title: string;
  verdict: DRAssuranceVerdict;
  severity?: DRAssuranceSeverity;
  weight: number;
  message?: string;
  recommendation?: string;
  evidence_refs: string[];
}

export interface DRAssuranceFinding {
  code: string;
  title: string;
  verdict: DRAssuranceVerdict;
  severity: DRAssuranceSeverity;
  weight: number;
  message: string;
  recommendation: string;
  evidence_refs?: string[];
}

export interface DRAssuranceEvaluateResponse {
  assessment: DRAssuranceStoredAssessment;
  score: number;
  verdict: DRAssuranceVerdict;
  results: DRAssuranceCheckResult[];
  findings: DRAssuranceFinding[];
  recommendations: string[];
}

export interface DRAssuranceAssessmentReport {
  assessment: DRAssuranceStoredAssessment;
  results: DRAssuranceStoredResult[];
  findings: DRAssuranceFinding[];
  recommendations: string[];
}

export interface DRJournalSegment {
  id: string;
  tenant_id: string;
  stream_id: string;
  min_seq: number;
  max_seq: number;
  frame_count: number;
  min_lsn: string;
  max_lsn: string;
  min_ts: DRTimestamp;
  max_ts: DRTimestamp;
  object_key: string;
  payload_bytes: number;
  content_hash: string;
  pruned: boolean;
  pruned_at?: DRTimestamp | null;
  sealed_at: DRTimestamp;
}

export interface DRJournalBookmark {
  id: string;
  tenant_id: string;
  stream_id: string;
  name: string;
  kind: string;
  at_seq: number;
  at_lsn: string;
  at_ts: DRTimestamp;
  note?: string;
  created_by?: string | null;
  created_at: DRTimestamp;
}

export interface DRJournalTimeline {
  stream_id: string;
  segments: DRJournalSegment[];
  bookmarks: DRJournalBookmark[];
  earliest_seq: number;
  earliest_lsn: string;
  earliest_ts: DRTimestamp;
  latest_seq: number;
  latest_lsn: string;
  latest_ts: DRTimestamp;
  recoverable: boolean;
  has_gaps: boolean;
}

export interface DRJournalResolveRequest {
  at?: DRTimestamp;
  lsn?: string;
  seq?: number;
}

export interface DRJournalResolution {
  stream_id: string;
  target_kind: string;
  target_ts?: DRTimestamp | null;
  target_lsn?: string;
  target_seq?: number | null;
  segments: DRJournalSegment[];
  cut_seq: number;
  cut_lsn: string;
  cut_ts: DRTimestamp;
  exact_match: boolean;
  boundary_clamped: boolean;
}

export interface DRCreateJournalBookmarkRequest {
  name: string;
  kind: string;
  at_seq?: number;
  at_lsn?: string;
  at_ts?: DRTimestamp;
  note?: string;
}

export interface DRInstantRecoverySession {
  id: string;
  tenant_id: string;
  recovery_point_id: string;
  group_id?: string | null;
  state: string;
  chunks_total: number;
  chunks_hydrated: number;
  chunk_size: number;
  overlay_location: string;
  finalized_location?: string | null;
  last_error?: string | null;
  started_at: DRTimestamp;
  ready_at?: DRTimestamp | null;
  finalized_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
}

export interface DRInstantRecoveryProgress {
  session: DRInstantRecoverySession;
  percent_complete: number;
}

export interface DRFailbackRun {
  id: string;
  tenant_id: string;
  group_id: string;
  failover_run_id?: string | null;
  from_site: string;
  to_site: string;
  reverse_stream_id?: string | null;
  status: string;
  delta_bytes_remaining: number;
  delta_seq_remaining: number;
  converge_threshold_bytes: number;
  source_lsn?: string | null;
  applied_lsn?: string | null;
  last_converged_at?: DRTimestamp | null;
  cutover_window_open: boolean;
  initiated_by: string;
  approved_by?: string | null;
  approved_at?: DRTimestamp | null;
  new_direction?: string | null;
  last_error?: string | null;
  claimed_at?: DRTimestamp | null;
  initiated_at: DRTimestamp;
  completed_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
  /** Optional backend approval detail, when the API exposes a gate body. */
  approval_reason?: string | null;
  approval_quorum_status?: string | null;
  approval_quorum?: DRApprovalQuorumState | null;
  approval?: DRApprovalGateState | null;
}

export interface DRFailbackStep {
  id: string;
  run_id: string;
  step: string;
  status: string;
  detail?: Record<string, DRJsonValue>;
  started_at: DRTimestamp;
  finished_at?: DRTimestamp | null;
}

export interface DRCreateFailbackRunRequest {
  group_id: string;
  from_site: string;
  to_site: string;
  failover_run_id?: string | null;
  converge_threshold_bytes?: number;
}

export interface DRConsistencyBarrier {
  id: string;
  tenant_id: string;
  group_id: string;
  recovery_point_id?: string | null;
  consistency_level: string;
  provider: string;
  barrier_lsn: string;
  success: boolean;
  quiesced: boolean;
  thawed: boolean;
  detail?: string;
  error?: string;
  requested_by?: string | null;
  quiesce_started_at?: DRTimestamp | null;
  quiesce_finished_at?: DRTimestamp | null;
  thaw_started_at?: DRTimestamp | null;
  thaw_finished_at?: DRTimestamp | null;
  created_at: DRTimestamp;
}

export interface DRTriggerConsistencyPointRequest {
  provider?: string;
  script?: {
    freeze_cmd: string;
    thaw_cmd: string;
    shell?: string;
    timeout_sec?: number;
  };
  http?: {
    base_url: string;
    auth_token?: string;
    timeout_sec?: number;
  };
  retention_until?: DRTimestamp;
}

export interface DRTopologyNode {
  id: string;
  tenant_id: string;
  group_id: string;
  site_id: string;
  site_name: string;
  role: string;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRTopologyEdge {
  id: string;
  tenant_id: string;
  group_id: string;
  from_node_id: string;
  to_node_id: string;
  stream_id: string;
  mode: string;
  priority: number;
  health: string;
  lag_seconds?: number | null;
  applied_seq: number;
  last_progress_at?: DRTimestamp | null;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRTopology {
  group_id: string;
  nodes: DRTopologyNode[];
  edges: DRTopologyEdge[];
  topo_order?: string[];
}

export interface DRTopologyAddEdgeRequest {
  from_site_id: string;
  to_site_id: string;
  from_role?: string;
  to_role?: string;
  stream_id: string;
  mode?: string;
  priority?: number;
}

export interface DRTopologyFailoverCandidate {
  node_id: string;
  site_id: string;
  site_name: string;
  role: string;
  edge_id: string;
  stream_id: string;
  mode: string;
  priority: number;
  health: string;
  eligible: boolean;
  lag_seconds?: number | null;
  applied_seq: number;
  reason: string;
}

export interface DRTopologyFailoverSelection {
  group_id: string;
  selected?: DRTopologyFailoverCandidate | null;
  ranking: DRTopologyFailoverCandidate[];
  evaluated_at: DRTimestamp;
}

export interface DRBootService {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  kind: string;
  boot_action: string;
  site_id?: string;
  probe_kind: string;
  probe_target: string;
  probe_expect_status: number;
  boot_timeout_seconds: number;
  health_retries: number;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRBootPlan {
  group_id: string;
  tiers: DRBootService[][];
  tier_names?: string[][];
  tier_count?: number;
}

export interface DRCreateBootServicesRequest {
  services: Array<{
    name: string;
    kind?: string;
    boot_action?: string;
    site_id?: string;
    probe_kind: string;
    probe_target: string;
    probe_expect_status?: number;
    boot_timeout_seconds?: number;
    health_retries?: number;
    depends_on?: string[];
  }>;
}

export interface DRBootRun {
  id: string;
  tenant_id: string;
  group_id: string;
  status: string;
  policy: string;
  total_tiers: number;
  tiers_booted: number;
  initiated_by?: string | null;
  last_error?: string | null;
  started_at: DRTimestamp;
  completed_at?: DRTimestamp | null;
}

export interface DRBootServiceStatus {
  id: string;
  run_id: string;
  service_id: string;
  service_name: string;
  tier: number;
  status: string;
  attempts: number;
  last_error?: string | null;
  booted_at?: DRTimestamp | null;
  healthy_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
}

export interface DRBootRunDetail {
  run: DRBootRun;
  services: DRBootServiceStatus[];
}

export interface DRDrillSchedule {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  cron_expr: string;
  profile: string;
  rto_objective_seconds: number;
  enabled: boolean;
  next_run: DRTimestamp;
  last_fired_at?: DRTimestamp | null;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRCreateDrillScheduleRequest {
  group_id: string;
  name: string;
  cron_expr: string;
  profile?: string;
  rto_objective_seconds?: number;
  enabled?: boolean;
}

export interface DRDrillNextRunsResponse {
  schedule_id: string;
  next_runs: DRTimestamp[];
  count: number;
}

export interface DRDrillStep {
  key: string;
  title?: string;
  status: string;
  duration_ms: number;
}

export interface DRDrillResult {
  id: string;
  tenant_id: string;
  group_id: string;
  schedule_id?: string | null;
  run_id: string;
  passed: boolean;
  rto_achieved_seconds: number;
  rpo_achieved_seconds: number;
  rto_objective_seconds: number;
  recovery_point_id?: string | null;
  validation_ratio?: number | null;
  validation_outcome: string;
  steps: DRDrillStep[];
  asset_fingerprint: {
    members?: Record<string, number>;
    topology_edges?: string[];
  };
  observed_at: DRTimestamp;
  created_at: DRTimestamp;
}

export interface DRDrillDiff {
  group_id: string;
  schedule_id?: string | null;
  current_result_id: string;
  previous_result_id: string;
  passed_changed: boolean;
  previous_passed: boolean;
  current_passed: boolean;
  newly_regressed: boolean;
  newly_recovered: boolean;
  rto_delta_seconds: number;
  rpo_delta_seconds: number;
  rto_regressed: boolean;
  rpo_regressed: boolean;
  newly_failed_steps?: string[];
  newly_passed_steps?: string[];
  added_steps?: string[];
  removed_steps?: string[];
  duration_drift?: Array<{
    key: string;
    previous_ms: number;
    current_ms: number;
    delta_ms: number;
    change_fraction: number;
  }>;
  asset_drift: {
    added_members?: string[];
    removed_members?: string[];
    reordered_members?: Array<{
      site_id: string;
      from_order: number;
      to_order: number;
    }>;
    added_edges?: string[];
    removed_edges?: string[];
  };
}

export interface DRGameDayExpectation {
  signal: string;
  detect_within?: string;
  recover_within?: string;
}

export interface DRGameDayStep {
  action: string;
  target: string;
  params?: Record<string, DRJsonValue>;
  expect: DRGameDayExpectation;
}

export interface DRGameDayScenario {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  description: string;
  scope: string;
  steps: DRGameDayStep[];
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRCreateGameDayScenarioRequest {
  group_id: string;
  name: string;
  description?: string;
  scope: string;
  steps: DRGameDayStep[];
}

export interface DRGameDayRun {
  id: string;
  tenant_id: string;
  scenario_id: string;
  group_id: string;
  scope: string;
  status: string;
  steps_total: number;
  steps_passed: number;
  score?: number | null;
  all_faults_reverted: boolean;
  safety_verdict: string;
  last_error?: string | null;
  initiated_by?: string | null;
  initiated_at: DRTimestamp;
  started_at?: DRTimestamp | null;
  completed_at?: DRTimestamp | null;
  claimed_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
}

export interface DRGameDayStepResult {
  id: string;
  tenant_id: string;
  run_id: string;
  step_index: number;
  action: string;
  target: string;
  observability: string;
  expected_signal: string;
  detect_within_ms: number;
  recover_within_ms: number;
  signal_observed: boolean;
  observed_signal: string;
  detection_latency_ms?: number | null;
  recovery_latency_ms?: number | null;
  fault_reverted: boolean;
  passed: boolean;
  detail: string;
  started_at: DRTimestamp;
  finished_at?: DRTimestamp | null;
}

export interface DRGameDayScorecard {
  run: DRGameDayRun;
  steps: DRGameDayStepResult[];
}

export interface DRRunbook {
  id: string;
  tenant_id: string;
  group_id?: string | null;
  name: string;
  description: string;
  status: string;
  source: string;
  created_by?: string | null;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRRunbookTask {
  id: string;
  tenant_id: string;
  runbook_id: string;
  task_key: string;
  name: string;
  task_type: string;
  required: boolean;
  owner: string;
  team: string;
  instructions: string;
  planned_duration_seconds: number;
  automation_action: string;
  predecessors: string[];
  params?: Record<string, DRJsonValue>;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRRunbookRun {
  id: string;
  tenant_id: string;
  runbook_id: string;
  mode: string;
  status: string;
  planned_critical_path_seconds: number;
  started_by?: string | null;
  started_at: DRTimestamp;
  completed_at?: DRTimestamp | null;
  actual_duration_seconds?: number | null;
  last_error?: string | null;
  claimed_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
}

export interface DRRunbookTaskRun {
  id: string;
  tenant_id: string;
  run_id: string;
  task_id: string;
  status: string;
  acted_by?: string | null;
  started_at?: DRTimestamp | null;
  finished_at?: DRTimestamp | null;
  actual_duration_seconds?: number | null;
  detail?: Record<string, DRJsonValue>;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

// Mirrors backend runbookstudio.RunProjection (internal/dr/runbookstudio/engine.go).
// Every field is serialized unconditionally (no omitempty), so all are required.
// The server already computes the projected finish + on-track verdict over the
// live sub-DAG of outstanding work — consume those directly; do not re-derive.
export interface DRRunbookProjection {
  planned_critical_path_seconds: number;
  elapsed_seconds: number;
  completed_tasks: number;
  total_tasks: number;
  remaining_critical_path_seconds: number;
  projected_finish_seconds: number;
  projected_finish_at: DRTimestamp;
  on_track: boolean;
  variance_seconds: number;
}

export interface DRRunbookPlan {
  runbook: DRRunbook;
  tasks: DRRunbookTask[];
}

export interface DRRunbookLiveState {
  run: DRRunbookRun;
  tasks: DRRunbookTask[];
  task_runs: DRRunbookTaskRun[];
  frontier: string[];
  projection: DRRunbookProjection;
}

export interface DRCreateRunbookRequest {
  name: string;
  description?: string;
  group_id?: string;
  import_steps?: Array<{
    key: string;
    name: string;
    task_type?: string;
    required: boolean;
    owner?: string;
    team?: string;
    instructions?: string;
    planned_duration_seconds?: number;
    automation_action?: string;
    params?: Record<string, DRJsonValue>;
  }>;
}

export interface DRRunbookUpdateRequest {
  name?: string;
  description?: string;
  status?: string;
}

export interface DRRunbookAddTaskRequest {
  task_key: string;
  name: string;
  task_type?: string;
  required?: boolean;
  owner?: string;
  team?: string;
  instructions?: string;
  planned_duration_seconds?: number;
  automation_action?: string;
  predecessors?: string[];
  params?: Record<string, DRJsonValue>;
}

export interface DRRunbookStartRunRequest {
  mode?: string;
}

export interface DRRunbookActionRequest {
  note?: string;
  fail_run?: boolean;
}

export type DRRegistryRunbookProfile = 'production' | 'isolated';

export interface DRPrediction {
  id: string;
  tenant_id: string;
  stream_id: string;
  group_label: string;
  rpo_objective_seconds: number;
  smoothed_lag_seconds: number;
  lag_trend_slope: number;
  throughput_trend_slope: number;
  predicted_breach_seconds?: number | null;
  breach_forecast: boolean;
  throughput_collapse: boolean;
  sample_count: number;
  forecast_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRPredictionSample {
  id: string;
  tenant_id: string;
  stream_id: string;
  observed_at: DRTimestamp;
  lag_seconds: number;
  throughput_bps: number;
  applied_seq: number;
  created_at: DRTimestamp;
}

export interface DRStreamForecast {
  prediction?: DRPrediction | null;
  samples: DRPredictionSample[];
}

export interface DRRegistryMemberAsset {
  site_id: string;
  site_name: string;
  site_kind: string;
  primary_endpoint: string;
  boot_order: number;
  network_profile: DRRegistryRunbookProfile | string;
  primary_cidr?: string;
  recovery_cidr?: string;
}

export interface DRRegistryRecoveryPointAsset {
  id: string;
  marker_lsn: string;
  rpo_seconds: number;
  validation_ratio: number;
  is_validated: boolean;
  legal_hold: boolean;
  sealed_at: DRTimestamp;
}

export interface DRRegistryAssetSnapshot {
  group_id: string;
  group_name: string;
  rto_objective_seconds: number;
  rpo_objective_seconds: number;
  network_profile: DRRegistryRunbookProfile | string;
  members: DRRegistryMemberAsset[];
  recovery_point?: DRRegistryRecoveryPointAsset | null;
  captured_at: DRTimestamp;
}

export type DRRegistryRunbookStepKind =
  | 'pin_recovery_point'
  | 'quiesce'
  | 'approval'
  | 'boot_member'
  | 'health_gate'
  | 'attest';

export interface DRRegistryRunbookStep {
  key: string;
  order: number;
  kind: DRRegistryRunbookStepKind | string;
  gate?: string;
  title: string;
  description: string;
  params?: Record<string, DRJsonValue>;
}

export interface DRRegistryReorderedStep {
  key: string;
  from_pos: number;
  to_pos: number;
}

export interface DRRegistryRunbookDiff {
  added: string[];
  removed: string[];
  reordered: DRRegistryReorderedStep[];
  changed: string[];
}

export type DRRegistryRunbookTrigger =
  | 'manual'
  | 'membership'
  | 'recovery_point'
  | 'network_mapping'
  | 'site'
  | 'group';

export interface DRRegistryRunbookVersion {
  id: string;
  runbook_id: string;
  tenant_id: string;
  group_id: string;
  version: number;
  template_id: string;
  steps: DRRegistryRunbookStep[];
  asset_snapshot: DRRegistryAssetSnapshot;
  content_hash: string;
  diff?: DRRegistryRunbookDiff | null;
  trigger: DRRegistryRunbookTrigger | string;
  created_at: DRTimestamp;
}

export interface DRRegistryRegenerateResult {
  version: DRRegistryRunbookVersion;
  changed: boolean;
  diff?: DRRegistryRunbookDiff | null;
}

export type DRRansomwareSignalKind =
  | 'entropy'
  | 'byte_rate'
  | 'change_rate'
  | 'delete_burst';

export type DRRansomwareSignalSeverity = 'warning' | 'confirmed';

export interface DRRansomwareSignal {
  id: string;
  tenant_id: string;
  stream_id: string;
  kind: DRRansomwareSignalKind | string;
  severity: DRRansomwareSignalSeverity | string;
  observed: number;
  baseline: number;
  ratio: number;
  threshold: number;
  sample_seq: number;
  source_lsn?: string;
  curated_recovery_point_id?: string;
  detail: string;
  observed_at: DRTimestamp;
  created_at: DRTimestamp;
}

export interface DRRansomwareSignalFilters {
  limit?: number;
  stream_id?: string;
}

export type DRCleanRoomVerdict = 'clean' | 'malware' | 'integrity_failed' | 'error';

export interface DRCleanRoomChunkVerdict {
  stream_id: string;
  object_key: string;
  sandbox_path: string;
  bytes: number;
  sha256: string;
  integrity_ok: boolean;
  clean: boolean;
  threat?: string;
}

export interface DRCleanRoomScan {
  id: string;
  tenant_id: string;
  recovery_point_id: string;
  group_id: string;
  verdict: DRCleanRoomVerdict | string;
  scanner: string;
  chunks_scanned: number;
  bytes_scanned: number;
  detail: string;
  findings: DRCleanRoomChunkVerdict[];
  started_at: DRTimestamp;
  finished_at: DRTimestamp;
}

export type DRCopilotMessageRole = 'user' | 'assistant' | 'tool';

export interface DRCopilotChatRequest {
  session_id?: string | null;
  message: string;
}

export interface DRCopilotToolCallRecord {
  id: string;
  name: string;
  arguments?: Record<string, DRJsonValue>;
  success: boolean;
  result_summary: string;
  latency_ms: number;
}

export interface DRCopilotAPICall {
  method: string;
  path: string;
  body?: Record<string, DRJsonValue>;
}

export interface DRCopilotProposedAction {
  kind: string;
  summary: string;
  requires_approval: boolean;
  api_call: DRCopilotAPICall;
  approval_call?: DRCopilotAPICall | null;
  plan?: Record<string, DRJsonValue>;
  warnings?: string[];
}

export interface DRCopilotChatResult {
  session_id: string;
  message_id: string;
  answer: string;
  tool_calls?: DRCopilotToolCallRecord[];
  proposed_action?: DRCopilotProposedAction | null;
  provider: string;
  model: string;
  latency_ms: number;
  iterations: number;
}

export interface DRCopilotSession {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  provider: string;
  model: string;
  message_count: number;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRCopilotMessage {
  id: string;
  session_id: string;
  tenant_id: string;
  seq: number;
  role: DRCopilotMessageRole | string;
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_calls?: DRCopilotToolCallRecord[];
  proposed_action?: DRCopilotProposedAction | null;
  latency_ms: number;
  created_at: DRTimestamp;
}

export interface DRCopilotSessionTranscript {
  session: DRCopilotSession;
  messages: DRCopilotMessage[];
}

export type DRIaCSourceKind =
  | 'terraform_state'
  | 'k8s_manifest'
  | 'helm_release';

export interface DRIaCIngestSnapshotRequest {
  name: string;
  source_kind: DRIaCSourceKind | string;
  group_id?: string;
  artifact?: string;
  artifact_base64?: string;
}

export interface DRIaCSnapshotList {
  snapshots: DRIaCSnapshot[];
  count: number;
}

export interface DRIaCSnapshot {
  id: string;
  tenant_id: string;
  group_id?: string | null;
  name: string;
  source_kind: DRIaCSourceKind | string;
  version: number;
  content_hash: string;
  resource_count: number;
  metadata?: Record<string, string>;
  created_at: DRTimestamp;
  resources?: DRIaCResource[];
}

export interface DRIaCResource {
  id?: string;
  tenant_id?: string;
  snapshot_id?: string;
  provider: string;
  type: string;
  name: string;
  address: string;
  attributes: Record<string, DRJsonValue>;
  depends_on: string[];
  hash: string;
  created_at?: DRTimestamp;
}

export interface DRIaCResourceKey {
  provider: string;
  type: string;
  name: string;
}

export interface DRIaCAttributeChange {
  path: string;
  old_value?: DRJsonValue;
  new_value?: DRJsonValue;
  had_old: boolean;
  had_new: boolean;
}

export type DRIaCResourceChangeType = 'added' | 'removed' | 'modified';

export interface DRIaCResourceDiff {
  key: DRIaCResourceKey;
  change: DRIaCResourceChangeType | string;
  address: string;
  old_hash?: string;
  new_hash?: string;
  attributes?: DRIaCAttributeChange[];
}

export interface DRIaCDiff {
  base_snapshot_id?: string;
  target_snapshot_id?: string;
  added: DRIaCResourceDiff[];
  removed: DRIaCResourceDiff[];
  modified: DRIaCResourceDiff[];
}

export interface DRIaCPlanStep {
  order: number;
  wave: number;
  key: DRIaCResourceKey;
  address: string;
  provider: string;
  type: string;
  name: string;
  depends_on?: string[];
}

export interface DRIaCReconstitutionPlan {
  snapshot_id?: string;
  steps: DRIaCPlanStep[];
  waves: DRIaCPlanStep[][];
}

export type DRStorageProvider =
  | 'file'
  | 'netapp_ontap'
  | 'dell_powerstore'
  | 'nfs';

export type DRStorageSnapshotKind = 'full' | 'incremental';

export type DRStorageSnapshotState =
  | 'PENDING'
  | 'CREATING'
  | 'READY'
  | 'REPLICATING'
  | 'REPLICATED'
  | 'EXPIRED'
  | 'FAILED';

export interface DRRegisterStorageVolumeRequest {
  name: string;
  provider?: DRStorageProvider | string;
  array_endpoint?: string;
  source_location: string;
  site_id?: string;
  retention_max_snapshots?: number;
  retention_max_age_seconds?: number;
}

export interface DRReplicateStorageSnapshotRequest {
  target: string;
}

export interface DRStorageVolume {
  id: string;
  tenant_id: string;
  name: string;
  provider: DRStorageProvider | string;
  array_endpoint: string;
  source_location: string;
  site_id?: string | null;
  retention_max_snapshots: number;
  retention_max_age_seconds: number;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRStorageSnapshot {
  id: string;
  tenant_id: string;
  volume_id: string;
  parent_id?: string | null;
  provider_handle: string;
  kind: DRStorageSnapshotKind | string;
  state: DRStorageSnapshotState | string;
  manifest_hash: string;
  size_bytes: number;
  changed_bytes: number;
  file_count: number;
  replicated_target?: string | null;
  last_error?: string | null;
  created_at: DRTimestamp;
  ready_at?: DRTimestamp | null;
  replicated_at?: DRTimestamp | null;
  expired_at?: DRTimestamp | null;
  updated_at: DRTimestamp;
}

export type DRWorkloadCaptureSourceKind = 'vm_disk' | 'k8s_workload';

export type DRWorkloadCaptureBindingKind =
  | 'file'
  | 'vmware_cbt'
  | 'libvirt'
  | 'rest'
  | 'fixture';

export type DRWorkloadCaptureEpochKind = 'base' | 'incremental';

export interface DRRegisterWorkloadCaptureRequest {
  stream_id: string;
  name: string;
  source_kind: DRWorkloadCaptureSourceKind | string;
  binding_kind: DRWorkloadCaptureBindingKind | string;
  block_size_bytes?: number;
  config?: Record<string, DRJsonValue>;
  enabled?: boolean;
}

export interface DRWorkloadCaptureSource {
  id: string;
  tenant_id: string;
  stream_id: string;
  name: string;
  source_kind: DRWorkloadCaptureSourceKind | string;
  binding_kind: DRWorkloadCaptureBindingKind | string;
  block_size_bytes: number;
  config: Record<string, DRJsonValue>;
  enabled: boolean;
  epoch_count: number;
  last_run_at?: DRTimestamp | null;
  last_seq: number;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

export interface DRWorkloadCaptureResourceHeader {
  kind: string;
  namespace: string;
  name: string;
  hash: string;
  data_ref?: string;
}

export interface DRWorkloadCaptureEpoch {
  id: string;
  tenant_id: string;
  source_id: string;
  stream_id: string;
  epoch: number;
  epoch_kind: DRWorkloadCaptureEpochKind | string;
  from_seq: number;
  to_seq: number;
  frame_count: number;
  changed_units: number;
  total_units: number;
  payload_bytes: number;
  content_hash: string;
  source_marker: string;
  set_summary?: DRWorkloadCaptureResourceHeader[];
  captured_at: DRTimestamp;
}

export type DRSelfDRComponentKind =
  | 'postgres_control_db'
  | 'object_worm_store'
  | 'event_outbox_queue'
  | 'vault_pki_secrets'
  | 'container_images_artifacts'
  | 'config_iac'
  | 'observability'
  | 'dr_service';

export type DRSelfDRSeverity = 'info' | 'warning' | 'critical';
export type DRSelfDRVerdict = 'ready' | 'degraded' | 'not_ready';
export type DRSelfDRArtifactKind =
  | 'control_plane_backup'
  | 'offline_restore_bundle';
export type DRSelfDROfflineBundleFormat = 'tar.gz' | 'json';

export interface DRSelfDRComponentsResponse {
  required_components: DRSelfDRComponentKind[];
  sealing_enabled: boolean;
}

export interface DRSelfDRRecoveryObjective {
  rto_seconds?: number;
  rpo_seconds?: number;
}

export interface DRSelfDRBackupEvidence {
  available: boolean;
  immutable: boolean;
  encrypted: boolean;
  location_id?: string;
  uri?: string;
  captured_at?: DRTimestamp;
  max_rpo_seconds?: number;
}

export interface DRSelfDRRestoreEvidence {
  passed: boolean;
  tested_at?: DRTimestamp;
  location_id?: string;
  rto_seconds?: number;
  rpo_seconds?: number;
  notes?: string;
}

export interface DRSelfDRComponent {
  id: string;
  name: string;
  kind: DRSelfDRComponentKind | string;
  required?: boolean;
  objective: DRSelfDRRecoveryObjective;
  backup: DRSelfDRBackupEvidence;
  restore: DRSelfDRRestoreEvidence;
  recovery_locations?: string[];
  metadata?: Record<string, string>;
}

export interface DRSelfDRDependency {
  component_id: string;
  depends_on_id: string;
}

export interface DRSelfDRRecoveryLocation {
  id: string;
  name?: string;
  region?: string;
  available: boolean;
  independent: boolean;
  offline?: boolean;
}

export interface DRSelfDRBreakGlassAccess {
  available: boolean;
  control_plane_independent: boolean;
  holders?: number;
  tested_at?: DRTimestamp;
  location_id?: string;
}

export interface DRSelfDROfflineRestoreBundle {
  available: boolean;
  complete: boolean;
  location_id?: string;
  generated_at?: DRTimestamp;
}

export interface DRSelfDRProfile {
  id: string;
  name?: string;
  components: DRSelfDRComponent[];
  dependencies?: DRSelfDRDependency[];
  recovery_locations?: DRSelfDRRecoveryLocation[];
  break_glass: DRSelfDRBreakGlassAccess;
  offline_bundle: DRSelfDROfflineRestoreBundle;
  restore_test_window?: number | string;
  required_kinds?: Array<DRSelfDRComponentKind | string>;
  metadata?: Record<string, string>;
}

export interface DRSelfDRFinding {
  code: string;
  severity: DRSelfDRSeverity | string;
  component_id?: string;
  component_kind?: DRSelfDRComponentKind | string;
  message: string;
}

export interface DRSelfDRRestoreWave {
  sequence: number;
  components: DRSelfDRComponent[];
}

export interface DRSelfDRRestorePlan {
  profile_id: string;
  waves: DRSelfDRRestoreWave[];
}

export interface DRSelfDRStoredAssessment {
  id: string;
  tenant_id: string;
  profile_id: string;
  verdict: DRSelfDRVerdict | string;
  critical: number;
  warning: number;
  info: number;
  findings: DRSelfDRFinding[];
  restore_plan: DRSelfDRRestorePlan;
  created_by: string;
  created_at: DRTimestamp;
}

export interface DRSelfDRAssessResponse {
  assessment: DRSelfDRStoredAssessment;
  verdict: DRSelfDRVerdict | string;
  findings: DRSelfDRFinding[];
  restore_plan: DRSelfDRRestorePlan;
}

export interface DRSelfDRStoredArtifact {
  id: string;
  tenant_id: string;
  kind: DRSelfDRArtifactKind | string;
  component_id?: string;
  component_kind?: DRSelfDRComponentKind | string;
  key?: string;
  uri?: string;
  version_id?: string;
  sha256: string;
  size_bytes: number;
  captured_at: DRTimestamp;
  retain_until?: DRTimestamp;
  location_id?: string;
  immutable: boolean;
  encrypted: boolean;
  evidence?: DRSelfDRBackupEvidence | DRSelfDROfflineRestoreBundle | DRJsonValue;
  created_by: string;
  created_at: DRTimestamp;
}

export interface DRSelfDRAssessmentReport {
  assessment: DRSelfDRStoredAssessment;
  artifacts: DRSelfDRStoredArtifact[];
}

export interface DRSelfDRBackupRequest {
  component_id: string;
  component_kind: DRSelfDRComponentKind | string;
  location_id?: string;
  stream_id?: string;
  marker?: string;
  max_rpo_seconds?: number;
  retain_days?: number;
  metadata?: Record<string, string>;
}

export interface DRSelfDROperatorRunbookMetadata {
  document_id?: string;
  title?: string;
  version?: string;
  uri?: string;
  sha256?: string;
  generated_at?: DRTimestamp;
  notes?: string;
  metadata?: Record<string, string>;
}

export interface DRSelfDROfflineBundleRequest {
  profile?: DRSelfDRProfile;
  runbook?: DRSelfDROperatorRunbookMetadata;
  format?: DRSelfDROfflineBundleFormat | string;
  location_id?: string;
  stream_id?: string;
  retain_days?: number;
  manifest_note?: string;
}

// ---------------------------------------------------------------------------
// External recovery integrations (hypervisor / storage-array / cloud-vault /
// kubernetes connectors). Credentials are write-only and are NEVER returned by
// the API — they are accepted on create/update and persisted server-side.
// ---------------------------------------------------------------------------

export type DRIntegrationKind =
  | 'hypervisor'
  | 'storage_array'
  | 'cloud_vault'
  | 'kubernetes';

export type DRIntegrationVendor =
  | 'netapp_ontap'
  | 'vmware_vsphere'
  | 'aws_backup'
  | 'azure_backup'
  | 'gcp_backup_dr'
  | 'dell_powerstore'
  | 'nfs'
  | 'kubernetes';

export type DRIntegrationStatus =
  | 'configured'
  | 'active'
  | 'error'
  | 'untested';

export interface DRIntegration {
  id: string;
  tenant_id: string;
  name: string;
  kind: DRIntegrationKind | string;
  vendor: DRIntegrationVendor | string;
  endpoint: string;
  status: DRIntegrationStatus | string;
  enabled: boolean;
  last_tested_at?: DRTimestamp | null;
  last_test_error?: string | null;
  created_at: DRTimestamp;
  updated_at: DRTimestamp;
}

/** Write-only credential material. Never echoed back in a DRIntegration. */
export interface DRIntegrationCredentials {
  username?: string;
  token?: string;
  ca_cert_pem?: string;
  extra?: Record<string, string>;
}

export interface DRCreateIntegrationRequest {
  name: string;
  kind: DRIntegrationKind | string;
  vendor: DRIntegrationVendor | string;
  endpoint: string;
  enabled: boolean;
  credentials?: DRIntegrationCredentials;
}

/** Credentials are optional on update — omit them to leave the stored secret untouched. */
export type DRUpdateIntegrationRequest = DRCreateIntegrationRequest;

/**
 * Result of POST /integrations/{id}/test. The backend returns the refreshed
 * integration record (with status / last_tested_at / last_test_error updated),
 * so a test result is structurally a DRIntegration.
 */
export type DRIntegrationTestResult = DRIntegration;
