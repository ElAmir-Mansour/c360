'use client';

import { useEffect, useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { uuidSchema } from '@/lib/enterprise/schemas';
import type { UserDirectoryEntry, VisusDashboard } from '@/types/suites';
import {
  pickEnumLabel,
  useVisusDashboardShareLabels,
  useVisusEnumLabels,
  useVisusFormCommonLabels,
} from '../../_lib/visus-i18n';

const shareSchema = z.object({
  visibility: z.enum(['private', 'team', 'organization', 'public']),
  shared_with: z.array(uuidSchema).default([]),
});

type ShareFormValues = z.infer<typeof shareSchema>;

interface DashboardShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: VisusDashboard | null;
  users: UserDirectoryEntry[];
  pending?: boolean;
  onSubmit: (payload: ShareFormValues) => Promise<void>;
}

export function DashboardShareDialog({
  open,
  onOpenChange,
  dashboard,
  users,
  pending = false,
  onSubmit,
}: DashboardShareDialogProps) {
  const t = useVisusDashboardShareLabels();
  const fc = useVisusFormCommonLabels();
  const enums = useVisusEnumLabels();
  const form = useForm<ShareFormValues>({
    resolver: zodResolver(shareSchema),
    defaultValues: {
      visibility: 'private',
      shared_with: [],
    },
  });

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: `${user.first_name} ${user.last_name}`.trim() || user.email,
      })),
    [users],
  );

  useEffect(() => {
    form.reset({
      visibility: dashboard?.visibility ?? 'private',
      shared_with: dashboard?.shared_with ?? [],
    });
  }, [dashboard, form, open]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {t.description(dashboard?.name ?? t.thisDashboardFallback)}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="share-visibility">{t.visibilityLabel}</Label>
              <Select
                value={form.watch('visibility')}
                onValueChange={(value) => form.setValue('visibility', value as ShareFormValues['visibility'], { shouldDirty: true })}
              >
                <SelectTrigger id="share-visibility">
                  <SelectValue placeholder={t.visibilityPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{pickEnumLabel(enums.visibility, 'private')}</SelectItem>
                  <SelectItem value="team">{pickEnumLabel(enums.visibility, 'team')}</SelectItem>
                  <SelectItem value="organization">{pickEnumLabel(enums.visibility, 'organization')}</SelectItem>
                  <SelectItem value="public">{pickEnumLabel(enums.visibility, 'public')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="share-users">{t.sharedWithLabel}</Label>
              <MultiSelect
                options={userOptions}
                selected={form.watch('shared_with')}
                onChange={(values) => form.setValue('shared_with', values, { shouldDirty: true })}
                placeholder={t.sharedWithPlaceholder}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {fc.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? fc.saving : t.submit}
              </Button>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
