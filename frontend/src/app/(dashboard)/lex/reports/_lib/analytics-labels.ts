/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq
 * legal-affairs ANALYTICS & KPI dashboard (Phase 4, CAP-133..151) — the flagship
 * quarterly SLA-compliance gauge, performance scorecard, and case / contract /
 * consultation analytics rollups.
 *
 * This is a SEPARATE label group from the existing reports-labels.ts (which
 * covers the contract / matter / obligation CSV report tabs); the analytics
 * surface lives at /lex/reports/analytics and is self-contained.
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`): two
 * FULL, same-shaped copies; `en` is the canonical English surface, `ar` is
 * professional MSA using the suite glossary (تقرير / قضية / عقد / استشارة /
 * أداء / امتثال / اتفاقية مستوى الخدمة). Function-valued and interpolated fields
 * appear on BOTH sides and preserve Western digits.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export type AnalyticsTab = 'overview' | 'sla' | 'performance' | 'cases' | 'contracts' | 'consultations';

export interface AnalyticsLabels {
  pageTitle: string;
  pageDescription: string;
  backToReports: string;
  tabs: Record<AnalyticsTab, string>;
  tabDescriptions: Record<AnalyticsTab, string>;
  actions: {
    exportCsv: string;
    exportXlsx: string;
    print: string;
    classicReports: string;
    clearFilters: string;
  };
  filters: {
    title: string;
    department: string;
    departmentPlaceholder: string;
    status: string;
    statusPlaceholder: string;
    type: string;
    typePlaceholder: string;
    from: string;
    to: string;
    quarters: string;
    quartersHint: (n: number) => string;
  };
  overview: {
    title: string;
    description: string;
    cases: string;
    contracts: string;
    consultations: string;
    currentSla: string;
    avgProcessing: string;
    overdueRequests: string;
    openCases: string;
    activeContracts: string;
    answeredConsultations: string;
    goToCases: string;
    goToContracts: string;
    goToConsultations: string;
    goToPerformance: string;
    goToSla: string;
    classicHint: string;
  };
  comparison: {
    title: string;
    previousWindow: (from: string, to: string) => string;
    noWindow: string;
    versusPrevious: string;
    up: (value: string) => string;
    down: (value: string) => string;
    flat: string;
    points: string;
    generatedContext: (timestamp: string) => string;
  };
  sla: {
    headline: string;
    headlineDescription: string;
    target: (pct: number) => string;
    overall: string;
    overallMeets: string;
    overallMisses: string;
    gaugeLabel: string;
    currentQuarter: string;
    trendTitle: string;
    trendDescription: string;
    quarterColumn: string;
    received: string;
    onTime: string;
    breached: string;
    pending: string;
    rate: string;
    status: string;
    meets: string;
    misses: string;
    noQuarters: string;
    previousQuarter: string;
    qoqChange: string;
    targetGap: string;
    noPreviousQuarter: string;
    exceptionTitle: string;
    exceptionDescription: string;
    exceptionQuarter: string;
    exceptionType: string;
    exceptionCount: string;
    exceptionAction: string;
    exceptionBreached: string;
    exceptionPending: string;
    reviewBreached: string;
    reviewPending: string;
    noExceptions: string;
  };
  performance: {
    avgProcessing: string;
    avgProcessingHint: (n: number) => string;
    closedCaseRatio: string;
    closedCaseHint: (closed: number, total: number) => string;
    approvedContractRatio: string;
    approvedContractHint: (approved: number, total: number) => string;
    overdueRequests: string;
    overdueHint: string;
    durationAdherence: string;
    durationAdherenceHint: (onTime: number, resolved: number) => string;
    hoursUnit: string;
  };
  cases: {
    total: string;
    closed: string;
    underProcedure: string;
    byType: string;
    byDepartment: string;
    byStatus: string;
    byCompanyRole: string;
  };
  contracts: {
    total: string;
    avgReview: string;
    avgReviewHint: (n: number) => string;
    byType: string;
    byDepartment: string;
    byStatus: string;
  };
  consultations: {
    total: string;
    avgCompletion: string;
    avgCompletionHint: (n: number) => string;
    byType: string;
    byDepartment: string;
    byStatus: string;
  };
  breakdown: {
    distribution: string;
    noData: string;
    countColumn: string;
    openBucket: string;
  };
  generated: (timestamp: string) => string;
  loadError: string;
  exportSuccess: string;
  loadingTitle: string;
}

const bundle: LexBilingual<AnalyticsLabels> = {
  en: {
    pageTitle: 'Legal Affairs Analytics',
    pageDescription:
      'Operational KPIs and analytics for cases, contracts, consultations, and SLA compliance.',
    backToReports: 'Back to reports',
    tabs: {
      overview: 'Overview',
      sla: 'SLA Compliance',
      performance: 'Performance',
      cases: 'Cases',
      contracts: 'Contracts',
      consultations: 'Consultations',
    },
    tabDescriptions: {
      overview: 'Unified legal-affairs reports hub with current KPIs and drilldowns.',
      sla: 'Flagship quarterly SLA-compliance rate against the 90% target.',
      performance: 'Operational performance scorecard across requests, cases, and contracts.',
      cases: 'Litigation-case analytics grouped by type, department, and status.',
      contracts: 'Contract analytics with review turnaround and distribution breakdowns.',
      consultations: 'Consultation analytics with completion turnaround and distribution.',
    },
    actions: {
      exportCsv: 'Export CSV',
      exportXlsx: 'Export XLSX',
      print: 'Print',
      classicReports: 'Classic reports',
      clearFilters: 'Clear',
    },
    filters: {
      title: 'Report window',
      department: 'Department',
      departmentPlaceholder: 'All departments',
      status: 'Status',
      statusPlaceholder: 'Any status token',
      type: 'Type',
      typePlaceholder: 'Any type token',
      from: 'From',
      to: 'To',
      quarters: 'Quarters',
      quartersHint: (n) => `Showing the last ${n} quarters`,
    },
    overview: {
      title: 'Reports hub',
      description: 'Consolidated cases, contracts, consultations, performance, and SLA posture.',
      cases: 'Cases',
      contracts: 'Contracts',
      consultations: 'Consultations',
      currentSla: 'Current SLA',
      avgProcessing: 'Avg processing',
      overdueRequests: 'Overdue requests',
      openCases: 'Open / under procedure',
      activeContracts: 'Active contracts',
      answeredConsultations: 'Answered consultations',
      goToCases: 'Cases analytics',
      goToContracts: 'Contracts analytics',
      goToConsultations: 'Consultations analytics',
      goToPerformance: 'Performance scorecard',
      goToSla: 'SLA workspace',
      classicHint: 'Classic CSV reports remain available for contracts, matters, and obligations.',
    },
    comparison: {
      title: 'Comparison',
      previousWindow: (from, to) => `Previous window: ${from} to ${to}`,
      noWindow: 'Choose both From and To dates to compare with the prior period.',
      versusPrevious: 'vs previous period',
      up: (value) => `+${value}`,
      down: (value) => `-${value}`,
      flat: 'No change',
      points: 'pts',
      generatedContext: (timestamp) => `Generated from live analytics data at ${timestamp}.`,
    },
    sla: {
      headline: 'Quarterly SLA Compliance',
      headlineDescription: 'Completed-on-time as a share of all SLA clocks received in the quarter.',
      target: (pct) => `Target ≥ ${pct}%`,
      overall: 'Overall compliance',
      overallMeets: 'Meeting the target',
      overallMisses: 'Below the target',
      gaugeLabel: 'Current quarter',
      currentQuarter: 'Current quarter',
      trendTitle: 'Compliance trend',
      trendDescription: 'SLA-compliance rate per quarter against the target line.',
      quarterColumn: 'Quarter',
      received: 'Received',
      onTime: 'On time',
      breached: 'Breached',
      pending: 'Pending',
      rate: 'Rate',
      status: 'Status',
      meets: 'On target',
      misses: 'Below target',
      noQuarters: 'No SLA clocks recorded for the selected window.',
      previousQuarter: 'Previous quarter',
      qoqChange: 'QoQ change',
      targetGap: 'Target gap',
      noPreviousQuarter: 'No previous quarter available for comparison.',
      exceptionTitle: 'SLA exception workspace',
      exceptionDescription:
        'Breached and pending quarter shortcuts. Counts are aggregate; links open the closest request queues for action.',
      exceptionQuarter: 'Quarter',
      exceptionType: 'Exception',
      exceptionCount: 'Count',
      exceptionAction: 'Action',
      exceptionBreached: 'Breached',
      exceptionPending: 'Pending',
      reviewBreached: 'Review active requests',
      reviewPending: 'Review submitted requests',
      noExceptions: 'No breached or pending SLA counts in the selected quarters.',
    },
    performance: {
      avgProcessing: 'Avg request processing',
      avgProcessingHint: (n) => `Across ${n} processed requests`,
      closedCaseRatio: 'Closed case ratio',
      closedCaseHint: (closed, total) => `${closed} of ${total} cases closed`,
      approvedContractRatio: 'Approved contract ratio',
      approvedContractHint: (approved, total) => `${approved} of ${total} contracts active`,
      overdueRequests: 'Overdue requests',
      overdueHint: 'Requests with a breached SLA clock',
      durationAdherence: 'Duration adherence',
      durationAdherenceHint: (onTime, resolved) => `${onTime} of ${resolved} clocks on time`,
      hoursUnit: 'working hrs',
    },
    cases: {
      total: 'Total cases',
      closed: 'Closed',
      underProcedure: 'Under procedure',
      byType: 'By case type',
      byDepartment: 'By department',
      byStatus: 'By status',
      byCompanyRole: 'By company role',
    },
    contracts: {
      total: 'Total contracts',
      avgReview: 'Avg review duration',
      avgReviewHint: (n) => `Based on ${n} reviewed contracts`,
      byType: 'By type',
      byDepartment: 'By department',
      byStatus: 'By status',
    },
    consultations: {
      total: 'Total consultations',
      avgCompletion: 'Avg completion time',
      avgCompletionHint: (n) => `Based on ${n} answered consultations`,
      byType: 'By type',
      byDepartment: 'By department',
      byStatus: 'By status',
    },
    breakdown: {
      distribution: 'Distribution',
      noData: 'No data for this breakdown.',
      countColumn: 'Count',
      openBucket: 'Open filtered list',
    },
    generated: (timestamp) => `Generated ${timestamp}`,
    loadError: 'Failed to load the analytics report.',
    exportSuccess: 'Report exported.',
    loadingTitle: 'Legal Affairs Analytics',
  },
  ar: {
    pageTitle: 'تحليلات الشؤون القانونية',
    pageDescription:
      'مؤشرات الأداء والتحليلات للقضايا والعقود والاستشارات والامتثال لاتفاقية مستوى الخدمة.',
    backToReports: 'العودة إلى التقارير',
    tabs: {
      overview: 'نظرة عامة',
      sla: 'الامتثال لمستوى الخدمة',
      performance: 'الأداء',
      cases: 'القضايا',
      contracts: 'العقود',
      consultations: 'الاستشارات',
    },
    tabDescriptions: {
      overview: 'مركز موحّد لتقارير الشؤون القانونية مع المؤشرات الحالية وروابط التفصيل.',
      sla: 'مؤشر الامتثال الفصلي الرئيس لاتفاقية مستوى الخدمة مقابل المستهدف ٩٠٪.',
      performance: 'بطاقة أداء تشغيلية تشمل الطلبات والقضايا والعقود.',
      cases: 'تحليلات قضايا التقاضي مصنّفة حسب النوع والإدارة والحالة.',
      contracts: 'تحليلات العقود مع زمن دورة المراجعة وتوزيع البيانات.',
      consultations: 'تحليلات الاستشارات مع زمن الإنجاز وتوزيع البيانات.',
    },
    actions: {
      exportCsv: 'تصدير CSV',
      exportXlsx: 'تصدير XLSX',
      print: 'طباعة',
      classicReports: 'التقارير الكلاسيكية',
      clearFilters: 'مسح',
    },
    filters: {
      title: 'نطاق التقرير',
      department: 'الإدارة',
      departmentPlaceholder: 'كل الإدارات',
      status: 'الحالة',
      statusPlaceholder: 'أي رمز حالة',
      type: 'النوع',
      typePlaceholder: 'أي رمز نوع',
      from: 'من',
      to: 'إلى',
      quarters: 'الأرباع',
      quartersHint: (n) => `عرض آخر ${n} أرباع`,
    },
    overview: {
      title: 'مركز التقارير',
      description: 'عرض موحّد للقضايا والعقود والاستشارات والأداء وحالة اتفاقية مستوى الخدمة.',
      cases: 'القضايا',
      contracts: 'العقود',
      consultations: 'الاستشارات',
      currentSla: 'مستوى الخدمة الحالي',
      avgProcessing: 'متوسط المعالجة',
      overdueRequests: 'الطلبات المتأخرة',
      openCases: 'مفتوحة / قيد الإجراء',
      activeContracts: 'العقود النشطة',
      answeredConsultations: 'الاستشارات المجابة',
      goToCases: 'تحليلات القضايا',
      goToContracts: 'تحليلات العقود',
      goToConsultations: 'تحليلات الاستشارات',
      goToPerformance: 'بطاقة الأداء',
      goToSla: 'مساحة مستوى الخدمة',
      classicHint: 'تظل التقارير الكلاسيكية بصيغة CSV متاحة للعقود والمسائل والالتزامات.',
    },
    comparison: {
      title: 'المقارنة',
      previousWindow: (from, to) => `النطاق السابق: ${from} إلى ${to}`,
      noWindow: 'اختر تاريخي من وإلى للمقارنة مع الفترة السابقة.',
      versusPrevious: 'مقارنة بالفترة السابقة',
      up: (value) => `+${value}`,
      down: (value) => `-${value}`,
      flat: 'لا تغيير',
      points: 'نقطة',
      generatedContext: (timestamp) => `أُنشئ من بيانات التحليلات المباشرة في ${timestamp}.`,
    },
    sla: {
      headline: 'الامتثال الفصلي لمستوى الخدمة',
      headlineDescription: 'نسبة المنجز في الوقت المحدد من إجمالي مؤقتات الخدمة المستلمة في الربع.',
      target: (pct) => `المستهدف ≥ ${pct}٪`,
      overall: 'الامتثال الإجمالي',
      overallMeets: 'مطابق للمستهدف',
      overallMisses: 'دون المستهدف',
      gaugeLabel: 'الربع الحالي',
      currentQuarter: 'الربع الحالي',
      trendTitle: 'اتجاه الامتثال',
      trendDescription: 'نسبة الامتثال لمستوى الخدمة لكل ربع مقابل خط المستهدف.',
      quarterColumn: 'الربع',
      received: 'المستلَم',
      onTime: 'في الوقت',
      breached: 'متجاوز',
      pending: 'معلّق',
      rate: 'النسبة',
      status: 'الحالة',
      meets: 'ضمن المستهدف',
      misses: 'دون المستهدف',
      noQuarters: 'لا توجد مؤقتات خدمة مسجّلة للنطاق المحدد.',
      previousQuarter: 'الربع السابق',
      qoqChange: 'التغير الفصلي',
      targetGap: 'الفجوة عن المستهدف',
      noPreviousQuarter: 'لا يوجد ربع سابق متاح للمقارنة.',
      exceptionTitle: 'مساحة استثناءات مستوى الخدمة',
      exceptionDescription:
        'اختصارات للأرباع المتجاوزة والمعلّقة. الأعداد إجمالية؛ تفتح الروابط أقرب قوائم طلبات قابلة للعمل.',
      exceptionQuarter: 'الربع',
      exceptionType: 'الاستثناء',
      exceptionCount: 'العدد',
      exceptionAction: 'الإجراء',
      exceptionBreached: 'متجاوز',
      exceptionPending: 'معلّق',
      reviewBreached: 'مراجعة الطلبات النشطة',
      reviewPending: 'مراجعة الطلبات المقدمة',
      noExceptions: 'لا توجد أعداد متجاوزة أو معلّقة في الأرباع المحددة.',
    },
    performance: {
      avgProcessing: 'متوسط معالجة الطلب',
      avgProcessingHint: (n) => `عبر ${n} طلبًا معالَجًا`,
      closedCaseRatio: 'نسبة القضايا المغلقة',
      closedCaseHint: (closed, total) => `${closed} من ${total} قضية مغلقة`,
      approvedContractRatio: 'نسبة العقود المعتمدة',
      approvedContractHint: (approved, total) => `${approved} من ${total} عقد نشط`,
      overdueRequests: 'الطلبات المتأخرة',
      overdueHint: 'الطلبات ذات مؤقت خدمة متجاوز',
      durationAdherence: 'الالتزام بالمدة',
      durationAdherenceHint: (onTime, resolved) => `${onTime} من ${resolved} مؤقت في الوقت`,
      hoursUnit: 'ساعة عمل',
    },
    cases: {
      total: 'إجمالي القضايا',
      closed: 'مغلقة',
      underProcedure: 'قيد الإجراء',
      byType: 'حسب نوع القضية',
      byDepartment: 'حسب الإدارة',
      byStatus: 'حسب الحالة',
      byCompanyRole: 'حسب دور الشركة',
    },
    contracts: {
      total: 'إجمالي العقود',
      avgReview: 'متوسط مدة المراجعة',
      avgReviewHint: (n) => `بناءً على ${n} عقد تمت مراجعته`,
      byType: 'حسب النوع',
      byDepartment: 'حسب الإدارة',
      byStatus: 'حسب الحالة',
    },
    consultations: {
      total: 'إجمالي الاستشارات',
      avgCompletion: 'متوسط زمن الإنجاز',
      avgCompletionHint: (n) => `بناءً على ${n} استشارة تمت الإجابة عليها`,
      byType: 'حسب النوع',
      byDepartment: 'حسب الإدارة',
      byStatus: 'حسب الحالة',
    },
    breakdown: {
      distribution: 'التوزيع',
      noData: 'لا توجد بيانات لهذا التصنيف.',
      countColumn: 'العدد',
      openBucket: 'فتح القائمة المصفّاة',
    },
    generated: (timestamp) => `أُنشئ في ${timestamp}`,
    loadError: 'تعذّر تحميل تقرير التحليلات.',
    exportSuccess: 'تم تصدير التقرير.',
    loadingTitle: 'تحليلات الشؤون القانونية',
  },
};

export function resolveAnalyticsLabels(locale: AppLocale = 'en'): AnalyticsLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useAnalyticsLabels(): AnalyticsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveAnalyticsLabels(locale), [locale]);
}
