'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Gavel, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button, type ButtonProps } from '@/components/ui/button';
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
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { legalHoldsApi, type LegalHoldSubjectType } from '@/lib/lex/legal-holds';

/**
 * In-context "Apply hold" action (FR-WATHEEQ-005). Places a legal hold on the
 * record the user is already looking at — the subject_type + subject_id are
 * fixed from props, so unlike the admin register dialog there is no record
 * picker: the operator only supplies the preservation reason (+ optional
 * reference / custodian / notes).
 *
 * Self-gates on `lex:write` — the same coarse tier the backend legal-hold apply
 * route and the admin register page use — so the component renders nothing for
 * users who cannot place a hold. Mounting it is therefore a one-liner in a
 * detail page's header/action area.
 *
 * Only backend-supported subject types are accepted (contract / matter /
 * document); a legal *case* (`/lex/cases`) is a distinct entity with no legal-
 * hold subject type today, so it is intentionally not offered here.
 */

interface ApplyHoldButtonProps {
  subjectType: Extract<LegalHoldSubjectType, 'contract' | 'matter' | 'document'>;
  subjectId: string;
  /** Optional identifier shown in the dialog description (e.g. contract title). */
  subjectLabel?: string;
  /** Trigger button styling (defaults to a compact outline button). */
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  /** Fired after a hold is successfully applied. */
  onApplied?: () => void;
}

interface ApplyHoldCopy {
  trigger: string;
  title: string;
  description: (subject: string) => string;
  reason: string;
  reasonPlaceholder: string;
  reference: string;
  referencePlaceholder: string;
  custodian: string;
  custodianPlaceholder: string;
  notes: string;
  submit: string;
  cancel: string;
  applied: string;
  reasonRequired: string;
  genericSubject: string;
}

const AR: ApplyHoldCopy = {
  trigger: 'فرض حجز قانوني',
  title: 'فرض حجز قانوني',
  description: (subject) =>
    `ضع حجزًا قانونيًا (حظر إتلاف) على ${subject} لمنع حذفه أو أرشفته أو تعديله أثناء التقاضي أو التحقيق التنظيمي.`,
  reason: 'سبب الحجز',
  reasonPlaceholder: 'مثال: دعوى قضائية رقم 1445/123 — يلزم حفظ الأدلة.',
  reference: 'المرجع',
  referencePlaceholder: 'رقم القضية أو المحكمة أو الجهة',
  custodian: 'الحافظ',
  custodianPlaceholder: 'الشخص المسؤول عن الحفظ',
  notes: 'ملاحظات',
  submit: 'فرض الحجز',
  cancel: 'إلغاء',
  applied: 'تم فرض الحجز القانوني.',
  reasonRequired: 'سبب الحجز مطلوب.',
  genericSubject: 'هذا السجل',
};

const EN: ApplyHoldCopy = {
  trigger: 'Apply hold',
  title: 'Apply legal hold',
  description: (subject) =>
    `Place a legal hold (destruction freeze) on ${subject} so it cannot be deleted, archived, or modified during litigation or a regulatory investigation.`,
  reason: 'Reason',
  reasonPlaceholder: 'e.g. Lawsuit 1445/123 — evidence must be preserved.',
  reference: 'Reference',
  referencePlaceholder: 'Case, court, or matter identifier',
  custodian: 'Custodian',
  custodianPlaceholder: 'Person responsible for preservation',
  notes: 'Notes',
  submit: 'Apply hold',
  cancel: 'Cancel',
  applied: 'Legal hold applied.',
  reasonRequired: 'A reason is required.',
  genericSubject: 'this record',
};

function buildSchema(copy: ApplyHoldCopy) {
  return z.object({
    reason: z.string().trim().min(1, copy.reasonRequired),
    reference: z.string().trim().optional(),
    custodian: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

const DEFAULTS: FormValues = { reason: '', reference: '', custodian: '', notes: '' };

export function ApplyHoldButton({
  subjectType,
  subjectId,
  subjectLabel,
  variant = 'outline',
  size,
  onApplied,
}: ApplyHoldButtonProps) {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const qc = useQueryClient();
  const copy = useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
  const schema = useMemo(() => buildSchema(copy), [copy]);
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (open) form.reset(DEFAULTS);
  }, [open, form]);

  const apply = useMutation({
    mutationFn: (v: FormValues) =>
      legalHoldsApi.apply({
        subject_type: subjectType,
        subject_id: subjectId,
        reason: v.reason,
        reference: v.reference || undefined,
        custodian: v.custodian || undefined,
        notes: v.notes || undefined,
      }),
    onSuccess: async () => {
      showSuccess(copy.applied);
      await qc.invalidateQueries({ queryKey: ['lex-admin-legal-holds'] });
      setOpen(false);
      onApplied?.();
    },
    onError: showApiError,
  });

  // Mirror the admin register page: the mutating hold action is gated on the
  // coarse `lex:write` tier the backend apply route enforces.
  if (!hasPermission('lex:write') || !subjectId) return null;

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Gavel className="me-1.5 h-3.5 w-3.5" />
        {copy.trigger}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description(subjectLabel?.trim() || copy.genericSubject)}
            </DialogDescription>
          </DialogHeader>
          <FormProvider {...form}>
            <form className="space-y-5" onSubmit={form.handleSubmit((v) => apply.mutate(v))}>
              <FormField name="reason" label={copy.reason} required>
                <Textarea
                  id="reason"
                  {...form.register('reason')}
                  placeholder={copy.reasonPlaceholder}
                  rows={3}
                />
              </FormField>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField name="reference" label={copy.reference}>
                  <Input
                    id="reference"
                    {...form.register('reference')}
                    placeholder={copy.referencePlaceholder}
                  />
                </FormField>
                <FormField name="custodian" label={copy.custodian}>
                  <Input
                    id="custodian"
                    {...form.register('custodian')}
                    placeholder={copy.custodianPlaceholder}
                  />
                </FormField>
              </div>

              <FormField name="notes" label={copy.notes}>
                <Textarea id="notes" {...form.register('notes')} rows={2} />
              </FormField>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {copy.cancel}
                </Button>
                <Button type="submit" disabled={apply.isPending}>
                  {apply.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                  {copy.submit}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>
    </>
  );
}
