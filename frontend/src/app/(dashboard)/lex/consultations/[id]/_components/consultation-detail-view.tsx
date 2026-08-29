'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  FileText,
  Link2,
  Paperclip,
  Plus,
  Printer,
  Scale,
  Trash2,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import {
  StatusBadge,
  severityMap,
  type StatusTone,
} from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatBytes } from '@/lib/format';
import { useLexFormat } from '@/lib/lex/ksa';
import type {
  Consultation,
  ConsultationAuditEntry,
  ConsultationDocument,
  ConsultationStatus,
} from '@/lib/lex/consultations';
import { ConsultationAuditTimeline } from '../../_components/consultation-audit-timeline';
import { useConsultationLabels } from '../../_components/labels';
import { ConsultationSlaRibbon } from './consultation-sla-ribbon';

const COPY = {
  en: {
    back: 'Back to consultations',
    print: 'Print consultation',
    responseDate: 'Response date',
    submittedDate: 'Submitted',
    originalRequest: 'Original request information',
    requesterPrefix: 'Requester',
    question: 'Legal question',
    sourceRequest: 'Source legal request',
    officialOpinion: 'Official legal opinion',
    pendingOpinion: 'The legal opinion has not been recorded yet.',
    pendingOpinionDescription:
      'The consultation remains in progress. Use the next-action panel to continue its workflow.',
    responseMetadata: 'Response metadata',
    leadCounsel: 'Lead counsel',
    timeSpent: 'Time spent',
    confidence: 'Confidence level',
    notRecorded: 'Not recorded',
    referencedPrecedents: 'Referenced precedents',
    noPrecedents: 'No precedents have been recorded for this response.',
    supportingDocuments: 'Supporting documents',
    noDocuments: 'No supporting documents are attached.',
    attachDocument: 'Attach document',
    riskAssessment: 'Risk assessment and exposure',
    hours: 'hours',
  },
  ar: {
    back: 'العودة إلى الاستشارات',
    print: 'طباعة الاستشارة',
    responseDate: 'تاريخ الرد',
    submittedDate: 'تاريخ التقديم',
    originalRequest: 'معلومات الطلب الأصلي',
    requesterPrefix: 'مقدّم الطلب',
    question: 'المسألة القانونية',
    sourceRequest: 'الطلب القانوني المرتبط',
    officialOpinion: 'الرأي القانوني الرسمي',
    pendingOpinion: 'لم يُسجَّل الرأي القانوني بعد.',
    pendingOpinionDescription:
      'لا تزال الاستشارة قيد المعالجة. استخدم لوحة الإجراء التالي لمتابعة سير العمل.',
    responseMetadata: 'بيانات الرد',
    leadCounsel: 'المستشار المسؤول',
    timeSpent: 'الوقت المستغرق',
    confidence: 'مستوى الثقة',
    notRecorded: 'غير مسجّل',
    referencedPrecedents: 'السوابق المشار إليها',
    noPrecedents: 'لم تُسجَّل سوابق قضائية لهذا الرد.',
    supportingDocuments: 'المستندات الداعمة',
    noDocuments: 'لا توجد مستندات داعمة مرفقة.',
    attachDocument: 'إرفاق مستند',
    riskAssessment: 'تقييم المخاطر والتعرّض',
    hours: 'ساعة',
  },
} as const;

const STATUS_TONES: Record<ConsultationStatus, StatusTone> = {
  submitted: 'info',
  classified: 'pending',
  routed: 'info',
  responded: 'success',
  approved: 'primary',
  archived: 'neutral',
};

interface ConsultationDetailViewProps {
  consultation: Consultation;
  title: string;
  typeLabel: string;
  audit: ConsultationAuditEntry[];
  auditLoading: boolean;
  canWrite: boolean;
  onHold: boolean;
  holdReason?: string;
  onAttachDocument: () => void;
  onRemoveDocument: (document: ConsultationDocument) => void;
  headerActions?: ReactNode;
  actionPanel: ReactNode;
}

export function ConsultationDetailView({
  consultation,
  title,
  typeLabel,
  audit,
  auditLoading,
  canWrite,
  onHold,
  holdReason,
  onAttachDocument,
  onRemoveDocument,
  headerActions,
  actionPanel,
}: ConsultationDetailViewProps) {
  const { locale, direction } = useLocaleOrDefault();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const labels = useConsultationLabels();
  const f = useLexFormat();
  const documents = consultation.documents ?? [];
  const precedents = resolvePrecedents(consultation);
  const metadata = consultation.metadata ?? {};
  const confidence = metadataString(metadata, [
    'confidence_level',
    'confidence',
  ]);
  const riskAssessment = metadataString(metadata, [
    'risk_assessment',
    'risk_exposure',
    'risk_summary',
  ]);
  const riskLevel = metadataString(metadata, ['risk_level', 'exposure_level']);
  const timeSpent = resolveTimeSpent(
    consultation,
    copy.hours,
    copy.notRecorded,
  );

  return (
    <div
      className="space-y-6 motion-safe:animate-fade-up"
      dir={direction}
      lang={locale}
      data-testid="consultation-detail-view"
    >
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
            <Link href="/lex/consultations">
              <ArrowLeft
                className="me-1.5 h-4 w-4 rtl:-scale-x-100"
                aria-hidden
              />
              {copy.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="text-h2 font-bold leading-tight tracking-tight text-foreground"
              dir="auto"
            >
              <span className="text-primary">
                {consultation.consultation_number}:
              </span>{' '}
              {title}
            </h1>
            <StatusBadge
              status={consultation.status}
              label={labels.filters.statusOptions[consultation.status]}
              tone={STATUS_TONES[consultation.status]}
              icon={null}
              size="md"
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {consultation.responded_at ? copy.responseDate : copy.submittedDate}
            :{' '}
            <span className="font-medium text-foreground">
              {f.formatDual(
                consultation.responded_at ?? consultation.created_at,
              )}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={copy.print}
            title={copy.print}
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,0.72fr)]">
        <section
          className="min-w-0 space-y-6"
          aria-label={copy.officialOpinion}
        >
          <details className="group card overflow-hidden" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-2.5">
                <FileText
                  className="h-5 w-5 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="font-semibold text-foreground">
                  {copy.originalRequest}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                  {copy.requesterPrefix}:{' '}
                  <span className="font-medium text-foreground" dir="auto">
                    {consultation.requester_name}
                  </span>
                </span>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast group-open:rotate-180"
                  aria-hidden
                />
              </span>
            </summary>

            <div className="space-y-5 border-t border-border/70 px-5 py-5 sm:px-6">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetadataField
                  label={labels.detail.metadata.requester}
                  value={consultation.requester_name}
                />
                <MetadataField
                  label={labels.detail.metadata.department}
                  value={consultation.department || labels.detail.notSet}
                />
                <MetadataField
                  label={labels.detail.metricType}
                  value={typeLabel}
                />
                <MetadataField
                  label={labels.filters.priority}
                  value={
                    <StatusBadge
                      status={consultation.priority}
                      map={severityMap}
                      label={
                        labels.filters.priorityOptions[consultation.priority]
                      }
                      icon={null}
                      size="sm"
                    />
                  }
                />
              </dl>

              <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
                <p className="text-xs font-semibold uppercase tracking-caps-wide text-primary">
                  {copy.question}
                </p>
                <p
                  className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground"
                  dir="auto"
                >
                  {consultation.question}
                </p>
              </div>

              {consultation.legal_request_id ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link2
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-muted-foreground">
                    {copy.sourceRequest}:
                  </span>
                  <Link
                    href={`/lex/service-desk/${consultation.legal_request_id}`}
                    className="inline-flex items-center gap-1 font-mono text-xs font-medium text-primary hover:underline"
                    dir="ltr"
                  >
                    {consultation.legal_request_id}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              ) : null}

              {consultation.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {consultation.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="border-t border-border/70 pt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Paperclip className="h-4 w-4 text-primary" aria-hidden />
                    {copy.supportingDocuments}
                  </h2>
                  {canWrite ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onAttachDocument}
                    >
                      <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
                      {copy.attachDocument}
                    </Button>
                  ) : null}
                </div>

                {documents.length === 0 ? (
                  <p className="rounded-xl bg-muted/40 px-4 py-5 text-center text-sm text-foreground">
                    {copy.noDocuments}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {documents.map((document) => (
                      <div
                        key={document.id}
                        className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <FileText className="h-4 w-4" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p
                              className="truncate text-sm font-medium text-foreground"
                              dir="auto"
                            >
                              {document.file_name}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {document.kind} ·{' '}
                              {formatBytes(document.file_size)} ·{' '}
                              {f.formatDual(document.created_at)}
                            </p>
                          </div>
                        </div>
                        {canWrite ? (
                          <WithTooltip
                            content={holdReason}
                            wrapDisabled={onHold}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={onHold}
                              onClick={() => onRemoveDocument(document)}
                              aria-label={`${labels.detail.delete}: ${document.file_name}`}
                            >
                              <Trash2
                                className="me-1.5 h-3.5 w-3.5"
                                aria-hidden
                              />
                              {labels.detail.delete}
                            </Button>
                          </WithTooltip>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </details>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Scale className="h-5 w-5 text-primary" aria-hidden />
                {copy.officialOpinion}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {consultation.response ? (
                <div
                  className="consultation-opinion max-w-none text-sm leading-7 text-foreground"
                  dir="auto"
                >
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => (
                        <h2 className="mb-3 mt-7 border-s-4 border-brand-gold ps-3 text-lg font-bold first:mt-0">
                          {children}
                        </h2>
                      ),
                      h2: ({ children }) => (
                        <h2 className="mb-3 mt-7 border-s-4 border-brand-gold ps-3 text-base font-bold first:mt-0">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="mb-2 mt-6 text-sm font-bold text-foreground">
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => (
                        <p className="mb-4 whitespace-pre-line text-muted-foreground last:mb-0">
                          {children}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className="mb-4 space-y-2 ps-5 [&>li]:list-disc">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="mb-4 space-y-2 ps-5 [&>li]:list-decimal">
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className="ps-1 text-muted-foreground marker:text-primary">
                          {children}
                        </li>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="my-4 rounded-xl border-s-4 border-primary bg-primary/[0.05] px-4 py-3">
                          {children}
                        </blockquote>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-foreground">
                          {children}
                        </strong>
                      ),
                    }}
                  >
                    {consultation.response}
                  </ReactMarkdown>
                </div>
              ) : (
                <EmptyState
                  icon={Scale}
                  title={copy.pendingOpinion}
                  description={copy.pendingOpinionDescription}
                  size="compact"
                />
              )}

              {riskAssessment ? (
                <div className="mt-6 rounded-xl border border-warning-400/70 bg-warning-50 p-4 dark:bg-warning-700/10">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    {riskLevel ? (
                      <StatusBadge
                        status={riskLevel}
                        label={titleCase(riskLevel)}
                        tone={riskTone(riskLevel)}
                        icon={null}
                        className="shrink-0"
                      />
                    ) : null}
                    <div>
                      <p className="text-sm font-semibold text-warning-800 dark:text-warning-200">
                        {copy.riskAssessment}
                      </p>
                      <p
                        className="mt-1 text-sm leading-6 text-warning-800/90 dark:text-warning-200/90"
                        dir="auto"
                      >
                        {riskAssessment}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <ConsultationAuditTimeline entries={audit} loading={auditLoading} />
        </section>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">{copy.responseMetadata}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <SidebarMetadata
                  label={copy.leadCounsel}
                  value={
                    consultation.advisor_name ||
                    consultation.responded_by ||
                    copy.notRecorded
                  }
                />
                <SidebarMetadata label={copy.timeSpent} value={timeSpent} />
                <SidebarMetadata
                  label={copy.confidence}
                  value={
                    confidence ? (
                      <StatusBadge
                        status={confidence}
                        label={titleCase(confidence)}
                        tone={confidenceTone(confidence)}
                        icon={null}
                        size="sm"
                      />
                    ) : (
                      copy.notRecorded
                    )
                  }
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">
                {copy.referencedPrecedents}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {precedents.length === 0 ? (
                <p className="rounded-xl bg-muted/40 px-4 py-5 text-center text-sm leading-6 text-foreground">
                  {copy.noPrecedents}
                </p>
              ) : (
                <div className="space-y-3">
                  {precedents.map((precedent, index) => (
                    <div
                      key={`${precedent.title}-${index}`}
                      className="rounded-xl bg-muted/45 p-4"
                    >
                      <p
                        className="text-sm font-semibold text-primary"
                        dir="auto"
                      >
                        {precedent.title}
                      </p>
                      {precedent.description ? (
                        <p
                          className="mt-1 text-xs leading-5 text-muted-foreground"
                          dir="auto"
                        >
                          {precedent.description}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <ConsultationSlaRibbon consultation={consultation} />
          <div>{actionPanel}</div>
        </aside>
      </div>
    </div>
  );
}

function MetadataField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold text-foreground" dir="auto">
        {value}
      </dd>
    </div>
  );
}

function SidebarMetadata({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-end text-sm font-semibold text-foreground" dir="auto">
        {value}
      </dd>
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
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return '';
}

function resolveTimeSpent(
  consultation: Consultation,
  hoursLabel: string,
  fallback: string,
): string {
  const metadata = consultation.metadata ?? {};
  const explicit = metadataString(metadata, [
    'time_spent_hours',
    'hours_spent',
    'time_spent',
  ]);
  if (explicit) {
    const normalized = Number(explicit);
    return Number.isFinite(normalized)
      ? `${normalized} ${hoursLabel}`
      : explicit;
  }
  return fallback;
}

interface Precedent {
  title: string;
  description?: string;
}

function resolvePrecedents(consultation: Consultation): Precedent[] {
  const metadata = consultation.metadata ?? {};
  const raw =
    metadata.referenced_precedents ??
    metadata.precedents ??
    metadata.legal_references ??
    metadata.authorities;
  const out: Precedent[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) {
        out.push({ title: item.trim() });
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const title = metadataString(record, [
          'title',
          'name',
          'citation',
          'reference',
        ]);
        const description = metadataString(record, [
          'description',
          'summary',
          'holding',
          'note',
        ]);
        if (title) out.push({ title, description: description || undefined });
      }
    }
  } else if (typeof raw === 'string') {
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim()) out.push({ title: line.trim() });
    }
  }

  for (const document of consultation.documents ?? []) {
    const kind = document.kind.toLowerCase();
    if (
      kind.includes('precedent') ||
      kind.includes('reference') ||
      kind.includes('authority')
    ) {
      out.push({ title: document.file_name, description: document.kind });
    }
  }

  return out;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function confidenceTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (normalized.includes('high')) return 'success';
  if (normalized.includes('medium') || normalized.includes('moderate'))
    return 'warning';
  if (normalized.includes('low')) return 'danger';
  return 'neutral';
}

function riskTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (normalized.includes('critical') || normalized.includes('high'))
    return 'danger';
  if (normalized.includes('medium') || normalized.includes('moderate'))
    return 'warning';
  if (normalized.includes('low')) return 'success';
  return 'neutral';
}
