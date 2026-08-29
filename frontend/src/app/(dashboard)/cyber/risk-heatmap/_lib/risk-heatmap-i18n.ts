/**
 * Bilingual (English + Modern Standard Arabic) labels for the Cyber Risk
 * Heatmap (`/cyber/risk-heatmap`). Follows the `{ en, ar }` bundle + hook
 * pattern of `../../_lib/cyber-i18n`.
 *
 * Acronyms / product names stay as-is: CTEM.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type CyberBilingual,
  resolveCyberBilingual,
} from '../../_lib/cyber-i18n';

export interface RiskHeatmapLabels {
  // page
  pageTitle: string;
  pageDescription: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  // grid axis & total
  total: string;
  gridAriaLabel: string;
  // severity column labels (also used in summary table header)
  severityCritical: string;
  severityHigh: string;
  severityMedium: string;
  severityLow: string;
  severityInfo: string;
  // legend
  legendIntensity: string;
  // summary table
  keyInsights: string;
  insightHighestRiskLabel: string;
  insightHighestRisk: (count: number, severity: string, assetType: string) => string;
  insightMostVulnerableLabel: string;
  insightMostVulnerable: (assetType: string, count: number, percent: string) => string;
  insightLeastCoveredLabel: string;
  insightLeastCovered: (assetType: string, ratio: string) => string;
  colAssetType: string;
  // cell tooltip
  cellTooltipCount: (count: number, severity: string, assetType: string) => string;
  cellTooltipAffecting: (affected: number, totalOfType: number) => string;
  cellTooltipClick: string;
}

export const riskHeatmapLabels: CyberBilingual<RiskHeatmapLabels> = {
  en: {
    pageTitle: 'Risk Heatmap',
    pageDescription: 'Vulnerability distribution across asset types and severity levels',
    loadError: 'Failed to load risk heatmap',
    emptyTitle: 'No vulnerability data available',
    emptyDescription: 'Run a CTEM assessment or asset scan to populate the risk heatmap.',
    total: 'Total',
    gridAriaLabel: 'Risk heatmap showing vulnerability distribution',
    severityCritical: 'Critical',
    severityHigh: 'High',
    severityMedium: 'Medium',
    severityLow: 'Low',
    severityInfo: 'Info',
    legendIntensity: 'Intensity:',
    keyInsights: 'Key Insights',
    insightHighestRiskLabel: 'Highest risk:',
    insightHighestRisk: (count, severity, assetType) =>
      `${count} ${severity} vulnerabilities on ${assetType} assets.`,
    insightMostVulnerableLabel: 'Most vulnerable asset type:',
    insightMostVulnerable: (assetType, count, percent) =>
      `${assetType} with ${count} open vulnerabilities (${percent}% of total).`,
    insightLeastCoveredLabel: 'Least covered:',
    insightLeastCovered: (assetType, ratio) =>
      `${assetType} assets have the highest vuln-to-asset ratio (${ratio}).`,
    colAssetType: 'Asset Type',
    cellTooltipCount: (count, severity, assetType) =>
      `${count} ${severity} vulnerabilities on ${assetType} assets`,
    cellTooltipAffecting: (affected, totalOfType) =>
      `Affecting ${affected} of ${totalOfType} assets`,
    cellTooltipClick: 'Click to view →',
  },
  ar: {
    pageTitle: 'خريطة المخاطر الحرارية',
    pageDescription: 'توزيع الثغرات عبر أنواع الأصول ومستويات الخطورة',
    loadError: 'تعذّر تحميل خريطة المخاطر الحرارية',
    emptyTitle: 'لا تتوفّر بيانات عن الثغرات',
    emptyDescription: 'نفّذ تقييم CTEM أو فحص الأصول لملء خريطة المخاطر الحرارية.',
    total: 'الإجمالي',
    gridAriaLabel: 'خريطة حرارية للمخاطر توضّح توزيع الثغرات',
    severityCritical: 'حرج',
    severityHigh: 'عالٍ',
    severityMedium: 'متوسط',
    severityLow: 'منخفض',
    severityInfo: 'معلوماتي',
    legendIntensity: 'الكثافة:',
    keyInsights: 'أبرز الملاحظات',
    insightHighestRiskLabel: 'أعلى مخاطرة:',
    insightHighestRisk: (count, severity, assetType) =>
      `${count} ثغرة بخطورة ${severity} على أصول ${assetType}.`,
    insightMostVulnerableLabel: 'أكثر أنواع الأصول عرضةً للثغرات:',
    insightMostVulnerable: (assetType, count, percent) =>
      `${assetType} بإجمالي ${count} ثغرة مفتوحة (${percent}% من الإجمالي).`,
    insightLeastCoveredLabel: 'الأقل تغطيةً:',
    insightLeastCovered: (assetType, ratio) =>
      `أصول ${assetType} لديها أعلى نسبة ثغرات لكل أصل (${ratio}).`,
    colAssetType: 'نوع الأصل',
    cellTooltipCount: (count, severity, assetType) =>
      `${count} ثغرة بخطورة ${severity} على أصول ${assetType}`,
    cellTooltipAffecting: (affected, totalOfType) =>
      `تؤثّر على ${affected} من ${totalOfType} أصلًا`,
    cellTooltipClick: 'انقر للعرض ←',
  },
};

export function useRiskHeatmapLabels(): RiskHeatmapLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(riskHeatmapLabels, locale), [locale]);
}
