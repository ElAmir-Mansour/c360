'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import {
  CalendarClock,
  CheckCircle2,
  Eye,
  FileSignature,
  GitCompareArrows,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { z } from 'zod';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatDateTime, parseApiError } from '@/lib/format';
import { showApiError, showBackendError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  PLEADING_TYPE_OPTIONS,
  formatCaseToken,
  type LegalPleading,
  type LegalPleadingVersion,
  type PleadingType,
  type StartPleadingGenerationPayload,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';
import { useDeepTabLabels } from './deep-tab-labels';
import { buildFilingSummary, resolveRecordText } from './deep-tab-model';
import { PleadingGenerationPanel } from './pleading-generation-panel';
import { usePleadingGenerationLabels } from './pleading-generation-labels';
import {
  usePleadingGeneration,
  type PleadingGenerationView,
} from './use-pleading-generation';

interface PleadingsTabProps {
  caseId: string;
  canWrite: boolean;
}

function buildPleadingSchema(titleRequired: string) {
  return z.object({
    type: z.string().trim().min(1),
    title: z.string().trim().min(1, titleRequired),
    body: z.string().optional().default(''),
    generate_body: z.boolean().default(false),
    draft_prompt: z.string().optional().default(''),
    direction: z.enum(['incoming', 'outgoing', 'internal']).default('outgoing'),
    recipient: z.string().trim().optional().default(''),
    court_reference: z.string().trim().optional().default(''),
    response_deadline: z.string().optional().default(''),
  });
}
type PleadingValues = z.infer<ReturnType<typeof buildPleadingSchema>>;

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'approved':
    case 'filed':
      return 'success';
    case 'in_approval':
      return 'warning';
    case 'rejected':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function PleadingsTab({ caseId, canWrite }: PleadingsTabProps) {
  const labels = useCaseLabels();
  const deepLabels = useDeepTabLabels();
  const generationLabels = usePleadingGenerationLabels();
  const t = labels.pleadings;
  const { locale } = useLocaleOrDefault();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [createError, setCreateError] = useState<{
    message: string;
    canUseManualEntry: boolean;
  } | null>(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<LegalPleading | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LegalPleading | null>(null);

  const pleadingsQuery = useQuery({
    queryKey: ['lex-case-pleadings', caseId],
    queryFn: () => casesApi.listPleadings(caseId),
  });

  const schema = useMemo(
    () => buildPleadingSchema(labels.pleadingForm.errors.titleRequired),
    [labels.pleadingForm.errors.titleRequired],
  );
  const form = useForm<PleadingValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'statement_of_claim',
      title: '',
      body: '',
      generate_body: false,
      draft_prompt: '',
      direction: 'outgoing',
      recipient: '',
      court_reference: '',
      response_deadline: '',
    },
  });

  useEffect(() => {
    if (addOpen) {
      setCreateError(null);
      form.reset({
        type: 'statement_of_claim',
        title: '',
        body: '',
        generate_body: false,
        draft_prompt: '',
        direction: 'outgoing',
        recipient: '',
        court_reference: '',
        response_deadline: '',
      });
    }
  }, [addOpen, form]);

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ['lex-case-pleadings', caseId],
      }),
    [caseId, queryClient],
  );

  const {
    generations,
    start: startGeneration,
    retry: retryGeneration,
    cancel: cancelGeneration,
    resume: resumeGeneration,
    restore: restoreGenerations,
    dismiss: dismissGeneration,
    isActive: isGenerationActive,
  } = usePleadingGeneration({
    caseId,
    onCompleted: () => {
      void invalidate();
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: PleadingValues) =>
      casesApi.createPleading(caseId, {
        type: values.type as PleadingType,
        title: values.title,
        body: values.body,
        // AI generation is deliberately split into two requests. This first
        // call persists an empty, recoverable draft immediately; the streaming
        // generation request starts only after the draft has an id.
        generate_body: false,
        language: locale,
        direction: values.direction,
        recipient: values.recipient || null,
        court_reference: values.court_reference || null,
        response_deadline: values.response_deadline
          ? new Date(values.response_deadline).toISOString()
          : null,
        metadata: values.generate_body
          ? { generation_requested: true }
          : undefined,
      }),
    onMutate: () => {
      setCreateError(null);
    },
    onSuccess: async (pleading, values) => {
      setCreateError(null);
      setAddOpen(false);
      queryClient.setQueryData<LegalPleading[]>(
        ['lex-case-pleadings', caseId],
        (current) => {
          const existing = current ?? [];
          return [
            pleading,
            ...existing.filter((item) => item.id !== pleading.id),
          ];
        },
      );

      if (values.generate_body) {
        showSuccess(
          generationLabels.draftSaved,
          generationLabels.draftSavedDescription,
        );
        void startGeneration(pleading.id, {
          language: locale,
          draft_prompt: values.draft_prompt.trim(),
        });
      } else {
        showSuccess(labels.toast.pleadingCreated);
      }
      await invalidate();
    },
    onError: (error, values) => {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      setCreateError({
        message: parseApiError(error),
        canUseManualEntry:
          values.generate_body && (code === '' || code.startsWith('DRAFTING_')),
      });
      showBackendError(error, labels.pleadingForm.errorTitle);
    },
  });

  const submitMutation = useMutation({
    mutationFn: (pleadingId: string) => casesApi.submitPleading(caseId, pleadingId),
    onSuccess: async () => {
      showSuccess(labels.toast.pleadingSubmitted);
      await invalidate();
    },
    onError: showApiError,
  });

  const fileMutation = useMutation({
    mutationFn: (pleadingId: string) => casesApi.filePleading(caseId, pleadingId, {}),
    onSuccess: async () => {
      showSuccess(labels.toast.pleadingFiled);
      await invalidate();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (pleadingId: string) => casesApi.deletePleading(caseId, pleadingId),
    onSuccess: async () => {
      showSuccess(labels.toast.pleadingRemoved);
      setRemoveTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const typeValue = form.watch('type');
  const directionValue = form.watch('direction');
  const generateBody = form.watch('generate_body');
  const pleadings = useMemo(() => pleadingsQuery.data ?? [], [pleadingsQuery.data]);
  useEffect(() => {
    if (pleadings.length > 0) {
      void restoreGenerations(pleadings);
    }
  }, [pleadings, restoreGenerations]);
  const filingSummary = useMemo(
    () =>
      buildFilingSummary(
        pleadings.map((pleading) => ({
          title: pleading.title,
          direction: resolveRecordText(pleading, 'direction'),
          status: pleading.status,
          responseDeadline: resolveRecordText(pleading, 'response_deadline'),
        })),
      ),
    [pleadings],
  );
  const pleadingTypeOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...PLEADING_TYPE_OPTIONS,
          'memorandum',
          'motion',
          'petition',
          'appeal',
          'notice',
          'request',
        ]),
      ),
    [],
  );

  return (
    <SectionCard
      title={deepLabels.filings.title}
      description={deepLabels.filings.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.add}
          </Button>
        ) : undefined
      }
    >
      {pleadingsQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : pleadingsQuery.isError ? (
        <ErrorState message={t.loadError} onRetry={() => void pleadingsQuery.refetch()} />
      ) : pleadings.length === 0 ? (
        <EmptyState icon={FileSignature} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="space-y-4">
            {pleadings.map((pleading) => {
              const generationState = generations[pleading.id];
              const generationActive = isGenerationActive(pleading.id);
              const direction = resolveRecordText(pleading, 'direction') ?? 'outgoing';
              const recipient = resolveRecordText(pleading, 'recipient');
              const courtReference = resolveRecordText(pleading, 'court_reference');
              const responseDeadline = resolveRecordText(pleading, 'response_deadline');
              const directionLabel =
                deepLabels.filings.direction[
                  direction as keyof typeof deepLabels.filings.direction
                ] ?? formatCaseToken(direction);
              return (
                <article
                  key={pleading.id}
                  className="rounded-xl border border-border/80 bg-card p-4 shadow-elevation-1"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground" dir="auto">{pleading.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pleading.pleading_number} •{' '}
                        {labels.filters.pleadingTypeOptions[pleading.type] ??
                          formatCaseToken(pleading.type)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Badge variant={direction === 'incoming' ? 'warning' : direction === 'internal' ? 'neutral' : 'success'}>
                        {directionLabel}
                      </Badge>
                      <Badge variant="info">
                        {labels.filters.pleadingTypeOptions[pleading.type] ??
                          formatCaseToken(pleading.type)}
                      </Badge>
                      <Badge variant={statusVariant(pleading.status)}>
                        {labels.filters.pleadingStatusOptions[pleading.status] ??
                          formatCaseToken(pleading.status)}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 border-y border-border/70 py-3 sm:grid-cols-2">
                    <div>
                      <p className="text-overline font-semibold uppercase text-muted-foreground">
                        {deepLabels.filings.recipient}
                      </p>
                      <p className="mt-1 text-sm font-medium" dir="auto">
                        {recipient ?? deepLabels.common.notSet}
                      </p>
                    </div>
                    {responseDeadline ? (
                      <div>
                        <p className="text-overline font-semibold uppercase text-error-600">
                          {deepLabels.filings.deadline}
                        </p>
                        <p className="mt-1 text-sm font-medium text-error-700">
                          {new Date(responseDeadline).toLocaleDateString(
                            locale === 'ar' ? 'ar-SA' : 'en-GB',
                            { day: '2-digit', month: 'short', year: 'numeric' },
                          )}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {pleading.body ? (
                    <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground" dir="auto">
                      {pleading.body}
                    </p>
                  ) : null}

                  {(pleading.attachments?.length ?? 0) > 0 || courtReference ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm font-medium" dir="auto">
                          {pleading.attachments?.[0]?.file_name ?? deepLabels.common.file}
                        </span>
                        {(pleading.attachments?.length ?? 0) > 1 ? (
                          <Badge variant="outline">+{(pleading.attachments?.length ?? 1) - 1}</Badge>
                        ) : null}
                      </div>
                      {courtReference ? (
                        <p className="text-xs text-muted-foreground">
                          {deepLabels.common.reference}:{' '}
                          <span className="font-semibold text-foreground">{courtReference}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {generationState ? (
                    <div className="mt-4">
                      <PleadingGenerationPanel
                        generation={generationState}
                        compact
                        onRetry={() => void retryGeneration(pleading.id)}
                        onCancel={() => void cancelGeneration(pleading.id)}
                        onResume={() => void resumeGeneration(pleading.id)}
                        onDismiss={() => dismissGeneration(pleading.id)}
                      />
                    </div>
                  ) : null}

                  {canWrite ? (
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                      {pleading.status === 'draft' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            submitMutation.isPending ||
                            generationActive ||
                            !pleading.body?.trim()
                          }
                          onClick={() => submitMutation.mutate(pleading.id)}
                        >
                          <Send className="me-1.5 h-3.5 w-3.5" />
                          {t.submit}
                        </Button>
                      ) : null}
                      {pleading.status === 'approved' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={fileMutation.isPending}
                          onClick={() => fileMutation.mutate(pleading.id)}
                        >
                          <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                          {t.file}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => setWorkspaceTarget(pleading)}>
                        <Eye className="me-1.5 h-3.5 w-3.5" />
                        {t.workspace}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoveTarget(pleading)}>
                        <Trash2 className="me-1.5 h-3.5 w-3.5" />
                        {t.remove}
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <aside className="h-fit space-y-4 rounded-xl border border-border/80 bg-card p-5 shadow-elevation-1 xl:sticky xl:top-4">
            <h3 className="font-semibold text-foreground">{deepLabels.filings.overview}</h3>
            <dl className="space-y-3 text-sm">
              <SummaryRow label={deepLabels.filings.total} value={String(filingSummary.total)} />
              <SummaryRow label={deepLabels.filings.outgoing} value={String(filingSummary.outgoing)} tone="success" />
              <SummaryRow label={deepLabels.filings.incoming} value={String(filingSummary.incoming)} tone="warning" />
              <SummaryRow label={deepLabels.filings.rate} value={`${filingSummary.acceptanceRate}%`} tone="info" />
            </dl>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-semibold">
                {deepLabels.filings.deadlines} ({filingSummary.deadlines.length})
              </p>
              {filingSummary.deadlines.length ? (
                filingSummary.deadlines.slice(0, 4).map((item, index) => (
                  <div
                    key={`${item.title}:${item.responseDeadline}`}
                    className={index === 0 ? 'rounded-lg bg-error-50 p-3' : 'rounded-lg bg-warning-50 p-3'}
                  >
                    <p className={index === 0 ? 'text-sm font-semibold text-error-700' : 'text-sm font-semibold text-warning-700'} dir="auto">
                      {item.title}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {item.responseDeadline ? formatDateTime(item.responseDeadline) : deepLabels.common.notSet}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">{deepLabels.common.notSet}</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {canWrite ? (
        <>
          <PleadingWorkspaceDialog
            caseId={caseId}
            pleading={workspaceTarget}
            generation={
              workspaceTarget
                ? generations[workspaceTarget.id]
                : undefined
            }
            onGenerate={(pleadingId, payload) =>
              startGeneration(pleadingId, payload)
            }
            onRetry={retryGeneration}
            onCancel={cancelGeneration}
            onResume={resumeGeneration}
            onDismiss={dismissGeneration}
            onOpenChange={(open) => {
              if (!open) setWorkspaceTarget(null);
            }}
            onSaved={() => void invalidate()}
          />

          <Dialog
            open={addOpen}
            onOpenChange={(open) => {
              if (!createMutation.isPending) setAddOpen(open);
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{labels.pleadingForm.addTitle}</DialogTitle>
                <DialogDescription>{labels.pleadingForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...form}>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="type" label={labels.pleadingForm.type} required>
                      <Select
                        value={typeValue}
                        onValueChange={(v) => form.setValue('type', v, { shouldValidate: true })}
                      >
                        <SelectTrigger id="type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pleadingTypeOptions.map((o) => (
                            <SelectItem key={o} value={o}>
                              {labels.filters.pleadingTypeOptions[o as PleadingType] ?? formatCaseToken(o)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="title" label={labels.pleadingForm.title} required>
                      <Input id="title" {...form.register('title')} placeholder={labels.pleadingForm.titlePlaceholder} />
                    </FormField>
                    <FormField name="direction" label={locale === 'ar' ? 'الاتجاه' : 'Direction'} required>
                      <Select
                        value={directionValue}
                        onValueChange={(value) =>
                          form.setValue(
                            'direction',
                            value as 'incoming' | 'outgoing' | 'internal',
                            { shouldValidate: true },
                          )
                        }
                      >
                        <SelectTrigger id="direction">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['incoming', 'outgoing', 'internal'] as const).map((direction) => (
                            <SelectItem key={direction} value={direction}>
                              {deepLabels.filings.direction[direction]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="recipient" label={deepLabels.filings.recipient}>
                      <Input
                        id="recipient"
                        dir="auto"
                        {...form.register('recipient')}
                        placeholder={locale === 'ar' ? 'المحكمة أو الجهة المستهدفة' : 'Court or target body'}
                      />
                    </FormField>
                    <FormField name="court_reference" label={deepLabels.common.reference}>
                      <Input
                        id="court_reference"
                        dir="ltr"
                        {...form.register('court_reference')}
                        placeholder="COURT-REQ-..."
                      />
                    </FormField>
                    <FormField name="response_deadline" label={deepLabels.filings.deadline}>
                      <Input id="response_deadline" type="date" {...form.register('response_deadline')} />
                    </FormField>
                  </div>

                  <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
                    <Checkbox
                      id="generate_body"
                      checked={generateBody}
                      onCheckedChange={(checked) => {
                        setCreateError(null);
                        form.setValue('generate_body', checked === true, { shouldValidate: true })
                      }}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor="generate_body" className="text-sm font-medium">
                        {labels.pleadingForm.generateBody}
                      </Label>
                      <p className="text-xs text-muted-foreground">{labels.pleadingForm.generateBodyHint}</p>
                    </div>
                  </div>

                  {generateBody ? (
                    <FormField name="draft_prompt" label={labels.pleadingForm.draftPrompt}>
                      <Textarea
                        id="draft_prompt"
                        rows={3}
                        {...form.register('draft_prompt')}
                        placeholder={labels.pleadingForm.draftPromptPlaceholder}
                      />
                    </FormField>
                  ) : (
                    <FormField name="body" label={labels.pleadingForm.body}>
                      <Textarea
                        id="body"
                        rows={6}
                        {...form.register('body')}
                        placeholder={labels.pleadingForm.bodyPlaceholder}
                      />
                    </FormField>
                  )}

                  {createMutation.isPending && generateBody ? (
                    <div
                      className="flex items-start gap-3 rounded-lg border border-info-200 bg-info-50 p-3 text-info-800 dark:border-info-800 dark:bg-info-950/40 dark:text-info-200"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      <div>
                        <p className="text-sm font-semibold">{generationLabels.savingDraft}</p>
                        <p className="mt-0.5 text-xs">
                          {generationLabels.draftSavedDescription}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {createError ? (
                    <div
                      className="rounded-lg border border-error-200 bg-error-50 p-3 text-error-800 dark:border-error-800 dark:bg-error-950/40 dark:text-error-200"
                      role="alert"
                    >
                      <div className="flex items-start gap-2">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{labels.pleadingForm.errorTitle}</p>
                          <p className="mt-1 text-sm">{createError.message}</p>
                        </div>
                      </div>
                      {createError.canUseManualEntry ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => {
                            setCreateError(null);
                            form.setValue('generate_body', false, { shouldValidate: true });
                            window.setTimeout(() => document.getElementById('body')?.focus(), 0);
                          }}
                        >
                          {labels.pleadingForm.enterManually}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={createMutation.isPending}
                      onClick={() => setAddOpen(false)}
                    >
                      {labels.pleadingForm.cancel}
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {createMutation.isPending && generateBody
                        ? generationLabels.savingDraft
                        : labels.pleadingForm.submit}
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
            title={labels.confirm.removePleadingTitle}
            description={labels.confirm.removePleadingDescription(removeTarget?.title ?? '')}
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

function SummaryRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'info';
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success-700',
    warning: 'text-warning-700',
    info: 'text-info-700',
  }[tone];
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}

function PleadingWorkspaceDialog({
  caseId,
  pleading,
  generation,
  onGenerate,
  onRetry,
  onCancel,
  onResume,
  onDismiss,
  onOpenChange,
  onSaved,
}: {
  caseId: string;
  pleading: LegalPleading | null;
  generation?: PleadingGenerationView;
  onGenerate: (
    pleadingId: string,
    payload: StartPleadingGenerationPayload,
  ) => Promise<void>;
  onRetry: (pleadingId: string) => Promise<void>;
  onCancel: (pleadingId: string) => Promise<void>;
  onResume: (pleadingId: string) => Promise<void>;
  onDismiss: (pleadingId: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.pleadings;
  const { locale } = useLocaleOrDefault();
  const [draftBody, setDraftBody] = useState('');
  const draftBodyDirty = useRef(false);
  const [changeReason, setChangeReason] = useState('');
  const [beforeVersionId, setBeforeVersionId] = useState('');
  const [afterVersionId, setAfterVersionId] = useState('');

  const versions = useMemo(
    () => [...(pleading?.versions ?? [])].sort((a, b) => b.version - a.version),
    [pleading?.versions],
  );
  const beforeVersion = versions.find((version) => version.id === beforeVersionId);
  const afterVersion = versions.find((version) => version.id === afterVersionId);

  useEffect(() => {
    if (!pleading) return;
    draftBodyDirty.current = false;
    setDraftBody(pleading.body ?? '');
    setChangeReason('');
    setAfterVersionId(versions[0]?.id ?? '');
    setBeforeVersionId(versions[1]?.id ?? versions[0]?.id ?? '');
  }, [pleading, versions]);

  useEffect(() => {
    if (
      generation?.status === 'completed' &&
      generation.streamedBody &&
      !draftBodyDirty.current
    ) {
      setDraftBody(generation.streamedBody);
    }
  }, [generation?.status, generation?.streamedBody]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!pleading) throw new Error('No pleading selected');
      return casesApi.updatePleading(caseId, pleading.id, {
        body: draftBody,
        title: pleading.title,
        change_reason: changeReason.trim() || 'Pleading workspace revision',
      });
    },
    onSuccess: () => {
      draftBodyDirty.current = false;
      showSuccess(t.revisionSaved);
      onSaved();
    },
    onError: showApiError,
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!pleading) throw new Error('No pleading selected');
      return casesApi.submitPleading(caseId, pleading.id);
    },
    onSuccess: () => {
      showSuccess(labels.toast.pleadingSubmitted);
      onSaved();
    },
    onError: showApiError,
  });

  const fileMutation = useMutation({
    mutationFn: () => {
      if (!pleading) throw new Error('No pleading selected');
      return casesApi.filePleading(caseId, pleading.id, {});
    },
    onSuccess: () => {
      showSuccess(labels.toast.pleadingFiled);
      onSaved();
    },
    onError: showApiError,
  });
  const generationActive = Boolean(
    generation &&
      ['queued', 'running', 'retrying', 'cancelling', 'disconnected'].includes(
        generation.status,
      ),
  );

  return (
    <Dialog open={Boolean(pleading)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pleading?.title ?? t.workspaceTitle}</DialogTitle>
          <DialogDescription>{t.workspaceDescription}</DialogDescription>
        </DialogHeader>

        {pleading ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(pleading.status)}>
                  {labels.filters.pleadingStatusOptions[pleading.status] ?? formatCaseToken(pleading.status)}
                </Badge>
                {pleading.ai_generated ? <Badge variant="outline">{t.aiGenerated}</Badge> : null}
                <Badge variant="secondary">v{pleading.current_version}</Badge>
              </div>

              {generation ? (
                <PleadingGenerationPanel
                  generation={generation}
                  onRetry={() => void onRetry(pleading.id)}
                  onCancel={() => void onCancel(pleading.id)}
                  onResume={() => void onResume(pleading.id)}
                  onDismiss={() => onDismiss(pleading.id)}
                />
              ) : null}

              <div className="space-y-1.5">
                <Label>{t.body}</Label>
                <Textarea
                  value={draftBody}
                  rows={14}
                  onChange={(event) => {
                    draftBodyDirty.current = true;
                    setDraftBody(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t.revisionPrompt}</Label>
                <Textarea
                  value={changeReason}
                  rows={3}
                  placeholder={t.revisionPromptPlaceholder}
                  onChange={(event) => setChangeReason(event.target.value)}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={generationActive}
                  onClick={() =>
                    void onGenerate(pleading.id, {
                      language: locale,
                      draft_prompt:
                        changeReason.trim() || draftBody || pleading.body,
                    })
                  }
                >
                  {generationActive ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="me-1.5 h-4 w-4" />
                  )}
                  {t.regenerate}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate()}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="me-1.5 h-4 w-4" />
                  )}
                  {t.saveRevision}
                </Button>
                {pleading.status === 'draft' ? (
                  <Button
                    type="button"
                    disabled={
                      submitMutation.isPending ||
                      generationActive ||
                      !draftBody.trim()
                    }
                    onClick={() => submitMutation.mutate()}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="me-1.5 h-4 w-4" />
                    )}
                    {t.submitAction}
                  </Button>
                ) : null}
                {pleading.status === 'approved' ? (
                  <Button type="button" disabled={fileMutation.isPending} onClick={() => fileMutation.mutate()}>
                    {fileMutation.isPending ? (
                      <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="me-1.5 h-4 w-4" />
                    )}
                    {t.fileAction}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border">
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <div>
                    <p className="font-semibold">{t.versionCompareTitle}</p>
                    <p className="text-xs text-muted-foreground">{t.versionCompareDescription}</p>
                  </div>
                  <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="space-y-4 p-4">
                  {versions.length < 2 ? (
                    <p className="text-sm text-muted-foreground">{t.versionCompareNeedsTwo}</p>
                  ) : (
                    <>
                      <VersionSelect
                        label={t.before}
                        value={beforeVersionId}
                        versions={versions}
                        onChange={setBeforeVersionId}
                      />
                      <VersionSelect label={t.after} value={afterVersionId} versions={versions} onChange={setAfterVersionId} />
                      <Separator />
                      <VersionBody label={t.before} body={beforeVersion?.body} noBodyLabel={t.noBodySnapshot} />
                      <VersionBody label={t.after} body={afterVersion?.body} noBodyLabel={t.noBodySnapshot} />
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="font-semibold">{t.documentReadinessTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.documentReadinessDescription}</p>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: string;
  versions: LegalPleadingVersion[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((version) => (
            <SelectItem key={version.id} value={version.id}>
              v{version.version} {version.change_reason ? `- ${version.change_reason}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function VersionBody({ label, body, noBodyLabel }: { label: string; body?: string; noBodyLabel: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <ScrollArea className="max-h-44 rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-line text-xs text-muted-foreground">{body || noBodyLabel}</p>
      </ScrollArea>
    </div>
  );
}
