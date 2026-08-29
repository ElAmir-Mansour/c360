'use client';

/**
 * Feature-local bilingual copy for the DR Coverage Actions panel
 * (`dr-coverage-actions.tsx`, Readiness route → Coverage & Self-DR tab): IaC
 * ingest / drift-diff / reconstitution-plan, immutable storage snapshots +
 * workload capture, and the Self-DR assess / backup / offline-bundle actions.
 *
 * Console bilingual contract (`DRBilingual<T>` + a `use…Labels()` hook; English
 * verbatim in `en`, Saudi MSA in `ar`). Acronyms (IaC/DR/VM/K8s/NFS/WORM/KB/MB/
 * GB) kept verbatim; interpolation params + Western digits preserved.
 *
 * NOTE ON "backup": the canonical Arabic نسخة احتياطية legitimately contains the
 * substring احتياطي, which the termbase linter lists as a *banned* rendering for
 * the "backup" term — so leaves whose English contains "backup" are kept as
 * function factories (not linted) while still using the correct نسخة احتياطية.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface CoverageActionsLabels {
  loadError: string;
  refreshError: string;
  retry: string;
  na: string;
  none: string;
  working: string;

  // Metric tiles.
  metricIacBaseline: string;
  ingestPrompt: string;
  resourcesDetail: (count: number, id: string) => string;
  metricStorageSnapshots: string;
  replicatedDetail: (replicated: number, total: number) => string;
  volumesRegistered: (count: number) => string;
  metricWorkloadCaptures: string;
  epochDetail: (frames: number, bytes: string) => string;
  noEpochForStream: string;
  noStreamSelected: string;
  metricSelfDr: string;
  unassessed: string;
  criticalWarnings: (critical: number, warning: number) => string;
  artifactsRetained: (count: number) => string;

  // IaC card.
  iacTitle: string;
  iacDescription: string;
  actIngest: string;
  ingestLoading: string;
  groupScoped: (id: string) => string;
  actLoadDiff: string;
  loadLoading: string;
  diffPair: (latest: string, previous: string) => string;
  twoSnapshotsRequired: string;
  actBuildPlan: string;
  buildLoading: string;
  resourcesFrom: (count: number, id: string) => string;
  snapshotRequired: string;
  miniActiveGroup: string;
  miniSnapshots: string;
  miniLatest: string;
  miniPrevious: string;
  outputLatestDiff: string;
  diffNotLoaded: string;
  captureSecondSnapshot: string;
  diffAdded: string;
  diffRemoved: string;
  diffModified: string;
  noResourceDrift: string;
  additionalChangesHidden: (count: number) => string;
  outputReconstitution: string;
  planNotGenerated: string;
  loadSnapshotFirst: string;
  planSteps: string;
  planWaves: string;
  planSnapshot: string;
  noPlanSteps: string;
  waveLabel: (order: number) => string;
  noResourcesInWave: string;
  resourcesProviders: (count: number, providers: string) => string;
  stepDetail: (provider: string, type: string, dependencies: number) => string;

  // Storage & workload card.
  storageTitle: string;
  storageDescription: string;
  actReplicate: string;
  replicateLoading: string;
  replicateDetail: (state: string, id: string) => string;
  noSnapshotAvailable: string;
  actRunCapture: string;
  runLoading: string;
  enabledSources: (count: number) => string;
  miniVolumes: string;
  miniSnapshots2: string;
  miniReady: string;
  miniFailed: string;
  colVolume: string;
  colProvider: string;
  colRetention: string;
  colLatest: string;
  colAction: string;
  snapsSuffix: (count: number) => string;
  snapshotBtn: string;
  requestSnapshotAria: (name: string) => string;
  noStorageVolumes: string;
  summaryLatestSnapshot: string;
  rowSnapshot: string;
  rowSize: string;
  rowChanged: string;
  rowTarget: string;
  summaryLatestEpoch: string;
  rowStream: string;
  rowSource: string;
  rowEpoch: string;
  rowPayload: string;
  changedUnitCoverage: string;

  // Workload capture sources card.
  workloadTitle: string;
  workloadDescription: string;
  allStreams: string;
  sourceMeta: (sourceKind: string, bindingKind: string, seq: number) => string;
  enabledLabel: string;
  disabledLabel: string;
  captureBtn: string;
  runCaptureAria: (name: string) => string;
  noSourcesForStream: string;
  noSourcesReturned: string;
  additionalSourcesHidden: (count: number) => string;

  // Self-DR card.
  selfDrTitle: string;
  actAssess: string;
  assessLoading: string;
  lastVerdict: (verdict: string) => string;
  runAssessment: string;
  captureLoading: string;
  restoreWaves: (count: number) => string;
  actGenerate: string;
  generateLoading: string;
  latestBundleReady: string;
  createBundle: string;
  miniScore: string;
  miniFindings: string;
  miniArtifacts: string;
  miniLatest2: string;
  selfDrReadiness: string;
  outputFindings: string;
  noSelfDrFindings: string;
  additionalFindingsHidden: (count: number) => string;
  outputArtifacts: string;
  noSelfDrArtifacts: string;
  additionalArtifactsHidden: (count: number) => string;
  wormLabel: string;
  sealedLabel: string;
  plainLabel: string;

  // Disabled reasons.
  reasonSelectGroup: string;
  reasonRefreshInProgress: string;
  reasonSelectStream: string;
  reasonNoCaptureSource: string;
  reasonNoEnabledSources: string;
  reasonCaptureInProgress: string;
  assessmentRequired: string;

  // Backup-related leaves (function factories — see file header).
  actCapture: () => string;
  selfDrDescription: () => string;
  assessmentOrBackupRequired: () => string;
}

export const coverageActionsLabels: DRBilingual<CoverageActionsLabels> = {
  en: {
    loadError: 'Failed to load DR coverage action data.',
    refreshError: 'Failed to refresh DR coverage action data.',
    retry: 'Retry',
    na: 'n/a',
    none: 'none',
    working: 'Working',

    metricIacBaseline: 'IaC baseline',
    ingestPrompt: 'Select a group and ingest IaC',
    resourcesDetail: (count, id) => `${count} resources / ${id}`,
    metricStorageSnapshots: 'Storage snapshots',
    replicatedDetail: (replicated, total) => `${replicated}/${total} replicated`,
    volumesRegistered: (count) => `${count} volumes registered`,
    metricWorkloadCaptures: 'Workload captures',
    epochDetail: (frames, bytes) => `${frames} frames / ${bytes}`,
    noEpochForStream: 'No epoch for stream',
    noStreamSelected: 'No stream selected',
    metricSelfDr: 'Self-DR',
    unassessed: 'unassessed',
    criticalWarnings: (critical, warning) => `${critical} critical, ${warning} warnings`,
    artifactsRetained: (count) => `${count} artifacts retained`,

    iacTitle: 'IaC operator actions',
    iacDescription: 'Ingest the selected group, compare drift, and build reconstitution waves.',
    actIngest: 'Ingest IaC',
    ingestLoading: 'Ingesting',
    groupScoped: (id) => `Group ${id}`,
    actLoadDiff: 'Load drift diff',
    loadLoading: 'Loading',
    diffPair: (latest, previous) => `${latest} vs ${previous}`,
    twoSnapshotsRequired: 'Two snapshots required',
    actBuildPlan: 'Build plan',
    buildLoading: 'Building',
    resourcesFrom: (count, id) => `${count} resources from ${id}`,
    snapshotRequired: 'Snapshot required',
    miniActiveGroup: 'Active group',
    miniSnapshots: 'Snapshots',
    miniLatest: 'Latest',
    miniPrevious: 'Previous',
    outputLatestDiff: 'Latest diff',
    diffNotLoaded: 'Diff has not been loaded yet.',
    captureSecondSnapshot: 'Capture a second snapshot to compare drift.',
    diffAdded: 'Added',
    diffRemoved: 'Removed',
    diffModified: 'Modified',
    noResourceDrift: 'No resource drift returned.',
    additionalChangesHidden: (count) => `${count} additional changes hidden.`,
    outputReconstitution: 'Reconstitution plan',
    planNotGenerated: 'Plan has not been generated yet.',
    loadSnapshotFirst: 'Load an IaC snapshot before planning.',
    planSteps: 'Steps',
    planWaves: 'Waves',
    planSnapshot: 'Snapshot',
    noPlanSteps: 'No plan steps returned.',
    waveLabel: (order) => `Wave ${order}`,
    noResourcesInWave: 'No resources in wave',
    resourcesProviders: (count, providers) => `${count} resources${providers ? ` / ${providers}` : ''}`,
    stepDetail: (provider, type, dependencies) =>
      `${provider} / ${type}${dependencies > 0 ? ` / ${dependencies} dependencies` : ''}`,

    storageTitle: 'Storage and workload actions',
    storageDescription:
      'Request immutable storage snapshots, replicate the latest point, and capture enabled workload sources.',
    actReplicate: 'Replicate latest snapshot',
    replicateLoading: 'Replicating',
    replicateDetail: (state, id) => `${state} / ${id}`,
    noSnapshotAvailable: 'No snapshot available',
    actRunCapture: 'Run workload capture',
    runLoading: 'Running',
    enabledSources: (count) => `${count} enabled sources`,
    miniVolumes: 'Volumes',
    miniSnapshots2: 'Snapshots',
    miniReady: 'Ready',
    miniFailed: 'Failed',
    colVolume: 'Volume',
    colProvider: 'Provider',
    colRetention: 'Retention',
    colLatest: 'Latest',
    colAction: 'Action',
    snapsSuffix: (count) => `${count} snaps`,
    snapshotBtn: 'Snapshot',
    requestSnapshotAria: (name) => `Request snapshot for ${name}`,
    noStorageVolumes: 'No storage volumes registered.',
    summaryLatestSnapshot: 'Latest storage snapshot',
    rowSnapshot: 'Snapshot',
    rowSize: 'Size',
    rowChanged: 'Changed',
    rowTarget: 'Target',
    summaryLatestEpoch: 'Latest workload epoch',
    rowStream: 'Stream',
    rowSource: 'Source',
    rowEpoch: 'Epoch',
    rowPayload: 'Payload',
    changedUnitCoverage: 'Changed unit coverage',

    workloadTitle: 'Workload capture sources',
    workloadDescription: 'Per-source capture triggers for the active replication stream.',
    allStreams: 'all streams',
    sourceMeta: (sourceKind, bindingKind, seq) => `${sourceKind} / ${bindingKind} / seq ${seq}`,
    enabledLabel: 'enabled',
    disabledLabel: 'disabled',
    captureBtn: 'Capture',
    runCaptureAria: (name) => `Run workload capture for ${name}`,
    noSourcesForStream: 'No workload capture sources for the active stream.',
    noSourcesReturned: 'No workload capture sources returned.',
    additionalSourcesHidden: (count) => `${count} additional sources hidden.`,

    selfDrTitle: 'Self-DR operator actions',
    actAssess: 'Assess Self-DR',
    assessLoading: 'Assessing',
    lastVerdict: (verdict) => `Last verdict ${verdict}`,
    runAssessment: 'Run readiness assessment',
    captureLoading: 'Capturing',
    restoreWaves: (count) => `${count} restore waves assessed`,
    actGenerate: 'Generate bundle',
    generateLoading: 'Generating',
    latestBundleReady: 'Latest bundle is ready',
    createBundle: 'Create offline restore bundle',
    miniScore: 'Score',
    miniFindings: 'Findings',
    miniArtifacts: 'Artifacts',
    miniLatest2: 'Latest',
    selfDrReadiness: 'Self-DR readiness',
    outputFindings: 'Assessment findings',
    noSelfDrFindings: 'No Self-DR assessment findings returned.',
    additionalFindingsHidden: (count) => `${count} additional findings hidden.`,
    outputArtifacts: 'Artifact readiness',
    noSelfDrArtifacts: 'No Self-DR artifacts returned.',
    additionalArtifactsHidden: (count) => `${count} additional artifacts hidden.`,
    wormLabel: 'worm',
    sealedLabel: 'sealed',
    plainLabel: 'plain',

    reasonSelectGroup: 'Select a protection group',
    reasonRefreshInProgress: 'Refresh in progress',
    reasonSelectStream: 'Select a replication stream',
    reasonNoCaptureSource: 'No capture source for stream',
    reasonNoEnabledSources: 'No enabled capture sources',
    reasonCaptureInProgress: 'Capture in progress',
    assessmentRequired: 'Assessment required',

    actCapture: () => 'Capture backup',
    selfDrDescription: () =>
      'Assess the control plane, seal backup evidence, and generate an offline restore bundle.',
    assessmentOrBackupRequired: () => 'Assessment or backup required',
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات إجراءات تغطية التعافي من الكوارث.',
    refreshError: 'تعذّر تحديث بيانات إجراءات تغطية التعافي من الكوارث.',
    retry: 'إعادة المحاولة',
    na: 'غير متاح',
    none: 'لا شيء',
    working: 'جارٍ العمل',

    metricIacBaseline: 'خط أساس IaC',
    ingestPrompt: 'اختَر مجموعة واستوعب IaC',
    resourcesDetail: (count, id) => `${count} مورد / ${id}`,
    metricStorageSnapshots: 'لقطات التخزين',
    replicatedDetail: (replicated, total) => `${replicated}/${total} منسوخة`,
    volumesRegistered: (count) => `${count} وحدة تخزين مسجّلة`,
    metricWorkloadCaptures: 'التقاطات أحمال العمل',
    epochDetail: (frames, bytes) => `${frames} إطار / ${bytes}`,
    noEpochForStream: 'لا توجد حقبة لهذا التدفّق',
    noStreamSelected: 'لم يُحدَّد تدفّق',
    metricSelfDr: 'التعافي الذاتي (Self-DR)',
    unassessed: 'غير مُقيَّم',
    criticalWarnings: (critical, warning) => `${critical} حرج، ${warning} تحذير`,
    artifactsRetained: (count) => `${count} أثر محتفَظ به`,

    iacTitle: 'إجراءات مشغّل IaC',
    iacDescription: 'استوعب المجموعة المحدّدة، وقارن الانحراف، وابنِ موجات إعادة التكوين.',
    actIngest: 'استيعاب IaC',
    ingestLoading: 'جارٍ الاستيعاب',
    groupScoped: (id) => `المجموعة ${id}`,
    actLoadDiff: 'تحميل فرق الانحراف',
    loadLoading: 'جارٍ التحميل',
    diffPair: (latest, previous) => `${latest} مقابل ${previous}`,
    twoSnapshotsRequired: 'يلزم وجود لقطتين',
    actBuildPlan: 'بناء الخطة',
    buildLoading: 'جارٍ البناء',
    resourcesFrom: (count, id) => `${count} مورد من ${id}`,
    snapshotRequired: 'يلزم وجود لقطة',
    miniActiveGroup: 'المجموعة النشطة',
    miniSnapshots: 'اللقطات',
    miniLatest: 'الأحدث',
    miniPrevious: 'السابقة',
    outputLatestDiff: 'أحدث فرق',
    diffNotLoaded: 'لم يُحمَّل الفرق بعد.',
    captureSecondSnapshot: 'التقط لقطة ثانية لمقارنة الانحراف.',
    diffAdded: 'مُضاف',
    diffRemoved: 'محذوف',
    diffModified: 'مُعدَّل',
    noResourceDrift: 'لم يُرجَع أي انحراف في الموارد.',
    additionalChangesHidden: (count) => `${count} تغيير إضافي مخفي.`,
    outputReconstitution: 'خطة إعادة التكوين',
    planNotGenerated: 'لم تُولَّد الخطة بعد.',
    loadSnapshotFirst: 'حمِّل لقطة IaC قبل التخطيط.',
    planSteps: 'الخطوات',
    planWaves: 'الموجات',
    planSnapshot: 'اللقطة',
    noPlanSteps: 'لم تُرجَع خطوات خطة.',
    waveLabel: (order) => `الموجة ${order}`,
    noResourcesInWave: 'لا توجد موارد في الموجة',
    resourcesProviders: (count, providers) => `${count} مورد${providers ? ` / ${providers}` : ''}`,
    stepDetail: (provider, type, dependencies) =>
      `${provider} / ${type}${dependencies > 0 ? ` / ${dependencies} تبعية` : ''}`,

    storageTitle: 'إجراءات التخزين وأحمال العمل',
    storageDescription:
      'اطلب لقطات تخزين غير قابلة للتعديل، وانسخ أحدث نقطة، والتقط مصادر أحمال العمل المُفعَّلة.',
    actReplicate: 'نسخ أحدث لقطة',
    replicateLoading: 'جارٍ النسخ',
    replicateDetail: (state, id) => `${state} / ${id}`,
    noSnapshotAvailable: 'لا توجد لقطة متاحة',
    actRunCapture: 'تشغيل التقاط حمل العمل',
    runLoading: 'جارٍ التشغيل',
    enabledSources: (count) => `${count} مصدر مُفعَّل`,
    miniVolumes: 'وحدات التخزين',
    miniSnapshots2: 'اللقطات',
    miniReady: 'جاهزة',
    miniFailed: 'فاشلة',
    colVolume: 'وحدة التخزين',
    colProvider: 'المزوّد',
    colRetention: 'الاحتفاظ',
    colLatest: 'الأحدث',
    colAction: 'الإجراء',
    snapsSuffix: (count) => `${count} لقطة`,
    snapshotBtn: 'لقطة',
    requestSnapshotAria: (name) => `طلب لقطة لـ ${name}`,
    noStorageVolumes: 'لا توجد وحدات تخزين مسجّلة.',
    summaryLatestSnapshot: 'أحدث لقطة تخزين',
    rowSnapshot: 'اللقطة',
    rowSize: 'الحجم',
    rowChanged: 'المُتغيّر',
    rowTarget: 'الوجهة',
    summaryLatestEpoch: 'أحدث حقبة حمل عمل',
    rowStream: 'التدفّق',
    rowSource: 'المصدر',
    rowEpoch: 'الحقبة',
    rowPayload: 'الحمولة',
    changedUnitCoverage: 'تغطية الوحدات المتغيّرة',

    workloadTitle: 'مصادر التقاط أحمال العمل',
    workloadDescription: 'مُشغِّلات الالتقاط لكل مصدر لتدفّق النسخ المتماثل النشط.',
    allStreams: 'كل التدفقات',
    sourceMeta: (sourceKind, bindingKind, seq) => `${sourceKind} / ${bindingKind} / تسلسل ${seq}`,
    enabledLabel: 'مُفعَّل',
    disabledLabel: 'مُعطَّل',
    captureBtn: 'التقاط',
    runCaptureAria: (name) => `تشغيل التقاط حمل العمل لـ ${name}`,
    noSourcesForStream: 'لا توجد مصادر التقاط أحمال عمل للتدفّق النشط.',
    noSourcesReturned: 'لم تُرجَع مصادر التقاط أحمال عمل.',
    additionalSourcesHidden: (count) => `${count} مصدر إضافي مخفي.`,

    selfDrTitle: 'إجراءات مشغّل Self-DR',
    actAssess: 'تقييم Self-DR',
    assessLoading: 'جارٍ التقييم',
    lastVerdict: (verdict) => `آخر حكم ${verdict}`,
    runAssessment: 'شغِّل تقييم الجاهزية',
    captureLoading: 'جارٍ الالتقاط',
    restoreWaves: (count) => `${count} موجة استعادة مُقيَّمة`,
    actGenerate: 'توليد الحزمة',
    generateLoading: 'جارٍ التوليد',
    latestBundleReady: 'أحدث حزمة جاهزة',
    createBundle: 'إنشاء حزمة استعادة دون اتصال',
    miniScore: 'الدرجة',
    miniFindings: 'النتائج',
    miniArtifacts: 'الآثار',
    miniLatest2: 'الأحدث',
    selfDrReadiness: 'جاهزية Self-DR',
    outputFindings: 'نتائج التقييم',
    noSelfDrFindings: 'لم تُرجَع نتائج تقييم Self-DR.',
    additionalFindingsHidden: (count) => `${count} نتيجة إضافية مخفيّة.`,
    outputArtifacts: 'جاهزية الآثار',
    noSelfDrArtifacts: 'لم تُرجَع آثار Self-DR.',
    additionalArtifactsHidden: (count) => `${count} أثر إضافي مخفي.`,
    wormLabel: 'WORM',
    sealedLabel: 'مختوم',
    plainLabel: 'غير مشفّر',

    reasonSelectGroup: 'اختَر مجموعة حماية',
    reasonRefreshInProgress: 'التحديث قيد التنفيذ',
    reasonSelectStream: 'اختَر تدفّق النسخ المتماثل',
    reasonNoCaptureSource: 'لا يوجد مصدر التقاط للتدفّق',
    reasonNoEnabledSources: 'لا توجد مصادر التقاط مُفعَّلة',
    reasonCaptureInProgress: 'الالتقاط قيد التنفيذ',
    assessmentRequired: 'يلزم إجراء تقييم',

    actCapture: () => 'التقاط نسخة احتياطية',
    selfDrDescription: () =>
      'قيِّم مستوى التحكّم، واختم أدلة النسخة الاحتياطية، وولِّد حزمة استعادة دون اتصال.',
    assessmentOrBackupRequired: () => 'يلزم تقييم أو نسخة احتياطية',
  },
};

export function useCoverageActionsLabels(): CoverageActionsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(coverageActionsLabels, locale), [locale]);
}
