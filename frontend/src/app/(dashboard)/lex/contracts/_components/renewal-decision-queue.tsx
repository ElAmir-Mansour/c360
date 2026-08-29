/**
 * Feature 10 — renewal decision queue.
 *
 * A dialog opened from the list-page {@link RenewalWarningsBanner}: the
 * expiring-contracts cohort (`GET /contracts/expiring` via the previously
 * unused `enterpriseApi.lex.getExpiringContracts`) enriched with the
 * renewal-warnings digest so every countdown chip is NOTICE-PERIOD aware, not
 * just expiry-date aware. The operator records a per-row decision — renew
 * (POST /contracts/{id}/renew), terminate or renegotiate (both via the status
 * FSM, targets from `DECISION_TARGET_STATUS`) — or applies one decision to a
 * checked selection in bulk. Each decision can optionally generate a
 * counterparty notice letter through the drafting API; generated letters are
 * persisted to the drafting studio history so they open as real drafts.
 *
 * Execution (sequential, per-row isolation, live progress, partial-failure
 * summary) lives in {@link useRenewalQueue}; this file is presentation only.
 *
 * RBAC: every mutating control is gated on the page's `canWrite`
 * (`lex:contract:add` OR `lex:contract:edit` — page.tsx §9/§18.4). Without it
 * the dialog renders the cohort read-only. Terminate/renegotiate additionally
 * require `lex:contract:approve` server-side; per-row failures from that gate
 * surface in the partial-failure summary rather than being pre-masked, exactly
 * like the existing BulkStatusDialog.
 *
 * Labels follow the canonical lex bilingual contract (`LexBilingual<T>` +
 * `resolveLexBilingual`); dates/digits ride `useLexFormat` (Arabic-Indic
 * digits under ar); layout uses logical props (ms-/me-/ps-/pe-) for RTL.
 */

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

import {
  type LexBilingual,
  lexContractStatusLabels,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';
import {
  type RenewalCountdownTone,
  type RenewalQueueDecision,
  type RenewalQueueDecisionInput,
  type RenewalQueueResult,
  type RenewalQueueRow,
  countdownTone,
  isDecisionAllowed,
  useRenewalQueue,
} from '../_lib/use-renewal-queue';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

interface RenewalQueueLabels {
  title: string;
  /** Dialog sub-line; receives the pre-formatted horizon-days figure. */
  description: (days: string) => string;
  loadFailed: string;
  retry: string;
  empty: string;
  /** Countdown chips. Day figures arrive pre-formatted (Arabic-Indic in ar). */
  expired: string;
  daysLeft: (days: string) => string;
  inNoticeWindow: string;
  /** Tooltip: the row's renewal notice window. */
  noticeWindow: (days: string) => string;
  noticeUnknown: string;
  autoRenew: string;
  decisionHeading: string;
  decisions: Record<RenewalQueueDecision, string>;
  skip: string;
  decisionBlocked: string;
  selectAll: string;
  selectRow: (title: string) => string;
  selectedCount: (count: string) => string;
  bulkSetPrefix: string;
  bulkClear: string;
  generateNotice: string;
  generateNoticeHint: string;
  termLabel: string;
  termMonths: (months: string) => string;
  /** Footer decision tally; figures arrive pre-formatted. */
  tally: (renew: string, terminate: string, renegotiate: string) => string;
  execute: (count: string) => string;
  executing: string;
  progress: (completed: string, total: string) => string;
  processing: (title: string) => string;
  resultsTitle: string;
  resultsApplied: (ok: string, total: string) => string;
  resultsFailed: (count: string) => string;
  resultsLetters: (count: string) => string;
  letterFailed: string;
  viewLetter: string;
  hideLetter: string;
  openStudio: string;
  backToQueue: string;
  done: string;
  cancel: string;
  close: string;
  readOnly: string;
  toastAll: (count: string) => string;
  toastPartial: (ok: string, failed: string) => string;
  toastNone: string;
}

const renewalQueueLabels: LexBilingual<RenewalQueueLabels> = {
  en: {
    title: 'Renewal decision queue',
    description: (days) =>
      `Contracts expiring within the next ${days} days, with notice-period-aware countdowns. Record a decision per contract, or apply one to a selection.`,
    loadFailed: 'Could not load the expiring-contracts cohort.',
    retry: 'Retry',
    empty: 'No contracts are expiring within the horizon.',
    expired: 'Expired',
    daysLeft: (days) => `${days} days left`,
    inNoticeWindow: 'In notice window',
    noticeWindow: (days) => `Renewal notice window: ${days} days`,
    noticeUnknown: 'Notice window not configured — assuming the default.',
    autoRenew: 'Auto-renew',
    decisionHeading: 'Decision',
    decisions: {
      renew: 'Renew',
      terminate: 'Terminate',
      renegotiate: 'Renegotiate',
    },
    skip: 'Skip',
    decisionBlocked: 'Not allowed from the current status',
    selectAll: 'Select all contracts',
    selectRow: (title) => `Select ${title}`,
    selectedCount: (count) => `${count} selected`,
    bulkSetPrefix: 'Set selected to',
    bulkClear: 'Clear',
    generateNotice: 'Generate notice letters',
    generateNoticeHint:
      'Drafts a counterparty notice per decision and files it in the drafting studio.',
    termLabel: 'Renewal term',
    termMonths: (months) => `${months} months`,
    tally: (renew, terminate, renegotiate) =>
      `${renew} renew · ${terminate} terminate · ${renegotiate} renegotiate`,
    execute: (count) => `Apply ${count} decisions`,
    executing: 'Applying…',
    progress: (completed, total) => `${completed} of ${total} processed`,
    processing: (title) => `Processing ${title}…`,
    resultsTitle: 'Run summary',
    resultsApplied: (ok, total) => `${ok} of ${total} decisions applied`,
    resultsFailed: (count) => `${count} failed`,
    resultsLetters: (count) => `${count} notice letters drafted`,
    letterFailed: 'Decision applied, but the notice letter failed',
    viewLetter: 'View letter',
    hideLetter: 'Hide letter',
    openStudio: 'Open drafting studio',
    backToQueue: 'Back to queue',
    done: 'Done',
    cancel: 'Cancel',
    close: 'Close',
    readOnly: 'You have view-only access — renewal decisions are disabled.',
    toastAll: (count) => `${count} renewal decisions applied.`,
    toastPartial: (ok, failed) => `${ok} applied, ${failed} failed.`,
    toastNone: 'No renewal decisions could be applied.',
  },
  ar: {
    title: 'قائمة قرارات التجديد',
    description: (days) =>
      `العقود التي تنتهي خلال ${days} يومًا القادمة، مع عدّ تنازلي يراعي مهلة الإشعار. سجّل قرارًا لكل عقد، أو طبّق قرارًا واحدًا على مجموعة محددة.`,
    loadFailed: 'تعذّر تحميل مجموعة العقود المنتهية.',
    retry: 'إعادة المحاولة',
    empty: 'لا توجد عقود تنتهي ضمن هذه الفترة.',
    expired: 'منتهي',
    daysLeft: (days) => `متبقٍ ${days} يومًا`,
    inNoticeWindow: 'ضمن نافذة الإشعار',
    noticeWindow: (days) => `مهلة إشعار التجديد: ${days} يومًا`,
    noticeUnknown: 'لم تُضبط مهلة الإشعار — سيُفترض الإعداد الافتراضي.',
    autoRenew: 'تجديد تلقائي',
    decisionHeading: 'القرار',
    decisions: {
      renew: 'تجديد',
      terminate: 'إنهاء',
      renegotiate: 'إعادة تفاوض',
    },
    skip: 'تخطٍّ',
    decisionBlocked: 'غير مسموح من الحالة الحالية',
    selectAll: 'تحديد جميع العقود',
    selectRow: (title) => `تحديد ${title}`,
    selectedCount: (count) => `${count} محدد`,
    bulkSetPrefix: 'تعيين المحدد إلى',
    bulkClear: 'مسح',
    generateNotice: 'إنشاء خطابات إشعار',
    generateNoticeHint:
      'يصوغ خطاب إشعار للطرف الآخر عن كل قرار ويحفظه في استوديو الصياغة.',
    termLabel: 'مدة التجديد',
    termMonths: (months) => `${months} شهرًا`,
    tally: (renew, terminate, renegotiate) =>
      `${renew} تجديد · ${terminate} إنهاء · ${renegotiate} إعادة تفاوض`,
    execute: (count) => `تطبيق ${count} قرارات`,
    executing: 'جارٍ التطبيق…',
    progress: (completed, total) => `تمت معالجة ${completed} من ${total}`,
    processing: (title) => `جارٍ معالجة ${title}…`,
    resultsTitle: 'ملخص التنفيذ',
    resultsApplied: (ok, total) => `طُبّق ${ok} من ${total} قرارات`,
    resultsFailed: (count) => `فشل ${count}`,
    resultsLetters: (count) => `صيغ ${count} خطاب إشعار`,
    letterFailed: 'طُبّق القرار، لكن تعذّر إنشاء خطاب الإشعار',
    viewLetter: 'عرض الخطاب',
    hideLetter: 'إخفاء الخطاب',
    openStudio: 'فتح استوديو الصياغة',
    backToQueue: 'العودة إلى القائمة',
    done: 'تم',
    cancel: 'إلغاء',
    close: 'إغلاق',
    readOnly: 'صلاحيتك للعرض فقط — قرارات التجديد معطّلة.',
    toastAll: (count) => `طُبّق ${count} من قرارات التجديد.`,
    toastPartial: (ok, failed) => `طُبّق ${ok}، وفشل ${failed}.`,
    toastNone: 'تعذّر تطبيق أي قرار تجديد.',
  },
};

/* ------------------------------------------------------------------------- *
 * Countdown chip — the notice-period-aware badge.
 * ------------------------------------------------------------------------- */

const countdownToneClass: Record<RenewalCountdownTone, string> = {
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
  notice:
    'border-warning-500/40 bg-warning-500/10 text-warning-700 dark:text-warning-300',
  upcoming: 'border-border bg-muted/50 text-muted-foreground',
};

function CountdownChip({
  row,
  labels,
  formatNumber,
}: {
  row: RenewalQueueRow;
  labels: RenewalQueueLabels;
  formatNumber: (value: number) => string;
}) {
  const tone = countdownTone(row.daysUntilExpiry, row.noticeDays);
  const text =
    tone === 'overdue' ? labels.expired : labels.daysLeft(formatNumber(row.daysUntilExpiry));
  const tooltip = row.noticeKnown
    ? labels.noticeWindow(formatNumber(row.noticeDays))
    : labels.noticeUnknown;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={tooltip}>
      <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', countdownToneClass[tone])}>
        <CalendarClock className="h-3 w-3" aria-hidden="true" />
        {text}
      </Badge>
      {tone === 'notice' ? (
        <Badge
          variant="outline"
          className={cn('whitespace-nowrap', countdownToneClass.notice)}
        >
          {labels.inNoticeWindow}
        </Badge>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * Dialog.
 * ------------------------------------------------------------------------- */

const DECISION_VALUES: RenewalQueueDecision[] = ['renew', 'terminate', 'renegotiate'];
const TERM_MONTH_OPTIONS = [6, 12, 24, 36];
/** Sentinel for "no decision" — Radix Select forbids empty-string item values. */
const SKIP = 'skip';
/** Cohort horizon default (days) — matches the list page's expiring-soon lens. */
const DEFAULT_HORIZON_DAYS = 60;

export interface RenewalDecisionQueueProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page's contract-mutation gate (`lex:contract:add` OR `lex:contract:edit`). */
  canWrite: boolean;
  /** Invoked once after a run in which at least one decision succeeded. */
  onApplied?: () => void;
  /** Expiry horizon (days) for the cohort. Defaults to {@link DEFAULT_HORIZON_DAYS}. */
  horizonDays?: number;
}

export function RenewalDecisionQueue({
  open,
  onOpenChange,
  canWrite,
  onApplied,
  horizonDays = DEFAULT_HORIZON_DAYS,
}: RenewalDecisionQueueProps) {
  const router = useRouter();
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const labels = useMemo(() => resolveLexBilingual(renewalQueueLabels, locale), [locale]);
  const statusLabels = useMemo(
    () => resolveLexBilingual(lexContractStatusLabels, locale),
    [locale],
  );
  const num = (value: number) => f.formatNumber(value);

  const queue = useRenewalQueue({ horizonDays, enabled: open });

  const [decisions, setDecisions] = useState<Record<string, RenewalQueueDecision>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [generateNotice, setGenerateNotice] = useState(true);
  const [termMonths, setTermMonths] = useState(12);
  const [letterOpenId, setLetterOpenId] = useState<string | null>(null);

  const checkedIds = useMemo(
    () => queue.rows.filter((row) => checked[row.id]).map((row) => row.id),
    [queue.rows, checked],
  );
  const allChecked = queue.rows.length > 0 && checkedIds.length === queue.rows.length;

  /** Rows with a recorded (still-legal) decision, in cohort order. */
  const pending: RenewalQueueDecisionInput[] = useMemo(
    () =>
      queue.rows
        .filter((row) => decisions[row.id] && isDecisionAllowed(row, decisions[row.id]))
        .map((row) => ({ row, decision: decisions[row.id] })),
    [queue.rows, decisions],
  );
  const tally = useMemo(() => {
    const counts: Record<RenewalQueueDecision, number> = {
      renew: 0,
      terminate: 0,
      renegotiate: 0,
    };
    for (const item of pending) {
      counts[item.decision] += 1;
    }
    return counts;
  }, [pending]);

  const setRowDecision = (rowId: string, value: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      if (value === SKIP) {
        delete next[rowId];
      } else {
        next[rowId] = value as RenewalQueueDecision;
      }
      return next;
    });
  };

  /** Bulk: apply one decision to every checked row where it is legal. */
  const applyBulkDecision = (decision: RenewalQueueDecision) => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const row of queue.rows) {
        if (checked[row.id] && isDecisionAllowed(row, decision)) {
          next[row.id] = decision;
        }
      }
      return next;
    });
  };

  const resetLocal = () => {
    setDecisions({});
    setChecked({});
    setLetterOpenId(null);
    queue.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (queue.executing) {
      return; // Never abandon a run mid-flight.
    }
    if (!next) {
      resetLocal();
    }
    onOpenChange(next);
  };

  const handleExecute = async () => {
    if (!canWrite || pending.length === 0 || queue.executing) {
      return;
    }
    const results = await queue.execute(pending, { generateNotice, termMonths, locale });
    const ok = results.filter((result) => result.ok).length;
    const failed = results.length - ok;
    if (failed === 0 && ok > 0) {
      showSuccess(labels.toastAll(num(ok)));
    } else if (ok === 0) {
      showError(labels.toastNone);
    } else {
      showSuccess(labels.toastPartial(num(ok), num(failed)));
    }
    if (ok > 0) {
      setDecisions({});
      setChecked({});
      onApplied?.();
    }
  };

  const results = queue.results;
  const okResults = results?.filter((result) => result.ok) ?? [];
  const letterCount = results?.filter((result) => result.notice).length ?? 0;
  const anyLetter = letterCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description(num(horizonDays))}</DialogDescription>
        </DialogHeader>

        {results ? (
          /* ---------------- Results (partial-failure summary) ---------------- */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{labels.resultsTitle}</span>
              <Badge variant="outline" className="gap-1 border-success-500/40 text-success-700 dark:text-success-300">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {labels.resultsApplied(num(okResults.length), num(results.length))}
              </Badge>
              {results.length - okResults.length > 0 ? (
                <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                  <XCircle className="h-3 w-3" aria-hidden="true" />
                  {labels.resultsFailed(num(results.length - okResults.length))}
                </Badge>
              ) : null}
              {anyLetter ? (
                <Badge variant="outline" className="gap-1">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  {labels.resultsLetters(num(letterCount))}
                </Badge>
              ) : null}
            </div>

            <ul className="max-h-[45vh] space-y-2 overflow-y-auto pe-1">
              {results.map((result: RenewalQueueResult) => (
                <li key={result.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {result.ok ? (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-success-600 dark:text-success-300"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{result.title}</span>
                    <Badge variant="outline">{labels.decisions[result.decision]}</Badge>
                    {result.notice ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setLetterOpenId((prev) => (prev === result.id ? null : result.id))
                        }
                      >
                        <FileText className="me-1 h-3.5 w-3.5" aria-hidden="true" />
                        {letterOpenId === result.id ? labels.hideLetter : labels.viewLetter}
                      </Button>
                    ) : null}
                  </div>
                  {result.error ? (
                    <p className="mt-1 text-xs text-destructive">{result.error}</p>
                  ) : null}
                  {result.noticeError ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-warning-700 dark:text-warning-300">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {labels.letterFailed}: {result.noticeError}
                    </p>
                  ) : null}
                  {result.notice && letterOpenId === result.id ? (
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border bg-muted/40 p-3">
                      <p className="text-sm font-semibold">{result.notice.title}</p>
                      {result.notice.summary ? (
                        <p className="text-xs text-muted-foreground">{result.notice.summary}</p>
                      ) : null}
                      {result.notice.sections.map((section, index) => (
                        <div key={index} className="space-y-0.5">
                          <p className="text-xs font-medium">{section.heading}</p>
                          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                            {section.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <DialogFooter className="gap-2">
              {anyLetter ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/lex/drafting?tab=contract')}
                >
                  <ExternalLink className="me-1.5 h-4 w-4" aria-hidden="true" />
                  {labels.openStudio}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => queue.reset()}>
                {labels.backToQueue}
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {labels.done}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ------------------------------ Queue ------------------------------ */
          <div className="space-y-4">
            {!canWrite ? (
              <p className="rounded-md border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-xs text-warning-700 dark:text-warning-300">
                {labels.readOnly}
              </p>
            ) : null}

            {queue.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : queue.isError ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {labels.loadFailed}
                <Button type="button" size="sm" variant="outline" onClick={queue.refetch}>
                  <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {labels.retry}
                </Button>
              </div>
            ) : queue.rows.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {labels.empty}
              </p>
            ) : (
              <>
                {canWrite ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Checkbox
                      id="renewal-queue-select-all"
                      checked={allChecked}
                      onCheckedChange={(value) => {
                        const next: Record<string, boolean> = {};
                        if (value === true) {
                          for (const row of queue.rows) {
                            next[row.id] = true;
                          }
                        }
                        setChecked(next);
                      }}
                      aria-label={labels.selectAll}
                      disabled={queue.executing}
                    />
                    <Label
                      htmlFor="renewal-queue-select-all"
                      className="text-xs text-muted-foreground"
                    >
                      {labels.selectedCount(num(checkedIds.length))}
                    </Label>
                    {checkedIds.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {labels.bulkSetPrefix}:
                        </span>
                        {DECISION_VALUES.map((decision) => (
                          <Button
                            key={decision}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => applyBulkDecision(decision)}
                            disabled={queue.executing}
                          >
                            {labels.decisions[decision]}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          onClick={() => setChecked({})}
                          disabled={queue.executing}
                        >
                          {labels.bulkClear}
                        </Button>
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <ul className="max-h-[45vh] space-y-2 overflow-y-auto pe-1">
                  {queue.rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3"
                    >
                      {canWrite ? (
                        <Checkbox
                          checked={Boolean(checked[row.id])}
                          onCheckedChange={(value) =>
                            setChecked((prev) => ({ ...prev, [row.id]: value === true }))
                          }
                          aria-label={labels.selectRow(row.title)}
                          disabled={queue.executing}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="truncate text-sm font-medium">{row.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.counterparty}
                          {row.ownerName ? ` · ${row.ownerName}` : ''}
                        </p>
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <Badge variant="outline">
                            {statusLabels[row.status] ?? row.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {f.formatDate(row.expiryDate)}
                          </span>
                          <CountdownChip row={row} labels={labels} formatNumber={num} />
                          {row.autoRenew ? (
                            <Badge variant="outline" className="gap-1">
                              <RefreshCw className="h-3 w-3" aria-hidden="true" />
                              {labels.autoRenew}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {canWrite ? (
                        <Select
                          value={decisions[row.id] ?? SKIP}
                          onValueChange={(value) => setRowDecision(row.id, value)}
                          disabled={queue.executing}
                        >
                          <SelectTrigger
                            className="h-8 w-36 shrink-0 text-xs"
                            aria-label={labels.decisionHeading}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>{labels.skip}</SelectItem>
                            {DECISION_VALUES.map((decision) => {
                              const allowed = isDecisionAllowed(row, decision);
                              return (
                                <SelectItem
                                  key={decision}
                                  value={decision}
                                  disabled={!allowed}
                                  title={allowed ? undefined : labels.decisionBlocked}
                                >
                                  {labels.decisions[decision]}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {canWrite ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id="renewal-queue-notice"
                        checked={generateNotice}
                        onCheckedChange={(value) => setGenerateNotice(value === true)}
                        disabled={queue.executing}
                      />
                      <Label
                        htmlFor="renewal-queue-notice"
                        className="text-xs"
                        title={labels.generateNoticeHint}
                      >
                        {labels.generateNotice}
                      </Label>
                    </span>
                    <span className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">{labels.termLabel}</Label>
                      <Select
                        value={String(termMonths)}
                        onValueChange={(value) => setTermMonths(Number(value))}
                        disabled={queue.executing || tally.renew === 0}
                      >
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TERM_MONTH_OPTIONS.map((months) => (
                            <SelectItem key={months} value={String(months)}>
                              {labels.termMonths(num(months))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  </div>
                ) : null}

                {queue.executing && queue.progress ? (
                  <div className="space-y-1.5">
                    <Progress
                      value={queue.progress.completed}
                      max={queue.progress.total}
                      className="h-2"
                      aria-label={labels.progress(
                        num(queue.progress.completed),
                        num(queue.progress.total),
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      {labels.progress(num(queue.progress.completed), num(queue.progress.total))}
                      {queue.progress.currentTitle
                        ? ` — ${labels.processing(queue.progress.currentTitle)}`
                        : ''}
                    </p>
                  </div>
                ) : null}
              </>
            )}

            <DialogFooter className="gap-2">
              {canWrite && pending.length > 0 ? (
                <span className="me-auto self-center text-xs text-muted-foreground">
                  {labels.tally(num(tally.renew), num(tally.terminate), num(tally.renegotiate))}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={queue.executing}
              >
                {canWrite ? labels.cancel : labels.close}
              </Button>
              {canWrite ? (
                <Button
                  type="button"
                  onClick={() => void handleExecute()}
                  disabled={pending.length === 0 || queue.executing}
                >
                  {queue.executing ? (
                    <RefreshCw className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {queue.executing ? labels.executing : labels.execute(num(pending.length))}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
