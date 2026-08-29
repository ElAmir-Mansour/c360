'use client';

/**
 * Bilingual (English + Modern Standard Arabic) labels for the Legal Service Desk
 * Intake Triage Queue (`/lex/service-desk/intake`, CAP-001..005, CAP-015).
 *
 * Follows the canonical lex i18n contract: a `LexBilingual<T> = { en, ar }`
 * bundle with two full same-shaped copies, resolved per locale by the
 * `useIntakeLabels()` hook over `resolveLexBilingual`. JSX only ever touches the
 * resolved `T`. The status-enum map is keyed by the RAW backend token
 * (pending | processed | errored) with identical key sets on both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export const INTAKE_STATUS_OPTIONS = ['pending', 'processed', 'errored'] as const;

export interface IntakeLabels {
  pageTitle: string;
  pageDescription: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
  notLinked: string;
  stats: {
    pending: string;
    processed: string;
    errored: string;
  };
  statDetails: {
    pending: string;
    processed: string;
    errored: string;
    loadedMessages: string;
    intakeShare: string;
  };
  columns: {
    from: string;
    subject: string;
    status: string;
    attachments: string;
    linkedRequest: string;
    received: string;
  };
  filters: { status: string };
  attachmentsCount: (count: number) => string;
  noSubject: string;
  sheet: {
    title: string;
    description: string;
    sectionMessage: string;
    sectionRouting: string;
    from: string;
    to: string;
    subject: string;
    status: string;
    received: string;
    mailbox: string;
    mailboxNone: string;
    attachments: string;
    linkedRequest: string;
    viewRequest: string;
    notLinked: string;
    createRequest: string;
  };
  statusOptions: Record<string, string>;
  simulate: {
    trigger: string;
    title: string;
    description: string;
    mailbox: string;
    mailboxPlaceholder: string;
    mailboxEmpty: string;
    from: string;
    fromPlaceholder: string;
    subject: string;
    subjectPlaceholder: string;
    body: string;
    bodyPlaceholder: string;
    submit: string;
    submitting: string;
    cancel: string;
    successTitle: string;
    successBody: string;
    errorTitle: string;
  };
}

const bundle: LexBilingual<IntakeLabels> = {
  en: {
    pageTitle: 'Intake Triage',
    pageDescription:
      'Email-ingested and direct-submission intake messages awaiting triage into legal requests.',
    searchPlaceholder: 'Search intake messages...',
    emptyTitle: 'No intake messages',
    emptyDescription: 'No intake messages matched the current filters.',
    notLinked: 'Not linked',
    stats: {
      pending: 'Pending',
      processed: 'Processed',
      errored: 'Errored',
    },
    statDetails: {
      pending: 'Messages waiting for triage.',
      processed: 'Messages already converted or dismissed.',
      errored: 'Messages that failed intake processing.',
      loadedMessages: 'Loaded messages',
      intakeShare: 'Intake share',
    },
    columns: {
      from: 'From',
      subject: 'Subject',
      status: 'Status',
      attachments: 'Attachments',
      linkedRequest: 'Linked request',
      received: 'Received',
    },
    filters: { status: 'Status' },
    attachmentsCount: (count) => `${count} attachment${count === 1 ? '' : 's'}`,
    noSubject: '(No subject)',
    sheet: {
      title: 'Intake message',
      description: 'Full intake message and its routing into the request register.',
      sectionMessage: 'Message',
      sectionRouting: 'Routing',
      from: 'From',
      to: 'To',
      subject: 'Subject',
      status: 'Status',
      received: 'Received',
      mailbox: 'Mailbox',
      mailboxNone: 'Direct submission',
      attachments: 'Attachments',
      linkedRequest: 'Linked request',
      viewRequest: 'View linked request',
      notLinked: 'Not linked to a request',
      createRequest: 'Create request from this message',
    },
    statusOptions: {
      pending: 'Pending',
      processed: 'Processed',
      errored: 'Errored',
    },
    simulate: {
      trigger: 'Simulate inbound email',
      title: 'Simulate inbound email',
      description:
        'Synthesize an inbound email against a mailbox and run the full classify and route pipeline — no external mail provider required.',
      mailbox: 'Mailbox',
      mailboxPlaceholder: 'Select a mailbox',
      mailboxEmpty: 'No intake mailboxes are configured yet.',
      from: 'From',
      fromPlaceholder: 'requester@example.com',
      subject: 'Subject',
      subjectPlaceholder: 'e.g. Contract review request',
      body: 'Body',
      bodyPlaceholder: 'The email body used for classification and routing.',
      submit: 'Simulate',
      submitting: 'Simulating…',
      cancel: 'Cancel',
      successTitle: 'Inbound email simulated',
      successBody: 'The message was ingested and routed into the request register.',
      errorTitle: 'Could not simulate inbound email',
    },
  },
  ar: {
    pageTitle: 'فرز الاستقبال',
    pageDescription:
      'رسائل الاستقبال الواردة عبر البريد الإلكتروني والتقديم المباشر بانتظار الفرز إلى طلبات قانونية.',
    searchPlaceholder: 'البحث في رسائل الاستقبال...',
    emptyTitle: 'لا توجد رسائل استقبال',
    emptyDescription: 'لا توجد رسائل استقبال مطابقة للمرشّحات الحالية.',
    notLinked: 'غير مرتبط',
    stats: {
      pending: 'معلّقة',
      processed: 'مُعالَجة',
      errored: 'بها خطأ',
    },
    statDetails: {
      pending: 'رسائل تنتظر الفرز.',
      processed: 'رسائل تم تحويلها أو صرفها.',
      errored: 'رسائل فشلت معالجتها في الاستقبال.',
      loadedMessages: 'الرسائل المحمّلة',
      intakeShare: 'حصة الاستقبال',
    },
    columns: {
      from: 'من',
      subject: 'الموضوع',
      status: 'الحالة',
      attachments: 'المرفقات',
      linkedRequest: 'الطلب المرتبط',
      received: 'تاريخ الاستلام',
    },
    filters: { status: 'الحالة' },
    attachmentsCount: (count) => `${count} مرفق`,
    noSubject: '(بدون موضوع)',
    sheet: {
      title: 'رسالة الاستقبال',
      description: 'رسالة الاستقبال الكاملة وتوجيهها إلى سجل الطلبات.',
      sectionMessage: 'الرسالة',
      sectionRouting: 'التوجيه',
      from: 'من',
      to: 'إلى',
      subject: 'الموضوع',
      status: 'الحالة',
      received: 'تاريخ الاستلام',
      mailbox: 'صندوق البريد',
      mailboxNone: 'تقديم مباشر',
      attachments: 'المرفقات',
      linkedRequest: 'الطلب المرتبط',
      viewRequest: 'عرض الطلب المرتبط',
      notLinked: 'غير مرتبط بطلب',
      createRequest: 'إنشاء طلب من هذه الرسالة',
    },
    statusOptions: {
      pending: 'معلّقة',
      processed: 'مُعالَجة',
      errored: 'بها خطأ',
    },
    simulate: {
      trigger: 'محاكاة بريد وارد',
      title: 'محاكاة بريد إلكتروني وارد',
      description:
        'إنشاء بريد إلكتروني وارد على صندوق بريد وتشغيل مسار التصنيف والتوجيه بالكامل — دون الحاجة إلى مزوّد بريد خارجي.',
      mailbox: 'صندوق البريد',
      mailboxPlaceholder: 'اختر صندوق بريد',
      mailboxEmpty: 'لا توجد صناديق بريد استقبال مُهيّأة بعد.',
      from: 'من',
      fromPlaceholder: 'requester@example.com',
      subject: 'الموضوع',
      subjectPlaceholder: 'مثال: طلب مراجعة عقد',
      body: 'النص',
      bodyPlaceholder: 'نص البريد المستخدم في التصنيف والتوجيه.',
      submit: 'محاكاة',
      submitting: 'جارٍ المحاكاة…',
      cancel: 'إلغاء',
      successTitle: 'تمت محاكاة البريد الوارد',
      successBody: 'تم استقبال الرسالة وتوجيهها إلى سجل الطلبات.',
      errorTitle: 'تعذّرت محاكاة البريد الوارد',
    },
  },
};

export function resolveIntakeLabels(locale: AppLocale = 'en'): IntakeLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useIntakeLabels(): IntakeLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveIntakeLabels(locale), [locale]);
}

/** Resolve an intake status token using the shared label map, with a fallback. */
export function formatIntakeToken(token: string): string {
  return token.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
