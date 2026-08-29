/**
 * Persona nav-visibility tests for the Lex (Watheeq) granular-RBAC model.
 *
 * Source of truth: docs/ClarioWatheeq/Lex_Codebase_RBAC_Map.md §19.1 (navigation
 * visibility matrix). These tests prove that, given a role's ACTUAL granular
 * permission set (the same `CANONICAL_ROLE_PERMS` the Role Matrix renders and the
 * backend enforces), the LEX sidebar shows exactly the items the design intends —
 * and hides everything else.
 *
 * The granular `lex:<domain>:<verb>` keys reach the client via a later backend
 * slice (the current demo users have no legal roles), so this phase is verified by
 * UNIT TESTS with mocked permission sets — NOT by a running app. We drive the REAL
 * `filterNavItems` + `checkPermission` logic so the test cannot drift from the
 * shipped filter.
 */

import { describe, it, expect, vi } from 'vitest';
import { navigation, filterNavItems, SUITES } from './navigation';
import { checkPermission } from '@/stores/auth-store';
import { canAccess, LEX_ROUTE_PERMISSIONS } from '@/lib/permissions';
import { CANONICAL_PERMS_BY_CODE } from '@/app/(dashboard)/lex/admin/role-matrix/_lib/legal-role-permissions';
import type { RoleCode } from '@/app/(dashboard)/lex/admin/role-matrix/_lib/legal-role-matrix';

vi.mock('@/lib/api', () => ({
  default: {},
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

// The Watheeq suite renders as multiple lex-* group sections (sub-grouped
// sidebar IA) rather than one flat `lex` section — collect them all.
const LEX_SECTIONS = navigation.filter((section) => section.id.startsWith('lex-'));
if (LEX_SECTIONS.length === 0) throw new Error('lex nav sections missing');

/**
 * Resolve the flat list of visible LEX nav-item ids (including surviving admin
 * children) for a given permission set, using the production filter + the
 * authoritative wildcard resolver. Mirrors the sidebar end-to-end: the
 * section-level permission gate is applied first, then `filterNavItems` drops
 * items (and empty parent groups) exactly as the sidebar renders them.
 */
function visibleLexNavIds(permissions: readonly string[]): Set<string> {
  const perms = [...permissions];
  const hasPermission = (p: string) => checkPermission(perms, p);
  const ids = new Set<string>();
  const walk = (items: ReturnType<typeof filterNavItems>) => {
    for (const item of items) {
      ids.add(item.id);
      if (item.children) walk(item.children);
    }
  };
  for (const section of LEX_SECTIONS) {
    // Same section gate as the sidebar / mobile sidebar / command palette.
    if (section.permission !== '*:read' && !hasPermission(section.permission)) continue;
    walk(filterNavItems(section.items, hasPermission));
  }
  return ids;
}

/** Visible ids for a canonical role code (its real granular permission set). */
function visibleForRole(code: RoleCode): Set<string> {
  return visibleLexNavIds(CANONICAL_PERMS_BY_CODE[code]);
}

function canViewWorkflowPolicies(code: RoleCode): boolean {
  return canAccess(
    [...CANONICAL_PERMS_BY_CODE[code]],
    LEX_ROUTE_PERMISSIONS['/lex/workflow-policies'],
  );
}

describe('Lex persona nav visibility (§19.1) — granular permission sets', () => {
  describe('legal-requester (REQ)', () => {
    const ids = visibleForRole('REQ');

    it('sees the consolidated Legal Services & Requests module', () => {
      expect(ids.has('lex-legal-services')).toBe(true);
    });

    it('does NOT see Cases, Investigations, Settlements, or Admin', () => {
      expect(ids.has('lex-cases')).toBe(false);
      expect(ids.has('lex-investigations')).toBe(false);
      expect(ids.has('lex-settlements')).toBe(false);
      expect(ids.has('lex-admin')).toBe(false);
      // and no admin child leaked through the dropped parent
      expect(ids.has('lex-admin-integrations')).toBe(false);
    });
  });

  describe('legal-advisor (LA)', () => {
    const ids = visibleForRole('LA');

    it('sees Contracts, Consultations, Documents', () => {
      expect(ids.has('lex-contracts')).toBe(true);
      expect(ids.has('lex-consultations')).toBe(true);
      expect(ids.has('lex-documents')).toBe(true);
    });

    it('does NOT see Cases, Investigations, or Settlements', () => {
      expect(ids.has('lex-cases')).toBe(false);
      expect(ids.has('lex-investigations')).toBe(false);
      expect(ids.has('lex-settlements')).toBe(false);
    });
  });

  describe('legal-officer (LO)', () => {
    const ids = visibleForRole('LO');

    it('sees Cases, Investigations, Settlements, Documents', () => {
      expect(ids.has('lex-cases')).toBe(true);
      expect(ids.has('lex-investigations')).toBe(true);
      expect(ids.has('lex-settlements')).toBe(true);
      expect(ids.has('lex-documents')).toBe(true);
    });

    it('does NOT see approval queues, admin, audit, or role matrix', () => {
      // No request:approve ⇒ no approvals entry would surface; the officer has no
      // admin/audit/role keys at all.
      expect(ids.has('lex-admin')).toBe(false);
      expect(ids.has('lex-admin-integrations')).toBe(false);
      // Insight surfaces require lex:report:read, which the officer lacks.
      expect(ids.has('lex-reports')).toBe(false);
      expect(ids.has('lex-analytics')).toBe(false);
      // The officer holds no approval-policy key, so workflow policies stay hidden.
      expect(ids.has('lex-workflow-policies')).toBe(false);
    });
  });

  describe('legal-cases-manager (CSM)', () => {
    const ids = visibleForRole('CSM');

    it('sees Cases, Investigations, Settlements', () => {
      expect(ids.has('lex-cases')).toBe(true);
      expect(ids.has('lex-investigations')).toBe(true);
      expect(ids.has('lex-settlements')).toBe(true);
    });

    it('does NOT surface the legal-affairs admin group (no config keys)', () => {
      expect(ids.has('lex-admin')).toBe(false);
    });
  });

  describe('legal-contracts-manager (KSM)', () => {
    const ids = visibleForRole('KSM');

    it('sees the unified Contracts and Consultations workspace', () => {
      expect(ids.has('lex-contracts')).toBe(true);
      expect(ids.has('lex-consultations')).toBe(true);
    });

    it('does NOT see case/investigation/settlement queues', () => {
      expect(ids.has('lex-cases')).toBe(false);
      expect(ids.has('lex-investigations')).toBe(false);
      expect(ids.has('lex-settlements')).toBe(false);
    });
  });

  describe('legal-auditor (AUD)', () => {
    const ids = visibleForRole('AUD');

    it('sees Reports, Analytics, and the Role Matrix (via admin group)', () => {
      // Brand re-org: the Compliance sidebar link is out of the Watheeq IA (the
      // /lex/compliance route stays live via the lex command palette), so the
      // auditor's oversight surfaces are the Insights group + the admin group.
      expect(ids.has('lex-reports')).toBe(true); // lex:report:read
      expect(ids.has('lex-analytics-risk')).toBe(true); // lex:report:read
      // Auditor has lex:role:view + lex:catalog:view + lex:integration:read +
      // lex:security:view ⇒ the admin group's anyOf is satisfied and survives.
      expect(ids.has('lex-admin')).toBe(true);
      expect(ids.has('lex-admin-service-catalog')).toBe(true); // lex:catalog:view
    });

    it('does NOT see any mutation-only items', () => {
      // New Request / New (add) routes require :add — auditor is read-only.
      expect(ids.has('lex-service-desk-new')).toBe(false); // lex:request:add
      expect(ids.has('lex-drafting')).toBe(false); // requires an :add/:edit verb
    });
  });

  describe('legal-director (LD)', () => {
    const ids = visibleForRole('LD');

    it('has the broad command-center surface incl. admin group', () => {
      expect(ids.has('lex-cases')).toBe(true);
      expect(ids.has('lex-contracts')).toBe(true);
      expect(ids.has('lex-settlements')).toBe(true);
      expect(ids.has('lex-reports')).toBe(true); // lex:report:read
      expect(ids.has('lex-admin')).toBe(true); // many config view keys
      expect(ids.has('lex-workflow-approvals')).toBe(true); // lex:approval:admin ⊃ read
    });
  });

  describe('legal-system-admin (ADM)', () => {
    const ids = visibleForRole('ADM');

    it('sees the admin configuration group (integrations, roles, security, etc.)', () => {
      // §13 admin nav requirements accept view OR manage; ADM holds the :manage
      // keys but NOT `lex:read` — so this locks in that neither the admin-group
      // section gate nor the suite-entry gate is stricter than the item-level
      // requirements the persona actually satisfies.
      expect(ids.has('lex-overview')).toBe(true); // /lex anyOf via lex:audit:read
      expect(ids.has('lex-admin')).toBe(true);
      expect(ids.has('lex-admin-integrations')).toBe(true); // lex:integration:manage
      expect(ids.has('lex-admin-service-catalog')).toBe(true); // lex:catalog:manage
    });

    it('does NOT see operational case/contract work queues', () => {
      expect(ids.has('lex-cases')).toBe(false); // no lex:case:view
      expect(ids.has('lex-contracts')).toBe(false); // no lex:contract:view
      expect(ids.has('lex-settlements')).toBe(false); // no lex:settlement:view
      expect(ids.has('lex-service-desk')).toBe(false); // no lex:request:view
    });
  });

  describe('workflow-policy route read tier', () => {
    it('allows legal personas carrying the backend lex:read fallback to view the catalog', () => {
      for (const code of ['REQ', 'DM', 'BUC', 'CEO', 'CSM', 'KSM', 'CSV', 'KSV', 'LO', 'LA', 'SSM', 'AUD', 'LD'] as RoleCode[]) {
        expect(canViewWorkflowPolicies(code)).toBe(true);
      }
    });

    it('does not allow a persona without the backend approval-policy read tier', () => {
      expect(canViewWorkflowPolicies('ADM')).toBe(false);
    });
  });

  describe('suite switcher / launcher entry (SuiteEntry.permission, §8.1)', () => {
    const lexSuite = SUITES.find((suite) => suite.segment === 'lex');

    it('gates the Watheeq suite on the §8.1 anyOf requirement, not the bare lex:read string', () => {
      // A plain 'lex:read' string here re-introduces the ADM lockout — the
      // switcher/launcher would hide Watheeq from legal-system-admin.
      expect(lexSuite).toBeDefined();
      expect(lexSuite?.permission).toEqual(LEX_ROUTE_PERMISSIONS['/lex']);
    });

    it('shows Watheeq in the switcher/launcher to every legal persona, including legal-system-admin', () => {
      for (const code of ['REQ', 'DM', 'BUC', 'CEO', 'CSM', 'KSM', 'CSV', 'KSV', 'LO', 'LA', 'SSM', 'AUD', 'LD', 'ADM'] as RoleCode[]) {
        const perms = [...CANONICAL_PERMS_BY_CODE[code]];
        expect(canAccess(perms, lexSuite?.permission), `persona ${code} must see the Watheeq suite entry`).toBe(true);
      }
    });

    it('hides Watheeq from a user with no legal permissions at all', () => {
      expect(canAccess(['cyber:read', 'data:read'], lexSuite?.permission)).toBe(false);
    });
  });
});
