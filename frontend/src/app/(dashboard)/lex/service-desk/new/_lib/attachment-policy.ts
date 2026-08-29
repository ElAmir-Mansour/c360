'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPost } from '@/lib/api';
import {
  lexAdminApi,
  LEX_ADMIN_ENDPOINTS,
  type AttachmentPolicy,
  type AttachmentSlot,
} from '@/lib/lex/admin';
import type { StagedAttachment } from './attachments-types';

/**
 * Requester-facing attachment-requirement resolution for the intake wizard
 * (PRD 14.1).
 *
 * The Legal-Affairs backend already owns the completeness gate: the admin
 * AttachmentPolicy surface (`/api/v1/lex/attachment-policies`) exposes a
 * FindApplicable + Evaluate pipeline (see
 * `backend/internal/lex/service/attachment_policy_service.go`). Historically the
 * intake wizard hard-coded "Attachments optional" and never consulted it, so a
 * submitter only discovered a missing mandatory document at the provider-side
 * completeness check. This module wires the wizard to the SAME endpoints:
 *
 *  - `POST /attachment-policies/evaluate` resolves the applicable policy (by
 *    service_code, falling back to request_type — identical precedence to the
 *    server) and returns the authoritative verdict for a candidate set of
 *    provided slot keys + count. It is the single source of truth for what
 *    "required" means, so the wizard never drifts from the provider gate.
 *  - `GET /attachment-policies/{id}` hydrates the resolved policy's named slots
 *    (with bilingual labels) for display, once evaluate has told us which policy
 *    applies.
 *
 * Reads on both routes are gated on `lex:catalog:view | lex:view | lex:read`;
 * every requester who can reach the intake wizard holds `lex:view`. Should the
 * lookup fail for any reason we FAIL OPEN (treat the request type as having no
 * requirement) so a transient error can never wrongly block a legitimate submit.
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Mirror of `model.AttachmentPolicyEvaluation` (the backend completeness verdict). */
export interface AttachmentPolicyEvaluation {
  policy_id: string;
  request_type: string;
  service_code: string;
  required_count: number;
  max_allowed_count: number;
  provided_count: number;
  count_satisfied: boolean;
  count_exceeded: boolean;
  missing_slots: string[];
  slots_satisfied: boolean;
  complete: boolean;
  evaluated_at_unix: number;
}

interface EvaluateInput {
  request_type: string;
  service_code: string;
  provided_slots: string[];
  provided_count: number;
}

/** Calls the shared AttachmentPolicy evaluate endpoint (source of truth). */
async function evaluateAttachmentPolicy(
  input: EvaluateInput,
): Promise<AttachmentPolicyEvaluation> {
  const res = await apiPost<{ data: AttachmentPolicyEvaluation }>(
    `${LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES}/evaluate`,
    input,
  );
  return res.data;
}

/** Distinct, non-empty, lower-cased slot keys currently assigned to staged files. */
export function providedSlotKeys(attachments: StagedAttachment[]): string[] {
  const seen = new Set<string>();
  for (const a of attachments) {
    const key = (a.slotKey ?? '').trim().toLowerCase();
    if (key) seen.add(key);
  }
  return Array.from(seen).sort();
}

export interface UseAttachmentPolicyArgs {
  /** Service catalog `code` (preferred match key). */
  serviceCode?: string;
  /** Service catalog `request_type` (fallback match key). */
  requestType?: string;
  attachments: StagedAttachment[];
  /** Gate the whole lookup (e.g. only once a service is selected). */
  enabled?: boolean;
}

export interface AttachmentPolicyState {
  /** Fully-hydrated applicable policy (slots + labels), or null when none applies. */
  policy: AttachmentPolicy | null;
  /** Authoritative completeness verdict from the backend, or null. */
  evaluation: AttachmentPolicyEvaluation | null;
  loading: boolean;
  /** True when a policy applies (a requirement or expected-document set exists). */
  hasPolicy: boolean;
  /** True when the policy actually constrains submission (min count and/or a required slot). */
  hasRequirement: boolean;
  requiredCount: number;
  maxCount: number;
  providedCount: number;
  /** Lower-cased keys of required slots not yet provided. */
  missingSlotKeys: string[];
  requiredSlots: AttachmentSlot[];
  optionalSlots: AttachmentSlot[];
  /** All policy slots, sorted for display. */
  slots: AttachmentSlot[];
  countSatisfied: boolean;
  countExceeded: boolean;
  slotsSatisfied: boolean;
  /** Backend verdict: every requirement met. */
  complete: boolean;
  /** hasRequirement && !complete — the wizard must warn/block while true. */
  blocking: boolean;
}

const EMPTY_SLOTS: AttachmentSlot[] = [];

function sortSlots(slots: AttachmentSlot[] | undefined): AttachmentSlot[] {
  if (!slots || slots.length === 0) return EMPTY_SLOTS;
  return [...slots].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Resolves the applicable attachment policy for the selected service and judges
 * the currently-staged attachments against it, using the shared backend
 * evaluate/find-applicable pipeline.
 */
export function useAttachmentPolicy({
  serviceCode,
  requestType,
  attachments,
  enabled = true,
}: UseAttachmentPolicyArgs): AttachmentPolicyState {
  const code = (serviceCode ?? '').trim();
  const type = (requestType ?? '').trim();
  const lookupEnabled = enabled && (code.length > 0 || type.length > 0);

  const providedCount = attachments.length;
  const slots = useMemo(() => providedSlotKeys(attachments), [attachments]);
  const slotsKey = slots.join(',');

  // Authoritative verdict. Re-runs whenever the service or the candidate set
  // (assigned slots / file count) changes. `placeholderData` keeps the previous
  // verdict visible during a refetch so the banner never flickers empty.
  const evaluationQuery = useQuery({
    queryKey: ['lex-attachment-policy-evaluate', code, type, slotsKey, providedCount],
    queryFn: () =>
      evaluateAttachmentPolicy({
        request_type: type,
        service_code: code,
        provided_slots: slots,
        provided_count: providedCount,
      }),
    enabled: lookupEnabled,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: false,
  });

  const evaluation = evaluationQuery.data ?? null;
  const policyId =
    evaluation && evaluation.policy_id && evaluation.policy_id !== NIL_UUID
      ? evaluation.policy_id
      : '';

  // Hydrate the resolved policy's named slots + labels. Keyed on the stable
  // policy id, so this only fires once per applicable policy.
  const policyQuery = useQuery({
    queryKey: ['lex-attachment-policy', policyId],
    queryFn: () => lexAdminApi.getAttachmentPolicy(policyId),
    enabled: lookupEnabled && policyId.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const policy = policyQuery.data ?? null;

  return useMemo<AttachmentPolicyState>(() => {
    const hasPolicy = policyId.length > 0;
    const allSlots = sortSlots(policy?.slots);
    const requiredSlots = allSlots.filter((s) => s.required);
    const optionalSlots = allSlots.filter((s) => !s.required);
    const requiredCount = evaluation?.required_count ?? policy?.min_attachment_count ?? 0;
    const maxCount = evaluation?.max_allowed_count ?? policy?.max_attachment_count ?? 0;
    const missingSlotKeys = evaluation?.missing_slots ?? [];

    // A policy constrains submission when it sets a minimum count or defines at
    // least one required slot — matching the provider completeness gate.
    const hasRequirement = hasPolicy && (requiredCount > 0 || requiredSlots.length > 0);

    // Fail open: with no verdict yet (or an errored lookup) never block.
    const complete = evaluation ? evaluation.complete : true;
    const blocking = hasRequirement && Boolean(evaluation) && !complete;

    return {
      policy,
      evaluation,
      loading: evaluationQuery.isLoading || (policyId.length > 0 && policyQuery.isLoading),
      hasPolicy,
      hasRequirement,
      requiredCount,
      maxCount,
      providedCount,
      missingSlotKeys,
      requiredSlots,
      optionalSlots,
      slots: allSlots,
      countSatisfied: evaluation ? evaluation.count_satisfied : true,
      countExceeded: evaluation ? evaluation.count_exceeded : false,
      slotsSatisfied: evaluation ? evaluation.slots_satisfied : true,
      complete,
      blocking,
    };
  }, [
    policy,
    policyId,
    evaluation,
    providedCount,
    evaluationQuery.isLoading,
    policyQuery.isLoading,
  ]);
}
