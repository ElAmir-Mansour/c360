/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq reports
 * surface (contract / matter / obligation report tabs, metric cards, breakdown
 * cards, and report rows). Follows the canonical lex bilingual contract
 * (`../../_lib/lex-i18n.ts`).
 *
 * The `en` side MUST equal the pre-existing English strings so existing
 * English-asserting tests stay green; the `ar` side is professional MSA using
 * the suite glossary (تقرير / عقد / قضية / التزام / مخاطر / تجديد).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export type ReportKind = 'contracts' | 'matters' | 'obligations' | 'cases' | 'investigations';

export interface ReportsLabels {
  pageTitle: string;
  tabs: Record<ReportKind, string>;
  descriptions: Record<ReportKind, string>;
  analyticsCallout: {
    title: string;
    description: string;
    action: string;
  };
  actions: {
    signatures: string;
    exportCsv: string;
    exportXlsx: string;
    exportSelectedCsv: string;
    downloadPdf: string;
    builder: string;
  };
  dateRange: {
    label: string;
    all: string;
    clear: string;
    presets: {
      next30: string;
      next90: string;
      thisMonth: string;
      thisYear: string;
    };
  };
  presets: {
    label: string;
    highRiskContracts: string;
    activeMatters: string;
    closedMatters: string;
    overdueObligations: string;
    dueSoonObligations: string;
  };
  savedViews: {
    save: string;
    saved: string;
    empty: string;
  };
  filters: {
    status: string;
    type: string;
    riskLevel: string;
    priority: string;
    department: string;
    tag: string;
    overdue: string;
    overdueYes: string;
  };
  errors: Record<ReportKind, string>;
  empty: {
    title: string;
    contracts: string;
    matters: string;
    obligations: string;
    cases: string;
    investigations: string;
  };
  generated: (when: string) => string;
  reportRows: Record<ReportKind, string>;
  table: {
    searchPlaceholder: Record<ReportKind, string>;
    title: string;
    status: string;
    type: string;
    risk: string;
    priority: string;
    owner: string;
    source: string;
    expiryDate: string;
    dueDate: string;
    createdAt: string;
    action: string;
    open: string;
    number: string;
    category: string;
    department: string;
    age: string;
    sla: string;
    resolvedAt: string;
  };
  metrics: {
    contracts: string;
    statuses: string;
    types: string;
    riskBands: string;
    matters: string;
    priorities: string;
    obligations: string;
    overdue: string;
    dueSoon: string;
    completed: string;
    cases: string;
    investigations: string;
    open: string;
    closed: string;
    averageAge: string;
    approvalTime: string;
    slaCompliance: string;
  };
  metricDetails: {
    reportScope: string;
    statusCoverage: string;
    typeCoverage: string;
    riskCoverage: string;
    priorityCoverage: string;
    overdueQueue: string;
    dueSoonQueue: string;
    completionCoverage: string;
    currentReport: string;
    distributionShare: string;
  };
  breakdown: {
    byStatus: string;
    byType: string;
    byRisk: string;
    byPriority: string;
    byDepartment: string;
    byCategory: string;
    distribution: string;
    noData: string;
  };
  rows: {
    versionPrefix: (version: number | string) => string;
    noExpiryDate: string;
    noDueDate: string;
    unassigned: string;
    unlinked: string;
  };
  dueWindow: {
    overdue: (days: number | string) => string;
    today: string;
    dueIn: (days: number | string) => string;
  };
  enums: {
    contractTypes: Record<string, string>;
    matterStatuses: Record<string, string>;
    matterTypes: Record<string, string>;
    obligationStatuses: Record<string, string>;
    obligationTypes: Record<string, string>;
  };
}

export const reportsLabels: LexBilingual<ReportsLabels> = {
  en: {
    pageTitle: 'Reports',
    tabs: {
      contracts: 'Contracts',
      matters: 'Matters',
      obligations: 'Obligations',
      cases: 'Cases',
      investigations: 'Investigations',
    },
    descriptions: {
      contracts: 'Contract portfolio reporting, lifecycle distribution, and CSV export.',
      matters: 'Matter reporting by status, type, priority, owner, and deadline posture.',
      obligations: 'Obligation reporting by status, priority, source linkage, and due-window signals.',
      cases: 'Litigation case portfolio by lifecycle, type, department, and company role.',
      investigations: 'Investigation lifecycle, category, open ageing, approval time, and SLA outcomes.',
    },
    analyticsCallout: {
      title: 'Reports & Performance Indicators',
      description:
        'The legal-affairs statistics and SLA-compliance percentage live on the performance-indicators dashboard.',
      action: 'Open performance indicators',
    },
    actions: {
      signatures: 'Signatures',
      exportCsv: 'Export CSV',
      exportXlsx: 'Export XLSX',
      exportSelectedCsv: 'Export selected CSV',
      downloadPdf: 'Download PDF',
      builder: 'Open report builder',
    },
    dateRange: {
      label: 'Due/expiry window',
      all: 'All time',
      clear: 'Clear',
      presets: {
        next30: 'Next 30 days',
        next90: 'Next 90 days',
        thisMonth: 'This month',
        thisYear: 'This year',
      },
    },
    presets: {
      label: 'Report presets',
      highRiskContracts: 'High-risk contracts',
      activeMatters: 'Active matters',
      closedMatters: 'Closed matters',
      overdueObligations: 'Overdue obligations',
      dueSoonObligations: 'Due soon obligations',
    },
    savedViews: {
      save: 'Save report view',
      saved: 'Saved report views',
      empty: 'No saved report views yet',
    },
    filters: {
      status: 'Status',
      type: 'Type',
      riskLevel: 'Risk',
      priority: 'Priority',
      department: 'Department',
      tag: 'Tag',
      overdue: 'Overdue',
      overdueYes: 'Overdue only',
    },
    errors: {
      contracts: 'Failed to load contract report.',
      matters: 'Failed to load matter report.',
      obligations: 'Failed to load obligation report.',
      cases: 'Failed to load case report.',
      investigations: 'Failed to load investigation report.',
    },
    empty: {
      title: 'No report rows',
      contracts: 'No contracts matched the current report filters.',
      matters: 'No matters matched the current report filters.',
      obligations: 'No obligations matched the current report filters.',
      cases: 'No cases matched the current report filters.',
      investigations: 'No investigations matched the current report filters.',
    },
    generated: (when) => `Generated ${when}`,
    reportRows: {
      contracts: 'Contract Report Rows',
      matters: 'Matter Report Rows',
      obligations: 'Obligation Report Rows',
      cases: 'Case Report Drilldown',
      investigations: 'Investigation Report Rows',
    },
    table: {
      searchPlaceholder: {
        contracts: 'Search contract reports...',
        matters: 'Search matter reports...',
        obligations: 'Search obligation reports...',
        cases: 'Search case reports...',
        investigations: 'Search investigation reports...',
      },
      title: 'Title',
      status: 'Status',
      type: 'Type',
      risk: 'Risk',
      priority: 'Priority',
      owner: 'Owner',
      source: 'Source',
      expiryDate: 'Expiry',
      dueDate: 'Due',
      createdAt: 'Created',
      action: 'Action',
      open: 'Open',
      number: 'Number',
      category: 'Category',
      department: 'Department',
      age: 'Age (days)',
      sla: 'SLA outcome',
      resolvedAt: 'Resolved',
    },
    metrics: {
      contracts: 'Contracts',
      statuses: 'Statuses',
      types: 'Types',
      riskBands: 'Risk Bands',
      matters: 'Matters',
      priorities: 'Priorities',
      obligations: 'Obligations',
      overdue: 'Overdue',
      dueSoon: 'Due Soon',
      completed: 'Completed',
      cases: 'Cases',
      investigations: 'Investigations',
      open: 'Open',
      closed: 'Terminal',
      averageAge: 'Average open age',
      approvalTime: 'Register → approved',
      slaCompliance: 'SLA compliance',
    },
    metricDetails: {
      reportScope: 'Rows included in the current report output.',
      statusCoverage: 'Distinct lifecycle states represented.',
      typeCoverage: 'Distinct record types represented.',
      riskCoverage: 'Risk bands present in this report.',
      priorityCoverage: 'Priority levels present in this report.',
      overdueQueue: 'Rows past the target due date.',
      dueSoonQueue: 'Rows approaching the target due date.',
      completionCoverage: 'Completed share of this report.',
      currentReport: 'Current report',
      distributionShare: 'Distribution share',
    },
    breakdown: {
      byStatus: 'By Status',
      byType: 'By Type',
      byRisk: 'By Risk',
      byPriority: 'By Priority',
      byDepartment: 'By Department',
      byCategory: 'By Category',
      distribution: 'Report distribution',
      noData: 'No data available.',
    },
    rows: {
      versionPrefix: (version) => `v${version}`,
      noExpiryDate: 'No expiry date',
      noDueDate: 'No due date',
      unassigned: 'Unassigned',
      unlinked: 'Unlinked',
    },
    dueWindow: {
      overdue: (days) => `${days} days overdue`,
      today: 'Due today',
      dueIn: (days) => `Due in ${days} days`,
    },
    enums: {
      contractTypes: {},
      matterStatuses: {},
      matterTypes: {},
      obligationStatuses: {},
      obligationTypes: {},
    },
  },
  ar: {
    pageTitle: 'التقارير',
    tabs: {
      contracts: 'العقود',
      matters: 'القضايا',
      obligations: 'الالتزامات',
      cases: 'الدعاوى',
      investigations: 'التحقيقات',
    },
    descriptions: {
      contracts: 'تقارير محفظة العقود وتوزيع دورة الحياة وتصدير CSV.',
      matters: 'تقارير القضايا حسب الحالة والنوع والأولوية والمسؤول ووضع المواعيد النهائية.',
      obligations: 'تقارير الالتزامات حسب الحالة والأولوية وارتباط المصدر ومؤشرات نافذة الاستحقاق.',
      cases: 'محفظة الدعاوى حسب دورة الحياة والنوع والإدارة وصفة الشركة.',
      investigations: 'دورة حياة التحقيقات وفئاتها وأعمارها المفتوحة ومدة الاعتماد ونتائج مستوى الخدمة.',
    },
    analyticsCallout: {
      title: 'التقارير ومؤشرات الأداء',
      description:
        'تتوفّر إحصائيات الشؤون القانونية ونسبة الامتثال لاتفاقية مستوى الخدمة في لوحة مؤشرات الأداء.',
      action: 'فتح مؤشرات الأداء',
    },
    actions: {
      signatures: 'التوقيعات',
      exportCsv: 'تصدير CSV',
      exportXlsx: 'تصدير XLSX',
      exportSelectedCsv: 'تصدير المحدد CSV',
      downloadPdf: 'تنزيل PDF',
      builder: 'فتح منشئ التقارير',
    },
    dateRange: {
      label: 'نافذة الاستحقاق/الانتهاء',
      all: 'كل الأوقات',
      clear: 'مسح',
      presets: {
        next30: 'الأيام 30 القادمة',
        next90: 'الأيام 90 القادمة',
        thisMonth: 'هذا الشهر',
        thisYear: 'هذا العام',
      },
    },
    presets: {
      label: 'إعدادات التقرير الجاهزة',
      highRiskContracts: 'العقود عالية المخاطر',
      activeMatters: 'القضايا النشطة',
      closedMatters: 'القضايا المغلقة',
      overdueObligations: 'الالتزامات المتأخرة',
      dueSoonObligations: 'الالتزامات المستحقة قريبًا',
    },
    savedViews: {
      save: 'حفظ عرض التقرير',
      saved: 'عروض التقارير المحفوظة',
      empty: 'لا توجد عروض تقارير محفوظة بعد',
    },
    filters: {
      status: 'الحالة',
      type: 'النوع',
      riskLevel: 'المخاطر',
      priority: 'الأولوية',
      department: 'الإدارة',
      tag: 'الوسم',
      overdue: 'متأخر',
      overdueYes: 'المتأخرة فقط',
    },
    errors: {
      contracts: 'تعذّر تحميل تقرير العقود.',
      matters: 'تعذّر تحميل تقرير القضايا.',
      obligations: 'تعذّر تحميل تقرير الالتزامات.',
      cases: 'تعذّر تحميل تقرير الدعاوى.',
      investigations: 'تعذّر تحميل تقرير التحقيقات.',
    },
    empty: {
      title: 'لا توجد صفوف تقرير',
      contracts: 'لا توجد عقود مطابقة لمرشّحات التقرير الحالية.',
      matters: 'لا توجد قضايا مطابقة لمرشّحات التقرير الحالية.',
      obligations: 'لا توجد التزامات مطابقة لمرشّحات التقرير الحالية.',
      cases: 'لا توجد دعاوى مطابقة لمرشّحات التقرير الحالية.',
      investigations: 'لا توجد تحقيقات مطابقة لمرشّحات التقرير الحالية.',
    },
    generated: (when) => `أُنشئ ${when}`,
    reportRows: {
      contracts: 'صفوف تقرير العقود',
      matters: 'صفوف تقرير القضايا',
      obligations: 'صفوف تقرير الالتزامات',
      cases: 'تفاصيل تقرير الدعاوى',
      investigations: 'صفوف تقرير التحقيقات',
    },
    table: {
      searchPlaceholder: {
        contracts: 'البحث في تقارير العقود...',
        matters: 'البحث في تقارير القضايا...',
        obligations: 'البحث في تقارير الالتزامات...',
        cases: 'البحث في تقارير الدعاوى...',
        investigations: 'البحث في تقارير التحقيقات...',
      },
      title: 'العنوان',
      status: 'الحالة',
      type: 'النوع',
      risk: 'المخاطر',
      priority: 'الأولوية',
      owner: 'المسؤول',
      source: 'المصدر',
      expiryDate: 'الانتهاء',
      dueDate: 'الاستحقاق',
      createdAt: 'تاريخ الإنشاء',
      action: 'الإجراء',
      open: 'فتح',
      number: 'الرقم',
      category: 'الفئة',
      department: 'الإدارة',
      age: 'العمر (بالأيام)',
      sla: 'نتيجة مستوى الخدمة',
      resolvedAt: 'تاريخ الإنهاء',
    },
    metrics: {
      contracts: 'العقود',
      statuses: 'الحالات',
      types: 'الأنواع',
      riskBands: 'فئات المخاطر',
      matters: 'القضايا',
      priorities: 'الأولويات',
      obligations: 'الالتزامات',
      overdue: 'متأخرة',
      dueSoon: 'تستحق قريبًا',
      completed: 'مكتملة',
      cases: 'الدعاوى',
      investigations: 'التحقيقات',
      open: 'مفتوحة',
      closed: 'نهائية',
      averageAge: 'متوسط عمر المفتوح',
      approvalTime: 'من التسجيل إلى الاعتماد',
      slaCompliance: 'الامتثال لمستوى الخدمة',
    },
    metricDetails: {
      reportScope: 'الصفوف المدرجة في مخرجات التقرير الحالي.',
      statusCoverage: 'حالات دورة حياة مميزة ممثلة.',
      typeCoverage: 'أنواع سجلات مميزة ممثلة.',
      riskCoverage: 'فئات المخاطر الموجودة في هذا التقرير.',
      priorityCoverage: 'مستويات الأولوية الموجودة في هذا التقرير.',
      overdueQueue: 'صفوف تجاوزت تاريخ الاستحقاق المستهدف.',
      dueSoonQueue: 'صفوف تقترب من تاريخ الاستحقاق المستهدف.',
      completionCoverage: 'حصة المكتمل من هذا التقرير.',
      currentReport: 'التقرير الحالي',
      distributionShare: 'حصة التوزيع',
    },
    breakdown: {
      byStatus: 'حسب الحالة',
      byType: 'حسب النوع',
      byRisk: 'حسب المخاطر',
      byPriority: 'حسب الأولوية',
      byDepartment: 'حسب الإدارة',
      byCategory: 'حسب الفئة',
      distribution: 'توزيع التقرير',
      noData: 'لا تتوفر بيانات.',
    },
    rows: {
      versionPrefix: (version) => `إصدار ${version}`,
      noExpiryDate: 'بلا تاريخ انتهاء',
      noDueDate: 'بلا تاريخ استحقاق',
      unassigned: 'غير مُسند',
      unlinked: 'غير مرتبط',
    },
    dueWindow: {
      overdue: (days) => `${days} يومًا متأخر`,
      today: 'يُستحق اليوم',
      dueIn: (days) => `يُستحق خلال ${days} يومًا`,
    },
    enums: {
      contractTypes: {
        nda: 'اتفاقية سرّية',
        service: 'عقد خدمة',
        employment: 'عقد عمل',
        lease: 'عقد إيجار',
        purchase: 'عقد شراء',
        partnership: 'عقد شراكة',
        license: 'عقد ترخيص',
        framework: 'عقد إطاري',
        amendment: 'تعديل',
        other: 'أخرى',
      },
      matterStatuses: {
        intake: 'استقبال',
        triage: 'فرز',
        active: 'نشطة',
        on_hold: 'معلّقة',
        closed: 'مغلقة',
        archived: 'مؤرشفة',
      },
      matterTypes: {
        litigation: 'تقاضٍ',
        advisory: 'استشارة',
        compliance: 'امتثال',
        contract: 'عقد',
        dispute: 'نزاع',
        regulatory: 'تنظيمي',
        corporate: 'شركات',
        other: 'أخرى',
      },
      obligationStatuses: {
        open: 'مفتوح',
        in_progress: 'قيد التنفيذ',
        blocked: 'مُعطَّل',
        completed: 'مكتمل',
        waived: 'مُتنازَل عنه',
        cancelled: 'ملغى',
      },
      obligationTypes: {
        contractual: 'تعاقدي',
        renewal: 'تجديد',
        notice: 'إشعار',
        payment: 'دفع',
        delivery: 'تسليم',
        reporting: 'إبلاغ',
        compliance: 'امتثال',
        covenant: 'تعهد',
        condition_precedent: 'شرط مسبق',
        regulatory: 'تنظيمي',
        other: 'أخرى',
      },
    },
  },
};

export function useReportsLabels(): ReportsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(reportsLabels, locale), [locale]);
}

/**
 * resolveReportsLabels is the pure resolver for non-React callers/tests.
 */
export function resolveReportsLabels(locale: AppLocale = 'en'): ReportsLabels {
  return resolveLexBilingual(reportsLabels, locale === 'ar' ? 'ar' : 'en');
}
