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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAssetLabels, type AssetLabels } from '../_lib/assets-i18n';

function buildScanIntervals(t: AssetLabels) {
  return [
    { label: t.scheduleDialog.intervals.hourly, value: '0 * * * *' },
    { label: t.scheduleDialog.intervals.every6h, value: '0 */6 * * *' },
    { label: t.scheduleDialog.intervals.dailyMidnight, value: '0 0 * * *' },
    { label: t.scheduleDialog.intervals.daily6am, value: '0 6 * * *' },
    { label: t.scheduleDialog.intervals.weekly, value: '0 0 * * 0' },
    { label: t.scheduleDialog.intervals.monthly, value: '0 0 1 * *' },
  ];
}

function buildSchema(v: { targetRequired: string; scheduleRequired: string; labelRequired: string }) {
  return z.object({
    scan_type: z.enum(['network', 'cloud', 'agent']),
    target: z.string().min(1, v.targetRequired),
    schedule: z.string().min(1, v.scheduleRequired),
    label: z.string().min(1, v.labelRequired).max(100),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface ScanScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScanScheduleDialog({ open, onOpenChange }: ScanScheduleDialogProps) {
  const t = useAssetLabels();
  const scanIntervals = buildScanIntervals(t);
  const schema = useMemo(
    () => buildSchema({
      targetRequired: t.scheduleDialog.targetRequired,
      scheduleRequired: t.scheduleDialog.scheduleRequired,
      labelRequired: t.scheduleDialog.labelRequired,
    }),
    [t.scheduleDialog.targetRequired, t.scheduleDialog.scheduleRequired, t.scheduleDialog.labelRequired],
  );
  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      scan_type: 'network',
      target: '',
      schedule: '0 0 * * *',
      label: '',
    },
  });

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, setValue, watch } = methods;
  const selectedSchedule = watch('schedule');

  const onSubmit = handleSubmit(async (data) => {
    try {
      await apiPost(API_ENDPOINTS.CYBER_ASSETS_SCAN, {
        scan_type: data.scan_type,
        targets: data.target.split(/[,\n]/).map((t: string) => t.trim()).filter(Boolean),
        schedule: data.schedule,
        label: data.label,
      });
      toast.success(t.scheduleDialog.createdToast);
      reset();
      onOpenChange(false);
    } catch {
      toast.error(t.scheduleDialog.failedToast);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.scheduleDialog.title}</DialogTitle>
          <DialogDescription>
            {t.scheduleDialog.description}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label>{t.scheduleDialog.label}</Label>
              <Input
                placeholder={t.scheduleDialog.labelPlaceholder}
                {...register('label')}
                className="mt-1"
              />
              {errors.label && <p className="mt-1 text-xs text-destructive">{errors.label.message}</p>}
            </div>

            <div>
              <Label>{t.scheduleDialog.scanType}</Label>
              <Select
                value={watch('scan_type')}
                onValueChange={(v) => setValue('scan_type', v as FormValues['scan_type'])}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="network">{t.scheduleDialog.networkDiscovery}</SelectItem>
                  <SelectItem value="cloud">{t.scheduleDialog.cloudResourceSync}</SelectItem>
                  <SelectItem value="agent">{t.scheduleDialog.agentBasedInventory}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.scheduleDialog.targets}</Label>
              <Input
                placeholder={t.scheduleDialog.targetsPlaceholder}
                {...register('target')}
                className="mt-1"
              />
              {errors.target && <p className="mt-1 text-xs text-destructive">{errors.target.message}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {t.scheduleDialog.targetsHint}
              </p>
            </div>

            <div>
              <Label>{t.scheduleDialog.schedule}</Label>
              <Select
                value={selectedSchedule}
                onValueChange={(v) => setValue('schedule', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scanIntervals.map((interval) => (
                    <SelectItem key={interval.value} value={interval.value}>
                      {interval.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.scheduleDialog.cronPrefix} <code className="text-overline rounded bg-muted px-1">{selectedSchedule}</code>
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.scheduleDialog.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t.scheduleDialog.creating : t.scheduleDialog.createSchedule}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
