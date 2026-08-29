'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import {
  dateColumn,
  statusColumn,
  actionsColumn,
} from '@/components/shared/data-table/columns/common-columns';
import { workflowStatusConfig, type StatusConfig } from '@/lib/status-configs';
import {
  formatWorkflowDuration,
  workflowLabel,
  type WorkflowPageLabels,
} from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';
import type { WorkflowInstance } from '@/types/models';

interface WorkflowInstanceColumnOptions {
  onView: (instance: WorkflowInstance) => void;
  onCancel: (instance: WorkflowInstance) => void;
  onRetry: (instance: WorkflowInstance) => void;
  labels?: WorkflowPageLabels;
  /**
   * Whether the viewer may control THIS instance. The engine authorizes cancel
   * and retry to the user who started the instance (or a workflow operator), so
   * offering the action to anyone else only produces a 403 toast. Defaults to
   * permitting the action when no predicate is supplied, preserving the
   * behaviour of existing callers such as the admin console.
   */
  canControl?: (instance: WorkflowInstance) => boolean;
}

function getLocalizedWorkflowStatusConfig(labels?: WorkflowPageLabels): StatusConfig {
  if (!labels) {
    return workflowStatusConfig;
  }
  return Object.fromEntries(
    Object.entries(workflowStatusConfig).map(([status, config]) => [
      status,
      { ...config, label: workflowLabel(labels, status, config.label) },
    ]),
  ) as StatusConfig;
}

function CurrentStepCell({ instance, labels }: { instance: WorkflowInstance; labels?: WorkflowPageLabels }) {
  if (instance.status === 'completed') {
    return (
      <span className="text-sm text-primary">
        {labels?.workflows.completedSteps(instance.total_steps ?? 0) ?? `Completed (${instance.total_steps ?? 0} steps)`}
      </span>
    );
  }
  if (instance.status === 'failed') {
    const step = instance.current_step_name ?? labels?.workflows.unknownStep ?? 'Unknown step';
    return (
      <span className="text-sm text-destructive">
        {labels?.workflows.failedAt(step) ?? `Failed at: ${step}`}
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
          {labels?.workflows.stepOf(stepNum, total) ?? `Step ${stepNum} of ${total}`}
        </span>
      </div>
    );
  }
  return <span className="text-muted-foreground text-sm">—</span>;
}

function DurationCell({ instance, labels }: { instance: WorkflowInstance; labels?: WorkflowPageLabels }) {
  const startTime = new Date(instance.started_at).getTime();
  const endTime = instance.completed_at
    ? new Date(instance.completed_at).getTime()
    : Date.now();
  const seconds = Math.floor((endTime - startTime) / 1000);
  return (
    <span className="text-sm text-muted-foreground">
      {labels ? formatWorkflowDuration(seconds, labels) : `${seconds}s`}
    </span>
  );
}

function StartedByCell({ instance, labels }: { instance: WorkflowInstance; labels?: WorkflowPageLabels }) {
  if (!instance.started_by) {
    return <Badge variant="secondary" className="text-xs">{labels?.workflows.system ?? 'System'}</Badge>;
  }
  return <span className="text-sm">{instance.started_by_name ?? instance.started_by}</span>;
}

export function getWorkflowInstanceColumns(
  options: WorkflowInstanceColumnOptions,
): ColumnDef<WorkflowInstance>[] {
  const { onView, onCancel, onRetry, labels, canControl } = options;
  const mayControl = (instance: WorkflowInstance) => canControl?.(instance) ?? true;
  const localizedStatusConfig = getLocalizedWorkflowStatusConfig(labels);

  return [
    {
      id: 'definition_name',
      accessorKey: 'definition_name',
      header: 'Workflow',
      cell: ({ getValue, row }) => {
        const name = getValue() as string;
        return (
          <button
            onClick={() => onView(row.original)}
            className="text-sm font-medium text-left hover:underline"
          >
            {name}
          </button>
        );
      },
      enableSorting: true,
    },
    {
      id: 'current_step',
      header: labels?.workflows.columns.currentStep ?? 'Current Step',
      cell: ({ row }) => <CurrentStepCell instance={row.original} labels={labels} />,
      size: 200,
      enableSorting: false,
    },
    statusColumn<WorkflowInstance>('status', labels?.workflows.columns.status ?? 'Status', localizedStatusConfig),
    dateColumn<WorkflowInstance>('started_at', labels?.workflows.columns.started ?? 'Started', { relative: true }),
    {
      id: 'duration',
      header: labels?.workflows.columns.duration ?? 'Duration',
      cell: ({ row }) => <DurationCell instance={row.original} labels={labels} />,
      size: 100,
      enableSorting: false,
    },
    {
      id: 'started_by',
      header: labels?.workflows.columns.startedBy ?? 'Started By',
      cell: ({ row }) => <StartedByCell instance={row.original} labels={labels} />,
      size: 140,
      enableSorting: false,
    },
    actionsColumn<WorkflowInstance>((instance) => [
      { label: labels?.workflows.actions.viewDetails ?? 'View Details', onClick: () => onView(instance) },
      ...(instance.status === 'running' && mayControl(instance)
        ? [{ label: labels?.workflows.actions.cancel ?? 'Cancel', onClick: () => onCancel(instance), variant: 'destructive' as const }]
        : []),
      ...(instance.status === 'failed' && mayControl(instance)
        ? [{ label: labels?.workflows.actions.retry ?? 'Retry', onClick: () => onRetry(instance) }]
        : []),
    ]),
  ];
}
