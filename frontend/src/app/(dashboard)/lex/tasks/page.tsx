'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Paperclip,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Upload,
  UsersRound,
} from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import { formatBytes } from '@/lib/format';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  managerTasksApi,
  type ManagerTask,
  type ManagerTaskStatus,
} from '@/lib/lex/manager-tasks';
import { useLexContext } from '@/lib/lex/use-lex-context';
import { showApiError, showSuccess } from '@/lib/toast';
import type { UserDirectoryEntry } from '@/types/suites';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import {
  MANAGER_TASK_STATUS_ORDER,
  managerTasksCopy,
  type ManagerTasksCopy,
} from './_lib/labels';
import {
  canCreateManagerTask,
  managerTaskActions,
  managerTaskAssigneeRoles,
} from './_lib/task-policy';

type TaskScope = 'all' | ManagerTaskStatus | 'active';

const TASKS_QUERY_KEY = ['lex', 'manager-tasks'] as const;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const STATUS_TONES: Record<ManagerTaskStatus, StatusTone> = {
  assigned: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  correction_required: 'danger',
  accepted: 'success',
  cancelled: 'neutral',
};

async function loadTaskAssignees(
  roleSlug: string | null | undefined,
): Promise<UserDirectoryEntry[]> {
  const groups = await Promise.allSettled(
    managerTaskAssigneeRoles(roleSlug).map((candidateRole) =>
      enterpriseApi.users.listByRole(candidateRole),
    ),
  );
  const byID = new Map<string, UserDirectoryEntry>();
  for (const group of groups) {
    if (group.status !== 'fulfilled') continue;
    for (const user of group.value) byID.set(user.id, user);
  }
  if (byID.size > 0) {
    return [...byID.values()].filter(
      (user) => user.status.toLocaleLowerCase() === 'active',
    );
  }

  const response = await enterpriseApi.users.list({
    page: 1,
    per_page: 200,
    sort: 'first_name',
    order: 'asc',
  });
  return response.data.filter(
    (user) => user.status.toLocaleLowerCase() === 'active',
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForCleanAttachment(
  fileID: string,
  initialStatus: string,
  messages: { rejected: string; timedOut: string },
): Promise<void> {
  let status = initialStatus.trim().toLocaleLowerCase();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (status === 'clean') return;
    if (['infected', 'error', 'failed', 'skipped'].includes(status)) {
      throw new Error(messages.rejected);
    }
    await sleep(1_500);
    const record = await enterpriseApi.files.get(fileID);
    status = record.virus_scan_status.trim().toLocaleLowerCase();
  }
  throw new Error(messages.timedOut);
}

function shortID(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function ManagerTasksContent() {
  const { locale, direction } = useLocale();
  const copy = managerTasksCopy(locale);
  const format = useLexFormat();
  const { user } = useAuth();
  const { activeRole } = useLexContext();
  const queryClient = useQueryClient();
  const roleSlug = activeRole?.slug;
  const currentUserID = user?.id;
  const canCreate = canCreateManagerTask(roleSlug);

  const [status, setStatus] = useState<TaskScope>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [submitTask, setSubmitTask] = useState<ManagerTask | null>(null);
  const [reviewTask, setReviewTask] = useState<ManagerTask | null>(null);

  const tasksQuery = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: () =>
      managerTasksApi.list({
        page: 1,
        per_page: 100,
      }),
    staleTime: 30_000,
  });
  const usersQuery = useQuery({
    queryKey: ['lex', 'manager-tasks', 'assignees', roleSlug ?? 'unscoped'],
    queryFn: () => loadTaskAssignees(roleSlug),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const allTasks = useMemo(() => tasksQuery.data?.data ?? [], [tasksQuery.data?.data]);
  const tasks = useMemo(() => {
    if (status === 'all') return allTasks;
    if (status === 'active') {
      return allTasks.filter((task) => task.status === 'in_progress' || task.status === 'correction_required');
    }
    return allTasks.filter((task) => task.status === status);
  }, [allTasks, status]);
  const userNames = useMemo(
    () =>
      new Map(
        (usersQuery.data ?? []).map((entry) => [entry.id, userDisplayName(entry)]),
      ),
    [usersQuery.data],
  );
  const counts = useMemo(
    () => ({
      assigned: allTasks.filter((task) => task.status === 'assigned').length,
      active: allTasks.filter(
        (task) =>
          task.status === 'in_progress' || task.status === 'correction_required',
      ).length,
      review: allTasks.filter((task) => task.status === 'submitted').length,
      accepted: allTasks.filter((task) => task.status === 'accepted').length,
    }),
    [allTasks],
  );

  const invalidateTasks = () =>
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });

  const startMutation = useMutation({
    mutationFn: (taskID: string) => managerTasksApi.start(taskID),
    onSuccess: async () => {
      showSuccess(copy.toast.started);
      await invalidateTasks();
    },
    onError: showApiError,
  });
  const submitMutation = useMutation({
    mutationFn: ({ taskID, result }: { taskID: string; result: string }) =>
      managerTasksApi.submit(taskID, { result }),
    onSuccess: async () => {
      showSuccess(copy.toast.submitted);
      setSubmitTask(null);
      await invalidateTasks();
    },
    onError: showApiError,
  });
  const decisionMutation = useMutation({
    mutationFn: ({
      taskID,
      decision,
      note,
    }: {
      taskID: string;
      decision: 'accept' | 'return';
      note?: string;
    }) => managerTasksApi.decide(taskID, { decision, note }),
    onSuccess: async (_task, variables) => {
      showSuccess(
        variables.decision === 'accept'
          ? copy.toast.accepted
          : copy.toast.returned,
      );
      setReviewTask(null);
      await invalidateTasks();
    },
    onError: showApiError,
  });

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        description={copy.page.description}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => void tasksQuery.refetch()}
              disabled={tasksQuery.isFetching}
            >
              <RefreshCw
                className={
                  tasksQuery.isFetching
                    ? 'h-4 w-4 motion-safe:animate-spin'
                    : 'h-4 w-4'
                }
                aria-hidden
              />
              {copy.refresh}
            </Button>
            {canCreate ? (
              <Button type="button" className="gap-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                {copy.create}
              </Button>
            ) : null}
          </>
        }
      />

      <TaskKpis
        copy={copy}
        counts={counts}
        loading={tasksQuery.isLoading}
        activeScope={status}
        onScopeChange={(scope) => setStatus((current) => current === scope ? 'all' : scope)}
      />

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{copy.list.title}</CardTitle>
            <CardDescription>{copy.list.description}</CardDescription>
          </div>
          <div className="w-full sm:w-56">
            <Label htmlFor="manager-task-status" className="sr-only">
              {copy.filterLabel}
            </Label>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as TaskScope)
              }
            >
              <SelectTrigger id="manager-task-status" aria-label={copy.filterLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{copy.allStatuses}</SelectItem>
                <SelectItem value="active">{copy.kpis.active}</SelectItem>
                {MANAGER_TASK_STATUS_ORDER.map((item) => (
                  <SelectItem key={item} value={item}>
                    {copy.status[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {tasksQuery.isLoading ? (
            <TaskListSkeleton />
          ) : tasksQuery.isError ? (
            <TaskState
              icon={RotateCcw}
              title={copy.list.errorTitle}
              description={copy.list.errorBody}
              action={
                <Button variant="outline" onClick={() => void tasksQuery.refetch()}>
                  {copy.actions.retry}
                </Button>
              }
            />
          ) : tasks.length === 0 ? (
            <TaskState
              icon={ClipboardCheck}
              title={copy.list.emptyTitle}
              description={copy.list.emptyBody}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-caption text-muted-foreground">
                {copy.list.total(format.formatNumber(tasksQuery.data?.meta.total ?? tasks.length))}
              </p>
              {tasks.map((task) => {
                const actions = managerTaskActions(task, currentUserID, roleSlug);
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    copy={copy}
                    assigneeName={
                      userNames.get(task.assignee_id) ?? shortID(task.assignee_id)
                    }
                    created={format.formatDate(task.created_at, {
                      dateStyle: 'medium',
                    })}
                    updated={format.formatRelative(task.updated_at)}
                    actions={actions}
                    startPending={
                      startMutation.isPending && startMutation.variables === task.id
                    }
                    onStart={() => startMutation.mutate(task.id)}
                    onSubmit={() => setSubmitTask(task)}
                    onReview={() => setReviewTask(task)}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        copy={copy}
        locale={locale}
        direction={direction}
        assignees={usersQuery.data ?? []}
        assigneesLoading={usersQuery.isLoading}
        onCreated={invalidateTasks}
      />
      <SubmitTaskDialog
        task={submitTask}
        copy={copy}
        locale={locale}
        direction={direction}
        pending={submitMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setSubmitTask(null);
        }}
        onSubmit={(result) => {
          if (submitTask) submitMutation.mutate({ taskID: submitTask.id, result });
        }}
      />
      <ReviewTaskDialog
        task={reviewTask}
        copy={copy}
        locale={locale}
        direction={direction}
        pending={decisionMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setReviewTask(null);
        }}
        onDecision={(decision, note) => {
          if (reviewTask) {
            decisionMutation.mutate({ taskID: reviewTask.id, decision, note });
          }
        }}
      />
    </div>
  );
}

function TaskKpis({
  copy,
  counts,
  loading,
  activeScope,
  onScopeChange,
}: {
  copy: ManagerTasksCopy;
  counts: { assigned: number; active: number; review: number; accepted: number };
  loading: boolean;
  activeScope: TaskScope;
  onScopeChange: (scope: Exclude<TaskScope, 'all'>) => void;
}) {
  const format = useLexFormat();
  const items = [
    { label: copy.kpis.assigned, value: counts.assigned, icon: UsersRound, scope: 'assigned' as const },
    { label: copy.kpis.active, value: counts.active, icon: Clock3, scope: 'active' as const },
    { label: copy.kpis.review, value: counts.review, icon: Send, scope: 'submitted' as const },
    { label: copy.kpis.accepted, value: counts.accepted, icon: CheckCircle2, scope: 'accepted' as const },
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.page.title}>
      {items.map((item) => (
        <TaskKpiCard
          key={item.label}
          {...item}
          displayValue={format.formatNumber(item.value)}
          loading={loading}
          pressed={activeScope === item.scope}
          onAction={() => onScopeChange(item.scope)}
        />
      ))}
    </section>
  );
}

function TaskKpiCard({
  label,
  icon: Icon,
  displayValue,
  loading,
  pressed,
  onAction,
}: {
  label: string;
  icon: typeof UsersRound;
  displayValue: string;
  loading: boolean;
  pressed: boolean;
  onAction: () => void;
}) {
  return (
    <Button type="button" variant="ghost" onClick={onAction} aria-pressed={pressed} className="h-auto items-stretch justify-start rounded-xl p-0 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={pressed ? 'border-primary bg-primary/5' : 'transition hover:border-primary/40 hover:bg-primary/5'}>
        <CardContent className="flex items-center justify-between gap-4 pt-5 sm:pt-6">
          <div>
            <p className="text-caption font-medium text-muted-foreground">{label}</p>
            {loading ? <Skeleton className="mt-2 h-8 w-14" /> : <p className="mt-1 text-h2 font-semibold tabular-nums">{displayValue}</p>}
          </div>
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        </CardContent>
      </Card>
    </Button>
  );
}

function TaskCard({
  task,
  copy,
  assigneeName,
  created,
  updated,
  actions,
  startPending,
  onStart,
  onSubmit,
  onReview,
}: {
  task: ManagerTask;
  copy: ManagerTasksCopy;
  assigneeName: string;
  created: string;
  updated: string;
  actions: ReturnType<typeof managerTaskActions>;
  startPending: boolean;
  onStart: () => void;
  onSubmit: () => void;
  onReview: () => void;
}) {
  return (
    <article className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/25">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-semibold text-foreground">{task.title}</h3>
            <StatusBadge
              status={task.status}
              label={copy.status[task.status]}
              tone={STATUS_TONES[task.status]}
              size="sm"
            />
          </div>
          <p className="max-w-3xl whitespace-pre-wrap text-body-sm text-muted-foreground" dir="auto">
            {task.description}
          </p>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-caption">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{copy.list.assignedTo}</dt>
              <dd className="font-medium text-foreground">{assigneeName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{copy.list.created}</dt>
              <dd className="font-medium text-foreground">{created}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{copy.list.updated}</dt>
              <dd className="font-medium text-foreground">{updated}</dd>
            </div>
          </dl>
          {task.attachment ? (
            <div className="flex flex-wrap items-center gap-2 text-caption">
              <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">{copy.list.attachment}</span>
              <span className="font-medium text-foreground">
                {task.attachment.original_name}
              </span>
              <Badge variant="success" size="sm">
                {formatBytes(task.attachment.size_bytes)}
              </Badge>
            </div>
          ) : null}
          {task.result ? (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-overline font-semibold uppercase text-muted-foreground">
                {copy.list.result}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-body-sm" dir="auto">
                {task.result}
              </p>
            </div>
          ) : null}
          {task.correction_note ? (
            <div className="rounded-lg border border-warning-300/50 bg-warning-50/60 p-3 dark:bg-warning-700/10">
              <p className="text-overline font-semibold uppercase text-warning-700 dark:text-warning-300">
                {copy.list.correction}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-body-sm" dir="auto">
                {task.correction_note}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          {actions.canStart ? (
            <Button size="sm" variant="outline" className="gap-2" onClick={onStart} disabled={startPending}>
              {startPending ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {copy.actions.start}
            </Button>
          ) : null}
          {actions.canSubmit ? (
            <Button size="sm" className="gap-2" onClick={onSubmit}>
              <Send className="h-4 w-4" aria-hidden />
              {copy.actions.submit}
            </Button>
          ) : null}
          {actions.canReview ? (
            <Button size="sm" className="gap-2" onClick={onReview}>
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              {copy.actions.review}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  copy,
  locale,
  direction,
  assignees,
  assigneesLoading,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: ManagerTasksCopy;
  locale: string;
  direction: 'ltr' | 'rtl';
  assignees: UserDirectoryEntry[];
  assigneesLoading: boolean;
  onCreated: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeID, setAssigneeID] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const reset = () => {
    setTitle('');
    setDescription('');
    setAssigneeID('');
    setFile(null);
    setUploadProgress(0);
  };
  const mutation = useMutation({
    mutationFn: async () => {
      let attachmentFileID: string | undefined;
      if (file) {
        const uploaded = await enterpriseApi.files.upload(
          file,
          {
            suite: 'lex',
            entity_type: 'manager_task_attachment',
            lifecycle_policy: 'standard',
          },
          setUploadProgress,
        );
        await waitForCleanAttachment(
          uploaded.id,
          uploaded.virus_scan_status,
          {
            rejected:
              locale === 'ar'
                ? 'لم يجتز الملف فحص الحماية.'
                : 'The attachment did not pass its security scan.',
            timedOut:
              locale === 'ar'
                ? 'لم يكتمل فحص الملف بعد. حاول مرة أخرى لاحقاً.'
                : 'The attachment scan is still pending. Try again shortly.',
          },
        );
        attachmentFileID = uploaded.id;
      }
      return managerTasksApi.create({
        title: title.trim(),
        description: description.trim(),
        assignee_id: assigneeID,
        attachment_file_id: attachmentFileID,
      });
    },
    onSuccess: async () => {
      showSuccess(copy.toast.created);
      reset();
      onOpenChange(false);
      await onCreated();
    },
    onError: showApiError,
  });
  const valid =
    title.trim().length > 0 &&
    title.trim().length <= 200 &&
    description.trim().length > 0 &&
    description.trim().length <= 10_000 &&
    assigneeID.length > 0 &&
    (!file || file.size <= MAX_ATTACHMENT_BYTES);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent dir={direction} lang={locale} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.createDialog.title}</DialogTitle>
          <DialogDescription>{copy.createDialog.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manager-task-title">{copy.createDialog.titleLabel}</Label>
            <Input
              id="manager-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy.createDialog.titlePlaceholder}
              maxLength={200}
              dir="auto"
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manager-task-description">
              {copy.createDialog.descriptionLabel}
            </Label>
            <Textarea
              id="manager-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={copy.createDialog.descriptionPlaceholder}
              rows={5}
              maxLength={10_000}
              dir="auto"
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manager-task-assignee">
              {copy.createDialog.assigneeLabel}
            </Label>
            <Select value={assigneeID} onValueChange={setAssigneeID} disabled={mutation.isPending || assigneesLoading}>
              <SelectTrigger id="manager-task-assignee">
                <SelectValue
                  placeholder={
                    assigneesLoading
                      ? copy.createDialog.assigneesLoading
                      : copy.createDialog.assigneePlaceholder
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee.id} value={assignee.id}>
                    {userDisplayName(assignee)} · {assignee.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!assigneesLoading && assignees.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {copy.createDialog.noAssignees}
              </p>
            ) : null}
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div>
              <Label htmlFor="manager-task-attachment">
                {copy.createDialog.attachmentLabel}
              </Label>
              <p className="mt-1 text-caption text-muted-foreground">
                {copy.createDialog.attachmentHint}
              </p>
            </div>
            <input
              id="manager-task-attachment"
              type="file"
              className="sr-only"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
              disabled={mutation.isPending}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2.5 text-body-sm">
                <span className="min-w-0 truncate">
                  {file.name} · {formatBytes(file.size)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setFile(null)}
                  disabled={mutation.isPending}
                >
                  {copy.createDialog.removeFile}
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" asChild>
                <label htmlFor="manager-task-attachment" className="cursor-pointer gap-2">
                  <Upload className="h-4 w-4" aria-hidden />
                  {copy.createDialog.chooseFile}
                </label>
              </Button>
            )}
            {file && file.size > MAX_ATTACHMENT_BYTES ? (
              <p role="alert" className="text-caption text-destructive">
                {locale === 'ar'
                  ? 'يجب ألا يتجاوز حجم الملف 25 ميجابايت.'
                  : 'The attachment must be 25 MB or smaller.'}
              </p>
            ) : null}
            {mutation.isPending && file ? (
              <p role="status" className="text-caption text-muted-foreground">
                {locale === 'ar'
                  ? `جارٍ رفع الملف وفحصه… ${uploadProgress}%`
                  : `Uploading and scanning… ${uploadProgress}%`}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {copy.createDialog.cancel}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? (
              <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden />
            ) : null}
            {mutation.isPending ? copy.createDialog.saving : copy.createDialog.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitTaskDialog({
  task,
  copy,
  locale,
  direction,
  pending,
  onOpenChange,
  onSubmit,
}: {
  task: ManagerTask | null;
  copy: ManagerTasksCopy;
  locale: string;
  direction: 'ltr' | 'rtl';
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (result: string) => void;
}) {
  const [result, setResult] = useState('');
  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open && !pending) setResult('');
        onOpenChange(open);
      }}
    >
      <DialogContent dir={direction} lang={locale}>
        <DialogHeader>
          <DialogTitle>{copy.submitDialog.title}</DialogTitle>
          <DialogDescription>{copy.submitDialog.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="manager-task-result">{copy.submitDialog.resultLabel}</Label>
          <Textarea
            id="manager-task-result"
            value={result}
            onChange={(event) => setResult(event.target.value)}
            placeholder={copy.submitDialog.resultPlaceholder}
            rows={7}
            dir="auto"
            disabled={pending}
          />
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {copy.submitDialog.cancel}
          </Button>
          <Button type="button" onClick={() => onSubmit(result.trim())} disabled={pending || !result.trim()}>
            {pending ? <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden /> : null}
            {pending ? copy.submitDialog.saving : copy.submitDialog.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewTaskDialog({
  task,
  copy,
  locale,
  direction,
  pending,
  onOpenChange,
  onDecision,
}: {
  task: ManagerTask | null;
  copy: ManagerTasksCopy;
  locale: string;
  direction: 'ltr' | 'rtl';
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onDecision: (decision: 'accept' | 'return', note?: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open && !pending) setNote('');
        onOpenChange(open);
      }}
    >
      <DialogContent dir={direction} lang={locale}>
        <DialogHeader>
          <DialogTitle>{copy.reviewDialog.title}</DialogTitle>
          <DialogDescription>{copy.reviewDialog.description}</DialogDescription>
        </DialogHeader>
        {task?.result ? (
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-overline font-semibold uppercase text-muted-foreground">
              {copy.reviewDialog.resultLabel}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-body-sm" dir="auto">
              {task.result}
            </p>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="manager-task-review-note">{copy.reviewDialog.noteLabel}</Label>
          <Textarea
            id="manager-task-review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.reviewDialog.notePlaceholder}
            rows={5}
            dir="auto"
            disabled={pending}
          />
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {copy.reviewDialog.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecision('return', note.trim())}
            disabled={pending || !note.trim()}
          >
            {pending ? <Loader2 className="me-2 h-4 w-4 motion-safe:animate-spin" aria-hidden /> : null}
            {copy.reviewDialog.return}
          </Button>
          <Button type="button" onClick={() => onDecision('accept')} disabled={pending}>
            {copy.reviewDialog.accept}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof ClipboardCheck;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
      <span className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-body-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function TaskListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((item) => (
        <div key={item} className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-72" />
        </div>
      ))}
    </div>
  );
}

export default function LexManagerTasksPage() {
  return (
    <LexRouteGuard route="/lex/tasks">
      <ManagerTasksContent />
    </LexRouteGuard>
  );
}
