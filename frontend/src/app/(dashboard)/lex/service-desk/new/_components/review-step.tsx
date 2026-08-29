'use client';

/**
 * ReviewStep — the read-only Review & Submit surface (step 4) of the "New Legal
 * Service Request" wizard, restyled to the step-4 mockup.
 *
 * Layout: a two-column grid inside the review body.
 *   - LEFT (main): a "Request Information" sub-card (uppercase eyebrow labels for
 *     Service Type / Requesting Department / Request Title / Description &
 *     Objective / SLA Priority Group with a colored tier dot / Target Due Date),
 *     each with an inline "Edit" jump-back; then an "Attached Supporting Documents
 *     (N files)" sub-card.
 *   - RIGHT (aside): the "SLA Target Delivery" card (<SlaPromisePreview />)
 *     stacked ABOVE the REQUIRED attestation checkbox (the final submit gate),
 *     per the step-4 mockup.
 *
 * Step mapping for the inline Edit affordance (4-step wizard):
 *   service → 1, requesting department / all details → 2, attachments → 3.
 *
 * Bilingual EN/AR with logical-direction CSS only (Arabic-RTL is the app default);
 * new copy lives in the step-local `STEP4_COPY` object per the wizard i18n rule.
 */
import { type ReactNode } from 'react';
import { FileText, Pencil, ShieldCheck } from 'lucide-react';
import {
  type RequestPriority,
  type ServiceCatalogEntry,
} from '@/lib/lex/requests';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/suites/section-card';
import { cn } from '@/lib/utils';
import { reviewStrings } from '../_lib/review-i18n';
import { useServiceSlaTargets } from '../_lib/service-sla';
import type { StagedAttachment } from '../_lib/attachments-types';
import SlaPromisePreview from './sla-promise-preview';

/** Wizard step indices this surface can jump back to (mirrors page.tsx). */
type WizardStep = 1 | 2 | 3;

export interface ReviewStepProps {
  service?: ServiceCatalogEntry;
  titleEn: string;
  titleAr: string;
  description: string;
  requesterName: string;
  beneficiaryName?: string;
  priority: RequestPriority;
  urgency?: string;
  notes?: string;
  /** Locale-formatted requested due date (already formatted by the container). */
  requestedDueDate?: string;
  attachments?: StagedAttachment[];
  confirmed: boolean;
  onConfirmChange: (value: boolean) => void;
  confirmError?: string;
  onEditStep: (step: WizardStep) => void;
}

/**
 * Step-4-specific bilingual copy. Kept local so this file owns its strings and
 * never collides with the shared `labels.ts` / `review-i18n.ts` bundles. Arabic is
 * Modern Standard Arabic (flag for the localization/termbase gate).
 */
const STEP4_COPY = {
  en: {
    heading: 'Review Your Legal Service Request',
    subheading:
      'Please verify all specifications and attachments before finalizing the submission.',
    requestInfo: 'Request Information',
    attachedDocs: (count: string, single: boolean) =>
      `Attached Supporting Documents (${count} ${single ? 'file' : 'files'})`,
    labelService: 'Service Type',
    labelDepartment: 'Requesting Department',
    labelTitle: 'Request Title',
    labelDescription: 'Description and Objective',
    labelPriority: 'SLA Priority Group',
    labelDueDate: 'Target Due Date',
    labelUrgency: 'Urgency Justification',
    labelNotes: 'Additional Notes',
    businessDays: (window: string, single: boolean) =>
      `${window} Business ${single ? 'Day' : 'Days'}`,
    noFiles: 'No supporting documents attached.',
    confirmationTitle: 'Confirmation',
    required: 'Required',
    attestation:
      'I confirm that all provided details and attachments are accurate and that I agree to WatheeqTech legal service guidelines and internal policy terms.',
  },
  ar: {
    heading: 'راجع طلب الخدمة القانونية',
    subheading: 'يرجى التحقق من جميع المواصفات والمرفقات قبل إتمام الإرسال.',
    requestInfo: 'معلومات الطلب',
    attachedDocs: (count: string, single: boolean) =>
      `المستندات الداعمة المرفقة (${count} ${single ? 'ملف' : 'ملفات'})`,
    labelService: 'نوع الخدمة',
    labelDepartment: 'الإدارة الطالبة',
    labelTitle: 'عنوان الطلب',
    labelDescription: 'وصف الطلب والهدف',
    labelPriority: 'فئة أولوية الخدمة',
    labelDueDate: 'تاريخ الاستحقاق المستهدف',
    labelUrgency: 'مبرّر الاستعجال',
    labelNotes: 'ملاحظات إضافية',
    businessDays: (window: string, single: boolean) =>
      `${window} ${single ? 'يوم عمل' : 'أيام عمل'}`,
    noFiles: 'لا توجد مستندات داعمة مرفقة.',
    confirmationTitle: 'الإقرار',
    required: 'مطلوب',
    attestation:
      'أقر بأن جميع البيانات والمرفقات المقدمة صحيحة، وأوافق على إرشادات الخدمة القانونية وشروط السياسة الداخلية لواثق تِك.',
  },
} as const;

/** Priority tier → colored dot (matches the segmented Priority selector tones). */
const PRIORITY_DOT: Record<RequestPriority, string> = {
  normal: 'bg-success-500',
  urgent: 'bg-warning-500',
  emergency: 'bg-error-500',
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default function ReviewStep({
  service,
  titleEn,
  titleAr,
  description,
  requesterName,
  beneficiaryName,
  priority,
  urgency,
  notes,
  requestedDueDate,
  attachments,
  confirmed,
  onConfirmChange,
  confirmError,
  onEditStep,
}: ReviewStepProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = reviewStrings(locale);
  const c = locale === 'ar' ? STEP4_COPY.ar : STEP4_COPY.en;

  const serviceName = service ? resolveLocalized(service.name, locale) : '';
  const primaryTitle = locale === 'ar' ? titleAr || titleEn : titleEn || titleAr;
  const secondaryTitle = locale === 'ar' ? titleEn : titleAr;
  const primaryTitleDir = locale === 'ar' ? (titleAr ? 'rtl' : 'ltr') : titleEn ? 'ltr' : 'rtl';

  const files = attachments ?? [];
  const count = files.length;

  const priorityLabel =
    priority === 'emergency'
      ? t.priorityEmergency
      : priority === 'urgent'
        ? t.priorityUrgent
        : t.priorityNormal;

  // Real SLA turnaround days for the chosen service + priority (fail-soft: a
  // requester without admin perms gets an empty map, so the "(N Business Days)"
  // suffix is simply omitted rather than blocking).
  const { slaByCode } = useServiceSlaTargets();
  const slaDays = service?.code ? slaByCode.get(service.code) : undefined;
  const turnaroundDays = slaDays
    ? (slaDays as unknown as Partial<Record<RequestPriority, number>>)[priority]
    : undefined;
  const prioritySlaText =
    typeof turnaroundDays === 'number'
      ? c.businessDays(f.formatNumber(turnaroundDays), turnaroundDays === 1)
      : undefined;

  return (
    <div className="space-y-5">
      {/* Review heading */}
      <header>
        <h2 className="text-lg font-semibold text-foreground">{c.heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{c.subheading}</p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* LEFT — main summary */}
        <div className="space-y-5 lg:col-span-2">
          {/* Request Information */}
          <SectionCard title={c.requestInfo} className="border-border/70 shadow-elevation-1">
            <dl className="divide-y divide-border/60">
              <InfoRow
                label={c.labelService}
                onEdit={() => onEditStep(1)}
                editLabel={t.edit}
                editAria={t.editAria}
                notSet={t.notSet}
                value={serviceName}
              />
              <InfoRow
                label={c.labelDepartment}
                onEdit={() => onEditStep(2)}
                editLabel={t.edit}
                editAria={t.editAria}
                notSet={t.notSet}
                value={beneficiaryName}
              />
              <InfoRow
                label={c.labelTitle}
                onEdit={() => onEditStep(2)}
                editLabel={t.edit}
                editAria={t.editAria}
                notSet={t.notSet}
                value={primaryTitle}
                valueDir={primaryTitleDir}
              >
                {secondaryTitle?.trim() ? (
                  <p
                    className="mt-1 truncate text-xs text-muted-foreground"
                    dir={locale === 'ar' ? 'ltr' : 'rtl'}
                  >
                    {secondaryTitle}
                  </p>
                ) : null}
              </InfoRow>
              <InfoRow
                label={c.labelDescription}
                onEdit={() => onEditStep(2)}
                editLabel={t.edit}
                editAria={t.editAria}
                notSet={t.notSet}
                value={description}
                multiline
              />
              <InfoRow
                label={c.labelPriority}
                onEdit={() => onEditStep(2)}
                editLabel={t.edit}
                editAria={t.editAria}
                notSet={t.notSet}
                valueContent={
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', PRIORITY_DOT[priority])}
                      aria-hidden
                    />
                    <span className="text-sm text-foreground">{priorityLabel}</span>
                    {prioritySlaText ? (
                      <span className="text-sm text-muted-foreground">({prioritySlaText})</span>
                    ) : null}
                  </span>
                }
              />
              <InfoRow
                label={c.labelDueDate}
                onEdit={() => onEditStep(2)}
                editLabel={t.edit}
                editAria={t.editAria}
                notSet={t.notSet}
                value={requestedDueDate}
              />
              {priority === 'urgent' && urgency?.trim() ? (
                <InfoRow
                  label={c.labelUrgency}
                  onEdit={() => onEditStep(2)}
                  editLabel={t.edit}
                  editAria={t.editAria}
                  notSet={t.notSet}
                  value={urgency}
                  multiline
                />
              ) : null}
              {notes?.trim() ? (
                <InfoRow
                  label={c.labelNotes}
                  onEdit={() => onEditStep(2)}
                  editLabel={t.edit}
                  editAria={t.editAria}
                  notSet={t.notSet}
                  value={notes}
                  multiline
                />
              ) : null}
            </dl>
          </SectionCard>

          {/* Attached Supporting Documents */}
          <SectionCard
            title={c.attachedDocs(f.formatNumber(count), count === 1)}
            className="border-border/70 shadow-elevation-1"
            actions={
              <EditButton
                onEdit={() => onEditStep(3)}
                label={t.edit}
                editAria={t.editAria}
                section={c.attachedDocs(f.formatNumber(count), count === 1)}
              />
            }
          >
            {count === 0 ? (
              <p className="text-sm italic text-muted-foreground">{c.noFiles}</p>
            ) : (
              <ul className="space-y-2">
                {files.map((file) => (
                  <li
                    key={file.fileId}
                    className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" dir="auto">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatSize(file.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* RIGHT — SLA target delivery card, then the attestation gate */}
        <aside className="space-y-5 lg:col-span-1">
          <SlaPromisePreview serviceCode={service?.code} priority={priority} />

          <div
            className={cn(
              'rounded-xl border p-4 sm:p-5 transition-colors',
              confirmError
                ? 'border-error-300 bg-error-50/50 dark:border-error-800/60 dark:bg-error-900/15'
                : 'border-border bg-card',
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                {c.confirmationTitle}
              </h3>
              <Badge variant="warning" size="sm" className="shrink-0">
                {c.required}
              </Badge>
            </div>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => onConfirmChange(v === true)}
                className="mt-0.5"
                aria-invalid={Boolean(confirmError)}
                required
              />
              <span className="text-sm leading-relaxed text-foreground">{c.attestation}</span>
            </label>
            {confirmError ? (
              <p className="mt-2 text-xs text-error-600" role="alert">
                {confirmError}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function InfoRow({
  label,
  value,
  valueContent,
  notSet,
  onEdit,
  editLabel,
  editAria,
  valueDir,
  multiline,
  children,
}: {
  label: string;
  value?: string;
  /** Custom node that REPLACES the default text value line (e.g. the priority dot). */
  valueContent?: ReactNode;
  notSet: string;
  onEdit: () => void;
  editLabel: string;
  editAria: string;
  valueDir?: 'ltr' | 'rtl';
  multiline?: boolean;
  /** Supplementary content rendered BELOW the value line (e.g. the other-language title). */
  children?: ReactNode;
}) {
  const isEmpty = !value || value.trim() === '';
  return (
    <div className="flex items-start justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        {valueContent ? (
          <dd className="mt-1">{valueContent}</dd>
        ) : (
          <dd
            dir={valueDir}
            className={cn(
              'mt-1 text-sm',
              isEmpty ? 'italic text-muted-foreground/70' : 'text-foreground',
              multiline ? 'whitespace-pre-wrap break-words' : 'break-words',
            )}
          >
            {isEmpty ? notSet : value}
          </dd>
        )}
        {children}
      </div>
      <EditButton onEdit={onEdit} label={editLabel} editAria={editAria} section={label} />
    </div>
  );
}

function EditButton({
  onEdit,
  label,
  editAria,
  section,
}: {
  onEdit: () => void;
  label: string;
  editAria: string;
  section: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onEdit}
      aria-label={`${editAria}: ${section}`}
      className="-me-2 h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}
