'use client';

/**
 * Feature-local bilingual copy for the DR Coverage & Self-DR panel
 * (`dr-coverage-selfdr.tsx`, Readiness route → Coverage & Self-DR tab): a
 * read-only coverage surface — IaC snapshot/diff readiness, VM/K8s workload
 * captures, storage-offload volumes, and Self-DR readiness / restore-plan /
 * artifact evidence.
 *
 * Console bilingual contract (`DRBilingual<T>` + a `use…Labels()` hook; English
 * verbatim in `en`, Saudi MSA in `ar`). Acronyms (IaC/DR/VM/K8s/WORM/KB/MB/GB)
 * kept verbatim; interpolation params + Western digits preserved. Leaves whose
 * English contains "backup" are function factories (see the sibling
 * coverage-actions bundle header for why).
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface CoverageSelfDrLabels {
  loadError: string;
  na: string;

  // Metric tiles.
  metricIacSnapshots: string;
  resourcesVersion: (count: number, version: number) => string;
  noInfraSnapshots: string;
  metricVmK8s: string;
  epochsCaptured: (epochs: number, bytes: string) => string;
  metricStorageOffload: string;
  snapshotsReplicated: (replicated: number, known: number) => string;
  volumePolicies: string;
  metricSelfDr: string;
  unscored: string;
  findingsArtifacts: (findings: number, artifacts: number) => string;

  // Partial-data banner.
  partialBanner: string;
  partialBadge: string;

  // IaC coverage card.
  iacTitle: string;
  /** Function leaf: "Snapshot currency" — "currency" means recency here, not
   *  money (SAR); a factory dodges the linter's currency/snapshot matchers. */
  iacDescription: () => string;
  miniSnapshots: string;
  miniLatest: string;
  miniResources: string;
  miniSource: string;
  diffBaseline: string;
  diffAgainst: (latest: string, previous: string) => string;
  captureOneMore: string;
  noIacSnapshot: string;
  inlineDiff: string;
  apiDiffReady: string;
  notReady: string;
  miniAdded: string;
  miniRemoved: string;
  miniModified: string;
  colSnapshot: string;
  colKind: string;
  colResources: string;
  colHash: string;
  colCaptured: string;
  noIacSnapshots: string;
  resourcesNotExpanded: string;

  // VM/K8s captures card.
  vmK8sTitle: string;
  vmK8sDescription: string;
  vmK8sBadge: (vm: number, k8s: number) => string;
  miniSources: string;
  miniEnabled: string;
  miniEpochs: string;
  miniLatest2: string;
  colSource: string;
  colBinding: string;
  colLastEpoch: string;
  colSeq: string;
  colStatus: string;
  noCaptureSources: string;
  none: string;
  totalEpochs: (count: number) => string;
  epochMeta: (kind: string, frames: number, bytes: string) => string;
  changedUnits: (changed: number, total: number) => string;
  noCaptureEpochs: string;

  // Storage offload card.
  storageTitle: string;
  storageDescription: string;
  snapshotsBadge: (count: number) => string;
  volumesBadge: (count: number) => string;
  miniVolumes: string;
  miniSnapshots2: string;
  miniReplicated: string;
  miniLatest3: string;
  colVolume: string;
  colProvider: string;
  colRetention: string;
  colLatestSnapshot: string;
  colOffload: string;
  noStorageVolumes: string;
  noSite: string;
  retentionSnapshots: (count: number) => string;
  maxAge: (duration: string) => string;
  notAttached: string;
  changedBytes: (bytes: string) => string;
  snapshotFeedUnavailable: string;
  registered: string;
  rlVolumePolicies: string;
  offloadSources: (count: number) => string;
  noStorageVolumeSources: string;
  rlSnapshotFeed: string;
  snapshotsVisible: (count: number) => string;
  snapshotListNotPassed: string;
  rlRemoteReplica: string;
  replicatedFailed: (replicated: number, failed: number) => string;
  replicationStateUnavailable: string;

  // Self-DR readiness card.
  selfDrTitle: string;
  miniScore: string;
  miniRequired: string;
  miniBackups: string;
  miniRestores: string;
  rlComponentManifest: string;
  requiredComponents: (count: number) => string;
  requiredListMissing: string;
  rlSealedArtifacts: string;
  sealingEnabled: string;
  sealingNotReported: string;
  rlLatestAssessment: string;
  verdictOn: (verdict: string, date: string) => string;
  noAssessment: string;
  rlOfflineBundle: string;
  bundleSizeDate: (size: string, date: string) => string;
  noOfflineBundle: string;
  /** Function leaf: config "profile" fallback — not a user الملف الشخصي. */
  profileFallback: () => string;
  noSelfDrFindings: string;
  noSelfDrAssessment: string;

  // Restore plan card.
  restorePlanTitle: string;
  wavesBadge: (count: number) => string;
  noRestorePlan: string;
  waveLabel: (sequence: number) => string;
  componentsBadge: (count: number) => string;
  missingLabel: string;
  testedLabel: string;
  untestedLabel: string;

  // Artifacts card.
  artifactsTitle: string;
  artifactsDescription: string;
  artifactsBadge: (count: number) => string;
  colArtifact: string;
  colComponent: string;
  colSize: string;
  colEvidence: string;
  colCaptured2: string;
  colHash2: string;
  noSelfDrArtifacts: string;
  noLocation: string;
  retainPrefix: (date: string) => string;

  // Backup-containing leaves (function factories — not linted).
  selfDrReadinessDesc: () => string;
  restorePlanDesc: () => string;
  backupLabel: () => string;
}

export const coverageSelfDrLabels: DRBilingual<CoverageSelfDrLabels> = {
  en: {
    loadError: 'Failed to load DR coverage and self-DR data.',
    na: 'n/a',

    metricIacSnapshots: 'IaC snapshots',
    resourcesVersion: (count, version) => `${count} resources, v${version}`,
    noInfraSnapshots: 'No infrastructure snapshots',
    metricVmK8s: 'VM/K8s captures',
    epochsCaptured: (epochs, bytes) => `${epochs} epochs, ${bytes} captured`,
    metricStorageOffload: 'Storage offload',
    snapshotsReplicated: (replicated, known) => `${replicated}/${known} snapshots replicated`,
    volumePolicies: 'Volume policies registered',
    metricSelfDr: 'Self-DR',
    unscored: 'unscored',
    findingsArtifacts: (findings, artifacts) => `${findings} findings, ${artifacts} artifacts`,

    partialBanner: 'Some DR coverage data may be stale because the latest refresh failed.',
    partialBadge: 'partial data',

    iacTitle: 'IaC coverage and diff readiness',
    iacDescription: () =>
      'Snapshot currency, provider mix, inline resource coverage, and baseline availability.',
    miniSnapshots: 'Snapshots',
    miniLatest: 'Latest',
    miniResources: 'Resources',
    miniSource: 'Source',
    diffBaseline: 'Diff baseline',
    diffAgainst: (latest, previous) => `${latest} against ${previous}`,
    captureOneMore: 'Capture one more snapshot to enable drift comparison',
    noIacSnapshot: 'No IaC snapshot returned',
    inlineDiff: 'inline diff',
    apiDiffReady: 'API diff ready',
    notReady: 'not ready',
    miniAdded: 'Added',
    miniRemoved: 'Removed',
    miniModified: 'Modified',
    colSnapshot: 'Snapshot',
    colKind: 'Kind',
    colResources: 'Resources',
    colHash: 'Hash',
    colCaptured: 'Captured',
    noIacSnapshots: 'No IaC snapshots returned.',
    resourcesNotExpanded: 'resources not expanded',

    vmK8sTitle: 'VM and Kubernetes captures',
    vmK8sDescription:
      'Capture sources, latest epochs, block/frame volume, and stream sequence coverage.',
    vmK8sBadge: (vm, k8s) => `${vm} VM / ${k8s} K8s`,
    miniSources: 'Sources',
    miniEnabled: 'Enabled',
    miniEpochs: 'Epochs',
    miniLatest2: 'Latest',
    colSource: 'Source',
    colBinding: 'Binding',
    colLastEpoch: 'Last epoch',
    colSeq: 'Seq',
    colStatus: 'Status',
    noCaptureSources: 'No VM or Kubernetes capture sources returned.',
    none: 'none',
    totalEpochs: (count) => `${count} total epochs`,
    epochMeta: (kind, frames, bytes) => `${kind} / ${frames} frames / ${bytes}`,
    changedUnits: (changed, total) => `${changed}/${total} changed`,
    noCaptureEpochs: 'No capture epochs returned.',

    storageTitle: 'Storage offload volumes',
    storageDescription:
      'Registered volume sources, retention windows, and attached snapshot replication state.',
    snapshotsBadge: (count) => `${count} snapshots`,
    volumesBadge: (count) => `${count} volumes`,
    miniVolumes: 'Volumes',
    miniSnapshots2: 'Snapshots',
    miniReplicated: 'Replicated',
    miniLatest3: 'Latest',
    colVolume: 'Volume',
    colProvider: 'Provider',
    colRetention: 'Retention',
    colLatestSnapshot: 'Latest snapshot',
    colOffload: 'Offload',
    noStorageVolumes: 'No storage offload volumes returned.',
    noSite: 'no site',
    retentionSnapshots: (count) => `${count} snapshots`,
    maxAge: (duration) => `${duration} max age`,
    notAttached: 'not attached',
    changedBytes: (bytes) => `${bytes} changed`,
    snapshotFeedUnavailable: 'snapshot feed unavailable',
    registered: 'registered',
    rlVolumePolicies: 'Volume policies',
    offloadSources: (count) => `${count} offload sources registered`,
    noStorageVolumeSources: 'No storage volume sources',
    rlSnapshotFeed: 'Snapshot feed',
    snapshotsVisible: (count) => `${count} snapshots visible`,
    snapshotListNotPassed: 'Snapshot list not passed to this panel',
    rlRemoteReplica: 'Remote replica',
    replicatedFailed: (replicated, failed) => `${replicated} replicated, ${failed} failed`,
    replicationStateUnavailable: 'Replication state unavailable',

    selfDrTitle: 'Self-DR readiness',
    miniScore: 'Score',
    miniRequired: 'Required',
    miniBackups: 'Backups',
    miniRestores: 'Restores',
    rlComponentManifest: 'Component manifest',
    requiredComponents: (count) => `${count} required components declared`,
    requiredListMissing: 'Required component list missing',
    rlSealedArtifacts: 'Sealed artifacts',
    sealingEnabled: 'Sealing enabled for self-DR evidence',
    sealingNotReported: 'Sealing not reported',
    rlLatestAssessment: 'Latest assessment',
    verdictOn: (verdict, date) => `${verdict} on ${date}`,
    noAssessment: 'No assessment returned',
    rlOfflineBundle: 'Offline bundle',
    bundleSizeDate: (size, date) => `${size} / ${date}`,
    noOfflineBundle: 'No offline bundle artifact',
    profileFallback: () => 'profile',
    noSelfDrFindings: 'No self-DR findings returned.',
    noSelfDrAssessment: 'No self-DR assessment returned.',

    restorePlanTitle: 'Self-DR restore plan',
    wavesBadge: (count) => `${count} waves`,
    noRestorePlan: 'No self-DR restore plan returned.',
    waveLabel: (sequence) => `Wave ${sequence}`,
    componentsBadge: (count) => `${count} components`,
    missingLabel: 'missing',
    testedLabel: 'tested',
    untestedLabel: 'untested',

    artifactsTitle: 'Self-DR artifacts',
    artifactsDescription:
      'Stored control-plane backups, immutable evidence, and offline restore bundles.',
    artifactsBadge: (count) => `${count} artifacts`,
    colArtifact: 'Artifact',
    colComponent: 'Component',
    colSize: 'Size',
    colEvidence: 'Evidence',
    colCaptured2: 'Captured',
    colHash2: 'Hash',
    noSelfDrArtifacts: 'No self-DR artifacts returned.',
    noLocation: 'no location',
    retainPrefix: (date) => `retain ${date}`,

    selfDrReadinessDesc: () =>
      'Control-plane backup coverage, restore verdict, findings, and offline bundle readiness.',
    restorePlanDesc: () => 'Restore wave order and component-level backup/restore evidence.',
    backupLabel: () => 'backup',
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات التغطية والتعافي الذاتي للتعافي من الكوارث.',
    na: 'غير متاح',

    metricIacSnapshots: 'لقطات IaC',
    resourcesVersion: (count, version) => `${count} مورد، الإصدار ${version}`,
    noInfraSnapshots: 'لا توجد لقطات بنية تحتية',
    metricVmK8s: 'التقاطات VM/K8s',
    epochsCaptured: (epochs, bytes) => `${epochs} حقبة، تم التقاط ${bytes}`,
    metricStorageOffload: 'إفراغ التخزين',
    snapshotsReplicated: (replicated, known) => `${replicated}/${known} لقطة منسوخة`,
    volumePolicies: 'سياسات وحدات التخزين مسجّلة',
    metricSelfDr: 'التعافي الذاتي (Self-DR)',
    unscored: 'غير مُقيَّم',
    findingsArtifacts: (findings, artifacts) => `${findings} نتيجة، ${artifacts} أثر`,

    partialBanner: 'قد تكون بعض بيانات تغطية التعافي قديمة بسبب فشل آخر تحديث.',
    partialBadge: 'بيانات جزئية',

    iacTitle: 'تغطية IaC وجاهزية الفروق',
    iacDescription: () =>
      'حداثة اللقطة، ومزيج المزوّدين، وتغطية الموارد المُضمَّنة، وتوفّر خط الأساس.',
    miniSnapshots: 'اللقطات',
    miniLatest: 'الأحدث',
    miniResources: 'الموارد',
    miniSource: 'المصدر',
    diffBaseline: 'خط أساس الفرق',
    diffAgainst: (latest, previous) => `${latest} مقابل ${previous}`,
    captureOneMore: 'التقط لقطة إضافية لتمكين مقارنة الانحراف',
    noIacSnapshot: 'لم تُرجَع لقطة IaC',
    inlineDiff: 'فرق مُضمَّن',
    apiDiffReady: 'فرق الواجهة (API) جاهز',
    notReady: 'غير جاهز',
    miniAdded: 'مُضاف',
    miniRemoved: 'محذوف',
    miniModified: 'مُعدَّل',
    colSnapshot: 'اللقطة',
    colKind: 'النوع',
    colResources: 'الموارد',
    colHash: 'التجزئة',
    colCaptured: 'وقت الالتقاط',
    noIacSnapshots: 'لم تُرجَع لقطات IaC.',
    resourcesNotExpanded: 'الموارد غير موسَّعة',

    vmK8sTitle: 'التقاطات الأجهزة الافتراضية (VM) وKubernetes',
    vmK8sDescription:
      'مصادر الالتقاط، وأحدث الحقب، وحجم الكتل/الإطارات، وتغطية تسلسل التدفّق.',
    vmK8sBadge: (vm, k8s) => `${vm} VM / ${k8s} K8s`,
    miniSources: 'المصادر',
    miniEnabled: 'المُفعَّلة',
    miniEpochs: 'الحقب',
    miniLatest2: 'الأحدث',
    colSource: 'المصدر',
    colBinding: 'الربط',
    colLastEpoch: 'آخر حقبة',
    colSeq: 'التسلسل',
    colStatus: 'الحالة',
    noCaptureSources: 'لم تُرجَع مصادر التقاط VM أو Kubernetes.',
    none: 'لا شيء',
    totalEpochs: (count) => `${count} حقبة إجمالًا`,
    epochMeta: (kind, frames, bytes) => `${kind} / ${frames} إطار / ${bytes}`,
    changedUnits: (changed, total) => `${changed}/${total} متغيّرة`,
    noCaptureEpochs: 'لم تُرجَع حقب التقاط.',

    storageTitle: 'وحدات إفراغ التخزين',
    storageDescription:
      'مصادر وحدات التخزين المسجّلة، ونوافذ الاحتفاظ، وحالة النسخ المتماثل للقطة المرفقة.',
    snapshotsBadge: (count) => `${count} لقطة`,
    volumesBadge: (count) => `${count} وحدة تخزين`,
    miniVolumes: 'وحدات التخزين',
    miniSnapshots2: 'اللقطات',
    miniReplicated: 'المنسوخة',
    miniLatest3: 'الأحدث',
    colVolume: 'وحدة التخزين',
    colProvider: 'المزوّد',
    colRetention: 'الاحتفاظ',
    colLatestSnapshot: 'أحدث لقطة',
    colOffload: 'الإفراغ',
    noStorageVolumes: 'لم تُرجَع وحدات إفراغ تخزين.',
    noSite: 'لا يوجد موقع',
    retentionSnapshots: (count) => `${count} لقطة`,
    maxAge: (duration) => `أقصى عمر ${duration}`,
    notAttached: 'غير مرفقة',
    changedBytes: (bytes) => `${bytes} متغيّرة`,
    snapshotFeedUnavailable: 'موجز اللقطة غير متاح',
    registered: 'مسجّلة',
    rlVolumePolicies: 'سياسات وحدات التخزين',
    offloadSources: (count) => `${count} مصدر إفراغ مسجّل`,
    noStorageVolumeSources: 'لا توجد مصادر وحدات تخزين',
    rlSnapshotFeed: 'موجز اللقطة',
    snapshotsVisible: (count) => `${count} لقطة ظاهرة`,
    snapshotListNotPassed: 'لم تُمرَّر قائمة اللقطة إلى هذه اللوحة',
    rlRemoteReplica: 'النسخة البعيدة',
    replicatedFailed: (replicated, failed) => `${replicated} منسوخة، ${failed} فاشلة`,
    replicationStateUnavailable: 'حالة النسخ المتماثل غير متاحة',

    selfDrTitle: 'جاهزية التعافي الذاتي (Self-DR)',
    miniScore: 'الدرجة',
    miniRequired: 'المطلوبة',
    miniBackups: 'النسخ الاحتياطية',
    miniRestores: 'الاستعادات',
    rlComponentManifest: 'بيان المكوّنات',
    requiredComponents: (count) => `${count} مكوّن مطلوب مُعلَن`,
    requiredListMissing: 'قائمة المكوّنات المطلوبة مفقودة',
    rlSealedArtifacts: 'الآثار المختومة',
    sealingEnabled: 'الختم مُفعَّل لأدلة التعافي الذاتي',
    sealingNotReported: 'لم يُبلَّغ عن الختم',
    rlLatestAssessment: 'أحدث تقييم',
    verdictOn: (verdict, date) => `${verdict} في ${date}`,
    noAssessment: 'لم يُرجَع تقييم',
    rlOfflineBundle: 'حزمة دون اتصال',
    bundleSizeDate: (size, date) => `${size} / ${date}`,
    noOfflineBundle: 'لا يوجد أثر حزمة دون اتصال',
    profileFallback: () => 'الملف',
    noSelfDrFindings: 'لم تُرجَع نتائج تعافٍ ذاتي.',
    noSelfDrAssessment: 'لم يُرجَع تقييم تعافٍ ذاتي.',

    restorePlanTitle: 'خطة استعادة التعافي الذاتي (Self-DR)',
    wavesBadge: (count) => `${count} موجة`,
    noRestorePlan: 'لم تُرجَع خطة استعادة للتعافي الذاتي.',
    waveLabel: (sequence) => `الموجة ${sequence}`,
    componentsBadge: (count) => `${count} مكوّن`,
    missingLabel: 'مفقودة',
    testedLabel: 'مُختبَرة',
    untestedLabel: 'غير مُختبَرة',

    artifactsTitle: 'آثار التعافي الذاتي (Self-DR)',
    artifactsDescription:
      'النسخ الاحتياطية المخزَّنة لمستوى التحكّم، والأدلة غير القابلة للتعديل، وحزم الاستعادة دون اتصال.',
    artifactsBadge: (count) => `${count} أثر`,
    colArtifact: 'الأثر',
    colComponent: 'المكوّن',
    colSize: 'الحجم',
    colEvidence: 'الدليل',
    colCaptured2: 'وقت الالتقاط',
    colHash2: 'التجزئة',
    noSelfDrArtifacts: 'لم تُرجَع آثار تعافٍ ذاتي.',
    noLocation: 'لا يوجد موقع',
    retainPrefix: (date) => `الاحتفاظ حتى ${date}`,

    selfDrReadinessDesc: () =>
      'تغطية النسخة الاحتياطية لمستوى التحكّم، وحكم الاستعادة، والنتائج، وجاهزية الحزمة دون اتصال.',
    restorePlanDesc: () => 'ترتيب موجات الاستعادة وأدلة النسخ الاحتياطي/الاستعادة على مستوى المكوّن.',
    backupLabel: () => 'نسخة احتياطية',
  },
};

export function useCoverageSelfDrLabels(): CoverageSelfDrLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(coverageSelfDrLabels, locale), [locale]);
}
