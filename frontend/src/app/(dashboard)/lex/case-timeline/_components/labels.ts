'use client';

/**
 * Local label extension for the case-timeline domain.
 *
 * The case-timeline workspace reuses the Settlements `timeline.*` bundle for all
 * of its EXISTING copy (it drives the very same {@link CaseTimelinePanel}). This
 * module adds ONLY the small amount of NEW copy the premium pass introduces —
 * KPI captions for the portfolio triage strip, holiday markers, a richer empty
 * CTA, and the eyebrow — without touching the shared (out-of-scope) Settlements
 * label file. Per the lex i18n contract every domain owns its own local bundle;
 * this is ours.
 *
 * Bilingual EN/AR, resolved off the active locale via {@link useTimelineExtra}.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

export interface TimelineExtraLabels {
  /** Uppercase eyebrow above the page title. */
  eyebrow: string;
  /** KPI strip captions for the portfolio triage view. */
  kpi: {
    total: string;
    onHold: string;
    openDelays: string;
    overdue: string;
    avgDelay: string;
    dueThisWeek: string;
    /** Short unit suffix for the avg-delay KPI (just "days"). */
    daysUnit: string;
  };
  /** Holiday / non-working-day markers (#29 KSA). */
  holiday: {
    /** Tooltip prefix when a completion date lands on a recognized KSA holiday. */
    onHoliday: string;
    /** Approximate-Eid note. */
    approximate: string;
  };
  /** Richer empty-state CTA for the picker workspace. */
  empty: {
    browsePortfolio: string;
    pickerHint: string;
  };
  /** Aria / micro copy. */
  triageEyebrow: string;
  worstFirst: string;
  /** "Recently viewed" eyebrow for the picker quick-jump chips. */
  recentlyViewed: string;
}

const BUNDLE: Record<AppLocale, TimelineExtraLabels> = {
  en: {
    eyebrow: 'Legal Suite · Case timelines',
    kpi: {
      total: 'Matters tracked',
      onHold: 'On external hold',
      openDelays: 'With open delays',
      overdue: 'Overdue',
      avgDelay: 'Avg. open delay',
      dueThisWeek: 'Due this week',
      daysUnit: 'days',
    },
    holiday: {
      onHoliday: 'Falls on a Saudi holiday',
      approximate: 'Eid date is approximate',
    },
    empty: {
      browsePortfolio: 'Browse the case portfolio',
      pickerHint: 'Pick a matter above to open its duration, hold and delay register.',
    },
    triageEyebrow: 'Practice-wide triage',
    worstFirst: 'Worst delay first',
    recentlyViewed: 'Recently viewed',
  },
  ar: {
    eyebrow: 'المجموعة القانونية · الجداول الزمنية للقضايا',
    kpi: {
      total: 'القضايا المتابَعة',
      onHold: 'في الحجز الخارجي',
      openDelays: 'بها تأخيرات مفتوحة',
      overdue: 'متجاوزة الموعد',
      avgDelay: 'متوسط التأخير المفتوح',
      dueThisWeek: 'مستحقة هذا الأسبوع',
      daysUnit: 'يومًا',
    },
    holiday: {
      onHoliday: 'يصادف عطلة رسمية سعودية',
      approximate: 'تاريخ العيد تقريبي',
    },
    empty: {
      browsePortfolio: 'تصفّح محفظة القضايا',
      pickerHint: 'اختر قضية بالأعلى لفتح مدتها وحجزها وسجل تأخيراتها.',
    },
    triageEyebrow: 'فرز على مستوى الممارسة',
    worstFirst: 'الأسوأ تأخيرًا أولًا',
    recentlyViewed: 'شوهدت مؤخرًا',
  },
};

/** Resolve the local timeline-extension labels for the active locale. */
export function useTimelineExtra(): TimelineExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => BUNDLE[locale === 'ar' ? 'ar' : 'en'], [locale]);
}
