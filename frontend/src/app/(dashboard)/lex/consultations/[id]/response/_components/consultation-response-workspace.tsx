'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  RotateCcw,
  Scale,
  Send,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  StatusBadge,
  severityMap,
  type StatusTone,
} from '@/components/shared/status-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatBytes } from '@/lib/format';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  consultationsApi,
  type Consultation,
  type ConsultationApprovalTask,
  type ConsultationDocument,
  type ConsultationStatus,
  type RespondConsultationPayload,
} from '@/lib/lex/consultations';
import { showApiError } from '@/lib/toast';
import { useConsultationLabels } from '../../../_components/labels';
import { useConsultationResponseCopy } from './response-copy';

const STATUS_TONES: Record<ConsultationStatus, StatusTone> = {
  submitted: 'info',
  classified: 'pending',
  routed: 'info',
  responded: 'success',
  approved: 'primary',
  archived: 'neutral',
};

interface LegalReference {
  title: string;
  description?: string;
}

interface ConsultationResponseWorkspaceProps {
  consultation: Consultation;
  title: string;
  canWrite: boolean;
  canApprove: boolean;
  pendingApprovalTask?: ConsultationApprovalTask;
  approvalTasksLoading: boolean;
  responsePending: boolean;
  decisionPending: boolean;
  onSubmitResponse: (payload: RespondConsultationPayload) => void;
  onStartApproval: () => void;
  onApprove: (task: ConsultationApprovalTask, notes: string) => void;
  onRequestRevision: (
    task: ConsultationApprovalTask,
    notes: string,
  ) => void;
  onArchive: () => void;
}

export function ConsultationResponseWorkspace({
  consultation,
  title,
  canWrite,
  canApprove,
  pendingApprovalTask,
  approvalTasksLoading,
  responsePending,
  decisionPending,
  onSubmitResponse,
  onStartApproval,
  onApprove,
  onRequestRevision,
  onArchive,
}: ConsultationResponseWorkspaceProps) {
  const { locale } = useLocaleOrDefault();
  const copy = useConsultationResponseCopy();
  const labels = useConsultationLabels();
  const f = useLexFormat();
  const metadata = consultation.metadata ?? {};
  const references = useMemo(
    () => resolveLegalReferences(consultation),
    [consultation],
  );
  const remedy = metadataString(metadata, [
    'proposed_remedy',
    'recommended_action',
    'action_item',
    'recommendation',
  ]);
  const risk = metadataString(metadata, [
    'risk_assessment',
    'risk_exposure',
    'risk_summary',
  ]);
  const riskLevel = metadataString(metadata, [
    'risk_level',
    'exposure_level',
  ]);
  const advisorRole =
    metadataString(metadata, [
      'advisor_title',
      'lead_counsel_role',
      'responder_role',
    ]) || copy.advisorRoleFallback;
  const isRouted = consultation.status === 'routed';
  const responseRecorded = Boolean(consultation.response?.trim());
  const documents = consultation.documents ?? [];

  return (
    <section
      className="space-y-7 motion-safe:animate-fade-up [&_.text-muted-foreground]:!text-foreground/80"
      data-testid="consultation-response-workspace"
      aria-labelledby="consultation-response-title"
    >
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Button asChild variant="ghost" size="sm" className="-ms-3">
          <Link href={`/lex/consultations/${consultation.id}`}>
            <ArrowLeft
              className="me-1.5 h-4 w-4 rtl:-scale-x-100"
              aria-hidden
            />
            {copy.back}
          </Link>
        </Button>
        <ChevronRight
          className="h-3.5 w-3.5 rtl:-scale-x-100"
          aria-hidden
        />
        <span className="font-medium text-foreground">{copy.breadcrumb}</span>
      </nav>

      <Card className="overflow-hidden border-border/80 shadow-elevation-1">
        <CardContent className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant="secondary"
                className="border-info-200 bg-info-50 text-info-700"
              >
                {labels.filters.typeOptions[consultation.type]}
              </Badge>
              <span aria-hidden>•</span>
              <span>
                {copy.submitted}:{' '}
                {f.formatDate(consultation.created_at, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
            </div>
            <h1
              id="consultation-response-title"
              className="max-w-5xl text-h2 font-bold leading-tight tracking-tight text-foreground"
              dir="auto"
            >
              {title}{' '}
              <span className="whitespace-nowrap text-primary">
                ({consultation.consultation_number})
              </span>
            </h1>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <StatusBadge
              status={consultation.priority}
              map={severityMap}
              label={labels.filters.priorityOptions[consultation.priority]}
              size="md"
              className="text-foreground"
            />
            <StatusBadge
              status={consultation.status}
              label={labels.filters.statusOptions[consultation.status]}
              tone={STATUS_TONES[consultation.status]}
              icon={null}
              size="md"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.38fr)]">
        <OriginalRequestCard
          consultation={consultation}
          title={title}
          documents={documents}
        />

        <Card className="min-w-0 border-border/80 shadow-elevation-1">
          <CardHeader className="border-b border-border/70 px-5 py-5 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-11 w-11 border border-primary/20">
                  <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                    {initials(
                      consultation.advisor_name ||
                        copy.responseAuthorFallback,
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h2
                    className="truncate text-base font-semibold tracking-tight text-foreground"
                    dir="auto"
                  >
                    {consultation.advisor_name ||
                      copy.responseAuthorFallback}
                  </h2>
                  <p
                    className="mt-0.5 truncate text-xs text-muted-foreground"
                    dir="auto"
                  >
                    {advisorRole}
                  </p>
                </div>
              </div>

              {consultation.responded_at ? (
                <p className="shrink-0 text-sm text-muted-foreground">
                  {copy.resolved}:{' '}
                  <span className="font-medium text-foreground">
                    {f.formatDate(consultation.responded_at, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </span>
                </p>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="space-y-7 px-5 py-6 sm:px-8 sm:py-8">
            {isRouted && canWrite ? (
              <ResponseEditor
                consultation={consultation}
                responsePending={responsePending}
                onSubmitResponse={onSubmitResponse}
              />
            ) : responseRecorded ? (
              <RecordedResponse
                response={consultation.response ?? ''}
                references={references}
                remedy={remedy}
                risk={risk}
                riskLevel={riskLevel}
                lateJustification={consultation.late_justification}
              />
            ) : (
              <UnavailableResponse consultation={consultation} />
            )}

            <ResponseActions
              consultation={consultation}
              canWrite={canWrite}
              canApprove={canApprove}
              pendingApprovalTask={pendingApprovalTask}
              approvalTasksLoading={approvalTasksLoading}
              decisionPending={decisionPending}
              onStartApproval={onStartApproval}
              onApprove={onApprove}
              onRequestRevision={onRequestRevision}
              onArchive={onArchive}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function OriginalRequestCard({
  consultation,
  title,
  documents,
}: {
  consultation: Consultation;
  title: string;
  documents: ConsultationDocument[];
}) {
  const copy = useConsultationResponseCopy();

  return (
    <Card className="border-border/80 shadow-elevation-1 lg:sticky lg:top-6">
      <CardHeader className="border-b border-border/70">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {copy.originalRequest}
        </h2>
      </CardHeader>
      <CardContent className="space-y-6 p-5 sm:p-6">
        <RequestField label={copy.requester}>
          <span dir="auto">{consultation.requester_name}</span>
          {consultation.department ? (
            <span
              className="ms-1 text-sm font-normal text-muted-foreground"
              dir="auto"
            >
              ({consultation.department})
            </span>
          ) : null}
        </RequestField>

        <RequestField label={copy.subjectTopic}>
          <span dir="auto">{title}</span>
        </RequestField>

        <RequestField label={copy.inquiryDetails}>
          <p
            className="whitespace-pre-wrap text-sm font-normal leading-6 text-foreground"
            dir="auto"
          >
            {consultation.question}
          </p>
        </RequestField>

        <RequestField label={copy.attachedDrafts}>
          {documents.length === 0 ? (
            <p className="text-sm font-normal leading-6 text-muted-foreground">
              {copy.noDocuments}
            </p>
          ) : (
            <ul className="space-y-2">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5"
                >
                  <FileText
                    className="h-5 w-5 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm font-medium"
                      dir="auto"
                    >
                      {document.file_name}
                    </span>
                    <span className="block text-xs font-normal text-foreground/80">
                      {formatBytes(document.file_size)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RequestField>
      </CardContent>
    </Card>
  );
}

function RequestField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm font-semibold text-foreground">{children}</div>
    </div>
  );
}

function ResponseEditor({
  consultation,
  responsePending,
  onSubmitResponse,
}: {
  consultation: Consultation;
  responsePending: boolean;
  onSubmitResponse: (payload: RespondConsultationPayload) => void;
}) {
  const { locale } = useLocaleOrDefault();
  const copy = useConsultationResponseCopy();
  const [response, setResponse] = useState(consultation.response ?? '');
  const [fromAi, setFromAi] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [lateJustification, setLateJustification] = useState('');

  useEffect(() => {
    setResponse(consultation.response ?? '');
    setFromAi(false);
    setAttempted(false);
    setLateJustification('');
  }, [consultation.id, consultation.response]);

  const draftMutation = useMutation({
    mutationFn: () =>
      consultationsApi.draftResponse(consultation.id, { locale }),
    onSuccess: (result) => {
      setResponse(result.draft);
      setFromAi(true);
    },
    onError: showApiError,
  });

  const isLate = Boolean(
    consultation.sla_response_due_at &&
      Date.now() > new Date(consultation.sla_response_due_at).getTime(),
  );
  const responseValid = Boolean(response.trim());
  const valid = responseValid && (!isLate || Boolean(lateJustification.trim()));

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!valid) return;
        onSubmitResponse({
          response: response.trim(),
          use_ai: false,
          notes: '',
          ...(isLate ? { late_justification: lateJustification.trim() } : {}),
        });
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {copy.responseDraft}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {copy.responseDraftDescription}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draftMutation.isPending || responsePending}
          onClick={() => draftMutation.mutate()}
        >
          {draftMutation.isPending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {draftMutation.isPending ? copy.drafting : copy.draftWithAi}
        </Button>
      </div>

      {fromAi ? (
        <Badge variant="secondary" className="w-fit text-primary">
          <Sparkles className="me-1 h-3 w-3" aria-hidden />
          {copy.aiGenerated}
        </Badge>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="consultation-response">{copy.responseLabel}</Label>
        <Textarea
          id="consultation-response"
          value={response}
          onChange={(event) => {
            setResponse(event.target.value);
            setFromAi(false);
          }}
          placeholder={copy.responsePlaceholder}
          rows={15}
          aria-invalid={attempted && !responseValid}
          aria-describedby={
            attempted && !responseValid ? 'consultation-response-error' : undefined
          }
          disabled={responsePending}
          className="min-h-72 resize-y leading-6"
          dir="auto"
        />
        {attempted && !responseValid ? (
          <p
            id="consultation-response-error"
            className="text-sm text-destructive"
          >
            {copy.responseRequired}
          </p>
        ) : null}
      </div>

      {isLate ? (
        <div className="space-y-2 rounded-xl border border-warning-300 bg-warning-50/60 p-4 dark:bg-warning-700/10">
          <Label htmlFor="consultation-late-justification">
            {locale === 'ar' ? 'مبرر تجاوز اتفاقية مستوى الخدمة' : 'Late SLA justification'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="consultation-late-justification"
            value={lateJustification}
            onChange={(event) => setLateJustification(event.target.value)}
            rows={4}
            placeholder={locale === 'ar' ? 'اشرح سبب تسجيل الرد بعد الموعد المحدد.' : 'Explain why the response was recorded after its SLA deadline.'}
            disabled={responsePending}
            dir="auto"
          />
          {attempted && !lateJustification.trim() ? (
            <p className="text-sm text-destructive">
              {locale === 'ar' ? 'المبرر مطلوب.' : 'A late justification is required.'}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {locale === 'ar'
              ? 'يظهر فقط لمدير الإدارة القانونية ومدير العقود.'
              : 'Visible only to the Legal Director and Contracts Manager.'}
          </p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!valid || responsePending}>
          {responsePending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {responsePending ? copy.submitting : copy.submitResponse}
        </Button>
      </div>
    </form>
  );
}

function RecordedResponse({
  response,
  references,
  remedy,
  risk,
  riskLevel,
  lateJustification,
}: {
  response: string;
  references: LegalReference[];
  remedy: string;
  risk: string;
  riskLevel: string;
  lateJustification?: string | null;
}) {
  const copy = useConsultationResponseCopy();

  return (
    <article className="space-y-7">
      <section>
        <h2 className="mb-3 text-lg font-bold text-foreground">
          {copy.legalOpinion}
        </h2>
        <ResponseMarkdown value={response} />
      </section>

      {lateJustification ? (
        <section className="rounded-xl border border-warning-300 bg-warning-50/60 p-4 dark:bg-warning-700/10">
          <h3 className="font-semibold text-warning-800 dark:text-warning-200">
            Late SLA justification
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm" dir="auto">{lateJustification}</p>
        </section>
      ) : null}

      {risk ? (
        <section className="rounded-xl border border-warning-300 bg-warning-50/70 p-4 dark:bg-warning-700/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-warning-700"
              aria-hidden
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-warning-800 dark:text-warning-200">
                  {copy.riskAssessment}
                </h3>
                {riskLevel ? (
                  <StatusBadge
                    status={riskLevel}
                    label={titleCase(riskLevel)}
                    tone={riskTone(riskLevel)}
                    icon={null}
                    size="sm"
                    className="text-foreground"
                  />
                ) : null}
              </div>
              <p
                className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/85"
                dir="auto"
              >
                {risk}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-bold text-foreground">
          {copy.references}
        </h2>
        {references.length === 0 ? (
          <p className="rounded-xl border border-border/70 bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
            {copy.noReferences}
          </p>
        ) : (
          <div className="space-y-3">
            {references.map((reference, index) => (
              <div
                key={`${reference.title}-${index}`}
                className="rounded-xl border border-border/70 bg-muted/25 p-4"
              >
                <p className="font-semibold text-primary" dir="auto">
                  {reference.title}
                </p>
                {reference.description ? (
                  <p
                    className="mt-1 text-sm leading-6 text-foreground/80"
                    dir="auto"
                  >
                    {reference.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-info-300 bg-info-50 p-5 dark:bg-info-700/10">
        <h2 className="font-bold text-info-700 dark:text-info-200">
          {copy.proposedRemedy}
        </h2>
        <p
          className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground"
          dir="auto"
        >
          {remedy || copy.noRemedy}
        </p>
      </section>
    </article>
  );
}

function ResponseMarkdown({ value }: { value: string }) {
  return (
    <div className="text-sm leading-6 text-foreground" dir="auto">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h3 className="mb-2 mt-6 text-lg font-bold first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-6 border-s-4 border-brand-gold ps-3 text-base font-bold first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-2 mt-5 font-bold first:mt-0">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="mb-4 whitespace-pre-line text-foreground last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-4 space-y-1.5 ps-5 [&>li]:list-disc">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-4 space-y-1.5 ps-5 [&>li]:list-decimal">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="ps-1 marker:text-primary">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-xl border-s-4 border-primary bg-primary/[0.05] px-4 py-3">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function UnavailableResponse({
  consultation,
}: {
  consultation: Consultation;
}) {
  const copy = useConsultationResponseCopy();
  const earlierStage =
    consultation.status === 'submitted' || consultation.status === 'classified';

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
      <Scale
        className="mx-auto h-8 w-8 text-muted-foreground"
        aria-hidden
      />
      <h2 className="mt-3 font-semibold text-foreground">
        {copy.responseNotRecorded}
      </h2>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
        {earlierStage
          ? copy.earlierStage
          : copy.responseNotRecordedDescription}
      </p>
      <Button asChild variant="outline" className="mt-5">
        <Link href={`/lex/consultations/${consultation.id}`}>
          {copy.openDetail}
        </Link>
      </Button>
    </div>
  );
}

function ResponseActions({
  consultation,
  canWrite,
  canApprove,
  pendingApprovalTask,
  approvalTasksLoading,
  decisionPending,
  onStartApproval,
  onApprove,
  onRequestRevision,
  onArchive,
}: {
  consultation: Consultation;
  canWrite: boolean;
  canApprove: boolean;
  pendingApprovalTask?: ConsultationApprovalTask;
  approvalTasksLoading: boolean;
  decisionPending: boolean;
  onStartApproval: () => void;
  onApprove: (task: ConsultationApprovalTask, notes: string) => void;
  onRequestRevision: (
    task: ConsultationApprovalTask,
    notes: string,
  ) => void;
  onArchive: () => void;
}) {
  const copy = useConsultationResponseCopy();
  const [notes, setNotes] = useState('');
  const [revisionOpen, setRevisionOpen] = useState(false);

  if (consultation.status === 'routed') return null;

  if (consultation.status === 'submitted' || consultation.status === 'classified') {
    return null;
  }

  if (consultation.status === 'archived') {
    return <ActionNotice icon={Archive} text={copy.archived} />;
  }

  if (consultation.status === 'approved') {
    if (!canWrite) {
      return <ActionNotice icon={CheckCircle2} text={copy.readOnly} />;
    }
    return (
      <div className="border-t border-border pt-6">
        <div className="flex flex-col gap-4 rounded-xl border border-primary/25 bg-primary/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
          <ActionNotice
            icon={CheckCircle2}
            text={
              consultation.legal_hold
                ? copy.holdBlocked
                : copy.approved
            }
            bare
          />
          <WithTooltip
            content={
              consultation.legal_hold ? copy.holdBlocked : undefined
            }
            wrapDisabled={consultation.legal_hold}
          >
            <Button
              type="button"
              variant="outline"
              disabled={consultation.legal_hold}
              onClick={onArchive}
            >
              <Archive className="me-1.5 h-4 w-4" aria-hidden />
              {copy.archive}
            </Button>
          </WithTooltip>
        </div>
      </div>
    );
  }

  if (approvalTasksLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border pt-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {copy.approvalLoading}
      </div>
    );
  }

  if (pendingApprovalTask && canApprove) {
    return (
      <>
        <section className="space-y-4 border-t border-border pt-6">
          <div className="space-y-2">
            <Label htmlFor="consultation-response-decision-notes">
              {copy.approvalNotes}
            </Label>
            <Textarea
              id="consultation-response-decision-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={copy.approvalNotesPlaceholder}
              rows={3}
              disabled={decisionPending}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              size="lg"
              disabled={decisionPending}
              onClick={() => onApprove(pendingApprovalTask, notes)}
            >
              {decisionPending ? (
                <Loader2
                  className="me-1.5 h-4 w-4 animate-spin"
                  aria-hidden
                />
              ) : (
                <CheckCircle2
                  className="me-1.5 h-4 w-4"
                  aria-hidden
                />
              )}
              {decisionPending ? copy.approving : copy.approve}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={decisionPending}
              onClick={() => setRevisionOpen(true)}
            >
              <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
              {copy.requestRevision}
            </Button>
          </div>
        </section>

        <ConfirmDialog
          open={revisionOpen}
          onOpenChange={setRevisionOpen}
          title={copy.requestRevisionTitle}
          description={copy.requestRevisionDescription}
          confirmLabel={copy.requestRevisionConfirm}
          variant="destructive"
          loading={decisionPending}
          onConfirm={async () => {
            onRequestRevision(pendingApprovalTask, notes);
          }}
        />
      </>
    );
  }

  if (!pendingApprovalTask && canApprove && !consultation.workflow_instance_id) {
    return (
      <div className="border-t border-border pt-6">
        <div className="flex flex-col gap-4 rounded-xl border border-primary/25 bg-primary/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
          <ActionNotice icon={Send} text={copy.approvalRequired} bare />
          <Button type="button" onClick={onStartApproval}>
            <Send className="me-1.5 h-4 w-4" aria-hidden />
            {copy.forwardApproval}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-6">
      <ActionNotice
        icon={ShieldAlert}
        text={canApprove ? copy.awaitingApproval : copy.readOnly}
      />
    </div>
  );
}

function ActionNotice({
  icon: Icon,
  text,
  bare = false,
}: {
  icon: LucideIcon;
  text: string;
  bare?: boolean;
}) {
  return (
    <div
      className={
        bare
          ? 'flex min-w-0 items-center gap-3'
          : 'flex items-center gap-3 rounded-xl bg-muted/35 p-4'
      }
    >
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <p className="text-sm font-medium leading-6 text-foreground">{text}</p>
    </div>
  );
}

function metadataString(
  metadata: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function resolveLegalReferences(
  consultation: Consultation,
): LegalReference[] {
  const metadata = consultation.metadata ?? {};
  const values = [
    metadata.legal_references,
    metadata.referenced_precedents,
    metadata.precedents,
    metadata.authorities,
  ];

  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const references = value.flatMap<LegalReference>((item) => {
      if (typeof item === 'string' && item.trim()) {
        return [{ title: item.trim() }];
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const title = metadataString(record, [
        'title',
        'name',
        'citation',
        'reference',
      ]);
      if (!title) return [];
      const description = metadataString(record, [
        'description',
        'summary',
        'note',
        'holding',
      ]);
      return [{ title, description: description || undefined }];
    });
    if (references.length > 0) return references;
  }

  return (consultation.documents ?? [])
    .filter((document) =>
      /(precedent|reference|authority|statute)/i.test(document.kind),
    )
    .map((document) => ({
      title: document.file_name,
    }));
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function riskTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (/(critical|severe|extreme)/.test(normalized)) return 'critical';
  if (/(high|major)/.test(normalized)) return 'danger';
  if (/(medium|moderate|warning)/.test(normalized)) return 'warning';
  if (/(low|minor)/.test(normalized)) return 'info';
  return 'neutral';
}
