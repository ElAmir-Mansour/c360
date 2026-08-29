'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import {
  LexRecordPicker,
  type LexRecordKind,
} from '@/components/lex/lex-record-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  legalHoldsApi,
  LEGAL_HOLD_SUBJECT_TYPE_VALUES,
  type LegalHoldSubjectType,
} from '@/lib/lex/legal-holds';
import {
  useLegalHoldCopy,
  subjectTypeLabel,
  type LegalHoldCopy,
} from './legal-hold-copy';

/** The subject-type tokens are identical to the record-picker kinds. */
const RECORD_KIND: Record<LegalHoldSubjectType, LexRecordKind> = {
  contract: 'contract',
  matter: 'matter',
  document: 'document',
  consultation: 'consultation',
};

function buildSchema(copy: LegalHoldCopy) {
  return z.object({
    subject_type: z.enum(
      LEGAL_HOLD_SUBJECT_TYPE_VALUES as unknown as [
        LegalHoldSubjectType,
        ...LegalHoldSubjectType[],
      ],
    ),
    subject_id: z.string().trim().min(1, copy.form.errors.subjectRequired),
    reason: z.string().trim().min(1, copy.form.errors.reasonRequired),
    reference: z.string().trim().optional(),
    custodian: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

const DEFAULTS: FormValues = {
  subject_type: 'contract',
  subject_id: '',
  reason: '',
  reference: '',
  custodian: '',
  notes: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

export function LegalHoldFormDialog({ open, onOpenChange, onApplied }: Props) {
  const qc = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const copy = useLegalHoldCopy();
  const schema = useMemo(() => buildSchema(copy), [copy]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (open) form.reset(DEFAULTS);
  }, [open, form]);

  const subjectType = form.watch('subject_type');
  const subjectId = form.watch('subject_id');

  const apply = useMutation({
    mutationFn: (v: FormValues) =>
      legalHoldsApi.apply({
        subject_type: v.subject_type,
        subject_id: v.subject_id,
        reason: v.reason,
        reference: v.reference || undefined,
        custodian: v.custodian || undefined,
        notes: v.notes || undefined,
      }),
    onSuccess: async () => {
      showSuccess(copy.toast.applied);
      await qc.invalidateQueries({ queryKey: ['lex-admin-legal-holds'] });
      onOpenChange(false);
      onApplied?.();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.form.title}</DialogTitle>
          <DialogDescription>{copy.form.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => apply.mutate(v))}>
            <LexCreationGuidance workflow="legal-hold" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="subject_type" label={copy.form.subjectType} required>
                <Select
                  value={subjectType}
                  onValueChange={(v) => {
                    form.setValue('subject_type', v as LegalHoldSubjectType, {
                      shouldValidate: true,
                    });
                    // The picked record must belong to the new subject type.
                    form.setValue('subject_id', '', { shouldValidate: false });
                  }}
                >
                  <SelectTrigger id="subject_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEGAL_HOLD_SUBJECT_TYPE_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {subjectTypeLabel(value, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField
                name="subject_id"
                label={copy.form.subject}
                required
                description={copy.form.subjectHint}
              >
                <LexRecordPicker
                  id="subject_id"
                  kind={RECORD_KIND[subjectType]}
                  ariaLabel={copy.form.subject}
                  value={subjectId}
                  onChange={(id) => form.setValue('subject_id', id, { shouldValidate: true })}
                  required
                />
              </FormField>
            </div>

            <FormField name="reason" label={copy.form.reason} required>
              <Textarea
                id="reason"
                {...form.register('reason')}
                placeholder={copy.form.reasonPlaceholder}
                rows={3}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="reference" label={copy.form.reference}>
                <Input
                  id="reference"
                  {...form.register('reference')}
                  placeholder={copy.form.referencePlaceholder}
                />
              </FormField>
              <FormField name="custodian" label={copy.form.custodian}>
                <Input
                  id="custodian"
                  {...form.register('custodian')}
                  placeholder={copy.form.custodianPlaceholder}
                />
              </FormField>
            </div>

            <FormField name="notes" label={copy.form.notes}>
              <Textarea id="notes" {...form.register('notes')} rows={2} />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {copy.actions.cancel}
              </Button>
              <Button type="submit" disabled={apply.isPending}>
                {apply.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {copy.form.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
