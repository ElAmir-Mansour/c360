'use client';

import { useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { useUpdateWebhook } from '@/hooks/use-webhooks';
import { useT } from '@/components/providers/locale-provider';
import { Plus, Trash2 } from 'lucide-react';
import type { NotificationWebhook } from '@/types/models';

const EVENT_GROUPS: { labelKey: string; events: string[] }[] = [
  {
    labelKey: 'cw.grpCyber',
    events: [
      'cyber.alert.created',
      'cyber.alert.resolved',
      'cyber.threat.detected',
      'cyber.vulnerability.found',
      'cyber.asset.compromised',
    ],
  },
  {
    labelKey: 'cw.grpData',
    events: [
      'data.pipeline.started',
      'data.pipeline.completed',
      'data.pipeline.failed',
      'data.quality.issue',
      'data.source.connected',
    ],
  },
  {
    labelKey: 'cw.grpActa',
    events: [
      'acta.meeting.scheduled',
      'acta.action.assigned',
      'acta.action.overdue',
      'acta.minutes.published',
    ],
  },
  {
    labelKey: 'cw.grpLex',
    events: [
      'lex.contract.expiring',
      'lex.compliance.violation',
      'lex.document.reviewed',
    ],
  },
  {
    labelKey: 'cw.grpWorkflow',
    events: [
      'workflow.task.assigned',
      'workflow.task.completed',
      'workflow.instance.failed',
      'workflow.approval.requested',
    ],
  },
  {
    labelKey: 'cw.grpSystem',
    events: [
      'system.maintenance',
      'system.announcement',
      'system.user.created',
      'system.user.suspended',
    ],
  },
];

type SettingsFormData = {
  name: string;
  url: string;
  headers: { key: string; value: string }[];
  events: string[];
  max_retries: number;
  backoff_type: 'linear' | 'exponential';
  initial_delay_seconds: number;
};

interface WebhookSettingsFormProps {
  webhook: NotificationWebhook;
  onSaved: () => void;
}

export function WebhookSettingsForm({ webhook, onSaved }: WebhookSettingsFormProps) {
  const t = useT('admin');
  const updateMutation = useUpdateWebhook(webhook.id);

  const settingsSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t('wsf.errNameRequired')).max(100),
        url: z.string().url(t('wsf.errUrl')),
        headers: z.array(
          z.object({
            key: z.string().min(1, t('wsf.errRequired')),
            value: z.string().min(1, t('wsf.errRequired')),
          }),
        ),
        events: z.array(z.string()).min(1, t('wsf.errSelectEvent')),
        max_retries: z.number().min(0).max(10),
        backoff_type: z.enum(['linear', 'exponential']),
        initial_delay_seconds: z.number().min(1).max(300),
      }),
    [t],
  );

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: webhook.name,
      url: webhook.url,
      headers: Object.entries(webhook.headers).map(([key, value]) => ({ key, value })),
      events: webhook.events,
      max_retries: webhook.retry_policy.max_retries,
      backoff_type: webhook.retry_policy.backoff_type,
      initial_delay_seconds: webhook.retry_policy.initial_delay_seconds,
    },
  });

  const { fields: headerFields, append: appendHeader, remove: removeHeader } = useFieldArray({
    control: form.control,
    name: 'headers',
  });

  const onSubmit = async (data: SettingsFormData) => {
    const headers: Record<string, string> = {};
    for (const h of data.headers) {
      headers[h.key] = h.value;
    }

    await updateMutation.mutateAsync({
      name: data.name,
      url: data.url,
      events: data.events,
      headers,
      retry_policy: {
        max_retries: data.max_retries,
        backoff_type: data.backoff_type,
        initial_delay_seconds: data.initial_delay_seconds,
      },
    });
    form.reset(data);
    onSaved();
  };

  const events = form.watch('events');
  const toggleEvent = (event: string) => {
    const current = form.getValues('events');
    if (current.includes(event)) {
      form.setValue('events', current.filter((e) => e !== event), { shouldDirty: true, shouldValidate: true });
    } else {
      form.setValue('events', [...current, event], { shouldDirty: true, shouldValidate: true });
    }
  };

  const toggleGroup = (groupEvents: string[]) => {
    const current = form.getValues('events');
    const allSelected = groupEvents.every((e) => current.includes(e));
    if (allSelected) {
      form.setValue('events', current.filter((e) => !groupEvents.includes(e)), { shouldDirty: true, shouldValidate: true });
    } else {
      const merged = Array.from(new Set([...current, ...groupEvents]));
      form.setValue('events', merged, { shouldDirty: true, shouldValidate: true });
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('wsf.basicInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">{t('wsf.name')}</Label>
            <Input id="edit-name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-url">URL</Label>
            <Input id="edit-url" {...form.register('url')} />
            {form.formState.errors.url && (
              <p className="text-xs text-destructive">{form.formState.errors.url.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('wsf.customHeaders')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => appendHeader({ key: '', value: '' })}
              >
                <Plus className="me-1 h-3 w-3" /> {t('wsf.add')}
              </Button>
            </div>
            {headerFields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <Input
                  placeholder={t('wsf.headerName')}
                  {...form.register(`headers.${index}.key`)}
                  className="flex-1"
                />
                <Input
                  placeholder={t('wsf.value')}
                  {...form.register(`headers.${index}.value`)}
                  className="flex-1"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeHeader(index)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('wsf.events')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-h-[400px] overflow-y-auto">
          {EVENT_GROUPS.map(({ labelKey, events: groupEvents }) => {
            const groupLabel = t(labelKey);
            const allSelected = groupEvents.every((e) => events.includes(e));
            const someSelected = groupEvents.some((e) => events.includes(e));
            return (
              <div key={labelKey} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => toggleGroup(groupEvents)}
                    aria-label={t('cw.selectAllGroup', { group: groupLabel })}
                  />
                  <span className="text-sm font-medium">{groupLabel}</span>
                  {someSelected && !allSelected && (
                    <Badge variant="secondary" className="text-xs">{t('wsf.partial')}</Badge>
                  )}
                </div>
                <div className="ms-6 grid grid-cols-1 gap-1.5">
                  {groupEvents.map((event) => (
                    <label key={event} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={events.includes(event)}
                        onCheckedChange={() => toggleEvent(event)}
                      />
                      {event}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {form.formState.errors.events && (
            <p className="text-xs text-destructive">{form.formState.errors.events.message}</p>
          )}
        </CardContent>
      </Card>

      {/* Retry Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('wsf.retryPolicy')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>{t('wsf.maxRetries', { n: form.watch('max_retries') })}</Label>
            <Slider
              value={[form.watch('max_retries')]}
              onValueChange={([v]) => form.setValue('max_retries', v, { shouldDirty: true })}
              min={0}
              max={10}
              step={1}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wsf.backoffType')}</Label>
            <div className="flex gap-3">
              {(['linear', 'exponential'] as const).map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.watch('backoff_type') === type}
                    onChange={() => form.setValue('backoff_type', type, { shouldDirty: true })}
                    className="h-4 w-4"
                  />
                  {type === 'linear' ? t('cw.linear') : t('cw.exponential')}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-delay">{t('wsf.initialDelay')}</Label>
            <Input
              id="edit-delay"
              type="number"
              min={1}
              max={300}
              {...form.register('initial_delay_seconds', { valueAsNumber: true })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!form.formState.isDirty || updateMutation.isPending}
        >
          {updateMutation.isPending ? t('wsf.saving') : t('wsf.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
