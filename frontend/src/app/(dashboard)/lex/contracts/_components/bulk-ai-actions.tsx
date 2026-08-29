/**
 * Partial-failure summary dialog for the contracts-list bulk AI actions
 * (`/lex/contracts`). The companion hook (`_lib/use-bulk-ai.ts`) runs the four
 * selection-scoped operations — Run compliance / Analyze / Extract obligations /
 * Auto-categorize — reports live `n/total` progress through a single updating
 * toast, and collects any per-contract failures into a `BulkAiSummary`. When at
 * least one item fails, the page opens this dialog to show WHICH contracts
 * failed and WHY (id + title + human-readable reason), so the user can fix and
 * retry just the failed subset.
 *
 * Read-only surface: the dialog itself performs no mutations, so it needs no
 * RBAC gate of its own — the hook already returns zero actions (and refuses to
 * run) unless the page's `canWrite` gate is satisfied.
 *
 * Labels reuse the hook's canonical `LexBilingual<BulkAiLabels>` bundle via
 * `useBulkAiLabels()`; counts render through `useLexFormat().formatNumber`
 * (Arabic-Indic digits under the ar locale). Layout is RTL-safe (logical
 * `ps-`/`ms-` spacing only).
 */

'use client';

import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, ListChecks, ShieldCheck, Sparkles, Tags, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLexFormat } from '@/lib/lex/ksa';

import {
  type BulkAiKind,
  type BulkAiSummary,
  bulkAiKindLabel,
  useBulkAiLabels,
} from '../_lib/use-bulk-ai';

/** Same iconography as the table bulk actions, keyed by operation. */
const KIND_ICONS: Record<BulkAiKind, LucideIcon> = {
  compliance: ShieldCheck,
  analyze: Sparkles,
  extract_obligations: ListChecks,
  auto_categorize: Tags,
};

export interface BulkAiActionsDialogProps {
  /** Outcome of the last bulk run; the dialog renders nothing while null. */
  summary: BulkAiSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkAiActionsDialog({
  summary,
  open,
  onOpenChange,
}: BulkAiActionsDialogProps) {
  const labels = useBulkAiLabels();
  const { formatNumber } = useLexFormat();

  if (!summary) {
    return null;
  }

  const KindIcon = KIND_ICONS[summary.kind];
  const actionLabel = bulkAiKindLabel(labels, summary.kind);
  const failedCount = summary.failures.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{labels.dialog.title(actionLabel)}</span>
          </DialogTitle>
          <DialogDescription>
            {labels.dialog.description(
              formatNumber(summary.succeeded),
              formatNumber(failedCount),
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Succeeded / failed split at a glance. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 text-success-700 dark:text-success-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              {formatNumber(summary.succeeded)}
              <span className="text-muted-foreground">/ {formatNumber(summary.total)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <XCircle className="h-4 w-4 shrink-0" aria-hidden />
              {formatNumber(failedCount)}
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {labels.dialog.failedListLabel}
            </p>
            <ul className="max-h-64 space-y-2 overflow-y-auto rounded-lg border bg-muted/40 px-3 py-2.5">
              {summary.failures.map((failure) => (
                <li key={failure.id} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-foreground">
                      {failure.title || labels.dialog.unknownContract}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {failure.id.slice(0, 8)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">{labels.dialog.reasonLabel}:</span>{' '}
                    {failure.reason}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.dialog.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
