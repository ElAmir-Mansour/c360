'use client';

/**
 * CAP-123 — Manual contract classify / categorize · data hooks.
 *
 * Thin react-query bindings over the CAP-123 backend (distinct from the AI
 * `/classify` ClassificationResult path):
 *   GET  /api/v1/lex/contracts/categories        -> ContractCategory[]  (tenant catalog)
 *   POST /api/v1/lex/contracts/{id}/categorize   -> ContractCategorizationResult
 *
 * These live in a per-cap hook file (NOT a shared api client) and use the
 * `lib/api` apiGet/apiPost helpers directly, unwrapping the suite `{ data }`
 * envelope. The categorize mutation invalidates the contract-detail caches so the
 * applied-category chips + tags reconcile with the server.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

/** One entry of a tenant's manual contract-category catalog. */
export interface ContractCategory {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  sort_order: number;
}

/** Result of applying manual categories to a contract. */
export interface ContractCategorizationResult {
  contract_id: string;
  category_tags: string[];
  tags: string[];
  categorized_at: string;
  categorized_by: string;
}

const CATEGORIES_URL = '/api/v1/lex/contracts/categories';
const CATEGORIZE_URL = (contractId: string) =>
  `/api/v1/lex/contracts/${contractId}/categorize`;

/** Stable query key for the tenant category catalog. */
export function contractCategoriesQueryKey(): readonly unknown[] {
  return ['lex-contract-categories'];
}

/** Fetch the tenant's manual category catalog (the multi-select feed). */
export function useContractCategories() {
  return useQuery({
    queryKey: contractCategoriesQueryKey(),
    queryFn: async (): Promise<ContractCategory[]> => {
      const res = await apiGet<{ data: ContractCategory[] }>(CATEGORIES_URL);
      return res.data ?? [];
    },
  });
}

/**
 * Apply operator-selected category slugs to a contract. On success the caller is
 * expected to refresh the contract detail; we invalidate the broad contract
 * caches here so list/detail surfaces re-render with the new tags.
 */
export function useCategorizeContract(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      categoryTags: string[],
    ): Promise<ContractCategorizationResult> => {
      const res = await apiPost<{ data: ContractCategorizationResult }>(
        CATEGORIZE_URL(contractId),
        { category_tags: categoryTags },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lex-contract', contractId] });
      void queryClient.invalidateQueries({ queryKey: ['lex-contracts'] });
    },
  });
}
