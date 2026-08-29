/**
 * Pure compute for the org-wide escalation coverage heatmap (CAP-019).
 *
 * Given the flat list of {@link OrgEntity} records returned by
 * `lexAdminApi.listOrgEntities`, this module derives, for every
 * (entity, roleKey) pair, whether the role is:
 *
 *   - GREEN  — bound directly on the entity itself;
 *   - AMBER  — inherited from the nearest ancestor up `path[]`
 *              (root-first list of ancestor ids), recording WHICH ancestor
 *              supplies it; or
 *   - RED    — not found anywhere on the entity or its ancestry.
 *
 * Everything here is framework-free and side-effect-free so it can be unit
 * tested in isolation and reused by the matrix UI.
 */
import { ORG_ROLE_KEYS, type OrgEntity, type OrgRoleKey } from '@/lib/lex/admin';

export type CoverageStatus = 'bound' | 'inherited' | 'none';

/** The three escalation-ladder roles (L1/L2/L3), in order. */
export const ESCALATION_ROLE_KEYS: readonly OrgRoleKey[] = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as const;

/** The governance roles, shown after the escalation ladder. */
export const GOVERNANCE_ROLE_KEYS: readonly OrgRoleKey[] = ORG_ROLE_KEYS.filter(
  (key) => !ESCALATION_ROLE_KEYS.includes(key),
);

/** Ordered columns: the L1/L2/L3 ladder first, then the governance roles. */
export const COVERAGE_COLUMN_KEYS: readonly OrgRoleKey[] = [
  ...ESCALATION_ROLE_KEYS,
  ...GOVERNANCE_ROLE_KEYS,
];

/** 1-based escalation level for the ladder roles, or `null` for governance. */
export function escalationLevel(roleKey: OrgRoleKey): 1 | 2 | 3 | null {
  const idx = ESCALATION_ROLE_KEYS.indexOf(roleKey);
  return idx === -1 ? null : ((idx + 1) as 1 | 2 | 3);
}

/** Resolved state of a single (entity, roleKey) cell. */
export interface CoverageCell {
  roleKey: OrgRoleKey;
  status: CoverageStatus;
  /**
   * The entity that actually supplies the role:
   *  - `bound`     → the row entity itself;
   *  - `inherited` → the nearest ancestor that carries the role;
   *  - `none`      → `null`.
   */
  sourceEntityId: string | null;
  sourceEntityCode: string | null;
}

/** One matrix row: an entity plus its resolved cell for every column role. */
export interface CoverageRow {
  entity: OrgEntity;
  cells: Record<OrgRoleKey, CoverageCell>;
}

/** Aggregate counts driving the KPI strip. */
export interface CoverageSummary {
  total: number;
  bound: number;
  inherited: number;
  none: number;
  /** Share of cells with ANY coverage (bound or inherited), 0..100, rounded. */
  coveragePct: number;
}

function hasRole(entity: OrgEntity, roleKey: OrgRoleKey): boolean {
  return (entity.roles ?? []).some((role) => role.role_key === roleKey);
}

/**
 * Resolve a single cell for `entity` / `roleKey` against the indexed pool.
 * `byId` maps entity id → entity so ancestry lookups via `path[]` are O(depth).
 */
export function resolveCell(
  entity: OrgEntity,
  roleKey: OrgRoleKey,
  byId: ReadonlyMap<string, OrgEntity>,
): CoverageCell {
  if (hasRole(entity, roleKey)) {
    return {
      roleKey,
      status: 'bound',
      sourceEntityId: entity.id,
      sourceEntityCode: entity.code,
    };
  }
  // `path` is root-first; walk it from the nearest ancestor (end) upward.
  for (let i = entity.path.length - 1; i >= 0; i -= 1) {
    const ancestorId = entity.path[i];
    // An entity's own id can appear at the tail of `path`; skip self.
    if (ancestorId === entity.id) continue;
    const ancestor = byId.get(ancestorId);
    if (ancestor && hasRole(ancestor, roleKey)) {
      return {
        roleKey,
        status: 'inherited',
        sourceEntityId: ancestor.id,
        sourceEntityCode: ancestor.code,
      };
    }
  }
  return { roleKey, status: 'none', sourceEntityId: null, sourceEntityCode: null };
}

/** Build the full set of coverage rows for `entities` over all column roles. */
export function buildCoverageRows(entities: readonly OrgEntity[]): CoverageRow[] {
  const byId = new Map<string, OrgEntity>(entities.map((e) => [e.id, e]));
  return entities.map((entity) => {
    const cells = {} as Record<OrgRoleKey, CoverageCell>;
    for (const roleKey of COVERAGE_COLUMN_KEYS) {
      cells[roleKey] = resolveCell(entity, roleKey, byId);
    }
    return { entity, cells };
  });
}

/** Aggregate every cell across `rows` into the KPI summary. */
export function summarizeCoverage(rows: readonly CoverageRow[]): CoverageSummary {
  let bound = 0;
  let inherited = 0;
  let none = 0;
  for (const row of rows) {
    for (const roleKey of COVERAGE_COLUMN_KEYS) {
      const status = row.cells[roleKey].status;
      if (status === 'bound') bound += 1;
      else if (status === 'inherited') inherited += 1;
      else none += 1;
    }
  }
  const total = bound + inherited + none;
  const coveragePct = total === 0 ? 0 : Math.round(((bound + inherited) / total) * 100);
  return { total, bound, inherited, none, coveragePct };
}
