import {
  LayoutDashboard,
  Shield,
  Monitor,
  AlertTriangle,
  Search,
  Target,
  Wrench,
  Database,
  Bot,
  ShieldCheck,
  Fingerprint,
  Grid3X3,
  Rss,
  BarChart3,
  Calculator,
  FolderOpen,
  Boxes,
  GitBranch,
  CheckCircle,
  Zap,
  Package,
  TrendingUp,
  Users,
  BookOpen,
  Scale,
  FileText,
  Eye,
  FileBarChart,
  Settings,
  KeyRound,
  ClipboardList,
  Workflow,
  Bell,
  BellRing,
  File,
  Building2,
  Gavel,
  Plug,
  Key,
  Mail,
  Layout,
  Library,
  Lock,
  Server,
  BookMarked,
  FileCheck2,
  Handshake,
  Archive,
  Gauge,
  Globe,
  Radar,
  GraduationCap,
  Siren,
  CircuitBoard,
  ListChecks,
  Terminal,
  Sparkles,
  CreditCard,
  LayoutGrid,
  ScrollText,
  Activity,
  BrainCircuit,
  Inbox,
  FilePlus,
  ShieldQuestion,
  MessagesSquare,
  CalendarClock,
  Settings2,
  CalendarDays,
  Layers,
  Timer,
  FileStack,
  Network,
  RadioTower,
  LifeBuoy,
  Cloud,
  ShieldAlert,
  ServerCog,
  DatabaseZap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { WatheeqMark } from '@/components/brand/watheeq-mark';
import {
  canAccessWith,
  LEX_ROUTE_PERMISSIONS,
  LEX_ADMIN_NAV_PERMISSIONS,
  type PermissionRequirement,
} from '@/lib/permissions';

export interface BadgeConfig {
  endpoint: string;
  key: string;
  variant: 'default' | 'destructive' | 'warning';
  /** Permission needed to fetch/render this badge. Defaults to the owning item. */
  permission?: PermissionRequirement;
  /** Poll fallback interval. WebSocket topics drive immediate refresh. */
  pollIntervalMs: number;
  /** Realtime topics that should trigger an immediate badge refresh. */
  topics?: string[];
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Smallest permission needed to see this item. Accepts a plain permission
   * string (backward compatible — all non-Lex items still use a string) OR a
   * {@link PermissionRequirement} `anyOf`/`allOf` group. Evaluated through
   * `canAccessWith` in the sidebar / mobile nav / command-palette filters.
   */
  permission?: PermissionRequirement;
  badge?: BadgeConfig;
  children?: NavItem[];
}

export interface NavSection {
  id: string;
  label: string;
  permission: string;
  /**
   * Platform-architecture tier this section belongs to (see {@link NAV_TIERS}).
   * Drives the tiered sidebar grouping. Tier-less sections (the top `main`
   * block) render above every tier with no tier header.
   */
  tier?: string;
  items: NavItem[];
}

/*
 * The shared workflow workspace — the Workflows hub, My Tasks, Browse Workflows
 * and the pending-task-count badge — is a baseline surface for EVERY
 * authenticated user (like Files and Notifications), so those entries carry no
 * `permission`. The workflow-engine RBAC classifiers
 * (backend/cmd/workflow-engine/rbac.go) enforce the same authenticated baseline
 * server-side. Authoring/admin surfaces remain permission-gated.
 */

/**
 * Top-level route segments that identify a product suite. Sections whose items
 * live under one of these segments are suite-scoped; everything else
 * (Dashboard, Administration, Workspace) is global and always shown.
 */
export const SUITE_ROUTE_SEGMENTS = ['cyber', 'data', 'recover', 'dr', 'respond', 'migrate', 'acta', 'lex', 'visus'] as const;

function sectionRouteSegment(section: NavSection): string {
  const href = section.items[0]?.href ?? '';
  return href.split('/').filter(Boolean)[0] ?? '';
}

/**
 * Per-suite sidebar selection. When the current route is inside a suite, return
 * only that suite's sections plus the global sections (Dashboard, Administration,
 * Workspace). On global routes (dashboard, admin, settings, …) return everything
 * so every suite stays reachable from the hub.
 */
/**
 * Product families: route segments that render as ONE product. The deep DR
 * operations console (`dr`) is nested under the Recover product, so when the user
 * is in either `/recover` or `/dr` they see the full Recover product nav — the
 * product/exec surfaces AND the operations-console sections — as one coherent group.
 */
export const SUITE_FAMILY: Record<string, string> = { dr: 'recover' };
export const familyOf = (segment: string): string => SUITE_FAMILY[segment] ?? segment;

export function filterSectionsForRoute(
  sections: NavSection[],
  pathname: string | null,
  /**
   * Sticky suite context (see useStickySuiteSegment): when the route itself is
   * global (workspace, admin, files, …) this remembered suite segment keeps the
   * sidebar scoped to the suite the user is working in instead of expanding to
   * every suite.
   */
  fallbackSegment = '',
): NavSection[] {
  const segment = (pathname ?? '').split('/').filter(Boolean)[0] ?? '';
  const isSuite = (s: string) => (SUITE_ROUTE_SEGMENTS as readonly string[]).includes(s);
  const activeSuite = isSuite(segment) ? segment : isSuite(fallbackSegment) ? fallbackSegment : null;
  if (!activeSuite) return sections;
  const activeFamily = familyOf(activeSuite);
  return sections.filter((section) => {
    const seg = sectionRouteSegment(section);
    return !isSuite(seg) || familyOf(seg) === activeFamily;
  });
}

/**
 * Permission-filter a list of nav items (§11.2/§11.3). An item is kept when the
 * caller's `hasPermission` predicate satisfies its {@link PermissionRequirement}
 * (no requirement, or the legacy `*:read` sentinel ⇒ always shown). Children are
 * filtered recursively, and a PARENT group is dropped when it has declared
 * children but none survive the filter — so the sidebar never shows an empty
 * expandable group. Items that never had children are unaffected.
 *
 * Shared by the desktop sidebar, the mobile sidebar, and the mobile quick-nav so
 * every nav surface evaluates the SAME requirement model.
 */
export function filterNavItems(
  items: NavItem[],
  hasPermission: (permission: string) => boolean,
): NavItem[] {
  return items
    .filter(
      (item) =>
        item.permission === '*:read' ||
        canAccessWith(hasPermission, item.permission),
    )
    .map((item) => {
      if (!item.children) return item;
      return { ...item, children: filterNavItems(item.children, hasPermission) };
    })
    .filter((item) => !item.children || item.children.length > 0);
}

export function canAccessNavBadge(
  item: NavItem,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (!item.badge) return false;
  const requirement = item.badge.permission ?? item.permission;
  return requirement === '*:read' || canAccessWith(hasPermission, requirement);
}

export function collectNavBadgeConfigs(
  items: NavItem[],
  hasPermission: (permission: string) => boolean,
): BadgeConfig[] {
  const configs: BadgeConfig[] = [];
  const seenEndpoints = new Set<string>();

  const visit = (navItems: NavItem[]) => {
    for (const item of navItems) {
      if (
        item.badge &&
        canAccessNavBadge(item, hasPermission) &&
        !seenEndpoints.has(item.badge.endpoint)
      ) {
        configs.push(item.badge);
        seenEndpoints.add(item.badge.endpoint);
      }
      if (item.children) visit(item.children);
    }
  };

  visit(items);
  return configs;
}

/**
 * Bilingual (en/ar) static label carried directly in the navigation config.
 * Mirrors the platform `LocalizedText` shape but keeps both sides required so
 * config entries can never ship half-translated.
 */
export interface NavLocalizedText {
  en: string;
  ar: string;
}

/** Resolve a {@link NavLocalizedText} for the active locale ('ar' default app). */
export function resolveNavText(text: NavLocalizedText, locale: string): string {
  return locale === 'ar' ? text.ar : text.en;
}

export interface SuiteEntry {
  /** Top-level route segment; matches SUITE_ROUTE_SEGMENTS. */
  segment: string;
  label: string;
  /** One-line bilingual product description (suite switcher + All-Suites hub). */
  description: NavLocalizedText;
  /** Suite landing route. */
  href: string;
  icon: LucideIcon;
  /**
   * Requirement to see this suite in the switcher/launcher. Widened from a
   * plain string so role-based suites (Watheeq §8.1) can use `anyOf` — a
   * legal-system-admin holds only `:manage` verbs and must still see the
   * suite. Evaluate with `canAccessWith(hasPermission, permission)`, never
   * `hasPermission(permission)` directly.
   */
  permission: PermissionRequirement;
  /** Platform-architecture tier this suite belongs to (see {@link NAV_TIERS}). */
  tier: string;
  /**
   * Optional brand sub-label rendered under the suite name in the switcher
   * instead of the generic "SUITE" word.
   */
  subLabel?: NavLocalizedText;
}

/**
 * The platform-architecture tiers (brand diagram), in sidebar render order:
 * the product suites first — AI Services (copilots & detection), DataStream, and
 * Business+ — then the platform foundation (Platform Core, Infrastructure) at the
 * base, mirroring the layered architecture where the core underpins the suites.
 * Sections and suites carry a matching `tier` id; the tier-less `main` block
 * (Dashboard, Notebooks) renders above every tier with no header.
 *
 * Labels are bilingual in-config (en/ar) so the tiered sidebar, suite switcher
 * and All-Suites hub render localized tier headers without a message-catalog
 * round-trip (same pattern as the suite descriptions).
 */
export interface NavTier {
  id: string;
  label: NavLocalizedText;
}

export const NAV_TIERS: NavTier[] = [
  { id: 'ai-services', label: { en: 'AI Services', ar: 'خدمات الذكاء الاصطناعي' } },
  { id: 'datastream', label: { en: 'DataStream Suite', ar: 'حزمة DataStream' } },
  { id: 'business-plus', label: { en: 'Business+ Suite', ar: 'حزمة Business+' } },
  { id: 'platform-core', label: { en: 'Platform Core', ar: 'نواة المنصّة' } },
  { id: 'infrastructure', label: { en: 'Infrastructure', ar: 'البنية التحتية' } },
];

const NAV_TIER_BY_ID: Record<string, NavTier> = Object.fromEntries(
  NAV_TIERS.map((tier) => [tier.id, tier]),
);

/** Resolve a tier's localized label for the active locale ('ar' default app). */
export function resolveTierLabel(tier: NavTier, locale: string): string {
  return resolveNavText(tier.label, locale);
}

export interface NavTierGroup<T extends NavSection = NavSection> {
  /** `null` for the tier-less lead block (Dashboard / Notebooks). */
  tier: NavTier | null;
  sections: T[];
}

/**
 * Group nav sections into their architecture tiers for the tiered sidebar. The
 * tier-less lead block renders first; the remaining tiers follow NAV_TIERS order.
 * Empty tiers (all their sections filtered out by permission/route/entitlement)
 * are omitted so a tier header never renders above zero sections. Section order
 * WITHIN a tier is preserved from the input, and every input section lands in
 * exactly one group — so the grouping never drops or reorders a visible section.
 */
export function groupSectionsByTier<T extends NavSection>(sections: T[]): NavTierGroup<T>[] {
  const untiered: T[] = [];
  const byTier = new Map<string, T[]>();
  for (const section of sections) {
    const tierId = section.tier;
    if (!tierId || !NAV_TIER_BY_ID[tierId]) {
      untiered.push(section);
      continue;
    }
    const bucket = byTier.get(tierId);
    if (bucket) bucket.push(section);
    else byTier.set(tierId, [section]);
  }
  const groups: NavTierGroup<T>[] = [];
  if (untiered.length > 0) groups.push({ tier: null, sections: untiered });
  for (const tier of NAV_TIERS) {
    const tierSections = byTier.get(tier.id);
    if (tierSections && tierSections.length > 0) {
      groups.push({ tier, sections: tierSections });
    }
  }
  return groups;
}

export interface SuiteTierGroup {
  tier: NavTier;
  suites: SuiteEntry[];
}

/**
 * Group product suites by architecture tier for the suite switcher and the
 * All-Suites hub. Only tiers that own at least one of the passed suites appear
 * (Platform Core / Infrastructure carry no product suites), and tiers follow
 * NAV_TIERS order. Suite order within a tier is preserved from the input.
 */
export function suitesByTier(suites: readonly SuiteEntry[] = SUITES): SuiteTierGroup[] {
  const byTier = new Map<string, SuiteEntry[]>();
  for (const suite of suites) {
    const bucket = byTier.get(suite.tier);
    if (bucket) bucket.push(suite);
    else byTier.set(suite.tier, [suite]);
  }
  const groups: SuiteTierGroup[] = [];
  for (const tier of NAV_TIERS) {
    const tierSuites = byTier.get(tier.id);
    if (tierSuites && tierSuites.length > 0) groups.push({ tier, suites: tierSuites });
  }
  return groups;
}

/** Product suites surfaced in the sidebar suite switcher. */
export const SUITES: SuiteEntry[] = [
  {
    segment: 'cyber',
    label: 'Cyber',
    description: {
      en: 'Security operations, threat intelligence & exposure management.',
      ar: 'عمليات الأمن السيبراني واستخبارات التهديدات وإدارة التعرّض.',
    },
    href: '/cyber',
    icon: Shield,
    permission: 'cyber:read',
    tier: 'ai-services',
  },
  {
    segment: 'data',
    label: 'Data',
    description: {
      en: 'Data sources, quality, pipelines & analytics.',
      ar: 'مصادر البيانات والجودة وخطوط المعالجة والتحليلات.',
    },
    href: '/data',
    icon: BarChart3,
    permission: 'data:read',
    tier: 'datastream',
  },
  // Clario Recover — productized application-recovery surface over DR. Reuses the
  // DR permission model (`dr:read`); per-sub-solution access is additionally gated
  // by live licensing entitlement (GET /api/recover/products).
  // Recover is the single top-level RESILIENCE product (planning / orchestration /
  // exec framing). The deep DR operations console (/dr/*) is NESTED under Recover
  // (see SUITE_FAMILY + the "Operations Console" nav group) rather than shown as a
  // competing suite entry, so the sidebar presents one coherent product.
  {
    segment: 'recover',
    label: 'Recover',
    description: {
      en: 'Application recovery: IT DR, cloud DR & cyber recovery.',
      ar: 'تعافي التطبيقات: تعافي تقنية المعلومات والسحابة والتعافي السيبراني.',
    },
    href: '/recover',
    icon: LifeBuoy,
    permission: 'dr:read',
    tier: 'datastream',
  },
  {
    segment: 'respond',
    label: 'Respond',
    description: {
      en: 'Incident command & major-event response.',
      ar: 'قيادة الحوادث والاستجابة للأحداث الكبرى.',
    },
    href: '/respond',
    icon: Siren,
    permission: 'respond:incident:read',
    tier: 'datastream',
  },
  {
    segment: 'migrate',
    label: 'Migrate',
    description: {
      en: 'Cloud migration portfolio, waves & cutovers.',
      ar: 'محفظة الترحيل السحابي والموجات وعمليات التحويل.',
    },
    href: '/migrate',
    icon: Cloud,
    permission: 'migrate:read',
    tier: 'datastream',
  },
  {
    segment: 'acta',
    label: 'Acta',
    description: {
      en: 'Committees, meetings & governance actions.',
      ar: 'اللجان والاجتماعات وإجراءات الحوكمة.',
    },
    href: '/acta',
    icon: Building2,
    permission: 'acta:read',
    tier: 'business-plus',
  },
  {
    segment: 'lex',
    label: 'وثيقتك',
    description: {
      en: 'Legal affairs: cases, contracts & consultations.',
      ar: 'الشؤون القانونية: القضايا والعقود والاستشارات.',
    },
    href: '/lex',
    icon: WatheeqMark,
    // §8.1 suite-entry requirement (anyOf) — NOT the bare 'lex:read' string:
    // personas like legal-system-admin hold only :manage/:view verbs.
    permission: LEX_ROUTE_PERMISSIONS['/lex'],
    tier: 'business-plus',
    subLabel: { en: 'Legal affairs', ar: 'الشؤون القانونية' },
  },
  {
    segment: 'visus',
    label: 'Visus',
    description: {
      en: 'Executive dashboards, KPIs & reports.',
      ar: 'لوحات تنفيذية ومؤشرات أداء وتقارير.',
    },
    href: '/visus',
    icon: Eye,
    permission: 'visus:read',
    tier: 'business-plus',
  },
];

/** NavSection id for the Clario Recover product group. */
export const RECOVER_NAV_SECTION_ID = 'recover' as const;

/**
 * Maps each Recover sub-solution nav-item id to its stable sub-solution slug
 * (RECOVER_CONTRACT.md). The sidebar uses this to filter sub-solution items by
 * live licensing entitlement: a sub-solution item is shown only when its slug is
 * reported `active` for the tenant. The product Overview item has no slug and is
 * always shown to a `dr:read` user (the landing page itself surfaces per-card
 * entitlement and the "request access" affordance for unlicensed sub-solutions).
 */
export const RECOVER_SUBSOLUTION_NAV: Record<string, string> = {
  'recover-it-dr': 'it-dr',
  'recover-cloud-dr': 'cloud-dr',
  'recover-cyber-recovery': 'cyber-recovery',
};

/**
 * Filters the Recover nav section's sub-solution items by the set of entitled
 * sub-solution slugs. Non-sub-solution items (e.g. the product Overview) are
 * preserved; sub-solution items are kept only when their slug is entitled. Other
 * sections pass through untouched. When `entitledSlugs` is `null` the entitlement
 * state is still loading — keep the section intact (the server-side guard is the
 * real control, so a brief over-show before data lands is safe and avoids nav
 * flicker).
 */
export function filterRecoverNavByEntitlement(
  sections: NavSection[],
  entitledSlugs: readonly string[] | null,
): NavSection[] {
  if (entitledSlugs === null) return sections;
  const entitled = new Set(entitledSlugs);
  return sections.map((section) => {
    if (section.id !== RECOVER_NAV_SECTION_ID) return section;
    return {
      ...section,
      items: section.items.filter((item) => {
        const slug = RECOVER_SUBSOLUTION_NAV[item.id];
        return slug === undefined || entitled.has(slug);
      }),
    };
  });
}

export const navigation: NavSection[] = [
  {
    id: 'main',
    label: '',
    permission: '*:read',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
      },
      {
        id: 'notebooks',
        label: 'Notebook Workspace',
        href: '/notebooks',
        icon: Bot,
      },
    ],
  },
  {
    id: 'security-operations',
    label: 'Security operations',
    permission: 'cyber:read',
    tier: 'ai-services',
    items: [
      { id: 'cyber-overview', label: 'Overview', href: '/cyber', icon: Shield },
      { id: 'cyber-assets', label: 'Assets', href: '/cyber/assets', icon: Monitor },
      {
        id: 'cyber-alerts',
        label: 'Alerts',
        href: '/cyber/alerts',
        icon: AlertTriangle,
        badge: {
          endpoint: '/api/v1/cyber/alerts/count?status=new,acknowledged',
          key: 'count',
          variant: 'destructive',
          pollIntervalMs: 30000,
          topics: ['alert.created', 'alert.escalated'],
        },
      },
      { id: 'cyber-indicators', label: 'IOC Management', href: '/cyber/indicators', icon: Fingerprint, permission: 'cyber:read' },
      { id: 'cyber-feeds', label: 'Threat Feeds', href: '/cyber/threat-feeds', icon: Rss, permission: 'cyber:manage' },
      { id: 'cyber-threats', label: 'Threat Hunting', href: '/cyber/threats', icon: Search },
      { id: 'cyber-detection', label: 'Detection Rules', href: '/cyber/detection-rules', icon: ShieldCheck, permission: 'cyber:read' },
      { id: 'cyber-events', label: 'Event Explorer', href: '/cyber/events', icon: Terminal, permission: 'cyber:read' },
      { id: 'cyber-siem', label: 'SIEM Operations', href: '/cyber/siem', icon: Terminal, permission: 'cyber:read' },
    ],
  },
  {
    id: 'cyber-cti',
    label: 'Threat intelligence',
    permission: 'cyber:read',
    tier: 'ai-services',
    items: [
      { id: 'cti-dashboard', label: 'CTI Dashboard', href: '/cyber/cti', icon: Radar, permission: 'cyber:read' },
      { id: 'cti-events', label: 'Threat Events', href: '/cyber/cti/events', icon: Zap, permission: 'cyber:read' },
      { id: 'cti-campaigns', label: 'Active Campaigns', href: '/cyber/cti/campaigns', icon: Target, permission: 'cyber:read' },
      { id: 'cti-actors', label: 'Threat Actors', href: '/cyber/cti/actors', icon: Users, permission: 'cyber:read' },
      { id: 'cti-brand-abuse', label: 'Brand Abuse', href: '/cyber/cti/brand-abuse', icon: Shield, permission: 'cyber:read' },
      { id: 'cti-geo', label: 'Geographic Analysis', href: '/cyber/cti/geo', icon: Globe, permission: 'cyber:read' },
      { id: 'cti-sectors', label: 'Sector Targeting', href: '/cyber/cti/sectors', icon: BarChart3, permission: 'cyber:read' },
    ],
  },
  {
    id: 'cyber-programs',
    label: 'Cyber programs',
    permission: 'cyber:read',
    tier: 'ai-services',
    items: [
      {
        id: 'cyber-ctem',
        label: 'CTEM',
        href: '/cyber/ctem',
        icon: Target,
        children: [
          { id: 'cyber-ctem-dashboard', label: 'Dashboard', href: '/cyber/ctem/dashboard', icon: LayoutDashboard },
          { id: 'cyber-ctem-assessments', label: 'Assessments', href: '/cyber/ctem', icon: Target },
        ],
      },
      {
        id: 'cyber-remediation',
        label: 'Remediation',
        href: '/cyber/remediation',
        icon: Wrench,
        permission: 'remediation:read',
      },
      {
        id: 'cyber-dspm',
        label: 'DSPM',
        href: '/cyber/dspm',
        icon: Database,
        children: [
          { id: 'cyber-dspm-overview', label: 'Overview', href: '/cyber/dspm', icon: Database },
          { id: 'cyber-dspm-assets', label: 'Data Assets', href: '/cyber/dspm/assets', icon: FolderOpen },
          { id: 'cyber-dspm-remediations', label: 'Remediations', href: '/cyber/dspm/remediations', icon: Wrench },
          { id: 'cyber-dspm-policies', label: 'Policies', href: '/cyber/dspm/policies', icon: FileText },
          { id: 'cyber-dspm-exceptions', label: 'Exceptions', href: '/cyber/dspm/exceptions', icon: AlertTriangle },
          { id: 'cyber-dspm-access', label: 'Access Control', href: '/cyber/dspm/access', icon: KeyRound },
          { id: 'cyber-dspm-compliance', label: 'Compliance', href: '/cyber/dspm/compliance', icon: Scale },
        ],
      },
      {
        id: 'cyber-ueba',
        label: 'UEBA',
        href: '/cyber/ueba',
        icon: Fingerprint,
        children: [
          { id: 'cyber-ueba-dashboard', label: 'Dashboard', href: '/cyber/ueba', icon: LayoutDashboard },
          { id: 'cyber-ueba-alerts', label: 'Alerts', href: '/cyber/ueba/alerts', icon: AlertTriangle },
          { id: 'cyber-ueba-config', label: 'Configuration', href: '/cyber/ueba/config', icon: Settings2 },
        ],
      },
      {
        id: 'cyber-vciso',
        label: 'Virtual CISO',
        href: '/cyber/vciso',
        icon: Bot,
        children: [
          { id: 'cyber-vciso-briefing', label: 'Briefing', href: '/cyber/vciso', icon: Bot },
          { id: 'cyber-vciso-risk-register', label: 'Risk Register', href: '/cyber/vciso/risk-register', icon: BookMarked },
          { id: 'cyber-vciso-policies', label: 'Policies', href: '/cyber/vciso/policies', icon: FileText },
          { id: 'cyber-vciso-compliance', label: 'Compliance', href: '/cyber/vciso/compliance', icon: FileCheck2 },
          { id: 'cyber-vciso-third-party', label: 'Third-Party Risk', href: '/cyber/vciso/third-party', icon: Handshake },
          { id: 'cyber-vciso-evidence', label: 'Evidence', href: '/cyber/vciso/evidence', icon: Archive },
          { id: 'cyber-vciso-maturity', label: 'Maturity & Budget', href: '/cyber/vciso/maturity', icon: Gauge },
          { id: 'cyber-vciso-awareness', label: 'Awareness & IAM', href: '/cyber/vciso/awareness', icon: GraduationCap },
          { id: 'cyber-vciso-incident-readiness', label: 'Incident Readiness', href: '/cyber/vciso/incident-readiness', icon: Siren },
          { id: 'cyber-vciso-integrations', label: 'Integrations', href: '/cyber/vciso/integrations', icon: CircuitBoard },
          { id: 'cyber-vciso-workflows', label: 'Workflows', href: '/cyber/vciso/workflows', icon: ListChecks },
          { id: 'cyber-vciso-predict', label: 'Predictive Analytics', href: '/cyber/vciso/predict', icon: BrainCircuit },
        ],
      },
      { id: 'cyber-mitre', label: 'MITRE ATT&CK', href: '/cyber/mitre-attack', icon: Grid3X3, permission: 'cyber:read' },
      { id: 'cyber-analytics', label: 'Analytics', href: '/cyber/analytics', icon: TrendingUp, permission: 'cyber:read' },
    ],
  },
  {
    id: 'data-intelligence',
    label: 'Data intelligence',
    permission: 'data:read',
    tier: 'datastream',
    items: [
      { id: 'data-overview', label: 'Overview', href: '/data', icon: BarChart3 },
      { id: 'data-sources', label: 'Data Sources', href: '/data/sources', icon: FolderOpen },
      { id: 'data-models', label: 'Data Models', href: '/data/models', icon: Boxes },
      {
        id: 'data-pipelines',
        label: 'Pipelines',
        href: '/data/pipelines',
        icon: GitBranch,
        badge: {
          endpoint: '/api/v1/data/pipelines/count?status=failed',
          key: 'count',
          variant: 'warning',
          pollIntervalMs: 60000,
          topics: ['pipeline.failed'],
        },
      },
      { id: 'data-quality', label: 'Data Quality', href: '/data/quality', icon: CheckCircle },
      { id: 'data-contradictions', label: 'Contradictions', href: '/data/contradictions', icon: Zap },
      { id: 'data-dark', label: 'Dark Data', href: '/data/dark-data', icon: Package },
      { id: 'data-analytics', label: 'Analytics', href: '/data/analytics', icon: TrendingUp },
    ],
  },
  // ── Clario Recover · Application Recovery ────────────────────────────────────
  // The Recover product surfaces three sub-solutions (IT DR / Cloud DR / Cyber
  // Recovery) as a top-level suite scoped under `/recover`. Each item maps 1:1 to
  // a sub-solution slug via RECOVER_SUBSOLUTION_NAV; the sidebar additionally
  // filters these items by LIVE licensing entitlement (GET /api/recover/products)
  // so an unlicensed sub-solution is hidden (server-side route guards reject
  // direct navigation regardless). The coarse `dr:read` permission gate keeps the
  // whole product hidden from users without DR access.
  {
    id: RECOVER_NAV_SECTION_ID,
    label: 'Recover · Application recovery',
    permission: 'dr:read',
    tier: 'datastream',
    items: [
      { id: 'recover-overview', label: 'Overview', href: '/recover', icon: LifeBuoy, permission: 'dr:read' },
      { id: 'recover-it-dr', label: 'IT Disaster Recovery', href: '/recover/it-dr', icon: ServerCog, permission: 'dr:read' },
      { id: 'recover-cloud-dr', label: 'Cloud Disaster Recovery', href: '/recover/cloud-dr', icon: Cloud, permission: 'dr:read' },
      { id: 'recover-cyber-recovery', label: 'Cyber Recovery', href: '/recover/cyber-recovery', icon: ShieldAlert, permission: 'dr:read' },
      { id: 'recover-prove', label: 'Prove · Evidence', href: '/recover/prove', icon: FileCheck2, permission: 'dr:read' },
      { id: 'recover-metastore', label: 'Application Metastore', href: '/recover/it-dr/metastore', icon: DatabaseZap, permission: 'dr:read' },
      // Entry point to the nested DR Operations Console — the deep, live operational
      // surface (protection groups, replication, failover, drills). Placed inside the
      // Recover product group so the product → operations relationship is explicit.
      { id: 'recover-ops-console', label: 'Operations Console', href: '/dr', icon: ShieldCheck, permission: 'dr:read' },
    ],
  },
  // ── ClarioDR · Disaster Recovery ─────────────────────────────────────────────
  // The DR routes are grouped into three labeled lifecycle sections so new
  // users can form a mental model instead of scanning one flat list. This mirrors
  // the Cyber suite's multi-section grouping (SECURITY OPERATIONS / THREAT
  // INTELLIGENCE / CYBER PROGRAMS): each group is its own NavSection but every
  // deep operational items stay under `/dr`; Recover lifecycle pages use their
  // canonical `/recover/it-dr/*` routes. `filterSectionsForRoute` keeps all three
  // scoped to the Recover product family. No renderer change is needed — the
  // existing per-section SidebarSection header gives each group its label, and no
  // other suite's sidebar output is affected.
  {
    id: 'resilience-operations',
    label: 'Operations console',
    permission: 'dr:read',
    tier: 'datastream',
    items: [
      { id: 'dr-overview', label: 'Overview', href: '/dr', icon: ShieldCheck, permission: 'dr:read' },
      { id: 'dr-approvals', label: 'Approvals', href: '/dr/approvals', icon: CheckCircle, permission: 'dr:read' },
      { id: 'dr-insights', label: 'Insights', href: '/dr/insights', icon: TrendingUp, permission: 'dr:read' },
    ],
  },
  {
    id: 'resilience-lifecycle',
    label: 'Operations · Lifecycle',
    permission: 'dr:read',
    tier: 'datastream',
    items: [
      // Protect → Recover → Rehearse → Prove → Readiness.
      { id: 'dr-protect', label: 'Protect', href: '/dr/protect', icon: Shield, permission: 'dr:read' },
      { id: 'dr-recover', label: 'Recover', href: '/recover/it-dr/recover', icon: Siren, permission: 'dr:read' },
      { id: 'dr-rehearse', label: 'Rehearse', href: '/recover/it-dr/rehearse', icon: GraduationCap, permission: 'dr:read' },
      {
        id: 'dr-prove',
        label: 'Prove',
        href: '/recover/it-dr/prove',
        icon: FileCheck2,
        permission: 'dr:read',
        children: [
          { id: 'dr-prove-overview', label: 'Overview', href: '/recover/it-dr/prove', icon: FileCheck2, permission: 'dr:read' },
          { id: 'dr-prove-ledger', label: 'Ledger', href: '/recover/it-dr/prove/ledger', icon: ListChecks, permission: 'dr:read' },
          { id: 'dr-prove-compliance', label: 'Compliance', href: '/recover/it-dr/prove/compliance', icon: Scale, permission: 'dr:read' },
        ],
      },
      { id: 'dr-readiness', label: 'Readiness', href: '/dr/readiness', icon: Gauge, permission: 'dr:read' },
    ],
  },
  {
    id: 'resilience-infrastructure',
    label: 'Operations · Infrastructure',
    permission: 'dr:read',
    tier: 'datastream',
    items: [
      { id: 'dr-topology', label: 'Topology', href: '/dr/topology', icon: GitBranch, permission: 'dr:read' },
      { id: 'dr-runbooks', label: 'Runbooks', href: '/recover/it-dr/runbooks', icon: BookMarked, permission: 'dr:read' },
      { id: 'dr-integrations', label: 'Integrations', href: '/dr/integrations', icon: Plug, permission: 'dr:read' },
    ],
  },
  {
    id: 'respond-command',
    label: 'Respond · Command',
    permission: 'respond:incident:read',
    tier: 'datastream',
    items: [
      { id: 'respond-overview', label: 'Overview', href: '/respond', icon: Siren, permission: 'respond:incident:read' },
      {
        id: 'respond-incidents',
        label: 'Incidents',
        href: '/respond/incidents',
        icon: RadioTower,
        permission: 'respond:incident:read',
      },
    ],
  },
  {
    id: 'migrate-command',
    label: 'Migrate · Cloud migration',
    permission: 'migrate:read',
    tier: 'datastream',
    items: [
      { id: 'migrate-overview', label: 'Overview', href: '/migrate', icon: Cloud, permission: 'migrate:read' },
      { id: 'migrate-command-center', label: 'Command Center', href: '/migrate/command-center', icon: LayoutDashboard, permission: 'migrate:read' },
      { id: 'migrate-portfolio', label: 'Portfolio', href: '/migrate/portfolio', icon: Layers, permission: 'migrate:read' },
      { id: 'migrate-move-groups', label: 'Move Groups', href: '/migrate/move-groups', icon: Network, permission: 'migrate:read' },
      { id: 'migrate-waves', label: 'Waves', href: '/migrate/waves', icon: GitBranch, permission: 'migrate:read' },
      { id: 'migrate-cutovers', label: 'Cutovers', href: '/migrate/cutovers', icon: CalendarClock, permission: 'migrate:read' },
      { id: 'migrate-integrations', label: 'Integrations', href: '/migrate/integrations', icon: Plug, permission: 'migrate:read' },
      { id: 'migrate-evidence', label: 'Evidence', href: '/migrate/command-center', icon: FileCheck2, permission: 'migrate:evidence:export' },
    ],
  },
  {
    id: 'acta',
    label: 'Acta',
    permission: 'acta:read',
    tier: 'business-plus',
    items: [
      { id: 'acta-overview', label: 'Overview', href: '/acta', icon: Building2 },
      { id: 'acta-committees', label: 'Committees', href: '/acta/committees', icon: Users },
      { id: 'acta-meetings', label: 'Meetings', href: '/acta/meetings', icon: BookOpen },
      { id: 'acta-actions', label: 'Action Items', href: '/acta/action-items', icon: ClipboardList },
    ],
  },
  // ── Watheeq (Lex) · Legal Affairs ────────────────────────────────────────────
  // IA aligned to the Othaim PRD scope map so the client recognises their own
  // modules by name. This mobile/sidebar inventory is kept in lockstep with the
  // desktop top-nav single source of truth (`components/lex/shell/
  // lex-routes.ts`): the same spec-9 first-class modules (Overview, Legal
  // Services & Requests, Consultations, Contracts, Cases, Investigations,
  // References, Reports & Performance Indicators, Roles & Users), the same
  // secondary Legal Domains / Workspace grouping, and the same routes (Reports →
  // the KPI dashboards at /lex/reports/analytics, Notifications →
  // /lex/notifications).
  //
  // Every item is tagged from the granular `LEX_ROUTE_PERMISSIONS` registry
  // (docs/ClarioWatheeq/Lex_Codebase_RBAC_Map.md §8) — the SINGLE SOURCE OF TRUTH
  // shared with the command palette. The coarse `lex:read`/`lex:write` keys are
  // gone from the item level; `lex:read` survives ONLY inside the suite entry's
  // `anyOf` (§8.1) as a compatibility fallback. Per-suite filtering
  // (filterSectionsForRoute) shows only these `/lex` sections inside Watheeq, so
  // together they read as one suite. Section headers use '*:read' so they defer
  // to the granular item requirement; the sidebar drops a section when no item
  // survives the filter, so nothing leaks to users without the matching keys.
  {
    // Empty label → renders the landing item with no sub-header.
    id: 'lex-home',
    label: '',
    permission: '*:read',
    tier: 'business-plus',
    items: [
      { id: 'lex-overview', label: 'Overview', href: '/lex', icon: Gavel, permission: LEX_ROUTE_PERMISSIONS['/lex'] },
    ],
  },
  {
    // PRIMARY — the spec-9 first-class modules (Overview lives in `lex-home`
    // above; the remaining eight render here), in lockstep with the desktop
    // top-nav single source of truth (`components/lex/shell/lex-routes.ts` →
    // `modules` group): same routes, same order, same labels. The operational
    // tabs (Task Management, Workflow & Approvals, Documents, Notifications)
    // drop into the secondary Legal Domains / Workspace groups below.
    id: 'lex-modules-group',
    label: 'Modules',
    permission: '*:read',
    tier: 'business-plus',
    items: [
      { id: 'lex-legal-services', label: 'Legal Services & Requests', href: '/lex/service-desk', icon: Inbox, permission: LEX_ROUTE_PERMISSIONS['/lex/service-desk'] },
      {
        id: 'lex-consultations',
        label: 'Consultations',
        href: '/lex/consultations',
        icon: MessagesSquare,
        permission: LEX_ROUTE_PERMISSIONS['/lex/consultations'],
        badge: {
          endpoint: '/api/v1/lex/consultations/count?status=submitted',
          key: 'count',
          variant: 'warning',
          pollIntervalMs: 30000,
          topics: ['lex.consultations'],
        },
      },
      { id: 'lex-contracts', label: 'Contracts', href: '/lex/contracts', icon: FileText, permission: LEX_ROUTE_PERMISSIONS['/lex/contracts'] },
      { id: 'lex-cases', label: 'Cases', href: '/lex/cases', icon: Gavel, permission: LEX_ROUTE_PERMISSIONS['/lex/cases'] },
      { id: 'lex-investigations', label: 'Investigations', href: '/lex/investigations', icon: ShieldQuestion, permission: LEX_ROUTE_PERMISSIONS['/lex/investigations'] },
      { id: 'lex-library', label: 'References', href: '/lex/library', icon: Library, permission: LEX_ROUTE_PERMISSIONS['/lex/library'] },
      { id: 'lex-reports', label: 'Reports & Performance Indicators', href: '/lex/reports/analytics', icon: BarChart3, permission: LEX_ROUTE_PERMISSIONS['/lex/reports/analytics'] },
      { id: 'lex-roles', label: 'Roles & Users', href: '/lex/admin/role-matrix', icon: Users, permission: LEX_ADMIN_NAV_PERMISSIONS.roleMatrix },
    ],
  },
  {
    // SECONDARY — the extra legal domains, kept below the ten modules.
    id: 'lex-domains-group',
    label: 'Legal Domains',
    permission: '*:read',
    tier: 'business-plus',
    items: [
      { id: 'lex-matters', label: 'Matters', href: '/lex/matters', icon: Scale, permission: { anyOf: ['lex:case:view', 'lex:contract:view'] } },
      { id: 'lex-settlements', label: 'Settlements & ADR', href: '/lex/settlements', icon: Handshake, permission: LEX_ROUTE_PERMISSIONS['/lex/settlements'] },
      { id: 'lex-signatures', label: 'Signatures', href: '/lex/signatures', icon: FileCheck2, permission: { anyOf: ['lex:contract:view', 'lex:document:view'] } },
      { id: 'lex-drafting', label: 'AI Drafting', href: '/lex/drafting', icon: Sparkles, permission: LEX_ROUTE_PERMISSIONS['/lex/drafting'] },
      { id: 'lex-clause-library', label: 'Clause Library', href: '/lex/clause-library', icon: BookMarked, permission: LEX_ROUTE_PERMISSIONS['/lex/clause-library'] },
      { id: 'lex-playbooks', label: 'Playbooks', href: '/lex/playbooks', icon: ClipboardList, permission: LEX_ROUTE_PERMISSIONS['/lex/playbooks'] },
      { id: 'lex-regulations', label: 'Regulations', href: '/lex/regulations', icon: ScrollText, permission: LEX_ROUTE_PERMISSIONS['/lex/regulations'] },
      { id: 'lex-compliance', label: 'Compliance', href: '/lex/compliance', icon: ShieldCheck, permission: LEX_ROUTE_PERMISSIONS['/lex/compliance'] },
      { id: 'lex-documents', label: 'Documents & Attachments', href: '/lex/documents', icon: File, permission: LEX_ROUTE_PERMISSIONS['/lex/documents'] },
      { id: 'lex-notifications', label: 'Notifications & Alerts', href: '/lex/notifications', icon: Bell, permission: LEX_ROUTE_PERMISSIONS['/lex/notifications'] },
    ],
  },
  {
    // SECONDARY — operational / oversight workspace surfaces.
    id: 'lex-workspace-group',
    label: 'Workspace',
    permission: '*:read',
    tier: 'business-plus',
    items: [
      { id: 'lex-tasks', label: 'Task Management', href: '/lex/tasks', icon: ListChecks, permission: LEX_ROUTE_PERMISSIONS['/lex/tasks'] },
      { id: 'lex-approvals', label: 'Approvals', href: '/lex/approvals/requests', icon: FileCheck2, permission: LEX_ROUTE_PERMISSIONS['/lex/approvals/requests'] },
      { id: 'lex-approval-escalations', label: 'Escalation Management', href: '/lex/approvals/escalations', icon: ShieldAlert, permission: LEX_ROUTE_PERMISSIONS['/lex/approvals/escalations'] },
      { id: 'lex-workflow-approvals', label: 'Workflow & Approvals', href: '/lex/workflow-policies', icon: Workflow, permission: LEX_ROUTE_PERMISSIONS['/lex/workflow-policies'] },
      { id: 'lex-calendar', label: 'Calendar', href: '/lex/calendar', icon: CalendarDays, permission: LEX_ROUTE_PERMISSIONS['/lex/calendar'] },
      { id: 'lex-entities', label: 'Entities', href: '/lex/entities', icon: Building2, permission: LEX_ROUTE_PERMISSIONS['/lex/entities'] },
      { id: 'lex-analytics-risk', label: 'Risk Analytics', href: '/lex/analytics/risk', icon: ShieldAlert, permission: LEX_ROUTE_PERMISSIONS['/lex/analytics/risk'] },
      { id: 'lex-report-builder', label: 'Report Builder', href: '/lex/reports/builder', icon: Settings2, permission: LEX_ROUTE_PERMISSIONS['/lex/reports/builder'] },
      { id: 'lex-reports-export', label: 'Report Exports', href: '/lex/reports', icon: FileBarChart, permission: 'lex:report:read' },
    ],
  },
  {
    id: 'lex-admin-group',
    label: 'Administration',
    // §13: the admin surface must show for any persona with a view OR manage
    // key on at least one config domain — the legal-system-admin holds ONLY
    // `:manage` keys (no `lex:read`), so a section-level 'lex:read' gate would
    // hide this group from the exact persona it exists for. '*:read' defers to
    // the granular item requirements (LEX_ADMIN_NAV_PERMISSIONS / approval
    // keys); the sidebar drops the section when no item survives the filter.
    permission: '*:read',
    tier: 'business-plus',
    items: [
      // PRD re-org: "Workflow & Approvals" (/lex/workflow-policies) and the
      // Notifications inbox are now first-class PRD modules in the Modules group
      // above — this section holds only the deep Legal Affairs Administration hub.
      {
        id: 'lex-admin',
        label: 'Legal Affairs Administration',
        href: '/lex/admin',
        icon: Settings2,
        // §13: the admin group surfaces for any persona with a view OR manage key
        // on at least one config domain (the System Admin holds only `:manage`).
        permission: LEX_ADMIN_NAV_PERMISSIONS.group,
        children: [
          { id: 'lex-admin-calendars', label: 'Working Calendars', href: '/lex/admin/working-calendars', icon: CalendarDays, permission: LEX_ADMIN_NAV_PERMISSIONS.workingCalendars },
          { id: 'lex-admin-service-catalog', label: 'Service Catalog', href: '/lex/admin/service-catalog', icon: Layers, permission: LEX_ADMIN_NAV_PERMISSIONS.serviceCatalog },
          { id: 'lex-admin-sla-targets', label: 'SLA Targets', href: '/lex/admin/sla-targets', icon: Timer, permission: LEX_ADMIN_NAV_PERMISSIONS.slaTargets },
          { id: 'lex-admin-attachment-policies', label: 'Attachment Policies', href: '/lex/admin/attachment-policies', icon: FileStack, permission: LEX_ADMIN_NAV_PERMISSIONS.attachmentPolicies },
          { id: 'lex-admin-org-entities', label: 'Org Registry', href: '/lex/admin/org-entities', icon: Network, permission: LEX_ADMIN_NAV_PERMISSIONS.orgEntities },
          { id: 'lex-admin-integrations', label: 'Integrations', href: '/lex/admin/integrations', icon: Plug, permission: LEX_ADMIN_NAV_PERMISSIONS.integrations },
          { id: 'lex-admin-integrations-dlq', label: 'Dead-letter queue', href: '/lex/admin/integrations/dlq', icon: Inbox, permission: LEX_ADMIN_NAV_PERMISSIONS.integrations },
          { id: 'lex-admin-integrations-observability', label: 'Observability', href: '/lex/admin/integrations/observability', icon: Activity, permission: LEX_ADMIN_NAV_PERMISSIONS.integrations },
          { id: 'lex-admin-integrations-events', label: 'Events', href: '/lex/admin/integrations/events', icon: Rss, permission: LEX_ADMIN_NAV_PERMISSIONS.integrations },
          { id: 'lex-admin-integrations-pending-changes', label: 'Pending changes', href: '/lex/admin/integrations/pending-changes', icon: ShieldQuestion, permission: LEX_ADMIN_NAV_PERMISSIONS.integrations },
          { id: 'lex-admin-classifications', label: 'Case Classifications', href: '/lex/admin/classifications', icon: GitBranch, permission: LEX_ADMIN_NAV_PERMISSIONS.classifications },
          { id: 'lex-admin-legal-holds', label: 'Legal Holds', href: '/lex/admin/legal-holds', icon: Lock, permission: LEX_ADMIN_NAV_PERMISSIONS.legalHolds },
          { id: 'lex-admin-contract-approval-policies', label: 'Contract Approval Policies', href: '/lex/admin/contract-approval-policies', icon: ScrollText, permission: LEX_ADMIN_NAV_PERMISSIONS.contractApprovalPolicies },
        ],
      },
    ],
  },
  {
    id: 'visus',
    label: 'Visus',
    permission: 'visus:read',
    tier: 'business-plus',
    items: [
      { id: 'visus-dashboard', label: 'Overview', href: '/visus', icon: Eye },
      { id: 'visus-dashboards', label: 'Dashboards', href: '/visus/dashboards', icon: Layout },
      { id: 'visus-kpis', label: 'KPIs', href: '/visus/kpis', icon: TrendingUp },
      { id: 'visus-reports', label: 'Reports', href: '/visus/reports', icon: FileBarChart },
      { id: 'visus-alerts', label: 'Alerts', href: '/visus/alerts', icon: Bell },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    permission: 'users:read',
    tier: 'platform-core',
    items: [
      {
        id: 'admin-users',
        label: 'Users',
        href: '/admin/users',
        icon: Users,
        permission: 'users:read',
      },
      {
        id: 'admin-roles',
        label: 'Roles',
        href: '/admin/roles',
        icon: KeyRound,
        permission: 'roles:read',
      },
      {
        id: 'admin-tenants',
        label: 'Tenants',
        href: '/admin/tenants',
        icon: Building2,
        permission: 'admin:tenants',
      },
      {
        id: 'admin-sso',
        label: 'Single Sign-On',
        href: '/admin/sso',
        icon: ShieldCheck,
        permission: 'admin:tenants',
      },
      {
        id: 'admin-api-keys',
        label: 'API Keys',
        href: '/admin/api-keys',
        icon: Key,
        permission: 'users:read',
      },
      {
        id: 'admin-invitations',
        label: 'Invitations',
        href: '/admin/invitations',
        icon: Mail,
        permission: 'users:write',
      },
      {
        id: 'admin-ai-governance',
        label: 'AI Governance',
        href: '/admin/ai-governance',
        icon: Bot,
        permission: 'users:read',
        children: [
          { id: 'admin-ai-governance-models', label: 'Model Registry', href: '/admin/ai-governance', icon: Bot, permission: 'users:read' },
          { id: 'admin-ai-governance-compute', label: 'Compute', href: '/admin/ai-governance/compute', icon: Server, permission: 'users:read' },
          { id: 'admin-ai-governance-benchmarks', label: 'Benchmarks', href: '/admin/ai-governance/benchmarks', icon: BarChart3, permission: 'users:read' },
        ],
      },
      {
        id: 'admin-billing',
        label: 'Billing & Usage',
        href: '/admin/billing',
        icon: CreditCard,
        permission: 'tenant:read',
      },
      {
        id: 'admin-integrations',
        label: 'Integrations',
        href: '/admin/integrations',
        icon: Plug,
        permission: 'tenant:write',
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    permission: '*:read',
    tier: 'platform-core',
    items: [
      {
        id: 'admin-workflows',
        label: 'Workflows',
        href: '/workflows',
        icon: Workflow,
        badge: {
          endpoint: '/api/v1/workflows/tasks/count',
          key: 'pending',
          variant: 'default',
          pollIntervalMs: 30000,
          topics: ['task.assigned', 'task.completed', 'task.overdue', 'workflow.task.created', 'workflow.task.completed'],
        },
        children: [
          {
            id: 'workflows-my-tasks',
            label: 'My Tasks',
            href: '/workflows/tasks',
            icon: ClipboardList,
            badge: {
              endpoint: '/api/v1/workflows/tasks/count',
              key: 'pending',
              variant: 'warning',
              pollIntervalMs: 30000,
              topics: ['task.assigned', 'task.completed', 'task.overdue', 'workflow.task.created', 'workflow.task.completed'],
            },
          },
          { id: 'workflows-definitions-browse', label: 'Browse Workflows', href: '/workflows/definitions', icon: Layout },
          { id: 'admin-workflow-tasks', label: 'Task Queue', href: '/admin/workflows/tasks', icon: ClipboardList, permission: 'workflow:write' },
          { id: 'admin-workflow-instances', label: 'Instances', href: '/admin/workflows/instances', icon: Workflow, permission: 'workflow:write' },
          { id: 'admin-workflow-definitions', label: 'Definitions', href: '/admin/workflows/definitions', icon: GitBranch, permission: 'workflow:write' },
          { id: 'admin-workflow-templates', label: 'Templates', href: '/admin/workflows/templates', icon: Layout, permission: 'workflow:write' },
          { id: 'admin-workflow-forms', label: 'Forms', href: '/admin/workflows/forms', icon: FileText, permission: 'workflow:write' },
          { id: 'admin-workflow-operations', label: 'Operations', href: '/admin/workflows/operations', icon: Settings2, permission: 'workflow:write' },
          { id: 'admin-automation-engine', label: 'Automation Engine', href: '/admin/automation', icon: Zap, permission: 'automation:read' },
          { id: 'admin-workflow-analytics', label: 'Analytics', href: '/admin/workflows/analytics', icon: BarChart3, permission: 'workflow:write' },
        ],
      },
      { id: 'admin-files', label: 'Files', href: '/files', icon: File },
      { id: 'admin-notifications', label: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    permission: 'admin:console',
    tier: 'platform-core',
    items: [
      { id: 'platform-overview', label: 'Overview', href: '/platform', icon: Server, permission: 'admin:console' },
      {
        id: 'platform-tenants',
        label: 'Tenants',
        href: '/platform/tenants',
        icon: Building2,
        permission: 'admin:console',
        badge: {
          endpoint: '/api/v1/platform/tenants/summary',
          key: 'attention',
          variant: 'warning',
          pollIntervalMs: 60000,
          topics: ['platform.tenant.lifecycle'],
        },
      },
      { id: 'platform-suites', label: 'Suites', href: '/platform/suites', icon: LayoutGrid, permission: 'admin:console' },
      {
        id: 'platform-licensing',
        label: 'Licensing',
        href: '/platform/licensing',
        icon: Boxes,
        permission: 'admin:console',
        badge: {
          endpoint: '/api/v1/licensing/admin/licenses/expiring?within_days=30',
          key: 'data',
          variant: 'destructive',
          pollIntervalMs: 300000,
        },
      },
      {
        id: 'platform-pricing',
        label: 'Pricing',
        href: '/platform/pricing',
        icon: Calculator,
        // Any pricing verb may open the calculator; pricing:* / * match too. The
        // internal margin panel inside the page is separately gated on
        // pricing:admin (and the backend structurally masks regardless).
        permission: { anyOf: ['pricing:read', 'pricing:write', 'pricing:admin'] },
        children: [
          {
            id: 'platform-pricing-calculator',
            label: 'Calculator',
            href: '/platform/pricing',
            icon: Calculator,
            permission: { anyOf: ['pricing:read', 'pricing:write', 'pricing:admin'] },
          },
          {
            id: 'platform-pricing-quotes',
            label: 'Quotes',
            href: '/platform/pricing/quotes',
            icon: FileText,
            // Quotes history/list — gated on pricing:read (pricing:* / * match).
            permission: 'pricing:read',
          },
        ],
      },
      { id: 'platform-identity', label: 'Identity', href: '/platform/identity', icon: KeyRound, permission: 'admin:console' },
      { id: 'platform-audit', label: 'Audit', href: '/platform/audit', icon: ScrollText, permission: 'admin:console' },
      {
        id: 'platform-services',
        label: 'Services',
        href: '/platform/services',
        icon: Activity,
        permission: 'admin:console',
        badge: {
          endpoint: '/api/v1/platform/fleet/summary',
          key: 'unhealthy',
          variant: 'destructive',
          pollIntervalMs: 30000,
          topics: ['platform.fleet.health'],
        },
      },
      { id: 'platform-ai', label: 'AI Governance', href: '/platform/ai', icon: BrainCircuit, permission: 'admin:console' },
    ],
  },
  // ── Infrastructure · cross-cutting operational surfaces ──────────────────────
  // Tenant audit trail, tenant settings, and notification delivery configuration —
  // the events/audit + settings + notifications surfaces of the platform-architecture
  // Infrastructure tier. These items relocated out of the Administration group (their
  // routes, ids, permissions and coarse `users:read` visibility gate are unchanged) so
  // the sidebar reads as the five architecture tiers. `admin-audit` stays `*:read` at
  // the item level; the section keeps the `users:read` gate it inherited under
  // Administration, so no user newly gains or loses an entry.
  {
    id: 'platform-operations',
    label: 'Operations & audit',
    permission: 'users:read',
    tier: 'infrastructure',
    items: [
      {
        id: 'admin-audit',
        label: 'Audit Logs',
        href: '/admin/audit',
        icon: ClipboardList,
        permission: '*:read',
      },
      {
        id: 'admin-settings',
        label: 'Settings',
        href: '/admin/settings',
        icon: Settings,
        permission: 'tenant:write',
      },
      {
        id: 'admin-notification-management',
        label: 'Notification Mgmt',
        href: '/admin/notifications',
        icon: BellRing,
        permission: 'tenant:write',
      },
    ],
  },
];

/* ──────────────────────────────────────────────────────────────────────────────
 * Navigation IA helpers — breadcrumbs, progressive disclosure & suite launcher.
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * Bilingual labels for route segments that are NOT covered by a nav item id
 * (acronyms, hub segments, dynamic sub-pages). The breadcrumb trail resolves a
 * segment against the nav-item registry first, then falls back to this map, so
 * every dashboard route renders a meaningful, localized crumb instead of a
 * title-cased slug like “Ctem” or “Dspm”.
 */
export const NAV_SEGMENT_LABELS: Record<string, NavLocalizedText> = {
  // Global areas
  dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
  admin: { en: 'Administration', ar: 'الإدارة' },
  platform: { en: 'Platform', ar: 'المنصة' },
  console: { en: 'Console', ar: 'وحدة التحكم' },
  workflows: { en: 'Workflows', ar: 'سير العمل' },
  files: { en: 'Files', ar: 'الملفات' },
  notifications: { en: 'Notifications', ar: 'الإشعارات' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  notebooks: { en: 'Notebook Workspace', ar: 'مساحة دفاتر العمل' },
  suites: { en: 'Suites', ar: 'الحزم' },
  new: { en: 'New', ar: 'جديد' },
  edit: { en: 'Edit', ar: 'تعديل' },
  review: { en: 'Review', ar: 'المراجعة' },
  // Suite roots (Arabic side fills catalog gaps for newer suites)
  cyber: { en: 'Cyber', ar: 'الأمن السيبراني' },
  data: { en: 'Data', ar: 'البيانات' },
  recover: { en: 'Recover', ar: 'التعافي' },
  respond: { en: 'Respond', ar: 'الاستجابة' },
  migrate: { en: 'Migrate', ar: 'الترحيل' },
  acta: { en: 'Acta', ar: 'الحوكمة' },
  lex: { en: 'وثيقتك', ar: 'وثيقتك' },
  visus: { en: 'Visus', ar: 'ذكاء تنفيذي' },
  dr: { en: 'Operations Console', ar: 'وحدة العمليات' },
  // Cyber acronym programs & sub-pages
  ctem: { en: 'CTEM', ar: 'إدارة التعرّض المستمرة' },
  dspm: { en: 'DSPM', ar: 'إدارة أمن البيانات' },
  ueba: { en: 'UEBA', ar: 'تحليلات سلوك المستخدمين' },
  siem: { en: 'SIEM Operations', ar: 'عمليات SIEM' },
  cti: { en: 'Threat Intelligence', ar: 'استخبارات التهديدات' },
  vciso: { en: 'Virtual CISO', ar: 'الرئيس الافتراضي لأمن المعلومات' },
  'mitre-attack': { en: 'MITRE ATT&CK', ar: 'مصفوفة MITRE ATT&CK' },
  'threat-feeds': { en: 'Threat Feeds', ar: 'مصادر التهديدات' },
  'detection-rules': { en: 'Detection Rules', ar: 'قواعد الكشف' },
  indicators: { en: 'IOC Management', ar: 'إدارة مؤشرات الاختراق' },
  remediations: { en: 'Remediations', ar: 'المعالجات' },
  exceptions: { en: 'Exceptions', ar: 'الاستثناءات' },
  access: { en: 'Access Control', ar: 'التحكم بالوصول' },
  // Recover / DR
  'it-dr': { en: 'IT Disaster Recovery', ar: 'تعافي تقنية المعلومات' },
  'cloud-dr': { en: 'Cloud Disaster Recovery', ar: 'التعافي السحابي' },
  'cyber-recovery': { en: 'Cyber Recovery', ar: 'التعافي السيبراني' },
  metastore: { en: 'Application Metastore', ar: 'سجل التطبيقات' },
  // Admin / platform sub-pages
  'ai-governance': { en: 'AI Governance', ar: 'حوكمة الذكاء الاصطناعي' },
  'api-keys': { en: 'API Keys', ar: 'مفاتيح API' },
  invitations: { en: 'Invitations', ar: 'الدعوات' },
  billing: { en: 'Billing & Usage', ar: 'الفوترة والاستخدام' },
  licensing: { en: 'Licensing', ar: 'التراخيص' },
  pricing: { en: 'Pricing', ar: 'التسعير' },
  quotes: { en: 'Quotes', ar: 'عروض الأسعار' },
  identity: { en: 'Identity', ar: 'الهوية' },
  tenants: { en: 'Tenants', ar: 'المستأجرون' },
  users: { en: 'Users', ar: 'المستخدمون' },
  roles: { en: 'Roles', ar: 'الأدوار' },
  audit: { en: 'Audit', ar: 'التدقيق' },
  benchmarks: { en: 'Benchmarks', ar: 'المعايير المرجعية' },
  compute: { en: 'Compute', ar: 'الحوسبة' },
  services: { en: 'Services', ar: 'الخدمات' },
  // Workflow workspace sub-pages
  tasks: { en: 'Tasks', ar: 'المهام' },
  definitions: { en: 'Definitions', ar: 'التعريفات' },
  instances: { en: 'Instances', ar: 'النسخ' },
  templates: { en: 'Templates', ar: 'القوالب' },
  forms: { en: 'Forms', ar: 'النماذج' },
  operations: { en: 'Operations', ar: 'العمليات' },
  automation: { en: 'Automation Engine', ar: 'محرك الأتمتة' },
  // Lex sub-pages
  dlq: { en: 'Dead-letter Queue', ar: 'قائمة الرسائل المتعثرة' },
  observability: { en: 'Observability', ar: 'قابلية المراقبة' },
  'pending-changes': { en: 'Pending Changes', ar: 'التغييرات المعلّقة' },
  kpis: { en: 'KPIs', ar: 'مؤشرات الأداء' },
  // Common suite pages (Arabic side fills catalog gaps)
  alerts: { en: 'Alerts', ar: 'التنبيهات' },
  assets: { en: 'Assets', ar: 'الأصول' },
  events: { en: 'Events', ar: 'الأحداث' },
  campaigns: { en: 'Campaigns', ar: 'الحملات' },
  actors: { en: 'Threat Actors', ar: 'جهات التهديد' },
  threats: { en: 'Threat Hunting', ar: 'اصطياد التهديدات' },
  incidents: { en: 'Incidents', ar: 'الحوادث' },
  sources: { en: 'Data Sources', ar: 'مصادر البيانات' },
  models: { en: 'Data Models', ar: 'نماذج البيانات' },
  pipelines: { en: 'Pipelines', ar: 'خطوط المعالجة' },
  quality: { en: 'Data Quality', ar: 'جودة البيانات' },
  contradictions: { en: 'Contradictions', ar: 'التناقضات' },
  'dark-data': { en: 'Dark Data', ar: 'البيانات المظلمة' },
  analytics: { en: 'Analytics', ar: 'التحليلات' },
  portfolio: { en: 'Portfolio', ar: 'المحفظة' },
  'move-groups': { en: 'Move Groups', ar: 'مجموعات النقل' },
  waves: { en: 'Waves', ar: 'الموجات' },
  cutovers: { en: 'Cutovers', ar: 'عمليات التحويل' },
  'command-center': { en: 'Command Center', ar: 'مركز القيادة' },
  integrations: { en: 'Integrations', ar: 'التكاملات' },
  evidence: { en: 'Evidence', ar: 'الأدلة' },
  approvals: { en: 'Approvals', ar: 'الموافقات' },
  readiness: { en: 'Readiness', ar: 'الجاهزية' },
  insights: { en: 'Insights', ar: 'الرؤى' },
  topology: { en: 'Topology', ar: 'البنية الطوبولوجية' },
  runbooks: { en: 'Runbooks', ar: 'أدلة التشغيل' },
  protect: { en: 'Protect', ar: 'الحماية' },
  rehearse: { en: 'Rehearse', ar: 'التمرين' },
  prove: { en: 'Prove', ar: 'الإثبات' },
  ledger: { en: 'Ledger', ar: 'السجل' },
  compliance: { en: 'Compliance', ar: 'الامتثال' },
  committees: { en: 'Committees', ar: 'اللجان' },
  meetings: { en: 'Meetings', ar: 'الاجتماعات' },
  'action-items': { en: 'Action Items', ar: 'بنود العمل' },
  dashboards: { en: 'Dashboards', ar: 'لوحات المعلومات' },
  reports: { en: 'Reports', ar: 'التقارير' },
};

/** Where a pathname lives inside the navigation config. */
export interface NavLocation {
  section: NavSection;
  item: NavItem;
  /** Set when the matched item is a child of an expandable group. */
  parent?: NavItem;
}

const hrefMatchesPath = (href: string, pathname: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * Longest-prefix match of a pathname against every nav item (children included).
 * Powers the breadcrumb trail (suite > section > page) and the sidebar's
 * active-section auto-expansion. Returns `null` for routes outside the config.
 */
export function findNavLocation(pathname: string | null): NavLocation | null {
  if (!pathname) return null;
  let best: NavLocation | null = null;
  let bestLength = -1;
  for (const section of navigation) {
    for (const item of section.items) {
      if (hrefMatchesPath(item.href, pathname) && item.href.length > bestLength) {
        best = { section, item };
        bestLength = item.href.length;
      }
      for (const child of item.children ?? []) {
        if (hrefMatchesPath(child.href, pathname) && child.href.length > bestLength) {
          best = { section, item: child, parent: item };
          bestLength = child.href.length;
        }
      }
    }
  }
  return best;
}

/** True when a section contains a nav item (or child) matching the pathname. */
export function sectionContainsPath(section: NavSection, pathname: string | null): boolean {
  if (!pathname) return false;
  return section.items.some(
    (item) =>
      hrefMatchesPath(item.href, pathname) ||
      (item.children ?? []).some((child) => hrefMatchesPath(child.href, pathname)),
  );
}

/**
 * Progressive-disclosure defaults: within each suite family, the first two nav
 * sections are expanded and the rest start collapsed. Label-less sections (the
 * top “main” block) and global sections (Administration, Workspace, Platform)
 * stay expanded — only multi-section suites collapse their tail. The active
 * route's section and any persisted user toggles override these defaults.
 */
export function defaultExpandedSectionIds(sections: NavSection[]): Set<string> {
  const expanded = new Set<string>();
  const perFamily = new Map<string, number>();
  const isSuite = (s: string) => (SUITE_ROUTE_SEGMENTS as readonly string[]).includes(s);
  for (const section of sections) {
    if (!section.label) {
      expanded.add(section.id);
      continue;
    }
    const family = familyOf(sectionRouteSegment(section));
    if (!isSuite(family)) {
      expanded.add(section.id);
      continue;
    }
    const seen = perFamily.get(family) ?? 0;
    perFamily.set(family, seen + 1);
    if (seen < 2) expanded.add(section.id);
  }
  return expanded;
}

/**
 * Top pages of a suite for the All-Suites launcher: the first `max`
 * permission-visible items across the suite's sections, excluding the suite
 * overview itself (the card already links there). Order follows the nav config.
 */
export function suiteQuickLinks(
  segment: string,
  hasPermission: (permission: string) => boolean,
  max = 3,
): NavItem[] {
  const family = familyOf(segment);
  const suite = SUITES.find((s) => s.segment === segment);
  const links: NavItem[] = [];
  for (const section of navigation) {
    if (familyOf(sectionRouteSegment(section)) !== family) continue;
    if (!(section.permission === '*:read' || hasPermission(section.permission))) continue;
    for (const item of filterNavItems(section.items, hasPermission)) {
      if (suite && item.href === suite.href) continue;
      if (links.some((existing) => existing.href === item.href)) continue;
      links.push(item);
      if (links.length >= max) return links;
    }
  }
  return links;
}

/* ============================================================
   WatheeqTech brand presentation helpers.
   ============================================================ */

/** Sidebar tier whose header is replaced by the WatheeqTech brand label. */
export const WATHEEQ_BRAND_TIER_ID = 'business-plus';
/** Brand label rendered instead of the Business+ tier header (both locales). */
export const WATHEEQ_BRAND_TIER_LABEL = 'وثيقتك';
/** Text under the WatheeqTech logo in WatheeqTech mode. */
export const WATHEEQ_LOGO_TAGLINE = 'Legal affairs';
/**
 * Arabic tagline under the وثيقتك lockup. Uses the client-approved term for the
 * Legal Affairs domain verbatim ("Legal Affairs — الشؤون القانونية"), so the
 * Arabic UI no longer renders the English string beneath the Arabic logo.
 */
export const WATHEEQ_LOGO_TAGLINE_AR = 'الشؤون القانونية';

/**
 * True when the sidebar should render the WatheeqTech brand experience: the
 * user is inside the /lex suite, or WatheeqTech is the only suite they can
 * access (a WatheeqTech-only tenant sees the brand everywhere, including
 * /dashboard).
 */
/**
 * True when the user's accessible suites are EXCLUSIVELY lex — i.e. a
 * Watheeq-only user. Used both for the sidebarless shell (below) and for
 * post-login routing, so such a user lands on their /lex home rather than the
 * all-suites dashboard.
 */
export function isWatheeqOnlyAccess(
  accessibleSuites: readonly SuiteEntry[],
): boolean {
  return (
    accessibleSuites.length > 0 &&
    accessibleSuites.every((suite) => suite.segment === 'lex')
  );
}

export function isWatheeqNavContext(
  segment: string,
  accessibleSuites: readonly SuiteEntry[],
): boolean {
  if (familyOf(segment) === 'lex') return true;
  return isWatheeqOnlyAccess(accessibleSuites);
}

/**
 * Watheeq-mode presentation transform, per the brand re-org spec:
 * - hide the Notebook Workspace link ("We need to hide workspace");
 * - the shared `workspace` section becomes the "Platform Core" group (the
 *   PLATFORM CORE tier header is dropped by the sidebar in this mode, so the
 *   group reads as a normal link like the rest), with its Workflows entry
 *   renamed "Workspace" (مساحة العمل).
 * Ids are swapped to Watheeq-specific ones so the message catalog can carry
 * dedicated translations without disturbing the other suites' sidebars.
 */
export function applyWatheeqNavPresentation<T extends NavSection>(
  sections: readonly T[],
): T[] {
  return sections.map((section) => {
    if (section.id === 'main') {
      return {
        ...section,
        items: section.items.filter((item) => item.id !== 'notebooks'),
      };
    }
    if (section.id === 'workspace') {
      return {
        ...section,
        id: 'watheeq-platform-core',
        label: 'Platform Core',
        items: section.items.map((item) =>
          item.id === 'admin-workflows'
            ? { ...item, id: 'watheeq-workspace', label: 'Workspace' }
            : item,
        ),
      };
    }
    return section;
  });
}
