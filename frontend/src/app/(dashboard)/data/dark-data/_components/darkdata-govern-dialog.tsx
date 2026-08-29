'use client';

import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { darkDataGovernSchema, type DarkDataGovernValues } from '@/lib/data-suite/forms';
import { type DarkDataAsset } from '@/lib/data-suite';
import { deriveModelName } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface DarkDataGovernDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: DarkDataAsset | null;
  submitting: boolean;
  onSubmit: (values: DarkDataGovernValues) => void;
}

export function DarkDataGovernDialog({
  open,
  onOpenChange,
  asset,
  submitting,
  onSubmit,
}: DarkDataGovernDialogProps) {
  const labels = useDataLabels();
  const form = useForm<DarkDataGovernValues>({
    resolver: zodResolver(darkDataGovernSchema),
    defaultValues: {
      model_name: '',
      assign_quality_rules: true,
    },
  });

  useEffect(() => {
    if (!asset || !open) {
      return;
    }
    form.reset({
      model_name: deriveModelName(asset.table_name || asset.name),
      assign_quality_rules: true,
    });
  }, [asset, form, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.darkData.governTitle}</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField name="model_name" label={labels.darkData.modelName} required>
              <Input {...form.register('model_name')} />
            </FormField>
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Switch checked={form.watch('assign_quality_rules')} onCheckedChange={(checked) => form.setValue('assign_quality_rules', checked, { shouldValidate: true })} />
              <div className="text-sm">{labels.darkData.autoGenRules}</div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.common.cancel}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? labels.darkData.governing : labels.darkData.govern}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
