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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexAdminApi,
  SLA_ACK_UNITS,
  SLA_PRIORITIES,
  type SLAAckUnit,
  type ServiceCatalogEntry,
  type SLATarget,
  type SLATargetPriority,
} from '@/lib/lex/admin';
import { useAdminCommonLabels, useSLALabels, type SLALabels } from '../../_lib/admin-labels';

// Backend (sla_service.go: validateSLAAckWindow) hard-couples the acknowledgement
// window unit AND value bounds to the priority; and (validateSLAEscalationOffsets)
// hard-rejects any escalation offset that is not exactly +2/+4/+6 working days.
// The form must mirror these constraints so a valid-looking edit cannot 400.
const ACK_BOUNDS: Record<SLATargetPriority, { unit: SLAAckUnit; max: number }> = {
  // Emergency shares the urgent acknowledgement shape (working-hours, 0-4).
  emergency: { unit: 'working_hours', max: 4 },
  urgent: { unit: 'working_hours', max: 4 },
  normal: { unit: 'working_days', max: 1 },
};
const FIXED_ESCALATION = { l1: 2, l2: 4, l3: 6 } as const;

interface SLAFormCopy {
  ackNonNegative: string;
  ackUrgentRange: string;
  ackNormalRange: string;
  ackUnitAuto: string;
  ackUnitUrgent: string;
  ackUnitNormal: string;
  escalationFixed: string;
  turnaroundFromLabel: string;
  turnaroundFromHelp: string;
  turnaroundFromNonNegative: string;
  turnaroundFromRange: string;
}

function slaFormCopy(locale: string): SLAFormCopy {
  const ar = locale === 'ar';
  return {
    turnaroundFromLabel: ar ? 'الحد الأدنى للإنجاز (أيام عمل)' : 'Turnaround from (working days)',
    turnaroundFromHelp: ar
      ? 'الحد الأدنى للوعد؛ يُعرض الإنجاز كنطاق «من–إلى». اتركه مساويًا للإنجاز لرقم واحد.'
      : 'Earliest-promise lower bound; turnaround shows as a From–To window. Set equal to the turnaround for a single figure.',
    turnaroundFromNonNegative: ar
      ? 'يجب ألا يقل الحد الأدنى للإنجاز عن صفر.'
      : 'Turnaround from cannot be negative.',
    turnaroundFromRange: ar
      ? 'يجب ألا يتجاوز الحد الأدنى للإنجاز مدة الإنجاز.'
      : 'Turnaround from must not exceed the turnaround (upper bound).',
    ackNonNegative: ar
      ? 'يجب ألا تقل نافذة الإقرار عن صفر.'
      : 'Acknowledgement window cannot be negative.',
    ackUrgentRange: ar
      ? 'نافذة الإقرار العاجل بين 0 و4 ساعات عمل.'
      : 'Urgent acknowledgement window must be 0–4 working hours.',
    ackNormalRange: ar
      ? 'نافذة الإقرار العادي بين 0 و1 يوم عمل.'
      : 'Normal acknowledgement window must be 0–1 working day.',
    ackUnitAuto: ar
      ? 'تُحدَّد الوحدة تلقائيًا حسب الأولوية.'
      : 'Unit is set automatically by the selected priority.',
    ackUnitUrgent: ar
      ? 'يجب أن تستخدم الأولوية العاجلة ساعات العمل.'
      : 'Urgent priority must use working hours.',
    ackUnitNormal: ar
      ? 'يجب أن تستخدم الأولوية العادية أيام العمل.'
      : 'Normal priority must use working days.',
    escalationFixed: ar
      ? 'مستويات التصعيد ثابتة حسب السياسة (+2 / +4 / +6 أيام عمل بعد الإخلال).'
      : 'Escalation levels are fixed by policy (+2 / +4 / +6 working days after breach).',
  };
}

function buildSchema(errors: SLALabels['form']['errors'], copy: SLAFormCopy) {
  return z
    .object({
      service_code: z.string().trim().min(1, errors.serviceCodeRequired),
      priority: z.enum(SLA_PRIORITIES as unknown as [SLATargetPriority, ...SLATargetPriority[]]),
      turnaround_working_days: z.coerce.number().int().min(1, errors.turnaroundPositive),
      turnaround_working_days_from: z.coerce.number().int().min(0, copy.turnaroundFromNonNegative),
      ack_window_value: z.coerce.number().int().min(0, copy.ackNonNegative),
      ack_window_unit: z.enum(SLA_ACK_UNITS as unknown as [SLAAckUnit, ...SLAAckUnit[]]),
      escalation_l1_days: z.coerce.number().int().min(0),
      escalation_l2_days: z.coerce.number().int().min(0),
      escalation_l3_days: z.coerce.number().int().min(0),
      active: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.turnaround_working_days_from > v.turnaround_working_days) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['turnaround_working_days_from'],
          message: copy.turnaroundFromRange,
        });
      }
      const bounds = ACK_BOUNDS[v.priority];
      if (v.ack_window_unit !== bounds.unit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ack_window_unit'],
          message: v.priority === 'urgent' ? copy.ackUnitUrgent : copy.ackUnitNormal,
        });
      }
      if (v.ack_window_value > bounds.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ack_window_value'],
          message: v.priority === 'urgent' ? copy.ackUrgentRange : copy.ackNormalRange,
        });
      }
      if (
        v.escalation_l1_days !== FIXED_ESCALATION.l1 ||
        v.escalation_l2_days !== FIXED_ESCALATION.l2 ||
        v.escalation_l3_days !== FIXED_ESCALATION.l3
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['escalation_l1_days'],
          message: copy.escalationFixed,
        });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  target?: SLATarget | null;
  services?: ServiceCatalogEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (target: SLATarget) => void;
}

function defaults(target?: SLATarget | null): FormValues {
  return {
    service_code: target?.service_code ?? '',
    priority: target?.priority ?? 'normal',
    turnaround_working_days: target?.turnaround_working_days ?? 5,
    turnaround_working_days_from:
      target?.turnaround_working_days_from ?? target?.turnaround_working_days ?? 5,
    ack_window_value: target?.ack_window_value ?? 1,
    ack_window_unit: target?.ack_window_unit ?? 'working_days',
    // Escalation offsets are fixed by policy (+2/+4/+6); the fields are read-only.
    escalation_l1_days: FIXED_ESCALATION.l1,
    escalation_l2_days: FIXED_ESCALATION.l2,
    escalation_l3_days: FIXED_ESCALATION.l3,
    active: target?.active ?? true,
  };
}

export function SLATargetFormDialog({ target, services = [], open, onOpenChange, onSaved }: Props) {
  const isEdit = Boolean(target);
  const qc = useQueryClient();
  const t = useSLALabels();
  const common = useAdminCommonLabels();
  const { locale } = useLocaleOrDefault();
  const copy = useMemo(() => slaFormCopy(locale), [locale]);
  const schema = useMemo(() => buildSchema(t.form.errors, copy), [t.form.errors, copy]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(target) });

  useEffect(() => {
    if (open) form.reset(defaults(target));
  }, [target, form, open]);

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      isEdit && target
        ? lexAdminApi.updateSLATarget(target.id, {
            turnaround_working_days: v.turnaround_working_days,
            turnaround_working_days_from: v.turnaround_working_days_from,
            ack_window_value: v.ack_window_value,
            ack_window_unit: v.ack_window_unit,
            escalation_l1_days: v.escalation_l1_days,
            escalation_l2_days: v.escalation_l2_days,
            escalation_l3_days: v.escalation_l3_days,
            active: v.active,
          })
        : lexAdminApi.createSLATarget(v),
    onSuccess: async (saved) => {
      showSuccess(isEdit ? common.toast.updated : common.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-admin-sla-targets'] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const priority = form.watch('priority');
  // Clamp the From input's max to the current turnaround (upper bound) so the
  // native control mirrors the from <= to invariant the schema enforces.
  const turnaround = Number(form.watch('turnaround_working_days')) || undefined;
  const ackUnit = form.watch('ack_window_unit');
  const active = form.watch('active');
  const serviceCode = form.watch('service_code');
  const ackBounds = ACK_BOUNDS[priority];

  // The acknowledgement-window unit is dictated by priority (backend rejects any
  // other pairing). Keep the unit in sync and clamp the value to the allowed max
  // whenever the priority changes.
  useEffect(() => {
    const bounds = ACK_BOUNDS[priority];
    if (form.getValues('ack_window_unit') !== bounds.unit) {
      form.setValue('ack_window_unit', bounds.unit, { shouldValidate: true });
    }
    const raw = form.getValues('ack_window_value');
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(numeric) && numeric > bounds.max) {
      form.setValue('ack_window_value', bounds.max, { shouldValidate: true });
    }
  }, [priority, form]);
  const activeServices = useMemo(
    () => services.filter((service) => service.active).sort((a, b) => a.code.localeCompare(b.code)),
    [services],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? t.form.identityLocked : t.pageDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="policy" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="service_code" label={t.form.serviceCode} required>
                {activeServices.length > 0 && !isEdit ? (
                  <Select
                    value={serviceCode}
                    onValueChange={(v) => form.setValue('service_code', v, { shouldValidate: true })}
                  >
                    <SelectTrigger id="service_code">
                      <SelectValue placeholder={t.form.serviceCodePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {activeServices.map((service) => (
                        <SelectItem key={service.id} value={service.code}>
                          {service.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="service_code"
                    {...form.register('service_code')}
                    placeholder={t.form.serviceCodePlaceholder}
                    disabled={isEdit}
                  />
                )}
              </FormField>
              <FormField name="priority" label={t.form.priority} required>
                <Select
                  value={priority}
                  onValueChange={(v) =>
                    form.setValue('priority', v as SLATargetPriority, { shouldValidate: true })
                  }
                  disabled={isEdit}
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SLA_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t.priorities[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="turnaround_working_days" label={t.form.turnaround} required>
                <Input
                  id="turnaround_working_days"
                  type="number"
                  min={1}
                  {...form.register('turnaround_working_days')}
                />
              </FormField>
              <FormField
                name="turnaround_working_days_from"
                label={copy.turnaroundFromLabel}
                required
                description={copy.turnaroundFromHelp}
              >
                <Input
                  id="turnaround_working_days_from"
                  type="number"
                  min={0}
                  max={turnaround}
                  {...form.register('turnaround_working_days_from')}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  name="ack_window_value"
                  label={t.form.ackValue}
                  required
                  description={priority === 'urgent' ? copy.ackUrgentRange : copy.ackNormalRange}
                >
                  <Input
                    id="ack_window_value"
                    type="number"
                    min={0}
                    max={ackBounds.max}
                    {...form.register('ack_window_value')}
                  />
                </FormField>
                <FormField
                  name="ack_window_unit"
                  label={t.form.ackUnit}
                  required
                  description={copy.ackUnitAuto}
                >
                  <Select
                    value={ackUnit}
                    onValueChange={(v) =>
                      form.setValue('ack_window_unit', v as SLAAckUnit, { shouldValidate: true })
                    }
                    disabled
                  >
                    <SelectTrigger id="ack_window_unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SLA_ACK_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {t.ackUnits[u]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
              <FormField
                name="escalation_l1_days"
                label={t.form.escalationL1}
                description={copy.escalationFixed}
              >
                <Input
                  id="escalation_l1_days"
                  type="number"
                  min={0}
                  readOnly
                  tabIndex={-1}
                  className="bg-muted/40 text-muted-foreground"
                  {...form.register('escalation_l1_days')}
                />
              </FormField>
              <FormField name="escalation_l2_days" label={t.form.escalationL2}>
                <Input
                  id="escalation_l2_days"
                  type="number"
                  min={0}
                  readOnly
                  tabIndex={-1}
                  className="bg-muted/40 text-muted-foreground"
                  {...form.register('escalation_l2_days')}
                />
              </FormField>
              <FormField name="escalation_l3_days" label={t.form.escalationL3}>
                <Input
                  id="escalation_l3_days"
                  type="number"
                  min={0}
                  readOnly
                  tabIndex={-1}
                  className="bg-muted/40 text-muted-foreground"
                  {...form.register('escalation_l3_days')}
                />
              </FormField>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="active"
                checked={active}
                onCheckedChange={(c) => form.setValue('active', c, { shouldValidate: true })}
              />
              <Label htmlFor="active">{t.form.active}</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {common.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? common.save : common.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
