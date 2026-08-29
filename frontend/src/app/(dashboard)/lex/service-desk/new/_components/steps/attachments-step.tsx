'use client';

/**
 * STEP 3 — Attachments.
 *
 * Wraps `AttachmentsField`, which owns the whole upload / async virus-scan poll /
 * per-file policy-slot pipeline plus the mockup drop zone + "Uploaded Documents"
 * list. The submit backstop (policy-blocking + scan-clean) is enforced by this
 * step's validate() gate and again at review in `page.tsx` — this file only adds
 * the section heading/subtitle and surfaces the step-level attachment error.
 */

import { AlertTriangle } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AttachmentsStepProps } from '../../_lib/wizard-types';
import AttachmentsField from '../attachments-field';

const HEADING = {
  en: {
    title: 'Add supporting documents',
    description:
      'Attach any drafts, emails, certificates, or reference material that will help Legal review your request.',
  },
  ar: {
    title: 'إضافة المستندات والمرفقات الداعمة',
    description:
      'يرجى إرفاق المسودات والوثائق ذات العلاقة لمساعدة الفريق القانوني في دراسة الطلب بدقة.',
  },
} as const;

export default function AttachmentsStep({
  attachments,
  onAttachmentsChange,
  policy,
  errors,
  disabled,
}: AttachmentsStepProps) {
  const { locale } = useLocaleOrDefault();
  const copy = locale === 'ar' ? HEADING.ar : HEADING.en;
  const attachmentError = errors.attachments;

  return (
    <SectionCard
      title={copy.title}
      description={copy.description}
      className="border-border/70 shadow-elevation-1"
      contentClassName="pt-0"
    >
      <div className="space-y-4">
        {attachmentError ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-error-300/70 bg-error-50 px-3 py-2.5 text-sm text-error-700 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-300"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{attachmentError}</span>
          </div>
        ) : null}

        <AttachmentsField
          value={attachments}
          onChange={onAttachmentsChange}
          policy={policy}
          disabled={disabled}
        />
      </div>
    </SectionCard>
  );
}
