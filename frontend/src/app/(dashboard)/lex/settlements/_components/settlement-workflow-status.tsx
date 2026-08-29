/**
 * FEATURE 11 UI — Settlement approval workflow status.
 *
 * Read-only window onto the shared Go workflow engine for a settlement that has
 * been submitted for approval. It is only meaningful when a settlement is in
 * `pending_approval` AND carries a `workflow_instance_id`; the detail-page
 * integrator renders <SettlementWorkflowStatus workflowInstanceId={...}/> under
 * exactly that guard, so this component assumes a non-empty id and focuses on
 * presenting:
 *
 *   1. the current workflow instance status (+ current step), and
 *   2. the open human task(s) on this instance — assignee / role and when they
 *      were created (surfaced from the caller's own task queue, filtered to this
 *      instance, since the shared task list endpoint scopes to the current user), and
 *   3. a short decision / step history rendered as a Timeline from the instance's
 *      step executions (newest activity last, matching engine ordering).
 *
 * It reuses the existing workflow READ clients/hooks rather than re-deriving the
 * HTTP surface:
 *   useWorkflowInstance(id)         -> WorkflowInstance       (status + current step)
 *   useWorkflowInstanceHistory(id)  -> { steps: StepExecution[] }  (decision history)
 * and reads the caller's open tasks via the shared `WORKFLOWS_TASKS` endpoint.
 *
 * Self-contained bilingual labels (English + professional MSA) per the lex
 * bilingual contract. Legal/workflow glossary: تسوية (settlement),
 * سير العمل (workflow), موافقة (approval), مهمة (task), قرار (decision).
 *
 * Module-build constraints: this file only; no edits to page.tsx / [id]/page.tsx
 * / settlements.ts; RTL logical props throughout.
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  GitBranch,
  Loader2,
  PauseCircle,
  UserCheck,
  Workflow,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Timeline } from '@/components/shared/timeline';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  useWorkflowInstance,
  useWorkflowInstanceHistory,
} from '@/hooks/use-workflow-instances-ext';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTime } from '@/lib/format';
import type {
  HumanTask,
  StepExecution,
  StepStatus,
  WorkflowInstanceStatus,
} from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import type { AppLocale } from '@/lib/i18n';
import { resolveLexBilingual, type LexBilingual } from '../../_lib/lex-i18n';
import { useApprovalTaskLabel } from '../../service-desk/_components/lex-enums-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained, per the lex bilingual contract).
 * ------------------------------------------------------------------------- */

interface SettlementWorkflowLabels {
  title: string;
  description: string;
  loading: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Current-status section. */
  currentStatus: string;
  currentStep: string;
  startedAt: string;
  completedAt: string;
  startedBy: string;
  progress: (done: number, total: number) => string;
  errorLabel: string;
  /** Open-task section. */
  openTasksTitle: string;
  noOpenTasksTitle: string;
  noOpenTasksDescription: string;
  tasksLoadError: string;
  assignee: string;
  assigneeRole: string;
  claimedBy: string;
  unassigned: string;
  created: string;
  slaDeadline: string;
  slaBreached: string;
  /** History section. */
  historyTitle: string;
  historyLoadError: string;
  historyEmptyTitle: string;
  historyEmptyDescription: string;
  startedStep: string;
  /** Maps (keyed by raw backend token; both locales share the key set). */
  instanceStatusLabels: Record<string, string>;
  stepStatusLabels: Record<string, string>;
  taskStatusLabels: Record<string, string>;
}

const settlementWorkflowLabelsBundle: LexBilingual<SettlementWorkflowLabels> = {
  en: {
    title: 'Approval Workflow',
    description: 'Live state of the settlement approval workflow, open tasks, and decision history.',
    loading: 'Loading approval workflow…',
    loadError: 'Failed to load the approval workflow.',
    emptyTitle: 'No approval workflow',
    emptyDescription: 'This settlement is not currently routed through an approval workflow.',
    currentStatus: 'Status',
    currentStep: 'Current step',
    startedAt: 'Started',
    completedAt: 'Completed',
    startedBy: 'Started by',
    progress: (done, total) => `${done} of ${total} steps`,
    errorLabel: 'Error',
    openTasksTitle: 'Open Tasks',
    noOpenTasksTitle: 'No open tasks for you',
    noOpenTasksDescription:
      'There are no pending approval tasks assigned to you on this workflow. Another approver may still be deciding.',
    tasksLoadError: 'Failed to load open tasks.',
    assignee: 'Assignee',
    assigneeRole: 'Role',
    claimedBy: 'Claimed by',
    unassigned: 'Unassigned',
    created: 'Created',
    slaDeadline: 'Due',
    slaBreached: 'SLA breached',
    historyTitle: 'Decision History',
    historyLoadError: 'Failed to load the decision history.',
    historyEmptyTitle: 'No history yet',
    historyEmptyDescription: 'No workflow steps have executed yet.',
    startedStep: 'Started',
    instanceStatusLabels: {
      running: 'In progress',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      suspended: 'Suspended',
    },
    stepStatusLabels: {
      completed: 'Completed',
      running: 'Running',
      failed: 'Failed',
      pending: 'Pending',
      skipped: 'Skipped',
      cancelled: 'Cancelled',
    },
    taskStatusLabels: {
      pending: 'Pending',
      claimed: 'Claimed',
      completed: 'Completed',
      rejected: 'Rejected',
      escalated: 'Escalated',
      cancelled: 'Cancelled',
    },
  },
  ar: {
    title: 'سير عمل الموافقة',
    description: 'الحالة المباشرة لسير عمل الموافقة على التسوية، والمهام المفتوحة، وسجل القرارات.',
    loading: 'جارٍ تحميل سير عمل الموافقة…',
    loadError: 'تعذّر تحميل سير عمل الموافقة.',
    emptyTitle: 'لا يوجد سير عمل موافقة',
    emptyDescription: 'لا تمر هذه التسوية حاليًا عبر سير عمل موافقة.',
    currentStatus: 'الحالة',
    currentStep: 'الخطوة الحالية',
    startedAt: 'بدأ',
    completedAt: 'اكتمل',
    startedBy: 'بدأه',
    progress: (done, total) => `${done} من ${total} خطوات`,
    errorLabel: 'خطأ',
    openTasksTitle: 'المهام المفتوحة',
    noOpenTasksTitle: 'لا توجد مهام مفتوحة لك',
    noOpenTasksDescription:
      'لا توجد مهام موافقة معلّقة مُسندة إليك في سير العمل هذا. قد يكون مُعتمِد آخر بصدد اتخاذ القرار.',
    tasksLoadError: 'تعذّر تحميل المهام المفتوحة.',
    assignee: 'المُسنَد إليه',
    assigneeRole: 'الدور',
    claimedBy: 'استلمها',
    unassigned: 'غير مُسند',
    created: 'أُنشئت',
    slaDeadline: 'الاستحقاق',
    slaBreached: 'تجاوز مهلة الخدمة',
    historyTitle: 'سجل القرارات',
    historyLoadError: 'تعذّر تحميل سجل القرارات.',
    historyEmptyTitle: 'لا يوجد سجل بعد',
    historyEmptyDescription: 'لم تُنفَّذ أي خطوات في سير العمل بعد.',
    startedStep: 'بدأت',
    instanceStatusLabels: {
      running: 'قيد التنفيذ',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
      suspended: 'مُعلَّق',
    },
    stepStatusLabels: {
      completed: 'مكتملة',
      running: 'قيد التشغيل',
      failed: 'فاشلة',
      pending: 'معلّقة',
      skipped: 'متجاوَزة',
      cancelled: 'ملغاة',
    },
    taskStatusLabels: {
      pending: 'معلّقة',
      claimed: 'مُستلَمة',
      completed: 'مكتملة',
      rejected: 'مرفوضة',
      escalated: 'مُصعَّدة',
      cancelled: 'ملغاة',
    },
  },
};

function useSettlementWorkflowLabels(): { labels: SettlementWorkflowLabels; locale: AppLocale; direction: 'rtl' | 'ltr' } {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMemo(
    () => resolveLexBilingual(settlementWorkflowLabelsBundle, locale),
    [locale],
  );
  return { labels, locale, direction };
}

/** Humanize a raw token (`pending_approval` -> `Pending Approval`) as a fallback. */
function formatToken(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/* ------------------------------------------------------------------------- *
 * Status -> tone mapping (badge variant + accent + icon).
 * ------------------------------------------------------------------------- */

type Tone = 'success' | 'warning' | 'error' | 'default';

const INSTANCE_STATUS_TONE: Record<WorkflowInstanceStatus, Tone> = {
  running: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'error',
  suspended: 'default',
};

const INSTANCE_STATUS_ICON: Record<WorkflowInstanceStatus, LucideIcon> = {
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
  suspended: PauseCircle,
};

const STEP_STATUS_TONE: Record<StepStatus, Tone> = {
  completed: 'success',
  running: 'warning',
  failed: 'error',
  pending: 'default',
  skipped: 'default',
  cancelled: 'error',
};

const STEP_STATUS_ICON: Record<StepStatus, LucideIcon> = {
  completed: CheckCircle2,
  running: Loader2,
  failed: XCircle,
  pending: CircleDashed,
  skipped: CircleDashed,
  cancelled: XCircle,
};

function badgeVariant(tone: Tone): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (tone) {
    case 'success':
      return 'default';
    case 'error':
      return 'destructive';
    case 'warning':
      return 'secondary';
    default:
      return 'outline';
  }
}

function accentClass(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'bg-success-300/70';
    case 'error':
      return 'bg-destructive/60';
    case 'warning':
      return 'bg-warning-300/70';
    default:
      return 'bg-sky-400/70';
  }
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface SettlementWorkflowStatusProps {
  /**
   * The settlement's `workflow_instance_id`. The detail integrator only renders
   * this component when the settlement is `pending_approval` AND has a non-empty
   * instance id, but the component still self-guards on an empty id.
   */
  workflowInstanceId: string;
}

export function SettlementWorkflowStatus({ workflowInstanceId }: SettlementWorkflowStatusProps) {
  const { labels, locale, direction } = useSettlementWorkflowLabels();
  // Resolve workflow step / human-task NAMES (which the engine stores as English
  // literals, e.g. "Settlement Approval" / "Approve settlement") to localized
  // labels so the Arabic panel does not render raw English. Unknown names fall
  // back to a prettified token, matching the prior formatToken behaviour.
  const resolveTaskLabel = useApprovalTaskLabel();

  const enabled = Boolean(workflowInstanceId);

  const instanceQuery = useWorkflowInstance(workflowInstanceId);
  const historyQuery = useWorkflowInstanceHistory(workflowInstanceId);

  // The shared task list endpoint scopes to the current user AND federates across
  // the suite databases (the engine's FederatedTaskReader), so the settlement
  // approval task that lex writes to lex_db is surfaced here even though the engine
  // primary store is a different database. We pull the caller's open
  // (pending/claimed) tasks and filter to this instance to surface the actionable
  // approval task(s) with assignee/role/created.
  const tasksQuery = useQuery({
    queryKey: ['settlement-workflow-tasks', workflowInstanceId],
    queryFn: () =>
      apiGet<PaginatedResponse<HumanTask>>(API_ENDPOINTS.WORKFLOWS_TASKS, {
        status: 'pending,claimed',
        per_page: 100,
        sort: 'created_at',
        order: 'desc',
      }),
    enabled,
  });

  const instance = instanceQuery.data;
  const steps = useMemo<StepExecution[]>(
    () => historyQuery.data?.steps ?? [],
    [historyQuery.data],
  );

  const openTasks = useMemo<HumanTask[]>(() => {
    const all = tasksQuery.data?.data ?? [];
    return all.filter(
      (task) =>
        task.instance_id === workflowInstanceId &&
        (task.status === 'pending' || task.status === 'claimed' || task.status === 'escalated'),
    );
  }, [tasksQuery.data, workflowInstanceId]);

  const timelineItems = useMemo(
    () =>
      steps.map((step) => {
        const status = (step.status ?? 'pending') as StepStatus;
        const tone = STEP_STATUS_TONE[status] ?? 'default';
        const Icon = STEP_STATUS_ICON[status] ?? CircleDashed;
        const stepLabel = labels.stepStatusLabels[status] ?? formatToken(status);
        const ts = step.completed_at ?? step.started_at ?? step.created_at ?? null;
        return {
          id: step.id,
          icon: Icon,
          variant: tone,
          title: resolveTaskLabel(step.step_name?.trim() || step.step_id || step.step_type || ''),
          description: stepLabel,
          timestamp: ts ? formatDateTime(ts) : labels.startedStep,
        };
      }),
    [steps, labels, resolveTaskLabel],
  );

  // ---- Loading / empty / error (top-level on the instance) ----------------

  if (!enabled) {
    return (
      <SectionCard title={labels.title} description={labels.description}>
        <div dir={direction} lang={locale}>
          <EmptyState
            icon={Workflow}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={labels.title} description={labels.description}>
      <div dir={direction} lang={locale} className="space-y-6">
        {/* --- Current status --- */}
        {instanceQuery.isLoading ? (
          <LoadingSkeleton variant="card" count={1} />
        ) : instanceQuery.isError ? (
          <ErrorState message={labels.loadError} onRetry={() => void instanceQuery.refetch()} />
        ) : !instance ? (
          <EmptyState
            icon={Workflow}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : (
          <InstanceStatusBlock instance={instance} labels={labels} />
        )}

        {/* --- Open tasks --- */}
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
            {labels.openTasksTitle}
          </h3>
          {tasksQuery.isLoading ? (
            <LoadingSkeleton variant="list-item" count={2} />
          ) : tasksQuery.isError ? (
            <ErrorState message={labels.tasksLoadError} onRetry={() => void tasksQuery.refetch()} />
          ) : openTasks.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title={labels.noOpenTasksTitle}
              description={labels.noOpenTasksDescription}
            />
          ) : (
            <div className="space-y-3">
              {openTasks.map((task) => (
                <OpenTaskRow key={task.id} task={task} labels={labels} />
              ))}
            </div>
          )}
        </div>

        {/* --- Decision history --- */}
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden />
            {labels.historyTitle}
          </h3>
          {historyQuery.isLoading ? (
            <LoadingSkeleton variant="list-item" count={3} />
          ) : historyQuery.isError ? (
            <ErrorState
              message={labels.historyLoadError}
              onRetry={() => void historyQuery.refetch()}
            />
          ) : timelineItems.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={labels.historyEmptyTitle}
              description={labels.historyEmptyDescription}
            />
          ) : (
            <Timeline items={timelineItems} />
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Current-status block.
 * ------------------------------------------------------------------------- */

interface InstanceStatusBlockProps {
  instance: NonNullable<ReturnType<typeof useWorkflowInstance>['data']>;
  labels: SettlementWorkflowLabels;
}

function InstanceStatusBlock({ instance, labels }: InstanceStatusBlockProps) {
  const resolveTaskLabel = useApprovalTaskLabel();
  const status = instance.status;
  const tone = INSTANCE_STATUS_TONE[status] ?? 'default';
  const Icon = INSTANCE_STATUS_ICON[status] ?? CircleDashed;
  const statusLabel = labels.instanceStatusLabels[status] ?? formatToken(status);
  const spin = status === 'running';

  const totalSteps = instance.total_steps ?? instance.definition_steps?.length ?? 0;
  const completedSteps = instance.completed_steps ?? 0;

  return (
    <div className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
      <span className={`absolute inset-y-0 start-0 w-1 ${accentClass(tone)}`} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Icon
              className={`h-4 w-4 shrink-0 text-muted-foreground ${spin ? 'animate-spin' : ''}`}
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">{labels.currentStatus}</span>
            <Badge variant={badgeVariant(tone)}>{statusLabel}</Badge>
          </div>

          {instance.current_step_name || instance.current_step_id ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{labels.currentStep}: </span>
              <span className="font-medium">
                {resolveTaskLabel(instance.current_step_name?.trim() || instance.current_step_id || '')}
              </span>
            </p>
          ) : null}

          {totalSteps > 0 ? (
            <p className="text-xs text-muted-foreground">
              {labels.progress(completedSteps, totalSteps)}
            </p>
          ) : null}

          {instance.error_message ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-medium">{labels.errorLabel}:</span> {instance.error_message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1 text-end text-xs text-muted-foreground">
          {instance.started_at ? (
            <p>
              {labels.startedAt}: <RelativeTime date={instance.started_at} />
            </p>
          ) : null}
          {instance.completed_at ? (
            <p>
              {labels.completedAt}: <RelativeTime date={instance.completed_at} />
            </p>
          ) : null}
          {instance.started_by_name || instance.started_by ? (
            <p>
              {labels.startedBy}: {instance.started_by_name ?? instance.started_by}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Open-task row.
 * ------------------------------------------------------------------------- */

interface OpenTaskRowProps {
  task: HumanTask;
  labels: SettlementWorkflowLabels;
}

function OpenTaskRow({ task, labels }: OpenTaskRowProps) {
  const resolveTaskLabel = useApprovalTaskLabel();
  const statusLabel = labels.taskStatusLabels[task.status] ?? formatToken(task.status);
  const tone: Tone = task.sla_breached
    ? 'error'
    : task.status === 'escalated'
      ? 'error'
      : task.status === 'claimed'
        ? 'warning'
        : 'default';

  const assigneeName = task.claimed_by_name ?? task.claimed_by ?? null;

  return (
    <div className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
      <span className={`absolute inset-y-0 start-0 w-1 ${accentClass(tone)}`} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{resolveTaskLabel(task.name || task.step_id)}</span>
            <Badge variant={badgeVariant(tone)}>{statusLabel}</Badge>
            {task.sla_breached ? (
              <Badge variant="destructive">{labels.slaBreached}</Badge>
            ) : null}
          </div>

          {task.description ? (
            <p className="text-xs text-muted-foreground">{task.description}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {assigneeName ? (
              <Badge variant="outline">
                {labels.claimedBy}: {assigneeName}
              </Badge>
            ) : task.assignee_id ? (
              <Badge variant="outline">
                {labels.assignee}: {task.assignee_id}
              </Badge>
            ) : (
              <Badge variant="outline">{labels.unassigned}</Badge>
            )}
            {task.assignee_role ? (
              <Badge variant="outline">
                {labels.assigneeRole}: {formatToken(task.assignee_role)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-1 text-end text-xs text-muted-foreground">
          <p>
            {labels.created}: <RelativeTime date={task.created_at} />
          </p>
          {task.sla_deadline ? (
            <p className={task.sla_breached ? 'text-destructive' : undefined}>
              {labels.slaDeadline}: {formatDateTime(task.sla_deadline)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
