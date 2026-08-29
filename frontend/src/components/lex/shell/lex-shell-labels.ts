/**
 * Local bilingual (EN/AR) label bundle for the lex SHELL chrome — sidebar groups
 * + nav items, breadcrumbs, recent strip, command palette and global search.
 *
 * Follows the suite bilingual contract verbatim (see `lex/_lib/lex-i18n.ts`):
 * two full, same-shaped copies of the label object resolved against the active
 * locale via {@link resolveLexBilingual}. This is the shell's OWN local bundle —
 * it intentionally does NOT extend the shared suite i18n file.
 *
 * Route labels reuse the canonical domain names already defined in
 * `lexOverviewLabels.domains` where they overlap; the extra shell-only routes
 * (command center, calendar, inbox, analytics, entities, drafting, regulations,
 * clause library, playbooks) are added here so the rail stays bilingual without
 * touching the shared file.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';

export interface LexShellLabels {
  /** Task-oriented navigation group headings. */
  groups: {
    daily_work: string;
    governance: string;
    insights: string;
    administration: string;
  };
  /** Combined desktop navigation domains. */
  clusters: {
    contracts_consultations: string;
    cases_investigations: string;
    references_library: string;
  };
  /** Route display names, keyed by route id (one per nav entry). */
  routes: Record<string, string>;
  /** Sidebar chrome. */
  sidebar: {
    railLabel: string;
    collapse: string;
    expand: string;
    home: string;
    suiteName: string;
    suiteTagline: string;
  };
  /** Breadcrumb chrome. */
  breadcrumbs: {
    home: string;
    ariaLabel: string;
  };
  /** Recently-viewed strip. */
  recent: {
    title: string;
    clear: string;
    empty: string;
  };
  /** Command palette + global search. */
  palette: {
    placeholder: string;
    searchPlaceholder: string;
    jumpSection: string;
    actionsSection: string;
    searchSection: string;
    casesSection: string;
    contractsSection: string;
    requestsSection: string;
    clausesSection: string;
    mattersSection: string;
    open: string;
    actions: {
      newRequest: string;
      newCase: string;
      aiDrafting: string;
      export: string;
    };
  };
  search: {
    label: string;
    placeholder: string;
    hint: string;
  };
}

export const lexShellLabels: LexBilingual<LexShellLabels> = {
  en: {
    groups: {
      daily_work: 'Daily Work',
      governance: 'Governance',
      insights: 'Insights',
      administration: 'Admin',
    },
    clusters: {
      contracts_consultations: 'Contracts and Consultations',
      cases_investigations: 'Cases and Investigations',
      references_library: 'References and Library',
    },
    routes: {
      // ── The ten first-class PRD modules ──────────────────────────────────
      command_center: 'Overview',
      // Service-workspace dashboards (cluster leads).
      contracts_control: 'Contracts & Consultations Panel',
      cases_control: 'Cases & Investigations Panel',
      legal_services: 'Legal Services & Requests',
      consultations: 'Consultations',
      tasks: 'Task Management',
      approvals: 'Approvals',
      escalations: 'Escalation Management',
      workflow_approvals: 'Workflow & Approvals',
      cases: 'Cases',
      contracts: 'Contracts',
      documents: 'Documents & Attachments',
      notifications: 'Notifications & Alerts',
      audit: 'Audit & Compliance',
      knowledge_hub: 'Knowledge Hub',
      policies: 'Policy Hub',
      learning_centre: 'Learning Centre',
      reports: 'Reports & Performance Indicators',
      roles: 'Roles & Users',
      // ── Secondary legal domains ──────────────────────────────────────────
      matters: 'Matters',
      investigations: 'Investigations',
      settlements: 'Settlements',
      obligations: 'Obligations',
      signatures: 'Signatures',
      drafting: 'AI Drafting',
      clause_library: 'Clause Library',
      playbooks: 'Playbooks',
      regulations: 'Regulations',
      compliance: 'Compliance',
      // ── Secondary workspace / oversight ──────────────────────────────────
      library: 'References',
      calendar: 'Calendar',
      entities: 'Entities',
      analytics_risk: 'Risk Portfolio',
      report_builder: 'Report Builder',
      reports_export: 'Report Exports',
      admin: 'Administration',
    },
    sidebar: {
      railLabel: 'Legal suite navigation',
      collapse: 'Collapse',
      expand: 'Expand navigation',
      home: 'Overview',
      suiteName: 'ClarioLegal',
      suiteTagline: 'Watheeq · Legal Affairs',
    },
    breadcrumbs: {
      home: 'Legal',
      ariaLabel: 'Breadcrumb',
    },
    recent: {
      title: 'Recent',
      clear: 'Clear',
      empty: 'No recently viewed items yet.',
    },
    palette: {
      placeholder:
        'Search the legal suite, jump to a domain, or run an action…',
      searchPlaceholder: 'Search cases, contracts, requests, clauses…',
      jumpSection: 'Jump to',
      actionsSection: 'Quick actions',
      searchSection: 'Search',
      casesSection: 'Cases',
      contractsSection: 'Contracts',
      requestsSection: 'Requests',
      clausesSection: 'Clauses',
      mattersSection: 'Matters',
      open: 'Open',
      actions: {
        newRequest: 'New request',
        newCase: 'New case',
        aiDrafting: 'AI drafting',
        export: 'Export',
      },
    },
    search: {
      label: 'Search legal suite',
      placeholder: 'Search cases, contracts, requests…',
      hint: 'Search',
    },
  },
  ar: {
    groups: {
      daily_work: 'العمل اليومي',
      governance: 'الحوكمة',
      insights: 'الرؤى',
      administration: 'الإدارة',
    },
    clusters: {
      contracts_consultations: 'العقود والاستشارات',
      cases_investigations: 'القضايا والتحقيقات',
      references_library: 'المراجع والمكتبة',
    },
    routes: {
      // ── الوحدات العشر الأساسية وفق كراسة المتطلبات ────────────────────────
      command_center: 'نظرة عامة',
      // لوحات مساحات العمل الخدمية (روابط المجموعات الرئيسية).
      contracts_control: 'لوحة العقود والاستشارات',
      cases_control: 'لوحة القضايا والتحقيقات',
      legal_services: 'الخدمات والطلبات القانونية',
      consultations: 'الاستشارات',
      tasks: 'إدارة المهام',
      approvals: 'الموافقات',
      escalations: 'إدارة التصعيدات',
      workflow_approvals: 'سير العمل والموافقات',
      cases: 'القضايا',
      contracts: 'العقود',
      documents: 'الوثائق والمرفقات',
      notifications: 'الإشعارات والتنبيهات',
      audit: 'التدقيق والامتثال',
      knowledge_hub: 'مركز المعرفة',
      policies: 'مركز السياسات',
      learning_centre: 'مركز التعلّم',
      reports: 'التقارير ومؤشرات الأداء',
      roles: 'الأدوار والمستخدمون',
      // ── المجالات القانونية الثانوية ──────────────────────────────────────
      matters: 'الملفات القانونية',
      investigations: 'التحقيقات',
      settlements: 'التسويات',
      obligations: 'الالتزامات',
      signatures: 'التوقيعات',
      drafting: 'الصياغة بالذكاء الاصطناعي',
      clause_library: 'مكتبة البنود',
      playbooks: 'الأدلة الإرشادية',
      regulations: 'اللوائح',
      compliance: 'الامتثال',
      // ── مساحة العمل / الرقابة الثانوية ───────────────────────────────────
      library: 'المراجع',
      calendar: 'التقويم',
      entities: 'الجهات',
      analytics_risk: 'محفظة المخاطر',
      report_builder: 'منشئ التقارير',
      reports_export: 'تصدير التقارير',
      admin: 'الإدارة',
    },
    sidebar: {
      railLabel: 'تنقّل المجموعة القانونية',
      collapse: 'طيّ',
      expand: 'توسيع التنقّل',
      home: 'نظرة عامة',
      suiteName: 'كلاريو ليجال',
      suiteTagline: 'وثيق · الشؤون القانونية',
    },
    breadcrumbs: {
      home: 'القانونية',
      ariaLabel: 'مسار التنقّل',
    },
    recent: {
      title: 'الأخيرة',
      clear: 'مسح',
      empty: 'لا توجد عناصر تمّ عرضها مؤخرًا بعد.',
    },
    palette: {
      placeholder:
        'ابحث في المجموعة القانونية، أو انتقل إلى مجال، أو نفّذ إجراءً…',
      searchPlaceholder: 'ابحث في القضايا والعقود والطلبات والبنود…',
      jumpSection: 'الانتقال إلى',
      actionsSection: 'إجراءات سريعة',
      searchSection: 'البحث',
      casesSection: 'القضايا',
      contractsSection: 'العقود',
      requestsSection: 'الطلبات',
      clausesSection: 'البنود',
      mattersSection: 'الملفات القانونية',
      open: 'فتح',
      actions: {
        newRequest: 'طلب جديد',
        newCase: 'قضية جديدة',
        aiDrafting: 'الصياغة بالذكاء الاصطناعي',
        export: 'تصدير',
      },
    },
    search: {
      label: 'بحث المجموعة القانونية',
      placeholder: 'ابحث في القضايا والعقود والطلبات…',
      hint: 'بحث',
    },
  },
};

/**
 * useLexShellLabels resolves the shell label bundle against the active locale,
 * defaulting to English outside a LocaleProvider (mirrors `useLexLabels`).
 */
export function useLexShellLabels(): LexShellLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(lexShellLabels, locale), [locale]);
}
