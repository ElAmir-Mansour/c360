'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Combobox } from '@/components/shared/forms/combobox';
import { FormField } from '@/components/shared/forms/form-field';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  SETTLEMENT_METHOD_OPTIONS,
  useSettlementLabels,
  type SettlementLabels,
} from './labels';
import {
  settlementsApi,
  type OpenSettlementPayload,
  type RecordSettlementPayload,
  type Settlement,
} from '@/lib/lex/settlements';

function buildSchema(errors: SettlementLabels['form']['errors'], isEdit: boolean) {
  return z.object({
    matter_id: isEdit ? z.string().optional() : z.string().min(1, errors.matterRequired),
    title: z.string().trim().min(3, errors.titleRequired),
    reference: z.string().trim().optional(),
    method: z.enum(SETTLEMENT_METHOD_OPTIONS),
    terms: z.string().trim().min(3, errors.termsRequired),
    value: z
      .string()
      .optional()
      .refine((v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 0), errors.valueInvalid),
    currency: z.string().trim().optional(),
    counterparty_name: z.string().trim().optional(),
    counterparty_contact: z.string().trim().optional(),
    counterparty_id_number: z.string().trim().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

function buildDefaults(settlement?: Settlement | null): FormValues {
  return {
    matter_id: settlement?.matter_id ?? '',
    title: settlement?.title ?? '',
    reference: settlement?.reference ?? '',
    method: settlement?.method ?? 'reconciliation',
    terms: settlement?.terms ?? '',
    value: settlement?.value !== null && settlement?.value !== undefined ? String(settlement.value) : '',
    currency: settlement?.currency ?? '',
    counterparty_name: settlement?.counterparty_name ?? '',
    counterparty_contact: settlement?.counterparty_contact ?? '',
    counterparty_id_number: settlement?.counterparty_id_number ?? '',
  };
}

interface SettlementFormDialogProps {
  settlement?: Settlement | null;
  /** Pre-selected matter (used when opening from a matter detail). */
  presetMatterId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (settlement: Settlement) => void;
}

export function SettlementFormDialog({
  settlement,
  presetMatterId,
  open,
  onOpenChange,
  onSaved,
}: SettlementFormDialogProps) {
  const isEdit = Boolean(settlement);
  const queryClient = useQueryClient();
  const L = useSettlementLabels();
  const labels = L.form;
  const schema = useMemo(() => buildSchema(L.form.errors, isEdit), [L.form.errors, isEdit]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaults(settlement),
  });

  useEffect(() => {
    if (open) {
      const defaults = buildDefaults(settlement);
      if (!isEdit && presetMatterId) {
        defaults.matter_id = presetMatterId;
      }
      form.reset(defaults);
    }
  }, [settlement, presetMatterId, isEdit, form, open]);

  // Matter options (create flow only; hidden when a preset matter is provided).
  const mattersQuery = useQuery({
    queryKey: ['lex-settlements-matter-options'],
    queryFn: () => settlementsApi.searchMatters(''),
    enabled: open && !isEdit && !presetMatterId,
  });
  const matterOptions = useMemo(
    () =>
      (mattersQuery.data?.data ?? []).map((matter) => ({
        value: matter.id,
        label: matter.matter_number ? `${matter.title} (${matter.matter_number})` : matter.title,
      })),
    [mattersQuery.data],
  );

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      if (isEdit && settlement) {
        const payload: RecordSettlementPayload = {
          title: values.title,
          reference: values.reference || undefined,
          method: values.method,
          terms: values.terms,
          value: values.value ? Number(values.value) : undefined,
          currency: values.currency || undefined,
          counterparty_name: values.counterparty_name || undefined,
          counterparty_contact: values.counterparty_contact || undefined,
          counterparty_id_number: values.counterparty_id_number || undefined,
        };
        return settlementsApi.record(settlement.id, payload);
      }
      const payload: OpenSettlementPayload = {
        matter_id: values.matter_id ?? '',
        title: values.title,
        reference: values.reference || undefined,
        method: values.method,
        terms: values.terms,
        value: values.value ? Number(values.value) : undefined,
        currency: values.currency || undefined,
        counterparty_name: values.counterparty_name || undefined,
        counterparty_contact: values.counterparty_contact || undefined,
        counterparty_id_number: values.counterparty_id_number || undefined,
      };
      return settlementsApi.open(payload);
    },
    onSuccess: async (saved) => {
      showSuccess(isEdit ? L.toast.updated : L.toast.created);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-settlements'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-settlement', saved.id] }),
      ]);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const methodValue = form.watch('method');
  const matterValue = form.watch('matter_id') ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? labels.editDescription : labels.createDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
            {!isEdit ? <LexCreationGuidance workflow="settlement" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {!isEdit && !presetMatterId ? (
                <FormField name="matter_id" label={labels.matter} description={labels.matterHint} required>
                  <Combobox
                    options={matterOptions}
                    value={matterValue}
                    onChange={(v) => form.setValue('matter_id', v, { shouldValidate: true })}
                    placeholder={labels.matterPlaceholder}
                    searchPlaceholder={labels.matterPlaceholder}
                    className="w-full"
                  />
                </FormField>
              ) : null}
              <FormField name="title" label={labels.title} required>
                <Input id="title" {...form.register('title')} placeholder={labels.titlePlaceholder} />
              </FormField>
              <FormField name="method" label={labels.method} required>
                <Select
                  value={methodValue}
                  onValueChange={(v) =>
                    form.setValue('method', v as FormValues['method'], { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTLEMENT_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {L.filters.methodOptions[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="reference" label={labels.reference}>
                <Input id="reference" {...form.register('reference')} placeholder={labels.referencePlaceholder} />
              </FormField>
            </div>

            <FormField name="terms" label={labels.terms} required>
              <Textarea id="terms" rows={4} {...form.register('terms')} placeholder={labels.termsPlaceholder} />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="value" label={labels.value}>
                <Input id="value" inputMode="decimal" {...form.register('value')} placeholder={labels.valuePlaceholder} />
              </FormField>
              <FormField name="currency" label={labels.currency}>
                <Input id="currency" {...form.register('currency')} placeholder={labels.currencyPlaceholder} />
              </FormField>
            </div>

            <div className="rounded-lg border p-4">
              <p className="mb-3 text-xs text-muted-foreground">{labels.pii}</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField name="counterparty_name" label={labels.counterpartyName}>
                  <Input
                    id="counterparty_name"
                    {...form.register('counterparty_name')}
                    placeholder={labels.counterpartyNamePlaceholder}
                  />
                </FormField>
                <FormField name="counterparty_contact" label={labels.counterpartyContact}>
                  <Input
                    id="counterparty_contact"
                    {...form.register('counterparty_contact')}
                    placeholder={labels.counterpartyContactPlaceholder}
                  />
                </FormField>
                <FormField name="counterparty_id_number" label={labels.counterpartyIdNumber}>
                  <Input
                    id="counterparty_id_number"
                    {...form.register('counterparty_id_number')}
                    placeholder={labels.counterpartyIdNumberPlaceholder}
                  />
                </FormField>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? labels.save : labels.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
