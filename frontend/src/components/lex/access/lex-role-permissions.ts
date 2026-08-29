/**
 * Frontend mirror of the 14 legal-affairs role permission sets, used ONLY to
 * power the §15 "another assigned persona can access this" UX hint on the
 * access-denied page. The backend (internal/auth/legal_roles.go) is the single
 * authoritative source; this is a usability convenience so we can tell the user
 * "Switch to <role> to continue" WITHOUT a second round-trip per candidate role.
 *
 * The `/api/v1/lex/me` response only carries `effective_permissions` for the
 * ACTIVE role plus the names/slugs of the available roles — not each available
 * role's permission set — so this map fills that gap for the hint. If a slug is
 * unknown here, the candidate is still offered (with no precise grant claim),
 * and the backend persona switch + route guard remain the real boundary.
 *
 * Transcribed verbatim from backend/internal/auth/legal_roles.go LegalAffairsRoleDefs.
 */

export const LEX_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  'legal-requester': [
    'lex:support:view', 'lex:support:create',
    'lex:request:view', 'lex:request:add', 'lex:request:edit',
    'lex:contract:view', 'lex:contract:add',
    'lex:consultation:view', 'lex:consultation:add',
    'lex:document:view', 'lex:document:add',
    'lex:report:read',
    'lex:read',
  ],
  'legal-dept-manager': [
    'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve',
    'lex:case:view', 'lex:case:add',
    'lex:consultation:view', 'lex:consultation:add',
    'lex:contract:view', 'lex:contract:add', 'lex:contract:edit',
    'lex:document:add',
    'lex:report:read',
    'lex:read',
  ],
  'legal-bu-ceo': [
    'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve',
    'lex:case:view',
    'lex:contract:view',
    'lex:document:view',
    'lex:report:read',
    'lex:read',
  ],
  'legal-ceo': [
    'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve',
    'lex:case:view', 'lex:case:add',
    'lex:contract:view',
    'lex:report:read',
    'lex:read',
  ],
  'legal-director': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
    'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve', 'lex:request:close',
    'lex:case:view', 'lex:case:add', 'lex:case:edit', 'lex:case:assign', 'lex:case:approve', 'lex:case:close',
    'lex:investigation:view', 'lex:investigation:add', 'lex:investigation:edit', 'lex:investigation:approve', 'lex:investigation:close',
    'lex:settlement:view', 'lex:settlement:add', 'lex:settlement:edit', 'lex:settlement:approve', 'lex:settlement:close',
    'lex:contract:view', 'lex:contract:add', 'lex:contract:edit', 'lex:contract:distribute', 'lex:contract:approve', 'lex:contract:close',
    'lex:consultation:view', 'lex:consultation:add', 'lex:consultation:edit', 'lex:consultation:approve', 'lex:consultation:close',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:notification:edit',
    'lex:report:read',
    'lex:sla:manage', 'lex:escalation:manage', 'lex:catalog:manage',
    'lex:role:view',
    'lex:audit:read', 'lex:integration:read', 'lex:security:view',
    'lex:approval:admin',
    'lex:read', 'lex:write',
  ],
  'legal-cases-manager': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
    'lex:request:view', 'lex:request:edit', 'lex:request:approve',
    'lex:case:view', 'lex:case:add', 'lex:case:edit', 'lex:case:assign', 'lex:case:approve', 'lex:case:close',
    'lex:investigation:view', 'lex:investigation:approve', 'lex:investigation:close',
    'lex:settlement:view', 'lex:settlement:approve', 'lex:settlement:close',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:report:read',
    'lex:read', 'lex:write',
  ],
  'legal-contracts-manager': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
    'lex:request:view', 'lex:request:approve',
    'lex:contract:view', 'lex:contract:add', 'lex:contract:edit', 'lex:contract:distribute', 'lex:contract:approve', 'lex:contract:close',
    'lex:consultation:view', 'lex:consultation:add', 'lex:consultation:edit', 'lex:consultation:approve', 'lex:consultation:close',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:report:read',
    'lex:read', 'lex:write',
  ],
  'legal-case-supervisor': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
    'lex:request:view', 'lex:request:approve',
    'lex:case:view', 'lex:case:edit', 'lex:case:approve',
    'lex:investigation:view', 'lex:investigation:edit',
    'lex:settlement:view', 'lex:settlement:edit',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:read', 'lex:write',
  ],
  'legal-contracts-supervisor': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
    'lex:request:view', 'lex:request:approve',
    'lex:contract:view', 'lex:contract:add', 'lex:contract:edit', 'lex:contract:distribute',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:read', 'lex:write',
  ],
  'legal-officer': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond',
    'lex:request:view', 'lex:request:edit',
    'lex:case:view', 'lex:case:add', 'lex:case:edit',
    'lex:investigation:view', 'lex:investigation:add', 'lex:investigation:edit',
    'lex:settlement:view', 'lex:settlement:add', 'lex:settlement:edit',
    'lex:consultation:view',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:read', 'lex:write',
  ],
  'legal-advisor': [
    'lex:support:view', 'lex:support:create', 'lex:support:respond',
    'lex:contract:view', 'lex:contract:add', 'lex:contract:edit',
    'lex:consultation:view', 'lex:consultation:add', 'lex:consultation:edit',
    'lex:request:view',
    'lex:document:view', 'lex:document:add', 'lex:document:edit',
    'lex:report:read',
    'lex:read', 'lex:write',
  ],
  'legal-shared-services-manager': [
    'lex:request:view',
    'lex:case:view',
    'lex:investigation:view',
    'lex:settlement:view',
    'lex:contract:view',
    'lex:consultation:view',
    'lex:sla:view', 'lex:escalation:view',
    'lex:report:read', 'lex:audit:read',
    'lex:read',
  ],
  'legal-auditor': [
    'lex:request:view',
    'lex:case:view',
    'lex:investigation:view',
    'lex:settlement:view',
    'lex:contract:view',
    'lex:consultation:view',
    'lex:document:view',
    'lex:report:read', 'lex:audit:read',
    'lex:catalog:view', 'lex:role:view',
    'lex:integration:read', 'lex:security:view',
    'lex:read',
  ],
  'legal-system-admin': [
    'lex:catalog:manage',
    'lex:sla:manage', 'lex:escalation:manage',
    'lex:notification:manage',
    'lex:role:assign', 'lex:role:manage',
    'lex:integration:manage',
    'lex:security:manage',
    'lex:audit:read',
  ],
};
