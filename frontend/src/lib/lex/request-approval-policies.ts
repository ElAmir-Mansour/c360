/**
 * Request-Approval Policy API client (CAP-006/007).
 *
 * The subject-agnostic two-stage (requester → provider) approval-policy stack
 * for legal *requests* — the request-side analog of the contract approval
 * policies (`enterpriseApi.lex.*ApprovalPolicy`). Scope is `request_type` (+
 * optional service/stage/department/priority-tier/value-range) instead of
 * contract_type; the routing payload (mode/quorum/approvers/form_fields) and the
 * governance trio (immutable versions, append-only audit, reusable templates)
 * mirror the contract stack verbatim and REUSE its FE payload types
 * (`LexApprovalPolicyApprover` / `LexApprovalFormFieldRequest`).
 *
 * Types mirror the Go DTOs/model verbatim; all calls go through the shared axios
 * `api` instance and unwrap the `{data}` / `{data,meta}` envelopes.
 */

import { apiDelete, apiPatch, apiPost } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import type {
  JsonObject,
  LexApprovalFormFieldRequest,
  LexApprovalPolicyApprover,
  LexApprovalPolicyMode,
  LexApprovalPolicyQuorum,
} from '@/types/suites';

/* ----------------------------- Enums ----------------------------- */

export type RequestApprovalStage = 'requester' | 'provider';
export type RequestApprovalPolicyStatus = 'draft' | 'active' | 'archived';
export type RequestApprovalPolicyAuditAction =
  | 'created'
  | 'updated'
  | 'archived'
  | 'restored'
  | 'template_applied'
  | string;

/* ----------------------------- Models ----------------------------- */

/**
 * RequestApprovalPolicy is a subject-agnostic approval routing policy scoped to a
 * legal request type. `approvers` / `form_fields` reuse the contract
 * approval-policy payload shapes. A nil/absent scope dimension means "any".
 */
export interface RequestApprovalPolicy {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  status: RequestApprovalPolicyStatus;
  priority: number;
  // Scope dimensions (absent ⇒ "any").
  request_type?: string | null;
  service_id?: string | null;
  stage?: RequestApprovalStage | null;
  department?: string | null;
  priority_tier?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  currency: string;
  // Routing.
  mode: LexApprovalPolicyMode;
  quorum: LexApprovalPolicyQuorum;
  quorum_n?: number | null;
  approvers: LexApprovalPolicyApprover[];
  form_fields: LexApprovalFormFieldRequest[];
  require_authority_evidence: boolean;
  required_role?: string | null;
  required_authority_amount?: number | null;
  metadata: JsonObject;
  version: number;
  valid_from?: string | null;
  valid_until?: string | null;
  template_id?: string | null;
  created_by: string;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

/** Immutable point-in-time snapshot of a policy (append-only history). */
export interface RequestApprovalPolicyVersion {
  id: string;
  policy_id: string;
  tenant_id: string;
  version: number;
  snapshot: RequestApprovalPolicy;
  change_reason?: string;
  created_by?: string | null;
  created_at: string;
}

/** One append-only audit record (before/after may each be null). */
export interface RequestApprovalPolicyAuditEntry {
  id: string;
  tenant_id: string;
  policy_id: string;
  action: RequestApprovalPolicyAuditAction;
  actor_id?: string | null;
  before?: RequestApprovalPolicy | null;
  after?: RequestApprovalPolicy | null;
  request_id?: string;
  created_at: string;
}

/** Reusable named policy definition a concrete policy can be materialised from. */
export interface RequestApprovalPolicyTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: string;
  definition: JsonObject;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

/** Best-match active policy for a concrete request (the recommend endpoint). */
export interface RequestApprovalPolicyRecommendation {
  policy: RequestApprovalPolicy | null;
  matched: boolean;
  reason: string;
}

/* ----------------------------- Payloads ----------------------------- */

export interface CreateRequestApprovalPolicyPayload {
  name: string;
  description?: string;
  status?: RequestApprovalPolicyStatus;
  priority?: number;
  request_type?: string | null;
  service_id?: string | null;
  stage?: RequestApprovalStage | null;
  department?: string | null;
  priority_tier?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  currency?: string;
  mode: string;
  quorum: string;
  quorum_n?: number | null;
  approvers: LexApprovalPolicyApprover[];
  form_fields?: LexApprovalFormFieldRequest[];
  require_authority_evidence?: boolean;
  required_role?: string | null;
  required_authority_amount?: number | null;
  metadata?: JsonObject;
  valid_from?: string | null;
  valid_until?: string | null;
  template_id?: string | null;
}

/** Update patch — omitted fields unchanged; `cleared_fields` reset to NULL. */
export interface UpdateRequestApprovalPolicyPayload
  extends Partial<CreateRequestApprovalPolicyPayload> {
  cleared_fields?: string[];
}

/** Conflict-check body: a candidate policy + optional id to exclude (edit preview). */
export interface RequestApprovalPolicyConflictCheckPayload
  extends CreateRequestApprovalPolicyPayload {
  exclude_id?: string;
}

export interface RequestApprovalPolicyConflictCheckResult {
  /** Overlapping policies (server returns the conflicting policy rows). */
  conflicts: RequestApprovalPolicy[];
  has_conflicts: boolean;
  has_identical: boolean;
}

export interface RequestApprovalPolicyVersionsResult {
  policy_id: string;
  versions: RequestApprovalPolicyVersion[];
}

export interface RequestApprovalPolicyAuditResult {
  policy_id: string;
  entries: RequestApprovalPolicyAuditEntry[];
}

export interface CreateRequestApprovalPolicyTemplatePayload {
  name: string;
  description?: string;
  category?: string;
  definition: JsonObject;
}

export type UpdateRequestApprovalPolicyTemplatePayload =
  Partial<CreateRequestApprovalPolicyTemplatePayload>;

/** Materialise a concrete policy from a template; overrides win per-field. */
export interface InstantiateRequestApprovalPolicyTemplatePayload {
  overrides?: UpdateRequestApprovalPolicyPayload;
}

export interface RecommendRequestApprovalPolicyParams {
  request_type?: string;
  service_id?: string;
  stage?: RequestApprovalStage;
  department?: string;
  priority_tier?: string;
}

/* ----------------------------- API surface ----------------------------- */

const BASE = '/api/v1/lex/request-approval/policies';

export const lexRequestApprovalPoliciesApi = {
  // --- Policies ---
  listPolicies: (params: FetchParams): Promise<PaginatedResponse<RequestApprovalPolicy>> =>
    fetchSuitePaginated<RequestApprovalPolicy>(BASE, params),
  getPolicy: (id: string): Promise<RequestApprovalPolicy> => fetchSuiteData(`${BASE}/${id}`),
  createPolicy: (payload: CreateRequestApprovalPolicyPayload): Promise<RequestApprovalPolicy> =>
    apiPost<{ data: RequestApprovalPolicy }>(BASE, payload).then((res) => res.data),
  updatePolicy: (
    id: string,
    payload: UpdateRequestApprovalPolicyPayload,
  ): Promise<RequestApprovalPolicy> =>
    apiPatch<{ data: RequestApprovalPolicy }>(`${BASE}/${id}`, payload).then((res) => res.data),
  archivePolicy: (id: string): Promise<RequestApprovalPolicy> =>
    apiPost<{ data: RequestApprovalPolicy }>(`${BASE}/${id}/archive`, {}).then((res) => res.data),
  deletePolicy: (id: string): Promise<void> => apiDelete<void>(`${BASE}/${id}`),

  // --- Guidance: conflict-check + recommend ---
  conflictCheck: (
    payload: RequestApprovalPolicyConflictCheckPayload,
  ): Promise<RequestApprovalPolicyConflictCheckResult> =>
    apiPost<{ data: RequestApprovalPolicyConflictCheckResult }>(
      `${BASE}/conflict-check`,
      payload,
    ).then((res) => res.data),
  recommendPolicy: (
    params: RecommendRequestApprovalPolicyParams,
  ): Promise<RequestApprovalPolicyRecommendation> =>
    fetchSuiteData(`${BASE}/recommend`, params as Record<string, unknown>),

  // --- Governance: versions + audit ---
  listVersions: (id: string): Promise<RequestApprovalPolicyVersionsResult> =>
    fetchSuiteData(`${BASE}/${id}/versions`),
  getVersion: (id: string, version: number): Promise<RequestApprovalPolicyVersion> =>
    fetchSuiteData(`${BASE}/${id}/versions/${version}`),
  restoreVersion: (id: string, version: number): Promise<RequestApprovalPolicy> =>
    apiPost<{ data: RequestApprovalPolicy }>(`${BASE}/${id}/versions/${version}/restore`, {}).then(
      (res) => res.data,
    ),
  listAudit: (id: string): Promise<RequestApprovalPolicyAuditResult> =>
    fetchSuiteData(`${BASE}/${id}/audit`),

  // --- Templates ---
  listTemplates: (): Promise<RequestApprovalPolicyTemplate[]> => fetchSuiteData(`${BASE}/templates`),
  getTemplate: (id: string): Promise<RequestApprovalPolicyTemplate> =>
    fetchSuiteData(`${BASE}/templates/${id}`),
  createTemplate: (
    payload: CreateRequestApprovalPolicyTemplatePayload,
  ): Promise<RequestApprovalPolicyTemplate> =>
    apiPost<{ data: RequestApprovalPolicyTemplate }>(`${BASE}/templates`, payload).then(
      (res) => res.data,
    ),
  updateTemplate: (
    id: string,
    payload: UpdateRequestApprovalPolicyTemplatePayload,
  ): Promise<RequestApprovalPolicyTemplate> =>
    apiPatch<{ data: RequestApprovalPolicyTemplate }>(`${BASE}/templates/${id}`, payload).then(
      (res) => res.data,
    ),
  deleteTemplate: (id: string): Promise<void> => apiDelete<void>(`${BASE}/templates/${id}`),
  instantiateTemplate: (
    id: string,
    payload: InstantiateRequestApprovalPolicyTemplatePayload,
  ): Promise<RequestApprovalPolicy> =>
    apiPost<{ data: RequestApprovalPolicy }>(`${BASE}/templates/${id}/instantiate`, payload).then(
      (res) => res.data,
    ),
};
