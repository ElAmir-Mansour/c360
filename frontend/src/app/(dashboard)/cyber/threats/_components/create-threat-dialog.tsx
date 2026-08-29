'use client';

import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FormField } from '@/components/shared/forms/form-field';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  emptyIndicator,
  INDICATOR_TYPE_OPTIONS,
  THREAT_TYPE_OPTIONS,
} from '@/lib/cyber-threats';
import type {
  CreateThreatInput,
  MITRETacticItem,
  MITRETechniqueItem,
  Threat,
} from '@/types/cyber';
import { useThreatLabels } from '../_lib/threats-i18n';

function buildThreatSchema(v: { nameRequired: string; indicatorValueRequired: string }) {
  return z.object({
  name: z.string().min(1, v.nameRequired).max(255),
  type: z.enum([
    'malware',
    'phishing',
    'apt',
    'ransomware',
    'ddos',
    'insider_threat',
    'supply_chain',
    'zero_day',
    'brute_force',
    'other',
  ]),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  description: z.string().optional(),
  threat_actor: z.string().optional(),
  campaign: z.string().optional(),
  mitre_tactic_ids: z.array(z.string()).default([]),
  mitre_technique_ids: z.array(z.string()).default([]),
  tags_input: z.string().optional(),
  indicators: z.array(z.object({
    type: z.enum([
      'ip',
      'domain',
      'url',
      'email',
      'file_hash_md5',
      'file_hash_sha1',
      'file_hash_sha256',
      'certificate',
      'registry_key',
      'user_agent',
      'cidr',
    ]),
    value: z.string().min(1, v.indicatorValueRequired),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    confidence: z.number().min(0).max(100),
    description: z.string().optional(),
  })).default([]),
  });
}

type ThreatFormValues = z.infer<ReturnType<typeof buildThreatSchema>>;

interface CreateThreatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threat?: Threat | null;
  onSuccess?: (threat: Threat) => void;
}

export function CreateThreatDialog({
  open,
  onOpenChange,
  threat,
  onSuccess,
}: CreateThreatDialogProps) {
  const t = useThreatLabels();
  const cd = t.createDialog;
  const severityLabels: Record<string, string> = {
    critical: cd.severityCritical,
    high: cd.severityHigh,
    medium: cd.severityMedium,
    low: cd.severityLow,
  };
  const isEditing = Boolean(threat);
  const threatSchema = useMemo(
    () => buildThreatSchema({ nameRequired: cd.nameRequired, indicatorValueRequired: cd.indicatorValueRequired }),
    [cd.nameRequired, cd.indicatorValueRequired],
  );
  const methods = useForm<ThreatFormValues>({
    resolver: zodResolver(threatSchema),
    defaultValues: {
      name: '',
      type: 'malware',
      severity: 'medium',
      description: '',
      threat_actor: '',
      campaign: '',
      mitre_tactic_ids: [],
      mitre_technique_ids: [],
      tags_input: '',
      indicators: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: methods.control,
    name: 'indicators',
  });

  const { data: tacticsEnvelope } = useQuery({
    queryKey: ['mitre-tactics'],
    queryFn: () => apiGet<{ data: MITRETacticItem[] }>(API_ENDPOINTS.CYBER_MITRE_TACTICS),
    staleTime: 300000,
  });

  const selectedTactics = methods.watch('mitre_tactic_ids');
  const techniquesQuery = useQuery({
    queryKey: ['mitre-techniques', selectedTactics],
    queryFn: () =>
      apiGet<{ data: MITRETechniqueItem[] }>(
        API_ENDPOINTS.CYBER_MITRE_TECHNIQUES,
        selectedTactics.length > 0 ? { tactic_id: selectedTactics } : undefined,
      ),
    enabled: open,
    staleTime: 300000,
  });

  const tacticOptions = useMemo(
    () => (tacticsEnvelope?.data ?? []).map((item) => ({ label: `${item.id} · ${item.name}`, value: item.id })),
    [tacticsEnvelope],
  );
  const techniqueOptions = useMemo(
    () => (techniquesQuery.data?.data ?? []).map((item) => ({ label: `${item.id} · ${item.name}`, value: item.id })),
    [techniquesQuery.data],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    methods.reset({
      name: threat?.name ?? '',
      type: threat?.type ?? 'malware',
      severity: threat?.severity ?? 'medium',
      description: threat?.description ?? '',
      threat_actor: threat?.threat_actor ?? '',
      campaign: threat?.campaign ?? '',
      mitre_tactic_ids: threat?.mitre_tactic_ids ?? [],
      mitre_technique_ids: threat?.mitre_technique_ids ?? [],
      tags_input: (threat?.tags ?? []).join(', '),
      indicators: [],
    });
  }, [methods, open, threat]);

  useEffect(() => {
    const allowed = new Set(techniqueOptions.map((option) => option.value));
    const next = methods.getValues('mitre_technique_ids').filter((id) => allowed.has(id));
    if (next.length !== methods.getValues('mitre_technique_ids').length) {
      methods.setValue('mitre_technique_ids', next);
    }
  }, [methods, techniqueOptions]);

  const createMutation = useApiMutation<Threat, CreateThreatInput>(
    'post',
    API_ENDPOINTS.CYBER_THREATS,
    {
      invalidateKeys: ['cyber-threats'],
      successMessage: cd.threatCreated,
      onSuccess: (response) => {
        methods.reset();
        onOpenChange(false);
        onSuccess?.(response);
      },
    },
  );

  const updateMutation = useApiMutation<Threat, CreateThreatInput>(
    'put',
    () => API_ENDPOINTS.CYBER_THREAT_DETAIL(threat!.id),
    {
      invalidateKeys: ['cyber-threats', threat ? `cyber-threat-${threat.id}` : 'cyber-threats'],
      successMessage: cd.threatUpdated,
      onSuccess: (response) => {
        onOpenChange(false);
        onSuccess?.(response);
      },
    },
  );

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const onSubmit = methods.handleSubmit((values) => {
    const payload: CreateThreatInput = {
      name: values.name.trim(),
      type: values.type,
      severity: values.severity,
      description: values.description?.trim() || undefined,
      threat_actor: values.threat_actor?.trim() || undefined,
      campaign: values.campaign?.trim() || undefined,
      mitre_tactic_ids: values.mitre_tactic_ids,
      mitre_technique_ids: values.mitre_technique_ids,
      tags: parseTags(values.tags_input),
      indicators: isEditing ? undefined : values.indicators.map((indicator) => ({
        ...indicator,
        value: indicator.value.trim(),
        description: indicator.description?.trim() || undefined,
        confidence: indicator.confidence / 100,
        source: 'manual',
      })),
    };

    if (isEditing) {
      updateMutation.mutate(payload);
      return;
    }
    createMutation.mutate(payload);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? cd.editTitle : cd.createTitle}</DialogTitle>
          <DialogDescription>
            {isEditing ? cd.editDescription : cd.createDescription}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="name" label={cd.name} required className="md:col-span-3">
                <Input id="name" placeholder={cd.namePlaceholder} {...methods.register('name')} />
              </FormField>
              <FormField name="type" label={cd.type} required>
                <Select
                  value={methods.watch('type')}
                  onValueChange={(value) => methods.setValue('type', value as ThreatFormValues['type'])}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THREAT_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="severity" label={cd.severity} required>
                <Select
                  value={methods.watch('severity')}
                  onValueChange={(value) => methods.setValue('severity', value as ThreatFormValues['severity'])}
                >
                  <SelectTrigger id="severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['critical', 'high', 'medium', 'low'].map((option) => (
                      <SelectItem key={option} value={option}>{severityLabels[option] ?? option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="tags_input" label={cd.tags}>
                <Input id="tags_input" placeholder={cd.tagsPlaceholder} {...methods.register('tags_input')} />
              </FormField>
            </div>

            <FormField name="description" label={cd.description}>
              <Textarea
                id="description"
                rows={4}
                placeholder={cd.descriptionPlaceholder}
                {...methods.register('description')}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="threat_actor" label={cd.threatActor}>
                <Input id="threat_actor" placeholder={cd.threatActorPlaceholder} {...methods.register('threat_actor')} />
              </FormField>
              <FormField name="campaign" label={cd.campaign}>
                <Input id="campaign" placeholder={cd.campaignPlaceholder} {...methods.register('campaign')} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="mitre_tactic_ids" label={cd.mitreTactics}>
                <MultiSelect
                  options={tacticOptions}
                  selected={methods.watch('mitre_tactic_ids')}
                  onChange={(values) => methods.setValue('mitre_tactic_ids', values, { shouldValidate: true })}
                  placeholder={cd.selectTactics}
                />
              </FormField>
              <FormField name="mitre_technique_ids" label={cd.mitreTechniques}>
                <MultiSelect
                  options={techniqueOptions}
                  selected={methods.watch('mitre_technique_ids')}
                  onChange={(values) => methods.setValue('mitre_technique_ids', values, { shouldValidate: true })}
                  placeholder={selectedTactics.length > 0 ? cd.selectTechniques : cd.selectTacticsFirst}
                  disabled={selectedTactics.length === 0}
                />
              </FormField>
            </div>

            {!isEditing && (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{cd.initialIndicators}</h3>
                    <p className="text-xs text-muted-foreground">
                      {cd.initialIndicatorsHint}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append(emptyIndicator())}
                  >
                    {cd.addIndicator}
                  </Button>
                </div>

                {fields.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    {cd.noIndicatorsYet}
                  </div>
                ) : (
                  <ScrollArea className="max-h-[280px] pe-3">
                    <div className="space-y-4">
                      {fields.map((field, index) => (
                        <div key={field.id} className="rounded-xl border bg-background p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-sm font-medium">{cd.indicatorN(index + 1)}</h4>
                            <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                              {cd.remove}
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <FormField name={`indicators.${index}.type`} label={cd.indType} required>
                              <Select
                                value={methods.watch(`indicators.${index}.type`)}
                                onValueChange={(value) => methods.setValue(`indicators.${index}.type`, value as ThreatFormValues['indicators'][number]['type'])}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {INDICATOR_TYPE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormField>
                            <FormField name={`indicators.${index}.severity`} label={cd.indSeverity} required>
                              <Select
                                value={methods.watch(`indicators.${index}.severity`)}
                                onValueChange={(value) => methods.setValue(`indicators.${index}.severity`, value as ThreatFormValues['indicators'][number]['severity'])}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {['critical', 'high', 'medium', 'low'].map((option) => (
                                    <SelectItem key={option} value={option}>{severityLabels[option] ?? option}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormField>
                            <FormField name={`indicators.${index}.value`} label={cd.indValue} required className="md:col-span-2">
                              <Input
                                placeholder={cd.indValuePlaceholder}
                                {...methods.register(`indicators.${index}.value`)}
                              />
                            </FormField>
                            <FormField name={`indicators.${index}.description`} label={cd.indDescription} className="md:col-span-2">
                              <Textarea
                                rows={2}
                                placeholder={cd.indDescriptionPlaceholder}
                                {...methods.register(`indicators.${index}.description`)}
                              />
                            </FormField>
                            <FormField name={`indicators.${index}.confidence`} label={cd.indConfidence}>
                              <div className="rounded-xl border px-3 py-3">
                                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{cd.analystConfidence}</span>
                                  <span>{Math.round(methods.watch(`indicators.${index}.confidence`) ?? 0)}%</span>
                                </div>
                                <Slider
                                  value={[methods.watch(`indicators.${index}.confidence`) ?? 0]}
                                  max={100}
                                  step={1}
                                  onValueChange={(value) => methods.setValue(`indicators.${index}.confidence`, value[0] ?? 0)}
                                />
                              </div>
                            </FormField>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {cd.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (isEditing ? cd.saving : cd.creating) : (isEditing ? cd.saveChanges : cd.createThreat)}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function parseTags(value?: string): string[] | undefined {
  const tags = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return tags.length > 0 ? Array.from(new Set(tags)) : undefined;
}
