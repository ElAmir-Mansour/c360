'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * *Investigations* detail *navigation & shareability toolbar*: copy the
 * investigation number, copy a shareable link, and prev/next sibling
 * navigation (mouse click + `j`/`k` keyboard shortcuts).
 *
 * Follows the canonical lex i18n contract (`../../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle resolved per locale by
 * {@link useInvestigationToolbarNavLabels}. JSX only ever touches the resolved
 * `InvestigationToolbarNavLabels`.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationToolbarNavLabels {
  copyNumber: string;
  copyNumberAria: (investigationNumber: string) => string;
  copyNumberCopiedAria: string;
  copyLink: string;
  copyLinkAria: string;
  copyLinkCopiedAria: string;
  copied: string;
  prev: string;
  prevAria: string;
  prevDisabledAria: string;
  next: string;
  nextAria: string;
  nextDisabledAria: string;
}

const bundle: LexBilingual<InvestigationToolbarNavLabels> = {
  en: {
    copyNumber: 'Copy investigation number',
    copyNumberAria: (investigationNumber) => `Copy investigation number ${investigationNumber}`,
    copyNumberCopiedAria: 'Investigation number copied',
    copyLink: 'Copy link',
    copyLinkAria: 'Copy link to this investigation',
    copyLinkCopiedAria: 'Link copied',
    copied: 'Copied',
    prev: 'Previous investigation',
    prevAria: 'Go to previous investigation (shortcut: k)',
    prevDisabledAria: 'No previous investigation on this page',
    next: 'Next investigation',
    nextAria: 'Go to next investigation (shortcut: j)',
    nextDisabledAria: 'No next investigation on this page',
  },
  ar: {
    copyNumber: 'نسخ رقم التحقيق',
    copyNumberAria: (investigationNumber) => `نسخ رقم التحقيق ${investigationNumber}`,
    copyNumberCopiedAria: 'تم نسخ رقم التحقيق',
    copyLink: 'نسخ الرابط',
    copyLinkAria: 'نسخ رابط هذا التحقيق',
    copyLinkCopiedAria: 'تم نسخ الرابط',
    copied: 'تم النسخ',
    prev: 'التحقيق السابق',
    prevAria: 'الانتقال إلى التحقيق السابق (اختصار: k)',
    prevDisabledAria: 'لا يوجد تحقيق سابق في هذه الصفحة',
    next: 'التحقيق التالي',
    nextAria: 'الانتقال إلى التحقيق التالي (اختصار: j)',
    nextDisabledAria: 'لا يوجد تحقيق تالٍ في هذه الصفحة',
  },
};

export function resolveInvestigationToolbarNavLabels(
  locale: AppLocale = 'en',
): InvestigationToolbarNavLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationToolbarNavLabels(): InvestigationToolbarNavLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationToolbarNavLabels(locale), [locale]);
}
