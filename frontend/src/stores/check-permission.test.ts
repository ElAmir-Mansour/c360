import { describe, expect, it } from 'vitest';
import { checkPermission } from '@/stores/auth-store';

/**
 * checkPermission must mirror the backend resolver (backend/internal/auth/
 * rbac.go — HasPermission + expandGrants) so client-side gates never disagree
 * with server authorization for raw (unexpanded) role permission sets.
 */
describe('checkPermission — wildcard semantics (existing behavior)', () => {
  it('exact match, star, prefix wildcard and action-suffix wildcard', () => {
    expect(checkPermission(['lex:case:view'], 'lex:case:view')).toBe(true);
    expect(checkPermission(['*'], 'anything:at:all')).toBe(true);
    expect(checkPermission(['lex:*'], 'lex:case:view')).toBe(true);
    expect(checkPermission(['lex:case:*'], 'lex:case:approve')).toBe(true);
    expect(checkPermission(['*:read'], 'reports:read')).toBe(true);
    expect(checkPermission([], 'lex:read')).toBe(false);
    expect(checkPermission(['lex:case:view'], 'lex:case:edit')).toBe(false);
  });
});

describe('checkPermission — lex config-domain manage implication (expandGrants rule 2)', () => {
  it.each(['sla', 'escalation', 'catalog', 'notification', 'role', 'integration', 'security'])(
    'lex:%s:manage implies the domain lower verbs',
    (domain) => {
      const lowerVerb = domain === 'integration' ? 'read' : 'view';
      expect(checkPermission([`lex:${domain}:manage`], `lex:${domain}:${lowerVerb}`)).toBe(true);
    },
  );

  it('the config-only System Administrator raw set passes read-gated admin surfaces', () => {
    // Raw (unexpanded) legal-system-admin permissions — see
    // backend/internal/auth/legal_roles.go. No :view/:read counterparts and no
    // coarse lex:read; the §13 admin surfaces must still open.
    const systemAdmin = [
      'lex:catalog:manage',
      'lex:sla:manage',
      'lex:escalation:manage',
      'lex:notification:manage',
      'lex:role:assign',
      'lex:role:manage',
      'lex:integration:manage',
      'lex:security:manage',
      'lex:audit:read',
    ];
    expect(checkPermission(systemAdmin, 'lex:integration:read')).toBe(true);
    expect(checkPermission(systemAdmin, 'lex:notification:view')).toBe(true);
    expect(checkPermission(systemAdmin, 'lex:catalog:view')).toBe(true);
    expect(checkPermission(systemAdmin, 'lex:security:view')).toBe(true);
    expect(checkPermission(systemAdmin, 'lex:role:view')).toBe(true);
    // manage on one config domain implies nothing on OTHER domains…
    expect(checkPermission(['lex:sla:manage'], 'lex:catalog:view')).toBe(false);
    // …and never the coarse keys.
    expect(checkPermission(systemAdmin, 'lex:read')).toBe(false);
    expect(checkPermission(systemAdmin, 'lex:write')).toBe(false);
  });

  it('manage implication never applies to operational (non-config) domains', () => {
    // "case" is operational — there is no lex:case:manage concept; a stray key
    // must not unlock reads.
    expect(checkPermission(['lex:case:manage'], 'lex:case:view')).toBe(false);
  });
});

describe('checkPermission — lex operational-verb ⇒ :view implication (expandGrants rule 1)', () => {
  it.each(['add', 'edit', 'approve', 'close', 'assign', 'distribute'])(
    'lex:case:%s implies lex:case:view',
    (verb) => {
      expect(checkPermission([`lex:case:${verb}`], 'lex:case:view')).toBe(true);
    },
  );

  it('operational verbs never imply each other', () => {
    expect(checkPermission(['lex:case:edit'], 'lex:case:approve')).toBe(false);
    expect(checkPermission(['lex:case:approve'], 'lex:case:close')).toBe(false);
  });

  it('does not leak across domains or to non-lex keys', () => {
    expect(checkPermission(['lex:case:edit'], 'lex:contract:view')).toBe(false);
    expect(checkPermission(['cyber:incident:edit'], 'cyber:incident:view')).toBe(false);
  });
});
