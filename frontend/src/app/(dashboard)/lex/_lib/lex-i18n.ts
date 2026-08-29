/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * ClarioLegal / Watheeq (`/lex`) console.
 *
 * This is the canonical i18n contract for the ENTIRE lex suite. It mirrors the
 * ClarioDR pattern (`dr/_lib/dr-i18n.ts`) so every lex feature renders
 * token-driven, locale-resolved copy without scattering hardcoded English (or
 * inline `locale === 'ar' ? ...` ternaries) through the JSX.
 *
 * Each label group is held in a bilingual bundle `{ en, ar }` and resolved
 * against the active locale by {@link useLexLabels} (the React hook every lex
 * component/page uses) or {@link resolveLexLabels} (the pure resolver for
 * non-React contexts and tests).
 *
 * Resolution defaults to English when no locale context is mounted (mirroring
 * `useLocaleOrDefault` + the form `resolveLocalized` precedent), so isolated
 * unit tests and the `renderWithQuery` `en` default keep rendering the English
 * surface unchanged — the `en` side of every bundle MUST equal the
 * pre-existing English strings.
 *
 * THE BILINGUAL CONTRACT (followed VERBATIM by every lex feature-local label
 * file — matters / signatures / clause-library / regulations / drafting /
 * playbooks / contracts / obligations / documents / compliance / reports /
 * workflow-policies):
 *
 *   1. A label group is a `LexBilingual<T> = { en: T; ar: T }` bundle: two FULL,
 *      same-shaped copies of the label object — English in `en`, professional
 *      MSA in `ar`. Function-valued and nested-object fields appear in BOTH
 *      sides; no empty `ar` strings, no machine-junk, no whole-sentence
 *      transliteration.
 *
 *   2. Components NEVER receive the bundle; they receive the resolved `T`. A
 *      page/component reads the resolved object from `useLexLabels()` (React) or
 *      `resolveLexLabels(locale)` (non-React) and uses it exactly like a plain
 *      label object.
 *
 *   3. Interpolation params, ICU/plural shape, and Western digits are preserved
 *      across both locales (e.g. `(count) => ...` is a function on BOTH sides
 *      and returns the same `{value}` / numeric placeholders). Established legal
 *      terms use the suite glossary below (عقد / بند / قضية / التزام / لائحة /
 *      حجز قانوني / توقيع / دليل إرشادي / الامتثال / تجديد / طرف / انحراف /
 *      الحوكمة).
 *
 *   4. A feature defines its bundle as `LexBilingual<T>` and exposes it through a
 *      thin `use<Feature>Labels()` hook:
 *
 *        export const fooLabels: LexBilingual<FooLabels> = { en: {...}, ar: {...} };
 *        export function useFooLabels(): FooLabels {
 *          const { locale } = useLocaleOrDefault();
 *          return useMemo(() => resolveLexBilingual(fooLabels, locale), [locale]);
 *        }
 *
 *      Suite-wide groups (status enums, common actions) live in THIS file and
 *      are read via {@link useLexLabels}.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

/**
 * LexBilingual is the canonical bundle shape for every lex label group: two full
 * copies of the same-shaped label object, one per locale. Every lex
 * feature-local label file MUST adopt this structure.
 */
export type LexBilingual<T> = { readonly en: T; readonly ar: T };

/**
 * Returns the authored copy for the active locale. Arabic copy is deliberately
 * returned verbatim: client-approved wording in the bilingual bundle is the
 * source of truth and must not be replaced by translation-memory synonyms.
 */
export function resolveLexBilingual<T>(
  bundle: LexBilingual<T>,
  locale: AppLocale,
): T {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

/* ------------------------------------------------------------------------- *
 * Suite-wide shared label groups.
 *
 * Status-enum maps are keyed by the RAW backend token so a component can resolve
 * a label with `statusLabels[token] ?? formatToken(token)`. Both locales carry
 * the SAME key set.
 * ------------------------------------------------------------------------- */

/**
 * Contract lifecycle status labels, keyed by the raw `LexContractStatus` backend
 * token. Both locales carry the SAME key set; a component resolves with
 * `contractStatusLabels[token] ?? formatToken(token)`.
 */
export const lexContractStatusLabels: LexBilingual<Record<string, string>> = {
  en: {
    draft: 'Draft',
    internal_review: 'Internal review',
    legal_review: 'Legal review',
    negotiation: 'Negotiation',
    pending_signature: 'Pending signature',
    active: 'Active',
    suspended: 'Suspended',
    expired: 'Expired',
    terminated: 'Terminated',
    renewed: 'Renewed',
    cancelled: 'Cancelled',
  },
  ar: {
    draft: 'مسودة',
    internal_review: 'مراجعة داخلية',
    legal_review: 'مراجعة قانونية',
    negotiation: 'تفاوض',
    pending_signature: 'بانتظار التوقيع',
    active: 'ساري',
    suspended: 'موقوف',
    expired: 'منتهٍ',
    terminated: 'مُنهى',
    renewed: 'مُجدَّد',
    cancelled: 'ملغى',
  },
};

/** Severity labels shared across alerts, deviations, and risk, keyed by token. */
export const lexSeverityLabels: LexBilingual<Record<string, string>> = {
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
  },
  ar: {
    critical: 'حرج',
    high: 'مرتفع',
    medium: 'متوسط',
    low: 'منخفض',
    info: 'معلومة',
  },
};

/** Common actions reused across the lex suite, for consistent verb copy. */
export const lexCommonActionLabels: LexBilingual<{
  view: string;
  viewAll: string;
  edit: string;
  delete: string;
  cancel: string;
  save: string;
  create: string;
  export: string;
  approve: string;
  reject: string;
  requestChanges: string;
  retry: string;
  applying: string;
  /** Cross-link to the read-only Reference Library (/lex/library) from content-repository pages. */
  browseLibrary: string;
}> = {
  en: {
    view: 'View',
    viewAll: 'View all',
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    save: 'Save changes',
    create: 'Create',
    export: 'Export',
    approve: 'Approve',
    reject: 'Reject',
    requestChanges: 'Request Changes',
    retry: 'Retry',
    applying: 'Applying...',
    browseLibrary: 'Browse the Reference Library',
  },
  ar: {
    view: 'عرض',
    viewAll: 'عرض الكل',
    edit: 'تعديل',
    delete: 'حذف',
    cancel: 'إلغاء',
    save: 'حفظ التغييرات',
    create: 'إنشاء',
    export: 'تصدير',
    approve: 'موافقة',
    reject: 'رفض',
    requestChanges: 'طلب تعديلات',
    retry: 'إعادة المحاولة',
    applying: 'جارٍ التطبيق...',
    browseLibrary: 'تصفح المكتبة المرجعية',
  },
};

/* ------------------------------------------------------------------------- *
 * Lex overview (the `/lex` landing console) — reference implementation.
 *
 * This bundle is the worked example the four area agents copy. Note the
 * function-valued, interpolated fields (`createdThisMonth`, `daysShort`, …) that
 * preserve Western digits + placeholders on BOTH sides.
 * ------------------------------------------------------------------------- */

/**
 * The 19 lex command-center domain ids. Used to key {@link LexOverviewLabels.domains}
 * so both locales carry the SAME key set and the integrator's tile registry stays
 * type-safe against this union.
 */
export type LexDomainId =
  | 'litigation_cases'
  | 'service_desk'
  | 'investigations'
  | 'consultations'
  | 'settlements'
  | 'contracts'
  | 'matters'
  | 'obligations'
  | 'documents'
  | 'clause_library'
  | 'playbooks'
  | 'regulations'
  | 'signatures'
  | 'workflow_policies'
  | 'compliance'
  | 'drafting'
  | 'reports'
  | 'admin';

/** Needs-Attention item types, used to key {@link LexOverviewLabels.needsAttention.typeLabels}. */
export type LexAttentionType =
  'sla' | 'obligations' | 'approvals' | 'renewals' | 'hearings';

/** Client-local time band used by the command-center welcome. */
export type LexGreetingPeriod =
  | 'neutral'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'night';

export interface LexOverviewLabels {
  pageTitle: string;
  pageDescription: string;
  nav: {
    contracts: string;
    signatures: string;
    reports: string;
    compliance: string;
  };
  /** Command-center hero band with a localized, time-aware welcome. */
  hero: {
    eyebrow: string;
    greeting: (period: LexGreetingPeriod, name?: string) => string;
    subtitle: string;
    attentionSummary: (count: string) => string;
    allClear: string;
    freshness: {
      updated: (relativeTime: string) => string;
      refreshing: string;
    };
    quickActions: {
      reviewApprovals: string;
      newRequest: string;
      aiDrafting: string;
      compliance: string;
      export: string;
    };
    posture: {
      complianceScore: string;
      openAlerts: string;
      slaCompliance: string;
      overdue: string;
      healthy: string;
      watch: string;
      actionRequired: string;
    };
  };
  /** Cross-domain headline KPI strip labels + short descriptions. */
  commandKpis: {
    activeContracts: string;
    activeContractsDescription: string;
    openMatters: string;
    openMattersDescription: string;
    overdueObligations: string;
    overdueObligationsDescription: string;
    pendingApprovals: string;
    pendingApprovalsDescription: string;
    slaBreaches: string;
    slaBreachesDescription: string;
    openAlerts: string;
    openAlertsDescription: string;
  };
  /** Domain-tile grid: heading, per-tile view affordance, and 19 display names. */
  domainsHeading: string;
  viewLabel: string;
  domains: Record<LexDomainId, string>;
  /** Unified Needs-Attention panel: header, segment filters, empty state, type labels. */
  needsAttention: {
    title: string;
    description: string;
    filterAll: string;
    filterSla: string;
    filterObligations: string;
    filterApprovals: string;
    filterRenewals: string;
    filterHearings: string;
    emptyTitle: string;
    emptyDescription: string;
    typeLabels: Record<LexAttentionType, string>;
  };
  /** My-Work panel: items assigned to / requested by the current user. */
  myWork: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    assignedTo: string;
  };
  loadError: string;
  kpis: {
    activeContracts: string;
    activeContractsChange: string;
    createdThisMonth: (count: number) => string;
    pendingReview: string;
    pendingReviewDescription: string;
    highRisk: string;
    highRiskDescription: string;
    renewalWarnings: string;
    renewalWarningsDescription: string;
    openComplianceAlerts: string;
    openComplianceAlertsDescription: string;
    activeValue: string;
    activeValueDescription: string;
  };
  compliancePosture: {
    title: string;
    description: string;
    gaugeLabel: string;
    openAlerts: string;
    documents: string;
    trendLabel: string;
    trendEmpty: string;
    openAlertsLink: string;
    documentsLink: string;
    viewCompliance: string;
  };
  lifecycle: {
    title: string;
    description: string;
  };
  monthlyActivity: {
    title: string;
    description: string;
    series: {
      created: string;
      activated: string;
      renewed: string;
      expired: string;
    };
  };
  renewals: {
    title: string;
    description: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    daysShort: (days: number) => string;
  };
  reviewQueue: {
    title: string;
    description: string;
    selected: (count: number) => string;
    selectVisibleAria: string;
    selectVisible: string;
    selectionCount: (selected: number, total: number) => string;
    emptyTitle: string;
    emptyDescription: string;
    selectRowAria: (title: string) => string;
    unassigned: string;
    startedPrefix: string;
    selectFirstError: string;
    toastSuccessTitle: string;
    toastSuccessDescription: (count: number) => string;
    toastPartialTitle: string;
    toastPartialDescription: (succeeded: number, failed: number) => string;
    toastErrorTitle: string;
  };
  complianceAlerts: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  recentContracts: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    valuePrefix: string;
    valueUndisclosed: string;
    expiresPrefix: (date: string) => string;
    noExpiry: string;
  };
  regulations: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    fallbackSubtitle: string;
  };
}

export const lexOverviewLabels: LexBilingual<LexOverviewLabels> = {
  en: {
    pageTitle: 'Legal',
    pageDescription:
      'Live legal operations view across contracts, document lifecycle, and compliance posture.',
    nav: {
      contracts: 'Contracts',
      signatures: 'Signatures',
      reports: 'Reports',
      compliance: 'Compliance',
    },
    hero: {
      eyebrow: 'Your daily legal brief',
      greeting: (period, name) => {
        const welcome: Record<LexGreetingPeriod, string> = {
          neutral: 'Welcome',
          morning: 'Good morning',
          afternoon: 'Good afternoon',
          evening: 'Good evening',
          night: 'Welcome back',
        };
        return name ? `${welcome[period]}, ${name}` : welcome[period];
      },
      subtitle:
        'Unified view across litigation, service desk, contracts, obligations and compliance.',
      attentionSummary: (count) =>
        `${count} time-critical ${count === '1' ? 'item needs' : 'items need'} your attention today.`,
      allClear: 'No overdue or breached items need your attention right now.',
      freshness: {
        updated: (relativeTime) => `Updated ${relativeTime}`,
        refreshing: 'Refreshing legal posture…',
      },
      quickActions: {
        reviewApprovals: 'Review approvals',
        newRequest: 'New request',
        aiDrafting: 'AI drafting',
        compliance: 'Compliance',
        export: 'Export',
      },
      posture: {
        complianceScore: 'Compliance score',
        openAlerts: 'Active alerts',
        slaCompliance: 'SLA compliance',
        overdue: 'Overdue',
        healthy: 'Healthy posture',
        watch: 'Monitor closely',
        actionRequired: 'Action required',
      },
    },
    commandKpis: {
      activeContracts: 'Active Contracts',
      activeContractsDescription: 'Currently in force',
      openMatters: 'Open Matters',
      openMattersDescription: 'Across all practice areas',
      overdueObligations: 'Overdue Obligations',
      overdueObligationsDescription: 'Past their due date',
      pendingApprovals: 'Active Approval Tasks',
      pendingApprovalsDescription: 'Across approval workflows',
      slaBreaches: 'SLA Breaches',
      slaBreachesDescription: 'Service-desk clocks breached',
      openAlerts: 'Active Alerts',
      openAlertsDescription: 'Active compliance findings',
    },
    domainsHeading: 'Legal Affairs',
    viewLabel: 'Open',
    domains: {
      litigation_cases: 'Litigation Cases',
      service_desk: 'Service Desk',
      investigations: 'Investigations',
      consultations: 'Consultations',
      settlements: 'Settlements',
      contracts: 'Contracts',
      matters: 'Matters',
      obligations: 'Obligations',
      documents: 'Documents',
      clause_library: 'Clause Library',
      playbooks: 'Playbooks',
      regulations: 'Regulations',
      signatures: 'Signatures',
      workflow_policies: 'Workflow Policies',
      compliance: 'Compliance',
      drafting: 'Drafting',
      reports: 'Reports',
      admin: 'Administration',
    },
    needsAttention: {
      title: 'Needs Attention',
      description:
        'Time-critical items across every legal domain, ranked by urgency.',
      filterAll: 'All',
      filterSla: 'SLA',
      filterObligations: 'Obligations',
      filterApprovals: 'Approvals',
      filterRenewals: 'Renewals',
      filterHearings: 'Hearings',
      emptyTitle: 'Nothing needs attention',
      emptyDescription:
        'No breached, overdue or imminent items across your domains.',
      typeLabels: {
        sla: 'SLA breach',
        obligations: 'Overdue obligation',
        approvals: 'Pending approval',
        renewals: 'Renewal warning',
        hearings: 'Upcoming hearing',
      },
    },
    myWork: {
      title: 'My Work',
      description: 'Items assigned to or requested by you across the suite.',
      emptyTitle: 'No assigned work',
      emptyDescription:
        'You have no cases, requests or tasks assigned to you right now.',
      assignedTo: 'Assigned to you',
    },
    loadError: 'Failed to load legal operations overview.',
    kpis: {
      activeContracts: 'Active Contracts',
      activeContractsChange: 'new MoM',
      createdThisMonth: (count) => `${count} created this month`,
      pendingReview: 'Pending Review',
      pendingReviewDescription: 'Awaiting legal action',
      highRisk: 'High Risk',
      highRiskDescription: 'Flagged for mitigation',
      renewalWarnings: 'Renewal Warnings',
      renewalWarningsDescription: 'Within 60-day window',
      openComplianceAlerts: 'Open Compliance Alerts',
      openComplianceAlertsDescription: 'Across the portfolio',
      activeValue: 'Active Value',
      activeValueDescription: 'Total contract value',
    },
    compliancePosture: {
      title: 'Compliance Posture',
      description: 'Portfolio compliance health.',
      gaugeLabel: 'Compliance score',
      openAlerts: 'Open alerts',
      documents: 'Documents',
      trendLabel: 'Recent score trend',
      trendEmpty: 'Trend builds as scores are recorded.',
      openAlertsLink: 'View open compliance alerts',
      documentsLink: 'View documents',
      viewCompliance: 'Open compliance console',
    },
    lifecycle: {
      title: 'Lifecycle Pipeline',
      description: 'Contract volume by Watheeq lifecycle stage.',
    },
    monthlyActivity: {
      title: 'Monthly Activity',
      description:
        'Created, activated, renewed and expired contracts over time.',
      series: {
        created: 'Created',
        activated: 'Activated',
        renewed: 'Renewed',
        expired: 'Expired',
      },
    },
    renewals: {
      title: 'Renewal Warnings',
      description: 'Early warnings from expiry and renewal notice windows.',
      loadError: 'Failed to load renewal warnings.',
      emptyTitle: 'No renewal warnings',
      emptyDescription:
        'No contracts are inside the configured renewal window.',
      daysShort: (days) => {
        const count = Math.abs(days);
        if (days === 0) return 'Due today';
        if (days < 0) return `Overdue by ${count} day${count === 1 ? '' : 's'}`;
        return `Due in ${count} day${count === 1 ? '' : 's'}`;
      },
    },
    reviewQueue: {
      title: 'Review Queue',
      description:
        'Workflow-backed contract approvals and pending legal tasks.',
      selected: (count) => `${count} selected`,
      selectVisibleAria: 'Select visible workflow tasks',
      selectVisible: 'Select visible tasks',
      selectionCount: (selected, total) => `${selected} of ${total}`,
      emptyTitle: 'Nothing to review',
      emptyDescription: 'No active contract workflows are waiting for review.',
      selectRowAria: (title) => `Select ${title}`,
      unassigned: 'Unassigned',
      startedPrefix: 'Started',
      selectFirstError: 'Select workflow tasks first',
      toastSuccessTitle: 'Bulk decision applied',
      toastSuccessDescription: (count) =>
        `${count} workflow task${count === 1 ? '' : 's'} updated.`,
      toastPartialTitle: 'Bulk decision completed with errors',
      toastPartialDescription: (succeeded, failed) =>
        `${succeeded} succeeded, ${failed} failed.`,
      toastErrorTitle: 'Bulk decision failed',
    },
    complianceAlerts: {
      title: 'Compliance Alerts',
      description:
        'Latest non-compliance findings from the compliance dashboard.',
      emptyTitle: 'No open alerts',
      emptyDescription: 'No active compliance alerts are currently open.',
    },
    recentContracts: {
      title: 'Recent Contracts',
      description: 'Latest contract records and current lifecycle state.',
      emptyTitle: 'No contracts yet',
      emptyDescription: 'No contracts are available for this tenant.',
      valuePrefix: 'Value:',
      valueUndisclosed: 'Undisclosed',
      expiresPrefix: (date) => `Expires ${date}`,
      noExpiry: 'No expiry',
    },
    regulations: {
      title: 'Active Regulations',
      description: 'Enabled regulatory controls and rule definitions.',
      emptyTitle: 'No regulations',
      emptyDescription: 'No regulations are configured for this tenant.',
      fallbackSubtitle: 'Regulation library record',
    },
  },
  ar: {
    pageTitle: 'وثيق',
    pageDescription:
      'لوحة تشغيل قانونية مباشرة للعقود ودورة حياة الوثائق ووضع الامتثال.',
    nav: {
      contracts: 'العقود',
      signatures: 'التوقيعات',
      reports: 'التقارير',
      compliance: 'الامتثال',
    },
    hero: {
      eyebrow: 'موجزك القانوني اليومي',
      greeting: (period, name) => {
        const welcome: Record<LexGreetingPeriod, string> = {
          neutral: 'مرحبًا',
          morning: 'صباح الخير',
          afternoon: 'طاب نهارك',
          evening: 'مساء الخير',
          night: 'مساء الخير',
        };
        return name ? `${welcome[period]}، ${name}` : welcome[period];
      },
      subtitle:
        'عرض موحّد عبر التقاضي ومكتب الخدمة والعقود والالتزامات والامتثال.',
      attentionSummary: (count) =>
        `${count} بنود حسّاسة زمنيًا تتطلب انتباهك اليوم.`,
      allClear: 'لا توجد بنود متأخرة أو منتهكة تتطلب انتباهك الآن.',
      freshness: {
        updated: (relativeTime) => `آخر تحديث ${relativeTime}`,
        refreshing: 'جارٍ تحديث الوضع القانوني…',
      },
      quickActions: {
        reviewApprovals: 'مراجعة الموافقات',
        newRequest: 'طلب جديد',
        aiDrafting: 'الصياغة بالذكاء الاصطناعي',
        compliance: 'الامتثال',
        export: 'تصدير',
      },
      posture: {
        complianceScore: 'درجة الامتثال',
        openAlerts: 'تنبيهات نشطة',
        slaCompliance: 'الالتزام باتفاقية مستوى الخدمة',
        overdue: 'متأخرة',
        healthy: 'وضع سليم',
        watch: 'يتطلب المتابعة',
        actionRequired: 'يتطلب إجراءً',
      },
    },
    commandKpis: {
      activeContracts: 'العقود السارية',
      activeContractsDescription: 'سارية المفعول حاليًا',
      openMatters: 'القضايا المفتوحة',
      openMattersDescription: 'عبر جميع مجالات الممارسة',
      overdueObligations: 'الالتزامات المتأخرة',
      overdueObligationsDescription: 'تجاوزت تاريخ استحقاقها',
      pendingApprovals: 'مهام الاعتماد النشطة',
      pendingApprovalsDescription: 'عبر مسارات عمل الاعتماد',
      slaBreaches: 'انتهاكات مستوى الخدمة',
      slaBreachesDescription: 'مؤقتات مكتب الخدمة المُنتهَكة',
      openAlerts: 'التنبيهات النشطة',
      openAlertsDescription: 'نتائج امتثال نشطة',
    },
    domainsHeading: 'الشؤون القانونية',
    viewLabel: 'فتح',
    domains: {
      litigation_cases: 'قضايا التقاضي',
      service_desk: 'مكتب الخدمة',
      investigations: 'التحقيقات',
      consultations: 'الاستشارات',
      settlements: 'التسويات',
      contracts: 'العقود',
      matters: 'الملفات القانونية',
      obligations: 'الالتزامات',
      documents: 'الوثائق',
      clause_library: 'مكتبة البنود',
      playbooks: 'الأدلة الإرشادية',
      regulations: 'اللوائح',
      signatures: 'التوقيعات',
      workflow_policies: 'سياسات سير العمل',
      compliance: 'الامتثال',
      drafting: 'الصياغة',
      reports: 'التقارير',
      admin: 'الإدارة',
    },
    needsAttention: {
      title: 'يتطلب انتباهًا',
      description:
        'بنود حسّاسة زمنيًا عبر كل مجال قانوني، مرتّبة حسب الأولوية.',
      filterAll: 'الكل',
      filterSla: 'مستوى الخدمة',
      filterObligations: 'الالتزامات',
      filterApprovals: 'الموافقات',
      filterRenewals: 'التجديدات',
      filterHearings: 'الجلسات',
      emptyTitle: 'لا شيء يتطلّب الانتباه',
      emptyDescription: 'لا توجد بنود مُنتهَكة أو متأخرة أو وشيكة عبر مجالاتك.',
      typeLabels: {
        sla: 'انتهاك مستوى الخدمة',
        obligations: 'التزام متأخر',
        approvals: 'موافقة معلّقة',
        renewals: 'تنبيه تجديد',
        hearings: 'جلسة قادمة',
      },
    },
    myWork: {
      title: 'أعمالي',
      description: 'البنود المُسندة إليك أو المطلوبة منك عبر المجموعة.',
      emptyTitle: 'لا توجد مهام مُسندة',
      emptyDescription:
        'لا توجد لديك قضايا أو طلبات أو مهام مُسندة إليك حاليًا.',
      assignedTo: 'مُسندة إليك',
    },
    loadError: 'تعذّر تحميل نظرة عامة على العمليات القانونية.',
    kpis: {
      activeContracts: 'العقود السارية',
      activeContractsChange: 'تغيّر شهري',
      createdThisMonth: (count) => `${count} أُنشئ هذا الشهر`,
      pendingReview: 'بانتظار المراجعة',
      pendingReviewDescription: 'بانتظار إجراء قانوني',
      highRisk: 'مخاطر مرتفعة',
      highRiskDescription: 'مُعلَّمة للمعالجة',
      renewalWarnings: 'تنبيهات التجديد',
      renewalWarningsDescription: 'خلال نافذة ٦٠ يومًا',
      openComplianceAlerts: 'تنبيهات الامتثال المفتوحة',
      openComplianceAlertsDescription: 'على مستوى المحفظة',
      activeValue: 'القيمة السارية',
      activeValueDescription: 'إجمالي قيمة العقود',
    },
    compliancePosture: {
      title: 'وضع الامتثال',
      description: 'صحة امتثال المحفظة.',
      gaugeLabel: 'درجة الامتثال',
      openAlerts: 'تنبيهات مفتوحة',
      documents: 'الوثائق',
      trendLabel: 'اتجاه الدرجة الأخير',
      trendEmpty: 'يتكوّن الاتجاه كلما سُجّلت درجات.',
      openAlertsLink: 'عرض تنبيهات الامتثال المفتوحة',
      documentsLink: 'عرض الوثائق',
      viewCompliance: 'فتح لوحة الامتثال',
    },
    lifecycle: {
      title: 'مسار دورة الحياة',
      description: 'حجم العقود حسب مرحلة دورة حياة وثيق.',
    },
    monthlyActivity: {
      title: 'النشاط الشهري',
      description:
        'العقود المُنشأة والمُفعَّلة والمُجدَّدة والمنتهية عبر الزمن.',
      series: {
        created: 'مُنشأة',
        activated: 'مُفعَّلة',
        renewed: 'مُجدَّدة',
        expired: 'منتهية',
      },
    },
    renewals: {
      title: 'تنبيهات التجديد',
      description: 'تنبيهات مبكرة من نوافذ الانتهاء وإشعارات التجديد.',
      loadError: 'تعذّر تحميل تنبيهات التجديد.',
      emptyTitle: 'لا توجد تنبيهات تجديد',
      emptyDescription: 'لا توجد عقود ضمن نافذة التجديد المُهيّأة.',
      daysShort: (days) => {
        const count = Math.abs(days);
        if (days === 0) return 'الاستحقاق اليوم';
        if (days < 0) return `متأخر ${count} يومًا`;
        return `الاستحقاق خلال ${count} يومًا`;
      },
    },
    reviewQueue: {
      title: 'قائمة المراجعة',
      description:
        'موافقات العقود المُدارة بسير العمل والمهام القانونية المعلّقة.',
      selected: (count) => `${count} محدد`,
      selectVisibleAria: 'تحديد مهام سير العمل الظاهرة',
      selectVisible: 'تحديد المهام الظاهرة',
      selectionCount: (selected, total) => `${selected} من ${total}`,
      emptyTitle: 'لا شيء للمراجعة',
      emptyDescription: 'لا توجد عقود نشطة في سير العمل بانتظار المراجعة.',
      selectRowAria: (title) => `تحديد ${title}`,
      unassigned: 'غير مُسند',
      startedPrefix: 'بدأت',
      selectFirstError: 'حدّد مهام سير العمل أولًا',
      toastSuccessTitle: 'تم تطبيق القرار الجماعي',
      toastSuccessDescription: (count) =>
        `تم تحديث ${count} من مهام سير العمل.`,
      toastPartialTitle: 'اكتمل القرار الجماعي مع أخطاء',
      toastPartialDescription: (succeeded, failed) =>
        `نجح ${succeeded}، وفشل ${failed}.`,
      toastErrorTitle: 'فشل القرار الجماعي',
    },
    complianceAlerts: {
      title: 'تنبيهات الامتثال',
      description: 'أحدث نتائج عدم الامتثال من لوحة الامتثال.',
      emptyTitle: 'لا توجد تنبيهات مفتوحة',
      emptyDescription: 'لا توجد تنبيهات امتثال نشطة مفتوحة حاليًا.',
    },
    recentContracts: {
      title: 'أحدث العقود',
      description: 'أحدث سجلات العقود وحالة دورة الحياة الحالية.',
      emptyTitle: 'لا توجد عقود بعد',
      emptyDescription: 'لا توجد عقود متاحة لهذا المستأجر.',
      valuePrefix: 'القيمة:',
      valueUndisclosed: 'غير مُفصح عنها',
      expiresPrefix: (date) => `ينتهي في ${date}`,
      noExpiry: 'بلا تاريخ انتهاء',
    },
    regulations: {
      title: 'اللوائح السارية',
      description: 'الضوابط التنظيمية المُفعَّلة وتعريفات القواعد.',
      emptyTitle: 'لا توجد لوائح',
      emptyDescription: 'لا توجد لوائح مُهيّأة لهذا المستأجر.',
      fallbackSubtitle: 'سجل مكتبة اللوائح',
    },
  },
};

/* ------------------------------------------------------------------------- *
 * Resolver + hook.
 * ------------------------------------------------------------------------- */

/**
 * resolveLexLabels is the pure resolver: given an explicit locale it returns the
 * resolved suite-wide lex label objects. Use it in non-React contexts; React
 * components should prefer {@link useLexLabels}. Defaults to English when no
 * locale is supplied (and any unknown locale resolves to English too) so unit
 * tests and non-React callers keep the English surface.
 *
 * Feature-local bundles (matters, signatures, …) are NOT merged here — each
 * feature exposes its OWN `use<Feature>Labels()` hook over `resolveLexBilingual`
 * — but they share this resolver's fallback + locale-normalisation semantics.
 */
export function resolveLexLabels(locale: AppLocale = 'en') {
  const loc: AppLocale = locale === 'ar' ? 'ar' : 'en';
  return {
    locale: loc,
    contractStatusLabels: resolveLexBilingual(lexContractStatusLabels, loc),
    severityLabels: resolveLexBilingual(lexSeverityLabels, loc),
    commonActions: resolveLexBilingual(lexCommonActionLabels, loc),
    overview: resolveLexBilingual(lexOverviewLabels, loc),
  };
}

export type LexLabels = ReturnType<typeof resolveLexLabels>;

/**
 * useLexLabels is THE shared React hook lex console pages/components use to read
 * the resolved suite-wide label objects. It reads the active locale via
 * `useLocaleOrDefault` (so it never throws outside a LocaleProvider and defaults
 * to English in isolated tests / the `renderWithQuery` `en` default), then
 * returns the resolved label objects (memoized on locale).
 *
 * Feature surfaces additionally read their feature-local hook, e.g.
 *   const labels = useLexLabels();          // suite-wide (status, actions, overview)
 *   const matter = useMatterLabels();       // feature-local bundle
 */
export function useLexLabels(): LexLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexLabels(locale), [locale]);
}
