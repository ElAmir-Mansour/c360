'use client';

import { Card, CardContent } from '@/components/ui/card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { WorkflowInstance } from '@/types/models';
import {
  fillAdminWorkflowLabel,
  formatAdminDuration,
  getAdminWorkflowLabels,
} from '../../../tasks/_lib/admin-workflow-i18n';

interface InstanceProgressProps {
  instance: WorkflowInstance;
}

export function InstanceProgress({ instance }: InstanceProgressProps) {
  const { locale } = useLocaleOrDefault();
  const labels = getAdminWorkflowLabels(locale);
  const numberFormat = new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en-US');
  const totalSteps = instance.total_steps ?? 0;
  const completedSteps = instance.completed_steps ?? 0;
  const percent =
    totalSteps > 0
      ? Math.round((completedSteps / totalSteps) * 100)
      : 0;

  const startTime = new Date(instance.started_at).getTime();
  const endTime = instance.completed_at
    ? new Date(instance.completed_at).getTime()
    : Date.now();
  const durationSec = Math.floor((endTime - startTime) / 1000);
  const duration = formatAdminDuration(durationSec, locale);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">
            {fillAdminWorkflowLabel(labels.progress.stepOf, {
              completed: numberFormat.format(completedSteps),
              total: numberFormat.format(totalSteps),
            })}
          </span>
          <span className="font-medium">{numberFormat.format(percent)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
          <span>
            {instance.current_step_name
              ? fillAdminWorkflowLabel(labels.progress.current, {
                  step: instance.current_step_name,
                })
              : instance.status === 'completed'
                ? labels.progress.allStepsCompleted
                : '—'}
          </span>
          <span>
            {fillAdminWorkflowLabel(labels.progress.duration, {
              duration,
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
