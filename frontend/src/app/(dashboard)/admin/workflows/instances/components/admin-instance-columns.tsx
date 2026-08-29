'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import {
  dateColumn,
  statusColumn,
  actionsColumn,
} from '@/components/shared/data-table/columns/common-columns';
import type { NamespacedTranslator } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';
import type { WorkflowInstance } from '@/types/models';
import {
  formatAdminDuration,
  getLocalizedWorkflowStatusConfig,
} from '../../tasks/_lib/admin-workflow-i18n';

interface AdminInstanceColumnOptions {
  locale: AppLocale;
  t: NamespacedTranslator;
  onView: (instance: WorkflowInstance) => void;
  onCancel: (instance: WorkflowInstance) => void;
  onRetry: (instance: WorkflowInstance) => void;
  onPause: (instance: WorkflowInstance) => void;
  onResume: (instance: WorkflowInstance) => void;
}

function CurrentStepCell({ instance, t }: { instance: WorkflowInstance; t: NamespacedTranslator }) {
  if (instance.status === 'completed') {
    return (
      <span className="text-sm text-primary">
        {t('aic.completedSteps', { n: instance.total_steps ?? 0 })}
      </span>
    );
  }
  if (instance.status === 'failed') {
    return (
      <span className="text-sm text-destructive">
        {t('aic.failedAt', { step: instance.current_step_name ?? t('aic.unknownStep') })}
      </span>
    );
  }
  if (instance.current_step_name) {
    const stepNum = (instance.completed_steps ?? 0) + 1;
    const total = instance.total_steps ?? 0;
    return (
      <div>
        <span className="text-sm font-medium">{instance.current_step_name}</span>
        <span className="ms-1.5 text-xs text-muted-foreground">
          {t('aic.stepOf', { n: stepNum, total })}
        </span>
      </div>
    );
  }
  return <span className="text-muted-foreground text-sm">&mdash;</span>;
}

function DurationCell({ instance, locale }: { instance: WorkflowInstance; locale: AppLocale }) {
  const startTime = new Date(instance.started_at).getTime();
  const endTime = instance.completed_at
    ? new Date(instance.completed_at).getTime()
    : Date.now();
  const seconds = Math.floor((endTime - startTime) / 1000);
  return <span className="text-sm text-muted-foreground">{formatAdminDuration(seconds, locale)}</span>;
}

function StartedByCell({ instance, t }: { instance: WorkflowInstance; t: NamespacedTranslator }) {
  if (!instance.started_by) {
    return <Badge variant="secondary" className="text-xs">{t('aic.system')}</Badge>;
  }
  return <span className="text-sm">{instance.started_by_name ?? instance.started_by}</span>;
}

export function getAdminInstanceColumns(
  options: AdminInstanceColumnOptions,
): ColumnDef<WorkflowInstance>[] {
  const { locale, t, onView, onCancel, onRetry, onPause, onResume } = options;
  const localizedWorkflowStatusConfig = getLocalizedWorkflowStatusConfig(locale);

  return [
    {
      id: 'definition_name',
      accessorKey: 'definition_name',
      header: t('aic.colWorkflow'),
      cell: ({ getValue, row }) => {
        const name = getValue() as string;
        return (
          <button
            onClick={() => onView(row.original)}
            className="text-sm font-medium text-start hover:underline"
          >
            {name}
          </button>
        );
      },
      enableSorting: true,
    },
    {
      id: 'current_step',
      header: t('aic.colCurrentStep'),
      cell: ({ row }) => <CurrentStepCell instance={row.original} t={t} />,
      size: 200,
      enableSorting: false,
    },
    statusColumn<WorkflowInstance>('status', t('aic.colStatus'), localizedWorkflowStatusConfig),
    dateColumn<WorkflowInstance>('started_at', t('aic.colStarted'), { relative: true }),
    {
      id: 'duration',
      header: t('aic.colDuration'),
      cell: ({ row }) => <DurationCell instance={row.original} locale={locale} />,
      size: 100,
      enableSorting: false,
    },
    {
      id: 'started_by',
      header: t('aic.colStartedBy'),
      cell: ({ row }) => <StartedByCell instance={row.original} t={t} />,
      size: 140,
      enableSorting: false,
    },
    actionsColumn<WorkflowInstance>((instance) => [
      { label: t('aic.viewDetails'), onClick: () => onView(instance) },
      ...(instance.status === 'running'
        ? [
            { label: t('aic.suspend'), onClick: () => onPause(instance) },
            { label: t('aic.cancel'), onClick: () => onCancel(instance), variant: 'destructive' as const },
          ]
        : []),
      ...(instance.status === 'suspended'
        ? [{ label: t('aic.resume'), onClick: () => onResume(instance) }]
        : []),
      ...(instance.status === 'failed'
        ? [{ label: t('aic.retry'), onClick: () => onRetry(instance) }]
        : []),
    ]),
  ];
}
