'use client';

/**
 * MatterObligationManager — full obligation lifecycle surface for the Watheeq
 * (Lex) matter detail page. Replaces the prior read-only obligation list with a
 * create / edit / delete + status-transition (complete / in-progress / block /
 * waive / cancel) console scoped to a single matter.
 *
 * Self-contained bilingual labels (EN + professional MSA) following the canonical
 * lex bilingual contract (`../../_lib/lex-i18n.ts`): a `LexBilingual<T>` bundle
 * resolved by {@link useObligationManagerLabels}. The component renders the list
 * CONTENT only — the integrator keeps the surrounding `SectionCard` (titled from
 * the matter detail labels) so the existing detail tests stay green.
 *
 * Legal glossary: قضية (matter) / التزام (obligation) / مهلة (deadline) /
 * تذكير (reminder) / مستند (document) / تصعيد (escalation).
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Ban,
  CheckCircle2,
  CirclePause,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  PencilLine,
  PlayCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { FormField } from '@/components/shared/forms/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type {
  LexCreateObligationPayload,
  LexLegalPriority,
  LexObligation,
  LexObligationStatus,
  LexObligationType,
  LexUpdateObligationPayload,
} from '@/types/suites';

/* ------------------------------------------------------------------------- *
 * Enum option sets (raw backend tokens).
 * ------------------------------------------------------------------------- */

export const OBLIGATION_TYPE_OPTIONS: readonly LexObligationType[] = [
  'contractual',
  'renewal',
  'notice',
  'payment',
  'delivery',
  'reporting',
  'compliance',
  'covenant',
  'condition_precedent',
  'regulatory',
  'other',
] as const;

export const OBLIGATION_PRIORITY_OPTIONS: readonly LexLegalPriority[] = [
  'critical',
  'high',
  'medium',
  'low',
] as const;

/**
 * Status transitions exposed as quick actions on a live obligation, keyed by the
 * current status. `completed`, `waived`, and `cancelled` are terminal and expose
 * no further moves.
 */
const OBLIGATION_STATUS_ACTIONS: Record<string, readonly LexObligationStatus[]> = {
  open: ['in_progress', 'completed', 'blocked', 'waived', 'cancelled'],
  in_progress: ['completed', 'blocked', 'waived', 'cancelled'],
  blocked: ['in_progress', 'completed', 'waived', 'cancelled'],
  completed: [],
  waived: [],
  cancelled: [],
};

/* ------------------------------------------------------------------------- *
 * Bilingual labels.
 * ------------------------------------------------------------------------- */

interface ObligationManagerLabels {
  newObligation: string;
  emptyTitle: string;
  emptyDescription: string;
  loadError: string;
  overdue: string;
  dueOn: (date: string) => string;
  completedOn: (date: string) => string;
  owner: string;
  unassigned: string;
  noDueDate: string;
  actionsAria: string;
  statusActionLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  typeLabels: Record<string, string>;
  priorityLabels: Record<string, string>;
  edit: string;
  delete: string;
  form: {
    createTitle: string;
    editTitle: string;
    createDescription: string;
    editDescription: string;
    title: string;
    titlePlaceholder: string;
    type: string;
    priority: string;
    owner: string;
    ownerPlaceholder: string;
    dueDate: string;
    description: string;
    descriptionPlaceholder: string;
    usersError: string;
    cancel: string;
    create: string;
    save: string;
    errors: {
      titleRequired: string;
      ownerRequired: string;
      ownerNameRequired: string;
      dueDateRequired: string;
    };
  };
  confirm: {
    deleteTitle: string;
    deleteConfirm: string;
    deleteDescription: (title: string) => string;
  };
  toast: {
    created: string;
    updated: string;
    statusUpdated: string;
    deleted: string;
  };
}

const obligationManagerLabels: LexBilingual<ObligationManagerLabels> = {
  en: {
    newObligation: 'New Obligation',
    emptyTitle: 'No obligations',
    emptyDescription: 'Track a deadline or deliverable by adding the first obligation to this matter.',
    loadError: 'Failed to load matter obligations.',
    overdue: 'Overdue',
    dueOn: (date) => `Due ${date}`,
    completedOn: (date) => `Completed ${date}`,
    owner: 'Owner',
    unassigned: 'Unassigned',
    noDueDate: 'No due date',
    actionsAria: 'Obligation actions',
    statusActionLabels: {
      in_progress: 'Mark in progress',
      completed: 'Mark complete',
      blocked: 'Block',
      waived: 'Waive',
      cancelled: 'Cancel obligation',
    },
    statusLabels: {
      open: 'Open',
      in_progress: 'In Progress',
      blocked: 'Blocked',
      completed: 'Completed',
      waived: 'Waived',
      cancelled: 'Cancelled',
    },
    typeLabels: {
      contractual: 'Contractual',
      renewal: 'Renewal',
      notice: 'Notice',
      payment: 'Payment',
      delivery: 'Delivery',
      reporting: 'Reporting',
      compliance: 'Compliance',
      covenant: 'Covenant',
      condition_precedent: 'Condition precedent',
      regulatory: 'Regulatory',
      other: 'Other',
    },
    priorityLabels: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    edit: 'Edit',
    delete: 'Delete',
    form: {
      createTitle: 'Add Obligation',
      editTitle: 'Edit Obligation',
      createDescription: 'Register an obligation, deadline, or deliverable tied to this matter.',
      editDescription: 'Update the obligation title, type, owner, due date, and context.',
      title: 'Title',
      titlePlaceholder: 'Serve termination notice',
      type: 'Type',
      priority: 'Priority',
      owner: 'Owner',
      ownerPlaceholder: 'Select owner',
      dueDate: 'Due date',
      description: 'Description',
      descriptionPlaceholder: 'Obligation scope, contractual basis, and completion criteria.',
      usersError:
        'Unable to load the user directory. Saving is disabled until owners can be resolved.',
      cancel: 'Cancel',
      create: 'Add obligation',
      save: 'Save changes',
      errors: {
        titleRequired: 'Obligation title is required.',
        ownerRequired: 'Select an obligation owner.',
        ownerNameRequired: 'Owner name is required.',
        dueDateRequired: 'A due date is required.',
      },
    },
    confirm: {
      deleteTitle: 'Delete obligation',
      deleteConfirm: 'Delete',
      deleteDescription: (title) =>
        `Delete "${title}"? This removes the obligation from this matter.`,
    },
    toast: {
      created: 'Obligation created.',
      updated: 'Obligation updated.',
      statusUpdated: 'Obligation status updated.',
      deleted: 'Obligation deleted.',
    },
  },
  ar: {
    newObligation: 'التزام جديد',
    emptyTitle: 'لا توجد التزامات',
    emptyDescription: 'تتبّع مهلة أو مُخرجًا بإضافة أول التزام إلى هذه القضية.',
    loadError: 'تعذّر تحميل التزامات القضية.',
    overdue: 'متأخر',
    dueOn: (date) => `الاستحقاق ${date}`,
    completedOn: (date) => `اكتمل ${date}`,
    owner: 'المسؤول',
    unassigned: 'غير مُسند',
    noDueDate: 'بلا تاريخ استحقاق',
    actionsAria: 'إجراءات الالتزام',
    statusActionLabels: {
      in_progress: 'وضع قيد التنفيذ',
      completed: 'وضع كمكتمل',
      blocked: 'حظر',
      waived: 'إعفاء',
      cancelled: 'إلغاء الالتزام',
    },
    statusLabels: {
      open: 'مفتوح',
      in_progress: 'قيد التنفيذ',
      blocked: 'محظور',
      completed: 'مكتمل',
      waived: 'مُعفى',
      cancelled: 'ملغى',
    },
    typeLabels: {
      contractual: 'تعاقدي',
      renewal: 'تجديد',
      notice: 'إشعار',
      payment: 'دفع',
      delivery: 'تسليم',
      reporting: 'تقارير',
      compliance: 'امتثال',
      covenant: 'تعهّد',
      condition_precedent: 'شرط مسبق',
      regulatory: 'تنظيمي',
      other: 'أخرى',
    },
    priorityLabels: {
      critical: 'حرجة',
      high: 'مرتفعة',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
    edit: 'تعديل',
    delete: 'حذف',
    form: {
      createTitle: 'إضافة التزام',
      editTitle: 'تعديل الالتزام',
      createDescription: 'تسجيل التزام أو مهلة أو مُخرج مرتبط بهذه القضية.',
      editDescription: 'تحديث عنوان الالتزام ونوعه ومسؤوله وتاريخ استحقاقه وسياقه.',
      title: 'العنوان',
      titlePlaceholder: 'تبليغ إشعار الإنهاء',
      type: 'النوع',
      priority: 'الأولوية',
      owner: 'المسؤول',
      ownerPlaceholder: 'اختر المسؤول',
      dueDate: 'تاريخ الاستحقاق',
      description: 'الوصف',
      descriptionPlaceholder: 'نطاق الالتزام وأساسه التعاقدي ومعايير إنجازه.',
      usersError:
        'تعذّر تحميل دليل المستخدمين. الحفظ معطّل حتى يتعذّر تعيين المسؤولين.',
      cancel: 'إلغاء',
      create: 'إضافة الالتزام',
      save: 'حفظ التغييرات',
      errors: {
        titleRequired: 'عنوان الالتزام مطلوب.',
        ownerRequired: 'اختر مسؤولًا للالتزام.',
        ownerNameRequired: 'اسم المسؤول مطلوب.',
        dueDateRequired: 'تاريخ الاستحقاق مطلوب.',
      },
    },
    confirm: {
      deleteTitle: 'حذف الالتزام',
      deleteConfirm: 'حذف',
      deleteDescription: (title) => `حذف "${title}"؟ سيؤدي ذلك إلى إزالة الالتزام من هذه القضية.`,
    },
    toast: {
      created: 'تم إنشاء الالتزام.',
      updated: 'تم تحديث الالتزام.',
      statusUpdated: 'تم تحديث حالة الالتزام.',
      deleted: 'تم حذف الالتزام.',
    },
  },
};

function useObligationManagerLabels(): ObligationManagerLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(obligationManagerLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

interface MatterObligationManagerProps {
  matterId: string;
  canWrite: boolean;
}

export function MatterObligationManager({ matterId, canWrite }: MatterObligationManagerProps) {
  const labels = useObligationManagerLabels();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LexObligation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LexObligation | null>(null);

  const obligationsQuery = useQuery({
    queryKey: ['lex-matter-obligations', matterId],
    queryFn: () =>
      enterpriseApi.lex.listMatterObligations(matterId, { page: 1, per_page: 50, order: 'asc' }),
    enabled: Boolean(matterId),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-matter-obligations', matterId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LexObligationStatus }) =>
      enterpriseApi.lex.updateObligationStatus(id, { status }),
    onSuccess: async () => {
      showSuccess(labels.toast.statusUpdated);
      await invalidate();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteObligation(id),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      setDeleteTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const obligations = obligationsQuery.data?.data ?? [];

  if (obligationsQuery.isLoading) {
    return <LoadingSkeleton variant="list-item" count={3} />;
  }

  if (obligationsQuery.isError) {
    return <ErrorState message={labels.loadError} onRetry={() => void obligationsQuery.refetch()} />;
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {labels.newObligation}
          </Button>
        </div>
      ) : null}

      {obligations.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={labels.emptyTitle}
          description={labels.emptyDescription}
          action={
            canWrite
              ? { label: labels.newObligation, onClick: () => setCreateOpen(true) }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {obligations.map((obligation) => (
            <ObligationRow
              key={obligation.id}
              obligation={obligation}
              labels={labels}
              canWrite={canWrite}
              statusPending={
                statusMutation.isPending && statusMutation.variables?.id === obligation.id
              }
              onStatus={(status) => statusMutation.mutate({ id: obligation.id, status })}
              onEdit={() => setEditTarget(obligation)}
              onDelete={() => setDeleteTarget(obligation)}
            />
          ))}
        </ul>
      )}

      {canWrite ? (
        <>
          <ObligationFormDialog
            matterId={matterId}
            open={createOpen}
            obligation={null}
            labels={labels}
            onOpenChange={setCreateOpen}
            onSaved={() => void invalidate()}
          />
          <ObligationFormDialog
            matterId={matterId}
            open={Boolean(editTarget)}
            obligation={editTarget}
            labels={labels}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
            onSaved={() => void invalidate()}
          />
          <ConfirmDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            title={labels.confirm.deleteTitle}
            description={labels.confirm.deleteDescription(deleteTarget?.title ?? '')}
            confirmLabel={labels.confirm.deleteConfirm}
            variant="destructive"
            loading={deleteMutation.isPending}
            onConfirm={async () => {
              if (deleteTarget) {
                await deleteMutation.mutateAsync(deleteTarget.id);
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Row.
 * ------------------------------------------------------------------------- */

const STATUS_ACTION_ICONS: Record<string, typeof PlayCircle> = {
  in_progress: PlayCircle,
  completed: CheckCircle2,
  blocked: PauseCircle,
  waived: CirclePause,
  cancelled: Ban,
};

interface ObligationRowProps {
  obligation: LexObligation;
  labels: ObligationManagerLabels;
  canWrite: boolean;
  statusPending: boolean;
  onStatus: (status: LexObligationStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ObligationRow({
  obligation,
  labels,
  canWrite,
  statusPending,
  onStatus,
  onEdit,
  onDelete,
}: ObligationRowProps) {
  const overdue = isOverdue(obligation);
  const statusActions = OBLIGATION_STATUS_ACTIONS[obligation.status] ?? [];

  return (
    <li className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
      <span
        className={`absolute inset-y-0 start-0 w-1 ${obligationStatusAccent(obligation.status, overdue)}`}
        aria-hidden
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{obligation.title}</span>
            <Badge variant="outline">{typeLabel(labels, obligation.type)}</Badge>
            {overdue ? <Badge variant="destructive">{labels.overdue}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {labels.owner}: {obligation.owner_name || labels.unassigned} •{' '}
            {obligation.completed_at
              ? labels.completedOn(formatDateTime(obligation.completed_at))
              : obligation.due_date
                ? labels.dueOn(formatDateTime(obligation.due_date))
                : labels.noDueDate}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PriorityBadge labels={labels} priority={obligation.priority} />
          <ObligationStatusBadge labels={labels} status={obligation.status} overdue={overdue} />
          {canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={labels.actionsAria}
                  disabled={statusPending}
                >
                  {statusPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {statusActions.map((status) => {
                  const Icon = STATUS_ACTION_ICONS[status] ?? PlayCircle;
                  return (
                    <DropdownMenuItem key={status} onClick={() => onStatus(status)}>
                      <Icon className="me-2 h-4 w-4" />
                      {labels.statusActionLabels[status] ?? status}
                    </DropdownMenuItem>
                  );
                })}
                {statusActions.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={onEdit}>
                  <PencilLine className="me-2 h-4 w-4" />
                  {labels.edit}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  {labels.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------- *
 * Create / edit dialog.
 * ------------------------------------------------------------------------- */

function buildObligationFormSchema(errors: ObligationManagerLabels['form']['errors']) {
  return z.object({
    title: z.string().trim().min(3, errors.titleRequired),
    type: z.enum(
      OBLIGATION_TYPE_OPTIONS as unknown as [LexObligationType, ...LexObligationType[]],
    ),
    priority: z.enum(
      OBLIGATION_PRIORITY_OPTIONS as unknown as [LexLegalPriority, ...LexLegalPriority[]],
    ),
    owner_user_id: z.string().uuid(errors.ownerRequired),
    owner_name: z.string().trim().min(1, errors.ownerNameRequired),
    due_date: z.string().trim().min(1, errors.dueDateRequired),
    description: z.string().trim().optional().nullable(),
  });
}

type ObligationFormValues = z.infer<ReturnType<typeof buildObligationFormSchema>>;

interface ObligationFormDialogProps {
  matterId: string;
  obligation: LexObligation | null;
  open: boolean;
  labels: ObligationManagerLabels;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

function ObligationFormDialog({
  matterId,
  obligation,
  open,
  labels,
  onOpenChange,
  onSaved,
}: ObligationFormDialogProps) {
  const isEdit = Boolean(obligation);
  const { user } = useAuth();
  const formLabels = labels.form;
  const schema = useMemo(() => buildObligationFormSchema(formLabels.errors), [formLabels.errors]);

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-obligation-dialog'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });

  const users = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const usersById = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);

  const form = useForm<ObligationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildObligationFormDefaults(obligation),
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    form.reset(buildObligationFormDefaults(obligation));
  }, [obligation, form, open]);

  // Default the owner to the current user on create when resolvable.
  useEffect(() => {
    if (!open || isEdit || users.length === 0) {
      return;
    }
    if (form.getValues('owner_user_id')) {
      return;
    }
    const currentUserId = user?.id;
    if (!currentUserId || !usersById.has(currentUserId)) {
      return;
    }
    applyOwner(currentUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isEdit, open, user?.id, users.length, usersById]);

  const applyOwner = (userId: string) => {
    const directoryUser = usersById.get(userId);
    form.setValue('owner_user_id', userId, { shouldValidate: true });
    form.setValue('owner_name', directoryUser ? userDisplayName(directoryUser) : '', {
      shouldValidate: true,
    });
  };

  const saveMutation = useMutation({
    mutationFn: (values: ObligationFormValues) => {
      if (isEdit && obligation) {
        return enterpriseApi.lex.updateObligation(obligation.id, buildUpdatePayload(values));
      }
      return enterpriseApi.lex.createObligation(buildCreatePayload(values, matterId));
    },
    onSuccess: () => {
      showSuccess(isEdit ? labels.toast.updated : labels.toast.created);
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const ownerValue = form.watch('owner_user_id');
  const typeValue = form.watch('type');
  const priorityValue = form.watch('priority');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? formLabels.editTitle : formLabels.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? formLabels.editDescription : formLabels.createDescription}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          >
            <FormField name="title" label={formLabels.title} required>
              <Input
                id="title"
                {...form.register('title')}
                placeholder={formLabels.titlePlaceholder}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="type" label={formLabels.type} required>
                <Select
                  value={typeValue}
                  onValueChange={(value) =>
                    form.setValue('type', value as ObligationFormValues['type'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBLIGATION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {labels.typeLabels[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="priority" label={formLabels.priority} required>
                <Select
                  value={priorityValue}
                  onValueChange={(value) =>
                    form.setValue('priority', value as ObligationFormValues['priority'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBLIGATION_PRIORITY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {labels.priorityLabels[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="owner_user_id" label={formLabels.owner} required>
                <Select value={ownerValue} onValueChange={applyOwner}>
                  <SelectTrigger id="owner_user_id">
                    <SelectValue placeholder={formLabels.ownerPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {userDisplayName(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="due_date" label={formLabels.dueDate} required>
                <Input id="due_date" type="date" {...form.register('due_date')} />
              </FormField>
            </div>

            <FormField name="description" label={formLabels.description}>
              <Textarea
                id="description"
                {...form.register('description')}
                placeholder={formLabels.descriptionPlaceholder}
                rows={3}
              />
            </FormField>

            {usersQuery.isError ? (
              <p className="text-sm text-destructive">{formLabels.usersError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {formLabels.cancel}
              </Button>
              <Button
                type="submit"
                disabled={saveMutation.isPending || usersQuery.isLoading || usersQuery.isError}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {isEdit ? formLabels.save : formLabels.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Payload + value helpers.
 * ------------------------------------------------------------------------- */

function buildObligationFormDefaults(obligation: LexObligation | null): ObligationFormValues {
  return {
    title: obligation?.title ?? '',
    type: normalizeOption(obligation?.type, OBLIGATION_TYPE_OPTIONS, 'contractual'),
    priority: normalizeOption(obligation?.priority, OBLIGATION_PRIORITY_OPTIONS, 'medium'),
    owner_user_id: obligation?.owner_user_id ?? '',
    owner_name: obligation?.owner_name ?? '',
    due_date: toDateInputValue(obligation?.due_date),
    description: obligation?.description ?? '',
  };
}

function buildCreatePayload(
  values: ObligationFormValues,
  matterId: string,
): LexCreateObligationPayload {
  return {
    title: values.title.trim(),
    type: values.type,
    priority: values.priority,
    owner_user_id: values.owner_user_id,
    owner_name: values.owner_name.trim(),
    due_date: toDueDateTime(values.due_date),
    description: values.description?.trim() ?? '',
    matter_id: matterId,
  };
}

function buildUpdatePayload(values: ObligationFormValues): LexUpdateObligationPayload {
  return {
    title: values.title.trim(),
    type: values.type,
    priority: values.priority,
    owner_user_id: values.owner_user_id,
    owner_name: values.owner_name.trim(),
    due_date: toDueDateTime(values.due_date),
    description: values.description?.trim() ?? '',
  };
}

function normalizeOption<T extends readonly string[]>(
  value: string | undefined | null,
  options: T,
  fallback: T[number],
): T[number] {
  return value && (options as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function toDateInputValue(value?: string | null): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}

function toDueDateTime(value: string): string {
  return new Date(`${value}T00:00:00Z`).toISOString();
}

/**
 * An obligation is overdue when its due date is strictly in the past and it has
 * not reached a settled terminal state (completed / waived / cancelled).
 */
function isOverdue(obligation: LexObligation): boolean {
  if (
    obligation.status === 'completed' ||
    obligation.status === 'waived' ||
    obligation.status === 'cancelled' ||
    obligation.completed_at
  ) {
    return false;
  }
  if (!obligation.due_date) {
    return false;
  }
  const due = new Date(obligation.due_date);
  return !Number.isNaN(due.valueOf()) && due.getTime() < Date.now();
}

/**
 * Semantic leading-accent bar for an obligation lifecycle status: overdue → rose
 * (risk), completed → emerald (health), blocked → rose, open/in_progress → gold
 * (in flight), waived/cancelled → slate (inert). Purely decorative.
 */
function obligationStatusAccent(status: string, overdue: boolean): string {
  if (overdue) {
    return 'bg-rose-500/70';
  }
  switch (status) {
    case 'completed':
      return 'bg-success-300/70';
    case 'blocked':
      return 'bg-rose-500/70';
    case 'open':
    case 'in_progress':
      return 'bg-warning-300/70';
    default:
      return 'bg-muted-foreground/40';
  }
}

function PriorityBadge({
  labels,
  priority,
}: {
  labels: ObligationManagerLabels;
  priority: string;
}) {
  const variant =
    priority === 'critical' || priority === 'high'
      ? 'destructive'
      : priority === 'medium'
        ? 'warning'
        : 'secondary';
  return <Badge variant={variant}>{labels.priorityLabels[priority] ?? priority}</Badge>;
}

/**
 * Obligation status pill. Overdue items render a rose-toned outline regardless of
 * the underlying status so the risk reads at a glance.
 */
function ObligationStatusBadge({
  labels,
  status,
  overdue,
}: {
  labels: ObligationManagerLabels;
  status: string;
  overdue: boolean;
}) {
  const text = labels.statusLabels[status] ?? status;
  if (overdue) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-300 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
        {text}
      </span>
    );
  }
  const tone = STATUS_BADGE_TONE[status] ?? 'bg-secondary text-foreground/70';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {text}
    </span>
  );
}

const STATUS_BADGE_TONE: Record<string, string> = {
  open: 'bg-warning-100 text-warning-700 dark:bg-warning-800/30 dark:text-warning-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  blocked: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  completed: 'bg-primary/15 text-primary dark:bg-primary/30',
  waived: 'bg-secondary text-foreground/70 dark:bg-neutral-ink dark:text-foreground/45',
  cancelled: 'bg-secondary text-foreground/70 dark:bg-neutral-ink dark:text-foreground/45',
};

function typeLabel(labels: ObligationManagerLabels, type: string): string {
  return labels.typeLabels[type] ?? type.replace(/_/g, ' ');
}
