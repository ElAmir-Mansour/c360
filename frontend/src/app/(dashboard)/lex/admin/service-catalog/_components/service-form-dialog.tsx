'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, FormProvider, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
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
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise/api';
import {
  ELIGIBILITY_RULE_TYPES,
  ORG_ROLE_KEYS,
  SERVICE_CHANNELS,
  lexAdminApi,
  type EligibilityRuleType,
  type OrgEntity,
  type ServiceCatalogEntry,
  type ServiceChannel,
} from '@/lib/lex/admin';
import type { LexApprovalPolicy } from '@/types/suites';
import {
  useAdminCommonLabels,
  useServiceCatalogLabels,
  type ServiceCatalogLabels,
} from '../../_lib/admin-labels';
import { buildRecordTimeline, readSnapshots, writeSnapshot } from '../../_lib/admin-feature-utils';

function buildSchema(errors: ServiceCatalogLabels['form']['errors']) {
  return z
    .object({
      code: z.string().trim().min(1, errors.codeRequired),
      request_type: z.string().trim().min(1, errors.requestTypeRequired),
      name_ar: z.string().trim(),
      name_en: z.string().trim(),
      description_ar: z.string().trim(),
      description_en: z.string().trim(),
      channel: z.enum(SERVICE_CHANNELS as unknown as [ServiceChannel, ...ServiceChannel[]]),
      intake_email: z.string().trim(),
      approval_policy_id: z.string().trim(),
      requester_approval_required: z.boolean(),
      provider_approval_required: z.boolean(),
      active: z.boolean(),
      available_to: z.string().trim(),
      eligibility_rules: z.array(
        z.object({
          rule_type: z.enum(
            ELIGIBILITY_RULE_TYPES as unknown as [EligibilityRuleType, ...EligibilityRuleType[]],
          ),
          value: z.string().trim(),
        }),
      ),
    })
    .refine((v) => v.name_ar.length > 0 || v.name_en.length > 0, {
      message: errors.nameRequired,
      path: ['name_en'],
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  service?: ServiceCatalogEntry | null;
  mode?: 'create' | 'edit' | 'clone';
  requestTypeOptions?: string[];
  orgEntities?: OrgEntity[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (service: ServiceCatalogEntry) => void;
}

function defaults(
  service?: ServiceCatalogEntry | null,
  mode: Props['mode'] = 'create',
  cloneSuffix = 'copy',
): FormValues {
  const isClone = mode === 'clone';
  return {
    code: isClone && service?.code ? `${service.code}_COPY` : service?.code ?? '',
    request_type: service?.request_type ?? '',
    name_ar: service?.name?.ar ?? '',
    name_en: isClone && service?.name?.en ? `${service.name.en} ${cloneSuffix}` : service?.name?.en ?? '',
    description_ar: service?.description?.ar ?? '',
    description_en: service?.description?.en ?? '',
    channel: service?.channel ?? 'platform',
    intake_email: service?.intake_email ?? '',
    approval_policy_id: service?.approval_policy_id ?? '',
    requester_approval_required: service?.requester_approval_required ?? false,
    provider_approval_required: service?.provider_approval_required ?? false,
    active: isClone ? false : service?.active ?? true,
    available_to: (service?.available_to ?? []).join(', '),
    eligibility_rules: (service?.eligibility_rules ?? []).map((r) => ({
      rule_type: r.rule_type,
      value: r.value,
    })),
  };
}

const NO_POLICY = '__none__';
const SERVICE_SNAPSHOT_NAMESPACE = 'lex-admin-service-catalog';

interface ServiceSnapshot {
  saved_at: string;
  label: string;
  record: ServiceCatalogEntry;
}

function approvalSummary(
  policy: LexApprovalPolicy,
  locale: AppLocale,
  format: ServiceCatalogLabels['detailView']['approverSummary'],
): string {
  const quorum = policy.quorum === 'n_of_m'
    ? locale === 'ar'
      ? `${policy.quorum_n ?? 1} من ${policy.approvers.length}`
      : `${policy.quorum_n ?? 1} of ${policy.approvers.length}`
    : policy.quorum.replace(/_/g, ' ');
  const mode = policy.mode.replace(/_/g, ' ');
  return format(mode, quorum, policy.approvers.length);
}

function formatTimelineDate(value: string | undefined, locale: AppLocale, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function isServiceSnapshot(value: unknown): value is ServiceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ServiceSnapshot>;
  return typeof snapshot.saved_at === 'string' && Boolean(snapshot.record?.id);
}

function makeServiceSnapshot(record: ServiceCatalogEntry, locale: AppLocale): ServiceSnapshot {
  return {
    saved_at: new Date().toISOString(),
    label: resolveLocalized(record.name, locale) || record.code,
    record,
  };
}

function readServiceSnapshots(id: string): ServiceSnapshot[] {
  return readSnapshots<ServiceSnapshot>(SERVICE_SNAPSHOT_NAMESPACE, id).filter(isServiceSnapshot);
}

export function ServiceFormDialog({
  service,
  mode,
  requestTypeOptions = [],
  orgEntities = [],
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const resolvedMode = mode ?? (service ? 'edit' : 'create');
  const isEdit = resolvedMode === 'edit' && Boolean(service);
  const qc = useQueryClient();
  const t = useServiceCatalogLabels();
  const common = useAdminCommonLabels();
  const { locale } = useLocaleOrDefault();
  const schema = useMemo(() => buildSchema(t.form.errors), [t.form.errors]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(service, resolvedMode, t.form.cloneSuffix),
  });
  const rules = useFieldArray({ control: form.control, name: 'eligibility_rules' });
  const [snapshots, setSnapshots] = useState<ServiceSnapshot[]>([]);

  useEffect(() => {
    if (open) form.reset(defaults(service, resolvedMode, t.form.cloneSuffix));
  }, [service, form, open, resolvedMode, t.form.cloneSuffix]);

  useEffect(() => {
    if (open && isEdit && service?.id) {
      setSnapshots(readServiceSnapshots(service.id));
    } else {
      setSnapshots([]);
    }
  }, [isEdit, open, service?.id]);

  const policiesQuery = useQuery({
    queryKey: ['lex-approval-policies', 'service-catalog-picker'],
    queryFn: () => enterpriseApi.lex.listApprovalPolicies(),
    enabled: open,
  });
  const activePolicies = useMemo(
    () => (policiesQuery.data ?? []).filter((policy) => policy.status === 'active'),
    [policiesQuery.data],
  );

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const availableTo = v.available_to
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        request_type: v.request_type,
        name: { ar: v.name_ar, en: v.name_en },
        description: { ar: v.description_ar, en: v.description_en },
        channel: v.channel,
        intake_email: v.intake_email || null,
        approval_policy_id: v.approval_policy_id || null,
        requester_approval_required: v.requester_approval_required,
        provider_approval_required: v.provider_approval_required,
        active: v.active,
        available_to: availableTo,
        eligibility_rules: v.eligibility_rules.map((r) => ({ rule_type: r.rule_type, value: r.value })),
      };
      return isEdit && service
        ? lexAdminApi.updateServiceCatalogEntry(service.id, payload)
        : lexAdminApi.createServiceCatalogEntry({ code: v.code, ...payload });
    },
    onSuccess: async (saved) => {
      if (isEdit && service) {
        writeSnapshot<ServiceSnapshot>(SERVICE_SNAPSHOT_NAMESPACE, service.id, makeServiceSnapshot(service, locale));
        setSnapshots(readServiceSnapshots(service.id));
      }
      showSuccess(isEdit ? common.toast.updated : common.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-admin-service-catalog'] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const channel = form.watch('channel');
  const selectedPolicyId = form.watch('approval_policy_id');
  const selectedPolicy = activePolicies.find((policy) => policy.id === selectedPolicyId);
  const timeline = useMemo(
    () => (isEdit && service ? buildRecordTimeline(service, common.timeline) : []),
    [isEdit, service, common.timeline],
  );
  const requestTypeDatalistId = useMemo(
    () => `service-request-type-options-${service?.id ?? resolvedMode}`,
    [resolvedMode, service?.id],
  );
  const orgValueOptions = useMemo(() => {
    const departments = orgEntities
      .filter((entity) => entity.entity_type === 'department' || entity.entity_type === 'section')
      .map((entity) => entity.code);
    const roles = ORG_ROLE_KEYS.map((role) => role);
    return {
      department: Array.from(new Set(departments)).sort(),
      role: roles,
      doa_matrix: roles,
      all: [],
    } satisfies Record<EligibilityRuleType, string[]>;
  }, [orgEntities]);

  const restoreSnapshot = (snapshot: ServiceSnapshot) => {
    form.reset(defaults(snapshot.record, 'edit', t.form.cloneSuffix));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t.form.editTitle : resolvedMode === 'clone' ? t.form.cloneTitle : t.form.createTitle}
          </DialogTitle>
          <DialogDescription>
            {resolvedMode === 'clone' ? t.form.cloneDescription : t.pageDescription}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="service" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="code" label={t.form.code} required>
                <Input id="code" {...form.register('code')} placeholder={t.form.codePlaceholder} disabled={isEdit} />
              </FormField>
              <FormField name="request_type" label={t.form.requestType} required>
                <Input
                  id="request_type"
                  list={requestTypeDatalistId}
                  {...form.register('request_type')}
                  placeholder={t.form.requestTypePlaceholder}
                />
                <datalist id={requestTypeDatalistId}>
                  {requestTypeOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </FormField>
              <FormField name="name_en" label={common.nameEn}>
                <Input id="name_en" {...form.register('name_en')} />
              </FormField>
              <FormField name="name_ar" label={common.nameAr}>
                <Input id="name_ar" dir="rtl" {...form.register('name_ar')} />
              </FormField>
              <FormField name="description_en" label={common.descriptionEn}>
                <Input id="description_en" {...form.register('description_en')} />
              </FormField>
              <FormField name="description_ar" label={common.descriptionAr}>
                <Input id="description_ar" dir="rtl" {...form.register('description_ar')} />
              </FormField>
              <FormField name="channel" label={t.form.channel} required>
                <Select
                  value={channel}
                  onValueChange={(v) =>
                    form.setValue('channel', v as ServiceChannel, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t.channels[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                name="intake_email"
                label={t.form.intakeEmail}
                description={t.form.intakeEmailDescription}
              >
                <Input
                  id="intake_email"
                  type="email"
                  {...form.register('intake_email')}
                  placeholder={t.form.intakeEmailPlaceholder}
                  disabled={channel === 'platform'}
                />
              </FormField>
              <FormField name="approval_policy_id" label={t.form.approvalPolicy}>
                <Select
                  value={selectedPolicyId || NO_POLICY}
                  onValueChange={(v) =>
                    form.setValue('approval_policy_id', v === NO_POLICY ? '' : v, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="approval_policy_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_POLICY}>{t.form.approvalPolicyNone}</SelectItem>
                    {activePolicies.map((policy) => (
                      <SelectItem key={policy.id} value={policy.id}>
                        {policy.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {selectedPolicy ? selectedPolicy.name : t.form.localApprovalPreview}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedPolicy
                      ? approvalSummary(selectedPolicy, locale, t.detailView.approverSummary)
                      : t.form.localApprovalDescription}
                  </p>
                </div>
              </div>
            </div>

            <FormField name="available_to" label={t.form.availableTo} description={t.form.availableToHint}>
              <Input id="available_to" {...form.register('available_to')} placeholder={t.form.availableToPlaceholder} />
            </FormField>

            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="requester_approval_required"
                  checked={form.watch('requester_approval_required')}
                  onCheckedChange={(c) => form.setValue('requester_approval_required', c)}
                />
                <Label htmlFor="requester_approval_required">{t.form.requesterApproval}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="provider_approval_required"
                  checked={form.watch('provider_approval_required')}
                  onCheckedChange={(c) => form.setValue('provider_approval_required', c)}
                />
                <Label htmlFor="provider_approval_required">{t.form.providerApproval}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="active"
                  checked={form.watch('active')}
                  onCheckedChange={(c) => form.setValue('active', c)}
                />
                <Label htmlFor="active">{t.form.active}</Label>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t.form.eligibilityTitle}</p>
                  <p className="text-xs text-muted-foreground">{t.form.eligibilityHint}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => rules.append({ rule_type: 'all', value: '' })}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.form.addRule}
                </Button>
              </div>
              {rules.fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <FormField name={`eligibility_rules.${index}.rule_type`} label={t.form.ruleType}>
                    <Select
                      value={form.watch(`eligibility_rules.${index}.rule_type`)}
                      onValueChange={(v) =>
                        form.setValue(
                          `eligibility_rules.${index}.rule_type`,
                          v as EligibilityRuleType,
                          { shouldValidate: true },
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ELIGIBILITY_RULE_TYPES.map((rt) => (
                          <SelectItem key={rt} value={rt}>
                            {t.ruleTypes[rt]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField name={`eligibility_rules.${index}.value`} label={t.form.ruleValue}>
                    <datalist id={`eligibility-value-options-${field.id}`}>
                      {orgValueOptions[form.watch(`eligibility_rules.${index}.rule_type`)].map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                    <Input
                      {...form.register(`eligibility_rules.${index}.value`)}
                      list={`eligibility-value-options-${field.id}`}
                      placeholder={t.form.ruleValuePlaceholder}
                      disabled={form.watch(`eligibility_rules.${index}.rule_type`) === 'all'}
                    />
                  </FormField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => rules.remove(index)}
                    aria-label={common.remove}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            {isEdit && service ? (
              <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{common.recordPanel.timeline}</p>
                  </div>
                  {timeline.length > 0 ? (
                    <div className="space-y-2">
                      {timeline.map((event) => (
                        <div key={event.id} className="rounded-md border bg-muted/20 px-3 py-2">
                          <p className="text-sm font-medium">{event.label}</p>
                          <p className="text-xs text-muted-foreground">{formatTimelineDate(event.at, locale, t.detailView.notSet)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{common.recordPanel.noServerTimestamps}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{common.recordPanel.localVersions}</p>
                  </div>
                  {snapshots.length > 0 ? (
                    <div className="space-y-2">
                      {snapshots.map((snapshot) => (
                        <div key={`${snapshot.saved_at}:${snapshot.record.id}`} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{snapshot.label}</p>
                            <p className="text-xs text-muted-foreground">{formatTimelineDate(snapshot.saved_at, locale, t.detailView.notSet)}</p>
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => restoreSnapshot(snapshot)}>
                            <RotateCcw className="me-1.5 h-3.5 w-3.5" />
                            {common.recordPanel.restore}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{common.recordPanel.noLocalVersions}</p>
                  )}
                </div>
              </div>
            ) : null}

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
