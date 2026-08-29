/**
 * Send-for-review action for the ClarioLegal / Watheeq contracts LIST page —
 * a thin shell over the same `enterpriseApi.lex.startContractReview` endpoint
 * the detail page's ReviewDialog submits to (POST /contracts/{id}/review).
 *
 * The detail page's dialog (contracts/[id]/page.tsx `ReviewDialog`) carries the
 * full DoA policy picker / recommendation / OOO-delegation surface and is
 * defined inline in that page, so this component intentionally duplicates only
 * the THIN dialog shell (approver, role, SLA, description) rather than editing
 * the detail file — per the list-workspace agent contract. The payload shape is
 * the same `LexReviewContractRequest` subset the backend accepts (description +
 * sla_hours + approver_user_id/approver_role; sla defaults to 48h server-side).
 *
 * One dialog backs BOTH the per-row action and the table bulk action (a single
 * selected id behaves identically to a batch — the BulkStatusDialog precedent):
 *  - contracts already carrying a `workflow_instance_id` are partitioned out up
 *    front (the backend would 409 "already has an active workflow instance");
 *  - eligible contracts are submitted SEQUENTIALLY with a live progress bar;
 *  - the run ends in an inline partial-failure summary. Separation-of-duties
 *    403s (author == approver → `SOD_CONFLICT` / FORBIDDEN + "separation of
 *    duties") are rendered as a FRIENDLY inline explanation — never an error
 *    toast — because SoD is the control working as designed, not a fault.
 *
 * Labels follow the canonical lex bilingual contract (`LexBilingual<T>` bundle
 * resolved via `useLocaleOrDefault`, mirroring `contracts-labels.ts`). Counts
 * flow through `useLexFormat().formatNumber` so Arabic renders Arabic-Indic
 * digits. Layout is RTL-safe (logical `ms-`/`me-`/`ps-` utilities only).
 *
 * RBAC: rendering is gated on the SAME `canWrite` verb set as the list page
 * (`lex:contract:add` OR `lex:contract:edit` — page.tsx §9/§18.4); the page
 * additionally only registers the row/bulk actions when `canWrite` holds, so a
 * read-only persona never sees this mutation at all.
 */

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { showError, showSuccess } from '@/lib/toast';
import type { LexContract, LexReviewContractRequest } from '@/types/suites';

import {
  type LexBilingual,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (exported so the list page and tests reuse one source).
 * ------------------------------------------------------------------------- */

export interface SendForReviewLabels {
  /** Row / bulk action entry labels consumed by page.tsx. */
  actionRow: string;
  actionBulk: string;
  title: string;
  description: (count: number) => string;
  approver: string;
  loadingUsers: string;
  selectApprover: string;
  assignByRole: string;
  approverRole: string;
  approverRolePlaceholder: string;
  slaHours: string;
  taskDescription: string;
  taskDescriptionPlaceholder: string;
  eligible: (count: number) => string;
  alreadyInReview: (count: number) => string;
  alreadyInReviewListLabel: string;
  noEligible: string;
  validationHint: string;
  cancel: string;
  send: string;
  sending: string;
  progressOf: (done: string, total: string) => string;
  summaryTitle: string;
  succeeded: (count: number) => string;
  sodTitle: string;
  sodExplanation: string;
  failedTitle: string;
  close: string;
  successAll: (count: number) => string;
  successPartial: (succeeded: number, failed: number) => string;
  allFailed: string;
}

export const sendForReviewLabels: LexBilingual<SendForReviewLabels> = {
  en: {
    actionRow: 'Send for review',
    actionBulk: 'Send for review',
    title: 'Send for review',
    description: (count) =>
      `Start the legal review workflow for ${count} selected contract${count === 1 ? '' : 's'}. Contracts already in review are skipped.`,
    approver: 'Specific approver',
    loadingUsers: 'Loading users…',
    selectApprover: 'Select an approver',
    assignByRole: 'Assign by role',
    approverRole: 'Approver role',
    approverRolePlaceholder: 'e.g. legal-director',
    slaHours: 'SLA (hours)',
    taskDescription: 'Task description',
    taskDescriptionPlaceholder: 'What should the reviewer focus on?',
    eligible: (count) => `${count} will be sent for review`,
    alreadyInReview: (count) => `${count} skipped`,
    alreadyInReviewListLabel: 'Already in review',
    noEligible:
      'Every selected contract already has an active review workflow. Nothing to send.',
    validationHint:
      'Provide a description (at least 5 characters) and an approver — a specific person or a role.',
    cancel: 'Cancel',
    send: 'Send for review',
    sending: 'Sending…',
    progressOf: (done, total) => `${done} of ${total}`,
    summaryTitle: 'Review submission summary',
    succeeded: (count) => `${count} sent for review`,
    sodTitle: 'Separation of duties',
    sodExplanation:
      'You authored these contracts, so separation-of-duties rules require a different person to run their approval. This protects the approval trail — ask a colleague with the approver role to send them for review.',
    failedTitle: 'Could not be sent',
    close: 'Close',
    successAll: (count) => `${count} contract${count === 1 ? '' : 's'} sent for review.`,
    successPartial: (succeeded, failed) => `${succeeded} sent, ${failed} not sent.`,
    allFailed: 'No contracts could be sent for review.',
  },
  ar: {
    actionRow: 'إرسال للمراجعة',
    actionBulk: 'إرسال للمراجعة',
    title: 'إرسال للمراجعة',
    description: (count) =>
      `بدء سير عمل المراجعة القانونية لـ ${count} عقد محدد. تُتخطى العقود قيد المراجعة بالفعل.`,
    approver: 'معتمِد محدد',
    loadingUsers: 'جارٍ تحميل المستخدمين…',
    selectApprover: 'اختر معتمِدًا',
    assignByRole: 'إسناد حسب الدور',
    approverRole: 'دور المعتمِد',
    approverRolePlaceholder: 'مثال: legal-director',
    slaHours: 'اتفاقية مستوى الخدمة (ساعات)',
    taskDescription: 'وصف المهمة',
    taskDescriptionPlaceholder: 'ما الذي ينبغي أن يركّز عليه المراجع؟',
    eligible: (count) => `${count} سيُرسل للمراجعة`,
    alreadyInReview: (count) => `${count} تم تخطّيه`,
    alreadyInReviewListLabel: 'قيد المراجعة بالفعل',
    noEligible: 'جميع العقود المحددة لديها سير عمل مراجعة نشط بالفعل. لا يوجد ما يُرسل.',
    validationHint: 'أدخل وصفًا (5 أحرف على الأقل) ومعتمِدًا — شخصًا محددًا أو دورًا.',
    cancel: 'إلغاء',
    send: 'إرسال للمراجعة',
    sending: 'جارٍ الإرسال…',
    progressOf: (done, total) => `${done} من ${total}`,
    summaryTitle: 'ملخص إرسال المراجعة',
    succeeded: (count) => `تم إرسال ${count} للمراجعة`,
    sodTitle: 'الفصل بين المهام',
    sodExplanation:
      'أنت مَن أنشأ هذه العقود، لذا تقتضي قواعد الفصل بين المهام أن يتولى شخص آخر اعتمادها. هذا يحمي سجل الاعتماد — اطلب من زميل يحمل دور المعتمِد إرسالها للمراجعة.',
    failedTitle: 'تعذّر الإرسال',
    close: 'إغلاق',
    successAll: (count) => `تم إرسال ${count} عقد للمراجعة.`,
    successPartial: (succeeded, failed) => `تم إرسال ${succeeded}، ولم يُرسل ${failed}.`,
    allFailed: 'تعذّر إرسال أي عقد للمراجعة.',
  },
};

/** Hook the list page uses for the row/bulk action entry labels. */
export function useSendForReviewLabels(): SendForReviewLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(sendForReviewLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * SoD classification.
 * ------------------------------------------------------------------------- */

/**
 * True when a rejected start-review call is the dynamic separation-of-duties
 * guard (author == approver) rather than a genuine fault. The API layer
 * normalizes axios failures into `ApiError { status, code, message }`; the SoD
 * denial arrives either as the route middleware's `SOD_CONFLICT` code or as a
 * service-level 403 FORBIDDEN whose message names separation of duties
 * (`backend/internal/lex/middleware/distinct_actor.go` /
 * `service/workflow_service.go` requireDistinctDecisionAuthor).
 */
export function isSodConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { status?: number; code?: string; message?: string };
  if (err.status !== 403) {
    return false;
  }
  if (err.code === 'SOD_CONFLICT') {
    return true;
  }
  const message = (err.message ?? '').toLowerCase();
  return (
    message.includes('separation of duties') || message.includes('separation-of-duties')
  );
}

/* ------------------------------------------------------------------------- *
 * Dialog.
 * ------------------------------------------------------------------------- */

interface ReviewDraft {
  approverUserId: string;
  approverRole: string;
  slaHours: string;
  description: string;
}

const DEFAULT_DRAFT: ReviewDraft = {
  approverUserId: '',
  approverRole: '',
  slaHours: '48',
  description: '',
};

interface FailureEntry {
  contract: LexContract;
  message: string;
}

interface RunResults {
  succeeded: LexContract[];
  sodBlocked: FailureEntry[];
  failed: FailureEntry[];
}

type Phase = 'form' | 'running' | 'summary';

export interface SendForReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current list rows — used to resolve the selected ids to records. */
  contracts: LexContract[];
  /** Snapshot of the ids the action was invoked with (row = single id). */
  selectedIds: string[];
  /** Called after a run with at least one success (refetch + clear selection). */
  onDone: () => void;
}

export function SendForReviewDialog({
  open,
  onOpenChange,
  contracts,
  selectedIds,
  onDone,
}: SendForReviewDialogProps) {
  const { hasAnyPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const labels = useMemo(() => resolveLexBilingual(sendForReviewLabels, locale), [locale]);

  const [draft, setDraft] = useState<ReviewDraft>(DEFAULT_DRAFT);
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null }>({
    done: 0,
    total: 0,
    current: null,
  });
  const [results, setResults] = useState<RunResults | null>(null);

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-send-for-review'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });
  const users = usersQuery.data?.data ?? [];

  // The selected contracts in list order, partitioned by eligibility: a
  // contract that already carries a workflow instance would 409 server-side.
  const { eligible, alreadyInReview } = useMemo(() => {
    const idSet = new Set(selectedIds);
    const selected = contracts.filter((contract) => idSet.has(contract.id));
    const eligibleList: LexContract[] = [];
    const busyList: LexContract[] = [];
    for (const contract of selected) {
      if (contract.workflow_instance_id) {
        busyList.push(contract);
      } else {
        eligibleList.push(contract);
      }
    }
    return { eligible: eligibleList, alreadyInReview: busyList };
  }, [contracts, selectedIds]);

  // Same write gate as the list page (§9/§18.4): contract add OR edit verb.
  // The page only registers the actions when canWrite holds; this is the
  // defense-in-depth layer so the dialog can never render a forbidden mutation.
  const canWrite = hasAnyPermission(['lex:contract:add', 'lex:contract:edit']);
  if (!canWrite) {
    return null;
  }

  const running = phase === 'running';
  const isValid =
    draft.description.trim().length >= 5 &&
    Boolean(draft.approverRole.trim() || draft.approverUserId) &&
    Number(draft.slaHours) >= 1;

  const reset = () => {
    setDraft(DEFAULT_DRAFT);
    setPhase('form');
    setProgress({ done: 0, total: 0, current: null });
    setResults(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (running) {
      return; // never abandon a half-applied batch silently
    }
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const buildPayload = (): LexReviewContractRequest => ({
    approver_user_id: draft.approverUserId || undefined,
    approver_role: draft.approverRole.trim() || undefined,
    description: draft.description.trim(),
    sla_hours: Math.max(1, Number(draft.slaHours) || Number(DEFAULT_DRAFT.slaHours)),
  });

  const handleSend = async () => {
    if (!isValid || eligible.length === 0 || running) {
      return;
    }
    // Snapshot the batch: `eligible` recomputes once onDone() refetches the
    // list (workflow_instance_id becomes set), but the summary must keep
    // reporting the run as it happened.
    const batch = eligible;
    const payload = buildPayload();
    setPhase('running');
    setProgress({ done: 0, total: batch.length, current: batch[0]?.title ?? null });

    const run: RunResults = { succeeded: [], sodBlocked: [], failed: [] };
    // Sequential on purpose: live progress, and no thundering herd against the
    // workflow engine (each start opens a transaction + task fan-out).
    for (let index = 0; index < batch.length; index += 1) {
      const contract = batch[index];
      setProgress({ done: index, total: batch.length, current: contract.title });
      try {
        await enterpriseApi.lex.startContractReview(contract.id, payload);
        run.succeeded.push(contract);
      } catch (error) {
        const entry: FailureEntry = { contract, message: parseApiError(error) };
        if (isSodConflictError(error)) {
          run.sodBlocked.push(entry);
        } else {
          run.failed.push(entry);
        }
      }
    }
    setProgress({ done: batch.length, total: batch.length, current: null });
    setResults(run);

    const failures = run.sodBlocked.length + run.failed.length;
    if (run.succeeded.length > 0) {
      onDone();
    }
    if (failures === 0) {
      showSuccess(labels.successAll(run.succeeded.length));
      reset();
      onOpenChange(false);
      return;
    }
    if (run.succeeded.length > 0) {
      showSuccess(labels.successPartial(run.succeeded.length, failures));
    } else if (run.failed.length > 0) {
      // Only genuine faults earn an error toast — an all-SoD outcome is the
      // control working as designed and is explained inline instead.
      showError(labels.allFailed);
    }
    setPhase('summary');
  };

  const showEligibilitySummary = alreadyInReview.length > 0 || eligible.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir={direction} lang={locale} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description(selectedIds.length)}</DialogDescription>
        </DialogHeader>

        {phase === 'form' ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="send-review-user">{labels.approver}</Label>
              <Select
                value={draft.approverUserId || 'none'}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    approverUserId: value === 'none' ? '' : value,
                  }))
                }
              >
                <SelectTrigger id="send-review-user">
                  <SelectValue
                    placeholder={usersQuery.isLoading ? labels.loadingUsers : labels.selectApprover}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{labels.assignByRole}</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {userDisplayName(user)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="send-review-role">{labels.approverRole}</Label>
                <Input
                  id="send-review-role"
                  value={draft.approverRole}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, approverRole: event.target.value }))
                  }
                  placeholder={labels.approverRolePlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send-review-sla">{labels.slaHours}</Label>
                <Input
                  id="send-review-sla"
                  type="number"
                  min={1}
                  value={draft.slaHours}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, slaHours: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="send-review-description">{labels.taskDescription}</Label>
              <Textarea
                id="send-review-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder={labels.taskDescriptionPlaceholder}
                rows={3}
              />
            </div>

            <p className="text-xs text-muted-foreground">{labels.validationHint}</p>

            {showEligibilitySummary ? (
              <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">
                    {labels.eligible(eligible.length)}
                  </span>
                  {alreadyInReview.length > 0 ? (
                    <span className="text-muted-foreground">
                      {labels.alreadyInReview(alreadyInReview.length)}
                    </span>
                  ) : null}
                </div>
                {alreadyInReview.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {labels.alreadyInReviewListLabel}
                    </p>
                    <ul className="space-y-0.5 ps-4 text-xs text-muted-foreground">
                      {alreadyInReview.map((contract) => (
                        <li key={contract.id} className="list-disc">
                          <span className="truncate">{contract.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {eligible.length === 0 ? (
                  <p className="text-xs text-warning-700 dark:text-warning-300">
                    {labels.noEligible}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === 'running' ? (
          <div className="space-y-3">
            <Progress
              value={progress.done}
              max={Math.max(1, progress.total)}
              aria-label={labels.sending}
              className="h-2"
            />
            <p className="text-sm text-muted-foreground">
              {labels.progressOf(f.formatNumber(progress.done), f.formatNumber(progress.total))}
              {progress.current ? (
                <span className="ms-2 font-medium text-foreground">{progress.current}</span>
              ) : null}
            </p>
          </div>
        ) : null}

        {phase === 'summary' && results ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">{labels.summaryTitle}</p>

            {results.succeeded.length > 0 ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden />
                <span>{labels.succeeded(results.succeeded.length)}</span>
              </div>
            ) : null}

            {results.sodBlocked.length > 0 ? (
              // Friendly inline SoD explanation — deliberately informational
              // (muted/info tones), never an error surface: the guard firing
              // means governance is working, not that something broke.
              <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{labels.sodTitle}</span>
                </div>
                <p className="text-xs text-muted-foreground">{labels.sodExplanation}</p>
                <ul className="space-y-0.5 ps-4 text-xs text-muted-foreground">
                  {results.sodBlocked.map(({ contract }) => (
                    <li key={contract.id} className="list-disc">
                      <span className="truncate">{contract.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {results.failed.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <XCircle className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{labels.failedTitle}</span>
                </div>
                <ul className="space-y-0.5 ps-4 text-xs text-muted-foreground">
                  {results.failed.map(({ contract, message }) => (
                    <li key={contract.id} className="list-disc">
                      <span className="truncate">{contract.title}</span>
                      <span className="ms-1 opacity-70">({message})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {phase === 'summary' ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              {labels.close}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={running}
              >
                {labels.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSend()}
                disabled={!isValid || eligible.length === 0 || running}
              >
                {running ? (
                  <RefreshCw className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {running ? labels.sending : labels.send}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
