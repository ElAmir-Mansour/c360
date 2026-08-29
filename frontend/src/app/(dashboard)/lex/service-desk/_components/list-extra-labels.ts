"use client";

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * Service Desk LIST PAGE features #2–#4 (real analytics KPIs, richer filters +
 * quick views + saved views, row selection + bulk actions).
 *
 * Follows the canonical lex i18n contract: a `LexBilingual<T> = { en, ar }`
 * bundle with two full same-shaped copies, resolved per locale by the
 * `useListExtraLabels()` hook over `resolveLexBilingual`. JSX only ever touches
 * the resolved `T`. Kept separate from `labels.ts` (which this agent does not
 * own) so the new list strings live beside their consuming components.
 *
 * NOTE on the import path: page.tsx is one level above `_components`, but THIS
 * file lives inside `_components`, so the shared resolver is at
 * `../../_lib/lex-i18n` from here.
 */

import { useMemo } from "react";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import type { AppLocale } from "@/lib/i18n";
import { type LexBilingual, resolveLexBilingual } from "../../_lib/lex-i18n";

export interface ListExtraLabels {
  // --- Real analytics KPIs (feature #2) ---
  kpis: {
    total: string;
    slaCompliance: string;
    slaComplianceTarget: (target: number) => string;
    overdue: string;
    overdueDescription: string;
    avgProcessing: string;
    avgProcessingDescription: string;
    closedRatio: string;
    closedRatioDescription: string;
    loadError: string;
  };
  kpiDetails: {
    currentQueue: string;
    requestShare: string;
    slaTarget: string;
    performanceSignal: string;
  };

  // --- Revamped command header ---
  hero: {
    eyebrow: string;
    totalMatched: string;
    visibleOnPage: string;
    activeFilters: string;
    currentPage: string;
    actionsLabel: string;
  };

  // --- Richer filters (feature #3) ---
  filters: {
    requestType: string;
    requestTypePlaceholder: string;
    department: string;
    departmentPlaceholder: string;
    service: string;
    servicePlaceholder: string;
    anyService: string;
  };

  // --- Quick-view chips (feature #3) ---
  quickViews: {
    label: string;
    myRequests: string;
    urgent: string;
    awaitingApproval: string;
  };

  // --- Saved views (feature #3) ---
  savedViews: {
    save: string;
    saved: string;
    empty: string;
  };

  // --- Navigation to sibling pages ---
  nav: {
    slaBoard: string;
    intake: string;
    notifications: string;
  };

  // --- List/board view toggle (feature #6) ---
  view: {
    label: string;
    list: string;
    board: string;
    boardEmptyColumn: string;
    noNumber: string;
    cardRequester: string;
  };

  // --- Bulk actions (feature #4) ---
  bulk: {
    reclassify: string;
    submit: string;
    exportCsv: string;
    // Reclassify dialog
    reclassifyTitle: string;
    reclassifyDescription: (count: number) => string;
    priority: string;
    reason: string;
    reasonPlaceholder: string;
    cancel: string;
    apply: string;
    applying: string;
    errorReasonRequired: string;
    // Result toasts
    summaryTitle: string;
    summary: (updated: number, failed: number) => string;
    submitSkipped: (count: number) => string;
    noDraftsTitle: string;
    noDraftsDescription: string;
    exportEmpty: string;
  };
}

const bundle: LexBilingual<ListExtraLabels> = {
  en: {
    kpis: {
      total: "Total requests",
      slaCompliance: "SLA compliance",
      slaComplianceTarget: (target) => `Target ${target}%`,
      overdue: "Overdue requests",
      overdueDescription: "Past their turnaround deadline",
      avgProcessing: "Avg processing",
      avgProcessingDescription: "Hours per request",
      closedRatio: "Closed-case ratio",
      closedRatioDescription: "Share of cases closed",
      loadError: "Failed to load analytics.",
    },
    kpiDetails: {
      currentQueue: "Current queue",
      requestShare: "Request share",
      slaTarget: "SLA target",
      performanceSignal: "Performance signal",
    },
    hero: {
      eyebrow: "Legal operations intake",
      totalMatched: "Matched requests",
      visibleOnPage: "Visible now",
      activeFilters: "Active filters",
      currentPage: "Page",
      actionsLabel: "Workspace shortcuts",
    },
    filters: {
      requestType: "Request type",
      requestTypePlaceholder: "e.g. contract_review",
      department: "Department",
      departmentPlaceholder: "e.g. Procurement",
      service: "Service",
      servicePlaceholder: "Any service",
      anyService: "Any service",
    },
    quickViews: {
      label: "Quick views",
      myRequests: "My requests",
      urgent: "Urgent",
      awaitingApproval: "Awaiting approval",
    },
    savedViews: {
      save: "Save current view",
      saved: "Saved views",
      empty: "No saved views yet",
    },
    nav: {
      slaBoard: "SLA board",
      intake: "Intake",
      notifications: "Notifications",
    },
    view: {
      label: "View",
      list: "List",
      board: "Board",
      boardEmptyColumn: "No requests",
      noNumber: "No number",
      cardRequester: "Requester",
    },
    bulk: {
      reclassify: "Reclassify priority",
      submit: "Submit",
      exportCsv: "Export CSV",
      reclassifyTitle: "Reclassify priority",
      reclassifyDescription: (count) =>
        `Set a new priority for ${count} selected request${count === 1 ? "" : "s"}.`,
      priority: "New priority",
      reason: "Reason",
      reasonPlaceholder: "Why is the priority changing?",
      cancel: "Cancel",
      apply: "Apply",
      applying: "Applying...",
      errorReasonRequired: "A reason is required.",
      summaryTitle: "Bulk action completed",
      summary: (updated, failed) =>
        failed > 0
          ? `${updated} updated, ${failed} failed.`
          : `${updated} updated.`,
      submitSkipped: (count) =>
        `${count} request${count === 1 ? "" : "s"} skipped (only drafts can be submitted).`,
      noDraftsTitle: "Nothing to submit",
      noDraftsDescription: "None of the selected requests are drafts.",
      exportEmpty: "No rows to export.",
    },
  },
  ar: {
    kpis: {
      total: "إجمالي الطلبات",
      slaCompliance: "الالتزام باتفاقية مستوى الخدمة",
      slaComplianceTarget: (target) => `المستهدف ${target}%`,
      overdue: "الطلبات المتأخّرة",
      overdueDescription: "تجاوزت الموعد النهائي للإنجاز",
      avgProcessing: "متوسّط المعالجة",
      avgProcessingDescription: "ساعات لكل طلب",
      closedRatio: "نسبة القضايا المغلقة",
      closedRatioDescription: "حصّة القضايا المغلقة",
      loadError: "تعذّر تحميل التحليلات.",
    },
    kpiDetails: {
      currentQueue: "القائمة الحالية",
      requestShare: "حصة الطلبات",
      slaTarget: "مستهدف مستوى الخدمة",
      performanceSignal: "إشارة الأداء",
    },
    hero: {
      eyebrow: "استقبال العمليات القانونية",
      totalMatched: "الطلبات المطابقة",
      visibleOnPage: "المعروضة الآن",
      activeFilters: "الفلاتر النشطة",
      currentPage: "الصفحة",
      actionsLabel: "اختصارات مساحة العمل",
    },
    filters: {
      requestType: "نوع الطلب",
      requestTypePlaceholder: "مثال: contract_review",
      department: "الإدارة",
      departmentPlaceholder: "مثال: المشتريات",
      service: "الخدمة",
      servicePlaceholder: "أي خدمة",
      anyService: "أي خدمة",
    },
    quickViews: {
      label: "عروض سريعة",
      myRequests: "طلباتي",
      urgent: "عاجلة",
      awaitingApproval: "بانتظار الموافقة",
    },
    savedViews: {
      save: "حفظ العرض الحالي",
      saved: "العروض المحفوظة",
      empty: "لا توجد عروض محفوظة بعد",
    },
    nav: {
      slaBoard: "لوحة اتفاقية مستوى الخدمة",
      intake: "الاستقبال",
      notifications: "الإشعارات",
    },
    view: {
      label: "العرض",
      list: "قائمة",
      board: "لوحة",
      boardEmptyColumn: "لا توجد طلبات",
      noNumber: "بلا رقم",
      cardRequester: "مقدّم الطلب",
    },
    bulk: {
      reclassify: "إعادة تصنيف الأولوية",
      submit: "تقديم",
      exportCsv: "تصدير CSV",
      reclassifyTitle: "إعادة تصنيف الأولوية",
      reclassifyDescription: (count) =>
        `حدّد أولوية جديدة لـ ${count} من الطلبات المحدّدة.`,
      priority: "الأولوية الجديدة",
      reason: "السبب",
      reasonPlaceholder: "لماذا تتغيّر الأولوية؟",
      cancel: "إلغاء",
      apply: "تطبيق",
      applying: "جارٍ التطبيق...",
      errorReasonRequired: "السبب مطلوب.",
      summaryTitle: "اكتمل الإجراء الجماعي",
      summary: (updated, failed) =>
        failed > 0
          ? `تم تحديث ${updated}، وفشل ${failed}.`
          : `تم تحديث ${updated}.`,
      submitSkipped: (count) =>
        `تم تخطّي ${count} من الطلبات (يمكن تقديم المسوّدات فقط).`,
      noDraftsTitle: "لا شيء للتقديم",
      noDraftsDescription: "لا يوجد بين الطلبات المحدّدة أي مسوّدة.",
      exportEmpty: "لا توجد صفوف للتصدير.",
    },
  },
};

export function resolveListExtraLabels(
  locale: AppLocale = "en",
): ListExtraLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useListExtraLabels(): ListExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveListExtraLabels(locale), [locale]);
}
