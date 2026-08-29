/**
 * Bilingual (English + Modern Standard Arabic) labels + session-type definitions
 * for the Court Sessions Management surface (إدارة جلسات المحاكمة).
 *
 * Session type / required action / required documents / attendees / adjournment
 * are persisted on a hearing's `metadata` JSONB (round-tripped verbatim by the
 * backend). Follows the canonical lex i18n contract.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '../../../../_lib/lex-i18n';

export const SESSION_TYPES = [
  'preparatory',
  'pleading',
  'evidence',
  'expert',
  'closing',
  'verdict',
  'other',
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

export interface SessionsLabels {
  map: {
    title: string;
    upcoming: string;
    done: string;
    next: string;
    hijri: string;
  };
  next: {
    title: string;
    badge: string;
    none: string;
    court: string;
    noCourt: string;
    requiredAction: string;
    noAction: string;
    team: string;
    noTeam: string;
    countdown: (label: string) => string;
  };
  requiredDocs: {
    title: string;
    description: string;
    empty: string;
    add: string;
    addPlaceholder: string;
    provided: string;
    pending: string;
    remove: string;
    progress: (done: string, total: string) => string;
    forNext: string;
  };
  past: {
    title: string;
    empty: string;
    columns: {
      date: string;
      type: string;
      outcome: string;
      nextAction: string;
    };
    noOutcome: string;
    noNextAction: string;
  };
  quick: {
    title: string;
    addSession: string;
    adjourn: string;
  };
  form: {
    addTitle: string;
    editTitle: string;
    description: string;
    date: string;
    sessionType: string;
    location: string;
    locationPlaceholder: string;
    requiredAction: string;
    requiredActionPlaceholder: string;
    attendees: string;
    attendeesAdd: string;
    notes: string;
    notesPlaceholder: string;
    decision: string;
    decisionPlaceholder: string;
    requiredDocs: string;
    requiredDocsPlaceholder: string;
    requiredDocsAdd: string;
    cancel: string;
    submit: string;
    save: string;
    errors: { dateRequired: string };
  };
  adjourn: {
    title: string;
    description: (date: string) => string;
    newDate: string;
    reason: string;
    reasonPlaceholder: string;
    createFollowUp: string;
    cancel: string;
    confirm: string;
    noTarget: string;
    errors: { reasonRequired: string; dateRequired: string };
  };
  badges: {
    adjourned: string;
    today: string;
    holiday: string;
  };
  reports: string;
  edit: string;
  remove: string;
  sessionTypes: Record<SessionType, string>;
  toast: {
    added: string;
    updated: string;
    removed: string;
    docsUpdated: string;
    adjourned: string;
  };
  confirmRemove: { title: string; description: string };
  emptyTitle: string;
  emptyDescription: string;
}

const sessionsLabels: LexBilingual<SessionsLabels> = {
  en: {
    map: {
      title: 'Sessions map & path',
      upcoming: 'Upcoming',
      done: 'Held',
      next: 'Next',
      hijri: 'Hijri',
    },
    next: {
      title: 'Next session details',
      badge: 'Upcoming session',
      none: 'No upcoming session is scheduled.',
      court: 'Competent court',
      noCourt: 'Not specified',
      requiredAction: 'Required action',
      noAction: 'No action recorded',
      team: 'Attending legal team',
      noTeam: 'No attendees assigned',
      countdown: (label) => label,
    },
    requiredDocs: {
      title: 'Documents required for the next session',
      description: 'Track what must be ready before the session.',
      empty: 'No required documents recorded.',
      add: 'Add required document',
      addPlaceholder: 'e.g. Reply memorandum to the expert report',
      provided: 'Ready',
      pending: 'Pending',
      remove: 'Remove',
      progress: (done, total) => `${done} of ${total} ready`,
      forNext: 'For the next session',
    },
    past: {
      title: 'Previous sessions & outcomes',
      empty: 'No previous sessions recorded yet.',
      columns: {
        date: 'Date',
        type: 'Session type',
        outcome: 'Decision / outcome',
        nextAction: 'Next required action',
      },
      noOutcome: 'No outcome recorded',
      noNextAction: '—',
    },
    quick: {
      title: 'Quick session actions',
      addSession: 'Add scheduled session',
      adjourn: 'Request session adjournment',
    },
    form: {
      addTitle: 'Add scheduled session',
      editTitle: 'Edit session',
      description: 'Schedule a hearing and record its session details.',
      date: 'Session date & time',
      sessionType: 'Session type',
      location: 'Competent court',
      locationPlaceholder: 'e.g. Riyadh Commercial Court',
      requiredAction: 'Required action',
      requiredActionPlaceholder: 'e.g. Submit the reply memorandum',
      attendees: 'Attending legal team',
      attendeesAdd: 'Add attendee',
      notes: 'Notes',
      notesPlaceholder: 'Agenda, context, or notes',
      decision: 'Decision / outcome',
      decisionPlaceholder: 'Recorded once the session is held',
      requiredDocs: 'Required documents',
      requiredDocsPlaceholder: 'Add a required document',
      requiredDocsAdd: 'Add',
      cancel: 'Cancel',
      submit: 'Schedule session',
      save: 'Save',
      errors: { dateRequired: 'A session date is required' },
    },
    adjourn: {
      title: 'Request session adjournment',
      description: (date) => `Adjourn the session scheduled for ${date}.`,
      newDate: 'New session date & time',
      reason: 'Adjournment reason',
      reasonPlaceholder: 'e.g. Awaiting the expert report',
      createFollowUp: 'Schedule the new session automatically',
      cancel: 'Cancel',
      confirm: 'Confirm adjournment',
      noTarget: 'There is no upcoming session to adjourn.',
      errors: { reasonRequired: 'A reason is required', dateRequired: 'A new date is required' },
    },
    badges: {
      adjourned: 'Adjourned',
      today: 'Today',
      holiday: 'Holiday',
    },
    reports: 'Reports',
    edit: 'Edit',
    remove: 'Remove',
    sessionTypes: {
      preparatory: 'Preparatory / first',
      pleading: 'Pleading & defenses',
      evidence: 'Hearing & verification',
      expert: 'Expert / examination',
      closing: 'Closing pleading',
      verdict: 'Verdict pronouncement',
      other: 'Other',
    },
    toast: {
      added: 'Session scheduled.',
      updated: 'Session updated.',
      removed: 'Session removed.',
      docsUpdated: 'Required documents updated.',
      adjourned: 'Session adjournment recorded.',
    },
    confirmRemove: {
      title: 'Remove this session?',
      description: 'This permanently removes the scheduled session.',
    },
    emptyTitle: 'No sessions scheduled',
    emptyDescription: 'Schedule the first court session for this case.',
  },
  ar: {
    map: {
      title: 'خريطة الجلسات والمسار',
      upcoming: 'قادمة',
      done: 'منعقدة',
      next: 'التالية',
      hijri: 'هجري',
    },
    next: {
      title: 'تفاصيل ومعطيات الجلسة القادمة',
      badge: 'جلسة قادمة',
      none: 'لا توجد جلسة قادمة مجدولة.',
      court: 'المحكمة المختصة',
      noCourt: 'غير محددة',
      requiredAction: 'الإجراء المطلوب',
      noAction: 'لم يُسجَّل إجراء',
      team: 'الفريق القانوني الحاضر',
      noTeam: 'لم يُسنَد حضور',
      countdown: (label) => label,
    },
    requiredDocs: {
      title: 'مستندات مطلوبة للجلسة القادمة',
      description: 'تتبّع ما يجب تجهيزه قبل الجلسة.',
      empty: 'لا توجد مستندات مطلوبة مسجلة.',
      add: 'إضافة مستند مطلوب',
      addPlaceholder: 'مثال: مذكرة الرد على تقرير الخبير',
      provided: 'جاهز',
      pending: 'قيد التجهيز',
      remove: 'إزالة',
      progress: (done, total) => `${done} من ${total} جاهز`,
      forNext: 'للجلسة القادمة',
    },
    past: {
      title: 'سجل الجلسات السابقة ومخرجاتها',
      empty: 'لم تُسجَّل جلسات سابقة بعد.',
      columns: {
        date: 'التاريخ',
        type: 'نوع الجلسة',
        outcome: 'القرار / المخرجات',
        nextAction: 'الإجراء التالي المطلوب',
      },
      noOutcome: 'لم تُسجَّل مخرجات',
      noNextAction: '—',
    },
    quick: {
      title: 'إجراءات سريعة للجلسات',
      addSession: 'إضافة جلسة مجدولة جديدة',
      adjourn: 'طلب تأجيل موعد الجلسة',
    },
    form: {
      addTitle: 'إضافة جلسة مجدولة',
      editTitle: 'تعديل الجلسة',
      description: 'جدولة جلسة وتسجيل معطياتها.',
      date: 'تاريخ ووقت الجلسة',
      sessionType: 'نوع الجلسة',
      location: 'المحكمة المختصة',
      locationPlaceholder: 'مثال: المحكمة التجارية بالرياض',
      requiredAction: 'الإجراء المطلوب',
      requiredActionPlaceholder: 'مثال: تقديم مذكرة الرد',
      attendees: 'الفريق القانوني الحاضر',
      attendeesAdd: 'إضافة حاضر',
      notes: 'ملاحظات',
      notesPlaceholder: 'جدول الأعمال أو السياق أو ملاحظات',
      decision: 'القرار / المخرجات',
      decisionPlaceholder: 'يُسجَّل بعد انعقاد الجلسة',
      requiredDocs: 'المستندات المطلوبة',
      requiredDocsPlaceholder: 'أضف مستنداً مطلوباً',
      requiredDocsAdd: 'إضافة',
      cancel: 'إلغاء',
      submit: 'جدولة الجلسة',
      save: 'حفظ',
      errors: { dateRequired: 'تاريخ الجلسة مطلوب' },
    },
    adjourn: {
      title: 'طلب تأجيل موعد الجلسة',
      description: (date) => `تأجيل الجلسة المجدولة بتاريخ ${date}.`,
      newDate: 'تاريخ ووقت الجلسة الجديد',
      reason: 'سبب التأجيل',
      reasonPlaceholder: 'مثال: بانتظار تقرير الخبير',
      createFollowUp: 'جدولة الجلسة الجديدة تلقائياً',
      cancel: 'إلغاء',
      confirm: 'تأكيد التأجيل',
      noTarget: 'لا توجد جلسة قادمة لتأجيلها.',
      errors: { reasonRequired: 'السبب مطلوب', dateRequired: 'التاريخ الجديد مطلوب' },
    },
    badges: {
      adjourned: 'مؤجّلة',
      today: 'اليوم',
      holiday: 'عطلة',
    },
    reports: 'المحاضر',
    edit: 'تعديل',
    remove: 'إزالة',
    sessionTypes: {
      preparatory: 'تحضيرية / أولى',
      pleading: 'مرافعة ودفوع',
      evidence: 'استماع وتحقق',
      expert: 'خبرة / معاينة',
      closing: 'المرافعة الختامية',
      verdict: 'النطق بالحكم',
      other: 'أخرى',
    },
    toast: {
      added: 'تمت جدولة الجلسة.',
      updated: 'تم تحديث الجلسة.',
      removed: 'تمت إزالة الجلسة.',
      docsUpdated: 'تم تحديث المستندات المطلوبة.',
      adjourned: 'تم تسجيل تأجيل الجلسة.',
    },
    confirmRemove: {
      title: 'إزالة هذه الجلسة؟',
      description: 'سيؤدي ذلك إلى إزالة الجلسة المجدولة نهائياً.',
    },
    emptyTitle: 'لا توجد جلسات مجدولة',
    emptyDescription: 'جدول أول جلسة محكمة لهذه القضية.',
  },
};

export function useSessionsLabels(): SessionsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(sessionsLabels, locale), [locale]);
}
