/**
 * Feature #2 — contracts list signature column.
 *
 * Presentational half of the e-signature rollup, fed by the shared batch fetch
 * in `../_lib/use-signature-summaries.ts` (ONE `GET /signatures/summary`
 * request for the visible page, joined by `contract_id`):
 *
 *   1. {@link ContractSignatureCell} — envelope-status chip (draft / sent /
 *      partially-signed / completed / declined / expired), provider badge
 *      (native / Nafath / Najiz / emdha — Arabic names included) and a stuck
 *      indicator for envelopes awaiting signatures for over 7 days. Degrades
 *      to a neutral dashed "no envelope" pill and to a skeleton while the
 *      batch is loading.
 *
 *   2. {@link PendingSignatureKpi} — tenant-wide "out for signature" KPI tile
 *      (envelopes in sent/viewed, counted via two `meta.total`-only list
 *      probes inside one react-query entry), with an optional page-scope
 *      stuck-count footer. Mirrors the page's clickable `KpiTile` chrome.
 *
 *   3. {@link useSignatureReminderRowAction} — toast-wired `RowAction` over the
 *      {@link resendReminder} helper (existing `POST /signatures/{id}/send`).
 *      WRITE-tier: callers pass `canSend` (the page's `lex:contract:edit`
 *      gate) and the action also hides itself per-row when the rollup has
 *      nothing to nudge.
 *
 * Bilingual labels follow the canonical lex token-record contract
 * (`LexBilingual<T>` resolved via the active locale); logical spacing and
 * flex/gap layout keep the cell RTL-safe.
 */

'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Hourglass, PenLine } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showInfo, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { RowAction } from '@/types/table';
import { resolveLexBilingual, type LexBilingual } from '../../_lib/lex-i18n';
import {
  LEX_SIGNATURE_SUMMARY_QUERY_KEY,
  isReminderEligible,
  resendReminder,
  signatureStatusTone,
  type LexContractSignatureProvider,
  type LexContractSignatureStatus,
  type LexContractSignatureSummary,
  type SignatureStatusTone,
} from '../_lib/use-signature-summaries';
import { ContractKpiTile } from './contracts-kpi-tile';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

export interface ContractSignatureCellLabels {
  /** Column header on the contracts table. */
  columnHeader: string;
  /** Envelope-status chip text per rollup status. */
  statuses: Record<LexContractSignatureStatus, string>;
  /** Provider badge text (Arabic brand names in ar mode). */
  providers: Record<LexContractSignatureProvider, string>;
  /** Provider badge tooltip. */
  providerHint: (name: string) => string;
  /** Tooltip expanding on the "no envelope" state. */
  noEnvelopeHint: string;
  /** Stuck indicator tooltip / aria label. */
  stuck: string;
  /** Tooltip fragment: recipients still to sign (count pre-formatted). */
  pendingRecipients: (count: string) => string;
  /** Tooltip fragment: most recent signature activity (relative time). */
  lastEvent: (when: string) => string;
  kpi: {
    title: string;
    description: string;
    /** Footer label for the page-scope stuck count. */
    stuckDetail: string;
    /** Description swap when the tenant-wide probe fails. */
    error: string;
  };
  reminder: {
    /** Row-action entry label. */
    action: string;
    /** Draft envelope dispatched for the first time. */
    sent: string;
    /** In-flight envelope re-dispatched. */
    resent: string;
    /** Server refused the re-send — envelope already with the signers. */
    alreadyInFlight: string;
    noEnvelope: string;
    notActionable: string;
  };
}

export const contractSignatureCellLabels: LexBilingual<ContractSignatureCellLabels> = {
  en: {
    columnHeader: 'Signature',
    statuses: {
      none: 'No envelope',
      draft: 'Draft',
      sent: 'Sent',
      partially_signed: 'Partially signed',
      completed: 'Completed',
      declined: 'Declined',
      expired: 'Expired',
    },
    providers: {
      native: 'Native',
      nafath: 'Nafath',
      najiz: 'Najiz',
      emdha: 'emdha',
      external: 'External',
    },
    providerHint: (name) => `E-signature provider: ${name}`,
    noEnvelopeHint: 'No e-signature envelope has been created for this contract.',
    stuck: 'Stuck — awaiting signature for more than 7 days',
    pendingRecipients: (count) => `${count} awaiting signature`,
    lastEvent: (when) => `Last activity ${when}`,
    kpi: {
      title: 'Out for signature',
      description: 'Signature envelopes awaiting signers',
      stuckDetail: 'Stuck > 7 days (this page)',
      error: 'Could not load the signature workload.',
    },
    reminder: {
      action: 'Send signature reminder',
      sent: 'Signature envelope dispatched to the signers.',
      resent: 'Signature reminder re-sent to the pending signers.',
      alreadyInFlight:
        'The envelope is already with the signing parties; in-flight reminders are handled by the provider.',
      noEnvelope: 'No signature envelope exists for this contract yet.',
      notActionable: 'The signature process is already closed for this contract.',
    },
  },
  ar: {
    columnHeader: 'التوقيع',
    statuses: {
      none: 'لا يوجد مظروف',
      draft: 'مسودة',
      sent: 'مُرسل',
      partially_signed: 'موقّع جزئيًا',
      completed: 'مكتمل',
      declined: 'مرفوض',
      expired: 'منتهي الصلاحية',
    },
    providers: {
      native: 'المنصة',
      nafath: 'نفاذ',
      najiz: 'ناجز',
      emdha: 'إمضاء',
      external: 'خارجي',
    },
    providerHint: (name) => `مزوّد التوقيع الإلكتروني: ${name}`,
    noEnvelopeHint: 'لم يُنشأ مظروف توقيع إلكتروني لهذا العقد.',
    stuck: 'متعثر — بانتظار التوقيع منذ أكثر من ٧ أيام',
    pendingRecipients: (count) => `${count} بانتظار التوقيع`,
    lastEvent: (when) => `آخر نشاط ${when}`,
    kpi: {
      title: 'قيد التوقيع',
      description: 'مظاريف توقيع بانتظار الموقّعين',
      stuckDetail: 'متعثرة أكثر من ٧ أيام (هذه الصفحة)',
      error: 'تعذر تحميل عبء التوقيعات.',
    },
    reminder: {
      action: 'إرسال تذكير بالتوقيع',
      sent: 'تم إرسال مظروف التوقيع إلى الموقّعين.',
      resent: 'أُعيد إرسال التذكير إلى الموقّعين المتبقين.',
      alreadyInFlight:
        'المظروف لدى أطراف التوقيع بالفعل؛ يتولى المزوّد التذكيرات للمظاريف قيد الإرسال.',
      noEnvelope: 'لا يوجد مظروف توقيع لهذا العقد بعد.',
      notActionable: 'عملية التوقيع مغلقة بالفعل لهذا العقد.',
    },
  },
};

export function useContractSignatureCellLabels(): ContractSignatureCellLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(contractSignatureCellLabels, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Chip chrome per tone — spelled out literally so Tailwind's JIT scanner can
 * statically detect each class (mirrors CHIP_TONE in contract-risk-cell.tsx).
 * ------------------------------------------------------------------------- */

const CHIP_TONE: Record<SignatureStatusTone, string> = {
  neutral: 'border-border/70 bg-muted/50 text-muted-foreground',
  info: 'border-info-500/30 bg-info-500/6 text-info-700 dark:text-info-300',
  ok: 'border-success-500/30 bg-success-500/8 text-success-700 dark:text-success-300',
  warn: 'border-warning-500/30 bg-warning-500/7 text-warning-700 dark:text-warning-300',
  danger: 'border-error-500/30 bg-error-500/6 text-error-700 dark:text-error-300',
};

/** Dot accent inside the status chip, matching the ramp above. */
const DOT_TONE: Record<SignatureStatusTone, string> = {
  neutral: 'bg-muted-foreground/50',
  info: 'bg-info-500',
  ok: 'bg-success-500',
  warn: 'bg-warning-500',
  danger: 'bg-error-500',
};

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  'native',
  'nafath',
  'najiz',
  'emdha',
  'external',
]);

/* ------------------------------------------------------------------------- *
 * 1. ContractSignatureCell — the column cell.
 * ------------------------------------------------------------------------- */

export interface ContractSignatureCellProps {
  /** Rollup for this contract; absent = no data (renders the neutral pill). */
  summary?: LexContractSignatureSummary | null;
  /** Batch fetch still in flight — render a skeleton, not "no envelope". */
  loading?: boolean;
  className?: string;
}

/**
 * Purely presentational rollup cell. No data fetching, no state — the batch
 * fetch and column wiring are owned by the list-page integrator via
 * `useSignatureSummaries()`.
 */
export function ContractSignatureCell({
  summary,
  loading = false,
  className,
}: ContractSignatureCellProps) {
  const labels = useContractSignatureCellLabels();
  const f = useLexFormat();

  if (loading) {
    return (
      <span
        className={cn(
          'inline-block h-5 w-20 animate-pulse rounded-full bg-muted',
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  const status = summary?.envelope_status ?? 'none';

  if (!summary || status === 'none') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-dashed px-2.5 py-0.5 text-xs',
          CHIP_TONE.neutral,
          className,
        )}
        title={labels.noEnvelopeHint}
        aria-label={labels.noEnvelopeHint}
      >
        {labels.statuses.none}
      </span>
    );
  }

  const tone = signatureStatusTone(status);
  const statusLabel =
    labels.statuses[status as LexContractSignatureStatus] ??
    String(status).replace(/_/g, ' ');

  const titleParts = [statusLabel];
  if ((summary.pending_count ?? 0) > 0) {
    titleParts.push(labels.pendingRecipients(f.formatNumber(summary.pending_count ?? 0)));
  }
  if (summary.last_event_at) {
    titleParts.push(labels.lastEvent(f.formatRelative(summary.last_event_at)));
  }
  const title = titleParts.join(' · ');

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
          CHIP_TONE[tone],
        )}
        title={title}
        aria-label={title}
      >
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_TONE[tone])}
          aria-hidden="true"
        />
        {statusLabel}
      </span>
      <SignatureProviderBadge provider={summary.provider} />
      {summary.stuck ? (
        <span title={labels.stuck} aria-label={labels.stuck} role="img">
          <Hourglass
            className="h-3.5 w-3.5 shrink-0 text-warning-700 dark:text-warning-300"
            aria-hidden="true"
          />
        </span>
      ) : null}
    </div>
  );
}

/** Compact provider badge (bilingual brand names). Renders nothing when unset. */
export function SignatureProviderBadge({
  provider,
  className,
}: {
  provider?: LexContractSignatureProvider | string | null;
  className?: string;
}) {
  const labels = useContractSignatureCellLabels();
  if (!provider) return null;
  const name = KNOWN_PROVIDERS.has(provider)
    ? labels.providers[provider as LexContractSignatureProvider]
    : provider;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-px text-[11px] font-medium text-muted-foreground',
        className,
      )}
      title={labels.providerHint(name)}
      aria-label={labels.providerHint(name)}
    >
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * 2. PendingSignatureKpi — tenant-wide "out for signature" tile.
 * ------------------------------------------------------------------------- */

/** Query key for the tenant-wide pending-envelope probe. */
export const LEX_PENDING_SIGNATURE_KPI_QUERY_KEY = [
  'lex-signatures',
  'pending-kpi',
] as const;

/**
 * Tenant-wide envelopes out with signers: the signatures list is probed with
 * `per_page=1` for the `sent` and `viewed` FSM states and only `meta.total`
 * is consumed — two cheap counts inside ONE react-query entry.
 */
async function fetchPendingEnvelopeCount(): Promise<number> {
  const [sent, viewed] = await Promise.all([
    enterpriseApi.lex.listSignatures({ page: 1, per_page: 1, filters: { status: 'sent' } }),
    enterpriseApi.lex.listSignatures({ page: 1, per_page: 1, filters: { status: 'viewed' } }),
  ]);
  return (sent.meta?.total ?? 0) + (viewed.meta?.total ?? 0);
}

export interface PendingSignatureKpiProps {
  /**
   * Selects the `pending_signature` slice of the register — or clears it again
   * when {@link active}, so a pressed tile stays un-pressable (the list page
   * owns the toggle).
   */
  onClick: () => void;
  /** Pressed state when the register is showing this tile's slice. */
  active?: boolean;
  /**
   * Stuck-envelope count over the LOADED page (from
   * `useSignatureSummaries().counts.stuck`) — rendered as the footer detail.
   */
  stuckOnPage?: number;
  className?: string;
}

/**
 * "Out for signature" KPI tile for the contracts list header strip. Fetches
 * its own tenant-wide count (never limited to the visible page) and mirrors
 * the page's clickable `KpiTile` chrome, including `aria-pressed` when wired
 * to a filter.
 */
export function PendingSignatureKpi({
  onClick,
  active,
  stuckOnPage,
  className,
}: PendingSignatureKpiProps) {
  const labels = useContractSignatureCellLabels();
  const f = useLexFormat();

  const query = useQuery({
    queryKey: LEX_PENDING_SIGNATURE_KPI_QUERY_KEY,
    queryFn: fetchPendingEnvelopeCount,
    staleTime: 60_000,
  });

  return (
    <ContractKpiTile
      title={labels.kpi.title}
      value={query.isError ? '—' : (query.data ?? 0)}
      theme="gold"
      icon={PenLine}
      loading={query.isLoading}
      error={query.isError}
      detail={stuckOnPage !== undefined ? labels.kpi.stuckDetail : undefined}
      detailValue={stuckOnPage !== undefined ? f.formatNumber(stuckOnPage) : undefined}
      active={active}
      onClick={onClick}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------------- *
 * 3. useSignatureReminderRowAction — toast-wired "Send signature reminder".
 * ------------------------------------------------------------------------- */

export interface SignatureReminderRowActionOptions {
  /** Rollup lookup from `useSignatureSummaries().getSummary`. */
  getSummary: (contractId: string) => LexContractSignatureSummary | undefined;
  /**
   * Write gate — the send route is write tier; pass the page's contract-edit
   * check (`hasPermission('lex:contract:edit')` per the signatures-workspace
   * precedent). The action hides itself entirely when false.
   */
  canSend: boolean;
}

/**
 * Ready-made `RowAction` nudging a contract's signature process through the
 * existing send API (see {@link resendReminder} for the outcome semantics).
 * Hidden for rows whose rollup has nothing to nudge (no envelope / terminal)
 * and for personas without the write verb — a mutation a persona cannot
 * perform is never rendered.
 */
export function useSignatureReminderRowAction<TRow extends { id: string }>({
  getSummary,
  canSend,
}: SignatureReminderRowActionOptions): RowAction<TRow> {
  const labels = useContractSignatureCellLabels();
  const queryClient = useQueryClient();

  return useMemo<RowAction<TRow>>(
    () => ({
      label: labels.reminder.action,
      icon: BellRing,
      hidden: (row) =>
        !canSend || !isReminderEligible(getSummary(row.id)?.envelope_status),
      onClick: (row) => {
        void (async () => {
          try {
            const result = await resendReminder(row.id);
            switch (result.kind) {
              case 'sent':
                showSuccess(labels.reminder.sent);
                break;
              case 'resent':
                showSuccess(labels.reminder.resent);
                break;
              case 'already_in_flight':
                showInfo(labels.reminder.alreadyInFlight);
                break;
              case 'no_envelope':
                showInfo(labels.reminder.noEnvelope);
                break;
              case 'not_actionable':
                showInfo(labels.reminder.notActionable);
                break;
            }
            if (result.kind === 'sent' || result.kind === 'resent') {
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: LEX_SIGNATURE_SUMMARY_QUERY_KEY,
                }),
                queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
              ]);
            }
          } catch (error) {
            showApiError(error);
          }
        })();
      },
    }),
    [canSend, getSummary, labels, queryClient],
  );
}
