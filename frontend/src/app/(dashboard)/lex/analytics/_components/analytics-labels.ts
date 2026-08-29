'use client';

/**
 * Self-contained bilingual (English + Modern Standard Arabic) label bundle for
 * the Legal-Ops Analytics page (features #21 workload heatmap + #22 velocity /
 * cycle-time charts).
 *
 * Follows the canonical lex bilingual contract (see `lex/_lib/lex-i18n.ts`):
 * a `LexBilingual<T>` = two FULL, same-shaped copies of the label object; the
 * component receives the RESOLVED `T` from `useAnalyticsLabels()`. The `en`
 * side is the authoritative English surface; `ar` is professional MSA using the
 * established lex glossary (قضية / مكتب / مجال الممارسة / تسوية / دورة).
 *
 * This is intentionally local to the analytics route — it NEVER edits the shared
 * i18n file. It also exports small enum-keyed maps (case status / company side /
 * practice area) so the analytics surface labels the same enum values the cases
 * domain uses, without importing that domain's (much larger) label object.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLexBilingual, type LexBilingual } from '../../_lib/lex-i18n';
import type {
  CaseCompanyStatus,
  CaseStatus,
} from '@/lib/lex/cases';

export interface AnalyticsLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    refresh: string;
  };
  kpi: {
    activeMatters: string;
    closedThisQuarter: string;
    avgCycleDays: string;
    settlementCycleDays: string;
    weeklyThroughput: string;
    busiestOfficer: string;
    days: string;
    perWeek: string;
    noOfficer: string;
  };
  kpiDetails: {
    activeMatters: string;
    closedThisQuarter: string;
    avgCycleDays: string;
    settlementCycleDays: string;
    weeklyThroughput: string;
    busiestOfficer: string;
    workloadShare: string;
    recentWindow: string;
    throughputSignal: string;
  };
  heatmap: {
    title: string;
    description: string;
    officer: string;
    practiceArea: string;
    total: string;
    legendLight: string;
    legendHeavy: string;
    /** Tooltip builder: officer + area + count. */
    cellTooltip: (officer: string, area: string, count: number) => string;
    unassigned: string;
    empty: string;
    emptyHint: string;
    showActiveOnly: string;
  };
  velocity: {
    title: string;
    description: string;
    closedPerWeek: string;
    opened: string;
    closed: string;
    avgDaysInPhase: string;
    avgDaysInPhaseDesc: string;
    settlementCycle: string;
    settlementCycleDesc: string;
    week: string;
    cases: string;
    matters: string;
    daysAxis: string;
    settledValue: string;
    cycleDays: string;
    empty: string;
  };
  companyStatus: Record<CaseCompanyStatus, string>;
  status: Record<CaseStatus, string>;
  /**
   * Practice-area (case_type) display labels, keyed by the NORMALIZED case_type
   * (trimmed + lowercased). `case_type` is free text, so unknown keys fall back
   * to a humanized form; known keys render the professional legal label.
   */
  practiceAreas: Record<string, string>;
}

const labels: LexBilingual<AnalyticsLabels> = {
  en: {
    page: {
      eyebrow: 'Legal Operations',
      title: 'Legal-Ops Analytics',
      description:
        'Workload distribution and matter velocity across handling officers and practice areas.',
      refresh: 'Refresh',
    },
    kpi: {
      activeMatters: 'Active matters',
      closedThisQuarter: 'Closed (90d)',
      avgCycleDays: 'Avg. days to close',
      settlementCycleDays: 'Settlement cycle',
      weeklyThroughput: 'Weekly throughput',
      busiestOfficer: 'Busiest officer',
      days: 'days',
      perWeek: '/ week',
      noOfficer: '—',
    },
    kpiDetails: {
      activeMatters: 'Open matters currently represented in the analytics sample.',
      closedThisQuarter: 'Matters closed during the recent 90-day window.',
      avgCycleDays: 'Average elapsed time from open to close.',
      settlementCycleDays: 'Average settlement creation-to-execution cycle.',
      weeklyThroughput: 'Mean matters closed per week in the recent trend.',
      busiestOfficer: 'Officer carrying the largest active workload.',
      workloadShare: 'Workload share',
      recentWindow: 'Recent window',
      throughputSignal: 'Throughput signal',
    },
    heatmap: {
      title: 'Workload heatmap',
      description: 'Open matters by handling officer × practice area.',
      officer: 'Officer',
      practiceArea: 'Practice area',
      total: 'Total',
      legendLight: 'Lighter',
      legendHeavy: 'Heavier',
      cellTooltip: (officer, area, count) =>
        `${officer} · ${area}: ${count} matter${count === 1 ? '' : 's'}`,
      unassigned: 'Unassigned',
      empty: 'No matters to chart',
      emptyHint: 'Once cases are assigned to officers, the workload grid appears here.',
      showActiveOnly: 'Active only',
    },
    velocity: {
      title: 'Velocity & cycle time',
      description: 'Throughput and time-in-phase trends over the recent period.',
      closedPerWeek: 'Matters opened vs. closed per week',
      opened: 'Opened',
      closed: 'Closed',
      avgDaysInPhase: 'Average days in phase',
      avgDaysInPhaseDesc: 'Mean dwell time per case status (open matters).',
      settlementCycle: 'Settlement cycle time',
      settlementCycleDesc: 'Days from settlement creation to execution.',
      week: 'Week',
      cases: 'Cases',
      matters: 'Matters',
      daysAxis: 'Days',
      settledValue: 'Settled value',
      cycleDays: 'Cycle (days)',
      empty: 'Not enough data to chart yet',
    },
    companyStatus: {
      plaintiff: 'Plaintiff',
      defendant: 'Defendant',
    },
    status: {
      intake: 'Intake',
      phase1: 'Phase 1',
      phase2: 'Phase 2',
      open: 'Open',
      under_procedure: 'Under procedure',
      on_hold: 'On hold',
      closed: 'Closed',
      cancelled: 'Cancelled',
    },
    practiceAreas: {
      commercial: 'Commercial',
      civil: 'Civil',
      labor: 'Labor',
      labour: 'Labor',
      criminal: 'Criminal',
      administrative: 'Administrative',
      execution: 'Execution',
      real_estate: 'Real estate',
      'real estate': 'Real estate',
      corporate: 'Corporate',
      contractual: 'Contractual',
      contract: 'Contract',
      rental: 'Rental',
      tax: 'Tax',
      employment: 'Employment',
      litigation: 'Litigation',
      arbitration: 'Arbitration',
      regulatory: 'Regulatory',
      compliance: 'Compliance',
      advisory: 'Advisory',
      intellectual_property: 'Intellectual property',
      general: 'General',
      other: 'Other',
      'labor dispute': 'Labor dispute',
      'labour dispute': 'Labor dispute',
      'commercial dispute': 'Commercial dispute',
      'civil dispute': 'Civil dispute',
      'commercial claim': 'Commercial claim',
      'civil claim': 'Civil claim',
      'labor claim': 'Labor claim',
      'execution claim': 'Execution claim',
      'execution request': 'Execution request',
    },
  },
  ar: {
    page: {
      eyebrow: 'العمليات القانونية',
      title: 'تحليلات العمليات القانونية',
      description:
        'توزيع أعباء العمل وسرعة معالجة القضايا بحسب المسؤولين ومجالات الممارسة.',
      refresh: 'تحديث',
    },
    kpi: {
      activeMatters: 'القضايا النشطة',
      closedThisQuarter: 'المغلقة (٩٠ يومًا)',
      avgCycleDays: 'متوسط أيام الإغلاق',
      settlementCycleDays: 'دورة التسوية',
      weeklyThroughput: 'الإنتاجية الأسبوعية',
      busiestOfficer: 'الأكثر انشغالًا',
      days: 'يوم',
      perWeek: '/ أسبوع',
      noOfficer: '—',
    },
    kpiDetails: {
      activeMatters: 'القضايا المفتوحة الممثلة حاليًا في عينة التحليلات.',
      closedThisQuarter: 'قضايا أُغلقت خلال نافذة التسعين يومًا الأخيرة.',
      avgCycleDays: 'متوسط الوقت المنقضي من الفتح إلى الإغلاق.',
      settlementCycleDays: 'متوسط الدورة من إنشاء التسوية حتى تنفيذها.',
      weeklyThroughput: 'متوسط القضايا المغلقة أسبوعيًا في الاتجاه الأخير.',
      busiestOfficer: 'المسؤول صاحب أكبر عبء عمل نشط.',
      workloadShare: 'حصة عبء العمل',
      recentWindow: 'النافذة الأخيرة',
      throughputSignal: 'إشارة الإنتاجية',
    },
    heatmap: {
      title: 'خريطة أعباء العمل',
      description: 'القضايا المفتوحة بحسب المسؤول × مجال الممارسة.',
      officer: 'المسؤول',
      practiceArea: 'مجال الممارسة',
      total: 'الإجمالي',
      legendLight: 'أخف',
      legendHeavy: 'أثقل',
      cellTooltip: (officer, area, count) => `${officer} · ${area}: ${count} قضية`,
      unassigned: 'غير مُسند',
      empty: 'لا توجد قضايا لعرضها',
      emptyHint: 'عند إسناد القضايا إلى المسؤولين، تظهر شبكة أعباء العمل هنا.',
      showActiveOnly: 'النشطة فقط',
    },
    velocity: {
      title: 'السرعة ودورة المعالجة',
      description: 'اتجاهات الإنتاجية ومدة بقاء القضايا في كل مرحلة خلال الفترة الأخيرة.',
      closedPerWeek: 'القضايا المفتوحة مقابل المغلقة أسبوعيًا',
      opened: 'المفتوحة',
      closed: 'المغلقة',
      avgDaysInPhase: 'متوسط الأيام في المرحلة',
      avgDaysInPhaseDesc: 'متوسط مدة البقاء لكل حالة قضية (القضايا المفتوحة).',
      settlementCycle: 'مدة دورة التسوية',
      settlementCycleDesc: 'الأيام من إنشاء التسوية حتى تنفيذها.',
      week: 'الأسبوع',
      cases: 'القضايا',
      matters: 'القضايا',
      daysAxis: 'الأيام',
      settledValue: 'القيمة المسوّاة',
      cycleDays: 'الدورة (أيام)',
      empty: 'لا توجد بيانات كافية للعرض بعد',
    },
    companyStatus: {
      plaintiff: 'مدّعٍ',
      defendant: 'مدّعى عليه',
    },
    status: {
      intake: 'الاستلام',
      phase1: 'المرحلة الأولى',
      phase2: 'المرحلة الثانية',
      open: 'مفتوحة',
      under_procedure: 'قيد الإجراء',
      on_hold: 'معلّقة',
      closed: 'مغلقة',
      cancelled: 'ملغاة',
    },
    practiceAreas: {
      commercial: 'تجاري',
      civil: 'مدني',
      labor: 'عمالي',
      labour: 'عمالي',
      criminal: 'جنائي',
      administrative: 'إداري',
      execution: 'تنفيذ',
      real_estate: 'عقاري',
      'real estate': 'عقاري',
      corporate: 'شركات',
      contractual: 'تعاقدي',
      contract: 'عقود',
      rental: 'إيجاري',
      tax: 'ضريبي',
      employment: 'توظيف',
      litigation: 'تقاضٍ',
      arbitration: 'تحكيم',
      regulatory: 'تنظيمي',
      compliance: 'امتثال',
      advisory: 'استشاري',
      intellectual_property: 'ملكية فكرية',
      general: 'عام',
      other: 'أخرى',
      'labor dispute': 'نزاع عمالي',
      'labour dispute': 'نزاع عمالي',
      'commercial dispute': 'نزاع تجاري',
      'civil dispute': 'نزاع مدني',
      'commercial claim': 'مطالبة تجارية',
      'civil claim': 'مطالبة مدنية',
      'labor claim': 'مطالبة عمالية',
      'execution claim': 'دعوى تنفيذية',
      'execution request': 'طلب تنفيذ',
    },
  },
};

/** React hook: resolves the analytics labels for the active locale. */
export function useAnalyticsLabels(): AnalyticsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(labels, locale), [locale]);
}
