'use client';

import { CheckCircle, XCircle, Clock, SkipForward, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStepIcon } from '@/lib/workflow-utils';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { StepExecution } from '@/types/models';
import {
  formatAdminDateTime,
  formatAdminDuration,
  getStepStatusLabel,
  getStepTypeLabel,
} from '../../../tasks/_lib/admin-workflow-i18n';

const statusIcons: Record<string, React.ElementType> = {
  completed: CheckCircle,
  running: Loader2,
  failed: XCircle,
  pending: Clock,
  skipped: SkipForward,
  cancelled: XCircle,
};

const statusColors: Record<string, string> = {
  completed: 'text-primary',
  running: 'text-info-600 animate-spin',
  failed: 'text-error-600',
  pending: 'text-foreground/45',
  skipped: 'text-foreground/45',
  cancelled: 'text-foreground/45',
};

interface StepHistoryProps {
  steps: StepExecution[];
}

export function StepHistory({ steps }: StepHistoryProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  if (steps.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t('sh.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute start-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {steps.map((step, idx) => {
              const StatusIcon = statusIcons[step.status] ?? Clock;
              const StepIcon = getStepIcon(step.step_type);
              const color = statusColors[step.status] ?? 'text-foreground/45';

              return (
                <div key={step.id || idx} className="relative ps-10">
                  {/* Timeline dot */}
                  <div className="absolute start-2 top-1">
                    <StatusIcon className={`h-4 w-4 ${color}`} />
                  </div>

                  <div className="border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <StepIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {step.step_name ?? step.step_id}
                        </span>
                        <Badge variant="outline" className="text-overline shrink-0">
                          {getStepTypeLabel(step.step_type, locale)}
                        </Badge>
                      </div>
                      <Badge
                        variant={
                          step.status === 'completed'
                            ? 'default'
                            : step.status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                        }
                        className="text-overline shrink-0"
                      >
                        {getStepStatusLabel(step.status, locale)}
                      </Badge>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                      {step.started_at && (
                        <div>
                          <span className="block text-overline uppercase font-medium">
                            {t('sh.started')}
                          </span>
                          {formatAdminDateTime(step.started_at, locale)}
                        </div>
                      )}
                      {step.completed_at && (
                        <div>
                          <span className="block text-overline uppercase font-medium">
                            {t('sh.completed')}
                          </span>
                          {formatAdminDateTime(step.completed_at, locale)}
                        </div>
                      )}
                      {step.duration_ms != null && (
                        <div>
                          <span className="block text-overline uppercase font-medium">
                            {t('sh.duration')}
                          </span>
                          {formatAdminDuration(Math.round(step.duration_ms / 1000), locale)}
                        </div>
                      )}
                      {step.duration_ms == null && step.duration_seconds != null && (
                        <div>
                          <span className="block text-overline uppercase font-medium">
                            {t('sh.duration')}
                          </span>
                          {formatAdminDuration(step.duration_seconds, locale)}
                        </div>
                      )}
                      {step.assigned_to && (
                        <div>
                          <span className="block text-overline uppercase font-medium">
                            {t('sh.assignee')}
                          </span>
                          {step.assigned_to}
                        </div>
                      )}
                    </div>

                    {(step.error_message ?? step.error) && (
                      <div className="mt-2 text-xs text-error-700 bg-error-50 rounded p-2 dark:bg-error-700/15 dark:text-error-300">
                        {step.error_message ?? step.error}
                      </div>
                    )}

                    {(step.output_data ?? step.output) &&
                      Object.keys(step.output_data ?? step.output ?? {}).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            {t('sh.outputData')}
                          </summary>
                          <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto">
                            {JSON.stringify(step.output_data ?? step.output, null, 2)}
                          </pre>
                        </details>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
