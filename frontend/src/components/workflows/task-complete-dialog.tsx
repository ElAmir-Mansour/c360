'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
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
import type { HumanTask } from '@/types/models';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useWorkflowPageLabels } from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';

interface TaskCompleteDialogProps {
  task: HumanTask;
  formData: Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function TaskCompleteDialog({
  task,
  formData,
  open,
  onOpenChange,
  onSuccess,
}: TaskCompleteDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lateJustification, setLateJustification] = useState('');
  const { locale } = useLocaleOrDefault();
  const labels = useWorkflowPageLabels();
  const isLate = Boolean(
    task.sla_deadline && Date.now() > new Date(task.sla_deadline).getTime(),
  );

  useEffect(() => {
    if (!open) setLateJustification('');
  }, [open]);

  const handleComplete = async () => {
	if (isLate && !lateJustification.trim()) return;
    setIsSubmitting(true);
    try {
      await apiPost(`/api/v1/workflows/tasks/${task.id}/complete`, {
        form_data: formData,
        ...(isLate ? { late_justification: lateJustification.trim() } : {}),
      });
      showSuccess(labels.tasks.detail.completedSuccess);
      onOpenChange(false);
      onSuccess();
    } catch {
      showApiError(new Error(labels.tasks.detail.failedToComplete));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show a summary of filled form fields
  const fields = task.form_schema.map((field) => ({
    field,
    value: formData[field.name],
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
              <CheckCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>{labels.tasks.detail.completeTitle}</DialogTitle>
              <DialogDescription className="mt-0.5">
                {labels.tasks.detail.completeDescription}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {fields.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {labels.tasks.detail.completeAnswers}
            </p>
            <dl className="space-y-1.5">
              {fields.slice(0, 6).map(({ field, value }) => (
                <div key={field.name} className="flex gap-2 text-sm">
                  <dt className="shrink-0 font-medium capitalize">
                    {resolveLocalized(field.label, locale)}:
                  </dt>
                  <dd className="truncate text-muted-foreground">
                    {value === undefined || value === null || value === ''
                      ? field.required
                        ? labels.tasks.detail.required
                        : labels.tasks.detail.optional
                      : typeof value === 'boolean'
                        ? value
                          ? labels.tasks.detail.yes
                          : labels.tasks.detail.no
                        : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {labels.tasks.detail.completeWarning}
        </p>

        {isLate ? (
          <div className="space-y-1.5 rounded-lg border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
            <Label htmlFor="task-late-justification">
              Late SLA justification <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="task-late-justification"
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

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {labels.common.cancel}
          </Button>
          <Button
            onClick={handleComplete}
            disabled={isSubmitting || (isLate && !lateJustification.trim())}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {labels.tasks.detail.completing}
              </>
            ) : (
              labels.tasks.detail.completeTitle
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
