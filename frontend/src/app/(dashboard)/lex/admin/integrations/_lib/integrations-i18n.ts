/**
 * Bilingual (AR — MSA / EN) labels for the admin/integrations console list page.
 * Arabic is the default surface; English is the fallback. Resolved at the call
 * site via:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? labels.ar : labels.en;
 *
 * Kept module-local on purpose — this is a suite-specific admin feature and must
 * not touch the shared `@/lib/i18n/messages` catalog (the integrator owns that).
 * All copy here is plain strings (no JSX) so it stays portable + RTL-safe.
 */
import type { AppLocale } from '@/lib/i18n';
import type {
  IntegrationHealthGrade,
  IntegrationStatus,
} from '@/lib/lex/integrations';

export interface IntegrationsListLabels {
  /* Header */
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  refresh: string;
  newIntegration: string;
  configure: string;
  manage: string;
  test: string;
  testing: string;

  /* KPI strip (by health grade) */
  kpiTotal: string;
  kpiHealthy: string;
  kpiDegraded: string;
  kpiDown: string;
  kpiUnconfigured: string;
  kpiTotalHint: string;
  kpiHealthyHint: string;
  kpiDegradedHint: string;
  kpiDownHint: string;
  kpiUnconfiguredHint: string;

  /* Card meta */
  connectorsCount: (n: number) => string;
  noConnectors: string;
  govGated: string;
  encrypted: string;
  lastChecked: string;
  neverChecked: string;
  configureFirst: string;
  defaultName: string;

  /* Status labels */
  status: Record<IntegrationStatus, string>;
  /* Health grade labels (dot tooltip / legend) */
  grade: Record<IntegrationHealthGrade, string>;

  /* States */
  emptyTitle: string;
  emptyBody: string;
  emptyCta: string;
  errorTitle: string;
  errorBody: string;
  healthUnavailableTitle: string;
  healthUnavailableBody: string;
  readOnlyNote: string;

  /* Toasts */
  toastReachable: string;
  toastUnreachable: string;

  /* Health sparkline / uptime (Feature 6) */
  uptimeLabel: (pct: number) => string;
  uptimeAria: (pct: number, samples: number) => string;
  uptimeNoHistory: string;
  degrading: string;
  degradeHint: string;

  /* Test quick-action summary (Feature 2 card) */
  testStepsSummary: (pass: number, total: number) => string;
  testNoSteps: string;
  testFailedSteps: (n: number) => string;
  testWarnSteps: (n: number) => string;

  /* Bulk actions toolbar (bonus) */
  bulkSelected: (n: number) => string;
  bulkSelectAll: string;
  bulkClear: string;
  bulkTestAll: string;
  bulkEnable: string;
  bulkDisable: string;
  bulkTesting: string;
  bulkEnabling: string;
  bulkDisabling: string;
  bulkManageDenied: string;
  bulkTestDone: (pass: number, total: number) => string;
  bulkEnableDone: (n: number) => string;
  bulkDisableDone: (n: number) => string;
  bulkPartial: (ok: number, total: number) => string;
  selectRow: string;

  /* Relative time */
  justNow: string;
  ago: (value: string) => string;
}

/** lib re-export so callers don't import two modules for the same screen. */
export type { IntegrationHealthGrade, IntegrationStatus };

export const labels: { en: IntegrationsListLabels; ar: IntegrationsListLabels } = {
  en: {
    pageTitle: 'Integrations',
    pageDescription:
      'Federate the legal suite with external systems — register connectors, probe health, and run on-demand syncs.',
    eyebrow: 'Integration Platform',
    refresh: 'Refresh',
    newIntegration: 'New integration',
    configure: 'Configure',
    manage: 'Manage',
    test: 'Test',
    testing: 'Testing…',

    kpiTotal: 'Connectors',
    kpiHealthy: 'Healthy',
    kpiDegraded: 'Degraded',
    kpiDown: 'Down',
    kpiUnconfigured: 'Not configured',
    kpiTotalHint: 'Registered endpoints across all kinds',
    kpiHealthyHint: 'Active and reachable on last probe',
    kpiDegradedHint: 'Active but with a recent error',
    kpiDownHint: 'In an error state',
    kpiUnconfiguredHint: 'Planned connectors not yet configured',

    connectorsCount: (n) => (n === 1 ? '1 connector' : `${n} connectors`),
    noConnectors: 'No connectors yet',
    govGated: 'Gov-gated',
    encrypted: 'Encrypted at rest',
    lastChecked: 'Last checked',
    neverChecked: 'Never probed',
    configureFirst: 'Add your first connector for this kind.',
    defaultName: 'Untitled connector',

    status: {
      planned: 'Planned',
      active: 'Active',
      disabled: 'Disabled',
      error: 'Error',
    },
    grade: {
      healthy: 'Healthy',
      degraded: 'Degraded',
      down: 'Unreachable',
      unconfigured: 'Not configured',
      disabled: 'Disabled',
    },

    emptyTitle: 'No integrations registered',
    emptyBody:
      'This tenant has not configured any external connectors yet. Pick a kind below to register your first endpoint.',
    emptyCta: 'Configure a connector',
    errorTitle: 'Could not load integrations',
    errorBody:
      'The integrations registry request failed. Retry, or check that the lex service is running.',
    healthUnavailableTitle: 'Health probes unavailable',
    healthUnavailableBody:
      'Connector registry actions remain available, but aggregate health could not be refreshed.',
    readOnlyNote: 'You have read-only access; configuration changes are disabled.',

    toastReachable: 'Connector is reachable.',
    toastUnreachable: 'Connector is not reachable.',

    uptimeLabel: (pct) => `${pct}% uptime`,
    uptimeAria: (pct, samples) =>
      `Health history: ${pct}% uptime over the last ${samples} probes.`,
    uptimeNoHistory: 'No health history yet',
    degrading: 'Degrading',
    degradeHint: 'The latest probe is worse than the previous one.',

    testStepsSummary: (pass, total) => `${pass}/${total} checks passed`,
    testNoSteps: 'No diagnostic detail',
    testFailedSteps: (n) => (n === 1 ? '1 failed' : `${n} failed`),
    testWarnSteps: (n) => (n === 1 ? '1 warning' : `${n} warnings`),

    bulkSelected: (n) => (n === 1 ? '1 selected' : `${n} selected`),
    bulkSelectAll: 'Select all',
    bulkClear: 'Clear',
    bulkTestAll: 'Test selected',
    bulkEnable: 'Enable',
    bulkDisable: 'Disable',
    bulkTesting: 'Testing…',
    bulkEnabling: 'Enabling…',
    bulkDisabling: 'Disabling…',
    bulkManageDenied: 'You lack permission to enable or disable connectors.',
    bulkTestDone: (pass, total) => `${pass}/${total} connectors reachable`,
    bulkEnableDone: (n) => (n === 1 ? 'Enabled 1 connector' : `Enabled ${n} connectors`),
    bulkDisableDone: (n) =>
      n === 1 ? 'Disabled 1 connector' : `Disabled ${n} connectors`,
    bulkPartial: (ok, total) => `${ok}/${total} succeeded`,
    selectRow: 'Select connector',

    justNow: 'just now',
    ago: (value) => `${value} ago`,
  },
  ar: {
    pageTitle: 'عمليات التكامل',
    pageDescription:
      'اربط المجموعة القانونية بالأنظمة الخارجية — سجّل الموصّلات، وافحص الصحة، ونفّذ المزامنة عند الطلب.',
    eyebrow: 'منصة التكامل',
    refresh: 'تحديث',
    newIntegration: 'تكامل جديد',
    configure: 'تهيئة',
    manage: 'إدارة',
    test: 'اختبار',
    testing: 'جارٍ الاختبار…',

    kpiTotal: 'الموصّلات',
    kpiHealthy: 'سليم',
    kpiDegraded: 'متدهور',
    kpiDown: 'متوقّف',
    kpiUnconfigured: 'غير مُهيّأ',
    kpiTotalHint: 'النقاط المسجّلة عبر كل الأنواع',
    kpiHealthyHint: 'فعّال ويمكن الوصول إليه في آخر فحص',
    kpiDegradedHint: 'فعّال لكن مع خطأ حديث',
    kpiDownHint: 'في حالة خطأ',
    kpiUnconfiguredHint: 'بنود مخطّطة لم تُهيّأ بعد',

    connectorsCount: (n) => {
      if (n === 1) return 'موصّل واحد';
      if (n === 2) return 'موصّلان';
      if (n >= 3 && n <= 10) return `${n} موصّلات`;
      return `${n} موصّلًا`;
    },
    noConnectors: 'لا توجد موصّلات بعد',
    govGated: 'مقيّد حكوميًا',
    encrypted: 'مشفّر عند التخزين',
    lastChecked: 'آخر فحص',
    neverChecked: 'لم يُفحص بعد',
    configureFirst: 'أضف أول موصّل لهذا النوع.',
    defaultName: 'موصّل بلا اسم',

    status: {
      planned: 'مخطّط',
      active: 'فعّال',
      disabled: 'معطّل',
      error: 'خطأ',
    },
    grade: {
      healthy: 'سليم',
      degraded: 'متدهور',
      down: 'غير قابل للوصول',
      unconfigured: 'غير مُهيّأ',
      disabled: 'معطّل',
    },

    emptyTitle: 'لا توجد عمليات تكامل مسجّلة',
    emptyBody:
      'لم يُهيّئ هذا المستأجر أي موصّلات خارجية بعد. اختر نوعًا أدناه لتسجيل أول نقطة.',
    emptyCta: 'تهيئة موصّل',
    errorTitle: 'تعذّر تحميل عمليات التكامل',
    errorBody: 'فشل طلب سجل التكامل. أعد المحاولة أو تحقق من تشغيل خدمة lex.',
    healthUnavailableTitle: 'فحوصات الصحة غير متاحة',
    healthUnavailableBody:
      'تظل إجراءات سجل الموصّلات متاحة، لكن تعذّر تحديث الصحة الإجمالية.',
    readOnlyNote: 'صلاحيتك للقراءة فقط؛ تعديلات التهيئة معطّلة.',

    toastReachable: 'الموصّل قابل للوصول.',
    toastUnreachable: 'الموصّل غير قابل للوصول.',

    uptimeLabel: (pct) => `${pct}٪ جاهزية`,
    uptimeAria: (pct, samples) =>
      `سجل الصحة: ${pct}٪ جاهزية خلال آخر ${samples} فحوصات.`,
    uptimeNoHistory: 'لا يوجد سجل صحة بعد',
    degrading: 'يتدهور',
    degradeHint: 'الفحص الأخير أسوأ من الفحص السابق.',

    testStepsSummary: (pass, total) => `${pass}/${total} فحوصات ناجحة`,
    testNoSteps: 'لا توجد تفاصيل تشخيصية',
    testFailedSteps: (n) => {
      if (n === 1) return 'فشل واحد';
      if (n === 2) return 'فشلان';
      return `${n} حالات فشل`;
    },
    testWarnSteps: (n) => {
      if (n === 1) return 'تحذير واحد';
      if (n === 2) return 'تحذيران';
      return `${n} تحذيرات`;
    },

    bulkSelected: (n) => {
      if (n === 1) return 'عنصر واحد محدّد';
      if (n === 2) return 'عنصران محدّدان';
      if (n >= 3 && n <= 10) return `${n} عناصر محدّدة`;
      return `${n} عنصرًا محدّدًا`;
    },
    bulkSelectAll: 'تحديد الكل',
    bulkClear: 'مسح',
    bulkTestAll: 'اختبار المحدّد',
    bulkEnable: 'تفعيل',
    bulkDisable: 'تعطيل',
    bulkTesting: 'جارٍ الاختبار…',
    bulkEnabling: 'جارٍ التفعيل…',
    bulkDisabling: 'جارٍ التعطيل…',
    bulkManageDenied: 'لا تملك صلاحية تفعيل أو تعطيل الموصّلات.',
    bulkTestDone: (pass, total) => `${pass}/${total} موصّلات قابلة للوصول`,
    bulkEnableDone: (n) => {
      if (n === 1) return 'تم تفعيل موصّل واحد';
      if (n === 2) return 'تم تفعيل موصّلين';
      return `تم تفعيل ${n} موصّلات`;
    },
    bulkDisableDone: (n) => {
      if (n === 1) return 'تم تعطيل موصّل واحد';
      if (n === 2) return 'تم تعطيل موصّلين';
      return `تم تعطيل ${n} موصّلات`;
    },
    bulkPartial: (ok, total) => `${ok}/${total} نجحت`,
    selectRow: 'تحديد الموصّل',

    justNow: 'الآن',
    ago: (value) => `قبل ${value}`,
  },
};

/** Pick the label bundle for a locale (AR default, EN fallback). */
export function integrationsLabels(locale: AppLocale): IntegrationsListLabels {
  return locale === 'ar' ? labels.ar : labels.en;
}
