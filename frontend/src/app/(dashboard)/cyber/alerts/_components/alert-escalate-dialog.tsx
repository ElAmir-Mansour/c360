'use client';

import { useEffect, useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpCircle } from 'lucide-react';
import { z } from 'zod';
import { FormField } from '@/components/shared/forms/form-field';
import { Combobox } from '@/components/shared/forms/combobox';
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
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { toast } from 'sonner';
import type { PaginatedResponse } from '@/types/api';
import type { CyberAlert } from '@/types/cyber';
import type { User } from '@/types/models';

import { useAlertLabels } from '../_lib/alerts-i18n';

const schema = z.object({
  escalated_to: z.string().uuid('Select an escalation target'),
  reason: z.string().min(5, 'Provide a clear escalation reason'),
});

type FormValues = z.infer<typeof schema>;

interface AlertEscalateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alert: CyberAlert;
  onSuccess?: () => void;
}

export function AlertEscalateDialog({ open, onOpenChange, alert, onSuccess }: AlertEscalateDialogProps) {
  const t = useAlertLabels();
  const localizedSchema = useMemo(
    () =>
      z.object({
        escalated_to: z.string().uuid(t.escalate.selectTargetError),
        reason: z.string().min(5, t.escalate.reasonError),
      }),
    [t.escalate.selectTargetError, t.escalate.reasonError],
  );
  const methods = useForm<FormValues>({
    resolver: zodResolver(localizedSchema),
    defaultValues: { escalated_to: '', reason: '' },
  });

  const usersQuery = useQuery({
    queryKey: ['alert-escalate-users'],
    queryFn: () => apiGet<PaginatedResponse<User>>('/api/v1/users', {
      page: 1,
      per_page: 100,
      status: 'active',
      sort: 'created_at',
      order: 'desc',
    }),
    enabled: open,
  });

  const options = useMemo(() => (
    (usersQuery.data?.data ?? [])
      .filter((user) => user.id !== alert.assigned_to)
      .map((user) => ({
        value: user.id,
        label: `${user.first_name} ${user.last_name} (${user.email})`,
      }))
  ), [alert.assigned_to, usersQuery.data?.data]);

  useEffect(() => {
    if (!open) {
      methods.reset({ escalated_to: '', reason: '' });
    }
  }, [methods, open]);

  async function handleSubmit(values: FormValues) {
    await apiPost(API_ENDPOINTS.CYBER_ALERT_ESCALATE(alert.id), values);
    toast.success(t.escalate.escalated);
    methods.reset({ escalated_to: '', reason: '' });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-error-600 dark:text-error-300">
            <ArrowUpCircle className="h-5 w-5" />
            {t.escalate.title}
          </DialogTitle>
          <DialogDescription>
            {t.escalate.description(alert.title)}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField name="escalated_to" label={t.escalate.escalateToLabel} required>
              <Combobox
                options={options}
                value={methods.watch('escalated_to')}
                onChange={(value) => methods.setValue('escalated_to', value, { shouldValidate: true })}
                placeholder={usersQuery.isLoading ? t.escalate.loadingAnalysts : t.escalate.selectTarget}
                searchPlaceholder={t.escalate.searchAnalysts}
                disabled={usersQuery.isLoading || options.length === 0}
                className="w-full justify-between"
              />
            </FormField>

            <FormField name="reason" label={t.escalate.reasonLabel} required>
              <Textarea
                rows={4}
                placeholder={t.escalate.reasonPlaceholder}
                {...methods.register('reason')}
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.escalate.cancel}
              </Button>
              <Button type="submit" disabled={methods.formState.isSubmitting || usersQuery.isLoading}>
                {methods.formState.isSubmitting ? t.escalate.submitting : t.escalate.submitIdle}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
