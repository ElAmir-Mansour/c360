'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the
 * Legal Service Desk request-detail *navigation & shareability toolbar*
 * (#10): copy request number, copy link, and prev/next sibling navigation
 * (mouse click + `j`/`k` keyboard shortcuts).
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useRequestToolbarNavLabels}. JSX only ever
 * touches the resolved `RequestToolbarNavLabels`.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface RequestToolbarNavLabels {
  /** "Copy request number" — tooltip/title when NOT in the just-copied state. */
  copyNumber: string;
  /** aria-label, parameterized with the actual request number for a11y clarity. */
  copyNumberAria: (requestNumber: string) => string;
  /** Announced (aria-label + tooltip) for ~2s right after a successful copy. */
  copyNumberCopiedAria: string;
  /** "Copy link" — tooltip/title when NOT in the just-copied state. */
  copyLink: string;
  copyLinkAria: string;
  /** Announced (aria-label + tooltip) for ~2s right after a successful copy. */
  copyLinkCopiedAria: string;
  /** Generic "Copied" word used in the transient tooltip body. */
  copied: string;
  /** "Previous" — short label for the prev tooltip body when enabled. */
  prev: string;
  /** aria-label/title for the prev button when a previous sibling exists. */
  prevAria: string;
  /** aria-label/title for the prev button when there is no previous sibling. */
  prevDisabledAria: string;
  /** "Next" — short label for the next tooltip body when enabled. */
  next: string;
  /** aria-label/title for the next button when a next sibling exists. */
  nextAria: string;
  /** aria-label/title for the next button when there is no next sibling. */
  nextDisabledAria: string;
}

const bundle: LexBilingual<RequestToolbarNavLabels> = {
  en: {
    copyNumber: 'Copy request number',
    copyNumberAria: (requestNumber) => `Copy request number ${requestNumber}`,
    copyNumberCopiedAria: 'Request number copied',
    copyLink: 'Copy link',
    copyLinkAria: 'Copy link to this request',
    copyLinkCopiedAria: 'Link copied',
    copied: 'Copied',
    prev: 'Previous request',
    prevAria: 'Go to previous request (shortcut: k)',
    prevDisabledAria: 'No previous request on this page',
    next: 'Next request',
    nextAria: 'Go to next request (shortcut: j)',
    nextDisabledAria: 'No next request on this page',
  },
  ar: {
    copyNumber: 'نسخ رقم الطلب',
    copyNumberAria: (requestNumber) => `نسخ رقم الطلب ${requestNumber}`,
    copyNumberCopiedAria: 'تم نسخ رقم الطلب',
    copyLink: 'نسخ الرابط',
    copyLinkAria: 'نسخ رابط هذا الطلب',
    copyLinkCopiedAria: 'تم نسخ الرابط',
    copied: 'تم النسخ',
    prev: 'الطلب السابق',
    prevAria: 'الانتقال إلى الطلب السابق (اختصار: k)',
    prevDisabledAria: 'لا يوجد طلب سابق في هذه الصفحة',
    next: 'الطلب التالي',
    nextAria: 'الانتقال إلى الطلب التالي (اختصار: j)',
    nextDisabledAria: 'لا يوجد طلب تالٍ في هذه الصفحة',
  },
};

export function resolveRequestToolbarNavLabels(
  locale: AppLocale = 'en',
): RequestToolbarNavLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useRequestToolbarNavLabels(): RequestToolbarNavLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRequestToolbarNavLabels(locale), [locale]);
}
