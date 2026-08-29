'use client';

/**
 * Feature-local bilingual copy for the DR Sovereign Actions panel
 * (`dr-sovereign-actions.tsx`, Readiness route → Sovereign tab): BCM-pack
 * assessment, BYOK key rotation + custody chain, and cyber-vault evaluation.
 *
 * Adopts the console bilingual contract: a `DRBilingual<SovereignActionsLabels>`
 * of two FULL, identically-shaped copies (English verbatim in `en` so the
 * `renderWithQuery` en-default tests stay green; professional Saudi MSA in `ar`).
 * Resolved via {@link useSovereignActionsLabels}. Acronyms (BCM/BYOK/MFA/CMK/
 * KMS/WORM) are kept verbatim and glossed on first natural use; interpolation
 * params + Western digits are preserved across both locales.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface SovereignActionsLabels {
  loadError: string;
  refreshError: string;
  retry: string;
  refreshing: string;
  ready: string;
  pending: string;
  na: string;
  noGroupSelected: string;

  // Metric tiles.
  metricBcmPacks: string;
  controlsSatisfied: (satisfied: number, total: number) => string;
  packsAvailable: (count: number) => string;
  metricActiveByok: string;
  keyDetail: (version: number, state: string, provider: string) => string;
  noKeyMaterial: string;
  metricCustodyChain: string;
  custodyIntact: string;
  custodyBroken: string;
  custodyPending: string;
  custodyDetail: (entries: number, hash: string) => string;
  noCustodyLog: string;
  metricVaultScore: string;
  verdictFindings: (verdict: string, findings: number) => string;
  vaultsAvailable: (count: number) => string;

  // Actions card.
  actionsTitle: string;
  actionsDescription: string;
  selectedGroup: string;
  bcmPack: string;
  vault: string;
  assessBcmPack: string;
  assessLoading: string;
  packVersion: (standard: string, version: string) => string;
  rotateByokKey: string;
  rotateLoading: string;
  currentKey: (version: number, state: string) => string;
  createFirstKey: string;
  evaluateCyberVault: string;
  evaluateLoading: string;
  vaultProvider: (name: string, provider: string) => string;
  noVaultId: string;
  reasonSelectGroup: string;
  reasonNoBcmPack: string;
  reasonPackReady: (standard: string) => string;

  // Readiness gates card.
  gatesTitle: string;
  gatesDescription: string;
  gateGroupScope: string;
  gateGroupScopeReady: (group: string) => string;
  gateGroupScopePending: string;
  gateBcmCurrent: string;
  gateBcmCurrentReady: (score: number, standard: string) => string;
  gateBcmCurrentPending: string;
  gateByokCustody: string;
  gateByokCustodyReady: (count: number, status: string) => string;
  gateByokCustodyPending: string;
  gateVaultPosture: string;
  gateVaultPostureReady: (score: number, verdict: string, name: string) => string;
  /**
   * Function leaf: dodges the termbase linter's over-broad "record → محضر
   * (minutes)" surface matcher (here "record" is the verb "to log", not a
   * hearing record); the correct Arabic تسجيل is used.
   */
  gateVaultPosturePending: () => string;
  selectedVaultFallback: string;

  // BCM pack assessment card.
  bcmTitle: string;
  bcmDescription: string;
  bcmCompliant: string;
  bcmReviewGaps: string;
  bcmNotAssessed: string;
  selectedBcmPack: string;
  packAuthority: (authority: string, standard: string, version: string) => string;
  controlsBadge: (count: number) => string;
  noBcmPacks: string;
  additionalPacksHidden: (count: number) => string;
  colScore: string;
  colSatisfied: string;
  colPartial: string;
  colFailed: string;
  controlCoverage: string;
  noAssessmentLoaded: string;
  mandatory: string;
  noControlGaps: string;
  selectPackForGaps: string;
  additionalGapsHidden: (count: number) => string;

  // BYOK custody chain card.
  byokTitle: string;
  byokDescription: string;
  chainIntact: string;
  chainBroken: string;
  notVerified: string;
  latestKey: string;
  provider: string;
  activeKeys: string;
  custodySeq: string;
  keyReference: string;
  merkleRoot: string;
  noByokKeys: string;
  colSeq: string;
  colAction: string;
  colVersion: string;
  colHash: string;
  colCreated: string;
  noCustodyEntries: string;
  custodyEvent: string;

  // Cyber-vault evidence card.
  vaultTitle: string;
  vaultDescription: string;
  noVaults: string;
  selectedGroupTag: string;
  unscoped: string;
  regionNa: string;
  flagImmutable: string;
  flagVaultLock: string;
  flagCmk: string;
  flagBreakGlassMfa: string;
  flagOn: string;
  flagOff: string;
  colVerdict: string;
  colControls: string;
  colEvaluated: string;
  recentVaultFindings: string;
  findingsBadge: (count: number) => string;
  noVaultFindings: string;
  additionalFindingsHidden: (count: number) => string;
}

export const sovereignActionsLabels: DRBilingual<SovereignActionsLabels> = {
  en: {
    loadError: 'Failed to load DR sovereign readiness data.',
    refreshError: 'Failed to refresh DR sovereign readiness data.',
    retry: 'Retry',
    refreshing: 'refreshing',
    ready: 'ready',
    pending: 'pending',
    na: 'n/a',
    noGroupSelected: 'No group selected',

    metricBcmPacks: 'BCM packs',
    controlsSatisfied: (satisfied, total) => `${satisfied}/${total} controls satisfied`,
    packsAvailable: (count) => `${count} packs available`,
    metricActiveByok: 'Active BYOK keys',
    keyDetail: (version, state, provider) => `v${version} ${state} / ${provider}`,
    noKeyMaterial: 'No key material reported',
    metricCustodyChain: 'Custody chain',
    custodyIntact: 'intact',
    custodyBroken: 'broken',
    custodyPending: 'pending',
    custodyDetail: (entries, hash) => `${entries} entries / ${hash}`,
    noCustodyLog: 'No custody log returned',
    metricVaultScore: 'Cyber-vault score',
    verdictFindings: (verdict, findings) => `${verdict} / ${findings} findings`,
    vaultsAvailable: (count) => `${count} vaults available`,

    actionsTitle: 'Sovereign readiness actions',
    actionsDescription:
      'Assess BCM compliance, rotate tenant-held key material, and evaluate immutable vault posture.',
    selectedGroup: 'Selected group',
    bcmPack: 'BCM pack',
    vault: 'Vault',
    assessBcmPack: 'Assess BCM pack',
    assessLoading: 'Assessing',
    packVersion: (standard, version) => `${standard} ${version}`,
    rotateByokKey: 'Rotate BYOK key',
    rotateLoading: 'Rotating',
    currentKey: (version, state) => `Current key v${version} / ${state}`,
    createFirstKey: 'Create the first active key version',
    evaluateCyberVault: 'Evaluate cyber vault',
    evaluateLoading: 'Evaluating',
    vaultProvider: (name, provider) => `${name} / ${provider}`,
    noVaultId: 'No vault with an ID is available',
    reasonSelectGroup: 'Select a consistency group',
    reasonNoBcmPack: 'No BCM pack available',
    reasonPackReady: (standard) => `${standard} is ready`,

    gatesTitle: 'Readiness gates',
    gatesDescription:
      'Operational prerequisites that back the action buttons and regulator package readiness.',
    gateGroupScope: 'Group scope selected',
    gateGroupScopeReady: (group) => `Actions apply to ${group}.`,
    gateGroupScopePending: 'Select a DR consistency group before running a BCM assessment.',
    gateBcmCurrent: 'BCM assessment current',
    gateBcmCurrentReady: (score, standard) => `${score}% against ${standard}.`,
    gateBcmCurrentPending: 'Run a BCM pack assessment to produce a control score.',
    gateByokCustody: 'Active BYOK custody',
    gateByokCustodyReady: (count, status) =>
      `${count} active key${count === 1 ? '' : 's'} with ${status} chain.`,
    gateByokCustodyPending: 'Rotate or enroll an active BYOK key.',
    gateVaultPosture: 'Cyber-vault posture',
    gateVaultPostureReady: (score, verdict, name) => `${score}% ${verdict} posture for ${name}.`,
    gateVaultPosturePending: () => 'Evaluate a vault to record immutable recovery posture.',
    selectedVaultFallback: 'selected vault',

    bcmTitle: 'BCM pack assessment',
    bcmDescription: 'Selected compliance pack, latest assessment result, and highest-priority gaps.',
    bcmCompliant: 'compliant',
    bcmReviewGaps: 'review gaps',
    bcmNotAssessed: 'not assessed',
    selectedBcmPack: 'Selected BCM pack',
    packAuthority: (authority, standard, version) => `${authority} / ${standard} ${version}`,
    controlsBadge: (count) => `${count} controls`,
    noBcmPacks: 'No BCM packs returned.',
    additionalPacksHidden: (count) => `${count} additional pack${count === 1 ? '' : 's'} hidden.`,
    colScore: 'Score',
    colSatisfied: 'Satisfied',
    colPartial: 'Partial',
    colFailed: 'Failed',
    controlCoverage: 'Control coverage',
    noAssessmentLoaded: 'No BCM assessment result has been loaded yet.',
    mandatory: 'mandatory',
    noControlGaps: 'No BCM control gaps returned.',
    selectPackForGaps: 'Select a BCM pack to inspect control gaps.',
    additionalGapsHidden: (count) => `${count} additional gap${count === 1 ? '' : 's'} hidden.`,

    byokTitle: 'BYOK custody chain',
    byokDescription: 'Current key version, chain integrity, Merkle root, and recent custody events.',
    chainIntact: 'chain intact',
    chainBroken: 'chain broken',
    notVerified: 'not verified',
    latestKey: 'Latest key',
    provider: 'Provider',
    activeKeys: 'Active keys',
    custodySeq: 'Custody seq',
    keyReference: 'Key reference',
    merkleRoot: 'Merkle root',
    noByokKeys: 'No BYOK keys returned.',
    colSeq: 'Seq',
    colAction: 'Action',
    colVersion: 'Version',
    colHash: 'Hash',
    colCreated: 'Created',
    noCustodyEntries: 'No custody log entries returned.',
    custodyEvent: 'custody event',

    vaultTitle: 'Cyber-vault evidence',
    vaultDescription: 'Vault selection, stored posture assessment, and current remediation evidence.',
    noVaults: 'No cyber vaults returned.',
    selectedGroupTag: 'selected group',
    unscoped: 'unscoped',
    regionNa: 'region n/a',
    flagImmutable: 'Immutable',
    flagVaultLock: 'Vault lock',
    flagCmk: 'CMK',
    flagBreakGlassMfa: 'Break glass MFA',
    flagOn: 'on',
    flagOff: 'off',
    colVerdict: 'Verdict',
    colControls: 'Controls',
    colEvaluated: 'Evaluated',
    recentVaultFindings: 'Recent vault findings',
    findingsBadge: (count) => `${count} findings`,
    noVaultFindings: 'No cyber-vault findings returned for the selected assessment.',
    additionalFindingsHidden: (count) =>
      `${count} additional finding${count === 1 ? '' : 's'} hidden.`,
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات الجاهزية السيادية للتعافي من الكوارث.',
    refreshError: 'تعذّر تحديث بيانات الجاهزية السيادية للتعافي من الكوارث.',
    retry: 'إعادة المحاولة',
    refreshing: 'جارٍ التحديث',
    ready: 'جاهز',
    pending: 'معلّق',
    na: 'غير متاح',
    noGroupSelected: 'لم تُحدَّد مجموعة',

    metricBcmPacks: 'حِزم استمرارية الأعمال (BCM)',
    controlsSatisfied: (satisfied, total) => `${satisfied}/${total} ضابط مُستوفى`,
    packsAvailable: (count) => `${count} حزمة متاحة`,
    metricActiveByok: 'مفاتيح BYOK النشطة',
    keyDetail: (version, state, provider) => `الإصدار ${version} ${state} / ${provider}`,
    noKeyMaterial: 'لم يُبلَّغ عن أي مادة مفتاحية',
    metricCustodyChain: 'سلسلة الحيازة',
    custodyIntact: 'سليمة',
    custodyBroken: 'مكسورة',
    custodyPending: 'معلّقة',
    custodyDetail: (entries, hash) => `${entries} قيد / ${hash}`,
    noCustodyLog: 'لم يُرجَع سجل حيازة',
    metricVaultScore: 'درجة الخزنة السيبرانية',
    verdictFindings: (verdict, findings) => `${verdict} / ${findings} نتيجة`,
    vaultsAvailable: (count) => `${count} خزنة متاحة`,

    actionsTitle: 'إجراءات الجاهزية السيادية',
    actionsDescription:
      'قيِّم امتثال استمرارية الأعمال (BCM)، ودوِّر المادة المفتاحية التي يملكها المستأجر، وقيِّم وضع الخزنة غير القابلة للتعديل.',
    selectedGroup: 'المجموعة المحدّدة',
    bcmPack: 'حزمة BCM',
    vault: 'الخزنة',
    assessBcmPack: 'تقييم حزمة BCM',
    assessLoading: 'جارٍ التقييم',
    packVersion: (standard, version) => `${standard} ${version}`,
    rotateByokKey: 'تدوير مفتاح BYOK',
    rotateLoading: 'جارٍ التدوير',
    currentKey: (version, state) => `المفتاح الحالي الإصدار ${version} / ${state}`,
    createFirstKey: 'أنشئ أول إصدار مفتاح نشط',
    evaluateCyberVault: 'تقييم الخزنة السيبرانية',
    evaluateLoading: 'جارٍ التقييم',
    vaultProvider: (name, provider) => `${name} / ${provider}`,
    noVaultId: 'لا توجد خزنة ذات معرّف متاحة',
    reasonSelectGroup: 'اختَر مجموعة اتّساق',
    reasonNoBcmPack: 'لا توجد حزمة BCM متاحة',
    reasonPackReady: (standard) => `${standard} جاهزة`,

    gatesTitle: 'بوابات الجاهزية',
    gatesDescription:
      'المتطلّبات التشغيلية المسبقة التي تدعم أزرار الإجراءات وجاهزية حزمة الهيئة المنظِّمة.',
    gateGroupScope: 'تم تحديد نطاق المجموعة',
    gateGroupScopeReady: (group) => `تنطبق الإجراءات على ${group}.`,
    gateGroupScopePending: 'اختَر مجموعة اتّساق للتعافي من الكوارث قبل تشغيل تقييم BCM.',
    gateBcmCurrent: 'تقييم BCM محدّث',
    gateBcmCurrentReady: (score, standard) => `${score}% مقابل ${standard}.`,
    gateBcmCurrentPending: 'شغِّل تقييم حزمة BCM لإنتاج درجة ضوابط.',
    gateByokCustody: 'حيازة BYOK نشطة',
    gateByokCustodyReady: (count, status) => `${count} مفتاح نشط بسلسلة ${status}.`,
    gateByokCustodyPending: 'دوِّر مفتاح BYOK نشطًا أو سجِّله.',
    gateVaultPosture: 'وضع الخزنة السيبرانية',
    gateVaultPostureReady: (score, verdict, name) => `وضع ${verdict} بنسبة ${score}% للخزنة ${name}.`,
    gateVaultPosturePending: () => 'قيِّم خزنة لتسجيل وضع الاسترداد غير القابل للتعديل.',
    selectedVaultFallback: 'الخزنة المحدّدة',

    bcmTitle: 'تقييم حزمة BCM',
    bcmDescription: 'حزمة الامتثال المحدّدة وأحدث نتيجة تقييم والفجوات الأعلى أولوية.',
    bcmCompliant: 'ممتثل',
    bcmReviewGaps: 'راجع الفجوات',
    bcmNotAssessed: 'لم يُقيَّم',
    selectedBcmPack: 'حزمة BCM المحدّدة',
    packAuthority: (authority, standard, version) => `${authority} / ${standard} ${version}`,
    controlsBadge: (count) => `${count} ضابط`,
    noBcmPacks: 'لم تُرجَع حِزم BCM.',
    additionalPacksHidden: (count) => `${count} حزمة إضافية مخفيّة.`,
    colScore: 'الدرجة',
    colSatisfied: 'مُستوفى',
    colPartial: 'جزئي',
    colFailed: 'فاشل',
    controlCoverage: 'تغطية الضوابط',
    noAssessmentLoaded: 'لم يُحمَّل بعد أي نتيجة تقييم BCM.',
    mandatory: 'إلزامي',
    noControlGaps: 'لم تُرجَع فجوات ضوابط BCM.',
    selectPackForGaps: 'اختَر حزمة BCM لفحص فجوات الضوابط.',
    additionalGapsHidden: (count) => `${count} فجوة إضافية مخفيّة.`,

    byokTitle: 'سلسلة حيازة BYOK',
    byokDescription: 'إصدار المفتاح الحالي وسلامة السلسلة وجذر ميركل وأحدث أحداث الحيازة.',
    chainIntact: 'السلسلة سليمة',
    chainBroken: 'السلسلة مكسورة',
    notVerified: 'لم يُتحقَّق منها',
    latestKey: 'أحدث مفتاح',
    provider: 'المزوّد',
    activeKeys: 'المفاتيح النشطة',
    custodySeq: 'تسلسل الحيازة',
    keyReference: 'مرجع المفتاح',
    merkleRoot: 'جذر ميركل',
    noByokKeys: 'لم تُرجَع مفاتيح BYOK.',
    colSeq: 'التسلسل',
    colAction: 'الإجراء',
    colVersion: 'الإصدار',
    colHash: 'التجزئة',
    colCreated: 'تاريخ الإنشاء',
    noCustodyEntries: 'لم تُرجَع قيود سجل حيازة.',
    custodyEvent: 'حدث حيازة',

    vaultTitle: 'أدلة الخزنة السيبرانية',
    vaultDescription: 'اختيار الخزنة وتقييم الوضع المخزَّن وأدلة المعالجة الحالية.',
    noVaults: 'لم تُرجَع خزائن سيبرانية.',
    selectedGroupTag: 'المجموعة المحدّدة',
    unscoped: 'غير محدّد النطاق',
    regionNa: 'المنطقة غير متاحة',
    flagImmutable: 'غير قابلة للتعديل',
    flagVaultLock: 'قفل الخزنة',
    flagCmk: 'مفتاح يديره العميل (CMK)',
    flagBreakGlassMfa: 'المصادقة متعددة العوامل (MFA) للوصول الطارئ',
    flagOn: 'مُفعَّل',
    flagOff: 'مُعطَّل',
    colVerdict: 'الحكم',
    colControls: 'الضوابط',
    colEvaluated: 'تاريخ التقييم',
    recentVaultFindings: 'أحدث نتائج الخزنة',
    findingsBadge: (count) => `${count} نتيجة`,
    noVaultFindings: 'لم تُرجَع نتائج للخزنة السيبرانية للتقييم المحدّد.',
    additionalFindingsHidden: (count) => `${count} نتيجة إضافية مخفيّة.`,
  },
};

export function useSovereignActionsLabels(): SovereignActionsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(sovereignActionsLabels, locale), [locale]);
}
