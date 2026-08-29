/**
 * Bilingual (English + Modern Standard Arabic) labels for the Cyber Threat
 * Analytics console (`/cyber/analytics`). Follows the same `{ en, ar }` bundle
 * + `use*Labels()` hook pattern as `../../_lib/cyber-i18n`.
 *
 * Acronyms / product names stay as-is: MITRE ATT&CK, IOC, ML.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type CyberBilingual,
  resolveCyberBilingual,
} from '../../_lib/cyber-i18n';

export interface CyberAnalyticsLabels {
  // page header
  pageTitle: string;
  pageDescription: string;
  tagPredictive: string;
  tagCampaign: string;
  tagTechniqueTrends: string;
  retry: string;
  // threat landscape
  landscapeHeading: string;
  landscapeError: string;
  kpiActiveThreats: string;
  kpiTotalIocs: string;
  kpiTopThreatType: string;
  chartThreatsByType: string;
  chartThreatsBySeverity: string;
  centerTypes: string;
  centerThreats: string;
  // threat forecast
  forecastTitle: string;
  forecastDescription: string;
  forecastError: string;
  forecastEmpty: string;
  colTechnique: string;
  colGrowth: string;
  colPredictedP50: string;
  colRangeP10P90: string;
  // alert volume forecast
  alertForecastTitle: string;
  alertForecastTitleWindow: string;
  alertForecastError: string;
  alertForecastInsufficient: string;
  seriesPredicted: string;
  seriesUpperBound: string;
  seriesLowerBound: string;
  // technique trends
  trendsTitle: string;
  trendsError: string;
  trendsEmpty: string;
  colId: string;
  colTrend: string;
  // trend value words (data-driven 'increasing'/'decreasing'/'stable')
  trendIncreasing: string;
  trendDecreasing: string;
  trendStable: string;
  // campaign detection
  campaignHeading: string;
  campaignError: string;
  campaignEmpty: string;
  campaignTitle: (id: string) => string;
  campaignAlerts: string;
  campaignConfidence: string;
  campaignStart: string;
  campaignEnd: string;
  campaignMitreTechniques: string;
  campaignSharedIocs: string;
  campaignInvestigate: string;
  // campaign stage enum keys
  stageReconnaissance: string;
  stageActiveAttack: string;
  stageExpandedCampaign: string;
}

export const cyberAnalyticsLabels: CyberBilingual<CyberAnalyticsLabels> = {
  en: {
    pageTitle: 'Threat Analytics',
    pageDescription:
      'Predictive intelligence, campaign detection, and attack technique trend analysis powered by ML models.',
    tagPredictive: 'Predictive intelligence',
    tagCampaign: 'Campaign detection',
    tagTechniqueTrends: 'Technique trends',
    retry: 'Retry',
    landscapeHeading: 'Threat Landscape',
    landscapeError: 'Failed to load threat landscape data.',
    kpiActiveThreats: 'Active Threats',
    kpiTotalIocs: 'Total IOCs',
    kpiTopThreatType: 'Top Threat Type',
    chartThreatsByType: 'Threats by Type',
    chartThreatsBySeverity: 'Threats by Severity',
    centerTypes: 'types',
    centerThreats: 'threats',
    forecastTitle: 'Emerging Threats — 7-Day Forecast',
    forecastDescription:
      'Attack techniques predicted to increase in activity over the next 7 days, ranked by growth rate.',
    forecastError: 'Failed to load threat forecast.',
    forecastEmpty: 'No techniques are forecasted to increase in the next 7 days.',
    colTechnique: 'Technique',
    colGrowth: 'Growth',
    colPredictedP50: 'Predicted (p50)',
    colRangeP10P90: 'Range (p10–p90)',
    alertForecastTitle: 'Alert Volume Forecast',
    alertForecastTitleWindow: 'Alert Volume Forecast (30 Days)',
    alertForecastError: 'Failed to load alert volume forecast.',
    alertForecastInsufficient: 'Insufficient data to generate alert volume forecast.',
    seriesPredicted: 'Predicted',
    seriesUpperBound: 'Upper Bound',
    seriesLowerBound: 'Lower Bound',
    trendsTitle: 'Attack Technique Trends (30 Days)',
    trendsError: 'Failed to load technique trend data.',
    trendsEmpty: 'No technique trend data available yet.',
    colId: 'ID',
    colTrend: 'Trend',
    trendIncreasing: 'increasing',
    trendDecreasing: 'decreasing',
    trendStable: 'stable',
    campaignHeading: 'Campaign Detection',
    campaignError: 'Failed to load campaign data.',
    campaignEmpty:
      'No active campaigns detected. The system correlates alerts by IOC overlap, MITRE technique overlap, and temporal proximity.',
    campaignTitle: (id) => `Campaign #${id}`,
    campaignAlerts: 'Alerts:',
    campaignConfidence: 'Confidence:',
    campaignStart: 'Start:',
    campaignEnd: 'End:',
    campaignMitreTechniques: 'MITRE Techniques:',
    campaignSharedIocs: 'Shared IOCs:',
    campaignInvestigate: 'Investigate Alerts',
    stageReconnaissance: 'reconnaissance',
    stageActiveAttack: 'active attack',
    stageExpandedCampaign: 'expanded campaign',
  },
  ar: {
    pageTitle: 'تحليلات التهديدات',
    pageDescription:
      'استخبارات تنبؤية، وكشف الحملات، وتحليل اتجاهات أساليب الهجوم بالاعتماد على نماذج التعلّم الآلي (ML).',
    tagPredictive: 'استخبارات تنبؤية',
    tagCampaign: 'كشف الحملات',
    tagTechniqueTrends: 'اتجاهات الأساليب',
    retry: 'إعادة المحاولة',
    landscapeHeading: 'مشهد التهديدات',
    landscapeError: 'تعذّر تحميل بيانات مشهد التهديدات.',
    kpiActiveThreats: 'التهديدات النشطة',
    kpiTotalIocs: 'إجمالي مؤشرات الاختراق (IOC)',
    kpiTopThreatType: 'أبرز نوع تهديد',
    chartThreatsByType: 'التهديدات حسب النوع',
    chartThreatsBySeverity: 'التهديدات حسب الخطورة',
    centerTypes: 'الأنواع',
    centerThreats: 'التهديدات',
    forecastTitle: 'التهديدات الناشئة — تنبؤ ٧ أيام',
    forecastDescription:
      'أساليب الهجوم المتوقَّع تزايد نشاطها خلال الأيام السبعة القادمة، مُرتَّبةً حسب معدل النمو.',
    forecastError: 'تعذّر تحميل تنبؤ التهديدات.',
    forecastEmpty: 'لا توجد أساليب يُتوقَّع تزايدها خلال الأيام السبعة القادمة.',
    colTechnique: 'الأسلوب',
    colGrowth: 'النمو',
    colPredictedP50: 'المتوقَّع (p50)',
    colRangeP10P90: 'النطاق (p10–p90)',
    alertForecastTitle: 'تنبؤ حجم التنبيهات',
    alertForecastTitleWindow: 'تنبؤ حجم التنبيهات (٣٠ يومًا)',
    alertForecastError: 'تعذّر تحميل تنبؤ حجم التنبيهات.',
    alertForecastInsufficient: 'البيانات غير كافية لتوليد تنبؤ حجم التنبيهات.',
    seriesPredicted: 'المتوقَّع',
    seriesUpperBound: 'الحد الأعلى',
    seriesLowerBound: 'الحد الأدنى',
    trendsTitle: 'اتجاهات أساليب الهجوم (٣٠ يومًا)',
    trendsError: 'تعذّر تحميل بيانات اتجاهات الأساليب.',
    trendsEmpty: 'لا تتوفّر بيانات عن اتجاهات الأساليب حتى الآن.',
    colId: 'المعرّف',
    colTrend: 'الاتجاه',
    trendIncreasing: 'تصاعدي',
    trendDecreasing: 'تنازلي',
    trendStable: 'مستقر',
    campaignHeading: 'كشف الحملات',
    campaignError: 'تعذّر تحميل بيانات الحملات.',
    campaignEmpty:
      'لم تُكتشف أي حملات نشطة. يربط النظام بين التنبيهات بناءً على تداخل مؤشرات الاختراق (IOC) وتداخل أساليب MITRE والتقارب الزمني.',
    campaignTitle: (id) => `الحملة رقم ${id}`,
    campaignAlerts: 'التنبيهات:',
    campaignConfidence: 'الثقة:',
    campaignStart: 'البداية:',
    campaignEnd: 'النهاية:',
    campaignMitreTechniques: 'أساليب MITRE:',
    campaignSharedIocs: 'مؤشرات الاختراق المشتركة (IOC):',
    campaignInvestigate: 'التحقيق في التنبيهات',
    stageReconnaissance: 'الاستطلاع',
    stageActiveAttack: 'هجوم نشط',
    stageExpandedCampaign: 'حملة موسّعة',
  },
};

export function useCyberAnalyticsLabels(): CyberAnalyticsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(cyberAnalyticsLabels, locale), [locale]);
}
