'use client';

import { useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
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
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/shared/forms/form-field';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAssetLabels } from '../_lib/assets-i18n';

function buildSchema(v: { scanTypeRequired: string; targetRequired: string }) {
  return z.object({
    scan_type: z.enum(['network', 'cloud', 'agent'], {
      required_error: v.scanTypeRequired,
    }),
    target: z.string().min(1, v.targetRequired),
    ports: z.string().optional().or(z.literal('')),
    include_vuln: z.boolean(),
    include_config: z.boolean(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface ScanTriggerPayload {
  scan_type: string;
  targets: string[];
  ports?: number[];
  options?: Record<string, unknown>;
}

interface ScanResult {
  scan_id: string;
  status: string;
  message: string;
}

interface ScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTarget?: string;
  onSuccess?: (result: ScanResult) => void;
}

function parsePorts(raw: string): number[] | undefined {
  if (!raw.trim()) return undefined;
  const ports: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let p = start; p <= end && ports.length < 1000; p++) {
          if (p >= 1 && p <= 65535) ports.push(p);
        }
      }
    } else {
      const p = Number(trimmed);
      if (!isNaN(p) && p >= 1 && p <= 65535) ports.push(p);
    }
    if (ports.length >= 1000) break;
  }
  return ports.length > 0 ? ports.slice(0, 1000) : undefined;
}

export function ScanDialog({ open, onOpenChange, defaultTarget, onSuccess }: ScanDialogProps) {
  const t = useAssetLabels();
  const schema = useMemo(
    () => buildSchema({ scanTypeRequired: t.scanDialog.scanTypeRequired, targetRequired: t.scanDialog.targetRequired }),
    [t.scanDialog.scanTypeRequired, t.scanDialog.targetRequired],
  );
  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      scan_type: 'network',
      target: defaultTarget ?? '',
      ports: '',
      include_vuln: true,
      include_config: true,
    },
  });

  const { mutate, isPending } = useApiMutation<ScanResult, ScanTriggerPayload>(
    'post',
    API_ENDPOINTS.CYBER_ASSETS_SCAN,
    {
      successMessage: t.scanDialog.startedToast,
      invalidateKeys: ['cyber-assets-scans'],
      onSuccess: (result) => {
        methods.reset();
        onOpenChange(false);
        onSuccess?.(result);
      },
    },
  );

  const onSubmit = methods.handleSubmit((data) => {
    const targets = data.target.split(',').map((t) => t.trim()).filter(Boolean);
    const ports = parsePorts(data.ports ?? '');
    const options: Record<string, unknown> = {};
    if (data.include_vuln) options['vuln_scan'] = true;
    if (data.include_config) options['config_audit'] = true;

    mutate({
      scan_type: data.scan_type,
      targets,
      ...(ports ? { ports } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    });
  });

  const { register, watch, setValue } = methods;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.scanDialog.title}</DialogTitle>
          <DialogDescription>
            {t.scanDialog.description}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="scan_type">{t.scanDialog.scanType}</Label>
              <select
                id="scan_type"
                {...register('scan_type')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="network">{t.scanDialog.optNetwork}</option>
                <option value="cloud">{t.scanDialog.optCloud}</option>
                <option value="agent">{t.scanDialog.optAgent}</option>
              </select>
            </div>

            <FormField name="target" label={t.scanDialog.targets} required>
              <Input
                placeholder="10.0.0.1, 192.168.1.0/24, host.example.com"
                {...register('target')}
              />
              <p className="text-xs text-muted-foreground">{t.scanDialog.targetsHint}</p>
            </FormField>

            <FormField name="ports" label={t.scanDialog.ports}>
              <Input placeholder="80,443,8080 or 1-1024 (optional)" {...register('ports')} />
              <p className="text-xs text-muted-foreground">{t.scanDialog.portsHint}</p>
            </FormField>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t.scanDialog.additionalChecks}</p>
              <div className="space-y-2 rounded-md border p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-primary/20"
                    checked={watch('include_vuln')}
                    onChange={(e) => setValue('include_vuln', e.target.checked)}
                  />
                  {t.scanDialog.vulnMatching}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-primary/20"
                    checked={watch('include_config')}
                    onChange={(e) => setValue('include_config', e.target.checked)}
                  />
                  {t.scanDialog.configAudit}
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.scanDialog.cancel}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t.scanDialog.starting : t.scanDialog.startScan}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
