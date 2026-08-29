/**
 * Feature 9b/9c — obligations command center for the contracts LIST page
 * (`/lex/contracts`).
 *
 * Two exports, both fed by the SINGLE batched obligations fetch shared through
 * `_lib/use-obligations-rollup.ts` (same TanStack cache entry as every
 * {@link ContractObligationsCell} row — the page still performs exactly one
 * obligations request):
 *
 *   1. {@link ObligationsKpiTile} — a KpiCard tile ("due in 7 days" headline,
 *      overdue footer metric) for the page's KPI grid, computed over the
 *      currently VISIBLE (filtered) contract rows.
 *
 *   2. {@link ObligationsCommandCenter} — a collapsible right-rail panel over
 *      the filtered set: upcoming open obligations (triage order) with SAR
 *      exposure, auto-renew opt-out countdowns (`expiry_date -
 *      renewal_notice_days`), and a "Send reminders" action that chains the
 *      existing reminder pipeline (`POST /obligations/reminders/enqueue` →
 *      `POST /obligations/reminders/outbox/dispatch`).
 *
 * RBAC: the send-reminders mutation is rendered ONLY for personas holding
 * `lex:contract:edit` — the same verb the obligations workspace uses to gate
 * its reminder actions (obligations/page.tsx `canWrite`). Read-only content
 * carries no extra gate beyond the page's own view guard.
 *
 * Bilingual (English + MSA) via the canonical lex `LexBilingual<T>` colocated
 * token-record contract; KSA formatting (SAR currency, Arabic-Indic digits,
 * localized dates) through `useLexFormat`. Logical spacing props (ms-/me-,
 * text-start) keep the panel RTL-safe.
 */

'use client';

import { useId, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  BellRing,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { LexContract } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  type AutoRenewCountdown,
  type UpcomingObligationEntry,
  OBLIGATIONS_DUE_SOON_DAYS,
  OBLIGATIONS_ROLLUP_QUERY_KEY,
  useObligationsRollup,
} from '../_lib/use-obligations-rollup';
import { ContractKpiTile } from './contracts-kpi-tile';

/** Rows shown before the "+N more" line (panel stays rail-sized). */
const UPCOMING_LIMIT = 8;
const AUTO_RENEW_LIMIT = 5;

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

export interface ObligationsCommandCenterLabels {
  /** Panel heading + region aria-label. */
  panelTitle: string;
  /** Collapse/expand toggle aria-labels. */
  expand: string;
  collapse: string;
  /** Header chips (localized counts). */
  dueSoonChip: (count: string) => string;
  overdueChip: (count: string) => string;
  /** SAR exposure summary. */
  exposureTitle: string;
  exposureDetail: (contracts: string) => string;
  exposureNonSar: (count: string) => string;
  /** Upcoming obligations section. */
  upcomingTitle: string;
  upcomingEmpty: string;
  moreUpcoming: (count: string) => string;
  dueToday: string;
  dueIn: (days: string) => string;
  overdueBy: (days: string) => string;
  /** Row aria-label when the row opens the contract preview. */
  openContract: (title: string) => string;
  /** Auto-renew opt-out section. */
  autoRenewTitle: string;
  autoRenewEmpty: string;
  optOutBy: (date: string) => string;
  daysLeft: (days: string) => string;
  windowClosed: string;
  noticeDays: (days: string) => string;
  /** Send-reminders action + result toast. */
  sendReminders: string;
  sending: string;
  remindersTitle: string;
  remindersDescription: (queued: string, sent: string) => string;
  /** Tenant has more obligations than one clamped page. */
  truncated: string;
  /** Fetch failure line. */
  loadError: string;
  /** KPI tile. */
  kpiTitle: string;
  kpiDescription: string;
  kpiOverdue: string;
  kpiOverdueShare: string;
}

export const obligationsCommandCenterLabels: LexBilingual<ObligationsCommandCenterLabels> = {
  en: {
    panelTitle: 'Obligations command center',
    expand: 'Expand obligations command center',
    collapse: 'Collapse obligations command center',
    dueSoonChip: (count) => `${count} due in 7 days`,
    overdueChip: (count) => `${count} overdue`,
    exposureTitle: 'SAR exposure',
    exposureDetail: (contracts) => `across ${contracts} contracts with open obligations`,
    exposureNonSar: (count) => `${count} foreign-currency contracts excluded`,
    upcomingTitle: 'Upcoming obligations',
    upcomingEmpty: 'No open obligations for the contracts in view.',
    moreUpcoming: (count) => `+${count} more open obligations`,
    dueToday: 'Due today',
    dueIn: (days) => `Due in ${days} days`,
    overdueBy: (days) => `Overdue by ${days} days`,
    openContract: (title) => `Open contract ${title}`,
    autoRenewTitle: 'Auto-renew opt-out countdown',
    autoRenewEmpty: 'No auto-renewing contracts in view.',
    optOutBy: (date) => `Opt out by ${date}`,
    daysLeft: (days) => `${days} days left`,
    windowClosed: 'Window closed',
    noticeDays: (days) => `${days}-day notice`,
    sendReminders: 'Send reminders',
    sending: 'Sending…',
    remindersTitle: 'Reminders dispatched',
    remindersDescription: (queued, sent) => `${queued} queued · ${sent} sent.`,
    truncated: 'Showing the first page of obligations; counts may be partial.',
    loadError: 'Obligations could not be loaded.',
    kpiTitle: 'Obligations due 7d',
    kpiDescription: 'Open obligations across visible contracts',
    kpiOverdue: 'Overdue',
    kpiOverdueShare: 'Overdue share',
  },
  ar: {
    panelTitle: 'مركز قيادة الالتزامات',
    expand: 'توسيع مركز قيادة الالتزامات',
    collapse: 'طي مركز قيادة الالتزامات',
    dueSoonChip: (count) => `${count} مستحقة خلال ٧ أيام`,
    overdueChip: (count) => `${count} متأخرة`,
    exposureTitle: 'التعرض المالي (ريال)',
    exposureDetail: (contracts) => `عبر ${contracts} عقدًا ذا التزامات مفتوحة`,
    exposureNonSar: (count) => `${count} عقود بعملات أجنبية مستثناة`,
    upcomingTitle: 'الالتزامات القادمة',
    upcomingEmpty: 'لا توجد التزامات مفتوحة للعقود المعروضة.',
    moreUpcoming: (count) => `+${count} التزامات مفتوحة إضافية`,
    dueToday: 'مستحق اليوم',
    dueIn: (days) => `يستحق خلال ${days} يومًا`,
    overdueBy: (days) => `متأخر منذ ${days} يومًا`,
    openContract: (title) => `فتح العقد ${title}`,
    autoRenewTitle: 'العد التنازلي لإلغاء التجديد التلقائي',
    autoRenewEmpty: 'لا توجد عقود بتجديد تلقائي ضمن العرض.',
    optOutBy: (date) => `إلغاء التجديد قبل ${date}`,
    daysLeft: (days) => `متبقٍ ${days} يومًا`,
    windowClosed: 'انتهت المهلة',
    noticeDays: (days) => `إشعار ${days} يومًا`,
    sendReminders: 'إرسال التذكيرات',
    sending: 'جارٍ الإرسال…',
    remindersTitle: 'تم إرسال التذكيرات',
    remindersDescription: (queued, sent) => `${queued} في قائمة الانتظار · ${sent} أُرسلت.`,
    truncated: 'يتم عرض الصفحة الأولى من الالتزامات؛ قد تكون الأعداد جزئية.',
    loadError: 'تعذر تحميل الالتزامات.',
    kpiTitle: 'التزامات خلال ٧ أيام',
    kpiDescription: 'التزامات مفتوحة عبر العقود المعروضة',
    kpiOverdue: 'متأخرة',
    kpiOverdueShare: 'نسبة المتأخر',
  },
};

export function useObligationsCommandCenterLabels(): ObligationsCommandCenterLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(obligationsCommandCenterLabels, locale), [locale]);
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/* ------------------------------------------------------------------------- *
 * 1. ObligationsKpiTile — KPI-grid tile (due 7d headline, overdue footer).
 * ------------------------------------------------------------------------- */

export interface ObligationsKpiTileProps {
  /** The currently visible (filtered) contract rows. */
  contracts: readonly LexContract[];
  className?: string;
}

/**
 * "Obligations due 7d" KPI over the visible contract set, with the overdue
 * count as the footer metric. Turns rose the moment anything is overdue.
 * Shares the batched obligations fetch with the panel and the table cells.
 */
export function ObligationsKpiTile({ contracts, className }: ObligationsKpiTileProps) {
  const labels = useObligationsCommandCenterLabels();
  const f = useLexFormat();
  const rollup = useObligationsRollup(contracts);

  return (
    <ContractKpiTile
      title={labels.kpiTitle}
      value={rollup.dueSoon}
      theme={rollup.overdue > 0 ? 'rose' : 'gold'}
      icon={BellRing}
      progress={share(rollup.overdue, rollup.openTotal)}
      progressLabel={labels.kpiOverdueShare}
      detail={labels.kpiOverdue}
      detailValue={f.formatNumber(rollup.overdue)}
      loading={rollup.isLoading}
      className={className}
      href="#contracts-obligations-command-center"
    />
  );
}

/* ------------------------------------------------------------------------- *
 * 2. ObligationsCommandCenter — collapsible right-rail panel.
 * ------------------------------------------------------------------------- */

export interface ObligationsCommandCenterProps {
  /** The currently visible (filtered) contract rows. */
  contracts: readonly LexContract[];
  /** Opens the contract preview drawer for a row inside the panel. */
  onSelectContract?: (contractId: string) => void;
  /** Panel starts expanded by default. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Collapsible right-rail command center over the filtered contract set:
 * SAR exposure, upcoming open obligations (most overdue first), auto-renew
 * opt-out countdowns, and — for `lex:contract:edit` holders — a send-reminders
 * action chaining the existing enqueue → outbox-dispatch pipeline.
 */
export function ObligationsCommandCenter({
  contracts,
  onSelectContract,
  defaultOpen = true,
  className,
}: ObligationsCommandCenterProps) {
  const labels = useObligationsCommandCenterLabels();
  const f = useLexFormat();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);

  const rollup = useObligationsRollup(contracts);

  // Same verb the obligations workspace uses for its reminder mutations —
  // the button is NOT rendered for personas that cannot perform it.
  const canSendReminders = hasPermission('lex:contract:edit');

  const remindersMutation = useMutation({
    // Two-step pipeline against the existing endpoints: plan + queue the
    // 7-day horizon (matching the KPI window), then dispatch the outbox.
    mutationFn: async () => {
      const enqueue = await enterpriseApi.lex.enqueueObligationReminders({
        horizon_days: OBLIGATIONS_DUE_SOON_DAYS,
        include_escalations: true,
        channels: ['email', 'in_app'],
      });
      const dispatch = await enterpriseApi.lex.dispatchObligationReminderOutbox();
      return { enqueue, dispatch };
    },
    onSuccess: async ({ enqueue, dispatch }) => {
      showSuccess(
        labels.remindersTitle,
        labels.remindersDescription(
          f.formatNumber(enqueue.queued_count),
          f.formatNumber(dispatch.sent_count),
        ),
      );
      // `last_reminder_at` changed server-side — refresh the shared payload.
      await queryClient.invalidateQueries({ queryKey: OBLIGATIONS_ROLLUP_QUERY_KEY });
    },
    onError: showApiError,
  });

  const upcomingVisible = rollup.upcoming.slice(0, UPCOMING_LIMIT);
  const upcomingRest = rollup.upcoming.length - upcomingVisible.length;
  const autoRenewVisible = rollup.autoRenew.slice(0, AUTO_RENEW_LIMIT);

  return (
    <section
      id="contracts-obligations-command-center"
      aria-label={labels.panelTitle}
      className={cn('rounded-xl border border-border bg-card', className)}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={open ? labels.collapse : labels.expand}
        className={cn(
          'flex w-full items-center gap-2 p-4 text-start',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{labels.panelTitle}</span>
        {rollup.dueSoon > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 border-warning-500/40 bg-warning-500/10 tabular-nums text-warning-700 dark:text-warning-300"
          >
            {labels.dueSoonChip(f.formatNumber(rollup.dueSoon))}
          </Badge>
        ) : null}
        {rollup.overdue > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 border-destructive/40 bg-destructive/10 tabular-nums text-destructive"
          >
            <AlertTriangle className="me-1 h-3 w-3" aria-hidden="true" />
            {labels.overdueChip(f.formatNumber(rollup.overdue))}
          </Badge>
        ) : null}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div id={contentId} className="space-y-4 border-t border-border p-4">
          {rollup.isLoading ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : rollup.isError ? (
            <p className="text-sm text-muted-foreground">{labels.loadError}</p>
          ) : (
            <>
              {/* SAR exposure over the distinct contracts carrying open obligations. */}
              {rollup.exposure.contractCount > 0 || rollup.exposure.nonSarCount > 0 ? (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Banknote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {labels.exposureTitle}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {f.formatCurrency(rollup.exposure.sarTotal, { currency: 'SAR' })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {labels.exposureDetail(f.formatNumber(rollup.exposure.contractCount))}
                    {rollup.exposure.nonSarCount > 0 ? (
                      <span className="block">
                        {labels.exposureNonSar(f.formatNumber(rollup.exposure.nonSarCount))}
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : null}

              {/* Upcoming open obligations — most overdue first. */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {labels.upcomingTitle}
                </h3>
                {upcomingVisible.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{labels.upcomingEmpty}</p>
                ) : (
                  <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pe-1">
                    {upcomingVisible.map((entry) => (
                      <UpcomingObligationRow
                        key={entry.obligation.id}
                        entry={entry}
                        labels={labels}
                        onSelectContract={onSelectContract}
                      />
                    ))}
                  </ul>
                )}
                {upcomingRest > 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {labels.moreUpcoming(f.formatNumber(upcomingRest))}
                  </p>
                ) : null}
              </div>

              {/* Auto-renew opt-out countdowns (expiry_date - renewal_notice_days). */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {labels.autoRenewTitle}
                </h3>
                {autoRenewVisible.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{labels.autoRenewEmpty}</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {autoRenewVisible.map((entry) => (
                      <AutoRenewCountdownRow
                        key={entry.contract.id}
                        entry={entry}
                        labels={labels}
                        onSelectContract={onSelectContract}
                      />
                    ))}
                  </ul>
                )}
              </div>

              {rollup.truncated ? (
                <p className="text-xs text-muted-foreground">{labels.truncated}</p>
              ) : null}

              {canSendReminders ? (
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={() => remindersMutation.mutate()}
                  disabled={remindersMutation.isPending || rollup.openTotal === 0}
                >
                  {remindersMutation.isPending ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
                  )}
                  {remindersMutation.isPending ? labels.sending : labels.sendReminders}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------- *
 * Rows.
 * ------------------------------------------------------------------------- */

function UpcomingObligationRow({
  entry,
  labels,
  onSelectContract,
}: {
  entry: UpcomingObligationEntry;
  labels: ObligationsCommandCenterLabels;
  onSelectContract?: (contractId: string) => void;
}) {
  const f = useLexFormat();
  const { obligation, contract } = entry;
  const days = obligation.days_until_due;

  const dueLabel =
    days < 0
      ? labels.overdueBy(f.formatNumber(Math.abs(days)))
      : days === 0
        ? labels.dueToday
        : labels.dueIn(f.formatNumber(days));

  const dueClassName =
    days < 0
      ? 'text-destructive'
      : days <= OBLIGATIONS_DUE_SOON_DAYS
        ? 'text-warning-700 dark:text-warning-300'
        : 'text-muted-foreground';

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{obligation.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{contract.title}</span>
      </span>
      <span className="shrink-0 text-end">
        <span className="block text-xs text-foreground">{f.formatDate(obligation.due_date)}</span>
        <span className={cn('block text-xs font-medium tabular-nums', dueClassName)}>
          {dueLabel}
        </span>
      </span>
    </>
  );

  if (!onSelectContract) {
    return <li className="flex items-center gap-2 rounded-md px-2 py-1.5">{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectContract(contract.id)}
        aria-label={labels.openContract(contract.title)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-muted/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {body}
      </button>
    </li>
  );
}

function AutoRenewCountdownRow({
  entry,
  labels,
  onSelectContract,
}: {
  entry: AutoRenewCountdown;
  labels: ObligationsCommandCenterLabels;
  onSelectContract?: (contractId: string) => void;
}) {
  const f = useLexFormat();
  const { contract, deadline, daysLeft } = entry;

  const countdown =
    daysLeft < 0 ? labels.windowClosed : labels.daysLeft(f.formatNumber(daysLeft));
  const countdownClassName =
    daysLeft < 0
      ? 'text-destructive'
      : daysLeft <= OBLIGATIONS_DUE_SOON_DAYS
        ? 'text-warning-700 dark:text-warning-300'
        : 'text-muted-foreground';

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{contract.title}</span>
        <span
          className="block truncate text-xs text-muted-foreground"
          title={labels.noticeDays(f.formatNumber(Math.max(0, contract.renewal_notice_days)))}
        >
          {labels.optOutBy(f.formatDate(deadline))}
        </span>
      </span>
      <span className={cn('shrink-0 text-xs font-medium tabular-nums', countdownClassName)}>
        {countdown}
      </span>
    </>
  );

  if (!onSelectContract) {
    return <li className="flex items-center gap-2 rounded-md px-2 py-1.5">{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectContract(contract.id)}
        aria-label={labels.openContract(contract.title)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-muted/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {body}
      </button>
    </li>
  );
}
