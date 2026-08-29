/**
 * Feature-local label bundle for the drill calendar + cadence-enforcement
 * surface.
 *
 * Adopts the foundation bilingual contract: the label group is a
 * `DRBilingual<DrillCalendarLabels> = { en, ar }` bundle of two FULL,
 * identically-shaped copies — the original English in `en` (unchanged so the
 * English-asserting tests stay green) and professional Modern Standard Arabic in
 * `ar`. Function-valued fields (`attentionSummary`, `dayRunCount`, `overdueBy`,
 * `dueIn`) and the nested `status` record appear in BOTH sides with the same
 * signatures; only the literal copy differs and interpolation params / Western
 * digits are preserved. Acronyms (RTO) are kept and glossed in Arabic.
 *
 * RTL is handled by logical Tailwind props in the components; this file is copy
 * only. Components resolve the active-locale copy via {@link useDrillCalendarLabels}
 * (under the `renderWithQuery` `en` default this yields English).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../../_lib/dr-i18n';
import type { DrillCadenceStatus } from './drill-cadence';

export interface DrillCalendarLabels {
  /** Section heading + supporting copy. */
  title: string;
  description: string;

  /** View toggle. */
  viewCalendar: string;
  viewList: string;
  viewCalendarTab: string;
  viewListTab: string;

  /** Attention banner. */
  attentionTitleOverdue: string;
  attentionTitleDueSoon: string;
  attentionAllClearTitle: string;
  attentionAllClearDescription: string;
  /** "{overdue} overdue, {dueSoon} due soon across {total} schedules" */
  attentionSummary: (overdue: number, dueSoon: number, total: number) => string;

  /** Cadence status badge text, keyed by status token. */
  status: Record<DrillCadenceStatus, string>;

  /** Calendar grid. */
  monthGridAriaLabel: string;
  prevMonth: string;
  nextMonth: string;
  today: string;
  weekdayHeaders: readonly [string, string, string, string, string, string, string];
  /** "{count} drill runs" used as a day-cell tooltip / aria description. */
  dayRunCount: (count: number) => string;

  /** List view + schedule rows. */
  scheduleColumn: string;
  cadenceColumn: string;
  nextRunColumn: string;
  lastRunColumn: string;
  statusColumn: string;
  nextRunPrefix: string;
  lastRunPrefix: string;
  neverRun: string;
  cadencePrefix: string;
  rtoObjectivePrefix: string;
  /** "{value} overdue" — value is a coarse horizon like "3d". */
  overdueBy: (value: string) => string;
  /** "due in {value}" */
  dueIn: (value: string) => string;
  /** Coarse-horizon word for a boundary less than a minute away ("now"). */
  cadenceNow: string;

  /** Empty / error states. */
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  loading: string;
}

export const drillCalendarLabels: DRBilingual<DrillCalendarLabels> = {
  en: {
    title: 'Drill calendar',
    description:
      'Scheduled isolated drills plotted against their cron cadence, with overdue and due-soon enforcement computed from each schedule and its last result.',

    viewCalendar: 'Calendar view',
    viewList: 'List view',
    viewCalendarTab: 'Calendar',
    viewListTab: 'Schedules',

    attentionTitleOverdue: 'Drill cadence breached',
    attentionTitleDueSoon: 'Drills due soon',
    attentionAllClearTitle: 'Drill cadence on track',
    attentionAllClearDescription:
      'Every enabled drill schedule has run within its cadence. No drill is overdue or imminently due.',
    attentionSummary: (overdue, dueSoon, total) =>
      `${overdue} overdue, ${dueSoon} due soon across ${total} schedules.`,

    status: {
      overdue: 'Overdue',
      due_soon: 'Due soon',
      on_track: 'On track',
      paused: 'Paused',
    },

    monthGridAriaLabel: 'Drill schedule calendar',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    weekdayHeaders: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dayRunCount: (count) => `${count} drill ${count === 1 ? 'run' : 'runs'}`,

    scheduleColumn: 'Schedule',
    cadenceColumn: 'Cadence',
    nextRunColumn: 'Next run',
    lastRunColumn: 'Last run',
    statusColumn: 'Cadence status',
    nextRunPrefix: 'Next',
    lastRunPrefix: 'Last',
    neverRun: 'Never run',
    cadencePrefix: 'Cron',
    rtoObjectivePrefix: 'RTO target',
    overdueBy: (value) => `${value} overdue`,
    dueIn: (value) => `due in ${value}`,
    cadenceNow: 'now',

    emptyTitle: 'No drill schedules',
    emptyDescription:
      'Create an isolated drill schedule to plot upcoming runs and enforce a rehearsal cadence here.',
    errorTitle: 'Could not load drill schedules',
    errorDescription: 'The drill schedule feed is unavailable. Retry to reload the calendar.',
    retry: 'Retry',
    loading: 'Loading drill schedules…',
  },
  ar: {
    title: 'تقويم التمارين',
    description:
      'تمارين معزولة مجدولة مرسومة وفق وتيرتها الزمنية (cron)، مع تطبيق حالتي «متأخر» و«قريب الاستحقاق» المحسوبتين من كل جدول ونتيجته الأخيرة.',

    viewCalendar: 'عرض التقويم',
    viewList: 'عرض القائمة',
    viewCalendarTab: 'التقويم',
    viewListTab: 'الجداول',

    attentionTitleOverdue: 'تم تجاوز وتيرة التمارين',
    attentionTitleDueSoon: 'تمارين قريبة الاستحقاق',
    attentionAllClearTitle: 'وتيرة التمارين ضمن المسار',
    attentionAllClearDescription:
      'نُفِّذ كل جدول تمارين مُفعَّل ضمن وتيرته الزمنية. لا يوجد تمرين متأخر أو وشيك الاستحقاق.',
    attentionSummary: (overdue, dueSoon, total) =>
      `${overdue} متأخر، ${dueSoon} قريب الاستحقاق من أصل ${total} جدول.`,

    status: {
      overdue: 'متأخر',
      due_soon: 'قريب الاستحقاق',
      on_track: 'ضمن المسار',
      paused: 'متوقف مؤقتًا',
    },

    monthGridAriaLabel: 'تقويم جداول التمارين',
    prevMonth: 'الشهر السابق',
    nextMonth: 'الشهر التالي',
    today: 'اليوم',
    weekdayHeaders: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    dayRunCount: (count) => `${count} ${count === 1 ? 'تمرين' : 'تمارين'}`,

    scheduleColumn: 'الجدول',
    cadenceColumn: 'الوتيرة',
    nextRunColumn: 'التشغيل التالي',
    lastRunColumn: 'آخر تشغيل',
    statusColumn: 'حالة الوتيرة',
    nextRunPrefix: 'التالي',
    lastRunPrefix: 'الأخير',
    neverRun: 'لم يُشغَّل قط',
    cadencePrefix: 'Cron',
    rtoObjectivePrefix: 'هدف زمن الاسترداد (RTO)',
    overdueBy: (value) => `متأخر بمقدار ${value}`,
    dueIn: (value) => `يُستحَق خلال ${value}`,
    cadenceNow: 'الآن',

    emptyTitle: 'لا توجد جداول تمارين',
    emptyDescription:
      'أنشئ جدول تمارين معزولًا لرسم التشغيلات القادمة وفرض وتيرة للتمرين هنا.',
    errorTitle: 'تعذّر تحميل جداول التمارين',
    errorDescription: 'موجز جداول التمارين غير متاح. أعد المحاولة لإعادة تحميل التقويم.',
    retry: 'إعادة المحاولة',
    loading: 'جارٍ تحميل جداول التمارين…',
  },
};

/**
 * useDrillCalendarLabels resolves the drill-calendar labels against the active
 * locale (English fallback / default), mirroring the shared `useDRLabels` hook.
 */
export function useDrillCalendarLabels(): DrillCalendarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(drillCalendarLabels, locale), [locale]);
}
