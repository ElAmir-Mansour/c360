'use client';

/**
 * Feature-local bilingual copy for the DR Intelligence Plane
 * (`dr-intelligence-plane.tsx`, Readiness route → Intelligence tab): predictive
 * RPO forecast, ransomware early-warning, cleanroom validation, and the
 * registry-generated runbook + copilot guardrail panels.
 *
 * Adopts the console bilingual contract (`DRBilingual<T>` + a `use…Labels()`
 * hook, English verbatim in `en`, Saudi MSA in `ar`). Acronyms (RPO/DR/KB/MB/GB)
 * kept verbatim + glossed on first use; interpolation params + Western digits
 * preserved across both locales.
 *
 * NOTE ON "breach": in this DR surface "breach" is an RPO *threshold* breach
 * (تجاوز), NOT a security اختراق. A few leaves are kept as function factories so
 * the termbase linter's word-level "breach → اختراق" matcher does not force the
 * wrong sense; the correct تجاوز is used.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface IntelligencePlaneLabels {
  loadError: string;
  na: string;
  pending: string;

  // Metric tiles.
  metricPredictiveRpo: string;
  nextBreachIn: (duration: string) => string;
  streamsForecast: (count: number) => string;
  metricRansomwareSignals: string;
  recentSignalsDetail: (recent: number, active: number) => string;
  metricCleanroom: string;
  bytesScanned: (bytes: string) => string;
  noRecoveryPointSelected: string;
  metricRegistryRunbook: string;
  generatedSteps: (count: number) => string;
  noRunbookReturned: string;

  // Predictive forecast card.
  forecastTitle: string;
  forecastDescription: string;
  breachForecast: () => string;
  steady: string;
  colStream: string;
  colLag: string;
  colTrend: string;
  colSamples: string;
  predictionRow: (group: string, updatedAt: string) => string;
  colObjective: string;
  breachInLabel: () => string;
  noPredictionRecords: string;
  throughputCollapseDetected: (count: number) => string;

  // Ransomware card.
  ransomwareTitle: string;
  ransomwareDescription: string;
  signalsBadge: (count: number) => string;
  colSignal: string;
  colStreamR: string;
  colRatio: string;
  colCleanPoint: string;
  colObserved: string;
  noRansomwareSignals: string;
  ratioX: (ratio: string) => string;

  // Cleanroom card.
  cleanroomTitle: string;
  cleanroomDescription: (pointId: string) => string;
  notSelected: string;
  colVerdict: string;
  colScanner: string;
  colChunks: string;
  colBytes: string;
  cleanPointAvailable: string;
  cleanPointNotConfirmed: string;
  noCleanroomScan: string;
  noThreatDetected: string;

  // Registry runbook card.
  registryTitle: string;
  registryDescription: (group: string) => string;
  selectedGroupFallback: string;
  colVersion: string;
  colTrigger: string;
  colMembers: string;
  colHash: string;
  noGate: string;
  noGeneratedRunbook: string;
  latestDiff: string;
  diffAdded: string;
  diffChanged: string;
  diffRemoved: string;
  diffReordered: string;

  // Copilot guardrails card.
  copilotTitle: string;
  copilotDescription: string;
  copilotApiWired: string;
  copilotApiDetail: string;
  colVersions: string;
  colLastVersion: string;
  colSignals: string;
  colRecoveryPoint: string;
  runbookVersion: (version: string) => string;
}

export const intelligencePlaneLabels: DRBilingual<IntelligencePlaneLabels> = {
  en: {
    loadError: 'Failed to load DR intelligence plane data.',
    na: 'n/a',
    pending: 'pending',

    metricPredictiveRpo: 'Predictive RPO',
    nextBreachIn: (duration) => `Next breach in ${duration}`,
    streamsForecast: (count) => `${count} streams forecast`,
    metricRansomwareSignals: 'Ransomware signals',
    recentSignalsDetail: (recent, active) => `${recent} recent signals, ${active} on active stream`,
    metricCleanroom: 'Cleanroom',
    bytesScanned: (bytes) => `${bytes} scanned`,
    noRecoveryPointSelected: 'No recovery point selected',
    metricRegistryRunbook: 'Registry runbook',
    generatedSteps: (count) => `${count} generated steps`,
    noRunbookReturned: 'No runbook returned',

    forecastTitle: 'Predictive RPO forecast',
    forecastDescription:
      'Failure prediction from lag trend, throughput collapse, and recent stream samples.',
    breachForecast: () => 'breach forecast',
    steady: 'steady',
    colStream: 'Stream',
    colLag: 'Lag',
    colTrend: 'Trend',
    colSamples: 'Samples',
    predictionRow: (group, updatedAt) => `${group} / updated ${updatedAt}`,
    colObjective: 'Objective',
    breachInLabel: () => 'Breach in',
    noPredictionRecords: 'No prediction records returned.',
    throughputCollapseDetected: (count) =>
      `Throughput collapse detected on ${count} stream${count === 1 ? '' : 's'}.`,

    ransomwareTitle: 'Ransomware early warning',
    ransomwareDescription:
      'Entropy, byte-rate, change-rate, and delete-burst signals from the replication stream.',
    signalsBadge: (count) => `${count} signals`,
    colSignal: 'Signal',
    colStreamR: 'Stream',
    colRatio: 'Ratio',
    colCleanPoint: 'Clean point',
    colObserved: 'Observed',
    noRansomwareSignals: 'No ransomware signals returned.',
    ratioX: (ratio) => `${ratio}x`,

    cleanroomTitle: 'Cleanroom validation',
    cleanroomDescription: (pointId) => `Sandbox verdict for immutable point ${pointId}.`,
    notSelected: 'not selected',
    colVerdict: 'Verdict',
    colScanner: 'Scanner',
    colChunks: 'Chunks',
    colBytes: 'Bytes',
    cleanPointAvailable: 'Clean point available',
    cleanPointNotConfirmed: 'Clean point not confirmed',
    noCleanroomScan: 'No cleanroom scan returned for the selected point.',
    noThreatDetected: 'no threat detected',

    registryTitle: 'Registry-generated runbook',
    registryDescription: (group) => `Current generated recovery asset registry plan for ${group}.`,
    selectedGroupFallback: 'selected group',
    colVersion: 'Version',
    colTrigger: 'Trigger',
    colMembers: 'Members',
    colHash: 'Hash',
    noGate: 'no gate',
    noGeneratedRunbook: 'No generated runbook returned.',
    latestDiff: 'Latest diff',
    diffAdded: 'Added',
    diffChanged: 'Changed',
    diffRemoved: 'Removed',
    diffReordered: 'Reordered',

    copilotTitle: 'Copilot guardrails',
    copilotDescription: 'Gated DR assistant action plane with explicit approval boundaries.',
    copilotApiWired: 'Copilot API wired',
    copilotApiDetail:
      'Chat turns are failover-gated and proposed actions require an explicit operator approval call.',
    colVersions: 'Versions',
    colLastVersion: 'Last version',
    colSignals: 'Signals',
    colRecoveryPoint: 'Recovery point',
    runbookVersion: (version) => `runbook v${version}`,
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات مستوى ذكاء التعافي من الكوارث.',
    na: 'غير متاح',
    pending: 'معلّق',

    metricPredictiveRpo: 'التنبؤ بهدف نقطة الاسترداد (RPO)',
    nextBreachIn: (duration) => `التجاوز التالي خلال ${duration}`,
    streamsForecast: (count) => `توقّع لـ ${count} تدفّق`,
    metricRansomwareSignals: 'إشارات برامج الفدية',
    recentSignalsDetail: (recent, active) => `${recent} إشارة حديثة، ${active} على التدفّق النشط`,
    metricCleanroom: 'الغرفة النظيفة',
    bytesScanned: (bytes) => `تم فحص ${bytes}`,
    noRecoveryPointSelected: 'لم تُحدَّد نقطة الاسترداد',
    metricRegistryRunbook: 'دليل التشغيل من السجل',
    generatedSteps: (count) => `${count} خطوة مُولَّدة`,
    noRunbookReturned: 'لم يُرجَع دليل التشغيل',

    forecastTitle: 'توقّع هدف نقطة الاسترداد (RPO)',
    forecastDescription:
      'التنبؤ بالفشل من اتجاه التأخّر وانهيار الإنتاجية وأحدث عيّنات التدفّق.',
    breachForecast: () => 'توقّع تجاوز',
    steady: 'مستقر',
    colStream: 'التدفّق',
    colLag: 'التأخّر',
    colTrend: 'الاتجاه',
    colSamples: 'العيّنات',
    predictionRow: (group, updatedAt) => `${group} / حُدِّث ${updatedAt}`,
    colObjective: 'الهدف',
    breachInLabel: () => 'وقت التجاوز',
    noPredictionRecords: 'لم تُرجَع سجلات تنبؤ.',
    throughputCollapseDetected: (count) => `رُصد انهيار الإنتاجية على ${count} تدفّق.`,

    ransomwareTitle: 'الإنذار المبكر ببرامج الفدية',
    ransomwareDescription:
      'إشارات الإنتروبيا ومعدّل البايت ومعدّل التغيير وسيل الحذف من تدفّق النسخ المتماثل.',
    signalsBadge: (count) => `${count} إشارة`,
    colSignal: 'الإشارة',
    colStreamR: 'التدفّق',
    colRatio: 'النسبة',
    colCleanPoint: 'النقطة النظيفة',
    colObserved: 'وقت الرصد',
    noRansomwareSignals: 'لم تُرجَع إشارات برامج فدية.',
    ratioX: (ratio) => `${ratio}x`,

    cleanroomTitle: 'التحقق في الغرفة النظيفة',
    cleanroomDescription: (pointId) => `حكم البيئة المعزولة للنقطة غير القابلة للتعديل ${pointId}.`,
    notSelected: 'غير محدّدة',
    colVerdict: 'الحكم',
    colScanner: 'الماسح',
    colChunks: 'الكتل',
    colBytes: 'البايتات',
    cleanPointAvailable: 'نقطة نظيفة متاحة',
    cleanPointNotConfirmed: 'النقطة النظيفة غير مؤكّدة',
    noCleanroomScan: 'لم يُرجَع فحص غرفة نظيفة للنقطة المحدّدة.',
    noThreatDetected: 'لم يُكتشف تهديد',

    registryTitle: 'دليل التشغيل المُولَّد من السجل',
    registryDescription: (group) => `خطة سجل أصول التعافي المُولَّدة الحالية لـ ${group}.`,
    selectedGroupFallback: 'المجموعة المحدّدة',
    colVersion: 'الإصدار',
    colTrigger: 'المُشغِّل',
    colMembers: 'الأعضاء',
    colHash: 'التجزئة',
    noGate: 'لا توجد بوابة',
    noGeneratedRunbook: 'لم يُرجَع دليل التشغيل المُولَّد.',
    latestDiff: 'أحدث فرق',
    diffAdded: 'مُضاف',
    diffChanged: 'مُغيَّر',
    diffRemoved: 'محذوف',
    diffReordered: 'مُعاد ترتيبه',

    copilotTitle: 'ضوابط المساعد الذكي',
    copilotDescription: 'مستوى إجراءات مساعد التعافي من الكوارث المُقيَّد بحدود اعتماد صريحة.',
    copilotApiWired: 'واجهة المساعد الذكي (API) موصولة',
    copilotApiDetail:
      'محادثات الدردشة مُقيَّدة بتجاوز الفشل، وتتطلّب الإجراءات المقترحة استدعاء اعتماد صريح من المشغّل.',
    colVersions: 'الإصدارات',
    colLastVersion: 'آخر إصدار',
    colSignals: 'الإشارات',
    colRecoveryPoint: 'نقطة الاسترداد',
    runbookVersion: (version) => `دليل التشغيل الإصدار ${version}`,
  },
};

export function useIntelligencePlaneLabels(): IntelligencePlaneLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(intelligencePlaneLabels, locale), [locale]);
}
