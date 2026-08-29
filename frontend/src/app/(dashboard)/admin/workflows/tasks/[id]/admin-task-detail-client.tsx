'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  ArrowUpCircle,
  Send,
  UserPlus,
  Loader2,
  ExternalLink,
  MessageSquare,
  Clock,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  useWorkflowTask,
  useCompleteTask,
  useAssignTask,
  useAddTaskComment,
} from '@/hooks/use-workflow-tasks-ext';
import { TaskFormRenderer } from '../components/task-form-renderer';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { TaskComment } from '@/types/models';
import {
  formatAdminDateTime,
  formatAdminSLAStatus,
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from '../_lib/admin-workflow-i18n';

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

export function AdminTaskDetailClient() {
  const params = useParams();
  const router = useRouter();
  const taskId = (params?.id as string | undefined) ?? '';
  const formRef = useRef<HTMLFormElement>(null);
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();

  const [commentText, setCommentText] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');

  const { data: task, isLoading, isError, refetch } = useWorkflowTask(taskId);
  const completeMutation = useCompleteTask();
  const assignMutation = useAssignTask();
  const commentMutation = useAddTaskComment();

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
        message={t('td.failedLoad')}
        onRetry={() => refetch()}
      />
    );
  }

  const sla = formatAdminSLAStatus(task, locale);
  const isCompleted = task.status === 'completed' || task.status === 'rejected' || task.status === 'cancelled';
  const isApproval = task.step_id.includes('approval') || task.name.toLowerCase().includes('approv');
  const priorityLabel = getTaskPriorityLabel(task.priority, locale);
  const comments: TaskComment[] = (task.metadata?.comments as TaskComment[] | undefined) ?? [];

  function handleAction(action: 'approve' | 'reject' | 'complete' | 'escalate') {
    if (formRef.current && task!.form_schema.length > 0 && action !== 'escalate') {
      formRef.current.requestSubmit();
      return;
    }
    completeMutation.mutate({ taskId, data: { action } });
  }

  function handleFormSubmit(formData: Record<string, unknown>) {
    completeMutation.mutate({
      taskId,
      data: { action: isApproval ? 'approve' : 'complete', form_data: formData },
    });
  }

  function handleAssign() {
    if (!assignUserId.trim()) return;
    assignMutation.mutate(
      { taskId, data: { user_id: assignUserId } },
      { onSuccess: () => { setShowAssign(false); setAssignUserId(''); } },
    );
  }

  function handleComment() {
    if (!commentText.trim()) return;
    commentMutation.mutate(
      { taskId, content: commentText },
      { onSuccess: () => setCommentText('') },
    );
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/admin/workflows/tasks')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('td.backToQueue')}
      </button>

      {/* Header */}
      <PageHeader
        eyebrow={t('td.eyebrow')}
        title={task.name}
        description={
          <>
            {task.definition_name}
            {task.description && (
              <span className="mt-1 block">{task.description}</span>
            )}
          </>
        }
        tags={[
          { label: getTaskStatusLabel(task.status, locale), tone: taskStatusTone(task.status) },
          { label: priorityLabel, tone: 'neutral' },
        ]}
        actions={
          <a
            href={`/admin/workflows/instances/${task.instance_id}`}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t('td.viewInstance')} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        }
      />

      {/* Main 2-col layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Left: Form + Actions */}
        <div className="space-y-4">
          {/* Form */}
          {task.form_schema.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('td.taskForm')}</CardTitle>
              </CardHeader>
              <CardContent>
                <TaskFormRenderer
                  fields={task.form_schema}
                  initialData={task.form_data}
                  readOnly={isCompleted}
                  onSubmit={handleFormSubmit}
                  formRef={formRef}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('td.noFormFields')}
            </div>
          )}

          {/* Action buttons */}
          {!isCompleted && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {isApproval ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleAction('approve')}
                    disabled={completeMutation.isPending}
                  >
                    {completeMutation.isPending ? (
                      <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="me-1 h-3.5 w-3.5" />
                    )}
                    {t('c.approve')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleAction('reject')}
                    disabled={completeMutation.isPending}
                  >
                    <XCircle className="me-1 h-3.5 w-3.5" />
                    {t('c.reject')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleAction('complete')}
                  disabled={completeMutation.isPending}
                >
                  {completeMutation.isPending ? (
                    <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="me-1 h-3.5 w-3.5" />
                  )}
                  {t('c.complete')}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction('escalate')}
                disabled={completeMutation.isPending}
              >
                <ArrowUpCircle className="me-1 h-3.5 w-3.5" />
                {t('td.escalate')}
              </Button>
            </div>
          )}
        </div>

        {/* Right: Context + Metadata */}
        <div className="space-y-4">
          {/* SLA & Assignee card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('td.taskInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {task.sla_deadline && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {t('td.due')}
                  </span>
                  <span className={sla.color}>{sla.text}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  {t('td.assignedTo')}
                </span>
                <span>{task.claimed_by_name ?? task.assignee_id ?? t('td.unassigned')}</span>
              </div>
              {task.assignee_role && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('td.requiredRole')}</span>
                  <Badge variant="secondary" className="text-xs">
                    {task.assignee_role}
                  </Badge>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('c.created')}</span>
                <span>{formatAdminDateTime(task.created_at, locale)}</span>
              </div>
              {task.claimed_at && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('td.claimed')}</span>
                  <span>{formatAdminDateTime(task.claimed_at, locale)}</span>
                </div>
              )}

              {!isCompleted && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowAssign(!showAssign)}
                  >
                    <UserPlus className="me-1 h-3.5 w-3.5" />
                    {t('td.reassign')}
                  </Button>
                  {showAssign && (
                    <div className="mt-2 flex items-center gap-2">
                      <TenantUserPicker
                        ariaLabel={t('td.assignedTo')}
                        value={assignUserId}
                        onChange={setAssignUserId}
                        disabled={assignMutation.isPending}
                        labels={{
                          select: locale === 'ar' ? 'اختر مستخدمًا' : 'Select a user',
                          search: locale === 'ar' ? 'ابحث بالاسم أو البريد الإلكتروني…' : 'Search by name or email…',
                          empty: locale === 'ar' ? 'لا يوجد مستخدمون مطابقون.' : 'No matching users.',
                        }}
                        className="min-w-0 flex-1 [&_button]:h-8 [&_button]:text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={handleAssign}
                        disabled={assignMutation.isPending || !assignUserId}
                      >
                        {assignMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          t('td.assign')
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Instance context */}
          {task.metadata && Object.keys(task.metadata).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('td.instanceContext')}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-40 overflow-x-auto overflow-y-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(task.metadata, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Comments */}
      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {t('td.comments')} {comments.length > 0 && `(${comments.length})`}
          </h3>
        </div>
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('td.noComments')}</p>
        ) : (
          <div className="mb-3 space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="rounded border p-2 text-xs">
                <div className="mb-0.5 flex justify-between text-muted-foreground">
                  <span className="font-medium">{c.user_name}</span>
                  <span>{formatAdminDateTime(c.created_at, locale)}</span>
                </div>
                <p>{c.content}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={t('td.addComment')}
            rows={2}
            className="text-sm"
          />
          <Button
            size="icon"
            variant="outline"
            className="shrink-0 self-end"
            disabled={!commentText.trim() || commentMutation.isPending}
            onClick={handleComment}
          >
            {commentMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
