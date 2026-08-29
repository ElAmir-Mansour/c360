'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { useAuth } from '@/hooks/use-auth';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexCreateMatterPayload,
  LexMatter,
  LexUpdateMatterPayload,
} from '@/types/suites';
import {
  MATTER_PRIORITY_OPTIONS,
  MATTER_STATUS_OPTIONS,
  MATTER_TYPE_OPTIONS,
  type MatterLabels,
  useMatterLabels,
} from './labels';

function buildMatterFormSchema(errors: MatterLabels['form']['errors']) {
  return z.object({
    title: z.string().trim().min(3, errors.titleRequired),
    matter_number: z.string().trim().optional().nullable(),
    type: z.enum(MATTER_TYPE_OPTIONS),
    status: z.enum(MATTER_STATUS_OPTIONS),
    priority: z.enum(MATTER_PRIORITY_OPTIONS),
    owner_user_id: z.string().uuid(errors.ownerRequired),
    owner_name: z.string().trim().min(1, errors.ownerNameRequired),
    requester_user_id: z.string().trim().optional().nullable(),
    requester_name: z.string().trim().optional().nullable(),
    department: z.string().trim().optional().nullable(),
    due_date: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    tags: z.array(z.string().trim()).default([]),
  });
}

export type MatterFormValues = z.infer<ReturnType<typeof buildMatterFormSchema>>;

interface MatterFormDialogProps {
  matter?: LexMatter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (matter: LexMatter) => void;
}

export function MatterFormDialog({ matter, open, onOpenChange, onSaved }: MatterFormDialogProps) {
  const isEdit = Boolean(matter);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const matterLabels = useMatterLabels();
  const labels = matterLabels.form;
  const matterFormSchema = useMemo(
    () => buildMatterFormSchema(matterLabels.form.errors),
    [matterLabels.form.errors],
  );

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-matter-dialog'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });

  const form = useForm<MatterFormValues>({
    resolver: zodResolver(matterFormSchema),
    defaultValues: buildMatterFormDefaults(matter),
  });

  // Exemplar wiring for useUnsavedChanges: while the dialog is open with
  // unsaved edits, Esc/overlay/cancel closes and app-router navigations are
  // held behind a discard confirmation. Gated on `open` because this dialog
  // stays mounted while closed (a stale dirty form must not block the page).
  const { isDirty } = form.formState;
  const { guard, guardOpenChange } = useUnsavedChanges(open && isDirty);
  const handleOpenChange = guardOpenChange(onOpenChange);

  const users = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const usersById = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);

  useEffect(() => {
    if (!open) {
      return;
    }
    form.reset(buildMatterFormDefaults(matter));
  }, [matter, form, open]);

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

  const applyRequester = (userId: string | null) => {
    const directoryUser = userId ? usersById.get(userId) : undefined;
    form.setValue('requester_user_id', userId, { shouldValidate: true });
    form.setValue('requester_name', directoryUser ? userDisplayName(directoryUser) : null, {
      shouldValidate: true,
    });
  };

  const saveMutation = useMutation({
    mutationFn: (values: MatterFormValues) => {
      if (isEdit && matter) {
        return enterpriseApi.lex.updateMatter(matter.id, buildUpdateMatterPayload(values));
      }
      return enterpriseApi.lex.createMatter(buildCreateMatterPayload(values));
    },
    onSuccess: async (savedMatter) => {
      showSuccess(isEdit ? matterLabels.toast.updated : matterLabels.toast.created);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-matters'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        matter
          ? queryClient.invalidateQueries({ queryKey: ['lex-matter', matter.id] })
          : Promise.resolve(),
      ]);
      onOpenChange(false);
      onSaved?.(savedMatter);
    },
    onError: showApiError,
  });

  const ownerValue = form.watch('owner_user_id');
  const requesterValue = form.watch('requester_user_id');
  const typeValue = form.watch('type');
  const statusValue = form.watch('status');
  const priorityValue = form.watch('priority');
  const tagsValue = form.watch('tags');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? labels.editDescription : labels.createDescription}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          >
            {!isEdit ? <LexCreationGuidance workflow="matter" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="title" label={labels.title} required>
                <Input id="title" {...form.register('title')} placeholder={labels.titlePlaceholder} />
              </FormField>

              <FormField name="matter_number" label={labels.matterNumber}>
                <Input
                  id="matter_number"
                  {...form.register('matter_number')}
                  placeholder={labels.matterNumberPlaceholder}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="type" label={labels.type} required>
                <Select
                  value={typeValue}
                  onValueChange={(value) =>
                    form.setValue('type', value as MatterFormValues['type'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATTER_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {matterLabels.filters.typeOptions[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="status" label={labels.status} required>
                <Select
                  value={statusValue}
                  onValueChange={(value) =>
                    form.setValue('status', value as MatterFormValues['status'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATTER_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {matterLabels.filters.statusOptions[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="priority" label={labels.priority} required>
                <Select
                  value={priorityValue}
                  onValueChange={(value) =>
                    form.setValue('priority', value as MatterFormValues['priority'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATTER_PRIORITY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {matterLabels.filters.priorityOptions[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="owner_user_id" label={labels.owner} required>
                <Select value={ownerValue} onValueChange={applyOwner}>
                  <SelectTrigger id="owner_user_id">
                    <SelectValue placeholder={labels.ownerPlaceholder} />
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

              <FormField name="requester_user_id" label={labels.requester}>
                <Select
                  value={requesterValue ?? 'none'}
                  onValueChange={(value) => applyRequester(value === 'none' ? null : value)}
                >
                  <SelectTrigger id="requester_user_id">
                    <SelectValue placeholder={labels.requesterUnassigned} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{labels.requesterUnassigned}</SelectItem>
                    {users.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {userDisplayName(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="department" label={labels.department}>
                <Input
                  id="department"
                  {...form.register('department')}
                  placeholder={labels.departmentPlaceholder}
                />
              </FormField>

              <FormField name="due_date" label={labels.dueDate}>
                <Input id="due_date" type="date" {...form.register('due_date')} />
              </FormField>
            </div>

            <FormField name="description" label={labels.description}>
              <Textarea
                id="description"
                {...form.register('description')}
                placeholder={labels.descriptionPlaceholder}
                rows={3}
              />
            </FormField>

            <FormField name="tags" label={labels.tags}>
              <Input
                id="tags"
                value={tagsToInput(tagsValue)}
                onChange={(event) =>
                  form.setValue('tags', parseTagInput(event.target.value), { shouldValidate: true })
                }
                placeholder={labels.tagsPlaceholder}
              />
            </FormField>

            {usersQuery.isError ? (
              <p className="text-sm text-destructive">{labels.usersError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button
                type="submit"
                disabled={saveMutation.isPending || usersQuery.isLoading || usersQuery.isError}
              >
                {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? labels.save : labels.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
        {guard}
      </DialogContent>
    </Dialog>
  );
}

function buildMatterFormDefaults(matter?: LexMatter | null): MatterFormValues {
  return {
    title: matter?.title ?? '',
    matter_number: matter?.matter_number ?? null,
    type: normalizeOption(matter?.type, MATTER_TYPE_OPTIONS, 'general'),
    status: normalizeOption(matter?.status, MATTER_STATUS_OPTIONS, 'intake'),
    priority: normalizeOption(matter?.priority, MATTER_PRIORITY_OPTIONS, 'medium'),
    owner_user_id: matter?.owner_user_id ?? '',
    owner_name: matter?.owner_name ?? '',
    requester_user_id: matter?.requester_user_id ?? null,
    requester_name: matter?.requester_name ?? null,
    department: matter?.department ?? null,
    due_date: toDateInputValue(matter?.due_date),
    description: matter?.description ?? '',
    tags: matter?.tags ?? [],
  };
}

function buildCreateMatterPayload(values: MatterFormValues): LexCreateMatterPayload {
  return {
    title: values.title.trim(),
    matter_number: emptyToNull(values.matter_number),
    type: values.type,
    status: values.status,
    priority: values.priority,
    owner_user_id: values.owner_user_id,
    owner_name: values.owner_name.trim(),
    requester_user_id: emptyToNull(values.requester_user_id),
    requester_name: emptyToNull(values.requester_name),
    department: emptyToNull(values.department),
    due_date: toOptionalDateTime(values.due_date),
    description: values.description?.trim() ?? '',
    tags: values.tags,
  };
}

function buildUpdateMatterPayload(values: MatterFormValues): LexUpdateMatterPayload {
  // For the requester_user_id UUID, send the nil UUID sentinel when the matter
  // has no requester ("Unassigned") so the backend can distinguish "clear
  // requester" from "don't change requester" — an empty string cannot decode
  // into Go's *uuid.UUID and hard-400s the save. Mirrors the contract
  // legal_reviewer_id convention.
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';
  return {
    title: values.title.trim(),
    matter_number: values.matter_number?.trim() ?? '',
    type: values.type,
    status: values.status,
    priority: values.priority,
    owner_user_id: values.owner_user_id,
    owner_name: values.owner_name.trim(),
    requester_user_id: values.requester_user_id?.trim() || NIL_UUID,
    requester_name: values.requester_name?.trim() ?? '',
    department: values.department?.trim() ?? '',
    due_date: toOptionalDateTime(values.due_date),
    description: values.description?.trim() ?? '',
    tags: values.tags,
  };
}

function normalizeOption<T extends readonly string[]>(
  value: string | undefined | null,
  options: T,
  fallback: T[number],
): T[number] {
  return value && (options as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function tagsToInput(tags: string[] | undefined): string {
  return tags?.join(', ') ?? '';
}

function toDateInputValue(value?: string | null): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}

function toOptionalDateTime(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(`${value}T00:00:00Z`).toISOString();
}

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
