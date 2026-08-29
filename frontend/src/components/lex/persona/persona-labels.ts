/**
 * Bilingual (EN / MSA Arabic) label bundle for the Lex persona chrome — role
 * badge, persona switcher, and the "My Lex Access" capabilities sheet (§14).
 *
 * Follows the suite bilingual contract verbatim (see lex/_lib/lex-i18n.ts):
 * two full, same-shaped copies resolved against the active locale via
 * {@link resolveLexBilingual}. Kept LOCAL to the persona feature (it does not
 * extend the shared suite i18n file).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import type { LegalRoleTier } from '@/lib/lex/types';

export interface LexPersonaLabels {
  /** Role-badge chrome. */
  badge: {
    /** e.g. "Legal tier" suffix shown after the tier name. */
    tierSuffix: string;
    /** e.g. "Escalation level {level}" — function so the level interpolates. */
    escalation: (level: number) => string;
    /** Tooltip copy explaining what the escalation level means in this SLA context. */
    escalationHint: string;
    /** Aria label for the whole badge. */
    ariaLabel: string;
  };
  /** Tier display names. */
  tiers: Record<LegalRoleTier, string>;
  /** Persona switcher. */
  switcher: {
    trigger: string;
    heading: string;
    activeBadge: string;
    switching: string;
    error: string;
  };
  /** Capabilities sheet. */
  sheet: {
    trigger: string;
    title: string;
    description: string;
    activeRoleHeading: string;
    availableRolesHeading: string;
    permissionsHeading: string;
    tierLabel: string;
    escalationLabel: string;
    noRole: string;
    noPermissions: string;
    granted: string;
    denied: string;
  };
  /** Domain group headings for the grouped permission list. */
  domains: Record<string, string>;
  /** Verb labels for the grouped permission list (✓/✗ rows). */
  verbs: Record<string, string>;
  /** Persona-home (`/lex`) quick-link card labels, keyed by quick-link id. */
  quickLinks: Record<string, string>;
  /** Persona-home heading + subtitle, keyed by persona-home variant. */
  home: {
    quickLinksHeading: string;
    variants: Record<string, { title: string; subtitle: string }>;
  };
}

export const lexPersonaLabels: LexBilingual<LexPersonaLabels> = {
  en: {
    badge: {
      tierSuffix: 'tier',
      escalation: (level) => `Escalation level ${level}`,
      /** Explains what the escalation level means, shown in a tooltip on the badge. */
      escalationHint:
        "This role's position on the SLA escalation ladder — requests that breach their SLA move up through these levels until they reach this role's authority.",
      ariaLabel: 'Your active legal role',
    },
    tiers: {
      Business: 'Business',
      Legal: 'Legal',
      Oversight: 'Oversight',
      Admin: 'Admin',
    },
    switcher: {
      trigger: 'Switch persona',
      heading: 'Switch active persona',
      activeBadge: 'Active',
      switching: 'Switching…',
      error: 'Could not switch persona. Please try again.',
    },
    sheet: {
      trigger: 'My WatheeqTech Access',
      title: 'My WatheeqTech Access',
      description: 'Your active legal persona, available roles, and effective permissions.',
      activeRoleHeading: 'Active role',
      availableRolesHeading: 'Available roles',
      permissionsHeading: 'Effective permissions',
      tierLabel: 'Tier',
      escalationLabel: 'Escalation level',
      noRole: 'You have no legal role assigned. Contact your administrator to request access.',
      noPermissions: 'No effective Lex permissions for this persona.',
      granted: 'Granted',
      denied: 'Not granted',
    },
    domains: {
      request: 'Requests',
      case: 'Cases',
      investigation: 'Investigations',
      settlement: 'Settlements',
      contract: 'Contracts',
      consultation: 'Consultations',
      document: 'Documents',
      report: 'Reports',
      audit: 'Audit',
      sla: 'SLA',
      escalation: 'Escalation',
      catalog: 'Catalog',
      notification: 'Notifications',
      role: 'Roles',
      integration: 'Integrations',
      security: 'Security',
      approval: 'Approvals',
      other: 'Other',
    },
    verbs: {
      view: 'View',
      read: 'View',
      add: 'Add',
      edit: 'Edit',
      approve: 'Approve',
      close: 'Close',
      assign: 'Assign',
      distribute: 'Distribute',
      manage: 'Manage',
      admin: 'Administer',
    },
    quickLinks: {
      my_requests: 'My Requests',
      new_request: 'New Request',
      request_approvals: 'Request Approvals',
      cases: 'Litigation Cases',
      investigations: 'Investigations',
      settlements: 'Settlements & ADR',
      contracts: 'Contracts',
      consultations: 'Consultations',
      documents: 'Documents',
      drafting: 'AI Drafting',
      clause_library: 'Clause Library',
      playbooks: 'Playbooks',
      reports: 'Reports',
      analytics: 'Analytics & KPIs',
      risk_analytics: 'Risk Analytics',
      compliance: 'Compliance',
      entities: 'Entities & Exposure',
      calendar: 'Calendar',
      inbox: 'Inbox',
      admin: 'Administration',
    },
    home: {
      quickLinksHeading: 'For your role',
      variants: {
        requester: {
          title: 'Your requests',
          subtitle: 'Submit and track your legal service requests.',
        },
        approver: {
          title: 'Pending your approval',
          subtitle: 'Requests and matters awaiting your decision.',
        },
        director: {
          title: 'Your workspace',
          subtitle: 'Cross-domain oversight, approvals and escalations.',
        },
        cases: {
          title: 'Case operations',
          subtitle: 'Cases, investigations and settlements at a glance.',
        },
        contracts: {
          title: 'Contract operations',
          subtitle: 'Contracts, drafting and distribution at a glance.',
        },
        officer: {
          title: 'My work',
          subtitle: 'Your assigned cases, investigations and documents.',
        },
        advisor: {
          title: 'Advisory workspace',
          subtitle: 'Your consultations, contracts and knowledge shortcuts.',
        },
        oversight: {
          title: 'Oversight',
          subtitle: 'SLA, escalations and cross-domain health.',
        },
        auditor: {
          title: 'Compliance & audit',
          subtitle: 'Evidence, audit exceptions and compliance reports.',
        },
        admin: {
          title: 'Configuration',
          subtitle: 'Roles, integrations, policies and security.',
        },
        generic: {
          title: 'Legal Affairs',
          subtitle: 'Your legal workspace.',
        },
      },
    },
  },
  ar: {
    badge: {
      tierSuffix: '',
      escalation: (level) => `مستوى التصعيد ${level}`,
      /** Explains what the escalation level means, shown in a tooltip on the badge. */
      escalationHint:
        'موضع هذا الدور على سلّم تصعيد اتفاقية مستوى الخدمة — الطلبات التي تتجاوز مهلتها المحددة تُصعَّد عبر هذه المستويات حتى تصل إلى صلاحية هذا الدور.',
      ariaLabel: 'دورك القانوني النشط',
    },
    tiers: {
      Business: 'الأعمال',
      Legal: 'الإدارة القانونية',
      Oversight: 'الإشراف',
      Admin: 'الإدارة',
    },
    switcher: {
      trigger: 'تبديل الشخصية',
      heading: 'تبديل الشخصية النشطة',
      activeBadge: 'نشطة',
      switching: 'جارٍ التبديل…',
      error: 'تعذّر تبديل الشخصية. يُرجى المحاولة مرة أخرى.',
    },
    sheet: {
      trigger: 'صلاحياتي في النظام',
      title: 'صلاحياتي في النظام',
      description: 'شخصيتك القانونية النشطة والأدوار المتاحة والصلاحيات الفعّالة.',
      activeRoleHeading: 'الدور النشط',
      availableRolesHeading: 'الأدوار المتاحة',
      permissionsHeading: 'الصلاحيات الفعّالة',
      tierLabel: 'المستوى',
      escalationLabel: 'مستوى التصعيد',
      noRole: 'لا يوجد دور قانوني مُسند إليك. تواصل مع المسؤول لطلب الوصول.',
      noPermissions: 'لا توجد صلاحيات فعّالة لهذه الشخصية.',
      granted: 'مُتاحة',
      denied: 'غير مُتاحة',
    },
    domains: {
      request: 'الطلبات',
      case: 'القضايا',
      investigation: 'التحقيقات',
      settlement: 'التسويات',
      contract: 'العقود',
      consultation: 'الاستشارات',
      document: 'الوثائق',
      report: 'التقارير',
      audit: 'التدقيق',
      sla: 'اتفاقية مستوى الخدمة',
      escalation: 'التصعيد',
      catalog: 'الكتالوج',
      notification: 'الإشعارات',
      role: 'الأدوار',
      integration: 'التكاملات',
      security: 'الأمان',
      approval: 'الموافقات',
      other: 'أخرى',
    },
    verbs: {
      view: 'عرض',
      read: 'عرض',
      add: 'إضافة',
      edit: 'تعديل',
      approve: 'اعتماد',
      close: 'إغلاق',
      assign: 'إسناد',
      distribute: 'توزيع',
      manage: 'إدارة',
      admin: 'إدارة كاملة',
    },
    quickLinks: {
      my_requests: 'طلباتي',
      new_request: 'طلب جديد',
      request_approvals: 'موافقات الطلبات',
      cases: 'قضايا التقاضي',
      investigations: 'التحقيقات',
      settlements: 'التسويات والحلول البديلة',
      contracts: 'العقود',
      consultations: 'الاستشارات',
      documents: 'الوثائق',
      drafting: 'الصياغة بالذكاء الاصطناعي',
      clause_library: 'مكتبة البنود',
      playbooks: 'الأدلة الإرشادية',
      reports: 'التقارير',
      analytics: 'التحليلات ومؤشرات الأداء',
      risk_analytics: 'تحليلات المخاطر',
      compliance: 'الامتثال',
      entities: 'الجهات والتعرّضات',
      calendar: 'التقويم',
      inbox: 'صندوق الوارد',
      admin: 'الإدارة',
    },
    home: {
      quickLinksHeading: 'لدورك',
      variants: {
        requester: {
          title: 'طلباتك',
          subtitle: 'قدّم طلبات الخدمة القانونية وتابعها.',
        },
        approver: {
          title: 'بانتظار موافقتك',
          subtitle: 'الطلبات والملفات التي تنتظر قرارك.',
        },
        director: {
          title: 'مساحة عملك',
          subtitle: 'إشراف شامل والموافقات والتصعيدات.',
        },
        cases: {
          title: 'عمليات القضايا',
          subtitle: 'القضايا والتحقيقات والتسويات في لمحة.',
        },
        contracts: {
          title: 'عمليات العقود',
          subtitle: 'العقود والصياغة والتوزيع في لمحة.',
        },
        officer: {
          title: 'عملي',
          subtitle: 'القضايا والتحقيقات والوثائق المُسندة إليك.',
        },
        advisor: {
          title: 'مساحة الاستشارات',
          subtitle: 'استشاراتك وعقودك واختصارات المعرفة.',
        },
        oversight: {
          title: 'الإشراف',
          subtitle: 'اتفاقيات مستوى الخدمة والتصعيدات وصحة المجالات.',
        },
        auditor: {
          title: 'الامتثال والتدقيق',
          subtitle: 'الأدلة واستثناءات التدقيق وتقارير الامتثال.',
        },
        admin: {
          title: 'الإعدادات',
          subtitle: 'الأدوار والتكاملات والسياسات والأمان.',
        },
        generic: {
          title: 'الشؤون القانونية',
          subtitle: 'مساحة عملك القانونية.',
        },
      },
    },
  },
};

/** Resolve the persona label bundle against the active locale (defaults to EN). */
export function useLexPersonaLabels(): LexPersonaLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(lexPersonaLabels, locale), [locale]);
}

/**
 * Group a flat list of `lex:<domain>:<verb>` permission keys into a
 * `{ domain: verb[] }` map, in the canonical domain order used by the sheet.
 * Non-lex keys and malformed keys land under `other`.
 */
export const PERSONA_DOMAIN_ORDER = [
  'request',
  'case',
  'investigation',
  'settlement',
  'contract',
  'consultation',
  'document',
  'report',
  'audit',
  'sla',
  'escalation',
  'catalog',
  'notification',
  'role',
  'integration',
  'security',
  'approval',
] as const;

export function groupPermissionsByDomain(
  permissions: string[],
): Array<{ domain: string; verbs: string[] }> {
  const byDomain = new Map<string, Set<string>>();
  for (const perm of permissions) {
    const parts = perm.split(':');
    // Expect `lex:<domain>:<verb>`; fold anything else under `other`.
    if (parts.length === 3 && parts[0] === 'lex') {
      const [, domain, verb] = parts;
      if (!byDomain.has(domain)) byDomain.set(domain, new Set());
      byDomain.get(domain)!.add(verb);
    } else {
      if (!byDomain.has('other')) byDomain.set('other', new Set());
      byDomain.get('other')!.add(perm);
    }
  }

  const ordered: Array<{ domain: string; verbs: string[] }> = [];
  for (const domain of PERSONA_DOMAIN_ORDER) {
    const verbs = byDomain.get(domain);
    if (verbs && verbs.size > 0) {
      ordered.push({ domain, verbs: Array.from(verbs).sort() });
      byDomain.delete(domain);
    }
  }
  // Any leftover domains (incl. `other`) appended in stable order.
  for (const [domain, verbs] of byDomain) {
    if (verbs.size > 0) ordered.push({ domain, verbs: Array.from(verbs).sort() });
  }
  return ordered;
}
