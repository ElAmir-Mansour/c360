export type RespondSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

export type RespondIncidentStatus =
  | 'Declared'
  | 'Triaged'
  | 'Mobilizing'
  | 'Investigating'
  | 'Mitigating'
  | 'Mitigated'
  | 'Resolved'
  | 'Closed'
  | 'Cancelled';

export type RespondEntitlementState = 'licensed' | 'unlicensed' | 'trial' | 'expired';

export type RespondImpactLevel = 'none' | 'limited' | 'major' | 'critical';

export type RespondIncidentRole =
  | 'incident_commander'
  | 'communications_lead'
  | 'technical_lead'
  | 'subject_matter_expert'
  | 'scribe'
  | 'stakeholder_liaison'
  | 'resolver';

export type RespondTaskStatus =
  | 'pending'
  | 'runnable'
  | 'ready'
  | 'blocked'
  | 'running'
  | 'in_progress'
  | 'complete'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | (string & {});

export type RespondApprovalDecision = 'approved' | 'rejected';

export type RespondEvidenceExportFormat = 'csv' | 'pdf';

export type RespondIntegrationProvider = 'servicenow' | 'slack';

export type RespondIntegrationConnectorType = 'itsm' | 'comms';

export type RespondIntegrationSyncAction =
  | 'create'
  | 'update'
  | 'sync'
  | 'create_channel'
  | 'post_message'
  | (string & {});

export interface RespondCapability {
  id: string;
  label: string;
  description?: string;
  entitlement_key: string;
  enabled: boolean;
}

export interface RespondProduct {
  id: 'respond';
  name: string;
  entitlement_key: 'respond.major_incident';
  entitlement_state: RespondEntitlementState;
  entitlement_reason?: string;
  licensed: boolean;
  capabilities: RespondCapability[];
}

export interface RespondIncidentListItem {
  id: string;
  tenant_id?: string;
  reference: string;
  title: string;
  description?: string | null;
  severity: RespondSeverity;
  status: RespondIncidentStatus;
  declared_by?: string;
  declared_at: string;
  detected_at?: string | null;
  mitigated_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  impacted_services: string[];
  commander_name?: string | null;
  open_tasks?: number;
  overdue_tasks?: number;
  row_version?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RespondIncidentList {
  incidents: RespondIncidentListItem[];
  total: number;
  page: number;
  per_page: number;
}

export interface RespondIncident extends RespondIncidentListItem {
  tenant_id: string;
  description: string;
  declared_by: string;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface RespondCockpitIncident {
  id: string;
  tenant_id?: string;
  reference: string;
  title: string;
  description?: string | null;
  severity: RespondSeverity;
  status: RespondIncidentStatus;
  declared_by?: string;
  declared_at: string;
  detected_at?: string | null;
  mitigated_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  impacted_services: string[];
  row_version?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RespondRoleAssignment {
  id: string;
  role: RespondIncidentRole | (string & {});
  user_id?: string | null;
  display_name: string;
  acknowledgement_state?: 'pending' | 'acknowledged' | 'declined' | 'escalated' | null;
  acknowledged_at?: string | null;
  assigned_at?: string | null;
  assigned_by?: string | null;
  escalation_state?: string | null;
}

export interface RespondTaskCard {
  id: string;
  task_key?: string;
  title: string;
  description?: string | null;
  status: RespondTaskStatus;
  owner_name?: string | null;
  owner_id?: string | null;
  owner_role?: RespondIncidentRole | string | null;
  team?: string | null;
  order?: number | null;
  position?: number | null;
  due_at?: string | null;
  blocked_by?: string[];
  dependencies?: string[];
  started_at?: string | null;
  completed_at?: string | null;
  finished_at?: string | null;
  task_type?: string | null;
  row_version?: number;
}

export interface RespondTaskGraph {
  incident_id: string;
  tasks: RespondTaskCard[];
  progress?: {
    total?: number;
    pending?: number;
    runnable?: number;
    running?: number;
    complete?: number;
    skipped?: number;
    failed?: number;
    blocked?: number;
    required_total?: number;
    required_complete?: number;
    required_complete_percent?: number;
    planned_critical_path_seconds?: number;
    frontier?: string[];
    blocked_tasks?: string[];
  };
}

export interface RespondTimelineEvent {
  id: string;
  tenant_id?: string;
  incident_id?: string;
  event_type: string;
  actor_name?: string | null;
  actor_id?: string | null;
  occurred_at: string;
  summary?: string;
  payload?: Record<string, unknown>;
}

export interface RespondIntegrationStatus {
  provider: string;
  connector_id?: string | null;
  connector_name?: string | null;
  external_reference?: string | null;
  sync_state: string;
  last_synced_at?: string | null;
  last_error?: string | null;
  ticket_url?: string | null;
  channel_url?: string | null;
}

export interface RespondIntegrationConnector {
  id: string;
  provider: RespondIntegrationProvider | (string & {});
  kind?: RespondIntegrationConnectorType | (string & {});
  connector_type?: RespondIntegrationConnectorType | (string & {});
  name: string;
  enabled: boolean;
  endpoint_url?: string | null;
  field_mapping?: Record<string, string>;
  webhook_auth_type?: 'hmac_sha256' | 'bearer' | (string & {});
  webhook_secret_name?: string | null;
  row_version?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RespondIntegrationSyncResult {
  provider: string;
  connector_id?: string | null;
  external_reference?: string | null;
  sync_state: string;
  last_synced_at?: string | null;
  last_error?: string | null;
}

export interface RespondCockpitQuickAction {
  id: string;
  label: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload?: Record<string, unknown>;
  enabled: boolean;
  disabled_reason?: string | null;
  required_permission?: string | null;
  required_capability?: string | null;
}

export interface RespondServiceLink {
  service_id: string;
  name?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  tier?: string | null;
  dependencies?: string[];
  metadata_state?: 'resolved' | 'unresolved' | 'stale' | (string & {});
}

export interface RespondSeverityAssessmentInput {
  user_base_scope: RespondImpactLevel;
  business_process_criticality: RespondImpactLevel;
  revenue_impact: RespondImpactLevel;
  regulatory_exposure: RespondImpactLevel;
}

export interface RespondSeverityRecommendation {
  recommended_severity: RespondSeverity;
  rationale: string[];
  inputs: RespondSeverityAssessmentInput;
  computed_at?: string | null;
}

export interface RespondStakeholderUpdate {
  id: string;
  subject: string;
  body: string;
  channel?: string | null;
  dispatched_at?: string | null;
  status: string;
  next_update_at?: string | null;
}

export interface RespondApprovalGate {
  id: string;
  action_key: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | (string & {});
  requested_by?: string | null;
  requested_at?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_reason?: string | null;
}

export interface RespondPIRActionItem {
  id: string;
  title: string;
  owner_name?: string | null;
  due_at?: string | null;
  status: string;
}

export interface RespondPIR {
  id: string;
  status: 'draft' | 'ready_for_signoff' | 'signed_off' | (string & {});
  summary?: string | null;
  contributing_factors?: string | null;
  lessons_learned?: string | null;
  mttr_seconds?: number | null;
  mttr_target_seconds?: number | null;
  action_items?: RespondPIRActionItem[];
  signed_off_by?: string | null;
  signed_off_at?: string | null;
  generated_at?: string | null;
  updated_at?: string | null;
}

export interface RespondEvidenceExport {
  id: string;
  format: RespondEvidenceExportFormat;
  status: string;
  download_url?: string | null;
  generated_at?: string | null;
  generated_by?: string | null;
}

export interface RespondCockpit {
  incident: RespondCockpitIncident;
  roles: RespondRoleAssignment[];
  tasks: RespondTaskCard[];
  timeline: RespondTimelineEvent[];
  integrations: RespondIntegrationStatus[];
  quick_actions: RespondCockpitQuickAction[];
  timeline_stream_url?: string | null;
  service_links?: RespondServiceLink[];
  severity_recommendation?: RespondSeverityRecommendation | null;
  stakeholder_updates?: RespondStakeholderUpdate[];
  approvals?: RespondApprovalGate[];
  pir?: RespondPIR | null;
  evidence_exports?: RespondEvidenceExport[];
  capabilities?: RespondCapability[];
}

export interface RespondStakeholderStatus {
  incident_reference: string;
  title: string;
  severity: RespondSeverity;
  status: RespondIncidentStatus;
  impact_summary: string;
  current_phase: string;
  next_update_at?: string | null;
  last_update_at?: string | null;
}

export interface DeclareRespondIncidentInput {
  title: string;
  description: string;
  severity: RespondSeverity;
  detected_at?: string | null;
  impacted_services: string[];
}

export interface UpdateRespondIncidentInput {
  title: string;
  description: string;
  impacted_services: string[];
  expected_version: number;
}

export interface ChangeRespondSeverityInput {
  severity: RespondSeverity;
  expected_version: number;
}

export interface TransitionRespondIncidentInput {
  to: RespondIncidentStatus;
  expected_version: number;
}

export interface RecordRespondTimelineEventInput {
  event_type: string;
  payload: Record<string, unknown>;
}

export interface CreateRespondStakeholderTokenInput {
  expires_at?: string | null;
  next_update_at?: string | null;
}

export interface RespondStakeholderTokenResponse {
  id: string;
  incident_id: string;
  token: string;
  url_path: string;
  expires_at?: string | null;
  next_update_at?: string | null;
}

export interface ConfirmRespondTriageInput {
  severity: RespondSeverity;
  recommended_severity?: RespondSeverity | null;
  impact_assessment: RespondSeverityAssessmentInput;
  expected_version: number;
  override_reason?: string | null;
}

export interface AssignRespondRoleInput {
  role: RespondIncidentRole;
  user_id: string;
  team_id?: string | null;
  responder_source?: 'role' | 'team' | 'on_call' | 'service_owner' | (string & {});
}

export interface MobilizeRespondRoleInput {
  role_assignment_id: string;
  channels: Array<'email' | 'sms' | 'chat' | (string & {})>;
  escalation_window_minutes?: number;
}

export interface CreateRespondTaskInput {
  title: string;
  description?: string | null;
  owner_id?: string | null;
  due_at?: string | null;
  depends_on?: string[];
  task_type?: string | null;
}

export interface UpdateRespondTaskStatusInput {
  status: RespondTaskStatus;
  expected_version?: number;
}

export interface ReorderRespondTasksInput {
  task_ids: string[];
}

export interface SaveRespondIntegrationConfigInput {
  name: string;
  provider: RespondIntegrationProvider;
  connector_type: RespondIntegrationConnectorType;
  endpoint_url?: string | null;
  config?: Record<string, unknown>;
  field_mapping?: Record<string, string>;
  enabled?: boolean;
  webhook_auth_type?: 'hmac_sha256' | 'bearer' | null;
  webhook_secret_name?: string | null;
  secrets?: Array<{ name: string; secret_ref?: string | null; value?: string | null }>;
}

export interface SyncRespondIntegrationInput {
  connector_id: string;
  action?: RespondIntegrationSyncAction;
  message?: string | null;
}

export interface IngestRespondIntegrationWebhookInput {
  tenant_id: string;
  connector_id: string;
  event_id?: string | null;
  headers?: Record<string, string>;
  body: unknown;
}

export interface SendRespondStakeholderUpdateInput {
  subject: string;
  body: string;
  channels: Array<'email' | 'sms' | 'chat' | 'status_page' | (string & {})>;
  next_update_at?: string | null;
}

export interface RequestRespondApprovalInput {
  action_key: string;
  title: string;
  reason: string;
  approver_role?: RespondIncidentRole | string | null;
}

export interface DecideRespondApprovalInput {
  decision: RespondApprovalDecision;
  reason?: string | null;
}

export interface UpdateRespondPIRInput {
  contributing_factors?: string | null;
  lessons_learned?: string | null;
  action_items?: Array<{
    title: string;
    owner_id?: string | null;
    due_at?: string | null;
  }>;
}

export interface CreateRespondEvidenceExportInput {
  format: RespondEvidenceExportFormat;
}
