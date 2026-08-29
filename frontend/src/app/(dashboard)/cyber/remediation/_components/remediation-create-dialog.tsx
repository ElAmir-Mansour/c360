'use client';

import { useMemo } from 'react';
import { useForm, FormProvider, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AsyncRecordPicker, type RecordPickerOption } from '@/components/shared/forms/async-record-picker';
import { FormField } from '@/components/shared/forms/form-field';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Plus, Trash2 } from 'lucide-react';
import type { PaginatedResponse } from '@/types/api';
import type { CyberAlert, RemediationAction, Vulnerability } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

const PICKER_PAGE_SIZE = 25;

async function loadAlertOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<CyberAlert>>(API_ENDPOINTS.CYBER_ALERTS, {
    page: 1, per_page: PICKER_PAGE_SIZE, search: search || undefined, sort: 'created_at', order: 'desc',
  });
  return response.data.map((alert) => ({
    value: alert.id,
    label: alert.title,
    description: [alert.severity, alert.source, alert.status].filter(Boolean).join(' • '),
    keywords: [alert.source, alert.severity, alert.status, alert.rule_name ?? ''],
  }));
}

async function loadVulnerabilityOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<Vulnerability>>('/api/v1/cyber/vulnerabilities', {
    page: 1, per_page: PICKER_PAGE_SIZE, search: search || undefined, sort: 'detected_at', order: 'desc',
  });
  return response.data.map((vulnerability) => ({
    value: vulnerability.id,
    label: vulnerability.cve_id ? `${vulnerability.cve_id} — ${vulnerability.title}` : vulnerability.title,
    description: [vulnerability.severity, vulnerability.asset_name ?? vulnerability.source, vulnerability.status]
      .filter(Boolean).join(' • '),
    keywords: [vulnerability.cve_id ?? '', vulnerability.asset_name ?? '', vulnerability.source, vulnerability.status],
  }));
}

function buildSchema(v: {
  titleMin: string;
  descriptionMin: string;
  actionRequired: string;
  stepRequired: string;
}) {
  const stepSchema = z.object({
    number: z.number(),
    action: z.string().min(1, v.actionRequired),
    description: z.string().optional(),
    target: z.string().optional(),
  });
  return z.object({
    title: z.string().min(3, v.titleMin),
    description: z.string().min(10, v.descriptionMin),
    type: z.enum(['patch', 'config_change', 'block_ip', 'isolate_asset', 'firewall_rule', 'access_revoke', 'certificate_renew', 'custom']),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    execution_mode: z.enum(['automated', 'manual', 'semi_automated']),
    requires_approval_from: z.enum(['security_manager', 'ciso', 'tenant_admin']).default('security_manager'),
    steps: z.array(stepSchema).min(1, v.stepRequired),
    alert_id: z.string().optional().or(z.literal('')),
    vulnerability_id: z.string().optional().or(z.literal('')),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface RemediationCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (action: RemediationAction) => void;
  defaultAlertId?: string;
  defaultVulnId?: string;
}

export function RemediationCreateDialog({
  open,
  onOpenChange,
  onSuccess,
  defaultAlertId,
  defaultVulnId,
}: RemediationCreateDialogProps) {
  const t = useRemediationLabels();
  const schema = useMemo(
    () => buildSchema({
      titleMin: t.create.titleMin,
      descriptionMin: t.create.descriptionMin,
      actionRequired: t.create.actionRequired,
      stepRequired: t.create.stepRequired,
    }),
    [t.create.titleMin, t.create.descriptionMin, t.create.actionRequired, t.create.stepRequired],
  );
  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'patch',
      severity: 'medium',
      execution_mode: 'manual' as const,
      requires_approval_from: 'security_manager' as const,
      alert_id: defaultAlertId ?? '',
      vulnerability_id: defaultVulnId ?? '',
      steps: [{ number: 1, action: '', description: '', target: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: methods.control, name: 'steps' });

  const { mutate, isPending } = useApiMutation<RemediationAction, FormValues>(
    'post',
    API_ENDPOINTS.CYBER_REMEDIATION,
    {
      successMessage: t.create.createdToast,
      invalidateKeys: ['cyber-remediation', 'cyber-remediation-stats'],
      onSuccess: (action) => {
        methods.reset();
        onOpenChange(false);
        onSuccess?.(action);
      },
    },
  );

  const onSubmit = methods.handleSubmit((data) => {
    const { steps, ...rest } = data;
    const payload = {
      ...rest,
      alert_id: data.alert_id || undefined,
      vulnerability_id: data.vulnerability_id || undefined,
      affected_asset_ids: [],
      plan: {
        steps: steps.map((s, i) => ({ ...s, number: i + 1 })),
        reversible: data.execution_mode !== 'automated',
        risk_level: data.severity,
      },
    };
    mutate(payload as unknown as FormValues);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.create.title}</DialogTitle>
          <DialogDescription>{t.create.description}</DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className="space-y-5">
            <FormField name="title" label={t.create.titleField} required>
              <Input placeholder={t.create.titlePlaceholder} {...methods.register('title')} />
            </FormField>

            <FormField name="description" label={t.create.descriptionField} required>
              <Textarea rows={2} placeholder={t.create.descriptionPlaceholder} {...methods.register('description')} />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="type" label={t.create.type} required>
                <Select value={methods.watch('type')} onValueChange={(v) => methods.setValue('type', v as FormValues['type'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['patch', 'config_change', 'block_ip', 'isolate_asset', 'firewall_rule', 'access_revoke', 'certificate_renew', 'custom'].map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="severity" label={t.create.severity} required>
                <Select value={methods.watch('severity')} onValueChange={(v) => methods.setValue('severity', v as FormValues['severity'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['critical', 'high', 'medium', 'low'].map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="execution_mode" label={t.create.executionMode} required>
                <Select value={methods.watch('execution_mode')} onValueChange={(v) => methods.setValue('execution_mode', v as FormValues['execution_mode'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{t.create.manual}</SelectItem>
                    <SelectItem value="semi_automated">{t.create.semiAutomated}</SelectItem>
                    <SelectItem value="automated">{t.create.automated}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField name="requires_approval_from" label={t.create.requiresApprovalFrom}>
              <Select
                value={methods.watch('requires_approval_from')}
                onValueChange={(v) => methods.setValue('requires_approval_from', v as FormValues['requires_approval_from'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="security_manager">{t.create.securityManager}</SelectItem>
                  <SelectItem value="ciso">{t.create.ciso}</SelectItem>
                  <SelectItem value="tenant_admin">{t.create.tenantAdmin}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField name="alert_id" label={t.create.linkedAlertId}>
                <AsyncRecordPicker
                  ariaLabel={t.create.linkedAlertId}
                  queryKey={['cyber-remediation-alert-picker']}
                  loadOptions={loadAlertOptions}
                  value={methods.watch('alert_id') ?? ''}
                  onChange={(value) => methods.setValue('alert_id', value, { shouldDirty: true, shouldValidate: true })}
                  allowClear
                  labels={{ select: t.create.linkedAlertPlaceholder }}
                />
              </FormField>
              <FormField name="vulnerability_id" label={t.create.linkedVulnId}>
                <AsyncRecordPicker
                  ariaLabel={t.create.linkedVulnId}
                  queryKey={['cyber-remediation-vulnerability-picker']}
                  loadOptions={loadVulnerabilityOptions}
                  value={methods.watch('vulnerability_id') ?? ''}
                  onChange={(value) => methods.setValue('vulnerability_id', value, { shouldDirty: true, shouldValidate: true })}
                  allowClear
                  labels={{ select: t.create.linkedVulnPlaceholder }}
                />
              </FormField>
            </div>

            {/* Steps */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">{t.create.remediationSteps}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ number: fields.length + 1, action: '', description: '', target: '' })}
                >
                  <Plus className="me-1 h-3.5 w-3.5" /> {t.create.addStep}
                </Button>
              </div>
              <div className="space-y-3">
                {fields.map((field, idx) => (
                  <div key={field.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">{t.create.stepLabel(idx + 1)}</span>
                      {fields.length > 1 && (
                        <button type="button" aria-label={t.create.removeStep(idx + 1)} onClick={() => remove(idx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Input
                        placeholder={t.create.stepActionPlaceholder}
                        {...methods.register(`steps.${idx}.action`)}
                      />
                      <Input
                        placeholder={t.create.stepTargetPlaceholder}
                        {...methods.register(`steps.${idx}.target`)}
                      />
                      <Input
                        placeholder={t.create.stepDescriptionPlaceholder}
                        {...methods.register(`steps.${idx}.description`)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t.create.cancel}</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t.create.creating : t.create.createAction}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
