'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import type { RemediationAction } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: RemediationAction;
  onSuccess?: () => void;
}

export function RollbackDialog({ open, onOpenChange, action, onSuccess }: RollbackDialogProps) {
  const t = useRemediationLabels();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');

  const { mutate, isPending } = useApiMutation<void, { reason: string }>(
    'post',
    `${API_ENDPOINTS.CYBER_REMEDIATION}/${action.id}/rollback`,
    {
      successMessage: t.rollback.initiatedToast,
      invalidateKeys: ['cyber-remediation', `cyber-remediation-${action.id}`],
      onSuccess: () => {
        setConfirm('');
        setReason('');
        onOpenChange(false);
        onSuccess?.();
      },
    },
  );

  const handleClose = () => {
    setConfirm('');
    setReason('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning-700 dark:text-warning-300">
            <RotateCcw className="h-5 w-5" />
            {t.rollback.title}
          </DialogTitle>
          <DialogDescription>
            {t.rollback.description(action.title)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-warning-100 bg-warning-50/50 p-3 dark:border-warning-800 dark:bg-warning-800/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" />
            <p className="text-xs text-warning-700 dark:text-warning-300">
              {t.rollback.warningBody}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rollback-reason">{t.rollback.reasonLabel}</Label>
            <Textarea
              id="rollback-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.rollback.reasonPlaceholder}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rollback-confirm">
              {t.rollback.confirmPromptPrefix}<strong>{t.rollback.confirmPromptWord}</strong>{t.rollback.confirmPromptSuffix}
            </Label>
            <Input
              id="rollback-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t.rollback.confirmPlaceholder}
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>{t.rollback.cancel}</Button>
          <Button
            type="button"
            disabled={confirm !== 'ROLLBACK' || !reason.trim() || isPending}
            onClick={() => mutate({ reason })}
            className="bg-warning-600 text-white hover:bg-warning-700"
          >
            <RotateCcw className="me-1.5 h-4 w-4" />
            {isPending ? t.rollback.rollingBack : t.rollback.confirmRollback}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
