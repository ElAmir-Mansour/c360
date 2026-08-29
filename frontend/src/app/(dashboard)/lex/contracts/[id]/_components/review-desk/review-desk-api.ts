/**
 * CAP-094..125 — Contract review-desk fe-client.
 *
 * Self-contained data layer for the contract review REQUEST journey that the
 * backend (contract_review_desk_handler.go) already exposes under
 * `/api/v1/lex/contracts/{id}/review-desk/*`. It talks directly to the lex
 * gateway via the shared axios helpers (apiGet/apiPost/apiPut/apiDelete) and
 * unwraps the `{ data }` / `{ data, meta }` envelopes inline — deliberately NOT
 * routed through the shared enterprise/suites client so this cap stays
 * self-contained and composes in parallel with the rest of the contract surface.
 *
 * Shapes mirror the backend models VERBATIM (contract_intake.go,
 * contract_attachment.go, contract_correspondence.go, contract_recommendation.go)
 * so the desk overview / attachment / completeness / correspondence surfaces read
 * the server rows without a translation layer.
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { PaginationMeta } from '@/types/api';

const BASE = '/api/v1/lex/contracts';

/** review-desk endpoint builder for a contract. */
function deskPath(contractId: string, suffix = ''): string {
  return `${BASE}/${contractId}/review-desk${suffix}`;
}

/* ── Enums (mirror the backend model string enums) ────────────────────────── */

/**
 * Named attachment slots (contract_attachment.go). The five Othaim PRD §9.1
 * slots are the canonical intake set; the four original slots are retained for
 * backward compatibility with historical intakes.
 */
export type ContractAttachmentSlot =
  | 'foundation_document'
  | 'purpose_of_contract'
  | 'authorized_person_id'
  | 'power_of_attorney'
  | 'addendum_prior_docs'
  | 'draft'
  | 'quotation'
  | 'commercial_registration'
  | 'committee_decision';

/** The five PRD §9.1 slots surfaced as the primary upload targets, in order. */
export const PRD_ATTACHMENT_SLOTS = [
  'foundation_document',
  'purpose_of_contract',
  'authorized_person_id',
  'power_of_attorney',
  'addendum_prior_docs',
] as const satisfies readonly ContractAttachmentSlot[];

/**
 * Default required/optional per PRD §9.1, mirroring the backend intake seed
 * (contract_review_desk_service.go contractAttachmentSlotSeeds). Foundation
 * document, purpose, and authorized-person ID are always required; power of
 * attorney (only when the signatory acts by delegation) and the addendum / prior
 * documents (only for amendments/renewals) default optional. Used only for the
 * pre-intake preview badge; once an intake is opened the real backend requirement
 * rows drive the Required/Optional badge.
 */
export const PRD_SLOT_REQUIRED_DEFAULTS: Record<
  (typeof PRD_ATTACHMENT_SLOTS)[number],
  boolean
> = {
  foundation_document: true,
  purpose_of_contract: true,
  authorized_person_id: true,
  power_of_attorney: false,
  addendum_prior_docs: false,
};

export type ContractIntakeStatus =
  | 'received'
  | 'acknowledged'
  | 'routed_to_legal'
  | 'under_review'
  | 'returned'
  | 'completed';

export type ContractCorrespondenceKind =
  | 'internal'
  | 'clarification'
  | 'auto_return';

export type ContractCorrespondenceDirection =
  | 'internal'
  | 'outbound'
  | 'inbound';

export type ContractRecommendationOutcome =
  | 'approved'
  | 'needs_amendment'
  | 'rejected';

/* ── Read models (mirror backend JSON) ────────────────────────────────────── */

export interface ContractIntake {
  id: string;
  tenant_id: string;
  contract_id: string;
  reference_number: string;
  status: ContractIntakeStatus;
  received_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  routed_to_legal_at?: string | null;
  routed_to_legal_by?: string | null;
  assigned_reviewer_id?: string | null;
  assigned_reviewer_name?: string | null;
  completeness_checked: boolean;
  completeness_passed: boolean;
  last_checked_at?: string | null;
  returned_at?: string | null;
  returned_by?: string | null;
  return_reason?: string | null;
  deficiency_notice?: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractAttachmentRequirement {
  id: string;
  tenant_id: string;
  contract_id: string;
  slot: ContractAttachmentSlot;
  required: boolean;
  label: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractAttachment {
  id: string;
  tenant_id: string;
  contract_id: string;
  slot: ContractAttachmentSlot;
  file_id?: string | null;
  file_name: string;
  file_size_bytes: number;
  content_hash?: string | null;
  version: number;
  superseded: boolean;
  notes?: string | null;
  metadata: Record<string, unknown> | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ContractCompletenessSlot {
  slot: ContractAttachmentSlot;
  label: string;
  required: boolean;
  satisfied: boolean;
  attachment_id?: string | null;
  file_name?: string | null;
}

export interface ContractCompletenessResult {
  contract_id: string;
  complete: boolean;
  missing_slots: ContractAttachmentSlot[];
  slots: ContractCompletenessSlot[];
  checked_at: string;
}

export interface ContractRecommendation {
  id: string;
  contract_id: string;
  intake_id?: string | null;
  outcome: ContractRecommendationOutcome;
  summary: string;
  amendment_reason?: string | null;
  rejection_reason?: string | null;
  workflow_instance_id?: string | null;
  superseded: boolean;
  recommended_by_name?: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractCorrespondence {
  id: string;
  tenant_id: string;
  contract_id: string;
  intake_id?: string | null;
  kind: ContractCorrespondenceKind;
  direction: ContractCorrespondenceDirection;
  subject: string;
  body: string;
  author_name?: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
}

/** Aggregate desk read model (contract_review_desk_dto.go ContractReviewDeskView). */
export interface ContractReviewDeskView {
  contract_id: string;
  intake?: ContractIntake | null;
  requirements: ContractAttachmentRequirement[];
  attachments: ContractAttachment[];
  completeness?: ContractCompletenessResult | null;
  recommendation?: ContractRecommendation | null;
}

/* ── Write payloads (mirror backend request DTOs) ─────────────────────────── */

export interface OpenIntakePayload {
  assigned_reviewer_id?: string;
  assigned_reviewer_name?: string;
  notes?: string;
}

export interface RouteIntakePayload {
  assigned_reviewer_id?: string;
  assigned_reviewer_name?: string;
  notes?: string;
}

export interface ReturnIntakePayload {
  reason: string;
  deficiency_notice?: string;
}

export interface UploadAttachmentPayload {
  slot: ContractAttachmentSlot;
  file_id?: string;
  file_name: string;
  file_size_bytes: number;
  content_hash?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface AddCorrespondencePayload {
  kind: ContractCorrespondenceKind;
  direction?: ContractCorrespondenceDirection;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface CorrespondencePage {
  data: ContractCorrespondence[];
  meta: PaginationMeta;
}

/* ── Client ───────────────────────────────────────────────────────────────── */

export const reviewDeskApi = {
  overview: (contractId: string): Promise<ContractReviewDeskView> =>
    apiGet<{ data: ContractReviewDeskView }>(deskPath(contractId)).then((res) => res.data),

  openIntake: (contractId: string, payload: OpenIntakePayload): Promise<ContractIntake> =>
    apiPost<{ data: ContractIntake }>(deskPath(contractId, '/intake'), payload).then(
      (res) => res.data,
    ),

  acknowledge: (contractId: string, notes?: string): Promise<ContractIntake> =>
    apiPost<{ data: ContractIntake }>(deskPath(contractId, '/intake/acknowledge'), {
      notes,
    }).then((res) => res.data),

  routeToLegal: (contractId: string, payload: RouteIntakePayload): Promise<ContractIntake> =>
    apiPost<{ data: ContractIntake }>(deskPath(contractId, '/intake/route'), payload).then(
      (res) => res.data,
    ),

  returnToRequester: (
    contractId: string,
    payload: ReturnIntakePayload,
  ): Promise<ContractIntake> =>
    apiPost<{ data: ContractIntake }>(deskPath(contractId, '/intake/return'), payload).then(
      (res) => res.data,
    ),

  distribute: (contractId: string, payload: RouteIntakePayload): Promise<ContractIntake> =>
    apiPost<{ data: ContractIntake }>(deskPath(contractId, '/distribute'), payload).then(
      (res) => res.data,
    ),

  listAttachments: (
    contractId: string,
    includeSuperseded = false,
  ): Promise<ContractAttachment[]> =>
    apiGet<{ data: ContractAttachment[] }>(
      deskPath(contractId, '/attachments'),
      includeSuperseded ? { include_superseded: 'true' } : undefined,
    ).then((res) => res.data ?? []),

  uploadAttachment: (
    contractId: string,
    payload: UploadAttachmentPayload,
  ): Promise<ContractAttachment> =>
    apiPost<{ data: ContractAttachment }>(deskPath(contractId, '/attachments'), payload).then(
      (res) => res.data,
    ),

  deleteAttachment: (contractId: string, attachmentId: string): Promise<void> =>
    apiDelete<void>(deskPath(contractId, `/attachments/${attachmentId}`)),

  checkCompleteness: (contractId: string): Promise<ContractCompletenessResult> =>
    apiPost<{ data: ContractCompletenessResult }>(
      deskPath(contractId, '/completeness'),
      {},
    ).then((res) => res.data),

  listCorrespondence: (
    contractId: string,
    params?: { page?: number; per_page?: number; kind?: ContractCorrespondenceKind },
  ): Promise<CorrespondencePage> =>
    apiGet<CorrespondencePage>(deskPath(contractId, '/correspondence'), params),

  addCorrespondence: (
    contractId: string,
    payload: AddCorrespondencePayload,
  ): Promise<ContractCorrespondence> =>
    apiPost<{ data: ContractCorrespondence }>(
      deskPath(contractId, '/correspondence'),
      payload,
    ).then((res) => res.data),
};
