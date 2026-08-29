'use client';

/**
 * CAP-109 data hook — the contract regulatory-compliance check.
 *
 * Reads the matched-issue list + open/resolved roll-up from
 * `GET /api/v1/lex/contracts/{id}/compliance-check`, and exposes mutations to record a
 * per-issue review (`POST .../compliance-reviews`) and flip its open/resolved
 * disposition (`PUT .../compliance-reviews/{reviewId}`). Uses the lib/api
 * helpers directly (per the per-cap hook convention) and invalidates the check
 * query after each write so the list + KPI strip re-roll-up.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiPost, apiPut } from '@/lib/api';

export type ComplianceReviewStatus = 'open' | 'resolved';

export type ComplianceSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'none';

export interface ComplianceItem {
  flag_ref: string;
  title: string;
  description: string;
  severity: ComplianceSeverity;
  clause_reference?: string | null;
  rule?: string | null;
  rule_type?: string | null;
  remediation?: string | null;
  status: ComplianceReviewStatus;
  note: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

export interface ComplianceCheck {
  contract_id: string;
  generated_at: string;
  total: number;
  open: number;
  resolved: number;
  items: ComplianceItem[];
  has_analysis: boolean;
}

export interface ComplianceReview {
  id: string;
  contract_id: string;
  flag_ref: string;
  status: ComplianceReviewStatus;
  note: string;
}

const EMPTY_CHECK: ComplianceCheck = {
  contract_id: '',
  generated_at: '',
  total: 0,
  open: 0,
  resolved: 0,
  items: [],
  has_analysis: false,
};

export function complianceCheckKey(contractId: string) {
  return ['lex-contract-compliance-check', contractId] as const;
}

export function useComplianceCheck(contractId: string) {
  const query = useQuery({
    queryKey: complianceCheckKey(contractId),
    queryFn: () =>
      apiGet<{ data: ComplianceCheck }>(
        `/api/v1/lex/contracts/${contractId}/compliance-check`,
      ),
    enabled: Boolean(contractId),
  });

  return {
    ...query,
    check: query.data?.data ?? EMPTY_CHECK,
  };
}

export interface RecordComplianceReviewInput {
  flag_ref: string;
  status: ComplianceReviewStatus;
  note?: string;
}

/**
 * useRecordComplianceReview upserts the triage of a single flag (POST). The
 * backend keys on (tenant, contract, flag_ref), so a repeated call for the same
 * flag replaces the prior disposition in place — this is how the resolve toggle
 * flips a flag with no prior review row.
 */
export function useRecordComplianceReview(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordComplianceReviewInput) =>
      apiPost<{ data: ComplianceReview }>(
        `/api/v1/lex/contracts/${contractId}/compliance-reviews`,
        input,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: complianceCheckKey(contractId) });
    },
  });
}

export interface UpdateComplianceReviewInput {
  reviewId: string;
  status: ComplianceReviewStatus;
  note?: string;
}

/**
 * useUpdateComplianceReview flips an EXISTING review row (PUT). Use this when a
 * flag already has a review id; otherwise record (POST) which upserts.
 */
export function useUpdateComplianceReview(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, status, note }: UpdateComplianceReviewInput) =>
      apiPut<{ data: ComplianceReview }>(
        `/api/v1/lex/contracts/${contractId}/compliance-reviews/${reviewId}`,
        { status, note },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: complianceCheckKey(contractId) });
    },
  });
}
