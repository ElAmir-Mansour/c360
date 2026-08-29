'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { visusDashboardSchema } from '@/lib/enterprise/schemas';
import type { UserDirectoryEntry, VisusDashboard } from '@/types/suites';
import { formatCommaSeparatedList, formatJsonInput, parseCommaSeparatedList, parseJsonInput } from '../../_components/form-utils';
import {
  pickEnumLabel,
  useVisusDashboardFormLabels,
  useVisusEnumLabels,
  useVisusFormCommonLabels,
} from '../../_lib/visus-i18n';

type DashboardFormValues = z.infer<typeof visusDashboardSchema>;

const VISIBILITY_VALUES: DashboardFormValues['visibility'][] = ['private', 'team', 'organization', 'public'];

interface DashboardFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard?: VisusDashboard | null;
  users: UserDirectoryEntry[];
  pending?: boolean;
  onSubmit: (payload: DashboardFormValues) => Promise<void>;
}

export function DashboardFormDialog({
  open,
  onOpenChange,
  dashboard,
  users,
  pending = false,
  onSubmit,
}: DashboardFormDialogProps) {
  const t = useVisusDashboardFormLabels();
  const fc = useVisusFormCommonLabels();
  const enums = useVisusEnumLabels();
  const [tagsInput, setTagsInput] = useState('');
  const [metadataInput, setMetadataInput] = useState('{}');
  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: `${user.first_name} ${user.last_name}`.trim() || user.email,
      })),
    [users],
  );

  const form = useForm<DashboardFormValues>({
    resolver: zodResolver(visusDashboardSchema),
    defaultValues: {
      name: '',
      description: '',
      grid_columns: 12,
      visibility: 'private',
      shared_with: [],
      is_default: false,
      tags: [],
      metadata: {},
    },
  });

  useEffect(() => {
    const nextValues: DashboardFormValues = {
      name: dashboard?.name ?? '',
      description: dashboard?.description ?? '',
      grid_columns: dashboard?.grid_columns ?? 12,
      visibility: dashboard?.visibility ?? 'private',
      shared_with: dashboard?.shared_with ?? [],
      is_default: dashboard?.is_default ?? false,
      tags: dashboard?.tags ?? [],
      metadata: dashboard?.metadata ?? {},
    };
    form.reset(nextValues);
    setTagsInput(formatCommaSeparatedList(nextValues.tags));
    setMetadataInput(formatJsonInput(nextValues.metadata));
  }, [dashboard, form, open]);

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      const metadata = parseJsonInput(metadataInput);
      await onSubmit({
        ...values,
        tags: parseCommaSeparatedList(tagsInput),
        metadata,
      });
      onOpenChange(false);
    } catch (error) {
      form.setError('metadata', {
        type: 'validate',
        message: error instanceof Error ? error.message : fc.invalidMetadata,
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dashboard ? t.titleEdit : t.titleCreate}</DialogTitle>
          <DialogDescription>
            {t.description}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="name" label={t.nameLabel} required>
                <Input id="name" {...form.register('name')} placeholder={t.namePlaceholder} />
              </FormField>
              <FormField name="grid_columns" label={t.gridColumnsLabel} required>
                <Input id="grid_columns" type="number" min={1} max={12} {...form.register('grid_columns', { valueAsNumber: true })} />
              </FormField>
            </div>

            <FormField name="description" label={t.descriptionLabel} required>
              <Textarea
                id="description"
                rows={3}
                {...form.register('description')}
                placeholder={t.descriptionPlaceholder}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="visibility" label={t.visibilityLabel} required>
                <Select
                  value={form.watch('visibility')}
                  onValueChange={(value) =>
                    form.setValue('visibility', value as DashboardFormValues['visibility'], { shouldDirty: true, shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.visibilityPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {pickEnumLabel(enums.visibility, value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <div className="space-y-1.5">
                <Label htmlFor="dashboard-tags">{t.tagsLabel}</Label>
                <Input
                  id="dashboard-tags"
                  value={tagsInput}
                  onChange={(event) => setTagsInput(event.target.value)}
                  placeholder={t.tagsPlaceholder}
                />
                <p className="text-xs text-muted-foreground">{t.tagsHelp}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dashboard-shared-with">{t.sharedWithLabel}</Label>
              <MultiSelect
                options={userOptions}
                selected={form.watch('shared_with')}
                onChange={(values) => form.setValue('shared_with', values, { shouldDirty: true })}
                placeholder={t.sharedWithPlaceholder}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="is_default"
                checked={form.watch('is_default')}
                onCheckedChange={(checked) => form.setValue('is_default', Boolean(checked), { shouldDirty: true })}
              />
              <Label htmlFor="is_default">{t.isDefaultLabel}</Label>
            </div>

            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="space-y-1.5">
                  <Label htmlFor="dashboard-metadata">{t.metadataLabel}</Label>
                  <Textarea
                    id="dashboard-metadata"
                    rows={10}
                    value={metadataInput}
                    onChange={(event) => setMetadataInput(event.target.value)}
                    className="font-mono text-xs"
                    placeholder='{"owner_team":"executive","cadence":"weekly"}'
                  />
                </div>
                {typeof form.formState.errors.metadata?.message === 'string' ? (
                  <p className="text-xs text-destructive" role="alert">
                    {form.formState.errors.metadata.message}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {fc.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? fc.saving : dashboard ? t.submitEdit : t.submitCreate}
              </Button>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
