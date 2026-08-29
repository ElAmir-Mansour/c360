'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import {
  Check,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { PageHeader } from '@/components/common/page-header';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { FormField } from '@/components/shared/forms/form-field';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { formatBytes } from '@/lib/format';
import {
  CONSULTATION_TYPE_VALUES,
  consultationsApi,
  type ConsultationType,
} from '@/lib/lex/consultations';
import { cn } from '@/lib/utils';
import {
  showApiError,
  showSuccess,
  showWarning,
} from '@/lib/toast';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import {
  CONSULTATION_TYPE_OPTIONS,
  useConsultationLabels,
} from '../_components/labels';
import {
  type ConsultationIntakeCopy,
  useConsultationIntakeCopy,
} from './_components/intake-copy';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_COUNT = 10;
const ACCEPTED_FILE_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
]);

function buildSchema(copy: ConsultationIntakeCopy) {
  return z
    .object({
      type: z.enum(CONSULTATION_TYPE_VALUES),
      department: z.string().trim().optional(),
      subject: z.string().trim().min(3, copy.errors.subject),
      details: z.string().trim().min(10, copy.errors.details),
      reference: z.string().trim().optional(),
      urgency: z.enum(['normal', 'urgent']),
      urgency_justification: z.string().trim().optional(),
    })
    .superRefine((values, context) => {
      if (values.urgency === 'urgent' && !values.urgency_justification?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['urgency_justification'],
          message: copy.errors.justification,
        });
      }
    });
}

type IntakeValues = z.infer<ReturnType<typeof buildSchema>>;

interface AttachmentResult {
  failed: string[];
}

function requesterDisplayName(
  user:
    | {
        full_name?: string;
        first_name?: string;
        last_name?: string;
        email?: string;
      }
    | null,
  fallback: string,
) {
  return (
    user?.full_name?.trim() ||
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    user?.email?.trim() ||
    fallback
  );
}

export default function NewConsultationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const copy = useConsultationIntakeCopy();
  const labels = useConsultationLabels();
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPosition, setUploadPosition] = useState(0);

  const schema = useMemo(() => buildSchema(copy), [copy]);
  const form = useForm<IntakeValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'contractual',
      department: '',
      subject: '',
      details: '',
      reference: '',
      urgency: 'normal',
      urgency_justification: '',
    },
  });

  const urgency = form.watch('urgency');
  const requesterName = requesterDisplayName(
    user,
    copy.requesterFallback,
  );

  const submitMutation = useMutation({
    mutationFn: async (
      values: IntakeValues,
    ): Promise<{
      consultationId: string;
      attachments: AttachmentResult;
    }> => {
      const consultation = await consultationsApi.submit({
        type: values.type,
        priority: values.urgency === 'urgent' ? 'high' : 'medium',
        title: {
          en: locale === 'en' ? values.subject.trim() : '',
          ar: locale === 'ar' ? values.subject.trim() : '',
        },
        requester_name: requesterName,
        department: values.department?.trim() || null,
        question: values.details.trim(),
        tags: [values.type, values.urgency],
        metadata: {
          source: 'consultation_intake',
          reference_number: values.reference?.trim() || null,
          urgency: values.urgency,
          urgency_justification:
            values.urgency === 'urgent'
              ? values.urgency_justification?.trim() || null
              : null,
        },
      });

      const failed: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadPosition(index + 1);
        setUploadProgress(Math.round((index / files.length) * 100));

        try {
          const uploaded = await enterpriseApi.files.upload(
            file,
            {
              suite: 'lex',
              entity_type: 'consultation_document',
              entity_id: consultation.id,
              lifecycle_policy: 'standard',
            },
            (progress) => {
              const completed = index / files.length;
              const current = progress / 100 / files.length;
              setUploadProgress(Math.round((completed + current) * 100));
            },
          );

          await consultationsApi.attachDocument(consultation.id, {
            file_id: uploaded.id,
            file_name: uploaded.original_name,
            file_size: uploaded.size_bytes,
            content_type: uploaded.content_type ?? null,
            kind: 'supporting_document',
            metadata: {
              source: 'consultation_intake',
            },
          });
        } catch {
          failed.push(file.name);
        }
      }

      setUploadProgress(files.length > 0 ? 100 : 0);
      return {
        consultationId: consultation.id,
        attachments: { failed },
      };
    },
    onSuccess: async ({ consultationId, attachments }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-consultations'] }),
        queryClient.invalidateQueries({
          queryKey: ['lex-consultations-stats'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['lex-consultation', consultationId],
        }),
      ]);

      if (attachments.failed.length > 0) {
        showWarning(
          copy.files.attachmentFailureTitle,
          copy.files.attachmentFailureDescription(attachments.failed.length),
        );
      } else {
        showSuccess(copy.success);
      }
      router.push(`/lex/consultations/${consultationId}`);
    },
    onError: showApiError,
  });

  return (
    <LexRouteGuard route="/lex/consultations/new">
      <div
        className="space-y-6"
        dir={direction}
        lang={locale}
        data-testid="consultation-intake-page"
      >
        <PageHeader
          breadcrumb={
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-2">
                <li>
                  <Link
                    href="/lex/consultations"
                    className="transition-colors hover:text-foreground"
                  >
                    {copy.breadcrumb.consultations}
                  </Link>
                </li>
                <li aria-hidden>
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5',
                      direction === 'rtl' && 'rotate-180',
                    )}
                  />
                </li>
                <li className="font-semibold text-foreground">
                  {copy.breadcrumb.current}
                </li>
              </ol>
            </nav>
          }
          title={copy.title}
          description={copy.description}
        />

        <LexCreationGuidance workflow="consultation" />

        <ConsultationStepper copy={copy} />

        <FormProvider {...form}>
          <form
            className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"
            onSubmit={form.handleSubmit((values) =>
              submitMutation.mutate(values),
            )}
          >
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border/70">
                <CardTitle>{copy.form.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <FormField
                    name="type"
                    label={copy.form.type}
                    required
                  >
                    <Select
                      value={form.watch('type')}
                      onValueChange={(value) =>
                        form.setValue('type', value as ConsultationType, {
                          shouldValidate: true,
                        })
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
                    name="department"
                    label={copy.form.department}
                  >
                    <Input
                      id="department"
                      {...form.register('department')}
                      placeholder={copy.form.departmentPlaceholder}
                    />
                  </FormField>
                </div>

                <FormField
                  name="subject"
                  label={copy.form.subject}
                  required
                >
                  <Input
                    id="subject"
                    {...form.register('subject')}
                    placeholder={copy.form.subjectPlaceholder}
                    aria-required="true"
                  />
                </FormField>

                <FormField
                  name="details"
                  label={copy.form.details}
                  required
                >
                  <Textarea
                    id="details"
                    {...form.register('details')}
                    placeholder={copy.form.detailsPlaceholder}
                    className="min-h-36 resize-y"
                    aria-required="true"
                  />
                </FormField>

                <FormField
                  name="reference"
                  label={`${copy.form.reference} ${copy.form.optional}`}
                >
                  <Input
                    id="reference"
                    {...form.register('reference')}
                    placeholder={copy.form.referencePlaceholder}
                  />
                </FormField>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold text-foreground">
                    {copy.form.urgency}
                  </legend>
                  <RadioGroup
                    value={urgency}
                    onValueChange={(value) =>
                      form.setValue(
                        'urgency',
                        value as IntakeValues['urgency'],
                        { shouldValidate: true },
                      )
                    }
                    className="flex flex-col gap-3 lg:flex-row lg:gap-8"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="urgent" id="urgency-urgent" />
                      <Label
                        htmlFor="urgency-urgent"
                        className="cursor-pointer font-normal"
                      >
                        {copy.form.urgent}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="normal" id="urgency-normal" />
                      <Label
                        htmlFor="urgency-normal"
                        className="cursor-pointer font-normal"
                      >
                        {copy.form.normal}
                      </Label>
                    </div>
                  </RadioGroup>
                </fieldset>

                {urgency === 'urgent' ? (
                  <FormField
                    name="urgency_justification"
                    label={copy.form.urgentJustification}
                    required
                  >
                    <Textarea
                      id="urgency_justification"
                      {...form.register('urgency_justification')}
                      placeholder={copy.form.urgentJustificationPlaceholder}
                      className="min-h-24"
                      aria-required="true"
                    />
                  </FormField>
                ) : null}

                <AttachmentPicker
                  files={files}
                  copy={copy}
                  disabled={submitMutation.isPending}
                  error={fileError}
                  onError={setFileError}
                  onChange={setFiles}
                />

                {submitMutation.isPending && files.length > 0 ? (
                  <div
                    className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-foreground">
                        {copy.files.uploading(
                          Math.max(uploadPosition, 1),
                          files.length,
                        )}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {uploadProgress}%
                      </span>
                    </div>
                    <Progress
                      value={uploadProgress}
                      className="h-2"
                      aria-label={copy.files.uploading(
                        Math.max(uploadPosition, 1),
                        files.length,
                      )}
                    />
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-6 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/lex/consultations')}
                    disabled={submitMutation.isPending}
                  >
                    {copy.form.cancel}
                  </Button>
                  <Button type="submit" disabled={submitMutation.isPending}>
                    {submitMutation.isPending ? (
                      <Loader2
                        className="me-2 h-4 w-4 animate-spin"
                        aria-hidden
                      />
                    ) : null}
                    {copy.form.submit}
                  </Button>
                  <p className="text-xs text-muted-foreground sm:ms-auto">
                    {copy.form.required}
                  </p>
                </div>
              </CardContent>
            </Card>

            <aside className="space-y-5 xl:sticky xl:top-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300">
                      <ShieldCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <CardTitle className="text-base">{copy.sla.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {copy.sla.description}
                  </p>
                  <SlaRow
                    badge={copy.sla.urgentDays}
                    title={copy.sla.urgentTitle}
                    tone="warning"
                    description={copy.sla.urgentDescription}
                  />
                  <div className="border-t border-border/70" />
                  <SlaRow
                    badge={copy.sla.normalDays}
                    title={copy.sla.normalTitle}
                    tone="info"
                  />
                </CardContent>
              </Card>

              <div className="rounded-2xl border border-success-300/60 bg-success-50 p-5 text-success-800 dark:border-success-700/50 dark:bg-success-700/10 dark:text-success-200">
                <h2 className="font-semibold">{copy.tip.title}</h2>
                <p className="mt-2 text-sm leading-6">
                  {copy.tip.description}
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-5">
                <p className="text-xs font-medium uppercase tracking-label text-muted-foreground">
                  {copy.form.requester}
                </p>
                <p className="mt-2 break-words text-sm font-semibold text-foreground">
                  {requesterName}
                </p>
              </div>
            </aside>
          </form>
        </FormProvider>
      </div>
    </LexRouteGuard>
  );
}

function ConsultationStepper({ copy }: { copy: ConsultationIntakeCopy }) {
  const steps = [
    { label: copy.steps.request, state: 'complete' as const },
    { label: copy.steps.details, state: 'active' as const },
    { label: copy.steps.attachments, state: 'upcoming' as const },
    { label: copy.steps.review, state: 'upcoming' as const },
  ];

  return (
    <ol
      className="grid gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-2 lg:flex lg:items-center lg:justify-center lg:gap-4"
      aria-label={copy.title}
    >
      {steps.map((step, index) => (
        <li
          key={step.label}
          className="flex min-w-0 items-center gap-3 lg:flex-1"
          aria-current={step.state === 'active' ? 'step' : undefined}
        >
          {index > 0 ? (
            <span
              className={cn(
                'hidden h-px min-w-6 flex-1 lg:block',
                step.state === 'active' ? 'bg-primary' : 'bg-border',
              )}
              aria-hidden
            />
          ) : null}
          <span
            className={cn(
              'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
              step.state === 'complete' &&
                'border-primary bg-primary text-primary-foreground',
              step.state === 'active' &&
                'border-primary bg-primary text-primary-foreground',
              step.state === 'upcoming' &&
                'border-border bg-background text-muted-foreground',
            )}
          >
            {step.state === 'complete' ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              index + 1
            )}
          </span>
          <span
            className={cn(
              'truncate text-sm',
              step.state === 'active'
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground',
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function AttachmentPicker({
  files,
  copy,
  disabled,
  error,
  onError,
  onChange,
}: {
  files: File[];
  copy: ConsultationIntakeCopy;
  disabled: boolean;
  error: string | null;
  onError: (error: string | null) => void;
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const stageFiles = (incoming: File[]) => {
    onError(null);
    if (files.length + incoming.length > MAX_FILE_COUNT) {
      onError(copy.files.tooMany);
      return;
    }

    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        onError(copy.files.tooLarge(file.name));
        return;
      }
      if (!ACCEPTED_FILE_TYPES.has(file.type)) {
        onError(copy.files.unsupported(file.name));
        return;
      }
    }

    const next = [...files];
    for (const file of incoming) {
      const duplicate = next.some(
        (item) =>
          item.name === file.name &&
          item.size === file.size &&
          item.lastModified === file.lastModified,
      );
      if (!duplicate) next.push(file);
    }
    onChange(next);
  };

  return (
    <section aria-labelledby="consultation-attachments-title">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/10'
            : 'border-primary/55 bg-primary/[0.025] hover:border-primary hover:bg-primary/[0.05]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) stageFiles(Array.from(event.dataTransfer.files));
        }}
        disabled={disabled}
        aria-describedby="consultation-attachments-hint"
      >
        <UploadCloud className="h-9 w-9 text-primary" aria-hidden />
        <span
          id="consultation-attachments-title"
          className="text-sm font-semibold text-foreground"
        >
          {copy.files.title}
        </span>
        <span
          id="consultation-attachments-hint"
          className="text-xs text-muted-foreground"
        >
          {copy.files.hint}
        </span>
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png"
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          stageFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5"
            >
              <FileText
                className="h-4 w-4 shrink-0 text-primary"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {file.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() =>
                  onChange(
                    files.filter(
                      (item) =>
                        !(
                          item.name === file.name &&
                          item.size === file.size &&
                          item.lastModified === file.lastModified
                        ),
                    ),
                  )
                }
                disabled={disabled}
                aria-label={copy.files.remove(file.name)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SlaRow({
  badge,
  title,
  description,
  tone,
}: {
  badge: string;
  title: string;
  description?: string;
  tone: 'warning' | 'info';
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-semibold',
            tone === 'warning'
              ? 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300'
              : 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
          )}
        >
          {badge}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      {description ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
