/**
 * Feature 8a — list-level renewal warnings.
 *
 * Two complementary surfaces sit on the contracts LIST page (`/lex/contracts`):
 *
 *   1. {@link RenewalWarningsBanner} — a dismissible summary banner driven by
 *      `enterpriseApi.lex.getContractRenewalWarnings()`. It mirrors the visual
 *      idiom of the detail-level `RenewalAlertBanner` but reports the portfolio
 *      total (urgent + warning) and hands triage back to the page via `onTriage`.
 *
 *   2. {@link ContractRenewalCell} — a compact table-cell renderer for a single
 *      contract's `renewal_date`, toned overdue / in-notice-window / normal with
 *      an optional auto-renew chip.
 *
 * Both are fully bilingual (English + MSA) following the canonical lex
 * `LexBilingual<T> = { en, ar }` token-record contract. Logical spacing props
 * (me-/ms-/ps-/pe-) keep the layout correct under RTL.
 */

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ListChecks, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RelativeTime } from '@/components/shared/relative-time';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

interface RenewalWarningsLabels {
  /** Banner heading. Pluralizes on the portfolio total. */
  bannerTitle: (total: number) => string;
  /** Sub-line breaking the total into urgent + warning counts. */
  bannerDetail: (urgent: number, warning: number) => string;
  /** CTA that hands triage to the page (apply the renewal preset). */
  triage: string;
  /** CTA that opens the renewal decision queue panel (feature 10). */
  openQueue: string;
  /** Dismiss control aria-label. */
  dismiss: string;
  /** Auto-renew chip on the cell. */
  autoRenew: string;
  /** Cell aria-label / tooltip prefixes. */
  overdue: string;
  inNoticeWindow: string;
  /** Em-dash placeholder when no renewal date. */
  noRenewal: string;
}

const renewalWarningsLabels: LexBilingual<RenewalWarningsLabels> = {
  en: {
    bannerTitle: (total) =>
      `${total} contract${total === 1 ? '' : 's'} need renewal action`,
    bannerDetail: (urgent, warning) =>
      `${urgent} urgent · ${warning} upcoming within the notice window.`,
    triage: 'Review renewals',
    openQueue: 'Open renewal queue',
    dismiss: 'Dismiss renewal summary',
    autoRenew: 'Auto-renew',
    overdue: 'Overdue',
    inNoticeWindow: 'In notice window',
    noRenewal: '—',
  },
  ar: {
    bannerTitle: (total) => `${total} عقد بحاجة إلى إجراء تجديد`,
    bannerDetail: (urgent, warning) =>
      `${urgent} عاجل · ${warning} قادم ضمن نافذة الإشعار.`,
    triage: 'مراجعة التجديدات',
    openQueue: 'فتح قائمة قرارات التجديد',
    dismiss: 'إخفاء ملخص التجديد',
    autoRenew: 'تجديد تلقائي',
    overdue: 'متأخر',
    inNoticeWindow: 'ضمن نافذة الإشعار',
    noRenewal: '—',
  },
};

function useRenewalWarningsLabels(): RenewalWarningsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(renewalWarningsLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * 1. RenewalWarningsBanner — list-level summary.
 * ------------------------------------------------------------------------- */

export interface RenewalWarningsBannerProps {
  /**
   * Invoked when the operator clicks the triage CTA. The integrator wires this
   * to apply the expiring/renewal preset (e.g. `setFilter(...)`).
   */
  onTriage: () => void;
  /**
   * When provided, renders the "Open renewal queue" CTA that opens the
   * {@link RenewalDecisionQueue} panel. Pass it ONLY for personas that can
   * mutate contracts (the page's `canWrite`) — the queue is a decision
   * surface, so read-only personas keep the triage-only banner.
   */
  onOpenQueue?: () => void;
  /** Optional className passthrough for layout placement. */
  className?: string;
}

/**
 * Dismissible portfolio-level renewal summary. Fetches the renewal-warnings
 * digest and renders only when `total > 0`. When any contract is `urgent` the
 * banner adopts the danger tone; otherwise the amber/warning tone. Dismiss state
 * is local (not persisted) so it returns on the next navigation/mount.
 *
 * Returns `null` while loading, on error, or when `total === 0`.
 */
export function RenewalWarningsBanner({
  onTriage,
  onOpenQueue,
  className,
}: RenewalWarningsBannerProps) {
  const labels = useRenewalWarningsLabels();
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['lex-contract-renewal-warnings'],
    queryFn: () => enterpriseApi.lex.getContractRenewalWarnings(),
    staleTime: 60_000,
  });

  if (isLoading || isError || dismissed || !data || data.total === 0) {
    return null;
  }

  const urgent = data.urgent > 0;
  const Icon = urgent ? ShieldAlert : CalendarClock;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
        urgent
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-warning-500/30 bg-warning-500/10',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            urgent
              ? 'bg-destructive/15 text-destructive'
              : 'bg-warning-500/15 text-warning-700 dark:text-warning-300',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-0.5">
          <p
            className={cn(
              'text-sm font-semibold',
              urgent ? 'text-destructive' : 'text-warning-700 dark:text-warning-300',
            )}
          >
            {labels.bannerTitle(data.total)}
          </p>
          <p className="text-sm text-muted-foreground">
            {labels.bannerDetail(data.urgent, data.warning)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 ps-12 sm:ps-0">
        <Button
          type="button"
          size="sm"
          variant={urgent ? 'destructive' : 'default'}
          onClick={onTriage}
        >
          {labels.triage}
        </Button>
        {onOpenQueue ? (
          <Button type="button" size="sm" variant="outline" onClick={onOpenQueue}>
            <ListChecks className="me-1.5 h-4 w-4" aria-hidden="true" />
            {labels.openQueue}
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => setDismissed(true)}
          aria-label={labels.dismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * 2. ContractRenewalCell — single-row renewal date renderer.
 * ------------------------------------------------------------------------- */

export interface ContractRenewalCellProps {
  /** ISO renewal date. Em-dash placeholder when null/undefined. */
  renewalDate?: string | null;
  /** Whether the contract auto-renews (renders an inline chip). */
  autoRenew: boolean;
  /** Renewal notice window in days; defines the "in-notice-window" tone. */
  noticeDays: number;
  /** Optional className passthrough. */
  className?: string;
}

type RenewalTone = 'overdue' | 'notice' | 'normal';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Classify a renewal date into a tone:
 *   - `overdue`  — the renewal date is in the past.
 *   - `notice`   — the renewal date is within `noticeDays` from now.
 *   - `normal`   — beyond the notice window.
 */
function renewalTone(date: Date, noticeDays: number): RenewalTone {
  const diffDays = (date.getTime() - Date.now()) / MS_PER_DAY;
  if (diffDays < 0) {
    return 'overdue';
  }
  if (diffDays <= Math.max(0, noticeDays)) {
    return 'notice';
  }
  return 'normal';
}

const toneClassName: Record<RenewalTone, string> = {
  overdue: 'text-destructive',
  notice: 'text-warning-700 dark:text-warning-300',
  normal: 'text-foreground',
};

/**
 * Compact renewal cell: renders `renewalDate` via {@link RelativeTime} toned by
 * proximity to the notice window, plus an auto-renew chip when `autoRenew`.
 * Renders an em-dash when no renewal date is set.
 */
export function ContractRenewalCell({
  renewalDate,
  autoRenew,
  noticeDays,
  className,
}: ContractRenewalCellProps) {
  const labels = useRenewalWarningsLabels();

  const parsed = renewalDate ? new Date(renewalDate) : null;
  const isValidDate = parsed instanceof Date && !Number.isNaN(parsed.getTime());

  if (!parsed || !isValidDate) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="text-sm text-muted-foreground">{labels.noRenewal}</span>
        {autoRenew ? (
          <Badge variant="outline" className="shrink-0">
            <RefreshCw className="me-1 h-3 w-3" aria-hidden="true" />
            {labels.autoRenew}
          </Badge>
        ) : null}
      </div>
    );
  }

  const tone = renewalTone(parsed, noticeDays);
  const toneLabel =
    tone === 'overdue'
      ? labels.overdue
      : tone === 'notice'
        ? labels.inNoticeWindow
        : undefined;

  return (
    <div className={cn('flex items-center gap-2', className)} title={toneLabel}>
      <RelativeTime date={parsed} className={cn('font-medium', toneClassName[tone])} />
      {autoRenew ? (
        <Badge variant="outline" className="shrink-0">
          <RefreshCw className="me-1 h-3 w-3" aria-hidden="true" />
          {labels.autoRenew}
        </Badge>
      ) : null}
    </div>
  );
}
