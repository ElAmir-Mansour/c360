'use client';

import { useEffect, useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
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
import { apiGet, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { toast } from 'sonner';
import type { PaginatedResponse } from '@/types/api';
import type { CyberAlert } from '@/types/cyber';
import type { User } from '@/types/models';

import { useAlertLabels } from '../_lib/alerts-i18n';

const schema = z.object({
  assigned_to: z.string().uuid(),
});

type FormValues = z.infer<typeof schema>;

interface AlertAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alert?: CyberAlert | null;
  alertIds?: string[];
  onSuccess?: () => void;
}

export function AlertAssignDialog({
  open,
  onOpenChange,
  alert,
  alertIds,
  onSuccess,
}: AlertAssignDialogProps) {
  const t = useAlertLabels();
  const localizedSchema = useMemo(
    () => z.object({ assigned_to: z.string().uuid(t.assign.selectAnalystError) }),
    [t.assign.selectAnalystError],
  );
  const methods = useForm<FormValues>({
    resolver: zodResolver(localizedSchema),
    defaultValues: { assigned_to: '' },
  });

  const targetIds = useMemo(
    () => (alertIds && alertIds.length > 0 ? alertIds : alert ? [alert.id] : []),
    [alert, alertIds],
  );

  const usersQuery = useQuery({
    queryKey: ['alert-assign-users'],
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
    (usersQuery.data?.data ?? []).map((user) => ({
      value: user.id,
      label: `${user.first_name} ${user.last_name} (${user.email})`,
    }))
  ), [usersQuery.data?.data]);

  useEffect(() => {
    if (!open) {
      methods.reset({ assigned_to: '' });
    }
  }, [methods, open]);

  async function handleSubmit(values: FormValues) {
    if (targetIds.length === 0) {
      toast.error(t.assign.noAlertsSelected);
      return;
    }

    if (targetIds.length > 1) {
      await apiPut(API_ENDPOINTS.CYBER_ALERT_BULK_ASSIGN, {
        alert_ids: targetIds,
        assigned_to: values.assigned_to,
      });
    } else {
      await apiPut(API_ENDPOINTS.CYBER_ALERT_ASSIGN(targetIds[0]), {
        assigned_to: values.assigned_to,
      });
    }

    toast.success(targetIds.length === 1 ? t.assign.assignedSingle : t.assign.assignedBulk(targetIds.length));
    methods.reset({ assigned_to: '' });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            {targetIds.length > 1 ? t.assign.titleBulk(targetIds.length) : t.assign.titleSingle}
          </DialogTitle>
          <DialogDescription>
            {targetIds.length > 1
              ? t.assign.descriptionBulk
              : t.assign.descriptionSingle(alert?.title ?? t.assign.thisAlert)}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              name="assigned_to"
              label={t.assign.analystLabel}
              required
              description={t.assign.analystHelp}
            >
              <Combobox
                options={options}
                value={methods.watch('assigned_to')}
                onChange={(value) => methods.setValue('assigned_to', value, { shouldValidate: true })}
                placeholder={usersQuery.isLoading ? t.assign.loadingAnalysts : t.assign.selectAnalyst}
                searchPlaceholder={t.assign.searchAnalysts}
                disabled={usersQuery.isLoading || options.length === 0}
                className="w-full justify-between"
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.assign.cancel}
              </Button>
              <Button type="submit" disabled={methods.formState.isSubmitting || usersQuery.isLoading}>
                {methods.formState.isSubmitting ? t.assign.submitting : t.assign.submitIdle}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
