/**
 * Typed bilingual catalogue for the Legal Director landing dashboard.
 *
 * The dashboard owns only copy that is specific to this composition. Legal
 * domain names continue to come from the suite-wide `lexOverviewLabels`
 * catalogue so the same domain key cannot acquire two different translations.
 *
 * Product semantics that remain open in WLS-UI-SPEC-LD-001 are deliberately
 * absent from this file. In particular, the catalogue does not assign a unit
 * to Active Consultations, reconcile cross-panel totals, or name a destination
 * for the unresolved drill-through actions. The Calendar panel title and its
 * calendar-specific empty/error copy remain owned by the already-registered
 * `lex.calendar` catalogue; this file supplies only neutral dashboard-shell
 * states for that panel.
 */

'use client';

import { useMemo } from 'react';
import { useBilingual } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { registerMessages } from '@/lib/i18n/registry';
import {
  resolveLexBilingual,
  resolveLexLabels,
  useLexLabels,
  type LexBilingual,
  type LexOverviewLabels,
} from '../lex-i18n';

export const LEGAL_DIRECTOR_DASHBOARD_NAMESPACE =
  'lex.legalDirectorDashboard' as const;

export interface DashboardStateLabels {
  loading: string;
  empty: string;
  error: string;
  zero: string;
}

export interface LegalDirectorDashboardMessages {
  pageTitle: string;
  hero: {
    roleEyebrow: string;
    rolePill: string;
    welcome: (fullName: string) => string;
    subtitle: string;
  };
  window: {
    label: string;
    today: string;
    sevenDays: (formattedDays: string) => string;
    thirtyDays: (formattedDays: string) => string;
  };
  kpis: {
    sla: string;
    complianceScore: string;
    activeCases: string;
    activeInvestigations: string;
    activeContracts: string;
    activeConsultations: string;
  };
  panels: {
    escalations: string;
    serviceRequests: string;
    teamWorkload: string;
    resolutionRate: string;
    aiAgent: string;
    legalDomains: string;
    managerTasks: string;
  };
  managerTasks: {
    /** Caption when the caller sees the whole tenant's board. */
    scopeTenant: string;
    /** Caption when the caller sees only tasks they created or received. */
    scopeOwn: string;
    summary: (awaitingReview: string, inProgress: string, total: string) => string;
    columns: {
      task: string;
      assignee: string;
      status: string;
    };
  };
  severity: {
    critical: string;
    high: string;
    medium: string;
  };
  serviceRequestCategories: {
    contracts: string;
    consultations: string;
    litigations: string;
    investigation: string;
    other: string;
  };
  workload: {
    active: string;
    capacity: string;
    atLimit: string;
    optimal: string;
    activeOfCapacity: (formattedActive: string, formattedCapacity: string) => string;
    viewBalanceSheet: string;
  };
  /**
   * "My AI Agent" copy. The panel title itself stays in `panels.aiAgent` and
   * the neutral shell states in `states.aiAgent`; everything below is the
   * conversation surface the spec did not have copy for.
   *
   * The failure strings distinguish the assistant's four honest outcomes: a
   * transport failure worth resending, a model refusal, an environment with no
   * provider key, and a caller with no readable legal domain to ground on.
   */
  aiAgent: {
    heading: string;
    intro: string;
    askLabel: string;
    askPlaceholder: string;
    send: string;
    sending: string;
    searchLabel: string;
    searchPlaceholder: string;
    recent: string;
    newChat: string;
    noChats: string;
    noMatches: string;
    transcript: string;
    you: string;
    assistant: string;
    groundedIn: (formattedCount: string, isSingular: boolean) => string;
    errors: {
      failed: string;
      refused: string;
      providerOffline: string;
      noGrounding: string;
    };
  };
  values: {
    total: string;
    warnings: (formattedCount: string, isSingular: boolean) => string;
  };
  actions: {
    retry: string;
    viewAll: string;
  };
  states: {
    kpi: DashboardStateLabels;
    escalations: DashboardStateLabels;
    managerTasks: DashboardStateLabels;
    serviceRequests: DashboardStateLabels;
    teamWorkload: DashboardStateLabels;
    resolutionRate: DashboardStateLabels;
    aiAgent: DashboardStateLabels;
    calendar: DashboardStateLabels;
    legalDomains: DashboardStateLabels;
  };
  accessibility: {
    timeWindowSelector: string;
    selectedWindow: (label: string) => string;
    kpiLink: (label: string) => string;
    kpiUnavailable: (label: string) => string;
    chart: (title: string) => string;
    chartTable: (title: string) => string;
    loadingPanel: (title: string) => string;
    retryPanel: (title: string) => string;
    avatar: (name: string) => string;
    domainLink: (label: string) => string;
    columns: {
      category: string;
      count: string;
      percentage: string;
      rate: string;
      teamMember: string;
      active: string;
      capacity: string;
      status: string;
    };
  };
}

/**
 * Resolved labels consumed by dashboard components. `domains` is composed from
 * the existing Lex catalogue and is intentionally not registered a second time
 * beneath the Legal Director namespace.
 */
export type LegalDirectorDashboardLabels = LegalDirectorDashboardMessages & {
  domains: LexOverviewLabels['domains'];
};

export const legalDirectorDashboardMessages: LexBilingual<LegalDirectorDashboardMessages> = {
  en: {
    pageTitle: 'Legal Director Dashboard',
    hero: {
      roleEyebrow: 'Legal Director',
      rolePill: 'Legal Director (Head of Legal)',
      welcome: (fullName) => `Welcome, ${fullName}`,
      subtitle: 'Command view across matters, contracts, litigation, and compliance',
    },
    window: {
      label: 'Dashboard time window',
      today: 'Today',
      sevenDays: (formattedDays) => `${formattedDays} Days`,
      thirtyDays: (formattedDays) => `${formattedDays} Days`,
    },
    kpis: {
      sla: 'SLA',
      complianceScore: 'Compliance Score',
      activeCases: 'Active Cases',
      activeInvestigations: 'Active Investigations',
      activeContracts: 'Active Contracts',
      activeConsultations: 'Active Consultations',
    },
    panels: {
      escalations: 'Escalation & Risk Warnings',
      serviceRequests: 'Service Request Distribution',
      teamWorkload: 'Team Workload Distribution',
      resolutionRate: 'Legal Teams Resolution Rate',
      aiAgent: 'My AI Agent',
      legalDomains: 'Legal Domains',
      managerTasks: 'Task Management',
    },
    managerTasks: {
      scopeTenant: 'All assigned work across the legal department.',
      scopeOwn: 'Tasks you assigned or were assigned.',
      summary: (awaitingReview, inProgress, total) =>
        `${awaitingReview} awaiting review · ${inProgress} in progress · ${total} total`,
      columns: {
        task: 'Task',
        assignee: 'Assignee',
        status: 'Status',
      },
    },
    severity: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
    },
    serviceRequestCategories: {
      contracts: 'Contracts',
      consultations: 'Consultations',
      litigations: 'Litigations',
      investigation: 'Investigation',
      other: 'Other task',
    },
    workload: {
      active: 'Active',
      capacity: 'Capacity',
      atLimit: 'At Limit',
      optimal: 'Optimal',
      activeOfCapacity: (active, capacity) => `${active} of ${capacity} active`,
      viewBalanceSheet: 'View Balance Sheet',
    },
    aiAgent: {
      heading: 'What can I help with?',
      intro: 'Answers are grounded in the legal data you can already read.',
      askLabel: 'Ask anything',
      askPlaceholder: 'Ask anything',
      send: 'Send',
      sending: 'Thinking…',
      searchLabel: 'Search chats',
      searchPlaceholder: 'Search chats',
      recent: 'Recent chats',
      newChat: 'New chat',
      noChats: 'No chats yet',
      noMatches: 'No chats match your search',
      transcript: 'Conversation',
      you: 'You',
      assistant: 'AI Agent',
      groundedIn: (formattedCount, isSingular) =>
        `Grounded in ${formattedCount} legal source${isSingular ? '' : 's'}`,
      errors: {
        failed: 'The assistant could not answer. Send your question again.',
        refused: 'The assistant declined to answer this request.',
        providerOffline: 'The assistant is not configured in this environment.',
        noGrounding:
          'You can read no legal domain, so there is nothing to ground an answer on.',
      },
    },
    values: {
      total: 'Total',
      warnings: (formattedCount, isSingular) =>
        `${formattedCount} warning${isSingular ? '' : 's'}`,
    },
    actions: {
      retry: 'Retry',
      viewAll: 'View all',
    },
    states: {
      kpi: {
        loading: 'Loading KPI data',
        empty: 'No KPI data available',
        error: 'Unable to load KPI data',
        zero: 'Value is zero',
      },
      escalations: {
        loading: 'Loading warnings',
        empty: 'No warning data available',
        error: 'Unable to load warnings',
        zero: 'No warnings',
      },
      managerTasks: {
        loading: 'Loading tasks',
        empty: 'No tasks assigned yet',
        error: 'Unable to load tasks',
        zero: 'No open tasks',
      },
      serviceRequests: {
        loading: 'Loading service request data',
        empty: 'No service request data available',
        error: 'Unable to load service request data',
        zero: 'No service requests',
      },
      teamWorkload: {
        loading: 'Loading team workload data',
        empty: 'No team workload data available',
        error: 'Unable to load team workload data',
        zero: 'No active workload',
      },
      resolutionRate: {
        loading: 'Loading resolution rate data',
        empty: 'No resolution rate data available',
        error: 'Unable to load resolution rate data',
        zero: 'Rate is zero',
      },
      aiAgent: {
        loading: 'Loading AI Agent data',
        empty: 'No AI Agent data available',
        error: 'Unable to load AI Agent data',
        zero: 'No AI Agent activity',
      },
      calendar: {
        loading: 'Loading schedule',
        empty: 'No schedule data available',
        error: 'Unable to load the schedule',
        zero: 'Nothing scheduled',
      },
      legalDomains: {
        loading: 'Loading legal domain data',
        empty: 'No legal domain data available',
        error: 'Unable to load legal domain data',
        zero: 'Count is zero',
      },
    },
    accessibility: {
      timeWindowSelector: 'Select dashboard time window',
      selectedWindow: (label) => `${label}, selected`,
      kpiLink: (label) => `Open ${label}`,
      kpiUnavailable: (label) =>
        `${label}: value not available with your permissions`,
      chart: (title) => `${title} chart`,
      chartTable: (title) => `${title} data table`,
      loadingPanel: (title) => `Loading ${title}`,
      retryPanel: (title) => `Retry loading ${title}`,
      avatar: (name) => `${name} avatar`,
      domainLink: (label) => `Open ${label}`,
      columns: {
        category: 'Category',
        count: 'Count',
        percentage: 'Percentage',
        rate: 'Rate',
        teamMember: 'Team member',
        active: 'Active',
        capacity: 'Capacity',
        status: 'Status',
      },
    },
  },
  ar: {
    pageTitle: 'لوحة المعلومات للمدير القانوني',
    hero: {
      roleEyebrow: 'المدير القانوني',
      rolePill: 'المدير القانوني (رئيس الإدارة القانونية)',
      welcome: (fullName) => `مرحبًا، ${fullName}`,
      subtitle: 'نظرة قيادية على القضايا والعقود والتقاضي والامتثال',
    },
    window: {
      label: 'النطاق الزمني للوحة المعلومات',
      today: 'اليوم',
      sevenDays: (formattedDays) => `${formattedDays} أيام`,
      thirtyDays: (formattedDays) => `${formattedDays} يومًا`,
    },
    kpis: {
      sla: 'SLA — اتفاقية مستوى الخدمة',
      complianceScore: 'درجة الامتثال',
      activeCases: 'القضايا النشطة',
      activeInvestigations: 'التحقيقات النشطة',
      activeContracts: 'العقود النشطة',
      activeConsultations: 'الاستشارات النشطة',
    },
    panels: {
      escalations: 'تنبيهات التصعيد والمخاطر',
      serviceRequests: 'توزيع طلبات الخدمة',
      teamWorkload: 'توزيع أعباء عمل الفريق',
      resolutionRate: 'معدل إنجاز الفرق القانونية',
      aiAgent: 'وكيل الذكاء الاصطناعي الخاص بي',
      legalDomains: 'المجالات القانونية',
      managerTasks: 'إدارة المهام',
    },
    managerTasks: {
      scopeTenant: 'جميع الأعمال المُسندة في الإدارة القانونية.',
      scopeOwn: 'المهام التي أسندتها أو أُسندت إليك.',
      summary: (awaitingReview, inProgress, total) =>
        `${awaitingReview} بانتظار المراجعة · ${inProgress} قيد التنفيذ · ${total} الإجمالي`,
      columns: {
        task: 'المهمة',
        // Glossary term "assignee / owner": task assignee is المُكلَّف
        // (المالك / المستلم are banned renderings).
        assignee: 'المُكلَّف بالمهمة',
        status: 'الحالة',
      },
    },
    severity: {
      critical: 'حرجة',
      high: 'عالية',
      medium: 'متوسطة',
    },
    serviceRequestCategories: {
      contracts: 'العقود',
      consultations: 'الاستشارات',
      litigations: 'قضايا التقاضي',
      investigation: 'التحقيقات',
      other: 'مهمة أخرى',
    },
    workload: {
      active: 'نشط',
      capacity: 'السعة',
      atLimit: 'بلغ الحد',
      optimal: 'مثالي',
      activeOfCapacity: (active, capacity) => `${active} من ${capacity} نشط`,
      viewBalanceSheet: 'عرض بيان عبء العمل',
    },
    aiAgent: {
      heading: 'بمَ يمكنني مساعدتك؟',
      intro: 'ترتكز الإجابات على البيانات القانونية المتاحة لك أصلًا.',
      askLabel: 'اسأل عن أي شيء',
      askPlaceholder: 'اسأل عن أي شيء',
      send: 'إرسال',
      sending: 'جارٍ التفكير…',
      searchLabel: 'البحث في المحادثات',
      searchPlaceholder: 'البحث في المحادثات',
      recent: 'المحادثات الأخيرة',
      newChat: 'محادثة جديدة',
      noChats: 'لا توجد محادثات بعد',
      noMatches: 'لا توجد محادثات مطابقة لبحثك',
      transcript: 'المحادثة',
      you: 'أنت',
      assistant: 'وكيل الذكاء الاصطناعي',
      groundedIn: (formattedCount, _isSingular) =>
        `مرتكز على ${formattedCount} من المصادر القانونية`,
      errors: {
        failed: 'تعذّر على المساعد الإجابة. أعِد إرسال سؤالك.',
        refused: 'امتنع المساعد عن الإجابة على هذا الطلب.',
        providerOffline: 'المساعد غير مُهيّأ في هذه البيئة.',
        noGrounding: 'لا يمكنك قراءة أي مجال قانوني، لذا لا توجد بيانات ترتكز عليها الإجابة.',
      },
    },
    values: {
      total: 'الإجمالي',
      warnings: (formattedCount, _isSingular) => `${formattedCount} تنبيهًا`,
    },
    actions: {
      retry: 'إعادة المحاولة',
      viewAll: 'عرض الكل',
    },
    states: {
      kpi: {
        loading: 'جارٍ تحميل بيانات المؤشر',
        empty: 'لا تتوفر بيانات للمؤشر',
        error: 'تعذّر تحميل بيانات المؤشر',
        zero: 'القيمة صفر',
      },
      escalations: {
        loading: 'جارٍ تحميل التنبيهات',
        empty: 'لا تتوفر بيانات للتنبيهات',
        error: 'تعذّر تحميل التنبيهات',
        zero: 'لا توجد تنبيهات',
      },
      managerTasks: {
        loading: 'جارٍ تحميل المهام',
        empty: 'لا توجد مهام مُسندة بعد',
        error: 'تعذّر تحميل المهام',
        zero: 'لا توجد مهام مفتوحة',
      },
      serviceRequests: {
        loading: 'جارٍ تحميل بيانات طلبات الخدمة',
        empty: 'لا تتوفر بيانات لطلبات الخدمة',
        error: 'تعذّر تحميل بيانات طلبات الخدمة',
        zero: 'لا توجد طلبات خدمة',
      },
      teamWorkload: {
        loading: 'جارٍ تحميل بيانات عبء عمل الفريق',
        empty: 'لا تتوفر بيانات لعبء عمل الفريق',
        error: 'تعذّر تحميل بيانات عبء عمل الفريق',
        zero: 'لا يوجد عبء عمل نشط',
      },
      resolutionRate: {
        loading: 'جارٍ تحميل بيانات معدل الإنجاز',
        empty: 'لا تتوفر بيانات لمعدل الإنجاز',
        error: 'تعذّر تحميل بيانات معدل الإنجاز',
        zero: 'المعدل صفر',
      },
      aiAgent: {
        loading: 'جارٍ تحميل بيانات وكيل الذكاء الاصطناعي',
        empty: 'لا تتوفر بيانات لوكيل الذكاء الاصطناعي',
        error: 'تعذّر تحميل بيانات وكيل الذكاء الاصطناعي',
        zero: 'لا يوجد نشاط لوكيل الذكاء الاصطناعي',
      },
      calendar: {
        loading: 'جارٍ تحميل الجدول',
        empty: 'لا تتوفر بيانات للجدول',
        error: 'تعذّر تحميل الجدول',
        zero: 'لا شيء مجدول',
      },
      legalDomains: {
        loading: 'جارٍ تحميل بيانات المجالات القانونية',
        empty: 'لا تتوفر بيانات للمجالات القانونية',
        error: 'تعذّر تحميل بيانات المجالات القانونية',
        zero: 'العدد صفر',
      },
    },
    accessibility: {
      timeWindowSelector: 'اختيار النطاق الزمني للوحة المعلومات',
      selectedWindow: (label) => `${label}، محدد`,
      kpiLink: (label) => `فتح ${label}`,
      kpiUnavailable: (label) => `${label}: القيمة غير متاحة ضمن صلاحياتك`,
      chart: (title) => `مخطط ${title}`,
      chartTable: (title) => `جدول بيانات ${title}`,
      loadingPanel: (title) => `جارٍ تحميل ${title}`,
      retryPanel: (title) => `إعادة محاولة تحميل ${title}`,
      avatar: (name) => `الصورة الرمزية لـ ${name}`,
      domainLink: (label) => `فتح ${label}`,
      columns: {
        category: 'الفئة',
        count: 'العدد',
        percentage: 'النسبة المئوية',
        rate: 'المعدل',
        teamMember: 'عضو الفريق',
        active: 'نشط',
        capacity: 'السعة',
        status: 'الحالة',
      },
    },
  },
};

registerMessages(
  LEGAL_DIRECTOR_DASHBOARD_NAMESPACE,
  legalDirectorDashboardMessages,
);

/** Pure resolver for tests and non-React callers. */
export function resolveLegalDirectorDashboardLabels(
  locale: AppLocale = 'en',
): LegalDirectorDashboardLabels {
  const resolvedLocale: AppLocale = locale === 'ar' ? 'ar' : 'en';
  return {
    ...resolveLexBilingual(legalDirectorDashboardMessages, resolvedLocale),
    domains: resolveLexLabels(resolvedLocale).overview.domains,
  };
}

/** Typed hook used by the Legal Director dashboard composition. */
export function useLegalDirectorDashboardLabels(): LegalDirectorDashboardLabels {
  const local = useBilingual(legalDirectorDashboardMessages);
  const lex = useLexLabels();

  return useMemo(
    () => ({ ...local, domains: lex.overview.domains }),
    [lex.overview.domains, local],
  );
}
