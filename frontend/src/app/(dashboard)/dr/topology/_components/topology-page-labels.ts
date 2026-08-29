/**
 * Feature-local bilingual label bundle for the recovery-topology + isolated-boot
 * AUTHORING route (`/dr/topology`).
 * =============================================================================
 *
 * The shared foundation bundle `_components/topology/topology-labels.ts`
 * (`useTopologyLabels`) already owns the NodeMap copy, the add-edge form copy,
 * and the failover-ranking copy. This route owns the chrome the foundation
 * bundle does NOT cover — the page header, the protection-group picker, the
 * REAL backend role/mode/health option labels for the authoring selects (keyed
 * by the actual `internal/dr/topology` tokens `source`/`relay`/`target` and
 * `sync`/`async`, which differ from the foundation bundle's display-only
 * `primary`/`standby`/`recovery` map), and the entire isolated-boot authoring
 * surface (boot-plan view, define-boot-services form, and the live boot-run
 * view) keyed by the real `internal/dr/bootgraph` tokens.
 *
 * Adopts the foundation bilingual contract (`_lib/dr-i18n.ts`): a
 * `DRBilingual<TopologyPageLabels> = { en, ar }` bundle of two FULL, identically
 * shaped copies — English in `en`, professional Modern Standard Arabic in `ar`.
 * Function-valued fields (announcements, interpolated summaries) and nested
 * records appear on BOTH sides with the same signatures. Interpolation params
 * and Western digits (ports / counts / IDs) are preserved across both locales;
 * acronyms (RTO/RPO/HTTP/TCP/DAG) are kept and glossed in Arabic. RTL is handled
 * by logical Tailwind props in the components; this file is copy only.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface TopologyPageLabels {
  /** Page header. */
  pageTitle: string;
  pageDescription: string;
  loadingDescription: string;
  errorDescription: string;
  loadError: string;
  retry: string;

  /** Protection-group picker. */
  groupPickerLabel: string;
  groupPickerPlaceholder: string;
  noGroups: string;
  noGroupsHint: string;
  noGroupSelected: string;
  noGroupSelectedHint: string;

  /** Backend role tokens (source/relay/target) — authoring selects. */
  roleOptions: Record<string, string>;
  /** Backend edge-mode tokens (sync/async) — authoring selects. */
  modeOptions: Record<string, string>;
  /** Backend edge-health tokens — failover-candidate + edge display. */
  healthOptions: Record<string, string>;

  /** Isolated-boot authoring section. */
  bootSectionTitle: string;
  bootSectionDescription: string;
  bootPlanTierLabel: (tier: number) => string;
  bootPlanServiceCount: (count: number) => string;
  bootPlanColumnService: string;
  bootPlanColumnKind: string;
  bootPlanColumnProbe: string;
  bootPlanColumnTimeout: string;
  bootPlanEmptyTitle: string;
  bootPlanEmptyDescription: string;
  bootPlanLoadError: string;
  bootTierCountLabel: (count: number) => string;

  /** Define-boot-services dialog + form. */
  defineServicesTrigger: string;
  defineServicesTitle: string;
  defineServicesDescription: string;
  serviceNameLabel: string;
  serviceNamePlaceholder: string;
  serviceKindLabel: string;
  serviceKindPlaceholder: string;
  probeKindLabel: string;
  probeKindOptions: Record<string, string>;
  probeTargetLabel: string;
  probeTargetPlaceholder: string;
  probeExpectStatusLabel: string;
  probeExpectStatusHint: string;
  bootTimeoutLabel: string;
  bootTimeoutHint: string;
  healthRetriesLabel: string;
  healthRetriesHint: string;
  dependsOnLabel: string;
  dependsOnHint: string;
  dependsOnPlaceholder: string;
  addServiceRow: string;
  removeServiceRow: string;
  serviceRowHeading: (index: number) => string;
  defineServicesSubmit: string;
  atLeastOneServiceError: string;
  serviceNameError: string;
  probeTargetError: string;

  /** Start / track a boot run. */
  startBootRunTrigger: string;
  bootPolicyLabel: string;
  bootPolicyOptions: Record<string, string>;
  bootPolicyHint: string;
  startBootRunSubmit: string;
  startBootRunTitle: string;
  startBootRunDescription: string;
  bootRunTitle: string;
  bootRunDescription: string;
  bootRunStatusLabel: string;
  bootRunPolicyLabel: string;
  bootRunTiersLabel: string;
  bootRunTiersValue: (booted: number, total: number) => string;
  bootRunStartedLabel: string;
  bootRunColumnService: string;
  bootRunColumnTier: string;
  bootRunColumnStatus: string;
  bootRunColumnAttempts: string;
  bootRunColumnError: string;
  bootRunNoError: string;
  bootRunEmptyTitle: string;
  bootRunEmptyDescription: string;
  /** Backend boot run-status tokens. */
  bootRunStatusOptions: Record<string, string>;
  /** Backend per-service boot-status tokens. */
  bootServiceStatusOptions: Record<string, string>;

  /** Shared form actions. */
  cancel: string;

  /** Live-region announcements. */
  bootServicesDefinedAnnouncement: (count: number) => string;
  bootRunStartedAnnouncement: (id: string) => string;
}

export const topologyPageLabelBundle: DRBilingual<TopologyPageLabels> = {
  en: {
    pageTitle: 'Recovery topology & boot',
    pageDescription:
      'Author the directed replication topology that drives failover ranking, then define the tiered boot plan and start an isolated boot run for the selected protection group.',
    loadingDescription: 'Loading recovery topology…',
    errorDescription: 'The topology and boot feeds could not be loaded.',
    loadError: 'Could not load the recovery topology. Retry to reload.',
    retry: 'Retry',

    groupPickerLabel: 'Protection group',
    groupPickerPlaceholder: 'Select a protection group',
    noGroups: 'No protection groups',
    noGroupsHint:
      'Create a protection group from the Protect surface before authoring its recovery topology.',
    noGroupSelected: 'Select a protection group',
    noGroupSelectedHint:
      'Choose a protection group above to view and author its recovery topology and boot plan.',

    roleOptions: {
      source: 'Source',
      relay: 'Relay',
      target: 'Target',
    },
    modeOptions: {
      sync: 'Synchronous',
      async: 'Asynchronous',
    },
    healthOptions: {
      healthy: 'Healthy',
      degraded: 'Degraded',
      unhealthy: 'Unhealthy',
      unknown: 'Unknown',
    },

    bootSectionTitle: 'Isolated boot plan',
    bootSectionDescription:
      'The tiered boot order for the recovery site — each tier boots only after the previous tier is healthy.',
    bootPlanTierLabel: (tier) => `Tier ${tier}`,
    bootPlanServiceCount: (count) =>
      count === 1 ? '1 service' : `${count} services`,
    bootPlanColumnService: 'Service',
    bootPlanColumnKind: 'Type',
    bootPlanColumnProbe: 'Health probe',
    bootPlanColumnTimeout: 'Boot timeout',
    bootPlanEmptyTitle: 'No boot plan yet',
    bootPlanEmptyDescription:
      'Define the boot services and their dependencies to build the tiered boot order.',
    bootPlanLoadError: 'Could not load the boot plan. Retry to reload.',
    bootTierCountLabel: (count) =>
      count === 1 ? '1 tier' : `${count} tiers`,

    defineServicesTrigger: 'Define boot services',
    defineServicesTitle: 'Define boot services',
    defineServicesDescription:
      'Declare each recoverable service, its health probe, and the services it depends on. Dependencies determine the boot tier order.',
    serviceNameLabel: 'Service name',
    serviceNamePlaceholder: 'e.g. postgres-primary',
    serviceKindLabel: 'Type',
    serviceKindPlaceholder: 'e.g. database',
    probeKindLabel: 'Health probe',
    probeKindOptions: {
      http: 'HTTP(S) GET',
      tcp: 'TCP connect',
      script: 'Script exit code',
    },
    probeTargetLabel: 'Probe target',
    probeTargetPlaceholder: 'e.g. http://api.recovery:8080/healthz',
    probeExpectStatusLabel: 'Expected HTTP status',
    probeExpectStatusHint: 'Only used for the HTTP probe. Defaults to 200.',
    bootTimeoutLabel: 'Boot timeout (seconds)',
    bootTimeoutHint: 'How long the tier waits for this service to go healthy.',
    healthRetriesLabel: 'Health retries',
    healthRetriesHint: 'Probe attempts before the service is marked unhealthy.',
    dependsOnLabel: 'Depends on',
    dependsOnHint: 'Comma-separated names of services that must be healthy first.',
    dependsOnPlaceholder: 'e.g. postgres-primary, cache',
    addServiceRow: 'Add service',
    removeServiceRow: 'Remove service',
    serviceRowHeading: (index) => `Service ${index}`,
    defineServicesSubmit: 'Save boot services',
    atLeastOneServiceError: 'Add at least one boot service.',
    serviceNameError: 'Enter a service name.',
    probeTargetError: 'Enter a probe target.',

    startBootRunTrigger: 'Start boot run',
    bootPolicyLabel: 'Failure policy',
    bootPolicyOptions: {
      halt: 'Halt on tier failure',
      rollback: 'Roll back booted tiers',
    },
    bootPolicyHint:
      'What the run does when a tier never goes healthy within its budget.',
    startBootRunSubmit: 'Start isolated boot',
    startBootRunTitle: 'Start an isolated boot run',
    startBootRunDescription:
      'Boot the recovery site tier by tier in an isolated network. Choose how the run reacts to a tier that fails to go healthy.',
    bootRunTitle: 'Isolated boot run',
    bootRunDescription:
      'Live tier-by-tier boot progress and per-service health for the running boot.',
    bootRunStatusLabel: 'Run status',
    bootRunPolicyLabel: 'Policy',
    bootRunTiersLabel: 'Tiers booted',
    bootRunTiersValue: (booted, total) => `${booted} of ${total}`,
    bootRunStartedLabel: 'Started',
    bootRunColumnService: 'Service',
    bootRunColumnTier: 'Tier',
    bootRunColumnStatus: 'Status',
    bootRunColumnAttempts: 'Attempts',
    bootRunColumnError: 'Last error',
    bootRunNoError: 'None',
    bootRunEmptyTitle: 'No boot run in flight',
    bootRunEmptyDescription:
      'Start an isolated boot run to track tier-by-tier boot progress here.',
    bootRunStatusOptions: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      rolled_back: 'Rolled back',
    },
    bootServiceStatusOptions: {
      pending: 'Pending',
      booting: 'Booting',
      healthy: 'Healthy',
      unhealthy: 'Unhealthy',
      rolled_back: 'Rolled back',
    },

    cancel: 'Cancel',

    bootServicesDefinedAnnouncement: (count) =>
      count === 1
        ? 'Boot plan updated with 1 service.'
        : `Boot plan updated with ${count} services.`,
    bootRunStartedAnnouncement: (id) => `Isolated boot run ${id} started.`,
  },
  ar: {
    pageTitle: 'طوبولوجيا الاسترداد والإقلاع',
    pageDescription:
      'حرِّر طوبولوجيا النسخ المتماثل الموجّهة التي تقود ترتيب تجاوز الفشل، ثم عرِّف خطة الإقلاع المتدرّجة وابدأ تشغيل إقلاع معزول لمجموعة الحماية المختارة.',
    loadingDescription: 'جارٍ تحميل طوبولوجيا الاسترداد…',
    errorDescription: 'تعذّر تحميل موجزات الطوبولوجيا والإقلاع.',
    loadError: 'تعذّر تحميل طوبولوجيا الاسترداد. أعد المحاولة لإعادة التحميل.',
    retry: 'إعادة المحاولة',

    groupPickerLabel: 'مجموعة الحماية',
    groupPickerPlaceholder: 'اختر مجموعة حماية',
    noGroups: 'لا توجد مجموعات حماية',
    noGroupsHint:
      'أنشئ مجموعة حماية من شاشة الحماية قبل تحرير طوبولوجيا الاسترداد الخاصة بها.',
    noGroupSelected: 'اختر مجموعة حماية',
    noGroupSelectedHint:
      'اختر مجموعة حماية من الأعلى لعرض وتحرير طوبولوجيا الاسترداد وخطة الإقلاع الخاصة بها.',

    roleOptions: {
      source: 'مصدر',
      relay: 'مُرحِّل',
      target: 'هدف',
    },
    modeOptions: {
      sync: 'متزامن',
      async: 'غير متزامن',
    },
    healthOptions: {
      healthy: 'سليم',
      degraded: 'متدهور',
      unhealthy: 'غير سليم',
      unknown: 'غير معروف',
    },

    bootSectionTitle: 'خطة الإقلاع المعزول',
    bootSectionDescription:
      'ترتيب إقلاع موقع الاسترداد المتدرّج — لا تُقلِع كل طبقة إلا بعد أن تصبح الطبقة السابقة سليمة.',
    bootPlanTierLabel: (tier) => `الطبقة ${tier}`,
    bootPlanServiceCount: (count) =>
      count === 1 ? 'خدمة واحدة' : `${count} خدمات`,
    bootPlanColumnService: 'الخدمة',
    bootPlanColumnKind: 'النوع',
    bootPlanColumnProbe: 'فحص السلامة',
    bootPlanColumnTimeout: 'مهلة الإقلاع',
    bootPlanEmptyTitle: 'لا توجد خطة إقلاع بعد',
    bootPlanEmptyDescription:
      'عرِّف خدمات الإقلاع وتبعياتها لبناء ترتيب الإقلاع المتدرّج.',
    bootPlanLoadError: 'تعذّر تحميل خطة الإقلاع. أعد المحاولة لإعادة التحميل.',
    bootTierCountLabel: (count) =>
      count === 1 ? 'طبقة واحدة' : `${count} طبقات`,

    defineServicesTrigger: 'تعريف خدمات الإقلاع',
    defineServicesTitle: 'تعريف خدمات الإقلاع',
    defineServicesDescription:
      'صرِّح بكل خدمة قابلة للاسترداد وفحص سلامتها والخدمات التي تعتمد عليها. تُحدِّد التبعيات ترتيب طبقات الإقلاع.',
    serviceNameLabel: 'اسم الخدمة',
    serviceNamePlaceholder: 'مثال: postgres-primary',
    serviceKindLabel: 'النوع',
    serviceKindPlaceholder: 'مثال: قاعدة بيانات',
    probeKindLabel: 'فحص السلامة',
    probeKindOptions: {
      http: 'طلب HTTP(S) GET',
      tcp: 'اتصال TCP',
      script: 'رمز خروج برنامج نصي',
    },
    probeTargetLabel: 'هدف الفحص',
    probeTargetPlaceholder: 'مثال: http://api.recovery:8080/healthz',
    probeExpectStatusLabel: 'حالة HTTP المتوقعة',
    probeExpectStatusHint: 'يُستخدَم فقط لفحص HTTP. القيمة الافتراضية 200.',
    bootTimeoutLabel: 'مهلة الإقلاع (بالثواني)',
    bootTimeoutHint: 'المدة التي تنتظرها الطبقة حتى تصبح هذه الخدمة سليمة.',
    healthRetriesLabel: 'محاولات فحص السلامة',
    healthRetriesHint: 'عدد محاولات الفحص قبل وسم الخدمة بأنها غير سليمة.',
    dependsOnLabel: 'تعتمد على',
    dependsOnHint: 'أسماء الخدمات التي يجب أن تكون سليمة أولًا، مفصولة بفواصل.',
    dependsOnPlaceholder: 'مثال: postgres-primary, cache',
    addServiceRow: 'إضافة خدمة',
    removeServiceRow: 'إزالة الخدمة',
    serviceRowHeading: (index) => `الخدمة ${index}`,
    defineServicesSubmit: 'حفظ خدمات الإقلاع',
    atLeastOneServiceError: 'أضِف خدمة إقلاع واحدة على الأقل.',
    serviceNameError: 'أدخِل اسم الخدمة.',
    probeTargetError: 'أدخِل هدف الفحص.',

    startBootRunTrigger: 'بدء تشغيل الإقلاع',
    bootPolicyLabel: 'سياسة الفشل',
    bootPolicyOptions: {
      halt: 'الإيقاف عند فشل الطبقة',
      rollback: 'التراجع عن الطبقات المُقلَعة',
    },
    bootPolicyHint:
      'ما يفعله التشغيل عندما لا تصبح طبقة سليمة ضمن مهلتها.',
    startBootRunSubmit: 'بدء إقلاع معزول',
    startBootRunTitle: 'بدء تشغيل إقلاع معزول',
    startBootRunDescription:
      'أقلِع موقع الاسترداد طبقةً بطبقة في شبكة معزولة. اختر كيفية استجابة التشغيل لطبقة تعجز عن أن تصبح سليمة.',
    bootRunTitle: 'تشغيل إقلاع معزول',
    bootRunDescription:
      'تقدّم الإقلاع المباشر طبقةً بطبقة وسلامة كل خدمة للإقلاع الجاري.',
    bootRunStatusLabel: 'حالة التشغيل',
    bootRunPolicyLabel: 'السياسة',
    bootRunTiersLabel: 'الطبقات المُقلَعة',
    bootRunTiersValue: (booted, total) => `${booted} من ${total}`,
    bootRunStartedLabel: 'بدأ في',
    bootRunColumnService: 'الخدمة',
    bootRunColumnTier: 'الطبقة',
    bootRunColumnStatus: 'الحالة',
    bootRunColumnAttempts: 'المحاولات',
    bootRunColumnError: 'آخر خطأ',
    bootRunNoError: 'لا شيء',
    bootRunEmptyTitle: 'لا يوجد إقلاع جارٍ',
    bootRunEmptyDescription:
      'ابدأ تشغيل إقلاع معزول لتتبّع تقدّم الإقلاع طبقةً بطبقة هنا.',
    bootRunStatusOptions: {
      pending: 'معلّق',
      running: 'قيد التشغيل',
      completed: 'مكتمل',
      failed: 'فشل',
      rolled_back: 'تمت الإعادة إلى الحالة السابقة',
    },
    bootServiceStatusOptions: {
      pending: 'معلّق',
      booting: 'قيد الإقلاع',
      healthy: 'سليم',
      unhealthy: 'غير سليم',
      rolled_back: 'تمت الإعادة إلى الحالة السابقة',
    },

    cancel: 'إلغاء',

    bootServicesDefinedAnnouncement: (count) =>
      count === 1
        ? 'تم تحديث خطة الإقلاع بخدمة واحدة.'
        : `تم تحديث خطة الإقلاع بـ ${count} خدمات.`,
    bootRunStartedAnnouncement: (id) => `بدأ تشغيل الإقلاع المعزول ${id}.`,
  },
};

/** English surface, exported for non-React callers and as the default resolution. */
export const topologyPageLabels: TopologyPageLabels = topologyPageLabelBundle.en;

/**
 * useTopologyPageLabels resolves the topology+boot authoring chrome against the
 * active locale (English fallback / default), mirroring the shared `useDRLabels`
 * hook and the foundation `useTopologyLabels` hook.
 */
export function useTopologyPageLabels(): TopologyPageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(topologyPageLabelBundle, locale), [locale]);
}
