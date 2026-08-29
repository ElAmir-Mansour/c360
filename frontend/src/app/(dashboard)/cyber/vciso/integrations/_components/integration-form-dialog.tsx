'use client';

import { useState, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type { VCISOIntegration, CyberIntegrationType } from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

// ─── Constants ───────────────────────────────────────────────────────────────

const INTEGRATION_TYPE_VALUES: CyberIntegrationType[] = [
  'asset_management',
  'ticketing',
  'cloud_security',
  'data_protection',
  'siem',
  'iam',
];

const SYNC_FREQUENCY_VALUES = ['every_5m', 'every_15m', 'every_hour', 'every_6h', 'daily'];

// ─── Props ───────────────────────────────────────────────────────────────────

interface IntegrationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration?: VCISOIntegration | null;
  /** Called after a successful save so the parent can refresh its data. */
  onSaved?: () => void | Promise<void>;
}

// ─── Form State ──────────────────────────────────────────────────────────────

interface IntegrationFormData {
  name: string;
  type: CyberIntegrationType;
  provider: string;
  sync_frequency: string;
  config_json: string;
}

function getDefaultForm(integration?: VCISOIntegration | null): IntegrationFormData {
  if (integration) {
    return {
      name: integration.name,
      type: integration.type,
      provider: integration.provider,
      sync_frequency: integration.sync_frequency,
      config_json: JSON.stringify(integration.config, null, 2),
    };
  }
  return {
    name: '',
    type: 'asset_management',
    provider: '',
    sync_frequency: 'every_hour',
    config_json: '{}',
  };
}

function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IntegrationFormDialog({
  open,
  onOpenChange,
  integration,
  onSaved,
}: IntegrationFormDialogProps) {
  const labels = useVcisoOpsLabels().integrations;
  const t = labels.form;
  const typeLabels = labels.types as Record<string, string>;
  const freqLabels = labels.syncFrequencies;
  const isEdit = !!integration;
  const [form, setForm] = useState<IntegrationFormData>(() => getDefaultForm(integration));

  useEffect(() => {
    if (open) {
      setForm(getDefaultForm(integration));
    }
  }, [open, integration]);

  const { mutate: createIntegration, isPending: creating } = useApiMutation<
    VCISOIntegration,
    Record<string, unknown>
  >('post', API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS, {
    successMessage: t.createdToast,
    invalidateKeys: [API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS],
    onSuccess: () => {
      onOpenChange(false);
      void onSaved?.();
    },
  });

  const { mutate: updateIntegration, isPending: updating } = useApiMutation<
    VCISOIntegration,
    Record<string, unknown>
  >(
    'put',
    () => `${API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS}/${integration?.id}`,
    {
      successMessage: t.updatedToast,
      invalidateKeys: [API_ENDPOINTS.CYBER_VCISO_INTEGRATIONS],
      onSuccess: () => {
        onOpenChange(false);
        void onSaved?.();
      },
    },
  );

  const isPending = creating || updating;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(form.config_json) as Record<string, unknown>;
    } catch {
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      provider: form.provider.trim(),
      status: isEdit ? (integration?.status ?? 'pending') : 'pending',
      sync_frequency: form.sync_frequency,
      config,
    };

    if (isEdit) {
      updateIntegration(payload);
    } else {
      createIntegration(payload);
    }
  }

  function updateField<K extends keyof IntegrationFormData>(key: K, value: IntegrationFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isValid =
    form.name.trim().length > 0 &&
    form.provider.trim().length > 0 &&
    isValidJSON(form.config_json);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="integration-name">{t.name}</Label>
            <Input
              id="integration-name"
              placeholder={t.namePlaceholder}
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              required
            />
          </div>

          {/* Type & Provider */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t.type}</Label>
              <Select
                value={form.type}
                onValueChange={(v) => updateField('type', v as CyberIntegrationType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.selectType} />
                </SelectTrigger>
                <SelectContent>
                  {INTEGRATION_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {typeLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="integration-provider">{t.provider}</Label>
              <Input
                id="integration-provider"
                placeholder={t.providerPlaceholder}
                value={form.provider}
                onChange={(e) => updateField('provider', e.target.value)}
                required
              />
            </div>
          </div>

          {/* Sync Frequency */}
          <div className="space-y-2">
            <Label>{t.syncFrequency}</Label>
            <Select
              value={form.sync_frequency}
              onValueChange={(v) => updateField('sync_frequency', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t.selectFrequency} />
              </SelectTrigger>
              <SelectContent>
                {SYNC_FREQUENCY_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {freqLabels[value]?.() ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Configuration JSON */}
          <div className="space-y-2">
            <Label htmlFor="integration-config">{t.configJson}</Label>
            <Textarea
              id="integration-config"
              placeholder='{"api_key": "...", "base_url": "https://..."}'
              value={form.config_json}
              onChange={(e) => updateField('config_json', e.target.value)}
              rows={5}
              className="font-mono text-xs"
            />
            {!isValidJSON(form.config_json) && form.config_json.trim().length > 0 && (
              <p className="text-xs text-destructive">{t.invalidJson}</p>
            )}
            <p className="text-xs text-muted-foreground">{t.configHelp}</p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={isPending || !isValid}>
              {isPending
                ? isEdit
                  ? t.saving
                  : t.adding
                : isEdit
                  ? t.saveChanges
                  : t.addIntegration}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
