'use client';

import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/shared/forms/form-field';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { contradictionResolutionSchema, type ContradictionResolutionValues } from '@/lib/data-suite/forms';
import { type Contradiction } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface ContradictionResolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contradiction: Contradiction | null;
  submitting: boolean;
  onSubmit: (values: ContradictionResolutionValues) => void;
}

export function ContradictionResolveDialog({
  open,
  onOpenChange,
  contradiction,
  submitting,
  onSubmit,
}: ContradictionResolveDialogProps) {
  const labels = useDataLabels();
  const form = useForm<ContradictionResolutionValues>({
    resolver: zodResolver(contradictionResolutionSchema),
    defaultValues: {
      resolution_action: 'data_reconciled',
      resolution_notes: '',
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.contradictions.resolveTitle}</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField name="resolution_action" label={labels.contradictions.resolutionAction} required>
              <Select value={form.watch('resolution_action')} onValueChange={(value) => form.setValue('resolution_action', value as ContradictionResolutionValues['resolution_action'], { shouldValidate: true })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="source_a_corrected">{labels.contradictions.raSourceA}</SelectItem>
                  <SelectItem value="source_b_corrected">{labels.contradictions.raSourceB}</SelectItem>
                  <SelectItem value="both_corrected">{labels.contradictions.raBoth}</SelectItem>
                  <SelectItem value="data_reconciled">{labels.contradictions.raReconciled}</SelectItem>
                  <SelectItem value="accepted_as_is">{labels.contradictions.raAccepted}</SelectItem>
                  <SelectItem value="false_positive">{labels.contradictions.raFalsePositive}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField name="resolution_notes" label={labels.contradictions.resolutionNotes} required>
              <Textarea rows={5} {...form.register('resolution_notes')} placeholder={contradiction?.title} />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.common.cancel}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? labels.contradictions.submitting : labels.contradictions.resolve}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
