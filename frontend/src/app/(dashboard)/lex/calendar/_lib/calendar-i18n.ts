/**
 * Local bilingual label bundle for the Unified Legal Calendar (feature #15).
 *
 * Follows the canonical lex `LexBilingual<T>` idiom: two full copies of the same
 * label object, one per locale. This bundle is OWNED by the calendar feature —
 * it is never folded into the shared i18n file.
 *
 * REFERENCE MIGRATION (unified i18n): the bundle is registered as the
 * 'lex.calendar' namespace, so components can ALSO resolve its string leaves
 * with `useT('lex.calendar')` — e.g. `t('kpis.overdue')` — with automatic
 * fallback to the global catalog. The typed `useCalendarLabels()` hook remains
 * the primary API and now rides the shared `useBilingual` hook instead of the
 * hand-rolled `useLocaleOrDefault` + `resolveLexBilingual` body.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages } from '@/lib/i18n/registry';
import { type LexBilingual } from '../../_lib/lex-i18n';
import type { LegalEventType, LegalEventSeverity } from './calendar-events';

export interface CalendarLabels {
  eyebrow: string;
  title: string;
  description: string;
  views: { month: string; agenda: string };
  filters: {
    heading: string;
    types: string;
    severities: string;
    all: string;
    clear: string;
    showingAll: string;
    activeSuffix: string;
  };
  kpis: {
    total: string;
    overdue: string;
    thisWeek: string;
    thisMonth: string;
    holidays: string;
  };
  legend: {
    holiday: string;
    today: string;
    weekend: string;
  };
  agenda: {
    today: string;
    empty: string;
  };
  empty: {
    title: string;
    description: string;
    filtered: string;
  };
  error: {
    title: string;
    description: string;
    retry: string;
  };
  more: (n: number) => string;
  /** Event type display labels. */
  type: Record<LegalEventType, string>;
  /** Severity display labels. */
  severity: Record<LegalEventSeverity, string>;
  /** Weekday short names, Sun..Sat. */
  weekdays: readonly string[];
}

const labels: LexBilingual<CalendarLabels> = {
  en: {
    eyebrow: 'Unified Legal Calendar',
    title: 'Legal Calendar',
    description:
      'Every dated obligation across the legal suite — hearings, renewals, signatures, deadlines and SLAs — on one Gregorian + Hijri timeline.',
    views: { month: 'Month', agenda: 'Agenda' },
    filters: {
      heading: 'Filters',
      types: 'Type',
      severities: 'Severity',
      all: 'All',
      clear: 'Clear',
      showingAll: 'Showing all events',
      activeSuffix: 'active',
    },
    kpis: {
      total: 'Total events',
      overdue: 'Overdue',
      thisWeek: 'Due this week',
      thisMonth: 'Due this month',
      holidays: 'KSA holidays',
    },
    legend: {
      holiday: 'KSA holiday',
      today: 'Today',
      weekend: 'Weekend',
    },
    agenda: {
      today: 'Today',
      empty: 'No upcoming events',
    },
    empty: {
      title: 'Nothing scheduled',
      description: 'No dated legal items were found across the suite.',
      filtered: 'No events match the current filters.',
    },
    error: {
      title: 'Unable to load the calendar',
      description:
        'One or more legal data sources could not be reached. Please try again.',
      retry: 'Retry',
    },
    more: (n) => `+${n} more`,
    type: {
      hearing: 'Hearing',
      contract_renewal: 'Contract renewal',
      contract_expiry: 'Contract expiry',
      signature_deadline: 'Signature deadline',
      obligation: 'Obligation',
      settlement_milestone: 'Settlement milestone',
      service_sla: 'Service-desk SLA',
    },
    severity: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Informational',
    },
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  ar: {
    eyebrow: 'التقويم القانوني الموحّد',
    title: 'التقويم القانوني',
    description:
      'كل التزام مؤرّخ عبر المجموعة القانونية — الجلسات والتجديدات والتواقيع والمواعيد النهائية واتفاقيات مستوى الخدمة — على تقويم ميلادي وهجري واحد.',
    views: { month: 'شهر', agenda: 'قائمة' },
    filters: {
      heading: 'عوامل التصفية',
      types: 'النوع',
      severities: 'الأهمية',
      all: 'الكل',
      clear: 'مسح',
      showingAll: 'عرض جميع الأحداث',
      activeSuffix: 'نشِط',
    },
    kpis: {
      total: 'إجمالي الأحداث',
      overdue: 'متأخّرة',
      thisWeek: 'مستحقّة هذا الأسبوع',
      thisMonth: 'مستحقّة هذا الشهر',
      holidays: 'عطل رسمية',
    },
    legend: {
      holiday: 'عطلة رسمية',
      today: 'اليوم',
      weekend: 'نهاية الأسبوع',
    },
    agenda: {
      today: 'اليوم',
      empty: 'لا توجد أحداث قادمة',
    },
    empty: {
      title: 'لا شيء مجدول',
      description: 'لم يتم العثور على عناصر قانونية مؤرّخة عبر المجموعة القانونية.',
      filtered: 'لا توجد أحداث مطابقة لعوامل التصفية الحالية.',
    },
    error: {
      title: 'تعذّر تحميل التقويم',
      description:
        'تعذّر الوصول إلى مصدر أو أكثر من مصادر البيانات القانونية. يُرجى المحاولة مرة أخرى.',
      retry: 'إعادة المحاولة',
    },
    more: (n) => `+${n} المزيد`,
    type: {
      hearing: 'جلسة',
      contract_renewal: 'تجديد عقد',
      contract_expiry: 'انتهاء عقد',
      signature_deadline: 'موعد توقيع',
      obligation: 'التزام',
      settlement_milestone: 'مرحلة تسوية',
      service_sla: 'مستوى خدمة',
    },
    severity: {
      critical: 'حرِجة',
      high: 'عالية',
      medium: 'متوسطة',
      low: 'منخفضة',
      info: 'إرشادية',
    },
    weekdays: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],
  },
};

// Unified i18n registration: string leaves resolvable via useT('lex.calendar').
registerMessages('lex.calendar', labels);

export function useCalendarLabels(): CalendarLabels {
  return useBilingual(labels);
}
