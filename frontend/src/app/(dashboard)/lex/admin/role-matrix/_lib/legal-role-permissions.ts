/**
 * Legal Role Matrix — SINGLE SOURCE OF TRUTH for the 14 roles' permission sets.
 *
 * This file is the frontend mirror of the SERVER-ENFORCED role definitions
 * (`backend/internal/auth/legal_roles.go` → `LegalAffairsRoleDefs`). Permission
 * resolution in the platform is 100% code-map driven: the JWT carries role
 * SLUGS and `HasPermission` looks each slug up in `RolePermissions`, which is
 * folded from `LegalAffairsRoleDefs`. So the arrays below are EXACTLY the keys
 * the backend honours per role, transcribed verbatim (design v2 §3, with verbs
 * as INDEPENDENT flags — nothing rounded up to "highest authority per domain").
 *
 * Per design v2 §6, the read-only Legal Role Matrix grid renders from these
 * sets — the SAME data the server enforces — instead of a divorced, hand-drawn
 * cell fixture. The grid additionally fetches the seeded roles from
 * `/api/v1/roles` (the rows the `LegalAffairsRoleSeeder` upserts into
 * `platform_core.roles`) and reconciles them against `CANONICAL_ROLE_PERMS`, so
 * any drift between the doc, this source, and the live tenant is VISIBLE in
 * product (see `diffRolePermissions`).
 *
 * The verb cells the grid paints are DERIVED from these key sets by
 * `deriveDomainVerbs` (lex:<domain>:<verb> → V/A/E/P/C/M), so the matrix can no
 * longer drift from the permissions silently.
 */

import type { MatrixVerb, RoleCode } from './legal-role-matrix';

/* -------------------------------------------------------------------------- */
/* Permission-key catalogue (mirrors backend/internal/auth/rbac.go)           */
/* -------------------------------------------------------------------------- */

/** Coarse cross-cutting lex keys (kept as migration fallbacks server-side). */
const LEX_READ = 'lex:read';
const LEX_WRITE = 'lex:write';

/**
 * The role → permission-key sets, transcribed verbatim from
 * `LegalAffairsRoleDefs` (backend). Keyed by the matrix RoleCode; each entry's
 * `slug` matches `platform_core.roles.slug` so the runtime reconciliation can
 * line fetched rows up by slug.
 */
export interface CanonicalRolePerms {
  code: RoleCode;
  slug: string;
  /** The exact permission keys the server resolves for this role. */
  permissions: readonly string[];
}

export const CANONICAL_ROLE_PERMS: readonly CanonicalRolePerms[] = [
  {
    code: 'REQ',
    slug: 'legal-requester',
    permissions: [
      'lex:support:view', 'lex:support:create',
      'lex:request:view', 'lex:request:add', 'lex:request:edit',
      'lex:contract:view', 'lex:contract:add',
      'lex:consultation:view', 'lex:consultation:add',
      'lex:document:view', 'lex:document:add',
      'lex:report:read',
      LEX_READ,
    ],
  },
  {
    code: 'DM',
    slug: 'legal-dept-manager',
    permissions: [
      'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve',
      'lex:case:view', 'lex:case:add',
      'lex:consultation:view', 'lex:consultation:add',
      'lex:contract:view', 'lex:contract:add', 'lex:contract:edit',
      'lex:document:add',
      'lex:report:read',
      LEX_READ,
    ],
  },
  {
    code: 'BUC',
    slug: 'legal-bu-ceo',
    permissions: [
      'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve',
      'lex:case:view',
      'lex:contract:view',
      'lex:document:view',
      'lex:report:read',
      LEX_READ,
    ],
  },
  {
    code: 'CEO',
    slug: 'legal-ceo',
    permissions: [
      'lex:request:view', 'lex:request:add', 'lex:request:edit', 'lex:request:approve',
      'lex:case:view', 'lex:case:add',
      'lex:contract:view',
      'lex:report:read',
      LEX_READ,
    ],
  },
  {
    code: 'LD',
    slug: 'legal-director',
    permissions: [
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
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'CSM',
    slug: 'legal-cases-manager',
    permissions: [
      'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
      'lex:request:view', 'lex:request:edit', 'lex:request:approve',
      'lex:case:view', 'lex:case:add', 'lex:case:edit', 'lex:case:assign', 'lex:case:approve', 'lex:case:close',
      'lex:investigation:view', 'lex:investigation:approve', 'lex:investigation:close',
      'lex:settlement:view', 'lex:settlement:approve', 'lex:settlement:close',
      'lex:document:view', 'lex:document:add', 'lex:document:edit',
      'lex:report:read',
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'KSM',
    slug: 'legal-contracts-manager',
    permissions: [
      'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
      'lex:request:view', 'lex:request:approve',
      'lex:contract:view', 'lex:contract:add', 'lex:contract:edit', 'lex:contract:distribute', 'lex:contract:approve', 'lex:contract:close',
      'lex:consultation:view', 'lex:consultation:add', 'lex:consultation:edit', 'lex:consultation:approve', 'lex:consultation:close',
      'lex:document:view', 'lex:document:add', 'lex:document:edit',
      'lex:report:read',
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'CSV',
    slug: 'legal-case-supervisor',
    permissions: [
      'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
      'lex:request:view', 'lex:request:approve',
      'lex:case:view', 'lex:case:edit', 'lex:case:approve',
      'lex:investigation:view', 'lex:investigation:edit',
      'lex:settlement:view', 'lex:settlement:edit',
      'lex:document:view', 'lex:document:add', 'lex:document:edit',
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'KSV',
    slug: 'legal-contracts-supervisor',
    permissions: [
      'lex:support:view', 'lex:support:create', 'lex:support:respond', 'lex:support:oversee',
      'lex:request:view', 'lex:request:approve',
      'lex:contract:view', 'lex:contract:add', 'lex:contract:edit', 'lex:contract:distribute',
      'lex:document:view', 'lex:document:add', 'lex:document:edit',
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'LO',
    slug: 'legal-officer',
    permissions: [
      'lex:support:view', 'lex:support:create', 'lex:support:respond',
      'lex:request:view', 'lex:request:edit',
      'lex:case:view', 'lex:case:add', 'lex:case:edit',
      'lex:investigation:view', 'lex:investigation:add', 'lex:investigation:edit',
      'lex:settlement:view', 'lex:settlement:add', 'lex:settlement:edit',
      'lex:consultation:view',
      'lex:document:view', 'lex:document:add', 'lex:document:edit',
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'LA',
    slug: 'legal-advisor',
    permissions: [
      'lex:support:view', 'lex:support:create', 'lex:support:respond',
      'lex:contract:view', 'lex:contract:add', 'lex:contract:edit',
      'lex:consultation:view', 'lex:consultation:add', 'lex:consultation:edit',
      'lex:request:view',
      'lex:document:view', 'lex:document:add', 'lex:document:edit',
      'lex:report:read',
      LEX_READ, LEX_WRITE,
    ],
  },
  {
    code: 'SSM',
    slug: 'legal-shared-services-manager',
    permissions: [
      'lex:request:view',
      'lex:case:view',
      'lex:investigation:view',
      'lex:settlement:view',
      'lex:contract:view',
      'lex:consultation:view',
      'lex:sla:view', 'lex:escalation:view',
      'lex:report:read', 'lex:audit:read',
      LEX_READ,
    ],
  },
  {
    code: 'AUD',
    slug: 'legal-auditor',
    permissions: [
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
      LEX_READ,
    ],
  },
  {
    code: 'ADM',
    slug: 'legal-system-admin',
    permissions: [
      'lex:catalog:manage',
      'lex:sla:manage', 'lex:escalation:manage',
      'lex:notification:manage',
      'lex:role:assign', 'lex:role:manage',
      'lex:integration:manage',
      'lex:security:manage',
      'lex:audit:read',
    ],
  },
];

/** Quick lookup of the canonical permission set by role code. */
export const CANONICAL_PERMS_BY_CODE: Readonly<Record<RoleCode, readonly string[]>> =
  Object.fromEntries(
    CANONICAL_ROLE_PERMS.map((r) => [r.code, r.permissions]),
  ) as Record<RoleCode, readonly string[]>;

/** Slug → role code, to line up fetched `/api/v1/roles` rows with the matrix. */
export const CODE_BY_SLUG: Readonly<Record<string, RoleCode>> = Object.fromEntries(
  CANONICAL_ROLE_PERMS.map((r) => [r.slug, r.code]),
) as Record<string, RoleCode>;

/* -------------------------------------------------------------------------- */
/* Domain → verb derivation (lex:<domain>:<verb> → matrix V/A/E/P/C/M)        */
/* -------------------------------------------------------------------------- */

/**
 * The lex permission verb (`view|add|edit|approve|close|assign|distribute|
 * manage|read`) → the matrix verb code it surfaces as. `assign`/`distribute`
 * are the v2 restricted verbs; both surface as E (edit-class allocation) but
 * are also called out explicitly in the column tooltip so the manager-only
 * nuance is not lost. `read`/`view` → V; `manage` → M.
 */
const VERB_KEY_TO_MATRIX: Record<string, MatrixVerb> = {
  view: 'V',
  read: 'V',
  add: 'A',
  edit: 'E',
  assign: 'E',
  distribute: 'E',
  approve: 'P',
  close: 'C',
  manage: 'M',
};

/**
 * A matrix domain (the column family the grid groups by) and the
 * `lex:<domain>` prefix its capability keys carry. The grid renders one row per
 * domain; each role's cell is DERIVED from the verbs it holds on that domain.
 */
export interface MatrixDomain {
  /** lex:<domain> prefix, e.g. "lex:case". */
  prefix: string;
  /** Stable id / React key. */
  id: string;
}

/**
 * The domains, in the order the grid renders them. `report`/`audit` use a flat
 * `:read` key (not a `:<verb>` triplet); they still derive to V correctly via
 * VERB_KEY_TO_MATRIX.
 */
export const MATRIX_DOMAINS: readonly MatrixDomain[] = [
  { id: 'request', prefix: 'lex:request' },
  { id: 'case', prefix: 'lex:case' },
  { id: 'investigation', prefix: 'lex:investigation' },
  { id: 'settlement', prefix: 'lex:settlement' },
  { id: 'contract', prefix: 'lex:contract' },
  { id: 'consultation', prefix: 'lex:consultation' },
  { id: 'document', prefix: 'lex:document' },
  { id: 'report', prefix: 'lex:report' },
  { id: 'notification', prefix: 'lex:notification' },
  { id: 'sla', prefix: 'lex:sla' },
  { id: 'escalation', prefix: 'lex:escalation' },
  { id: 'catalog', prefix: 'lex:catalog' },
  { id: 'role', prefix: 'lex:role' },
  { id: 'audit', prefix: 'lex:audit' },
  { id: 'integration', prefix: 'lex:integration' },
  { id: 'security', prefix: 'lex:security' },
];

/** Authority order so a derived cell lists verbs strongest→weakest. */
const DERIVE_ORDER: readonly MatrixVerb[] = ['M', 'P', 'C', 'E', 'A', 'V'];

/**
 * Derives the matrix verb set a role holds on a domain from its permission
 * keys. Returns the verbs ordered by authority (M→V); empty = no access.
 *
 * Restricted verbs (`assign`/`distribute`) and their underlying domain keys are
 * folded together — e.g. `lex:case:assign` contributes E. The explicit
 * `assign`/`distribute` keys are surfaced separately by `restrictedVerbs` for
 * the column tooltip.
 */
export function deriveDomainVerbs(
  permissions: readonly string[],
  prefix: string,
): MatrixVerb[] {
  const found = new Set<MatrixVerb>();
  const want = `${prefix}:`;
  for (const perm of permissions) {
    if (!perm.startsWith(want)) continue;
    const verbKey = perm.slice(want.length);
    const mapped = VERB_KEY_TO_MATRIX[verbKey];
    if (mapped) found.add(mapped);
  }
  return DERIVE_ORDER.filter((v) => found.has(v));
}

/**
 * The restricted verb keys (`assign`, `distribute`) a role holds on a domain —
 * surfaced in the cell tooltip so the manager-only allocation right stays
 * legible even though it derives to the E colour.
 */
export function restrictedVerbs(
  permissions: readonly string[],
  prefix: string,
): string[] {
  const out: string[] = [];
  for (const key of ['assign', 'distribute']) {
    if (permissions.includes(`${prefix}:${key}`)) out.push(key);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Runtime reconciliation (drift between this source and the live tenant)     */
/* -------------------------------------------------------------------------- */

/** A single drift finding between canonical and runtime permission sets. */
export interface RolePermDrift {
  code: RoleCode;
  slug: string;
  /** Keys the live role has that the canonical source does not. */
  extra: string[];
  /** Keys the canonical source has that the live role is missing. */
  missing: string[];
}

/**
 * Compares a fetched role's runtime permission set against the canonical
 * source. Returns null when they match (no drift). Coarse fallbacks
 * (`lex:read`/`lex:write`) are ignored — they are migration-compat keys, not
 * part of the matrix's granular contract.
 */
export function diffRolePermissions(
  code: RoleCode,
  slug: string,
  runtime: readonly string[],
): RolePermDrift | null {
  const ignore = new Set([LEX_READ, LEX_WRITE]);
  const canonical = new Set(
    (CANONICAL_PERMS_BY_CODE[code] ?? []).filter((p) => !ignore.has(p)),
  );
  const live = new Set(runtime.filter((p) => !ignore.has(p)));
  // A `*` wildcard role (e.g. a super-admin override) covers everything — not drift.
  if (live.has('*') || live.has('lex:*')) return null;

  const extra = [...live].filter((p) => !canonical.has(p)).sort();
  const missing = [...canonical].filter((p) => !live.has(p)).sort();
  if (extra.length === 0 && missing.length === 0) return null;
  return { code, slug, extra, missing };
}

/* -------------------------------------------------------------------------- */
/* Coverage (derived from the same canonical permission sets)                 */
/* -------------------------------------------------------------------------- */

/** Total domains the grid renders (denominator for per-role coverage). */
export const TOTAL_CAPABILITY_ROWS = MATRIX_DOMAINS.length;

/**
 * Count of capability domains a role has ANY access to — derived from its
 * canonical permission set, so it cannot drift from the cells the grid paints.
 */
export function roleCoverageCount(code: RoleCode): number {
  const perms = CANONICAL_PERMS_BY_CODE[code] ?? [];
  let n = 0;
  for (const domain of MATRIX_DOMAINS) {
    if (deriveDomainVerbs(perms, domain.prefix).length > 0) n += 1;
  }
  return n;
}
