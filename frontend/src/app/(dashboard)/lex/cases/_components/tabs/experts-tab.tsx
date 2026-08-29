'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2, Pencil, Plus, Trash2, UserCheck } from 'lucide-react';
import { z } from 'zod';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RelativeTime } from '@/components/shared/relative-time';
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
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  EXPERT_ASSIGNMENT_STATUS_OPTIONS,
  formatCaseToken,
  type ExpertAssignmentStatus,
  type LegalExpertAssignment,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';

interface ExpertsTabProps {
  caseId: string;
  canWrite: boolean;
}

function buildExpertSchema(nameRequired: string, specRequired: string) {
  return z.object({
    expert_name: z.string().trim().min(1, nameRequired),
    specialization: z.string().trim().min(1, specRequired),
    mandate: z.string().trim().optional().default(''),
    contact_info: z.string().trim().optional().default(''),
    report_due_date: z.string().optional().default(''),
    status: z.string().optional().default('appointed'),
    report_received_at: z.string().optional().default(''),
  });
}
type ExpertValues = z.infer<ReturnType<typeof buildExpertSchema>>;

function expertDefaults(expert?: LegalExpertAssignment | null): ExpertValues {
  return {
    expert_name: expert?.expert_name ?? '',
    specialization: expert?.specialization ?? '',
    mandate: expert?.mandate ?? '',
    contact_info: expert?.contact_info ?? '',
    report_due_date: expert?.report_due_date ? expert.report_due_date.slice(0, 10) : '',
    status: expert?.status ?? 'appointed',
    report_received_at: expert?.report_received_at ? expert.report_received_at.slice(0, 10) : '',
  };
}

function toIsoDate(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function ExpertsTab({ caseId, canWrite }: ExpertsTabProps) {
  const labels = useCaseLabels();
  const t = labels.experts;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LegalExpertAssignment | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LegalExpertAssignment | null>(null);

  const expertsQuery = useQuery({
    queryKey: ['lex-case-experts', caseId],
    queryFn: () => casesApi.listExperts(caseId),
  });

  const schema = useMemo(
    () => buildExpertSchema(labels.expertForm.errors.nameRequired, labels.expertForm.errors.specializationRequired),
    [labels.expertForm.errors.nameRequired, labels.expertForm.errors.specializationRequired],
  );
  const form = useForm<ExpertValues>({
    resolver: zodResolver(schema),
    defaultValues: expertDefaults(),
  });

  useEffect(() => {
    if (addOpen) form.reset(expertDefaults());
  }, [addOpen, form]);

  useEffect(() => {
    if (editTarget) form.reset(expertDefaults(editTarget));
  }, [editTarget, form]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lex-case-experts', caseId] });

  const addMutation = useMutation({
    mutationFn: (values: ExpertValues) =>
      casesApi.createExpert(caseId, {
        expert_name: values.expert_name,
        specialization: values.specialization,
        mandate: values.mandate,
        contact_info: values.contact_info || null,
        report_due_date: toIsoDate(values.report_due_date),
      }),
    onSuccess: async () => {
      showSuccess(labels.toast.expertAdded);
      setAddOpen(false);
      await invalidate();
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: (values: ExpertValues) => {
      if (!editTarget) throw new Error('no expert selected');
      return casesApi.updateExpert(caseId, editTarget.id, {
        expert_name: values.expert_name,
        specialization: values.specialization,
        mandate: values.mandate,
        contact_info: values.contact_info || null,
        report_due_date: toIsoDate(values.report_due_date),
        report_received_at: toIsoDate(values.report_received_at),
        status: values.status as ExpertAssignmentStatus,
      });
    },
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      setEditTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const quickStatusMutation = useMutation({
    mutationFn: ({ expert, status }: { expert: LegalExpertAssignment; status: ExpertAssignmentStatus }) =>
      casesApi.updateExpert(caseId, expert.id, { status }),
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      await invalidate();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (expertId: string) => casesApi.deleteExpert(caseId, expertId),
    onSuccess: async () => {
      showSuccess(labels.toast.expertRemoved);
      setRemoveTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const experts = expertsQuery.data ?? [];

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.add}
          </Button>
        ) : undefined
      }
    >
      {expertsQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : expertsQuery.isError ? (
        <ErrorState message={t.title} onRetry={() => void expertsQuery.refetch()} />
      ) : experts.length === 0 ? (
        <EmptyState icon={UserCheck} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="space-y-3">
          {experts.map((expert) => (
            <div key={expert.id} className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
              <span className="absolute inset-y-0 start-0 w-1 bg-sky-400/70" aria-hidden />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{expert.expert_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{expert.specialization}</p>
                  {expert.mandate ? (
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{expert.mandate}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.reportDue}:{' '}
                    {expert.report_due_date ? <RelativeTime date={expert.report_due_date} /> : t.noReportDue}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {labels.filters.expertStatusOptions[expert.status] ?? formatCaseToken(expert.status)}
                  </Badge>
                  {canWrite ? (
                    <>
                      <Select
                        value={expert.status}
                        onValueChange={(value) =>
                          quickStatusMutation.mutate({
                            expert,
                            status: value as ExpertAssignmentStatus,
                          })
                        }
                        disabled={quickStatusMutation.isPending}
                      >
                        <SelectTrigger className="h-8 w-[11rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPERT_ASSIGNMENT_STATUS_OPTIONS.map((status) => (
                            <SelectItem key={status} value={status}>
                              {labels.filters.expertStatusOptions[status] ?? formatCaseToken(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => setEditTarget(expert)}>
                        <Pencil className="me-1.5 h-3.5 w-3.5" />
                        {labels.detail.edit}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoveTarget(expert)}>
                        <Trash2 className="me-1.5 h-3.5 w-3.5" />
                        {t.remove}
                      </Button>
                    </>
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
                <DialogTitle>{labels.expertForm.addTitle}</DialogTitle>
                <DialogDescription>{labels.expertForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...form}>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => addMutation.mutate(v))}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="expert_name" label={labels.expertForm.expertName} required>
                      <Input id="expert_name" {...form.register('expert_name')} placeholder={labels.expertForm.expertNamePlaceholder} />
                    </FormField>
                    <FormField name="specialization" label={labels.expertForm.specialization} required>
                      <Input id="specialization" {...form.register('specialization')} placeholder={labels.expertForm.specializationPlaceholder} />
                    </FormField>
                    <FormField name="contact_info" label={labels.expertForm.contact}>
                      <Input id="contact_info" {...form.register('contact_info')} placeholder={labels.expertForm.contactPlaceholder} />
                    </FormField>
                    <FormField name="report_due_date" label={labels.expertForm.reportDue}>
                      <Input id="report_due_date" type="date" {...form.register('report_due_date')} />
                    </FormField>
                  </div>
                  <FormField name="mandate" label={labels.expertForm.mandate}>
                    <Textarea id="mandate" rows={3} {...form.register('mandate')} placeholder={labels.expertForm.mandatePlaceholder} />
                  </FormField>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                      {labels.expertForm.cancel}
                    </Button>
                    <Button type="submit" disabled={addMutation.isPending}>
                      {addMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {labels.expertForm.submit}
                    </Button>
                  </DialogFooter>
                </form>
              </FormProvider>
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(editTarget)}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{labels.detail.edit} {t.expertName}</DialogTitle>
                <DialogDescription>{labels.expertForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...form}>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="expert_name" label={labels.expertForm.expertName} required>
                      <Input id="edit_expert_name" {...form.register('expert_name')} placeholder={labels.expertForm.expertNamePlaceholder} />
                    </FormField>
                    <FormField name="specialization" label={labels.expertForm.specialization} required>
                      <Input id="edit_specialization" {...form.register('specialization')} placeholder={labels.expertForm.specializationPlaceholder} />
                    </FormField>
                    <FormField name="contact_info" label={labels.expertForm.contact}>
                      <Input id="edit_contact_info" {...form.register('contact_info')} placeholder={labels.expertForm.contactPlaceholder} />
                    </FormField>
                    <FormField name="report_due_date" label={labels.expertForm.reportDue}>
                      <Input id="edit_report_due_date" type="date" {...form.register('report_due_date')} />
                    </FormField>
                    <FormField name="status" label={t.statusLabel}>
                      <Select
                        value={form.watch('status') || 'appointed'}
                        onValueChange={(value) => form.setValue('status', value, { shouldValidate: true })}
                      >
                        <SelectTrigger id="edit_status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPERT_ASSIGNMENT_STATUS_OPTIONS.map((status) => (
                            <SelectItem key={status} value={status}>
                              {labels.filters.expertStatusOptions[status] ?? formatCaseToken(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="report_received_at" label={t.reportReceived}>
                      <Input id="edit_report_received_at" type="date" {...form.register('report_received_at')} />
                    </FormField>
                  </div>
                  <FormField name="mandate" label={labels.expertForm.mandate}>
                    <Textarea id="edit_mandate" rows={3} {...form.register('mandate')} placeholder={labels.expertForm.mandatePlaceholder} />
                  </FormField>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                      {labels.expertForm.cancel}
                    </Button>
                    <Button type="submit" disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {labels.form.save}
                    </Button>
                  </DialogFooter>
                </form>
              </FormProvider>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={labels.confirm.removeExpertTitle}
            description={labels.confirm.removeExpertDescription(removeTarget?.expert_name ?? '')}
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
