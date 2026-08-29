'use client';

/**
 * RunbookTaskFlow — ClarioDR sequenced recovery task-flow.
 * =======================================================
 *
 * A keyboard-navigable, sequence-ordered view of a recovery runbook's tasks.
 * Each row answers WHO / WHAT / WHEN for one orchestration task:
 *   - WHO   : owner + team
 *   - WHAT  : task type (manual / automated / approval_gate / comms / milestone)
 *             + the action (instructions / automation_action)
 *   - WHEN  : planned vs actual duration, and dependencies
 * The CRITICAL PATH (the longest planned-duration dependency chain) is
 * highlighted — those tasks gate the run's RTA, so they carry a visible marker
 * and an accessible "on the critical path" label.
 *
 * Real DR shapes only: tasks are `DRRunbookTask`, the live per-task execution
 * rows are `DRRunbookTaskRun`, the projection is `DRRunbookProjection` — exactly
 * what `DRRunbookLiveState` (GET /studio/runs/{id}) returns. A bootgraph boot
 * plan is rendered through the same view via `bootTiersToRunbookTasks`.
 *
 * Standards:
 *   - Token-driven only (no hardcoded colour/spacing/type/radius/shadow/motion).
 *   - WCAG 2.1 AA: semantic list, roving `tabindex` keyboard navigation
 *     (Up/Down/Home/End), AA-contrast status pills that never rely on colour
 *     alone, ARIA labelling, and a <640px stacked-card reflow (the desktop
 *     table-like grid collapses to a single column).
 *   - First-class RTL via logical properties + the `rtl:` Tailwind variant;
 *     sequence ordering is content order (DOM), which reflows correctly in RTL.
 *   - All copy is supplied via the `labels` prop (bilingual-ready); nothing is
 *     hardcoded English in the render path.
 */

import * as React from 'react';
import {
  Bot,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Flag,
  Hand,
  Loader2,
  Megaphone,
  MinusCircle,
  ShieldCheck,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/shared/status-chip';
import { IconBadge } from '@/components/shared/icon-badge';
import { MetricTile } from '@/components/shared/metric-tile';
import { EmptyState } from '@/components/common/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type {
  DRRunbookTask,
  DRRunbookTaskRun,
  DRRunbookProjection,
} from '@/types/clario-dr';
import {
  buildRunbookFlow,
  formatDurationSeconds,
  type RunbookFlowRow,
  type RunbookTaskRunStatus,
  type RunbookTaskType,
} from './runbook-graph';

type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
type BadgeTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

/** All visible strings — supply localized copy for bilingual / RTL surfaces. */
export interface RunbookTaskFlowLabels {
  /** Accessible name for the task-flow list landmark. */
  listAriaLabel: string;
  /** Column / field labels (also used as visually-hidden labels on mobile). */
  sequence: string;
  task: string;
  owner: string;
  team: string;
  action: string;
  planned: string;
  actual: string;
  dependencies: string;
  noDependencies: string;
  criticalPath: string;
  onCriticalPath: string;
  required: string;
  optional: string;
  /** Summary-strip metric labels. */
  totalTasks: string;
  criticalPathDuration: string;
  completed: string;
  projectedFinish: string;
  onTrack: string;
  behindSchedule: string;
  /** Empty-state copy. */
  emptyTitle: string;
  emptyDescription: string;
  /** task_type display names, keyed by canonical type. */
  taskTypes: Record<RunbookTaskType, string>;
  /** task-run status display names, keyed by canonical status. */
  statuses: Record<RunbookTaskRunStatus, string>;
}

export interface RunbookTaskFlowProps {
  /** The runbook's authored tasks (the DAG nodes). */
  tasks: DRRunbookTask[];
  /** Live per-task execution rows from the run (optional — plan-only view). */
  taskRuns?: DRRunbookTaskRun[];
  /** Live projection (elapsed-vs-planned) for the summary strip (optional). */
  projection?: DRRunbookProjection | null;
  /** All visible copy (bilingual-ready). */
  labels: RunbookTaskFlowLabels;
  /** Heading shown above the flow (e.g. the runbook name). Optional. */
  title?: string;
  /** Sub-heading / description under the title. Optional. */
  description?: string;
  /** Fired when a task row is activated (Enter/Space/click). Optional. */
  onSelectTask?: (task: DRRunbookTask) => void;
  className?: string;
}

const TASK_TYPE_ICON: Record<RunbookTaskType, LucideIcon> = {
  manual: Hand,
  automated: Bot,
  approval_gate: ShieldCheck,
  comms: Megaphone,
  milestone: Flag,
};

const TASK_TYPE_TONE: Record<RunbookTaskType, BadgeTone> = {
  manual: 'info',
  automated: 'primary',
  approval_gate: 'warning',
  comms: 'muted',
  milestone: 'success',
};

const STATUS_ICON: Record<RunbookTaskRunStatus, LucideIcon> = {
  pending: CircleDashed,
  runnable: CircleDashed,
  running: Loader2,
  complete: CheckCircle2,
  skipped: MinusCircle,
  failed: XCircle,
  blocked: CircleSlash,
};

const STATUS_TONE: Record<RunbookTaskRunStatus, ChipTone> = {
  pending: 'neutral',
  runnable: 'info',
  running: 'primary',
  complete: 'success',
  skipped: 'neutral',
  failed: 'danger',
  blocked: 'warning',
};

/** A field block used in the stacked mobile reflow (visible label + value). */
function MobileField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:hidden">
      <span className="text-overline font-semibold uppercase text-content-muted">
        {label}
      </span>
      <span className="text-body-sm text-content-secondary">{children}</span>
    </div>
  );
}

function TaskRow({
  row,
  labels,
  index,
  focusIndex,
  onFocusIndexChange,
  onSelectTask,
  registerRef,
}: {
  row: RunbookFlowRow;
  labels: RunbookTaskFlowLabels;
  index: number;
  focusIndex: number;
  onFocusIndexChange: (i: number) => void;
  onSelectTask?: (task: DRRunbookTask) => void;
  registerRef: (el: HTMLLIElement | null, i: number) => void;
}) {
  const { task, taskType, status } = row;
  const TypeIcon = TASK_TYPE_ICON[taskType];
  const StatusIcon = STATUS_ICON[status];
  const interactive = Boolean(onSelectTask);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLLIElement>) => {
    if (interactive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelectTask?.(task);
    }
  };

  const actionText =
    taskType === 'automated' && task.automation_action
      ? task.automation_action
      : task.instructions;

  return (
    <li
      ref={(el) => registerRef(el, index)}
      role="listitem"
      tabIndex={index === focusIndex ? 0 : -1}
      aria-current={row.onCriticalPath ? 'step' : undefined}
      aria-label={`${row.sequence}. ${task.name} — ${labels.taskTypes[taskType]}, ${labels.statuses[status]}${
        row.onCriticalPath ? `, ${labels.onCriticalPath}` : ''
      }`}
      onFocus={() => onFocusIndexChange(index)}
      onClick={interactive ? () => onSelectTask?.(task) : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'group grid gap-3 rounded-card border bg-surface-card px-card-padding py-3 text-start outline-none',
        'grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)]',
        'sm:items-center',
        'transition-shadow duration-fast ease-standard',
        'focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
        interactive && 'cursor-pointer hover:shadow-elevation-2',
        row.onCriticalPath
          ? 'border-brand-gold-500/60 shadow-elevation-1 ring-1 ring-inset ring-brand-gold-500/30'
          : 'border-outline-subtle',
      )}
    >
      {/* WHEN: sequence index */}
      <div className="flex items-center gap-2 sm:justify-center">
        <span
          className={cn(
            'inline-flex h-7 min-w-7 items-center justify-center rounded-pill px-1.5 text-body-sm font-semibold tabular-nums',
            row.onCriticalPath
              ? 'bg-brand-gold-500/20 text-brand-gold-700'
              : 'bg-bg-subtle text-content-secondary',
          )}
          aria-hidden="true"
        >
          {row.sequence}
        </span>
        {row.onCriticalPath ? (
          <span className="sm:hidden">
            <StatusChip tone="warning" size="sm" label={labels.criticalPath} />
          </span>
        ) : null}
      </div>

      {/* WHAT: task name + type + action */}
      <div className="flex min-w-0 items-start gap-3">
        <IconBadge
          icon={TypeIcon}
          tone={TASK_TYPE_TONE[taskType]}
          size="sm"
          label={labels.taskTypes[taskType]}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-semibold text-content-primary">
              {task.name}
            </span>
            <StatusChip
              tone={STATUS_TONE[status]}
              size="sm"
              icon={StatusIcon}
              label={labels.statuses[status]}
            />
            {row.onCriticalPath ? (
              <span className="hidden sm:inline-flex">
                <StatusChip
                  tone="warning"
                  size="sm"
                  label={labels.criticalPath}
                />
              </span>
            ) : null}
            <StatusChip
              tone="neutral"
              size="sm"
              label={task.required ? labels.required : labels.optional}
            />
          </div>
          <p className="mt-1 line-clamp-2 text-body-sm text-content-secondary">
            <span className="font-medium text-content-muted">
              {labels.action}:{' '}
            </span>
            {actionText}
          </p>
          <p className="mt-0.5 text-caption text-content-muted">
            {labels.taskTypes[taskType]} · {task.task_key}
          </p>
        </div>
      </div>

      {/* WHO: owner + team */}
      <div className="flex flex-col gap-1">
        <MobileField label={labels.owner}>{task.owner || '—'}</MobileField>
        <span className="hidden items-center gap-1.5 text-body-sm text-content-secondary sm:flex">
          <Users className="size-3.5 shrink-0 text-content-muted" aria-hidden="true" />
          <span className="truncate">{task.owner || '—'}</span>
        </span>
        <span className="hidden truncate text-caption text-content-muted sm:block">
          {task.team || '—'}
        </span>
        <MobileField label={labels.team}>{task.team || '—'}</MobileField>
      </div>

      {/* WHEN: dependencies */}
      <div className="flex flex-col gap-1">
        <span className="text-overline font-semibold uppercase text-content-muted sm:hidden">
          {labels.dependencies}
        </span>
        {row.predecessorKeys.length > 0 ? (
          <div
            role="group"
            className="flex flex-wrap gap-1"
            aria-label={`${labels.dependencies}: ${task.name}`}
          >
            {row.predecessorKeys.map((key) => (
              <StatusChip key={key} tone="neutral" size="sm" label={key} />
            ))}
          </div>
        ) : (
          <span className="text-body-sm text-content-muted">
            {labels.noDependencies}
          </span>
        )}
      </div>

      {/* WHEN: planned vs actual timing */}
      <div className="flex flex-col gap-1 sm:items-end sm:text-end">
        <span className="text-body-sm tabular-nums text-content-secondary">
          <span className="text-content-muted sm:hidden">{labels.planned}: </span>
          {formatDurationSeconds(task.planned_duration_seconds)}
        </span>
        <span className="text-caption tabular-nums text-content-muted">
          {labels.actual}:{' '}
          {row.taskRun?.actual_duration_seconds != null
            ? formatDurationSeconds(row.taskRun.actual_duration_seconds)
            : '—'}
        </span>
      </div>
    </li>
  );
}

export function RunbookTaskFlow({
  tasks,
  taskRuns = [],
  projection,
  labels,
  title,
  description,
  onSelectTask,
  className,
}: RunbookTaskFlowProps) {
  const { rows, criticalPath } = React.useMemo(
    () => buildRunbookFlow(tasks, taskRuns),
    [tasks, taskRuns],
  );

  const [focusIndex, setFocusIndex] = React.useState(0);
  const rowRefs = React.useRef<Array<HTMLLIElement | null>>([]);

  const registerRef = React.useCallback(
    (el: HTMLLIElement | null, i: number) => {
      rowRefs.current[i] = el;
    },
    [],
  );

  const moveFocus = React.useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, next));
      setFocusIndex(clamped);
      rowRefs.current[clamped]?.focus();
    },
    [rows.length],
  );

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLOListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(focusIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(focusIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(rows.length - 1);
        break;
      default:
        break;
    }
  };

  const completedCount = rows.filter(
    (r) => r.status === 'complete' || r.status === 'skipped',
  ).length;

  return (
    <Card className={cn('overflow-hidden', className)}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="space-y-gutter">
        {/* Summary strip — token-driven MetricTiles. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label={labels.totalTasks}
            value={rows.length}
            icon={Flag}
            tone="primary"
          />
          <MetricTile
            label={labels.criticalPathDuration}
            value={formatDurationSeconds(criticalPath.totalSeconds)}
            icon={ShieldCheck}
            tone="warning"
          />
          <MetricTile
            label={labels.completed}
            value={`${completedCount} / ${rows.length}`}
            icon={CheckCircle2}
            tone="success"
          />
          {projection ? (
            (() => {
              // The backend RunProjection already computes the projected total
              // finish and the on-track verdict over the live sub-DAG of
              // outstanding work — consume them directly, never re-derive.
              const projectedFinish = projection.projected_finish_seconds;
              const onTrack = projection.on_track;
              return (
                <MetricTile
                  label={labels.projectedFinish}
                  value={formatDurationSeconds(projectedFinish)}
                  icon={onTrack ? CheckCircle2 : XCircle}
                  tone={onTrack ? 'success' : 'danger'}
                  deltaLabel={onTrack ? labels.onTrack : labels.behindSchedule}
                />
              );
            })()
          ) : (
            <MetricTile
              label={labels.criticalPath}
              value={`${criticalPath.path.length}`}
              icon={ShieldCheck}
              tone="warning"
            />
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Flag}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
            size="compact"
          />
        ) : (
          <ol
            role="list"
            aria-label={labels.listAriaLabel}
            onKeyDown={handleListKeyDown}
            className="flex flex-col gap-2"
          >
            {rows.map((row, index) => (
              <TaskRow
                key={row.task.id}
                row={row}
                labels={labels}
                index={index}
                focusIndex={focusIndex}
                onFocusIndexChange={setFocusIndex}
                onSelectTask={onSelectTask}
                registerRef={registerRef}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default RunbookTaskFlow;
