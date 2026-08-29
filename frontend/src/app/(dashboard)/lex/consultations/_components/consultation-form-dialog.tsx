'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import {
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  ClipboardList,
  Info,
  Loader2,
  MessageSquareText,
  Paperclip,
  Route,
  Scale,
  Send,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { FormField } from '@/components/shared/forms/form-field';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  CONSULTATION_PRIORITY_VALUES,
  CONSULTATION_TYPE_VALUES,
  consultationsApi,
  type Consultation,
  type SubmitConsultationPayload,
} from '@/lib/lex/consultations';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  CONSULTATION_PRIORITY_OPTIONS,
  CONSULTATION_TYPE_OPTIONS,
  type ConsultationLabels,
  useConsultationLabels,
} from './labels';

function buildSchema(errors: ConsultationLabels['form']['errors']) {
  return z
    .object({
      title_en: z.string().trim().optional(),
      title_ar: z.string().trim().optional(),
      type: z.enum(CONSULTATION_TYPE_VALUES),
      priority: z.enum(CONSULTATION_PRIORITY_VALUES),
      requester_name: z.string().trim().min(1, errors.requesterRequired),
      department: z.string().trim().optional(),
      question: z.string().trim().min(1, errors.questionRequired),
      tags: z.string().trim().optional(),
    })
    .refine((values) => Boolean(values.title_en || values.title_ar), {
      message: errors.titleRequired,
      path: ['title_en'],
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface ConsultationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (consultation: Consultation) => void;
  defaultRequesterName?: string;
}

function buildDefaults(defaultRequesterName = ''): FormValues {
  return {
    title_en: '',
    title_ar: '',
    type: 'general',
    priority: 'medium',
    requester_name: defaultRequesterName,
    department: '',
    question: '',
    tags: '',
  };
}

function parseTags(value = ''): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function ConsultationFormDialog({
  open,
  onOpenChange,
  onSaved,
  defaultRequesterName = '',
}: ConsultationFormDialogProps) {
  const queryClient = useQueryClient();
  const { locale, direction } = useLocaleOrDefault();
  const labels = useConsultationLabels();
  const formLabels = labels.form;
  const schema = useMemo(
    () => buildSchema(formLabels.errors),
    [formLabels.errors],
  );
  const defaults = useMemo(
    () => buildDefaults(defaultRequesterName),
    [defaultRequesterName],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults);
    }
  }, [defaults, form, open]);

  const submit = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: SubmitConsultationPayload = {
        type: values.type,
        priority: values.priority,
        title: {
          en: values.title_en?.trim() ?? '',
          ar: values.title_ar?.trim() ?? '',
        },
        requester_name: values.requester_name.trim(),
        department: values.department?.trim() || null,
        question: values.question.trim(),
        tags: parseTags(values.tags),
      };
      return consultationsApi.submit(payload);
    },
    onSuccess: async (consultation) => {
      showSuccess(labels.toast.submitted);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-consultations'] }),
        queryClient.invalidateQueries({
          queryKey: ['lex-consultations-stats'],
        }),
        queryClient.invalidateQueries({ queryKey: ['lex-consultations-tags'] }),
      ]);
      onOpenChange(false);
      onSaved?.(consultation);
    },
    onError: showApiError,
  });

  const type = form.watch('type');
  const priority = form.watch('priority');
  const titleEn = form.watch('title_en') ?? '';
  const titleAr = form.watch('title_ar') ?? '';
  const requesterName = form.watch('requester_name') ?? '';
  const department = form.watch('department') ?? '';
  const question = form.watch('question') ?? '';
  const tags = parseTags(form.watch('tags') ?? '');
  const displayTitle =
    titleEn.trim() || titleAr.trim() || formLabels.notProvided;
  const readiness = [
    Boolean(titleEn.trim() || titleAr.trim()),
    Boolean(requesterName.trim()),
    Boolean(question.trim()),
  ];
  const completeCount = readiness.filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        data-testid="consultation-create-dialog"
        dir={direction}
        lang={locale}
      >
        <DialogHeader className="border-b border-border/70 bg-gradient-to-br from-primary/[0.08] via-card to-brand-gold/[0.06] px-5 py-5 pe-14 text-start sm:px-7 sm:py-6">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-elevation-1">
              <Scale className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-caps-wide text-primary">
                {formLabels.eyebrow}
              </p>
              <DialogTitle className="text-xl sm:text-2xl">
                {formLabels.title}
              </DialogTitle>
              <DialogDescription className="max-w-2xl leading-6">
                {formLabels.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            className="flex min-h-0 flex-col overflow-hidden"
            onSubmit={form.handleSubmit((values) => submit.mutate(values))}
          >
            <LexCreationGuidance workflow="consultation" className="mx-5 mt-5 sm:mx-7" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid items-start lg:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.75fr)]">
                <div className="space-y-5 p-5 sm:p-7">
                  <section
                    className="rounded-2xl border border-border/70 bg-card p-5 shadow-elevation-1 sm:p-6"
                    aria-labelledby="consultation-intake-heading"
                  >
                    <SectionHeading
                      id="consultation-intake-heading"
                      icon={ClipboardList}
                      title={formLabels.intakeTitle}
                      description={formLabels.intakeDescription}
                    />

                    <div className="mt-6 space-y-5">
                      <div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField name="title_en" label={formLabels.titleEn}>
                            <Input
                              id="title_en"
                              {...form.register('title_en')}
                              placeholder={formLabels.titleEnPlaceholder}
                            />
                          </FormField>
                          <FormField name="title_ar" label={formLabels.titleAr}>
                            <Input
                              id="title_ar"
                              dir="rtl"
                              {...form.register('title_ar')}
                              placeholder={formLabels.titleArPlaceholder}
                            />
                          </FormField>
                        </div>
                        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                          <Info
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                          {formLabels.titleHelper}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FormField name="type" label={formLabels.type} required>
                          <Select
                            value={type}
                            onValueChange={(value) =>
                              form.setValue(
                                'type',
                                value as FormValues['type'],
                                {
                                  shouldValidate: true,
                                },
                              )
                            }
                          >
                            <SelectTrigger id="type" aria-required="true">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONSULTATION_TYPE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {labels.filters.typeOptions[option]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormField>

                        <FormField
                          name="priority"
                          label={formLabels.priority}
                          description={formLabels.priorityHelper}
                          required
                        >
                          <Select
                            value={priority}
                            onValueChange={(value) =>
                              form.setValue(
                                'priority',
                                value as FormValues['priority'],
                                {
                                  shouldValidate: true,
                                },
                              )
                            }
                          >
                            <SelectTrigger id="priority" aria-required="true">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONSULTATION_PRIORITY_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {labels.filters.priorityOptions[option]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormField>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FormField
                          name="requester_name"
                          label={formLabels.requesterName}
                          required
                        >
                          <Input
                            id="requester_name"
                            aria-required="true"
                            {...form.register('requester_name')}
                            placeholder={formLabels.requesterNamePlaceholder}
                          />
                        </FormField>
                        <FormField
                          name="department"
                          label={formLabels.department}
                        >
                          <Input
                            id="department"
                            {...form.register('department')}
                            placeholder={formLabels.departmentPlaceholder}
                          />
                        </FormField>
                      </div>
                    </div>
                  </section>

                  <section
                    className="rounded-2xl border border-border/70 bg-card p-5 shadow-elevation-1 sm:p-6"
                    aria-labelledby="consultation-question-heading"
                  >
                    <SectionHeading
                      id="consultation-question-heading"
                      icon={MessageSquareText}
                      title={formLabels.questionSectionTitle}
                      description={formLabels.questionSectionDescription}
                    />

                    <div className="mt-6 space-y-5">
                      <FormField
                        name="question"
                        label={formLabels.question}
                        description={formLabels.questionHelper}
                        required
                      >
                        <Textarea
                          id="question"
                          aria-required="true"
                          {...form.register('question')}
                          placeholder={formLabels.questionPlaceholder}
                          rows={8}
                          className="min-h-40 resize-y"
                        />
                      </FormField>

                      <FormField
                        name="tags"
                        label={formLabels.tags}
                        description={formLabels.tagsHelper}
                      >
                        <Input
                          id="tags"
                          {...form.register('tags')}
                          placeholder={formLabels.tagsPlaceholder}
                        />
                      </FormField>

                      {tags.length > 0 ? (
                        <div
                          className="flex flex-wrap gap-2"
                          aria-label={formLabels.tags}
                        >
                          {tags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              <Tags className="me-1 h-3 w-3" aria-hidden />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>

                <aside className="space-y-5 border-t border-border/70 bg-muted/20 p-5 sm:p-7 lg:sticky lg:top-0 lg:border-s lg:border-t-0">
                  <section
                    className="rounded-2xl border border-border/70 bg-card p-5 shadow-elevation-1"
                    aria-labelledby="consultation-summary-heading"
                  >
                    <SectionHeading
                      id="consultation-summary-heading"
                      icon={ClipboardCheck}
                      title={formLabels.summaryTitle}
                      description={formLabels.summaryDescription}
                      compact
                    />

                    <dl className="mt-5 space-y-4">
                      <SummaryRow
                        label={formLabels.previewTitle}
                        value={displayTitle}
                        valueDir={
                          titleEn.trim()
                            ? 'ltr'
                            : titleAr.trim()
                              ? 'rtl'
                              : 'auto'
                        }
                      />
                      <SummaryRow
                        label={formLabels.type}
                        value={labels.filters.typeOptions[type]}
                      />
                      <SummaryRow
                        label={formLabels.priority}
                        value={
                          <StatusBadge
                            status={priority}
                            map={severityMap}
                            label={labels.filters.priorityOptions[priority]}
                            icon={null}
                            size="sm"
                          />
                        }
                      />
                      <SummaryRow
                        label={formLabels.requesterName}
                        value={requesterName.trim() || formLabels.notProvided}
                      />
                      <SummaryRow
                        label={formLabels.department}
                        value={department.trim() || formLabels.notProvided}
                      />
                    </dl>

                    <div className="mt-5 border-t border-border/70 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {formLabels.readinessTitle}
                          </p>
                          <p
                            className="mt-1 text-xs text-muted-foreground"
                            aria-live="polite"
                          >
                            {formLabels.readiness(
                              completeCount,
                              readiness.length,
                            )}
                          </p>
                        </div>
                        <span
                          className={
                            completeCount === readiness.length
                              ? 'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success-50 text-success-700 dark:bg-success-700/15 dark:text-success-300'
                              : 'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300'
                          }
                        >
                          {completeCount === readiness.length ? (
                            <CheckCircle2 className="h-4 w-4" aria-hidden />
                          ) : (
                            <ClipboardList className="h-4 w-4" aria-hidden />
                          )}
                        </span>
                      </div>
                      <div className="mt-4 space-y-2">
                        <ReadinessItem
                          complete={readiness[0]}
                          label={formLabels.previewTitle}
                        />
                        <ReadinessItem
                          complete={readiness[1]}
                          label={formLabels.requesterName}
                        />
                        <ReadinessItem
                          complete={readiness[2]}
                          label={formLabels.question}
                        />
                      </div>
                    </div>
                  </section>

                  <section
                    className="rounded-2xl border border-primary/20 bg-primary/[0.045] p-5"
                    aria-labelledby="consultation-next-heading"
                  >
                    <h3
                      id="consultation-next-heading"
                      className="flex items-center gap-2 text-sm font-semibold text-foreground"
                    >
                      <Route className="h-4 w-4 text-primary" aria-hidden />
                      {formLabels.nextTitle}
                    </h3>
                    <ol className="mt-4 space-y-4">
                      <NextStep number={1} text={formLabels.nextClassify} />
                      <NextStep number={2} text={formLabels.nextAssign} />
                      <NextStep number={3} text={formLabels.nextRespond} />
                    </ol>
                  </section>

                  <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm">
                    <Paperclip
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    <p className="leading-6 text-foreground">
                      {formLabels.attachmentsNote}
                    </p>
                  </div>
                </aside>
              </div>
            </div>

            <DialogFooter className="items-center gap-3 border-t border-border/70 bg-card px-5 py-4 sm:justify-between sm:space-x-0 sm:px-7">
              <p className="me-auto text-xs text-muted-foreground">
                {formLabels.requiredNote}
              </p>
              <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  {formLabels.cancel}
                </Button>
                <Button type="submit" disabled={submit.isPending}>
                  {submit.isPending ? (
                    <Loader2
                      className="me-1.5 h-4 w-4 animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Send className="me-1.5 h-4 w-4" aria-hidden />
                  )}
                  {formLabels.submit}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          compact
            ? 'grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'
            : 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary'
        }
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2
          id={id}
          className={
            compact ? 'text-base font-semibold' : 'text-lg font-semibold'
          }
        >
          {title}
        </h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueDir = 'auto',
}: {
  label: string;
  value: React.ReactNode;
  valueDir?: 'auto' | 'ltr' | 'rtl';
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className="break-words text-sm font-semibold text-foreground"
        dir={valueDir}
      >
        {value}
      </dd>
    </div>
  );
}

function ReadinessItem({
  complete,
  label,
}: {
  complete: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {complete ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden />
      ) : (
        <Circle
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span className={complete ? 'text-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
    </div>
  );
}

function NextStep({ number, text }: { number: number; text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </span>
      <span className="leading-5 text-foreground">{text}</span>
    </li>
  );
}
