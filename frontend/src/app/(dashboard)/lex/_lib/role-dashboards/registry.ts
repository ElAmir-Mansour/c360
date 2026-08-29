/**
 * Declarative per-ROLE landing dashboard registry.
 *
 * Each legal role gets a bespoke dashboard composed from a shared widget
 * vocabulary (KPI row + list/donut/bar/alerts panels), tailored to that role's
 * duties and permissions. The `legal-dept-manager` config matches the approved
 * mockup (Total/Pending Requests, SLA Compliance, Active Litigations, Contracts
 * Under Review + recent requests, distribution donut, escalations, workload bar);
 * the other 13 reuse the same primitives with role-appropriate KPIs/panels.
 *
 * Presentation-only metadata lives here (format, href, tone rule). Human labels
 * are in `i18n.ts`; live values come from `useRoleDashboardData()`. Individual
 * KPIs/panels still self-hide when their source is ungated or empty.
 */

import type { KpiKey } from './use-role-dashboard-data';

/** How a KPI's tone (color) is derived from its live value. */
export type KpiToneKind =
  | 'neutral' // brand/ink — a plain magnitude
  | 'goodHighPct' // percent: high = good, low = bad
  | 'badWhenPositive' // a count that is a warning when > 0
  | 'criticalWhenPositive'; // a count that is serious when > 0

export interface KpiSpec {
  key: KpiKey;
  format: 'count' | 'percent';
  href: string;
  tone: KpiToneKind;
}

/** The authoritative KPI catalog (presentation metadata for every KpiKey). */
export const KPI_CATALOG: Record<KpiKey, Omit<KpiSpec, 'key'>> = {
  totalRequests: { format: 'count', href: '/lex/service-desk', tone: 'neutral' },
  pendingRequests: { format: 'count', href: '/lex/inbox', tone: 'badWhenPositive' },
  slaCompliance: { format: 'percent', href: '/lex/service-desk/sla-board', tone: 'goodHighPct' },
  activeLitigations: { format: 'count', href: '/lex/cases', tone: 'neutral' },
  contractsUnderReview: { format: 'count', href: '/lex/contracts', tone: 'neutral' },
  activeContracts: { format: 'count', href: '/lex/contracts', tone: 'neutral' },
  openMatters: { format: 'count', href: '/lex/matters', tone: 'neutral' },
  overdueObligations: { format: 'count', href: '/lex/obligations', tone: 'badWhenPositive' },
  pendingApprovals: { format: 'count', href: '/lex/inbox', tone: 'badWhenPositive' },
  slaBreaches: { format: 'count', href: '/lex/service-desk/sla-board', tone: 'criticalWhenPositive' },
  openAlerts: { format: 'count', href: '/lex/compliance', tone: 'badWhenPositive' },
  complianceScore: { format: 'percent', href: '/lex/compliance', tone: 'goodHighPct' },
  consultations: { format: 'count', href: '/lex/consultations', tone: 'neutral' },
  investigations: { format: 'count', href: '/lex/investigations', tone: 'neutral' },
  settlements: { format: 'count', href: '/lex/settlements', tone: 'neutral' },
  expiringContracts: { format: 'count', href: '/lex/contracts', tone: 'badWhenPositive' },
  highRiskContracts: { format: 'count', href: '/lex/contracts', tone: 'criticalWhenPositive' },
  myOpenItems: { format: 'count', href: '/lex', tone: 'neutral' },
};

/** A panel in a role dashboard body column. `titleKey` resolves via i18n. */
export type WidgetSpec =
  | { kind: 'listPanel'; source: 'recentRequests' | 'myWork'; titleKey: string; viewAllHref?: string }
  | { kind: 'donut'; titleKey: string }
  | { kind: 'barChart'; source: 'workloadByArea' | 'contractStatusMix' | 'resolutionRates'; titleKey: string }
  | { kind: 'alertsFeed'; titleKey: string }
  | { kind: 'domainNav'; titleKey: string }
  | { kind: 'decisionQueue'; titleKey: string }
  | { kind: 'teamPerformance'; titleKey: string }
  | { kind: 'managerTasks'; titleKey: string };

export interface RoleDashboardConfig {
  /** i18n keys for the welcome hero. */
  eyebrowKey: string;
  subtitleKey: string;
  /** Top KPI row (rendered up to 5 wide). */
  kpis: KpiKey[];
  /** Two-column body: left is the wider column. */
  left: WidgetSpec[];
  right: WidgetSpec[];
  /** Full-width sections rendered below the two-column body. */
  full?: WidgetSpec[];
}

// Reusable panel specs -------------------------------------------------------
const RECENT_REQUESTS: WidgetSpec = {
  kind: 'listPanel',
  source: 'recentRequests',
  titleKey: 'panel.recentRequests',
  viewAllHref: '/lex/service-desk',
};
const MY_WORK: WidgetSpec = {
  kind: 'listPanel',
  source: 'myWork',
  titleKey: 'panel.myWork',
  viewAllHref: '/lex',
};
const ESCALATIONS: WidgetSpec = { kind: 'alertsFeed', titleKey: 'panel.escalations' };
const DISTRIBUTION: WidgetSpec = { kind: 'donut', titleKey: 'panel.distribution' };
const WORKLOAD: WidgetSpec = { kind: 'barChart', source: 'workloadByArea', titleKey: 'panel.workload' };
const CONTRACT_MIX: WidgetSpec = { kind: 'barChart', source: 'contractStatusMix', titleKey: 'panel.contractMix' };
const RESOLUTION: WidgetSpec = { kind: 'barChart', source: 'resolutionRates', titleKey: 'panel.resolutionRates' };
const TEAM_PERFORMANCE: WidgetSpec = {
  kind: 'teamPerformance',
  titleKey: 'panel.teamPerformance',
};
const DECISION_QUEUE: WidgetSpec = {
  kind: 'decisionQueue',
  titleKey: 'panel.pendingDecisions',
};
/**
 * Ad-hoc task board. Self-hides for a role that can neither assign nor receive
 * a task, and the server scopes the rows — a section manager or supervisor sees
 * only what they assigned or were assigned, never the department's whole board.
 */
const MANAGER_TASKS: WidgetSpec = {
  kind: 'managerTasks',
  titleKey: 'panel.managerTasks',
};

/** Full-width legal-domain navigation, folded into every role dashboard. */
const DOMAIN_NAV: WidgetSpec = { kind: 'domainNav', titleKey: 'panel.domains' };
/** Default full-width sections appended below the two-column body of every role. */
export const DEFAULT_FULL_WIDTH: WidgetSpec[] = [DOMAIN_NAV];

/**
 * Per-role dashboards. Keys are the canonical hyphenated legal role slugs; a
 * role without an entry falls back to GENERIC_DASHBOARD.
 */
export const ROLE_DASHBOARDS: Record<string, RoleDashboardConfig> = {
  // The approved mockup.
  'legal-dept-manager': {
    eyebrowKey: 'role.legal-dept-manager',
    subtitleKey: 'subtitle.manager',
    kpis: ['totalRequests', 'pendingRequests', 'slaCompliance', 'activeLitigations', 'contractsUnderReview'],
    left: [RECENT_REQUESTS, ESCALATIONS],
    right: [DISTRIBUTION, RESOLUTION],
  },

  'legal-requester': {
    eyebrowKey: 'role.legal-requester',
    subtitleKey: 'subtitle.requester',
    kpis: ['myOpenItems', 'pendingRequests', 'slaCompliance', 'totalRequests'],
    left: [MY_WORK, RECENT_REQUESTS],
    right: [DISTRIBUTION, WORKLOAD],
    // A business requester is not a legal-team member: suppress the full
    // legal-domain command-center grid (litigation, matters, investigations,
    // clause library, playbooks, administration, …). Their dashboard stays
    // focused on their own requests, tasks and SLA. `full: []` overrides the
    // DEFAULT_FULL_WIDTH domain grid folded into every other role.
    full: [],
  },

  'legal-bu-ceo': {
    eyebrowKey: 'role.legal-bu-ceo',
    subtitleKey: 'subtitle.executive',
    kpis: ['pendingApprovals', 'activeContracts', 'activeLitigations', 'openMatters', 'complianceScore'],
    left: [ESCALATIONS, RECENT_REQUESTS],
    right: [DISTRIBUTION, RESOLUTION],
  },
  'legal-ceo': {
    eyebrowKey: 'role.legal-ceo',
    subtitleKey: 'subtitle.executive',
    kpis: ['pendingApprovals', 'activeContracts', 'activeLitigations', 'openMatters', 'complianceScore'],
    left: [ESCALATIONS, RECENT_REQUESTS],
    right: [DISTRIBUTION, RESOLUTION],
  },

  'legal-director': {
    eyebrowKey: 'role.legal-director',
    subtitleKey: 'subtitle.director',
    kpis: ['openMatters', 'activeContracts', 'activeLitigations', 'pendingApprovals', 'complianceScore'],
    left: [ESCALATIONS, RECENT_REQUESTS],
    right: [DISTRIBUTION, RESOLUTION, TEAM_PERFORMANCE],
  },

  'legal-cases-manager': {
    eyebrowKey: 'role.legal-cases-manager',
    subtitleKey: 'subtitle.cases',
    kpis: ['activeLitigations', 'investigations', 'settlements', 'pendingApprovals', 'slaCompliance'],
    left: [DECISION_QUEUE, ESCALATIONS, MANAGER_TASKS, MY_WORK],
    right: [DISTRIBUTION, WORKLOAD],
  },
  'legal-case-supervisor': {
    eyebrowKey: 'role.legal-case-supervisor',
    subtitleKey: 'subtitle.cases',
    kpis: ['activeLitigations', 'investigations', 'settlements', 'myOpenItems', 'slaCompliance'],
    left: [MY_WORK, MANAGER_TASKS, ESCALATIONS],
    right: [DISTRIBUTION, WORKLOAD],
  },

  'legal-contracts-manager': {
    eyebrowKey: 'role.legal-contracts-manager',
    subtitleKey: 'subtitle.contracts',
    // Keep every headline statistic inside the manager's two owned domains.
    // The canonical live dashboard is `/lex/contracts/control`; this fallback
    // landing therefore mirrors its contract + consultation scope and never
    // leaks case, settlement, obligation, or compliance portfolio totals.
    kpis: [
      'activeContracts',
      'contractsUnderReview',
      'expiringContracts',
      'highRiskContracts',
      'consultations',
    ],
    left: [MANAGER_TASKS, MY_WORK],
    right: [CONTRACT_MIX],
  },
  'legal-contracts-supervisor': {
    eyebrowKey: 'role.legal-contracts-supervisor',
    subtitleKey: 'subtitle.contracts',
    kpis: ['activeContracts', 'contractsUnderReview', 'expiringContracts', 'overdueObligations', 'myOpenItems'],
    left: [MY_WORK, MANAGER_TASKS, ESCALATIONS],
    right: [DISTRIBUTION, CONTRACT_MIX],
  },

  'legal-officer': {
    eyebrowKey: 'role.legal-officer',
    subtitleKey: 'subtitle.officer',
    kpis: ['myOpenItems', 'activeLitigations', 'consultations', 'pendingRequests', 'slaBreaches'],
    left: [MY_WORK, ESCALATIONS],
    right: [DISTRIBUTION, WORKLOAD],
  },

  'legal-advisor': {
    eyebrowKey: 'role.legal-advisor',
    subtitleKey: 'subtitle.advisor',
    kpis: ['consultations', 'myOpenItems', 'pendingRequests', 'openMatters', 'slaCompliance'],
    left: [MY_WORK, RECENT_REQUESTS],
    right: [DISTRIBUTION, WORKLOAD],
  },

  'legal-shared-services-manager': {
    eyebrowKey: 'role.legal-shared-services-manager',
    subtitleKey: 'subtitle.oversight',
    kpis: ['totalRequests', 'slaCompliance', 'pendingApprovals', 'overdueObligations', 'openAlerts'],
    left: [ESCALATIONS, MANAGER_TASKS, RECENT_REQUESTS],
    right: [DISTRIBUTION, RESOLUTION],
  },

  'legal-auditor': {
    eyebrowKey: 'role.legal-auditor',
    subtitleKey: 'subtitle.auditor',
    kpis: ['complianceScore', 'openAlerts', 'overdueObligations', 'highRiskContracts', 'slaBreaches'],
    left: [ESCALATIONS, RECENT_REQUESTS],
    right: [DISTRIBUTION, RESOLUTION],
  },

  'legal-system-admin': {
    eyebrowKey: 'role.legal-system-admin',
    subtitleKey: 'subtitle.admin',
    kpis: ['totalRequests', 'activeContracts', 'activeLitigations', 'pendingApprovals', 'openAlerts'],
    left: [ESCALATIONS, RECENT_REQUESTS],
    right: [DISTRIBUTION, WORKLOAD],
  },
};

export const GENERIC_DASHBOARD: RoleDashboardConfig = {
  eyebrowKey: 'role.generic',
  subtitleKey: 'subtitle.generic',
  kpis: ['openMatters', 'activeContracts', 'activeLitigations', 'pendingApprovals', 'complianceScore'],
  left: [ESCALATIONS, RECENT_REQUESTS],
  right: [DISTRIBUTION, WORKLOAD],
};

/** Resolve the dashboard config for a role slug (hyphen or underscore form). */
export function dashboardConfigForRole(roleSlug: string | null | undefined): RoleDashboardConfig {
  if (!roleSlug) return GENERIC_DASHBOARD;
  const normalized = roleSlug.replace(/_/g, '-');
  return ROLE_DASHBOARDS[normalized] ?? GENERIC_DASHBOARD;
}
