/**
 * Pure compute for the org re-parent / reorganize impact simulation (CAP-019).
 *
 * Given the flat list of {@link OrgEntity} records returned by
 * `lexAdminApi.listOrgEntities`, this module derives, BEFORE any write hits the
 * backend, what moving one subtree under a new parent would do to the L1/L2/L3
 * escalation ladder for the moved node and every one of its descendants.
 *
 * The escalation resolver walks `path[]` (root-first ancestor ids) plus the node
 * itself, nearest-first, looking for the first entity that binds the ladder
 * role. To preview a move we reconstruct each affected node's NEW ancestry
 * (new parent's ancestry + new parent + the node's position within the moved
 * subtree) and re-run the same nearest-first walk.
 *
 * Everything here is framework-free and side-effect-free: no React, no imports
 * beyond the domain types, so it is trivially unit-testable and reusable.
 *
 * NOTE: this is an advisory projection. The backend escalation resolver remains
 * authoritative; the UI must say so.
 */
import type { OrgEntity, OrgRoleKey } from '@/lib/lex/admin';

/** The three escalation-ladder roles, ordered L1 → L2 → L3. */
export const ESCALATION_ROLE_KEYS: readonly OrgRoleKey[] = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as const;

/** 1-based escalation level for a ladder role, or `null` for governance roles. */
export function escalationLevel(roleKey: OrgRoleKey): 1 | 2 | 3 | null {
  const idx = ESCALATION_ROLE_KEYS.indexOf(roleKey);
  return idx === -1 ? null : ((idx + 1) as 1 | 2 | 3);
}

/** How a single (entity, level) provider changes as a result of the move. */
export type EscalationChange = 'gained' | 'lost' | 'changed' | 'same';

/** One projected escalation-delta row for a single (entity, ladder level). */
export interface EscalationDeltaRow {
  entityId: string;
  code: string;
  /** 1 | 2 | 3 — the escalation ladder level. */
  level: 1 | 2 | 3;
  role_key: OrgRoleKey;
  /** Provider entity code before the move, or `null` if uncovered. */
  before: string | null;
  /** Provider entity code after the move, or `null` if uncovered. */
  after: string | null;
  change: EscalationChange;
}

/** Index helper: build an id → entity map once. */
function indexById(all: readonly OrgEntity[]): Map<string, OrgEntity> {
  return new Map(all.map((entity) => [entity.id, entity]));
}

/** Index helper: build a parentId → direct-children map once. */
function indexChildren(all: readonly OrgEntity[]): Map<string, OrgEntity[]> {
  const byParent = new Map<string, OrgEntity[]>();
  for (const entity of all) {
    if (!entity.parent_id) continue;
    const bucket = byParent.get(entity.parent_id);
    if (bucket) bucket.push(entity);
    else byParent.set(entity.parent_id, [entity]);
  }
  return byParent;
}

/**
 * Every descendant of `rootId` (children, grandchildren, …), excluding the root
 * itself. Order is a stable pre-order traversal.
 */
export function collectDescendants(rootId: string, all: readonly OrgEntity[]): OrgEntity[] {
  const byParent = indexChildren(all);
  const out: OrgEntity[] = [];
  const visit = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return out;
}

/**
 * True if `candidateId` is `ofId` itself or sits anywhere within `ofId`'s
 * subtree. Used as the cycle guard when choosing a new parent: an entity may
 * never be re-parented under itself or one of its own descendants.
 */
export function isDescendant(candidateId: string, ofId: string, all: readonly OrgEntity[]): boolean {
  if (candidateId === ofId) return true;
  const byParent = indexChildren(all);
  let found = false;
  const visit = (id: string) => {
    if (found) return;
    for (const child of byParent.get(id) ?? []) {
      if (child.id === candidateId) {
        found = true;
        return;
      }
      visit(child.id);
    }
  };
  visit(ofId);
  return found;
}

/**
 * All entities that may legally serve as the new parent of `entity`: everything
 * except `entity` itself and its descendants (which would create a cycle).
 * Inactive entities are kept so historical structure can still be expressed; the
 * caller may filter further.
 */
export function validParents(entity: OrgEntity, all: readonly OrgEntity[]): OrgEntity[] {
  return all.filter((candidate) => !isDescendant(candidate.id, entity.id, all));
}

/**
 * Resolve the nearest provider of `roleKey` for `entity` given an explicit
 * ancestry chain (`ancestryRootFirst`, root-first ancestor entities NOT
 * including `entity`). Walks self first, then ancestry nearest-first. Returns
 * the supplying entity's `{ entityId, code }`, or `null` if uncovered.
 */
function resolveProvider(
  entity: OrgEntity,
  ancestryRootFirst: readonly OrgEntity[],
  roleKey: OrgRoleKey,
): { entityId: string; code: string } | null {
  if (hasRole(entity, roleKey)) {
    return { entityId: entity.id, code: entity.code };
  }
  for (let i = ancestryRootFirst.length - 1; i >= 0; i -= 1) {
    const ancestor = ancestryRootFirst[i];
    if (ancestor.id === entity.id) continue;
    if (hasRole(ancestor, roleKey)) {
      return { entityId: ancestor.id, code: ancestor.code };
    }
  }
  return null;
}

function hasRole(entity: OrgEntity, roleKey: OrgRoleKey): boolean {
  return (entity.roles ?? []).some((role) => role.role_key === roleKey);
}

/**
 * Current nearest provider of `roleKey` for `entity` using the entity's
 * existing `path[]` ancestry. Returns `{ entityId, code }` or `null`.
 *
 * `entity.path` is the root-first list of ancestor ids (it may include the
 * entity's own id at the tail); `all` resolves ids to records.
 */
export function escalationProvider(
  entity: OrgEntity,
  all: readonly OrgEntity[],
  roleKey: OrgRoleKey,
): { entityId: string; code: string } | null {
  const byId = indexById(all);
  const ancestry: OrgEntity[] = [];
  for (const ancestorId of entity.path) {
    if (ancestorId === entity.id) continue;
    const ancestor = byId.get(ancestorId);
    if (ancestor) ancestry.push(ancestor);
  }
  return resolveProvider(entity, ancestry, roleKey);
}

/**
 * Project the L1/L2/L3 escalation provider for the moved entity AND every
 * descendant, BEFORE vs AFTER re-parenting `movedEntity` under `newParentId`
 * (`null` ⇒ make root).
 *
 * The NEW ancestry of any affected node is reconstructed as:
 *   [ ...newParent ancestry (root-first), newParent?, ...intra-subtree chain ]
 * where the intra-subtree chain is the affected node's existing ancestors that
 * lie at or below `movedEntity` (i.e. the part of its old `path[]` from
 * `movedEntity` onward, exclusive of the node itself).
 *
 * One {@link EscalationDeltaRow} is emitted per (affected node × ladder level).
 */
export function projectEscalationDelta(
  movedEntity: OrgEntity,
  newParentId: string | null,
  all: readonly OrgEntity[],
): EscalationDeltaRow[] {
  const byId = indexById(all);
  const newParent = newParentId ? byId.get(newParentId) ?? null : null;

  // New ancestry prefix shared by the whole moved subtree (root-first), i.e.
  // everything strictly above `movedEntity` after the move.
  const newPrefix: OrgEntity[] = [];
  if (newParent) {
    for (const ancestorId of newParent.path) {
      if (ancestorId === newParent.id) continue;
      const ancestor = byId.get(ancestorId);
      if (ancestor) newPrefix.push(ancestor);
    }
    newPrefix.push(newParent);
  }

  const affected: OrgEntity[] = [movedEntity, ...collectDescendants(movedEntity.id, all)];
  const rows: EscalationDeltaRow[] = [];

  for (const node of affected) {
    // Intra-subtree ancestry: the slice of `node.path` from `movedEntity`
    // (inclusive) up to but excluding `node` itself. For `movedEntity` this is
    // empty; for a grandchild it is [movedEntity, child, …].
    const intra: OrgEntity[] = [];
    const movedIdx = node.path.indexOf(movedEntity.id);
    if (movedIdx !== -1) {
      for (let i = movedIdx; i < node.path.length; i += 1) {
        const ancestorId = node.path[i];
        if (ancestorId === node.id) continue;
        const ancestor = byId.get(ancestorId);
        if (ancestor) intra.push(ancestor);
      }
    } else if (node.id !== movedEntity.id) {
      // Defensive: descendant whose path doesn't list movedEntity — fall back
      // to its full existing ancestry below movedEntity is unknown, so use none.
    }

    const newAncestry: OrgEntity[] = [...newPrefix, ...intra];

    for (const role_key of ESCALATION_ROLE_KEYS) {
      const level = escalationLevel(role_key) as 1 | 2 | 3;
      const beforeProvider = escalationProvider(node, all, role_key);
      const afterProvider = resolveProvider(node, newAncestry, role_key);
      const before = beforeProvider?.code ?? null;
      const after = afterProvider?.code ?? null;

      let change: EscalationChange;
      if (before === after) change = 'same';
      else if (before === null) change = 'gained';
      else if (after === null) change = 'lost';
      else change = 'changed';

      rows.push({ entityId: node.id, code: node.code, level, role_key, before, after, change });
    }
  }

  return rows;
}

/**
 * Aggregate convenience: how many DISTINCT affected entities lose escalation
 * coverage at one or more levels (i.e. have a `lost` row) under the projection.
 */
export function countEntitiesLosingCoverage(rows: readonly EscalationDeltaRow[]): number {
  const losers = new Set<string>();
  for (const row of rows) {
    if (row.change === 'lost') losers.add(row.entityId);
  }
  return losers.size;
}
