'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/format';
import type {
  Investigation,
  InvestigationApprovalTask,
  InvestigationAuditEntry,
} from '@/lib/lex/investigations';
import { useApprovalTaskLabel } from '../../service-desk/_components/lex-enums-i18n';
import {
  formatInvestigationToken,
  type InvestigationLabels,
  useInvestigationLabels,
} from './labels';

interface InvestigationApprovalOperationsPanelProps {
  investigation: Investigation;
  approvalTasks: InvestigationApprovalTask[];
  auditEntries: InvestigationAuditEntry[];
  loading: boolean;
  error: boolean;
  canApprove: boolean;
  canStartApproval: boolean;
  decisionPending: boolean;
  onRetry: () => void;
  onDecide: (
    task: InvestigationApprovalTask,
    decision: 'approve' | 'reject',
    notes?: string,
	lateJustification?: string,
  ) => void;
}

interface ReadinessCheck {
  id: string;
  label: string;
  helper: string;
  complete: boolean;
  required?: boolean;
}

export function InvestigationApprovalOperationsPanel({
  investigation,
  approvalTasks,
  auditEntries,
  loading,
  error,
  canApprove,
  canStartApproval,
  decisionPending,
  onRetry,
  onDecide,
}: InvestigationApprovalOperationsPanelProps) {
  const labels = useInvestigationLabels();
  const ops = labels.approvalOps;
  const resolveTaskLabel = useApprovalTaskLabel();
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [lateJustifications, setLateJustifications] = useState<Record<string, string>>({});
  const readinessChecks = useMemo(
    () => buildReadinessChecks(investigation, labels),
    [investigation, labels],
  );
  const completedChecks = readinessChecks.filter((check) => check.complete).length;
  const requiredReady = readinessChecks
    .filter((check) => check.required)
    .every((check) => check.complete);
  const actionableTasks = approvalTasks.filter(isTaskActionable);
  const approvalState = approvalStateLabel(investigation, approvalTasks, canStartApproval, labels);
  const workflowId = investigation.workflow_instance_id || firstWorkflowId(approvalTasks);
  const routeNotes = readMetadataText(investigation.metadata, [
    'approval_notes',
    'approval_note',
    'routing_notes',
    'notes',
    'note',
  ]);
  const rejectionNote = findRejectionNote(investigation, auditEntries, approvalTasks);

  return (
    <div id="investigation-approval" className="scroll-mt-24">
      <SectionCard
        title={ops.title}
        description={ops.description}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {loading ? <Badge variant="outline">{ops.loading}</Badge> : null}
            {error ? (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {ops.retry}
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ApprovalMetric
              label={ops.metricApprovalState}
              value={approvalState.label}
              badge={<Badge variant={approvalState.variant}>{approvalState.badge}</Badge>}
              onAction={() => scrollToApprovalSection('investigation-approval-tasks')}
            />
            <ApprovalMetric
              label={ops.metricReadiness}
              value={ops.metricReadinessValue(completedChecks, readinessChecks.length)}
              helper={requiredReady ? ops.readinessDoneHelper : ops.readinessTodoHelper}
              onAction={() => scrollToApprovalSection('investigation-approval-readiness')}
            />
            <ApprovalMetric
              label={ops.metricWorkflow}
              value={workflowId ? ops.workflowLinked : ops.workflowNotStarted}
              helper={workflowId || ops.workflowNoInstance}
              onAction={() => scrollToApprovalSection('investigation-approval-tasks')}
            />
          </div>

          {investigation.status === 'rejected' ? (
            <GuidanceBlock tone="danger" title={ops.rejectedTitle}>
              <p>{ops.rejectedBody}</p>
              {rejectionNote ? <p className="mt-2">{ops.reviewerNote(rejectionNote)}</p> : null}
            </GuidanceBlock>
          ) : null}

          {canStartApproval ? (
            <GuidanceBlock tone="success" title={ops.readyTitle}>
              <p>{ops.readyBody}</p>
            </GuidanceBlock>
          ) : !requiredReady ? (
            <GuidanceBlock tone="warning" title={ops.readinessAttentionTitle}>
              <p>{ops.readinessAttentionBody}</p>
            </GuidanceBlock>
          ) : null}

          {routeNotes ? (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <p className="font-medium">{ops.routingNotesTitle}</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{routeNotes}</p>
            </div>
          ) : null}

          <div
            id="investigation-approval-readiness"
            className="scroll-mt-24 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
          >
            {readinessChecks.map((check) => (
              <ApprovalReadinessCheck key={check.id} check={check} />
            ))}
          </div>

          {error ? (
            <div className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:text-warning-300">
              {ops.loadIncomplete}
            </div>
          ) : null}

          <div id="investigation-approval-tasks" className="scroll-mt-24">
            {loading && approvalTasks.length === 0 ? (
              <LoadingSkeleton variant="list-item" count={2} />
            ) : approvalTasks.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title={emptyApprovalTitle(investigation, labels)}
                description={emptyApprovalDescription(investigation, labels)}
              />
            ) : (
              <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{ops.tasksTitle}</p>
                <Badge variant={actionableTasks.length > 0 ? 'warning' : 'secondary'}>
                  {ops.openCount(actionableTasks.length)}
                </Badge>
              </div>
              {approvalTasks.map((task) => {
                const notes = decisionNotes[String(task.id)] ?? '';
                const taskWorkflowId = workflowIdForTask(task, investigation);
                const actionable = isTaskActionable(task) && Boolean(taskWorkflowId);
                const rawTaskName = task.title ?? task.name;
                const taskLabel = rawTaskName ? resolveTaskLabel(rawTaskName) : String(task.id);
                const deadline = task.sla_deadline ?? task.due_at;
                const isLate = Boolean(
                  deadline && Date.now() > new Date(deadline).getTime(),
                );
                const lateJustification = lateJustifications[String(task.id)] ?? '';

                return (
                  <div
                    key={String(task.id)}
                    className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5"
                  >
                    <span
                      className={`absolute inset-y-0 start-0 w-1 ${taskAccentClass(task)}`}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{taskLabel}</p>
                        {readText(task, 'description') ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {readText(task, 'description')}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {task.status ? (
                          <Badge variant={taskStatusVariant(task.status)}>
                            {formatInvestigationToken(String(task.status))}
                          </Badge>
                        ) : null}
                        {task.assignee_role ? (
                          <Badge variant="outline">{task.assignee_role}</Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                      <TaskMeta label={ops.taskIdLabel} value={String(task.id)} fallback={ops.notSet} />
                      <TaskMeta
                        label={ops.workflowLabel}
                        value={taskWorkflowId || ops.missing}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.assigneeRoleLabel}
                        value={task.assignee_role || ops.notSet}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.assigneeUserLabel}
                        value={task.assignee_user_id || ops.notAssigned}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.createdLabel}
                        value={formatOptionalDate(task.created_at, ops)}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.dueLabel}
                        value={formatOptionalDate(deadline, ops)}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.completedLabel}
                        value={formatOptionalDate(readText(task, 'completed_at'), ops)}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.updatedLabel}
                        value={formatOptionalDate(readText(task, 'updated_at'), ops)}
                        fallback={ops.notSet}
                      />
                      <TaskMeta
                        label={ops.priorityLabel}
                        value={formatTaskPriority(task, ops)}
                        fallback={ops.notSet}
                      />
                    </div>

                    <TaskNotes task={task} ops={ops} />

                    {canApprove && actionable ? (
                      <div className="mt-4 space-y-3 rounded-md border bg-muted/10 p-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`approval-notes-${task.id}`}>
                            {ops.decisionNotesLabel}
                          </Label>
                          <Textarea
                            id={`approval-notes-${task.id}`}
                            value={notes}
                            onChange={(event) =>
                              setDecisionNotes((current) => ({
                                ...current,
                                [String(task.id)]: event.target.value,
                              }))
                            }
                            placeholder={ops.decisionNotesPlaceholder}
                            rows={2}
                          />
                        </div>
                        {isLate ? (
                          <div className="space-y-1.5 rounded-md border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
                            <Label htmlFor={`approval-late-justification-${task.id}`}>
                              Late SLA justification <span className="text-destructive">*</span>
                            </Label>
                            <Textarea
                              id={`approval-late-justification-${task.id}`}
                              value={lateJustification}
                              onChange={(event) =>
                                setLateJustifications((current) => ({
                                  ...current,
                                  [String(task.id)]: event.target.value,
                                }))
                              }
                              placeholder="Explain why the investigation decision ended after its SLA deadline."
                              rows={3}
                            />
                            <p className="text-xs text-muted-foreground">
                              Visible only to the Legal Director and Cases &amp; Investigations Manager.
                            </p>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              onDecide(
                                task,
                                'approve',
                                notes.trim() || undefined,
                                isLate ? lateJustification.trim() : undefined,
                              )
                            }
                            disabled={decisionPending || (isLate && !lateJustification.trim())}
                          >
                            {decisionPending ? (
                              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                            )}
                            {ops.approve}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              onDecide(
                                task,
                                'reject',
                                notes.trim() || undefined,
                                isLate ? lateJustification.trim() : undefined,
                              )
                            }
                            disabled={decisionPending || (isLate && !lateJustification.trim())}
                          >
                            {decisionPending ? (
                              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="me-1.5 h-3.5 w-3.5" />
                            )}
                            {ops.reject}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {canApprove && !actionable && isTaskActionable(task) ? (
                      <div className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:text-warning-300">
                        {ops.missingWorkflowWarning}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function ApprovalMetric({
  label,
  value,
  helper,
  badge,
  onAction,
}: {
  label: string;
  value: string;
  helper?: string;
  badge?: ReactNode;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      title={helper ?? statisticHint(label)}
      className="rounded-md border bg-muted/20 px-3 py-2 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-sm font-semibold">{value}</p>
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
    </button>
  );
}

function scrollToApprovalSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ApprovalReadinessCheck({ check }: { check: ReadinessCheck }) {
  const icon = check.complete ? (
    <CheckCircle2 className="h-4 w-4 text-primary" />
  ) : check.required ? (
    <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" />
  ) : (
    <CircleDashed className="h-4 w-4 text-muted-foreground" />
  );

  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/10 px-3 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{check.label}</span>
        <span className="block text-xs text-muted-foreground">{check.helper}</span>
      </span>
    </div>
  );
}

function GuidanceBlock({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : tone === 'danger'
        ? 'border-error-100 bg-error-50 text-error-700'
        : 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300';

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${toneClass}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 leading-6">{children}</div>
    </div>
  );
}

function TaskMeta({
  label,
  value,
  fallback,
}: {
  label: string;
  value?: string | null;
  fallback: string;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/10 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value || fallback}</p>
    </div>
  );
}

function TaskNotes({
  task,
  ops,
}: {
  task: InvestigationApprovalTask;
  ops: InvestigationLabels['approvalOps'];
}) {
  const noteBlocks = [
    {
      label: ops.taskNotesLabel,
      value:
        readText(task, 'notes') ??
        readMetadataText(task.metadata, ['notes', 'note', 'approval_notes', 'routing_notes']),
    },
    {
      label: ops.decisionNotesMetaLabel,
      value:
        readText(task, 'decision_notes') ??
        readMetadataText(task.metadata, [
          'decision_notes',
          'decision_note',
          'rejection_reason',
          'reject_reason',
          'reason',
          'comment',
          'comments',
        ]),
    },
  ].filter((block): block is { label: string; value: string } => Boolean(block.value));

  if (noteBlocks.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {noteBlocks.map((block) => (
        <div key={block.label} className="rounded-md border bg-muted/10 px-3 py-2 text-sm">
          <p className="font-medium">{block.label}</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{block.value}</p>
        </div>
      ))}
    </div>
  );
}

function buildReadinessChecks(
  investigation: Investigation,
  labels: InvestigationLabels,
): ReadinessCheck[] {
  const r = labels.approvalOps.readiness;
  const parties = investigation.parties ?? [];
  const statements = investigation.statements ?? [];
  const evidence = investigation.evidence ?? [];
  const approvalEligible =
    investigation.status === 'results_recorded' ||
    investigation.status === 'pending_approval' ||
    investigation.status === 'approved' ||
    investigation.status === 'closed';

  return [
    {
      id: 'status',
      label: r.status,
      helper: approvalEligible ? r.statusDoneHelper : r.statusTodoHelper,
      complete: approvalEligible,
      required: true,
    },
    {
      id: 'findings',
      label: r.findings,
      helper: isFilled(investigation.findings) ? r.findingsDoneHelper : r.findingsTodoHelper,
      complete: isFilled(investigation.findings),
      required: true,
    },
    {
      id: 'recommendations',
      label: r.recommendations,
      helper: isFilled(investigation.recommendations)
        ? r.recommendationsDoneHelper
        : r.recommendationsTodoHelper,
      complete: isFilled(investigation.recommendations),
    },
    {
      id: 'parties',
      label: r.parties,
      helper: parties.length > 0 ? r.partiesDoneHelper(parties.length) : r.partiesTodoHelper,
      complete: parties.length > 0,
    },
    {
      id: 'statements',
      label: r.statements,
      helper:
        statements.length > 0 ? r.statementsDoneHelper(statements.length) : r.statementsTodoHelper,
      complete: statements.length > 0,
    },
    {
      id: 'evidence',
      label: r.evidence,
      helper: evidence.length > 0 ? r.evidenceDoneHelper(evidence.length) : r.evidenceTodoHelper,
      complete: evidence.length > 0,
    },
  ];
}

function approvalStateLabel(
  investigation: Investigation,
  tasks: InvestigationApprovalTask[],
  canStartApproval: boolean,
  labels: InvestigationLabels,
): { label: string; badge: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' } {
  const s = labels.approvalOps.state;
  if (investigation.status === 'approved' || investigation.status === 'closed') {
    return { label: s.approved, badge: s.approvedBadge, variant: 'success' };
  }

  if (investigation.status === 'rejected') {
    return { label: s.rejected, badge: s.rejectedBadge, variant: 'destructive' };
  }

  if (investigation.status === 'pending_approval') {
    const open = tasks.filter(isTaskActionable).length;
    return {
      label: open > 0 ? s.openTasks(open) : s.pendingApproval,
      badge: s.pendingBadge,
      variant: 'warning',
    };
  }

  if (canStartApproval) {
    return { label: s.readyToRoute, badge: s.readyBadge, variant: 'success' };
  }

  return { label: s.notStarted, badge: s.notStartedBadge, variant: 'secondary' };
}

function emptyApprovalTitle(investigation: Investigation, labels: InvestigationLabels): string {
  const e = labels.approvalOps.empty;
  if (investigation.status === 'approved' || investigation.status === 'closed') {
    return e.noOpenTitle;
  }
  if (investigation.status === 'rejected') return e.noActiveTitle;
  if (investigation.status === 'pending_approval') return e.noReturnedTitle;
  return e.notStartedTitle;
}

function emptyApprovalDescription(
  investigation: Investigation,
  labels: InvestigationLabels,
): string {
  const e = labels.approvalOps.empty;
  if (investigation.status === 'rejected') {
    return e.rejectedDescription;
  }
  if (investigation.status === 'pending_approval') {
    return e.pendingDescription;
  }
  return e.defaultDescription;
}

function isTaskActionable(task: InvestigationApprovalTask): boolean {
  const completedAt = readText(task, 'completed_at');
  const status = String(task.status ?? '').toLowerCase();
  if (completedAt) return false;
  if (!status) return true;
  return ![
    'approved',
    'rejected',
    'complete',
    'completed',
    'done',
    'cancelled',
    'canceled',
    'closed',
  ].includes(status);
}

function taskStatusVariant(
  status: string,
): 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' {
  const normalized = status.toLowerCase();
  if (['approved', 'complete', 'completed', 'done'].includes(normalized)) return 'success';
  if (['rejected', 'failed', 'cancelled', 'canceled'].includes(normalized)) return 'destructive';
  if (['pending', 'open', 'in_progress', 'assigned', 'awaiting_approval'].includes(normalized)) {
    return 'warning';
  }
  return 'secondary';
}

function taskAccentClass(task: InvestigationApprovalTask): string {
  const status = String(task.status ?? '').toLowerCase();
  if (['approved', 'complete', 'completed', 'done'].includes(status)) return 'bg-primary/70';
  if (['rejected', 'failed', 'cancelled', 'canceled'].includes(status)) return 'bg-error-300/80';
  if (isTaskActionable(task)) return 'bg-warning-300/80';
  return 'bg-muted-foreground/40';
}

function workflowIdForTask(
  task: InvestigationApprovalTask,
  investigation: Investigation,
): string | undefined {
  return (
    task.workflow_instance_id ??
    readText(task, 'instance_id') ??
    readText(task, 'workflowInstanceId') ??
    investigation.workflow_instance_id ??
    undefined
  );
}

function firstWorkflowId(tasks: InvestigationApprovalTask[]): string | undefined {
  for (const task of tasks) {
    const workflowId =
      task.workflow_instance_id ??
      readText(task, 'instance_id') ??
      readText(task, 'workflowInstanceId');
    if (workflowId) return workflowId;
  }
  return undefined;
}

function formatOptionalDate(
  value: string | null | undefined,
  ops: InvestigationLabels['approvalOps'],
): string {
  return value ? formatDateTime(value) : ops.notSet;
}

function formatTaskPriority(
  task: InvestigationApprovalTask,
  ops: InvestigationLabels['approvalOps'],
): string {
  const value = task.priority;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return ops.notSet;
}

function findRejectionNote(
  investigation: Investigation,
  auditEntries: InvestigationAuditEntry[],
  approvalTasks: InvestigationApprovalTask[],
): string | undefined {
  const investigationNote = readMetadataText(investigation.metadata, [
    'rejection_note',
    'rejection_reason',
    'reject_reason',
  ]);
  if (investigationNote) return investigationNote;

  for (const task of approvalTasks) {
    const taskNote =
      readText(task, 'rejection_reason') ??
      readMetadataText(task.metadata, [
        'rejection_note',
        'rejection_reason',
        'reject_reason',
        'decision_notes',
        'reason',
      ]);
    if (taskNote) return taskNote;
  }

  const rejectedAudit = auditEntries
    .filter((entry) => entry.action.toLowerCase().includes('reject'))
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))[0];
  return readMetadataText(rejectedAudit?.detail, [
    'notes',
    'note',
    'rejection_note',
    'rejection_reason',
    'reason',
    'message',
  ]);
}

function readText(source: InvestigationApprovalTask, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readMetadataText(metadata: unknown, keys: string[]): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const record = metadata as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isFilled(value?: string | null): boolean {
  return Boolean(value?.trim());
}

function timestamp(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
