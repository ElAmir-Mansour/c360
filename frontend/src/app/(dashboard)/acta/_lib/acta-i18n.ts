/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Acta board-governance suite (`/acta`).
 *
 * Mirrors the cyber/lex i18n pattern: every label group is a bilingual bundle
 * `{ en, ar }` (two FULL, same-shaped copies of the label object — English in
 * `en`, professional Saudi-register MSA in `ar`). Components receive the
 * resolved `T` via a thin `use<Feature>Labels()` hook (React) or
 * `resolveActaBilingual()` (non-React / tests).
 *
 * Resolution defaults to English when no LocaleProvider is mounted (mirroring
 * `useLocaleOrDefault`), so the `en` side of every bundle MUST equal the
 * pre-existing English strings VERBATIM.
 *
 * Product names / acronyms stay as-is across both locales: Acta.
 *
 * Registered into the namespace registry as the 'acta' namespace, so any
 * component can ALSO resolve string leaves with `useT('acta')` with automatic
 * fallback to the global catalog.
 */

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

/** The canonical bundle shape for every acta label group. */
export type ActaBilingual<T> = { readonly en: T; readonly ar: T };

/** Returns the `T` for `locale`, falling back to English. */
export function resolveActaBilingual<T>(bundle: ActaBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

// ---------------------------------------------------------------------------
// Shared common terms (used across the suite)
// ---------------------------------------------------------------------------

export interface ActaCommonLabels {
  eyebrow: string;
  refresh: string;
  retry: string;
  cancel: string;
  save: string;
  viewAll: string;
  fullReport: string;
  openTracker: string;
  allMeetings: string;
  minutesUnit: string;
  quorumMet: string;
  quorumNotMet: string;
  quorumPending: string;
  locationTbd: string;
  noDescription: string;
}

export const actaCommonLabels: ActaBilingual<ActaCommonLabels> = {
  en: {
    eyebrow: 'Acta · Board Governance',
    refresh: 'Refresh',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    viewAll: 'View all',
    fullReport: 'Full report',
    openTracker: 'Open tracker',
    allMeetings: 'All meetings',
    minutesUnit: 'min',
    quorumMet: 'Quorum met',
    quorumNotMet: 'Quorum not met',
    quorumPending: 'Quorum pending',
    locationTbd: 'Location to be confirmed',
    noDescription: 'No description provided',
  },
  ar: {
    eyebrow: 'أكتا · حوكمة المجالس',
    refresh: 'تحديث',
    retry: 'إعادة المحاولة',
    cancel: 'إلغاء',
    save: 'حفظ',
    viewAll: 'عرض الكل',
    fullReport: 'التقرير الكامل',
    openTracker: 'فتح المتتبِّع',
    allMeetings: 'كل الاجتماعات',
    minutesUnit: 'دقيقة',
    quorumMet: 'اكتمل النصاب',
    quorumNotMet: 'لم يكتمل النصاب',
    quorumPending: 'النصاب قيد التحديد',
    locationTbd: 'سيُحدَّد المكان لاحقًا',
    noDescription: 'لا يوجد وصف',
  },
};

export function useActaCommonLabels(): ActaCommonLabels {
  return useBilingual(actaCommonLabels);
}

// ---------------------------------------------------------------------------
// Board-governance landing dashboard (acta/page.tsx + _components/*)
// ---------------------------------------------------------------------------

export interface ActaDashboardLabels {
  title: string;
  description: string;
  loadingTitle: string;
  loadingDescription: string;
  loadError: string;
  // KPI cards
  kpiActiveCommittees: string;
  kpiActiveCommitteesDescription: string;
  kpiUpcomingMeetings: string;
  kpiUpcomingMeetingsDescription: string;
  kpiOpenActionItems: string;
  kpiOverdue: (count: number) => string;
  kpiNoOverdue: string;
  kpiComplianceScore: string;
  kpiMinutesPending: (count: number) => string;
  kpiAvgAttendance: (rate: number) => string;
  kpiOpenCompliance: string;
  kpiGovernanceGauge: string;
  // calendar widget
  calendarTitle: string;
  calendarDescription: string;
  prevMonth: string;
  nextMonth: string;
  selectDay: string;
  meetingsCount: (count: number) => string;
  noMeetingsForDay: string;
  weekDays: ReadonlyArray<string>;
  // upcoming meetings
  upcomingTitle: string;
  upcomingDescription: string;
  upcomingEmptyTitle: string;
  upcomingEmptyDescription: string;
  // overdue actions
  overdueTitle: string;
  overdueDescription: string;
  overdueEmptyTitle: string;
  overdueEmptyDescription: string;
  daysOverdue: (days: number) => string;
  dueOn: (date: string) => string;
  // compliance bars
  complianceTitle: string;
  complianceDescription: string;
  complianceEmptyTitle: string;
  complianceEmptyDescription: string;
  nonCompliantWarnings: (nonCompliant: number, warnings: number) => string;
}

export const actaDashboardLabels: ActaBilingual<ActaDashboardLabels> = {
  en: {
    title: 'Board Governance',
    description:
      'Committee operations, meeting readiness, action tracking, and compliance posture from live Acta APIs.',
    loadingTitle: 'Board Governance',
    loadingDescription: 'Board governance operations, meetings, and compliance',
    loadError: 'Failed to load board governance overview.',
    kpiActiveCommittees: 'Active Committees',
    kpiActiveCommitteesDescription: 'Board and governance committees',
    kpiUpcomingMeetings: 'Upcoming Meetings',
    kpiUpcomingMeetingsDescription: 'Scheduled within the next 30 days',
    kpiOpenActionItems: 'Open Action Items',
    kpiOverdue: (count) => `${count} overdue`,
    kpiNoOverdue: 'No overdue items',
    kpiComplianceScore: 'Compliance Score',
    kpiMinutesPending: (count) => `Minutes pending approval: ${count}`,
    kpiAvgAttendance: (rate) => `Avg attendance: ${rate}%`,
    kpiOpenCompliance: 'Open compliance',
    kpiGovernanceGauge: 'Governance',
    calendarTitle: 'Meeting Calendar',
    calendarDescription: 'Monthly view of scheduled committee sessions.',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    selectDay: 'Select a day',
    meetingsCount: (count) => `${count} meeting${count === 1 ? '' : 's'}`,
    noMeetingsForDay: 'No meetings scheduled for the selected day.',
    weekDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    upcomingTitle: 'Upcoming Meetings',
    upcomingDescription: 'Next scheduled committee sessions.',
    upcomingEmptyTitle: 'No upcoming meetings',
    upcomingEmptyDescription:
      'The schedule is currently clear for the next committee sessions.',
    overdueTitle: 'Overdue Action Items',
    overdueDescription: 'Top overdue follow-ups across committees.',
    overdueEmptyTitle: 'No overdue items',
    overdueEmptyDescription: 'Action items are currently within due dates.',
    daysOverdue: (days) => `${days} day${days === 1 ? '' : 's'} overdue`,
    dueOn: (date) => `Due ${date}`,
    complianceTitle: 'Compliance By Committee',
    complianceDescription: 'Committee-level governance scorecards from the latest checks.',
    complianceEmptyTitle: 'No compliance data',
    complianceEmptyDescription:
      'Run the Acta compliance engine to populate committee scorecards.',
    nonCompliantWarnings: (nonCompliant, warnings) =>
      `${nonCompliant} non-compliant • ${warnings} warnings`,
  },
  ar: {
    title: 'حوكمة المجالس',
    description:
      'عمليات اللجان، وجاهزية الاجتماعات، وتتبُّع الإجراءات، ومستوى الامتثال من واجهات أكتا الحية.',
    loadingTitle: 'حوكمة المجالس',
    loadingDescription: 'عمليات حوكمة المجالس والاجتماعات والامتثال',
    loadError: 'تعذّر تحميل نظرة عامة على حوكمة المجالس.',
    kpiActiveCommittees: 'اللجان النشطة',
    kpiActiveCommitteesDescription: 'لجان المجلس والحوكمة',
    kpiUpcomingMeetings: 'الاجتماعات القادمة',
    kpiUpcomingMeetingsDescription: 'المجدولة خلال الثلاثين يومًا القادمة',
    kpiOpenActionItems: 'بنود العمل المفتوحة',
    kpiOverdue: (count) => `${count} متأخِّر`,
    kpiNoOverdue: 'لا توجد بنود متأخرة',
    kpiComplianceScore: 'درجة الامتثال',
    kpiMinutesPending: (count) => `المحاضر بانتظار الاعتماد: ${count}`,
    kpiAvgAttendance: (rate) => `متوسط الحضور: ${rate}%`,
    kpiOpenCompliance: 'فتح الامتثال',
    kpiGovernanceGauge: 'الحوكمة',
    calendarTitle: 'تقويم الاجتماعات',
    calendarDescription: 'عرض شهري لجلسات اللجان المجدولة.',
    prevMonth: 'الشهر السابق',
    nextMonth: 'الشهر التالي',
    selectDay: 'اختر يومًا',
    meetingsCount: (count) => `${count} اجتماع`,
    noMeetingsForDay: 'لا توجد اجتماعات مجدولة في اليوم المحدد.',
    weekDays: ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
    upcomingTitle: 'الاجتماعات القادمة',
    upcomingDescription: 'جلسات اللجان المجدولة التالية.',
    upcomingEmptyTitle: 'لا توجد اجتماعات قادمة',
    upcomingEmptyDescription: 'الجدول خالٍ حاليًا من جلسات اللجان القادمة.',
    overdueTitle: 'بنود العمل المتأخرة',
    overdueDescription: 'أبرز المتابعات المتأخرة عبر اللجان.',
    overdueEmptyTitle: 'لا توجد بنود متأخرة',
    overdueEmptyDescription: 'بنود العمل ضمن تواريخ استحقاقها حاليًا.',
    daysOverdue: (days) => `متأخِّر ${days} يوم`,
    dueOn: (date) => `تُستحق في ${date}`,
    complianceTitle: 'الامتثال حسب اللجنة',
    complianceDescription: 'بطاقات أداء الحوكمة على مستوى اللجان من أحدث الفحوصات.',
    complianceEmptyTitle: 'لا توجد بيانات امتثال',
    complianceEmptyDescription: 'شغِّل محرك امتثال أكتا لتعبئة بطاقات أداء اللجان.',
    nonCompliantWarnings: (nonCompliant, warnings) =>
      `${nonCompliant} غير ممتثل • ${warnings} تحذيرات`,
  },
};

export function useActaDashboardLabels(): ActaDashboardLabels {
  return useBilingual(actaDashboardLabels);
}

// ---------------------------------------------------------------------------
// Meeting status / lifecycle enum labels
// ---------------------------------------------------------------------------

/** Meeting status enum keys → display label. Falls back to humanized key. */
export const actaMeetingStatusLabels: ActaBilingual<Record<string, string>> = {
  en: {
    scheduled: 'Scheduled',
    draft: 'Draft',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    postponed: 'Postponed',
    adjourned: 'Adjourned',
  },
  ar: {
    scheduled: 'مجدول',
    draft: 'مسودة',
    in_progress: 'قيد الانعقاد',
    completed: 'مكتمل',
    cancelled: 'ملغى',
    postponed: 'مؤجل',
    adjourned: 'مرفوع',
  },
};

export function useActaMeetingStatusLabels(): Record<string, string> {
  return useBilingual(actaMeetingStatusLabels);
}

/** Action-item priority enum keys → display label. */
export const actaPriorityLabels: ActaBilingual<Record<string, string>> = {
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  ar: {
    critical: 'حرج',
    high: 'عالٍ',
    medium: 'متوسط',
    low: 'منخفض',
  },
};

export function useActaPriorityLabels(): Record<string, string> {
  return useBilingual(actaPriorityLabels);
}

/** Action-item status enum keys → display label. */
export const actaActionStatusLabels: ActaBilingual<Record<string, string>> = {
  en: {
    open: 'Open',
    pending: 'Pending',
    in_progress: 'In Progress',
    blocked: 'Blocked',
    completed: 'Completed',
    cancelled: 'Cancelled',
    overdue: 'Overdue',
  },
  ar: {
    open: 'مفتوح',
    pending: 'قيد الانتظار',
    in_progress: 'قيد التنفيذ',
    blocked: 'معطَّل',
    completed: 'مكتمل',
    cancelled: 'ملغى',
    overdue: 'متأخر',
  },
};

export function useActaActionStatusLabels(): Record<string, string> {
  return useBilingual(actaActionStatusLabels);
}

// ---------------------------------------------------------------------------
// List pages (meetings / committees / action items) — one nested group each
// ---------------------------------------------------------------------------

export interface ActaListLabels {
  meetings: {
    title: string;
    description: string;
    viewTable: string;
    viewCalendar: string;
    schedule: string;
    kpiTotal: string;
    kpiScheduled: string;
    kpiCompleted: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  committees: {
    title: string;
    description: string;
    searchPlaceholder: string;
    loadError: string;
  };
  actionItems: {
    title: string;
    description: string;
    viewTable: string;
    viewKanban: string;
    create: string;
    kpiOpen: string;
    kpiOverdue: string;
    kpiCompleted: string;
    tabAll: string;
    tabMy: string;
    tabOverdue: string;
    tabCompleted: string;
    searchPlaceholder: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    toastUpdatedTitle: string;
    toastUpdatedBody: string;
  };
}

export const actaListLabels: ActaBilingual<ActaListLabels> = {
  en: {
    meetings: {
      title: 'Meetings',
      description: 'Schedule, track, and conduct board and committee meetings.',
      viewTable: 'Table',
      viewCalendar: 'Calendar',
      schedule: 'Schedule Meeting',
      kpiTotal: 'Total meetings',
      kpiScheduled: 'Scheduled',
      kpiCompleted: 'Completed',
      emptyTitle: 'No meetings found',
      emptyDescription: 'No meetings matched the current filters.',
    },
    committees: {
      title: 'Committees',
      description: 'Board and governance committee roster, cadence, and operating profile.',
      searchPlaceholder: 'Search committees...',
      loadError: 'Failed to load committees.',
    },
    actionItems: {
      title: 'Action Items',
      description: 'Track governance follow-ups in table or kanban view.',
      viewTable: 'Table',
      viewKanban: 'Kanban',
      create: 'Create Action',
      kpiOpen: 'Open',
      kpiOverdue: 'Overdue',
      kpiCompleted: 'Completed',
      tabAll: 'All',
      tabMy: 'My Items',
      tabOverdue: 'Overdue',
      tabCompleted: 'Completed',
      searchPlaceholder: 'Search action items...',
      loadError: 'Failed to load action items.',
      emptyTitle: 'No action items',
      emptyDescription: 'No action items matched the current scope.',
      toastUpdatedTitle: 'Action item updated.',
      toastUpdatedBody: 'The action item status has been changed.',
    },
  },
  ar: {
    meetings: {
      title: 'الاجتماعات',
      description: 'جدولة اجتماعات المجلس واللجان وتتبُّعها وعقدها.',
      viewTable: 'جدول',
      viewCalendar: 'تقويم',
      schedule: 'جدولة اجتماع',
      kpiTotal: 'إجمالي الاجتماعات',
      kpiScheduled: 'مجدولة',
      kpiCompleted: 'مكتملة',
      emptyTitle: 'لا توجد اجتماعات',
      emptyDescription: 'لا توجد اجتماعات مطابقة للمرشحات الحالية.',
    },
    committees: {
      title: 'اللجان',
      description: 'سجل لجان المجلس والحوكمة وإيقاعها وملفها التشغيلي.',
      searchPlaceholder: 'ابحث في اللجان...',
      loadError: 'تعذّر تحميل اللجان.',
    },
    actionItems: {
      title: 'بنود العمل',
      description: 'تتبُّع متابعات الحوكمة في عرض الجدول أو لوحة كانبان.',
      viewTable: 'جدول',
      viewKanban: 'كانبان',
      create: 'إنشاء بند',
      kpiOpen: 'مفتوحة',
      kpiOverdue: 'متأخرة',
      kpiCompleted: 'مكتملة',
      tabAll: 'الكل',
      tabMy: 'بنودي',
      tabOverdue: 'المتأخرة',
      tabCompleted: 'المكتملة',
      searchPlaceholder: 'ابحث في بنود العمل...',
      loadError: 'تعذّر تحميل بنود العمل.',
      emptyTitle: 'لا توجد بنود عمل',
      emptyDescription: 'لا توجد بنود عمل مطابقة للنطاق الحالي.',
      toastUpdatedTitle: 'تم تحديث بند العمل.',
      toastUpdatedBody: 'تم تغيير حالة بند العمل.',
    },
  },
};

export function useActaListLabels(): ActaListLabels {
  return useBilingual(actaListLabels);
}

/* ------------------------------------------------------------------------- *
 * Unified i18n registration — exposes string leaves to `useT('acta')`.
 * ------------------------------------------------------------------------- */
registerMessages('acta', {
  en: {
    common: actaCommonLabels.en,
    dashboard: actaDashboardLabels.en,
    meetingStatus: actaMeetingStatusLabels.en,
    priority: actaPriorityLabels.en,
    actionStatus: actaActionStatusLabels.en,
    list: actaListLabels.en,
  },
  ar: {
    common: actaCommonLabels.ar,
    dashboard: actaDashboardLabels.ar,
    meetingStatus: actaMeetingStatusLabels.ar,
    priority: actaPriorityLabels.ar,
    actionStatus: actaActionStatusLabels.ar,
    list: actaListLabels.ar,
  },
});
