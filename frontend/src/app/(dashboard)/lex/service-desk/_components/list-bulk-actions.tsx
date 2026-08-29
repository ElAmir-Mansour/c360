'use client';

/**
 * Bulk-action toolkit for the Legal Service Desk list page (feature #4).
 *
 * Exposes a hook `useListBulkActions` that returns:
 *   - `bulkActions`: a `BulkAction[]` for the DataTable toolbar
 *       • Reclassify priority — opens a dialog (priority + reason) and fans out
 *         `lexRequestsApi.reclassifyPriority(id, …)` over the selected ids.
 *       • Submit — only valid for `draft` rows; fans out `submitRequest(id, {})`.
 *       • Export CSV — client-side export of the loaded rows for the selection.
 *   - `dialog`: the reclassify dialog node to render once on the page.
 *
 * All fan-outs use `Promise.allSettled`, then a single summary toast
 * ("X updated, Y failed") and invalidation of both the list query
 * (`lex-legal-requests`) and the analytics query
 * (`lex-legal-affairs-dashboard`).
 *
 * Write actions are only included when the caller has `lex:write` (the page
 * passes `canWrite`). Export CSV is always available.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { showError, showSuccess } from '@/lib/toast';
import { lexRequestsApi, type LegalRequest, type RequestPriority } from '@/lib/lex/requests';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type { BulkAction } from '@/types/table';
import { REQUEST_PRIORITY_OPTIONS } from './labels';
import { useListExtraLabels } from './list-extra-labels';

interface UseListBulkActionsOptions {
  /** The currently loaded rows (for export + draft detection by id). */
  rows: LegalRequest[];
  /** Whether the current user may perform write actions (`lex:write`). */
  canWrite: boolean;
  /** Active locale, used to localize exported titles. */
  locale: AppLocale;
  /** Priority enum → label map (from `useServiceDeskLabels().priorityOptions`). */
  priorityLabels: Record<string, string>;
  /** Status enum → label map (from `useServiceDeskLabels().statusOptions`). */
  statusLabels: Record<string, string>;
}

interface UseListBulkActionsResult {
  bulkActions: BulkAction[];
  dialog: React.ReactNode;
}

/** Quote a CSV cell, escaping embedded quotes and wrapping when needed. */
function csvCell(value: string): string {
  const v = value ?? '';
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function triggerDownload(filename: string, contents: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([`﻿${contents}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useListBulkActions({
  rows,
  canWrite,
  locale,
  priorityLabels,
  statusLabels,
}: UseListBulkActionsOptions): UseListBulkActionsResult {
  const labels = useListExtraLabels();
  const t = labels.bulk;
  const qc = useQueryClient();

  // Reclassify dialog state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<RequestPriority>('normal');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['lex-legal-requests'] }),
      qc.invalidateQueries({ queryKey: ['lex-legal-affairs-dashboard'] }),
    ]);
  }, [qc]);

  const summarize = useCallback(
    (results: PromiseSettledResult<unknown>[]) => {
      const updated = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - updated;
      showSuccess(t.summaryTitle, t.summary(updated, failed));
    },
    [t],
  );

  // --- Reclassify (opens dialog; the real fan-out happens on Apply) ---
  const openReclassify = useCallback((selectedIds: string[]) => {
    setPendingIds(selectedIds);
    setPriority('normal');
    setReason('');
    setReasonError(null);
    setDialogOpen(true);
  }, []);

  const applyReclassify = useCallback(async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(t.errorReasonRequired);
      return;
    }
    setApplying(true);
    try {
      const results = await Promise.allSettled(
        pendingIds.map((id) =>
          lexRequestsApi.reclassifyPriority(id, { priority, reason: trimmed }),
        ),
      );
      summarize(results);
      await invalidate();
      setDialogOpen(false);
    } finally {
      setApplying(false);
    }
  }, [reason, pendingIds, priority, summarize, invalidate, t]);

  // --- Submit (only drafts) ---
  const submitSelected = useCallback(
    async (selectedIds: string[]) => {
      const selected = new Set(selectedIds);
      const draftIds = rows
        .filter((row) => selected.has(row.id) && row.status === 'draft')
        .map((row) => row.id);
      const skipped = selectedIds.length - draftIds.length;

      if (draftIds.length === 0) {
        showError(t.noDraftsTitle, t.noDraftsDescription);
        return;
      }

      const results = await Promise.allSettled(
        draftIds.map((id) => lexRequestsApi.submitRequest(id, {})),
      );
      const updated = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - updated;
      const detail =
        skipped > 0 ? `${t.summary(updated, failed)} ${t.submitSkipped(skipped)}` : t.summary(updated, failed);
      showSuccess(t.summaryTitle, detail);
      await invalidate();
    },
    [rows, invalidate, t],
  );

  // --- Export CSV (client-side, from loaded rows) ---
  const exportSelected = useCallback(
    async (selectedIds: string[]) => {
      const selected = new Set(selectedIds);
      const picked = rows.filter((row) => selected.has(row.id));
      if (picked.length === 0) {
        showError(t.exportEmpty);
        return;
      }
      const header = [
        'request_number',
        'title',
        'request_type',
        'department',
        'priority',
        'status',
        'requester_name',
        'updated_at',
      ];
      const lines = picked.map((row) =>
        [
          row.request_number ?? '',
          resolveLocalized(row.title, locale) ?? '',
          row.request_type ?? '',
          row.department ?? '',
          priorityLabels[row.priority] ?? row.priority,
          statusLabels[row.status] ?? row.status,
          row.requester_name ?? '',
          row.updated_at ?? '',
        ]
          .map((cell) => csvCell(String(cell)))
          .join(','),
      );
      const csv = [header.join(','), ...lines].join('\r\n');
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(`legal-requests-${stamp}.csv`, csv);
    },
    [rows, locale, priorityLabels, statusLabels, t],
  );

  const bulkActions = useMemo<BulkAction[]>(() => {
    const actions: BulkAction[] = [];
    if (canWrite) {
      actions.push({
        label: t.reclassify,
        icon: AlertTriangle,
        onClick: async (ids) => openReclassify(ids),
      });
      actions.push({
        label: t.submit,
        icon: Send,
        onClick: submitSelected,
      });
    }
    actions.push({
      label: t.exportCsv,
      icon: Download,
      onClick: exportSelected,
    });
    return actions;
  }, [canWrite, t, openReclassify, submitSelected, exportSelected]);

  const dialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.reclassifyTitle}</DialogTitle>
          <DialogDescription>{t.reclassifyDescription(pendingIds.length)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-reclassify-priority">{t.priority}</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as RequestPriority)}>
              <SelectTrigger id="bulk-reclassify-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUEST_PRIORITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {priorityLabels[option] ?? option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-reclassify-reason">{t.reason}</Label>
            <Textarea
              id="bulk-reclassify-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              placeholder={t.reasonPlaceholder}
              rows={2}
            />
            {reasonError ? <p className="text-sm text-destructive">{reasonError}</p> : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={() => void applyReclassify()} disabled={applying}>
            {applying ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {applying ? t.applying : t.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { bulkActions, dialog };
}
