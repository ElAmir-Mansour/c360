/**
 * insights-labels.ts — feature-local bilingual copy for the ClarioDR Ops-insights
 * view (`/dr/insights`).
 *
 * Per the console's bilingual contract, NEW user-facing strings live in a
 * feature-local `DRBilingual<InsightsLabels>` bundle (two full same-shaped copies:
 * English + professional MSA Arabic) resolved against the active locale by
 * {@link useInsightsLabels} (English fallback). The `renderWithQuery` `en` default
 * keeps existing English assertions green while an Arabic user sees the full MSA
 * surface.
 *
 * Functions are used for the few strings that interpolate real counts so the
 * surrounding components never concatenate raw values into prose; each function
 * keeps the SAME signature/params across both locales — only the literal copy and
 * word order differ.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface InsightsLabels {
  pageTitle: string;
  pageDescription: string;
  fromRealHistoryNote: string;
  groupScopeNote: (groupName: string) => string;

  emptyTitle: string;
  emptyDescription: string;
  emptyAction: string;

  errorTitle: string;
  retry: string;

  // Metric tiles.
  attainmentLabel: string;
  attainmentCaption: (met: number, measured: number) => string;
  medianDurationLabel: string;
  p90DurationLabel: string;
  drillPassRateLabel: string;
  drillPassCaption: (passed: number, total: number) => string;
  rpoBreachLabel: string;
  rpoBreachCaption: (breaching: number, total: number) => string;
  activeRunsLabel: string;
  failedRunsLabel: string;

  // Run-performance section.
  runSectionTitle: string;
  runSectionDescription: string;
  durationChartTitle: string;
  durationSeriesActual: string;
  durationSeriesObjective: string;
  runEmptyTitle: string;
  runEmptyDescription: string;

  // Drill-trend section.
  drillSectionTitle: string;
  drillSectionDescription: string;
  drillTrendChartTitle: string;
  drillSeriesPassRate: string;
  drillSeriesTotal: string;
  drillLastRunLabel: string;
  drillEmptyTitle: string;
  drillEmptyDescription: string;

  // RPO-breach section.
  rpoSectionTitle: string;
  rpoSectionDescription: string;
  rpoPointInTimeNote: string;
  rpoColStream: string;
  rpoColSite: string;
  rpoColRpo: string;
  rpoColObjective: string;
  rpoNoneTitle: string;
  rpoNoneDescription: string;

  naLabel: string;
  secondsSuffix: string;
}

const insightsEn: InsightsLabels = {
  pageTitle: 'Operational insights',
  pageDescription:
    'Recovery performance derived from real failover-run and drill history for the selected protection group.',
  fromRealHistoryNote:
    'Every metric is computed from recorded failover runs, drill results, and current replication posture — no estimates.',
  groupScopeNote: (groupName) => `Drill metrics scoped to ${groupName}.`,

  emptyTitle: 'No recovery history yet',
  emptyDescription:
    'Once failover runs and rehearsal drills have been executed, attainment, duration, and cadence trends appear here.',
  emptyAction: 'Go to Rehearse',

  errorTitle: 'Could not load insights data',
  retry: 'Try again',

  attainmentLabel: 'RTO attainment',
  attainmentCaption: (met, measured) => `${met} of ${measured} recent runs met RTO`,
  medianDurationLabel: 'Median run time',
  p90DurationLabel: 'p90 run time',
  drillPassRateLabel: 'Drill pass rate',
  drillPassCaption: (passed, total) => `${passed} of ${total} drills passed`,
  rpoBreachLabel: 'RPO breaches',
  rpoBreachCaption: (breaching, total) => `${breaching} of ${total} streams breaching`,
  activeRunsLabel: 'Runs in flight',
  failedRunsLabel: 'Failed runs',

  runSectionTitle: 'Failover-run performance',
  runSectionDescription:
    'Actual recovery time per terminal run against its RTO objective, recent runs left to right.',
  durationChartTitle: 'Run duration vs RTO objective',
  durationSeriesActual: 'Actual (s)',
  durationSeriesObjective: 'Objective (s)',
  runEmptyTitle: 'No completed runs',
  runEmptyDescription: 'Terminal failover runs will plot here once recoveries complete.',

  drillSectionTitle: 'Rehearsal drill cadence',
  drillSectionDescription:
    'Drills executed per month and the share that passed, oldest month first.',
  drillTrendChartTitle: 'Drills per month and pass rate',
  drillSeriesPassRate: 'Pass rate (%)',
  drillSeriesTotal: 'Drills',
  drillLastRunLabel: 'Last drill',
  drillEmptyTitle: 'No drills recorded',
  drillEmptyDescription: 'Scheduled and ad-hoc drills appear here once they have been observed.',

  rpoSectionTitle: 'Replication / RPO breaches',
  rpoSectionDescription: 'Streams whose current data-loss window exceeds their RPO objective.',
  rpoPointInTimeNote:
    'This is the current replication posture (a live snapshot), not a historical breach rate.',
  rpoColStream: 'Stream',
  rpoColSite: 'Site',
  rpoColRpo: 'Current RPO',
  rpoColObjective: 'Objective',
  rpoNoneTitle: 'No streams breaching RPO',
  rpoNoneDescription: 'All tracked replication streams are currently within their RPO objective.',

  naLabel: '—',
  secondsSuffix: 's',
};

const insightsAr: InsightsLabels = {
  pageTitle: 'الرؤى التشغيلية',
  pageDescription:
    'أداء الاسترداد مُشتقّ من السجل الفعلي لعمليات تجاوز الفشل والتمارين لمجموعة الحماية المختارة.',
  fromRealHistoryNote:
    'كل مقياس مُحتسَب من عمليات تجاوز الفشل المُسجَّلة ونتائج التمارين ووضع النسخ المتماثل الحالي — دون أي تقديرات.',
  groupScopeNote: (groupName) => `مقاييس التمارين محصورة بنطاق ${groupName}.`,

  emptyTitle: 'لا يوجد سجل استرداد بعد',
  emptyDescription:
    'بمجرد تنفيذ عمليات تجاوز الفشل وتمارين المحاكاة، تظهر هنا اتجاهات بلوغ الأهداف والمدة والوتيرة.',
  emptyAction: 'الانتقال إلى التمارين',

  errorTitle: 'تعذّر تحميل بيانات الرؤى',
  retry: 'إعادة المحاولة',

  attainmentLabel: 'بلوغ هدف زمن الاسترداد (RTO)',
  attainmentCaption: (met, measured) =>
    `${met} من ${measured} من العمليات الأخيرة بلغت هدف زمن الاسترداد (RTO)`,
  medianDurationLabel: 'وسيط زمن العملية',
  p90DurationLabel: 'زمن العملية عند المئين 90',
  drillPassRateLabel: 'معدّل نجاح التمارين',
  drillPassCaption: (passed, total) => `${passed} من ${total} تمرين نجحت`,
  rpoBreachLabel: 'تجاوزات نقطة الاسترداد (RPO)',
  rpoBreachCaption: (breaching, total) => `${breaching} من ${total} تدفّق يتجاوز الهدف`,
  activeRunsLabel: 'عمليات جارية',
  failedRunsLabel: 'عمليات فاشلة',

  runSectionTitle: 'أداء عمليات تجاوز الفشل',
  runSectionDescription:
    'زمن الاسترداد الفعلي لكل عملية منتهية مقابل هدف زمن الاسترداد (RTO) الخاص بها، العمليات الأحدث من البداية إلى النهاية.',
  durationChartTitle: 'مدة العملية مقابل هدف زمن الاسترداد (RTO)',
  durationSeriesActual: 'الفعلي (ث)',
  durationSeriesObjective: 'الهدف (ث)',
  runEmptyTitle: 'لا توجد عمليات مكتملة',
  runEmptyDescription: 'سترسَم عمليات تجاوز الفشل المنتهية هنا بمجرد اكتمال عمليات الاسترداد.',

  drillSectionTitle: 'وتيرة تمارين المحاكاة',
  drillSectionDescription:
    'التمارين المنفَّذة شهريًا والنسبة التي نجحت، الأقدم شهرًا أولًا.',
  drillTrendChartTitle: 'عدد التمارين شهريًا ومعدّل النجاح',
  drillSeriesPassRate: 'معدّل النجاح (٪)',
  drillSeriesTotal: 'التمارين',
  drillLastRunLabel: 'آخر تمرين',
  drillEmptyTitle: 'لم تُسجَّل أي تمارين',
  drillEmptyDescription: 'تظهر التمارين المجدوَلة والطارئة هنا بمجرد رصدها.',

  rpoSectionTitle: 'النسخ المتماثل / تجاوزات نقطة الاسترداد (RPO)',
  rpoSectionDescription: 'التدفّقات التي تتجاوز نافذة فقدان البيانات الحالية لها هدف نقطة الاسترداد (RPO).',
  rpoPointInTimeNote:
    'هذا هو وضع النسخ المتماثل الحالي (لقطة حيّة)، وليس معدّل تجاوز تاريخيًا.',
  rpoColStream: 'التدفّق',
  rpoColSite: 'الموقع',
  rpoColRpo: 'نقطة الاسترداد (RPO) الحالية',
  rpoColObjective: 'الهدف',
  rpoNoneTitle: 'لا توجد تدفّقات تتجاوز نقطة الاسترداد (RPO)',
  rpoNoneDescription: 'جميع تدفّقات النسخ المتماثل المتتبَّعة ضمن هدف نقطة الاسترداد (RPO) حاليًا.',

  naLabel: '—',
  secondsSuffix: 'ث',
};

/**
 * Bilingual bundle (English + professional MSA). Consumers resolve it via
 * {@link useInsightsLabels}; pure callers use {@link resolveDRBilingual}.
 */
export const insightsLabelBundle: DRBilingual<InsightsLabels> = {
  en: insightsEn,
  ar: insightsAr,
};

/**
 * useInsightsLabels resolves the ops-insights copy against the active locale
 * (English fallback), mirroring {@link useDRLabels}. Memoised by locale.
 */
export function useInsightsLabels(): InsightsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(insightsLabelBundle, locale), [locale]);
}
