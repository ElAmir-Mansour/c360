'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  actionsColumn,
  dateColumn,
  statusColumn,
} from '@/components/shared/data-table/columns/common-columns';
import { cn } from '@/lib/utils';
import { canClaimTask, canDelegateTask } from '@/lib/workflow-utils';
import type { AppLocale } from '@/lib/i18n';
import type { HumanTask, User } from '@/types/models';
import {
  formatAdminDateTime,
  formatAdminSLAStatus,
  getAdminWorkflowLabels,
  getLocalizedTaskStatusConfig,
  getTaskPriorityColor,
  getTaskPriorityLabel,
} from '../_lib/admin-workflow-i18n';

interface AdminTaskColumnOptions {
  locale: AppLocale;
  onOpen: (task: HumanTask) => void;
  onClaim: (task: HumanTask) => void;
  onDelegate: (task: HumanTask) => void;
  onViewWorkflow: (task: HumanTask) => void;
  currentUser?: User | null;
}

function PriorityCell({ priority, locale }: { priority: number; locale: AppLocale }) {
  const label = getTaskPriorityLabel(priority, locale);
  const color = getTaskPriorityColor(priority);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('block h-2.5 w-2.5 rounded-full', color)} aria-label={label} />
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function SLACell({ task, locale }: { task: HumanTask; locale: AppLocale }) {
  const labels = getAdminWorkflowLabels(locale);
  const { text, color } = formatAdminSLAStatus(task, locale);
  const deadlineText = task.sla_deadline
    ? formatAdminDateTime(task.sla_deadline, locale)
    : labels.sla.noDeadline;

  if (task.sla_breached) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="space-y-1">
            <Badge variant="destructive" className="text-xs">
              {labels.sla.overdue}
            </Badge>
            <p className="text-xs text-destructive">{text}</p>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {labels.taskColumns.deadline}: {deadlineText}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('text-xs', color)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          {labels.taskColumns.deadline}: {deadlineText}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function AssignedCell({
  task,
  currentUser,
  onClaim,
  locale,
}: {
  task: HumanTask;
  currentUser?: User | null;
  onClaim: (task: HumanTask) => void;
  locale: AppLocale;
}) {
  const labels = getAdminWorkflowLabels(locale);
  const isMe = task.claimed_by === currentUser?.id;

  if (!task.claimed_by) {
    const canClaim = canClaimTask(task, currentUser);
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="border-warning-300 text-xs text-warning-700 dark:text-warning-300"
        >
          {labels.taskColumns.unassigned}
        </Badge>
        {canClaim && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onClaim(task);
            }}
          >
            {labels.taskColumns.claim}
          </Button>
        )}
      </div>
    );
  }

  if (isMe) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="text-xs font-medium">{labels.taskColumns.you}</span>
      </div>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      {task.claimed_by_name ?? task.claimed_by}
    </span>
  );
}

export function getAdminTaskColumns(options: AdminTaskColumnOptions): ColumnDef<HumanTask>[] {
  const { locale, onOpen, onClaim, onDelegate, onViewWorkflow, currentUser } = options;
  const labels = getAdminWorkflowLabels(locale);
  const localizedTaskStatusConfig = getLocalizedTaskStatusConfig(locale);

  return [
    {
      id: 'priority',
      accessorKey: 'priority',
      header: '',
      cell: ({ row }) => <PriorityCell priority={row.original.priority} locale={locale} />,
      enableSorting: true,
      size: 50,
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: labels.taskColumns.taskName,
      cell: ({ row }) => {
        const task = row.original;
        return (
          <div
            className="cursor-pointer"
            onClick={() => onOpen(task)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onOpen(task);
              }
            }}
          >
            <span className="block text-sm font-medium">{task.name}</span>
            <span className="block text-xs text-muted-foreground">
              {task.description.length > 80
                ? `${task.description.slice(0, 80)}...`
                : task.description || '—'}
            </span>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: 'workflow_name',
      accessorKey: 'workflow_name',
      header: labels.taskColumns.workflow,
      cell: ({ row }) => {
        const value = row.original.workflow_name || row.original.definition_name;
        if (!value) {
          return <span className="text-muted-foreground">—</span>;
        }
        return (
          <Badge variant="outline" className="text-xs">
            {value}
          </Badge>
        );
      },
      size: 160,
    },
    statusColumn<HumanTask>('status', labels.taskColumns.status, localizedTaskStatusConfig),
    {
      id: 'sla_deadline',
      accessorKey: 'sla_deadline',
      header: labels.taskColumns.dueDate,
      cell: ({ row }) => <SLACell task={row.original} locale={locale} />,
      enableSorting: true,
      size: 130,
    },
    {
      id: 'claimed_by',
      accessorKey: 'claimed_by',
      header: labels.taskColumns.assigned,
      cell: ({ row }) => (
        <AssignedCell
          task={row.original}
          currentUser={currentUser}
          onClaim={onClaim}
          locale={locale}
        />
      ),
      size: 140,
    },
    dateColumn<HumanTask>('created_at', labels.taskColumns.created, { relative: true }),
    actionsColumn<HumanTask>((task) => [
      {
        label: labels.taskColumns.openTask,
        onClick: () => onOpen(task),
      },
      ...(canClaimTask(task, currentUser)
        ? [{ label: labels.taskColumns.claim, onClick: () => onClaim(task) }]
        : []),
      ...(canDelegateTask(task, currentUser)
        ? [{ label: labels.taskColumns.delegate, onClick: () => onDelegate(task) }]
        : []),
      {
        label: labels.taskColumns.viewWorkflow,
        onClick: () => onViewWorkflow(task),
      },
    ]),
  ];
}
