'use client';

/**
 * Bilingual (English + Modern Standard Arabic) labels for the segmented Priority
 * selector on the "New Legal Request" wizard (improvement #8). Self-contained and
 * resolved per-locale by {@link usePriorityLabels}, mirroring the canonical lex
 * i18n contract: a `{ en, ar }` bundle with two FULL same-shaped copies, resolved
 * with a locale ternary (default English / professional MSA). JSX only ever
 * touches the resolved `T`.
 *
 * Reason keys are RAW stable tokens (`regulatory` / `litigation` / `executive` /
 * `contractual` / `other`) so the active value is locale-independent and the
 * seeded justification text resolves from the same key set on both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

/** Stable, locale-independent suggested-reason tokens. */
export const URGENCY_REASON_KEYS = [
  'regulatory',
  'litigation',
  'executive',
  'contractual',
  'other',
] as const;

export type UrgencyReasonKey = (typeof URGENCY_REASON_KEYS)[number];

export interface PriorityLabels {
  /** Group heading + accessible name for the radio group. */
  legend: string;
  groupAria: string;
  /** Normal card. */
  normalTitle: string;
  normalBlurb: string;
  /** Urgent card. */
  urgentTitle: string;
  urgentBlurb: string;
  /** Emergency card. */
  emergencyTitle: string;
  emergencyBlurb: string;
  /** Selected-state pill on each card. */
  selected: string;
  /** Audit note under the urgent card. */
  urgentAuditNote: string;
  /** Consequences shown when urgent is selected. */
  urgentConsequencesTitle: string;
  urgentConsequences: {
    audit: string;
    escalation: string;
    slaApproval: string;
  };
  /** Short SLA prefix shown before an optional slaHint blurb. */
  slaPrefix: string;
  /** Justification area. */
  justificationLegend: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  justificationLabel: string;
  justificationHint: string;
  justificationPlaceholder: string;
  /** Suggested reasons (keyed by raw token; same key set on both locales). */
  reasons: Record<UrgencyReasonKey, string>;
  /**
   * Seed text written into the justification textarea when a non-"other" reason
   * is picked. User-editable afterwards. Keyed by the same reason tokens.
   */
  reasonSeed: Record<Exclude<UrgencyReasonKey, 'other'>, string>;
}

const bundle: { readonly en: PriorityLabels; readonly ar: PriorityLabels } = {
  en: {
    legend: 'Priority',
    groupAria: 'Request priority',
    normalTitle: 'Normal',
    normalBlurb: 'Standard turnaround.',
    urgentTitle: 'Urgent',
    urgentBlurb: 'Prioritised & escalated — audited.',
    emergencyTitle: 'Emergency',
    emergencyBlurb: 'Fastest response — within 24 hours.',
    selected: 'Selected',
    urgentAuditNote: 'Urgent requests are tracked and require a justification.',
    urgentConsequencesTitle: 'What urgent changes',
    urgentConsequences: {
      audit: 'Audit trail keeps the reason, reviewer actions, and timestamps.',
      escalation: 'Escalates ahead of normal work and may notify legal operations.',
      slaApproval: 'Uses the urgent SLA when configured; approvals may be checked before work starts.',
    },
    slaPrefix: 'SLA:',
    justificationLegend: 'Urgency justification',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Select a reason',
    justificationLabel: 'Explain the urgency',
    justificationHint: 'Describe the business impact (not requester delay). This is audited.',
    justificationPlaceholder: 'Explain why this request must be handled urgently.',
    reasons: {
      regulatory: 'Regulatory deadline',
      litigation: 'Litigation timeline',
      executive: 'Executive request',
      contractual: 'Contractual deadline',
      other: 'Other',
    },
    reasonSeed: {
      regulatory: 'A regulatory deadline requires urgent handling: ',
      litigation: 'A litigation timeline requires urgent handling: ',
      executive: 'Requested by executive leadership: ',
      contractual: 'A contractual deadline requires urgent handling: ',
    },
  },
  ar: {
    legend: 'الأولوية',
    groupAria: 'أولوية الطلب',
    normalTitle: 'عادي',
    normalBlurb: 'إنجاز ضمن المدة المعتادة.',
    urgentTitle: 'عاجل',
    urgentBlurb: 'ذو أولوية ومُصعَّد — مُدقَّق.',
    emergencyTitle: 'طارئ',
    emergencyBlurb: 'أسرع استجابة — خلال 24 ساعة.',
    selected: 'محدد',
    urgentAuditNote: 'تُتابَع الطلبات العاجلة وتتطلّب مبرّرًا.',
    urgentConsequencesTitle: 'ما الذي يتغير عند اختيار عاجل',
    urgentConsequences: {
      audit: 'يحفظ مسار التدقيق السبب وإجراءات المراجعين والطوابع الزمنية.',
      escalation: 'يُصعَّد قبل العمل العادي وقد يُبلِغ عمليات الشؤون القانونية.',
      slaApproval: 'تُطبَّق اتفاقية مستوى الخدمة العاجلة عند تهيئتها؛ وقد تُراجع الموافقات قبل بدء العمل.',
    },
    slaPrefix: 'اتفاقية مستوى الخدمة:',
    justificationLegend: 'مبرّر الاستعجال',
    reasonLabel: 'السبب',
    reasonPlaceholder: 'اختر سببًا',
    justificationLabel: 'وضّح سبب الاستعجال',
    justificationHint: 'صِف الأثر على العمل (وليس تأخّر مقدّم الطلب). هذا الحقل مُدقَّق.',
    justificationPlaceholder: 'وضّح سبب وجوب معالجة هذا الطلب بشكل عاجل.',
    reasons: {
      regulatory: 'موعد تنظيمي نهائي',
      litigation: 'جدول زمني لتقاضٍ',
      executive: 'طلب من الإدارة التنفيذية',
      contractual: 'موعد تعاقدي نهائي',
      other: 'أخرى',
    },
    reasonSeed: {
      regulatory: 'موعد تنظيمي نهائي يستلزم معالجة عاجلة: ',
      litigation: 'جدول زمني لتقاضٍ يستلزم معالجة عاجلة: ',
      executive: 'بطلب من الإدارة التنفيذية: ',
      contractual: 'موعد تعاقدي نهائي يستلزم معالجة عاجلة: ',
    },
  },
};

/** Pure resolver — defaults to English, any non-`ar` locale resolves to English. */
export function resolvePriorityLabels(locale: AppLocale = 'en'): PriorityLabels {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

/** React hook: reads the active locale (non-throwing) and returns resolved labels. */
export function usePriorityLabels(): PriorityLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolvePriorityLabels(locale), [locale]);
}
