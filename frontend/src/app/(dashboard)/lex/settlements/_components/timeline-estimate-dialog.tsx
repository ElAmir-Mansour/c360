'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
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
import { FormField } from '@/components/shared/forms/form-field';
import { useSettlementLabels, type SettlementLabels } from './labels';
import type { MatterTimeline, UpdateMatterTimelinePayload } from '@/lib/lex/settlements';

function buildSchema(labels: SettlementLabels['timeline']['estimateDialog']) {
  return z.object({
    duration_days: z
      .string()
      .optional()
      .refine(
        (v) => !v || (Number.isInteger(Number(v)) && Number(v) > 0),
        labels.durationInvalid,
      ),
    completion_date: z.string().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

function toDateInput(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

interface TimelineEstimateDialogProps {
  open: boolean;
  loading: boolean;
  timeline: MatterTimeline;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: UpdateMatterTimelinePayload) => void;
}

export function TimelineEstimateDialog({
  open,
  loading,
  timeline,
  onOpenChange,
  onSubmit,
}: TimelineEstimateDialogProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.estimateDialog;
  const schema = useMemo(() => buildSchema(labels), [labels]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      duration_days:
        timeline.estimated_duration_days != null ? String(timeline.estimated_duration_days) : '',
      completion_date: toDateInput(timeline.estimated_completion_date),
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        duration_days:
          timeline.estimated_duration_days != null ? String(timeline.estimated_duration_days) : '',
        completion_date: toDateInput(timeline.estimated_completion_date),
      });
    }
  }, [open, timeline, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              const hasDuration = Boolean(values.duration_days);
              const hasDate = Boolean(values.completion_date);
              onSubmit({
                estimated_duration_days: hasDuration ? Number(values.duration_days) : undefined,
                estimated_completion_date: hasDate
                  ? new Date(`${values.completion_date}T00:00:00Z`).toISOString()
                  : undefined,
                clear_estimate: !hasDuration && !hasDate,
              });
            })}
          >
            <LexCreationGuidance workflow="settlement" />
            <FormField name="duration_days" label={labels.durationDays}>
              <Input
                id="duration_days"
                inputMode="numeric"
                {...form.register('duration_days')}
                placeholder={labels.durationPlaceholder}
              />
            </FormField>
            <FormField name="completion_date" label={labels.completionDate}>
              <Input id="completion_date" type="date" {...form.register('completion_date')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {labels.save}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
