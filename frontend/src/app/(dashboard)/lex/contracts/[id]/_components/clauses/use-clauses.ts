'use client';

/**
 * CAP-107 — Clause-by-clause review · data hooks.
 *
 * Thin react-query bindings over the already-shipped clause-review backend
 * (`routes.go:283-286`):
 *   GET  /api/v1/lex/contracts/{id}/clauses              -> LexClause[]
 *   PUT  /api/v1/lex/contracts/{id}/clauses/{cid}/review -> LexClause  ({status, notes})
 *
 * These live in a per-cap hook file (NOT the shared `enterprise/api.ts`) and
 * use the `lib/api` apiGet/apiPut helpers directly, unwrapping the suite
 * `{ data }` envelope. The mutation applies an optimistic clause update against
 * the list cache, then invalidates so the contract-detail surface refreshes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '@/lib/api';
import type { LexClause, LexClauseReviewStatus } from '@/types/suites';

/** Stable query key for a contract's clause list. */
export function clausesQueryKey(contractId: string): readonly unknown[] {
  return ['lex-contract-clauses', contractId];
}

const CLAUSES_BASE = (contractId: string) =>
  `/api/v1/lex/contracts/${contractId}/clauses`;

/** Fetch the clause list for a contract (suite `{ data }` envelope unwrapped). */
export function useClauses(contractId: string) {
  return useQuery({
    queryKey: clausesQueryKey(contractId),
    queryFn: async (): Promise<LexClause[]> => {
      const res = await apiGet<{ data: LexClause[] }>(CLAUSES_BASE(contractId));
      return res.data ?? [];
    },
    enabled: Boolean(contractId),
  });
}

export interface ClauseReviewPayload {
  status: LexClauseReviewStatus;
  notes: string;
}

/**
 * Persist a clause review (`PUT …/{clauseId}/review`) with an optimistic update
 * against the clause-list cache, rolling back on error and invalidating on
 * settle so the panel + analysis tab reconcile with the server.
 */
export function useUpdateClauseReview(contractId: string) {
  const queryClient = useQueryClient();
  const key = clausesQueryKey(contractId);

  return useMutation({
    mutationFn: async ({
      clauseId,
      payload,
    }: {
      clauseId: string;
      payload: ClauseReviewPayload;
    }): Promise<LexClause> => {
      const res = await apiPut<{ data: LexClause }>(
        `${CLAUSES_BASE(contractId)}/${clauseId}/review`,
        payload,
      );
      return res.data;
    },
    onMutate: async ({ clauseId, payload }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LexClause[]>(key);
      if (previous) {
        queryClient.setQueryData<LexClause[]>(
          key,
          previous.map((clause) =>
            clause.id === clauseId
              ? {
                  ...clause,
                  review_status: payload.status,
                  review_notes: payload.notes,
                }
              : clause,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
