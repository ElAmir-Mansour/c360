'use client';

/**
 * Bilingual (English + Modern Standard Arabic) labels for the post-submit success
 * screen of the "New Legal Request" wizard (improvement #10). Self-contained and
 * resolved per-locale by {@link useSuccessLabels}, mirroring the canonical lex
 * i18n contract: a `{ en, ar }` bundle with two FULL same-shaped copies, resolved
 * with a locale ternary (default English / professional MSA). JSX only ever
 * touches the resolved `T`.
 *
 * Timeline step keys are RAW stable tokens (`submitted` / `acknowledged` /
 * `in_progress` / `delivered`) so the highlighted step is locale-independent and
 * the labels resolve from the same key set on both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

/** Stable, locale-independent "what happens next" timeline tokens (ordered). */
export const SUCCESS_TIMELINE_KEYS = [
  'submitted',
  'acknowledged',
  'in_progress',
  'delivered',
] as const;

export type SuccessTimelineKey = (typeof SUCCESS_TIMELINE_KEYS)[number];

export interface SuccessLabels {
  /** Hero heading + supporting copy. */
  heading: string;
  subheading: string;
  /** Request-number block. */
  requestNumberLabel: string;
  copyNumber: string;
  copyNumberDone: string;
  /** Status / priority badge prefixes (the value comes from the shared maps). */
  statusLabel: string;
  priorityLabel: string;
  /** "What happens next" mini-timeline. */
  timelineTitle: string;
  timelineCurrent: string;
  timeline: Record<SuccessTimelineKey, string>;
  /** Quick actions. */
  viewRequest: string;
  createAnother: string;
  copyLink: string;
  copyLinkDone: string;
  /** Accessible region name for the confirmation. */
  regionAria: string;
}

const bundle: { readonly en: SuccessLabels; readonly ar: SuccessLabels } = {
  en: {
    heading: 'Request submitted',
    subheading: 'Your legal request has been received and assigned a reference number.',
    requestNumberLabel: 'Reference number',
    copyNumber: 'Copy reference number',
    copyNumberDone: 'Reference number copied.',
    statusLabel: 'Status',
    priorityLabel: 'Priority',
    timelineTitle: 'What happens next',
    timelineCurrent: 'Current',
    timeline: {
      submitted: 'Submitted',
      acknowledged: 'Acknowledged',
      in_progress: 'In progress',
      delivered: 'Delivered',
    },
    viewRequest: 'View request',
    createAnother: 'Create another',
    copyLink: 'Copy link',
    copyLinkDone: 'Request link copied.',
    regionAria: 'Request submission confirmation',
  },
  ar: {
    heading: 'تم تقديم الطلب',
    subheading: 'تم استلام طلبك القانوني وإسناد رقم مرجعي له.',
    requestNumberLabel: 'الرقم المرجعي',
    copyNumber: 'نسخ الرقم المرجعي',
    copyNumberDone: 'تم نسخ الرقم المرجعي.',
    statusLabel: 'الحالة',
    priorityLabel: 'الأولوية',
    timelineTitle: 'الخطوات التالية',
    timelineCurrent: 'الحالية',
    timeline: {
      submitted: 'مُقدّم',
      acknowledged: 'تم الإقرار',
      in_progress: 'قيد التنفيذ',
      delivered: 'تم التسليم',
    },
    viewRequest: 'عرض الطلب',
    createAnother: 'إنشاء طلب آخر',
    copyLink: 'نسخ الرابط',
    copyLinkDone: 'تم نسخ رابط الطلب.',
    regionAria: 'تأكيد تقديم الطلب',
  },
};

/** Pure resolver — defaults to English, any non-`ar` locale resolves to English. */
export function resolveSuccessLabels(locale: AppLocale = 'en'): SuccessLabels {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

/** React hook: reads the active locale (non-throwing) and returns resolved labels. */
export function useSuccessLabels(): SuccessLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSuccessLabels(locale), [locale]);
}
