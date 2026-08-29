'use client';

import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { FormField } from '@/components/shared/forms/form-field';
import { visusReportSchema } from '@/lib/enterprise/schemas';
import type { UserDirectoryEntry, VisusReportDefinition } from '@/types/suites';
import { formatCommaSeparatedList, parseCommaSeparatedList } from '../../_components/form-utils';
import {
  pickEnumLabel,
  useVisusEnumLabels,
  useVisusFormCommonLabels,
  useVisusReportFormLabels,
} from '../../_lib/visus-i18n';

type ReportFormValues = z.infer<typeof visusReportSchema>;

const REPORT_TYPES: ReportFormValues['report_type'][] = [
  'executive_summary',
  'security_posture',
  'data_intelligence',
  'governance',
  'legal',
  'custom',
];

const REPORT_PERIODS: ReportFormValues['period'][] = [
  '7d',
  '14d',
  '30d',
  '90d',
  'quarterly',
  'annual',
  'custom',
];

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface ReportFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report?: VisusReportDefinition | null;
  users: UserDirectoryEntry[];
  pending?: boolean;
  onSubmit: (payload: ReportFormValues) => Promise<void>;
}

export function ReportFormDialog({
  open,
  onOpenChange,
  report,
  users,
  pending = false,
  onSubmit,
}: ReportFormDialogProps) {
  const t = useVisusReportFormLabels();
  const fc = useVisusFormCommonLabels();
  const enums = useVisusEnumLabels();
  const [sectionsInput, setSectionsInput] = useState('');

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: `${user.first_name} ${user.last_name}`.trim() || user.email,
      })),
    [users],
  );

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(visusReportSchema),
    defaultValues: {
      name: '',
      description: '',
      report_type: 'executive_summary',
      sections: [],
      period: '30d',
      custom_period_start: null,
      custom_period_end: null,
      schedule: null,
      recipients: [],
      auto_send: false,
    },
  });

  useEffect(() => {
    const nextValues: ReportFormValues = {
      name: report?.name ?? '',
      description: report?.description ?? '',
      report_type: report?.report_type ?? 'executive_summary',
      sections: report?.sections ?? [],
      period: (report?.period as ReportFormValues['period']) ?? '30d',
      custom_period_start: report?.custom_period_start ?? null,
      custom_period_end: report?.custom_period_end ?? null,
      schedule: report?.schedule ?? null,
      recipients: report?.recipients ?? [],
      auto_send: report?.auto_send ?? false,
    };
    form.reset(nextValues);
    setSectionsInput(formatCommaSeparatedList(nextValues.sections));
  }, [form, open, report]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit({
      ...values,
      sections: parseCommaSeparatedList(sectionsInput),
      custom_period_start: nullableString(values.custom_period_start ?? ''),
      custom_period_end: nullableString(values.custom_period_end ?? ''),
      schedule: nullableString(values.schedule ?? ''),
    });
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{report ? t.titleEdit : t.titleCreate}</DialogTitle>
          <DialogDescription>
            {t.description}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="name" label={t.nameLabel} required>
                <Input id="name" {...form.register('name')} placeholder={t.namePlaceholder} />
              </FormField>
              <FormField name="report_type" label={t.reportTypeLabel} required>
                <Select value={form.watch('report_type')} onValueChange={(value) => form.setValue('report_type', value as ReportFormValues['report_type'], { shouldDirty: true })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.reportTypePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {pickEnumLabel(enums.reportType, item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField name="description" label={t.descriptionLabel} required>
              <Textarea id="description" rows={3} {...form.register('description')} placeholder={t.descriptionPlaceholder} />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="period" label={t.periodLabel} required>
                <Select value={form.watch('period')} onValueChange={(value) => form.setValue('period', value as ReportFormValues['period'], { shouldDirty: true })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.periodPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_PERIODS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {pickEnumLabel(enums.period, item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="schedule" label={t.scheduleLabel}>
                <Input id="schedule" {...form.register('schedule')} placeholder="0 7 * * MON" />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="custom_period_start" label={t.customStartLabel}>
                <Input id="custom_period_start" type="date" {...form.register('custom_period_start')} />
              </FormField>
              <FormField name="custom_period_end" label={t.customEndLabel}>
                <Input id="custom_period_end" type="date" {...form.register('custom_period_end')} />
              </FormField>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-sections">{t.sectionsLabel}</Label>
              <Input id="report-sections" value={sectionsInput} onChange={(event) => setSectionsInput(event.target.value)} placeholder={t.sectionsPlaceholder} />
              <p className="text-xs text-muted-foreground">{t.sectionsHelp}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-recipients">{t.recipientsLabel}</Label>
              <MultiSelect
                options={userOptions}
                selected={form.watch('recipients')}
                onChange={(values) => form.setValue('recipients', values, { shouldDirty: true })}
                placeholder={t.recipientsPlaceholder}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="auto_send"
                checked={form.watch('auto_send')}
                onCheckedChange={(checked) => form.setValue('auto_send', Boolean(checked), { shouldDirty: true })}
              />
              <Label htmlFor="auto_send">{t.autoSendLabel}</Label>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {fc.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? fc.saving : report ? t.submitEdit : t.submitCreate}
              </Button>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
