/**
 * Feature-local copy for the `/dr/prove/compliance` posture board.
 *
 * Kept out of the shared `_lib/dr-i18n.ts` per the route contract, but adopting
 * the foundation's bilingual bundle shape: `compliancePostureLabels` is a
 * `DRBilingual<CompliancePostureLabels>` holding two full, identically-shaped
 * copies (English + professional MSA). Components resolve the active locale via
 * {@link useComplianceLabels} and read the resolved object exactly as before.
 */

'use client';

import { useMemo } from 'react';
import { type DRBilingual, resolveDRBilingual } from '../../../_lib/dr-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface CompliancePostureLabels {
  // Page framing.
  title: string;
  description: string;

  // Section headings.
  frameworksHeading: string;
  frameworksDescription: string;
  assuranceHeading: string;
  assuranceDescription: string;

  // RAG status labels (text always accompanies colour + icon).
  ragGreen: string;
  ragAmber: string;
  ragRed: string;
  ragUnknown: string;
  ragGreenSr: string;
  ragAmberSr: string;
  ragRedSr: string;
  ragUnknownSr: string;

  // Verdict labels (per-control).
  verdictSatisfied: string;
  verdictPartial: string;
  verdictFailed: string;

  // Severity labels.
  severityWarning: string;
  severityHigh: string;
  severityCritical: string;

  // Framework card chrome.
  authorityLabel: string;
  standardLabel: string;
  versionLabel: string;
  scoreLabel: string;
  controlsLabel: string;
  evaluatedLabel: string;
  targetLabel: string;
  mandatoryTag: string;
  notAssessedYet: string;

  // Tally line.
  satisfiedCount: string;
  partialCount: string;
  failedCount: string;

  // Drill-down.
  whatsMissing: string;
  whatsMissingClosed: string;
  gapsHeading: string;
  controlsHeading: string;
  findingsHeading: string;
  recommendationsHeading: string;
  noGaps: string;
  noFindings: string;
  noControls: string;
  noRecommendations: string;
  reasonLabel: string;
  recommendationLabel: string;

  // Actions.
  assessCta: string;
  assessingCta: string;
  reassessCta: string;
  selectFrameworkLabel: string;
  selectFrameworkPlaceholder: string;
  noFrameworksOption: string;

  // Permission / selection guards.
  noWriteTooltip: string;
  noGroupTooltip: string;
  noGroupSelected: string;
  readOnlyNotice: string;

  // Loading / error / empty.
  loadError: string;
  assuranceLoadError: string;
  noFrameworksTitle: string;
  noFrameworksDescription: string;
  noAssuranceTitle: string;
  noAssuranceDescription: string;

  // Framework family display names.
  familyHeadingFallback: string;
}

export const compliancePostureLabels: DRBilingual<CompliancePostureLabels> = {
  en: {
    // Page framing.
    title: 'Compliance posture',
    description:
      'Map control frameworks to live recovery evidence. Each framework is scored from real assessment data — its RAG status, weighted score, and the specific controls that are still failing or partial.',

    // Section headings.
    frameworksHeading: 'Control frameworks',
    frameworksDescription:
      'Regulatory and internal frameworks evaluated against the active protection group. Run an assessment to refresh a framework from current evidence.',
    assuranceHeading: 'Internal DR assurance policy',
    assuranceDescription:
      'The internal assurance control catalogue, scored against the active group from the latest evaluation. Findings list the precise control gaps to close.',

    // RAG status labels (text always accompanies colour + icon).
    ragGreen: 'Compliant',
    ragAmber: 'Gaps found',
    ragRed: 'Non-compliant',
    ragUnknown: 'Not assessed',
    ragGreenSr: 'Status: compliant',
    ragAmberSr: 'Status: gaps found',
    ragRedSr: 'Status: non-compliant',
    ragUnknownSr: 'Status: not yet assessed',

    // Verdict labels (per-control).
    verdictSatisfied: 'Satisfied',
    verdictPartial: 'Partial',
    verdictFailed: 'Failed',

    // Severity labels.
    severityWarning: 'Warning',
    severityHigh: 'High',
    severityCritical: 'Critical',

    // Framework card chrome.
    authorityLabel: 'Authority',
    standardLabel: 'Standard',
    versionLabel: 'Version',
    scoreLabel: 'Weighted score',
    controlsLabel: 'Controls',
    evaluatedLabel: 'Last evaluated',
    targetLabel: 'Target group',
    mandatoryTag: 'Mandatory',
    notAssessedYet: 'Not yet assessed for this group',

    // Tally line.
    satisfiedCount: 'satisfied',
    partialCount: 'partial',
    failedCount: 'failed',

    // Drill-down.
    whatsMissing: 'What is missing',
    whatsMissingClosed: 'No outstanding gaps',
    gapsHeading: 'Outstanding control gaps',
    controlsHeading: 'Control verdicts',
    findingsHeading: 'Assurance findings',
    recommendationsHeading: 'Recommendations',
    noGaps: 'No outstanding gaps — every required control is satisfied.',
    noFindings: 'No findings — the group satisfies every assurance check.',
    noControls: 'No control results were returned for this framework.',
    noRecommendations: 'No recommendations outstanding.',
    reasonLabel: 'Reason',
    recommendationLabel: 'Recommendation',

    // Actions.
    assessCta: 'Assess framework',
    assessingCta: 'Assessing',
    reassessCta: 'Re-assess',
    selectFrameworkLabel: 'Framework',
    selectFrameworkPlaceholder: 'Select a framework',
    noFrameworksOption: 'No frameworks available',

    // Permission / selection guards.
    noWriteTooltip: 'Requires the dr:write permission',
    noGroupTooltip: 'Select a protection group to assess compliance',
    noGroupSelected: 'No protection group selected',
    readOnlyNotice:
      'Running a compliance assessment requires the dr:write permission. Published frameworks and the latest scored evidence remain visible below.',

    // Loading / error / empty.
    loadError: 'Failed to load compliance frameworks.',
    assuranceLoadError: 'Failed to load the internal assurance posture.',
    noFrameworksTitle: 'No control frameworks published',
    noFrameworksDescription:
      'No compliance frameworks are available for this tenant yet. Frameworks appear here once they are published to the recovery assurance catalogue.',
    noAssuranceTitle: 'No assurance assessment yet',
    noAssuranceDescription:
      'The internal assurance posture appears once the active group has been evaluated against the assurance control catalogue.',

    // Framework family display names.
    familyHeadingFallback: 'Regulatory framework',
  },
  ar: {
    // Page framing.
    title: 'وضع الامتثال',
    description:
      'اربط أُطر الضوابط بأدلة الاسترداد الحية. يُسجَّل كل إطار من بيانات تقييم فعلية — حالته بنظام الإشارات الضوئية (أحمر/كهرماني/أخضر) ودرجته المرجَّحة والضوابط المحددة التي لا تزال فاشلة أو جزئية.',

    // Section headings.
    frameworksHeading: 'أُطر الضوابط',
    frameworksDescription:
      'أُطر تنظيمية وداخلية مُقيَّمة مقابل مجموعة الحماية النشطة. شغّل تقييمًا لتحديث الإطار من الأدلة الحالية.',
    assuranceHeading: 'سياسة ضمان التعافي من الكوارث الداخلية',
    assuranceDescription:
      'كتالوج ضوابط الضمان الداخلي، مُسجَّل مقابل المجموعة النشطة من أحدث تقييم. تسرد الملاحظات ثغرات الضوابط المحددة الواجب معالجتها.',

    // RAG status labels (text always accompanies colour + icon).
    ragGreen: 'ممتثل',
    ragAmber: 'وُجِدت ثغرات',
    ragRed: 'غير ممتثل',
    ragUnknown: 'لم يُقيَّم',
    ragGreenSr: 'الحالة: ممتثل',
    ragAmberSr: 'الحالة: وُجِدت ثغرات',
    ragRedSr: 'الحالة: غير ممتثل',
    ragUnknownSr: 'الحالة: لم يُقيَّم بعد',

    // Verdict labels (per-control).
    verdictSatisfied: 'مستوفى',
    verdictPartial: 'جزئي',
    verdictFailed: 'فاشل',

    // Severity labels.
    severityWarning: 'تحذير',
    severityHigh: 'مرتفع',
    severityCritical: 'حرج',

    // Framework card chrome.
    authorityLabel: 'الجهة',
    standardLabel: 'المعيار',
    versionLabel: 'الإصدار',
    scoreLabel: 'الدرجة المرجَّحة',
    controlsLabel: 'الضوابط',
    evaluatedLabel: 'آخر تقييم',
    targetLabel: 'المجموعة المستهدفة',
    mandatoryTag: 'إلزامي',
    notAssessedYet: 'لم يُقيَّم بعد لهذه المجموعة',

    // Tally line.
    satisfiedCount: 'مستوفى',
    partialCount: 'جزئي',
    failedCount: 'فاشل',

    // Drill-down.
    whatsMissing: 'ما الذي ينقص',
    whatsMissingClosed: 'لا توجد ثغرات قائمة',
    gapsHeading: 'ثغرات الضوابط القائمة',
    controlsHeading: 'أحكام الضوابط',
    findingsHeading: 'ملاحظات الضمان',
    recommendationsHeading: 'التوصيات',
    noGaps: 'لا توجد ثغرات قائمة — كل ضابط مطلوب مستوفى.',
    noFindings: 'لا توجد ملاحظات — المجموعة تستوفي كل فحوصات الضمان.',
    noControls: 'لم تُرجَع أي نتائج ضوابط لهذا الإطار.',
    noRecommendations: 'لا توجد توصيات قائمة.',
    reasonLabel: 'السبب',
    recommendationLabel: 'التوصية',

    // Actions.
    assessCta: 'تقييم الإطار',
    assessingCta: 'جارٍ التقييم',
    reassessCta: 'إعادة التقييم',
    selectFrameworkLabel: 'الإطار',
    selectFrameworkPlaceholder: 'اختر إطارًا',
    noFrameworksOption: 'لا توجد أُطر متاحة',

    // Permission / selection guards.
    noWriteTooltip: 'يتطلب صلاحية dr:write',
    noGroupTooltip: 'اختر مجموعة حماية لتقييم الامتثال',
    noGroupSelected: 'لم تُحدَّد مجموعة حماية',
    readOnlyNotice:
      'يتطلب تشغيل تقييم الامتثال صلاحية dr:write. تظل الأُطر المنشورة وأحدث الأدلة المُسجَّلة مرئية أدناه.',

    // Loading / error / empty.
    loadError: 'تعذّر تحميل أُطر الامتثال.',
    assuranceLoadError: 'تعذّر تحميل وضع الضمان الداخلي.',
    noFrameworksTitle: 'لا توجد أُطر ضوابط منشورة',
    noFrameworksDescription:
      'لا تتوفر أُطر امتثال لهذا المستأجر بعد. تظهر الأُطر هنا بمجرد نشرها في كتالوج ضمان الاسترداد.',
    noAssuranceTitle: 'لا يوجد تقييم ضمان بعد',
    noAssuranceDescription:
      'يظهر وضع الضمان الداخلي بمجرد تقييم المجموعة النشطة مقابل كتالوج ضوابط الضمان.',

    // Framework family display names.
    familyHeadingFallback: 'إطار تنظيمي',
  },
};

/**
 * React hook returning the active-locale-resolved compliance-posture labels.
 * Reads the active locale via `useLocaleOrDefault` (defaults to English under the
 * test `en` LocaleProvider and outside any provider) and memoizes by locale.
 */
export function useComplianceLabels(): CompliancePostureLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(compliancePostureLabels, locale), [locale]);
}
