'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { type DataModel, dataSuiteApi } from '@/lib/data-suite';
import { showApiError, showSuccess } from '@/lib/toast';
import { useDataLabels, type DataLabels, type StringKeys } from '@/app/(dashboard)/data/_lib/data-i18n';

const CLASSIFICATIONS: Array<{ labelKey: StringKeys<DataLabels['models']>; value: string }> = [
  { labelKey: 'clPublic', value: 'public' },
  { labelKey: 'clInternal', value: 'internal' },
  { labelKey: 'clConfidential', value: 'confidential' },
  { labelKey: 'clRestricted', value: 'restricted' },
];

const schema = z.object({
  display_name: z.string().min(2, 'Display name is required').max(255),
  description: z.string().max(2000).optional(),
  data_classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
});

type FormValues = z.infer<typeof schema>;

interface EditModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: DataModel | null;
  onUpdated?: () => void;
}

export function EditModelDialog({ open, onOpenChange, model, onUpdated }: EditModelDialogProps) {
  const labels = useDataLabels();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: '', description: '', data_classification: 'internal' },
  });

  useEffect(() => {
    if (!model || !open) return;
    form.reset({
      display_name: model.display_name || model.name,
      description: model.description,
      data_classification: model.data_classification,
    });
  }, [form, open, model]);

  const onSubmit = async (values: FormValues) => {
    if (!model) return;
    try {
      await dataSuiteApi.updateModel(model.id, {
        display_name: values.display_name,
        description: values.description,
        data_classification: values.data_classification,
      });
      showSuccess(labels.models.modelUpdated);
      onUpdated?.();
      onOpenChange(false);
    } catch (error) {
      showApiError(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{model ? labels.models.editTitleNamed(model.display_name || model.name) : labels.models.editTitle}</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField name="display_name" label={labels.common.displayName} required>
            <Input {...form.register('display_name')} />
          </FormField>

          <FormField name="description" label={labels.common.description}>
            <Textarea rows={3} {...form.register('description')} />
          </FormField>

          <FormField name="data_classification" label={labels.models.classification} required>
            <Select
              value={form.watch('data_classification')}
              onValueChange={(next) =>
                form.setValue('data_classification', next as FormValues['data_classification'], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASSIFICATIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {labels.models[item.labelKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.common.cancel}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? labels.common.saving : labels.quality.saveChanges}
            </Button>
          </DialogFooter>
        </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
