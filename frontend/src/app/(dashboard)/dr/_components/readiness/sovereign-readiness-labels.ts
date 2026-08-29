'use client';

/**
 * Feature-local bilingual copy for the Sovereign Readiness panel
 * (`SovereignReadinessPanel`). The panel derives its readiness/evidence
 * summaries from live query data via module-level builders; the human-readable
 * control names, framework names, detail lines, and card chrome are threaded in
 * from this bundle so the surface localizes without changing any derivation.
 *
 * Adopts the console bilingual contract: a `DRBilingual<SovereignReadinessLabels>`
 * of two FULL, identically-shaped copies (English verbatim in `en` so the
 * `renderWithQuery` en-default tests stay green; professional Saudi MSA in `ar`).
 * Resolved via {@link useSovereignReadinessLabels}. Acronyms (WORM/BYOK/BCM/
 * NCA/SAMA/KMS/AES-256) are kept verbatim and glossed on first natural use.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface SovereignReadinessLabels {
  loadError: string;

  // Health-status display map (keyed by normalized status token).
  health: Record<string, string>;

  // Score gauge + header.
  panelTitle: string;
  panelSubtitle: string;
  naLabel: string;
  scoreCaption: string;
  regulatorReady: string;
  needsReview: string;
  notReported: string;
  notGenerated: string;
  updated: (dateTime: string) => string;
  regionGenerated: (region: string, generated: string) => string;

  // Sovereign-control tiles.
  dataResidency: string;
  recoveryPoints: string;
  wormItems: (count: number) => string;
  keyCustody: string;
  tenantKms: string;
  airGap: string;
  bundleNotReported: string;

  // Readiness-controls card.
  readinessControlsTitle: string;
  readinessControlsSubtitle: string;
  noDetail: string;

  // Framework-coverage card.
  frameworkCoverageTitle: string;
  frameworkCoverageSubtitle: string;
  openGaps: (count: number) => string;

  // Derived readiness summary (buildReadinessSummary).
  region: string;
  residencyActive: string;
  noActiveByokKey: string;
  ctrlBcmPacks: string;
  packsAvailable: (count: number) => string;
  noBcmPacks: string;
  ctrlByokCustody: string;
  noActiveKey: string;
  ctrlImmutableEvidence: string;
  attestationRecords: (count: number) => string;
  ctrlOpenAttention: string;
  currentAttentionItems: (count: number) => string;

  // Default readiness controls (defaultReadinessControls).
  ctrlInRegion: string;
  regionNotReported: string;
  ctrlImmutablePoints: string;
  lockedRecoveryArtifacts: (count: number) => string;
  ctrlHumanApproval: string;
  humanApprovalDetail: string;
  ctrlAttestationLedger: string;
  immutableReportsIndexed: (count: number) => string;

  // Default frameworks (defaultFrameworks). NCA ECC / CCC and SAMA BCM are
  // regulator framework proper names — kept verbatim in both locales.
  fwNcaEccCcc: string;
  fwSamaBcm: string;
  fwInternalDrPolicy: string;
}

const HEALTH_EN: Record<string, string> = {
  healthy: 'Healthy',
  warning: 'Watch',
  critical: 'Critical',
  paused: 'Paused',
  seeding: 'Seeding',
  empty: 'Empty',
  streaming: 'Streaming',
  degraded: 'Degraded',
  error: 'Error',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
};

const HEALTH_AR: Record<string, string> = {
  healthy: 'سليم',
  warning: 'تحت المراقبة',
  critical: 'حرج',
  paused: 'متوقف مؤقتًا',
  seeding: 'قيد التهيئة',
  empty: 'فارغ',
  streaming: 'قيد البث',
  degraded: 'متدهور',
  error: 'خطأ',
  completed: 'مكتمل',
  passed: 'ناجح',
  failed: 'فشل',
};

export const sovereignReadinessLabels: DRBilingual<SovereignReadinessLabels> = {
  en: {
    loadError: 'Failed to load sovereign readiness.',
    health: HEALTH_EN,

    panelTitle: 'Sovereign readiness',
    panelSubtitle: 'Residency, immutable recovery, encryption custody, and air-gap posture.',
    naLabel: 'n/a',
    scoreCaption: 'score',
    regulatorReady: 'Regulator ready',
    needsReview: 'Needs review',
    notReported: 'not reported',
    notGenerated: 'not generated',
    updated: (dateTime) => `updated ${dateTime}`,
    regionGenerated: (region, generated) => `Region ${region}. Generated ${generated}.`,

    dataResidency: 'Data residency',
    recoveryPoints: 'Recovery points',
    wormItems: (count) => `${count} WORM items`,
    keyCustody: 'Key custody',
    tenantKms: 'tenant KMS',
    airGap: 'Air gap',
    bundleNotReported: 'bundle not reported',

    readinessControlsTitle: 'Readiness controls',
    readinessControlsSubtitle: 'Controls expected before a live failover or regulator export.',
    noDetail: 'No detail returned',

    frameworkCoverageTitle: 'Framework coverage',
    frameworkCoverageSubtitle: 'NCA, SAMA BCM, and internal operational controls.',
    openGaps: (count) => `${count} open gaps`,

    region: 'tenant DR region',
    residencyActive: 'sovereign controls active',
    noActiveByokKey: 'no active BYOK key reported',
    ctrlBcmPacks: 'BCM compliance packs',
    packsAvailable: (count) => `${count} packs available`,
    noBcmPacks: 'No BCM packs returned',
    ctrlByokCustody: 'BYOK key custody',
    noActiveKey: 'No active key returned',
    ctrlImmutableEvidence: 'Immutable recovery evidence',
    attestationRecords: (count) => `${count} attestation records`,
    ctrlOpenAttention: 'Open DR attention',
    currentAttentionItems: (count) => `${count} current attention items`,

    ctrlInRegion: 'In-region recovery',
    regionNotReported: 'Region not reported',
    ctrlImmutablePoints: 'Immutable restore points',
    lockedRecoveryArtifacts: (count) => `${count} locked recovery artifacts`,
    ctrlHumanApproval: 'Human approval gate',
    humanApprovalDetail: 'Gate 2 is represented as an explicit approval state',
    ctrlAttestationLedger: 'Attestation ledger',
    immutableReportsIndexed: (count) => `${count} immutable reports indexed`,

    fwNcaEccCcc: 'NCA ECC / CCC',
    fwSamaBcm: 'SAMA BCM',
    fwInternalDrPolicy: 'Internal DR policy',
  },
  ar: {
    loadError: 'تعذّر تحميل الجاهزية السيادية.',
    health: HEALTH_AR,

    panelTitle: 'الجاهزية السيادية',
    panelSubtitle: 'موطنة البيانات، والاسترداد غير القابل للتعديل، وحيازة مفاتيح التشفير، ووضع العزل الشبكي.',
    naLabel: 'غير متاح',
    scoreCaption: 'الدرجة',
    regulatorReady: 'جاهز للهيئة المنظِّمة',
    needsReview: 'يحتاج إلى مراجعة',
    notReported: 'غير مُبلَّغ عنه',
    notGenerated: 'لم يُنشأ',
    updated: (dateTime) => `حُدِّث ${dateTime}`,
    regionGenerated: (region, generated) => `المنطقة ${region}. أُنشئ ${generated}.`,

    dataResidency: 'موطنة البيانات',
    recoveryPoints: 'نقاط الاسترداد',
    wormItems: (count) => `${count} عنصر بنمط WORM`,
    keyCustody: 'حيازة المفاتيح',
    tenantKms: 'خدمة إدارة مفاتيح المستأجر (KMS)',
    airGap: 'العزل الشبكي',
    bundleNotReported: 'لم يُبلَّغ عن الحزمة',

    readinessControlsTitle: 'ضوابط الجاهزية',
    readinessControlsSubtitle: 'الضوابط المتوقّعة قبل تجاوز الفشل الفعلي أو التصدير للهيئة المنظِّمة.',
    noDetail: 'لم تُرجَع تفاصيل',

    frameworkCoverageTitle: 'تغطية الأطر',
    frameworkCoverageSubtitle: 'ضوابط الهيئة الوطنية للأمن السيبراني (NCA) واستمرارية الأعمال لدى ساما (SAMA BCM) والضوابط التشغيلية الداخلية.',
    openGaps: (count) => `${count} فجوة مفتوحة`,

    region: 'منطقة المستأجر للتعافي من الكوارث',
    residencyActive: 'الضوابط السيادية مفعّلة',
    noActiveByokKey: 'لا يوجد مفتاح BYOK نشط مُبلَّغ عنه',
    ctrlBcmPacks: 'حِزم الامتثال لاستمرارية الأعمال (BCM)',
    packsAvailable: (count) => `${count} حزمة متاحة`,
    noBcmPacks: 'لم تُرجَع حِزم استمرارية الأعمال (BCM)',
    ctrlByokCustody: 'حيازة مفتاح BYOK',
    noActiveKey: 'لم يُرجَع مفتاح نشط',
    ctrlImmutableEvidence: 'أدلة استرداد غير قابلة للتعديل',
    attestationRecords: (count) => `${count} سجل إثبات`,
    ctrlOpenAttention: 'تنبيهات التعافي المفتوحة',
    currentAttentionItems: (count) => `${count} عنصر انتباه حالي`,

    ctrlInRegion: 'الاسترداد داخل المنطقة',
    regionNotReported: 'المنطقة غير مُبلَّغ عنها',
    ctrlImmutablePoints: 'نقاط استعادة غير قابلة للتعديل',
    lockedRecoveryArtifacts: (count) => `${count} أثر استرداد مقفل`,
    ctrlHumanApproval: 'بوابة الاعتماد البشري',
    humanApprovalDetail: 'تُمثَّل البوابة الثانية كحالة اعتماد صريحة',
    ctrlAttestationLedger: 'سجل الإثبات',
    immutableReportsIndexed: (count) => `${count} تقرير غير قابل للتعديل مفهرس`,

    fwNcaEccCcc: 'أطر الهيئة الوطنية للأمن السيبراني (NCA ECC / CCC)',
    fwSamaBcm: 'استمرارية الأعمال لدى ساما (SAMA BCM)',
    fwInternalDrPolicy: 'سياسة التعافي من الكوارث الداخلية',
  },
};

export function useSovereignReadinessLabels(): SovereignReadinessLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(sovereignReadinessLabels, locale), [locale]);
}
