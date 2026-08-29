'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  RotateCcw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { Combobox } from '@/components/shared/forms/combobox';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { apiPost } from '@/lib/api';
import { enterpriseApi } from '@/lib/enterprise/api';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  lexRequestsApi,
  type ApprovalTask,
  type LegalRequest,
  type LegalRequestAuditEntry,
  type ReturnIncompleteReasonCode,
} from '@/lib/lex/requests';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLocale } from '@/components/providers/locale-provider';
import { useServiceDeskLabels } from './labels';
import { useApprovalTaskLabel, useApprovalTaskStatusLabel } from './lex-enums-i18n';
import { RequestAttachmentsPanel } from './request-attachments-panel';
import { actionableRequestApprovalTasks } from './request-approval-task-eligibility';
import { RETURN_REASON_CODES } from './return-reason-codes';

const COPY = {
  en: {
    back: 'Back to approval queue',
    details: 'Request details',
    serviceType: 'Service type',
    requester: 'Requester',
    department: 'Department',
    priority: 'Priority',
    submitted: 'Submission date',
    deadline: 'SLA deadline',
    noDeadline: 'No deadline set',
    description: 'Request description',
    noDescription: 'No description was provided for this request.',
    attachedDocuments: 'Attached documents',
    action: 'Take action',
    comments: 'Approval / rejection comments',
    commentsPlaceholder: 'Enter decision comments or feedback here...',
    commentsRequired: 'Add a comment before recording a decision.',
    approve: 'Approve request',
    return: 'Return for revision',
    reject: 'Reject request',
    reviewingFiles: 'Documents must finish security review before this request can be approved.',
    waitingForTask: 'This request is awaiting its assigned approver.',
    taskUnavailable: 'The approval task could not be loaded.',
    history: 'Lifecycle history',
    submittedEvent: 'Request submitted',
    by: 'By',
    returnDialogTitle: 'Return request for revision',
    returnDialogDescription:
      'Choose the issue that needs to be corrected. Your comments will be sent with the request.',
    rejectDialogTitle: 'Reject request',
    rejectDialogDescription:
      'Choose the reason for rejecting this request. This decision is recorded in the audit trail.',
    reason: 'Decision reason',
    reasonPlaceholder: 'Select a reason',
    reasonRequired: 'Select a reason before continuing.',
    cancel: 'Cancel',
    confirmReturn: 'Return request',
    confirmReject: 'Reject request',
    decisionRecorded: 'Approval decision recorded.',
    transfer: 'Transfer to another manager',
    transferPlaceholder: 'Select a manager',
    transferSearch: 'Search managers...',
    transferAction: 'Transfer request',
    transferSuccess: 'Approval task transferred.',
    noManagers: 'No eligible managers were found.',
  },
  ar: {
    back: 'العودة إلى قائمة الموافقات',
    details: 'تفاصيل الطلب',
    serviceType: 'نوع الخدمة',
    requester: 'مقدّم الطلب',
    department: 'الإدارة',
    priority: 'الأولوية',
    submitted: 'تاريخ التقديم',
    deadline: 'الموعد النهائي لاتفاقية مستوى الخدمة',
    noDeadline: 'لم يُحدَّد موعد نهائي',
    description: 'وصف الطلب',
    noDescription: 'لم يُقدَّم وصف لهذا الطلب.',
    attachedDocuments: 'المستندات المرفقة',
    action: 'اتخاذ إجراء',
    comments: 'ملاحظات الموافقة أو الرفض',
    commentsPlaceholder: 'أدخل ملاحظات القرار أو التعليقات هنا...',
    commentsRequired: 'أضف ملاحظة قبل تسجيل القرار.',
    approve: 'الموافقة على الطلب',
    return: 'إعادة للمراجعة',
    reject: 'رفض الطلب',
    reviewingFiles: 'يجب أن تُكمل المستندات المراجعة الأمنية قبل اعتماد الطلب.',
    waitingForTask: 'ينتظر هذا الطلب قرار الموافق المعيّن.',
    taskUnavailable: 'تعذّر تحميل مهمة الموافقة.',
    history: 'سجل دورة الحياة',
    submittedEvent: 'تم تقديم الطلب',
    by: 'بواسطة',
    returnDialogTitle: 'إعادة الطلب للمراجعة',
    returnDialogDescription: 'اختر المشكلة التي يجب تصحيحها. ستُرسل ملاحظاتك مع الطلب.',
    rejectDialogTitle: 'رفض الطلب',
    rejectDialogDescription: 'اختر سبب رفض هذا الطلب. سيُسجَّل القرار في سجل التدقيق.',
    reason: 'سبب القرار',
    reasonPlaceholder: 'اختر سببًا',
    reasonRequired: 'اختر سببًا قبل المتابعة.',
    cancel: 'إلغاء',
    confirmReturn: 'إعادة الطلب',
    confirmReject: 'رفض الطلب',
    decisionRecorded: 'تم تسجيل قرار الموافقة.',
    transfer: 'تحويل إلى مدير آخر',
    transferPlaceholder: 'اختر مديرًا',
    transferSearch: 'ابحث عن مدير...',
    transferAction: 'تحويل الطلب',
    transferSuccess: 'تم تحويل مهمة الموافقة.',
    noManagers: 'لم يتم العثور على مديرين مؤهلين.',
  },
} as const;

type RejectMode = 'return' | 'reject';

const PRIORITY_TONES: Record<LegalRequest['priority'], StatusTone> = {
  emergency: 'danger',
  urgent: 'warning',
  normal: 'info',
};

interface RequestApprovalDetailProps {
  request: LegalRequest;
  serviceName: string;
  onChanged: () => void;
  backHref?: string;
}

export function RequestApprovalDetail({
  request,
  serviceName,
  onChanged,
  backHref = '/lex/approvals/requests',
}: RequestApprovalDetailProps) {
  const { locale, direction } = useLocale();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const labels = useServiceDeskLabels();
  const f = useLexFormat();
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const canApprove = hasPermission('lex:request:approve');
  const canDelegate = hasPermission('workflow:write');
  const taskLabel = useApprovalTaskLabel();
  const taskStatusLabel = useApprovalTaskStatusLabel();

  const [comments, setComments] = useState('');
  const [commentsError, setCommentsError] = useState('');
  const [attachmentsReady, setAttachmentsReady] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(true);
  const [rejectMode, setRejectMode] = useState<RejectMode | null>(null);
  const [lastRejectMode, setLastRejectMode] = useState<RejectMode>('return');
  const [reasonCode, setReasonCode] = useState<ReturnIncompleteReasonCode | ''>('');
  const [reasonError, setReasonError] = useState('');
  const [delegateUserId, setDelegateUserId] = useState('');

  const tasksQuery = useQuery({
    queryKey: ['lex-approval-tasks', request.id],
    queryFn: () => lexRequestsApi.listApprovalTasks(request.id),
    enabled: Boolean(request.id && request.workflow_instance_id),
    retry: false,
  });
  const auditQuery = useQuery({
    queryKey: ['lex-request-audit', request.id],
    queryFn: () => lexRequestsApi.listRequestAudit(request.id),
    enabled: Boolean(request.id),
    retry: false,
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const actionableTasks = actionableRequestApprovalTasks(tasks);
  const activeTask = actionableTasks[0];
  const displayTask =
    activeTask ??
    tasks.find((task) => ['pending', 'claimed', 'escalated'].includes(task.status)) ??
    tasks[0];
  const usersQuery = useQuery({
    queryKey: ['lex-approval-delegate-users'],
    queryFn: () =>
      enterpriseApi.users.list({
        page: 1,
        per_page: 100,
        sort: 'first_name',
        order: 'asc',
      }),
    enabled: Boolean(displayTask && canDelegate),
    staleTime: 300_000,
  });
  const managerOptions = useMemo(
    () =>
      (usersQuery.data?.data ?? [])
        .filter((candidate) => candidate.id !== user?.id && candidate.status === 'active')
        .map((candidate) => ({
          value: candidate.id,
          label:
            `${candidate.first_name} ${candidate.last_name}`.trim() ||
            candidate.email,
        })),
    [user?.id, usersQuery.data?.data],
  );

  const decisionMutation = useMutation({
    mutationFn: ({
      task,
      decision,
      returnReasonCode,
    }: {
      task: ApprovalTask;
      decision: 'approve' | 'reject';
      returnReasonCode?: ReturnIncompleteReasonCode;
    }) =>
      lexRequestsApi.decideApprovalTask(request.id, task.instance_id, task.id, {
        decision,
        notes: comments.trim(),
        return_reason_code: returnReasonCode,
      }),
    onSuccess: async () => {
      showSuccess(copy.decisionRecorded);
      setComments('');
      setCommentsError('');
      closeDecisionDialog();
      await queryClient.invalidateQueries({ queryKey: ['lex-approval-tasks', request.id] });
      await queryClient.invalidateQueries({ queryKey: ['lex-request-audit', request.id] });
      onChanged();
    },
    onError: showApiError,
  });
  const delegateMutation = useMutation({
    mutationFn: async () => {
      if (!displayTask || !delegateUserId) return;
      await apiPost(`/api/v1/workflows/tasks/${displayTask.id}/delegate`, {
        delegate_to: delegateUserId,
        ...(comments.trim() ? { reason: comments.trim() } : {}),
      });
    },
    onSuccess: async () => {
      showSuccess(copy.transferSuccess);
      setDelegateUserId('');
      await queryClient.invalidateQueries({ queryKey: ['lex-approval-tasks', request.id] });
      await queryClient.invalidateQueries({ queryKey: ['lex-request-audit', request.id] });
      onChanged();
    },
    onError: showApiError,
  });

  const closeDecisionDialog = () => {
    setRejectMode(null);
    setReasonCode('');
    setReasonError('');
  };

  const validateComments = () => {
    if (comments.trim()) {
      setCommentsError('');
      return true;
    }
    setCommentsError(copy.commentsRequired);
    return false;
  };

  const startRejectDecision = (mode: RejectMode) => {
    if (!validateComments()) return;
    setLastRejectMode(mode);
    setRejectMode(mode);
  };
  const handleAttachmentReviewState = useCallback(
    (state: { loading: boolean; ready: boolean }) => {
      setAttachmentsReady(state.ready);
      setAttachmentsLoading(state.loading);
    },
    [],
  );

  const title = resolveLocalized(request.title, locale) || request.request_number;
  const deadline = displayTask?.sla_deadline
    ? f.formatRelative(displayTask.sla_deadline)
    : copy.noDeadline;
  const actionDisabled =
    decisionMutation.isPending || tasksQuery.isLoading || !activeTask || !canApprove;

  return (
    <div
      className="space-y-6 motion-safe:animate-fade-up"
      dir={direction}
      lang={locale}
      data-testid="request-approval-detail"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h2 font-bold leading-tight tracking-tight text-foreground" dir="auto">
              <span className="text-primary">{request.request_number}:</span> {title}
            </h1>
            <StatusBadge
              status={request.status}
              label={labels.statusOptions[request.status]}
              tone="warning"
              icon={Clock3}
              size="md"
            />
          </div>
        </div>
        <Button asChild variant="outline" className="w-fit shadow-none">
          <Link href={backHref}>
            <ArrowLeft className="me-1.5 h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {copy.back}
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,0.95fr)]">
        <div className="min-w-0 space-y-6">
          <Card className="rounded-xl border-border/70 bg-card shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">{copy.details}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <ApprovalMeta label={copy.serviceType} value={serviceName} />
                <ApprovalMeta label={copy.requester} value={request.requester_name} />
                <ApprovalMeta label={copy.department} value={request.department || labels.detail.notSet} />
                <ApprovalMeta
                  label={copy.priority}
                  value={
                    <StatusBadge
                      status={request.priority}
                      label={labels.priorityOptions[request.priority]}
                      tone={PRIORITY_TONES[request.priority]}
                      icon={null}
                      size="sm"
                    />
                  }
                />
                <ApprovalMeta label={copy.submitted} value={f.formatDual(request.created_at)} />
                <ApprovalMeta
                  label={copy.deadline}
                  value={deadline}
                  valueClassName={
                    displayTask?.sla_breached
                      ? 'text-destructive'
                      : displayTask?.sla_deadline
                        ? 'text-warning-700 dark:text-warning-300'
                        : undefined
                  }
                />
              </dl>

              <div className="mt-6 border-t border-border/70 pt-5">
                <p className="text-sm font-semibold text-foreground">{copy.description}</p>
                <p
                  className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground"
                  dir="auto"
                >
                  {request.description || copy.noDescription}
                </p>
              </div>
            </CardContent>
          </Card>

          <RequestAttachmentsPanel
            requestId={request.id}
            title={copy.attachedDocuments}
            onReviewStateChange={handleAttachmentReviewState}
          />
        </div>

        <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
          <Card className="rounded-xl border-border/70 bg-card shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">{copy.action}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {tasksQuery.isError ? (
                <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                  {copy.taskUnavailable}
                </div>
              ) : displayTask ? (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground" dir="auto">
                        {taskLabel(displayTask.name || displayTask.step_id)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {taskStatusLabel(displayTask.status)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : tasksQuery.isLoading ? (
                <Skeleton variant="list-item" />
              ) : (
                <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                  {copy.waitingForTask}
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="approval-comments">
                  {copy.comments} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="approval-comments"
                  value={comments}
                  onChange={(event) => {
                    setComments(event.target.value);
                    if (event.target.value.trim()) setCommentsError('');
                  }}
                  placeholder={copy.commentsPlaceholder}
                  rows={5}
                  disabled={decisionMutation.isPending || !canApprove}
                  aria-invalid={Boolean(commentsError)}
                  className="min-h-32 resize-y"
                />
                {commentsError ? (
                  <p className="text-xs font-medium text-destructive">{commentsError}</p>
                ) : null}
              </div>

              {attachmentsLoading || !attachmentsReady ? (
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {copy.reviewingFiles}
                </p>
              ) : null}

              <div className="space-y-2.5">
                <Button
                  type="button"
                  className="w-full bg-success-600 text-white hover:bg-success-700 active:bg-success-800"
                  disabled={actionDisabled || !attachmentsReady}
                  onClick={() => {
                    if (!activeTask || !validateComments()) return;
                    decisionMutation.mutate({ task: activeTask, decision: 'approve' });
                  }}
                >
                  {decisionMutation.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 className="me-2 h-4 w-4" aria-hidden />
                  )}
                  {copy.approve}
                </Button>
                <Button
                  type="button"
                  className="w-full bg-warning-600 text-white hover:bg-warning-700 active:bg-warning-800"
                  disabled={actionDisabled}
                  onClick={() => startRejectDecision('return')}
                >
                  <RotateCcw className="me-2 h-4 w-4" aria-hidden />
                  {copy.return}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  disabled={actionDisabled}
                  onClick={() => startRejectDecision('reject')}
                >
                  <XCircle className="me-2 h-4 w-4" aria-hidden />
                  {copy.reject}
                </Button>
              </div>

              {canDelegate ? (
                <div className="space-y-2 border-t border-border/70 pt-4">
                  <Label>{copy.transfer}</Label>
                  <Combobox
                    options={managerOptions}
                    value={delegateUserId}
                    onChange={setDelegateUserId}
                    placeholder={
                      usersQuery.isSuccess && managerOptions.length === 0
                        ? copy.noManagers
                        : copy.transferPlaceholder
                    }
                    searchPlaceholder={copy.transferSearch}
                    disabled={
                      !displayTask ||
                      usersQuery.isLoading ||
                      delegateMutation.isPending
                    }
                    className="w-full"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full shadow-none"
                    disabled={
                      !displayTask ||
                      !delegateUserId ||
                      delegateMutation.isPending
                    }
                    onClick={() => delegateMutation.mutate()}
                  >
                    {delegateMutation.isPending ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
                    )}
                    {copy.transferAction}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <ApprovalLifecycleHistory
            request={request}
            tasks={tasks}
            audit={auditQuery.data ?? []}
            loading={tasksQuery.isLoading || auditQuery.isLoading}
          />
        </aside>
      </div>

      <Dialog
        open={Boolean(rejectMode)}
        onOpenChange={(open) => {
          if (!open) closeDecisionDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {(rejectMode ?? lastRejectMode) === 'return'
                ? copy.returnDialogTitle
                : copy.rejectDialogTitle}
            </DialogTitle>
            <DialogDescription>
              {(rejectMode ?? lastRejectMode) === 'return'
                ? copy.returnDialogDescription
                : copy.rejectDialogDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="approval-reason">{copy.reason}</Label>
            <Select
              value={reasonCode}
              onValueChange={(value) => {
                setReasonCode(value as ReturnIncompleteReasonCode);
                setReasonError('');
              }}
            >
              <SelectTrigger id="approval-reason" aria-invalid={Boolean(reasonError)}>
                <SelectValue placeholder={copy.reasonPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {labels.returnDialog.reasons[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reasonError ? (
              <p className="text-sm font-medium text-destructive">{reasonError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDecisionDialog}>
              {copy.cancel}
            </Button>
            <Button
              type="button"
              variant={(rejectMode ?? lastRejectMode) === 'reject' ? 'destructive' : 'default'}
              loading={decisionMutation.isPending}
              className={
                (rejectMode ?? lastRejectMode) === 'return'
                  ? 'bg-warning-600 text-white hover:bg-warning-700 active:bg-warning-800'
                  : undefined
              }
              onClick={async () => {
                if (!reasonCode) {
                  setReasonError(copy.reasonRequired);
                  return;
                }
                if (activeTask) {
                  await decisionMutation.mutateAsync({
                    task: activeTask,
                    decision: 'reject',
                    returnReasonCode: reasonCode,
                  });
                }
              }}
            >
              {(rejectMode ?? lastRejectMode) === 'return'
                ? copy.confirmReturn
                : copy.confirmReject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalMeta({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-semibold text-foreground ${valueClassName ?? ''}`} dir="auto">
        {value}
      </dd>
    </div>
  );
}

function ApprovalLifecycleHistory({
  request,
  tasks,
  audit,
  loading,
}: {
  request: LegalRequest;
  tasks: ApprovalTask[];
  audit: LegalRequestAuditEntry[];
  loading: boolean;
}) {
  const { locale } = useLocale();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const f = useLexFormat();
  const taskLabel = useApprovalTaskLabel();
  const taskStatusLabel = useApprovalTaskStatusLabel();

  const submittedAudit = audit
    .filter((entry) => entry.to_status === 'submitted' || entry.action === 'submitted')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

  const events = [
    {
      id: `request-${request.id}`,
      title: copy.submittedEvent,
      detail: request.requester_name,
      at: submittedAudit?.created_at ?? request.created_at,
      complete: true,
    },
    ...tasks
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((task) => ({
        id: task.id,
        title: taskLabel(task.name || task.step_id),
        detail: `${taskStatusLabel(task.status)}${
          task.assignee_role || task.assignee_id
            ? ` · ${copy.by}: ${task.assignee_role || task.assignee_id}`
            : ''
        }`,
        at: task.completed_at ?? task.created_at,
        complete: Boolean(task.completed_at),
      })),
  ];

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">{copy.history}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} variant="list-item" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <ErrorState title={copy.history} message={copy.waitingForTask} />
        ) : (
          <ol className="space-y-0">
            {events.map((event, index) => {
              const isLast = index === events.length - 1;
              return (
                <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {!isLast ? (
                    <span
                      className="absolute bottom-0 start-[7px] top-4 w-px bg-border"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative z-[1] mt-1 shrink-0">
                    {event.complete ? (
                      <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 fill-muted text-border" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground" dir="auto">
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                      {event.detail}
                    </p>
                    <p className="mt-1 text-xs font-medium text-primary">
                      {f.formatDual(event.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
