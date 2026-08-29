'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import {
  BookOpen,
  CalendarClock,
  Gavel,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  TrendingDown,
  TrendingUp,
  Trash2,
} from 'lucide-react';
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
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/hooks/use-auth';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  JUDGMENT_OUTCOME_OPTIONS,
  JUDGMENT_RECOMMENDATION_OPTIONS,
  formatCaseToken,
  type JudgmentOutcome,
  type JudgmentRecommendation,
  type LegalJudgment,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';
import { useDeepTabLabels } from './deep-tab-labels';
import { buildDecisionSummary, resolveRecordText } from './deep-tab-model';

interface JudgmentsTabProps {
  caseId: string;
  canWrite: boolean;
}

function buildJudgmentSchema(refRequired: string) {
  return z.object({
    judgment_ref: z.string().trim().min(1, refRequired),
    judgment_date: z.string().optional().default(''),
    outcome: z.string().optional().default(''),
    summary: z.string().trim().optional().default(''),
    decision_type: z.string().trim().optional().default(''),
    impact: z.enum(['positive', 'negative', 'neutral', 'mixed']).default('neutral'),
    judge_name: z.string().trim().optional().default(''),
    court_name: z.string().trim().optional().default(''),
    implications: z.string().trim().optional().default(''),
    document_reference: z.string().trim().optional().default(''),
    next_expected_ruling_at: z.string().optional().default(''),
    next_expected_ruling: z.string().trim().optional().default(''),
  });
}
type JudgmentValues = z.infer<ReturnType<typeof buildJudgmentSchema>>;

function buildStudySchema(notesRequired: string) {
  return z.object({
    recommendation: z.enum(
      JUDGMENT_RECOMMENDATION_OPTIONS as unknown as [JudgmentRecommendation, ...JudgmentRecommendation[]],
    ),
    study_notes: z.string().trim().min(1, notesRequired),
    objection_deadline: z.string().optional().default(''),
    owner_name: z.string().trim().optional().default(''),
  });
}
type StudyValues = z.infer<ReturnType<typeof buildStudySchema>>;

function recommendationVariant(rec: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (rec) {
    case 'object':
      return 'destructive';
    case 'accept':
      return 'success';
    default:
      return 'secondary';
  }
}

export function JudgmentsTab({ caseId, canWrite }: JudgmentsTabProps) {
  const labels = useCaseLabels();
  const deepLabels = useDeepTabLabels();
  const { locale } = useLocaleOrDefault();
  const t = labels.judgments;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [studyTarget, setStudyTarget] = useState<LegalJudgment | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LegalJudgment | null>(null);

  const judgmentsQuery = useQuery({
    queryKey: ['lex-case-judgments', caseId],
    queryFn: () => casesApi.listJudgments(caseId),
  });

  const schema = useMemo(
    () => buildJudgmentSchema(labels.judgmentForm.errors.refRequired),
    [labels.judgmentForm.errors.refRequired],
  );
  const form = useForm<JudgmentValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      judgment_ref: '',
      judgment_date: '',
      outcome: '',
      summary: '',
      decision_type: '',
      impact: 'neutral',
      judge_name: '',
      court_name: '',
      implications: '',
      document_reference: '',
      next_expected_ruling_at: '',
      next_expected_ruling: '',
    },
  });

  useEffect(() => {
    if (addOpen) {
      form.reset({
        judgment_ref: '',
        judgment_date: '',
        outcome: '',
        summary: '',
        decision_type: '',
        impact: 'neutral',
        judge_name: '',
        court_name: '',
        implications: '',
        document_reference: '',
        next_expected_ruling_at: '',
        next_expected_ruling: '',
      });
    }
  }, [addOpen, form]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lex-case-judgments', caseId] });

  const addMutation = useMutation({
    mutationFn: (values: JudgmentValues) =>
      (casesApi.createJudgment as unknown as (
        targetCaseId: string,
        payload: Record<string, unknown>,
      ) => Promise<LegalJudgment>)(caseId, {
        judgment_ref: values.judgment_ref,
        judgment_date: values.judgment_date ? new Date(values.judgment_date).toISOString() : null,
        outcome: (values.outcome as JudgmentOutcome) || null,
        summary: values.summary,
        decision_type: values.decision_type || null,
        impact: values.impact,
        judge_name: values.judge_name || null,
        court_name: values.court_name || null,
        implications: values.implications || null,
        document_reference: values.document_reference || null,
        next_expected_ruling_at: values.next_expected_ruling_at
          ? new Date(values.next_expected_ruling_at).toISOString()
          : null,
        next_expected_ruling: values.next_expected_ruling || null,
      }),
    onSuccess: async () => {
      showSuccess(labels.toast.judgmentRecorded);
      setAddOpen(false);
      await invalidate();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (judgmentId: string) => casesApi.deleteJudgment(caseId, judgmentId),
    onSuccess: async () => {
      showSuccess(labels.toast.judgmentRemoved);
      setRemoveTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const outcomeValue = form.watch('outcome');
  const impactValue = form.watch('impact');
  const judgments = useMemo(() => judgmentsQuery.data ?? [], [judgmentsQuery.data]);
  const decisionSummary = useMemo(
    () =>
      buildDecisionSummary(
        judgments.map((judgment) => ({
          impact: resolveRecordText(judgment, 'impact'),
          nextExpectedRulingAt: resolveRecordText(judgment, 'next_expected_ruling_at'),
          nextExpectedRuling: resolveRecordText(judgment, 'next_expected_ruling'),
        })),
      ),
    [judgments],
  );

  return (
    <SectionCard
      title={deepLabels.decisions.title}
      description={deepLabels.decisions.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.add}
          </Button>
        ) : undefined
      }
    >
      {judgmentsQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : judgmentsQuery.isError ? (
        <ErrorState message={t.title} onRetry={() => void judgmentsQuery.refetch()} />
      ) : judgments.length === 0 ? (
        <EmptyState icon={Gavel} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="space-y-4">
            {judgments.map((judgment) => {
              const decisionType = resolveRecordText(judgment, 'decision_type');
              const impact = resolveRecordText(judgment, 'impact') ?? 'neutral';
              const judgeName = resolveRecordText(judgment, 'judge_name');
              const courtName = resolveRecordText(judgment, 'court_name');
              const implications = resolveRecordText(judgment, 'implications');
              const documentReference = resolveRecordText(judgment, 'document_reference');
              const fileName =
                resolveRecordText(judgment, 'file_name', 'attachment_file_name') ??
                documentReference;
              const impactLabel =
                deepLabels.decisions.impact[
                  impact as keyof typeof deepLabels.decisions.impact
                ] ?? formatCaseToken(impact);
              const impactVariant =
                impact === 'positive'
                  ? 'success'
                  : impact === 'negative'
                    ? 'destructive'
                    : impact === 'mixed'
                      ? 'warning'
                      : 'neutral';
              return (
                <article
                  key={judgment.id}
                  className="rounded-xl border border-border/80 bg-card p-4 shadow-elevation-1"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground" dir="auto">
                        {decisionType ? formatCaseToken(decisionType) : judgment.judgment_ref}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {deepLabels.common.decisionReference}:{' '}
                        <span className="font-semibold text-foreground" dir="auto">
                          {judgment.judgment_ref}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {judgment.judgment_date
                          ? formatDateTime(judgment.judgment_date)
                          : deepLabels.common.notSet}
                      </p>
                      {judgeName || courtName ? (
                        <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                          {deepLabels.decisions.judge}: <span className="font-medium text-foreground">{judgeName ?? deepLabels.common.notSet}</span>
                          {courtName ? ` · ${courtName}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {decisionType ? <Badge variant="info">{formatCaseToken(decisionType)}</Badge> : null}
                      <Badge variant={impactVariant}>{impactLabel}</Badge>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 border-y border-border/70 py-3">
                    <div>
                      <p className="text-overline font-semibold uppercase text-muted-foreground">
                        {deepLabels.decisions.summary}
                      </p>
                      <p className="mt-1 whitespace-pre-line text-sm text-foreground" dir="auto">
                        {judgment.summary || deepLabels.common.notSet}
                      </p>
                    </div>
                    <div>
                      <p className="text-overline font-semibold uppercase text-muted-foreground">
                        {deepLabels.decisions.implications}
                      </p>
                      <p className="mt-1 whitespace-pre-line text-sm text-foreground" dir="auto">
                        {implications || judgment.study_notes || deepLabels.common.notSet}
                      </p>
                    </div>
                  </div>

                  {judgment.file_id || fileName ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm font-medium" dir="auto">
                          {fileName ?? judgment.file_id ?? deepLabels.common.file}
                        </span>
                      </div>
                      {documentReference ? (
                        <p className="text-xs text-muted-foreground">
                          {deepLabels.common.documentReference}:{' '}
                          <span className="font-semibold text-foreground">
                            {documentReference}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {t.objectionDeadline}:{' '}
                      {judgment.objection_deadline ? (
                        <RelativeTime date={judgment.objection_deadline} />
                      ) : (
                        t.noObjectionDeadline
                      )}
                    </p>
                    <Badge variant={recommendationVariant(judgment.recommendation)}>
                      {labels.filters.judgmentRecommendationOptions[judgment.recommendation] ??
                        formatCaseToken(judgment.recommendation)}
                    </Badge>
                  </div>

                  {canWrite ? (
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setStudyTarget(judgment)}>
                        {judgment.studied_at ? (
                          <Pencil className="me-1.5 h-3.5 w-3.5" />
                        ) : (
                          <BookOpen className="me-1.5 h-3.5 w-3.5" />
                        )}
                        {judgment.studied_at ? labels.detail.edit : t.study}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoveTarget(judgment)}>
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
            <h3 className="font-semibold text-foreground">{deepLabels.decisions.overview}</h3>
            <dl className="space-y-3 text-sm">
              <DecisionSummaryRow label={deepLabels.decisions.total} value={String(decisionSummary.total)} />
              <DecisionSummaryRow label={deepLabels.decisions.positive} value={String(decisionSummary.positive)} tone="success" />
              <DecisionSummaryRow label={deepLabels.decisions.neutral} value={String(decisionSummary.neutral)} />
              <DecisionSummaryRow label={deepLabels.decisions.negative} value={String(decisionSummary.negative)} tone="destructive" />
            </dl>
            <div className="border-t border-border/70 pt-4">
              <p className="text-sm font-semibold">{deepLabels.decisions.trajectory}</p>
              <div
                className={`mt-3 flex gap-3 rounded-lg p-3 ${
                  decisionSummary.trajectory === 'positive'
                    ? 'bg-success-50 text-success-700'
                    : decisionSummary.trajectory === 'negative'
                      ? 'bg-error-50 text-error-700'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {decisionSummary.trajectory === 'negative' ? (
                  <TrendingDown className="mt-0.5 h-5 w-5 shrink-0" />
                ) : (
                  <TrendingUp className="mt-0.5 h-5 w-5 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {decisionSummary.trajectory === 'positive'
                      ? deepLabels.decisions.positiveTrajectory
                      : decisionSummary.trajectory === 'negative'
                        ? deepLabels.decisions.negativeTrajectory
                        : deepLabels.decisions.neutralTrajectory}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {decisionSummary.trajectory === 'positive'
                      ? deepLabels.decisions.positiveHint
                      : decisionSummary.trajectory === 'negative'
                        ? deepLabels.decisions.negativeHint
                        : deepLabels.decisions.neutralHint}
                  </p>
                </div>
              </div>
            </div>
            <div className="border-t border-border/70 pt-4">
              <p className="text-xs text-muted-foreground">{deepLabels.decisions.next}</p>
              {decisionSummary.next ? (
                <>
                  <p className="mt-1 font-semibold text-warning-700" dir="auto">
                    {decisionSummary.next.nextExpectedRuling ?? deepLabels.common.notSet}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {decisionSummary.next.nextExpectedRulingAt
                      ? new Date(decisionSummary.next.nextExpectedRulingAt).toLocaleDateString(
                          locale === 'ar' ? 'ar-SA' : 'en-GB',
                          { day: '2-digit', month: 'short', year: 'numeric' },
                        )
                      : deepLabels.common.notSet}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{deepLabels.common.notSet}</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {canWrite ? (
        <>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{labels.judgmentForm.addTitle}</DialogTitle>
                <DialogDescription>{labels.judgmentForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...form}>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => addMutation.mutate(v))}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="judgment_ref" label={labels.judgmentForm.judgmentRef} required>
                      <Input id="judgment_ref" {...form.register('judgment_ref')} placeholder={labels.judgmentForm.judgmentRefPlaceholder} />
                    </FormField>
                    <FormField name="judgment_date" label={labels.judgmentForm.judgmentDate}>
                      <Input id="judgment_date" type="date" {...form.register('judgment_date')} />
                    </FormField>
                    <FormField name="outcome" label={labels.judgmentForm.outcome}>
                      <Select
                        value={outcomeValue || 'none'}
                        onValueChange={(v) => form.setValue('outcome', v === 'none' ? '' : v, { shouldValidate: true })}
                      >
                        <SelectTrigger id="outcome">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{labels.judgmentForm.noOutcome}</SelectItem>
                          {JUDGMENT_OUTCOME_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {labels.filters.judgmentOutcomeOptions[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="decision_type" label={locale === 'ar' ? 'نوع القرار' : 'Decision type'}>
                      <Input
                        id="decision_type"
                        dir="auto"
                        {...form.register('decision_type')}
                        placeholder={locale === 'ar' ? 'حكم موضوعي، أمر مؤقت…' : 'Substantive ruling, interim order…'}
                      />
                    </FormField>
                    <FormField name="impact" label={locale === 'ar' ? 'الأثر' : 'Impact'}>
                      <Select
                        value={impactValue}
                        onValueChange={(value) =>
                          form.setValue(
                            'impact',
                            value as 'positive' | 'negative' | 'neutral' | 'mixed',
                            { shouldValidate: true },
                          )
                        }
                      >
                        <SelectTrigger id="impact">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['positive', 'negative', 'neutral', 'mixed'] as const).map((impact) => (
                            <SelectItem key={impact} value={impact}>
                              {deepLabels.decisions.impact[impact]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="judge_name" label={deepLabels.decisions.judge}>
                      <Input id="judge_name" dir="auto" {...form.register('judge_name')} />
                    </FormField>
                    <FormField name="court_name" label={deepLabels.decisions.court}>
                      <Input id="court_name" dir="auto" {...form.register('court_name')} />
                    </FormField>
                    <FormField name="document_reference" label={deepLabels.common.decisionReference}>
                      <Input
                        id="document_reference"
                        dir="ltr"
                        {...form.register('document_reference')}
                        placeholder="RIY-COMM-JUD-..."
                      />
                    </FormField>
                    <FormField name="next_expected_ruling_at" label={deepLabels.decisions.next}>
                      <Input
                        id="next_expected_ruling_at"
                        type="date"
                        {...form.register('next_expected_ruling_at')}
                      />
                    </FormField>
                    <FormField
                      name="next_expected_ruling"
                      label={locale === 'ar' ? 'وصف القرار المتوقع' : 'Expected ruling description'}
                    >
                      <Input
                        id="next_expected_ruling"
                        dir="auto"
                        {...form.register('next_expected_ruling')}
                      />
                    </FormField>
                  </div>
                  <FormField name="summary" label={labels.judgmentForm.summary}>
                    <Textarea id="summary" rows={4} {...form.register('summary')} placeholder={labels.judgmentForm.summaryPlaceholder} />
                  </FormField>
                  <FormField name="implications" label={deepLabels.decisions.implications}>
                    <Textarea id="implications" rows={3} dir="auto" {...form.register('implications')} />
                  </FormField>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                      {labels.judgmentForm.cancel}
                    </Button>
                    <Button type="submit" disabled={addMutation.isPending}>
                      {addMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {labels.judgmentForm.submit}
                    </Button>
                  </DialogFooter>
                </form>
              </FormProvider>
            </DialogContent>
          </Dialog>

          <StudyJudgmentDialog
            caseId={caseId}
            judgment={studyTarget}
            onOpenChange={(open) => {
              if (!open) setStudyTarget(null);
            }}
            onSaved={() => void invalidate()}
          />

          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={labels.confirm.removeJudgmentTitle}
            description={labels.confirm.removeJudgmentDescription(removeTarget?.judgment_ref ?? '')}
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

function DecisionSummaryRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'destructive';
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success-700',
    destructive: 'text-error-700',
  }[tone];
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}

function StudyJudgmentDialog({
  caseId,
  judgment,
  onOpenChange,
  onSaved,
}: {
  caseId: string;
  judgment: LegalJudgment | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.studyForm;
  const { user } = useAuth();

  const schema = useMemo(() => buildStudySchema(t.errors.notesRequired), [t.errors.notesRequired]);
  const form = useForm<StudyValues>({
    resolver: zodResolver(schema),
    defaultValues: { recommendation: 'pending', study_notes: '', objection_deadline: '', owner_name: '' },
  });

  useEffect(() => {
    if (judgment) {
      form.reset({
        recommendation: judgment.recommendation ?? 'pending',
        study_notes: judgment.study_notes ?? '',
        objection_deadline: judgment.objection_deadline ? judgment.objection_deadline.slice(0, 10) : '',
        owner_name: user?.full_name ?? user?.email ?? '',
      });
    }
  }, [judgment, form, user?.email, user?.full_name]);

  const studyMutation = useMutation({
    mutationFn: (values: StudyValues) => {
      if (!judgment) throw new Error('no judgment');
      return casesApi.studyJudgment(caseId, judgment.id, {
        recommendation: values.recommendation,
        study_notes: values.study_notes,
        objection_deadline: values.objection_deadline
          ? new Date(values.objection_deadline).toISOString()
          : null,
        owner_user_id: values.recommendation === 'object' ? user?.id ?? null : null,
        owner_name: values.owner_name || undefined,
      });
    },
    onSuccess: () => {
      showSuccess(labels.toast.judgmentStudied);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const recommendationValue = form.watch('recommendation');

  return (
    <Dialog open={Boolean(judgment)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => studyMutation.mutate(v))}>
            <FormField name="recommendation" label={t.recommendation} required>
              <Select
                value={recommendationValue}
                onValueChange={(v) => form.setValue('recommendation', v as JudgmentRecommendation, { shouldValidate: true })}
              >
                <SelectTrigger id="recommendation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JUDGMENT_RECOMMENDATION_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.filters.judgmentRecommendationOptions[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField name="study_notes" label={t.studyNotes} required>
              <Textarea id="study_notes" rows={4} {...form.register('study_notes')} placeholder={t.studyNotesPlaceholder} />
            </FormField>
            <FormField name="objection_deadline" label={t.objectionDeadline} description={t.objectionDeadlineHint}>
              <Input id="objection_deadline" type="date" {...form.register('objection_deadline')} />
            </FormField>
            <FormField name="owner_name" label={t.ownerName}>
              <Input id="owner_name" {...form.register('owner_name')} placeholder={t.ownerNamePlaceholder} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={studyMutation.isPending}>
                {studyMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
