'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import type { ReactNode } from 'react';
import {
  CalendarClock,
  ClipboardList,
  FileText,
  GaugeCircle,
  Gavel,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { useLexFormat } from '@/lib/lex/ksa';
import { formatCaseToken, type LegalCase } from '@/lib/lex/cases';
import { cn } from '@/lib/utils';
import { useCaseLabels } from '../labels';
import { useDetailWorkspaceLabels } from './workspace-labels';
import type { DeadlineItem } from './workflow-metrics';

interface CaseCommandHeaderProps {
  legalCase: LegalCase;
  deadlines: DeadlineItem[];
  hearingCount: number;
  taskCount: number;
  canWrite: boolean;
  onEditCase: () => void;
  onOpenIntake: () => void;
  onSetStrength: () => void;
  onChangeStatus: () => void;
  onOpenTab: (tab: string) => void;
}

type CommandActionState = 'needed' | 'watch' | 'open' | 'done';

interface CommandAction {
  id: string;
  label: string;
  detail: string;
  icon: ReactNode;
  state: CommandActionState;
  disabled?: boolean;
  onClick: () => void;
}

export function CaseCommandHeader({
  legalCase,
  deadlines,
  hearingCount,
  taskCount,
  canWrite,
  onEditCase,
  onOpenIntake,
  onSetStrength,
  onChangeStatus,
  onOpenTab,
}: CaseCommandHeaderProps) {
  const labels = useCaseLabels();
  const workspaceLabels = useDetailWorkspaceLabels();
  const f = useLexFormat();
  const t = workspaceLabels.command;
  const nextDeadline = deadlines[0] ?? null;
  const statusLabel =
    labels.filters.statusOptions[legalCase.status] ?? formatCaseToken(legalCase.status);
  const priorityLabel =
    labels.filters.priorityOptions[legalCase.priority] ?? formatCaseToken(legalCase.priority);
  const strengthLabel = legalCase.strength
    ? labels.filters.strengthOptions[legalCase.strength] ?? formatCaseToken(legalCase.strength)
    : t.notSet;
  const owner = legalCase.responsible_lawyer || legalCase.department || t.unassigned;
  const actions = buildCommandActions({
    legalCase,
    statusLabel,
    nextDeadline,
    hearingCount,
    taskCount,
    canWrite,
    labels: t,
    formatDeadlineDate: (value) => f.formatDate(value),
    onEditCase,
    onOpenIntake,
    onSetStrength,
    onChangeStatus,
    onOpenTab,
  });
  const openActionCount = actions.filter((action) => action.state === 'needed' || action.state === 'watch').length;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t.title}</Badge>
            <LexPriorityChip
              value={legalCase.priority}
              labels={labels.filters.priorityOptions}
              size="md"
            />
            <LexStatusChip
              value={legalCase.status}
              domain="case"
              labels={labels.filters.statusOptions}
              size="md"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <CommandMetric
              label={t.status}
              value={statusLabel}
              icon={<RefreshCw className="h-4 w-4" />}
              onAction={canWrite ? onChangeStatus : () => onOpenTab('overview')}
            />
            <CommandMetric
              label={t.priority}
              value={priorityLabel}
              icon={<ShieldAlert className="h-4 w-4" />}
              onAction={canWrite ? onEditCase : () => onOpenTab('overview')}
            />
            <CommandMetric
              label={t.strength}
              value={strengthLabel}
              icon={<GaugeCircle className="h-4 w-4" />}
              onAction={canWrite ? onSetStrength : () => onOpenTab('overview')}
            />
            <CommandMetric
              label={t.owner}
              value={owner}
              icon={<UserRound className="h-4 w-4" />}
              onAction={canWrite ? onEditCase : () => onOpenTab('overview')}
            />
            <CommandMetric
              label={t.nextCriticalDate}
              value={
                nextDeadline ? (
                  <span className="space-y-0.5">
                    <span className="block tabular-nums">{f.formatDate(nextDeadline.date)}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {f.formatHijri(nextDeadline.date)}
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      <RelativeTime date={nextDeadline.date} />
                    </span>
                  </span>
                ) : (
                  t.noneScheduled
                )
              }
              icon={<CalendarClock className="h-4 w-4" />}
              onAction={() => onOpenTab(openTabForDeadline(nextDeadline))}
            />
          </div>
        </div>
        <div className="w-full shrink-0 xl:w-[460px]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t.nextBestActions}</p>
            <Badge variant={openActionCount > 0 ? 'warning' : 'success'}>{t.pendingActions(openActionCount)}</Badge>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {actions.map((commandAction) => (
              <CommandActionButton key={commandAction.id} action={commandAction} labels={t} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommandMetric({
  label,
  value,
  icon,
  onAction,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      title={statisticHint(label)}
      className="min-w-0 rounded-md border bg-muted/20 px-3 py-2 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
    </button>
  );
}

function CommandActionButton({
  action,
  labels,
}: {
  action: CommandAction;
  labels: ReturnType<typeof useDetailWorkspaceLabels>['command'];
}) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md border bg-card/70 px-3 py-2 text-start transition hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-55',
        action.state === 'needed' && 'border-error-100 bg-error-50/70 hover:bg-error-50 dark:bg-error-700/10',
        action.state === 'watch' && 'border-warning-100 bg-warning-50/70 hover:bg-warning-50 dark:bg-warning-800/10',
      )}
    >
      <span className="mt-0.5 text-primary">{action.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">{action.label}</span>
          <Badge variant={actionStateVariant(action.state)}>{actionStateLabel(action.state, labels)}</Badge>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{action.detail}</span>
      </span>
    </button>
  );
}

function openTabForDeadline(item: DeadlineItem | null): string {
  if (!item) return 'timeline';
  if (item.type === 'task') return 'tasks';
  if (item.type === 'hearing') return 'hearings';
  if (item.type === 'expert') return 'experts';
  if (item.type === 'judgment') return 'judgments';
  return 'timeline';
}

function buildCommandActions({
  legalCase,
  statusLabel,
  nextDeadline,
  hearingCount,
  taskCount,
  canWrite,
  labels,
  formatDeadlineDate,
  onEditCase,
  onOpenIntake,
  onSetStrength,
  onChangeStatus,
  onOpenTab,
}: {
  legalCase: LegalCase;
  statusLabel: string;
  nextDeadline: DeadlineItem | null;
  hearingCount: number;
  taskCount: number;
  canWrite: boolean;
  labels: ReturnType<typeof useDetailWorkspaceLabels>['command'];
  formatDeadlineDate: (value: string) => string;
  onEditCase: () => void;
  onOpenIntake: () => void;
  onSetStrength: () => void;
  onChangeStatus: () => void;
  onOpenTab: (tab: string) => void;
}): CommandAction[] {
  const intakeNeeded = legalCase.status === 'intake';
  const ownerMissing = !legalCase.responsible_lawyer;
  const strengthMissing = !legalCase.strength;
  const deadlineNeedsReview = Boolean(nextDeadline && nextDeadline.daysUntil <= 7);
  const statusLocked = legalCase.status === 'closed' || legalCase.status === 'cancelled';

  return [
    {
      id: 'intake',
      label: labels.completeIntake,
      detail: canWrite ? (intakeNeeded ? labels.intakeRequired : labels.intakeComplete) : labels.writeRequired,
      icon: <ClipboardList className="h-4 w-4" />,
      state: intakeNeeded ? 'needed' : 'done',
      onClick: onOpenIntake,
      disabled: !canWrite || !intakeNeeded,
    },
    {
      id: 'owner',
      label: labels.assignOwner,
      detail: canWrite ? (ownerMissing ? labels.ownerMissing : legalCase.responsible_lawyer ?? labels.ownerReady) : labels.writeRequired,
      icon: <UserRound className="h-4 w-4" />,
      state: ownerMissing ? 'needed' : 'done',
      onClick: onEditCase,
      disabled: !canWrite,
    },
    {
      id: 'strength',
      label: labels.setStrength,
      detail: canWrite ? (strengthMissing ? labels.strengthMissing : labels.strengthReady) : labels.writeRequired,
      icon: <GaugeCircle className="h-4 w-4" />,
      state: strengthMissing ? 'needed' : 'done',
      onClick: onSetStrength,
      disabled: !canWrite,
    },
    {
      id: 'deadline',
      label: labels.reviewDeadline,
      detail: nextDeadline ? labels.deadlineDue(deadlineActionLabel(nextDeadline, formatDeadlineDate)) : labels.noDeadline,
      icon: <CalendarClock className="h-4 w-4" />,
      state: deadlineNeedsReview ? (nextDeadline && nextDeadline.daysUntil <= 2 ? 'needed' : 'watch') : nextDeadline ? 'open' : 'done',
      onClick: () => onOpenTab(openTabForDeadline(nextDeadline)),
      disabled: !nextDeadline,
    },
    {
      id: 'status',
      label: labels.updateStatus,
      detail: canWrite ? statusLabel : labels.writeRequired,
      icon: <RefreshCw className="h-4 w-4" />,
      state: statusLocked ? 'done' : legalCase.status === 'intake' ? 'watch' : 'open',
      onClick: onChangeStatus,
      disabled: !canWrite || statusLocked,
    },
    {
      id: 'hearing',
      label: labels.recordHearing,
      detail: hearingCount > 0 ? labels.hearingTracked(hearingCount) : labels.hearingMissing,
      icon: <Gavel className="h-4 w-4" />,
      state: hearingCount > 0 ? 'open' : 'watch',
      onClick: () => onOpenTab('hearings'),
    },
    {
      id: 'task',
      label: labels.recordTask,
      detail: taskCount > 0 ? labels.taskTracked(taskCount) : labels.taskMissing,
      icon: <ListChecks className="h-4 w-4" />,
      state: taskCount > 0 ? 'open' : 'watch',
      onClick: () => onOpenTab('tasks'),
    },
    {
      id: 'document',
      label: labels.recordDocument,
      detail: labels.documentReady,
      icon: <FileText className="h-4 w-4" />,
      state: 'open',
      onClick: () => onOpenTab('documents'),
    },
  ];
}

function deadlineActionLabel(item: DeadlineItem, formatDate: (value: string) => string): string {
  return `${formatDate(item.date)} · ${item.title}`;
}

function actionStateLabel(
  state: CommandActionState,
  labels: ReturnType<typeof useDetailWorkspaceLabels>['command'],
): string {
  if (state === 'needed') return labels.needed;
  if (state === 'watch') return labels.watch;
  if (state === 'done') return labels.done;
  return labels.open;
}

function actionStateVariant(state: CommandActionState): 'destructive' | 'warning' | 'success' | 'outline' {
  if (state === 'needed') return 'destructive';
  if (state === 'watch') return 'warning';
  if (state === 'done') return 'success';
  return 'outline';
}
