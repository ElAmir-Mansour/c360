"use client";

import { useMemo } from "react";
import { useLocale } from "@/components/providers/locale-provider";

export interface DetailedAnalyticsLabels {
  title: string;
  description: string;
  breadcrumb: {
    suite: string;
    reports: string;
  };
  generated: (value: string) => string;
  filters: {
    priority: string;
    serviceType: string;
    department: string;
    period: string;
    all: string;
    compare: string;
    reset: string;
    filterBy: string;
  };
  priority: Record<string, string>;
  metrics: {
    total: string;
    completion: string;
    processing: string;
    satisfaction: string;
    sla: string;
    pending: string;
    requestsSample: (count: string) => string;
    completedSample: (count: string) => string;
    processingSample: (count: string) => string;
    feedbackSample: (count: string) => string;
    slaSample: (count: string) => string;
    pendingSample: string;
    unavailable: string;
    hours: string;
    newSincePrevious: string;
    versusPrevious: string;
    noPreviousSample: string;
    points: string;
  };
  charts: {
    trend: string;
    trendDescription: string;
    current: string;
    previous: string;
    department: string;
    departmentDescription: string;
    services: string;
    servicesDescription: string;
    advisors: string;
    advisorsDescription: string;
    noRequests: string;
    noDepartments: string;
    noServices: string;
    noAdvisors: string;
    requests: string;
    completed: string;
    active: string;
    rating: string;
    noRating: string;
    sla: string;
    workload: string;
    other: string;
  };
  drilldown: {
    contributors: string;
    viewContributors: (label: string) => string;
    loading: string;
    loadError: string;
    retry: string;
    empty: string;
    recordCount: (count: string) => string;
    requester: string;
    department: string;
    serviceType: string;
    created: string;
    processingHours: string;
    satisfaction: string;
    slaOutcome: string;
    advisor: string;
    unspecified: string;
    previous: string;
    next: string;
  };
  actions: {
    loading: string;
    exportCsv: string;
    exportXlsx: string;
    print: string;
    classicReports: string;
    exportSuccess: string;
    loadError: string;
  };
}

const en: DetailedAnalyticsLabels = {
  title: "Detailed Analytics",
  description:
    "Request demand, service delivery, SLA performance, and advisor outcomes for Legal leadership.",
  breadcrumb: {
    suite: "WatheeqTech",
    reports: "Reports",
  },
  generated: (value) => `Generated ${value}`,
  filters: {
    priority: "Priority",
    serviceType: "Service type",
    department: "Department",
    period: "Report period",
    all: "All",
    compare: "Compare with previous period",
    reset: "Reset filters",
    filterBy: "Filter data by",
  },
  priority: { urgent: "Urgent", normal: "Normal" },
  metrics: {
    total: "Total requests",
    completion: "Completion rate",
    processing: "Average processing time",
    satisfaction: "Satisfaction",
    sla: "SLA compliance",
    pending: "Pending requests",
    requestsSample: (count) => `${count} requests received`,
    completedSample: (count) => `Based on ${count} requests`,
    processingSample: (count) => `${count} completed processing samples`,
    feedbackSample: (count) => `${count} requester responses`,
    slaSample: (count) => `${count} resolved SLA clocks`,
    pendingSample: "Excludes closed and cancelled requests",
    unavailable: "No observations",
    hours: "hrs",
    newSincePrevious: "New vs previous period",
    versusPrevious: "vs previous period",
    noPreviousSample: "No comparable previous sample",
    points: "pts",
  },
  charts: {
    trend: "Monthly request trend",
    trendDescription:
      "Requests created in each calendar month of the selected period.",
    current: "Current period",
    previous: "Previous period",
    department: "Requests by department",
    departmentDescription: "Demand from requesting departments.",
    services: "Distribution by service type",
    servicesDescription: "Share of requests by the canonical service type.",
    advisors: "Legal advisor performance",
    advisorsDescription:
      "Actual downstream owners across consultations, cases, and contract review.",
    noRequests: "No requests match this period and filter set.",
    noDepartments: "No department distribution is available.",
    noServices: "No service-type distribution is available.",
    noAdvisors: "No requests in this scope have a resolved legal advisor.",
    requests: "Requests",
    completed: "completed",
    active: "active",
    rating: "rating",
    noRating: "Not rated",
    sla: "SLA",
    workload: "Workload",
    other: "Other",
  },
  drilldown: {
    contributors: "Contributing requests",
    viewContributors: (label) => `View requests contributing to ${label}`,
    loading: "Loading contributing requests…",
    loadError: "Contributing requests could not be loaded.",
    retry: "Try again",
    empty: "No contributing requests are available for this result.",
    recordCount: (count) => `${count} contributing requests`,
    requester: "Requester",
    department: "Department",
    serviceType: "Service type",
    created: "Created",
    processingHours: "Processing time",
    satisfaction: "Satisfaction",
    slaOutcome: "SLA outcome",
    advisor: "Advisor",
    unspecified: "Unspecified",
    previous: "Previous",
    next: "Next",
  },
  actions: {
    loading: "Loading detailed analytics…",
    exportCsv: "Export CSV",
    exportXlsx: "Export XLSX",
    print: "Print",
    classicReports: "Report exports",
    exportSuccess: "Analytics export downloaded.",
    loadError: "Detailed analytics could not be loaded.",
  },
};

const ar: DetailedAnalyticsLabels = {
  title: "التحليلات التفصيلية",
  description:
    "حجم الطلبات وأداء تقديم الخدمات والالتزام باتفاقيات المستوى ونتائج المستشارين للإدارة القانونية.",
  breadcrumb: {
    suite: "وثيقتك",
    reports: "التقارير",
  },
  generated: (value) => `تم الإنشاء ${value}`,
  filters: {
    priority: "الأولوية",
    serviceType: "نوع الخدمة",
    department: "الإدارة",
    period: "فترة التقرير",
    all: "الكل",
    compare: "مقارنة بالفترة السابقة",
    reset: "إعادة ضبط المرشحات",
    filterBy: "تصفية البيانات حسب",
  },
  priority: { urgent: "عاجل", normal: "عادي" },
  metrics: {
    total: "إجمالي الطلبات",
    completion: "معدل الإنجاز",
    processing: "متوسط وقت المعالجة",
    satisfaction: "الرضا",
    sla: "الالتزام باتفاقية المستوى",
    pending: "الطلبات المعلقة",
    requestsSample: (count) => `${count} طلباً مستلماً`,
    completedSample: (count) => `استناداً إلى ${count} طلباً`,
    processingSample: (count) => `${count} عينة معالجة مكتملة`,
    feedbackSample: (count) => `${count} استجابة من مقدمي الطلبات`,
    slaSample: (count) => `${count} مؤقت خدمة محسوم`,
    pendingSample: "لا تشمل الطلبات المغلقة والملغاة",
    unavailable: "لا توجد مشاهدات",
    hours: "ساعة",
    newSincePrevious: "جديد مقارنة بالفترة السابقة",
    versusPrevious: "مقارنة بالفترة السابقة",
    noPreviousSample: "لا توجد عينة سابقة قابلة للمقارنة",
    points: "نقطة",
  },
  charts: {
    trend: "اتجاه الطلبات الشهري",
    trendDescription: "الطلبات المنشأة في كل شهر تقويمي ضمن الفترة المحددة.",
    current: "الفترة الحالية",
    previous: "الفترة السابقة",
    department: "الطلبات حسب الإدارة",
    departmentDescription: "حجم الطلب من الإدارات الطالبة.",
    services: "التوزيع حسب نوع الخدمة",
    servicesDescription: "حصة الطلبات حسب نوع الخدمة المعتمد.",
    advisors: "أداء المستشارين القانونيين",
    advisorsDescription:
      "المسؤولون الفعليون عن الاستشارات والقضايا ومراجعة العقود.",
    noRequests: "لا توجد طلبات مطابقة لهذه الفترة والمرشحات.",
    noDepartments: "لا يتوفر توزيع حسب الإدارة.",
    noServices: "لا يتوفر توزيع حسب نوع الخدمة.",
    noAdvisors: "لا توجد طلبات مرتبطة بمستشار قانوني محدد ضمن هذا النطاق.",
    requests: "الطلبات",
    completed: "مكتمل",
    active: "نشط",
    rating: "التقييم",
    noRating: "غير مقيّم",
    sla: "اتفاقية المستوى",
    workload: "حمولة العمل",
    other: "أخرى",
  },
  drilldown: {
    contributors: "الطلبات المساهمة",
    viewContributors: (label) => `عرض الطلبات المساهمة في ${label}`,
    loading: "جارٍ تحميل الطلبات المساهمة…",
    loadError: "تعذر تحميل الطلبات المساهمة.",
    retry: "إعادة المحاولة",
    empty: "لا توجد طلبات مساهمة متاحة لهذه النتيجة.",
    recordCount: (count) => `${count} طلباً مساهماً`,
    requester: "مقدم الطلب",
    department: "الإدارة",
    serviceType: "نوع الخدمة",
    created: "تاريخ الإنشاء",
    processingHours: "وقت المعالجة",
    satisfaction: "الرضا",
    slaOutcome: "نتيجة اتفاقية المستوى",
    advisor: "المستشار",
    unspecified: "غير محدد",
    previous: "السابق",
    next: "التالي",
  },
  actions: {
    loading: "جارٍ تحميل التحليلات التفصيلية…",
    exportCsv: "تصدير CSV",
    exportXlsx: "تصدير XLSX",
    print: "طباعة",
    classicReports: "تصدير التقارير",
    exportSuccess: "تم تنزيل تصدير التحليلات.",
    loadError: "تعذر تحميل التحليلات التفصيلية.",
  },
};

export function useDetailedAnalyticsLabels(): DetailedAnalyticsLabels {
  const { locale } = useLocale();
  return useMemo(() => (locale === "ar" ? ar : en), [locale]);
}
