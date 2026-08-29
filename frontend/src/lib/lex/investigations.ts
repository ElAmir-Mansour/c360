/**
 * Legal Investigations API client (CAP-077..083).
 *
 * Self-contained domain client for the `/lex/investigations` console area. It
 * calls the real gateway-mounted backend endpoints under `/api/v1/lex` via the
 * shared axios helpers (`apiGet`/`apiPost`/… from `@/lib/api`) and the suite
 * envelope unwrappers (`fetchSuiteData`/`fetchSuitePaginated` from
 * `@/lib/suite-api`), mirroring the `enterpriseApi.lex.*` conventions.
 *
 * The backend wraps singletons as `{ data: T }` and lists as `{ data: T[], meta }`.
 * Author-facing bilingual labels arrive as `LocalizedText { ar, en }` and are
 * resolved in the UI via `resolveLocalized`.
 */

import { apiDelete, apiPost, apiPut } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

const BASE = '/api/v1/lex/investigations';

/* ------------------------------------------------------------------------- *
 * Enums (mirror backend model tokens).
 * ------------------------------------------------------------------------- */

export const INVESTIGATION_STATUS_VALUES = [
  'registered',
  'in_progress',
  'results_recorded',
  'pending_approval',
  'approved',
  'rejected',
  'closed',
  'cancelled',
] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUS_VALUES)[number];

export const INVESTIGATION_PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
export type InvestigationPriority = (typeof INVESTIGATION_PRIORITY_VALUES)[number];

export const INVESTIGATION_PARTY_ROLE_VALUES = [
  'subject',
  'complainant',
  'witness',
  'investigator',
  'expert',
  'other',
] as const;
export type InvestigationPartyRole = (typeof INVESTIGATION_PARTY_ROLE_VALUES)[number];

/**
 * Lifecycle moves driven directly by the status endpoint. results-approval
 * transitions flow through the approval-chain endpoints, not here.
 */
export const INVESTIGATION_STATUS_TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  registered: ['in_progress', 'cancelled'],
  in_progress: ['cancelled'],
  results_recorded: ['in_progress', 'cancelled'],
  pending_approval: [],
  approved: ['closed'],
  rejected: ['in_progress', 'cancelled'],
  closed: [],
  cancelled: [],
};

/* ------------------------------------------------------------------------- *
 * Entity types (mirror backend JSON).
 * ------------------------------------------------------------------------- */

export interface InvestigationParty {
  id: string;
  tenant_id: string;
  investigation_id: string;
  role: InvestigationPartyRole;
  name: string;
  identifier?: string | null;
  contact?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InvestigationStatement {
  id: string;
  tenant_id: string;
  investigation_id: string;
  deponent_party_id?: string | null;
  deponent_name: string;
  statement: string;
  taken_at: string;
  taken_by: string;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InvestigationEvidence {
  id: string;
  tenant_id: string;
  investigation_id: string;
  file_id?: string | null;
  title: string;
  description: string;
  evidence_type: string;
  collected_by: string;
  collected_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Investigation {
  id: string;
  tenant_id: string;
  investigation_number: string;
  subject: string;
  lead_investigator: string;
  status: InvestigationStatus;
  priority: InvestigationPriority;
  case_id?: string | null;
  findings: string;
  recommendations: string;
  ai_drafted: boolean;
  department?: string | null;
  workflow_instance_id?: string | null;
  reminder_obligation_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by: string;
  closed_by?: string | null;
  closed_at?: string | null;
  closure_reason?: string | null;
  sla_deadline?: string | null;
  late_justification?: string | null;
  late_justification_submitted_by?: string | null;
  late_justification_submitted_at?: string | null;
  created_at: string;
  updated_at: string;
  parties?: InvestigationParty[];
  statements?: InvestigationStatement[];
  evidence?: InvestigationEvidence[];
}

export interface InvestigationAuditEntry {
  id: string;
  tenant_id: string;
  investigation_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  detail?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  actor_user_id: string;
  created_at: string;
}

/** Shared approval-task view returned by the workflow approval chain. */
export interface InvestigationApprovalTask {
  id: string;
  workflow_instance_id?: string;
  name?: string;
  title?: string;
  status?: string;
  assignee_role?: string;
  assignee_user_id?: string;
  created_at?: string;
  due_at?: string | null;
  sla_deadline?: string | null;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------------- *
 * Request payloads.
 * ------------------------------------------------------------------------- */

export interface CreateInvestigationPayload {
  investigation_number?: string | null;
  subject: string;
  lead_investigator: string;
  priority: InvestigationPriority;
  case_id?: string | null;
  department?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateInvestigationPayload {
  subject?: string;
  lead_investigator?: string;
  priority?: InvestigationPriority;
  case_id?: string | null;
  department?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateInvestigationStatusPayload {
  status: InvestigationStatus;
  reason?: string;
  late_justification?: string;
}

export interface AddInvestigationPartyPayload {
  role: InvestigationPartyRole;
  name: string;
  identifier?: string | null;
  contact?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordInvestigationStatementPayload {
  deponent_party_id?: string | null;
  deponent_name: string;
  statement: string;
  taken_at?: string | null;
  taken_by: string;
  metadata?: Record<string, unknown>;
}

export interface UploadInvestigationEvidencePayload {
  file_id?: string | null;
  title: string;
  description: string;
  evidence_type: string;
  collected_by: string;
  collected_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordInvestigationResultsPayload {
  findings: string;
  generate_ai: boolean;
  findings_prompt: string;
  metadata?: Record<string, unknown>;
}

export interface RecordInvestigationRecommendationsPayload {
  recommendations: string;
  generate_ai: boolean;
  recommendations_prompt: string;
  metadata?: Record<string, unknown>;
}

export interface StartInvestigationApprovalPayload {
  approver_role: string;
  notes: string;
}

export interface InvestigationApprovalDecisionPayload {
  decision: string;
  notes?: string | null;
  late_justification?: string;
}

/* ------------------------------------------------------------------------- *
 * API surface.
 * ------------------------------------------------------------------------- */

export const investigationsApi = {
  list: (params: FetchParams): Promise<PaginatedResponse<Investigation>> =>
    fetchSuitePaginated<Investigation>(BASE, params),
  get: (id: string): Promise<Investigation> => fetchSuiteData<Investigation>(`${BASE}/${id}`),
  create: (payload: CreateInvestigationPayload): Promise<Investigation> =>
    apiPost<{ data: Investigation }>(BASE, payload).then((res) => res.data),
  update: (id: string, payload: UpdateInvestigationPayload): Promise<Investigation> =>
    apiPut<{ data: Investigation }>(`${BASE}/${id}`, payload).then((res) => res.data),
  remove: (id: string): Promise<void> => apiDelete<void>(`${BASE}/${id}`),
  updateStatus: (id: string, payload: UpdateInvestigationStatusPayload): Promise<Investigation> =>
    apiPost<{ data: Investigation }>(`${BASE}/${id}/status`, payload).then((res) => res.data),

  addParty: (id: string, payload: AddInvestigationPartyPayload): Promise<InvestigationParty> =>
    apiPost<{ data: InvestigationParty }>(`${BASE}/${id}/parties`, payload).then((res) => res.data),
  updateParty: (
    id: string,
    partyId: string,
    payload: Partial<AddInvestigationPartyPayload>,
  ): Promise<InvestigationParty> =>
    apiPut<{ data: InvestigationParty }>(`${BASE}/${id}/parties/${partyId}`, payload).then(
      (res) => res.data,
    ),
  deleteParty: (id: string, partyId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/${id}/parties/${partyId}`),

  recordStatement: (
    id: string,
    payload: RecordInvestigationStatementPayload,
  ): Promise<InvestigationStatement> =>
    apiPost<{ data: InvestigationStatement }>(`${BASE}/${id}/statements`, payload).then(
      (res) => res.data,
    ),
  deleteStatement: (id: string, statementId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/${id}/statements/${statementId}`),

  uploadEvidence: (
    id: string,
    payload: UploadInvestigationEvidencePayload,
  ): Promise<InvestigationEvidence> =>
    apiPost<{ data: InvestigationEvidence }>(`${BASE}/${id}/evidence`, payload).then(
      (res) => res.data,
    ),
  deleteEvidence: (id: string, evidenceId: string): Promise<void> =>
    apiDelete<void>(`${BASE}/${id}/evidence/${evidenceId}`),

  recordResults: (
    id: string,
    payload: RecordInvestigationResultsPayload,
  ): Promise<Investigation> =>
    apiPost<{ data: Investigation }>(`${BASE}/${id}/results`, payload).then((res) => res.data),
  recordRecommendations: (
    id: string,
    payload: RecordInvestigationRecommendationsPayload,
  ): Promise<Investigation> =>
    apiPost<{ data: Investigation }>(`${BASE}/${id}/recommendations`, payload).then(
      (res) => res.data,
    ),

  startApproval: (
    id: string,
    payload: StartInvestigationApprovalPayload,
  ): Promise<Investigation> =>
    apiPost<{ data: Investigation }>(`${BASE}/${id}/approval/start`, payload).then(
      (res) => res.data,
    ),
  listApprovalTasks: (id: string): Promise<InvestigationApprovalTask[]> =>
    fetchSuiteData<InvestigationApprovalTask[]>(`${BASE}/${id}/approval/tasks`),
  decideApproval: (
    id: string,
    workflowInstanceId: string,
    taskId: string,
    payload: InvestigationApprovalDecisionPayload,
  ): Promise<unknown> =>
    apiPost<{ data: unknown }>(
      `${BASE}/${id}/approval/${workflowInstanceId}/tasks/${taskId}/decision`,
      payload,
    ).then((res) => res.data),

  listAudit: (id: string): Promise<InvestigationAuditEntry[]> =>
    fetchSuiteData<InvestigationAuditEntry[]>(`${BASE}/${id}/audit`),
};
