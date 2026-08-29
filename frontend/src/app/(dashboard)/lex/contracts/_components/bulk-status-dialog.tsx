/**
 * Transition-aware bulk (and single-row) status dialog for the ClarioLegal /
 * Watheeq contracts list. Picking a target status partitions the selected
 * contracts into a "will change" set and a "skipped" set (illegal transitions
 * per `isAllowedContractTransition`), applies the change only to the valid ids
 * via `enterpriseApi.lex.updateContractStatus`, and reports the success/failure
 * split through the shared toast helpers.
 *
 * This same dialog backs both the table bulk action and the per-row
 * "Change status" action — a single selected id behaves identically to a batch.
 *
 * Labels follow the canonical lex bilingual contract: a local
 * `LexBilingual<T> = { en, ar }` bundle resolved by `useLocale().locale` (mirrors
 * `resolveTokenRecord` on the list page). Status display strings reuse the shared
 * `lexContractStatusLabels` record so this dialog never re-spells lifecycle copy.
 */

'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale } from '@/components/providers/locale-provider';
import type { SelectionScope } from '@/components/shared/data-table/selection-scope';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import type { LexContract, LexContractStatus } from '@/types/suites';

import { lexContractStatusLabels } from '../../_lib/lex-i18n';
import { isAllowedContractTransition } from '../_lib/contracts-board';
import { BulkScopeError, useBulkScope } from '../_lib/use-bulk-scope';

/* ------------------------------------------------------------------------- *
 * Local bilingual label bundle (mirrors the lex `LexBilingual<T>` shape).
 * ------------------------------------------------------------------------- */

/** Local mirror of the lex `LexBilingual<T> = { en, ar }` bundle shape. */
interface BulkStatusBundle<T> {
  readonly en: T;
  readonly ar: T;
}

interface BulkStatusLabels {
  title: string;
  description: (count: number) => string;
  allMatchingNote: string;
  targetStatus: string;
  selectStatus: string;
  willChange: (count: number) => string;
  skipped: (count: number) => string;
  skippedReason: string;
  skippedListLabel: string;
  noValid: string;
  pickStatus: string;
  cancel: string;
  apply: string;
  applying: string;
  successAll: (count: number) => string;
  successPartial: (succeeded: number, failed: number) => string;
  allFailed: string;
  successDescription: (status: string) => string;
}

const bulkStatusLabels: BulkStatusBundle<BulkStatusLabels> = {
  en: {
    title: 'Change contract status',
    description: (count) =>
      `Apply a target status to ${count} selected contract${count === 1 ? '' : 's'}. Only legal lifecycle transitions are applied.`,
    allMatchingNote:
      'Applies to every contract matching the current filters (minus any you unchecked). Illegal transitions are skipped by the server and reported per contract.',
    targetStatus: 'Target status',
    selectStatus: 'Select status',
    willChange: (count) => `${count} will change`,
    skipped: (count) => `${count} skipped`,
    skippedReason: 'illegal transition',
    skippedListLabel: 'Skipped contracts',
    noValid: 'No selected contract can move to this status. Pick a different target.',
    pickStatus: 'Pick a target status to preview the transition.',
    cancel: 'Cancel',
    apply: 'Apply status',
    applying: 'Applying…',
    successAll: (count) => `${count} contract${count === 1 ? '' : 's'} updated.`,
    successPartial: (succeeded, failed) =>
      `${succeeded} updated, ${failed} failed.`,
    allFailed: 'No contracts could be updated.',
    successDescription: (status) => `Moved to ${status}.`,
  },
  ar: {
    title: 'تغيير حالة العقد',
    description: (count) =>
      `تطبيق حالة مستهدفة على ${count} عقد محدد. تُطبَّق انتقالات دورة الحياة المسموح بها فقط.`,
    allMatchingNote:
      'يُطبَّق على كل عقد يطابق المرشّحات الحالية (باستثناء ما ألغيت تحديده). يتخطى الخادم الانتقالات غير المسموح بها ويُبلغ عنها لكل عقد.',
    targetStatus: 'الحالة المستهدفة',
    selectStatus: 'اختر الحالة',
    willChange: (count) => `${count} سيتغيّر`,
    skipped: (count) => `${count} تم تخطّيه`,
    skippedReason: 'انتقال غير مسموح',
    skippedListLabel: 'العقود المتخطّاة',
    noValid: 'لا يمكن نقل أي عقد محدد إلى هذه الحالة. اختر حالة أخرى.',
    pickStatus: 'اختر حالة مستهدفة لمعاينة الانتقال.',
    cancel: 'إلغاء',
    apply: 'تطبيق الحالة',
    applying: 'جارٍ التطبيق…',
    successAll: (count) => `تم تحديث ${count} عقد.`,
    successPartial: (succeeded, failed) => `تم تحديث ${succeeded}، وفشل ${failed}.`,
    allFailed: 'تعذّر تحديث أي عقد.',
    successDescription: (status) => `تم النقل إلى ${status}.`,
  },
};

/** Lifecycle status order for the target selector (mirrors the board column order). */
const CONTRACT_STATUS_VALUES: LexContractStatus[] = [
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
  'suspended',
  'expired',
  'renewed',
  'terminated',
  'cancelled',
];

function resolveBundle<R>(bundle: { en: R; ar: R }, locale: string): R {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

export interface BulkStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contracts: LexContract[];
  selectedIds: string[];
  /**
   * Optional selection scope from the table's select-all-matching affordance.
   * When `{ mode: 'all-matching' }`, the client-side transition partition is
   * skipped (the server FSM + per-item SoD produce the `failed[]` entries) and
   * the whole filtered set is addressed through ONE bulk-status call.
   */
  scope?: SelectionScope;
  onApplied: () => void;
}

export function BulkStatusDialog({
  open,
  onOpenChange,
  contracts,
  selectedIds,
  scope,
  onApplied,
}: BulkStatusDialogProps) {
  const { locale } = useLocale();
  const labels = useMemo(() => resolveBundle(bulkStatusLabels, locale), [locale]);
  const statusLabels = useMemo(
    () => resolveBundle(lexContractStatusLabels, locale),
    [locale],
  );
  const { resolveBulkPayload } = useBulkScope();
  const isAllMatching = scope?.mode === 'all-matching';

  const [target, setTarget] = useState<LexContractStatus | ''>('');
  const [submitting, setSubmitting] = useState(false);

  // The selected contracts in the order they appear in the table.
  const selected = useMemo(() => {
    const idSet = new Set(selectedIds);
    return contracts.filter((contract) => idSet.has(contract.id));
  }, [contracts, selectedIds]);

  // Partition the selection by transition legality for the chosen target.
  const { valid, skipped } = useMemo(() => {
    if (!target) {
      return { valid: [] as LexContract[], skipped: [] as LexContract[] };
    }
    const validList: LexContract[] = [];
    const skippedList: LexContract[] = [];
    for (const contract of selected) {
      if (isAllowedContractTransition(contract.status, target)) {
        validList.push(contract);
      } else {
        skippedList.push(contract);
      }
    }
    return { valid: validList, skipped: skippedList };
  }, [selected, target]);

  const handleOpenChange = (next: boolean) => {
    if (submitting) {
      return;
    }
    if (!next) {
      setTarget('');
    }
    onOpenChange(next);
  };

  const handleApply = async () => {
    if (!target || submitting) {
      return;
    }
    if (!isAllMatching && valid.length === 0) {
      return;
    }
    setSubmitting(true);
    try {
      // ONE scope-aware call to POST /contracts/bulk-status. Page mode keeps
      // the client-side transition partition (only `valid` ids are sent);
      // all-matching mode addresses the whole filtered set and lets the
      // server FSM produce the per-contract failed[] entries.
      const payload = await resolveBulkPayload(
        isAllMatching && scope
          ? scope
          : { mode: 'page', ids: valid.map((contract) => contract.id) },
      );
      const result = await enterpriseApi.lex.bulkUpdateContractStatus({
        ...payload,
        status: target,
      });
      const statusLabel = statusLabels[target] ?? target;

      if (result.failed.length === 0) {
        showSuccess(
          labels.successAll(result.succeeded.length),
          labels.successDescription(statusLabel),
        );
      } else if (result.succeeded.length === 0) {
        showError(labels.allFailed);
      } else {
        showSuccess(
          labels.successPartial(result.succeeded.length, result.failed.length),
          labels.successDescription(statusLabel),
        );
      }

      onApplied();
      setTarget('');
      onOpenChange(false);
    } catch (error) {
      if (error instanceof BulkScopeError) {
        showError(error.message);
      } else {
        showApiError(error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCount = selected.length;
  const showSummary = Boolean(target);
  const noValid = showSummary && !isAllMatching && valid.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description(selectedCount)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{labels.targetStatus}</Label>
            <Select
              value={target || undefined}
              onValueChange={(value) => setTarget(value as LexContractStatus)}
              disabled={submitting}
            >
              <SelectTrigger>
                <SelectValue placeholder={labels.selectStatus} />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_STATUS_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabels[status] ?? status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isAllMatching ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              {labels.allMatchingNote}
            </p>
          ) : showSummary ? (
            <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">
                  {labels.willChange(valid.length)}
                </span>
                {skipped.length > 0 ? (
                  <span className="text-muted-foreground">
                    {labels.skipped(skipped.length)} ({labels.skippedReason})
                  </span>
                ) : null}
              </div>
              {skipped.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {labels.skippedListLabel}
                  </p>
                  <ul className="space-y-0.5 ps-4 text-xs text-muted-foreground">
                    {skipped.map((contract) => (
                      <li key={contract.id} className="list-disc">
                        <span className="truncate">{contract.title}</span>
                        <span className="ms-1 opacity-70">
                          ({statusLabels[contract.status] ?? contract.status})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {noValid ? (
                <p className="text-xs text-warning-700 dark:text-warning-300">{labels.noValid}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{labels.pickStatus}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {labels.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!target || (!isAllMatching && valid.length === 0) || submitting}
          >
            {submitting ? <RefreshCw className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {submitting ? labels.applying : labels.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
