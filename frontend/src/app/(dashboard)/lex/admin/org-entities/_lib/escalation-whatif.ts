/**
 * Pure compute for the live "what-if" escalation simulator (CAP-019).
 *
 * The backend's `getOrgEscalation(id)` resolves the L1/L2/L3 ladder for a single
 * entity by walking UP its ancestry for each escalation role. This module lets
 * the UI re-run that same resolution *locally* once an operator marks one or more
 * role holders as "on leave / unavailable" — without round-tripping the server —
 * so they can see, instantly, who the notification would actually reach (or
 * whether the rung goes UNCOVERED and the escalation would not fire).
 *
 * Resolution rule (mirrors the server + `escalation-coverage.resolveCell`):
 *   for each level 1..3 (role_key in ESCALATION_ROLE_KEYS order):
 *     - start at the SELECTED entity, then walk its ancestry nearest-first
 *       (`path[]` is root-first ancestor ids, so we iterate from the tail up);
 *     - pick the FIRST entity carrying that role with a holder whose user_id is
 *       NOT in `unavailableUserIds`;
 *     - if none qualifies, the rung is UNCOVERED.
 *
 * The base ladder is used only to detect which level a recipient *originally*
 * came from so we can classify a level as `original` (the base holder is still
 * available), `substituted` (we fell through to a different holder/entity), or
 * `uncovered` (no available holder anywhere in the ancestry).
 *
 * Everything here is framework-free and side-effect-free for unit testing.
 */
import type {
  EscalationLadder,
  EscalationRecipient,
  OrgEntity,
  OrgRoleKey,
} from '@/lib/lex/admin';

/** The three escalation-ladder roles (L1/L2/L3), in level order. */
export const ESCALATION_ROLE_KEYS: readonly OrgRoleKey[] = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as const;

/** Classification of a single rung after the unavailable toggles are applied. */
export type WhatIfStatus = 'original' | 'substituted' | 'uncovered';

/**
 * One resolved rung of the effective ladder.
 *
 * `recipient` is the holder that WOULD actually be notified after toggles, or
 * `null` when the rung is `uncovered`. For `original`/`substituted` it is a fully
 * formed {@link EscalationRecipient} pointing at the supplying entity.
 */
export interface WhatIfLevel {
  /** 1-based escalation level (1=L1, 2=L2, 3=L3). */
  level: number;
  /** The role that fills this level. */
  roleKey: OrgRoleKey;
  status: WhatIfStatus;
  /** The holder that would fire, or `null` when uncovered. */
  recipient: EscalationRecipient | null;
  /**
   * The base recipient as returned by the server for this level, if the ladder
   * carried one (ladders may be shorter than 3 → `null` = a pre-existing gap).
   */
  baseRecipient: EscalationRecipient | null;
}

/** Index a flat entity list by id for O(1) ancestry lookups. */
function indexById(entities: readonly OrgEntity[]): Map<string, OrgEntity> {
  return new Map(entities.map((e) => [e.id, e]));
}

/**
 * Build the ordered chain of entities to consider for a level, starting at the
 * selected entity and walking ancestry nearest-first. `path[]` is root-first, so
 * we read it from the tail toward the root; the entity's own id can appear at the
 * tail of its `path`, so we de-dupe against `self`.
 */
function ancestryChain(
  self: OrgEntity,
  byId: ReadonlyMap<string, OrgEntity>,
): OrgEntity[] {
  const chain: OrgEntity[] = [self];
  for (let i = self.path.length - 1; i >= 0; i -= 1) {
    const ancestorId = self.path[i];
    if (ancestorId === self.id) continue;
    const ancestor = byId.get(ancestorId);
    if (ancestor) chain.push(ancestor);
  }
  return chain;
}

/**
 * Find the first entity in `chain` carrying `roleKey` with a holder that is NOT
 * unavailable, and synthesize the {@link EscalationRecipient} it would produce.
 */
function resolveAvailable(
  chain: readonly OrgEntity[],
  roleKey: OrgRoleKey,
  level: number,
  unavailableUserIds: ReadonlySet<string>,
): EscalationRecipient | null {
  for (const entity of chain) {
    const role = (entity.roles ?? []).find(
      (r) => r.role_key === roleKey && !unavailableUserIds.has(r.user_id),
    );
    if (role) {
      return {
        level,
        role_key: roleKey,
        user_id: role.user_id,
        label: role.label,
        entity_id: entity.id,
        entity_code: entity.code,
        entity_name: entity.name,
      };
    }
  }
  return null;
}

/**
 * Recompute the effective escalation ladder for the entity behind `baseLadder`,
 * treating every user in `unavailableUserIds` as on-leave.
 *
 * Returns three rungs (L1/L2/L3) in level order, each classified relative to the
 * server-resolved base ladder:
 *   - `original`    — the base holder for that level is still available;
 *   - `substituted` — a different available holder/entity now fills the rung
 *                     (the base holder is on leave, or the rung was a gap that a
 *                     now-considered holder happens to cover);
 *   - `uncovered`   — no available holder exists anywhere up the ancestry → the
 *                     escalation would not fire at this level.
 *
 * The selected entity is located via `baseLadder.entity_id`; if it is absent
 * from `allEntities` (stale list) every rung degrades to `uncovered`, which is
 * the safe, fail-loud behaviour for a coverage tool.
 */
export function recomputeEffectiveLadder(
  baseLadder: EscalationLadder,
  allEntities: readonly OrgEntity[],
  unavailableUserIds: Set<string>,
): WhatIfLevel[] {
  const byId = indexById(allEntities);
  const self = byId.get(baseLadder.entity_id);
  const chain = self ? ancestryChain(self, byId) : [];

  const baseByLevel = new Map<number, EscalationRecipient>();
  for (const recipient of baseLadder.recipients) {
    baseByLevel.set(recipient.level, recipient);
  }

  return ESCALATION_ROLE_KEYS.map((roleKey, idx) => {
    const level = idx + 1;
    const baseRecipient = baseByLevel.get(level) ?? null;
    const recipient = resolveAvailable(chain, roleKey, level, unavailableUserIds);

    let status: WhatIfStatus;
    if (!recipient) {
      status = 'uncovered';
    } else if (
      baseRecipient &&
      baseRecipient.user_id === recipient.user_id &&
      baseRecipient.entity_id === recipient.entity_id
    ) {
      status = 'original';
    } else {
      // Either the base holder is on leave (a true substitution) or the base
      // ladder had no rung here and a holder now covers it. Both read as a
      // deviation from the resolved baseline, hence "substituted".
      status = 'substituted';
    }

    return { level, roleKey, status, recipient, baseRecipient };
  });
}

/**
 * Convenience: the holders that would ACTUALLY be notified, in level order,
 * skipping uncovered rungs. Drives the "effective notification recipients"
 * summary panel.
 */
export function effectiveRecipients(levels: readonly WhatIfLevel[]): EscalationRecipient[] {
  return levels
    .filter((l): l is WhatIfLevel & { recipient: EscalationRecipient } => l.recipient !== null)
    .map((l) => l.recipient);
}

/** Count of rungs that would NOT fire (no available holder in the ancestry). */
export function uncoveredCount(levels: readonly WhatIfLevel[]): number {
  return levels.reduce((acc, l) => acc + (l.status === 'uncovered' ? 1 : 0), 0);
}
