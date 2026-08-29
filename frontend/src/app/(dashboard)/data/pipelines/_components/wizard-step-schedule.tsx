'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { FormField } from '@/components/shared/forms/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CronSchedulePicker } from '@/app/(dashboard)/data/pipelines/_components/cron-schedule-picker';
import {
  PIPELINE_SCHEDULE_PRESETS,
  pipelineScheduleSchema,
  type PipelineScheduleValues,
} from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-types';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface WizardStepScheduleProps {
  defaultValues: PipelineScheduleValues;
  onBack: () => void;
  onSubmit: (values: PipelineScheduleValues) => void;
  submitting: boolean;
}

export function WizardStepSchedule({
  defaultValues,
  onBack,
  onSubmit,
  submitting,
}: WizardStepScheduleProps) {
  const labels = useDataLabels();
  const form = useForm<PipelineScheduleValues>({
    resolver: zodResolver(pipelineScheduleSchema),
    mode: 'onChange',
    defaultValues,
  });

  const mode = form.watch('schedule_mode');

  return (
    <FormProvider {...form}>
      <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField name="schedule_mode" label={labels.pipelines.scheduleMode} required>
          <Select
            value={mode}
            onValueChange={(next) =>
              form.setValue('schedule_mode', next as PipelineScheduleValues['schedule_mode'], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{labels.pipelines.smManual}</SelectItem>
              <SelectItem value="preset">{labels.pipelines.smPreset}</SelectItem>
              <SelectItem value="custom">{labels.pipelines.smCustom}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        {mode === 'preset' ? (
          <FormField name="schedule_preset" label={labels.pipelines.preset} required>
            <Select
              value={form.watch('schedule_preset') ?? ''}
              onValueChange={(next) => form.setValue('schedule_preset', next as PipelineScheduleValues['schedule_preset'], { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={labels.pipelines.choosePreset} />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_SCHEDULE_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}

        {mode === 'custom' ? (
          <CronSchedulePicker
            value={form.watch('custom_cron') || ''}
            onChange={(next) => form.setValue('custom_cron', next, { shouldValidate: true })}
            name="custom_cron"
            label={labels.pipelines.customCron}
          />
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField name="max_retries" label={labels.pipelines.maxRetries} required>
            <Input type="number" {...form.register('max_retries', { valueAsNumber: true })} min={0} max={10} />
          </FormField>

          <FormField name="retry_backoff_sec" label={labels.pipelines.retryBackoff} required>
            <Input
              type="number"
              {...form.register('retry_backoff_sec', { valueAsNumber: true })}
              min={5}
              max={3600}
            />
          </FormField>
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            {labels.common.back}
          </Button>
          <Button type="submit" disabled={!form.formState.isValid || submitting}>
            {submitting ? labels.pipelines.creating : labels.pipelines.createPipelineBtn}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
