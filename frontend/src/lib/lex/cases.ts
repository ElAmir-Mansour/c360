/**
 * Litigation Cases API client + domain types for the lex/Watheeq legal-affairs
 * console (CAP-032..076).
 *
 * This module is the typed HTTP surface for the first-class litigation case
 * aggregate and its plaintiff/defendant sub-flows. It calls the real backend at
 * `/api/v1/lex/...` through the shared axios instance (baseURL = gateway :8080)
 * via the `fetchSuiteData` / `fetchSuitePaginated` envelope helpers and the
 * `apiPost`/`apiPut`/`apiDelete` mutation helpers (which unwrap the `{data}`
 * envelope through `.then(res => res.data)`).
 *
 * Types mirror the Go DTOs/models in `backend/internal/lex` (legal_case,
 * case_classification, litigation pleading/expert/judgment/defendant). Author-
 * facing bilingual labels arrive as `LocalizedText {ar,en}`; resolve them in the
 * UI with `resolveLocalized`.
 */

import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { FetchParams } from '@/types/table';
import type { PaginatedResponse } from '@/types/api';
import type { LocalizedText } from '@/types/forms';
import type { JsonObject, LexDocument, LexDocumentVersion } from '@/types/suites';
import {
  cancelPleadingGeneration,
  getPleadingGeneration,
  resumePleadingGeneration,
  retryPleadingGeneration,
  startPleadingGeneration,
} from './pleading-generation';
export type {
  PleadingGenerationState,
  PleadingGenerationStatus,
  PleadingGenerationStreamHandlers,
  StartPleadingGenerationPayload,
} from './pleading-generation';

const BASE = '/api/v1/lex';

/* ------------------------------------------------------------------------- *
 * Enums (mirroring backend model constants)
 * ------------------------------------------------------------------------- */

export type CaseCompanyStatus = 'plaintiff' | 'defendant';
export type CaseStrength = 'strong' | 'weak';
/** Graded litigation-risk band (Othaim PRD 8.2). `none` is intentionally excluded:
 * an assessed case is always low+, an unassessed case has a null rating. */
export type CaseRiskRating = 'low' | 'medium' | 'high' | 'critical';
export type CaseStatus =
  | 'intake'
  | 'phase1'
  | 'phase2'
  | 'open'
  | 'under_procedure'
  | 'on_hold'
  | 'closed'
  | 'cancelled';
export type LegalPriority = 'critical' | 'high' | 'medium' | 'low';
export type DelayCategory = 'court' | 'government' | 'department' | 'expert';
export type LegalDocumentType =
  | 'policy'
  | 'regulation'
  | 'template'
  | 'memo'
  | 'opinion'
  | 'filing'
  | 'correspondence'
  | 'resolution'
  | 'power_of_attorney'
  | 'other';
export type DocumentConfidentiality = 'public' | 'internal' | 'confidential' | 'privileged';
export type CasePartyRole =
  | 'plaintiff'
  | 'defendant'
  | 'lawyer'
  | 'witness'
  | 'expert'
  | 'other';
export type CaseTaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type PleadingType =
  | 'statement_of_claim'
  | 'reply'
  | 'brief'
  | 'memorandum'
  | 'motion'
  | 'petition'
  | 'appeal'
  | 'notice'
  | 'request'
  | 'other';
export type PleadingStatus = 'draft' | 'in_approval' | 'approved' | 'rejected' | 'filed';
export type PleadingDirection = 'incoming' | 'outgoing' | 'internal';
export type EvidenceStatus = 'pending' | 'submitted' | 'admitted' | 'rejected' | 'withdrawn';
export type JudgmentImpact = 'positive' | 'negative' | 'neutral' | 'mixed';
export type HearingReportType = 'minutes' | 'decision' | 'report';
export type ExpertAssignmentStatus =
  | 'requested'
  | 'appointed'
  | 'report_received'
  | 'closed'
  | 'cancelled';
export type JudgmentRecommendation = 'pending' | 'object' | 'accept';
export type JudgmentOutcome = 'won' | 'lost' | 'partial' | 'other';
export type DefendantCaseStatus =
  | 'registered'
  | 'notified_dept'
  | 'response_drafting'
  | 'response_in_review'
  | 'response_approved'
  | 'response_rejected'
  | 'closed'
  | 'cancelled';
export type NajizSyncStatus = 'manual' | 'synced' | 'failed';
export type CaseMilestoneType =
  | 'filing'
  | 'hearing'
  | 'submission'
  | 'decision'
  | 'deadline'
  | 'custom';
export type CaseMilestoneStatus = 'planned' | 'completed' | 'cancelled';
export type HearingSessionStatus =
  | 'scheduled'
  | 'upcoming'
  | 'completed'
  | 'adjourned'
  | 'cancelled';

export interface CaseHearingMetadata extends Record<string, unknown> {
  session_number?: number | null;
  title?: string | null;
  agenda?: string | null;
  chamber?: string | null;
  presiding_judge?: string | null;
  presiding_judge_title?: string | null;
  attendees?: string[];
  attendee_names?: string[];
  status?: HearingSessionStatus | null;
  duration_minutes?: number | null;
}

export interface CaseDocumentMetadata extends Record<string, unknown> {
  evidence_category?: string | null;
  court_reference?: string | null;
  admission_status?: 'pending' | 'admitted' | 'rejected' | null;
  strength_score?: number | null;
}

export interface PleadingMetadata extends Record<string, unknown> {
  direction?: 'incoming' | 'outgoing' | null;
  recipient?: string | null;
  court_reference?: string | null;
  response_deadline?: string | null;
  filing_type?: string | null;
}

export interface JudgmentMetadata extends Record<string, unknown> {
  ruling_type?: string | null;
  impact?: string | null;
  court?: string | null;
  judge?: string | null;
  implications?: string | null;
  attachments?: Array<{ file_id?: string | null; file_name: string }>;
  trajectory?: string | null;
}

/* ------------------------------------------------------------------------- *
 * Core aggregate types
 * ------------------------------------------------------------------------- */

export interface CaseParty {
  id: string;
  case_id: string;
  role: CasePartyRole;
  name: string;
  identifier?: string | null;
  contact?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CaseHearing {
  id: string;
  case_id: string;
  hearing_date: string;
  location?: string | null;
  notes: string;
  decision?: string | null;
  metadata?: CaseHearingMetadata | null;
  created_at: string;
  updated_at: string;
}

export interface CaseTask {
  id: string;
  case_id: string;
  title: string;
  assignee_id?: string | null;
  priority: LegalPriority;
  status: CaseTaskStatus;
  due_date?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Tenant-maintained competent-court reference used by case intake. */
export interface LegalCourt {
  id: string;
  tenant_id: string;
  code: string;
  name: LocalizedText;
  active: boolean;
  is_system: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface LegalCase {
  id: string;
  tenant_id: string;
  case_number: string;
  court_number?: string | null;
  case_type: string;
  other_case_type?: string | null;
  classification_id?: string | null;
  company_status: CaseCompanyStatus;
  competent_court?: string | null;
  chamber?: string | null;
  filing_date?: string | null;
  claim_amount?: number | null;
  court_fees?: number | null;
  legal_fees?: number | null;
  currency?: string | null;
  expected_resolution_date?: string | null;
  title: LocalizedText;
  description: string;
  strength?: CaseStrength | null;
  risk_rating?: CaseRiskRating | null;
  risk_likelihood?: number | null;
  risk_impact?: number | null;
  risk_exposure_value?: number | null;
  risk_exposure_currency?: string | null;
  risk_rationale?: string | null;
  risk_assessed_by?: string | null;
  risk_assessed_at?: string | null;
  status: CaseStatus;
  priority: LegalPriority;
  section_manager_id?: string | null;
  supervisor_id?: string | null;
  handling_officer_id?: string | null;
  responsible_lawyer?: string | null;
  department?: string | null;
  contract_id?: string | null;
  request_id?: string | null;
  court_id?: string | null;
  court?: LegalCourt | null;
  workflow_instance_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  sla_turnaround_due_at?: string | null;
  late_justification?: string | null;
  late_justification_submitted_by?: string | null;
  late_justification_submitted_at?: string | null;
  parties?: CaseParty[];
  hearings?: CaseHearing[];
  tasks?: CaseTask[];
}

/**
 * One row returned by `GET /legal-cases`.
 *
 * The list endpoint augments the legal-case aggregate with the two computed
 * values its table/dashboard consumers need. Keep this separate from
 * `LegalCase`: detail responses expose their operational aggregates under a
 * different `computed` block, while list responses return these fields at the
 * row root.
 */
export interface LegalCaseListItem extends LegalCase {
  next_hearing_date: string | null;
  sla_turnaround_due_at: string | null;
  party_count: number;
}

export interface LegalCaseDetail extends LegalCase {
  computed: {
    sla_outcome: string | null;
    sla_turnaround_due_at: string | null;
    days_open: number | null;
    next_hearing_date: string | null;
    escalation_level: number;
    open_task_count: number;
  };
}

export interface LegalCaseAuditEntry {
  id: string;
  case_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  detail?: Record<string, unknown> | null;
  actor_user_id: string;
  created_at: string;
}

export interface LegalCaseVersion {
  id: string;
  case_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  change_reason: string;
  created_by?: string | null;
  created_at: string;
}

export interface CaseComment {
  id: string;
  tenant_id: string;
  case_id: string;
  body: string;
  mentions: string[];
  metadata?: Record<string, unknown> | null;
  created_by: string;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseDocumentLink {
  id: string;
  tenant_id: string;
  case_id: string;
  document_id: string;
  source: string;
  category?: string | null;
  notes: string;
  evidence_status?: EvidenceStatus | null;
  court_reference?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  metadata?: CaseDocumentMetadata | null;
  created_by: string;
  created_at: string;
  document?: LexDocument | null;
}

export interface CaseIntake {
  id: string;
  tenant_id: string;
  case_id: string;
  phase: 'phase1' | 'phase2' | 'complete';
  phase1_started_at?: string | null;
  phase1_completed_at?: string | null;
  phase2_started_at?: string | null;
  phase2_completed_at?: string | null;
  ceo_directive_ref?: string | null;
  doa_authority_ref?: string | null;
  strength_assessment?: CaseStrength | null;
  task_estimate?: string | null;
  workflow_instance_id?: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------------- *
 * Classification taxonomy
 * ------------------------------------------------------------------------- */

export interface CaseClassification {
  id: string;
  parent_id?: string | null;
  code: string;
  name: LocalizedText;
  path: string[];
  is_system: boolean;
  active: boolean;
  sort: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  children?: CaseClassification[];
}

export interface CaseClassificationCascade {
  classification_id: string;
  code: string;
  name: LocalizedText;
  resolved_at: string;
  chain: CaseClassification[];
}

/* ------------------------------------------------------------------------- *
 * Plaintiff: pleadings (statement-of-claim), hearing reports, experts, judgments
 * ------------------------------------------------------------------------- */

export interface LegalPleadingAttachment {
  id: string;
  pleading_id: string;
  file_id?: string | null;
  file_name: string;
  caption: string;
  created_at: string;
}

export interface LegalPleadingVersion {
  id: string;
  pleading_id: string;
  version: number;
  body: string;
  change_reason?: string;
  created_at: string;
  [key: string]: unknown;
}

export interface LegalPleading {
  id: string;
  case_id: string;
  pleading_number: string;
  type: PleadingType;
  title: string;
  body: string;
  direction?: PleadingDirection | null;
  recipient?: string | null;
  court_reference?: string | null;
  response_deadline?: string | null;
  response_owner_id?: string | null;
  status: PleadingStatus;
  ai_generated: boolean;
  current_version: number;
  workflow_instance_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  filed_at?: string | null;
  metadata?: PleadingMetadata | null;
  created_at: string;
  updated_at: string;
  attachments?: LegalPleadingAttachment[];
  versions?: LegalPleadingVersion[];
}

export interface CaseHearingReport {
  id: string;
  case_id: string;
  hearing_id: string;
  type: HearingReportType;
  title: string;
  body: string;
  decision: string;
  recorded_at?: string | null;
  file_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LegalExpertDocument {
  id: string;
  assignment_id: string;
  file_id?: string | null;
  file_name: string;
  caption: string;
  created_at: string;
}

export interface LegalExpertAssignment {
  id: string;
  case_id: string;
  expert_name: string;
  specialization: string;
  contact_info?: string | null;
  mandate: string;
  status: ExpertAssignmentStatus;
  appointed_at?: string | null;
  report_due_date?: string | null;
  report_received_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  documents?: LegalExpertDocument[];
}

export interface LegalJudgment {
  id: string;
  case_id: string;
  judgment_ref: string;
  judgment_date?: string | null;
  outcome?: JudgmentOutcome | null;
  decision_type?: string | null;
  impact?: JudgmentImpact | null;
  judge_name?: string | null;
  court_name?: string | null;
  implications?: string | null;
  document_reference?: string | null;
  next_expected_ruling_at?: string | null;
  next_expected_ruling?: string | null;
  summary: string;
  study_notes: string;
  recommendation: JudgmentRecommendation;
  objection_deadline?: string | null;
  obligation_id?: string | null;
  studied_by?: string | null;
  studied_at?: string | null;
  file_id?: string | null;
  metadata?: JudgmentMetadata | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------------- *
 * Defendant: incoming-lawsuit register, Najiz rep, first-response memo
 * ------------------------------------------------------------------------- */

export interface LegalDefendantAttachment {
  id: string;
  defendant_case_id: string;
  file_id?: string | null;
  file_name: string;
  caption: string;
  kind?: string;
  created_at: string;
}

export interface LegalDefendantCase {
  id: string;
  case_id: string;
  plaintiff_name: string;
  court_name?: string | null;
  notification_date?: string | null;
  company_representative?: string | null;
  najiz_status: NajizSyncStatus;
  najiz_reference?: string | null;
  concerned_department?: string | null;
  dept_notified_at?: string | null;
  response_memo: string;
  response_memo_ai: boolean;
  status: DefendantCaseStatus;
  workflow_instance_id?: string | null;
  response_approved_by?: string | null;
  response_approved_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  attachments?: LegalDefendantAttachment[];
}

export interface CaseMilestone {
  id: string;
  tenant_id?: string;
  case_id: string;
  title: string;
  description: string;
  milestone_type: CaseMilestoneType;
  status: CaseMilestoneStatus;
  milestone_date: string;
  completed_at?: string | null;
  owner_id?: string | null;
  source?: string | null;
  source_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------------- *
 * Request payloads
 * ------------------------------------------------------------------------- */

export interface CreateLegalCasePayload {
  case_number?: string | null;
  court_number?: string | null;
  case_type: string;
  classification_id?: string | null;
  company_status: CaseCompanyStatus;
  competent_court?: string | null;
  chamber?: string | null;
  filing_date?: string | null;
  claim_amount?: number | null;
  court_fees?: number | null;
  legal_fees?: number | null;
  currency?: string | null;
  expected_resolution_date?: string | null;
  title: LocalizedText;
  description: string;
  strength?: CaseStrength | null;
  status?: CaseStatus;
  priority?: LegalPriority;
  responsible_lawyer?: string | null;
  department?: string | null;
  contract_id?: string | null;
  request_id?: string | null;
  court_id?: string | null;
  other_case_type?: string | null;
  /** Explicit nullable-column clears for partial updates; ignored on create. */
  cleared_fields?: string[];
  metadata?: Record<string, unknown>;
}

export type UpdateLegalCasePayload = Partial<CreateLegalCasePayload>;

export interface UpdateCaseStatusPayload {
  status: CaseStatus;
  reason: string;
  category?: DelayCategory | null;
  late_justification?: string;
}

export interface SetCaseStrengthPayload {
  strength: CaseStrength;
  reason: string;
}

/** Othaim PRD 8.2 payload: record the graded case risk rating. Supply `rating`
 * directly, or both `likelihood` and `impact` (1–5) to derive the band. */
export interface SetCaseRiskRatingPayload {
  rating?: CaseRiskRating;
  likelihood?: number;
  impact?: number;
  exposure_value?: number;
  exposure_currency?: string;
  reason: string;
}

export interface SetCasePriorityPayload {
  priority: LegalPriority;
  reason: string;
}

/** CAP-037 work-allocation payload: transfer the case to a section manager. */
export interface TransferSectionManagerPayload {
  section_manager_id: string;
  reason: string;
}

/** CAP-038 work-allocation payload: assign the case supervisor. */
export interface AssignCaseSupervisorPayload {
  supervisor_id: string;
  reason: string;
}

/** Dedicated CAP-039 work-allocation payload (kept separate from case edits). */
export interface AssignCaseOfficerPayload {
  handling_officer_id: string;
  reason: string;
}

export interface StartCaseIntakePayload {
  ceo_directive_ref?: string | null;
  doa_authority_ref?: string | null;
  strength_assessment?: CaseStrength | null;
  metadata?: Record<string, unknown>;
}

export interface CreateCasePartyPayload {
  role: CasePartyRole;
  name: string;
  identifier?: string | null;
  contact?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateCaseHearingPayload {
  hearing_date: string;
  location?: string | null;
  notes: string;
  decision?: string | null;
  metadata?: CaseHearingMetadata;
}

export interface CreateCaseTaskPayload {
  title: string;
  assignee_id?: string | null;
  priority: LegalPriority;
  status: CaseTaskStatus;
  due_date?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateCaseClassificationPayload {
  parent_id?: string | null;
  code: string;
  name: LocalizedText;
  active?: boolean;
  sort?: number;
  metadata?: Record<string, unknown>;
}

export interface CreatePleadingPayload {
  type: PleadingType;
  title: string;
  body: string;
  direction?: PleadingDirection | null;
  recipient?: string | null;
  court_reference?: string | null;
  response_deadline?: string | null;
  response_owner_id?: string | null;
  generate_body?: boolean;
  language?: string;
  draft_prompt?: string;
  metadata?: PleadingMetadata;
}

export interface UpdatePleadingPayload {
  title?: string;
  body?: string;
  direction?: PleadingDirection | null;
  recipient?: string | null;
  court_reference?: string | null;
  response_deadline?: string | null;
  response_owner_id?: string | null;
  change_reason?: string;
  metadata?: PleadingMetadata;
}

export interface CreateHearingReportPayload {
  type: HearingReportType;
  title: string;
  body: string;
  decision?: string;
  recorded_at?: string | null;
  file_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateExpertAssignmentPayload {
  expert_name: string;
  specialization: string;
  contact_info?: string | null;
  mandate: string;
  report_due_date?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateExpertAssignmentPayload extends Partial<CreateExpertAssignmentPayload> {
  status?: ExpertAssignmentStatus;
  appointed_at?: string | null;
  report_received_at?: string | null;
}

export interface CreateJudgmentPayload {
  judgment_ref: string;
  judgment_date?: string | null;
  outcome?: JudgmentOutcome | null;
  decision_type?: string | null;
  impact?: JudgmentImpact | null;
  judge_name?: string | null;
  court_name?: string | null;
  implications?: string | null;
  summary: string;
  file_id?: string | null;
  document_reference?: string | null;
  next_expected_ruling_at?: string | null;
  next_expected_ruling?: string | null;
  metadata?: JudgmentMetadata;
}

export interface StudyJudgmentPayload {
  study_notes: string;
  recommendation: JudgmentRecommendation;
  objection_deadline?: string | null;
  owner_user_id?: string | null;
  owner_name?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterDefendantCasePayload {
  plaintiff_name: string;
  court_name?: string | null;
  notification_date?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SetNajizRepresentativePayload {
  company_representative: string;
  najiz_status: NajizSyncStatus;
  najiz_reference?: string | null;
}

export interface NotifyDepartmentPayload {
  concerned_department: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface DraftResponseMemoPayload {
  body: string;
  generate_body?: boolean;
  language?: string;
  draft_prompt?: string;
}

export interface CreateCaseRepositoryDocumentPayload {
  title: string;
  type: LegalDocumentType;
  description: string;
  category?: string | null;
  confidentiality?: DocumentConfidentiality;
  status?: string;
  tags?: string[];
  metadata?: JsonObject;
}

export interface CreateCaseCommentPayload {
  body: string;
  mentions?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateCaseDocumentLinkPayload {
  document_id?: string;
  title?: string;
  type?: LegalDocumentType;
  description?: string;
  category?: string | null;
  confidentiality?: DocumentConfidentiality;
  tags?: string[];
  document_metadata?: JsonObject;
  document?: CaseFileReferencePayload;
  source?: string;
  notes?: string;
  evidence_status?: EvidenceStatus | null;
  court_reference?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  metadata?: CaseDocumentMetadata;
}

export interface CaseFileReferencePayload {
  file_id: string;
  file_name: string;
  file_size_bytes: number;
  content_hash: string;
  extracted_text?: string;
  change_summary?: string;
}

export interface CreateCaseMilestonePayload {
  title: string;
  description: string;
  milestone_type: CaseMilestoneType;
  status?: CaseMilestoneStatus;
  milestone_date: string;
  completed_at?: string | null;
  owner_id?: string | null;
  source?: string | null;
  source_reference?: string | null;
  metadata?: Record<string, unknown>;
}

export type UpdateCaseMilestonePayload = Partial<CreateCaseMilestonePayload>;

/* ------------------------------------------------------------------------- *
 * API surface
 * ------------------------------------------------------------------------- */

export const casesApi = {
  // ----- Cases -----
  listCases: (params: FetchParams): Promise<PaginatedResponse<LegalCaseListItem>> =>
    fetchSuitePaginated<LegalCaseListItem>(`${BASE}/legal-cases`, params),
  getCase: (id: string): Promise<LegalCaseDetail> => fetchSuiteData(`${BASE}/legal-cases/${id}`),
  createCase: (payload: CreateLegalCasePayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases`, payload).then((res) => res.data),
  updateCase: (id: string, payload: UpdateLegalCasePayload): Promise<LegalCase> =>
    apiPut<{ data: LegalCase }>(`${BASE}/legal-cases/${id}`, payload).then((res) => res.data),
  deleteCase: (id: string): Promise<void> => apiDelete<void>(`${BASE}/legal-cases/${id}`),
  updateCaseStatus: (id: string, payload: UpdateCaseStatusPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/status`, payload).then((res) => res.data),
  setCaseStrength: (id: string, payload: SetCaseStrengthPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/strength`, payload).then((res) => res.data),
  setCaseRiskRating: (id: string, payload: SetCaseRiskRatingPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/risk-rating`, payload).then((res) => res.data),
  setCasePriority: (id: string, payload: SetCasePriorityPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/priority`, payload).then((res) => res.data),
  transferSectionManager: (id: string, payload: TransferSectionManagerPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/transfer-section-manager`, payload).then(
      (res) => res.data,
    ),
  assignSupervisor: (id: string, payload: AssignCaseSupervisorPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/assign-supervisor`, payload).then((res) => res.data),
  assignOfficer: (id: string, payload: AssignCaseOfficerPayload): Promise<LegalCase> =>
    apiPost<{ data: LegalCase }>(`${BASE}/legal-cases/${id}/assign-officer`, payload).then((res) => res.data),

  listCaseAudit: (id: string): Promise<LegalCaseAuditEntry[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${id}/audit`),
  listCaseVersions: (id: string): Promise<LegalCaseVersion[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${id}/versions`),
  listMilestones: (id: string): Promise<CaseMilestone[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${id}/milestones`),
  createMilestone: (id: string, payload: CreateCaseMilestonePayload): Promise<CaseMilestone> =>
    apiPost<{ data: CaseMilestone }>(`${BASE}/legal-cases/${id}/milestones`, payload).then(
      (res) => res.data,
    ),
  updateMilestone: (
    id: string,
    milestoneId: string,
    payload: UpdateCaseMilestonePayload,
  ): Promise<CaseMilestone> =>
    apiPut<{ data: CaseMilestone }>(
      `${BASE}/legal-cases/${id}/milestones/${milestoneId}`,
      payload,
    ).then((res) => res.data),
  deleteMilestone: (id: string, milestoneId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${id}/milestones/${milestoneId}`),

  listComments: (id: string): Promise<CaseComment[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${id}/comments`),
  addComment: (id: string, payload: CreateCaseCommentPayload): Promise<CaseComment> =>
    apiPost<{ data: CaseComment }>(`${BASE}/legal-cases/${id}/comments`, payload).then((res) => res.data),
  updateComment: (
    id: string,
    commentId: string,
    payload: Partial<CreateCaseCommentPayload>,
  ): Promise<CaseComment> =>
    apiPut<{ data: CaseComment }>(`${BASE}/legal-cases/${id}/comments/${commentId}`, payload).then(
      (res) => res.data,
    ),
  deleteComment: (id: string, commentId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${id}/comments/${commentId}`),

  listCaseDocuments: (id: string): Promise<CaseDocumentLink[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${id}/documents`),
  addCaseDocument: (id: string, payload: CreateCaseDocumentLinkPayload): Promise<CaseDocumentLink> =>
    apiPost<{ data: CaseDocumentLink }>(`${BASE}/legal-cases/${id}/documents`, payload).then((res) => res.data),
  deleteCaseDocument: (id: string, documentLinkId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${id}/documents/${documentLinkId}`),
  updateCaseDocument: (
    id: string,
    documentLinkId: string,
    payload: Partial<CreateCaseDocumentLinkPayload>,
  ): Promise<CaseDocumentLink> =>
    apiPut<{ data: CaseDocumentLink }>(
      `${BASE}/legal-cases/${id}/documents/${documentLinkId}`,
      payload,
    ).then((res) => res.data),

  // ----- Intake (Phase-1 CEO directive + strength) -----
  getIntake: (id: string): Promise<CaseIntake | null> => fetchSuiteData(`${BASE}/legal-cases/${id}/intake`),
  startIntake: (id: string, payload: StartCaseIntakePayload): Promise<CaseIntake> =>
    apiPost<{ data: CaseIntake }>(`${BASE}/legal-cases/${id}/intake/start`, payload).then((res) => res.data),

  // ----- Parties -----
  addParty: (caseId: string, payload: CreateCasePartyPayload): Promise<CaseParty> =>
    apiPost<{ data: CaseParty }>(`${BASE}/legal-cases/${caseId}/parties`, payload).then((res) => res.data),
  updateParty: (
    caseId: string,
    partyId: string,
    payload: Partial<CreateCasePartyPayload>,
  ): Promise<CaseParty> =>
    apiPut<{ data: CaseParty }>(`${BASE}/legal-cases/${caseId}/parties/${partyId}`, payload).then(
      (res) => res.data,
    ),
  deleteParty: (caseId: string, partyId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/parties/${partyId}`),

  // ----- Hearings -----
  addHearing: (caseId: string, payload: CreateCaseHearingPayload): Promise<CaseHearing> =>
    apiPost<{ data: CaseHearing }>(`${BASE}/legal-cases/${caseId}/hearings`, payload).then(
      (res) => res.data,
    ),
  updateHearing: (
    caseId: string,
    hearingId: string,
    payload: Partial<CreateCaseHearingPayload>,
  ): Promise<CaseHearing> =>
    apiPut<{ data: CaseHearing }>(`${BASE}/legal-cases/${caseId}/hearings/${hearingId}`, payload).then(
      (res) => res.data,
    ),
  deleteHearing: (caseId: string, hearingId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/hearings/${hearingId}`),

  // ----- Tasks -----
  defineTask: (caseId: string, payload: CreateCaseTaskPayload): Promise<CaseTask> =>
    apiPost<{ data: CaseTask }>(`${BASE}/legal-cases/${caseId}/tasks`, payload).then((res) => res.data),
  updateTask: (
    caseId: string,
    taskId: string,
    payload: Partial<CreateCaseTaskPayload>,
  ): Promise<CaseTask> =>
    apiPut<{ data: CaseTask }>(`${BASE}/legal-cases/${caseId}/tasks/${taskId}`, payload).then(
      (res) => res.data,
    ),
  deleteTask: (caseId: string, taskId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/tasks/${taskId}`),

  // ----- Classifications (cascading taxonomy) -----
  listClassifications: (params: FetchParams): Promise<PaginatedResponse<CaseClassification>> =>
    fetchSuitePaginated<CaseClassification>(`${BASE}/case-classifications`, params),
  getClassificationTree: (): Promise<CaseClassification[]> =>
    fetchSuiteData(`${BASE}/case-classifications/tree`),
  listSelectableClassifications: (
    params: FetchParams,
  ): Promise<PaginatedResponse<CaseClassification>> =>
    fetchSuitePaginated<CaseClassification>(`${BASE}/case-classifications/selectable`, params),
  getClassificationCascade: (id: string): Promise<CaseClassificationCascade> =>
    fetchSuiteData(`${BASE}/case-classifications/${id}/cascade`),

  createClassification: (payload: CreateCaseClassificationPayload): Promise<CaseClassification> =>
    apiPost<{ data: CaseClassification }>(`${BASE}/case-classifications`, payload).then((res) => res.data),
  updateClassification: (
    id: string,
    payload: Partial<CreateCaseClassificationPayload>,
  ): Promise<CaseClassification> =>
    apiPut<{ data: CaseClassification }>(`${BASE}/case-classifications/${id}`, payload).then(
      (res) => res.data,
    ),
  deleteClassification: (id: string): Promise<void> =>
    apiDelete<void>(`${BASE}/case-classifications/${id}`),

  // ----- Tenant court catalogue -----
  listCourts: (params: FetchParams): Promise<PaginatedResponse<LegalCourt>> =>
    fetchSuitePaginated<LegalCourt>(`${BASE}/legal-courts`, params),

  // ----- Plaintiff: pleadings -----
  listPleadings: (caseId: string): Promise<LegalPleading[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/pleadings`),
  getPleading: (caseId: string, pleadingId: string): Promise<LegalPleading> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/pleadings/${pleadingId}`),
  createPleading: (caseId: string, payload: CreatePleadingPayload): Promise<LegalPleading> =>
    apiPost<{ data: LegalPleading }>(`${BASE}/legal-cases/${caseId}/pleadings`, payload).then(
      (res) => res.data,
    ),
  updatePleading: (
    caseId: string,
    pleadingId: string,
    payload: UpdatePleadingPayload,
  ): Promise<LegalPleading> =>
    apiPut<{ data: LegalPleading }>(
      `${BASE}/legal-cases/${caseId}/pleadings/${pleadingId}`,
      payload,
    ).then((res) => res.data),
  submitPleading: (caseId: string, pleadingId: string): Promise<LegalPleading> =>
    apiPost<{ data: LegalPleading }>(
      `${BASE}/legal-cases/${caseId}/pleadings/${pleadingId}/submit`,
    ).then((res) => res.data),
  filePleading: (
    caseId: string,
    pleadingId: string,
    payload: { filed_at?: string | null; note?: string },
  ): Promise<LegalPleading> =>
    apiPost<{ data: LegalPleading }>(
      `${BASE}/legal-cases/${caseId}/pleadings/${pleadingId}/file`,
      payload,
    ).then((res) => res.data),
  deletePleading: (caseId: string, pleadingId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/pleadings/${pleadingId}`),
  getPleadingGeneration,
  streamPleadingGeneration: startPleadingGeneration,
  retryPleadingGeneration,
  resumePleadingGeneration,
  cancelPleadingGeneration,

  // ----- Plaintiff: hearing reports / minutes -----
  listHearingReports: (caseId: string, hearingId: string): Promise<CaseHearingReport[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/hearings/${hearingId}/reports`),
  createHearingReport: (
    caseId: string,
    hearingId: string,
    payload: CreateHearingReportPayload,
  ): Promise<CaseHearingReport> =>
    apiPost<{ data: CaseHearingReport }>(
      `${BASE}/legal-cases/${caseId}/hearings/${hearingId}/reports`,
      payload,
    ).then((res) => res.data),
  deleteHearingReport: (caseId: string, hearingId: string, reportId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/hearings/${hearingId}/reports/${reportId}`),

  // ----- Plaintiff: experts -----
  listExperts: (caseId: string): Promise<LegalExpertAssignment[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/experts`),
  getExpert: (caseId: string, expertId: string): Promise<LegalExpertAssignment> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/experts/${expertId}`),
  createExpert: (caseId: string, payload: CreateExpertAssignmentPayload): Promise<LegalExpertAssignment> =>
    apiPost<{ data: LegalExpertAssignment }>(`${BASE}/legal-cases/${caseId}/experts`, payload).then(
      (res) => res.data,
    ),
  updateExpert: (
    caseId: string,
    expertId: string,
    payload: UpdateExpertAssignmentPayload,
  ): Promise<LegalExpertAssignment> =>
    apiPut<{ data: LegalExpertAssignment }>(
      `${BASE}/legal-cases/${caseId}/experts/${expertId}`,
      payload,
    ).then((res) => res.data),
  deleteExpert: (caseId: string, expertId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/experts/${expertId}`),

  // ----- Plaintiff: judgments + objection deadline -----
  listJudgments: (caseId: string): Promise<LegalJudgment[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/judgments`),
  getJudgment: (caseId: string, judgmentId: string): Promise<LegalJudgment> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/judgments/${judgmentId}`),
  createJudgment: (caseId: string, payload: CreateJudgmentPayload): Promise<LegalJudgment> =>
    apiPost<{ data: LegalJudgment }>(`${BASE}/legal-cases/${caseId}/judgments`, payload).then(
      (res) => res.data,
    ),
  studyJudgment: (
    caseId: string,
    judgmentId: string,
    payload: StudyJudgmentPayload,
  ): Promise<LegalJudgment> =>
    apiPost<{ data: LegalJudgment }>(
      `${BASE}/legal-cases/${caseId}/judgments/${judgmentId}/study`,
      payload,
    ).then((res) => res.data),
  deleteJudgment: (caseId: string, judgmentId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/judgments/${judgmentId}`),

  // ----- Defendant: incoming-lawsuit register, Najiz, response memo -----
  listDefendant: (caseId: string): Promise<LegalDefendantCase[]> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/defendant`),
  getDefendant: (caseId: string, defendantId: string): Promise<LegalDefendantCase> =>
    fetchSuiteData(`${BASE}/legal-cases/${caseId}/defendant/${defendantId}`),
  registerDefendant: (
    caseId: string,
    payload: RegisterDefendantCasePayload,
  ): Promise<LegalDefendantCase> =>
    apiPost<{ data: LegalDefendantCase }>(`${BASE}/legal-cases/${caseId}/defendant`, payload).then(
      (res) => res.data,
    ),
  updateDefendant: (
    caseId: string,
    defendantId: string,
    payload: Partial<RegisterDefendantCasePayload>,
  ): Promise<LegalDefendantCase> =>
    apiPut<{ data: LegalDefendantCase }>(
      `${BASE}/legal-cases/${caseId}/defendant/${defendantId}`,
      payload,
    ).then((res) => res.data),
  deleteDefendant: (caseId: string, defendantId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-cases/${caseId}/defendant/${defendantId}`),
  setNajizRepresentative: (
    caseId: string,
    defendantId: string,
    payload: SetNajizRepresentativePayload,
  ): Promise<LegalDefendantCase> =>
    apiPost<{ data: LegalDefendantCase }>(
      `${BASE}/legal-cases/${caseId}/defendant/${defendantId}/najiz`,
      payload,
    ).then((res) => res.data),
  notifyDepartment: (
    caseId: string,
    defendantId: string,
    payload: NotifyDepartmentPayload,
  ): Promise<LegalDefendantCase> =>
    apiPost<{ data: LegalDefendantCase }>(
      `${BASE}/legal-cases/${caseId}/defendant/${defendantId}/notify-department`,
      payload,
    ).then((res) => res.data),
  draftResponseMemo: (
    caseId: string,
    defendantId: string,
    payload: DraftResponseMemoPayload,
  ): Promise<LegalDefendantCase> =>
    apiPost<{ data: LegalDefendantCase }>(
      `${BASE}/legal-cases/${caseId}/defendant/${defendantId}/response-memo`,
      payload,
    ).then((res) => res.data),
  startResponseReview: (
    caseId: string,
    defendantId: string,
    payload: { supervisor_id?: string | null; section_manager_id?: string | null },
  ): Promise<LegalDefendantCase> =>
    apiPost<{ data: LegalDefendantCase }>(
      `${BASE}/legal-cases/${caseId}/defendant/${defendantId}/response-review`,
      payload,
    ).then((res) => res.data),

  // ----- Shared document repository -----
  listRepositoryDocuments: (params: FetchParams): Promise<PaginatedResponse<LexDocument>> =>
    fetchSuitePaginated<LexDocument>(`${BASE}/documents`, params),
  createRepositoryDocument: (payload: CreateCaseRepositoryDocumentPayload): Promise<LexDocument> =>
    apiPost<{ data: LexDocument }>(`${BASE}/documents`, payload).then((res) => res.data),
  listRepositoryDocumentVersions: (documentId: string): Promise<LexDocumentVersion[]> =>
    fetchSuiteData(`${BASE}/documents/${documentId}/versions`),
};

/* ------------------------------------------------------------------------- *
 * Enum option arrays (for select pickers + filter dropdowns)
 * ------------------------------------------------------------------------- */

export const CASE_COMPANY_STATUS_OPTIONS: readonly CaseCompanyStatus[] = [
  'plaintiff',
  'defendant',
] as const;

export const CASE_STATUS_OPTIONS: readonly CaseStatus[] = [
  'intake',
  'phase1',
  'phase2',
  'open',
  'under_procedure',
  'on_hold',
  'closed',
  'cancelled',
] as const;

export const CASE_STRENGTH_OPTIONS: readonly CaseStrength[] = ['strong', 'weak'] as const;

export const CASE_RISK_RATING_OPTIONS: readonly CaseRiskRating[] = [
  'critical',
  'high',
  'medium',
  'low',
] as const;

export const LEGAL_PRIORITY_OPTIONS: readonly LegalPriority[] = [
  'critical',
  'high',
  'medium',
  'low',
] as const;

export const CASE_PARTY_ROLE_OPTIONS: readonly CasePartyRole[] = [
  'plaintiff',
  'defendant',
  'lawyer',
  'witness',
  'expert',
  'other',
] as const;

export const CASE_TASK_STATUS_OPTIONS: readonly CaseTaskStatus[] = [
  'open',
  'in_progress',
  'done',
  'cancelled',
] as const;

export const PLEADING_TYPE_OPTIONS: readonly PleadingType[] = [
  'statement_of_claim',
  'reply',
  'brief',
  'memorandum',
  'motion',
  'petition',
  'appeal',
  'notice',
  'request',
  'other',
] as const;

export const HEARING_REPORT_TYPE_OPTIONS: readonly HearingReportType[] = [
  'minutes',
  'decision',
  'report',
] as const;

export const EXPERT_ASSIGNMENT_STATUS_OPTIONS: readonly ExpertAssignmentStatus[] = [
  'requested',
  'appointed',
  'report_received',
  'closed',
  'cancelled',
] as const;

export const JUDGMENT_RECOMMENDATION_OPTIONS: readonly JudgmentRecommendation[] = [
  'pending',
  'object',
  'accept',
] as const;

export const JUDGMENT_OUTCOME_OPTIONS: readonly JudgmentOutcome[] = [
  'won',
  'lost',
  'partial',
  'other',
] as const;

export const NAJIZ_STATUS_OPTIONS: readonly NajizSyncStatus[] = [
  'manual',
  'synced',
  'failed',
] as const;

/**
 * Valid forward case FSM transitions. Mirrors the matter STATUS_TRANSITIONS
 * pattern: terminal states expose no further moves; the current status is
 * excluded from its own option set. The intake/phase1/phase2 prefix is driven
 * by the directive pipeline; the change-status dialog only offers the
 * operational moves.
 */
export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  // The intake service owns intake→phase1→phase2→open. The generic status
  // dialog must never bypass the directive approval or handoff.
  intake: ['cancelled'],
  phase1: ['cancelled'],
  phase2: ['cancelled'],
  open: ['under_procedure', 'on_hold', 'closed', 'cancelled'],
  under_procedure: ['open', 'on_hold', 'closed', 'cancelled'],
  on_hold: ['open', 'under_procedure', 'closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

/** Display a raw enum/snake_case token by replacing underscores with spaces. */
export function formatCaseToken(value: string): string {
  return value.replace(/_/g, ' ');
}
