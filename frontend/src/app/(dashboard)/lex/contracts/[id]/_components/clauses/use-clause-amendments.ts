'use client';

/**
 * CAP-111 — Propose clause amendments · data hooks.
 *
 * Thin react-query bindings over the clause-amendments backend
 * (`POST/GET /contracts/{id}/clauses/{clauseId}/amendments`,
 *  `PUT  …/amendments/{amendmentId}/decide`):
 *
 *   GET  /api/v1/lex/contracts/{id}/clauses/{cid}/amendments
 *          -> LexClauseAmendment[]
 *   POST /api/v1/lex/contracts/{id}/clauses/{cid}/amendments
 *          ({ proposed_text, original_text?, reason? }) -> LexClauseAmendment
 *   PUT  /api/v1/lex/contracts/{id}/clauses/{cid}/amendments/{aid}/decide
 *          ({ status: 'accepted' | 'rejected' }) -> LexClauseAmendment
 *
 * These live in a per-cap hook file (NOT the shared `enterprise/api.ts`) and use
 * the `lib/api` apiGet/apiPost/apiPut helpers directly, unwrapping the suite
 * `{ data }` envelope. `proposed_by` / `status` / decision stamps are derived
 * server-side from the JWT — the client never sends them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '@/lib/api';

export type LexClauseAmendmentStatus = 'proposed' | 'accepted' | 'rejected';

export interface LexClauseAmendment {
  id: string;
  tenant_id: string;
  clause_id: string;
  contract_id: string;
  original_text: string;
  proposed_text: string;
  reason: string;
  status: LexClauseAmendmentStatus;
  proposed_by: string;
  decided_by?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface ProposeAmendmentPayload {
  proposed_text: string;
  original_text?: string;
  reason?: string;
}

/** Stable query key for a clause's amendment list. */
export function clauseAmendmentsQueryKey(
  contractId: string,
  clauseId: string,
): readonly unknown[] {
  return ['lex-clause-amendments', contractId, clauseId];
}

const AMENDMENTS_BASE = (contractId: string, clauseId: string) =>
  `/api/v1/lex/contracts/${contractId}/clauses/${clauseId}/amendments`;

/** Fetch the amendment list for a clause (suite `{ data }` envelope unwrapped). */
export function useClauseAmendments(contractId: string, clauseId: string) {
  return useQuery({
    queryKey: clauseAmendmentsQueryKey(contractId, clauseId),
    queryFn: async (): Promise<LexClauseAmendment[]> => {
      const res = await apiGet<{ data: LexClauseAmendment[] }>(
        AMENDMENTS_BASE(contractId, clauseId),
      );
      return res.data ?? [];
    },
    enabled: Boolean(contractId) && Boolean(clauseId),
  });
}

/** Propose a redlined amendment for a clause; invalidates the amendment list. */
export function useProposeClauseAmendment(contractId: string, clauseId: string) {
  const queryClient = useQueryClient();
  const key = clauseAmendmentsQueryKey(contractId, clauseId);

  return useMutation({
    mutationFn: async (
      payload: ProposeAmendmentPayload,
    ): Promise<LexClauseAmendment> => {
      const res = await apiPost<{ data: LexClauseAmendment }>(
        AMENDMENTS_BASE(contractId, clauseId),
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Accept / reject a proposed amendment; invalidates the amendment list. */
export function useDecideClauseAmendment(contractId: string, clauseId: string) {
  const queryClient = useQueryClient();
  const key = clauseAmendmentsQueryKey(contractId, clauseId);

  return useMutation({
    mutationFn: async ({
      amendmentId,
      status,
    }: {
      amendmentId: string;
      status: Exclude<LexClauseAmendmentStatus, 'proposed'>;
    }): Promise<LexClauseAmendment> => {
      const res = await apiPut<{ data: LexClauseAmendment }>(
        `${AMENDMENTS_BASE(contractId, clauseId)}/${amendmentId}/decide`,
        { status },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
