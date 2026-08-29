/**
 * FEATURE 2 — Bulk alert triage action bar (Watheeq / lex compliance).
 *
 * A floating, sticky action bar that surfaces only when one or more compliance
 * alerts are selected in the alerts DataTable. It offers bulk
 * Acknowledge / Resolve / Dismiss, fans the chosen transition out across the
 * selected alert ids via `enterpriseApi.lex.updateComplianceAlertStatus`
 * (`Promise.allSettled`, so one failure never aborts the rest), shows a
 * disabled/progress state while running, toasts a succeeded/failed summary,
 * invalidates the shared compliance query keys, clears the selection, and calls
 * `onDone`.
 *
 * Self-contained: it owns its bilingual (EN + MSA) labels following the exact
 * `LexBilingual<T>` + `use<Feature>Labels()` contract from
 * `../_lib/compliance-labels.ts` and `../../_lib/lex-i18n.ts`. RTL-correct
 * (logical `ms-/me-/start-/end-` props only) and consumes only the existing
 * design-system primitives.
 *
 * This file ALSO exports `selectionColumn<TData>()`, a bilingual,
 * locale-aware checkbox selection `ColumnDef` the integrator can drop into
 * `alertColumns` so the DataTable renders a select column whose
 * `onSelectionChange` feeds `selectedIds` into <AlertBulkActionBar>.
 */

'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Loader2, ShieldCheck, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { shapeDigits } from '@/lib/lex/ksa';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AppLocale } from '@/lib/i18n';
import type { LexComplianceAlertStatus } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Bilingual labels (own them internally per the lex bilingual contract).
// ---------------------------------------------------------------------------

export interface BulkActionBarLabels {
  /** "{count} selected" pill. */
  selected: (count: number) => string;
  clear: string;
  actions: {
    acknowledge: string;
    resolve: string;
    dismiss: string;
  };
  /** Accessible labels for the table's checkbox selection column. */
  selection: {
    selectAll: string;
    selectRow: string;
  };
  toasts: {
    /** All transitions succeeded. */
    allSucceededTitle: string;
    allSucceededDescription: (count: number) => string;
    /** Mixed result — some failed. */
    partialTitle: string;
    partialDescription: (succeeded: number, failed: number) => string;
    /** Every transition failed. */
    allFailedTitle: string;
    allFailedDescription: (count: number) => string;
  };
}

export const bulkActionBarLabels: LexBilingual<BulkActionBarLabels> = {
  en: {
    selected: (count) => `${count} selected`,
    clear: 'Clear selection',
    actions: {
      acknowledge: 'Acknowledge',
      resolve: 'Resolve',
      dismiss: 'Dismiss',
    },
    selection: {
      selectAll: 'Select all alerts',
      selectRow: 'Select alert',
    },
    toasts: {
      allSucceededTitle: 'Alerts updated.',
      allSucceededDescription: (count) =>
        `${count} compliance alert${count === 1 ? '' : 's'} updated.`,
      partialTitle: 'Bulk update completed with errors',
      partialDescription: (succeeded, failed) =>
        `${succeeded} updated, ${failed} failed.`,
      allFailedTitle: 'Bulk update failed',
      allFailedDescription: (count) =>
        `None of the ${count} selected alert${count === 1 ? '' : 's'} could be updated.`,
    },
  },
  ar: {
    selected: (count) => `${count} محدد`,
    clear: 'إلغاء التحديد',
    actions: {
      acknowledge: 'الإقرار',
      resolve: 'حلّ',
      dismiss: 'رفض',
    },
    selection: {
      selectAll: 'تحديد جميع التنبيهات',
      selectRow: 'تحديد التنبيه',
    },
    toasts: {
      allSucceededTitle: 'تم تحديث التنبيهات.',
      allSucceededDescription: (count) => `تم تحديث ${count} من تنبيهات الامتثال.`,
      partialTitle: 'اكتمل التحديث الجماعي مع أخطاء',
      partialDescription: (succeeded, failed) => `تم تحديث ${succeeded}، وفشل ${failed}.`,
      allFailedTitle: 'فشل التحديث الجماعي',
      allFailedDescription: (count) =>
        `تعذّر تحديث أي من التنبيهات المحددة البالغ عددها ${count}.`,
    },
  },
};

export function useBulkActionBarLabels(): BulkActionBarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(bulkActionBarLabels, locale), [locale]);
}

/** Pure resolver for non-React callers / tests. Defaults to English. */
export function resolveBulkActionBarLabels(locale: AppLocale = 'en'): BulkActionBarLabels {
  return resolveLexBilingual(bulkActionBarLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Selection column helper (bilingual aria-labels, locale-aware).
//
// The shared `selectColumn<TData>()` in
// `@/components/shared/data-table/columns/common-columns` works, but its
// aria-labels are hardcoded English. This variant resolves them against the
// active locale so the RTL/Arabic surface stays consistent. Drop it into
// `alertColumns` (typically as the FIRST column) and pass `enableSelection`
// + `onSelectionChange` to <DataTable>.
// ---------------------------------------------------------------------------

export function selectionColumn<TData>(
  labels?: BulkActionBarLabels['selection'],
): ColumnDef<TData> {
  const selectAll = labels?.selectAll ?? 'Select all';
  const selectRow = labels?.selectRow ?? 'Select row';
  return {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label={selectAll}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={selectRow}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  };
}

// ---------------------------------------------------------------------------
// Bulk action bar.
// ---------------------------------------------------------------------------

/** Triage transitions the bar can apply. Constrained to the alert status enum. */
type BulkTriageStatus = Extract<
  LexComplianceAlertStatus,
  'acknowledged' | 'resolved' | 'dismissed'
>;

export interface AlertBulkActionBarProps {
  /** Selected alert ids (DataTable row ids). The bar hides when empty. */
  selectedIds: string[];
  /** Clear the table's row selection. Called after a run and on the X button. */
  onClear: () => void;
  /** Optional post-run hook (e.g. close a panel, refocus the table). */
  onDone?: () => void;
}

export function AlertBulkActionBar({ selectedIds, onClear, onDone }: AlertBulkActionBarProps) {
  const { direction, locale } = useLocaleOrDefault();
  const labels = useBulkActionBarLabels();
  const queryClient = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<BulkTriageStatus | null>(null);

  const count = selectedIds.length;
  const isPending = pendingStatus !== null;

  if (count === 0) {
    return null;
  }

  const applyBulk = async (status: BulkTriageStatus) => {
    if (isPending || selectedIds.length === 0) {
      return;
    }
    setPendingStatus(status);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) =>
          enterpriseApi.lex.updateComplianceAlertStatus(id, {
            status,
            resolution_notes: '',
          }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;

      if (failed === 0) {
        showSuccess(
          labels.toasts.allSucceededTitle,
          labels.toasts.allSucceededDescription(succeeded),
        );
      } else if (succeeded === 0) {
        const firstError = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        )?.reason;
        showApiError(
          firstError ?? new Error(labels.toasts.allFailedDescription(failed)),
        );
      } else {
        showSuccess(
          labels.toasts.partialTitle,
          labels.toasts.partialDescription(succeeded, failed),
        );
      }

      // Refresh anything that reads alerts/score regardless of partial failure,
      // since some rows may have transitioned. Mirrors the page's invalidation set.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
      ]);

      onClear();
      onDone?.();
    } finally {
      setPendingStatus(null);
    }
  };

  return (
    <div
      dir={direction}
      role="region"
      aria-label={labels.selected(count)}
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      <div className="surface-card pointer-events-auto flex flex-wrap items-center gap-3 rounded-full px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={onClear}
            disabled={isPending}
            aria-label={labels.clear}
          >
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{shapeDigits(labels.selected(count), locale)}</span>
        </div>

        <span className="h-5 w-px bg-[color:var(--card-border)]" aria-hidden />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void applyBulk('acknowledged')}
            disabled={isPending}
          >
            {pendingStatus === 'acknowledged' ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
            )}
            {labels.actions.acknowledge}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void applyBulk('resolved')}
            disabled={isPending}
          >
            {pendingStatus === 'resolved' ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
            )}
            {labels.actions.resolve}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void applyBulk('dismissed')}
            disabled={isPending}
          >
            {pendingStatus === 'dismissed' ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="me-1.5 h-3.5 w-3.5" />
            )}
            {labels.actions.dismiss}
          </Button>
        </div>
      </div>
    </div>
  );
}
