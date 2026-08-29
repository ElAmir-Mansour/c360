'use client';

/**
 * Feature-local bilingual copy for the DR Copilot Command panel
 * (`dr-copilot-commands.tsx`, Readiness route → Intelligence tab): operator
 * command prompts, registry-runbook regeneration, the latest copilot answer +
 * guardrails, and the session transcript.
 *
 * Adopts the console bilingual contract (`DRBilingual<T>` + a `use…Labels()`
 * hook; English verbatim in `en`, Saudi MSA in `ar`). Acronyms (RTO/RPO/API/DR)
 * kept verbatim + glossed; interpolation params + Western digits preserved.
 *
 * The LLM prompt bodies built by `buildPrompt` are deliberately NOT localized —
 * they are functional model-instruction text, not display copy.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface CopilotCommandsLabels {
  loadError: string;
  refreshError: string;
  retry: string;
  na: string;

  // Metric tiles.
  metricRunbookVersion: string;
  stepsAndTrigger: (steps: number, trigger: string) => string;
  noActiveRunbook: string;
  metricAvailableVersions: string;
  latestVersionDetail: (version: number, createdAt: string) => string;
  noVersionsReturned: string;
  metricSelectedGroup: string;
  none: string;
  metricStreamPoint: string;
  pointDetail: (hash: string) => string;
  noRecoveryPointSelected: string;

  // Commands card.
  commandsTitle: string;
  commandsDescription: string;
  badgeAsking: string;
  badgeSession: string;
  badgeIdle: string;
  cmdExplainFailover: string;
  cmdDraftRegulator: string;
  cmdValidateClean: string;
  cmdReviewDrift: string;
  regenTitle: string;
  regenGroupCurrent: (hash: string, current: string) => string;
  selectGroupFirst: string;
  regenerating: string;
  regenerate: string;
  diffAdded: string;
  diffChanged: string;
  diffRemoved: string;
  diffReordered: string;
  noRunbookVersions: string;

  // Latest answer card.
  answerTitle: string;
  answerDescription: string;
  providerNa: string;
  modelNa: string;
  msSuffix: (ms: number) => string;
  noAnswer: string;
  citations: string;
  guardrails: string;
  noCitations: string;
  noGuardrails: string;
  approvalRequiredGuardrail: string;
  apiCall: string;
  approvalCall: string;
  toolNoResult: string;
  toolSuccess: string;
  toolAttention: string;
  toolLatency: string;
  toolArgs: string;

  // Transcript card.
  transcriptTitle: string;
  transcriptDescription: string;
  refreshTranscript: string;
  loadTranscript: string;
  session: string;
  messages: string;
  provider: string;
  updated: string;
  transcriptAvailable: string;
  noSessionId: string;
  msgMeta: (seq: string, createdAt: string) => string;
  noContent: string;
  toolCallsLabel: string;
  actionLabel: string;
  actionNone: string;

  // Runbook version row.
  runbookVersionLabel: (version: number) => string;
  rvSteps: string;
  rvMembers: string;
  rvRto: string;
  rvRpo: string;

  selectedGroupFallback: string;
}

export const copilotCommandsLabels: DRBilingual<CopilotCommandsLabels> = {
  en: {
    loadError: 'Failed to load DR copilot guidance data.',
    refreshError: 'Failed to refresh DR copilot guidance data.',
    retry: 'Retry',
    na: 'n/a',

    metricRunbookVersion: 'Runbook version',
    stepsAndTrigger: (steps, trigger) => `${steps} steps / ${trigger}`,
    noActiveRunbook: 'No active runbook',
    metricAvailableVersions: 'Available versions',
    latestVersionDetail: (version, createdAt) => `Latest v${version} / ${createdAt}`,
    noVersionsReturned: 'No versions returned',
    metricSelectedGroup: 'Selected group',
    none: 'none',
    metricStreamPoint: 'Stream / point',
    pointDetail: (hash) => `Point ${hash}`,
    noRecoveryPointSelected: 'No recovery point selected',

    commandsTitle: 'Copilot commands',
    commandsDescription:
      'Operator prompts scoped to the selected group, stream, point, and runbook state.',
    badgeAsking: 'asking',
    badgeSession: 'session',
    badgeIdle: 'idle',
    cmdExplainFailover: 'Explain failover risk',
    cmdDraftRegulator: 'Draft regulator summary',
    cmdValidateClean: 'Validate clean point',
    cmdReviewDrift: 'Review runbook drift',
    regenTitle: 'Registry runbook regeneration',
    regenGroupCurrent: (hash, current) => `Group ${hash} / current ${current}`,
    selectGroupFirst: 'Select a group before regenerating.',
    regenerating: 'Regenerating',
    regenerate: 'Regenerate',
    diffAdded: 'Added',
    diffChanged: 'Changed',
    diffRemoved: 'Removed',
    diffReordered: 'Reordered',
    noRunbookVersions: 'No registry runbook versions returned.',

    answerTitle: 'Latest copilot answer',
    answerDescription:
      'Assistant output, evidence references, guardrails, and proposed operator action.',
    providerNa: 'provider n/a',
    modelNa: 'model n/a',
    msSuffix: (ms) => `${ms} ms`,
    noAnswer: 'No copilot answer returned yet.',
    citations: 'Citations',
    guardrails: 'Guardrails',
    noCitations: 'No citations returned.',
    noGuardrails: 'No guardrails returned.',
    approvalRequiredGuardrail: 'Proposed action requires explicit operator approval.',
    apiCall: 'API call',
    approvalCall: 'Approval call',
    toolNoResult: 'No result summary returned.',
    toolSuccess: 'success',
    toolAttention: 'attention',
    toolLatency: 'Latency',
    toolArgs: 'Args',

    transcriptTitle: 'Session transcript',
    transcriptDescription:
      'Conversation history and session metadata for the current copilot turn.',
    refreshTranscript: 'Refresh transcript',
    loadTranscript: 'Load transcript',
    session: 'Session',
    messages: 'Messages',
    provider: 'Provider',
    updated: 'Updated',
    transcriptAvailable: 'Transcript is available for this session but has not been loaded.',
    noSessionId: 'No copilot session id returned yet.',
    msgMeta: (seq, createdAt) => `seq ${seq} / ${createdAt}`,
    noContent: 'No content returned.',
    toolCallsLabel: 'Tool calls',
    actionLabel: 'Action',
    actionNone: 'none',

    runbookVersionLabel: (version) => `runbook v${version}`,
    rvSteps: 'Steps',
    rvMembers: 'Members',
    rvRto: 'RTO',
    rvRpo: 'RPO',

    selectedGroupFallback: 'selected group',
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات إرشادات المساعد الذكي للتعافي من الكوارث.',
    refreshError: 'تعذّر تحديث بيانات إرشادات المساعد الذكي للتعافي من الكوارث.',
    retry: 'إعادة المحاولة',
    na: 'غير متاح',

    metricRunbookVersion: 'إصدار دليل التشغيل',
    stepsAndTrigger: (steps, trigger) => `${steps} خطوة / ${trigger}`,
    noActiveRunbook: 'دليل التشغيل غير نشط',
    metricAvailableVersions: 'الإصدارات المتاحة',
    latestVersionDetail: (version, createdAt) => `أحدث إصدار ${version} / ${createdAt}`,
    noVersionsReturned: 'لم تُرجَع إصدارات',
    metricSelectedGroup: 'المجموعة المحدّدة',
    none: 'لا شيء',
    metricStreamPoint: 'التدفّق / النقطة',
    pointDetail: (hash) => `النقطة ${hash}`,
    noRecoveryPointSelected: 'لم تُحدَّد نقطة الاسترداد',

    commandsTitle: 'أوامر المساعد الذكي',
    commandsDescription:
      'مطالبات المشغّل محدّدة النطاق حسب المجموعة والتدفّق والنقطة وحالة دليل التشغيل المحدّدة.',
    badgeAsking: 'قيد السؤال',
    badgeSession: 'جلسة',
    badgeIdle: 'خامل',
    cmdExplainFailover: 'شرح مخاطر تجاوز الفشل',
    cmdDraftRegulator: 'إعداد مسودة ملخّص للهيئة المنظِّمة',
    cmdValidateClean: 'التحقق من النقطة النظيفة',
    cmdReviewDrift: 'مراجعة انحراف دليل التشغيل',
    regenTitle: 'إعادة توليد دليل التشغيل من السجل',
    regenGroupCurrent: (hash, current) => `المجموعة ${hash} / الحالي ${current}`,
    selectGroupFirst: 'اختَر مجموعة قبل إعادة التوليد.',
    regenerating: 'جارٍ إعادة التوليد',
    regenerate: 'إعادة التوليد',
    diffAdded: 'مُضاف',
    diffChanged: 'مُغيَّر',
    diffRemoved: 'محذوف',
    diffReordered: 'مُعاد ترتيبه',
    noRunbookVersions: 'لم تُرجَع إصدارات دليل التشغيل من السجل.',

    answerTitle: 'أحدث إجابة من المساعد الذكي',
    answerDescription:
      'مخرجات المساعد ومراجع الأدلة والضوابط والإجراء المقترح للمشغّل.',
    providerNa: 'المزوّد غير متاح',
    modelNa: 'النموذج غير متاح',
    msSuffix: (ms) => `${ms} م.ث`,
    noAnswer: 'لم تُرجَع أي إجابة من المساعد الذكي بعد.',
    citations: 'الاستشهادات',
    guardrails: 'الضوابط',
    noCitations: 'لم تُرجَع استشهادات.',
    noGuardrails: 'لم تُرجَع ضوابط.',
    approvalRequiredGuardrail: 'يتطلّب الإجراء المقترح اعتماد المشغّل الصريح.',
    apiCall: 'استدعاء الواجهة (API)',
    approvalCall: 'استدعاء الاعتماد',
    toolNoResult: 'لم يُرجَع ملخّص نتيجة.',
    toolSuccess: 'نجاح',
    toolAttention: 'يحتاج انتباه',
    toolLatency: 'زمن الاستجابة',
    toolArgs: 'الوسائط',

    transcriptTitle: 'محضر الجلسة',
    transcriptDescription:
      'سجل المحادثة وبيانات الجلسة الوصفية للدور الحالي مع المساعد الذكي.',
    refreshTranscript: 'تحديث المحضر',
    loadTranscript: 'تحميل المحضر',
    session: 'الجلسة',
    messages: 'الرسائل',
    provider: 'المزوّد',
    updated: 'آخر تحديث',
    transcriptAvailable: 'محضر هذه الجلسة متاح لكنه لم يُحمَّل بعد.',
    noSessionId: 'لم يُرجَع معرّف جلسة للمساعد الذكي بعد.',
    msgMeta: (seq, createdAt) => `تسلسل ${seq} / ${createdAt}`,
    noContent: 'لم يُرجَع محتوى.',
    toolCallsLabel: 'استدعاءات الأدوات',
    actionLabel: 'الإجراء',
    actionNone: 'لا شيء',

    runbookVersionLabel: (version) => `دليل التشغيل الإصدار ${version}`,
    rvSteps: 'الخطوات',
    rvMembers: 'الأعضاء',
    rvRto: 'هدف زمن الاسترداد (RTO)',
    rvRpo: 'هدف نقطة الاسترداد (RPO)',

    selectedGroupFallback: 'المجموعة المحدّدة',
  },
};

export function useCopilotCommandsLabels(): CopilotCommandsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(copilotCommandsLabels, locale), [locale]);
}
