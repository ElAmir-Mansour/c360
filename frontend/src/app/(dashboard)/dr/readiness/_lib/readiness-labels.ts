'use client';

/**
 * Feature-local bilingual copy for the `/dr/readiness` console route.
 *
 * Per the console's bilingual contract this is a `DRBilingual<ReadinessPageLabels>`
 * bundle (full English + professional MSA Arabic, two same-shaped copies) resolved
 * against the active locale by {@link useReadinessPageLabels} (English fallback).
 * The `renderWithQuery` `en` default keeps the existing English assertions green
 * (e.g. the page heading, the read-only banner, the inner-tab labels, and the
 * write-blocked warning toast copy), while an Arabic user sees the full MSA
 * surface.
 *
 * Only the page's own chrome lives here; the nested readiness/coverage/
 * intelligence panels are owned by their own (shared `_components/*`) modules.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface ReadinessPageLabels {
  pageTitle: string;
  pageDescription: string;

  readOnlyTitle: string;
  readOnlyDescription: string;

  tabSovereign: string;
  tabCoverage: string;
  tabIntelligence: string;

  /** Write-blocked warning toast (title + body); body doubles as the gate tooltip. */
  writeBlockedTitle: string;
  noWriteTooltip: string;

  /** Inline gate-notice reason shown when no protection group is selected. */
  noGroupReason: string;
}

export const readinessPageLabelBundle: DRBilingual<ReadinessPageLabels> = {
  en: {
    pageTitle: 'Readiness',
    pageDescription:
      'Sovereign readiness, recovery coverage and Self-DR, and the predictive intelligence plane for the selected protection group.',

    readOnlyTitle: 'Read-only access',
    readOnlyDescription:
      'You can review readiness, coverage, and intelligence data, but performing readiness actions (key rotation, vault evaluation, Self-DR capture, IaC and storage operations, runbook regeneration, copilot queries) requires the dr:write permission.',

    tabSovereign: 'Sovereign readiness',
    tabCoverage: 'Coverage & Self-DR',
    tabIntelligence: 'Intelligence',

    writeBlockedTitle: 'Write action blocked',
    noWriteTooltip: 'Requires the dr:write permission',
    noGroupReason: 'Select a protection group first',
  },
  ar: {
    pageTitle: 'الجاهزية',
    pageDescription:
      'الجاهزية السيادية، وتغطية الاسترداد والتعافي الذاتي، ومستوى الذكاء التنبّؤي لمجموعة الحماية المختارة.',

    readOnlyTitle: 'وصول للقراءة فقط',
    readOnlyDescription:
      'يمكنك مراجعة بيانات الجاهزية والتغطية والذكاء، لكن تنفيذ إجراءات الجاهزية (تدوير المفاتيح، وتقييم الخزينة، والتعافي الذاتي، وعمليات البنية التحتية ككود والتخزين، وإعادة توليد دليل التشغيل، واستعلامات المساعد الذكي) يتطلّب صلاحية الكتابة (dr:write).',

    tabSovereign: 'الجاهزية السيادية',
    tabCoverage: 'التغطية والتعافي الذاتي',
    tabIntelligence: 'الذكاء',

    writeBlockedTitle: 'تم حظر إجراء الكتابة',
    noWriteTooltip: 'يتطلّب صلاحية الكتابة (dr:write)',
    noGroupReason: 'اختَر مجموعة حماية أولًا',
  },
};

/**
 * useReadinessPageLabels resolves the readiness-page chrome copy against the
 * active locale (English fallback), mirroring {@link useDRLabels}. Memoised by
 * locale.
 */
export function useReadinessPageLabels(): ReadinessPageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(readinessPageLabelBundle, locale), [locale]);
}
