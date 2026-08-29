'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, X, AlertCircle, MessageSquare, Send } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import {
  TaskDetailForm,
  type TaskDetailFormHandle,
} from '@/components/workflows/task-detail-form';
import { TaskContextPanel } from '@/components/workflows/task-context-panel';
import { TaskClaimButton } from '@/components/workflows/task-claim-button';
import { TaskCompleteDialog } from '@/components/workflows/task-complete-dialog';
import { TaskRejectDialog } from '@/components/workflows/task-reject-dialog';
import { TaskDelegateDialog } from '@/components/workflows/task-delegate-dialog';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  canClaimTask,
  canDelegateTask,
} from '@/lib/workflow-utils';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useAddTaskComment } from '@/hooks/use-workflow-tasks-ext';
import {
  formatTaskSlaStatus,
  useWorkflowPageLabels,
  workflowLabel,
} from '../../_lib/workflow-page-i18n';
import type { HumanTask, TaskComment } from '@/types/models';

const DRAFT_KEY = (id: string) => `clario360_task_draft_${id}`;
const FORM_ID = 'task-detail-form';

/** Map a human-task status onto a semantic PageHeader tag tone. */
function taskStatusTone(status: string): PageHeaderTag['tone'] {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'claimed':
      return 'info';
    case 'completed':
      return 'success';
    case 'rejected':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

interface DraftData {
  values: Record<string, unknown>;
  savedAt: string;
}

export function TaskDetailPageClient() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const taskId = (params?.id as string | undefined) ?? '';
  const { user } = useAuth();
  const labels = useWorkflowPageLabels();
  const formRef = useRef<TaskDetailFormHandle>(null);

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [draftData, setDraftData] = useState<DraftData | null>(null);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const addComment = useAddTaskComment();

  const {
    data: task,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => apiGet<HumanTask>(`/api/v1/workflows/tasks/${taskId}`),
  });

  const currentInitialValues = useMemo(() => {
    if (!task) {
      return draftData?.values ?? {};
    }

    return (
      draftData?.values ??
      ((task.status === 'completed' || task.status === 'cancelled') && task.form_data
        ? task.form_data
        : task.form_data ?? {})
    );
  }, [draftData?.values, task]);

  useEffect(() => {
    if (!taskId || !task || task.status === 'completed' || task.status === 'cancelled') {
      return;
    }

    const raw = localStorage.getItem(DRAFT_KEY(taskId));
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as DraftData;
      setDraftData(parsed);
      setShowDraftBanner(true);
    } catch {
      localStorage.removeItem(DRAFT_KEY(taskId));
    }
  }, [task, taskId]);

  const saveDraft = (values: Record<string, unknown>) => {
    const draft: DraftData = { values, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY(taskId), JSON.stringify(draft));
    setDraftData(draft);
    setShowDraftBanner(true);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY(taskId));
    setDraftData(null);
    setShowDraftBanner(false);
    setFormData({});
  };

  const handleFormSubmit = async (data: Record<string, unknown>) => {
    setFormData(data);
    setCompleteOpen(true);
  };

  const handleCompleteSuccess = () => {
    localStorage.removeItem(DRAFT_KEY(taskId));
    router.push('/workflows/tasks');
  };

  const handleRejectSuccess = () => {
    router.push('/workflows/tasks');
  };

  const handleDelegateSuccess = () => {
    router.push('/workflows/tasks');
  };

  const handleClaimSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['task', taskId] });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if (isError || !task) {
    return (
      <ErrorState
        message={labels.tasks.detail.notFound}
        onRetry={() => refetch()}
      />
    );
  }

  const isCompleted = task.status === 'completed' || task.status === 'cancelled';
  const isReadOnly = isCompleted || task.status === 'rejected';
  const isMine = task.claimed_by === user?.id;
  const isUnclaimed = !task.claimed_by && task.status === 'pending';
  const isClaimedByOther = Boolean(task.claimed_by && task.claimed_by !== user?.id);
  const canClaim = canClaimTask(task, user);
  const canDelegate = canDelegateTask(task, user);
  const sla = formatTaskSlaStatus(task, labels);
  const priorityLabel = labels.priorities[task.priority] ?? labels.priorities[0];
  const hasForm = task.form_schema.length > 0;
  const comments = (task.metadata?.comments as TaskComment[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/workflows/tasks')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        {labels.tasks.detail.backToMyTasks}
      </button>

      <PageHeader
        eyebrow={labels.common.eyebrow}
        title={task.name}
        description={
          <>
            {task.definition_name || task.workflow_name}
            {task.step_id && ` · ${task.step_id}`}
            {task.description && (
              <span className="mt-1 block">{task.description}</span>
            )}
          </>
        }
        tags={[
          { label: workflowLabel(labels, task.status, task.status), tone: taskStatusTone(task.status) },
          { label: priorityLabel, tone: 'neutral' },
          { label: sla.text, tone: 'neutral' },
        ]}
      />

      {showDraftBanner && draftData && (
        <div className="flex items-center gap-3 rounded-lg border border-info-300/60 bg-info-50 px-4 py-2 text-sm dark:border-info-700/50 dark:bg-info-700/15">
          <AlertCircle className="h-4 w-4 text-info-600 dark:text-info-300" />
          <span className="text-info-700 dark:text-info-300">
            {labels.tasks.detail.draftRestored(formatDateTime(draftData.savedAt))}
          </span>
          <button
            onClick={discardDraft}
            className="ms-auto flex items-center gap-1 text-xs text-info-700 hover:underline dark:text-info-300"
            type="button"
          >
            <X className="h-3 w-3" />
            {labels.tasks.detail.discardDraft}
          </button>
        </div>
      )}

      {isClaimedByOther && !isCompleted && (
        <div className="rounded-lg border border-warning-300/60 bg-warning-50 px-4 py-2 text-sm text-warning-700 dark:border-warning-700/50 dark:bg-warning-700/15 dark:text-warning-300">
          {labels.tasks.detail.claimedByOther(task.claimed_by_name ?? task.claimed_by ?? '')}
        </div>
      )}

      {isCompleted && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          {labels.tasks.detail.completedNotice(workflowLabel(labels, task.status, task.status))}
        </div>
      )}

      {task.late_justification ? (
        <div className="rounded-lg border border-warning-300 bg-warning-50/60 px-4 py-3 dark:bg-warning-700/10">
          <p className="text-sm font-semibold text-warning-800 dark:text-warning-200">
            Late SLA justification
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm" dir="auto">
            {task.late_justification}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          {isUnclaimed ? (
            canClaim ? (
              <TaskClaimButton task={task} onSuccess={handleClaimSuccess} />
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {labels.tasks.detail.restrictedRole}
              </div>
            )
          ) : hasForm ? (
            <div className="rounded-lg border p-6">
              <h2 className="mb-4 text-base font-semibold">{labels.tasks.detail.taskForm}</h2>
              <TaskDetailForm
                ref={formRef}
                formId={FORM_ID}
                showSubmitButton={false}
                formSchema={task.form_schema}
                initialValues={currentInitialValues}
                readOnly={isReadOnly || isClaimedByOther}
                onSubmit={handleFormSubmit}
                onDraftSave={isMine ? saveDraft : undefined}
              />
            </div>
          ) : (
            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
              {labels.tasks.detail.noFormFields}
            </div>
          )}
        </div>

        <div>
          <TaskContextPanel task={task} instanceId={task.instance_id} />
        </div>
      </div>

      {!isCompleted && !isUnclaimed && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex gap-2">
            {isMine && (
              <Button variant="outline" onClick={() => setRejectOpen(true)}>
                {labels.tasks.detail.reject}
              </Button>
            )}
            {canDelegate && (
              <Button variant="outline" onClick={() => setDelegateOpen(true)}>
                {labels.tasks.detail.delegate}
              </Button>
            )}
          </div>
          {isMine && (
            <div className="flex gap-2">
              {hasForm && (
                <Button
                  variant="outline"
                  onClick={() => formRef.current?.saveDraft()}
                >
                  {labels.tasks.detail.saveDraft}
                </Button>
              )}
              <Button
                onClick={() => {
                  if (hasForm) {
                    void formRef.current?.submit();
                  } else {
                    setFormData({});
                    setCompleteOpen(true);
                  }
                }}
              >
                {labels.tasks.detail.complete} ✓
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Comments */}
      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {labels.tasks.detail.comments(comments.length)}
          </h3>
        </div>
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{labels.tasks.detail.noComments}</p>
        ) : (
          <div className="mb-3 space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.user_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{c.content}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={labels.tasks.detail.addComment}
            rows={2}
            className="text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            className="self-end"
            aria-label={labels.tasks.detail.addComment}
            disabled={!commentText.trim() || addComment.isPending}
            onClick={() => {
              if (!commentText.trim()) return;
              addComment.mutate(
                { taskId, content: commentText },
                {
                  onSuccess: () => {
                    setCommentText('');
                    queryClient.invalidateQueries({ queryKey: ['task', taskId] });
                  },
                },
              );
            }}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <TaskCompleteDialog
        task={task}
        formData={formData}
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        onSuccess={handleCompleteSuccess}
      />

      <TaskRejectDialog
        task={task}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onSuccess={handleRejectSuccess}
      />

      <TaskDelegateDialog
        task={task}
        open={delegateOpen}
        onOpenChange={setDelegateOpen}
        onSuccess={handleDelegateSuccess}
      />
    </div>
  );
}
