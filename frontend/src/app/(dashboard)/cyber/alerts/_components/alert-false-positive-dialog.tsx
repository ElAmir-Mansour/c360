'use client';

import { useEffect, useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert } from 'lucide-react';
import { z } from 'zod';
import { FormField } from '@/components/shared/forms/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { toast } from 'sonner';
import type { CyberAlert } from '@/types/cyber';

import { useAlertLabels } from '../_lib/alerts-i18n';

const schema = z.object({
  reason: z.string().min(5, 'Provide a clear reason'),
});

type FormValues = z.infer<typeof schema>;

interface AlertFalsePositiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alert?: CyberAlert | null;
  alertIds?: string[];
  onSuccess?: () => void;
}

export function AlertFalsePositiveDialog({
  open,
  onOpenChange,
  alert,
  alertIds,
  onSuccess,
}: AlertFalsePositiveDialogProps) {
  const t = useAlertLabels();
  const localizedSchema = useMemo(
    () => z.object({ reason: z.string().min(5, t.falsePositive.reasonError) }),
    [t.falsePositive.reasonError],
  );
  const methods = useForm<FormValues>({
    resolver: zodResolver(localizedSchema),
    defaultValues: { reason: '' },
  });

  const targetIds = alertIds && alertIds.length > 0 ? alertIds : alert ? [alert.id] : [];

  useEffect(() => {
    if (!open) {
      methods.reset({ reason: '' });
    }
  }, [methods, open]);

  async function handleSubmit(values: FormValues) {
    if (targetIds.length === 0) {
      toast.error(t.falsePositive.noAlertsSelected);
      return;
    }

    if (targetIds.length > 1) {
      await apiPut(API_ENDPOINTS.CYBER_ALERT_BULK_FALSE_POSITIVE, {
        alert_ids: targetIds,
        reason: values.reason.trim(),
      });
    } else {
      await apiPut(API_ENDPOINTS.CYBER_ALERT_FALSE_POSITIVE(targetIds[0]), {
        reason: values.reason.trim(),
      });
    }

    // Submit rule feedback for single-alert false positives when tied to a detection rule
    if (alert?.rule_id && targetIds.length === 1) {
      try {
        await apiPost(API_ENDPOINTS.CYBER_RULE_FEEDBACK(alert.rule_id), {
          alert_id: alert.id,
          feedback: 'false_positive',
        });
      } catch {
        // Best-effort — the alert was already marked FP above
      }
    }

    toast.success(targetIds.length === 1 ? t.falsePositive.markedSingle : t.falsePositive.markedBulk(targetIds.length));
    methods.reset({ reason: '' });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
            <ShieldAlert className="h-5 w-5" />
            {t.falsePositive.title}
          </DialogTitle>
          <DialogDescription>
            {targetIds.length > 1
              ? t.falsePositive.descriptionBulk
              : t.falsePositive.descriptionSingle(alert?.title ?? t.assign.thisAlert)}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField name="reason" label={t.falsePositive.reasonLabel} required>
              <Textarea
                rows={4}
                placeholder={t.falsePositive.reasonPlaceholder}
                {...methods.register('reason')}
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.falsePositive.cancel}
              </Button>
              <Button type="submit" disabled={methods.formState.isSubmitting}>
                {methods.formState.isSubmitting ? t.falsePositive.submitting : t.falsePositive.submitIdle}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
