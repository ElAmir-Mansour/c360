'use client';

/**
 * CAP-094..125 — Contract review-desk react-query hooks.
 *
 * Query + mutation hooks over `reviewDeskApi` for the contract review REQUEST
 * journey (intake receipt/acknowledge/route/return, named-slot attachment upload,
 * completeness gating, distribution, and the append-only correspondence thread).
 *
 * The desk overview uses its own cache key (`reviewDeskOverviewKey`) distinct from
 * the recommendation-only key in `use-final-version.ts`; mutations that can change
 * the recommendation (none here — recommendation lives in the RecommendationDialog)
 * still invalidate the contract detail so the lifecycle surface stays coherent.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { enterpriseApi } from '@/lib/enterprise';
import { reviewDeskQueryKey } from './use-final-version';
import {
  reviewDeskApi,
  type AddCorrespondencePayload,
  type ContractAttachmentSlot,
  type OpenIntakePayload,
  type ReturnIntakePayload,
  type RouteIntakePayload,
} from './review-desk-api';

/** Cache key for the full desk overview (intake + requirements + attachments). */
export function reviewDeskOverviewKey(contractId: string) {
  return ['lex-contract-review-desk-overview', contractId] as const;
}

/** Cache key for the paginated correspondence thread. */
export function correspondenceKey(contractId: string) {
  return ['lex-contract-review-desk-correspondence', contractId] as const;
}

export function useReviewDeskOverview(contractId: string) {
  return useQuery({
    queryKey: reviewDeskOverviewKey(contractId),
    queryFn: () => reviewDeskApi.overview(contractId),
    enabled: Boolean(contractId),
  });
}

export function useReviewDeskCorrespondence(contractId: string) {
  return useQuery({
    queryKey: correspondenceKey(contractId),
    queryFn: () => reviewDeskApi.listCorrespondence(contractId, { page: 1, per_page: 100 }),
    enabled: Boolean(contractId),
  });
}

/**
 * Shared invalidation for every desk mutation: refresh the overview + the
 * contract detail (assigned reviewer, workflow linkage) + the recommendation key
 * so the final-version modal reflects the latest desk state.
 */
function useDeskInvalidation(contractId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reviewDeskOverviewKey(contractId) }),
      queryClient.invalidateQueries({ queryKey: reviewDeskQueryKey(contractId) }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-timeline', contractId] }),
    ]);
  };
}

export function useOpenIntake(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: (payload: OpenIntakePayload) => reviewDeskApi.openIntake(contractId, payload),
    onSuccess: invalidate,
  });
}

export function useAcknowledgeIntake(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: (notes?: string) => reviewDeskApi.acknowledge(contractId, notes),
    onSuccess: invalidate,
  });
}

export function useRouteToLegal(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: (payload: RouteIntakePayload) => reviewDeskApi.routeToLegal(contractId, payload),
    onSuccess: invalidate,
  });
}

export function useDistributeContract(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: (payload: RouteIntakePayload) => reviewDeskApi.distribute(contractId, payload),
    onSuccess: invalidate,
  });
}

export function useReturnToRequester(contractId: string) {
  const queryClient = useQueryClient();
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: (payload: ReturnIntakePayload) =>
      reviewDeskApi.returnToRequester(contractId, payload),
    onSuccess: async () => {
      await invalidate();
      // A return records an auto-return correspondence entry (CAP-116).
      await queryClient.invalidateQueries({ queryKey: correspondenceKey(contractId) });
    },
  });
}

export function useCheckCompleteness(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: () => reviewDeskApi.checkCompleteness(contractId),
    onSuccess: invalidate,
  });
}

export function useDeleteAttachment(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: (attachmentId: string) =>
      reviewDeskApi.deleteAttachment(contractId, attachmentId),
    onSuccess: invalidate,
  });
}

export function useAddCorrespondence(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddCorrespondencePayload) =>
      reviewDeskApi.addCorrespondence(contractId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: correspondenceKey(contractId) });
    },
  });
}

/**
 * Upload a named-slot attachment: push the file to the files service (scoped to
 * this contract) then register the review-desk attachment against the slot. A new
 * upload into an occupied slot supersedes the prior one server-side (CAP-115).
 */
export function useUploadAttachment(contractId: string) {
  const invalidate = useDeskInvalidation(contractId);
  return useMutation({
    mutationFn: async ({
      slot,
      file,
      notes,
      onProgress,
    }: {
      slot: ContractAttachmentSlot;
      file: File;
      notes?: string;
      onProgress?: (progress: number) => void;
    }) => {
      const uploaded = await enterpriseApi.files.upload(
        file,
        {
          suite: 'lex',
          entity_type: 'contract_review_attachment',
          entity_id: contractId,
          tags: ['contract', 'review-desk', slot].join(','),
          lifecycle_policy: 'standard',
        },
        onProgress,
      );
      return reviewDeskApi.uploadAttachment(contractId, {
        slot,
        file_id: uploaded.id,
        file_name: uploaded.original_name,
        file_size_bytes: uploaded.size_bytes,
        content_hash: uploaded.checksum_sha256,
        notes: notes?.trim() ? notes.trim() : undefined,
      });
    },
    onSuccess: invalidate,
  });
}
