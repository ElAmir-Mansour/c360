/**
 * Legal Service Desk API client (CAP-001..031).
 *
 * Self-contained HTTP module for the request lifecycle: service catalog +
 * eligibility, legal-request spine + priority, two-stage requester→provider
 * approval, SLA clock (ack + turnaround + escalation) and execution (requirements
 * checklist, completeness confirmation, return-incomplete two-round, delivery
 * confirmation). All calls go through the shared axios `api` instance (baseURL =
 * gateway :8080) on the `/api/v1/lex/...` paths and unwrap the `{data}` /
 * `{data,meta}` envelopes via the suite-api helpers.
 *
 * Types mirror the backend JSON exactly (LocalizedText {ar,en} on author-facing
 * labels). Kept on the `/lex` path family to share query keys/clients with the
 * rest of the suite (the backend mounts the identical routes at `/watheeq` too).
 */

import {
  apiDelete,
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  apiPut,
} from "@/lib/api";
import { fetchSuiteData, fetchSuitePaginated } from "@/lib/suite-api";
import type { PaginatedResponse } from "@/types/api";
import type { FetchParams } from "@/types/table";
import type { LexNotificationInboxItem } from "@/lib/lex/notifications";

/** Bilingual author-facing label, mirrors backend forms.LocalizedText. */
export interface LocalizedText {
  ar: string;
  en: string;
}

/* ------------------------------------------------------------------------- *
 * Enums (raw backend tokens).
 * ------------------------------------------------------------------------- */

export type RequestPriority = "emergency" | "urgent" | "normal";

export type RequestStatus =
  | "draft"
  | "submitted"
  | "pending_requester_approval"
  | "pending_provider_approval"
  | "approved"
  | "routed"
  | "in_execution"
  | "delivered"
  | "closed"
  | "returned"
  | "cancelled";

const REQUEST_STATUSES_WITH_SLA_CLOCK: ReadonlySet<RequestStatus> = new Set([
  "in_execution",
  "delivered",
  "closed",
  // A returned request retains the just-stopped clock for its review round.
  // The endpoint returns that latest cycle so the UI can explain the pause;
  // resubmission creates a fresh running cycle.
  "returned",
]);

export function requestCanHaveSlaClock(
  status: RequestStatus | null | undefined,
): boolean {
  return status ? REQUEST_STATUSES_WITH_SLA_CLOCK.has(status) : false;
}

const REQUEST_STATUSES_WITH_EXECUTION_STATE: ReadonlySet<RequestStatus> =
  new Set(["routed", "in_execution", "delivered", "closed", "returned"]);

export function requestCanHaveExecutionState(
  status: RequestStatus | null | undefined,
): boolean {
  return status ? REQUEST_STATUSES_WITH_EXECUTION_STATE.has(status) : false;
}

export function requestCanHaveApprovalTasks(
  workflowInstanceId: string | null | undefined,
): boolean {
  return (
    typeof workflowInstanceId === "string" &&
    workflowInstanceId.trim().length > 0
  );
}

export type ServiceChannel = "platform" | "email" | "both";

export type EligibilityRuleType = "all" | "department" | "role" | "doa_matrix";

export type SLATargetPriority = "emergency" | "urgent" | "normal";
export type SLAAckUnit = "working_days" | "working_hours";
/**
 * `stopped` terminates a round because the request was returned to the requester.
 * It is deliberately neither `on_time` nor `breached` — the department did not
 * deliver, but neither did it miss a deadline it still controlled — and is
 * excluded from every SLA compliance aggregate.
 */
export type SLAClockOutcome = "pending" | "on_time" | "breached" | "stopped";

export type ExecutionStatus =
  | "awaiting_completeness"
  | "in_progress"
  | "delivered"
  | "returned"
  | "auto_closed"
  | "closed";

export type RequirementKind = "attachment" | "data";

export type ReviewRoundOutcome = "accepted" | "returned" | "auto_closed";

export type DeliveryConfirmationStatus =
  | "requested"
  | "confirmed"
  | "achieved"
  | "denied"
  | "expired";

/** Canonical legal service codes (the eight standard services). */
export const LEGAL_SERVICE_CODES = [
  "LEGAL_CONSULTATION",
  "CONTRACT_REVIEW",
  "CONTRACT_DRAFTING",
  "LITIGATION_SUPPORT",
  "LEGAL_OPINION",
  "REGULATORY_COMPLIANCE",
  "POWER_OF_ATTORNEY",
  "GENERAL_LEGAL_REQUEST",
] as const;

/* ------------------------------------------------------------------------- *
 * Models.
 * ------------------------------------------------------------------------- */

export interface ServiceEligibilityRule {
  id: string;
  tenant_id: string;
  service_id: string;
  rule_type: EligibilityRuleType;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface ServiceCatalogEntry {
  id: string;
  tenant_id: string;
  code: string;
  request_type: string;
  name: LocalizedText;
  description: LocalizedText;
  available_to: string[];
  requester_approval_required: boolean;
  provider_approval_required: boolean;
  approval_policy_id?: string | null;
  intake_email?: string | null;
  channel: ServiceChannel;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  eligibility_rules?: ServiceEligibilityRule[];
}

export interface EligibilityDecision {
  service_id: string;
  service_code: string;
  eligible: boolean;
  matched_rule?: string;
  reasons?: string[];
}

export interface LegalRequest {
  id: string;
  tenant_id: string;
  request_number: string;
  request_type: string;
  service_id?: string | null;
  title: LocalizedText;
  description: string;
  requester_user_id: string;
  requester_name: string;
  beneficiary_entity_id?: string | null;
  department?: string | null;
  priority: RequestPriority;
  status: RequestStatus;
  /**
   * 1-based review round. Increments each time a returned request is resubmitted,
   * so it is also the number of times the request has been handed back, plus one.
   * Notes, attachments and the SLA clock all carry the round they belong to.
   */
  cycle: number;
  urgency_justification?: string | null;
  requester_approval_required: boolean;
  provider_approval_required: boolean;
  subject_type?: string | null;
  subject_id?: string | null;
  workflow_instance_id?: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const CONTRACT_REQUEST_TOKENS = [
  "contract",
  "agreement",
  "nda",
  "عقد",
  "اتفاقية",
] as const;

/**
 * Mirrors the backend request-to-domain classifier for the contract delivery
 * workflow. Prefer the routed subject link, with request_type as the safe intake
 * fallback before or when a legacy request has not been linked yet.
 */
export function isContractLegalRequest(
  request: Pick<LegalRequest, "request_type" | "subject_type">,
): boolean {
  if (request.subject_type?.trim().toLowerCase() === "contract") return true;
  const requestType = request.request_type.trim().toLowerCase();
  return CONTRACT_REQUEST_TOKENS.some((token) => requestType.includes(token));
}

export interface LegalRequestAttachment {
  id: string;
  tenant_id: string;
  legal_request_id: string;
  /** Review round this upload arrived in. 1 for everything before round tracking. */
  cycle: number;
  file_id: string;
  slot_key?: string | null;
  original_name: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  file_version: number;
  virus_scan_status: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateLegalRequestAttachmentPayload {
  file_id: string;
  slot_key?: string;
}

export interface LegalRequestPriorityChange {
  id: string;
  tenant_id: string;
  request_id: string;
  from_priority: RequestPriority;
  to_priority: RequestPriority;
  reason: string;
  changed_by: string;
  changed_at: string;
}

export interface LegalRequestFeedback {
  id: string;
  tenant_id: string;
  request_id: string;
  rating: number;
  comment: string;
  submitted_by: string;
  submitted_at: string;
}

export interface SubmitLegalRequestFeedbackPayload {
  rating: number;
  comment?: string;
}

// Internal collaboration note on a request (Al Othaim PRD request detail right
// rail). `mentions` carries user IDs or display handles captured by the composer.
export interface RequestNote {
  id: string;
  tenant_id: string;
  request_id: string;
  /** Review round this note was written in. 1 for everything before round tracking. */
  cycle: number;
  body: string;
  mentions: string[];
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRequestNotePayload {
  body: string;
  mentions?: string[];
}

export interface SLAClock {
  id: string;
  tenant_id: string;
  legal_request_id: string;
  sla_target_id?: string | null;
  service_code: string;
  priority: SLATargetPriority;
  beneficiary_entity_id?: string | null;
  clock_started_at: string;
  ack_due_at: string;
  /**
   * Earliest-promise (From) instant of the From–To delivery window. Display-only;
   * breach/escalation still key off `turnaround_due_at` (the To deadline). Nullable
   * for clocks materialised before the window feature.
   */
  turnaround_from_due_at?: string | null;
  turnaround_due_at: string;
  escalation_l1_due_at: string;
  escalation_l2_due_at: string;
  escalation_l3_due_at: string;
  ack_done: boolean;
  ack_done_at?: string | null;
  escalation_level: number;
  breached: boolean;
  breached_at?: string | null;
  outcome: SLAClockOutcome;
  resolved_at?: string | null;
  /**
   * Review round this clock measures. A returned/resubmitted request owns one
   * clock per round; this matches the request's own `cycle`.
   */
  cycle: number;
  /**
   * When this round's clock was halted by a return to the requester. Set if and
   * only if `outcome` is `stopped`.
   */
  stopped_at?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RequirementItem {
  id: string;
  tenant_id: string;
  legal_request_id: string;
  code: string;
  label: LocalizedText;
  kind: RequirementKind;
  required: boolean;
  satisfied: boolean;
  file_id?: string | null;
  data_value?: string | null;
  satisfied_by?: string | null;
  satisfied_at?: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ReviewRound {
  id: string;
  tenant_id: string;
  legal_request_id: string;
  round_no: number;
  reason: string;
  outcome?: ReviewRoundOutcome | null;
  opened_by: string;
  opened_at: string;
  closed_by?: string | null;
  closed_at?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DeliveryConfirmation {
  id: string;
  tenant_id: string;
  legal_request_id: string;
  status: DeliveryConfirmationStatus;
  requested_by: string;
  recipient_user_id: string;
  requested_at: string;
  auto_close_at?: string | null;
  responded_by?: string | null;
  responded_at?: string | null;
  response_note?: string | null;
  late_justification?: string | null;
  late_justification_submitted_by?: string | null;
  late_justification_submitted_at?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Aggregate execution read model (GET execution state). */
export interface ExecutionState {
  id: string;
  tenant_id: string;
  legal_request_id: string;
  status: ExecutionStatus;
  clock_started_at?: string | null;
  completeness_confirmed_at?: string | null;
  sla_target_seconds?: number | null;
  working_calendar_id?: string | null;
  review_round_count: number;
  max_review_rounds: number;
  cloned_from_request_id?: string | null;
  clone_request_id?: string | null;
  delivered_at?: string | null;
  closed_at?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ExecutionStateView {
  state: ExecutionState | null;
  requirements: RequirementItem[];
  review_rounds: ReviewRound[];
  delivery_confirmations: DeliveryConfirmation[];
}

/** Subset of the shared workflow HumanTask used by the approval surface. */
export interface ApprovalTask {
  id: string;
  tenant_id: string;
  instance_id: string;
  step_id: string;
  name: string;
  description: string;
  status: string;
  assignee_id?: string | null;
  assignee_role?: string | null;
  sla_deadline?: string | null;
  sla_breached: boolean;
  priority: number;
  metadata: Record<string, unknown>;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  /** Server-computed eligibility for the signed-in actor and this exact task. */
  can_decide: boolean;
}

export interface ApprovalDecisionOutcome {
  subject_type: string;
  subject_id: string;
  workflow_instance_id: string;
  task_id: string;
  decision: string;
  task_status: string;
  workflow_status: string;
  previous_status: string;
  status: string;
  next_task_id?: string | null;
  decided_by: string;
}

/* ------------------------------------------------------------------------- *
 * Extended models — ops board, escalation chain, intake triage, analytics,
 * notifications, and revise (backend surfaces CAP-012..164 the UI did not yet
 * consume). All json field names mirror the Go DTOs verbatim.
 * ------------------------------------------------------------------------- */

/**
 * SLAClockView is the WS9 operations-board projection: the raw {@link SLAClock}
 * plus computed working-time-remaining, the resolved next-escalation recipient,
 * and ack/breach/escalation risk flags — so the board renders without
 * re-deriving deadlines client-side.
 */
export interface SLAClockView extends SLAClock {
  evaluated_at: string;
  ack_working_minutes_remaining?: number | null;
  turnaround_working_minutes_remaining?: number | null;
  next_escalation_level?: number | null;
  next_escalation_due_at?: string | null;
  next_escalation_recipient?: string;
  ack_overdue: boolean;
  ack_risk: boolean;
  breach_imminent: boolean;
  escalation_imminent: boolean;
}

/** Server-side filters for the SLA operations board (GET /sla/clocks). */
export interface SLAClockBoardFilters {
  outcome?: SLAClockOutcome;
  breached?: boolean;
  escalation_level?: number;
  service_code?: string;
  priority?: SLATargetPriority;
  due_before?: string;
}

/** One rung of the resolved org escalation ladder (CAP-019). */
export interface EscalationRecipient {
  level: number;
  role_key: string;
  user_id: string;
  label: LocalizedText;
  entity_id: string;
  entity_code: string;
  entity_name: LocalizedText;
}

export interface EscalationLadder {
  entity_id: string;
  entity_code: string;
  entity_name: LocalizedText;
  resolved_at: string;
  recipients: EscalationRecipient[];
}

export type IntakeMessageStatus = "pending" | "processed" | "errored" | string;

export interface IntakeMessage {
  id: string;
  tenant_id: string;
  mailbox_id?: string | null;
  provider_message_id: string;
  from_address: string;
  to_address: string;
  subject: string;
  raw_file_id?: string | null;
  attachment_file_ids: string[];
  beneficiary_entity_id?: string | null;
  legal_request_id?: string | null;
  status: IntakeMessageStatus;
  created_by: string;
  created_at: string;
}

/** Inbound email mailbox (CAP-002). Secrets are never returned by the API. */
export interface IntakeMailbox {
  id: string;
  tenant_id: string;
  address: string;
  request_type: string;
  service_id?: string | null;
  beneficiary_entity_id?: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Payload for the Simulate-Inbound admin action: synthesize an inbound email
 * against an owned mailbox and drive the full classify→route→legal_request
 * pipeline with no external mail provider. All fields optional; the backend
 * applies sensible defaults so a bare submit still routes a message.
 */
export interface IntakeSimulatePayload {
  message_id?: string;
  from?: string;
  subject?: string;
  body?: string;
}

export type NotificationCategory =
  "request" | "case" | "hearing" | "judgment" | "contract" | "general" | string;
/** Inbox subscription channels — the backend enum is in_app | email only. */
export type NotificationChannel = "in_app" | "email";

/**
 * Inbox row DTO. The authoritative {ar,en}-localized wire shape is owned by the
 * dedicated notifications client (`@/lib/lex/notifications`); this is an alias so
 * existing `@/lib/lex/requests` importers keep resolving. The previous local
 * interface here mirrored the Go *model* — it required `tenant_id`/`recipient_id`/
 * `updated_at` the API never sends and omitted the DTO's `read` flag — and had
 * drifted from the actual response.
 */
export type NotificationInboxItem = LexNotificationInboxItem;

export interface NotificationCounts {
  total: number;
  unread: number;
}

export interface NotificationSubscription {
  id: string;
  tenant_id: string;
  user_id: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertSubscriptionPayload {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

/* ----- Analytics / reporting (CAP-133..151) ----- */

export interface ReportFilters {
  from?: string | null;
  to?: string | null;
  department?: string | null;
  status?: string | null;
  type?: string | null;
}

export interface PerformanceKPIs {
  generated_at: string;
  filters: ReportFilters;
  avg_request_processing_hours: number;
  request_processing_sample: number;
  closed_case_ratio: number;
  total_cases: number;
  closed_cases: number;
  approved_contract_ratio: number;
  total_contracts: number;
  approved_contracts: number;
  overdue_requests: number;
  estimated_duration_adherence: number;
  resolved_clocks: number;
  on_time_clocks: number;
}

export interface QuarterSLACompliance {
  quarter: string;
  quarter_start: string;
  quarter_end: string;
  received: number;
  on_time: number;
  breached: number;
  pending: number;
  rate_pct: number;
  target_pct: number;
  meets_target: boolean;
}

export interface SLAComplianceReport {
  generated_at: string;
  filters: ReportFilters;
  target_pct: number;
  quarters: QuarterSLACompliance[];
  overall_rate_pct: number;
  overall_meets_target: boolean;
}

/** Permissive shape for the case/contract/consultation sub-reports. */
export interface CountReport {
  generated_at: string;
  total: number;
  [key: string]: unknown;
}

export interface LegalAffairsDashboard {
  generated_at: string;
  cases?: CountReport | null;
  contracts?: CountReport | null;
  consultations?: CountReport | null;
  performance?: PerformanceKPIs | null;
  sla_compliance?: SLAComplianceReport | null;
  current_quarter_rate_pct: number;
}

/** CAP-024 substantial-edit decision returned by revise. */
export type SubstantialEditReason =
  | "service_changed"
  | "request_type_changed"
  | "priority_tier_changed"
  | "scope_changed"
  | "required_item_added"
  | "required_item_removed"
  | "requirement_churn"
  | string;

export interface ChangeDecision {
  substantial: boolean;
  reasons: SubstantialEditReason[];
  changes: Record<string, unknown>;
}

/** revise response envelope: the edited request + the change decision. */
export interface ReviseResult {
  request: LegalRequest;
  change: ChangeDecision;
}

/** Append-only spine audit entry (GET /legal-requests/{id}/audit). */
export interface LegalRequestAuditEntry {
  id: string;
  tenant_id: string;
  request_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  actor_user_id?: string | null;
  /** Display name resolved server-side from the actor UUID; UUID is the fallback. */
  actor_name?: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------------- *
 * Payloads.
 * ------------------------------------------------------------------------- */

export interface CreateLegalRequestPayload {
  request_type: string;
  service_id?: string;
  title: LocalizedText;
  description: string;
  requester_name: string;
  beneficiary_entity_id?: string;
  department?: string;
  priority: RequestPriority;
  urgency_justification?: string;
  requester_approval_required: boolean;
  provider_approval_required: boolean;
  metadata?: Record<string, unknown>;
  attachments?: CreateLegalRequestAttachmentPayload[];
}

export interface UpdateLegalRequestPayload {
  request_type?: string;
  title?: LocalizedText;
  description?: string;
  requester_name?: string;
  department?: string;
  requester_approval_required?: boolean;
  provider_approval_required?: boolean;
}

export interface SubmitLegalRequestPayload {
  notes?: string;
}

export interface ReclassifyPriorityPayload {
  priority: RequestPriority;
  reason: string;
  urgency_justification?: string;
}

export interface EligibilityCheckPayload {
  service_id: string;
  department?: string;
  beneficiary_code?: string;
}

export interface IntakeSubmitPayload {
  service_id: string;
  title: LocalizedText;
  description: string;
  beneficiary_entity_id?: string;
  department?: string;
  priority: RequestPriority;
  urgency_justification?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfirmCompletenessPayload {
  working_calendar_id?: string;
  sla_target_seconds?: number;
  notes?: string;
}

export interface ReturnIncompletePayload {
  reason_code?: ReturnIncompleteReasonCode;
  reason: string;
  missing_requirement_codes?: string[];
}

export type ReturnIncompleteReasonCode =
  | "missing_information"
  | "doa_non_compliance"
  | "incomplete_referral_procedures"
  | "invalid_attachments";

export interface AddRequirementPayload {
  code: string;
  label: LocalizedText;
  kind: RequirementKind;
  required?: boolean;
  sort_order?: number;
}

export interface UpdateRequirementPayload {
  satisfied?: boolean;
  data_value?: string;
  file_id?: string;
  required?: boolean;
}

export interface RequestDeliveryConfirmationPayload {
  recipient_name: string;
  recipient_contact?: string;
  notes?: string;
  late_justification?: string;
}

export interface RespondDeliveryConfirmationPayload {
  confirm: boolean;
  note?: string;
}

export interface ApprovalDecisionPayload {
  decision: string;
  notes?: string;
  form_data?: Record<string, unknown>;
  late_justification?: string;
  // Structured PRD return-reason code (Al Othaim PRD 7.0 / Diagram B), required by
  // the backend when the decision is a reject at an approval gate. Reuses the same
  // controlled deficiency vocabulary as the execution "return incomplete" path.
  return_reason_code?: ReturnIncompleteReasonCode;
}

/* ------------------------------------------------------------------------- *
 * API surface.
 * ------------------------------------------------------------------------- */

const BASE = "/api/v1/lex";

export const lexRequestsApi = {
  // --- Service catalog & eligibility (CAP-001..008) ---
  listServices: (
    params: FetchParams,
  ): Promise<PaginatedResponse<ServiceCatalogEntry>> =>
    fetchSuitePaginated<ServiceCatalogEntry>(`${BASE}/service-catalog`, params),
  getService: (id: string): Promise<ServiceCatalogEntry> =>
    fetchSuiteData(`${BASE}/service-catalog/${id}`),
  checkEligibility: (
    payload: EligibilityCheckPayload,
  ): Promise<EligibilityDecision> =>
    apiPost<{ data: EligibilityDecision }>(
      `${BASE}/service-catalog/eligibility-check`,
      payload,
    ).then((res) => res.data),

  // --- Intake (CAP-002) ---
  submitIntake: (payload: IntakeSubmitPayload): Promise<LegalRequest> =>
    apiPost<{ data: LegalRequest }>(`${BASE}/intake/submit`, payload).then(
      (res) => res.data,
    ),

  // --- Legal request spine + priority (CAP-009..011, 030, 031) ---
  listRequests: (
    params: FetchParams,
  ): Promise<PaginatedResponse<LegalRequest>> =>
    fetchSuitePaginated<LegalRequest>(`${BASE}/legal-requests`, params),
  listMyApprovalRequests: (
    params: FetchParams,
  ): Promise<PaginatedResponse<LegalRequest>> =>
    fetchSuitePaginated<LegalRequest>(`${BASE}/legal-requests`, params, {
      approval_mine: true,
    }),
  getRequest: (id: string): Promise<LegalRequest> =>
    fetchSuiteData(`${BASE}/legal-requests/${id}`),
  listRequestAttachments: (id: string): Promise<LegalRequestAttachment[]> =>
    fetchSuiteData(`${BASE}/legal-requests/${id}/attachments`),
  getRequestAttachmentContent: (
    requestId: string,
    attachmentId: string,
    disposition: "inline" | "attachment" = "attachment",
  ): Promise<{ blob: Blob; filename: string | null }> =>
    apiGetBlob(
      `${BASE}/legal-requests/${requestId}/attachments/${attachmentId}/download`,
      {
        disposition,
      },
    ),
  createRequest: (payload: CreateLegalRequestPayload): Promise<LegalRequest> =>
    apiPost<{ data: LegalRequest }>(`${BASE}/legal-requests`, payload).then(
      (res) => res.data,
    ),
  updateRequest: (
    id: string,
    payload: UpdateLegalRequestPayload,
  ): Promise<LegalRequest> =>
    apiPut<{ data: LegalRequest }>(
      `${BASE}/legal-requests/${id}`,
      payload,
    ).then((res) => res.data),
  deleteRequest: (id: string): Promise<void> =>
    apiDelete<void>(`${BASE}/legal-requests/${id}`),
  submitRequest: (
    id: string,
    payload: SubmitLegalRequestPayload,
  ): Promise<LegalRequest> =>
    apiPost<{ data: LegalRequest }>(
      `${BASE}/legal-requests/${id}/submit`,
      payload,
    ).then((res) => res.data),
  reclassifyPriority: (
    id: string,
    payload: ReclassifyPriorityPayload,
  ): Promise<LegalRequest> =>
    apiPost<{ data: LegalRequest }>(
      `${BASE}/legal-requests/${id}/priority`,
      payload,
    ).then((res) => res.data),
  listPriorityHistory: (id: string): Promise<LegalRequestPriorityChange[]> =>
    fetchSuiteData(`${BASE}/legal-requests/${id}/priority-changes`),
  getRequestFeedback: (id: string): Promise<LegalRequestFeedback | null> =>
    fetchSuiteData(`${BASE}/legal-requests/${id}/feedback`),
  submitRequestFeedback: (
    id: string,
    payload: SubmitLegalRequestFeedbackPayload,
  ): Promise<LegalRequestFeedback> =>
    apiPost<{ data: LegalRequestFeedback }>(
      `${BASE}/legal-requests/${id}/feedback`,
      payload,
    ).then((res) => res.data),

  // --- Internal notes (Al Othaim PRD request detail right rail) ---
  listRequestNotes: (id: string): Promise<RequestNote[]> =>
    fetchSuiteData(`${BASE}/legal-requests/${id}/notes`),
  createRequestNote: (
    id: string,
    payload: CreateRequestNotePayload,
  ): Promise<RequestNote> =>
    apiPost<{ data: RequestNote }>(
      `${BASE}/legal-requests/${id}/notes`,
      payload,
    ).then((res) => res.data),

  // --- Approval chain (CAP-006, 007, 030, 031) ---
  getApproval: (requestId: string): Promise<LegalRequest> =>
    fetchSuiteData(`${BASE}/requests/${requestId}/approval`),
  listApprovalTasks: (requestId: string): Promise<ApprovalTask[]> =>
    fetchSuiteData(`${BASE}/requests/${requestId}/approval/tasks`),
  startApproval: (requestId: string): Promise<LegalRequest> =>
    apiPost<{ data: LegalRequest }>(
      `${BASE}/requests/${requestId}/approval/start`,
    ).then((res) => res.data),
  decideApprovalTask: (
    requestId: string,
    workflowInstanceId: string,
    taskId: string,
    payload: ApprovalDecisionPayload,
  ): Promise<ApprovalDecisionOutcome> =>
    apiPost<{ data: ApprovalDecisionOutcome }>(
      `${BASE}/requests/${requestId}/approval/${workflowInstanceId}/tasks/${taskId}/decision`,
      payload,
    ).then((res) => res.data),

  // --- SLA clock (CAP-012..019) ---
  getRequestClock: (requestId: string): Promise<SLAClock | null> =>
    fetchSuiteData(`${BASE}/sla/requests/${requestId}/clock`),
  acknowledgeClock: (clockId: string): Promise<SLAClock> =>
    apiPost<{ data: SLAClock }>(
      `${BASE}/sla/clocks/${clockId}/acknowledge`,
      {},
    ).then((res) => res.data),

  // --- Execution (CAP-022..029) ---
  getExecution: (requestId: string): Promise<ExecutionStateView> =>
    fetchSuiteData(`${BASE}/requests/${requestId}/execution`),
  confirmCompleteness: (
    requestId: string,
    payload: ConfirmCompletenessPayload,
  ): Promise<ExecutionStateView> =>
    apiPost<{ data: ExecutionStateView }>(
      `${BASE}/requests/${requestId}/execution/confirm-completeness`,
      payload,
    ).then((res) => res.data),
  returnIncomplete: (
    requestId: string,
    payload: ReturnIncompletePayload,
  ): Promise<ExecutionStateView> =>
    apiPost<{ data: ExecutionStateView }>(
      `${BASE}/requests/${requestId}/execution/return-incomplete`,
      payload,
    ).then((res) => res.data),
  addRequirement: (
    requestId: string,
    payload: AddRequirementPayload,
  ): Promise<RequirementItem> =>
    apiPost<{ data: RequirementItem }>(
      `${BASE}/requests/${requestId}/execution/requirements`,
      payload,
    ).then((res) => res.data),
  updateRequirement: (
    requestId: string,
    itemId: string,
    payload: UpdateRequirementPayload,
  ): Promise<RequirementItem> =>
    apiPatch<{ data: RequirementItem }>(
      `${BASE}/requests/${requestId}/execution/requirements/${itemId}`,
      payload,
    ).then((res) => res.data),
  deleteRequirement: (requestId: string, itemId: string): Promise<void> =>
    apiDelete<void>(
      `${BASE}/requests/${requestId}/execution/requirements/${itemId}`,
    ),
  requestDeliveryConfirmation: (
    requestId: string,
    payload: RequestDeliveryConfirmationPayload,
  ): Promise<DeliveryConfirmation> =>
    apiPost<{ data: DeliveryConfirmation }>(
      `${BASE}/requests/${requestId}/execution/delivery-confirmation`,
      payload,
    ).then((res) => res.data),
  respondDeliveryConfirmation: (
    requestId: string,
    confirmationId: string,
    payload: RespondDeliveryConfirmationPayload,
  ): Promise<DeliveryConfirmation> =>
    apiPost<{ data: DeliveryConfirmation }>(
      `${BASE}/requests/${requestId}/execution/delivery-confirmation/${confirmationId}/respond`,
      payload,
    ).then((res) => res.data),
  achieveDeliveryConfirmation: (
    requestId: string,
    confirmationId: string,
  ): Promise<DeliveryConfirmation> =>
    apiPost<{ data: DeliveryConfirmation }>(
      `${BASE}/requests/${requestId}/execution/delivery-confirmation/${confirmationId}/achieve`,
      {},
    ).then((res) => res.data),

  // --- Spine: route + revise + audit (CAP-009, CAP-024, WS4) ---
  routeRequest: (id: string): Promise<LegalRequest> =>
    apiPost<{ data: LegalRequest }>(
      `${BASE}/legal-requests/${id}/route`,
      {},
    ).then((res) => res.data),
  reviseRequest: (
    id: string,
    payload: UpdateLegalRequestPayload,
  ): Promise<ReviseResult> =>
    apiPost<{ data: ReviseResult }>(
      `${BASE}/legal-requests/${id}/revise`,
      payload,
    ).then((res) => res.data),
  listRequestAudit: (id: string): Promise<LegalRequestAuditEntry[]> =>
    fetchSuiteData(`${BASE}/legal-requests/${id}/audit`),

  // --- SLA operations board + escalation (CAP-012..019, WS9) ---
  listSlaClocks: (
    params: FetchParams,
    filters?: SLAClockBoardFilters,
  ): Promise<PaginatedResponse<SLAClockView>> =>
    fetchSuitePaginated<SLAClockView>(
      `${BASE}/sla/clocks`,
      params,
      filters as Record<string, unknown> | undefined,
    ),
  escalateClock: (clockId: string): Promise<SLAClock> =>
    apiPost<{ data: SLAClock }>(
      `${BASE}/sla/clocks/${clockId}/escalate`,
      {},
    ).then((res) => res.data),
  getOrgEntityEscalation: (entityId: string): Promise<EscalationLadder> =>
    fetchSuiteData(`${BASE}/org-entities/${entityId}/escalation`),

  // --- Intake triage (CAP-001..005, CAP-015) ---
  listIntakeMessages: (
    params: FetchParams,
  ): Promise<PaginatedResponse<IntakeMessage>> =>
    fetchSuitePaginated<IntakeMessage>(`${BASE}/intake/messages`, params),
  getIntakeMessage: (id: string): Promise<IntakeMessage> =>
    fetchSuiteData(`${BASE}/intake/messages/${id}`),
  listIntakeMailboxes: (
    params: FetchParams,
  ): Promise<PaginatedResponse<IntakeMailbox>> =>
    fetchSuitePaginated<IntakeMailbox>(`${BASE}/intake/mailboxes`, params),
  simulateInboundEmail: (
    mailboxId: string,
    payload: IntakeSimulatePayload,
  ): Promise<IntakeMessage> =>
    apiPost<{ data: IntakeMessage }>(
      `${BASE}/intake/mailboxes/${mailboxId}/simulate`,
      payload,
    ).then((res) => res.data),

  // --- Analytics & reporting (CAP-133..151) ---
  getLegalAffairsDashboard: (
    filters?: ReportFilters,
  ): Promise<LegalAffairsDashboard> =>
    fetchSuiteData(
      `${BASE}/dashboard/legal-affairs`,
      filters as Record<string, unknown> | undefined,
    ),
  getPerformanceKpis: (filters?: ReportFilters): Promise<PerformanceKPIs> =>
    fetchSuiteData(
      `${BASE}/reports/performance`,
      filters as Record<string, unknown> | undefined,
    ),
  getSlaCompliance: (filters?: ReportFilters): Promise<SLAComplianceReport> =>
    fetchSuiteData(
      `${BASE}/kpis/sla-compliance`,
      filters as Record<string, unknown> | undefined,
    ),

  // --- Notifications inbox + subscriptions (CAP-156..164) ---
  listInbox: (
    params: FetchParams,
  ): Promise<PaginatedResponse<NotificationInboxItem>> =>
    fetchSuitePaginated<NotificationInboxItem>(
      `${BASE}/notifications/inbox`,
      params,
    ),
  getInboxCounts: (): Promise<NotificationCounts> =>
    fetchSuiteData(`${BASE}/notifications/inbox/counts`),
  getInboxItem: (id: string): Promise<NotificationInboxItem> =>
    fetchSuiteData(`${BASE}/notifications/inbox/${id}`),
  markInboxRead: (id: string): Promise<void> =>
    apiPost<void>(`${BASE}/notifications/inbox/${id}/read`, {}),
  markAllInboxRead: (): Promise<void> =>
    apiPost<void>(`${BASE}/notifications/inbox/read-all`, {}),
  listSubscriptions: (): Promise<NotificationSubscription[]> =>
    fetchSuiteData(`${BASE}/notifications/subscriptions`),
  upsertSubscription: (
    payload: UpsertSubscriptionPayload,
  ): Promise<NotificationSubscription> =>
    apiPut<{ data: NotificationSubscription }>(
      `${BASE}/notifications/subscriptions`,
      payload,
    ).then((res) => res.data),
  deleteSubscription: (id: string): Promise<void> =>
    apiDelete<void>(`${BASE}/notifications/subscriptions/${id}`),
};
