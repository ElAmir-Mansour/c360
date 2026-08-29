/**
 * Single source of truth for the lex SHELL navigation — the grouped top-nav rail
 * AND the command-palette "jump to" set are both derived from this one ordered
 * declaration so they never drift.
 *
 * Information architecture is organized by user intent. The compact
 * `daily_work` group is rendered as flat tabs; governance, insight, and
 * administration routes collapse into named dropdowns.
 *
 * PRD module → route map (distributed across the task-oriented groups):
 *   1. Legal Services & Requests        → /lex/service-desk
 *   2. Consultations                    → /lex/consultations
 *   3. Task Management                  → /lex/tasks   (manager-assigned tracked work)
 *   4. Workflow & Approvals             → /lex/workflow-policies
 *   5. Case & Investigation             → /lex/cases
 *   6. Contracts                        → /lex/contracts
 *   7. Documents & Attachments          → /lex/documents
 *   8. Notifications & Alerts           → /lex/notifications
 *   9. Reports & Performance Indicators → /lex/reports/analytics  (the KPI dashboards)
 *  10. Roles & User Management          → /lex/admin/role-matrix
 *
 * Each entry carries a stable `id` (also the i18n leaf into
 * `lexShellLabels.routes`), an `href`, a distinct lucide icon, and a
 * `PermissionRequirement` (evaluated with `canAccessWith`, never a bare string)
 * drawn from the authoritative `LEX_ROUTE_PERMISSIONS` registry where one exists.
 */

import {
  LayoutDashboard,
  Gauge,
  Inbox,
  MessagesSquare,
  ListTodo,
  Workflow,
  Gavel,
  FileText,
  Paperclip,
  Bell,
  BarChart3,
  Users,
  Scale,
  ShieldQuestion,
  Handshake,
  FileCheck2,
  Sparkles,
  BookMarked,
  ClipboardList,
  BookText,
  ShieldCheck,
  CalendarDays,
  Building2,
  ShieldAlert,
  FileBarChart,
  Settings2,
  Library,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react';
import {
  LEX_ROUTE_PERMISSIONS,
  type PermissionRequirement,
} from '@/lib/permissions';

export type LexNavGroupId =
  'daily_work' | 'governance' | 'insights' | 'administration';

export interface LexNavRoute {
  /** Stable id; also the i18n leaf into `lexShellLabels.routes`. */
  id: string;
  /** Destination route. */
  href: string;
  /** Distinct lucide icon component. */
  icon: LucideIcon;
  /**
   * Access requirement (§7). Evaluated with `canAccessWith(hasPermission, …)`.
   * `undefined` ⇒ always visible. Never a bare `hasPermission(string)` call.
   */
  permission?: PermissionRequirement;
}

export interface LexNavGroup {
  id: LexNavGroupId;
  routes: LexNavRoute[];
}

export type LexDailyNavClusterId =
  | 'contracts_consultations'
  | 'cases_investigations'
  | 'references_library';

export interface LexDailyNavCluster {
  id: LexDailyNavClusterId;
  routeIds: string[];
}

/**
 * Related daily-work destinations that share one top-level desktop trigger.
 * Individual routes remain in `LEX_NAV_GROUPS`, so mobile navigation, command
 * search, permission checks, and deep links retain their existing behavior.
 */
export const LEX_DAILY_NAV_CLUSTERS: LexDailyNavCluster[] = [
  {
    // The workspace "Control & Monitoring Panel" leads the cluster so the
    // service-workspace dashboard is the primary entry (its `/lex/contracts/control`
    // href wins active-state by longest-prefix over the list routes below).
    id: 'contracts_consultations',
    routeIds: ['contracts_control', 'contracts', 'consultations', 'signatures', 'drafting'],
  },
  {
    id: 'cases_investigations',
    routeIds: ['cases_control', 'cases', 'investigations'],
  },
  {
    // Playbooks live here as reference content (not a primary Insights
    // workspace). The URL stays /lex/playbooks; only the nav home changed.
    id: 'references_library',
    routeIds: [
      'knowledge_hub',
      'library',
      'clause_library',
      'playbooks',
      'policies',
      'learning_centre',
      'documents',
    ],
  },
];

export const LEX_NAV_GROUPS: LexNavGroup[] = [
  {
    // PRIMARY — the routes legal professionals reach for throughout the day.
    // This short group renders as the persistent, flat top-nav rail.
    id: 'daily_work',
    routes: [
      {
        id: 'command_center',
        href: '/lex',
        icon: LayoutDashboard,
        permission: LEX_ROUTE_PERMISSIONS['/lex'],
      },
      {
        id: 'tasks',
        href: '/lex/tasks',
        icon: ListTodo,
        permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'],
      },
      {
        id: 'legal_services',
        href: '/lex/service-desk',
        icon: Inbox,
        permission: LEX_ROUTE_PERMISSIONS['/lex/service-desk'],
      },
      {
        // Contracts & Consultations service-workspace dashboard — the cluster
        // lead (see LEX_DAILY_NAV_CLUSTERS). Unified twin of `/lex/cases/control`.
        id: 'contracts_control',
        href: '/lex/contracts/control',
        icon: Gauge,
        permission: LEX_ROUTE_PERMISSIONS['/lex/contracts/control'],
      },
      {
        id: 'contracts',
        href: '/lex/contracts',
        icon: FileText,
        permission: LEX_ROUTE_PERMISSIONS['/lex/contracts'],
      },
      {
        id: 'consultations',
        href: '/lex/consultations',
        icon: MessagesSquare,
        permission: LEX_ROUTE_PERMISSIONS['/lex/consultations'],
      },
      {
        id: 'signatures',
        href: '/lex/signatures',
        icon: FileCheck2,
        permission: { anyOf: ['lex:contract:view', 'lex:document:view'] },
      },
      {
        id: 'drafting',
        href: '/lex/drafting',
        icon: Sparkles,
        permission: LEX_ROUTE_PERMISSIONS['/lex/drafting'],
      },
      {
        // Cases & Investigations service-workspace dashboard — the cluster lead
        // (see LEX_DAILY_NAV_CLUSTERS). The existing Control & Monitoring Panel.
        id: 'cases_control',
        href: '/lex/cases/control',
        icon: Gauge,
        permission: LEX_ROUTE_PERMISSIONS['/lex/cases/control'],
      },
      {
        id: 'cases',
        href: '/lex/cases',
        icon: Gavel,
        permission: LEX_ROUTE_PERMISSIONS['/lex/cases'],
      },
      {
        id: 'investigations',
        href: '/lex/investigations',
        icon: ShieldQuestion,
        permission: LEX_ROUTE_PERMISSIONS['/lex/investigations'],
      },
      {
        id: 'knowledge_hub',
        href: '/lex/knowledge-hub',
        icon: Library,
        permission: LEX_ROUTE_PERMISSIONS['/lex/knowledge-hub'],
      },
      {
        id: 'library',
        href: '/lex/library',
        icon: BookText,
        permission: LEX_ROUTE_PERMISSIONS['/lex/library'],
      },
      {
        id: 'clause_library',
        href: '/lex/clause-library',
        icon: BookMarked,
        permission: LEX_ROUTE_PERMISSIONS['/lex/clause-library'],
      },
      {
        // Reference content grouped under the References & Library cluster
        // (see LEX_DAILY_NAV_CLUSTERS). Must live in `daily_work` so the
        // cluster dropdown can resolve it; the route/URL is unchanged.
        id: 'playbooks',
        href: '/lex/playbooks',
        icon: ClipboardList,
        permission: LEX_ROUTE_PERMISSIONS['/lex/playbooks'],
      },
      {
        id: 'policies',
        href: '/lex/policies',
        icon: ShieldCheck,
        permission: LEX_ROUTE_PERMISSIONS['/lex/policies'],
      },
      {
        id: 'learning_centre',
        href: '/lex/learning-centre',
        icon: GraduationCap,
        permission: LEX_ROUTE_PERMISSIONS['/lex/learning-centre'],
      },
      {
        id: 'documents',
        href: '/lex/documents',
        icon: Paperclip,
        permission: LEX_ROUTE_PERMISSIONS['/lex/documents'],
      },
    ],
  },
  {
    // Policies, approvals, formal records, and regulatory oversight.
    id: 'governance',
    routes: [
      {
        id: 'calendar',
        href: '/lex/calendar',
        icon: CalendarDays,
        permission: LEX_ROUTE_PERMISSIONS['/lex/calendar'],
      },
      {
        id: 'approvals',
        href: '/lex/approvals/requests',
        icon: ClipboardList,
        permission: LEX_ROUTE_PERMISSIONS['/lex/approvals/requests'],
      },
      {
        id: 'escalations',
        href: '/lex/approvals/escalations',
        icon: ShieldAlert,
        permission: LEX_ROUTE_PERMISSIONS['/lex/approvals/escalations'],
      },
      {
        id: 'matters',
        href: '/lex/matters',
        icon: Scale,
        permission: { anyOf: ['lex:case:view', 'lex:contract:view'] },
      },
      {
        id: 'settlements',
        href: '/lex/settlements',
        icon: Handshake,
        permission: LEX_ROUTE_PERMISSIONS['/lex/settlements'],
      },
      {
        id: 'regulations',
        href: '/lex/regulations',
        icon: BookText,
        permission: LEX_ROUTE_PERMISSIONS['/lex/regulations'],
      },
      {
        id: 'compliance',
        href: '/lex/compliance',
        icon: ShieldCheck,
        permission: LEX_ROUTE_PERMISSIONS['/lex/compliance'],
      },
    ],
  },
  {
    // Research, drafting, reporting, and risk intelligence.
    id: 'insights',
    routes: [
      {
        id: 'reports',
        href: '/lex/reports/analytics',
        icon: BarChart3,
        permission: LEX_ROUTE_PERMISSIONS['/lex/reports/analytics'],
      },
      {
        id: 'report_builder',
        href: '/lex/reports/builder',
        icon: Settings2,
        permission: LEX_ROUTE_PERMISSIONS['/lex/reports/builder'],
      },
      {
        id: 'analytics_risk',
        href: '/lex/analytics/risk',
        icon: ShieldAlert,
        permission: LEX_ROUTE_PERMISSIONS['/lex/analytics/risk'],
      },
      {
        id: 'reports_export',
        href: '/lex/reports',
        icon: FileBarChart,
        permission: 'lex:report:read',
      },
    ],
  },
  {
    // Configuration and stewardship are intentionally out of the daily rail.
    id: 'administration',
    routes: [
      {
        id: 'workflow_approvals',
        href: '/lex/workflow-policies',
        icon: Workflow,
        permission: LEX_ROUTE_PERMISSIONS['/lex/workflow-policies'],
      },
      {
        id: 'roles',
        href: '/lex/admin/role-matrix',
        icon: Users,
        permission: LEX_ROUTE_PERMISSIONS['/lex/admin/role-matrix'],
      },
      {
        id: 'entities',
        href: '/lex/entities',
        icon: Building2,
        permission: LEX_ROUTE_PERMISSIONS['/lex/entities'],
      },
      {
        id: 'notifications',
        href: '/lex/notifications',
        icon: Bell,
        permission: LEX_ROUTE_PERMISSIONS['/lex/notifications'],
      },
      {
        id: 'audit',
        href: '/lex/audit',
        icon: ShieldCheck,
        permission: LEX_ROUTE_PERMISSIONS['/lex/audit'],
      },
      {
        id: 'admin',
        href: '/lex/admin',
        icon: Settings2,
        permission: LEX_ROUTE_PERMISSIONS['/lex/admin'],
      },
    ],
  },
];

/** Flattened ordered list of every shell route (used by the command palette). */
export const LEX_NAV_ROUTES: LexNavRoute[] = LEX_NAV_GROUPS.flatMap(
  (g) => g.routes,
);

/**
 * matchesRoute is the prefix test for a single route. `/lex` (command center)
 * is exact-only so it doesn't light up on every child route.
 */
function matchesRoute(href: string, pathname: string): boolean {
  if (href === '/lex') return pathname === '/lex';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * activeRouteHref resolves the SINGLE active nav entry for `pathname` using the
 * longest-prefix rule, so e.g. `/lex/reports/analytics` lights up "Reports"
 * (the longer match) and not the shorter "/lex/reports" export entry. Returns
 * the matched href, or `undefined` when no shell route owns the path.
 */
export function activeRouteHref(pathname: string): string | undefined {
  let best: string | undefined;
  for (const route of LEX_NAV_ROUTES) {
    if (
      matchesRoute(route.href, pathname) &&
      route.href.length > (best?.length ?? -1)
    ) {
      best = route.href;
    }
  }
  return best;
}
