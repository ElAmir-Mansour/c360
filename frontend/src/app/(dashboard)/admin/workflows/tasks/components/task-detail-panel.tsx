'use client';

import { useRef, useState } from 'react';
import {
  X,
  CheckCircle,
  XCircle,
  ArrowUpCircle,
  Send,
  UserPlus,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/shared/status-badge';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  useWorkflowTask,
  useCompleteTask,
  useAssignTask,
  useAddTaskComment,
} from '@/hooks/use-workflow-tasks-ext';
import { TaskFormRenderer } from './task-form-renderer';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { HumanTask, TaskComment } from '@/types/models';
import {
  formatAdminDateTime,
  formatAdminSLAStatus,
  getLocalizedTaskStatusConfig,
} from '../_lib/admin-workflow-i18n';

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const { data: task, isLoading, isError, refetch } = useWorkflowTask(taskId);
  const completeMutation = useCompleteTask();
  const assignMutation = useAssignTask();
  const commentMutation = useAddTaskComment();

  const [commentText, setCommentText] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  if (isLoading) {
    return (
      <PanelWrapper onClose={onClose}>
        <LoadingSkeleton variant="card" count={2} />
      </PanelWrapper>
    );
  }

  if (isError || !task) {
    return (
      <PanelWrapper onClose={onClose}>
        <ErrorState message={t('td.failedLoad')} onRetry={() => refetch()} />
      </PanelWrapper>
    );
  }

  const sla = formatAdminSLAStatus(task, locale);
  const isCompleted = task.status === 'completed' || task.status === 'rejected' || task.status === 'cancelled';
  const isApproval = task.step_id.includes('approval') || task.name.toLowerCase().includes('approv');
  const localizedTaskStatusConfig = getLocalizedTaskStatusConfig(locale);

  function handleAction(action: 'approve' | 'reject' | 'complete' | 'escalate') {
    if (!task) return;
    // Trigger form submit to validate, then complete
    if (formRef.current && task.form_schema.length > 0 && action !== 'escalate') {
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

  // Comments from metadata (if available)
  const comments: TaskComment[] = (task.metadata?.comments as TaskComment[]) ?? [];

  return (
    <PanelWrapper onClose={onClose}>
      {/* Header */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-h4 font-semibold">{task.name}</h2>
          <StatusBadge status={task.status} config={localizedTaskStatusConfig} />
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>{task.workflow_name ?? task.definition_name}</p>
          <a
            href={`/admin/workflows/instances/${task.instance_id}`}
            className="inline-flex items-center gap-1 hover:underline text-primary"
          >
            {t('td.viewInstance')} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* SLA & Assignee */}
      <div className="p-4 border-b space-y-2">
        {task.sla_deadline && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('td.due')}</span>
            <span className={sla.color}>
              {sla.text}
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('td.assignedTo')}</span>
          <span>{task.claimed_by_name ?? task.assignee_id ?? t('td.unassigned')}</span>
        </div>
        {!isCompleted && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setShowAssign(!showAssign)}
          >
            <UserPlus className="me-1 h-3.5 w-3.5" />
            {t('td.reassign')}
          </Button>
        )}
        {showAssign && (
          <div className="flex items-center gap-2">
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

      {/* Form */}
      {task.form_schema.length > 0 && (
        <div className="p-4 border-b">
          <h3 className="text-sm font-medium mb-2">{t('td.form')}</h3>
          <TaskFormRenderer
            fields={task.form_schema}
            initialData={task.form_data}
            readOnly={isCompleted}
            onSubmit={handleFormSubmit}
            formRef={formRef}
          />
        </div>
      )}

      {/* Action buttons */}
      {!isCompleted && (
        <div className="p-4 border-b flex flex-wrap gap-2">
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

      {/* Comments */}
      <div className="p-4 space-y-3">
        <h3 className="text-sm font-medium">{t('td.comments')}</h3>
        {comments.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('td.noComments')}</p>
        )}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="text-xs border rounded p-2">
              <div className="flex justify-between text-muted-foreground mb-0.5">
                <span className="font-medium">{c.user_name}</span>
                <span>{formatAdminDateTime(c.created_at, locale)}</span>
              </div>
              <p>{c.content}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={t('td.addComment')}
            rows={2}
            className="text-sm"
          />
          <Button
            size="icon"
            className="shrink-0 self-end"
            onClick={handleComment}
            disabled={!commentText.trim() || commentMutation.isPending}
          >
            {commentMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Instance context */}
      {task.metadata && Object.keys(task.metadata).length > 0 && (
        <details className="p-4 border-t">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            {t('td.instanceContext')}
          </summary>
          <pre className="mt-2 text-xs bg-muted rounded p-2 overflow-x-auto">
            {JSON.stringify(task.metadata, null, 2)}
          </pre>
        </details>
      )}
    </PanelWrapper>
  );
}

function PanelWrapper({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const t = useT('admin');
  return (
    <div className="fixed inset-y-0 end-0 w-[420px] max-w-full bg-background border-s shadow-xl z-50 flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">{t('td.taskDetails')}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label={t('td.closePanel')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
