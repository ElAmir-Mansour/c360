/**
 * The Watheeq / Lex PRIMARY top-bar navigation — a flat, director-oriented set of
 * top-level destinations rendered inline in the single unified {@link
 * import('./lex-top-bar').LexTopBar}. This replaces the previous two-row chrome
 * (global `Header` + grouped `LexTopNav` with cluster dropdowns): one deep-teal
 * bar carries the brand, this nav, the language toggle, and the user identity.
 *
 * The exhaustive route catalog (drafting, clause library, playbooks, calendar,
 * settlements, matters, control panels, …) still exists and stays reachable via
 * the shared ⌘K command palette (`LEX_NAV_ROUTES`) and each domain's sub-routes;
 * this bar surfaces only the primary domains a legal manager reaches for daily.
 *
 * Each item is permission-gated with a {@link PermissionRequirement} evaluated by
 * `canAccessWith` (never a bare string), and bilingual (EN + professional MSA).
 */

import {
  LEX_ROUTE_PERMISSIONS,
  type PermissionRequirement,
} from '@/lib/permissions';

export interface LexPrimaryNavItem {
  /** Stable id (test + key). */
  id: string;
  href: string;
  labelEn: string;
  labelAr: string;
  /** Evaluated with `canAccessWith(hasPermission, …)`. Undefined ⇒ always shown. */
  permission?: PermissionRequirement;
}

/**
 * A labelled section inside the "More" overflow dropdown. Groups the secondary
 * destinations (legal tools, workspace, compliance & knowledge, oversight) that
 * are real, working pages but too numerous for the flat bar. Each leaf is a
 * {@link LexPrimaryNavItem} and is permission-gated the same way; a section with
 * no surviving leaves is dropped, and the whole "More" menu hides if empty.
 */
export interface LexPrimaryNavSection {
  id: string;
  labelEn: string;
  labelAr: string;
  items: LexPrimaryNavItem[];
}

export const LEX_PRIMARY_NAV: LexPrimaryNavItem[] = [
  {
    id: 'dashboard',
    href: '/lex',
    labelEn: 'Dashboard',
    labelAr: 'لوحة المعلومات',
    permission: LEX_ROUTE_PERMISSIONS['/lex'],
  },
  {
    id: 'requests',
    href: '/lex/service-desk',
    labelEn: 'Requests',
    labelAr: 'الطلبات',
    permission: LEX_ROUTE_PERMISSIONS['/lex/service-desk'],
  },
  {
    id: 'litigation',
    href: '/lex/cases',
    labelEn: 'Litigation',
    labelAr: 'التقاضي',
    permission: LEX_ROUTE_PERMISSIONS['/lex/cases'],
  },
  {
    id: 'investigations',
    href: '/lex/investigations',
    labelEn: 'Investigations',
    labelAr: 'التحقيقات',
    permission: LEX_ROUTE_PERMISSIONS['/lex/investigations'],
  },
  {
    id: 'contracts',
    href: '/lex/contracts',
    labelEn: 'Contracts',
    labelAr: 'العقود',
    permission: LEX_ROUTE_PERMISSIONS['/lex/contracts'],
  },
  {
    id: 'consultations',
    href: '/lex/consultations',
    labelEn: 'Consultations',
    labelAr: 'الاستشارات',
    permission: LEX_ROUTE_PERMISSIONS['/lex/consultations'],
  },
  {
    id: 'reports',
    href: '/lex/reports/analytics',
    labelEn: 'Reports',
    labelAr: 'التقارير',
    permission: LEX_ROUTE_PERMISSIONS['/lex/reports/analytics'],
  },
  {
    id: 'report_builder',
    href: '/lex/reports/builder',
    labelEn: 'Report Builder',
    labelAr: 'منشئ التقارير',
    permission: LEX_ROUTE_PERMISSIONS['/lex/reports/builder'],
  },
  {
    id: 'knowledge',
    href: '/lex/library',
    labelEn: 'Knowledge Base',
    labelAr: 'قاعدة المعرفة',
    permission: LEX_ROUTE_PERMISSIONS['/lex/library'],
  },
  {
    id: 'settings',
    href: '/lex/admin',
    labelEn: 'Settings',
    labelAr: 'الإعدادات',
    permission: LEX_ROUTE_PERMISSIONS['/lex/admin'],
  },
];

/**
 * Contracts Manager top-bar contract. The role owns a purpose-built live
 * dashboard at `/lex/contracts/control`; Tasks opens the dedicated tracked
 * manager-task lifecycle, while Support opens the internal peer-support inbox.
 */
export const LEX_CONTRACTS_MANAGER_NAV: LexPrimaryNavItem[] = [
  {
    id: 'dashboard',
    href: '/lex/contracts/control',
    labelEn: 'Dashboard',
    labelAr: 'لوحة المعلومات',
    permission: LEX_ROUTE_PERMISSIONS['/lex/contracts/control'],
  },
  {
    id: 'tasks',
    href: '/lex/tasks',
    labelEn: 'My Tasks',
    labelAr: 'المهام',
    permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'],
  },
  LEX_PRIMARY_NAV.find((item) => item.id === 'requests')!,
  LEX_PRIMARY_NAV.find((item) => item.id === 'contracts')!,
  LEX_PRIMARY_NAV.find((item) => item.id === 'consultations')!,
  {
    id: 'reports',
    href: '/lex/reports',
    labelEn: 'Reports',
    labelAr: 'التقارير',
    permission: 'lex:report:read',
  },
  LEX_PRIMARY_NAV.find((item) => item.id === 'knowledge')!,
  {
    id: 'support',
    href: '/lex/inbox?view=sent',
    labelEn: 'Support',
    labelAr: 'الدعم',
    permission: 'lex:support:view',
  },
];

export const LEX_REQUESTER_NAV: LexPrimaryNavItem[] = [
  LEX_PRIMARY_NAV.find((item) => item.id === 'dashboard')!,
  {
    id: 'tasks',
    href: '/lex/tasks',
    labelEn: 'My Tasks',
    labelAr: 'مهامي',
    permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'],
  },
  {
    ...LEX_PRIMARY_NAV.find((item) => item.id === 'requests')!,
    labelEn: 'My Requests',
    labelAr: 'طلباتي',
  },
];

export const LEX_DIRECTOR_NAV: LexPrimaryNavItem[] = [
  LEX_PRIMARY_NAV.find((item) => item.id === 'dashboard')!,
  {
    id: 'tasks',
    href: '/lex/tasks',
    labelEn: 'My Tasks',
    labelAr: 'مهامي',
    permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'],
  },
  {
    id: 'reports',
    href: '/lex/reports',
    labelEn: 'Reports',
    labelAr: 'التقارير',
    permission: 'lex:report:read',
  },
  {
    id: 'knowledge_hub',
    href: '/lex/knowledge-hub',
    labelEn: 'Knowledge Hub',
    labelAr: 'مركز المعرفة',
    permission: LEX_ROUTE_PERMISSIONS['/lex/knowledge-hub'],
  },
];

export const LEX_CASES_MANAGER_NAV: LexPrimaryNavItem[] = [
  {
    id: 'dashboard',
    href: '/lex/cases/control',
    labelEn: 'Dashboard',
    labelAr: 'لوحة المعلومات',
    permission: LEX_ROUTE_PERMISSIONS['/lex/cases/control'],
  },
  {
    id: 'tasks',
    href: '/lex/tasks',
    labelEn: 'My Tasks',
    labelAr: 'مهامي',
    permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'],
  },
  LEX_PRIMARY_NAV.find((item) => item.id === 'requests')!,
  {
    ...LEX_PRIMARY_NAV.find((item) => item.id === 'litigation')!,
    labelEn: 'Cases',
    labelAr: 'القضايا',
  },
  LEX_PRIMARY_NAV.find((item) => item.id === 'investigations')!,
  {
    id: 'reports',
    href: '/lex/reports',
    labelEn: 'Reports',
    labelAr: 'التقارير',
    permission: 'lex:report:read',
  },
  LEX_PRIMARY_NAV.find((item) => item.id === 'knowledge')!,
  {
    id: 'support',
    href: '/lex/inbox?view=sent',
    labelEn: 'Support',
    labelAr: 'الدعم',
    permission: 'lex:support:view',
  },
];

/** Return the exact primary-nav contract for the active legal persona. */
export function primaryNavForRole(
  roleSlug: string | null | undefined,
): LexPrimaryNavItem[] {
  switch (roleSlug) {
    case 'legal-requester':
      return LEX_REQUESTER_NAV;
    case 'legal-director':
      return LEX_DIRECTOR_NAV;
    case 'legal-cases-manager':
      return LEX_CASES_MANAGER_NAV;
    case 'legal-contracts-manager':
      return LEX_CONTRACTS_MANAGER_NAV;
    default:
      return LEX_PRIMARY_NAV;
  }
}

export function hasRoleSpecificPrimaryNav(
  roleSlug: string | null | undefined,
): boolean {
  return [
    'legal-requester',
    'legal-director',
    'legal-cases-manager',
    'legal-contracts-manager',
  ].includes(roleSlug ?? '');
}

/**
 * `matchesPrimaryRoute` — prefix test for a single item. `/lex` (Dashboard) is
 * exact-only so it does not light up on every child route.
 */
function matchesPrimaryRoute(href: string, pathname: string): boolean {
  const routePath = href.split(/[?#]/, 1)[0] || href;
  if (routePath === '/lex') return pathname === '/lex';
  return pathname === routePath || pathname.startsWith(`${routePath}/`);
}

/**
 * `activePrimaryHref` resolves the SINGLE active nav item for `pathname` using
 * the longest-prefix rule (so `/lex/contracts/control` lights up "Contracts").
 * Returns the matched href, or `undefined` when no primary item owns the path.
 */
export function activePrimaryHref(
  pathname: string,
  items: readonly LexPrimaryNavItem[] = LEX_PRIMARY_NAV,
): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    if (
      matchesPrimaryRoute(item.href, pathname) &&
      item.href.length > (best?.length ?? -1)
    ) {
      best = item.href;
    }
  }
  return best;
}

/**
 * The "More ▾" overflow menu — the secondary but fully-built destinations that
 * exist in the route catalog yet don't warrant a permanent slot in the flat bar.
 * Grouped into scannable sections; each leaf is permission-gated so a persona
 * only sees what its RBAC grants. Labels are EN + professional MSA.
 *
 * A handful of routes (signatures, matters, obligations, report exports) have no
 * single-key entry in `LEX_ROUTE_PERMISSIONS`, so they carry an explicit
 * requirement here rather than resolving to `undefined` (which would show them
 * to everyone).
 */
export const LEX_PRIMARY_NAV_MORE: LexPrimaryNavSection[] = [
  {
    id: 'legal_tools',
    labelEn: 'Legal Tools',
    labelAr: 'أدوات قانونية',
    items: [
      { id: 'drafting', href: '/lex/drafting', labelEn: 'AI Drafting', labelAr: 'الصياغة الذكية', permission: LEX_ROUTE_PERMISSIONS['/lex/drafting'] },
      { id: 'signatures', href: '/lex/signatures', labelEn: 'Signatures', labelAr: 'التوقيعات', permission: { anyOf: ['lex:contract:view', 'lex:document:view'] } },
      { id: 'clause_library', href: '/lex/clause-library', labelEn: 'Clause Library', labelAr: 'مكتبة البنود', permission: LEX_ROUTE_PERMISSIONS['/lex/clause-library'] },
      { id: 'playbooks', href: '/lex/playbooks', labelEn: 'Playbooks', labelAr: 'أدلة العمل', permission: LEX_ROUTE_PERMISSIONS['/lex/playbooks'] },
      { id: 'policies', href: '/lex/policies', labelEn: 'Policies', labelAr: 'السياسات', permission: LEX_ROUTE_PERMISSIONS['/lex/policies'] },
      { id: 'documents', href: '/lex/documents', labelEn: 'Documents & Attachments', labelAr: 'المستندات والمرفقات', permission: LEX_ROUTE_PERMISSIONS['/lex/documents'] },
    ],
  },
  {
    id: 'workspace',
    labelEn: 'Workspace',
    labelAr: 'مساحة العمل',
    items: [
      { id: 'manager_tasks', href: '/lex/tasks', labelEn: 'Manager Tasks', labelAr: 'مهام الإدارة', permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'] },
      { id: 'inbox', href: '/lex/inbox', labelEn: 'Approvals Inbox', labelAr: 'صندوق الاعتمادات', permission: LEX_ROUTE_PERMISSIONS['/lex/inbox'] },
      { id: 'approvals', href: '/lex/approvals/requests', labelEn: 'Approvals', labelAr: 'الاعتمادات', permission: LEX_ROUTE_PERMISSIONS['/lex/approvals/requests'] },
      { id: 'escalations', href: '/lex/approvals/escalations', labelEn: 'Escalation Management', labelAr: 'إدارة التصعيد', permission: LEX_ROUTE_PERMISSIONS['/lex/approvals/escalations'] },
      { id: 'calendar', href: '/lex/calendar', labelEn: 'Calendar', labelAr: 'التقويم', permission: LEX_ROUTE_PERMISSIONS['/lex/calendar'] },
      { id: 'workflow_policies', href: '/lex/workflow-policies', labelEn: 'Workflow & Approvals', labelAr: 'سير العمل والاعتمادات', permission: LEX_ROUTE_PERMISSIONS['/lex/workflow-policies'] },
      { id: 'entities', href: '/lex/entities', labelEn: 'Entities', labelAr: 'الكيانات', permission: LEX_ROUTE_PERMISSIONS['/lex/entities'] },
      { id: 'matters', href: '/lex/matters', labelEn: 'Matters', labelAr: 'المسائل القانونية', permission: { anyOf: ['lex:case:view', 'lex:contract:view'] } },
      { id: 'settlements', href: '/lex/settlements', labelEn: 'Settlements & ADR', labelAr: 'التسويات والتحكيم', permission: LEX_ROUTE_PERMISSIONS['/lex/settlements'] },
    ],
  },
  {
    id: 'compliance_knowledge',
    labelEn: 'Compliance & Knowledge',
    labelAr: 'الامتثال والمعرفة',
    items: [
      { id: 'compliance', href: '/lex/compliance', labelEn: 'Compliance', labelAr: 'الامتثال', permission: LEX_ROUTE_PERMISSIONS['/lex/compliance'] },
      { id: 'regulations', href: '/lex/regulations', labelEn: 'Regulations', labelAr: 'اللوائح والأنظمة', permission: LEX_ROUTE_PERMISSIONS['/lex/regulations'] },
      { id: 'knowledge_hub', href: '/lex/knowledge-hub', labelEn: 'Knowledge Hub', labelAr: 'مركز المعرفة', permission: LEX_ROUTE_PERMISSIONS['/lex/knowledge-hub'] },
      { id: 'learning_centre', href: '/lex/learning-centre', labelEn: 'Learning Centre', labelAr: 'مركز التعلّم', permission: LEX_ROUTE_PERMISSIONS['/lex/learning-centre'] },
      { id: 'obligations', href: '/lex/obligations', labelEn: 'Obligations', labelAr: 'الالتزامات', permission: { anyOf: ['lex:contract:view', 'lex:case:view'] } },
    ],
  },
  {
    id: 'oversight',
    labelEn: 'Insights & Oversight',
    labelAr: 'الرقابة والتحليلات',
    items: [
      { id: 'analytics_risk', href: '/lex/analytics/risk', labelEn: 'Risk Analytics', labelAr: 'تحليلات المخاطر', permission: LEX_ROUTE_PERMISSIONS['/lex/analytics/risk'] },
      { id: 'reports_export', href: '/lex/reports', labelEn: 'Report Exports', labelAr: 'تصدير التقارير', permission: 'lex:report:read' },
      { id: 'notifications', href: '/lex/notifications', labelEn: 'Notifications & Alerts', labelAr: 'التنبيهات والإشعارات', permission: LEX_ROUTE_PERMISSIONS['/lex/notifications'] },
      { id: 'audit', href: '/lex/audit', labelEn: 'Audit Log', labelAr: 'سجل التدقيق', permission: LEX_ROUTE_PERMISSIONS['/lex/audit'] },
      { id: 'case_timeline', href: '/lex/case-timeline', labelEn: 'Case Timeline', labelAr: 'الجدول الزمني للقضية', permission: LEX_ROUTE_PERMISSIONS['/lex/case-timeline'] },
    ],
  },
];

/**
 * `isMorePathActive` — true when `pathname` is owned by any leaf inside the
 * "More" menu, so the top-level "More" trigger can carry the active underline
 * even though the specific destination lives in the dropdown.
 */
export function isMorePathActive(pathname: string): boolean {
  return LEX_PRIMARY_NAV_MORE.some((section) =>
    section.items.some((item) => matchesPrimaryRoute(item.href, pathname)),
  );
}
