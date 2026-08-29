'use client';

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).

/**
 * Feature-local bilingual copy for the ClarioDR OPERATIONAL PANELS
 * (`dr-operational-panels.tsx`): the operator-actions launcher, the recovery-tier
 * summary, the recovery-point-validation table, and the cyber-vault/compliance
 * panel. Consumed by the root console (`dr/page.tsx`) and the Protect route.
 *
 * Follows the DR module convention (`DRBilingual<T>` + a `use…Labels()` hook that
 * resolves against the active locale, defaulting to English so the panels'
 * English-asserting tests stay green). Acronyms RTO/RPO/RTA/WORM/DR are kept and
 * glossed on first natural use; interpolation params + Western digits are
 * preserved across both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface OperationalPanelsLabels {
  na: string;

  operatorActions: {
    title: string;
    description: string;
    reviewGroups: string;
    groupsProtected: (count: number) => string;
    configureGroupFirst: string;
    validatePoint: string;
    latestPointValidated: string;
    validationPending: string;
    noSealedPoint: string;
    triageRpo: string;
    breachesNeedReview: (count: number) => string;
    streamsWithinObjective: (count: number) => string;
    advanceRun: string;
    runFallback: string;
    runAtGate: (mode: string, gate: number) => string;
    noActiveRunToAdvance: string;
    exportEvidence: string;
    reportsReady: (count: number) => string;
    attestationRequiredFirst: string;
    reviewControls: string;
    readinessNotScored: string;
    readinessPercent: (pct: number) => string;
  };

  recoveryTiers: {
    title: string;
    description: string;
    groupsBadge: (count: number) => string;
    ready: string;
    worstRpo: string;
    weakest: string;
    noGroupsInTier: string;
    inspectTier: string;
    tiers: Record<'tier-0' | 'tier-1' | 'tier-2' | 'tier-3', { label: string; description: string; target: string }>;
  };

  recoveryPointValidation: {
    title: string;
    description: string;
    validatedBadge: (validated: number, total: number) => string;
    colGroup: string;
    colPoint: string;
    colValidation: string;
    colRpo: string;
    colRetention: string;
    colHash: string;
    colAction: string;
    emptyRow: string;
    noSealedPointCell: string;
    markerPrefix: (lsn: string) => string;
    validated: string;
    pending: string;
    missing: string;
    targetPrefix: (value: string) => string;
    legalHold: string;
    policyRetention: string;
    openGroup: string;
  };

  cyberVault: {
    title: string;
    description: string;
    unscored: string;
    readyPercent: (pct: number) => string;
    immutableVault: string;
    lockedArtifacts: (count: number) => string;
    hashChain: string;
    notAnchored: string;
    keyCustody: string;
    noActiveKey: string;
    airGap: string;
    bundleNotReported: string;
    packageGates: string;
    packageGatesDesc: string;
    reportsBadge: (count: number) => string;
    gateValidatedPoint: string;
    gateAttestation: string;
    gateHashContinuity: string;
    gateControlsScored: string;
    exportAttestation: string;
    regulatorPackage: string;
    frameworkCoverage: string;
    frameworkCoverageDesc: string;
    packsBadge: (count: number) => string;
    compliancePack: string;
    gapsSuffix: (count: number) => string;
    noPacks: string;
  };

  gateLine: {
    ready: string;
    blocked: string;
  };
}

const operationalPanelsLabels: DRBilingual<OperationalPanelsLabels> = {
  en: {
    na: 'n/a',
    operatorActions: {
      title: 'Operator actions',
      description: 'Affordances are enabled only when the backing DR state is present.',
      reviewGroups: 'Review groups',
      groupsProtected: (count) => `${count} groups protected`,
      configureGroupFirst: 'Configure a protection group first',
      validatePoint: 'Validate point',
      latestPointValidated: 'Latest point is validated',
      validationPending: 'Validation pending',
      noSealedPoint: 'No sealed point available',
      triageRpo: 'Triage RPO',
      breachesNeedReview: (count) => `${count} breaches need review`,
      streamsWithinObjective: (count) => `${count} streams within objective`,
      advanceRun: 'Advance run',
      runFallback: 'run',
      runAtGate: (mode, gate) => `${mode} at gate ${gate}`,
      noActiveRunToAdvance: 'No active run to advance',
      exportEvidence: 'Export evidence',
      reportsReady: (count) => `${count} reports ready`,
      attestationRequiredFirst: 'Attestation required first',
      reviewControls: 'Review controls',
      readinessNotScored: 'Readiness not scored',
      readinessPercent: (pct) => `${pct}% readiness`,
    },
    recoveryTiers: {
      title: 'Recovery tiers',
      description:
        'Groups are tiered by RTO objective and scored by validated point, RPO, and replication.',
      groupsBadge: (count) => `${count} groups`,
      ready: 'Ready',
      worstRpo: 'Worst RPO',
      weakest: 'Weakest',
      noGroupsInTier: 'No groups assigned to this tier.',
      inspectTier: 'Inspect tier',
      tiers: {
        'tier-0': { label: 'Tier 0', description: 'Mission critical', target: '<= 15m RTO' },
        'tier-1': { label: 'Tier 1', description: 'Revenue systems', target: '<= 1h RTO' },
        'tier-2': { label: 'Tier 2', description: 'Operational apps', target: '<= 4h RTO' },
        'tier-3': { label: 'Tier 3', description: 'Standard restore', target: '> 4h RTO' },
      },
    },
    recoveryPointValidation: {
      title: 'Recovery point validation',
      description: 'Latest sealed points, validation ratios, retention state, and restore readiness.',
      validatedBadge: (validated, total) => `${validated}/${total} validated`,
      colGroup: 'Group',
      colPoint: 'Point',
      colValidation: 'Validation',
      colRpo: 'RPO',
      colRetention: 'Retention',
      colHash: 'Hash',
      colAction: 'Action',
      emptyRow: 'No protection groups returned for recovery point validation.',
      noSealedPointCell: 'no sealed point',
      markerPrefix: (lsn) => `marker ${lsn}`,
      validated: 'Validated',
      pending: 'Pending',
      missing: 'Missing',
      targetPrefix: (value) => `target ${value}`,
      legalHold: 'legal hold',
      policyRetention: 'policy retention',
      openGroup: 'Open group',
    },
    cyberVault: {
      title: 'Cyber-vault and compliance',
      description:
        'Immutable recovery, key custody, evidence continuity, and framework export readiness.',
      unscored: 'unscored',
      readyPercent: (pct) => `${pct}% ready`,
      immutableVault: 'Immutable vault',
      lockedArtifacts: (count) => `${count} locked artifacts`,
      hashChain: 'Hash chain',
      notAnchored: 'not anchored',
      keyCustody: 'Key custody',
      noActiveKey: 'no active key reported',
      airGap: 'Air gap',
      bundleNotReported: 'bundle not reported',
      packageGates: 'Package gates',
      packageGatesDesc: 'Evidence export requires attestation and stable controls.',
      reportsBadge: (count) => `${count} reports`,
      gateValidatedPoint: 'Validated recovery point',
      gateAttestation: 'Gate-4 attestation',
      gateHashContinuity: 'Hash-chain continuity',
      gateControlsScored: 'Compliance controls scored',
      exportAttestation: 'Export attestation',
      regulatorPackage: 'Regulator package',
      frameworkCoverage: 'Framework coverage',
      frameworkCoverageDesc: 'Top compliance packs and control gaps.',
      packsBadge: (count) => `${count} packs`,
      compliancePack: 'Compliance pack',
      gapsSuffix: (count) => `${count} gaps`,
      noPacks: 'No compliance packs returned from the DR API.',
    },
    gateLine: {
      ready: 'Ready',
      blocked: 'Blocked',
    },
  },
  ar: {
    na: 'غير متاح',
    operatorActions: {
      title: 'إجراءات المشغّل',
      description: 'لا تُفعَّل الإجراءات إلا عند توفّر حالة التعافي من الكوارث (DR) الداعمة.',
      reviewGroups: 'مراجعة المجموعات',
      groupsProtected: (count) => `${count} مجموعة محمية`,
      configureGroupFirst: 'هيّئ مجموعة حماية أولًا',
      validatePoint: 'التحقق من النقطة',
      latestPointValidated: 'تم التحقق من أحدث نقطة',
      validationPending: 'التحقق قيد الانتظار',
      noSealedPoint: 'لا توجد نقطة مختومة متاحة',
      triageRpo: 'فرز هدف نقطة الاسترداد (RPO)',
      breachesNeedReview: (count) => `${count} تجاوز يحتاج إلى مراجعة`,
      streamsWithinObjective: (count) => `${count} تدفّق ضمن الهدف`,
      advanceRun: 'تقديم العملية',
      runFallback: 'عملية',
      runAtGate: (mode, gate) => `${mode} عند البوابة ${gate}`,
      noActiveRunToAdvance: 'لا توجد عملية نشطة لتقديمها',
      exportEvidence: 'تصدير الأدلة',
      reportsReady: (count) => `${count} تقرير جاهز`,
      attestationRequiredFirst: 'الإثبات مطلوب أولًا',
      reviewControls: 'مراجعة الضوابط',
      readinessNotScored: 'لم تُقيَّم الجاهزية',
      readinessPercent: (pct) => `${pct}% جاهزية`,
    },
    recoveryTiers: {
      title: 'مستويات الاسترداد',
      description:
        'تُصنَّف المجموعات حسب هدف زمن الاسترداد (RTO)، وتُقيَّم وفق النقطة المُتحقَّق منها وهدف نقطة الاسترداد (RPO) والنسخ المتماثل.',
      groupsBadge: (count) => `${count} مجموعة`,
      ready: 'جاهزة',
      worstRpo: 'أسوأ هدف نقطة الاسترداد (RPO)',
      weakest: 'الأضعف',
      noGroupsInTier: 'لا توجد مجموعات مُسنَدة إلى هذا المستوى.',
      inspectTier: 'فحص المستوى',
      tiers: {
        'tier-0': {
          label: 'المستوى 0',
          description: 'بالغة الأهمية',
          target: 'هدف زمن الاسترداد (RTO) ≤ 15 دقيقة',
        },
        'tier-1': {
          label: 'المستوى 1',
          description: 'أنظمة الإيرادات',
          target: 'هدف زمن الاسترداد (RTO) ≤ 1 ساعة',
        },
        'tier-2': {
          label: 'المستوى 2',
          description: 'التطبيقات التشغيلية',
          target: 'هدف زمن الاسترداد (RTO) ≤ 4 ساعات',
        },
        'tier-3': {
          label: 'المستوى 3',
          description: 'الاستعادة القياسية',
          target: 'هدف زمن الاسترداد (RTO) > 4 ساعات',
        },
      },
    },
    recoveryPointValidation: {
      title: 'التحقق من نقطة الاسترداد',
      description: 'أحدث النقاط المختومة ونسب التحقق وحالة الاحتفاظ وجاهزية الاستعادة.',
      validatedBadge: (validated, total) => `${validated}/${total} مُتحقَّق منها`,
      colGroup: 'المجموعة',
      colPoint: 'النقطة',
      colValidation: 'التحقق',
      colRpo: 'هدف نقطة الاسترداد (RPO)',
      colRetention: 'الاحتفاظ',
      colHash: 'التجزئة',
      colAction: 'الإجراء',
      emptyRow: 'لم تُرجَع أي مجموعات حماية للتحقق من نقطة الاسترداد.',
      noSealedPointCell: 'لا توجد نقطة مختومة',
      markerPrefix: (lsn) => `مؤشر ${lsn}`,
      validated: 'مُتحقَّق منها',
      pending: 'قيد الانتظار',
      missing: 'مفقودة',
      targetPrefix: (value) => `الهدف ${value}`,
      legalHold: 'حجز قانوني',
      policyRetention: 'احتفاظ حسب السياسة',
      openGroup: 'فتح المجموعة',
    },
    cyberVault: {
      title: 'الخزنة السيبرانية والامتثال',
      description:
        'استرداد غير قابل للتعديل، وحفظ المفاتيح، واستمرارية الأدلة، وجاهزية تصدير الأطر.',
      unscored: 'غير مُقيَّم',
      readyPercent: (pct) => `${pct}% جاهزية`,
      immutableVault: 'خزنة غير قابلة للتعديل',
      lockedArtifacts: (count) => `${count} عنصر مقفل`,
      hashChain: 'سلسلة التجزئة',
      notAnchored: 'غير مرتبطة بمرساة',
      keyCustody: 'حفظ المفاتيح',
      noActiveKey: 'لم يُبلَّغ عن مفتاح نشط',
      airGap: 'العزل الهوائي',
      bundleNotReported: 'لم يُبلَّغ عن الحزمة',
      packageGates: 'بوابات الحزمة',
      packageGatesDesc: 'يتطلب تصدير الأدلة الإثبات وضوابط مستقرة.',
      reportsBadge: (count) => `${count} تقرير`,
      gateValidatedPoint: 'نقطة الاسترداد المُتحقَّق منها',
      gateAttestation: 'إثبات البوابة 4',
      gateHashContinuity: 'استمرارية سلسلة التجزئة',
      gateControlsScored: 'تقييم ضوابط الامتثال',
      exportAttestation: 'تصدير الإثبات',
      regulatorPackage: 'حزمة الجهة التنظيمية',
      frameworkCoverage: 'تغطية الأطر',
      frameworkCoverageDesc: 'أبرز حزم الامتثال وفجوات الضوابط.',
      packsBadge: (count) => `${count} حزمة`,
      compliancePack: 'حزمة امتثال',
      gapsSuffix: (count) => `${count} فجوة`,
      noPacks: 'لم تُرجَع أي حزم امتثال من واجهة DR API.',
    },
    gateLine: {
      ready: 'جاهز',
      blocked: 'محجوب',
    },
  },
};

export function useOperationalPanelsLabels(): OperationalPanelsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(operationalPanelsLabels, locale), [locale]);
}
