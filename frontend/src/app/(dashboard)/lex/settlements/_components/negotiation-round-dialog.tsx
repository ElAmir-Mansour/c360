'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/shared/forms/form-field';
import { useSettlementLabels, type SettlementLabels } from './labels';
import type { AddNegotiationRoundPayload } from '@/lib/lex/settlements';

function buildSchema(labels: SettlementLabels['round']) {
  return z.object({
    proposed_by: z.string().trim().min(1, labels.proposedByRequired),
    proposed_value: z
      .string()
      .optional()
      .refine((v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 0), labels.valueInvalid),
    currency: z.string().trim().optional(),
    terms: z.string().trim().min(3, labels.termsRequired),
    outcome: z.string().trim().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface NegotiationRoundDialogProps {
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: AddNegotiationRoundPayload) => void;
}

export function NegotiationRoundDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: NegotiationRoundDialogProps) {
  const L = useSettlementLabels();
  const labels = L.round;
  const schema = useMemo(() => buildSchema(L.round), [L.round]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { proposed_by: '', proposed_value: '', currency: '', terms: '', outcome: '' },
  });

  useEffect(() => {
    if (open) {
      form.reset({ proposed_by: '', proposed_value: '', currency: '', terms: '', outcome: '' });
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.addRound}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit((values) =>
              onSubmit({
                proposed_by: values.proposed_by,
                proposed_value: values.proposed_value ? Number(values.proposed_value) : undefined,
                currency: values.currency || undefined,
                terms: values.terms,
                outcome: values.outcome || undefined,
              }),
            )}
          >
            <LexCreationGuidance workflow="settlement" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="proposed_by" label={labels.proposedBy} required>
                <Input
                  id="proposed_by"
                  {...form.register('proposed_by')}
                  placeholder={labels.proposedByPlaceholder}
                />
              </FormField>
              <FormField name="proposed_value" label={labels.proposedValue}>
                <Input
                  id="proposed_value"
                  inputMode="decimal"
                  {...form.register('proposed_value')}
                  placeholder={labels.proposedValuePlaceholder}
                />
              </FormField>
              <FormField name="currency" label={labels.currency}>
                <Input id="currency" {...form.register('currency')} placeholder={labels.currencyPlaceholder} />
              </FormField>
            </div>
            <FormField name="terms" label={labels.terms} required>
              <Textarea id="terms" rows={3} {...form.register('terms')} placeholder={labels.termsPlaceholder} />
            </FormField>
            <FormField name="outcome" label={labels.outcome}>
              <Input id="outcome" {...form.register('outcome')} placeholder={labels.outcomePlaceholder} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {labels.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
