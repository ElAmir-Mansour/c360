/**
 * Feature-local bilingual label bundles for the recovery-tier & objective-fit
 * advisor surface (objective-fit advisor on the protect route, recovery-tier
 * catalog on the readiness route).
 *
 * Adopts the foundation bilingual contract verbatim: each label group is a
 * `DRBilingual<T> = { en, ar }` bundle of two FULL, identically-shaped copies —
 * the original English in `en` (unchanged so the English-asserting tests stay
 * green) and professional Modern Standard Arabic in `ar`. Resolution is via the
 * shared `resolveDRBilingual` + `useLocaleOrDefault`, so under the
 * `renderWithQuery` `en` default the English surface is preserved and an Arabic
 * locale yields the full MSA surface. Acronyms RTO/RPO are kept and glossed in
 * Arabic on first natural use.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface AdvisorLabels {
  title: string;
  description: string;
  rtoObjective: string;
  rpoObjective: string;
  recommendedTier: string;
  strategy: string;
  validationCadence: string;
  cyberVault: string;
  cleanRoom: string;
  capabilities: string;
  required: string;
  notRequired: string;
  remediation: string;
  noRemediation: string;
  recommendAction: string;
  recommending: string;
  recommendHint: string;
  noWriteHint: string;
  latestRecommendation: string;
  objectiveFitMissing: string;
  noSites: string;
  sites: string;
  objectiveFit: string;
  retry: string;
  failedToLoad: string;
}

export const advisorLabels: DRBilingual<AdvisorLabels> = {
  en: {
    title: 'Recovery-tier & objective-fit advisor',
    description:
      'Per-site recovery objective fit with the recommended tier and concrete remediation derived from the recovery service.',
    rtoObjective: 'RTO objective',
    rpoObjective: 'RPO objective',
    recommendedTier: 'Recommended tier',
    strategy: 'Strategy',
    validationCadence: 'Validation cadence',
    cyberVault: 'Cyber vault',
    cleanRoom: 'Clean room',
    capabilities: 'Capabilities',
    required: 'Required',
    notRequired: 'Not required',
    remediation: 'Remediation',
    noRemediation: 'Objectives are met with no outstanding remediation.',
    recommendAction: 'Recommend tier',
    recommending: 'Recommending…',
    recommendHint: 'Re-run the recommender against this site’s measured RTO/RPO objectives.',
    noWriteHint: 'Requires the dr:write permission.',
    latestRecommendation: 'Latest recommendation',
    objectiveFitMissing: 'No objective-fit assessment has been returned for this site yet.',
    noSites: 'No protected sites returned.',
    sites: 'Protected sites',
    objectiveFit: 'Objective fit',
    retry: 'Retry',
    failedToLoad: 'Failed to load recovery-tier and objective-fit data.',
  },
  ar: {
    title: 'مستشار طبقة التعافي وملاءمة الأهداف',
    description:
      'ملاءمة أهداف التعافي لكل موقع مع الطبقة الموصى بها وخطوات معالجة محددة مستمدة من خدمة التعافي.',
    rtoObjective: 'هدف زمن الاسترداد (RTO)',
    rpoObjective: 'هدف نقطة الاسترداد (RPO)',
    recommendedTier: 'الطبقة الموصى بها',
    strategy: 'الإستراتيجية',
    validationCadence: 'وتيرة التحقق',
    cyberVault: 'الخزنة السيبرانية',
    cleanRoom: 'الغرفة النظيفة',
    capabilities: 'القدرات',
    required: 'مطلوب',
    notRequired: 'غير مطلوب',
    remediation: 'المعالجة',
    noRemediation: 'تم تحقيق الأهداف دون أي إجراءات معالجة معلّقة.',
    recommendAction: 'أوصِ بطبقة',
    recommending: 'جارٍ التوصية…',
    recommendHint: 'أعد تشغيل المُوصي وفق أهداف زمن ونقطة الاسترداد (RTO/RPO) المقاسة لهذا الموقع.',
    noWriteHint: 'يتطلب صلاحية dr:write.',
    latestRecommendation: 'أحدث توصية',
    objectiveFitMissing: 'لم يُرجَع بعد أي تقييم لملاءمة الأهداف لهذا الموقع.',
    noSites: 'لا توجد مواقع محمية.',
    sites: 'المواقع المحمية',
    objectiveFit: 'ملاءمة الأهداف',
    retry: 'إعادة المحاولة',
    failedToLoad: 'فشل تحميل بيانات طبقة التعافي وملاءمة الأهداف.',
  },
};

/**
 * useAdvisorLabels resolves the objective-fit advisor labels against the active
 * locale (English fallback / default), mirroring the shared `useDRLabels` hook.
 */
export function useAdvisorLabels(): AdvisorLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(advisorLabels, locale), [locale]);
}

export interface CatalogLabels {
  title: string;
  description: string;
  rto: string;
  rpo: string;
  validation: string;
  cyberVault: string;
  cleanRoom: string;
  capabilities: string;
  required: string;
  notRequired: string;
  recommended: string;
  noTiers: string;
  failedToLoad: string;
  tiers: string;
}

export const catalogLabels: DRBilingual<CatalogLabels> = {
  en: {
    title: 'Recovery-tier catalog',
    description:
      'The recovery service’s tier profiles — each tier’s strategy, objectives, validation cadence, and isolation requirements.',
    rto: 'RTO',
    rpo: 'RPO',
    validation: 'Validation',
    cyberVault: 'Cyber vault',
    cleanRoom: 'Clean room',
    capabilities: 'Capabilities',
    required: 'Required',
    notRequired: 'Optional',
    recommended: 'Recommended',
    noTiers: 'No recovery-tier profiles returned.',
    failedToLoad: 'Failed to load the recovery-tier catalog.',
    tiers: 'Tiers',
  },
  ar: {
    title: 'دليل طبقات التعافي',
    description:
      'ملفات طبقات خدمة التعافي — إستراتيجية كل طبقة وأهدافها ووتيرة التحقق ومتطلبات العزل.',
    rto: 'هدف زمن الاسترداد (RTO)',
    rpo: 'هدف نقطة الاسترداد (RPO)',
    validation: 'التحقق',
    cyberVault: 'الخزنة السيبرانية',
    cleanRoom: 'الغرفة النظيفة',
    capabilities: 'القدرات',
    required: 'مطلوب',
    notRequired: 'اختياري',
    recommended: 'موصى به',
    noTiers: 'لا توجد ملفات طبقات تعافي.',
    failedToLoad: 'فشل تحميل دليل طبقات التعافي.',
    tiers: 'الطبقات',
  },
};

/**
 * useCatalogLabels resolves the recovery-tier catalog labels against the active
 * locale (English fallback / default), mirroring the shared `useDRLabels` hook.
 */
export function useCatalogLabels(): CatalogLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(catalogLabels, locale), [locale]);
}
