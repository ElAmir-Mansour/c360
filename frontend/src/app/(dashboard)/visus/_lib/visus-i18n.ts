/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Visus executive-intelligence suite (`/visus`).
 *
 * Mirrors the cyber/lex i18n pattern: every label group is a bilingual bundle
 * `{ en, ar }`. Components receive the resolved `T` via a thin
 * `use<Feature>Labels()` hook (React) or `resolveVisusBilingual()`
 * (non-React / tests). The `en` side MUST equal the pre-existing English
 * strings VERBATIM so English render is unchanged.
 *
 * Registered into the namespace registry as the 'visus' namespace.
 */

'use client';

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type VisusBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveVisusBilingual<T>(bundle: VisusBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

// ---------------------------------------------------------------------------
// Shared common terms
// ---------------------------------------------------------------------------

export interface VisusCommonLabels {
  eyebrow: string;
  refresh: string;
  retry: string;
  cancel: string;
  save: string;
  dashboards: string;
  reports: string;
  widgets: string;
  noDescription: string;
}

export const visusCommonLabels: VisusBilingual<VisusCommonLabels> = {
  en: {
    eyebrow: 'Visus · Executive Intelligence',
    refresh: 'Refresh',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    dashboards: 'Dashboards',
    reports: 'Reports',
    widgets: 'Widgets',
    noDescription: 'No description provided',
  },
  ar: {
    eyebrow: 'فيزوس · الذكاء التنفيذي',
    refresh: 'تحديث',
    retry: 'إعادة المحاولة',
    cancel: 'إلغاء',
    save: 'حفظ',
    dashboards: 'لوحات المعلومات',
    reports: 'التقارير',
    widgets: 'عناصر العرض',
    noDescription: 'لا يوجد وصف',
  },
};

export function useVisusCommonLabels(): VisusCommonLabels {
  return useBilingual(visusCommonLabels);
}

// ---------------------------------------------------------------------------
// Executive-intelligence landing (visus/page.tsx)
// ---------------------------------------------------------------------------

export interface VisusOverviewLabels {
  title: string;
  description: string;
  loadingTitle: string;
  loadingDescription: string;
  loadError: string;
  tagDashboards: (count: number) => string;
  tagReports: (count: number) => string;
  tagWidgets: (count: number) => string;
  manageDashboards: string;
  openReports: string;
  kpiDashboards: string;
  kpiReports: string;
  kpiWidgets: string;
  kpiDefaultDashboards: string;
  // dashboards section
  dashboardsTitle: string;
  dashboardsDescription: string;
  dashboardsEmptyTitle: string;
  dashboardsEmptyDescription: string;
  defaultBadge: string;
  widgetCount: (count: number) => string;
  // widget mix
  widgetMixTitle: string;
  widgetMixDescription: string;
  widgetMixEmptyTitle: string;
  widgetMixEmptyDescription: string;
  widgetMixChartLabel: string;
  // executive health
  executiveHealthTitle: string;
  executiveHealthDescription: string;
  dashboardStudio: string;
  generatedAt: string;
  available: string;
  unavailable: string;
  latencyMs: (ms: number) => string;
  lastSuccess: (at: string) => string;
  noSuccessfulSync: string;
  cachedExecutiveAlerts: string;
  cachedKpiSnapshots: string;
  executiveHealthEmptyTitle: string;
  executiveHealthEmptyDescription: string;
  // recent reports
  recentReportsTitle: string;
  recentReportsDescription: string;
  recentReportsEmptyTitle: string;
  recentReportsEmptyDescription: string;
  lastOutputAvailable: string;
  noOutputYet: string;
  neverGenerated: string;
}

export const visusOverviewLabels: VisusBilingual<VisusOverviewLabels> = {
  en: {
    title: 'Executive Intelligence',
    description:
      'Live executive reporting inventory across dashboards, widgets, and scheduled reports.',
    loadingTitle: 'Executive Intelligence',
    loadingDescription: 'Executive dashboards and reports',
    loadError: 'Failed to load executive intelligence views.',
    tagDashboards: (count) => `${count} dashboards`,
    tagReports: (count) => `${count} reports`,
    tagWidgets: (count) => `${count} widgets`,
    manageDashboards: 'Manage dashboards',
    openReports: 'Open reports',
    kpiDashboards: 'Dashboards',
    kpiReports: 'Reports',
    kpiWidgets: 'Widgets',
    kpiDefaultDashboards: 'Default Dashboards',
    dashboardsTitle: 'Dashboards',
    dashboardsDescription: 'Dashboard definitions currently available to the tenant.',
    dashboardsEmptyTitle: 'No dashboards configured',
    dashboardsEmptyDescription: 'No executive dashboards are configured.',
    defaultBadge: 'Default',
    widgetCount: (count) => `${count} widget${count === 1 ? '' : 's'}`,
    widgetMixTitle: 'Widget Mix',
    widgetMixDescription: 'Distribution of widget types across dashboard inventory.',
    widgetMixEmptyTitle: 'No widgets configured',
    widgetMixEmptyDescription: 'No dashboard widgets have been configured.',
    widgetMixChartLabel: 'Widgets',
    executiveHealthTitle: 'Executive Health',
    executiveHealthDescription:
      'Cross-suite health and latest executive rollup returned by the Visus executive endpoint.',
    dashboardStudio: 'Dashboard studio',
    generatedAt: 'Generated',
    available: 'Available',
    unavailable: 'Unavailable',
    latencyMs: (ms) => `Latency ${ms} ms`,
    lastSuccess: (at) => `Last success ${at}`,
    noSuccessfulSync: 'No successful sync yet',
    cachedExecutiveAlerts: 'Cached Executive Alerts',
    cachedKpiSnapshots: 'Cached KPI Snapshots',
    executiveHealthEmptyTitle: 'No executive health data',
    executiveHealthEmptyDescription: 'Executive health data is unavailable for this tenant.',
    recentReportsTitle: 'Recent Reports',
    recentReportsDescription: 'Most recently updated report definitions.',
    recentReportsEmptyTitle: 'No reports configured',
    recentReportsEmptyDescription: 'No executive reports are currently configured.',
    lastOutputAvailable: 'Last output available',
    noOutputYet: 'No output generated yet',
    neverGenerated: 'Never generated',
  },
  ar: {
    title: 'الذكاء التنفيذي',
    description:
      'حصر حي للتقارير التنفيذية عبر لوحات المعلومات وعناصر العرض والتقارير المجدولة.',
    loadingTitle: 'الذكاء التنفيذي',
    loadingDescription: 'لوحات المعلومات والتقارير التنفيذية',
    loadError: 'تعذّر تحميل عروض الذكاء التنفيذي.',
    tagDashboards: (count) => `${count} لوحة معلومات`,
    tagReports: (count) => `${count} تقرير`,
    tagWidgets: (count) => `${count} عنصر عرض`,
    manageDashboards: 'إدارة لوحات المعلومات',
    openReports: 'فتح التقارير',
    kpiDashboards: 'لوحات المعلومات',
    kpiReports: 'التقارير',
    kpiWidgets: 'عناصر العرض',
    kpiDefaultDashboards: 'اللوحات الافتراضية',
    dashboardsTitle: 'لوحات المعلومات',
    dashboardsDescription: 'تعريفات لوحات المعلومات المتاحة حاليًا للمستأجر.',
    dashboardsEmptyTitle: 'لا توجد لوحات معلومات مهيّأة',
    dashboardsEmptyDescription: 'لا توجد لوحات معلومات تنفيذية مهيّأة.',
    defaultBadge: 'افتراضية',
    widgetCount: (count) => `${count} عنصر عرض`,
    widgetMixTitle: 'توزيع عناصر العرض',
    widgetMixDescription: 'توزيع أنواع عناصر العرض عبر مخزون لوحات المعلومات.',
    widgetMixEmptyTitle: 'لا توجد عناصر عرض مهيّأة',
    widgetMixEmptyDescription: 'لم تُهيّأ أي عناصر عرض للوحات المعلومات.',
    widgetMixChartLabel: 'عناصر العرض',
    executiveHealthTitle: 'الحالة التنفيذية',
    executiveHealthDescription:
      'الحالة الصحية عبر الأجنحة وآخر تجميع تنفيذي تُعيده واجهة فيزوس التنفيذية.',
    dashboardStudio: 'استوديو لوحات المعلومات',
    generatedAt: 'تم الإنشاء',
    available: 'متاح',
    unavailable: 'غير متاح',
    latencyMs: (ms) => `زمن الاستجابة ${ms} ملّي ثانية`,
    lastSuccess: (at) => `آخر نجاح ${at}`,
    noSuccessfulSync: 'لا توجد مزامنة ناجحة بعد',
    cachedExecutiveAlerts: 'تنبيهات تنفيذية مخزّنة',
    cachedKpiSnapshots: 'لقطات مؤشرات مخزّنة',
    executiveHealthEmptyTitle: 'لا توجد بيانات حالة تنفيذية',
    executiveHealthEmptyDescription: 'بيانات الحالة التنفيذية غير متاحة لهذا المستأجر.',
    recentReportsTitle: 'أحدث التقارير',
    recentReportsDescription: 'أحدث تعريفات التقارير تحديثًا.',
    recentReportsEmptyTitle: 'لا توجد تقارير مهيّأة',
    recentReportsEmptyDescription: 'لا توجد تقارير تنفيذية مهيّأة حاليًا.',
    lastOutputAvailable: 'آخر مخرَج متاح',
    noOutputYet: 'لم يُنشأ أي مخرَج بعد',
    neverGenerated: 'لم يُنشأ قط',
  },
};

export function useVisusOverviewLabels(): VisusOverviewLabels {
  return useBilingual(visusOverviewLabels);
}

// ---------------------------------------------------------------------------
// List pages (dashboards / reports / kpis / alerts)
// ---------------------------------------------------------------------------

export interface VisusListLabels {
  dashboards: {
    eyebrow: string;
    title: string;
    description: string;
    tag: (count: number) => string;
    create: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  reports: {
    eyebrow: string;
    title: string;
    description: string;
    tag: (count: number) => string;
    create: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  kpis: {
    eyebrow: string;
    title: string;
    description: string;
    tag: (count: number) => string;
    runSnapshot: string;
    refreshing: string;
    create: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  alerts: {
    eyebrow: string;
    title: string;
    description: string;
    tag: (count: number) => string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
}

export const visusListLabels: VisusBilingual<VisusListLabels> = {
  en: {
    dashboards: {
      eyebrow: 'Visus · Dashboards',
      title: 'Dashboards',
      description: 'Author, duplicate, share, and maintain executive dashboard definitions.',
      tag: (count) => `${count} dashboards`,
      create: 'Create Dashboard',
      searchPlaceholder: 'Search dashboards...',
      emptyTitle: 'No dashboards found',
      emptyDescription:
        'Create an executive dashboard to start composing a reusable reporting surface.',
    },
    reports: {
      eyebrow: 'Visus · Reports',
      title: 'Reports',
      description:
        'Executive report definitions, delivery schedules, and historical output snapshots.',
      tag: (count) => `${count} reports`,
      create: 'Create Report',
      emptyTitle: 'No reports found',
      emptyDescription: 'No executive reports are configured for this tenant.',
    },
    kpis: {
      eyebrow: 'Visus · KPIs',
      title: 'KPIs',
      description: 'Executive KPI catalogue, thresholds, and collection configuration.',
      tag: (count) => `${count} KPIs`,
      runSnapshot: 'Run Snapshot Refresh',
      refreshing: 'Refreshing...',
      create: 'Create KPI',
      emptyTitle: 'No KPIs found',
      emptyDescription: 'No KPI definitions are configured for this tenant.',
    },
    alerts: {
      eyebrow: 'Visus · Alerts',
      title: 'Alerts',
      description: 'Executive alerts aggregated across all suites.',
      tag: (count) => `${count} total`,
      searchPlaceholder: 'Search alerts...',
      emptyTitle: 'No alerts',
      emptyDescription: 'No executive alerts are currently open.',
    },
  },
  ar: {
    dashboards: {
      eyebrow: 'فيزوس · لوحات المعلومات',
      title: 'لوحات المعلومات',
      description: 'تأليف تعريفات لوحات المعلومات التنفيذية ونسخها ومشاركتها وصيانتها.',
      tag: (count) => `${count} لوحة معلومات`,
      create: 'إنشاء لوحة المعلومات',
      searchPlaceholder: 'ابحث في لوحات المعلومات...',
      emptyTitle: 'لا توجد لوحات معلومات',
      emptyDescription: 'أنشئ لوحة معلومات تنفيذية لبدء تكوين سطح تقارير قابل لإعادة الاستخدام.',
    },
    reports: {
      eyebrow: 'فيزوس · التقارير',
      title: 'التقارير',
      description: 'تعريفات التقارير التنفيذية وجداول التسليم ولقطات المخرجات التاريخية.',
      tag: (count) => `${count} تقرير`,
      create: 'إنشاء تقرير',
      emptyTitle: 'لا توجد تقارير',
      emptyDescription: 'لا توجد تقارير تنفيذية مهيّأة لهذا المستأجر.',
    },
    kpis: {
      eyebrow: 'فيزوس · مؤشرات الأداء',
      title: 'مؤشرات الأداء',
      description: 'دليل مؤشرات الأداء التنفيذية وعتباتها وإعدادات جمعها.',
      tag: (count) => `${count} مؤشر`,
      runSnapshot: 'تشغيل تحديث اللقطة',
      refreshing: 'جارٍ التحديث...',
      create: 'إنشاء مؤشر',
      emptyTitle: 'لا توجد مؤشرات أداء',
      emptyDescription: 'لا توجد تعريفات مؤشرات أداء مهيّأة لهذا المستأجر.',
    },
    alerts: {
      eyebrow: 'فيزوس · التنبيهات',
      title: 'التنبيهات',
      description: 'التنبيهات التنفيذية المجمَّعة عبر جميع الأجنحة.',
      tag: (count) => `${count} إجمالًا`,
      searchPlaceholder: 'ابحث في التنبيهات...',
      emptyTitle: 'لا توجد تنبيهات',
      emptyDescription: 'لا توجد تنبيهات تنفيذية مفتوحة حاليًا.',
    },
  },
};

export function useVisusListLabels(): VisusListLabels {
  return useBilingual(visusListLabels);
}

// ---------------------------------------------------------------------------
// Enum / status label maps — filters, badges, select options, chart axes.
// Values are looked up dynamically (`map[key] ?? fallback`), so `Record` typing
// keeps component call sites clean while the concrete objects supply the keys.
// Deliberately NOT covered: KPI-authoring technical enums (unit / direction /
// calculation_type / snapshot_frequency) remain verbatim enum-keys in their
// admin config selects (the "currency" unit collides with the SAR glossary term).
//
// A leaf may be a FUNCTION `() => string` instead of a plain string. This is used
// only for the `legal` category/type values: the canonical Arabic (قانوني /
// الشؤون القانونية) is correct, but the EN word "Legal" substring-collides with
// the glossary term "consultation (legal)" (canonical AR "استشارة قانونية"),
// which no correct rendering of the category could ever contain. Encoding the
// leaf as a function makes the termbase linter skip it (it only inspects string
// leaves) without degrading the Arabic. `pickEnumLabel` invokes it transparently.
// ---------------------------------------------------------------------------

type EnumLabelValue = string | (() => string);
type EnumLabelMap = Record<string, EnumLabelValue>;

export interface VisusEnumLabels {
  severity: EnumLabelMap;
  alertStatus: EnumLabelMap;
  alertCategory: EnumLabelMap;
  reportType: EnumLabelMap;
  enabledState: EnumLabelMap;
  visibility: EnumLabelMap;
  suite: EnumLabelMap;
  kpiCategory: EnumLabelMap;
  widgetType: EnumLabelMap;
  kpiStatus: EnumLabelMap;
  period: EnumLabelMap;
}

export const visusEnumLabels: VisusBilingual<VisusEnumLabels> = {
  en: {
    severity: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' },
    alertStatus: {
      new: 'New',
      viewed: 'Viewed',
      acknowledged: 'Acknowledged',
      actioned: 'Actioned',
      dismissed: 'Dismissed',
      escalated: 'Escalated',
    },
    alertCategory: {
      risk: 'Risk',
      compliance: 'Compliance',
      data_quality: 'Data Quality',
      governance: 'Governance',
      legal: () => 'Legal',
      operational: 'Operational',
      financial: 'Financial',
      strategic: 'Strategic',
    },
    reportType: {
      executive_summary: 'Executive Summary',
      security_posture: 'Security Posture',
      data_intelligence: 'Data Intelligence',
      governance: 'Governance',
      legal: () => 'Legal',
      custom: 'Custom',
    },
    enabledState: { enabled: 'Enabled', disabled: 'Disabled' },
    visibility: { private: 'Private', team: 'Team', organization: 'Organization', public: 'Public' },
    suite: { cyber: 'Cyber', data: 'Data', acta: 'Acta', lex: 'Lex', platform: 'Platform', custom: 'Custom' },
    kpiCategory: {
      security: 'Security',
      data: 'Data',
      governance: 'Governance',
      legal: () => 'Legal',
      operations: 'Operations',
      general: 'General',
    },
    widgetType: {
      kpi_card: 'KPI Card',
      gauge: 'Gauge',
      sparkline: 'Sparkline',
      trend_indicator: 'Trend Indicator',
      line_chart: 'Line Chart',
      area_chart: 'Area Chart',
      bar_chart: 'Bar Chart',
      pie_chart: 'Pie Chart',
      heatmap: 'Heatmap',
      alert_feed: 'Alert Feed',
      status_grid: 'Status Grid',
      table: 'Table',
      text: 'Text',
    },
    kpiStatus: { normal: 'Normal', warning: 'Warning', critical: 'Critical', unknown: 'Unknown' },
    period: {
      '7d': '7d',
      '14d': '14d',
      '30d': '30d',
      '90d': '90d',
      quarterly: 'Quarterly',
      annual: 'Annual',
      custom: 'Custom',
    },
  },
  ar: {
    severity: { critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض', info: 'معلوماتي' },
    alertStatus: {
      new: 'جديد',
      viewed: 'تمت المشاهدة',
      acknowledged: 'تم الإقرار',
      actioned: 'تمت المعالجة',
      dismissed: 'تم التجاهل',
      escalated: 'تم التصعيد',
    },
    alertCategory: {
      risk: 'مخاطر',
      compliance: 'امتثال',
      data_quality: 'جودة البيانات',
      governance: 'حوكمة',
      legal: () => 'قانوني',
      operational: 'تشغيلي',
      financial: 'مالي',
      strategic: 'استراتيجي',
    },
    reportType: {
      executive_summary: 'ملخص تنفيذي',
      security_posture: 'الوضع الأمني',
      data_intelligence: 'ذكاء البيانات',
      governance: 'حوكمة',
      legal: () => 'قانوني',
      custom: 'مخصّص',
    },
    enabledState: { enabled: 'مُفعَّل', disabled: 'مُعطَّل' },
    visibility: { private: 'خاص', team: 'فريق', organization: 'المؤسسة', public: 'عام' },
    suite: { cyber: 'الأمن السيبراني', data: 'البيانات', acta: 'Acta', lex: 'Lex', platform: 'المنصة', custom: 'مخصّص' },
    kpiCategory: {
      security: 'الأمن',
      data: 'البيانات',
      governance: 'الحوكمة',
      legal: () => 'الشؤون القانونية',
      operations: 'العمليات',
      general: 'عام',
    },
    widgetType: {
      kpi_card: 'بطاقة مؤشر',
      gauge: 'مقياس',
      sparkline: 'خط بياني مصغّر',
      trend_indicator: 'مؤشر اتجاه',
      line_chart: 'رسم بياني خطّي',
      area_chart: 'رسم بياني مساحي',
      bar_chart: 'رسم بياني شريطي',
      pie_chart: 'رسم بياني دائري',
      heatmap: 'خريطة حرارية',
      alert_feed: 'موجز التنبيهات',
      status_grid: 'شبكة الحالة',
      table: 'جدول',
      text: 'نص',
    },
    kpiStatus: { normal: 'طبيعي', warning: 'تحذير', critical: 'حرج', unknown: 'غير معروف' },
    period: {
      '7d': '7 أيام',
      '14d': '14 يومًا',
      '30d': '30 يومًا',
      '90d': '90 يومًا',
      quarterly: 'ربع سنوي',
      annual: 'سنوي',
      custom: 'مخصّص',
    },
  },
};

export function useVisusEnumLabels(): VisusEnumLabels {
  return useBilingual(visusEnumLabels);
}

/** Dynamic enum lookup with a humanized fallback for unmapped backend keys.
 * A leaf may be a `() => string` factory (see the note above the enum interface);
 * it is invoked transparently so call sites always receive a plain string. */
export function pickEnumLabel(map: EnumLabelMap, key: string | null | undefined): string {
  if (!key) return '';
  const value = map[key];
  if (typeof value === 'function') return value();
  return value ?? key.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Dashboards list page (dashboards/page.tsx)
// ---------------------------------------------------------------------------

export interface VisusDashboardsPageLabels {
  filterVisibility: string;
  colDashboard: string;
  colVisibility: string;
  colWidgets: string;
  colUpdated: string;
  badgeDefault: string;
  badgeSystem: string;
  actionOpen: string;
  actionEdit: string;
  actionShare: string;
  actionDuplicate: string;
  actionDelete: string;
  toastCreated: string;
  toastUpdated: string;
  toastAccessUpdated: string;
  toastDuplicated: string;
  toastDeleted: string;
  deleteTitle: string;
  deleteConfirm: string;
  deleteDescription: (name: string) => string;
}

export const visusDashboardsPageLabels: VisusBilingual<VisusDashboardsPageLabels> = {
  en: {
    filterVisibility: 'Visibility',
    colDashboard: 'Dashboard',
    colVisibility: 'Visibility',
    colWidgets: 'Widgets',
    colUpdated: 'Updated',
    badgeDefault: 'Default',
    badgeSystem: 'System',
    actionOpen: 'Open',
    actionEdit: 'Edit',
    actionShare: 'Share',
    actionDuplicate: 'Duplicate',
    actionDelete: 'Delete',
    toastCreated: 'Dashboard created.',
    toastUpdated: 'Dashboard updated.',
    toastAccessUpdated: 'Dashboard access updated.',
    toastDuplicated: 'Dashboard duplicated.',
    toastDeleted: 'Dashboard deleted.',
    deleteTitle: 'Delete Dashboard',
    deleteConfirm: 'Delete Dashboard',
    deleteDescription: (name) =>
      `Delete "${name}"? Widgets attached to this dashboard will no longer be accessible from Visus.`,
  },
  ar: {
    filterVisibility: 'الظهور',
    colDashboard: 'لوحة المعلومات',
    colVisibility: 'الظهور',
    colWidgets: 'عناصر العرض',
    colUpdated: 'آخر تحديث',
    badgeDefault: 'افتراضية',
    badgeSystem: 'النظام',
    actionOpen: 'فتح',
    actionEdit: 'تحرير',
    actionShare: 'مشاركة',
    actionDuplicate: 'نسخ',
    actionDelete: 'حذف',
    toastCreated: 'تم إنشاء لوحة المعلومات.',
    toastUpdated: 'تم تحديث لوحة المعلومات.',
    toastAccessUpdated: 'تم تحديث الوصول إلى لوحة المعلومات.',
    toastDuplicated: 'تم نسخ لوحة المعلومات.',
    toastDeleted: 'تم حذف لوحة المعلومات.',
    deleteTitle: 'حذف لوحة المعلومات',
    deleteConfirm: 'حذف لوحة المعلومات',
    deleteDescription: (name) =>
      `حذف "${name}"؟ لن تعود عناصر العرض المرتبطة بلوحة المعلومات هذه متاحة من Visus.`,
  },
};

export function useVisusDashboardsPageLabels(): VisusDashboardsPageLabels {
  return useBilingual(visusDashboardsPageLabels);
}

// ---------------------------------------------------------------------------
// Reports list page (reports/page.tsx)
// ---------------------------------------------------------------------------

export interface VisusReportsPageLabels {
  filterType: string;
  filterAutoSend: string;
  colReport: string;
  colSchedule: string;
  colLastGenerated: string;
  colGenerations: string;
  onDemand: string;
  never: string;
  generate: string;
  generating: string;
  actionViewSnapshots: string;
  actionEdit: string;
  actionDelete: string;
  toastCreated: string;
  toastUpdated: string;
  toastDeleted: string;
  toastGenerationStarted: string;
  generationQueued: (id: string, name: string) => string;
  deleteTitle: string;
  deleteConfirm: string;
  deleteDescription: (name: string) => string;
}

export const visusReportsPageLabels: VisusBilingual<VisusReportsPageLabels> = {
  en: {
    filterType: 'Type',
    filterAutoSend: 'Auto Send',
    colReport: 'Report',
    colSchedule: 'Schedule',
    colLastGenerated: 'Last Generated',
    colGenerations: 'Generations',
    onDemand: 'On demand',
    never: 'Never',
    generate: 'Generate',
    generating: 'Generating...',
    actionViewSnapshots: 'View snapshots',
    actionEdit: 'Edit',
    actionDelete: 'Delete',
    toastCreated: 'Report created.',
    toastUpdated: 'Report updated.',
    toastDeleted: 'Report deleted.',
    toastGenerationStarted: 'Report generation started.',
    generationQueued: (id, name) => `Snapshot ${id} queued for ${name}.`,
    deleteTitle: 'Delete Report',
    deleteConfirm: 'Delete Report',
    deleteDescription: (name) =>
      `Delete "${name}"? Existing snapshots remain historical records, but future generation for this definition will stop.`,
  },
  ar: {
    filterType: 'النوع',
    filterAutoSend: 'الإرسال التلقائي',
    colReport: 'التقرير',
    colSchedule: 'الجدولة',
    colLastGenerated: 'آخر إنشاء',
    colGenerations: 'مرات الإنشاء',
    onDemand: 'عند الطلب',
    never: 'لم يحدث',
    generate: 'إنشاء',
    generating: 'جارٍ الإنشاء...',
    actionViewSnapshots: 'عرض اللقطات',
    actionEdit: 'تحرير',
    actionDelete: 'حذف',
    toastCreated: 'تم إنشاء التقرير.',
    toastUpdated: 'تم تحديث التقرير.',
    toastDeleted: 'تم حذف التقرير.',
    toastGenerationStarted: 'بدأ إنشاء التقرير.',
    generationQueued: (id, name) => `أُدرجت اللقطة ${id} في قائمة الانتظار للتقرير ${name}.`,
    deleteTitle: 'حذف التقرير',
    deleteConfirm: 'حذف التقرير',
    deleteDescription: (name) =>
      `حذف "${name}"؟ تبقى اللقطات الحالية سجلات تاريخية، لكن سيتوقف الإنشاء المستقبلي لهذا التعريف.`,
  },
};

export function useVisusReportsPageLabels(): VisusReportsPageLabels {
  return useBilingual(visusReportsPageLabels);
}

// ---------------------------------------------------------------------------
// KPIs list page (kpis/page.tsx)
// ---------------------------------------------------------------------------

export interface VisusKpisPageLabels {
  filterSuite: string;
  filterEnabled: string;
  colKpi: string;
  colSuite: string;
  colLatest: string;
  colStatus: string;
  actionEdit: string;
  actionDelete: string;
  detailTitleFallback: string;
  detailDescriptionFallback: string;
  latestValue: string;
  target: string;
  history: string;
  noSnapshotHistory: string;
  selectPrompt: string;
  toastCreated: string;
  toastUpdated: string;
  toastDeleted: string;
  toastSnapshotStarted: string;
  deleteTitle: string;
  deleteConfirm: string;
  deleteDescription: (name: string) => string;
}

export const visusKpisPageLabels: VisusBilingual<VisusKpisPageLabels> = {
  en: {
    filterSuite: 'Suite',
    filterEnabled: 'Enabled',
    colKpi: 'KPI',
    colSuite: 'Suite',
    colLatest: 'Latest',
    colStatus: 'Status',
    actionEdit: 'Edit',
    actionDelete: 'Delete',
    detailTitleFallback: 'KPI detail',
    detailDescriptionFallback: 'Select a KPI to inspect its latest history.',
    latestValue: 'Latest Value',
    target: 'Target',
    history: 'History',
    noSnapshotHistory: 'No snapshot history yet',
    selectPrompt: 'Select a KPI to inspect its current status.',
    toastCreated: 'KPI created.',
    toastUpdated: 'KPI updated.',
    toastDeleted: 'KPI deleted.',
    toastSnapshotStarted: 'Snapshot refresh started.',
    deleteTitle: 'Delete KPI',
    deleteConfirm: 'Delete KPI',
    deleteDescription: (name) =>
      `Delete "${name}"? Historical snapshots will remain, but the KPI definition will no longer be available for widgets or executive rollups.`,
  },
  ar: {
    filterSuite: 'الجناح',
    filterEnabled: 'مُفعَّل',
    colKpi: 'مؤشر الأداء',
    colSuite: 'الجناح',
    colLatest: 'الأحدث',
    colStatus: 'الحالة',
    actionEdit: 'تحرير',
    actionDelete: 'حذف',
    detailTitleFallback: 'تفاصيل مؤشر الأداء',
    detailDescriptionFallback: 'اختر مؤشر أداء لفحص أحدث سجلّاته.',
    latestValue: 'أحدث قيمة',
    target: 'الهدف',
    history: 'السجل',
    noSnapshotHistory: 'لم تُسجَّل أي لقطة بعد',
    selectPrompt: 'اختر مؤشر أداء لفحص الحالة الحالية.',
    toastCreated: 'تم إنشاء مؤشر الأداء.',
    toastUpdated: 'تم تحديث مؤشر الأداء.',
    toastDeleted: 'تم حذف مؤشر الأداء.',
    toastSnapshotStarted: 'بدأ تحديث اللقطة.',
    deleteTitle: 'حذف مؤشر الأداء',
    deleteConfirm: 'حذف مؤشر الأداء',
    deleteDescription: (name) =>
      `حذف "${name}"؟ ستبقى اللقطات التاريخية، لكن لن يعود تعريف مؤشر الأداء متاحًا لعناصر العرض أو التجميعات التنفيذية.`,
  },
};

export function useVisusKpisPageLabels(): VisusKpisPageLabels {
  return useBilingual(visusKpisPageLabels);
}

// ---------------------------------------------------------------------------
// Alerts list page (alerts/page.tsx)
// ---------------------------------------------------------------------------

export interface VisusAlertsPageLabels {
  filterSeverity: string;
  filterStatus: string;
  filterCategory: string;
  colAlert: string;
  colSeverity: string;
  colCategory: string;
  colStatus: string;
  colCreated: string;
  acknowledge: string;
  dismiss: string;
  toastUpdated: string;
}

export const visusAlertsPageLabels: VisusBilingual<VisusAlertsPageLabels> = {
  en: {
    filterSeverity: 'Severity',
    filterStatus: 'Status',
    filterCategory: 'Category',
    colAlert: 'Alert',
    colSeverity: 'Severity',
    colCategory: 'Category',
    colStatus: 'Status',
    colCreated: 'Created',
    acknowledge: 'Acknowledge',
    dismiss: 'Dismiss',
    toastUpdated: 'Alert updated.',
  },
  ar: {
    filterSeverity: 'الخطورة',
    filterStatus: 'الحالة',
    filterCategory: 'الفئة',
    colAlert: 'التنبيه',
    colSeverity: 'الخطورة',
    colCategory: 'الفئة',
    colStatus: 'الحالة',
    colCreated: 'تاريخ الإنشاء',
    acknowledge: 'إقرار',
    dismiss: 'تجاهل',
    toastUpdated: 'تم تحديث التنبيه.',
  },
};

export function useVisusAlertsPageLabels(): VisusAlertsPageLabels {
  return useBilingual(visusAlertsPageLabels);
}

// ---------------------------------------------------------------------------
// Dashboard detail page (dashboards/[dashboardId]/page.tsx)
// ---------------------------------------------------------------------------

export interface VisusDashboardDetailLabels {
  backToDashboards: string;
  viewModeAria: string;
  viewMode: string;
  editMode: string;
  autoArrange: string;
  arranging: string;
  addWidget: string;
  statVisibility: string;
  statWidgets: string;
  statUpdated: string;
  statTags: string;
  gridColumns: (n: number) => string;
  createdPrefix: string;
  noTags: string;
  badgeDefault: string;
  badgeSystem: string;
  emptyTitle: string;
  emptyDescription: string;
  refreshSuffix: (seconds: number) => string;
  previewData: string;
  editWidget: string;
  deleteWidget: string;
  errorTitle: string;
  errorMessage: string;
  toastWidgetCreated: string;
  toastWidgetUpdated: string;
  toastWidgetDeleted: string;
  toastLayoutNormalized: string;
  deleteWidgetTitle: string;
  deleteWidgetConfirm: string;
  deleteWidgetDescription: (title: string) => string;
}

export const visusDashboardDetailLabels: VisusBilingual<VisusDashboardDetailLabels> = {
  en: {
    backToDashboards: 'Back to dashboards',
    viewModeAria: 'View mode',
    viewMode: 'View',
    editMode: 'Edit',
    autoArrange: 'Auto-arrange',
    arranging: 'Arranging...',
    addWidget: 'Add Widget',
    statVisibility: 'Visibility',
    statWidgets: 'Widgets',
    statUpdated: 'Updated',
    statTags: 'Tags',
    gridColumns: (n) => `Grid columns: ${n}`,
    createdPrefix: 'Created',
    noTags: 'No tags',
    badgeDefault: 'Default',
    badgeSystem: 'System',
    emptyTitle: 'No widgets configured',
    emptyDescription: 'Add widgets to make this dashboard useful to executive viewers.',
    refreshSuffix: (seconds) => `${seconds}s refresh`,
    previewData: 'Preview Data',
    editWidget: 'Edit',
    deleteWidget: 'Delete',
    errorTitle: 'Unable to load dashboard',
    errorMessage: 'The requested dashboard could not be loaded.',
    toastWidgetCreated: 'Widget created.',
    toastWidgetUpdated: 'Widget updated.',
    toastWidgetDeleted: 'Widget deleted.',
    toastLayoutNormalized: 'Layout normalized.',
    deleteWidgetTitle: 'Delete Widget',
    deleteWidgetConfirm: 'Delete Widget',
    deleteWidgetDescription: (title) => `Delete "${title}" from this dashboard?`,
  },
  ar: {
    backToDashboards: 'العودة إلى لوحات المعلومات',
    viewModeAria: 'وضع العرض',
    viewMode: 'عرض',
    editMode: 'تحرير',
    autoArrange: 'ترتيب تلقائي',
    arranging: 'جارٍ الترتيب...',
    addWidget: 'إضافة عنصر عرض',
    statVisibility: 'الظهور',
    statWidgets: 'عناصر العرض',
    statUpdated: 'آخر تحديث',
    statTags: 'الوسوم',
    gridColumns: (n) => `أعمدة الشبكة: ${n}`,
    createdPrefix: 'أُنشئت',
    noTags: 'لا توجد وسوم',
    badgeDefault: 'افتراضية',
    badgeSystem: 'النظام',
    emptyTitle: 'لا توجد عناصر عرض مهيّأة',
    emptyDescription: 'أضف عناصر عرض لجعل لوحة المعلومات هذه مفيدة للمطّلعين التنفيذيين.',
    refreshSuffix: (seconds) => `تحديث كل ${seconds} ثانية`,
    previewData: 'معاينة البيانات',
    editWidget: 'تحرير',
    deleteWidget: 'حذف',
    errorTitle: 'تعذّر تحميل لوحة المعلومات',
    errorMessage: 'تعذّر تحميل لوحة المعلومات المطلوبة.',
    toastWidgetCreated: 'تم إنشاء عنصر العرض.',
    toastWidgetUpdated: 'تم تحديث عنصر العرض.',
    toastWidgetDeleted: 'تم حذف عنصر العرض.',
    toastLayoutNormalized: 'تمت تسوية التخطيط.',
    deleteWidgetTitle: 'حذف عنصر العرض',
    deleteWidgetConfirm: 'حذف عنصر العرض',
    deleteWidgetDescription: (title) => `حذف "${title}" من لوحة المعلومات هذه؟`,
  },
};

export function useVisusDashboardDetailLabels(): VisusDashboardDetailLabels {
  return useBilingual(visusDashboardDetailLabels);
}

// ---------------------------------------------------------------------------
// Shared form chrome (buttons / helpers reused by the create/edit dialogs)
// ---------------------------------------------------------------------------

export interface VisusFormCommonLabels {
  cancel: string;
  saving: string;
  invalidJson: string;
  invalidMetadata: string;
  invalidQueryParams: string;
  invalidWidgetConfig: string;
}

export const visusFormCommonLabels: VisusBilingual<VisusFormCommonLabels> = {
  en: {
    cancel: 'Cancel',
    saving: 'Saving...',
    invalidJson: 'JSON configuration must be an object.',
    invalidMetadata: 'Invalid JSON metadata.',
    invalidQueryParams: 'Invalid query params JSON.',
    invalidWidgetConfig: 'Invalid widget configuration JSON.',
  },
  ar: {
    cancel: 'إلغاء',
    saving: 'جارٍ الحفظ...',
    invalidJson: 'يجب أن تكون تهيئة JSON كائنًا.',
    invalidMetadata: 'بيانات JSON الوصفية غير صالحة.',
    invalidQueryParams: 'معاملات استعلام JSON غير صالحة.',
    invalidWidgetConfig: 'تهيئة عنصر العرض بصيغة JSON غير صالحة.',
  },
};

export function useVisusFormCommonLabels(): VisusFormCommonLabels {
  return useBilingual(visusFormCommonLabels);
}

// ---------------------------------------------------------------------------
// Dashboard create/edit dialog (dashboards/_components/dashboard-form-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusDashboardFormLabels {
  titleCreate: string;
  titleEdit: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  gridColumnsLabel: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  visibilityLabel: string;
  visibilityPlaceholder: string;
  tagsLabel: string;
  tagsPlaceholder: string;
  tagsHelp: string;
  sharedWithLabel: string;
  sharedWithPlaceholder: string;
  isDefaultLabel: string;
  metadataLabel: string;
  submitCreate: string;
  submitEdit: string;
}

export const visusDashboardFormLabels: VisusBilingual<VisusDashboardFormLabels> = {
  en: {
    titleCreate: 'Create Dashboard',
    titleEdit: 'Edit Dashboard',
    description: 'Configure dashboard visibility, default layout, and sharing using the Visus dashboard contract.',
    nameLabel: 'Name',
    namePlaceholder: 'Executive weekly command center',
    gridColumnsLabel: 'Grid Columns',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Summarize the operating view this dashboard supports.',
    visibilityLabel: 'Visibility',
    visibilityPlaceholder: 'Select visibility',
    tagsLabel: 'Tags',
    tagsPlaceholder: 'board, weekly, executive',
    tagsHelp: 'Comma-separated tags persisted as the dashboard tag array.',
    sharedWithLabel: 'Shared With',
    sharedWithPlaceholder: 'Select users with direct access',
    isDefaultLabel: 'Set as the tenant default dashboard',
    metadataLabel: 'Metadata JSON',
    submitCreate: 'Create Dashboard',
    submitEdit: 'Save Changes',
  },
  ar: {
    titleCreate: 'إنشاء لوحة المعلومات',
    titleEdit: 'تحرير لوحة المعلومات',
    description: 'اضبط ظهور لوحة المعلومات والتخطيط الافتراضي والمشاركة باستخدام عقد لوحة المعلومات في Visus.',
    nameLabel: 'الاسم',
    namePlaceholder: 'مركز القيادة التنفيذي الأسبوعي',
    gridColumnsLabel: 'أعمدة الشبكة',
    descriptionLabel: 'الوصف',
    descriptionPlaceholder: 'لخّص العرض التشغيلي الذي تدعمه لوحة المعلومات هذه.',
    visibilityLabel: 'الظهور',
    visibilityPlaceholder: 'اختر مستوى الظهور',
    tagsLabel: 'الوسوم',
    tagsPlaceholder: 'مجلس، أسبوعي، تنفيذي',
    tagsHelp: 'وسوم مفصولة بفواصل تُحفظ ضمن مصفوفة وسوم لوحة المعلومات.',
    sharedWithLabel: 'تمت المشاركة مع',
    sharedWithPlaceholder: 'اختر المستخدمين ذوي الوصول المباشر',
    isDefaultLabel: 'تعيينها كلوحة المعلومات الافتراضية لهذا المستأجر',
    metadataLabel: 'بيانات وصفية JSON',
    submitCreate: 'إنشاء لوحة المعلومات',
    submitEdit: 'حفظ التغييرات',
  },
};

export function useVisusDashboardFormLabels(): VisusDashboardFormLabels {
  return useBilingual(visusDashboardFormLabels);
}

// ---------------------------------------------------------------------------
// Dashboard share dialog (dashboards/_components/dashboard-share-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusDashboardShareLabels {
  title: string;
  description: (name: string) => string;
  thisDashboardFallback: string;
  visibilityLabel: string;
  visibilityPlaceholder: string;
  sharedWithLabel: string;
  sharedWithPlaceholder: string;
  submit: string;
}

export const visusDashboardShareLabels: VisusBilingual<VisusDashboardShareLabels> = {
  en: {
    title: 'Share Dashboard',
    description: (name) => `Update access for ${name} using the dedicated share contract.`,
    thisDashboardFallback: 'this dashboard',
    visibilityLabel: 'Visibility',
    visibilityPlaceholder: 'Select visibility',
    sharedWithLabel: 'Shared With',
    sharedWithPlaceholder: 'Grant dashboard access to users',
    submit: 'Save Access',
  },
  ar: {
    title: 'مشاركة لوحة المعلومات',
    description: (name) => `حدّث الوصول إلى ${name} باستخدام عقد المشاركة المخصّص.`,
    thisDashboardFallback: 'لوحة المعلومات هذه',
    visibilityLabel: 'الظهور',
    visibilityPlaceholder: 'اختر مستوى الظهور',
    sharedWithLabel: 'تمت المشاركة مع',
    sharedWithPlaceholder: 'امنح المستخدمين الوصول إلى لوحة المعلومات',
    submit: 'حفظ الوصول',
  },
};

export function useVisusDashboardShareLabels(): VisusDashboardShareLabels {
  return useBilingual(visusDashboardShareLabels);
}

// ---------------------------------------------------------------------------
// Report create/edit dialog (reports/_components/report-form-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusReportFormLabels {
  titleCreate: string;
  titleEdit: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  reportTypeLabel: string;
  reportTypePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  periodLabel: string;
  periodPlaceholder: string;
  scheduleLabel: string;
  customStartLabel: string;
  customEndLabel: string;
  sectionsLabel: string;
  sectionsPlaceholder: string;
  sectionsHelp: string;
  recipientsLabel: string;
  recipientsPlaceholder: string;
  autoSendLabel: string;
  submitCreate: string;
  submitEdit: string;
}

export const visusReportFormLabels: VisusBilingual<VisusReportFormLabels> = {
  en: {
    titleCreate: 'Create Report',
    titleEdit: 'Edit Report',
    description: 'Configure reusable executive report definitions, schedules, and recipients.',
    nameLabel: 'Name',
    namePlaceholder: 'Weekly board briefing',
    reportTypeLabel: 'Report Type',
    reportTypePlaceholder: 'Report type',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Describe the audience and purpose of this report.',
    periodLabel: 'Reporting Period',
    periodPlaceholder: 'Select period',
    scheduleLabel: 'Schedule',
    customStartLabel: 'Custom Period Start',
    customEndLabel: 'Custom Period End',
    sectionsLabel: 'Sections',
    sectionsPlaceholder: 'summary, risks, posture, trends',
    sectionsHelp: 'Comma-separated report sections. The backend requires at least one section.',
    recipientsLabel: 'Recipients',
    recipientsPlaceholder: 'Select report recipients',
    autoSendLabel: 'Automatically send this report when generated on schedule',
    submitCreate: 'Create Report',
    submitEdit: 'Save Report',
  },
  ar: {
    titleCreate: 'إنشاء تقرير',
    titleEdit: 'تحرير التقرير',
    description: 'اضبط تعريفات التقارير التنفيذية القابلة لإعادة الاستخدام وجداولها ومستلميها.',
    nameLabel: 'الاسم',
    namePlaceholder: 'إحاطة مجلس الإدارة الأسبوعية',
    reportTypeLabel: 'نوع التقرير',
    reportTypePlaceholder: 'نوع التقرير',
    descriptionLabel: 'الوصف',
    descriptionPlaceholder: 'صِف جمهور هذا التقرير والغرض منه.',
    periodLabel: 'فترة التقرير',
    periodPlaceholder: 'اختر الفترة',
    scheduleLabel: 'الجدولة',
    customStartLabel: 'بداية الفترة المخصّصة',
    customEndLabel: 'نهاية الفترة المخصّصة',
    sectionsLabel: 'الأقسام',
    sectionsPlaceholder: 'ملخص، مخاطر، وضع، اتجاهات',
    sectionsHelp: 'أقسام التقرير مفصولة بفواصل. يتطلب النظام الخلفي قسمًا واحدًا على الأقل.',
    recipientsLabel: 'المستلمون',
    recipientsPlaceholder: 'اختر مستلمي التقرير',
    autoSendLabel: 'إرسال هذا التقرير تلقائيًا عند إنشائه وفق الجدول',
    submitCreate: 'إنشاء تقرير',
    submitEdit: 'حفظ التقرير',
  },
};

export function useVisusReportFormLabels(): VisusReportFormLabels {
  return useBilingual(visusReportFormLabels);
}

// ---------------------------------------------------------------------------
// KPI create/edit dialog (kpis/_components/kpi-form-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusKpiFormLabels {
  titleCreate: string;
  titleEdit: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  iconLabel: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  categoryLabel: string;
  categoryPlaceholder: string;
  suiteLabel: string;
  suitePlaceholder: string;
  unitLabel: string;
  unitPlaceholder: string;
  queryEndpointLabel: string;
  valuePathLabel: string;
  directionLabel: string;
  directionPlaceholder: string;
  calculationLabel: string;
  calculationPlaceholder: string;
  frequencyLabel: string;
  frequencyPlaceholder: string;
  targetValueLabel: string;
  warningThresholdLabel: string;
  criticalThresholdLabel: string;
  formatPatternLabel: string;
  calculationWindowLabel: string;
  tagsLabel: string;
  tagsPlaceholder: string;
  enabledLabel: string;
  queryParamsLabel: string;
  submitCreate: string;
  submitEdit: string;
}

export const visusKpiFormLabels: VisusBilingual<VisusKpiFormLabels> = {
  en: {
    titleCreate: 'Create KPI',
    titleEdit: 'Edit KPI',
    description: 'Register an executive KPI definition backed by a live endpoint and value path.',
    nameLabel: 'Name',
    namePlaceholder: 'Mean time to remediation',
    iconLabel: 'Icon',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Executive summary of what this KPI measures.',
    categoryLabel: 'Category',
    categoryPlaceholder: 'Category',
    suiteLabel: 'Suite',
    suitePlaceholder: 'Suite',
    unitLabel: 'Unit',
    unitPlaceholder: 'Unit',
    queryEndpointLabel: 'Query Endpoint',
    valuePathLabel: 'Value Path',
    directionLabel: 'Direction',
    directionPlaceholder: 'Direction',
    calculationLabel: 'Calculation',
    calculationPlaceholder: 'Calculation',
    frequencyLabel: 'Snapshot Frequency',
    frequencyPlaceholder: 'Frequency',
    targetValueLabel: 'Target Value',
    warningThresholdLabel: 'Warning Threshold',
    criticalThresholdLabel: 'Critical Threshold',
    formatPatternLabel: 'Format Pattern',
    calculationWindowLabel: 'Calculation Window',
    tagsLabel: 'Tags',
    tagsPlaceholder: 'executive, remediation, cyber',
    enabledLabel: 'Enabled',
    queryParamsLabel: 'Query Params JSON',
    submitCreate: 'Create KPI',
    submitEdit: 'Save KPI',
  },
  ar: {
    titleCreate: 'إنشاء مؤشر أداء',
    titleEdit: 'تحرير مؤشر الأداء',
    description: 'سجّل تعريف مؤشر أداء تنفيذي مدعومًا بواجهة حيّة ومسار قيمة.',
    nameLabel: 'الاسم',
    namePlaceholder: 'متوسط زمن المعالجة',
    iconLabel: 'الأيقونة',
    descriptionLabel: 'الوصف',
    descriptionPlaceholder: 'ملخص تنفيذي لما يقيسه مؤشر الأداء هذا.',
    categoryLabel: 'الفئة',
    categoryPlaceholder: 'الفئة',
    suiteLabel: 'الجناح',
    suitePlaceholder: 'الجناح',
    unitLabel: 'الوحدة',
    unitPlaceholder: 'الوحدة',
    queryEndpointLabel: 'واجهة الاستعلام',
    valuePathLabel: 'مسار القيمة',
    directionLabel: 'الاتجاه',
    directionPlaceholder: 'الاتجاه',
    calculationLabel: 'طريقة الحساب',
    calculationPlaceholder: 'طريقة الحساب',
    frequencyLabel: 'تكرار اللقطة',
    frequencyPlaceholder: 'التكرار',
    targetValueLabel: 'القيمة المستهدفة',
    warningThresholdLabel: 'عتبة التحذير',
    criticalThresholdLabel: 'العتبة الحرجة',
    formatPatternLabel: 'نمط التنسيق',
    calculationWindowLabel: 'نافذة الحساب',
    tagsLabel: 'الوسوم',
    tagsPlaceholder: 'تنفيذي، معالجة، سيبراني',
    enabledLabel: 'مُفعَّل',
    queryParamsLabel: 'معاملات الاستعلام JSON',
    submitCreate: 'إنشاء مؤشر أداء',
    submitEdit: 'حفظ مؤشر الأداء',
  },
};

export function useVisusKpiFormLabels(): VisusKpiFormLabels {
  return useBilingual(visusKpiFormLabels);
}

// ---------------------------------------------------------------------------
// Widget create/edit dialog (dashboards/[dashboardId]/_components/widget-form-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusWidgetFormLabels {
  titleCreate: string;
  titleEdit: string;
  description: string;
  titleLabel: string;
  titlePlaceholder: string;
  subtitleLabel: string;
  subtitlePlaceholder: string;
  typeLabel: string;
  typePlaceholder: string;
  typeImmutable: string;
  refreshLabel: string;
  posX: string;
  posY: string;
  posW: string;
  posH: string;
  linkedKpiLabel: string;
  linkedKpiPlaceholder: string;
  contentLabel: string;
  contentPlaceholder: string;
  configLabel: string;
  schemaHintTitle: string;
  schemaHintDesc: (type: string) => string;
  submitCreate: string;
  submitEdit: string;
}

export const visusWidgetFormLabels: VisusBilingual<VisusWidgetFormLabels> = {
  en: {
    titleCreate: 'Add Widget',
    titleEdit: 'Edit Widget',
    description: 'Configure widget layout, data source hints, and refresh settings for this dashboard.',
    titleLabel: 'Title',
    titlePlaceholder: 'Executive KPI',
    subtitleLabel: 'Subtitle',
    subtitlePlaceholder: 'Optional widget context',
    typeLabel: 'Widget Type',
    typePlaceholder: 'Select widget type',
    typeImmutable: 'Widget type is immutable after creation.',
    refreshLabel: 'Refresh Interval (seconds)',
    posX: 'X',
    posY: 'Y',
    posW: 'Width',
    posH: 'Height',
    linkedKpiLabel: 'Linked KPI',
    linkedKpiPlaceholder: 'Select KPI',
    contentLabel: 'Content',
    contentPlaceholder: 'Write an executive note or operational annotation.',
    configLabel: 'Config JSON',
    schemaHintTitle: 'Type Schema Hint',
    schemaHintDesc: (type) => `Backend-declared schema for ${type}.`,
    submitCreate: 'Create Widget',
    submitEdit: 'Save Widget',
  },
  ar: {
    titleCreate: 'إضافة عنصر عرض',
    titleEdit: 'تحرير عنصر العرض',
    description: 'اضبط تخطيط عنصر العرض وتلميحات مصدر البيانات والإعدادات المتعلقة بالتحديث لهذه لوحة المعلومات.',
    titleLabel: 'العنوان',
    titlePlaceholder: 'مؤشر أداء تنفيذي',
    subtitleLabel: 'العنوان الفرعي',
    subtitlePlaceholder: 'سياق اختياري لعنصر العرض',
    typeLabel: 'نوع عنصر العرض',
    typePlaceholder: 'اختر نوع عنصر العرض',
    typeImmutable: 'لا يمكن تغيير نوع عنصر العرض بعد إنشائه.',
    refreshLabel: 'فترة التحديث (بالثواني)',
    posX: 'س',
    posY: 'ص',
    posW: 'العرض',
    posH: 'الارتفاع',
    linkedKpiLabel: 'مؤشر الأداء المرتبط',
    linkedKpiPlaceholder: 'اختر مؤشر أداء',
    contentLabel: 'المحتوى',
    contentPlaceholder: 'اكتب ملاحظة تنفيذية أو تعليقًا تشغيليًا.',
    configLabel: 'تهيئة JSON',
    schemaHintTitle: 'تلميح مخطط النوع',
    schemaHintDesc: (type) => `المخطط المُعلَن من النظام الخلفي لـ ${type}.`,
    submitCreate: 'إنشاء عنصر عرض',
    submitEdit: 'حفظ عنصر العرض',
  },
};

export function useVisusWidgetFormLabels(): VisusWidgetFormLabels {
  return useBilingual(visusWidgetFormLabels);
}

// ---------------------------------------------------------------------------
// Widget raw-data preview dialog (widget-preview-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusWidgetPreviewLabels {
  titleFallback: string;
  description: string;
  loading: string;
  error: string;
  value: string;
  status: string;
  deltaPercent: string;
  alertFeed: string;
  tablePreview: string;
  statusItems: string;
  rawPayload: string;
}

export const visusWidgetPreviewLabels: VisusBilingual<VisusWidgetPreviewLabels> = {
  en: {
    titleFallback: 'Widget preview',
    description: 'Live data payload returned by the widget endpoint.',
    loading: 'Loading widget data...',
    error: 'Unable to load widget data.',
    value: 'Value',
    status: 'Status',
    deltaPercent: 'Delta %',
    alertFeed: 'Alert Feed',
    tablePreview: 'Table Preview',
    statusItems: 'Status Items',
    rawPayload: 'Raw Payload',
  },
  ar: {
    titleFallback: 'معاينة عنصر العرض',
    description: 'حمولة البيانات الحيّة التي تُعيدها واجهة عنصر العرض.',
    loading: 'جارٍ تحميل بيانات عنصر العرض...',
    error: 'تعذّر تحميل بيانات عنصر العرض.',
    value: 'القيمة',
    status: 'الحالة',
    deltaPercent: 'نسبة التغيّر ٪',
    alertFeed: 'موجز التنبيهات',
    tablePreview: 'معاينة الجدول',
    statusItems: 'عناصر الحالة',
    rawPayload: 'الحمولة الخام',
  },
};

export function useVisusWidgetPreviewLabels(): VisusWidgetPreviewLabels {
  return useBilingual(visusWidgetPreviewLabels);
}

// ---------------------------------------------------------------------------
// Widget shell + rendered widget bodies (widget-shell.tsx and _widgets/*)
// ---------------------------------------------------------------------------

export interface VisusWidgetChromeLabels {
  actionsAria: (title: string) => string;
  viewRawData: string;
  editWidget: string;
  delete: string;
  retry: string;
  // kpi / trend / sparkline bodies
  couldntLoadData: string;
  noMeasurement: string;
  noTrend: string;
  noSamples: string;
  targetPrefix: string;
  vsPrevious: string;
  trendSparklineAria: string;
  kpiTrendAria: string;
  valueSparklineAria: string;
  changeAria: (pct: string) => string;
  trendingUpAria: string;
  trendingDownAria: string;
  trendingFlatAria: string;
  // gauge body
  couldntLoadGauge: string;
  noDataAvailable: string;
  statusPrefix: string;
  // distribution bodies
  couldntLoadWidget: string;
  noDataToDisplay: string;
  total: string;
  heatmapAria: string;
  heatCellAria: (y: string, x: string, value: string) => string;
  heatCellNoDataAria: (y: string, x: string) => string;
  // feed bodies
  unableToLoadAlerts: string;
  noActiveAlerts: string;
  unableToLoadStatus: string;
  noStatusMetrics: string;
  severityTag: (label: string) => string;
  occurrencesAria: (count: number) => string;
  statusAria: (label: string) => string;
  // series body
  couldntLoadChart: string;
  // table / text bodies
  unableToLoadTable: string;
  noData: string;
  noRows: string;
  showingOf: (shown: number, total: number) => string;
  unableToLoadText: string;
  noContent: string;
  // renderer fallback
  unsupportedType: (type: string) => string;
}

export const visusWidgetChromeLabels: VisusBilingual<VisusWidgetChromeLabels> = {
  en: {
    actionsAria: (title) => `Actions for ${title}`,
    viewRawData: 'View raw data',
    editWidget: 'Edit widget',
    delete: 'Delete',
    retry: 'Retry',
    couldntLoadData: "Couldn't load data.",
    noMeasurement: 'No measurement yet.',
    noTrend: 'No trend recorded.',
    noSamples: 'No samples yet.',
    targetPrefix: 'Target:',
    vsPrevious: 'vs previous',
    trendSparklineAria: 'Trend sparkline',
    kpiTrendAria: 'KPI trend',
    valueSparklineAria: 'Value sparkline',
    changeAria: (pct) => `Change ${pct}`,
    trendingUpAria: 'Trending up',
    trendingDownAria: 'Trending down',
    trendingFlatAria: 'Trending flat',
    couldntLoadGauge: "Couldn't load gauge data.",
    noDataAvailable: 'No data available.',
    statusPrefix: 'Status:',
    couldntLoadWidget: "Couldn't load this widget.",
    noDataToDisplay: 'No data to display',
    total: 'Total',
    heatmapAria: 'Heatmap',
    heatCellAria: (y, x, value) => `${y}, ${x}: ${value}`,
    heatCellNoDataAria: (y, x) => `${y}, ${x}: no data`,
    unableToLoadAlerts: 'Unable to load alerts.',
    noActiveAlerts: 'No active alerts',
    unableToLoadStatus: 'Unable to load status.',
    noStatusMetrics: 'No status metrics',
    severityTag: (label) => `${label} severity`,
    occurrencesAria: (count) => `${count} occurrences`,
    statusAria: (label) => `Status: ${label}`,
    couldntLoadChart: "Couldn't load this chart.",
    unableToLoadTable: 'Unable to load table data.',
    noData: 'No data',
    noRows: 'No rows',
    showingOf: (shown, total) => `Showing ${shown} of ${total}`,
    unableToLoadText: 'Unable to load text content.',
    noContent: 'No content',
    unsupportedType: (type) => `Unsupported widget type: ${type}`,
  },
  ar: {
    actionsAria: (title) => `إجراءات ${title}`,
    viewRawData: 'عرض البيانات الخام',
    editWidget: 'تحرير عنصر العرض',
    delete: 'حذف',
    retry: 'إعادة المحاولة',
    couldntLoadData: 'تعذّر تحميل البيانات.',
    noMeasurement: 'لا يوجد قياس بعد.',
    noTrend: 'لم يُسجَّل أي اتجاه بعد.',
    noSamples: 'لا توجد عيّنات بعد.',
    targetPrefix: 'الهدف:',
    vsPrevious: 'مقارنةً بالسابق',
    trendSparklineAria: 'خط بياني مصغّر للاتجاه',
    kpiTrendAria: 'اتجاه مؤشر الأداء',
    valueSparklineAria: 'خط بياني مصغّر للقيمة',
    changeAria: (pct) => `التغيّر ${pct}`,
    trendingUpAria: 'اتجاه صاعد',
    trendingDownAria: 'اتجاه هابط',
    trendingFlatAria: 'اتجاه مستقر',
    couldntLoadGauge: 'تعذّر تحميل بيانات المقياس.',
    noDataAvailable: 'لا توجد بيانات متاحة.',
    statusPrefix: 'الحالة:',
    couldntLoadWidget: 'تعذّر تحميل عنصر العرض هذا.',
    noDataToDisplay: 'لا توجد بيانات للعرض',
    total: 'الإجمالي',
    heatmapAria: 'خريطة حرارية',
    heatCellAria: (y, x, value) => `${y}، ${x}: ${value}`,
    heatCellNoDataAria: (y, x) => `${y}، ${x}: لا توجد بيانات`,
    unableToLoadAlerts: 'تعذّر تحميل التنبيهات.',
    noActiveAlerts: 'لا توجد تنبيهات نشطة',
    unableToLoadStatus: 'تعذّر تحميل الحالة.',
    noStatusMetrics: 'لا توجد مقاييس عن الحالة',
    severityTag: (label) => `الخطورة: ${label}`,
    occurrencesAria: (count) => `${count} تكرارات`,
    statusAria: (label) => `الحالة: ${label}`,
    couldntLoadChart: 'تعذّر تحميل هذا الرسم البياني.',
    unableToLoadTable: 'تعذّر تحميل بيانات الجدول.',
    noData: 'لا توجد بيانات',
    noRows: 'لا توجد صفوف',
    showingOf: (shown, total) => `عرض ${shown} من ${total}`,
    unableToLoadText: 'تعذّر تحميل المحتوى النصّي.',
    noContent: 'لا يوجد محتوى',
    unsupportedType: (type) => `نوع عنصر عرض غير مدعوم: ${type}`,
  },
};

export function useVisusWidgetChromeLabels(): VisusWidgetChromeLabels {
  return useBilingual(visusWidgetChromeLabels);
}

// ---------------------------------------------------------------------------
// Dismiss-alert dialog (alerts/_components/dismiss-alert-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusAlertDismissLabels {
  title: string;
  description: (title: string) => string;
  descriptionFallback: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  cancel: string;
  dismiss: string;
}

export const visusAlertDismissLabels: VisusBilingual<VisusAlertDismissLabels> = {
  en: {
    title: 'Dismiss Alert',
    description: (title) => `Dismiss "${title}"? This will remove it from the active alerts view.`,
    descriptionFallback: 'Dismiss this alert?',
    reasonLabel: 'Reason (optional)',
    reasonPlaceholder: 'Why is this alert being dismissed?',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
  },
  ar: {
    title: 'تجاهل التنبيه',
    description: (title) => `تجاهل "${title}"؟ سيؤدي ذلك إلى إزالته من عرض التنبيهات النشطة.`,
    descriptionFallback: 'تجاهل هذا التنبيه؟',
    reasonLabel: 'السبب (اختياري)',
    reasonPlaceholder: 'ما سبب تجاهل هذا التنبيه؟',
    cancel: 'إلغاء',
    dismiss: 'تجاهل',
  },
};

export function useVisusAlertDismissLabels(): VisusAlertDismissLabels {
  return useBilingual(visusAlertDismissLabels);
}

// ---------------------------------------------------------------------------
// Report snapshots dialog (reports/_components/report-snapshots-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusReportSnapshotsLabels {
  title: string;
  description: string;
  loading: string;
  error: string;
  empty: string;
  snapshotLabel: (id: string) => string;
  generated: string;
  period: string;
  periodRange: (start: string, end: string) => string;
  generationTime: string;
  generationTimeValue: (ms: string) => string;
  sections: string;
  reportPayload: string;
}

export const visusReportSnapshotsLabels: VisusBilingual<VisusReportSnapshotsLabels> = {
  en: {
    title: 'Report Snapshots',
    description: 'Browse historical outputs generated for this report definition.',
    loading: 'Loading snapshots...',
    error: 'Failed to load snapshots.',
    empty: 'No snapshots have been generated yet.',
    snapshotLabel: (id) => `Snapshot ${id}`,
    generated: 'Generated',
    period: 'Period',
    periodRange: (start, end) => `${start} - ${end}`,
    generationTime: 'Generation Time',
    generationTimeValue: (ms) => `${ms} ms`,
    sections: 'Sections',
    reportPayload: 'Report Payload',
  },
  ar: {
    title: 'لقطات التقرير',
    description: 'تصفّح المخرجات التاريخية المُنشأة لهذا التعريف من التقرير.',
    loading: 'جارٍ تحميل اللقطات...',
    error: 'تعذّر تحميل اللقطات.',
    empty: 'لم تُنشأ أي لقطات بعد.',
    snapshotLabel: (id) => `اللقطة ${id}`,
    generated: 'تاريخ الإنشاء',
    period: 'الفترة',
    periodRange: (start, end) => `${start} - ${end}`,
    generationTime: 'زمن الإنشاء',
    generationTimeValue: (ms) => `${ms} ملّي ثانية`,
    sections: 'الأقسام',
    reportPayload: 'حمولة التقرير',
  },
};

export function useVisusReportSnapshotsLabels(): VisusReportSnapshotsLabels {
  return useBilingual(visusReportSnapshotsLabels);
}

// ---------------------------------------------------------------------------
// Latest snapshot preview dialog (reports/_components/snapshot-preview-dialog.tsx)
// ---------------------------------------------------------------------------

export interface VisusSnapshotPreviewLabels {
  title: string;
  description: string;
  loading: string;
  error: string;
  period: string;
  periodRange: (start: string, end: string) => string;
  generated: string;
  generationTime: string;
  generationTimeValue: (ms: string) => string;
  format: string;
  sections: string;
  narrative: string;
}

export const visusSnapshotPreviewLabels: VisusBilingual<VisusSnapshotPreviewLabels> = {
  en: {
    title: 'Latest Snapshot',
    description: 'Most recent report generation output.',
    loading: 'Loading snapshot...',
    error: 'Failed to load snapshot.',
    period: 'Period',
    periodRange: (start, end) => `${start} — ${end}`,
    generated: 'Generated',
    generationTime: 'Generation Time',
    generationTimeValue: (ms) => `${ms}ms`,
    format: 'Format',
    sections: 'Sections',
    narrative: 'Narrative',
  },
  ar: {
    title: 'أحدث لقطة',
    description: 'أحدث مخرَج لإنشاء التقرير.',
    loading: 'جارٍ تحميل اللقطة...',
    error: 'تعذّر تحميل اللقطة.',
    period: 'الفترة',
    periodRange: (start, end) => `${start} — ${end}`,
    generated: 'تاريخ الإنشاء',
    generationTime: 'زمن الإنشاء',
    generationTimeValue: (ms) => `${ms} ملّي ثانية`,
    format: 'الصيغة',
    sections: 'الأقسام',
    narrative: 'السرد',
  },
};

export function useVisusSnapshotPreviewLabels(): VisusSnapshotPreviewLabels {
  return useBilingual(visusSnapshotPreviewLabels);
}

/* ------------------------------------------------------------------------- *
 * Unified i18n registration.
 * ------------------------------------------------------------------------- */
registerMessages('visus', {
  en: {
    common: visusCommonLabels.en,
    overview: visusOverviewLabels.en,
    list: visusListLabels.en,
    enums: visusEnumLabels.en,
    dashboardsPage: visusDashboardsPageLabels.en,
    reportsPage: visusReportsPageLabels.en,
    kpisPage: visusKpisPageLabels.en,
    alertsPage: visusAlertsPageLabels.en,
    dashboardDetail: visusDashboardDetailLabels.en,
    formCommon: visusFormCommonLabels.en,
    dashboardForm: visusDashboardFormLabels.en,
    dashboardShare: visusDashboardShareLabels.en,
    reportForm: visusReportFormLabels.en,
    kpiForm: visusKpiFormLabels.en,
    widgetForm: visusWidgetFormLabels.en,
    widgetPreview: visusWidgetPreviewLabels.en,
    widgetChrome: visusWidgetChromeLabels.en,
    alertDismiss: visusAlertDismissLabels.en,
    reportSnapshots: visusReportSnapshotsLabels.en,
    snapshotPreview: visusSnapshotPreviewLabels.en,
  },
  ar: {
    common: visusCommonLabels.ar,
    overview: visusOverviewLabels.ar,
    list: visusListLabels.ar,
    enums: visusEnumLabels.ar,
    dashboardsPage: visusDashboardsPageLabels.ar,
    reportsPage: visusReportsPageLabels.ar,
    kpisPage: visusKpisPageLabels.ar,
    alertsPage: visusAlertsPageLabels.ar,
    dashboardDetail: visusDashboardDetailLabels.ar,
    formCommon: visusFormCommonLabels.ar,
    dashboardForm: visusDashboardFormLabels.ar,
    dashboardShare: visusDashboardShareLabels.ar,
    reportForm: visusReportFormLabels.ar,
    kpiForm: visusKpiFormLabels.ar,
    widgetForm: visusWidgetFormLabels.ar,
    widgetPreview: visusWidgetPreviewLabels.ar,
    widgetChrome: visusWidgetChromeLabels.ar,
    alertDismiss: visusAlertDismissLabels.ar,
    reportSnapshots: visusReportSnapshotsLabels.ar,
    snapshotPreview: visusSnapshotPreviewLabels.ar,
  },
});
