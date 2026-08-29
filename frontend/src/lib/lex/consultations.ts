/**
 * Legal Consultations API client (CAP-126..132).
 *
 * Self-contained domain client for the `/lex/consultations` console area. Calls
 * the real gateway-mounted backend endpoints under `/api/v1/lex` via the shared
 * axios helpers and suite envelope unwrappers, mirroring `enterpriseApi.lex.*`.
 *
 * Consultation lifecycle: submitted → classified → routed → responded →
 * approved → archived. Author-facing `title` is bilingual `LocalizedText
 * { ar, en }` and resolved in the UI via `resolveLocalized`.
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { buildSuiteQueryParams, fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { LocalizedText } from '@/types/forms';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

const BASE = '/api/v1/lex/consultations';

/* ------------------------------------------------------------------------- *
 * Enums (mirror backend model tokens).
 * ------------------------------------------------------------------------- */

export const CONSULTATION_STATUS_VALUES = [
  'submitted',
  'classified',
  'routed',
  'responded',
  'approved',
  'archived',
] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUS_VALUES)[number];

export const CONSULTATION_TYPE_VALUES = [
  'general',
  'contractual',
  'labor',
  'regulatory',
  'corporate',
  'litigation',
  'intellectual_property',
  'tax',
  'other',
] as const;
export type ConsultationType = (typeof CONSULTATION_TYPE_VALUES)[number];

export const CONSULTATION_PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
export type ConsultationPriority = (typeof CONSULTATION_PRIORITY_VALUES)[number];

export const CONSULTATION_SLA_OUTCOME_VALUES = ['pending', 'on_time', 'breached'] as const;
export type ConsultationSLAOutcome = (typeof CONSULTATION_SLA_OUTCOME_VALUES)[number];

export const CONSULTATION_SLA_RISK_VALUES = ['breached', 'due_soon', 'on_track'] as const;
export type ConsultationSLARisk = (typeof CONSULTATION_SLA_RISK_VALUES)[number];

/* ------------------------------------------------------------------------- *
 * Entity types (mirror backend JSON).
 * ------------------------------------------------------------------------- */

export interface ConsultationDocument {
  id: string;
  tenant_id: string;
  consultation_id: string;
  file_id: string;
  file_name: string;
  file_size: number;
  content_type?: string | null;
  kind: string;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
}

export interface Consultation {
  id: string;
  tenant_id: string;
  consultation_number: string;
  type: ConsultationType;
  title: LocalizedText;
  status: ConsultationStatus;
  priority: ConsultationPriority;
  legal_request_id?: string | null;
  requester_user_id: string;
  requester_name: string;
  department?: string | null;
  advisor_id?: string | null;
  advisor_name?: string | null;
  question: string;
  response?: string | null;
  workflow_instance_id?: string | null;
  responded_by?: string | null;
  responded_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  archived_at?: string | null;
  tags: string[];
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  documents?: ConsultationDocument[];

  /**
   * Ack + response SLA clock (projected by both List and Get). A consultation
   * whose clock never materialised reports nil deadlines, `sla_outcome:
   * 'pending'`, and `sla_breached: false`. `sla_ack_done`, `sla_escalation_level`,
   * `sla_breached`, and `sla_outcome` are always present; the timestamps and
   * `sla_target_minutes` are omitted when null.
   */
  sla_started_at?: string | null;
  sla_ack_due_at?: string | null;
  sla_response_due_at?: string | null;
  sla_ack_done?: boolean;
  sla_ack_done_at?: string | null;
  sla_escalation_level?: number;
  sla_breached?: boolean;
  sla_breached_at?: string | null;
  sla_outcome?: ConsultationSLAOutcome;
  sla_resolved_at?: string | null;
  sla_target_minutes?: number | null;
  late_justification?: string | null;
  late_justification_submitted_by?: string | null;
  late_justification_submitted_at?: string | null;

  /**
   * Legal-hold preservation flags. Populated by Get (detail view) only, not
   * List, and `omitempty` on the wire — absent/false when the consultation is
   * not under an active hold. Used to render a banner and pre-disable
   * hold-guarded actions (archive, detach, delete).
   */
  legal_hold?: boolean;
  legal_hold_id?: string;
  legal_hold_reason?: string;
}

export interface ConsultationAuditEntry {
  id: string;
  tenant_id: string;
  consultation_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  detail?: Record<string, unknown> | null;
  actor_user_id: string;
  created_at: string;
}

export interface ConsultationApprovalTask {
  id: string;
  workflow_instance_id?: string;
  name?: string;
  title?: string;
  status?: string;
  assignee_role?: string;
  assignee_user_id?: string;
  created_at?: string;
  due_at?: string | null;
  [key: string]: unknown;
}

/**
 * Optional list/stats filter keys. These ride through `FetchParams.filters`
 * (same mechanism the list page uses); each becomes a query-string param via
 * `buildSuiteQueryParams`. The existing filters (status/type/priority/
 * advisor_id/requester_user_id/legal_request_id/department/tag/search) continue
 * to work; this type documents the now-supported additions. All values are
 * strings because `FetchParams.filters` is `Record<string, string | string[]>`.
 */
export interface ConsultationListFilters {
  status?: ConsultationStatus;
  type?: ConsultationType;
  priority?: ConsultationPriority;
  advisor_id?: string;
  requester_user_id?: string;
  legal_request_id?: string;
  department?: string;
  tag?: string;
  search?: string;
  sla_risk?: ConsultationSLARisk;
  created_from?: string; // RFC3339
  created_to?: string; // RFC3339
  responded_from?: string; // RFC3339
  responded_to?: string; // RFC3339
}

/**
 * Aggregate KPI rollup over the FULL filtered dataset (GET /consultations/stats).
 * `open` = submitted|classified|routed; `responded` = responded; `approved` =
 * approved|archived; `breached`/`due_soon` are SLA-derived. `avg_respond_minutes`
 * is averaged over `response_sample` answer-duration facts (0 when no data).
 */
export interface ConsultationStats {
  total: number;
  open: number;
  responded: number;
  approved: number;
  breached: number;
  due_soon: number;
  avg_respond_minutes: number;
  response_sample: number;
}

/** One advisor's open-consultation load (GET /consultations/advisor-workload). */
export interface AdvisorWorkload {
  advisor_id: string;
  advisor_name: string;
  open_count: number;
}

/**
 * A litigation/regulatory preservation record on the consultation, as returned
 * inside the legal-hold detail (`holds[]`). Mirrors the backend `LegalHold`
 * model; the most commonly-rendered fields are typed, the rest are optional.
 */
export interface ConsultationLegalHoldRecord {
  id: string;
  tenant_id?: string;
  subject_type?: 'contract' | 'matter' | 'document';
  subject_id?: string;
  reason: string;
  reference?: string;
  status: 'active' | 'released';
  custodian?: string;
  notes?: string;
  applied_by?: string;
  applied_at?: string;
  released_by?: string | null;
  released_at?: string | null;
  release_note?: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string;
}

/** Active-hold status for a consultation (GET /consultations/{id}/legal-hold). */
export interface ConsultationLegalHold {
  on_hold: boolean;
  holds: ConsultationLegalHoldRecord[];
}

/** AI draft-preview response (POST /consultations/{id}/respond/draft). */
export interface ConsultationDraftResponse {
  draft: string;
  generated_by: string;
}

/* ------------------------------------------------------------------------- *
 * Request payloads.
 * ------------------------------------------------------------------------- */

export interface SubmitConsultationPayload {
  consultation_number?: string | null;
  type: ConsultationType;
  title: LocalizedText;
  priority: ConsultationPriority;
  legal_request_id?: string | null;
  requester_user_id?: string | null;
  requester_name: string;
  department?: string | null;
  question: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface ClassifyConsultationPayload {
  type: ConsultationType;
  priority?: ConsultationPriority;
  notes: string;
}

export interface RouteConsultationPayload {
  advisor_id: string;
  advisor_name?: string | null;
  notes: string;
}

export interface RespondConsultationPayload {
  response: string;
  use_ai: boolean;
  locale?: string;
  notes: string;
  metadata?: Record<string, unknown>;
  late_justification?: string;
}

export interface ArchiveConsultationPayload {
  reason: string;
}

export interface AttachConsultationDocumentPayload {
  file_id: string;
  file_name: string;
  file_size: number;
  content_type?: string | null;
  kind: string;
  metadata?: Record<string, unknown>;
}

export interface StartConsultationApprovalPayload {
  approver_role?: string;
  notes?: string;
}

export interface ConsultationApprovalDecisionPayload {
  decision: string;
  notes?: string | null;
  late_justification?: string;
}

/** Body for the AI draft-preview call. Locale hints the drafting language. */
export interface DraftConsultationResponsePayload {
  locale?: 'ar' | 'en';
}

/**
 * Bulk action over many consultation ids (POST /consultations/bulk). Each id is
 * processed in its own transaction so one failure never rolls back the rest.
 * Action-specific params are carried inline:
 *   archive  → optional `notes`/`reason`
 *   delete   → (no params; needs org `close` in addition to lex:write)
 *   classify → `type` (required), optional `priority`, optional `notes`
 *   route    → `advisor_id` (required), optional `advisor_name`, optional `notes`
 *   tag      → `tags` (required); `tag_mode` "add" (default) | "replace"
 */
export interface BulkConsultationPayload {
  action: 'archive' | 'delete' | 'classify' | 'route' | 'tag';
  ids: string[];
  type?: ConsultationType;
  priority?: ConsultationPriority;
  notes?: string;
  advisor_id?: string;
  advisor_name?: string;
  reason?: string;
  tags?: string[];
  tag_mode?: 'add' | 'replace';
}

/** Per-id outcome of a bulk operation; both arrays are always present. */
export interface BulkConsultationResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/* ------------------------------------------------------------------------- *
 * API surface.
 * ------------------------------------------------------------------------- */

export const consultationsApi = {
  list: (params: FetchParams): Promise<PaginatedResponse<Consultation>> =>
    fetchSuitePaginated<Consultation>(BASE, params),
  get: (id: string): Promise<Consultation> => fetchSuiteData<Consultation>(`${BASE}/${id}`),
  submit: (payload: SubmitConsultationPayload): Promise<Consultation> =>
    apiPost<{ data: Consultation }>(BASE, payload).then((res) => res.data),
  remove: (id: string): Promise<void> => apiDelete<void>(`${BASE}/${id}`),

  // Aggregate KPI rollup; accepts the SAME filter set as list so the cards
  // reflect the active filters (passed via `FetchParams.filters`).
  stats: (params?: FetchParams): Promise<ConsultationStats> =>
    fetchSuiteData<ConsultationStats>(
      `${BASE}/stats`,
      params
        ? buildSuiteQueryParams(params)
        : undefined,
    ),

  // Distinct tag set for autocomplete + filter chips (unwraps `{ tags: [] }`).
  listTags: (): Promise<string[]> =>
    apiGet<{ data: { tags: string[] } }>(`${BASE}/tags`).then((res) => res.data.tags),

  // Open-consultation counts by advisor (unwraps `{ advisors: [] }`).
  advisorWorkload: (): Promise<AdvisorWorkload[]> =>
    apiGet<{ data: { advisors: AdvisorWorkload[] } }>(`${BASE}/advisor-workload`).then(
      (res) => res.data.advisors,
    ),

  // One action across many ids; partial outcomes (succeeded/failed).
  bulk: (payload: BulkConsultationPayload): Promise<BulkConsultationResult> =>
    apiPost<{ data: BulkConsultationResult }>(`${BASE}/bulk`, payload).then((res) => res.data),

  // Active legal holds on the consultation.
  getLegalHold: (id: string): Promise<ConsultationLegalHold> =>
    fetchSuiteData<ConsultationLegalHold>(`${BASE}/${id}/legal-hold`),

  // AI draft preview (no FSM move). May 409 (requires status `routed`) or 422
  // (no drafter configured); callers handle errors.
  draftResponse: (
    id: string,
    payload?: DraftConsultationResponsePayload,
  ): Promise<ConsultationDraftResponse> =>
    apiPost<{ data: ConsultationDraftResponse }>(
      `${BASE}/${id}/respond/draft`,
      payload ?? {},
    ).then((res) => res.data),

  classify: (id: string, payload: ClassifyConsultationPayload): Promise<Consultation> =>
    apiPost<{ data: Consultation }>(`${BASE}/${id}/classify`, payload).then((res) => res.data),
  route: (id: string, payload: RouteConsultationPayload): Promise<Consultation> =>
    apiPost<{ data: Consultation }>(`${BASE}/${id}/route`, payload).then((res) => res.data),
  respond: (id: string, payload: RespondConsultationPayload): Promise<Consultation> =>
    apiPost<{ data: Consultation }>(`${BASE}/${id}/respond`, payload).then((res) => res.data),
  archive: (id: string, payload: ArchiveConsultationPayload): Promise<Consultation> =>
    apiPost<{ data: Consultation }>(`${BASE}/${id}/archive`, payload).then((res) => res.data),

  attachDocument: (
    id: string,
    payload: AttachConsultationDocumentPayload,
  ): Promise<ConsultationDocument> =>
    apiPost<{ data: ConsultationDocument }>(`${BASE}/${id}/documents`, payload).then(
      (res) => res.data,
    ),
  listDocuments: (id: string): Promise<ConsultationDocument[]> =>
    fetchSuiteData<ConsultationDocument[]>(`${BASE}/${id}/documents`),
  detachDocument: (id: string, documentId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/${id}/documents/${documentId}`),

  startApproval: (
    id: string,
    payload: StartConsultationApprovalPayload,
  ): Promise<Consultation> =>
    apiPost<{ data: Consultation }>(`${BASE}/${id}/approval/start`, payload).then(
      (res) => res.data,
    ),
  listApprovalTasks: (id: string): Promise<ConsultationApprovalTask[]> =>
    fetchSuiteData<ConsultationApprovalTask[]>(`${BASE}/${id}/approval/tasks`),
  decideApproval: (
    id: string,
    workflowInstanceId: string,
    taskId: string,
    payload: ConsultationApprovalDecisionPayload,
  ): Promise<unknown> =>
    apiPost<{ data: unknown }>(
      `${BASE}/${id}/approval/${workflowInstanceId}/tasks/${taskId}/decision`,
      payload,
    ).then((res) => res.data),

  listAudit: (id: string): Promise<ConsultationAuditEntry[]> =>
    fetchSuiteData<ConsultationAuditEntry[]>(`${BASE}/${id}/audit`),
};
