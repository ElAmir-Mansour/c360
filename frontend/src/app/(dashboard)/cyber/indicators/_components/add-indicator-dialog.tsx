'use client';

import { useEffect, useMemo } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
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
import { FormField } from '@/components/shared/forms/form-field';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { INDICATOR_SOURCE_OPTIONS, parseTagsInput, validateIndicatorValue } from '@/lib/cyber-indicators';
import { API_ENDPOINTS } from '@/lib/constants';
import { INDICATOR_TYPE_OPTIONS } from '@/lib/cyber-threats';
import type { PaginatedResponse } from '@/types/api';
import type {
  StandaloneIndicatorInput,
  Threat,
  ThreatIndicator,
} from '@/types/cyber';

import { useIndicatorLabels } from '../_lib/indicators-i18n';

const indicatorSchema = z.object({
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
  value: z.string().min(1, 'Value is required'),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  source: z.enum(['manual', 'stix_feed', 'osint', 'internal', 'vendor']),
  confidence: z.number().min(0).max(100),
  description: z.string().optional(),
  threat_id: z.string().optional(),
  expires_at: z.string().optional(),
  tags_input: z.string().optional(),
}).superRefine((value, ctx) => {
  const error = validateIndicatorValue(value.type, value.value);
  if (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: error,
    });
  }
});

type IndicatorFormValues = z.infer<typeof indicatorSchema>;

interface AddIndicatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indicator?: ThreatIndicator | null;
  onSuccess?: (indicator: ThreatIndicator) => void;
}

export function AddIndicatorDialog({
  open,
  onOpenChange,
  indicator,
  onSuccess,
}: AddIndicatorDialogProps) {
  const t = useIndicatorLabels();
  const isEditing = Boolean(indicator);
  const localizedSchema = useMemo(
    () =>
      z
        .object({
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
          value: z.string().min(1, t.editor.valueRequired),
          severity: z.enum(['critical', 'high', 'medium', 'low']),
          source: z.enum(['manual', 'stix_feed', 'osint', 'internal', 'vendor']),
          confidence: z.number().min(0).max(100),
          description: z.string().optional(),
          threat_id: z.string().optional(),
          expires_at: z.string().optional(),
          tags_input: z.string().optional(),
        })
        .superRefine((value, ctx) => {
          const error = validateIndicatorValue(value.type, value.value);
          if (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['value'],
              message: error,
            });
          }
        }),
    [t.editor.valueRequired],
  );
  const methods = useForm<IndicatorFormValues>({
    resolver: zodResolver(localizedSchema),
    defaultValues: {
      type: 'ip',
      value: '',
      severity: 'medium',
      source: 'manual',
      confidence: 80,
      description: '',
      threat_id: '',
      expires_at: '',
      tags_input: '',
    },
  });

  const threatsQuery = useQuery({
    queryKey: ['indicator-threat-options'],
    queryFn: () => apiGet<PaginatedResponse<Threat>>(API_ENDPOINTS.CYBER_THREATS, {
      page: 1,
      per_page: 100,
      sort: 'name',
      order: 'asc',
    }),
    enabled: open,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    methods.reset({
      type: indicator?.type ?? 'ip',
      value: indicator?.value ?? '',
      severity: indicator?.severity ?? 'medium',
      source: (indicator?.source as IndicatorFormValues['source']) ?? 'manual',
      confidence: Math.round((indicator?.confidence ?? 0.8) * 100),
      description: indicator?.description ?? '',
      threat_id: indicator?.threat_id ?? '',
      expires_at: indicator?.expires_at ? indicator.expires_at.slice(0, 10) : '',
      tags_input: (indicator?.tags ?? []).join(', '),
    });
  }, [indicator, methods, open]);

  const createMutation = useApiMutation<ThreatIndicator, StandaloneIndicatorInput>(
    'post',
    API_ENDPOINTS.CYBER_INDICATORS,
    {
      invalidateKeys: ['cyber-indicators', 'cyber-indicator-stats', 'cyber-indicator-detail'],
      successMessage: t.editor.created,
      onSuccess: (response) => {
        onOpenChange(false);
        onSuccess?.(response);
      },
    },
  );

  const updateMutation = useApiMutation<ThreatIndicator, StandaloneIndicatorInput>(
    'put',
    () => API_ENDPOINTS.CYBER_INDICATOR_DETAIL(indicator!.id),
    {
      invalidateKeys: ['cyber-indicators', 'cyber-indicator-stats', 'cyber-indicator-detail', 'cyber-indicator-enrichment', 'cyber-indicator-matches'],
      successMessage: t.editor.updated,
      onSuccess: (response) => {
        onOpenChange(false);
        onSuccess?.(response);
      },
    },
  );

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const threatOptions = useMemo(
    () => threatsQuery.data?.data ?? [],
    [threatsQuery.data?.data],
  );

  const handleSubmit = methods.handleSubmit((values) => {
    const payload: StandaloneIndicatorInput = {
      type: values.type,
      value: values.value.trim(),
      severity: values.severity,
      source: values.source,
      confidence: values.confidence / 100,
      description: values.description?.trim() || undefined,
      threat_id: values.threat_id || undefined,
      expires_at: values.expires_at
        ? new Date(`${values.expires_at}T00:00:00.000Z`).toISOString()
        : undefined,
      tags: parseTagsInput(values.tags_input ?? ''),
    };

    if (isEditing) {
      updateMutation.mutate(payload);
      return;
    }
    createMutation.mutate(payload);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t.editor.editTitle : t.editor.addTitle}</DialogTitle>
          <DialogDescription>
            {t.editor.description}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="type" label={t.editor.typeLabel} required>
                <Select
                  value={methods.watch('type')}
                  onValueChange={(value) => methods.setValue('type', value as IndicatorFormValues['type'])}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICATOR_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="severity" label={t.editor.severityLabel} required>
                <Select
                  value={methods.watch('severity')}
                  onValueChange={(value) => methods.setValue('severity', value as IndicatorFormValues['severity'])}
                >
                  <SelectTrigger id="severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">{t.editor.critical}</SelectItem>
                    <SelectItem value="high">{t.editor.high}</SelectItem>
                    <SelectItem value="medium">{t.editor.medium}</SelectItem>
                    <SelectItem value="low">{t.editor.low}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="value" label={t.editor.valueLabel} required className="md:col-span-2">
                <Input
                  id="value"
                  placeholder={t.editor.valuePlaceholder}
                  {...methods.register('value')}
                />
              </FormField>

              <FormField name="source" label={t.editor.sourceLabel} required>
                <Select
                  value={methods.watch('source')}
                  onValueChange={(value) => {
                    methods.setValue('source', value as IndicatorFormValues['source']);
                    if (!indicator && value === 'manual' && methods.getValues('confidence') === 0) {
                      methods.setValue('confidence', 80);
                    }
                  }}
                >
                  <SelectTrigger id="source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICATOR_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="threat_id" label={t.editor.linkedThreatLabel}>
                <Select
                  value={methods.watch('threat_id') || '__none__'}
                  onValueChange={(value) => methods.setValue('threat_id', value === '__none__' ? '' : value)}
                >
                  <SelectTrigger id="threat_id">
                    <SelectValue placeholder={t.editor.optionalThreatLink} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t.editor.noLinkedThreat}</SelectItem>
                    {threatOptions.map((threat) => (
                      <SelectItem key={threat.id} value={threat.id}>
                        {threat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField
                name="confidence"
                label={t.editor.confidenceLabel(methods.watch('confidence'))}
                description={t.editor.confidenceHelp}
                className="md:col-span-2"
              >
                <Slider
                  value={[methods.watch('confidence')]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => methods.setValue('confidence', value[0] ?? 0)}
                />
              </FormField>

              <FormField name="expires_at" label={t.editor.expiresAtLabel}>
                <Input id="expires_at" type="date" {...methods.register('expires_at')} />
              </FormField>

              <FormField name="tags_input" label={t.editor.tagsLabel}>
                <Input id="tags_input" placeholder={t.editor.tagsPlaceholder} {...methods.register('tags_input')} />
              </FormField>

              <FormField name="description" label={t.editor.descriptionLabel} className="md:col-span-2">
                <Textarea
                  id="description"
                  rows={4}
                  placeholder={t.editor.descriptionPlaceholder}
                  {...methods.register('description')}
                />
              </FormField>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.editor.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t.editor.saving : isEditing ? t.editor.saveChanges : t.editor.createIndicator}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
