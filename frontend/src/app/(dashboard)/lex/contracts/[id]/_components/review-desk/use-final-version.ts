'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

// ── Types (CAP-117) ─────────────────────────────────────────────────────────
// Narrow, per-cap shapes mirroring the lex review-desk overview + final-version
// response envelopes. These are intentionally local (not added to the shared
// types index) so the cap composes without touching shared files.

export type ContractRecommendationOutcome =
  | 'approved'
  | 'needs_amendment'
  | 'rejected';

export interface ContractRecommendation {
  id: string;
  contract_id: string;
  outcome: ContractRecommendationOutcome;
  summary: string;
  superseded: boolean;
  created_at: string;
}

interface ReviewDeskOverview {
  contract_id: string;
  // The active (non-superseded) recommendation, present once the desk has
  // recorded a final recommendation. Absent until then.
  recommendation?: ContractRecommendation | null;
}

// RecordRecommendationRequest records the review-desk final recommendation
// (CAP-118..120). amendment_reason is required for needs_amendment and
// rejection_reason for rejected; an approved outcome MUST start the
// Contracts-Manager approval workflow (start_approval), and it is that approved
// recommendation which unlocks the final-version upload.
export interface RecordRecommendationRequest {
  outcome: ContractRecommendationOutcome;
  summary: string;
  amendment_reason?: string;
  rejection_reason?: string;
  start_approval: boolean;
}

export interface UploadFinalVersionRequest {
  file_id: string;
  file_name: string;
  file_size_bytes: number;
  content_hash: string;
  extracted_text: string;
  change_summary: string;
}

export interface ContractFinalVersionResult {
  contract_id: string;
  version: {
    id: string;
    version: number;
    file_name: string;
    uploaded_at: string;
  };
  previous_status: string;
  status: string;
  final_uploaded_at: string;
}

// reviewDeskQueryKey is the shared cache key for the review-desk overview so the
// final-version success path (and any sibling review-desk surface) can invalidate
// it consistently.
export function reviewDeskQueryKey(contractId: string) {
  return ['lex-contract-review-desk', contractId] as const;
}

// useReviewDeskRecommendation reads the contract's active review-desk
// recommendation from the overview endpoint. The final-version modal unlocks ONLY
// when this resolves to outcome === 'approved' (CAP-117 gate).
export function useReviewDeskRecommendation(contractId: string) {
  const query = useQuery({
    queryKey: reviewDeskQueryKey(contractId),
    queryFn: () =>
      apiGet<{ data: ReviewDeskOverview }>(
        `/api/v1/lex/contracts/${contractId}/review-desk`,
      ).then((res) => res.data),
    enabled: Boolean(contractId),
  });
  const recommendation = query.data?.recommendation ?? null;
  return {
    ...query,
    recommendation,
    isApproved: recommendation?.outcome === 'approved',
  };
}

// recordRecommendation records the review-desk final recommendation
// (POST /contracts/{id}/review-desk/recommendation, approval-write tier). This is
// the only producer of a recommendation; recording an `approved` outcome flips the
// review-desk overview's recommendation to approved, which unlocks the
// final-version upload. The backend enforces the reviewer role (CAP-106) and that
// intake is opened + passed completeness (409/403 otherwise), surfaced to the
// caller unchanged.
export async function recordRecommendation(
  contractId: string,
  req: RecordRecommendationRequest,
): Promise<ContractRecommendation> {
  const res = await apiPost<{ data: ContractRecommendation }>(
    `/api/v1/lex/contracts/${contractId}/review-desk/recommendation`,
    req,
  );
  return res.data;
}

// uploadFinalVersion posts the FINAL approved contract version through the
// review-desk ceremony (CAP-117). The backend enforces the approval gate (409 if
// the latest recommendation is not approved).
export async function uploadFinalVersion(
  contractId: string,
  req: UploadFinalVersionRequest,
): Promise<ContractFinalVersionResult> {
  const res = await apiPost<{ data: ContractFinalVersionResult }>(
    `/api/v1/lex/contracts/${contractId}/review-desk/final-version`,
    req,
  );
  return res.data;
}
