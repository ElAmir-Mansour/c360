'use client';

/**
 * #8 Co-located bilingual (English + Modern Standard Arabic) labels for the
 * Legal Service Desk request-detail RIGHT-RAIL "Documents & links" card
 * ({@link RequestRelatedCard}).
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useRequestRelatedLabels}. JSX only ever touches
 * the resolved `T`. Interpolated / function-valued fields appear on BOTH sides
 * and preserve Western digits + placeholders.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface RequestRelatedLabels {
  cardTitle: string;
  cardDescription: string;

  // --- Attachments subsection ---
  attachments: {
    heading: string;
    /** Header counter, e.g. "2/3" — attached over total. */
    counter: (satisfied: number, total: number) => string;
    required: string;
    attached: string;
    missing: string;
    /** Compact empty when no attachment requirements exist. */
    empty: string;
    /** SR-only label while the execution checklist loads. */
    loading: string;
  };

  // --- Related matter subsection ---
  related: {
    heading: string;
    caseLink: string;
    consultationLink: string;
    contractLink: string;
    investigationLink: string;
  };

  // --- Clone lineage subsection ---
  clone: {
    heading: string;
    clonedFrom: (ref: string) => string;
    continuedAs: (ref: string) => string;
    viewOrigin: string;
    viewContinuation: string;
    refFallback: (id: string) => string;
  };

  /** Card-level empty (nothing linked and the checklist is unavailable). */
  emptyAll: string;
}

const bundle: LexBilingual<RequestRelatedLabels> = {
  en: {
    cardTitle: 'Documents & links',
    cardDescription: 'Requested attachments and everything this request connects to.',
    attachments: {
      heading: 'Attachments',
      counter: (satisfied, total) => `${satisfied}/${total}`,
      required: 'Required',
      attached: 'Attached',
      missing: 'Missing',
      empty: 'No attachments requested.',
      loading: 'Loading attachments…',
    },
    related: {
      heading: 'Related matter',
      caseLink: 'Open linked case',
      consultationLink: 'Open linked consultation',
      contractLink: 'Open linked contract',
      investigationLink: 'Open linked investigation',
    },
    clone: {
      heading: 'Lineage',
      clonedFrom: (ref) => `Clone of ${ref}`,
      continuedAs: (ref) => `Continued as ${ref}`,
      viewOrigin: 'View origin request',
      viewContinuation: 'View continuation request',
      refFallback: (id) => `REQ ${id.slice(0, 8)}`,
    },
    emptyAll: 'Nothing is linked to this request yet.',
  },
  ar: {
    cardTitle: 'المستندات والروابط',
    cardDescription: 'المرفقات المطلوبة وكل ما يرتبط به هذا الطلب.',
    attachments: {
      heading: 'المرفقات',
      counter: (satisfied, total) => `${satisfied}/${total}`,
      required: 'مطلوب',
      attached: 'مُرفق',
      missing: 'ناقص',
      empty: 'لا توجد مرفقات مطلوبة.',
      loading: 'جارٍ تحميل المرفقات…',
    },
    related: {
      heading: 'الملف المرتبط',
      caseLink: 'فتح القضية المرتبطة',
      consultationLink: 'فتح الاستشارة المرتبطة',
      contractLink: 'فتح العقد المرتبط',
      investigationLink: 'فتح التحقيق المرتبط',
    },
    clone: {
      heading: 'السلالة',
      clonedFrom: (ref) => `نسخة من ${ref}`,
      continuedAs: (ref) => `استُكمل كـ ${ref}`,
      viewOrigin: 'عرض الطلب الأصلي',
      viewContinuation: 'عرض طلب الاستكمال',
      refFallback: (id) => `طلب ${id.slice(0, 8)}`,
    },
    emptyAll: 'لا يوجد أي عنصر مرتبط بهذا الطلب بعد.',
  },
};

export function resolveRequestRelatedLabels(locale: AppLocale = 'en'): RequestRelatedLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useRequestRelatedLabels(): RequestRelatedLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRequestRelatedLabels(locale), [locale]);
}
