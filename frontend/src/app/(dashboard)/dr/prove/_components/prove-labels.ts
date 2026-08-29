/**
 * Feature-local bilingual copy for the Prove overview surface and its panels that
 * own inline strings (the page chrome, the post-implementation review picker, the
 * evidence-operations posture/library panel, and the BCM assessment panel).
 *
 * Kept local to the Prove feature per the console's i18n contract, but adopting
 * the foundation's bilingual bundle shape: each label group is a
 * `DRBilingual<T>` holding two full, identically-shaped copies (English +
 * professional MSA). Components resolve the active locale via the hooks exported
 * here (defaulting to English under the test `en` LocaleProvider) and read the
 * resolved object exactly as before.
 */

'use client';

import { useMemo } from 'react';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

// ---------------------------------------------------------------------------
// Prove page chrome.
// ---------------------------------------------------------------------------

export interface ProvePageLabels {
  title: string;
  description: string;
  ledgerExplorerCta: string;
  complianceBoardCta: string;
  attestationLedgerHeading: string;
  openLedgerExplorerCta: string;
  ledgerLoadError: string;
  anchorWriteGateDescription: string;
  bcmWriteGateDescription: string;
  runsLoadError: string;
  unavailableNotice: string;
}

export const provePageLabels: DRBilingual<ProvePageLabels> = {
  en: {
    title: 'Prove',
    description:
      'Demonstrate that recovery happened and that the evidence is tamper-evident: inspect the hash-chained attestation ledger, fetch inclusion proofs, anchor checkpoints to WORM storage, assess BCM compliance, and review completed recovery runs.',
    ledgerExplorerCta: 'Ledger explorer',
    complianceBoardCta: 'Compliance board',
    attestationLedgerHeading: 'Attestation ledger',
    openLedgerExplorerCta: 'Open ledger explorer',
    ledgerLoadError: 'Failed to load the DR attestation ledger.',
    anchorWriteGateDescription:
      'Anchoring ledger checkpoints to WORM storage requires the dr:write permission. You can still inspect the ledger, verification status, and inclusion proofs below.',
    bcmWriteGateDescription:
      'Running a BCM compliance assessment requires the dr:write permission. The published packs and the latest assessment result remain visible.',
    runsLoadError: 'Failed to load recovery runs for review.',
    unavailableNotice:
      'Attestation data is currently unavailable. Recovery evidence will appear here as runs are sealed and attested.',
  },
  ar: {
    title: 'الإثبات',
    description:
      'أثبِت أن الاسترداد قد حدث وأن الأدلة مُحصَّنة ضد العبث: افحص سجل الإثبات المترابط بالتجزئة، واجلب أدلة الإدراج، واربط نقاط التحقق بتخزين WORM، وقيّم امتثال إدارة استمرارية الأعمال (BCM)، وراجِع عمليات الاسترداد المكتملة.',
    ledgerExplorerCta: 'مستكشف السجل',
    complianceBoardCta: 'لوحة الامتثال',
    attestationLedgerHeading: 'سجل الإثبات',
    openLedgerExplorerCta: 'فتح مستكشف السجل',
    ledgerLoadError: 'تعذّر تحميل سجل إثبات التعافي من الكوارث.',
    anchorWriteGateDescription:
      'يتطلب ربط نقاط تحقق السجل بتخزين WORM صلاحية dr:write. لا يزال بإمكانك فحص السجل وحالة التحقق وأدلة الإدراج أدناه.',
    bcmWriteGateDescription:
      'يتطلب تشغيل تقييم امتثال إدارة استمرارية الأعمال (BCM) صلاحية dr:write. تظل الحزم المنشورة وأحدث نتيجة تقييم مرئية.',
    runsLoadError: 'تعذّر تحميل عمليات الاسترداد للمراجعة.',
    unavailableNotice:
      'بيانات الإثبات غير متاحة حاليًا. ستظهر أدلة الاسترداد هنا عند ختم العمليات وإثباتها.',
  },
};

export function useProvePageLabels(): ProvePageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(provePageLabels, locale), [locale]);
}

// ---------------------------------------------------------------------------
// Post-implementation review (PIR) picker + chrome.
// ---------------------------------------------------------------------------

export interface PIRReviewLabels {
  panelTitle: string;
  emptyDescription: string;
  emptyNotice: string;
  selectDescription: string;
  runSelectLabel: string;
  runSelectPlaceholder: string;
  stepsLoadError: string;
  /** Backend step-name -> human label. Keyed by the backend step token. */
  stepLabels: Record<string, string>;
  /** Gate-2 approval detail line; `{approver}` is interpolated. */
  signedOffBy: (approver: string) => string;
}

export const pirReviewLabels: DRBilingual<PIRReviewLabels> = {
  en: {
    panelTitle: 'Post-implementation review',
    emptyDescription:
      'Once a failover drill or live recovery reaches a terminal state, select it here to review the four-gate outcome, RTO/RPO objectives vs achieved, and the execution timeline.',
    emptyNotice: 'No terminal recovery runs to review yet.',
    selectDescription:
      'Select a terminal recovery run to review its objectives, four-gate outcome, and execution timeline against the sealed attestation.',
    runSelectLabel: 'Recovery run',
    runSelectPlaceholder: 'Select a recovery run',
    stepsLoadError: "Failed to load the recovery run's execution steps.",
    stepLabels: {
      'quiesce.final_sync': 'Quiesce — final sync',
      'gate1.validate': 'Gate 1 — validate recovery point',
      'gate2.approved': 'Gate 2 — approval recorded',
      'gate3.execute': 'Gate 3 — execute boot order',
      'gate3.health': 'Gate 3 — health verification',
      'gate4.attest': 'Gate 4 — seal attestation',
      teardown: 'Teardown — isolated environment',
    },
    signedOffBy: (approver: string) => `Signed off by ${approver}`,
  },
  ar: {
    panelTitle: 'مراجعة ما بعد التنفيذ',
    emptyDescription:
      'بمجرد أن يصل تمرين تجاوز الفشل أو الاسترداد الفعلي إلى حالة نهائية، اختره هنا لمراجعة نتيجة البوابات الأربع، وأهداف هدف زمن الاسترداد (RTO)/نقطة الاسترداد (RPO) مقابل المُحقَّق، والخط الزمني للتنفيذ.',
    emptyNotice: 'لا توجد عمليات استرداد نهائية للمراجعة بعد.',
    selectDescription:
      'اختر عملية استرداد نهائية لمراجعة أهدافها ونتيجة البوابات الأربع والخط الزمني للتنفيذ مقابل الإثبات المختوم.',
    runSelectLabel: 'عملية الاسترداد',
    runSelectPlaceholder: 'اختر عملية استرداد',
    stepsLoadError: 'تعذّر تحميل خطوات تنفيذ عملية الاسترداد.',
    stepLabels: {
      'quiesce.final_sync': 'الإيقاف المؤقت — المزامنة النهائية',
      'gate1.validate': 'البوابة 1 — التحقق من نقطة الاسترداد',
      'gate2.approved': 'البوابة 2 — تسجيل الموافقة',
      'gate3.execute': 'البوابة 3 — تنفيذ ترتيب الإقلاع',
      'gate3.health': 'البوابة 3 — التحقق من السلامة',
      'gate4.attest': 'البوابة 4 — ختم الإثبات',
      teardown: 'التفكيك — البيئة المعزولة',
    },
    signedOffBy: (approver: string) => `اعتمدها ${approver}`,
  },
};

export function usePIRReviewLabels(): PIRReviewLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(pirReviewLabels, locale), [locale]);
}

// ---------------------------------------------------------------------------
// Evidence operations (posture + library) panel.
// ---------------------------------------------------------------------------

export interface EvidenceOperationsLabels {
  loadError: string;
  postureTitle: string;
  postureDescription: string;
  metricReports: string;
  metricWormLocked: string;
  metricHashChain: string;
  metricRecency: string;
  latestAttestation: string;
  noAttestation: string;
  miniRtoActual: string;
  miniRpo: string;
  miniCreated: string;
  miniHash: string;
  noRef: string;
  libraryTitle: string;
  libraryDescription: string;
  colReport: string;
  colGroup: string;
  colType: string;
  colResult: string;
  colHash: string;
  colGenerated: string;
  noReports: string;
  indexedEvidence: string;
  /** Recency formatting. */
  today: string;
  daysSuffix: (days: number) => string;
  notAvailable: string;
  /** Health/status token -> display label (lower-cased token key). */
  healthLabels: Record<string, string>;
  /** Derived control-name token (from buildEvidenceSummary) -> display label. */
  controlLabels: Record<string, string>;
}

export const evidenceOperationsLabels: DRBilingual<EvidenceOperationsLabels> = {
  en: {
    loadError: 'Failed to load DR evidence summary.',
    postureTitle: 'Evidence posture',
    postureDescription: 'Immutable reports and hash-chain readiness for regulator review.',
    metricReports: 'Reports',
    metricWormLocked: 'WORM locked',
    metricHashChain: 'Hash chain',
    metricRecency: 'Recency',
    latestAttestation: 'Latest attestation',
    noAttestation: 'No attestation',
    miniRtoActual: 'RTO actual',
    miniRpo: 'RPO',
    miniCreated: 'Created',
    miniHash: 'Hash',
    noRef: 'no ref',
    libraryTitle: 'Evidence library',
    libraryDescription: 'Gate-4 attestations, drill proofs, object keys, and framework coverage.',
    colReport: 'Report',
    colGroup: 'Group',
    colType: 'Type',
    colResult: 'Result',
    colHash: 'Hash',
    colGenerated: 'Generated',
    noReports: 'No evidence reports returned.',
    indexedEvidence: 'indexed evidence',
    today: 'today',
    daysSuffix: (days: number) => `${days}d`,
    notAvailable: 'n/a',
    healthLabels: {
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
      attested: 'Attested',
    },
    controlLabels: {
      'Gate-4 attestation ledger': 'Gate-4 attestation ledger',
      'Hash-chain continuity': 'Hash-chain continuity',
      'Immutable evidence retention': 'Immutable evidence retention',
    },
  },
  ar: {
    loadError: 'تعذّر تحميل ملخص أدلة التعافي من الكوارث.',
    postureTitle: 'وضع الأدلة',
    postureDescription: 'تقارير غير قابلة للتغيير وجاهزية سلسلة التجزئة لمراجعة الجهة التنظيمية.',
    metricReports: 'التقارير',
    metricWormLocked: 'مقفلة على WORM',
    metricHashChain: 'سلسلة التجزئة',
    metricRecency: 'الحداثة',
    latestAttestation: 'أحدث إثبات',
    noAttestation: 'لا يوجد إثبات',
    miniRtoActual: 'زمن الاسترداد الفعلي',
    miniRpo: 'نقطة الاسترداد (RPO)',
    miniCreated: 'تاريخ الإنشاء',
    miniHash: 'التجزئة',
    noRef: 'لا يوجد مرجع',
    libraryTitle: 'مكتبة الأدلة',
    libraryDescription:
      'إثباتات البوابة الرابعة، وأدلة التمارين، ومفاتيح الكائنات، وتغطية الأُطر.',
    colReport: 'التقرير',
    colGroup: 'المجموعة',
    colType: 'النوع',
    colResult: 'النتيجة',
    colHash: 'التجزئة',
    colGenerated: 'تاريخ الإنشاء',
    noReports: 'لم تُرجَع أي تقارير أدلة.',
    indexedEvidence: 'أدلة مفهرسة',
    today: 'اليوم',
    daysSuffix: (days: number) => `${days} يوم`,
    notAvailable: 'غير متاح',
    healthLabels: {
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
      attested: 'مُثبَت',
    },
    controlLabels: {
      'Gate-4 attestation ledger': 'سجل إثبات البوابة الرابعة',
      'Hash-chain continuity': 'استمرارية سلسلة التجزئة',
      'Immutable evidence retention': 'الاحتفاظ بالأدلة غير القابلة للتغيير',
    },
  },
};

export function useEvidenceOperationsLabels(): EvidenceOperationsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(evidenceOperationsLabels, locale), [locale]);
}

// ---------------------------------------------------------------------------
// BCM assessment panel.
// ---------------------------------------------------------------------------

export interface BCMAssessmentLabels {
  noWriteTooltip: string;
  noGroupTooltip: string;
  packsLoadError: string;
  assessError: string;
  panelTitle: string;
  panelDescription: string;
  assessing: string;
  assessCta: string;
  packSelectLabel: string;
  noPacksAvailable: string;
  selectPack: string;
  noPackSelected: string;
  choosePack: string;
  targetPrefix: string;
  noGroup: string;
  runPrompt: string;
  metricPack: string;
  metricStandard: string;
  metricControls: string;
  metricEvaluated: string;
  weightedScore: string;
  compliant: string;
  gapsFound: string;
  satisfiedSuffix: string;
  partialSuffix: string;
  failedSuffix: string;
  controlVerdicts: string;
  mandatoryGaps: string;
  noControlResults: string;
  noMandatoryGaps: string;
  mandatoryTag: string;
  verdictSatisfied: string;
  verdictPartial: string;
  verdictFailed: string;
  notAvailable: string;
}

export const bcmAssessmentLabels: DRBilingual<BCMAssessmentLabels> = {
  en: {
    noWriteTooltip: 'Requires the dr:write permission',
    noGroupTooltip: 'Select a protection group to assess BCM compliance',
    packsLoadError: 'Failed to load BCM compliance packs.',
    assessError: 'Failed to assess BCM pack.',
    panelTitle: 'BCM compliance assessment',
    panelDescription:
      'Score the active protection group against a published business-continuity pack and capture the result as immutable evidence.',
    assessing: 'Assessing',
    assessCta: 'Assess BCM pack',
    packSelectLabel: 'Compliance pack',
    noPacksAvailable: 'No packs available',
    selectPack: 'Select a pack',
    noPackSelected: 'No pack selected',
    choosePack: 'Choose a published BCM pack to evaluate.',
    targetPrefix: 'Target',
    noGroup: 'no group',
    runPrompt:
      'Run an assessment to see the weighted compliance score, per-control verdicts, and any mandatory gaps.',
    metricPack: 'Pack',
    metricStandard: 'Standard',
    metricControls: 'Controls',
    metricEvaluated: 'Evaluated',
    weightedScore: 'Weighted compliance score',
    compliant: 'Compliant',
    gapsFound: 'Gaps found',
    satisfiedSuffix: 'satisfied',
    partialSuffix: 'partial',
    failedSuffix: 'failed',
    controlVerdicts: 'Control verdicts',
    mandatoryGaps: 'Mandatory gaps',
    noControlResults: 'No control results returned.',
    noMandatoryGaps: 'No mandatory gaps — the group satisfies every required control.',
    mandatoryTag: 'Mandatory',
    verdictSatisfied: 'Satisfied',
    verdictPartial: 'Partial',
    verdictFailed: 'Failed',
    notAvailable: 'n/a',
  },
  ar: {
    noWriteTooltip: 'يتطلب صلاحية dr:write',
    noGroupTooltip: 'اختر مجموعة حماية لتقييم امتثال إدارة استمرارية الأعمال (BCM)',
    packsLoadError: 'تعذّر تحميل حزم امتثال إدارة استمرارية الأعمال (BCM).',
    assessError: 'تعذّر تقييم حزمة BCM.',
    panelTitle: 'تقييم امتثال إدارة استمرارية الأعمال (BCM)',
    panelDescription:
      'سجّل مجموعة الحماية النشطة مقابل حزمة استمرارية أعمال منشورة، والتقط النتيجة كدليل غير قابل للتغيير.',
    assessing: 'جارٍ التقييم',
    assessCta: 'تقييم حزمة BCM',
    packSelectLabel: 'حزمة الامتثال',
    noPacksAvailable: 'لا توجد حزم متاحة',
    selectPack: 'اختر حزمة',
    noPackSelected: 'لم تُحدَّد حزمة',
    choosePack: 'اختر حزمة BCM منشورة للتقييم.',
    targetPrefix: 'الهدف',
    noGroup: 'لا توجد مجموعة',
    runPrompt:
      'شغّل تقييمًا لرؤية درجة الامتثال المرجَّحة، وأحكام كل ضابط، وأي ثغرات إلزامية.',
    metricPack: 'الحزمة',
    metricStandard: 'المعيار',
    metricControls: 'الضوابط',
    metricEvaluated: 'تاريخ التقييم',
    weightedScore: 'درجة الامتثال المرجَّحة',
    compliant: 'ممتثل',
    gapsFound: 'وُجِدت ثغرات',
    satisfiedSuffix: 'مستوفى',
    partialSuffix: 'جزئي',
    failedSuffix: 'فاشل',
    controlVerdicts: 'أحكام الضوابط',
    mandatoryGaps: 'الثغرات الإلزامية',
    noControlResults: 'لم تُرجَع أي نتائج ضوابط.',
    noMandatoryGaps: 'لا توجد ثغرات إلزامية — المجموعة تستوفي كل ضابط مطلوب.',
    mandatoryTag: 'إلزامي',
    verdictSatisfied: 'مستوفى',
    verdictPartial: 'جزئي',
    verdictFailed: 'فاشل',
    notAvailable: 'غير متاح',
  },
};

export function useBCMAssessmentLabels(): BCMAssessmentLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(bcmAssessmentLabels, locale), [locale]);
}
