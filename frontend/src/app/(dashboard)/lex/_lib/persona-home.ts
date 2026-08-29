/**
 * Persona-home configuration (§5 / §10) — maps each legal role to the PRIMARY
 * modules it should reach in one click from the `/lex` home, plus which
 * command-center sections are relevant for that persona.
 *
 * The `/lex` page branches on the active persona using this config:
 *   - requester  → request-centric quick links
 *   - officer    → my-work quick links
 *   - director   → cross-domain command center
 *   - auditor    → compliance / audit
 *   - admin      → configuration
 *
 * Every quick-link `href` is a KNOWN-EXISTING lex route (validated against
 * persona-landing.ts's allow-list at build-of-this-list time), and each carries
 * a granular permission so a card the persona cannot use is filtered out — the
 * page is therefore always safe even if the role→module mapping drifts.
 *
 * This is a pure data module (no React) so it is unit-testable offline.
 */

import type { PermissionRequirement } from '@/lib/permissions';

/** Which broad command-center widget set a persona's home leads with (§10). */
export type PersonaHomeVariant =
  | 'requester'
  | 'approver'
  | 'director'
  | 'cases'
  | 'contracts'
  | 'officer'
  | 'advisor'
  | 'oversight'
  | 'auditor'
  | 'admin'
  | 'generic';

/** A single primary-module quick link on the persona home. */
export interface PersonaQuickLink {
  /** Stable id; also the i18n leaf into the persona-home label bundle. */
  id: string;
  href: string;
  /** Granular permission gating the card (filtered via canAccessWith). */
  permission: PermissionRequirement;
}

/** A persona-home definition: its variant + its ordered primary modules. */
export interface PersonaHome {
  variant: PersonaHomeVariant;
  quickLinks: PersonaQuickLink[];
}

/* ---- Reusable quick-link atoms (one per known-existing route) ------------- */

const QL = {
  myRequests: { id: 'my_requests', href: '/lex/service-desk', permission: 'lex:request:view' },
  newRequest: { id: 'new_request', href: '/lex/service-desk/new', permission: 'lex:request:add' },
  requestApprovals: {
    id: 'request_approvals',
    href: '/lex/inbox',
    permission: 'lex:request:approve',
  },
  cases: { id: 'cases', href: '/lex/cases', permission: 'lex:case:view' },
  investigations: {
    id: 'investigations',
    href: '/lex/investigations',
    permission: 'lex:investigation:view',
  },
  settlements: { id: 'settlements', href: '/lex/settlements', permission: 'lex:settlement:view' },
  contracts: { id: 'contracts', href: '/lex/contracts', permission: 'lex:contract:view' },
  consultations: {
    id: 'consultations',
    href: '/lex/consultations',
    permission: 'lex:consultation:view',
  },
  documents: { id: 'documents', href: '/lex/documents', permission: 'lex:document:view' },
  drafting: {
    id: 'drafting',
    href: '/lex/drafting',
    permission: {
      anyOf: [
        'lex:document:add',
        'lex:document:edit',
        'lex:contract:add',
        'lex:contract:edit',
        'lex:consultation:add',
        'lex:consultation:edit',
      ],
    } as PermissionRequirement,
  },
  clauseLibrary: {
    id: 'clause_library',
    href: '/lex/clause-library',
    permission: { anyOf: ['lex:catalog:view', 'lex:contract:view'] } as PermissionRequirement,
  },
  playbooks: {
    id: 'playbooks',
    href: '/lex/playbooks',
    permission: { anyOf: ['lex:catalog:view', 'lex:document:view'] } as PermissionRequirement,
  },
  reports: { id: 'reports', href: '/lex/reports', permission: 'lex:report:read' },
  analytics: { id: 'analytics', href: '/lex/analytics', permission: 'lex:report:read' },
  riskAnalytics: {
    id: 'risk_analytics',
    href: '/lex/analytics/risk',
    permission: { anyOf: ['lex:report:read', 'lex:audit:read'] } as PermissionRequirement,
  },
  compliance: { id: 'compliance', href: '/lex/compliance', permission: 'lex:audit:read' },
  entities: {
    id: 'entities',
    href: '/lex/entities',
    permission: { anyOf: ['lex:report:read', 'lex:audit:read'] } as PermissionRequirement,
  },
  calendar: {
    id: 'calendar',
    href: '/lex/calendar',
    permission: {
      anyOf: ['lex:request:view', 'lex:case:view', 'lex:contract:view', 'lex:consultation:view'],
    } as PermissionRequirement,
  },
  inbox: {
    id: 'inbox',
    href: '/lex/inbox',
    permission: {
      anyOf: ['lex:request:view', 'lex:case:view', 'lex:contract:view', 'lex:consultation:view'],
    } as PermissionRequirement,
  },
  admin: {
    id: 'admin',
    href: '/lex/admin',
    permission: {
      anyOf: [
        'lex:catalog:view',
        'lex:catalog:manage',
        'lex:sla:view',
        'lex:sla:manage',
        'lex:escalation:view',
        'lex:escalation:manage',
        'lex:notification:view',
        'lex:notification:manage',
        'lex:role:view',
        'lex:role:assign',
        'lex:role:manage',
        'lex:integration:read',
        'lex:integration:manage',
        'lex:security:view',
        'lex:security:manage',
        'lex:approval:read',
        'lex:approval:admin',
      ],
    } as PermissionRequirement,
  },
} satisfies Record<string, PersonaQuickLink>;

/**
 * Role → persona home. A role NOT in this map falls back to {@link GENERIC_HOME}
 * (which surfaces every quick link the user is permitted to see), so an unknown
 * or newly-added role still gets a usable, permission-filtered home.
 */
export const PERSONA_HOME_BY_ROLE: Record<string, PersonaHome> = {
  'legal-requester': {
    variant: 'requester',
    quickLinks: [QL.newRequest, QL.myRequests, QL.documents, QL.consultations, QL.contracts, QL.calendar],
  },
  'legal-dept-manager': {
    variant: 'approver',
    quickLinks: [QL.requestApprovals, QL.myRequests, QL.contracts, QL.cases, QL.documents, QL.inbox],
  },
  'legal-bu-ceo': {
    variant: 'approver',
    quickLinks: [QL.requestApprovals, QL.cases, QL.contracts, QL.analytics, QL.reports],
  },
  'legal-ceo': {
    variant: 'approver',
    quickLinks: [QL.requestApprovals, QL.cases, QL.contracts, QL.analytics, QL.reports],
  },
  'legal-director': {
    variant: 'director',
    quickLinks: [QL.cases, QL.contracts, QL.requestApprovals, QL.compliance, QL.analytics, QL.admin],
  },
  'legal-cases-manager': {
    variant: 'cases',
    quickLinks: [QL.cases, QL.investigations, QL.settlements, QL.requestApprovals, QL.analytics],
  },
  'legal-contracts-manager': {
    variant: 'contracts',
    quickLinks: [QL.contracts, QL.clauseLibrary, QL.drafting, QL.analytics, QL.reports],
  },
  'legal-case-supervisor': {
    variant: 'cases',
    quickLinks: [QL.cases, QL.investigations, QL.settlements, QL.requestApprovals, QL.inbox],
  },
  'legal-contracts-supervisor': {
    variant: 'contracts',
    quickLinks: [QL.contracts, QL.drafting, QL.clauseLibrary, QL.documents, QL.inbox],
  },
  'legal-officer': {
    variant: 'officer',
    quickLinks: [QL.cases, QL.investigations, QL.settlements, QL.documents, QL.inbox, QL.calendar],
  },
  'legal-advisor': {
    variant: 'advisor',
    quickLinks: [QL.consultations, QL.contracts, QL.documents, QL.clauseLibrary, QL.playbooks, QL.drafting],
  },
  'legal-shared-services-manager': {
    variant: 'oversight',
    quickLinks: [QL.compliance, QL.analytics, QL.riskAnalytics, QL.reports, QL.entities],
  },
  'legal-auditor': {
    variant: 'auditor',
    quickLinks: [QL.compliance, QL.reports, QL.analytics, QL.riskAnalytics, QL.entities],
  },
  'legal-system-admin': {
    variant: 'admin',
    quickLinks: [QL.admin, QL.inbox],
  },
};

/**
 * Fallback home for a user with no recognised persona (or no active role) —
 * surfaces a broad set of quick links; each is permission-gated so only the
 * usable ones render. Also used by the §8.1 coarse-`lex:read` compatibility path.
 */
export const GENERIC_HOME: PersonaHome = {
  variant: 'generic',
  quickLinks: [
    QL.cases,
    QL.contracts,
    QL.myRequests,
    QL.consultations,
    QL.documents,
    QL.compliance,
    QL.analytics,
    QL.admin,
  ],
};

/** Resolve the persona home for an active role slug (null ⇒ generic). */
export function personaHomeForRole(roleSlug: string | null | undefined): PersonaHome {
  if (!roleSlug) return GENERIC_HOME;
  return PERSONA_HOME_BY_ROLE[roleSlug] ?? GENERIC_HOME;
}

/**
 * Which command-center sections a persona variant should render below its quick
 * links (§10). Personas with a cross-domain mandate (director/oversight/auditor)
 * get the full KPI + needs-attention + analytics picture; operational personas
 * get a focused "my work" surface; requesters get the lightest surface.
 */
export interface PersonaSections {
  crossDomainKpis: boolean;
  domainTiles: boolean;
  needsAttention: boolean;
  myWork: boolean;
  contractAnalytics: boolean;
}

export function personaSectionsForVariant(variant: PersonaHomeVariant): PersonaSections {
  switch (variant) {
    case 'director':
      return {
        crossDomainKpis: true,
        domainTiles: true,
        needsAttention: true,
        myWork: true,
        contractAnalytics: true,
      };
    case 'oversight':
    case 'auditor':
      return {
        crossDomainKpis: true,
        domainTiles: true,
        needsAttention: true,
        myWork: false,
        contractAnalytics: false,
      };
    case 'cases':
    case 'contracts':
    case 'approver':
      return {
        crossDomainKpis: true,
        domainTiles: false,
        needsAttention: true,
        myWork: true,
        contractAnalytics: variant === 'contracts',
      };
    case 'officer':
    case 'advisor':
      return {
        crossDomainKpis: false,
        domainTiles: false,
        needsAttention: false,
        myWork: true,
        contractAnalytics: false,
      };
    case 'requester':
      return {
        crossDomainKpis: false,
        domainTiles: false,
        needsAttention: false,
        myWork: true,
        contractAnalytics: false,
      };
    case 'admin':
      return {
        crossDomainKpis: false,
        domainTiles: false,
        needsAttention: false,
        myWork: false,
        contractAnalytics: false,
      };
    case 'generic':
    default:
      return {
        crossDomainKpis: true,
        domainTiles: true,
        needsAttention: true,
        myWork: true,
        contractAnalytics: true,
      };
  }
}
