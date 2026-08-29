'use client';

/**
 * Self-contained bilingual (English + Modern Standard Arabic) label bundle for
 * the Portfolio Risk & Value dashboard (features #18 risk distribution and #19
 * contract value / renewal cliff).
 *
 * Follows the canonical lex bilingual contract (see `lex/_lib/lex-i18n.ts`):
 * a `LexBilingual<T>` = two FULL, same-shaped copies of the label object; the
 * component receives the RESOLVED `T` from `useRiskLabels()`. This is local to
 * the risk route — it NEVER edits the shared i18n file. Enum-keyed maps for risk
 * level, matter priority and obligation type let the surface label the same enum
 * values the contracts / matters / obligations domains use without importing
 * those domains' (much larger) label objects.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLexBilingual, type LexBilingual } from '../../../_lib/lex-i18n';
import type {
  LexRiskLevel,
  LexLegalPriority,
  LexObligationType,
} from '@/types/suites';
// Type-only import (erased at build) — avoids a runtime cycle with the register
// hook, which imports `riskBandForScore` from this module.
import type { ComplianceStatus, RiskDomain, RiskSeverity } from './use-risk-register';

/** The three risk bands the donut + gauge roll the granular score into. */
export type RiskBand = 'high' | 'medium' | 'low';

export interface RiskLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    refresh: string;
  };
  kpi: {
    portfolioValue: string;
    activeValue: string;
    valueAtRisk: string;
    highRiskShare: string;
    expiring90: string;
    avgRiskScore: string;
    contracts: string;
    perScore: string;
    ofPortfolio: string;
  };
  kpiDetails: {
    portfolioValue: string;
    activeValue: string;
    valueAtRisk: string;
    highRiskShare: string;
    expiring90: string;
    avgRiskScore: string;
    portfolioShare: string;
    activeExposure: string;
    scoredContracts: string;
  };
  risk: {
    title: string;
    description: string;
    gaugeTitle: string;
    gaugeLabel: string;
    donutTitle: string;
    donutDescription: string;
    donutCenter: string;
    bandTrendTitle: string;
    bandTrendDescription: string;
    scored: string;
    unscored: string;
    contracts: string;
    empty: string;
    emptyHint: string;
  };
  urgency: {
    title: string;
    description: string;
    open: string;
    overdue: string;
    matters: string;
    empty: string;
  };
  maturity: {
    title: string;
    description: string;
    obligations: string;
    valueAxis: string;
    overdue: string;
    next30: string;
    next90: string;
    later: string;
    empty: string;
  };
  cliff: {
    title: string;
    description: string;
    valueAxis: string;
    count: string;
    contractsExpiring: (count: number) => string;
    peakMonth: string;
    empty: string;
    emptyHint: string;
  };
  register: {
    title: string;
    description: string;
    searchPlaceholder: string;
    filterAll: string;
    colRecord: string;
    colSeverity: string;
    colObligations: string;
    colControls: string;
    colCompliance: string;
    expand: string;
    obligationsLabel: string;
    overdueLabel: string;
    controlsLabel: string;
    failingLabel: string;
    relationsObligations: string;
    relationsControls: string;
    noObligations: string;
    noControls: string;
    noFailingControls: string;
    noLegsForDomain: string;
    derivedNote: string;
    openRecord: string;
    empty: string;
    emptyHint: string;
    severity: Record<RiskSeverity, string>;
    compliance: Record<ComplianceStatus, string>;
    domains: Record<RiskDomain, string>;
  };
  obligationsPanel: {
    title: string;
    description: string;
    colObligation: string;
    colLinked: string;
    colOwner: string;
    colDue: string;
    colStatus: string;
    empty: string;
    emptyHint: string;
    overdue: string;
    unlinked: string;
    linkHint: string;
  };
  bands: Record<RiskBand, string>;
  priority: Record<LexLegalPriority, string>;
  obligationType: Record<LexObligationType, string>;
}

const labels: LexBilingual<RiskLabels> = {
  en: {
    page: {
      eyebrow: 'Portfolio Intelligence',
      title: 'Risk Portfolio',
      description:
        'One consolidated view of risk across every legal domain — each record linked to its obligations, controls and compliance status, alongside portfolio value and the renewal cliff ahead.',
      refresh: 'Refresh',
    },
    kpi: {
      portfolioValue: 'Portfolio value',
      activeValue: 'Active value',
      valueAtRisk: 'Value at risk',
      highRiskShare: 'High-risk share',
      expiring90: 'Expiring (90d)',
      avgRiskScore: 'Avg. risk score',
      contracts: 'contracts',
      perScore: '/ 100',
      ofPortfolio: 'of portfolio',
    },
    kpiDetails: {
      portfolioValue: 'Total contract value represented in the risk sample.',
      activeValue: 'Live contract value currently in force.',
      valueAtRisk: 'Active value carried by high-risk contracts.',
      highRiskShare: 'Share of scored contracts in the high-risk band.',
      expiring90: 'Active contracts expiring within the next 90 days.',
      avgRiskScore: 'Weighted portfolio risk score across active value.',
      portfolioShare: 'Portfolio share',
      activeExposure: 'Active exposure',
      scoredContracts: 'Scored contracts',
    },
    risk: {
      title: 'Risk distribution',
      description: 'How contract risk is spread across the active portfolio.',
      gaugeTitle: 'Portfolio risk index',
      gaugeLabel: 'Weighted risk',
      donutTitle: 'Risk bands',
      donutDescription: 'Share of scored contracts by high / medium / low risk.',
      donutCenter: 'Scored',
      bandTrendTitle: 'Risk by score band',
      bandTrendDescription: 'Contract count across the 0–100 risk-score range.',
      scored: 'Scored',
      unscored: 'Awaiting analysis',
      contracts: 'Contracts',
      empty: 'No risk-scored contracts',
      emptyHint: 'Once contracts are analyzed, the risk distribution appears here.',
    },
    urgency: {
      title: 'Matter urgency',
      description: 'Open matters by priority, with overdue matters highlighted.',
      open: 'Open',
      overdue: 'Overdue',
      matters: 'Matters',
      empty: 'No open matters to chart',
    },
    maturity: {
      title: 'Obligation maturity',
      description: 'Open obligations bucketed by how soon they fall due.',
      obligations: 'Obligations',
      valueAxis: 'Obligations',
      overdue: 'Overdue',
      next30: 'Next 30 days',
      next90: 'Next 90 days',
      later: 'Later',
      empty: 'No open obligations to chart',
    },
    cliff: {
      title: 'Renewal cliff',
      description: 'Active contract value expiring over the next 12 months.',
      valueAxis: 'Value (SAR)',
      count: 'Contracts',
      contractsExpiring: (count) => `${count} contract${count === 1 ? '' : 's'} expiring`,
      peakMonth: 'Peak exposure',
      empty: 'No upcoming expiries',
      emptyHint: 'Active contracts with an expiry date in the next year appear here.',
    },
    register: {
      title: 'Risk register',
      description:
        'Every risk-bearing record across the suite. Each row fans out to its obligations and controls — expand to trace the relationships.',
      searchPlaceholder: 'Search records…',
      filterAll: 'All',
      colRecord: 'Record',
      colSeverity: 'Risk',
      colObligations: 'Obligations',
      colControls: 'Controls',
      colCompliance: 'Compliance',
      expand: 'Expand relationships',
      obligationsLabel: 'obligations',
      overdueLabel: 'overdue',
      controlsLabel: 'controls',
      failingLabel: 'failing',
      relationsObligations: 'Obligations',
      relationsControls: 'Controls & compliance',
      noObligations: 'No open obligations linked to this record.',
      noControls: 'No compliance controls apply to this record.',
      noFailingControls: 'All applicable controls are passing.',
      noLegsForDomain:
        'This domain tracks risk without a contract link, so it has no obligations or controls of its own.',
      derivedNote: 'Priority-only record — no linked obligations or controls in the data.',
      openRecord: 'Open record',
      empty: 'No risk records match',
      emptyHint: 'Adjust the filters, or add contracts, cases and other records to populate the register.',
      severity: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
        none: 'Unscored',
      },
      compliance: {
        healthy: 'Healthy',
        watch: 'Watch',
        at_risk: 'At risk',
        none: 'No controls',
      },
      domains: {
        contract: 'Contracts',
        case: 'Cases',
        request: 'Requests',
        investigation: 'Investigations',
        consultation: 'Consultations',
        settlement: 'Settlements',
      },
    },
    obligationsPanel: {
      title: 'Obligations',
      description:
        'The full obligation ledger, now here on the Risk Portfolio. Each obligation traces back to the contract it protects.',
      colObligation: 'Obligation',
      colLinked: 'Linked contract',
      colOwner: 'Owner',
      colDue: 'Due',
      colStatus: 'Status',
      empty: 'No obligations yet',
      emptyHint: 'Obligations created against contracts appear here.',
      overdue: 'Overdue',
      unlinked: 'Unlinked',
      linkHint: 'Open in obligations',
    },
    bands: {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    priority: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    obligationType: {
      contractual: 'Contractual',
      renewal: 'Renewal',
      notice: 'Notice',
      payment: 'Payment',
      delivery: 'Delivery',
      reporting: 'Reporting',
      compliance: 'Compliance',
      covenant: 'Covenant',
      condition_precedent: 'Condition precedent',
      regulatory: 'Regulatory',
      other: 'Other',
    },
  },
  ar: {
    page: {
      eyebrow: 'ذكاء المحفظة',
      title: 'محفظة المخاطر',
      description:
        'عرض موحّد للمخاطر عبر جميع المجالات القانونية — كل سجل مرتبط بالتزاماته وضوابطه وحالة امتثاله، إلى جانب قيمة المحفظة ومنحدر التجديد القادم.',
      refresh: 'تحديث',
    },
    kpi: {
      portfolioValue: 'قيمة المحفظة',
      activeValue: 'القيمة النشطة',
      valueAtRisk: 'القيمة المعرّضة للخطر',
      highRiskShare: 'نسبة المخاطر العالية',
      expiring90: 'تنتهي خلال ٩٠ يومًا',
      avgRiskScore: 'متوسط درجة المخاطر',
      contracts: 'عقد',
      perScore: '/ ١٠٠',
      ofPortfolio: 'من المحفظة',
    },
    kpiDetails: {
      portfolioValue: 'إجمالي قيمة العقود الممثلة في عينة المخاطر.',
      activeValue: 'قيمة العقود السارية حاليًا.',
      valueAtRisk: 'القيمة النشطة المحمولة على عقود عالية المخاطر.',
      highRiskShare: 'حصة العقود المقيّمة ضمن فئة المخاطر العالية.',
      expiring90: 'عقود نشطة تنتهي خلال التسعين يومًا القادمة.',
      avgRiskScore: 'درجة المخاطر المرجّحة عبر القيمة النشطة.',
      portfolioShare: 'حصة المحفظة',
      activeExposure: 'الانكشاف النشط',
      scoredContracts: 'العقود المقيّمة',
    },
    risk: {
      title: 'توزيع المخاطر',
      description: 'كيفية توزّع مخاطر العقود عبر المحفظة النشطة.',
      gaugeTitle: 'مؤشر مخاطر المحفظة',
      gaugeLabel: 'المخاطر المرجّحة',
      donutTitle: 'فئات المخاطر',
      donutDescription: 'نسبة العقود المقيّمة بحسب المخاطر العالية / المتوسطة / المنخفضة.',
      donutCenter: 'مقيّمة',
      bandTrendTitle: 'المخاطر حسب نطاق الدرجة',
      bandTrendDescription: 'عدد العقود عبر نطاق درجة المخاطر من ٠ إلى ١٠٠.',
      scored: 'مقيّمة',
      unscored: 'بانتظار التحليل',
      contracts: 'العقود',
      empty: 'لا توجد عقود مقيّمة بالمخاطر',
      emptyHint: 'عند تحليل العقود، يظهر توزيع المخاطر هنا.',
    },
    urgency: {
      title: 'إلحاح القضايا',
      description: 'القضايا المفتوحة بحسب الأولوية مع إبراز المتأخرة.',
      open: 'مفتوحة',
      overdue: 'متأخرة',
      matters: 'القضايا',
      empty: 'لا توجد قضايا مفتوحة لعرضها',
    },
    maturity: {
      title: 'استحقاق الالتزامات',
      description: 'الالتزامات المفتوحة مصنّفة بحسب قرب موعد استحقاقها.',
      obligations: 'الالتزامات',
      valueAxis: 'الالتزامات',
      overdue: 'متأخرة',
      next30: 'خلال ٣٠ يومًا',
      next90: 'خلال ٩٠ يومًا',
      later: 'لاحقًا',
      empty: 'لا توجد التزامات مفتوحة لعرضها',
    },
    cliff: {
      title: 'منحدر التجديد',
      description: 'قيمة العقود النشطة المنتهية خلال الأشهر الاثني عشر القادمة.',
      valueAxis: 'القيمة (ريال)',
      count: 'العقود',
      contractsExpiring: (count) => `${count} عقد ينتهي`,
      peakMonth: 'ذروة التعرّض',
      empty: 'لا توجد انتهاءات قادمة',
      emptyHint: 'تظهر هنا العقود النشطة التي ينتهي أجلها خلال العام القادم.',
    },
    register: {
      title: 'سجل المخاطر',
      description:
        'كل سجل يحمل مخاطر عبر المنظومة. يتفرّع كل صف إلى التزاماته وضوابطه — وسّع الصف لتتبّع العلاقات.',
      searchPlaceholder: 'ابحث في السجلات…',
      filterAll: 'الكل',
      colRecord: 'السجل',
      colSeverity: 'المخاطر',
      colObligations: 'الالتزامات',
      colControls: 'الضوابط',
      colCompliance: 'الامتثال',
      expand: 'عرض العلاقات',
      obligationsLabel: 'التزام',
      overdueLabel: 'متأخر',
      controlsLabel: 'ضابط',
      failingLabel: 'مُخفق',
      relationsObligations: 'الالتزامات',
      relationsControls: 'الضوابط والامتثال',
      noObligations: 'لا توجد التزامات مفتوحة مرتبطة بهذا السجل.',
      noControls: 'لا تنطبق أي ضوابط امتثال على هذا السجل.',
      noFailingControls: 'جميع الضوابط المنطبقة ناجحة.',
      noLegsForDomain:
        'يتتبّع هذا المجال المخاطر دون ارتباط بعقد، لذا لا توجد له التزامات أو ضوابط خاصة.',
      derivedNote: 'سجل قائم على الأولوية فقط — لا توجد التزامات أو ضوابط مرتبطة في البيانات.',
      openRecord: 'فتح السجل',
      empty: 'لا توجد سجلات مخاطر مطابقة',
      emptyHint: 'عدّل عوامل التصفية أو أضف عقودًا وقضايا وسجلات أخرى لملء السجل.',
      severity: {
        critical: 'حرجة',
        high: 'عالية',
        medium: 'متوسطة',
        low: 'منخفضة',
        none: 'غير مقيّمة',
      },
      compliance: {
        healthy: 'سليم',
        watch: 'مراقبة',
        at_risk: 'معرّض للخطر',
        none: 'لا ضوابط',
      },
      domains: {
        contract: 'العقود',
        case: 'القضايا',
        request: 'الطلبات',
        investigation: 'التحقيقات',
        consultation: 'الاستشارات',
        settlement: 'التسويات',
      },
    },
    obligationsPanel: {
      title: 'الالتزامات',
      description:
        'سجل الالتزامات الكامل، وهو الآن هنا ضمن محفظة المخاطر. يعود كل التزام إلى العقد الذي يحميه.',
      colObligation: 'الالتزام',
      colLinked: 'العقد المرتبط',
      colOwner: 'المسؤول',
      colDue: 'الاستحقاق',
      colStatus: 'الحالة',
      empty: 'لا توجد التزامات بعد',
      emptyHint: 'تظهر هنا الالتزامات المنشأة على العقود.',
      overdue: 'متأخر',
      unlinked: 'غير مرتبط',
      linkHint: 'فتح في الالتزامات',
    },
    bands: {
      high: 'عالية',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
    priority: {
      critical: 'حرجة',
      high: 'عالية',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
    obligationType: {
      contractual: 'تعاقدي',
      renewal: 'تجديد',
      notice: 'إشعار',
      payment: 'دفع',
      delivery: 'تسليم',
      reporting: 'تقارير',
      compliance: 'امتثال',
      covenant: 'تعهّد',
      condition_precedent: 'شرط مسبق',
      regulatory: 'تنظيمي',
      other: 'أخرى',
    },
  },
};

/** Map a granular 0–100 risk score (or a coarse level) into a high/med/low band. */
export function riskBandForScore(
  score: number | null | undefined,
  level: LexRiskLevel | null | undefined,
): RiskBand | null {
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }
  switch (level) {
    case 'critical':
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return null;
  }
}

/** React hook: resolves the risk labels for the active locale. */
export function useRiskLabels(): RiskLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(labels, locale), [locale]);
}
