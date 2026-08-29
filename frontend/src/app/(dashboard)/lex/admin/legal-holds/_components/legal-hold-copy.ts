'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type {
  LegalHoldStatus,
  LegalHoldSubjectType,
} from '@/lib/lex/legal-holds';

/**
 * Bilingual (Arabic-first) copy for the Legal Hold (FR-WATHEEQ-005) admin
 * register. Kept local to the feature — no dependency on the shared admin-labels
 * module (integrator-owned) — so this net-new surface ships self-contained.
 */
export interface LegalHoldCopy {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  apply: string;
  emptyTitle: string;
  emptyDescription: string;
  stats: {
    total: string;
    active: string;
    released: string;
    totalHint: string;
    activeHint: string;
    releasedHint: string;
  };
  columns: {
    reference: string;
    subject: string;
    reason: string;
    status: string;
    custodian: string;
    appliedAt: string;
  };
  filters: {
    subjectType: string;
    status: string;
    reference: string;
    allSubjectTypes: string;
    allStatuses: string;
  };
  actions: {
    release: string;
    cancel: string;
  };
  form: {
    title: string;
    description: string;
    subjectType: string;
    subject: string;
    subjectHint: string;
    reason: string;
    reasonPlaceholder: string;
    reference: string;
    referencePlaceholder: string;
    custodian: string;
    custodianPlaceholder: string;
    notes: string;
    submit: string;
    errors: {
      subjectRequired: string;
      reasonRequired: string;
    };
  };
  release: {
    title: string;
    description: (reference: string) => string;
    note: string;
    notePlaceholder: string;
    confirm: string;
  };
  toast: {
    applied: string;
    released: string;
  };
  noReference: string;
}

const AR: LegalHoldCopy = {
  pageTitle: 'الحجوزات القانونية',
  pageDescription:
    'ضع حجزًا قانونيًا (حظر إتلاف) على عقد أو قضية أو مستند أو استشارة لمنع حذفه أو أرشفته أو تعديله أثناء التقاضي أو التحقيق التنظيمي، ثم ارفع الحجز عند انتهاء موجب الحفظ.',
  eyebrow: 'إدارة المجموعة القانونية',
  apply: 'فرض حجز قانوني',
  emptyTitle: 'لا توجد حجوزات قانونية',
  emptyDescription: 'لم يتم فرض أي حجز قانوني مطابق للفلاتر الحالية.',
  stats: {
    total: 'إجمالي الحجوزات',
    active: 'حجوزات سارية',
    released: 'حجوزات مرفوعة',
    totalHint: 'الحجوزات المطابقة للفلاتر الحالية.',
    activeHint: 'حجوزات سارية تمنع الإتلاف حاليًا.',
    releasedHint: 'حجوزات رُفعت وانتهى موجب الحفظ فيها.',
  },
  columns: {
    reference: 'المرجع',
    subject: 'الموضوع',
    reason: 'السبب',
    status: 'الحالة',
    custodian: 'الحافظ',
    appliedAt: 'تاريخ الفرض',
  },
  filters: {
    subjectType: 'نوع الموضوع',
    status: 'الحالة',
    reference: 'المرجع',
    allSubjectTypes: 'كل الأنواع',
    allStatuses: 'كل الحالات',
  },
  actions: {
    release: 'رفع الحجز',
    cancel: 'إلغاء',
  },
  form: {
    title: 'فرض حجز قانوني',
    description: 'اختر السجل المراد حفظه وسبب الحجز. لا يمكن أن يكون للسجل حجز ساري آخر.',
    subjectType: 'نوع الموضوع',
    subject: 'السجل',
    subjectHint: 'ابحث عن السجل الذي سيُطبق عليه الحجز.',
    reason: 'سبب الحجز',
    reasonPlaceholder: 'مثال: دعوى قضائية رقم 1445/123 — يلزم حفظ الأدلة.',
    reference: 'المرجع',
    referencePlaceholder: 'رقم القضية أو المحكمة أو الجهة',
    custodian: 'الحافظ',
    custodianPlaceholder: 'الشخص المسؤول عن الحفظ',
    notes: 'ملاحظات',
    submit: 'فرض الحجز',
    errors: {
      subjectRequired: 'يجب اختيار السجل.',
      reasonRequired: 'سبب الحجز مطلوب.',
    },
  },
  release: {
    title: 'رفع الحجز القانوني',
    description: (reference: string) =>
      `أنت على وشك رفع الحجز القانوني${reference ? ` (${reference})` : ''}. يعود السجل قابلاً للتعديل ما لم يوجد حجز ساري آخر.`,
    note: 'ملاحظة الرفع',
    notePlaceholder: 'سبب انتهاء موجب الحفظ (اختياري)',
    confirm: 'رفع الحجز',
  },
  toast: {
    applied: 'تم فرض الحجز القانوني.',
    released: 'تم رفع الحجز القانوني.',
  },
  noReference: 'بدون مرجع',
};

const EN: LegalHoldCopy = {
  pageTitle: 'Legal Holds',
  pageDescription:
    'Place a legal hold (destruction freeze) on a contract, matter, document, or consultation so it cannot be deleted, archived, or modified during litigation or a regulatory investigation, then release the hold once the preservation requirement ends.',
  eyebrow: 'Legal Suite Administration',
  apply: 'Apply legal hold',
  emptyTitle: 'No legal holds',
  emptyDescription: 'No legal hold matches the current filters.',
  stats: {
    total: 'Total holds',
    active: 'Active holds',
    released: 'Released holds',
    totalHint: 'Legal holds matching the current filters.',
    activeHint: 'Active holds currently preventing destruction.',
    releasedHint: 'Holds that were lifted once preservation ended.',
  },
  columns: {
    reference: 'Reference',
    subject: 'Subject',
    reason: 'Reason',
    status: 'Status',
    custodian: 'Custodian',
    appliedAt: 'Applied',
  },
  filters: {
    subjectType: 'Subject type',
    status: 'Status',
    reference: 'Reference',
    allSubjectTypes: 'All types',
    allStatuses: 'All statuses',
  },
  actions: {
    release: 'Release hold',
    cancel: 'Cancel',
  },
  form: {
    title: 'Apply legal hold',
    description:
      'Choose the record to preserve and the reason for the hold. The record must not already have an active hold.',
    subjectType: 'Subject type',
    subject: 'Record',
    subjectHint: 'Search for the record the hold applies to.',
    reason: 'Reason',
    reasonPlaceholder: 'e.g. Lawsuit 1445/123 — evidence must be preserved.',
    reference: 'Reference',
    referencePlaceholder: 'Case, court, or matter identifier',
    custodian: 'Custodian',
    custodianPlaceholder: 'Person responsible for preservation',
    notes: 'Notes',
    submit: 'Apply hold',
    errors: {
      subjectRequired: 'A record must be selected.',
      reasonRequired: 'A reason is required.',
    },
  },
  release: {
    title: 'Release legal hold',
    description: (reference: string) =>
      `You are about to release this legal hold${reference ? ` (${reference})` : ''}. The record becomes editable again unless another active hold exists.`,
    note: 'Release note',
    notePlaceholder: 'Why the preservation requirement ended (optional)',
    confirm: 'Release hold',
  },
  toast: {
    applied: 'Legal hold applied.',
    released: 'Legal hold released.',
  },
  noReference: 'No reference',
};

export function useLegalHoldCopy(): LegalHoldCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}

const SUBJECT_TYPE_LABELS: Record<LegalHoldSubjectType, { ar: string; en: string }> = {
  contract: { ar: 'عقد', en: 'Contract' },
  matter: { ar: 'قضية', en: 'Matter' },
  document: { ar: 'مستند', en: 'Document' },
  consultation: { ar: 'استشارة', en: 'Consultation' },
};

export function subjectTypeLabel(type: LegalHoldSubjectType, locale: AppLocale): string {
  const entry = SUBJECT_TYPE_LABELS[type];
  return locale === 'ar' ? entry.ar : entry.en;
}

const STATUS_LABELS: Record<LegalHoldStatus, { ar: string; en: string }> = {
  active: { ar: 'ساري', en: 'Active' },
  released: { ar: 'مرفوع', en: 'Released' },
};

export function statusLabel(status: LegalHoldStatus, locale: AppLocale): string {
  const entry = STATUS_LABELS[status];
  return locale === 'ar' ? entry.ar : entry.en;
}
