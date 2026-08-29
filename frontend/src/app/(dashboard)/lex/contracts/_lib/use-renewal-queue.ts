/**
 * Renewal decision queue — data + execution engine for the cohort panel opened
 * from the list-page {@link RenewalWarningsBanner}.
 *
 * Data: joins the (previously unused) `enterpriseApi.lex.getExpiringContracts`
 * cohort with the renewal-warnings digest (`getContractRenewalWarnings`, whose
 * query key is shared with the banner so the cache is reused) to enrich each
 * expiring contract with its notice period, auto-renew flag, and severity —
 * the countdown chips are notice-period aware, not just expiry-date aware.
 *
 * Decisions map onto EXISTING backend surfaces only:
 *   - renew        → POST /contracts/{id}/renew            (lex:contract:edit)
 *   - terminate    → PUT  /contracts/{id}/status→terminated (lex:contract:approve)
 *   - renegotiate  → PUT  /contracts/{id}/status→suspended  (lex:contract:approve)
 *
 * "Renegotiate" targets `suspended` deliberately: the contract FSM
 * (`CONTRACT_STATUS_TRANSITIONS`, mirroring backend `validTransitions`) has no
 * active→negotiation edge — `suspended` is the lifecycle's "on hold pending
 * renegotiation" state, from which the operator later resumes (`active`) or
 * exits (`terminated`).
 *
 * Each decision can optionally generate a notice letter via the drafting API
 * (POST /drafting/contracts — `enterpriseApi.lex.drafting.draftContract`,
 * coarse `lex:write`); the generated draft is attached to the per-row result
 * so the panel can open it for review, AND persisted to the drafting studio's
 * run history (`saveDraftingRun`, task `contract`) so it is genuinely "opened
 * as a draft" — it appears in `/lex/drafting?tab=contract` for editing/export.
 * Execution is sequential so the panel can render true progress, and every
 * row resolves independently — the run always completes with a
 * partial-failure summary instead of aborting.
 */
'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';
import type {
  LexContractRenewalWarning,
  LexContractStatus,
  LexDraftingContractDraft,
  LexDraftingContractRequest,
  LexExpiringContractSummary,
} from '@/types/suites';

import { saveDraftingRun } from '../../drafting/_components/drafting-workspace';
import { isAllowedContractTransition } from './contracts-board';

/* ------------------------------------------------------------------------- *
 * Row model + pure helpers (exported for unit tests).
 * ------------------------------------------------------------------------- */

/** Operator decision for one expiring contract. */
export type RenewalQueueDecision = 'renew' | 'terminate' | 'renegotiate';

/**
 * Status-transition targets for the non-renew decisions. `renew` is absent on
 * purpose — it rides the dedicated renew endpoint, not the status FSM.
 */
export const DECISION_TARGET_STATUS: Record<
  Exclude<RenewalQueueDecision, 'renew'>,
  LexContractStatus
> = {
  terminate: 'terminated',
  renegotiate: 'suspended',
};

/**
 * Fallback notice period when a cohort row has no renewal-warning enrichment
 * (mirrors the platform's default `renewal_notice_days`).
 */
export const DEFAULT_NOTICE_DAYS = 30;

/** One cohort row: the expiring summary enriched with notice metadata. */
export interface RenewalQueueRow {
  id: string;
  title: string;
  type: string;
  status: LexContractStatus;
  counterparty: string;
  ownerName: string;
  /** ISO expiry timestamp (always present in the expiring cohort). */
  expiryDate: string;
  /** Server-computed days remaining (clamped ≥ 0 by the backend). */
  daysUntilExpiry: number;
  /** Renewal notice window in days (warning digest, else {@link DEFAULT_NOTICE_DAYS}). */
  noticeDays: number;
  /** Whether the notice period came from the warnings digest (vs. fallback). */
  noticeKnown: boolean;
  autoRenew: boolean;
  severity?: 'urgent' | 'warning';
}

/** Notice-period-aware countdown classification for the chip. */
export type RenewalCountdownTone = 'overdue' | 'notice' | 'upcoming';

/**
 * Classify a countdown: `overdue` when expiry has arrived, `notice` when the
 * remaining days are already inside the renewal notice window (the notice
 * deadline has passed), `upcoming` otherwise.
 */
export function countdownTone(
  daysUntilExpiry: number,
  noticeDays: number,
): RenewalCountdownTone {
  if (daysUntilExpiry <= 0) {
    return 'overdue';
  }
  if (daysUntilExpiry <= Math.max(0, noticeDays)) {
    return 'notice';
  }
  return 'upcoming';
}

/**
 * Join the expiring cohort with the renewal-warnings digest (by contract id)
 * into enriched queue rows. Cohort order (soonest expiry first) is preserved.
 */
export function mergeQueueRows(
  expiring: LexExpiringContractSummary[],
  warnings?: LexContractRenewalWarning[],
): RenewalQueueRow[] {
  const byId = new Map<string, LexContractRenewalWarning>();
  for (const warning of warnings ?? []) {
    byId.set(warning.contract_id, warning);
  }
  return expiring.map((item) => {
    const warning = byId.get(item.id);
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      status: item.status,
      counterparty: item.party_b_name,
      ownerName: item.owner_name,
      expiryDate: item.expiry_date,
      daysUntilExpiry: item.days_until_expiry,
      noticeDays: warning ? Math.max(0, warning.renewal_notice_days) : DEFAULT_NOTICE_DAYS,
      noticeKnown: Boolean(warning),
      autoRenew: warning?.auto_renew ?? false,
      severity: warning?.severity,
    };
  });
}

/**
 * Compute the renewed term's expiry (ISO datetime) as `termMonths` months
 * after the current expiry — never earlier than `termMonths` after `now`, so
 * an already-lapsed contract still yields a forward-dated term.
 */
export function renewalExpiryFrom(
  expiryDate: string,
  termMonths: number,
  now: Date = new Date(),
): string {
  const months = Math.max(1, Math.round(termMonths));
  const parsed = new Date(expiryDate);
  const base =
    Number.isNaN(parsed.getTime()) || parsed.getTime() < now.getTime() ? now : parsed;
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth() + months,
      base.getUTCDate(),
    ),
  ).toISOString();
}

/** True when the decision is legal for the row per the shared lifecycle FSM. */
export function isDecisionAllowed(
  row: Pick<RenewalQueueRow, 'status'>,
  decision: RenewalQueueDecision,
): boolean {
  if (decision === 'renew') {
    // Mirrors backend RenewContract: only active or expired contracts renew.
    return row.status === 'active' || row.status === 'expired';
  }
  return isAllowedContractTransition(row.status, DECISION_TARGET_STATUS[decision]);
}

/**
 * Build the drafting request for a decision's notice letter
 * (POST /drafting/contracts). `deal_terms` carries the structured facts the
 * drafting engine needs to produce a counterparty-facing notice.
 */
export function buildNoticeLetterRequest(
  row: RenewalQueueRow,
  decision: RenewalQueueDecision,
  locale: AppLocale,
): LexDraftingContractRequest {
  const noticeKind =
    decision === 'renew'
      ? 'renewal_notice'
      : decision === 'terminate'
        ? 'termination_notice'
        : 'renegotiation_notice';
  return {
    contract_type: row.type,
    language: locale === 'ar' ? 'ar' : 'en',
    template_hint: `${noticeKind.replace(/_/g, ' ')} letter`,
    deal_terms: {
      notice_kind: noticeKind,
      contract_id: row.id,
      contract_title: row.title,
      counterparty: row.counterparty,
      expiry_date: row.expiryDate,
      renewal_notice_days: row.noticeDays,
      auto_renew: row.autoRenew,
    },
  };
}

/**
 * Flatten a generated notice-letter draft to plain text (title, summary, then
 * `heading\nbody` per section) — the same shape the drafting studio persists,
 * so a queue-generated letter round-trips through its history/export panels.
 */
export function noticeDraftToPlainText(draft: LexDraftingContractDraft): string {
  const parts = [draft.title, draft.summary ?? ''];
  for (const section of draft.sections) {
    parts.push(`${section.heading}\n${section.body}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------------- *
 * Execution engine.
 * ------------------------------------------------------------------------- */

/** One queued decision handed to {@link useRenewalQueue.execute}. */
export interface RenewalQueueDecisionInput {
  row: RenewalQueueRow;
  decision: RenewalQueueDecision;
}

export interface RenewalQueueExecuteOptions {
  /** Generate a notice-letter draft per decision via the drafting API. */
  generateNotice: boolean;
  /** Renewed term length in months (renew decisions only). */
  termMonths: number;
  /** Drafting language for generated notice letters. */
  locale: AppLocale;
}

/** Per-row outcome of a run (the partial-failure summary is built from these). */
export interface RenewalQueueResult {
  id: string;
  title: string;
  decision: RenewalQueueDecision;
  ok: boolean;
  /** Parsed backend error when the decision itself failed. */
  error?: string;
  /** Generated notice-letter draft (when requested and the decision succeeded). */
  notice?: LexDraftingContractDraft | null;
  /** Drafting-history run id when the letter was persisted to the studio. */
  noticeRunId?: string;
  /** Letter generation failed independently of the (successful) decision. */
  noticeError?: string;
}

export interface RenewalQueueProgress {
  total: number;
  completed: number;
  /** Title of the contract currently being processed (null when finished). */
  currentTitle: string | null;
}

export interface UseRenewalQueueOptions {
  /** Expiry horizon (days) for the cohort query. */
  horizonDays: number;
  /** Defer fetching until the panel is actually open. */
  enabled: boolean;
}

export interface UseRenewalQueueReturn {
  rows: RenewalQueueRow[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  executing: boolean;
  progress: RenewalQueueProgress | null;
  results: RenewalQueueResult[] | null;
  execute: (
    items: RenewalQueueDecisionInput[],
    options: RenewalQueueExecuteOptions,
  ) => Promise<RenewalQueueResult[]>;
  /** Clear the last run's results/progress (back to the queue view). */
  reset: () => void;
}

/** Query key for the queue cohort (exported so integrators can invalidate). */
export const RENEWAL_QUEUE_COHORT_KEY = 'lex-renewal-queue-expiring';
/** Shared with `RenewalWarningsBanner` so both surfaces reuse one cache entry. */
export const RENEWAL_WARNINGS_KEY = 'lex-contract-renewal-warnings';

async function applyDecision(
  input: RenewalQueueDecisionInput,
  options: RenewalQueueExecuteOptions,
): Promise<void> {
  const { row, decision } = input;
  if (decision === 'renew') {
    await enterpriseApi.lex.renewContract(row.id, {
      new_expiry_date: renewalExpiryFrom(row.expiryDate, options.termMonths),
      change_summary: `Renewal decision queue: renewed for ${Math.max(1, Math.round(options.termMonths))} months`,
    });
    return;
  }
  await enterpriseApi.lex.updateContractStatus(row.id, {
    status: DECISION_TARGET_STATUS[decision],
  });
}

export function useRenewalQueue(options: UseRenewalQueueOptions): UseRenewalQueueReturn {
  const { horizonDays, enabled } = options;
  const queryClient = useQueryClient();

  const expiringQuery = useQuery({
    queryKey: [RENEWAL_QUEUE_COHORT_KEY, horizonDays],
    queryFn: () => enterpriseApi.lex.getExpiringContracts(horizonDays),
    enabled,
    staleTime: 30_000,
  });

  const warningsQuery = useQuery({
    queryKey: [RENEWAL_WARNINGS_KEY],
    queryFn: () => enterpriseApi.lex.getContractRenewalWarnings(),
    enabled,
    staleTime: 60_000,
  });

  const rows = useMemo(
    () => mergeQueueRows(expiringQuery.data ?? [], warningsQuery.data?.items),
    [expiringQuery.data, warningsQuery.data],
  );

  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<RenewalQueueProgress | null>(null);
  const [results, setResults] = useState<RenewalQueueResult[] | null>(null);

  const execute = useCallback(
    async (
      items: RenewalQueueDecisionInput[],
      executeOptions: RenewalQueueExecuteOptions,
    ): Promise<RenewalQueueResult[]> => {
      if (items.length === 0 || executing) {
        return [];
      }
      setExecuting(true);
      setResults(null);
      setProgress({ total: items.length, completed: 0, currentTitle: null });

      const runResults: RenewalQueueResult[] = [];
      try {
        for (const item of items) {
          setProgress({
            total: items.length,
            completed: runResults.length,
            currentTitle: item.row.title,
          });

          const result: RenewalQueueResult = {
            id: item.row.id,
            title: item.row.title,
            decision: item.decision,
            ok: false,
          };

          try {
            await applyDecision(item, executeOptions);
            result.ok = true;
          } catch (error) {
            result.error = parseApiError(error);
          }

          if (result.ok && executeOptions.generateNotice) {
            try {
              const request = buildNoticeLetterRequest(
                item.row,
                item.decision,
                executeOptions.locale,
              );
              const draft = await enterpriseApi.lex.drafting.draftContract(request);
              result.notice = draft;
              try {
                // Persist immediately (not after the run) so letters survive a
                // mid-run navigation; failures here never fail the decision.
                result.noticeRunId = saveDraftingRun({
                  task: 'contract',
                  title: draft.title || item.row.title,
                  input: request,
                  result: draft,
                  text: noticeDraftToPlainText(draft),
                }).id;
              } catch {
                // localStorage unavailable — the inline preview still works.
              }
            } catch (error) {
              result.noticeError = parseApiError(error);
            }
          }

          runResults.push(result);
        }
      } finally {
        setProgress({ total: items.length, completed: runResults.length, currentTitle: null });
        setResults(runResults);
        setExecuting(false);
        // Refresh every renewal surface: the queue cohort, the banner digest,
        // and the contracts list/stats (status changes move rows out of the
        // cohort and between lifecycle columns).
        void queryClient.invalidateQueries({ queryKey: [RENEWAL_QUEUE_COHORT_KEY] });
        void queryClient.invalidateQueries({ queryKey: [RENEWAL_WARNINGS_KEY] });
      }
      return runResults;
    },
    [executing, queryClient],
  );

  const reset = useCallback(() => {
    setResults(null);
    setProgress(null);
  }, []);

  return {
    rows,
    isLoading: expiringQuery.isLoading || warningsQuery.isLoading,
    isError: expiringQuery.isError,
    refetch: () => {
      void expiringQuery.refetch();
      void warningsQuery.refetch();
    },
    executing,
    progress,
    results,
    execute,
    reset,
  };
}
