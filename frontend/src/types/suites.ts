export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export interface UserDirectoryEntry {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  roles: Array<{
    id: string;
    name: string;
    permissions: string[];
  }>;
}

export interface FileUploadRecord {
  id: string;
  tenant_id: string;
  original_name: string;
  sanitized_name: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  encrypted: boolean;
  virus_scan_status: string;
  uploaded_by: string;
  suite: string;
  entity_type?: string | null;
  entity_id?: string | null;
  tags: string[];
  version_number: number;
  is_public: boolean;
  lifecycle_policy: string;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type ActaCommitteeType =
  | "board"
  | "audit"
  | "risk"
  | "compensation"
  | "nomination"
  | "executive"
  | "governance"
  | "ad_hoc";

export type ActaMeetingFrequency =
  | "weekly"
  | "bi_weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual"
  | "ad_hoc";

export type ActaCommitteeStatus = "active" | "inactive" | "dissolved";

export type ActaCommitteeMemberRole =
  | "chair"
  | "vice_chair"
  | "secretary"
  | "member"
  | "observer";

export interface ActaCommitteeMember {
  id: string;
  tenant_id: string;
  committee_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: ActaCommitteeMemberRole;
  joined_at: string;
  left_at?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActaCommitteeStats {
  active_members: number;
  upcoming_meetings: number;
  completed_meetings: number;
  open_action_items: number;
  overdue_action_items: number;
  pending_minutes_approval: number;
}

export interface ActaCommittee {
  id: string;
  tenant_id: string;
  name: string;
  type: ActaCommitteeType;
  description: string;
  chair_user_id: string;
  vice_chair_user_id?: string | null;
  secretary_user_id?: string | null;
  meeting_frequency: ActaMeetingFrequency;
  quorum_percentage: number;
  quorum_type: "percentage" | "fixed_count";
  quorum_fixed_count?: number | null;
  charter?: string | null;
  established_date?: string | null;
  dissolution_date?: string | null;
  status: ActaCommitteeStatus;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  members?: ActaCommitteeMember[];
  stats?: ActaCommitteeStats | null;
}

export type ActaMeetingStatus =
  | "draft"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "postponed";

export type ActaLocationType = "physical" | "virtual" | "hybrid";

export type ActaAttendanceStatus =
  | "invited"
  | "confirmed"
  | "declined"
  | "present"
  | "absent"
  | "proxy"
  | "excused";

export interface ActaAttendee {
  id: string;
  tenant_id: string;
  meeting_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  member_role: ActaCommitteeMemberRole;
  status: ActaAttendanceStatus;
  confirmed_at?: string | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  proxy_user_id?: string | null;
  proxy_user_name?: string | null;
  proxy_authorized_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type ActaAgendaItemStatus =
  | "pending"
  | "discussed"
  | "deferred"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "for_noting";

export type ActaAgendaCategory =
  | "regular"
  | "special"
  | "information"
  | "decision"
  | "discussion"
  | "ratification";

export type ActaVoteType =
  | "unanimous"
  | "majority"
  | "two_thirds"
  | "roll_call";

export type ActaVoteResult = "approved" | "rejected" | "deferred" | "tied";

export interface ActaAgendaItem {
  id: string;
  tenant_id: string;
  meeting_id: string;
  title: string;
  description: string;
  item_number?: string | null;
  presenter_user_id?: string | null;
  presenter_name?: string | null;
  duration_minutes: number;
  order_index: number;
  parent_item_id?: string | null;
  status: ActaAgendaItemStatus;
  notes?: string | null;
  requires_vote: boolean;
  vote_type?: ActaVoteType | null;
  votes_for?: number | null;
  votes_against?: number | null;
  votes_abstained?: number | null;
  vote_result?: ActaVoteResult | null;
  vote_notes?: string | null;
  attachment_ids: string[];
  category?: ActaAgendaCategory | null;
  confidential: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActaMeetingAttachment {
  file_id: string;
  name: string;
  content_type?: string | null;
  uploaded_by?: string | null;
  uploaded_at: string;
}

export interface ActaExtractedAction {
  title: string;
  description: string;
  assigned_to: string;
  due_date?: string | null;
  priority: "critical" | "high" | "medium" | "low";
  source: string;
}

export type ActaMinutesStatus =
  | "draft"
  | "review"
  | "revision_requested"
  | "approved"
  | "published";

export interface ActaMeetingMinutes {
  id: string;
  tenant_id: string;
  meeting_id: string;
  content: string;
  ai_summary?: string | null;
  status: ActaMinutesStatus;
  submitted_for_review_at?: string | null;
  submitted_by?: string | null;
  reviewed_by?: string | null;
  review_notes?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  published_at?: string | null;
  version: number;
  previous_version_id?: string | null;
  ai_action_items: ActaExtractedAction[];
  ai_generated: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  meeting_title?: string | null;
}

export type ActaActionItemPriority = "critical" | "high" | "medium" | "low";
export type ActaActionItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "overdue"
  | "cancelled"
  | "deferred";

export interface ActaActionItem {
  id: string;
  tenant_id: string;
  meeting_id: string;
  agenda_item_id?: string | null;
  committee_id: string;
  title: string;
  description: string;
  priority: ActaActionItemPriority;
  assigned_to: string;
  assignee_name: string;
  assigned_by: string;
  due_date: string;
  original_due_date: string;
  extended_count: number;
  extension_reason?: string | null;
  status: ActaActionItemStatus;
  completed_at?: string | null;
  completion_notes?: string | null;
  completion_evidence: string[];
  follow_up_meeting_id?: string | null;
  reviewed_at?: string | null;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  meeting_title?: string | null;
}

export interface ActaActionItemStats {
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  open: number;
  overdue: number;
  completed: number;
}

export interface ActaActionItemSummary {
  id: string;
  title: string;
  committee_id: string;
  committee_name: string;
  assignee_name: string;
  due_date: string;
  priority: ActaActionItemPriority;
  status: ActaActionItemStatus;
}

export interface ActaMeetingSummary {
  id: string;
  committee_id: string;
  committee_name: string;
  title: string;
  status: ActaMeetingStatus;
  scheduled_at: string;
  duration_minutes: number;
  location?: string | null;
  quorum_met?: boolean | null;
}

export interface ActaCalendarDay {
  date: string;
  meetings: ActaMeetingSummary[];
}

export interface ActaMeeting {
  id: string;
  tenant_id: string;
  committee_id: string;
  committee_name: string;
  title: string;
  description: string;
  meeting_number?: number | null;
  scheduled_at: string;
  scheduled_end_at?: string | null;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  duration_minutes: number;
  location?: string | null;
  location_type: ActaLocationType;
  virtual_link?: string | null;
  virtual_platform?: string | null;
  status: ActaMeetingStatus;
  cancellation_reason?: string | null;
  quorum_required: number;
  attendee_count: number;
  present_count: number;
  quorum_met?: boolean | null;
  agenda_item_count: number;
  action_item_count: number;
  has_minutes: boolean;
  minutes_status?: string | null;
  workflow_instance_id?: string | null;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  agenda?: ActaAgendaItem[];
  attendance?: ActaAttendee[];
  latest_minutes?: ActaMeetingMinutes | null;
  attachments?: ActaMeetingAttachment[];
}

export type ActaComplianceCheckType =
  | "meeting_frequency"
  | "quorum_compliance"
  | "minutes_completion"
  | "action_item_tracking"
  | "attendance_rate"
  | "charter_review"
  | "document_retention"
  | "conflict_of_interest";

export type ActaComplianceStatus =
  | "compliant"
  | "non_compliant"
  | "warning"
  | "not_applicable";

export type ActaComplianceSeverity = "critical" | "high" | "medium" | "low";

export interface ActaComplianceCheck {
  id: string;
  tenant_id: string;
  committee_id?: string | null;
  check_type: ActaComplianceCheckType;
  check_name: string;
  status: ActaComplianceStatus;
  severity: ActaComplianceSeverity;
  description: string;
  finding?: string | null;
  recommendation?: string | null;
  evidence: JsonObject;
  period_start: string;
  period_end: string;
  checked_at: string;
  checked_by: string;
  created_at: string;
}

export interface ActaCommitteeCompliance {
  committee_id: string;
  committee_name: string;
  score: number;
  warnings: number;
  non_compliant: number;
}

export interface ActaComplianceReport {
  tenant_id: string;
  results: ActaComplianceCheck[];
  by_status: Record<string, number>;
  by_check_type: Record<string, number>;
  by_committee: ActaCommitteeCompliance[];
  score: number;
  non_compliant_count: number;
  warning_count: number;
  generated_at: string;
}

export interface ActaKPIs {
  active_committees: number;
  upcoming_meetings_30d: number;
  open_action_items: number;
  overdue_action_items: number;
  compliance_score: number;
  minutes_pending_approval: number;
  attendance_rate_avg: number;
}

export interface ActaMonthlyMeetingCount {
  month: string;
  count: number;
}

export interface ActaMonthlyAttendanceRate {
  month: string;
  rate_percent: number;
}

export interface ActaAuditEntry {
  timestamp: string;
  type: string;
  message: string;
  entity_id: string;
}

export interface ActaDashboard {
  kpis: ActaKPIs;
  upcoming_meetings: ActaMeetingSummary[];
  recent_meetings: ActaMeetingSummary[];
  action_items_by_status: Record<string, number>;
  action_items_by_priority: Record<string, number>;
  overdue_action_items: ActaActionItemSummary[];
  compliance_by_committee: ActaCommitteeCompliance[];
  compliance_score: number;
  meeting_frequency_chart: ActaMonthlyMeetingCount[];
  attendance_rate_chart: ActaMonthlyAttendanceRate[];
  recent_activity: ActaAuditEntry[];
  calculated_at: string;
}

export type LexContractType =
  | "service_agreement"
  | "nda"
  | "employment"
  | "vendor"
  | "license"
  | "lease"
  | "partnership"
  | "consulting"
  | "procurement"
  | "sla"
  | "mou"
  | "amendment"
  | "renewal"
  | "other";

export type LexContractStatus =
  | "draft"
  | "internal_review"
  | "legal_review"
  | "negotiation"
  | "pending_signature"
  | "active"
  | "suspended"
  | "expired"
  | "terminated"
  | "renewed"
  | "cancelled";

export type LexAnalysisStatus =
  | "pending"
  | "analyzing"
  | "completed"
  | "failed";
export type LexRiskLevel = "critical" | "high" | "medium" | "low" | "none";

export interface LexContractRecord {
  id: string;
  tenant_id: string;
  title: string;
  contract_number?: string | null;
  type: LexContractType;
  description: string;
  party_a_name: string;
  party_a_entity?: string | null;
  party_b_name: string;
  party_b_entity?: string | null;
  party_b_contact?: string | null;
  total_value?: number | null;
  currency: string;
  payment_terms?: string | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  renewal_date?: string | null;
  auto_renew: boolean;
  renewal_notice_days: number;
  signed_date?: string | null;
  status: LexContractStatus;
  previous_status?: LexContractStatus | null;
  status_changed_at?: string | null;
  status_changed_by?: string | null;
  owner_user_id: string;
  owner_name: string;
  legal_reviewer_id?: string | null;
  legal_reviewer_name?: string | null;
  risk_score?: number | null;
  risk_level: LexRiskLevel;
  analysis_status: LexAnalysisStatus;
  last_analyzed_at?: string | null;
  document_file_id?: string | null;
  document_text: string;
  current_version: number;
  parent_contract_id?: string | null;
  workflow_instance_id?: string | null;
  department?: string | null;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface LexContractSummary {
  id: string;
  title: string;
  type: LexContractType;
  status: LexContractStatus;
  party_b_name: string;
  risk_level: LexRiskLevel;
  risk_score?: number | null;
  expiry_date?: string | null;
  current_version: number;
  created_at: string;
}

export interface LexContractVersion {
  id: string;
  tenant_id: string;
  contract_id: string;
  version: number;
  file_id: string;
  file_name: string;
  file_size_bytes: number;
  content_hash: string;
  extracted_text?: string | null;
  change_summary?: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

export type LexRedlineOperation = "equal" | "added" | "removed";

export interface LexContractRedlineSegment {
  operation: LexRedlineOperation;
  base_line?: number | null;
  target_line?: number | null;
  text: string;
}

export interface LexContractRedline {
  contract_id: string;
  base_version: number;
  target_version: number;
  base_file_name: string;
  target_file_name: string;
  change_summary?: string | null;
  segments: LexContractRedlineSegment[];
  added_lines: number;
  removed_lines: number;
  generated_at: string;
}

export type LexContractRenewalWarningSeverity = "urgent" | "warning";

export interface LexContractRenewalWarning {
  contract_id: string;
  title: string;
  status: LexContractStatus;
  counterparty: string;
  owner: string;
  expiry_date?: string | null;
  renewal_date?: string | null;
  auto_renew: boolean;
  renewal_notice_days: number;
  configured_lead_days: number;
  trigger_date?: string | null;
  days_until_trigger: number;
  days_until_expiry: number;
  severity: LexContractRenewalWarningSeverity;
  reason: string;
}

export interface LexContractRenewalWarningSummary {
  tenant_id: string;
  generated_at: string;
  horizon_days: number;
  lead_days: number;
  total: number;
  urgent: number;
  warning: number;
  items: LexContractRenewalWarning[];
}

export interface LexContractStats {
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_risk_level: Record<string, number>;
  expiring_30_days: number;
  expiring_7_days: number;
}

/** Exactly one addressing mode — explicit ids OR a list-filter map (mirrors POST /contracts/bulk-status|bulk-analyze). */
export type LexContractBulkScope =
  | { contract_ids: string[]; filter?: never }
  | { filter: Record<string, string>; contract_ids?: never };

export type LexContractBulkStatusRequest = LexContractBulkScope & {
  status: LexContractStatus;
};

export type LexContractBulkAnalyzeRequest = LexContractBulkScope;

export interface LexContractBulkFailure {
  id: string;
  reason: string;
}

/** Partial-failure envelope of the bulk contract endpoints: every attempted id lands in exactly one of succeeded/failed. */
export interface LexContractBulkResult {
  total: number;
  succeeded: string[];
  failed: LexContractBulkFailure[];
}

export type LexContractInsightKind =
  | "missing_mandatory_clause"
  | "renewal_opt_out_closing"
  | "value_outlier"
  | "counterparty_concentration"
  | "stale_draft";

/** One ranked, bilingual insight card (mirrors backend ContractInsight). */
export interface LexContractInsight {
  /** Stable per-kind (or kind:cohort) identifier — the dismiss key. */
  id: string;
  /** Forward-compatible with future server-side kinds. */
  kind: LexContractInsightKind | (string & {});
  /** Reuses the existing lex risk scale. */
  severity: LexRiskLevel;
  title_en: string;
  title_ar: string;
  detail_en: string;
  detail_ar: string;
  /** Matching contract ids (server-capped at 25 per card). */
  contract_ids: string[];
  /** Raw numbers behind the card, for locale-aware re-formatting. */
  metric: Record<string, unknown>;
}

/** `GET /contracts/insights` response body (inside the `{data}` envelope). */
export interface LexContractInsightsReport {
  /** Ranked by the server. */
  insights: LexContractInsight[];
  /** RFC3339. */
  generated_at: string;
  window_days: number;
  stale_draft_days: number;
  scanned_active_contracts: number;
  /** True when a bounded scan covered fewer rows than the tenant holds. */
  truncated: boolean;
}

export interface LexContractClassificationRequest {
  apply: boolean;
  candidate_text?: string;
  override_type?: LexContractType;
}

export interface LexContractClassificationResult {
  contract_id: string;
  previous_type: LexContractType;
  recommended_type: LexContractType;
  applied_type: LexContractType;
  applied: boolean;
  confidence: number;
  matched_terms: string[];
  rationale: string;
  classified_at: string;
  metadata?: JsonObject | null;
}

export interface LexContractTimelineEvent {
  id: string;
  event_type: string;
  title: string;
  description: string;
  occurred_at: string;
  actor?: string | null;
  source: string;
  metadata?: JsonObject | null;
}

export interface LexContractTimeline {
  contract_id: string;
  generated_at: string;
  events: LexContractTimelineEvent[];
}

export type LexClauseType =
  | "indemnification"
  | "termination"
  | "limitation_of_liability"
  | "confidentiality"
  | "ip_ownership"
  | "non_compete"
  | "payment_terms"
  | "warranty"
  | "force_majeure"
  | "dispute_resolution"
  | "data_protection"
  | "governing_law"
  | "assignment"
  | "insurance"
  | "audit_rights"
  | "sla"
  | "auto_renewal"
  | "representations"
  | "non_solicitation"
  | "other";

export type LexClauseReviewStatus =
  | "pending"
  | "reviewed"
  | "flagged"
  | "accepted"
  | "rejected";

export interface LexClause {
  id: string;
  tenant_id: string;
  contract_id: string;
  clause_type: LexClauseType;
  title: string;
  content: string;
  section_reference?: string | null;
  page_number?: number | null;
  risk_level: LexRiskLevel;
  risk_score: number;
  risk_keywords: string[];
  analysis_summary?: string | null;
  recommendations: string[];
  compliance_flags: string[];
  review_status: LexClauseReviewStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  extraction_confidence: number;
  created_at: string;
  updated_at: string;
}

export interface LexRiskFinding {
  title: string;
  description: string;
  severity: LexRiskLevel;
  clause_reference?: string | null;
  recommendation: string;
  clause_type?: LexClauseType | null;
}

export interface LexComplianceFlag {
  code: string;
  title: string;
  description: string;
  severity: LexRiskLevel;
  clause_reference?: string | null;
}

export interface LexExtractedParty {
  name: string;
  role: string;
  source: string;
}

export interface LexExtractedDate {
  label: string;
  value?: string | null;
  source: string;
}

export interface LexExtractedAmount {
  label: string;
  currency: string;
  value: number;
  source: string;
}

export interface LexContractRiskAnalysis {
  id: string;
  tenant_id: string;
  contract_id: string;
  contract_version: number;
  overall_risk: LexRiskLevel;
  risk_score: number;
  clause_count: number;
  high_risk_clause_count: number;
  missing_clauses: LexClauseType[];
  key_findings: LexRiskFinding[];
  recommendations: string[];
  compliance_flags: LexComplianceFlag[];
  extracted_parties: LexExtractedParty[];
  extracted_dates: LexExtractedDate[];
  extracted_amounts: LexExtractedAmount[];
  analysis_duration_ms: number;
  analyzed_by: string;
  analyzed_at: string;
  created_at: string;
}

export interface LexContractDetail {
  contract: LexContractRecord;
  clauses: LexClause[];
  latest_analysis?: LexContractRiskAnalysis | null;
  version_count: number;
}

export interface LexContractBriefClause {
  id: string;
  title: string;
  clause_type: LexClauseType;
  section_reference?: string | null;
  risk_level: LexRiskLevel;
  risk_score: number;
  summary: string;
}

export interface LexContractBriefRisk {
  title: string;
  description: string;
  severity: LexRiskLevel;
  clause_reference?: string | null;
  recommendation?: string | null;
  clause_type?: LexClauseType | null;
}

export interface LexContractBriefSignal {
  label: string;
  value: string;
  source: string;
}

export interface LexContractBrief {
  contract_id: string;
  title: string;
  type: LexContractType;
  status: LexContractStatus;
  counterparty: string;
  owner: string;
  value?: number | null;
  currency: string;
  effective_date?: string | null;
  expiry_date?: string | null;
  renewal_date?: string | null;
  executive_summary: string;
  risk_summary: string;
  risk_level: LexRiskLevel;
  risk_score?: number | null;
  top_clauses: LexContractBriefClause[];
  top_risks: LexContractBriefRisk[];
  obligations: LexContractBriefSignal[];
  renewal_signals: LexContractBriefSignal[];
  metadata?: JsonObject | null;
  generated_at: string;
}

export type LexDraftingLanguage = "en" | "ar" | "bilingual" | string;

export interface LexDraftingClauseRequest {
  intent: string;
  clause_type?: LexClauseType | string;
  contract_type?: LexContractType | string;
  language?: LexDraftingLanguage;
  context?: string;
}

export interface LexDraftingGeneratedClause {
  title: string;
  clause_type: LexClauseType | string;
  text: string;
  rationale?: string;
  risk_level: LexRiskLevel | string;
  assumptions?: string[] | null;
  language?: LexDraftingLanguage;
  meta?: JsonObject | null;
}

export interface LexDraftingContractRequest {
  contract_type: LexContractType | string;
  deal_terms: JsonObject;
  template_hint?: string;
  language?: LexDraftingLanguage;
}

export interface LexDraftingDraftSection {
  heading: string;
  body: string;
}

export interface LexDraftingContractDraft {
  title: string;
  sections: LexDraftingDraftSection[];
  summary?: string;
  open_items?: string[] | null;
  language?: LexDraftingLanguage;
  meta?: JsonObject | null;
}

export interface LexDraftingRewriteRequest {
  text: string;
  target_tone?: string;
  risk_posture?: string;
  instructions?: string;
  language?: LexDraftingLanguage;
}

export interface LexDraftingRewriteChange {
  summary: string;
  reason?: string;
}

export interface LexDraftingClauseRewrite {
  rewritten_text: string;
  changes?: LexDraftingRewriteChange[] | null;
  risk_shift?: string;
  residual_risks?: string[] | null;
  meta?: JsonObject | null;
}

export interface LexDraftingFallbackRequest {
  clause_text: string;
  position?: string;
  count?: number;
  language?: LexDraftingLanguage;
}

export interface LexDraftingFallbackOption {
  label?: string;
  text: string;
  concession_level?: string;
  when_to_use?: string;
}

export interface LexDraftingFallbackSet {
  fallbacks: LexDraftingFallbackOption[];
  meta?: JsonObject | null;
}

export interface LexDraftingTranslateRequest {
  text: string;
  source_lang?: LexDraftingLanguage;
  target_lang: LexDraftingLanguage;
}

export interface LexDraftingTranslationResult {
  translation: string;
  equivalence?: "equivalent" | "partial" | "divergent" | string;
  notes?: string[] | null;
  caveats?: string[] | null;
  source_lang?: LexDraftingLanguage;
  target_lang?: LexDraftingLanguage;
  meta?: JsonObject | null;
}

export interface LexDraftingSummaryRequest {
  text: string;
  contract_type?: LexContractType | string;
  language?: LexDraftingLanguage;
}

export interface LexDraftingKeyTerm {
  label: string;
  value: string;
}

export interface LexDraftingContractSummary {
  executive_summary: string;
  key_terms?: LexDraftingKeyTerm[] | null;
  obligations?: string[] | null;
  risks?: string[] | null;
  renewal_notes?: string;
  meta?: JsonObject | null;
}

export interface LexDraftingGlossaryRequest {
  text: string;
  language?: LexDraftingLanguage;
}

export interface LexDraftingGlossaryEntry {
  term: string;
  definition: string;
}

export interface LexDraftingTermInconsistency {
  term: string;
  issue: string;
}

export interface LexDraftingGlossaryResult {
  glossary: LexDraftingGlossaryEntry[];
  inconsistencies?: LexDraftingTermInconsistency[] | null;
  meta?: JsonObject | null;
}

export interface LexDraftingTemplateSection {
  id: string;
  heading: string;
  body: string;
  condition?: string;
}

export interface LexDraftingAssembleRequest {
  sections: LexDraftingTemplateSection[];
  variables?: JsonObject;
}

export interface LexDraftingAssemblyResult {
  document: string;
  included_sections: string[];
  skipped_sections: string[];
  unresolved_vars: string[];
}

export interface LexDraftingRfpRequest {
  requirements: string;
  company_profile?: string;
  language?: LexDraftingLanguage;
}

export interface LexDraftingRfpSection {
  requirement: string;
  response: string;
}

export interface LexDraftingRfpResponse {
  sections: LexDraftingRfpSection[];
  summary?: string;
  gaps?: string[] | null;
  language?: LexDraftingLanguage;
  meta?: JsonObject | null;
}

export interface LexDraftingObligationQaRequest {
  contract_text: string;
  obligations: JsonObject[];
}

export interface LexDraftingObligationIssue {
  obligation_index: number;
  severity: "info" | "warning" | "error" | string;
  issue: string;
  suggestion?: string;
}

export interface LexDraftingObligationQaReview {
  issues: LexDraftingObligationIssue[];
  overall_confidence: number;
  missing_obligations?: string[] | null;
  meta?: JsonObject | null;
}

export interface LexExpiringContractSummary {
  id: string;
  title: string;
  type: LexContractType;
  status: LexContractStatus;
  party_b_name: string;
  expiry_date: string;
  days_until_expiry: number;
  owner_name: string;
  legal_reviewer_name?: string | null;
}

export interface LexContractRiskSummary {
  id: string;
  title: string;
  type: LexContractType;
  status: LexContractStatus;
  risk_level: LexRiskLevel;
  risk_score: number;
  party_b_name: string;
  expiry_date?: string | null;
}

export interface LexTotalValueBreakdown {
  by_type: Record<string, number>;
  by_currency: Record<string, number>;
}

export interface LexMonthlyContractActivity {
  month: string;
  created: number;
  activated: number;
  expired: number;
  renewed: number;
}

export interface LexDashboardKPIs {
  active_contracts: number;
  expiring_in_30_days: number;
  expiring_in_7_days: number;
  high_risk_contracts: number;
  pending_review: number;
  open_compliance_alerts: number;
  total_active_value: number;
  compliance_score: number;
}

export interface LexDashboard {
  kpis: LexDashboardKPIs;
  contracts_by_type: Record<string, number>;
  contracts_by_status: Record<string, number>;
  expiring_contracts: LexExpiringContractSummary[];
  high_risk_contracts: LexContractRiskSummary[];
  recent_contracts: LexContractSummary[];
  compliance_alerts_by_status: Record<string, number>;
  total_contract_value: LexTotalValueBreakdown;
  monthly_activity: LexMonthlyContractActivity[];
  calculated_at: string;
}

export type LexDocumentType =
  | "policy"
  | "regulation"
  | "template"
  | "memo"
  | "opinion"
  | "filing"
  | "correspondence"
  | "resolution"
  | "power_of_attorney"
  | "other";

export type LexDocumentConfidentiality =
  | "public"
  | "internal"
  | "confidential"
  | "privileged";

export type LexDocumentStatus = "draft" | "active" | "archived" | "superseded";

export interface LexDocument {
  id: string;
  tenant_id: string;
  title: string;
  type: LexDocumentType;
  description: string;
  file_id?: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  extracted_text?: string | null;
  category?: string | null;
  confidentiality: LexDocumentConfidentiality;
  contract_id?: string | null;
  current_version: number;
  status: LexDocumentStatus;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LexDocumentFolderSummary {
  path: string;
  document_count: number;
  privileged: number;
  archived: number;
}

export interface LexDocumentSavedViewSummary {
  name: string;
  document_count: number;
  filters?: JsonObject | null;
}

export interface LexDocumentTaxonomySummary {
  dimension: string;
  value: string;
  document_count: number;
}

export interface LexDocumentRetentionSummary {
  with_policy: number;
  with_disposition: number;
  disposition_due: number;
  missing_policy: number;
}

export interface LexDocumentRepositorySummary {
  tenant_id: string;
  generated_at: string;
  total_documents: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  by_confidentiality: Record<string, number>;
  by_category: Record<string, number>;
  folders: LexDocumentFolderSummary[];
  saved_views: LexDocumentSavedViewSummary[];
  taxonomy: LexDocumentTaxonomySummary[];
  retention: LexDocumentRetentionSummary;
}

export interface LexDocumentBulkImportItemResult {
  index: number;
  status: "imported" | "failed" | string;
  document_id?: string | null;
  title?: string;
  ocr_status?: string;
  index_status?: string;
  error?: string;
  metadata?: JsonObject | null;
}

export interface LexDocumentBulkImportResult {
  batch_id: string;
  source_system?: string;
  requested: number;
  succeeded: number;
  failed: number;
  items: LexDocumentBulkImportItemResult[];
}

export interface LexDocumentVersion {
  id: string;
  tenant_id: string;
  document_id: string;
  version: number;
  file_id: string;
  file_name: string;
  file_size_bytes: number;
  content_hash: string;
  extracted_text?: string | null;
  change_summary?: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

export type LexDocumentEditorLockStatus =
  | "checked_out"
  | "locked"
  | "released"
  | "expired"
  | string;

export interface LexDocumentEditorLock {
  id?: string;
  tenant_id?: string;
  document_id: string;
  status: LexDocumentEditorLockStatus;
  version?: number | null;
  locked_by?: string | null;
  locked_by_name?: string | null;
  locked_at?: string | null;
  expires_at?: string | null;
  released_at?: string | null;
  metadata?: JsonObject | null;
}

export type LexDocumentEditorPreflightSeverity =
  | "blocker"
  | "warning"
  | "info"
  | string;

export interface LexDocumentEditorPreflightIssue {
  code: string;
  severity: LexDocumentEditorPreflightSeverity;
  message: string;
  field?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentEditorPreflightResult {
  document_id: string;
  ready?: boolean;
  can_edit?: boolean;
  status?: "passed" | "needs_review" | "blocked" | string;
  issues: LexDocumentEditorPreflightIssue[];
  checked_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentEditorSession {
  document_id?: string;
  session?: JsonObject | null;
  document?: JsonObject | null;
  config?: JsonObject | null;
  provider?: string | null;
  document_type?: string | null;
  editor_url?: string | null;
  file_id?: string | null;
  version?: number | null;
  lock?: LexDocumentEditorLock | null;
  preflight?: LexDocumentEditorPreflightResult | null;
  expires_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentEditorOpenRequest {
  mode?: "view" | "comment" | "edit";
  provider?: string;
  locale?: string;
  user_display_name?: string;
  document_url?: string;
  callback_url?: string;
  options?: JsonObject;
  return_url?: string;
  source?: string;
  current_version?: number;
  metadata?: JsonObject;
}

export interface LexDocumentCheckOutRequest {
  session_id?: string;
  lock_type?: "checkout" | "edit" | string;
  reason?: string;
  expires_in_seconds?: number;
  current_version?: number;
  source?: string;
  expires_at?: string;
  metadata?: JsonObject;
}

export interface LexDocumentPreflightRequest {
  session_id?: string;
  status?: "passed" | "warning" | "failed" | string;
  score?: number;
  blocking?: boolean;
  summary?: string;
  checks?: Array<{
    key: string;
    status: string;
    severity?: string;
    message?: string;
    metadata?: JsonObject;
  }>;
  current_version?: number;
  source?: string;
  metadata?: JsonObject;
}

export interface LexDocumentVersionSnapshotRequest {
  session_id?: string;
  change_summary?: string;
  current_version?: number;
  source?: string;
  metadata?: JsonObject;
}

export interface LexDocumentVersionSnapshot {
  id?: string;
  tenant_id?: string;
  document_id: string;
  version?: number | null;
  file_id?: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  content_hash?: string | null;
  change_summary?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentAuditEntry {
  id: string;
  tenant_id?: string;
  document_id?: string;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  summary?: string | null;
  details?: JsonObject | null;
  before?: JsonObject | null;
  after?: JsonObject | null;
  created_at: string;
  metadata?: JsonObject | null;
}

export interface LexDocumentEditorFeatureRequestBase {
  session_id?: string;
  current_version?: number;
  source?: string;
  metadata?: JsonObject;
}

export type LexDocumentNegotiationRoomStatus =
  | "open"
  | "paused"
  | "closed"
  | string;

export interface LexDocumentNegotiationParticipant {
  id?: string;
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  role?: "owner" | "legal" | "business" | "counterparty" | "guest" | string;
  side?: "internal" | "external" | "counterparty" | string;
  joined_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentNegotiationMessage {
  id: string;
  author_id?: string | null;
  author_name?: string | null;
  body: string;
  clause_id?: string | null;
  section_id?: string | null;
  status?: "open" | "accepted" | "rejected" | "resolved" | string;
  created_at: string;
  metadata?: JsonObject | null;
}

export interface LexDocumentNegotiationRoom {
  document_id: string;
  room_id?: string | null;
  status: LexDocumentNegotiationRoomStatus;
  participants: LexDocumentNegotiationParticipant[];
  messages?: LexDocumentNegotiationMessage[] | null;
  open_items?: number | null;
  updated_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexUpsertDocumentNegotiationRoomRequest extends LexDocumentEditorFeatureRequestBase {
  status?: LexDocumentNegotiationRoomStatus;
  participants?: LexDocumentNegotiationParticipant[];
}

export interface LexDocumentNegotiationMessageRequest extends LexDocumentEditorFeatureRequestBase {
  body: string;
  clause_id?: string;
  section_id?: string;
  visibility?: "internal" | "external" | "all" | string;
}

export interface LexDocumentPlaybookDeviation {
  id?: string;
  clause_id?: string | null;
  section_id?: string | null;
  clause_type?: LexClauseType | string | null;
  severity: LexRiskLevel | string;
  title: string;
  description?: string | null;
  required_action?: string | null;
  status?: "open" | "waived" | "resolved" | string;
  metadata?: JsonObject | null;
}

export interface LexDocumentPlaybookEnforcement {
  document_id: string;
  playbook_id?: string | null;
  status: "passed" | "needs_review" | "blocked" | string;
  score?: number | null;
  deviations: LexDocumentPlaybookDeviation[];
  checked_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexRunDocumentPlaybookEnforcementRequest extends LexDocumentEditorFeatureRequestBase {
  playbook_id?: string;
  contract_type?: LexContractType | string;
  enforce_required_clauses?: boolean;
}

export interface LexDocumentDefinedTerm {
  id?: string;
  term: string;
  definition?: string | null;
  occurrences?: number | null;
  first_section_id?: string | null;
  status?: "defined" | "undefined" | "inconsistent" | string;
  metadata?: JsonObject | null;
}

export interface LexDocumentCrossReference {
  id?: string;
  source_section_id?: string | null;
  target_section_id?: string | null;
  label?: string | null;
  status?: "valid" | "broken" | "ambiguous" | string;
  message?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentTermIssue {
  id?: string;
  term?: string | null;
  severity: LexRiskLevel | string;
  message: string;
  section_id?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentTermsCrossReferences {
  document_id: string;
  terms: LexDocumentDefinedTerm[];
  cross_references: LexDocumentCrossReference[];
  issues: LexDocumentTermIssue[];
  checked_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexAnalyzeDocumentTermsCrossReferencesRequest extends LexDocumentEditorFeatureRequestBase {
  include_defined_terms?: boolean;
  include_cross_references?: boolean;
}

export interface LexDocumentSectionAssignment {
  id: string;
  document_id?: string;
  section_id: string;
  section_title?: string | null;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  role?: "drafter" | "reviewer" | "approver" | string;
  status?: "open" | "in_progress" | "complete" | string;
  due_at?: string | null;
  notes?: string | null;
  metadata?: JsonObject | null;
}

export interface LexUpsertDocumentSectionAssignmentRequest extends LexDocumentEditorFeatureRequestBase {
  assignments: Array<
    Omit<LexDocumentSectionAssignment, "id" | "document_id"> & {
      id?: string;
    }
  >;
}

export interface LexDocumentGuestReviewLink {
  id: string;
  document_id?: string;
  reviewer_name?: string | null;
  reviewer_email?: string | null;
  role?: "commenter" | "viewer" | string;
  permissions: string[];
  review_url?: string | null;
  status: "active" | "expired" | "revoked" | string;
  expires_at?: string | null;
  created_at?: string | null;
  revoked_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexCreateDocumentGuestReviewLinkRequest extends LexDocumentEditorFeatureRequestBase {
  reviewer_name?: string;
  reviewer_email?: string;
  role?: "commenter" | "viewer" | string;
  permissions?: string[];
  expires_at?: string;
}

export interface LexRevokeDocumentGuestReviewLinkRequest {
  reason?: string;
  metadata?: JsonObject;
}

export interface LexDocumentLegalIssue {
  id: string;
  document_id?: string;
  issue_type: string;
  title: string;
  description?: string | null;
  severity: LexRiskLevel | string;
  status: "open" | "in_progress" | "resolved" | "waived" | string;
  clause_id?: string | null;
  section_id?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  due_at?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexCreateDocumentLegalIssueRequest extends LexDocumentEditorFeatureRequestBase {
  issue_type: string;
  title: string;
  description?: string;
  severity?: LexRiskLevel | string;
  clause_id?: string;
  section_id?: string;
  owner_user_id?: string;
  due_at?: string;
}

export interface LexUpdateDocumentLegalIssueRequest extends LexDocumentEditorFeatureRequestBase {
  title?: string;
  description?: string;
  severity?: LexRiskLevel | string;
  status?: "open" | "in_progress" | "resolved" | "waived" | string;
  owner_user_id?: string | null;
  due_at?: string | null;
}

export interface LexDocumentSignatureReadinessCheck {
  key: string;
  status: "passed" | "warning" | "failed" | string;
  severity?: LexRiskLevel | string | null;
  message?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentSignatureReadiness {
  document_id: string;
  ready: boolean;
  status: "ready" | "needs_review" | "blocked" | string;
  score?: number | null;
  checks: LexDocumentSignatureReadinessCheck[];
  checked_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexRunDocumentSignatureReadinessRequest extends LexDocumentEditorFeatureRequestBase {
  signature_provider?: string;
  envelope_id?: string;
}

export interface LexDocumentClauseAIActionRequest extends LexDocumentEditorFeatureRequestBase {
  action:
    | "rewrite"
    | "summarize"
    | "fallback"
    | "risk_review"
    | "translate"
    | string;
  clause_id?: string;
  section_id?: string;
  text?: string;
  instructions?: string;
  target_language?: LexDraftingLanguage;
  risk_posture?: string;
}

export interface LexDocumentClauseAIActionResult {
  document_id: string;
  action_id?: string | null;
  action: string;
  status: "completed" | "needs_review" | "failed" | string;
  result_text?: string | null;
  changes?: JsonObject[] | null;
  citations?: JsonObject[] | null;
  created_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentHealthScoreDimension {
  key: string;
  label?: string;
  score: number;
  status?: "good" | "warning" | "critical" | string;
  findings?: string[] | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentHealthScore {
  document_id: string;
  score: number;
  grade?: string | null;
  status: "healthy" | "needs_review" | "critical" | string;
  dimensions: LexDocumentHealthScoreDimension[];
  recommendations?: string[] | null;
  checked_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexRefreshDocumentHealthScoreRequest extends LexDocumentEditorFeatureRequestBase {
  include_ai_signals?: boolean;
}

export interface LexDocumentPrivilegedControls {
  document_id: string;
  privileged: boolean;
  access_level?: "standard" | "restricted" | "ethical_wall" | string;
  privilege_basis?: string | null;
  ethical_wall?: boolean | null;
  allowed_user_ids?: string[] | null;
  denied_user_ids?: string[] | null;
  watermark?: boolean | null;
  copy_download_allowed?: boolean | null;
  external_sharing_allowed?: boolean | null;
  retention_hold?: boolean | null;
  warnings?: string[] | null;
  updated_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexUpdateDocumentPrivilegedControlsRequest extends LexDocumentEditorFeatureRequestBase {
  privileged?: boolean;
  access_level?: "standard" | "restricted" | "ethical_wall" | string;
  privilege_basis?: string | null;
  ethical_wall?: boolean;
  allowed_user_ids?: string[];
  denied_user_ids?: string[];
  watermark?: boolean;
  copy_download_allowed?: boolean;
  external_sharing_allowed?: boolean;
  retention_hold?: boolean;
}

export interface LexDocumentProviderEvent {
  id: string;
  document_id?: string;
  provider?: "onlyoffice" | "collabora" | "microsoft_graph" | string;
  event_type: string;
  status: "received" | "processed" | "failed" | "ignored" | string;
  summary?: string | null;
  actor_name?: string | null;
  created_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexRecordDocumentProviderEventRequest extends LexDocumentEditorFeatureRequestBase {
  provider?: "onlyoffice" | "collabora" | "microsoft_graph" | string;
  event_type: string;
  status?: "received" | "processed" | "failed" | "ignored" | string;
  payload?: JsonObject;
}

export interface LexDocumentGuestPortalStatus {
  document_id: string;
  active_links: number;
  expired_links: number;
  revoked_links: number;
  last_guest_activity_at?: string | null;
  watermark_enabled?: boolean | null;
  status: "ready" | "needs_review" | "blocked" | string;
  links?: LexDocumentGuestReviewLink[] | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentAutomationTask {
  id: string;
  document_id?: string;
  title: string;
  task_type: "legal_issue" | "comment" | "playbook_deviation" | "signature_blocker" | string;
  status: "open" | "in_progress" | "done" | "blocked" | string;
  priority?: LexRiskLevel | string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  due_at?: string | null;
  source_id?: string | null;
  metadata?: JsonObject | null;
}

export interface LexCreateDocumentAutomationTaskRequest extends LexDocumentEditorFeatureRequestBase {
  title: string;
  task_type: "legal_issue" | "comment" | "playbook_deviation" | "signature_blocker" | string;
  priority?: LexRiskLevel | string;
  owner_user_id?: string;
  due_at?: string;
  source_id?: string;
}

export interface LexUpdateDocumentAutomationTaskRequest extends LexDocumentEditorFeatureRequestBase {
  title?: string;
  status?: "open" | "in_progress" | "done" | "blocked" | string;
  priority?: LexRiskLevel | string;
  owner_user_id?: string | null;
  due_at?: string | null;
}

export interface LexDocumentClauseAnchor {
  id: string;
  document_id?: string;
  clause_id?: string | null;
  section_id?: string | null;
  label: string;
  path?: string | null;
  page_number?: number | null;
  position?: JsonObject | null;
  status: "anchored" | "stale" | "missing" | string;
  excerpt?: string | null;
  metadata?: JsonObject | null;
}

export interface LexExtractDocumentClauseAnchorsRequest extends LexDocumentEditorFeatureRequestBase {
  force?: boolean;
  include_tables?: boolean;
  include_schedules?: boolean;
}

export interface LexDocumentRedlinePackage {
  id: string;
  document_id?: string;
  status: "queued" | "generating" | "ready" | "failed" | string;
  package_type?: "negotiation" | "approval" | "signature" | string;
  formats: string[];
  download_url?: string | null;
  summary?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexGenerateDocumentRedlinePackageRequest extends LexDocumentEditorFeatureRequestBase {
  package_type?: "negotiation" | "approval" | "signature" | string;
  include_clean_docx?: boolean;
  include_redline_docx?: boolean;
  include_pdf?: boolean;
  include_issues?: boolean;
  include_audit?: boolean;
}

export interface LexDocumentApprovalGate {
  id: string;
  name: string;
  status: "not_started" | "pending" | "approved" | "rejected" | "blocked" | string;
  required: boolean;
  approver_name?: string | null;
  due_at?: string | null;
  severity?: LexRiskLevel | string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentApprovalMatrix {
  document_id: string;
  status: "clear" | "pending" | "blocked" | string;
  gates: LexDocumentApprovalGate[];
  next_gate_id?: string | null;
  updated_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexRequestDocumentApprovalRequest extends LexDocumentEditorFeatureRequestBase {
  gate_id?: string;
  approver_user_id?: string;
  reason?: string;
}

export interface LexDocumentCompareWorkspace {
  id: string;
  document_id?: string;
  base_label?: string | null;
  target_label?: string | null;
  status: "queued" | "running" | "ready" | "failed" | string;
  changes_count?: number | null;
  material_changes_count?: number | null;
  redline_url?: string | null;
  summary?: string | null;
  created_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexRunDocumentCompareRequest extends LexDocumentEditorFeatureRequestBase {
  base_version_id?: string;
  target_version_id?: string;
  uploaded_file_id?: string;
  include_clause_movement?: boolean;
}

export interface LexDocumentCollaborationInboxItem {
  id: string;
  item_type: "comment" | "mention" | "review_request" | "approval" | "guest_activity" | string;
  title: string;
  status: "unread" | "read" | "done" | "snoozed" | string;
  actor_name?: string | null;
  section_id?: string | null;
  priority?: LexRiskLevel | string | null;
  created_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexDocumentCollaborationInbox {
  document_id: string;
  unread_count: number;
  items: LexDocumentCollaborationInboxItem[];
  metadata?: JsonObject | null;
}

export interface LexDocumentPlaybookRuleLink {
  id: string;
  playbook_id?: string | null;
  name: string;
  status: "draft" | "active" | "approval_required" | "archived" | string;
  rule_count?: number | null;
  href?: string | null;
  updated_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexCreateDocumentPlaybookRuleLinkRequest extends LexDocumentEditorFeatureRequestBase {
  playbook_id?: string;
  name?: string;
}

export interface LexDocumentDefinedTermRepairAction {
  id: string;
  term: string;
  action: "define" | "rename" | "merge" | "ignore" | string;
  status: "suggested" | "queued" | "applied" | "dismissed" | string;
  severity?: LexRiskLevel | string | null;
  section_id?: string | null;
  preview?: string | null;
  metadata?: JsonObject | null;
}

export interface LexApplyDocumentDefinedTermRepairRequest extends LexDocumentEditorFeatureRequestBase {
  repair_id?: string;
  action?: "define" | "rename" | "merge" | "ignore" | string;
  replacement_text?: string;
}

export interface LexDocumentEvidenceBinding {
  id: string;
  document_id?: string;
  section_id?: string | null;
  source_type: "document" | "contract" | "policy" | "regulation" | "case" | "matter" | string;
  source_id?: string | null;
  title: string;
  status: "linked" | "missing" | "stale" | "needs_review" | string;
  confidence?: number | null;
  citation?: string | null;
  metadata?: JsonObject | null;
}

export interface LexCreateDocumentEvidenceBindingRequest extends LexDocumentEditorFeatureRequestBase {
  section_id?: string;
  source_type: "document" | "contract" | "policy" | "regulation" | "case" | "matter" | string;
  source_id?: string;
  title?: string;
  citation?: string;
}

export interface LexDocumentAIChangeSafety {
  document_id: string;
  enabled: boolean;
  mode: "preview_only" | "approval_required" | "disabled" | string;
  pending_proposals: number;
  required_approvals: number;
  blockers: string[];
  updated_at?: string | null;
  metadata?: JsonObject | null;
}

export interface LexUpdateDocumentAIChangeSafetyRequest extends LexDocumentEditorFeatureRequestBase {
  enabled?: boolean;
  mode?: "preview_only" | "approval_required" | "disabled" | string;
  required_approvals?: number;
}

export interface LexDocumentOfflineRecoveryState {
  document_id: string;
  status: "clear" | "buffering" | "restore_available" | "conflict" | string;
  queued_edits: number;
  queued_comments: number;
  conflict_count: number;
  last_buffered_at?: string | null;
  restore_token?: string | null;
  metadata?: JsonObject | null;
}

export interface LexSaveDocumentOfflineRecoveryRequest extends LexDocumentEditorFeatureRequestBase {
  queued_edits?: number;
  queued_comments?: number;
  recovery_payload?: JsonObject;
}

export interface LexDocumentEditorAnalytics {
  document_id: string;
  cycle_time_hours?: number | null;
  revision_count: number;
  unresolved_issue_count: number;
  playbook_deviation_rate?: number | null;
  approval_delay_hours?: number | null;
  external_review_turnaround_hours?: number | null;
  signature_readiness_trend?: "improving" | "flat" | "declining" | string | null;
  generated_at?: string | null;
  metadata?: JsonObject | null;
}

/**
 * LexDocumentSearchHit is one row from the full-text search endpoint
 * (`POST /api/v1/lex/documents/search`). It is a full {@link LexDocument} plus a
 * relevance `rank` and a `ts_headline` highlighted `snippet` (HTML `<mark>` tags).
 */
export interface LexDocumentSearchHit extends LexDocument {
  rank: number;
  snippet: string;
}

export type LexComplianceRuleType =
  | "expiry_warning"
  | "missing_clause"
  | "risk_threshold"
  | "review_overdue"
  | "unsigned_contract"
  | "value_threshold"
  | "jurisdiction_check"
  | "data_protection_required"
  | "custom";

export type LexComplianceSeverity = "critical" | "high" | "medium" | "low";
export type LexComplianceAlertStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "dismissed";

export interface LexComplianceRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  rule_type: LexComplianceRuleType;
  severity: LexComplianceSeverity;
  config: JsonObject;
  contract_types: string[];
  enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LexComplianceAlert {
  id: string;
  tenant_id: string;
  rule_id?: string | null;
  contract_id?: string | null;
  title: string;
  description: string;
  severity: LexComplianceSeverity;
  status: LexComplianceAlertStatus;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
  dedup_key?: string | null;
  evidence: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface LexComplianceDashboard {
  rules_by_type: Record<string, number>;
  alerts_by_status: Record<string, number>;
  alerts_by_severity: Record<string, number>;
  /** Unresolved (open/acknowledged/investigating) alerts by severity. Optional until all backends emit it. */
  active_alerts_by_severity?: Record<string, number>;
  open_alerts: number;
  resolved_alerts: number;
  contracts_in_scope: number;
  compliance_score: number;
  calculated_at: string;
}

export interface LexComplianceScore {
  tenant_id: string;
  score: number;
  open_alerts: number;
  resolved_alerts: number;
  rule_coverage: number;
  calculated_at: string;
}

export interface LexComplianceRunResult {
  tenant_id: string;
  score: number;
  alerts_created: number;
  alerts: LexComplianceAlert[];
  calculated_at: string;
}

export interface LexWorkflowSummary {
  workflow_instance_id: string;
  task_id?: string | null;
  contract_id: string;
  contract_title: string;
  contract_status: LexContractStatus;
  workflow_status: string;
  current_step_id?: string | null;
  started_at: string;
  assignee_id?: string | null;
  assignee_role?: string | null;
  task_status?: string | null;
  sla_deadline?: string | null;
  approval_policy?: JsonObject | null;
  delegation?: JsonObject | null;
}

export type LexApprovalPolicyMode = "sequential" | "parallel";
export type LexApprovalPolicyQuorum = "all" | "any" | "n_of_m";
export type LexApprovalPolicyApproverType = "user" | "role";

export interface LexApprovalPolicyApprover {
  type: LexApprovalPolicyApproverType;
  ref: string;
  label?: string | null;
}

export interface LexApprovalPolicy {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  status: string;
  priority: number;
  contract_type?: LexContractType | null;
  department?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  currency: string;
  mode: LexApprovalPolicyMode;
  quorum: LexApprovalPolicyQuorum;
  quorum_n?: number | null;
  approvers: LexApprovalPolicyApprover[];
  form_fields: LexApprovalFormFieldRequest[];
  require_authority_evidence: boolean;
  required_role?: string | null;
  required_authority_amount?: number | null;
  metadata: JsonObject;
  created_by: string;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type LexCreateApprovalPolicyRequest = Omit<
  LexApprovalPolicy,
  "id" | "tenant_id" | "created_by" | "updated_by" | "created_at" | "updated_at"
>;

export type LexUpdateApprovalPolicyRequest = LexCreateApprovalPolicyRequest;

export interface LexApprovalPolicyRecommendationResult {
  policy: LexApprovalPolicy | null;
  matched: boolean;
  reason: string;
}

export interface LexApprovalPolicyAnalyticsPolicy {
  policy_id: string;
  name: string;
  status: string;
  mode: LexApprovalPolicyMode;
  quorum: LexApprovalPolicyQuorum;
  quorum_n?: number | null;
  require_authority_evidence: boolean;
  total_tasks: number;
  active_tasks: number;
  completed_tasks: number;
  rejected_tasks: number;
  cancelled_tasks: number;
  awaiting_quorum_tasks: number;
  average_decision_hours?: number | null;
  last_task_at?: string | null;
}

export interface LexApprovalPolicyAnalytics {
  tenant_id: string;
  generated_at: string;
  total_policies: number;
  active_policies: number;
  draft_policies: number;
  archived_policies: number;
  total_routed_tasks: number;
  active_tasks: number;
  completed_tasks: number;
  rejected_tasks: number;
  cancelled_tasks: number;
  awaiting_quorum_tasks: number;
  average_decision_hours?: number | null;
  policies: LexApprovalPolicyAnalyticsPolicy[];
}

export interface LexApprovalPolicyRequest {
  policy_id?: string;
  name?: string;
  required_role?: string;
  required_authority_amount?: number;
  currency?: string;
  require_authority_evidence?: boolean;
}

export type LexApprovalFormFieldType =
  | "boolean"
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "date";

export interface LexApprovalFormFieldRequest {
  name: string;
  type: LexApprovalFormFieldType;
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  description?: string;
}

export interface LexOutOfOfficeDelegationInput {
  active: boolean;
  original_approver_user_id?: string;
  delegated_to?: string;
  reason?: string;
  evidence_id?: string;
  starts_at?: string;
  ends_at?: string;
}

export interface LexReviewContractRequest {
  approver_user_id?: string;
  approver_role?: string;
  sla_hours?: number;
  description?: string;
  approval_policy_id?: string;
  approval_policy?: LexApprovalPolicyRequest;
  form_fields?: LexApprovalFormFieldRequest[];
  out_of_office?: LexOutOfOfficeDelegationInput;
}

export interface LexApprovalAuthorityEvidence {
  policy_id?: string;
  role: string;
  authority_amount: number;
  currency: string;
  evidence_id: string;
  source?: string;
}

export interface LexWorkflowDecisionRequest {
  decision: "approve" | "request_changes" | "reject";
  notes?: string | null;
  metadata?: JsonObject;
  form_data?: JsonObject;
  authority_evidence?: LexApprovalAuthorityEvidence;
  delegated_to?: string;
  delegation_reason?: string;
  out_of_office?: LexOutOfOfficeDelegationInput;
  late_justification?: string;
}

export interface LexWorkflowBulkDecisionItem {
  workflow_instance_id: string;
  task_id: string;
  notes?: string | null;
  metadata?: JsonObject;
  form_data?: JsonObject;
  authority_evidence?: LexApprovalAuthorityEvidence;
  late_justification?: string;
}

export interface LexWorkflowBulkDecisionRequest {
  decision: LexWorkflowDecisionRequest["decision"];
  notes?: string | null;
  metadata?: JsonObject;
  form_data?: JsonObject;
  authority_evidence?: LexApprovalAuthorityEvidence;
  late_justification?: string;
  items: LexWorkflowBulkDecisionItem[];
}

export interface LexWorkflowDecisionResult {
  workflow_instance_id: string;
  task_id: string;
  contract_id: string;
  previous_contract_status: LexContractStatus | string;
  contract_status: LexContractStatus | string;
  workflow_status: string;
  task_status: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  notes?: string | null;
  metadata?: JsonObject;
  authority_evidence?: JsonObject | null;
  delegation?: JsonObject | null;
}

export interface LexWorkflowBulkDecisionError {
  workflow_instance_id: string;
  task_id: string;
  code: string;
  message: string;
}

export interface LexWorkflowBulkDecisionResult {
  decision: string;
  requested: number;
  succeeded: number;
  failed: number;
  decided_by: string;
  decided_at: string;
  results: LexWorkflowDecisionResult[];
  errors: LexWorkflowBulkDecisionError[];
}

export interface LexContractReport {
  generated_at: string;
  total: number;
  filters: Record<string, string>;
  contracts: LexContractSummary[];
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_risk_level: Record<string, number>;
}

export interface LexMatterSummary {
  id: string;
  matter_number: string;
  title: string;
  type: LexMatterType | string;
  status: LexMatterStatus | string;
  priority: LexMatterPriority | string;
  owner_user_id: string;
  owner_name: string;
  department?: string | null;
  opened_at: string;
  due_date?: string | null;
  closed_at?: string | null;
  created_at: string;
}

export interface LexMatterReport {
  generated_at: string;
  total: number;
  filters: Record<string, string>;
  matters: LexMatterSummary[];
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
}

export interface LexResolutionRateCategory {
  key: string;
  total: number;
  resolved: number;
  rate: number;
}

export interface LexResolutionRateReport {
  categories: LexResolutionRateCategory[];
  calculated_at: string;
}

export interface LexObligationSummary {
  id: string;
  title: string;
  type: LexObligationType | string;
  status: LexObligationStatus | string;
  priority: LexMatterPriority | string;
  owner_user_id: string;
  owner_name: string;
  contract_id?: string | null;
  contract_title?: string | null;
  matter_id?: string | null;
  matter_title?: string | null;
  due_date: string;
  days_until_due: number;
  completed_at?: string | null;
  created_at: string;
}

export interface LexObligationReport {
  generated_at: string;
  total: number;
  filters: Record<string, string>;
  obligations: LexObligationSummary[];
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
  overdue: number;
  due_soon: number;
  completed: number;
}

export type LexSignatureEnvelopeStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "declined"
  | "expired"
  | "cancelled";

export type LexSignatureProvider = "native" | "nafath" | "external";
export type LexSignatureMethod =
  | "otp"
  | "nafath"
  | "certificate"
  | "wet_signature";
export type LexSignatureLanguage = "en" | "ar" | "bilingual";

export type LexSignatureRecipientStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "declined"
  | "expired"
  | "cancelled";

export type LexSignatureRecipientAction = "view" | "sign" | "decline";

export interface LexSignatureRecipient {
  id: string;
  tenant_id?: string;
  envelope_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  user_id?: string | null;
  language?: LexSignatureLanguage | string | null;
  signing_order: number;
  status: LexSignatureRecipientStatus | string;
  provider?: LexSignatureProvider | string;
  method?: LexSignatureMethod | string;
  provider_recipient_id?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  evidence_hash?: string | null;
  evidence_metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface LexSignatureEnvelope {
  id: string;
  tenant_id: string;
  target_type: "contract" | "document" | string;
  contract_id?: string | null;
  document_id?: string | null;
  contract_title?: string | null;
  contract_number?: string | null;
  title: string;
  subject: string;
  message: string;
  language?: LexSignatureLanguage | string;
  subject_ar?: string;
  message_ar?: string;
  legal_consent_en?: string;
  legal_consent_ar?: string;
  provider: LexSignatureProvider | string;
  method: LexSignatureMethod | string;
  status: LexSignatureEnvelopeStatus | string;
  sender_user_id?: string | null;
  sender_name?: string | null;
  recipient_count?: number;
  signed_count?: number;
  due_at?: string | null;
  expires_at?: string | null;
  sent_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  evidence_hash?: string | null;
  evidence_metadata: JsonObject;
  recipients?: LexSignatureRecipient[];
  events?: Array<{
    id: string;
    event_type: string;
    recipient_id?: string | null;
    provider?: string | null;
    provider_status?: string | null;
    provider_event_id?: string | null;
    provider_envelope_id?: string | null;
    provider_recipient_id?: string | null;
    evidence_hash?: string | null;
    evidence_metadata?: JsonObject;
    occurred_at: string;
  }>;
  custody_evidence?: Array<{
    id: string;
    envelope_id: string;
    file_id: string;
    file_name: string;
    file_size_bytes: number;
    content_hash: string;
    seal_hash?: string | null;
    evidence_hash?: string | null;
    provider: LexSignatureProvider | string;
    signed_at: string;
    retention_metadata: JsonObject;
    custody_metadata: JsonObject;
    created_by: string;
    created_at: string;
  }>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LexSignatureRecipientInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  user_id?: string | null;
  language?: LexSignatureLanguage | string | null;
  method?: LexSignatureMethod | string;
  signing_order?: number;
  provider_recipient_id?: string | null;
  evidence_metadata?: JsonObject;
}

export interface LexCreateSignatureEnvelopePayload {
  contract_id?: string | null;
  document_id?: string | null;
  title: string;
  subject?: string;
  message?: string | null;
  language?: LexSignatureLanguage | string;
  subject_ar?: string | null;
  message_ar?: string | null;
  legal_consent_en?: string | null;
  legal_consent_ar?: string | null;
  provider?: LexSignatureProvider | string;
  method?: LexSignatureMethod | string;
  due_at?: string | null;
  expires_at?: string | null;
  evidence_metadata?: JsonObject;
  recipients: LexSignatureRecipientInput[];
}

export interface LexSignatureRecipientActionPayload {
  recipient_id: string;
  action: LexSignatureRecipientAction | string;
  actor_name?: string | null;
  actor_email?: string | null;
  evidence_hash?: string | null;
  evidence_metadata?: JsonObject;
  decline_reason?: string | null;
}

export type LexSignaturePlacementKind = "signature" | "initials" | "name" | "date";

export interface LexSignaturePlacement {
  id: string;
  recipient_id?: string | null;
  kind: LexSignaturePlacementKind | string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  label?: string | null;
}

export interface LexUpsertSignaturePlacementsPayload {
  placements: LexSignaturePlacement[];
  evidence_metadata?: JsonObject;
}

export interface LexSignatureUserProfile {
  tenant_id: string;
  user_id: string;
  typed_name: string;
  initials: string;
  signature_image?: string | null;
  signature_image_mime?: string | null;
  signature_image_hash?: string | null;
  initials_image?: string | null;
  initials_image_mime?: string | null;
  initials_image_hash?: string | null;
  consent_version: string;
  created_at: string;
  updated_at: string;
}

export interface LexUpsertSignatureUserProfilePayload {
  typed_name: string;
  initials?: string;
  signature_image?: string | null;
  initials_image?: string | null;
  consent_version?: string;
}

export interface LexSignatureProviderEventPayload {
  provider: LexSignatureProvider | string;
  provider_status: string;
  provider_event_id?: string | null;
  provider_envelope_id?: string | null;
  provider_recipient_id?: string | null;
  recipient_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  evidence_hash?: string | null;
  evidence_metadata?: JsonObject;
  decline_reason?: string | null;
  reason?: string | null;
  occurred_at?: string | null;
  webhook_signature?: string | null;
  webhook_timestamp?: string | null;
  webhook_payload?: string | null;
  webhook_secret?: string | null;
  webhook_signature_base?: string | null;
  webhook_algorithm?: string | null;
}

export interface LexRecordSignatureCustodyPayload {
  file_id: string;
  file_name: string;
  file_size_bytes: number;
  content_hash: string;
  seal_hash?: string | null;
  evidence_hash?: string | null;
  provider?: LexSignatureProvider | string;
  signed_at?: string | null;
  retention_metadata?: JsonObject;
  custody_metadata?: JsonObject;
}

export interface LexLocalizedSignatureText {
  language: LexSignatureLanguage | string;
  subject: string;
  message: string;
  legal_consent: string;
}

export interface LexRenderedSignatureText {
  language: LexSignatureLanguage | string;
  primary: LexLocalizedSignatureText;
  secondary?: LexLocalizedSignatureText | null;
}

export type LexMatterStatus =
  | "intake"
  | "open"
  | "in_review"
  | "waiting_on_business"
  | "on_hold"
  | "closed"
  | "cancelled";

export type LexLegalPriority = "critical" | "high" | "medium" | "low";
export type LexMatterPriority = LexLegalPriority;
export type LexMatterType =
  | "general"
  | "contract"
  | "litigation"
  | "regulatory"
  | "employment"
  | "dispute"
  | "advisory"
  | "other";

export interface LexMatterContract {
  id: string;
  tenant_id: string;
  matter_id: string;
  contract_id: string;
  contract_title?: string | null;
  relationship: string;
  created_by: string;
  created_at: string;
}

export interface LexMatter {
  id: string;
  tenant_id: string;
  matter_number: string;
  title: string;
  description: string;
  type: LexMatterType | string;
  status: LexMatterStatus | string;
  priority: LexMatterPriority | string;
  owner_user_id: string;
  owner_name: string;
  requester_user_id?: string | null;
  requester_name?: string | null;
  department?: string | null;
  opened_at: string;
  due_date?: string | null;
  closed_at?: string | null;
  contracts?: LexMatterContract[];
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LexCreateMatterPayload {
  matter_number?: string | null;
  title: string;
  description?: string;
  type?: LexMatterType | string;
  status?: LexMatterStatus | string;
  priority?: LexMatterPriority | string;
  owner_user_id: string;
  owner_name: string;
  requester_user_id?: string | null;
  requester_name?: string | null;
  department?: string | null;
  due_date?: string | null;
  tags?: string[];
  metadata?: JsonObject;
  contract_ids?: string[];
}

export interface LexUpdateMatterPayload {
  matter_number?: string | null;
  title?: string;
  description?: string;
  type?: LexMatterType | string;
  status?: LexMatterStatus | string;
  priority?: LexMatterPriority | string;
  owner_user_id?: string;
  owner_name?: string;
  requester_user_id?: string | null;
  requester_name?: string | null;
  department?: string | null;
  due_date?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexUpdateMatterStatusPayload {
  status: LexMatterStatus | string;
}

export interface LexTriageMatterPayload {
  status: LexMatterStatus | string;
  priority?: LexMatterPriority | string;
  owner_user_id?: string;
  owner_name?: string;
  due_date?: string | null;
  notes?: string;
  metadata?: JsonObject;
}

export interface LexLinkMatterContractPayload {
  contract_id: string;
  relationship: string;
}

// --- Matter collaboration / linking (FEATURE 5, 7, 9, 10) ----------------

// LexMatterComment is a persisted @mention-aware collaboration note on a matter
// (GET/POST/PUT/DELETE /matters/{id}/comments). author_name is derived
// server-side from the JWT email; clients never send it. mentions and metadata
// are never null (default to [] / {}).
export interface LexMatterComment {
  id: string;
  tenant_id: string;
  matter_id: string;
  body: string;
  mentions: string[];
  metadata: JsonObject;
  author_user_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface LexCreateMatterCommentPayload {
  body: string;
  mentions?: string[];
  metadata?: JsonObject;
}

// LexUpdateMatterCommentPayload patches a comment; nil/omitted fields are left
// as-is by the backend.
export interface LexUpdateMatterCommentPayload {
  body?: string | null;
  mentions?: string[] | null;
  metadata?: JsonObject | null;
}

// LexMatterDocumentLink is a join row connecting a matter to an existing
// repository document (LegalDocument). The underlying document is hydrated when
// active; deleting a link never deletes the document (WORM).
export interface LexMatterDocumentLink {
  id: string;
  tenant_id: string;
  matter_id: string;
  document_id: string;
  relationship: string;
  created_by: string;
  created_at: string;
  deleted_at?: string | null;
  document?: LexDocument | null;
}

export interface LexCreateMatterDocumentLinkPayload {
  document_id: string;
  relationship?: string;
}

// LexMatterAuditEntry is one append-only governance audit row for a matter
// (chronological, oldest-first). detail is always present (defaults to {}).
export interface LexMatterAuditEntry {
  id: string;
  tenant_id: string;
  matter_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  detail: JsonObject;
  actor_user_id: string;
  created_at: string;
}

export type LexMatterLinkTargetType =
  | "consultation"
  | "investigation"
  | "legal_case"
  | "settlement"
  | "litigation"
  | "contract";

// LexMatterLink is a cross-domain related-items edge from a matter to a sibling
// lex entity. target_reference/target_title are best-effort enrichment and are
// currently always omitted — the frontend resolves titles/refs from the domains
// it already loads.
export interface LexMatterLink {
  id: string;
  tenant_id: string;
  matter_id: string;
  target_type: LexMatterLinkTargetType | string;
  target_id: string;
  relationship: string;
  created_by: string;
  created_at: string;
  target_reference?: string;
  target_title?: string;
}

export interface LexCreateMatterLinkPayload {
  target_type: LexMatterLinkTargetType | string;
  target_id: string;
  relationship?: string;
}

export interface LexMatterConflictCheckRequest {
  matter_id?: string | null;
  contract_id?: string | null;
  title: string;
  description?: string;
  counterparty?: string;
  contract_title?: string;
  contract_context?: string;
}

export type LexMatterConflictSeverity = "conflict" | "warning";

export interface LexMatterConflictIssue {
  severity: LexMatterConflictSeverity;
  reasons: string[];
  matter_id?: string | null;
  matter_title?: string | null;
  contract_id?: string | null;
  contract_title?: string | null;
  matched_terms?: string[];
}

export interface LexMatterConflictCheckResult {
  checked_at: string;
  conflicts: LexMatterConflictIssue[];
  warnings: LexMatterConflictIssue[];
}

// =============================================================================
// Case Timelines (external dependency / delay) — backend CAP-084..088.
// Mirrors backend/internal/lex/model/case_delay.go + dto/settlement_dto.go.
// =============================================================================

// LexDelayCategory classifies the external party a matter is waiting on.
export type LexDelayCategory = "court" | "government" | "department" | "expert";

// LexCaseDelayEvent is one recorded external-dependency / delay window on a
// matter: an open -> resolved interval with a classified cause.
export interface LexCaseDelayEvent {
  id: string;
  tenant_id: string;
  matter_id: string;
  category: LexDelayCategory | string;
  reason: string;
  opened_at: string;
  resolved_at?: string | null;
  resolved: boolean;
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// LexCaseTimeline is the timeline / external-dependency projection of a matter
// (GET/PUT /matters/{id}/timeline, POST .../external-hold all return this shape).
export interface LexCaseTimeline {
  matter_id: string;
  tenant_id: string;
  matter_number: string;
  title: string;
  status: LexMatterStatus | string;
  opened_at: string;
  due_date?: string | null;
  closed_at?: string | null;
  estimated_duration_days?: number | null;
  estimated_completion_date?: string | null;
  external_hold: boolean;
  external_hold_category?: LexDelayCategory | string | null;
  external_hold_since?: string | null;
  closure_reason?: string | null;
  updated_at: string;
  delay_events?: LexCaseDelayEvent[];
  open_delay_days: number;
}

// LexMatterTimelineSummary is one row of the cross-matter (portfolio) timeline
// summary that powers the manager triage dashboard (GET /matters/timelines).
export interface LexMatterTimelineSummary {
  matter_id: string;
  matter_number: string;
  title: string;
  status: LexMatterStatus | string;
  external_hold: boolean;
  external_hold_category?: LexDelayCategory | string | null;
  external_hold_since?: string | null;
  estimated_completion_date?: string | null;
  due_date?: string | null;
  open_delay_days: number;
  updated_at: string;
}

// LexUpdateMatterTimelinePayload sets the estimated-duration / completion
// projection on a matter. Omit a field to leave it unchanged; set
// clear_estimate to null both estimate columns.
export interface LexUpdateMatterTimelinePayload {
  estimated_duration_days?: number | null;
  estimated_completion_date?: string | null;
  clear_estimate?: boolean;
}

// LexSetExternalHoldPayload flags or clears the external-pending state on a
// matter. When held is true a category is required.
export interface LexSetExternalHoldPayload {
  held: boolean;
  category?: LexDelayCategory | string | null;
  reason?: string;
  since?: string | null;
}

// LexMatterTimelineSummaryParams scopes the portfolio timeline listing.
export interface LexMatterTimelineSummaryParams {
  on_hold?: boolean;
  min_open_delay_days?: number;
  page?: number;
  per_page?: number;
  sort?: string;
  sort_dir?: "asc" | "desc";
}

export type LexObligationStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "completed"
  | "waived"
  | "cancelled";

export type LexObligationType =
  | "contractual"
  | "renewal"
  | "notice"
  | "payment"
  | "delivery"
  | "reporting"
  | "compliance"
  | "covenant"
  | "condition_precedent"
  | "regulatory"
  | "other";

export type LexObligationNotificationType = "reminder" | "escalation";
export type LexObligationNotificationChannel = "email" | "calendar" | "in_app";
export type LexObligationNotificationOutboxStatus =
  | "pending"
  | "sent"
  | "failed";

export interface LexObligation {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  type: LexObligationType | string;
  status: LexObligationStatus | string;
  priority: LexLegalPriority | string;
  contract_id?: string | null;
  contract_title?: string | null;
  matter_id?: string | null;
  matter_title?: string | null;
  clause_id?: string | null;
  owner_user_id: string;
  owner_name: string;
  due_date: string;
  completed_at?: string | null;
  reminder_enabled: boolean;
  reminder_lead_days: number[];
  escalation_enabled: boolean;
  escalation_lead_days: number[];
  escalation_target?: string | null;
  last_reminder_at?: string | null;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  days_until_due: number;
}

export interface LexCreateObligationPayload {
  title: string;
  description?: string;
  type?: LexObligationType | string;
  status?: LexObligationStatus | string;
  priority?: LexLegalPriority | string;
  contract_id?: string | null;
  matter_id?: string | null;
  clause_id?: string | null;
  owner_user_id: string;
  owner_name: string;
  due_date: string;
  reminder_enabled?: boolean;
  reminder_lead_days?: number[];
  escalation_enabled?: boolean;
  escalation_lead_days?: number[];
  escalation_target?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexUpdateObligationPayload {
  title?: string;
  description?: string;
  type?: LexObligationType | string;
  status?: LexObligationStatus | string;
  priority?: LexLegalPriority | string;
  contract_id?: string | null;
  matter_id?: string | null;
  clause_id?: string | null;
  owner_user_id?: string;
  owner_name?: string;
  due_date?: string;
  reminder_enabled?: boolean;
  reminder_lead_days?: number[];
  escalation_enabled?: boolean;
  escalation_lead_days?: number[];
  escalation_target?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexUpdateObligationStatusPayload {
  status: LexObligationStatus | string;
}

export interface LexObligationExtractionItem {
  title: string;
  description: string;
  type?: LexObligationType | string;
  priority?: LexLegalPriority | string;
  due_date?: string | null;
  source: string;
  source_reference: string;
  clause_id?: string | null;
  reminder_enabled?: boolean | null;
  reminder_lead_days?: number[];
  escalation_enabled?: boolean | null;
  escalation_lead_days?: number[];
  escalation_target?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexExtractObligationsPayload {
  owner_user_id: string;
  owner_name: string;
  matter_id?: string | null;
  items?: LexObligationExtractionItem[];
  include_contract_renewal?: boolean | null;
  default_reminder_lead_days?: number[];
  default_escalation_lead_days?: number[];
  default_escalation_target?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexMarkObligationReminderSentPayload {
  sent_at?: string | null;
  scheduled_at?: string | null;
  channel?: LexObligationNotificationChannel | string;
  event_type?: LexObligationNotificationType | string;
  lead_days?: number;
  provider?: string;
  provider_message_id?: string;
  provider_metadata?: JsonObject;
  recipient_contact?: string | null;
}

export interface LexEnqueueObligationRemindersPayload {
  as_of?: string | null;
  horizon_days?: number | null;
  include_escalations?: boolean | null;
  channels?: Array<LexObligationNotificationChannel | string>;
}

export interface LexMarkObligationReminderDeliveryPayload {
  status: LexObligationNotificationOutboxStatus | string;
  attempted_at?: string | null;
  provider?: string;
  provider_message_id?: string;
  provider_metadata?: JsonObject;
  error_message?: string;
}

export interface LexDispatchObligationReminderOutboxPayload {
  provider?: string;
  retry?: boolean;
  limit?: number | null;
  as_of?: string | null;
}

export interface LexObligationNotificationEvent {
  event_id: string;
  type: LexObligationNotificationType | string;
  obligation_id: string;
  obligation_title: string;
  contract_id?: string | null;
  contract_title?: string | null;
  matter_id?: string | null;
  matter_title?: string | null;
  owner_user_id: string;
  owner_name: string;
  due_date: string;
  days_until_due: number;
  lead_days: number;
  planned_for: string;
  channel: LexObligationNotificationChannel | string;
  escalation_target?: string | null;
  reason: string;
}

export interface LexObligationReminderPlan {
  as_of: string;
  horizon_days: number;
  total: number;
  events: LexObligationNotificationEvent[];
}

export interface LexObligationNotificationOutboxItem {
  id: string;
  tenant_id: string;
  obligation_id: string;
  event_id: string;
  event_type: LexObligationNotificationType | string;
  lead_days: number;
  channel: LexObligationNotificationChannel | string;
  recipient_user_id?: string | null;
  recipient_name: string;
  recipient_contact?: string | null;
  scheduled_at: string;
  status: LexObligationNotificationOutboxStatus | string;
  provider: string;
  provider_message_id?: string | null;
  provider_metadata: JsonObject;
  error_message?: string | null;
  attempt_count: number;
  last_attempt_at?: string | null;
  sent_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LexObligationReminderEnqueueResult {
  plan: LexObligationReminderPlan;
  requested_count: number;
  queued_count: number;
  skipped_duplicate_count: number;
  queued: LexObligationNotificationOutboxItem[];
}

export interface LexObligationExtractionSkip {
  source: string;
  title?: string;
  reason: string;
}

export interface LexObligationExtractionResult {
  contract_id: string;
  created_count: number;
  created: LexObligation[];
  skipped: LexObligationExtractionSkip[];
  planned_notifications: LexObligationNotificationEvent[];
  committed_at: string;
  deterministic_strategy: string;
}

export interface LexObligationReminderDispatchAttempt {
  outbox_id: string;
  obligation_id: string;
  channel: LexObligationNotificationChannel | string;
  previous_status: LexObligationNotificationOutboxStatus | string;
  status: LexObligationNotificationOutboxStatus | string;
  provider?: string;
  provider_message_id?: string | null;
  provider_metadata?: JsonObject;
  error_message?: string | null;
  skipped_reason?: string;
  item?: LexObligationNotificationOutboxItem | null;
}

export interface LexObligationReminderDispatchResult {
  provider: string;
  retry: boolean;
  requested_count: number;
  dispatched_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  attempts: LexObligationReminderDispatchAttempt[];
}

export type LexLibraryStatus =
  | "draft"
  | "active"
  | "in_review"
  | "pending_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "deprecated"
  | "archived";

export type LexGovernanceDecision = "submit_review" | "approve" | "reject";

export interface LexGovernanceDecisionRequest {
  decision: LexGovernanceDecision;
  activate?: boolean;
  notes?: string;
  evidence?: JsonObject;
}

export interface LexClauseLibraryEntry {
  id: string;
  tenant_id: string;
  code: string;
  clause_type: LexClauseType | string;
  title_en: string;
  title_ar: string;
  text_en: string;
  text_ar: string;
  category: string;
  jurisdiction: string;
  source: string;
  source_url?: string | null;
  language?: "en" | "ar" | "bilingual" | string | null;
  status: LexLibraryStatus | string;
  governance_status: LexLibraryStatus | string;
  version: number;
  risk_level?: LexRiskLevel | string | null;
  supersedes_id?: string | null;
  deprecated_by_id?: string | null;
  deprecated_at?: string | null;
  replacement_clause_id?: string | null;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LexCreateClauseLibraryEntryPayload {
  code: string;
  clause_type?: LexClauseType | string;
  title_en: string;
  title_ar?: string;
  text_en: string;
  text_ar?: string;
  category?: string;
  jurisdiction?: string;
  source?: string;
  source_url?: string | null;
  version?: number;
  status?: LexLibraryStatus | string;
  governance_status?: LexLibraryStatus | string;
  supersedes_id?: string | null;
  deprecated_by_id?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexUpdateClauseLibraryEntryPayload {
  code?: string;
  clause_type?: LexClauseType | string;
  title_en?: string;
  title_ar?: string;
  text_en?: string;
  text_ar?: string;
  category?: string;
  jurisdiction?: string;
  source?: string;
  source_url?: string | null;
  version?: number;
  status?: LexLibraryStatus | string;
  governance_status?: LexLibraryStatus | string;
  supersedes_id?: string | null;
  deprecated_by_id?: string | null;
  tags?: string[];
  metadata?: JsonObject;
}

export type LexRegulationClauseReferenceType =
  | "implements"
  | "required_by"
  | "recommended_by"
  | "impacted_by"
  | "related";

export interface LexRegulationClauseReference {
  id: string;
  tenant_id: string;
  regulation_id: string;
  clause_id: string;
  reference_type: LexRegulationClauseReferenceType | string;
  notes: string;
  clause_code?: string;
  clause_title_en?: string;
  clause_title_ar?: string;
  created_by: string;
  created_at: string;
}

export interface LexRegulation {
  id: string;
  tenant_id: string;
  code: string;
  title_en: string;
  title_ar: string;
  description_en: string;
  description_ar: string;
  authority: string;
  jurisdiction: string;
  regulation_type: string;
  source: string;
  effective_date?: string | null;
  last_reviewed_at?: string | null;
  status: LexLibraryStatus | string;
  version: number;
  source_url?: string | null;
  clause_references?: LexRegulationClauseReference[];
  compliance_rule_ids?: string[];
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LexCreateRegulationPayload {
  code: string;
  title_en: string;
  title_ar?: string;
  description_en?: string;
  description_ar?: string;
  authority?: string;
  jurisdiction?: string;
  regulation_type?: string;
  source?: string;
  source_url?: string | null;
  effective_date?: string | null;
  version?: number;
  status?: LexLibraryStatus | string;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexUpdateRegulationPayload {
  code?: string;
  title_en?: string;
  title_ar?: string;
  description_en?: string;
  description_ar?: string;
  authority?: string;
  jurisdiction?: string;
  regulation_type?: string;
  source?: string;
  source_url?: string | null;
  effective_date?: string | null;
  version?: number;
  status?: LexLibraryStatus | string;
  tags?: string[];
  metadata?: JsonObject;
}

export interface LexLinkRegulationClausePayload {
  clause_id: string;
  reference_type?: LexRegulationClauseReferenceType | string;
  notes?: string;
}

export interface LexUnlinkRegulationClauseParams {
  clause_id: string;
  reference_type: LexRegulationClauseReferenceType | string;
}

export interface LexClauseLibrarySearchResult {
  item: LexClauseLibraryEntry;
  score: number;
  matched_fields: string[];
  snippets?: Record<string, string>;
  metadata?: JsonObject | null;
}

export interface LexRegulationSearchResult {
  item: LexRegulation;
  score: number;
  matched_fields: string[];
  snippets?: Record<string, string>;
  metadata?: JsonObject | null;
}

export interface LexClauseLibrarySearchParams {
  query?: string;
  q?: string;
  page?: number;
  per_page?: number;
  clause_type?: string;
  category?: string;
  jurisdiction?: string;
  status?: string;
  governance_status?: string;
  risk_level?: string;
  language?: string;
  semantic?: boolean;
}

export interface LexRegulationSearchParams {
  query?: string;
  q?: string;
  page?: number;
  per_page?: number;
  jurisdiction?: string;
  authority?: string;
  regulation_type?: string;
  status?: string;
  risk_level?: string;
  language?: string;
  semantic?: boolean;
}

/* ------------------------------------------------------------------------- *
 * WatheeqTech Reference Library — the read-only, cross-tenant Saudi legal
 * reference corpus (`/lex/library`). Mirrors the {@link LexRegulation} field
 * shape but drops every write/governance/tenant-scoped concern: the catalog is
 * global and served read-only. See docs/ClarioWatheeq/WatheeqTech_Library_Design.md.
 * ------------------------------------------------------------------------- */

/** Top-level corpus bucket. */
export type LexReferenceCategory =
  | "systems-regulations"
  | "judicial-journal"
  | "research";

/** Finer document type within a corpus bucket. */
export type LexReferenceDocType =
  | "system"
  | "regulation"
  | "judicial-journal"
  | "research";

/** A single reference-library document (global catalog row). */
export interface LexReferenceDocument {
  id: string;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  category: LexReferenceCategory | string;
  doc_type: LexReferenceDocType | string;
  jurisdiction: string;
  authority: string;
  source: string;
  source_url?: string | null;
  tags: string[];
  file_id?: string | null;
  file_size_bytes?: number | null;
  content_hash?: string | null;
  published: boolean;
  hijri_date?: string | null;
  gregorian_date?: string | null;
  /**
   * Effective/enforcement date of the law, when known (a sibling backend change
   * adds it). Drives the detail page's "as-of" affordance; when absent the UI
   * shows an honest "confirm the current version" note instead of implying
   * currency it can't prove.
   */
  effective_date?: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

/** A single facet bucket returned by `/reference-library/facets`. */
export interface LexReferenceFacet {
  key: string;
  count: number;
}

/** Faceted counts driving the KPI strip + quick-filter tree. */
export interface LexReferenceLibraryFacets {
  categories: LexReferenceFacet[];
  doc_types: LexReferenceFacet[];
  tags: LexReferenceFacet[];
}

/** A contents/semantic search hit ("Second Brain" search). */
export interface LexReferenceSearchHit {
  doc_id: string;
  title_ar: string;
  title_en: string;
  snippet: string;
  score: number;
  /** Optional page anchor for deep-linking into the viewer (when the AI provides it). */
  page?: number | null;
}

/** A single citation returned alongside an Ask-the-Library answer. */
export interface LexReferenceAskCitation {
  doc_id: string;
  title_ar: string;
  title_en: string;
  snippet: string;
  page?: number | null;
  score: number;
}

/** Request body for the Ask-the-Library ("Second Brain") Q&A endpoint. */
export interface LexReferenceAskPayload {
  question: string;
  top_k?: number;
  doc_ids?: string[];
}

/** Grounded answer + citations from the Ask-the-Library endpoint. */
export interface LexReferenceAskResponse {
  answer: string;
  citations: LexReferenceAskCitation[];
  model: string;
  latency_ms: number;
}

/**
 * A single article/مادة entry in a reference document's table of contents,
 * returned by `GET /reference-library/{id}/articles`. Used by the viewer's
 * article-navigation panel to jump the reader to the article's page.
 */
export interface LexReferenceArticle {
  /** Article number label as it appears in the text (e.g. "12", "الثانية"). */
  article_no: string;
  /** Short display label (e.g. "المادة 12" / "Article 12"). */
  label: string;
  /** Optional article heading/title. */
  title?: string | null;
  /** 1-based page the article starts on (drives the viewer jump). */
  page?: number | null;
}

/** Thumbs up/down feedback on an Ask-the-Library answer. */
export type LexReferenceAskRating = "up" | "down";

/** Request body for `POST /reference-library/ask/feedback`. */
export interface LexReferenceAskFeedbackPayload {
  question: string;
  rating: LexReferenceAskRating;
  comment?: string;
  citations?: LexReferenceAskCitation[];
}

export type LexPlaybookStatus = "draft" | "active" | "archived";

export interface LexPlaybookClause {
  clause_type: LexClauseType | string;
  title: string;
  standard_text: string;
  required: boolean;
  risk_weight: number;
  similarity_threshold: number;
}

export interface LexClausePlaybook {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  contract_type: LexContractType | string;
  status: LexPlaybookStatus | string;
  clauses: LexPlaybookClause[];
  metadata: JsonObject;
  created_by: string;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LexCreatePlaybookPayload {
  name: string;
  description?: string;
  contract_type: LexContractType | string;
  status?: LexPlaybookStatus | string;
  clauses: LexPlaybookClause[];
  metadata?: JsonObject;
}

export interface LexUpdatePlaybookPayload {
  name?: string;
  description?: string;
  contract_type?: LexContractType | string;
  status?: LexPlaybookStatus | string;
  clauses?: LexPlaybookClause[];
  metadata?: JsonObject;
}

export type LexClauseDeviationKind = "missing" | "altered" | "extra";

export interface LexClauseDeviation {
  kind: LexClauseDeviationKind | string;
  clause_type: LexClauseType | string;
  title: string;
  required: boolean;
  similarity?: number | null;
  threshold?: number | null;
  risk_weight: number;
  severity: LexRiskLevel | string;
  // contract_clause_id is the stored contract-clause id the deviation refers to,
  // for deep-linking into the contract clause viewer (WTQ-RSK-02 #5). Set for
  // ALTERED/EXTRA deviations backed by a persisted clause row; null/absent for
  // MISSING deviations and live document extractions with no persisted row.
  contract_clause_id?: string | null;
  section_reference?: string | null;
  expected_excerpt?: string;
  actual_excerpt?: string;
  message: string;
}

export interface LexClauseDeviationReport {
  contract_id: string;
  playbook_id: string;
  playbook_name: string;
  contract_type: LexContractType | string;
  matched: boolean;
  reason: string;
  threshold: number;
  total_standard_clauses: number;
  missing_count: number;
  altered_count: number;
  extra_count: number;
  compliance_score: number;
  deviations: LexClauseDeviation[];
  generated_at: string;
}

// LexDeviationFilters are the optional clause-deviation report filters (WTQ-RSK-02
// #4). severity/kind are CSV strings (server-validated): severity tokens are one of
// low|medium|high|critical, kind tokens are one of missing|altered|extra.
export interface LexDeviationFilters {
  severity?: string;
  kind?: string;
  required_only?: boolean;
}

// LexPlaybookPortfolioRow is one contract's compliance summary against its matched
// active playbook for the portfolio view (WTQ-RSK-02 #2). Only contracts with a
// matched active playbook are returned.
export interface LexPlaybookPortfolioRow {
  contract_id: string;
  contract_title: string;
  contract_type: LexContractType | string;
  playbook_id: string;
  playbook_name: string;
  compliance_score: number;
  missing_count: number;
  altered_count: number;
  extra_count: number;
  generated_at: string;
}

// LexPlaybookPortfolioResult is the portfolio endpoint's non-standard envelope: a
// paginated page of rows PLUS a `truncated` flag indicating the candidate scan was
// capped server-side (service.PortfolioMaxScan) so the FE can warn / narrow filters.
export interface LexPlaybookPortfolioResult {
  data: LexPlaybookPortfolioRow[];
  page: number;
  per_page: number;
  total: number;
  truncated: boolean;
}

// LexPlaybookPortfolioParams are the portfolio filter/sort/page options (WTQ-RSK-02
// #2). order sorts the returned page by compliance_score (asc|desc).
export interface LexPlaybookPortfolioParams {
  contract_type?: string;
  min_score?: number;
  max_score?: number;
  order?: "asc" | "desc";
  page?: number;
  per_page?: number;
}

// LexDeviationReviewStatus enumerates the triage dispositions of a clause deviation
// (WTQ-RSK-02 #3).
export type LexDeviationReviewStatus =
  | "open"
  | "accepted"
  | "rejected"
  | "needs_fix";

// LexDeviationReview is a reviewer's triage disposition of a per-clause-type
// deviation on a contract (WTQ-RSK-02 #3). At most one row per
// (tenant, contract, clause_type); upserted in place.
export interface LexDeviationReview {
  id: string;
  tenant_id: string;
  contract_id: string;
  clause_type: LexClauseType | string;
  status: LexDeviationReviewStatus;
  note: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

// LexUpsertDeviationReviewPayload is the body for upserting a deviation triage
// disposition (WTQ-RSK-02 #3).
export interface LexUpsertDeviationReviewPayload {
  status: LexDeviationReviewStatus;
  note?: string;
}

// LexDryRunPlaybookPayload tests a draft/edited (unsaved) playbook clause set, or a
// saved playbook by id, against a contract WITHOUT it being the active playbook
// (WTQ-RSK-02 #8). playbook_id wins over clauses when both are supplied;
// contract_type defaults to the contract's own type when blank; threshold (0..1)
// overrides the detector default.
export interface LexDryRunPlaybookPayload {
  contract_id: string;
  clauses?: LexPlaybookClause[];
  contract_type?: LexContractType | string;
  threshold?: number;
  playbook_id?: string;
}

// LexPlaybookTemplate is one entry in the static playbook template library
// (WTQ-RSK-02 #7).
export interface LexPlaybookTemplate {
  key: string;
  name: string;
  description: string;
  contract_type: LexContractType | string;
  clauses: LexPlaybookClause[];
}

// LexClonePlaybookPayload is the optional body for cloning a template or playbook
// (WTQ-RSK-02 #7). name overrides the default clone name when non-empty.
export interface LexClonePlaybookPayload {
  name?: string;
}

export type VisusDashboardVisibility =
  | "private"
  | "team"
  | "organization"
  | "public";

export interface VisusWidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type VisusWidgetType =
  | "kpi_card"
  | "line_chart"
  | "bar_chart"
  | "area_chart"
  | "pie_chart"
  | "gauge"
  | "table"
  | "alert_feed"
  | "text"
  | "sparkline"
  | "heatmap"
  | "status_grid"
  | "trend_indicator";

export interface VisusWidget {
  id: string;
  tenant_id: string;
  dashboard_id: string;
  title: string;
  subtitle?: string | null;
  type: VisusWidgetType;
  config: JsonObject;
  position: VisusWidgetPosition;
  refresh_interval_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface VisusDashboard {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  grid_columns: number;
  visibility: VisusDashboardVisibility;
  shared_with: string[];
  is_default: boolean;
  is_system: boolean;
  tags: string[];
  metadata: JsonObject;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  widgets?: VisusWidget[];
  widget_count?: number;
}

export type VisusKPICategory =
  | "security"
  | "data"
  | "governance"
  | "legal"
  | "operations"
  | "general";

export type VisusKPISuite =
  | "cyber"
  | "data"
  | "acta"
  | "lex"
  | "platform"
  | "custom";
export type VisusKPIUnit =
  | "count"
  | "percentage"
  | "hours"
  | "minutes"
  | "score"
  | "currency"
  | "ratio"
  | "bytes";
export type VisusKPIDirection = "higher_is_better" | "lower_is_better";
export type VisusKPICalculationType =
  | "direct"
  | "delta"
  | "percentage_change"
  | "average_over_period"
  | "sum_over_period";
export type VisusKPISnapshotFrequency =
  | "every_15m"
  | "hourly"
  | "every_4h"
  | "daily"
  | "weekly";
export type VisusKPIStatus = "normal" | "warning" | "critical" | "unknown";

export interface VisusKPISnapshot {
  id: string;
  tenant_id: string;
  kpi_id: string;
  value: number;
  previous_value?: number | null;
  delta?: number | null;
  delta_percent?: number | null;
  status: VisusKPIStatus;
  period_start: string;
  period_end: string;
  fetch_success: boolean;
  fetch_latency_ms?: number | null;
  fetch_error?: string | null;
  created_at: string;
}

export interface VisusKPIDefinition {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: VisusKPICategory;
  suite: VisusKPISuite;
  icon?: string | null;
  query_endpoint: string;
  query_params: JsonObject;
  value_path: string;
  unit: VisusKPIUnit;
  format_pattern?: string | null;
  target_value?: number | null;
  warning_threshold?: number | null;
  critical_threshold?: number | null;
  direction: VisusKPIDirection;
  calculation_type: VisusKPICalculationType;
  calculation_window?: string | null;
  snapshot_frequency: VisusKPISnapshotFrequency;
  enabled: boolean;
  is_default: boolean;
  last_snapshot_at?: string | null;
  last_value?: number | null;
  last_status?: VisusKPIStatus | null;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  latest_snapshot?: VisusKPISnapshot | null;
}

export interface VisusKPIGetResponse {
  definition: VisusKPIDefinition;
  history: VisusKPISnapshot[];
}

export type VisusReportType =
  | "executive_summary"
  | "security_posture"
  | "data_intelligence"
  | "governance"
  | "legal"
  | "custom";

export interface VisusReportDefinition {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  report_type: VisusReportType;
  sections: string[];
  period: string;
  custom_period_start?: string | null;
  custom_period_end?: string | null;
  schedule?: string | null;
  next_run_at?: string | null;
  recipients: string[];
  auto_send: boolean;
  last_generated_at?: string | null;
  total_generated: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type VisusReportFileFormat = "json" | "pdf" | "html";

export interface VisusReportSnapshot {
  id: string;
  tenant_id: string;
  report_id: string;
  report_data: JsonObject;
  narrative?: string | null;
  file_id?: string | null;
  file_format: VisusReportFileFormat;
  period_start: string;
  period_end: string;
  sections_included: string[];
  generation_time_ms?: number | null;
  suite_fetch_errors: Record<string, string>;
  generated_by?: string | null;
  generated_at: string;
}

export type VisusAlertCategory =
  | "risk"
  | "compliance"
  | "data_quality"
  | "governance"
  | "legal"
  | "operational"
  | "financial"
  | "strategic";

export type VisusAlertSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";
export type VisusAlertStatus =
  | "new"
  | "viewed"
  | "acknowledged"
  | "actioned"
  | "dismissed"
  | "escalated";

export interface VisusExecutiveAlert {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  category: VisusAlertCategory;
  severity: VisusAlertSeverity;
  source_suite: string;
  source_type: string;
  source_entity_id?: string | null;
  source_event_type?: string | null;
  status: VisusAlertStatus;
  viewed_at?: string | null;
  viewed_by?: string | null;
  actioned_at?: string | null;
  actioned_by?: string | null;
  action_notes?: string | null;
  dismissed_at?: string | null;
  dismissed_by?: string | null;
  dismiss_reason?: string | null;
  dedup_key?: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  linked_kpi_id?: string | null;
  linked_dashboard_id?: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface VisusAlertStats {
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  total: number;
}

export interface VisusSuiteStatus {
  available: boolean;
  last_success: string;
  latency_ms: number;
  error?: string | null;
}

export interface VisusExecutiveSummary {
  cyber_security?: JsonObject | null;
  data_intelligence?: JsonObject | null;
  governance?: JsonObject | null;
  legal?: JsonObject | null;
  kpis: VisusKPISnapshot[];
  alerts: VisusExecutiveAlert[];
  suite_health: Record<string, VisusSuiteStatus>;
  generated_at: string;
  cache_status: Record<string, string>;
}

export interface VisusWidgetTypeDefinition {
  type: VisusWidgetType;
  schema: JsonObject;
}

export interface VisusKpiCardWidgetData {
  value: number;
  status: VisusKPIStatus;
  trend: Array<{ at: string; value: number }>;
  target?: number | null;
  unit?: string | null;
  delta?: number | null;
  delta_percent?: number | null;
}

export interface VisusGaugeWidgetData {
  value: number;
  min: number;
  max: number;
  thresholds: {
    warning?: number | null;
    critical?: number | null;
  };
  status: VisusKPIStatus;
}

export interface VisusSparklineWidgetData {
  values: number[];
  min: number;
  max: number;
  current: number;
  trend_direction: "up" | "down" | "flat";
}

export interface VisusTrendIndicatorWidgetData {
  value: number;
  direction: "up" | "down" | "flat";
  change_percent: number;
  periods: VisusKPISnapshot[];
}

export interface VisusAlertFeedWidgetData {
  alerts: VisusExecutiveAlert[];
}

export interface VisusSeriesPoint {
  x: string;
  y: number;
}

export interface VisusSeries {
  name: string;
  data: VisusSeriesPoint[] | number[];
}

export interface VisusSeriesWidgetData {
  series: VisusSeries[];
  x_label?: string;
  y_label?: string;
  categories?: Array<string | number>;
}

export interface VisusPieWidgetData {
  slices: Array<{ label: string; value: number; color: string }>;
}

export interface VisusTableWidgetData {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, JsonValue>>;
  total_count: number;
}

export interface VisusHeatmapWidgetData {
  cells: Array<{ x: string; y: string; value: number }>;
  x_labels: string[];
  y_labels: string[];
}

export interface VisusStatusGridWidgetData {
  items: Array<{
    label: string;
    status: string;
    value: number | string;
    unit?: string | null;
  }>;
}

export interface VisusTextWidgetData {
  content: string;
}

export type VisusWidgetData =
  | VisusKpiCardWidgetData
  | VisusGaugeWidgetData
  | VisusSparklineWidgetData
  | VisusTrendIndicatorWidgetData
  | VisusAlertFeedWidgetData
  | VisusSeriesWidgetData
  | VisusPieWidgetData
  | VisusTableWidgetData
  | VisusHeatmapWidgetData
  | VisusStatusGridWidgetData
  | VisusTextWidgetData;

export type ActaMeetingMinute = ActaMeetingMinutes;
export type LexContract = LexContractRecord;
export type VisusReport = VisusReportDefinition;
export type VisusReportGeneration = VisusReportSnapshot;
export type ComplianceDashboard = LexComplianceDashboard;
export type ComplianceRule = LexComplianceRule;

export interface ComplianceCheckResult {
  rule_id: string;
  rule_name: string;
  severity: string;
  status: string;
  message: string;
  alert_id?: string | null;
}
