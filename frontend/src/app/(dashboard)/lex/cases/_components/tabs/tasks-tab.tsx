'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { ClipboardList, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { FormField } from '@/components/shared/forms/form-field';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  CASE_TASK_STATUS_OPTIONS,
  LEGAL_PRIORITY_OPTIONS,
  formatCaseToken,
  type CaseTask,
  type CaseTaskStatus,
  type LegalPriority,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';

interface TasksTabProps {
  caseId: string;
  tasks: CaseTask[];
  canWrite: boolean;
  onChanged: () => Promise<void> | void;
}

function buildTaskSchema(titleRequired: string) {
  return z.object({
    title: z.string().trim().min(1, titleRequired),
    assignee_id: z.string().optional().default(''),
    priority: z.enum(LEGAL_PRIORITY_OPTIONS as unknown as [LegalPriority, ...LegalPriority[]]),
    status: z.enum(CASE_TASK_STATUS_OPTIONS as unknown as [CaseTaskStatus, ...CaseTaskStatus[]]),
    due_date: z.string().optional().default(''),
  });
}
type TaskValues = z.infer<ReturnType<typeof buildTaskSchema>>;

const TASK_TEMPLATES: Array<{
  id: string;
  priority: LegalPriority;
  dueInDays: number;
}> = [
  { id: 'case-review', priority: 'high', dueInDays: 2 },
  { id: 'evidence-index', priority: 'medium', dueInDays: 5 },
  { id: 'pleading-draft', priority: 'high', dueInDays: 7 },
  { id: 'hearing-pack', priority: 'medium', dueInDays: 10 },
  { id: 'deadline-check', priority: 'critical', dueInDays: 1 },
];

function dueDateIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function TasksTab({ caseId, tasks, canWrite, onChanged }: TasksTabProps) {
  const labels = useCaseLabels();
  const t = labels.tasks;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CaseTask | null>(null);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>(TASK_TEMPLATES.map((template) => template.id));
  const [templateAssigneeId, setTemplateAssigneeId] = useState('');

  const schema = useMemo(
    () => buildTaskSchema(labels.taskForm.errors.titleRequired),
    [labels.taskForm.errors.titleRequired],
  );
  const form = useForm<TaskValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', assignee_id: '', priority: 'medium', status: 'open', due_date: '' },
  });

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-case-task'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: addOpen || templateOpen,
  });
  const usersData = usersQuery.data?.data;
  const users = useMemo(() => usersData ?? [], [usersData]);
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  useEffect(() => {
    if (addOpen) form.reset({ title: '', assignee_id: '', priority: 'medium', status: 'open', due_date: '' });
  }, [addOpen, form]);

  const refresh = async () => {
    await Promise.all([
      onChanged(),
      queryClient.invalidateQueries({ queryKey: ['lex-case', caseId] }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (values: TaskValues) =>
      casesApi.defineTask(caseId, {
        title: values.title,
        assignee_id: values.assignee_id || null,
        priority: values.priority,
        status: values.status,
        due_date: values.due_date ? new Date(values.due_date).toISOString() : null,
      }),
    onSuccess: async () => {
      showSuccess(labels.toast.taskAdded);
      setAddOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  /**
   * Task status used to live on the removed "Required Actions" list under
   * Legal Position. Keep the complete four-state lifecycle on this canonical
   * tab so tasks can be started, completed, or cancelled without another
   * duplicate task surface.
   */
  const statusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: CaseTaskStatus }) =>
      casesApi.updateTask(caseId, taskId, { status }),
    onSuccess: async () => {
      showSuccess(labels.toast.taskStatusUpdated);
      await refresh();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (taskId: string) => casesApi.deleteTask(caseId, taskId),
    onSuccess: async () => {
      showSuccess(labels.toast.taskRemoved);
      setRemoveTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  const templateMutation = useMutation({
    mutationFn: async () => {
      const templates = TASK_TEMPLATES.filter((template) => selectedTemplates.includes(template.id));
      await Promise.all(
        templates.map((template) =>
          casesApi.defineTask(caseId, {
            title: t.templateTitles[template.id] ?? template.id,
            assignee_id: templateAssigneeId || null,
            priority: template.priority,
            status: 'open',
            due_date: dueDateIn(template.dueInDays),
            metadata: { template_id: template.id },
          }),
        ),
      );
    },
    onSuccess: async () => {
      showSuccess(t.templatesCreated);
      setTemplateOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const assigneeValue = form.watch('assignee_id');
  const priorityValue = form.watch('priority');
  const statusValue = form.watch('status');

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)}>
              <ClipboardList className="me-1.5 h-3.5 w-3.5" />
              {t.templates}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t.add}
            </Button>
          </div>
        ) : undefined
      }
    >
      {tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
              <span className="absolute inset-y-0 start-0 w-1 bg-warning-300/70" aria-hidden />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{task.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.due_date ? <RelativeTime date={task.due_date} /> : t.noDue}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {labels.filters.priorityOptions[task.priority] ?? formatCaseToken(task.priority)}
                  </Badge>
                  {canWrite ? (
                    <Select
                      value={task.status}
                      disabled={
                        task.status === 'cancelled' ||
                        (statusMutation.isPending && statusMutation.variables?.taskId === task.id)
                      }
                      onValueChange={(status) =>
                        statusMutation.mutate({ taskId: task.id, status: status as CaseTaskStatus })
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-36 text-xs"
                        aria-label={t.statusFor(task.title)}
                        aria-busy={
                          statusMutation.isPending && statusMutation.variables?.taskId === task.id
                        }
                      >
                        {statusMutation.isPending && statusMutation.variables?.taskId === task.id ? (
                          <Loader2 className="me-1 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                        ) : null}
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CASE_TASK_STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>
                            {labels.filters.taskStatusOptions[status] ?? formatCaseToken(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">
                      {labels.filters.taskStatusOptions[task.status] ?? formatCaseToken(task.status)}
                    </Badge>
                  )}
                  {canWrite ? (
                    <Button size="sm" variant="outline" onClick={() => setRemoveTarget(task)}>
                      <Trash2 className="me-1.5 h-3.5 w-3.5" />
                      {t.remove}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{labels.taskForm.addTitle}</DialogTitle>
                <DialogDescription>{labels.taskForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...form}>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => addMutation.mutate(v))}>
                  <FormField name="title" label={labels.taskForm.title} required>
                    <Input id="title" {...form.register('title')} placeholder={labels.taskForm.titlePlaceholder} />
                  </FormField>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="assignee_id" label={labels.taskForm.assignee}>
                      <Select
                        value={assigneeValue || 'none'}
                        onValueChange={(v) => form.setValue('assignee_id', v === 'none' ? '' : v, { shouldValidate: true })}
                      >
                        <SelectTrigger id="assignee_id">
                          <SelectValue placeholder={labels.taskForm.assigneePlaceholder} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{labels.taskForm.keepAssignee}</SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {userDisplayName(usersById.get(u.id) ?? u)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="due_date" label={labels.taskForm.due}>
                      <Input id="due_date" type="date" {...form.register('due_date')} />
                    </FormField>
                    <FormField name="priority" label={labels.taskForm.priority} required>
                      <Select
                        value={priorityValue}
                        onValueChange={(v) => form.setValue('priority', v as LegalPriority, { shouldValidate: true })}
                      >
                        <SelectTrigger id="priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEGAL_PRIORITY_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {labels.filters.priorityOptions[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="status" label={labels.taskForm.status} required>
                      <Select
                        value={statusValue}
                        onValueChange={(v) => form.setValue('status', v as CaseTaskStatus, { shouldValidate: true })}
                      >
                        <SelectTrigger id="status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CASE_TASK_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {labels.filters.taskStatusOptions[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  {usersQuery.isError ? (
                    <p className="text-xs text-destructive">{labels.taskForm.usersError}</p>
                  ) : null}
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                      {labels.taskForm.cancel}
                    </Button>
                    <Button type="submit" disabled={addMutation.isPending}>
                      {addMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {labels.taskForm.submit}
                    </Button>
                  </DialogFooter>
                </form>
              </FormProvider>
            </DialogContent>
          </Dialog>

          <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t.templatesTitle}</DialogTitle>
                <DialogDescription>{t.templatesDescription}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {TASK_TEMPLATES.map((template) => {
                    const checked = selectedTemplates.includes(template.id);
                    return (
                      <label
                        key={template.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            setSelectedTemplates((current) =>
                              next === true
                                ? Array.from(new Set([...current, template.id]))
                                : current.filter((id) => id !== template.id),
                            );
                          }}
                        />
                        <span className="min-w-0 space-y-1">
                          <span className="block font-medium">{t.templateTitles[template.id] ?? template.id}</span>
                          <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">
                              {labels.filters.priorityOptions[template.priority] ?? formatCaseToken(template.priority)}
                            </Badge>
                            {t.dueInDays(template.dueInDays)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="template_assignee">{labels.taskForm.assignee}</Label>
                  <Select
                    value={templateAssigneeId || 'none'}
                    onValueChange={(v) => setTemplateAssigneeId(v === 'none' ? '' : v)}
                  >
                    <SelectTrigger id="template_assignee">
                      <SelectValue placeholder={labels.taskForm.assigneePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{labels.taskForm.keepAssignee}</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {userDisplayName(usersById.get(u.id) ?? u)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {usersQuery.isError ? (
                  <p className="text-xs text-destructive">{labels.taskForm.usersError}</p>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTemplateOpen(false)}>
                  {labels.taskForm.cancel}
                </Button>
                <Button
                  type="button"
                  disabled={templateMutation.isPending || selectedTemplates.length === 0}
                  onClick={() => templateMutation.mutate()}
                >
                  {templateMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                  {t.createTasks}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={labels.confirm.removeTaskTitle}
            description={labels.confirm.removeTaskDescription(removeTarget?.title ?? '')}
            confirmLabel={t.remove}
            variant="destructive"
            loading={removeMutation.isPending}
            onConfirm={async () => {
              if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
            }}
          />
        </>
      ) : null}
    </SectionCard>
  );
}
