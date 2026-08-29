/**
 * E-signature rollup for the contracts list (`/lex/contracts`) —
 * feature #2 "Signature column".
 *
 * Data layer for the per-contract envelope rollup served by the NEW batch
 * endpoint `GET /api/v1/lex/signatures/summary?contract_ids=a,b,c` (read tier,
 * same gate as `GET /signatures`). The visible page's contract ids are batched
 * into ONE react-query fetch ({@link useSignatureSummaries}); the response is
 * keyed by `contract_id` and joined onto the rows client-side, mirroring
 * `use-playbook-scores.ts`.
 *
 * Backend contract notes (`model.ContractSignatureSummary`):
 *   - `envelope_status` collapses the envelope FSM + recipient progress into
 *     none / draft / sent / partially_signed / completed / declined / expired.
 *     "none" also covers contracts whose only envelopes were cancelled.
 *   - `provider` widens the stored provider with "emdha" (Saudi TSP envelopes
 *     are persisted as external + adapter and resolved back server-side).
 *     Absent for status "none".
 *   - `stuck` flags an envelope sent > 7 days ago still awaiting signatures.
 *   - The service caps one request at {@link SIGNATURE_SUMMARY_MAX_IDS} ids
 *     (400 above it), so the client chunks defensively.
 *
 * This module is the PURE/data half (typed client + hook + status logic + the
 * {@link resendReminder} row-action helper). The presentational cell, provider
 * badge, KPI tile and toast-wired row action live in
 * `../_components/contract-signature-cell.tsx`.
 */

'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import { fetchSuiteData } from '@/lib/suite-api';
import { isApiError } from '@/types/api';
import type { LexSignatureEnvelope } from '@/types/suites';

/* ------------------------------------------------------------------------- *
 * Endpoint + API types (drop-in candidates for `enterpriseApi.lex` /
 * `types/suites.ts` should the client ever be centralized — kept feature-local
 * per the `_lib/contract-audit-api.ts` precedent).
 * ------------------------------------------------------------------------- */

export const LEX_SIGNATURE_SUMMARY_ENDPOINT = '/api/v1/lex/signatures/summary';

/** Rolled-up envelope state per contract (backend ContractSignatureSummaryStatus). */
export type LexContractSignatureStatus =
  | 'none'
  | 'draft'
  | 'sent'
  | 'partially_signed'
  | 'completed'
  | 'declined'
  | 'expired';

/**
 * Rollup provider — wider than the stored `LexSignatureProvider`: the summary
 * endpoint resolves emdha-adapter envelopes back to a distinct "emdha" value
 * and Najiz envelopes surface directly.
 */
export type LexContractSignatureProvider =
  | 'native'
  | 'nafath'
  | 'najiz'
  | 'emdha'
  | 'external';

/** One rollup entry — mirrors backend `model.ContractSignatureSummary` (JSON tags). */
export interface LexContractSignatureSummary {
  contract_id: string;
  envelope_status: LexContractSignatureStatus;
  /** Absent when `envelope_status` is "none". */
  provider?: LexContractSignatureProvider | string | null;
  /** Recipients still to sign on the rolled-up envelope. */
  pending_count?: number;
  /** Most recent signature event on any of the contract's envelopes. */
  last_event_at?: string | null;
  /** Sent > 7 days ago and still awaiting signatures (sent / partially_signed). */
  stuck?: boolean;
}

/** Server-side cap on `contract_ids` per request (service validation above it). */
export const SIGNATURE_SUMMARY_MAX_IDS = 200;

/** Drop empties + duplicates while preserving first-occurrence order. */
export function dedupeContractIds(ids: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Typed client for `GET /signatures/summary`. The whole visible page rides ONE
 * request (the list renders at most 100 rows, well under the 200-id cap);
 * chunking is a defensive guard so an oversized caller never trips the server's
 * 400 instead of getting data.
 */
export async function getSignatureSummaries(
  contractIds: ReadonlyArray<string>,
): Promise<LexContractSignatureSummary[]> {
  const ids = dedupeContractIds(contractIds);
  if (ids.length === 0) return [];
  const out: LexContractSignatureSummary[] = [];
  for (let start = 0; start < ids.length; start += SIGNATURE_SUMMARY_MAX_IDS) {
    const chunk = ids.slice(start, start + SIGNATURE_SUMMARY_MAX_IDS);
    const items = await fetchSuiteData<LexContractSignatureSummary[]>(
      LEX_SIGNATURE_SUMMARY_ENDPOINT,
      { contract_ids: chunk.join(',') },
    );
    out.push(...(items ?? []));
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Status logic (pure, unit-tested).
 * ------------------------------------------------------------------------- */

/** Visual tone of a rollup status (chip chrome is spelled out in the cell). */
export type SignatureStatusTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger';

/** Classify a rollup status into its chip tone. Unknown/absent → neutral. */
export function signatureStatusTone(
  status?: LexContractSignatureStatus | string | null,
): SignatureStatusTone {
  switch (status) {
    case 'sent':
    case 'partially_signed':
      return 'info';
    case 'completed':
      return 'ok';
    case 'expired':
      return 'warn';
    case 'declined':
      return 'danger';
    case 'draft':
    case 'none':
    default:
      return 'neutral';
  }
}

/** Envelope is out with signers (the "pending signature" KPI population). */
export function isAwaitingSignature(
  status?: LexContractSignatureStatus | string | null,
): boolean {
  return status === 'sent' || status === 'partially_signed';
}

/**
 * A reminder/re-send is meaningful: there is a live envelope that has not
 * reached a terminal state (draft = never dispatched; sent/partially_signed =
 * signers to nudge). Terminal (completed/declined/expired) and "none" rows
 * never show the action.
 */
export function isReminderEligible(
  status?: LexContractSignatureStatus | string | null,
): boolean {
  return status === 'draft' || isAwaitingSignature(status);
}

export interface SignatureRollupCounts {
  /** Contracts with an envelope out for signature (sent / partially_signed). */
  pending: number;
  /** Of those, envelopes stuck > 7 days. */
  stuck: number;
}

/** Count the awaiting/stuck rows of a loaded batch (page-scope KPI detail). */
export function countSignatureRollup(
  summaries: Iterable<LexContractSignatureSummary>,
): SignatureRollupCounts {
  let pending = 0;
  let stuck = 0;
  for (const summary of summaries) {
    if (!isAwaitingSignature(summary.envelope_status)) continue;
    pending += 1;
    if (summary.stuck) stuck += 1;
  }
  return { pending, stuck };
}

/* ------------------------------------------------------------------------- *
 * Batched page fetch (one react-query entry per visible-id set).
 * ------------------------------------------------------------------------- */

/** Base query key — invalidate this to refresh every summary batch. */
export const LEX_SIGNATURE_SUMMARY_QUERY_KEY = ['lex-signature-summaries'] as const;

/**
 * Per-batch key: the SORTED id set, so reorderings (sort changes) of the same
 * page hit the same cache entry.
 */
export function signatureSummariesQueryKey(ids: ReadonlyArray<string>) {
  return [...LEX_SIGNATURE_SUMMARY_QUERY_KEY, [...ids].sort().join(',')] as const;
}

export interface UseSignatureSummariesResult {
  /** Rollups keyed by `contract_id` (absent while loading/error). */
  summariesById: ReadonlyMap<string, LexContractSignatureSummary>;
  /** Rollup for one contract, or `undefined` when not (yet) loaded. */
  getSummary: (contractId: string) => LexContractSignatureSummary | undefined;
  /** Awaiting/stuck counts over the loaded batch (page-scope). */
  counts: SignatureRollupCounts;
  /** Initial fetch in flight — cells render a skeleton, not "no envelope". */
  isLoading: boolean;
  /** Fetch failed — cells degrade to the neutral state (no error per row). */
  isError: boolean;
}

/**
 * Shared signature-rollup lookup for the contracts list: pass the VISIBLE
 * page's contract ids (`tableProps.data.map((row) => row.id)`) and every cell
 * joins by `contract_id` off this single request. 60s staleTime matches the
 * page's stats tiles; the reminder action invalidates
 * {@link LEX_SIGNATURE_SUMMARY_QUERY_KEY} to refresh after a send.
 */
export function useSignatureSummaries(
  contractIds: ReadonlyArray<string>,
): UseSignatureSummariesResult {
  const ids = useMemo(
    () => dedupeContractIds(contractIds),
    // Key on content, not array identity — the page maps a fresh array per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contractIds.join(',')],
  );

  const query = useQuery({
    queryKey: signatureSummariesQueryKey(ids),
    queryFn: () => getSignatureSummaries(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });

  const summariesById = useMemo(() => {
    const map = new Map<string, LexContractSignatureSummary>();
    for (const summary of query.data ?? []) {
      map.set(summary.contract_id, summary);
    }
    return map as ReadonlyMap<string, LexContractSignatureSummary>;
  }, [query.data]);

  const getSummary = useCallback(
    (contractId: string) => summariesById.get(contractId),
    [summariesById],
  );

  const counts = useMemo(
    () => countSignatureRollup(summariesById.values()),
    [summariesById],
  );

  return {
    summariesById,
    getSummary,
    counts,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/* ------------------------------------------------------------------------- *
 * resendReminder — the row-action helper over the existing send API.
 * ------------------------------------------------------------------------- */

/** Envelopes scanned per contract when resolving the reminder target. */
const REMINDER_ENVELOPE_SCAN = 50;

/** Envelope statuses that are out with signers (FSM, not rollup, values). */
const AWAITING_ENVELOPE_STATUSES = new Set(['sent', 'viewed']);

export type ResendReminderResult =
  /** A draft envelope was dispatched for the first time. */
  | { kind: 'sent'; envelopeId: string }
  /** An in-flight envelope was re-dispatched (server permitting). */
  | { kind: 'resent'; envelopeId: string }
  /**
   * The envelope is already with the signing parties and the server refused a
   * re-send (409 CONFLICT — the current send FSM is draft-only). Surfaced as
   * an informational outcome, not an error.
   */
  | { kind: 'already_in_flight'; envelopeId: string }
  /** The contract has no signature envelopes at all. */
  | { kind: 'no_envelope' }
  /** Envelopes exist but all are terminal (signed/declined/expired/cancelled). */
  | { kind: 'not_actionable'; envelopeStatus: string };

/**
 * Choose the envelope a reminder should target: the newest envelope that is
 * out with signers (sent/viewed), else the newest draft (never dispatched).
 * Terminal-only lists yield `null`. Pure — exported for unit tests.
 */
export function pickReminderEnvelope(
  envelopes: ReadonlyArray<LexSignatureEnvelope>,
): LexSignatureEnvelope | null {
  const newestFirst = [...envelopes].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
  return (
    newestFirst.find((envelope) => AWAITING_ENVELOPE_STATUSES.has(envelope.status)) ??
    newestFirst.find((envelope) => envelope.status === 'draft') ??
    null
  );
}

/**
 * Row-action helper: nudge the contract's signature process via the EXISTING
 * send/remind API (`POST /api/v1/lex/signatures/{id}/send`, write tier).
 *
 *   1. Resolves the contract's envelopes (`GET /signatures?contract_id=…`).
 *   2. Draft envelope → dispatches it (`kind: "sent"`).
 *   3. In-flight envelope → re-sends; the current backend send FSM only accepts
 *      drafts, so a 409 degrades gracefully to `kind: "already_in_flight"`
 *      (forward-compatible: if the server later supports re-sends the same call
 *      reports `kind: "resent"`).
 *
 * Anything unexpected (network, 403, 5xx) is re-thrown for the caller's error
 * toast. Callers must gate on the write permission (`lex:contract:edit` per
 * the signatures-workspace precedent) — the underlying route is write tier.
 */
export async function resendReminder(contractId: string): Promise<ResendReminderResult> {
  const page = await enterpriseApi.lex.listSignatures({
    page: 1,
    per_page: REMINDER_ENVELOPE_SCAN,
    filters: { contract_id: contractId },
  });
  const envelopes = page.data ?? [];
  const target = pickReminderEnvelope(envelopes);
  if (!target) {
    if (envelopes.length === 0) {
      return { kind: 'no_envelope' };
    }
    return { kind: 'not_actionable', envelopeStatus: String(envelopes[0]?.status ?? 'unknown') };
  }
  const isDraft = target.status === 'draft';
  try {
    const sent = await enterpriseApi.lex.sendSignature(target.id);
    return { kind: isDraft ? 'sent' : 'resent', envelopeId: sent?.id ?? target.id };
  } catch (error) {
    if (!isDraft && isApiError(error) && error.status === 409) {
      return { kind: 'already_in_flight', envelopeId: target.id };
    }
    throw error;
  }
}
