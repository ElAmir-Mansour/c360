'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiPost } from '@/lib/api';
import { showSuccess, showApiError } from '@/lib/toast';
import { useWorkflowPageLabels } from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';
import type { HumanTask } from '@/types/models';

interface TaskRejectDialogProps {
  task: HumanTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function TaskRejectDialog({
  task,
  open,
  onOpenChange,
  onSuccess,
}: TaskRejectDialogProps) {
  const [reason, setReason] = useState('');
  const [lateJustification, setLateJustification] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const labels = useWorkflowPageLabels();

  const isLate = Boolean(
    task.sla_deadline && Date.now() > new Date(task.sla_deadline).getTime(),
  );
  const canSubmit =
    reason.trim().length >= 10 && (!isLate || Boolean(lateJustification.trim()));

  const handleReject = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await apiPost(`/api/v1/workflows/tasks/${task.id}/reject`, {
        reason: reason.trim(),
        ...(isLate ? { late_justification: lateJustification.trim() } : {}),
      });
      showSuccess(labels.tasks.detail.rejectedSuccess);
      onOpenChange(false);
      setReason('');
      onSuccess();
    } catch {
      showApiError(new Error(labels.tasks.detail.failedToReject));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setReason('');
      setLateJustification('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>{labels.tasks.detail.rejectTitle}</DialogTitle>
              <DialogDescription className="mt-0.5">
                {labels.tasks.detail.rejectDescription}
              </DialogDescription>
            </div>
          </div>
          {isLate ? (
            <div className="space-y-1.5 rounded-lg border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
              <Label htmlFor="reject-late-justification">
                Late SLA justification <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reject-late-justification"
                value={lateJustification}
                onChange={(event) => setLateJustification(event.target.value)}
                placeholder="Explain why this task ended after its SLA deadline."
                disabled={isSubmitting}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Visible only to the Legal Director and the corresponding manager.
              </p>
            </div>
          ) : null}
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">
              {labels.tasks.detail.reason} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={labels.tasks.detail.rejectPlaceholder}
              className="min-h-[100px]"
              disabled={isSubmitting}
            />
            {reason.length > 0 && reason.trim().length < 10 && (
              <p className="text-xs text-destructive">
                {labels.tasks.detail.reasonMinLength}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {labels.tasks.detail.rejectWarning}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            {labels.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {labels.tasks.detail.rejecting}
              </>
            ) : (
              labels.tasks.detail.rejectTitle
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
