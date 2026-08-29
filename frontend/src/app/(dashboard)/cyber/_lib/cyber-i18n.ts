/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber Security suite (`/cyber`).
 *
 * This mirrors the lex/dr i18n pattern: every label group is a bilingual bundle
 * `{ en, ar }` (two FULL, same-shaped copies of the label object — English in
 * `en`, professional Saudi-register MSA in `ar`). Components NEVER receive the
 * bundle; they receive the resolved `T` via a thin `use<Feature>Labels()` hook
 * (React) or `resolveCyberBilingual()` (non-React / tests).
 *
 * Resolution defaults to English when no LocaleProvider is mounted (mirroring
 * `useLocaleOrDefault`), so isolated unit tests keep rendering the English
 * surface — the `en` side of every bundle MUST equal the pre-existing English
 * strings VERBATIM.
 *
 * Acronyms / product names stay as-is across both locales: MITRE ATT&CK, CTEM,
 * DSPM, vCISO, CTI, UEBA, SIEM, IOC, CVE, NCA, SAMA.
 *
 * REFERENCE MIGRATION (unified i18n): this module is registered into the
 * namespace registry as the 'cyber' namespace (see the `registerMessages` call
 * at the bottom of the file), so any component can ALSO resolve its string
 * leaves with `useT('cyber')` — e.g. `t('common.refresh')`,
 * `t('dashboard.title')` — with automatic fallback to the global catalog.
 * The typed hooks below remain the primary API and now ride the shared
 * `useBilingual` hook instead of a hand-rolled resolver.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

/** The canonical bundle shape for every cyber label group. */
export type CyberBilingual<T> = { readonly en: T; readonly ar: T };

/** Returns the `T` for `locale`, falling back to English. */
export function resolveCyberBilingual<T>(bundle: CyberBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

// ---------------------------------------------------------------------------
// Shared SOC / common cyber terms (used by the main dashboard and components)
// ---------------------------------------------------------------------------

export interface CyberCommonLabels {
  eyebrow: string;
  refresh: string;
  settings: string;
  retry: string;
  viewAll: string;
  cancel: string;
  // severity terms
  critical: string;
  high: string;
  medium: string;
  low: string;
  info: string;
  // recurring nouns
  total: string;
  alerts: string;
  confidence: string;
  technique: string;
  growth: string;
  trend: string;
}

export const cyberCommonLabels: CyberBilingual<CyberCommonLabels> = {
  en: {
    eyebrow: 'Cyber Defense',
    refresh: 'Refresh',
    settings: 'Settings',
    retry: 'Retry',
    viewAll: 'View all',
    cancel: 'Cancel',
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
    total: 'Total',
    alerts: 'Alerts',
    confidence: 'Confidence',
    technique: 'Technique',
    growth: 'Growth',
    trend: 'Trend',
  },
  ar: {
    eyebrow: 'الدفاع السيبراني',
    refresh: 'تحديث',
    settings: 'الإعدادات',
    retry: 'إعادة المحاولة',
    viewAll: 'عرض الكل',
    cancel: 'إلغاء',
    critical: 'حرج',
    high: 'عالٍ',
    medium: 'متوسط',
    low: 'منخفض',
    info: 'معلوماتي',
    total: 'الإجمالي',
    alerts: 'التنبيهات',
    confidence: 'الثقة',
    technique: 'الأسلوب',
    growth: 'النمو',
    trend: 'الاتجاه',
  },
};

export function useCyberCommonLabels(): CyberCommonLabels {
  return useBilingual(cyberCommonLabels);
}

// ---------------------------------------------------------------------------
// Main SOC dashboard (cyber/page.tsx) + dashboard widgets in _components/*
// ---------------------------------------------------------------------------

export interface CyberDashboardLabels {
  title: string;
  description: string;
  // page-header tags & stats
  tagLiveMonitoring: string;
  tagCritical: (count: number) => string;
  tagRisk: (score: number, grade?: string) => string;
  statOpenAlerts: string;
  statCritical: string;
  // section cards
  cardAlertVolume: string;
  cardSeverityDistribution: string;
  cardMitreHeatmap: string;
  cardVulnAging: string;
  cardRecentAlerts: string;
  cardTopAttackedAssets: string;
  cardAnalystWorkload: string;
  // page-level states
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  partialFailures: (sections: string) => string;
  // KPI cards
  kpiOpenAlerts: string;
  kpiOpenAlertsChange: string;
  kpiCriticalAlerts: string;
  kpiRiskScore: string;
  kpiMttr: string;
  kpiMttrDescription: string;
  // alert timeline chart
  alertVolumeSeriesLabel: string;
  alertVolumeEmpty: string;
  // analyst workload chart
  workloadOpen: string;
  workloadCritical: string;
  workloadEmpty: string;
  // vuln aging chart
  vulnAgingEmpty: string;
  // severity distribution
  severityTotalCenter: string;
  // mitre heatmap widget
  mitreEmptyTitle: string;
  mitreEmptyDescription: string;
  mitreLegendSparse: string;
  mitreLegendLow: string;
  mitreLegendModerate: string;
  mitreLegendHigh: string;
  mitreLegendHot: string;
  mitreLess: string;
  mitreMore: string;
  mitreOverflowMore: (count: string) => string;
  mitreFooter: (perTactic: number, detections: string) => string;
  mitreAlertsCountTooltip: (count: string, isOne: boolean) => string;
  mitreCriticalSuffix: (count: string) => string;
  // recent alerts table
  recentAlertsEmptyTitle: string;
  recentAlertsEmptyDescription: string;
  colSev: string;
  colTitle: string;
  colStatus: string;
  colConfidence: string;
  colDetected: string;
  // top attacked assets table
  attackedAssetsEmptyTitle: string;
  attackedAssetsEmptyDescription: string;
  colAsset: string;
  colCriticality: string;
  colAlerts: string;
  critShort: (count: number) => string;
}

export const cyberDashboardLabels: CyberBilingual<CyberDashboardLabels> = {
  en: {
    title: 'Security Operations Center',
    description: 'Real-time security monitoring and threat intelligence',
    tagLiveMonitoring: 'Live monitoring',
    tagCritical: (count) => `${count} critical`,
    tagRisk: (score, grade) => `Risk ${score}${grade ? ` (${grade})` : ''}`,
    statOpenAlerts: 'Open alerts',
    statCritical: 'Critical',
    cardAlertVolume: 'Alert Volume (24h)',
    cardSeverityDistribution: 'Severity Distribution',
    cardMitreHeatmap: 'MITRE ATT&CK Heatmap',
    cardVulnAging: 'Vulnerability Aging',
    cardRecentAlerts: 'Recent Critical Alerts',
    cardTopAttackedAssets: 'Top Attacked Assets',
    cardAnalystWorkload: 'Analyst Workload',
    loadError: 'Failed to load SOC dashboard. Please try again.',
    emptyTitle: 'No dashboard data yet',
    emptyDescription: 'SOC metrics will appear here once security telemetry starts flowing.',
    partialFailures: (sections) => `Some sections may be incomplete: ${sections}`,
    kpiOpenAlerts: 'Open Alerts',
    kpiOpenAlertsChange: 'vs yesterday',
    kpiCriticalAlerts: 'Critical Alerts',
    kpiRiskScore: 'Risk Score',
    kpiMttr: 'MTTR',
    kpiMttrDescription: 'Mean time to respond',
    alertVolumeSeriesLabel: 'Alerts',
    alertVolumeEmpty: 'No alert activity in the last 24 hours',
    workloadOpen: 'Open',
    workloadCritical: 'Critical',
    workloadEmpty: 'No analyst workload data',
    vulnAgingEmpty: 'No open vulnerabilities to age',
    severityTotalCenter: 'total',
    mitreEmptyTitle: 'No MITRE detections',
    mitreEmptyDescription: 'No MITRE ATT&CK techniques have been detected yet.',
    mitreLegendSparse: 'Sparse',
    mitreLegendLow: 'Low',
    mitreLegendModerate: 'Moderate',
    mitreLegendHigh: 'High',
    mitreLegendHot: 'Hot',
    mitreLess: 'Less',
    mitreMore: 'More',
    mitreOverflowMore: (count) => `+${count} more`,
    mitreFooter: (perTactic, detections) =>
      `Top ${perTactic} techniques per tactic · ${detections} detections`,
    mitreAlertsCountTooltip: (count, isOne) => `${count} alert${isOne ? '' : 's'}`,
    mitreCriticalSuffix: (count) => ` · ${count} critical`,
    recentAlertsEmptyTitle: 'No recent alerts',
    recentAlertsEmptyDescription: 'No critical alerts in the last 24 hours.',
    colSev: 'Sev',
    colTitle: 'Title',
    colStatus: 'Status',
    colConfidence: 'Confidence',
    colDetected: 'Detected',
    attackedAssetsEmptyTitle: 'No attacked assets',
    attackedAssetsEmptyDescription: 'No assets with active alerts found.',
    colAsset: 'Asset',
    colCriticality: 'Criticality',
    colAlerts: 'Alerts',
    critShort: (count) => `(${count} crit)`,
  },
  ar: {
    title: 'مركز العمليات الأمنية',
    description: 'مراقبة أمنية في الزمن الفعلي واستخبارات تهديدية',
    tagLiveMonitoring: 'مراقبة حية',
    tagCritical: (count) => `${count} حرج`,
    tagRisk: (score, grade) => `المخاطر ${score}${grade ? ` (${grade})` : ''}`,
    statOpenAlerts: 'التنبيهات المفتوحة',
    statCritical: 'حرج',
    cardAlertVolume: 'حجم التنبيهات (٢٤ ساعة)',
    cardSeverityDistribution: 'توزيع الخطورة',
    cardMitreHeatmap: 'خريطة MITRE ATT&CK الحرارية',
    cardVulnAging: 'تقادم الثغرات',
    cardRecentAlerts: 'أحدث التنبيهات الحرجة',
    cardTopAttackedAssets: 'أكثر الأصول استهدافًا',
    cardAnalystWorkload: 'عبء عمل المحللين',
    loadError: 'تعذّر تحميل لوحة مركز العمليات الأمنية. يُرجى المحاولة مرة أخرى.',
    emptyTitle: 'لا توجد بيانات للوحة بعد',
    emptyDescription: 'ستظهر مؤشرات مركز العمليات الأمنية هنا فور بدء تدفق بيانات القياس الأمنية.',
    partialFailures: (sections) => `قد تكون بعض الأقسام غير مكتملة: ${sections}`,
    kpiOpenAlerts: 'التنبيهات المفتوحة',
    kpiOpenAlertsChange: 'مقارنةً بالأمس',
    kpiCriticalAlerts: 'التنبيهات الحرجة',
    kpiRiskScore: 'درجة المخاطر',
    kpiMttr: 'متوسط زمن الاستجابة',
    kpiMttrDescription: 'متوسط الزمن اللازم للاستجابة',
    alertVolumeSeriesLabel: 'التنبيهات',
    alertVolumeEmpty: 'لا يوجد نشاط تنبيهات خلال آخر ٢٤ ساعة',
    workloadOpen: 'مفتوح',
    workloadCritical: 'حرج',
    workloadEmpty: 'لا توجد بيانات عن عبء عمل المحللين',
    vulnAgingEmpty: 'لا توجد ثغرات مفتوحة لقياس تقادمها',
    severityTotalCenter: 'الإجمالي',
    mitreEmptyTitle: 'لا توجد عمليات كشف لـ MITRE',
    mitreEmptyDescription: 'لم يُكتشف أي من أساليب MITRE ATT&CK حتى الآن.',
    mitreLegendSparse: 'متفرّق',
    mitreLegendLow: 'منخفض',
    mitreLegendModerate: 'متوسط',
    mitreLegendHigh: 'عالٍ',
    mitreLegendHot: 'مرتفع',
    mitreLess: 'أقل',
    mitreMore: 'أكثر',
    mitreOverflowMore: (count) => `+${count} المزيد`,
    mitreFooter: (perTactic, detections) =>
      `أعلى ${perTactic} أساليب لكل تكتيك · ${detections} عملية كشف`,
    mitreAlertsCountTooltip: (count, isOne) => (isOne ? `${count} تنبيه` : `${count} تنبيه`),
    mitreCriticalSuffix: (count) => ` · ${count} حرج`,
    recentAlertsEmptyTitle: 'لا توجد تنبيهات حديثة',
    recentAlertsEmptyDescription: 'لا توجد تنبيهات حرجة خلال آخر ٢٤ ساعة.',
    colSev: 'الخطورة',
    colTitle: 'العنوان',
    colStatus: 'الحالة',
    colConfidence: 'الثقة',
    colDetected: 'وقت الكشف',
    attackedAssetsEmptyTitle: 'لا توجد أصول مستهدَفة',
    attackedAssetsEmptyDescription: 'لم يُعثر على أصول لديها تنبيهات نشطة.',
    colAsset: 'الأصل',
    colCriticality: 'الأهمية',
    colAlerts: 'التنبيهات',
    critShort: (count) => `(${count} حرج)`,
  },
};

export function useCyberDashboardLabels(): CyberDashboardLabels {
  return useBilingual(cyberDashboardLabels);
}

// ---------------------------------------------------------------------------
// Shared status / severity / level display labels (data-driven enum keys)
// ---------------------------------------------------------------------------

/** Severity enum keys → display label. Falls back to the raw key. */
export const cyberSeverityLabels: CyberBilingual<Record<string, string>> = {
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
    informational: 'Informational',
  },
  ar: {
    critical: 'حرج',
    high: 'عالٍ',
    medium: 'متوسط',
    low: 'منخفض',
    info: 'معلوماتي',
    informational: 'معلوماتي',
  },
};

export function useCyberSeverityLabels(): Record<string, string> {
  return useBilingual(cyberSeverityLabels);
}

/** Alert status enum keys → display label. Falls back to the humanized raw key. */
export const cyberAlertStatusLabels: CyberBilingual<Record<string, string>> = {
  en: {
    new: 'New',
    acknowledged: 'Acknowledged',
    investigating: 'Investigating',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
    false_positive: 'False Positive',
    escalated: 'Escalated',
  },
  ar: {
    new: 'جديد',
    acknowledged: 'مُقَر',
    investigating: 'قيد التحقيق',
    in_progress: 'قيد المعالجة',
    resolved: 'تم الحل',
    closed: 'مُغلق',
    false_positive: 'إنذار كاذب',
    escalated: 'مُصعَّد',
  },
};

export function useCyberAlertStatusLabels(): Record<string, string> {
  return useBilingual(cyberAlertStatusLabels);
}

/** Criticality enum keys → display label. */
export const cyberCriticalityLabels: CyberBilingual<Record<string, string>> = {
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

export function useCyberCriticalityLabels(): Record<string, string> {
  return useBilingual(cyberCriticalityLabels);
}

/* ------------------------------------------------------------------------- *
 * Unified i18n registration.
 *
 * Exposes every string leaf above to the namespaced translator:
 *
 *   const t = useT('cyber');
 *   t('common.refresh')      -> "تحديث" / "Refresh"
 *   t('severity.critical')   -> "حرج" / "Critical"
 *   t('shell.search')        -> falls through to the GLOBAL catalog
 *
 * Function-valued labels (e.g. dashboard.tagCritical) stay accessible only
 * through the typed hooks — the translator resolves string leaves.
 * ------------------------------------------------------------------------- */
registerMessages('cyber', {
  en: {
    common: cyberCommonLabels.en,
    dashboard: cyberDashboardLabels.en,
    severity: cyberSeverityLabels.en,
    alertStatus: cyberAlertStatusLabels.en,
    criticality: cyberCriticalityLabels.en,
  },
  ar: {
    common: cyberCommonLabels.ar,
    dashboard: cyberDashboardLabels.ar,
    severity: cyberSeverityLabels.ar,
    alertStatus: cyberAlertStatusLabels.ar,
    criticality: cyberCriticalityLabels.ar,
  },
});
