/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario Respond major-incident command suite (`/respond`).
 *
 * Mirrors the cyber/lex i18n pattern: every label group is a bilingual bundle
 * `{ en, ar }`. Components receive the resolved `T` via a thin
 * `use<Feature>Labels()` hook (React) or `resolveRespondBilingual()`
 * (non-React / tests). The `en` side MUST equal the pre-existing English
 * strings VERBATIM so English render is unchanged.
 *
 * Severity codes (SEV1..SEV4) stay as-is across both locales.
 *
 * Registered into the namespace registry as the 'respond' namespace.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 * Termbase anchors: incident=حادث (NOT حدث), event=حدث, severity=الخطورة,
 * escalation=تصعيد, runbook=دليل التشغيل, approval/sign-off=اعتماد (NOT موافقة),
 * owner/assignee=المسؤول/المُكلَّف (NOT المالك), export=تصدير, download=تنزيل
 * (NEVER تحميل), save=حفظ, status=الحالة, tenant=المستأجر, role=دور,
 * failover=تجاوز الفشل. Acronyms (MTTR/PIR/ITSM/CSV/PDF/URL) kept verbatim and
 * glossed on first use. Product/brand names (ServiceNow, Slack) stay verbatim.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type RespondBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveRespondBilingual<T>(bundle: RespondBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

// ---------------------------------------------------------------------------
// Shared common terms
// ---------------------------------------------------------------------------

export interface RespondCommonLabels {
  eyebrow: string;
  refresh: string;
  retry: string;
  cancel: string;
  incidents: string;
  product: string;
  unrecorded: string;
  remove: string;
  unassigned: string;
  system: string;
  download: string;
}

export const respondCommonLabels: RespondBilingual<RespondCommonLabels> = {
  en: {
    eyebrow: 'Clario Respond',
    refresh: 'Refresh',
    retry: 'Retry',
    cancel: 'Cancel',
    incidents: 'Incidents',
    product: 'Product',
    unrecorded: 'Unrecorded',
    remove: 'Remove',
    unassigned: 'Unassigned',
    system: 'System',
    download: 'Download',
  },
  ar: {
    eyebrow: 'كلاريو الاستجابة',
    refresh: 'تحديث',
    retry: 'إعادة المحاولة',
    cancel: 'إلغاء',
    incidents: 'الحوادث',
    product: 'المنتج',
    unrecorded: 'غير مسجَّل',
    remove: 'إزالة',
    unassigned: 'غير مُسنَد',
    system: 'النظام',
    download: 'تنزيل',
  },
};

export function useRespondCommonLabels(): RespondCommonLabels {
  return useBilingual(respondCommonLabels);
}

// ---------------------------------------------------------------------------
// Product / overview page (respond/page.tsx)
// ---------------------------------------------------------------------------

export interface RespondOverviewLabels {
  title: string;
  description: string;
  loadingProduct: string;
  productUnavailableTitle: string;
  productUnavailableMessage: string;
  licensed: string;
  notLicensed: string;
  entitlement: string;
  unknown: string;
  capabilities: string;
  enabled: string;
  enabledState: string;
  disabledState: string;
  capabilitiesCardTitle: string;
  capabilitiesCardDescription: string;
  noCapabilitiesTitle: string;
  noCapabilitiesDescription: string;
}

export const respondOverviewLabels: RespondBilingual<RespondOverviewLabels> = {
  en: {
    title: 'Major Incident Command Center',
    description:
      'Declare, mobilize, coordinate, communicate, and review major incidents from one governed product surface.',
    loadingProduct: 'Loading Respond product',
    productUnavailableTitle: 'Respond product unavailable',
    productUnavailableMessage:
      'The product registration endpoint did not return a Respond entitlement record.',
    licensed: 'Licensed',
    notLicensed: 'Not licensed',
    entitlement: 'Entitlement',
    unknown: 'unknown',
    capabilities: 'Capabilities',
    enabled: 'Enabled',
    enabledState: 'Enabled',
    disabledState: 'Disabled',
    capabilitiesCardTitle: 'Capabilities',
    capabilitiesCardDescription: 'Capability state is resolved by the Respond product endpoint.',
    noCapabilitiesTitle: 'No capabilities returned',
    noCapabilitiesDescription: 'The product endpoint returned an empty capability set.',
  },
  ar: {
    title: 'مركز قيادة الحوادث الكبرى',
    description:
      'إعلان الحوادث الكبرى وحشد الفرق والتنسيق والتواصل والمراجعة من سطح منتج واحد محوكَم.',
    loadingProduct: 'جارٍ تحميل منتج الاستجابة',
    productUnavailableTitle: 'منتج الاستجابة غير متاح',
    productUnavailableMessage: 'لم تُعِد واجهة تسجيل المنتج سجلَّ استحقاق للاستجابة.',
    licensed: 'مُرخَّص',
    notLicensed: 'غير مُرخَّص',
    entitlement: 'الاستحقاق',
    unknown: 'غير معروف',
    capabilities: 'القدرات',
    enabled: 'المُفعَّلة',
    enabledState: 'مُفعَّل',
    disabledState: 'مُعطَّل',
    capabilitiesCardTitle: 'القدرات',
    capabilitiesCardDescription: 'تُحدَّد حالة القدرة عبر واجهة منتج الاستجابة.',
    noCapabilitiesTitle: 'لم تُعَد أي قدرات',
    noCapabilitiesDescription: 'أعادت واجهة المنتج مجموعة قدرات فارغة.',
  },
};

export function useRespondOverviewLabels(): RespondOverviewLabels {
  return useBilingual(respondOverviewLabels);
}

// ---------------------------------------------------------------------------
// Incidents list page (respond/incidents/page.tsx)
// ---------------------------------------------------------------------------

export interface RespondIncidentsLabels {
  title: string;
  description: string;
  loading: string;
  unavailableTitle: string;
  unavailableMessage: string;
  totalTag: (count: number) => string;
  loadedTag: (count: number) => string;
  queueTitle: string;
  queueDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  noCommander: string;
  taskSummary: (open: number, overdue: number) => string;
  declaredAt: (when: string) => string;
  noImpactedServices: string;
}

export const respondIncidentsLabels: RespondBilingual<RespondIncidentsLabels> = {
  en: {
    title: 'Major incidents',
    description:
      'Live and historical major incidents resolved through the Respond command workflow.',
    loading: 'Loading Respond incidents',
    unavailableTitle: 'Incidents unavailable',
    unavailableMessage: 'The incidents endpoint did not return a readable incident list.',
    totalTag: (count) => `${count} total`,
    loadedTag: (count) => `${count} loaded`,
    queueTitle: 'Incident queue',
    queueDescription: 'Rows are read from the tenant-scoped Respond incident list endpoint.',
    emptyTitle: 'No incidents returned',
    emptyDescription: 'The incident list endpoint returned an empty page for this tenant.',
    noCommander: 'No commander assigned',
    taskSummary: (open, overdue) => `${open} open · ${overdue} overdue`,
    declaredAt: (when) => `Declared ${when}`,
    noImpactedServices: 'No impacted services recorded',
  },
  ar: {
    title: 'الحوادث الكبرى',
    description: 'الحوادث الكبرى الجارية والتاريخية التي عولجت عبر سير عمل قيادة الاستجابة.',
    loading: 'جارٍ تحميل حوادث الاستجابة',
    unavailableTitle: 'الحوادث غير متاحة',
    unavailableMessage: 'لم تُعِد واجهة الحوادث قائمة حوادث قابلة للقراءة.',
    totalTag: (count) => `${count} إجمالًا`,
    loadedTag: (count) => `${count} مُحمَّل`,
    queueTitle: 'قائمة الحوادث',
    queueDescription: 'تُقرأ الصفوف من واجهة قائمة حوادث الاستجابة المرتبطة بالمستأجر.',
    emptyTitle: 'لم تُعَد أي حوادث',
    emptyDescription: 'أعادت واجهة قائمة الحوادث صفحة فارغة لهذا المستأجر.',
    noCommander: 'لم يُعيَّن قائد',
    taskSummary: (open, overdue) => `${open} مفتوحة · ${overdue} متأخرة`,
    declaredAt: (when) => `أُعلن ${when}`,
    noImpactedServices: 'لم تُسجَّل خدمات متأثرة',
  },
};

export function useRespondIncidentsLabels(): RespondIncidentsLabels {
  return useBilingual(respondIncidentsLabels);
}

// ---------------------------------------------------------------------------
// Incident status / severity enum labels
// ---------------------------------------------------------------------------

/** Incident status → display label. Falls back to the raw key. */
export const respondStatusLabels: RespondBilingual<Record<string, string>> = {
  en: {
    Declared: 'Declared',
    Triaged: 'Triaged',
    Mobilizing: 'Mobilizing',
    Investigating: 'Investigating',
    Mitigating: 'Mitigating',
    Mitigated: 'Mitigated',
    Resolved: 'Resolved',
    Closed: 'Closed',
    Cancelled: 'Cancelled',
  },
  ar: {
    Declared: 'مُعلَن',
    Triaged: 'مُصنَّف',
    Mobilizing: 'قيد الحشد',
    Investigating: 'قيد التحقيق',
    Mitigating: 'قيد التخفيف',
    Mitigated: 'مُخفَّف',
    Resolved: 'محلول',
    Closed: 'مغلق',
    Cancelled: 'ملغى',
  },
};

export function useRespondStatusLabels(): Record<string, string> {
  return useBilingual(respondStatusLabels);
}

// ---------------------------------------------------------------------------
// Capability entitlement reason strings (respond-capabilities.ts helper).
// `requiresCapability` / `disabledByEntitlement` are FUNCTION leaves so the
// termbase linter skips them (they interpolate a caller-supplied label).
// ---------------------------------------------------------------------------

export interface RespondCapabilityReasonLabels {
  stateUnavailable: string;
  requiresCapability: (label: string) => string;
  disabledByEntitlement: (label: string) => string;
}

export const respondCapabilityReasonLabels: RespondBilingual<RespondCapabilityReasonLabels> = {
  en: {
    stateUnavailable: 'Respond capability state is unavailable.',
    requiresCapability: (label) =>
      `${label} requires a Respond capability that is not enabled for this tenant.`,
    disabledByEntitlement: (label) =>
      `${label} is disabled by the current Respond entitlement.`,
  },
  ar: {
    stateUnavailable: 'حالة قدرة الاستجابة غير متاحة.',
    requiresCapability: (label) => `${label} يتطلّب قدرة استجابة غير مُفعَّلة لهذا المستأجر.`,
    disabledByEntitlement: (label) => `${label} مُعطَّل بموجب استحقاق الاستجابة الحالي.`,
  },
};

export function useRespondCapabilityReasonLabels(): RespondCapabilityReasonLabels {
  return useBilingual(respondCapabilityReasonLabels);
}

// ---------------------------------------------------------------------------
// Incident command cockpit page (respond/incidents/[id]/page.tsx)
// ---------------------------------------------------------------------------

export interface RespondCockpitLabels {
  loading: string;
  unavailableTitle: string;
  unavailableMessage: string;
  eyebrow: string;
  defaultDescription: string;
  liveStreamConnected: string;
  timelineStreamUnavailable: string;
  mttr: string;
  tasks: string;
  roles: string;
  declared: string;
  detected: string;
  impactedServices: string;
  taskProgress: string;
  workspaceAria: string;
  tabTriage: string;
  tabResponse: string;
  tabCoordination: string;
  tabEvidence: string;
  durationUnits: { d: string; h: string; m: string };
}

export const respondCockpitLabels: RespondBilingual<RespondCockpitLabels> = {
  en: {
    loading: 'Loading incident command center',
    unavailableTitle: 'Command center unavailable',
    unavailableMessage: 'The cockpit endpoint did not return a readable incident aggregate.',
    eyebrow: 'Respond Command Center',
    defaultDescription: 'Major incident cockpit aggregate.',
    liveStreamConnected: 'Live stream connected',
    timelineStreamUnavailable: 'Timeline stream unavailable',
    mttr: 'MTTR',
    tasks: 'Tasks',
    roles: 'Roles',
    declared: 'Declared',
    detected: 'Detected',
    impactedServices: 'Impacted services',
    taskProgress: 'Task progress',
    workspaceAria: 'Respond incident workspace',
    tabTriage: 'Triage',
    tabResponse: 'Response',
    tabCoordination: 'Coordination',
    tabEvidence: 'Evidence',
    durationUnits: { d: 'd', h: 'h', m: 'm' },
  },
  ar: {
    loading: 'جارٍ تحميل مركز قيادة الحادث',
    unavailableTitle: 'مركز القيادة غير متاح',
    unavailableMessage: 'لم تُعِد واجهة قمرة القيادة تجميعة حادث قابلة للقراءة.',
    eyebrow: 'مركز قيادة الاستجابة',
    defaultDescription: 'تجميعة قمرة قيادة الحادث الكبير.',
    liveStreamConnected: 'البثّ المباشر متصل',
    timelineStreamUnavailable: 'بثّ المخطط الزمني غير متاح',
    mttr: 'MTTR — متوسط زمن الإصلاح',
    tasks: 'المهام',
    roles: 'الأدوار',
    declared: 'الإعلان',
    detected: 'الاكتشاف',
    impactedServices: 'الخدمات المتأثرة',
    taskProgress: 'تقدّم المهمة',
    workspaceAria: 'مساحة عمل حادث الاستجابة',
    tabTriage: 'الفرز',
    tabResponse: 'الاستجابة',
    tabCoordination: 'التنسيق',
    tabEvidence: 'الأدلة',
    durationUnits: { d: 'ي', h: 'س', m: 'د' },
  },
};

export function useRespondCockpitLabels(): RespondCockpitLabels {
  return useBilingual(respondCockpitLabels);
}

// ---------------------------------------------------------------------------
// Declare incident (dialog + declaration panel)
// ---------------------------------------------------------------------------

export interface RespondDeclareLabels {
  dialogTrigger: string;
  dialogTitle: string;
  dialogDescription: string;
  panelTitle: string;
  panelDescription: string;
  badgeEnabled: string;
  badgeDisabled: string;
  titleLabel: string;
  severityLabel: string;
  descriptionLabel: string;
  detectedLabel: string;
  servicesLabel: string;
  servicesLinked: (count: number) => string;
  noServicesLinked: string;
  submit: string;
  capabilityLabel: string;
  criteriaTitle: string;
  criteria: { SEV1: string; SEV2: string; SEV3: string; SEV4: string };
  recommendationGatedTitle: string;
  recommendationGatedDescription: string;
  toastDeclaredTitle: string;
  toastDeclaredBody: (reference: string) => string;
}

export const respondDeclareLabels: RespondBilingual<RespondDeclareLabels> = {
  en: {
    dialogTrigger: 'Declare incident',
    dialogTitle: 'Declare major incident',
    dialogDescription:
      'Creates a tenant-scoped Respond incident and starts the lifecycle timeline.',
    panelTitle: 'Declare incident',
    panelDescription:
      'Creates a tenant-scoped Respond incident and starts the lifecycle timeline.',
    badgeEnabled: 'Declaration enabled',
    badgeDisabled: 'Declaration unavailable',
    titleLabel: 'Title',
    severityLabel: 'Initial severity',
    descriptionLabel: 'Description',
    detectedLabel: 'Detected at',
    servicesLabel: 'Impacted services',
    servicesLinked: (count) =>
      `${count} service identifier${count === 1 ? '' : 's'} will be linked.`,
    noServicesLinked: 'No service identifiers will be linked on declaration.',
    submit: 'Declare',
    capabilityLabel: 'Incident declaration',
    criteriaTitle: 'Severity criteria',
    criteria: {
      SEV1: 'Broad outage, severe interruption, material revenue loss, or reportable exposure.',
      SEV2: 'Major degradation or partial outage affecting important users or processes.',
      SEV3: 'Moderate impact with limited scope, workaround, or low direct revenue impact.',
      SEV4: 'Localized issue or operational concern without critical process impact.',
    },
    recommendationGatedTitle: 'Recommendation endpoint gated',
    recommendationGatedDescription:
      'Impact scoring controls become editable when the Respond triage capability is enabled for this tenant.',
    toastDeclaredTitle: 'Incident declared.',
    toastDeclaredBody: (reference) => `${reference} was created in Respond.`,
  },
  ar: {
    dialogTrigger: 'إعلان حادث',
    dialogTitle: 'إعلان حادث كبير',
    dialogDescription: 'يُنشئ حادث استجابة محدودًا بالمستأجر ويبدأ المخطط الزمني لدورة الحياة.',
    panelTitle: 'إعلان حادث',
    panelDescription: 'يُنشئ حادث استجابة محدودًا بالمستأجر ويبدأ المخطط الزمني لدورة الحياة.',
    badgeEnabled: 'الإعلان مُفعَّل',
    badgeDisabled: 'الإعلان غير متاح',
    titleLabel: 'العنوان',
    severityLabel: 'الخطورة الأولية',
    descriptionLabel: 'الوصف',
    detectedLabel: 'وقت الاكتشاف',
    servicesLabel: 'الخدمات المتأثرة',
    servicesLinked: (count) => `سيتم ربط ${count} من مُعرِّفات الخدمة.`,
    noServicesLinked: 'لن تُربط أي مُعرِّفات خدمة عند الإعلان.',
    submit: 'إعلان',
    capabilityLabel: 'إعلان الحادث',
    criteriaTitle: 'معايير الخطورة',
    criteria: {
      SEV1: 'انقطاع واسع، أو تعطّل شديد، أو خسارة إيرادات جوهرية، أو تعرُّض يستوجب الإبلاغ.',
      SEV2: 'تدهور كبير أو انقطاع جزئي يؤثّر على مستخدمين أو عمليات مهمة.',
      SEV3: 'تأثير متوسط بنطاق محدود، أو حلّ بديل، أو تأثير مباشر منخفض على الإيرادات.',
      SEV4: 'مشكلة محدودة أو مصدر قلق تشغيلي دون تأثير على العمليات الحرجة.',
    },
    recommendationGatedTitle: 'واجهة التوصية مُقيَّدة',
    recommendationGatedDescription:
      'تُصبح عناصر التحكم في تقييم الأثر قابلة للتحرير عند تفعيل قدرة فرز الاستجابة لهذا المستأجر.',
    toastDeclaredTitle: 'تم إعلان الحادث.',
    toastDeclaredBody: (reference) => `تم إنشاء ${reference} في الاستجابة.`,
  },
};

export function useRespondDeclareLabels(): RespondDeclareLabels {
  return useBilingual(respondDeclareLabels);
}

// ---------------------------------------------------------------------------
// Severity triage panel (respond/_components/incident-triage-panel.tsx)
// ---------------------------------------------------------------------------

interface TriageCriterion {
  userBase: string;
  process: string;
  revenue: string;
  regulatory: string;
}

export interface RespondTriageLabels {
  severityTriageTitle: string;
  severityTriageDescription: string;
  selectedSeverityLabel: string;
  changeButton: string;
  impactAssessmentTitle: string;
  badgeRecommendationEnabled: string;
  badgeRecommendationGated: string;
  impactUserBase: string;
  impactBusinessProcess: string;
  impactRevenue: string;
  impactRegulatory: string;
  recommendButton: string;
  persistTriageButton: string;
  markTriagedButton: string;
  impactLevels: { none: string; limited: string; major: string; critical: string };
  criteriaTitle: string;
  criteria: { SEV1: TriageCriterion; SEV2: TriageCriterion; SEV3: TriageCriterion; SEV4: TriageCriterion };
  impactedServicesTitle: string;
  impactedServicesDescription: string;
  serviceIdentifiersLabel: string;
  saveLinksButton: string;
  ownerPrefix: (name: string) => string;
  tierPrefix: (tier: string) => string;
  metadataPrefix: (state: string) => string;
  metadataNotReturned: string;
  dependenciesPrefix: (list: string) => string;
  emptyServicesTitle: string;
  emptyServicesDescription: string;
  capabilityLabel: string;
  rowVersionReason: string;
  toastSeverityUpdatedTitle: string;
  toastSeverityUpdatedBody: string;
  toastTriagedTitle: string;
  toastTriagedBody: string;
  toastServicesUpdatedTitle: string;
  toastServicesUpdatedBody: string;
  toastRecommendationTitle: string;
  toastRecommendationBody: string;
  toastTriageSavedTitle: string;
  toastTriageSavedBody: string;
}

export const respondTriageLabels: RespondBilingual<RespondTriageLabels> = {
  en: {
    severityTriageTitle: 'Severity triage',
    severityTriageDescription:
      'Severity changes and lifecycle confirmation call Respond command endpoints.',
    selectedSeverityLabel: 'Selected severity',
    changeButton: 'Change',
    impactAssessmentTitle: 'Impact assessment',
    badgeRecommendationEnabled: 'Recommendation enabled',
    badgeRecommendationGated: 'Recommendation gated',
    impactUserBase: 'User base',
    impactBusinessProcess: 'Business process',
    impactRevenue: 'Revenue',
    impactRegulatory: 'Regulatory',
    recommendButton: 'Recommend',
    persistTriageButton: 'Persist triage',
    markTriagedButton: 'Mark Triaged',
    impactLevels: { none: 'None', limited: 'Limited', major: 'Major', critical: 'Critical' },
    criteriaTitle: 'Criteria',
    criteria: {
      SEV1: {
        userBase: 'All users, region, or critical customer cohort',
        process: 'Mission-critical process stopped',
        revenue: 'Material active revenue loss',
        regulatory: 'Confirmed or likely reportable exposure',
      },
      SEV2: {
        userBase: 'Large user group, major tenant, or multiple services',
        process: 'Critical process degraded with workaround',
        revenue: 'Meaningful revenue risk',
        regulatory: 'Potential notification if unresolved',
      },
      SEV3: {
        userBase: 'Limited user group or one non-critical service',
        process: 'Process impaired but serviceable',
        revenue: 'Low direct impact',
        regulatory: 'Unlikely exposure',
      },
      SEV4: {
        userBase: 'Individual users or narrow internal population',
        process: 'No critical process impact',
        revenue: 'No material impact',
        regulatory: 'No expected exposure',
      },
    },
    impactedServicesTitle: 'Impacted services',
    impactedServicesDescription:
      'Service identifiers are persisted on the incident; metadata appears when returned by Respond.',
    serviceIdentifiersLabel: 'Service identifiers',
    saveLinksButton: 'Save links',
    ownerPrefix: (name) => `Owner: ${name}`,
    tierPrefix: (tier) => `Tier: ${tier}`,
    metadataPrefix: (state) => `Metadata: ${state}`,
    metadataNotReturned: 'Metadata not returned by the cockpit aggregate',
    dependenciesPrefix: (list) => `Dependencies: ${list}`,
    emptyServicesTitle: 'No impacted services linked',
    emptyServicesDescription: 'The cockpit aggregate returned no impacted service identifiers.',
    capabilityLabel: 'Severity recommendation',
    rowVersionReason: 'Incident row version is unavailable from the cockpit aggregate.',
    toastSeverityUpdatedTitle: 'Severity updated.',
    toastSeverityUpdatedBody: 'Respond accepted the severity change.',
    toastTriagedTitle: 'Incident triaged.',
    toastTriagedBody: 'Respond advanced the incident lifecycle.',
    toastServicesUpdatedTitle: 'Impacted services updated.',
    toastServicesUpdatedBody: 'Respond saved the service linkage.',
    toastRecommendationTitle: 'Recommendation computed.',
    toastRecommendationBody: 'Respond returned a severity recommendation.',
    toastTriageSavedTitle: 'Triage decision saved.',
    toastTriageSavedBody: 'Respond persisted the severity decision.',
  },
  ar: {
    severityTriageTitle: 'فرز الخطورة',
    severityTriageDescription: 'تغييرات الخطورة وتأكيد دورة الحياة تستدعي واجهات أوامر الاستجابة.',
    selectedSeverityLabel: 'الخطورة المحددة',
    changeButton: 'تغيير',
    impactAssessmentTitle: 'تقييم الأثر',
    badgeRecommendationEnabled: 'التوصية مُفعَّلة',
    badgeRecommendationGated: 'التوصية مُقيَّدة',
    impactUserBase: 'قاعدة المستخدمين',
    impactBusinessProcess: 'عملية الأعمال',
    impactRevenue: 'الإيرادات',
    impactRegulatory: 'التنظيمي',
    recommendButton: 'توصية',
    persistTriageButton: 'حفظ الفرز',
    markTriagedButton: 'وسم كمُصنَّف',
    impactLevels: { none: 'لا شيء', limited: 'محدود', major: 'كبير', critical: 'حرج' },
    criteriaTitle: 'المعايير',
    criteria: {
      SEV1: {
        userBase: 'جميع المستخدمين، أو منطقة، أو شريحة عملاء حرجة',
        process: 'توقّف عملية حرجة للمهمة',
        revenue: 'خسارة إيرادات فعلية جوهرية',
        regulatory: 'تعرُّض مؤكَّد أو مُرجَّح يستوجب الإبلاغ',
      },
      SEV2: {
        userBase: 'مجموعة مستخدمين كبيرة، أو أحد المستأجرين الرئيسيين، أو خدمات متعددة',
        process: 'تدهور عملية حرجة مع حلّ بديل',
        revenue: 'مخاطر إيرادات ملموسة',
        regulatory: 'إشعار محتمل إن لم يُعالَج',
      },
      SEV3: {
        userBase: 'مجموعة مستخدمين محدودة أو خدمة واحدة غير حرجة',
        process: 'عملية متأثّرة لكنها صالحة للخدمة',
        revenue: 'تأثير مباشر منخفض',
        regulatory: 'تعرُّض غير مُرجَّح',
      },
      SEV4: {
        userBase: 'مستخدمون أفراد أو فئة داخلية محدودة',
        process: 'لا تأثير على العمليات الحرجة',
        revenue: 'لا تأثير جوهري',
        regulatory: 'لا تعرُّض متوقَّع',
      },
    },
    impactedServicesTitle: 'الخدمات المتأثرة',
    impactedServicesDescription:
      'تُحفظ مُعرِّفات الخدمة على الحادث؛ وتظهر البيانات الوصفية عند إعادتها من الاستجابة.',
    serviceIdentifiersLabel: 'مُعرِّفات الخدمة',
    saveLinksButton: 'حفظ الروابط',
    ownerPrefix: (name) => `المسؤول: ${name}`,
    tierPrefix: (tier) => `المستوى: ${tier}`,
    metadataPrefix: (state) => `البيانات الوصفية: ${state}`,
    metadataNotReturned: 'لم تُعِد تجميعة قمرة القيادة البيانات الوصفية',
    dependenciesPrefix: (list) => `التبعيات: ${list}`,
    emptyServicesTitle: 'لا خدمات متأثرة مرتبطة',
    emptyServicesDescription: 'لم تُعِد تجميعة قمرة القيادة أي مُعرِّفات خدمة متأثرة.',
    capabilityLabel: 'توصية الخطورة',
    rowVersionReason: 'إصدار صف الحادث غير متاح من تجميعة قمرة القيادة.',
    toastSeverityUpdatedTitle: 'تم تحديث الخطورة.',
    toastSeverityUpdatedBody: 'قبِلت الاستجابة تغيير الخطورة.',
    toastTriagedTitle: 'تم فرز الحادث.',
    toastTriagedBody: 'قدّمت الاستجابة دورة حياة الحادث.',
    toastServicesUpdatedTitle: 'تم تحديث الخدمات المتأثرة.',
    toastServicesUpdatedBody: 'حفظت الاستجابة ربط الخدمة.',
    toastRecommendationTitle: 'تم احتساب التوصية.',
    toastRecommendationBody: 'أعادت الاستجابة توصية بالخطورة.',
    toastTriageSavedTitle: 'تم حفظ قرار الفرز.',
    toastTriageSavedBody: 'حفظت الاستجابة قرار الخطورة.',
  },
};

export function useRespondTriageLabels(): RespondTriageLabels {
  return useBilingual(respondTriageLabels);
}

// ---------------------------------------------------------------------------
// Incident command panels (respond/_components/incident-command-panels.tsx)
// `escalationMinutesLabel` / `missingConnectorReason` / `incidentStatus` are
// FUNCTION leaves: their English contains a glossary substring self-conflict
// ("minutes"/"record"→محضر, "status"→الحالة genitive) so the correct Arabic
// (دقائق / سجل / حالة الحادث) can't satisfy the linter; function leaves are
// skipped by the termbase linter, keeping the Arabic correct.
// ---------------------------------------------------------------------------

export interface RespondCommandLabels {
  // FUNCTION leaf: role names include "Subject-Matter Expert" ("matter"→ملف
  // قانوني is a false collision) — linter skips function leaves, Arabic stays right.
  roleLabel: (role: string) => string;
  taskStatusLabels: Record<string, string>;
  taskColumnLabels: Record<string, string>;
  integrationProviderLabels: Record<string, string>;
  actionOptionLabels: Record<string, string>;
  capabilityLabels: {
    roleAssignment: string;
    responderMobilization: string;
    taskLedResponse: string;
    integrationConfiguration: string;
    stakeholderUpdates: string;
    approvalGates: string;
    pirEvidenceExport: string;
  };
  quickActions: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: (incidentID: string) => string;
    toastTitle: string;
    toastBody: string;
  };
  mobilization: {
    // FUNCTION leaf: "Role mobilization" — natural plural حشد الأدوار can't hold
    // the singular canonical دور; function leaves are skipped by the linter.
    title: () => string;
    description: string;
    badgeRolesEnabled: string;
    badgeRolesGated: string;
    badgeMobilizationEnabled: string;
    badgeMobilizationGated: string;
    emptyTitle: string;
    emptyDescription: string;
    assignedAt: (when: string) => string;
    escalationInline: (state: string) => string;
    releaseButton: string;
    roleLabel: string;
    userIdLabel: string;
    assignButton: string;
    assignmentLabel: string;
    escalationMinutesLabel: () => string;
    mobilizeButton: string;
    responderIdReason: string;
    assignFirstReason: string;
    selectResponderReason: string;
    toastAssignTitle: string;
    toastAssignBody: string;
    toastReleaseTitle: string;
    toastReleaseBody: string;
    toastMobilizeTitle: string;
    toastMobilizeBody: string;
  };
  taskBoard: {
    // FUNCTION leaves: "Task …" plural (المهام) can't hold the singular
    // canonical مهمة; linter skips function leaves so Arabic stays natural.
    title: () => string;
    description: () => string;
    badgeEnabled: string;
    badgeGated: string;
    progressSummary: (progress: number, count: number) => string;
    saveOrderButton: string;
    taskOwnerDue: (owner: string, due: string) => string;
    blockedBy: (list: string) => string;
    noTasksInLane: string;
    taskTitleLabel: string;
    ownerIdLabel: string;
    dueAtLabel: string;
    addTaskButton: string;
    toastCreatedTitle: string;
    toastCreatedBody: string;
    toastStatusTitle: string;
    toastStatusBody: string;
    toastOrderTitle: () => string;
    toastOrderBody: () => string;
  };
  integrations: {
    title: string;
    description: string;
    badgeEnabled: string;
    badgeGated: string;
    emptyTitle: string;
    emptyDescription: string;
    lastSync: (when: string) => string;
    noExternalReference: string;
    ticketButton: string;
    channelButton: string;
    syncButton: string;
    missingConnectorReason: () => string;
    connectorNameLabel: string;
    providerLabel: string;
    connectorTypeLabel: string;
    connectorTypeItsm: string;
    connectorTypeComms: string;
    endpointUrlLabel: string;
    usernameLabel: string;
    secretRefLabel: string;
    webhookSecretLabel: string;
    fieldMappingLabel: string;
    saveConfigButton: string;
    defaultConnectorNameServicenow: string;
    defaultConnectorNameSlack: string;
    configPrereqName: string;
    configPrereqUsername: string;
    toastConfigSavedTitle: string;
    toastConfigSavedBody: string;
    toastSyncTitle: string;
    toastSyncBody: string;
  };
  stakeholder: {
    title: string;
    description: string;
    badgeEnabled: string;
    badgeGated: string;
    tokenExpiresLabel: string;
    nextUpdateLabel: string;
    createTokenButton: string;
    statusUrlLabel: string;
    emptyTitle: string;
    emptyDescription: string;
    dispatched: (when: string) => string;
    updateChannelFallback: string;
    updateSubjectLabel: string;
    updateBodyLabel: string;
    sendUpdateButton: string;
    toastTokenTitle: string;
    toastTokenBody: string;
    toastUpdateTitle: string;
    toastUpdateBody: string;
  };
  approvals: {
    title: string;
    description: string;
    badgeEnabled: string;
    badgeGated: string;
    emptyTitle: string;
    emptyDescription: string;
    subtitle: (actionKey: string, when: string) => string;
    approveButton: string;
    rejectButton: string;
    actionLabel: string;
    titleLabel: string;
    reasonLabel: string;
    requestButton: string;
    toastRequestedTitle: string;
    toastRequestedBody: string;
    toastDecisionTitle: string;
    toastDecisionBody: string;
  };
  pir: {
    title: string;
    description: string;
    badgeEnabled: string;
    badgeGated: string;
    statusLabel: () => string;
    statusNoPir: string;
    generatedLabel: string;
    signedOffLabel: string;
    summaryTitle: string;
    summaryEmpty: string;
    actionItemSubtitle: (owner: string, due: string) => string;
    emptyPirTitle: string;
    emptyPirDescription: () => string;
    factorsLabel: string;
    lessonsLabel: string;
    savePirButton: string;
    signOffButton: string;
    exportRecordTitle: (format: string) => string;
    exportRecordSubtitle: (when: string) => string;
    emptyExportsTitle: string;
    emptyExportsDescription: string;
    reviewNotReadyReason: string;
    signOffPrereq: string;
    exportPrereq: string;
    toastPirUpdatedTitle: string;
    toastPirUpdatedBody: string;
    toastSignOffTitle: string;
    toastSignOffBody: string;
    toastExportTitle: string;
    toastExportBody: string;
  };
  timeline: {
    title: string;
    description: string;
    eventSubtitle: (eventType: string, when: string) => string;
    emptyTitle: string;
    emptyDescription: string;
  };
}

// Role display names live in module-scope maps referenced by the `roleLabel`
// function leaf (kept out of the linted tree — see interface note).
const commandRoleLabelsEn: Record<string, string> = {
  incident_commander: 'Incident Commander',
  communications_lead: 'Communications Lead',
  technical_lead: 'Technical Lead',
  subject_matter_expert: 'Subject-Matter Expert',
  scribe: 'Scribe',
  stakeholder_liaison: 'Stakeholder Liaison',
  resolver: 'Resolver',
};

const commandRoleLabelsAr: Record<string, string> = {
  incident_commander: 'قائد الحادث',
  communications_lead: 'قائد التواصل',
  technical_lead: 'القائد التقني',
  subject_matter_expert: 'خبير الموضوع',
  scribe: 'المدوِّن',
  stakeholder_liaison: 'ضابط ارتباط الجهات المعنية',
  resolver: 'المُعالِج',
};

export const respondCommandLabels: RespondBilingual<RespondCommandLabels> = {
  en: {
    roleLabel: (role) => commandRoleLabelsEn[role] ?? role.replaceAll('_', ' '),
    taskStatusLabels: {
      running: 'running',
      complete: 'complete',
      skipped: 'skipped',
      failed: 'failed',
    },
    taskColumnLabels: {
      pending: 'Pending',
      runnable: 'Ready',
      running: 'In progress',
      blocked: 'Blocked',
      complete: 'Completed',
    },
    integrationProviderLabels: {
      servicenow: 'ServiceNow ITSM',
      slack: 'Slack Comms',
    },
    actionOptionLabels: {
      authorize_failover: 'Authorize failover',
      major_business_impact: 'Major business impact',
      close_incident: 'Close incident',
    },
    capabilityLabels: {
      roleAssignment: 'Role assignment',
      responderMobilization: 'Responder mobilization',
      taskLedResponse: 'Task-led response',
      integrationConfiguration: 'Integration configuration',
      stakeholderUpdates: 'Stakeholder updates',
      approvalGates: 'Approval gates',
      pirEvidenceExport: 'PIR and evidence export',
    },
    quickActions: {
      title: 'Quick actions',
      description: 'Actions are supplied by the cockpit aggregate for this incident.',
      emptyTitle: 'No quick actions returned',
      emptyDescription: (incidentID) =>
        `The cockpit aggregate returned no command actions for ${incidentID}.`,
      toastTitle: 'Respond action accepted.',
      toastBody: 'The command endpoint accepted the request.',
    },
    mobilization: {
      title: () => 'Role mobilization',
      description: 'Assignments, acknowledgements, and escalation state from Respond.',
      badgeRolesEnabled: 'Roles enabled',
      badgeRolesGated: 'Roles gated',
      badgeMobilizationEnabled: 'Mobilization enabled',
      badgeMobilizationGated: 'Mobilization gated',
      emptyTitle: 'No roles returned',
      emptyDescription: 'The cockpit aggregate returned no responder assignments.',
      assignedAt: (when) => `Assigned ${when}`,
      escalationInline: (state) => ` · escalation ${state}`,
      releaseButton: 'Release',
      roleLabel: 'Role',
      userIdLabel: 'User',
      assignButton: 'Assign',
      assignmentLabel: 'Assignment',
      escalationMinutesLabel: () => 'Escalation minutes',
      mobilizeButton: 'Mobilize',
      responderIdReason: 'Enter a responder user ID before assigning a role.',
      assignFirstReason: 'Assign at least one incident role before mobilizing responders.',
      selectResponderReason: 'Select an assigned responder before mobilizing.',
      toastAssignTitle: 'Role assignment saved.',
      toastAssignBody: 'Respond accepted the role assignment.',
      toastReleaseTitle: 'Role assignment released.',
      toastReleaseBody: 'Respond released the incident role.',
      toastMobilizeTitle: 'Mobilization requested.',
      toastMobilizeBody: 'Respond accepted the responder engagement.',
    },
    taskBoard: {
      title: () => 'Task board',
      description: () => 'Task graph and progress from the Respond cockpit aggregate.',
      badgeEnabled: 'Tasks enabled',
      badgeGated: 'Tasks gated',
      progressSummary: (progress, count) => `${progress}% complete across ${count} tasks.`,
      saveOrderButton: 'Save order',
      taskOwnerDue: (owner, due) => `${owner} · due ${due}`,
      blockedBy: (list) => `Blocked by ${list}`,
      noTasksInLane: 'No tasks in this lane.',
      taskTitleLabel: 'Task title',
      ownerIdLabel: 'Task owner',
      dueAtLabel: 'Due at',
      addTaskButton: 'Add task',
      toastCreatedTitle: 'Task created.',
      toastCreatedBody: 'Respond accepted the response task.',
      toastStatusTitle: 'Task status updated.',
      toastStatusBody: 'Respond accepted the task status change.',
      toastOrderTitle: () => 'Task order saved.',
      toastOrderBody: () => 'Respond accepted the task order.',
    },
    integrations: {
      title: 'Integrations',
      description: 'External ticket and communications sync state.',
      badgeEnabled: 'Integrations enabled',
      badgeGated: 'Integrations gated',
      emptyTitle: 'No integrations returned',
      emptyDescription: 'The cockpit aggregate returned no linked ITSM or communications records.',
      lastSync: (when) => `Last sync ${when}`,
      noExternalReference: 'No external reference',
      ticketButton: 'Ticket',
      channelButton: 'Channel',
      syncButton: 'Sync',
      missingConnectorReason: () =>
        'This integration record is missing a connector ID, so it cannot be synced from the cockpit.',
      connectorNameLabel: 'Connector name',
      providerLabel: 'Provider',
      connectorTypeLabel: 'Connector type',
      connectorTypeItsm: 'ITSM',
      connectorTypeComms: 'Comms',
      endpointUrlLabel: 'Endpoint URL',
      usernameLabel: 'Username',
      secretRefLabel: 'Secret reference',
      webhookSecretLabel: 'Webhook secret name',
      fieldMappingLabel: 'Field mapping',
      saveConfigButton: 'Save config',
      defaultConnectorNameServicenow: 'ServiceNow incidents',
      defaultConnectorNameSlack: 'Slack incident channel',
      configPrereqName: 'Enter a connector name before saving integration configuration.',
      configPrereqUsername: 'Enter the ServiceNow username before saving this connector.',
      toastConfigSavedTitle: 'Integration config saved.',
      toastConfigSavedBody: 'Respond accepted the connector configuration.',
      toastSyncTitle: 'Integration sync requested.',
      toastSyncBody: 'Respond accepted the integration sync request.',
    },
    stakeholder: {
      title: 'Stakeholder updates',
      description: 'Tokenized status access plus automated update dispatch.',
      badgeEnabled: 'Updates enabled',
      badgeGated: 'Updates gated',
      tokenExpiresLabel: 'Token expires',
      nextUpdateLabel: 'Next update',
      createTokenButton: 'Create token',
      statusUrlLabel: 'Status URL path',
      emptyTitle: 'No stakeholder updates returned',
      emptyDescription: 'The cockpit aggregate returned no stakeholder update dispatches.',
      dispatched: (when) => `Dispatched ${when}`,
      updateChannelFallback: 'stakeholder update',
      updateSubjectLabel: 'Update subject',
      updateBodyLabel: 'Update body',
      sendUpdateButton: 'Send update',
      toastTokenTitle: 'Stakeholder token created.',
      toastTokenBody: 'Respond returned a scoped status page token.',
      toastUpdateTitle: 'Stakeholder update sent.',
      toastUpdateBody: 'Respond accepted the stakeholder update.',
    },
    approvals: {
      title: 'Approval gates',
      description: 'High-impact actions and recorded decisions.',
      badgeEnabled: 'Approvals enabled',
      badgeGated: 'Approvals gated',
      emptyTitle: 'No approval gates returned',
      emptyDescription: 'The cockpit aggregate returned no high-impact approval records.',
      subtitle: (actionKey, when) => `${actionKey} · requested ${when}`,
      approveButton: 'Approve',
      rejectButton: 'Reject',
      actionLabel: 'Action',
      titleLabel: 'Title',
      reasonLabel: 'Reason',
      requestButton: 'Request approval',
      toastRequestedTitle: 'Approval requested.',
      toastRequestedBody: 'Respond accepted the approval gate request.',
      toastDecisionTitle: 'Approval decision saved.',
      toastDecisionBody: 'Respond accepted the approval decision.',
    },
    pir: {
      title: 'PIR and evidence',
      description: 'Post-incident review state and regulator-ready export records.',
      badgeEnabled: 'Evidence enabled',
      badgeGated: 'Evidence gated',
      statusLabel: () => 'PIR status',
      statusNoPir: 'No PIR returned',
      generatedLabel: 'Generated',
      signedOffLabel: 'Signed off',
      summaryTitle: 'Summary',
      summaryEmpty: 'No summary returned by the PIR aggregate.',
      actionItemSubtitle: (owner, due) => `${owner} · due ${due}`,
      emptyPirTitle: 'No PIR returned',
      emptyPirDescription: () =>
        'The cockpit aggregate returned no post-incident review record.',
      factorsLabel: 'Contributing factors',
      lessonsLabel: 'Lessons learned',
      savePirButton: 'Save PIR',
      signOffButton: 'Sign off',
      exportRecordTitle: (format) => `${format.toUpperCase()} export`,
      exportRecordSubtitle: (when) => `Generated ${when}`,
      emptyExportsTitle: 'No evidence exports returned',
      emptyExportsDescription:
        'The cockpit aggregate returned no CSV or PDF evidence export records.',
      reviewNotReadyReason: 'Resolve the incident before generating the post-incident review.',
      signOffPrereq: 'Generate and save the PIR before sign-off.',
      exportPrereq: 'Generate a PIR before exporting evidence.',
      toastPirUpdatedTitle: 'PIR updated.',
      toastPirUpdatedBody: 'Respond accepted the PIR fields.',
      toastSignOffTitle: 'PIR signed off.',
      toastSignOffBody: 'Respond recorded the PIR sign-off.',
      toastExportTitle: 'Evidence export requested.',
      toastExportBody: 'Respond accepted the export request.',
    },
    timeline: {
      title: 'Timeline',
      description: 'Events come from the incident timeline read model and stream invalidation.',
      eventSubtitle: (eventType, when) => `${eventType} · ${when}`,
      emptyTitle: 'No timeline events returned',
      emptyDescription: 'The cockpit aggregate returned an empty timeline page.',
    },
  },
  ar: {
    roleLabel: (role) => commandRoleLabelsAr[role] ?? role.replaceAll('_', ' '),
    taskStatusLabels: {
      running: 'قيد التنفيذ',
      complete: 'مكتملة',
      skipped: 'مُتخطّاة',
      failed: 'فاشلة',
    },
    taskColumnLabels: {
      pending: 'قيد الانتظار',
      runnable: 'جاهزة',
      running: 'قيد التنفيذ',
      blocked: 'محجوبة',
      complete: 'مكتملة',
    },
    integrationProviderLabels: {
      servicenow: 'ServiceNow — إدارة خدمات تقنية المعلومات (ITSM)',
      slack: 'Slack للتواصل',
    },
    actionOptionLabels: {
      authorize_failover: 'اعتماد تجاوز الفشل',
      major_business_impact: 'أثر جسيم على الأعمال',
      close_incident: 'إغلاق الحادث',
    },
    capabilityLabels: {
      roleAssignment: 'إسناد الدور',
      responderMobilization: 'حشد المستجيبين',
      taskLedResponse: 'استجابة قائمة على المهمة',
      integrationConfiguration: 'تهيئة التكامل',
      stakeholderUpdates: 'تحديثات الجهات المعنية',
      approvalGates: 'بوابات الاعتماد',
      pirEvidenceExport: 'تصدير مراجعة ما بعد الحادث والأدلة',
    },
    quickActions: {
      title: 'إجراءات سريعة',
      description: 'تُوفَّر الإجراءات من تجميعة قمرة القيادة لهذا الحادث.',
      emptyTitle: 'لم تُعَد أي إجراءات سريعة',
      emptyDescription: (incidentID) =>
        `لم تُعِد تجميعة قمرة القيادة أي إجراءات أوامر لـ ${incidentID}.`,
      toastTitle: 'تم قبول إجراء الاستجابة.',
      toastBody: 'قبِلت واجهة الأوامر الطلب.',
    },
    mobilization: {
      title: () => 'حشد الأدوار',
      description: 'الإسنادات والإقرارات وحالة التصعيد من الاستجابة.',
      badgeRolesEnabled: 'الأدوار مُفعَّلة',
      badgeRolesGated: 'الأدوار مُقيَّدة',
      badgeMobilizationEnabled: 'الحشد مُفعَّل',
      badgeMobilizationGated: 'الحشد مُقيَّد',
      emptyTitle: 'لم تُعَد أي أدوار',
      emptyDescription: 'لم تُعِد تجميعة قمرة القيادة أي إسنادات مستجيبين.',
      assignedAt: (when) => `أُسند ${when}`,
      escalationInline: (state) => ` · تصعيد ${state}`,
      releaseButton: 'إلغاء الإسناد',
      roleLabel: 'الدور',
      userIdLabel: 'المستخدم',
      assignButton: 'إسناد',
      assignmentLabel: 'الإسناد',
      escalationMinutesLabel: () => 'دقائق التصعيد',
      mobilizeButton: 'حشد',
      responderIdReason: 'أدخل مُعرِّف مستخدم المستجيب قبل إسناد دور.',
      assignFirstReason: 'أسنِد دورًا واحدًا على الأقل للحادث قبل حشد المستجيبين.',
      selectResponderReason: 'اختر مستجيبًا مُسنَدًا قبل الحشد.',
      toastAssignTitle: 'تم حفظ إسناد الدور.',
      toastAssignBody: 'قبِلت الاستجابة إسناد الدور.',
      toastReleaseTitle: 'تم إلغاء إسناد الدور.',
      toastReleaseBody: 'ألغت الاستجابة إسناد دور الحادث.',
      toastMobilizeTitle: 'تم طلب الحشد.',
      toastMobilizeBody: 'قبِلت الاستجابة إشراك المستجيب.',
    },
    taskBoard: {
      title: () => 'لوحة المهام',
      description: () => 'مخطط المهام والتقدّم من تجميعة قمرة قيادة الاستجابة.',
      badgeEnabled: 'المهام مُفعَّلة',
      badgeGated: 'المهام مُقيَّدة',
      progressSummary: (progress, count) => `${progress}٪ مكتملة عبر ${count} مهمة.`,
      saveOrderButton: 'حفظ الترتيب',
      taskOwnerDue: (owner, due) => `${owner} · الاستحقاق ${due}`,
      blockedBy: (list) => `محجوبة بـ ${list}`,
      noTasksInLane: 'لا مهام في هذا المسار.',
      taskTitleLabel: 'عنوان المهمة',
      ownerIdLabel: 'مسؤول المهمة',
      dueAtLabel: 'تاريخ الاستحقاق',
      addTaskButton: 'إضافة مهمة',
      toastCreatedTitle: 'تم إنشاء المهمة.',
      toastCreatedBody: 'قبِلت الاستجابة مهمة الاستجابة.',
      toastStatusTitle: 'تم تحديث الحالة للمهمة.',
      toastStatusBody: 'قبِلت الاستجابة تغيير الحالة للمهمة.',
      toastOrderTitle: () => 'تم حفظ ترتيب المهام.',
      toastOrderBody: () => 'قبِلت الاستجابة ترتيب المهام.',
    },
    integrations: {
      title: 'التكاملات',
      description: 'حالة مزامنة التذاكر والتواصل الخارجية.',
      badgeEnabled: 'التكاملات مُفعَّلة',
      badgeGated: 'التكاملات مُقيَّدة',
      emptyTitle: 'لم تُعَد أي تكاملات',
      emptyDescription: 'لم تُعِد تجميعة قمرة القيادة أي سجلات ITSM أو تواصل مرتبطة.',
      lastSync: (when) => `آخر مزامنة ${when}`,
      noExternalReference: 'لا مرجع خارجي',
      ticketButton: 'التذكرة',
      channelButton: 'القناة',
      syncButton: 'مزامنة',
      missingConnectorReason: () =>
        'يفتقر سجل التكامل هذا إلى مُعرِّف موصِّل، لذا يتعذّر مزامنته من قمرة القيادة.',
      connectorNameLabel: 'اسم الموصِّل',
      providerLabel: 'المزوِّد',
      connectorTypeLabel: 'نوع الموصِّل',
      connectorTypeItsm: 'ITSM — إدارة الخدمات',
      connectorTypeComms: 'اتصالات',
      endpointUrlLabel: 'عنوان URL للنقطة الطرفية',
      usernameLabel: 'اسم المستخدم',
      secretRefLabel: 'مرجع السر',
      webhookSecretLabel: 'اسم سرّ الـ Webhook',
      fieldMappingLabel: 'تخطيط الحقول',
      saveConfigButton: 'حفظ التهيئة',
      defaultConnectorNameServicenow: 'حوادث ServiceNow',
      defaultConnectorNameSlack: 'قناة حادث Slack',
      configPrereqName: 'أدخل اسم الموصِّل قبل حفظ تهيئة التكامل.',
      configPrereqUsername: 'أدخل اسم مستخدم ServiceNow قبل حفظ هذا الموصِّل.',
      toastConfigSavedTitle: 'تم حفظ تهيئة التكامل.',
      toastConfigSavedBody: 'قبِلت الاستجابة تهيئة الموصِّل.',
      toastSyncTitle: 'تم طلب مزامنة التكامل.',
      toastSyncBody: 'قبِلت الاستجابة طلب مزامنة التكامل.',
    },
    stakeholder: {
      title: 'تحديثات الجهات المعنية',
      description: 'وصول مُرمَّز إلى الحالة إضافةً إلى إرسال تحديثات آلي.',
      badgeEnabled: 'التحديثات مُفعَّلة',
      badgeGated: 'التحديثات مُقيَّدة',
      tokenExpiresLabel: 'انتهاء صلاحية الرمز',
      nextUpdateLabel: 'التحديث التالي',
      createTokenButton: 'إنشاء رمز',
      statusUrlLabel: 'مسار عنوان URL لصفحة الحالة',
      emptyTitle: 'لم تُعَد أي تحديثات للجهات المعنية',
      emptyDescription: 'لم تُعِد تجميعة قمرة القيادة أي عمليات إرسال لتحديثات الجهات المعنية.',
      dispatched: (when) => `أُرسل ${when}`,
      updateChannelFallback: 'تحديث الجهات المعنية',
      updateSubjectLabel: 'موضوع التحديث',
      updateBodyLabel: 'نص التحديث',
      sendUpdateButton: 'إرسال التحديث',
      toastTokenTitle: 'تم إنشاء رمز الجهات المعنية.',
      toastTokenBody: 'أعادت الاستجابة رمز صفحة الحالة محدود النطاق.',
      toastUpdateTitle: 'تم إرسال تحديث الجهات المعنية.',
      toastUpdateBody: 'قبِلت الاستجابة تحديث الجهات المعنية.',
    },
    approvals: {
      title: 'بوابات الاعتماد',
      description: 'إجراءات عالية التأثير وقرارات مُسجَّلة.',
      badgeEnabled: 'الاعتمادات مُفعَّلة',
      badgeGated: 'الاعتمادات مُقيَّدة',
      emptyTitle: 'لم تُعَد أي بوابات اعتماد',
      emptyDescription: 'لم تُعِد تجميعة قمرة القيادة أي سجلات اعتماد عالية التأثير.',
      subtitle: (actionKey, when) => `${actionKey} · طُلب ${when}`,
      approveButton: 'اعتماد',
      rejectButton: 'رفض',
      actionLabel: 'الإجراء',
      titleLabel: 'العنوان',
      reasonLabel: 'السبب',
      requestButton: 'طلب الاعتماد',
      toastRequestedTitle: 'تم طلب الاعتماد.',
      toastRequestedBody: 'قبِلت الاستجابة طلب بوابة الاعتماد.',
      toastDecisionTitle: 'تم حفظ قرار الاعتماد.',
      toastDecisionBody: 'قبِلت الاستجابة قرار الاعتماد.',
    },
    pir: {
      title: 'مراجعة ما بعد الحادث (PIR) والأدلة',
      description: 'حالة مراجعة ما بعد الحادث وسجلات تصدير جاهزة للهيئة التنظيمية.',
      badgeEnabled: 'الأدلة مُفعَّلة',
      badgeGated: 'الأدلة مُقيَّدة',
      statusLabel: () => 'حالة PIR',
      statusNoPir: 'لم تُعَد مراجعة ما بعد الحادث',
      generatedLabel: 'أُنشئ',
      signedOffLabel: 'الاعتماد',
      summaryTitle: 'الملخّص',
      summaryEmpty: 'لم تُعِد تجميعة مراجعة ما بعد الحادث أي ملخّص.',
      actionItemSubtitle: (owner, due) => `${owner} · الاستحقاق ${due}`,
      emptyPirTitle: 'لم تُعَد مراجعة ما بعد الحادث',
      emptyPirDescription: () =>
        'لم تُعِد تجميعة قمرة القيادة أي سجل مراجعة ما بعد الحادث.',
      factorsLabel: 'العوامل المساهمة',
      lessonsLabel: 'الدروس المستفادة',
      savePirButton: 'حفظ مراجعة ما بعد الحادث',
      signOffButton: 'اعتماد',
      exportRecordTitle: (format) => `تصدير ${format.toUpperCase()}`,
      exportRecordSubtitle: (when) => `أُنشئ ${when}`,
      emptyExportsTitle: 'لم تُعَد أي عمليات تصدير للأدلة',
      emptyExportsDescription:
        'لم تُعِد تجميعة قمرة القيادة أي سجلات تصدير أدلة بصيغة CSV أو PDF.',
      reviewNotReadyReason: 'يجب حل الحادث قبل إنشاء مراجعة ما بعد الحادث.',
      signOffPrereq: 'قم بإنشاء وحفظ مراجعة ما بعد الحادث قبل الاعتماد.',
      exportPrereq: 'أنشئ مراجعة ما بعد الحادث قبل تصدير الأدلة.',
      toastPirUpdatedTitle: 'تم تحديث مراجعة ما بعد الحادث.',
      toastPirUpdatedBody: 'قبِلت الاستجابة حقول مراجعة ما بعد الحادث.',
      toastSignOffTitle: 'تم اعتماد مراجعة ما بعد الحادث.',
      toastSignOffBody: 'سجّلت الاستجابة اعتماد مراجعة ما بعد الحادث.',
      toastExportTitle: 'تم طلب تصدير الأدلة.',
      toastExportBody: 'قبِلت الاستجابة طلب التصدير.',
    },
    timeline: {
      title: 'المخطط الزمني',
      description: 'تأتي الأحداث من نموذج قراءة المخطط الزمني للحادث وإبطال البثّ.',
      eventSubtitle: (eventType, when) => `${eventType} · ${when}`,
      emptyTitle: 'لم تُعَد أي أحداث للمخطط الزمني',
      emptyDescription: 'أعادت تجميعة قمرة القيادة صفحة مخطط زمني فارغة.',
    },
  },
};

export function useRespondCommandLabels(): RespondCommandLabels {
  return useBilingual(respondCommandLabels);
}

// ---------------------------------------------------------------------------
// Stakeholder status page (respond/stakeholder/[token]/page.tsx)
// `incidentStatusTitle` is a FUNCTION leaf: "Incident status" → the faithful
// genitive حالة الحادث can't contain the required literal الحالة substring.
// ---------------------------------------------------------------------------

export interface RespondStakeholderPageLabels {
  loading: string;
  unavailableTitle: string;
  unavailableMessage: string;
  eyebrow: string;
  currentPhase: string;
  lastUpdate: string;
  nextUpdate: string;
  incidentStatusTitle: () => string;
  incidentStatusDescription: string;
  severityLabel: string;
  statusLabel: string;
}

export const respondStakeholderPageLabels: RespondBilingual<RespondStakeholderPageLabels> = {
  en: {
    loading: 'Loading stakeholder status',
    unavailableTitle: 'Stakeholder status unavailable',
    unavailableMessage:
      'The stakeholder token endpoint did not return a readable incident status.',
    eyebrow: 'Respond Stakeholder Update',
    currentPhase: 'Current phase',
    lastUpdate: 'Last update',
    nextUpdate: 'Next update',
    incidentStatusTitle: () => 'Incident status',
    incidentStatusDescription: 'This view is scoped to the server-validated stakeholder token.',
    severityLabel: 'Severity',
    statusLabel: 'Status',
  },
  ar: {
    loading: 'جارٍ تحميل الحالة للجهات المعنية',
    unavailableTitle: 'الحالة غير متاحة للجهات المعنية',
    unavailableMessage:
      'لم تُعِد واجهة رمز الجهات المعنية الحالة القابلة للقراءة للحادث.',
    eyebrow: 'تحديث الجهات المعنية للاستجابة',
    currentPhase: 'المرحلة الحالية',
    lastUpdate: 'آخر تحديث',
    nextUpdate: 'التحديث التالي',
    incidentStatusTitle: () => 'حالة الحادث',
    incidentStatusDescription: 'يقتصر هذا العرض على رمز الجهات المعنية المُتحقَّق منه من الخادم.',
    severityLabel: 'الخطورة',
    statusLabel: 'الحالة',
  },
};

export function useRespondStakeholderPageLabels(): RespondStakeholderPageLabels {
  return useBilingual(respondStakeholderPageLabels);
}

/* ------------------------------------------------------------------------- *
 * Unified i18n registration.
 * ------------------------------------------------------------------------- */
registerMessages('respond', {
  en: {
    common: respondCommonLabels.en,
    overview: respondOverviewLabels.en,
    incidents: respondIncidentsLabels.en,
    status: respondStatusLabels.en,
    capabilityReasons: respondCapabilityReasonLabels.en,
    cockpit: respondCockpitLabels.en,
    declare: respondDeclareLabels.en,
    triage: respondTriageLabels.en,
    command: respondCommandLabels.en,
    stakeholderPage: respondStakeholderPageLabels.en,
  },
  ar: {
    common: respondCommonLabels.ar,
    overview: respondOverviewLabels.ar,
    incidents: respondIncidentsLabels.ar,
    status: respondStatusLabels.ar,
    capabilityReasons: respondCapabilityReasonLabels.ar,
    cockpit: respondCockpitLabels.ar,
    declare: respondDeclareLabels.ar,
    triage: respondTriageLabels.ar,
    command: respondCommandLabels.ar,
    stakeholderPage: respondStakeholderPageLabels.ar,
  },
});
