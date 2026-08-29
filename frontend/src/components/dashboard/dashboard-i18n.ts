'use client';

/**
 * Dashboard widgets — central bilingual strings.
 *
 * The dashboard hub (hero, KPI cards, metrics strip, alerts/tasks tables,
 * activity feed, onboarding checklist, critical-alerts banner) was originally
 * authored English-only. This module carries the Arabic mirror and resolves it
 * against the active locale via `useBilingual` — the same inline en/ar pattern
 * the suites launcher and widget board already use, so no shared catalog edits
 * are required and each widget stays self-contained.
 *
 * Number/date VALUES are formatted through the canonical `@/lib/format`
 * helpers (`formatNumber`, `formatRelativeAt`, `formatGregorian`) so Arabic
 * mode gets Arabic-Indic digits and correct relative-time wording.
 */

import { useBilingual } from '@/components/providers/locale-provider';

interface DashboardStrings {
  hero: {
    eyebrow: string;
    /** Composed as `${greeting} ${name}` so the Latin name stays isolated. */
    greeting: string;
    descTenant: string;
    descWorkspace: string;
    activeSuites: string;
    today: string;
  };
  kpi: {
    sectionLabel: string;
    openAlerts: string;
    failedPipelines: string;
    pendingTasks: string;
    dataQuality: string;
    trend24h: string;
    trendOverdue: string;
    trendPassRate: string;
  };
  freshness: {
    updated: string;
    waiting: string;
    live: string;
    fallback: string;
    refresh: string;
    refreshing: string;
    resume: string;
  };
  metrics: {
    mttr: string;
    mtta: string;
    sla: string;
    incidents: string;
    users: string;
    reviews: string;
    /** Unit suffixes for durations. */
    unitDay: string;
    unitHour: string;
    unitMinute: string;
  };
  alerts: {
    title: string;
    viewAll: string;
    newDetected: string;
    show: string;
    loadFailed: string;
    emptyTitle: string;
    emptyHint: string;
    colSeverity: string;
    colTitle: string;
    colStatus: string;
    colTime: string;
    severity: Record<string, string>;
    status: Record<string, string>;
  };
  tasks: {
    title: string;
    viewAll: string;
    unavailableTitle: string;
    unavailableHint: string;
    loadFailed: string;
    allCaughtUpTitle: string;
    allCaughtUpHint: string;
    due: string;
    overduePrefix: string;
    status: Record<string, string>;
  };
  banner: {
    /** Composed as `${count} ${itemsRequireAttention}`. */
    itemsRequireAttention: string;
    criticalAlerts: string;
    highSeverity: string;
    mediumSeverity: string;
    dismiss: string;
  };
  activity: {
    title: string;
    eventsSuffix: string;
    unavailableTitle: string;
    unavailableHint: string;
    loadFailed: string;
    retry: string;
    emptyTitle: string;
    emptyHint: string;
  };
  onboarding: {
    allSetTitle: string;
    getStartedTitle: string;
    allSetHint: string;
    getStartedHint: string;
    dismiss: string;
    go: string;
    markDone: string;
    progressLabel: string;
    steps: Record<
      string,
      { title: string; description: string }
    >;
  };
}

const EN: DashboardStrings = {
  hero: {
    eyebrow: 'Operational Overview',
    greeting: 'Welcome back,',
    descTenant: 'Monitoring cross-suite activity for',
    descWorkspace: 'Monitoring cross-suite activity across your workspace.',
    activeSuites: 'Active Suites',
    today: 'Today',
  },
  kpi: {
    sectionLabel: 'Key performance indicators',
    openAlerts: 'Open Alerts',
    failedPipelines: 'Failed Pipelines',
    pendingTasks: 'Pending Tasks',
    dataQuality: 'Data Quality',
    trend24h: '24h',
    trendOverdue: 'overdue',
    trendPassRate: 'pass rate',
  },
  freshness: {
    updated: 'Updated',
    waiting: 'Waiting for the first update',
    live: 'Live',
    fallback: 'Auto-refreshing every minute',
    refresh: 'Refresh dashboard data',
    refreshing: 'Refreshing dashboard data',
    resume: 'Resume live updates',
  },
  metrics: {
    mttr: 'MTTR',
    mtta: 'MTTA',
    sla: 'SLA Compliance',
    incidents: 'Active Incidents',
    users: 'Active Users',
    reviews: 'Pending Reviews',
    unitDay: 'd',
    unitHour: 'h',
    unitMinute: 'min',
  },
  alerts: {
    title: 'Recent Alerts',
    viewAll: 'View all',
    newDetected: 'New alert detected',
    show: 'Show',
    loadFailed: 'Failed to load alerts',
    emptyTitle: 'No alerts found',
    emptyHint: 'No recent alerts to display.',
    colSeverity: 'Severity',
    colTitle: 'Title',
    colStatus: 'Status',
    colTime: 'Time',
    severity: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Info',
    },
    status: {
      new: 'New',
      acknowledged: 'Acknowledged',
      investigating: 'Investigating',
      resolved: 'Resolved',
      false_positive: 'False positive',
    },
  },
  tasks: {
    title: 'My Tasks',
    viewAll: 'View all',
    unavailableTitle: 'Tasks unavailable',
    unavailableHint: 'Your current role has limited workflow access.',
    loadFailed: 'Failed to load tasks',
    allCaughtUpTitle: 'All caught up!',
    allCaughtUpHint: 'No pending tasks.',
    due: 'Due',
    overduePrefix: 'Overdue',
    status: {
      pending: 'Pending',
      claimed: 'Claimed',
      overdue: 'Overdue',
    },
  },
  banner: {
    itemsRequireAttention: 'Items Require Attention',
    criticalAlerts: 'Critical Alerts',
    highSeverity: 'High Severity',
    mediumSeverity: 'Medium Severity',
    dismiss: 'Dismiss critical alerts',
  },
  activity: {
    title: 'Live Activity',
    eventsSuffix: 'events',
    unavailableTitle: 'Activity unavailable',
    unavailableHint: 'Your current role has limited audit access.',
    loadFailed: 'Failed to load activity',
    retry: 'Retry',
    emptyTitle: 'All quiet',
    emptyHint: 'No recent activity in the last 7 days.',
  },
  onboarding: {
    allSetTitle: "You're all set",
    getStartedTitle: 'Get started with Clario360',
    allSetHint: 'You can dismiss this guide.',
    getStartedHint: 'A few quick steps to set up your workspace.',
    dismiss: 'Dismiss getting started',
    go: 'Go',
    markDone: 'Mark done',
    progressLabel: 'Getting started progress',
    steps: {
      profile: {
        title: 'Complete your profile',
        description: 'Add your details and secure your account with MFA.',
      },
      team: {
        title: 'Invite your team',
        description: 'Bring colleagues into your workspace.',
      },
      roles: {
        title: 'Set up roles & access',
        description: 'Define who can see and do what.',
      },
      integrations: {
        title: 'Connect integrations',
        description: 'Wire in your data sources and tools.',
      },
      billing: {
        title: 'Review your plan & usage',
        description: 'Check quotas and choose the right plan.',
      },
    },
  },
};

const AR: DashboardStrings = {
  hero: {
    eyebrow: 'نظرة تشغيلية عامة',
    greeting: 'مرحبًا بعودتك،',
    descTenant: 'متابعة النشاط عبر جميع الحزم لدى',
    descWorkspace: 'متابعة النشاط عبر جميع الحزم في مساحة عملك.',
    activeSuites: 'الحزم النشطة',
    today: 'اليوم',
  },
  kpi: {
    sectionLabel: 'مؤشرات الأداء الرئيسية',
    openAlerts: 'التنبيهات المفتوحة',
    failedPipelines: 'المسارات المتعثّرة',
    pendingTasks: 'المهام المعلّقة',
    dataQuality: 'جودة البيانات',
    trend24h: 'خلال ٢٤ ساعة',
    trendOverdue: 'متأخرة',
    trendPassRate: 'نسبة النجاح',
  },
  freshness: {
    updated: 'آخر تحديث',
    waiting: 'في انتظار التحديث الأول',
    live: 'مباشر',
    fallback: 'تحديث تلقائي كل دقيقة',
    refresh: 'تحديث بيانات لوحة المعلومات',
    refreshing: 'جارٍ تحديث بيانات لوحة المعلومات',
    resume: 'استئناف التحديثات المباشرة',
  },
  metrics: {
    mttr: 'زمن الإصلاح',
    mtta: 'زمن الاستجابة',
    sla: 'الالتزام باتفاقية الخدمة',
    incidents: 'الحوادث النشطة',
    users: 'المستخدمون النشطون',
    reviews: 'المراجعات المعلّقة',
    unitDay: 'ي',
    unitHour: 'س',
    unitMinute: 'د',
  },
  alerts: {
    title: 'أحدث التنبيهات',
    viewAll: 'عرض الكل',
    newDetected: 'تم رصد تنبيه جديد',
    show: 'عرض',
    loadFailed: 'تعذّر تحميل التنبيهات',
    emptyTitle: 'لا توجد تنبيهات',
    emptyHint: 'لا توجد تنبيهات حديثة للعرض.',
    colSeverity: 'الخطورة',
    colTitle: 'العنوان',
    colStatus: 'الحالة',
    colTime: 'الوقت',
    severity: {
      critical: 'حرجة',
      high: 'عالية',
      medium: 'متوسطة',
      low: 'منخفضة',
      info: 'معلوماتية',
    },
    status: {
      new: 'جديد',
      acknowledged: 'مُستلَم',
      investigating: 'قيد التحقيق',
      resolved: 'مُعالَج',
      false_positive: 'إنذار كاذب',
    },
  },
  tasks: {
    title: 'مهامي',
    viewAll: 'عرض الكل',
    unavailableTitle: 'المهام غير متاحة',
    unavailableHint: 'دورك الحالي يملك وصولاً محدوداً إلى سير العمل.',
    loadFailed: 'تعذّر تحميل المهام',
    allCaughtUpTitle: 'أنجزت كل شيء!',
    allCaughtUpHint: 'لا توجد مهام معلّقة.',
    due: 'الاستحقاق',
    overduePrefix: 'متأخرة',
    status: {
      pending: 'معلّقة',
      claimed: 'مُستلَمة',
      overdue: 'متأخرة',
    },
  },
  banner: {
    itemsRequireAttention: 'عناصر تتطلب الانتباه',
    criticalAlerts: 'تنبيهات حرجة',
    highSeverity: 'خطورة عالية',
    mediumSeverity: 'خطورة متوسطة',
    dismiss: 'إغلاق التنبيهات الحرجة',
  },
  activity: {
    title: 'النشاط المباشر',
    eventsSuffix: 'حدث',
    unavailableTitle: 'النشاط غير متاح',
    unavailableHint: 'دورك الحالي يملك وصولاً محدوداً إلى سجل التدقيق.',
    loadFailed: 'تعذّر تحميل النشاط',
    retry: 'إعادة المحاولة',
    emptyTitle: 'كل شيء هادئ',
    emptyHint: 'لا يوجد نشاط خلال آخر ٧ أيام.',
  },
  onboarding: {
    allSetTitle: 'كل شيء جاهز',
    getStartedTitle: 'ابدأ مع Clario360',
    allSetHint: 'يمكنك إغلاق هذا الدليل.',
    getStartedHint: 'بضع خطوات سريعة لإعداد مساحة عملك.',
    dismiss: 'إغلاق دليل البدء',
    go: 'انتقال',
    markDone: 'وضع علامة الإنجاز',
    progressLabel: 'تقدّم خطوات البدء',
    steps: {
      profile: {
        title: 'أكمل ملفك الشخصي',
        description: 'أضف بياناتك وأمّن حسابك بالمصادقة الثنائية.',
      },
      team: {
        title: 'ادعُ فريقك',
        description: 'أضف زملاءك إلى مساحة العمل.',
      },
      roles: {
        title: 'إعداد الأدوار والصلاحيات',
        description: 'حدّد من يرى ومن ينفّذ ماذا.',
      },
      integrations: {
        title: 'اربط التكاملات',
        description: 'اربط مصادر بياناتك وأدواتك.',
      },
      billing: {
        title: 'راجع خطتك واستهلاكك',
        description: 'تحقّق من الحصص واختر الخطة المناسبة.',
      },
    },
  },
};

const DASHBOARD_BUNDLE = { en: EN, ar: AR } as const;

/** Resolve all dashboard widget strings for the active locale. */
export function useDashboardText(): DashboardStrings {
  return useBilingual(DASHBOARD_BUNDLE);
}
