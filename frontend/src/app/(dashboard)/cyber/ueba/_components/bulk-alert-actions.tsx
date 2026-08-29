'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUndoToast } from '@/lib/undo-toast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useUebaLabels, type UebaLabels } from '../_lib/ueba-i18n';
import type { UebaAlertStatus } from './types';

interface BulkAlertActionsProps {
  selectedIds: string[];
  onComplete: () => void;
}

interface BulkResponse {
  updated: number;
  failed: number;
  errors?: string[];
}

function bulkStatuses(t: UebaLabels): { value: UebaAlertStatus; label: string }[] {
  return [
    { value: 'acknowledged', label: t.bulkAcknowledge },
    { value: 'investigating', label: t.bulkInvestigate },
    { value: 'resolved', label: t.bulkResolve },
  ];
}

export function BulkAlertActions({ selectedIds, onComplete }: BulkAlertActionsProps) {
  const t = useUebaLabels();
  const queryClient = useQueryClient();
  const undoToast = useUndoToast();
  const [loading, setLoading] = useState(false);
  const [fpDialogOpen, setFpDialogOpen] = useState(false);
  const [fpNotes, setFpNotes] = useState('');

  async function invalidateAll() {
    await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-alerts'] });
    await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-entity-alerts'] });
    await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-dashboard'] });
    await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-profile'] });
  }

  async function bulkUpdate(ids: string[], status: UebaAlertStatus) {
    setLoading(true);
    try {
      const res = await apiPut<BulkResponse>(API_ENDPOINTS.CYBER_UEBA_ALERTS_BULK_STATUS, {
        alert_ids: ids,
        status,
      });
      if (res.failed > 0) {
        toast.warning(t.bulkPartialToast(res.updated, res.failed));
      } else {
        toast.success(t.bulkUpdatedToast(res.updated));
      }
      await invalidateAll();
      onComplete();
    } catch {
      toast.error(t.bulkUpdateFailed);
    } finally {
      setLoading(false);
    }
  }

  // Exemplar wiring for undoToast: bulk status updates are deferred behind a
  // 6s undo window. Ids are snapshotted at schedule time so later selection
  // changes don't alter the queued action; the selection is only cleared
  // (onComplete) once the update actually runs.
  function scheduleBulkUpdate(status: UebaAlertStatus, label: string) {
    const ids = [...selectedIds];
    undoToast({
      message: t.bulkScheduled(ids.length, label),
      description: t.bulkUndoHint,
      action: () => bulkUpdate(ids, status),
    });
  }

  async function bulkFalsePositive() {
    setLoading(true);
    try {
      const res = await apiPut<BulkResponse>(API_ENDPOINTS.CYBER_UEBA_ALERTS_BULK_STATUS, {
        alert_ids: selectedIds,
        false_positive: true,
        notes: fpNotes,
      });
      if (res.failed > 0) {
        toast.warning(t.bulkFalsePositivePartialToast(res.updated, res.failed));
      } else {
        toast.success(t.bulkFalsePositiveToast(res.updated));
      }
      setFpDialogOpen(false);
      setFpNotes('');
      await invalidateAll();
      onComplete();
    } catch {
      toast.error(t.bulkFalsePositiveFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
        <span className="text-sm font-medium">
          {t.selectedCount(selectedIds.length)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={loading}>
              {loading ? t.updating : t.bulkActions}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {bulkStatuses(t).map(({ value, label }) => (
              <DropdownMenuItem key={value} onClick={() => scheduleBulkUpdate(value, label)}>
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setFpDialogOpen(true)}
            >
              {t.markFalsePositive}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={fpDialogOpen} onOpenChange={setFpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.bulkFalsePositiveDialogTitle}</DialogTitle>
            <DialogDescription>
              {t.bulkFalsePositiveDialogDescription(selectedIds.length)}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={t.falsePositivePlaceholder}
            value={fpNotes}
            onChange={(e) => setFpNotes(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFpDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void bulkFalsePositive()} disabled={loading}>
              {loading ? t.processing : t.confirmCount(selectedIds.length)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
