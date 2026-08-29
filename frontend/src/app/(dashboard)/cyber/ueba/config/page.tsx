'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { useUebaLabels, type UebaLabels } from '../_lib/ueba-i18n';

type UEBAConfig = {
  cycle_interval: string;
  max_events_per_cycle: number;
  max_processing_time: string;
  ema_alpha: number;
  min_maturity_for_alert: string;
  correlation_window: string;
  risk_decay_rate_per_day: number;
  batch_size: number;
  unusual_time_mature_high_prob: number;
  unusual_time_mature_medium_prob: number;
  unusual_time_base_high_prob: number;
  unusual_time_base_medium_prob: number;
  unusual_volume_medium_z: number;
  unusual_volume_high_z: number;
  unusual_volume_critical_z: number;
  unusual_volume_stddev_min: number;
  failure_spike_medium_z: number;
  failure_spike_high_z: number;
  failure_spike_critical_z: number;
  failure_stddev_min: number;
  failure_critical_count: number;
  bulk_rows_medium_multiplier: number;
  bulk_rows_high_multiplier: number;
  ddl_unusual_threshold: number;
};

type FieldKey = keyof UebaLabels['config']['fields'];
type GroupId = keyof UebaLabels['config']['groups'];

const TEXT_FIELDS: Array<{ key: FieldKey; placeholder: string }> = [
  { key: 'cycle_interval', placeholder: '5m' },
  { key: 'max_processing_time', placeholder: '30s' },
  { key: 'min_maturity_for_alert', placeholder: 'mature' },
  { key: 'correlation_window', placeholder: '15m' },
];

const NUMBER_GROUPS: Array<{ id: GroupId; fields: Array<{ key: FieldKey; step?: string }> }> = [
  {
    id: 'processing',
    fields: [
      { key: 'max_events_per_cycle' },
      { key: 'batch_size' },
      { key: 'ema_alpha', step: '0.01' },
      { key: 'risk_decay_rate_per_day', step: '0.01' },
    ],
  },
  {
    id: 'unusualTime',
    fields: [
      { key: 'unusual_time_mature_high_prob', step: '0.01' },
      { key: 'unusual_time_mature_medium_prob', step: '0.01' },
      { key: 'unusual_time_base_high_prob', step: '0.01' },
      { key: 'unusual_time_base_medium_prob', step: '0.01' },
    ],
  },
  {
    id: 'volumeFailures',
    fields: [
      { key: 'unusual_volume_medium_z', step: '0.1' },
      { key: 'unusual_volume_high_z', step: '0.1' },
      { key: 'unusual_volume_critical_z', step: '0.1' },
      { key: 'unusual_volume_stddev_min', step: '0.1' },
      { key: 'failure_spike_medium_z', step: '0.1' },
      { key: 'failure_spike_high_z', step: '0.1' },
      { key: 'failure_spike_critical_z', step: '0.1' },
      { key: 'failure_stddev_min', step: '0.1' },
      { key: 'failure_critical_count', step: '1' },
    ],
  },
  {
    id: 'bulkDdl',
    fields: [
      { key: 'bulk_rows_medium_multiplier', step: '0.1' },
      { key: 'bulk_rows_high_multiplier', step: '0.1' },
      { key: 'ddl_unusual_threshold', step: '0.1' },
    ],
  },
];

const DEFAULT_CONFIG: UEBAConfig = {
  cycle_interval: '5m',
  max_events_per_cycle: 10000,
  max_processing_time: '30s',
  ema_alpha: 0.2,
  min_maturity_for_alert: 'mature',
  correlation_window: '15m',
  risk_decay_rate_per_day: 0.05,
  batch_size: 500,
  unusual_time_mature_high_prob: 0.85,
  unusual_time_mature_medium_prob: 0.7,
  unusual_time_base_high_prob: 0.95,
  unusual_time_base_medium_prob: 0.85,
  unusual_volume_medium_z: 2,
  unusual_volume_high_z: 3,
  unusual_volume_critical_z: 4,
  unusual_volume_stddev_min: 1,
  failure_spike_medium_z: 2,
  failure_spike_high_z: 3,
  failure_spike_critical_z: 4,
  failure_stddev_min: 1,
  failure_critical_count: 20,
  bulk_rows_medium_multiplier: 2,
  bulk_rows_high_multiplier: 4,
  ddl_unusual_threshold: 3,
};

export default function UEBAConfigPage() {
  const t = useUebaLabels();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(() => configToForm(DEFAULT_CONFIG));

  const configQuery = useQuery({
    queryKey: ['ueba-config'],
    queryFn: () => apiGet<{ data?: UEBAConfig } | UEBAConfig>(API_ENDPOINTS.CYBER_UEBA_CONFIG),
  });

  useEffect(() => {
    if (!configQuery.data) return;
    const payload = 'data' in configQuery.data && configQuery.data.data ? configQuery.data.data : configQuery.data;
    setForm(configToForm(payload as UEBAConfig));
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiPut(API_ENDPOINTS.CYBER_UEBA_CONFIG, formToConfig(form)),
    onSuccess: () => {
      toast.success(t.config.updatedToast);
      void queryClient.invalidateQueries({ queryKey: ['ueba-config'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.config.eyebrow}
          title={t.config.title}
          description={t.config.description}
          actions={
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Save className="me-1.5 h-4 w-4" />}
              {t.config.save}
            </Button>
          }
        />

        {configQuery.error ? (
          <ErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  {t.config.runtimeCadenceTitle}
                </CardTitle>
                <CardDescription>{t.config.runtimeCadenceDescription}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {TEXT_FIELDS.map((field) => (
                  <ConfigField
                    key={field.key}
                    label={t.config.fields[field.key]}
                    value={form[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}
                  />
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              {NUMBER_GROUPS.map((group) => (
                <Card key={group.id}>
                  <CardHeader>
                    <CardTitle>{t.config.groups[group.id].title}</CardTitle>
                    <CardDescription>{t.config.groups[group.id].description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {group.fields.map((field) => (
                      <ConfigField
                        key={field.key}
                        label={t.config.fields[field.key]}
                        type="number"
                        step={field.step ?? '1'}
                        value={form[field.key] ?? ''}
                        onChange={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}
                      />
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  type = 'text',
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} step={step} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function configToForm(config: UEBAConfig): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, String(value)]),
  );
}

function formToConfig(form: Record<string, string>): UEBAConfig {
  const next: Record<string, string | number> = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(next) as Array<keyof UEBAConfig>) {
    const value = form[key];
    if (typeof DEFAULT_CONFIG[key] === 'number') {
      next[key] = Number(value);
    } else {
      next[key] = value;
    }
  }
  return next as UEBAConfig;
}
