'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import {
  AlertTriangle,
  Building,
  CheckCircle2,
  Clock3,
  FileText,
  Inbox,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';
import { z } from 'zod';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  NAJIZ_STATUS_OPTIONS,
  formatCaseToken,
  type LegalDefendantCase,
  type NajizSyncStatus,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';

interface DefendantTabProps {
  caseId: string;
  canWrite: boolean;
}

type SyncScope = 'synced' | 'failed' | 'deptNotified' | 'memoReady';

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'response_approved':
      return 'success';
    case 'response_in_review':
    case 'response_drafting':
    case 'notified_dept':
      return 'warning';
    case 'response_rejected':
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function daysSince(date?: string | null): number | null {
  if (!date) return null;
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function ageLabel(
  days: number | null,
  emptyLabel: string,
  t: { today: string; dayAgo: string; daysAgo: (days: number) => string },
) {
  if (days === null) return emptyLabel;
  if (days === 0) return t.today;
  if (days === 1) return t.dayAgo;
  return t.daysAgo(days);
}

function syncVariant(status: NajizSyncStatus): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'synced') return 'success';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

export function DefendantTab({ caseId, canWrite }: DefendantTabProps) {
  const labels = useCaseLabels();
  const t = labels.defendant;
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [najizTarget, setNajizTarget] = useState<LegalDefendantCase | null>(null);
  const [notifyTarget, setNotifyTarget] = useState<LegalDefendantCase | null>(null);
  const [memoTarget, setMemoTarget] = useState<LegalDefendantCase | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LegalDefendantCase | null>(null);
  const [syncScope, setSyncScope] = useState<SyncScope | null>(null);

  const defendantQuery = useQuery({
    queryKey: ['lex-case-defendant', caseId],
    queryFn: () => casesApi.listDefendant(caseId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lex-case-defendant', caseId] });

  const reviewMutation = useMutation({
    mutationFn: (defendantId: string) => casesApi.startResponseReview(caseId, defendantId, {}),
    onSuccess: async () => {
      showSuccess(labels.toast.reviewStarted);
      await invalidate();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (defendantId: string) => casesApi.deleteDefendant(caseId, defendantId),
    onSuccess: async () => {
      showSuccess(labels.toast.defendantRemoved);
      setRemoveTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const cases = useMemo(() => defendantQuery.data ?? [], [defendantQuery.data]);
  const syncCounts = useMemo(
    () => ({
      synced: cases.filter((dc) => dc.najiz_status === 'synced').length,
      failed: cases.filter((dc) => dc.najiz_status === 'failed').length,
      deptNotified: cases.filter((dc) => Boolean(dc.dept_notified_at)).length,
      memoReady: cases.filter((dc) => Boolean(dc.response_memo?.trim())).length,
    }),
    [cases],
  );
  const visibleCases = useMemo(() => {
    if (syncScope === 'synced') return cases.filter((dc) => dc.najiz_status === 'synced');
    if (syncScope === 'failed') return cases.filter((dc) => dc.najiz_status === 'failed');
    if (syncScope === 'deptNotified') return cases.filter((dc) => Boolean(dc.dept_notified_at));
    if (syncScope === 'memoReady') return cases.filter((dc) => Boolean(dc.response_memo?.trim()));
    return cases;
  }, [cases, syncScope]);
  const toggleSyncScope = (scope: SyncScope) => {
    setSyncScope((current) => (current === scope ? null : scope));
  };

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.register}
          </Button>
        ) : undefined
      }
    >
      {defendantQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={2} />
      ) : defendantQuery.isError ? (
        <ErrorState message={t.title} onRetry={() => void defendantQuery.refetch()} />
      ) : cases.length === 0 ? (
        <EmptyState icon={Inbox} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <SyncMetric label={t.metricSynced} value={syncCounts.synced} total={cases.length} tone="success" onAction={() => toggleSyncScope('synced')} pressed={syncScope === 'synced'} />
            <SyncMetric label={t.metricSyncFailed} value={syncCounts.failed} total={cases.length} tone="destructive" onAction={() => toggleSyncScope('failed')} pressed={syncScope === 'failed'} />
            <SyncMetric label={t.metricDeptNotified} value={syncCounts.deptNotified} total={cases.length} tone="warning" onAction={() => toggleSyncScope('deptNotified')} pressed={syncScope === 'deptNotified'} />
            <SyncMetric label={t.metricMemoReady} value={syncCounts.memoReady} total={cases.length} tone="secondary" onAction={() => toggleSyncScope('memoReady')} pressed={syncScope === 'memoReady'} />
          </div>
          {visibleCases.map((dc) => (
            <div key={dc.id} className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
              <span className="absolute inset-y-0 start-0 w-1 bg-rose-400/70" aria-hidden />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{dc.plaintiff_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {dc.court_name || t.noCourtName} •{' '}
                    {dc.notification_date ? formatDateTime(dc.notification_date) : t.noNotificationDate}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.najizRep}: {dc.company_representative || t.noRep} (
                    {labels.filters.najizStatusOptions[dc.najiz_status] ?? formatCaseToken(dc.najiz_status)})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.concernedDept}: {dc.concerned_department || t.noConcernedDept}
                  </p>
                  {dc.response_memo ? (
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
                      {dc.response_memo}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">{t.noResponseMemo}</p>
                  )}
                </div>
                <Badge variant={statusVariant(dc.status)}>
                  {labels.filters.defendantStatusOptions[dc.status] ?? formatCaseToken(dc.status)}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 border-t pt-3 md:grid-cols-2 xl:grid-cols-3">
                <SyncSignal
                  icon={dc.najiz_status === 'failed' ? AlertTriangle : dc.najiz_status === 'synced' ? CheckCircle2 : Clock3}
                  label={t.signalNajizSync}
                  value={labels.filters.najizStatusOptions[dc.najiz_status] ?? formatCaseToken(dc.najiz_status)}
                  detail={
                    dc.najiz_reference
                      ? `${t.signalNajizRefPrefix}: ${dc.najiz_reference}`
                      : t.signalNoNajizRef
                  }
                  variant={syncVariant(dc.najiz_status)}
                />
                <SyncSignal
                  icon={Clock3}
                  label={t.signalNotificationAge}
                  value={ageLabel(daysSince(dc.notification_date), t.noNotificationDate, t)}
                  detail={dc.notification_date ? formatDateTime(dc.notification_date) : t.signalNoCourtDate}
                  variant={daysSince(dc.notification_date) !== null && daysSince(dc.notification_date)! > 14 ? 'warning' : 'secondary'}
                />
                <SyncSignal
                  icon={dc.dept_notified_at ? Send : Building}
                  label={t.signalDeptNotification}
                  value={dc.dept_notified_at ? t.signalNotified : t.signalNotNotified}
                  detail={
                    dc.dept_notified_at
                      ? `${dc.concerned_department || t.noConcernedDept} • ${formatDateTime(dc.dept_notified_at)}`
                      : dc.concerned_department || t.noConcernedDept
                  }
                  variant={dc.dept_notified_at ? 'success' : dc.concerned_department ? 'warning' : 'secondary'}
                />
                <SyncSignal
                  icon={FileText}
                  label={t.signalResponseMemo}
                  value={dc.response_memo?.trim() ? t.signalMemoReady : t.signalMemoDraftNeeded}
                  detail={
                    dc.response_memo?.trim()
                      ? dc.response_memo_ai
                        ? t.signalMemoAi
                        : t.signalMemoManual
                      : t.signalMemoDraftHint
                  }
                  variant={dc.response_memo?.trim() ? 'success' : 'warning'}
                />
              </div>
              {dc.najiz_status === 'failed' && canWrite ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                  <span className="text-destructive">{t.syncFailedBanner}</span>
                  <Button size="sm" variant="outline" onClick={() => setNajizTarget(dc)}>
                    {t.resolveSync}
                  </Button>
                </div>
              ) : null}
              {canWrite ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => setNajizTarget(dc)}>
                    <UserCog className="me-1.5 h-3.5 w-3.5" />
                    {t.setNajiz}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setNotifyTarget(dc)}>
                    <Building className="me-1.5 h-3.5 w-3.5" />
                    {t.notifyDept}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMemoTarget(dc)}>
                    <FileText className="me-1.5 h-3.5 w-3.5" />
                    {t.draftMemo}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate(dc.id)}
                  >
                    <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                    {t.startReview}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRemoveTarget(dc)}>
                    <Trash2 className="me-1.5 h-3.5 w-3.5" />
                    {t.remove}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <RegisterDefendantDialog
            caseId={caseId}
            open={registerOpen}
            onOpenChange={setRegisterOpen}
            onSaved={() => void invalidate()}
          />
          <NajizDialog
            caseId={caseId}
            defendantCase={najizTarget}
            onOpenChange={(open) => {
              if (!open) setNajizTarget(null);
            }}
            onSaved={() => void invalidate()}
          />
          <NotifyDeptDialog
            caseId={caseId}
            defendantCase={notifyTarget}
            onOpenChange={(open) => {
              if (!open) setNotifyTarget(null);
            }}
            onSaved={() => void invalidate()}
          />
          <MemoDialog
            caseId={caseId}
            defendantCase={memoTarget}
            onOpenChange={(open) => {
              if (!open) setMemoTarget(null);
            }}
            onSaved={() => void invalidate()}
          />
          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={labels.confirm.removeDefendantTitle}
            description={labels.confirm.removeDefendantDescription(removeTarget?.plaintiff_name ?? '')}
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

function SyncMetric({
  label,
  value,
  total,
  tone,
  onAction,
  pressed,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'success' | 'warning' | 'destructive' | 'secondary';
  onAction: () => void;
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      title={statisticHint(label)}
      aria-pressed={pressed}
      className="rounded-lg border bg-muted/30 p-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[pressed=true]:border-primary data-[pressed=true]:bg-primary/10"
      data-pressed={pressed}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">/ {total}</span>
      </div>
      <Badge className="mt-2" variant={tone}>
        {total > 0 ? `${Math.round((value / total) * 100)}%` : '0%'}
      </Badge>
    </button>
  );
}

function SyncSignal({
  icon: Icon,
  label,
  value,
  detail,
  variant,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  detail: string;
  variant: 'success' | 'warning' | 'destructive' | 'secondary';
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={variant}>{value}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function buildRegisterSchema(plaintiffRequired: string) {
  return z.object({
    plaintiff_name: z.string().trim().min(1, plaintiffRequired),
    court_name: z.string().trim().optional().default(''),
    notification_date: z.string().optional().default(''),
  });
}
type RegisterValues = z.infer<ReturnType<typeof buildRegisterSchema>>;

function RegisterDefendantDialog({
  caseId,
  open,
  onOpenChange,
  onSaved,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.defendantForm;
  const schema = useMemo(() => buildRegisterSchema(t.errors.plaintiffRequired), [t.errors.plaintiffRequired]);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: { plaintiff_name: '', court_name: '', notification_date: '' },
  });

  useEffect(() => {
    if (open) form.reset({ plaintiff_name: '', court_name: '', notification_date: '' });
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      casesApi.registerDefendant(caseId, {
        plaintiff_name: values.plaintiff_name,
        court_name: values.court_name || null,
        notification_date: values.notification_date ? new Date(values.notification_date).toISOString() : null,
      }),
    onSuccess: () => {
      showSuccess(labels.toast.defendantRegistered);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.registerTitle}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField name="plaintiff_name" label={t.plaintiffName} required>
              <Input id="plaintiff_name" {...form.register('plaintiff_name')} placeholder={t.plaintiffNamePlaceholder} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="court_name" label={t.courtName}>
                <Input id="court_name" {...form.register('court_name')} placeholder={t.courtNamePlaceholder} />
              </FormField>
              <FormField name="notification_date" label={t.notificationDate}>
                <Input id="notification_date" type="date" {...form.register('notification_date')} />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function buildNajizSchema(repRequired: string) {
  return z.object({
    company_representative: z.string().trim().min(1, repRequired),
    najiz_status: z.enum(NAJIZ_STATUS_OPTIONS as unknown as [NajizSyncStatus, ...NajizSyncStatus[]]),
    najiz_reference: z.string().trim().optional().default(''),
  });
}
type NajizValues = z.infer<ReturnType<typeof buildNajizSchema>>;

function NajizDialog({
  caseId,
  defendantCase,
  onOpenChange,
  onSaved,
}: {
  caseId: string;
  defendantCase: LegalDefendantCase | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.najizForm;
  const schema = useMemo(() => buildNajizSchema(t.errors.repRequired), [t.errors.repRequired]);
  const form = useForm<NajizValues>({
    resolver: zodResolver(schema),
    defaultValues: { company_representative: '', najiz_status: 'manual', najiz_reference: '' },
  });

  useEffect(() => {
    if (defendantCase) {
      form.reset({
        company_representative: defendantCase.company_representative ?? '',
        najiz_status: defendantCase.najiz_status ?? 'manual',
        najiz_reference: defendantCase.najiz_reference ?? '',
      });
    }
  }, [defendantCase, form]);

  const mutation = useMutation({
    mutationFn: (values: NajizValues) => {
      if (!defendantCase) throw new Error('no defendant case');
      return casesApi.setNajizRepresentative(caseId, defendantCase.id, {
        company_representative: values.company_representative,
        najiz_status: values.najiz_status,
        najiz_reference: values.najiz_reference || null,
      });
    },
    onSuccess: () => {
      showSuccess(labels.toast.najizUpdated);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const statusValue = form.watch('najiz_status');

  return (
    <Dialog open={Boolean(defendantCase)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField name="company_representative" label={t.representative} required>
              <Input id="company_representative" {...form.register('company_representative')} placeholder={t.representativePlaceholder} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="najiz_status" label={t.status} required>
                <Select
                  value={statusValue}
                  onValueChange={(v) => form.setValue('najiz_status', v as NajizSyncStatus, { shouldValidate: true })}
                >
                  <SelectTrigger id="najiz_status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NAJIZ_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {labels.filters.najizStatusOptions[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="najiz_reference" label={t.reference}>
                <Input id="najiz_reference" {...form.register('najiz_reference')} placeholder={t.referencePlaceholder} />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function buildNotifySchema(deptRequired: string) {
  return z.object({
    concerned_department: z.string().trim().min(1, deptRequired),
    note: z.string().trim().optional().default(''),
  });
}
type NotifyValues = z.infer<ReturnType<typeof buildNotifySchema>>;

function NotifyDeptDialog({
  caseId,
  defendantCase,
  onOpenChange,
  onSaved,
}: {
  caseId: string;
  defendantCase: LegalDefendantCase | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.notifyDeptForm;
  const schema = useMemo(() => buildNotifySchema(t.errors.deptRequired), [t.errors.deptRequired]);
  const form = useForm<NotifyValues>({
    resolver: zodResolver(schema),
    defaultValues: { concerned_department: '', note: '' },
  });

  useEffect(() => {
    if (defendantCase) {
      form.reset({ concerned_department: defendantCase.concerned_department ?? '', note: '' });
    }
  }, [defendantCase, form]);

  const mutation = useMutation({
    mutationFn: (values: NotifyValues) => {
      if (!defendantCase) throw new Error('no defendant case');
      return casesApi.notifyDepartment(caseId, defendantCase.id, {
        concerned_department: values.concerned_department,
        note: values.note,
      });
    },
    onSuccess: () => {
      showSuccess(labels.toast.deptNotified);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={Boolean(defendantCase)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField name="concerned_department" label={t.department} required>
              <Input id="concerned_department" {...form.register('concerned_department')} placeholder={t.departmentPlaceholder} />
            </FormField>
            <FormField name="note" label={t.note}>
              <Textarea id="note" rows={3} {...form.register('note')} placeholder={t.notePlaceholder} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function buildMemoSchema(bodyRequired: string) {
  return z
    .object({
      body: z.string().optional().default(''),
      generate_body: z.boolean().default(false),
      draft_prompt: z.string().optional().default(''),
    })
    .refine((v) => v.generate_body || v.body.trim().length > 0, {
      path: ['body'],
      message: bodyRequired,
    });
}
type MemoValues = z.infer<ReturnType<typeof buildMemoSchema>>;

function MemoDialog({
  caseId,
  defendantCase,
  onOpenChange,
  onSaved,
}: {
  caseId: string;
  defendantCase: LegalDefendantCase | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.memoForm;
  const schema = useMemo(() => buildMemoSchema(t.errors.bodyRequired), [t.errors.bodyRequired]);
  const form = useForm<MemoValues>({
    resolver: zodResolver(schema),
    defaultValues: { body: '', generate_body: false, draft_prompt: '' },
  });

  useEffect(() => {
    if (defendantCase) {
      form.reset({ body: defendantCase.response_memo ?? '', generate_body: false, draft_prompt: '' });
    }
  }, [defendantCase, form]);

  const mutation = useMutation({
    mutationFn: (values: MemoValues) => {
      if (!defendantCase) throw new Error('no defendant case');
      return casesApi.draftResponseMemo(caseId, defendantCase.id, {
        body: values.body,
        generate_body: values.generate_body,
        draft_prompt: values.draft_prompt,
      });
    },
    onSuccess: () => {
      showSuccess(labels.toast.memoDrafted);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const generateBody = form.watch('generate_body');

  return (
    <Dialog open={Boolean(defendantCase)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
              <Checkbox
                id="memo_generate_body"
                checked={generateBody}
                onCheckedChange={(checked) =>
                  form.setValue('generate_body', checked === true, { shouldValidate: true })
                }
              />
              <div className="space-y-0.5">
                <Label htmlFor="memo_generate_body" className="text-sm font-medium">
                  {t.generateBody}
                </Label>
                <p className="text-xs text-muted-foreground">{t.generateBodyHint}</p>
              </div>
            </div>
            {generateBody ? (
              <FormField name="draft_prompt" label={t.draftPrompt}>
                <Textarea id="draft_prompt" rows={3} {...form.register('draft_prompt')} placeholder={t.draftPromptPlaceholder} />
              </FormField>
            ) : (
              <FormField name="body" label={t.body} required>
                <Textarea id="body" rows={6} {...form.register('body')} placeholder={t.bodyPlaceholder} />
              </FormField>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
