/**
 * Pure validation/rules engine for the org-entity registry Health & QA panel.
 *
 * Given the flat list of {@link OrgEntity} records returned by
 * `lexAdminApi.listOrgEntities`, {@link runOrgHealthRules} derives a list of
 * {@link AdminIssue}s — one per validation failure — each carrying an
 * already-localized title + "how to fix" description and a deep link to the
 * affected entity. {@link computeHealthScore} reduces that list to a single
 * 0..100 data-quality score by severity weighting.
 *
 * Everything here is framework-free and side-effect-free: the caller supplies a
 * resolved {@link HealthRuleLabels} (`t`) so the engine never touches React,
 * i18n context, or the network. This keeps it trivially unit-testable and lets
 * the same rules run on any locale.
 */
import type { OrgEntity, OrgEntityType, OrgRoleKey } from '@/lib/lex/admin';
import type { AdminIssue } from '../../_lib/admin-feature-utils';
import type { HealthRuleLabels } from './org-health-i18n';

/** Roles that satisfy an escalation target (an SLA breach can route to them). */
const ESCALATION_ROLE_KEYS: readonly OrgRoleKey[] = [
  'section_supervisor',
  'department_manager',
  'shared_services_manager',
] as const;

/** Hierarchy depth (path length) beyond which nesting is flagged. */
const MAX_DEPTH = 6;

/** Deep link to an entity detail page. */
function entityHref(id: string): string {
  return `/lex/admin/org-entities/${id}`;
}

/** Best-effort bilingual-aware ref "CODE — Name" used inside messages. */
function refOf(entity: OrgEntity, t: HealthRuleLabels): string {
  const name = entity.name?.en || entity.name?.ar || '';
  return t.entityRef(entity.code, name);
}

function hasEscalationRole(entity: OrgEntity | undefined): boolean {
  if (!entity) return false;
  return (entity.roles ?? []).some((role) =>
    ESCALATION_ROLE_KEYS.includes(role.role_key),
  );
}

/**
 * Walk the parent_id chain from `entity` and return `true` if a loop is found
 * before reaching a root (parent_id null/undefined) or an unknown parent.
 */
function hasCycle(entity: OrgEntity, byId: Map<string, OrgEntity>): boolean {
  const seen = new Set<string>([entity.id]);
  let current: OrgEntity | undefined = entity;
  // Cap iterations defensively at the registry size to avoid runaway loops on
  // malformed data even if `seen` somehow misses (it cannot, but be safe).
  for (let i = 0; i <= byId.size; i += 1) {
    const parentId = current?.parent_id;
    if (!parentId) return false;
    if (seen.has(parentId)) return true;
    seen.add(parentId);
    current = byId.get(parentId);
    if (!current) return false; // dangling parent — not a cycle
  }
  return true;
}

/**
 * runOrgHealthRules validates the full entity registry and returns one
 * {@link AdminIssue} per finding. `t` is a resolved {@link HealthRuleLabels}
 * so every issue's title/description is already in the active locale.
 */
export function runOrgHealthRules(
  entities: OrgEntity[],
  t: HealthRuleLabels,
): AdminIssue[] {
  const issues: AdminIssue[] = [];
  const byId = new Map<string, OrgEntity>(entities.map((e) => [e.id, e]));

  // --- duplicate code (warning) — computed once across the whole registry ---
  const codeGroups = new Map<string, OrgEntity[]>();
  for (const entity of entities) {
    const code = (entity.code ?? '').trim();
    if (!code) continue;
    const group = codeGroups.get(code) ?? [];
    group.push(entity);
    codeGroups.set(code, group);
  }
  for (const [code, group] of codeGroups) {
    if (group.length <= 1) continue;
    for (const entity of group) {
      issues.push({
        id: `dup-code:${entity.id}`,
        severity: 'warning',
        area: t.areaIdentity,
        title: t.duplicateCodeTitle,
        description: t.duplicateCodeDescription(code, group.length),
        href: entityHref(entity.id),
      });
    }
  }

  for (const entity of entities) {
    const ref = refOf(entity, t);
    const isRoot = !entity.parent_id;

    // --- cycle in parent_id chain (critical) ---
    if (hasCycle(entity, byId)) {
      issues.push({
        id: `cycle:${entity.id}`,
        severity: 'critical',
        area: t.areaStructure,
        title: t.cycleTitle,
        description: t.cycleDescription(ref),
        href: entityHref(entity.id),
      });
    }

    // --- inactive parent with active child (warning) ---
    if (entity.active && entity.parent_id) {
      const parent = byId.get(entity.parent_id);
      if (parent && !parent.active) {
        issues.push({
          id: `inactive-parent:${entity.id}`,
          severity: 'warning',
          area: t.areaStructure,
          title: t.inactiveParentTitle,
          description: t.inactiveParentDescription(ref, refOf(parent, t)),
          href: entityHref(entity.id),
        });
      }
    }

    // --- missing Arabic OR English name (warning) ---
    const arName = (entity.name?.ar ?? '').trim();
    const enName = (entity.name?.en ?? '').trim();
    if (!arName) {
      issues.push({
        id: `missing-name-ar:${entity.id}`,
        severity: 'warning',
        area: t.areaLocalization,
        title: t.missingNameTitle,
        description: t.missingNameDescriptionAr(ref),
        href: entityHref(entity.id),
      });
    }
    if (!enName) {
      issues.push({
        id: `missing-name-en:${entity.id}`,
        severity: 'warning',
        area: t.areaLocalization,
        title: t.missingNameTitle,
        description: t.missingNameDescriptionEn(ref),
        href: entityHref(entity.id),
      });
    }

    // --- entity with zero roles (info) ---
    if ((entity.roles ?? []).length === 0) {
      issues.push({
        id: `no-roles:${entity.id}`,
        severity: 'info',
        area: t.areaRoles,
        title: t.noRolesTitle,
        description: t.noRolesDescription(ref),
        href: entityHref(entity.id),
      });
    }

    // --- escalation dead-end (critical) ---
    // An escalation role must be reachable on the entity itself or any ancestor
    // up path[] (root-first list of ancestor ids). If none carries one, an SLA
    // breach here has nobody to escalate to.
    const ancestorIds = entity.path ?? [];
    const selfHas = hasEscalationRole(entity);
    const ancestorHas = ancestorIds.some((id) => hasEscalationRole(byId.get(id)));
    if (!selfHas && !ancestorHas) {
      issues.push({
        id: `escalation-dead-end:${entity.id}`,
        severity: 'critical',
        area: t.areaEscalation,
        title: t.escalationDeadEndTitle,
        description: t.escalationDeadEndDescription(ref),
        href: entityHref(entity.id),
      });
    }

    // --- depth > 6 via path[].length (info) ---
    const depth = (entity.path ?? []).length;
    if (depth > MAX_DEPTH) {
      issues.push({
        id: `depth:${entity.id}`,
        severity: 'info',
        area: t.areaStructure,
        title: t.depthTitle,
        description: t.depthDescription(ref, depth),
        href: entityHref(entity.id),
      });
    }

    // --- structural: only company may be a root (warning) ---
    if (isRoot && entity.entity_type !== 'company') {
      issues.push({
        id: `root-type:${entity.id}`,
        severity: 'warning',
        area: t.areaStructure,
        title: t.rootTypeTitle,
        description: t.rootTypeDescription(ref, t.entityType(entity.entity_type)),
        href: entityHref(entity.id),
      });
    }

    // --- structural: a section must sit under a department (warning) ---
    if (entity.entity_type === 'section') {
      const parent = entity.parent_id ? byId.get(entity.parent_id) : undefined;
      const parentIsDepartment = parent?.entity_type === 'department';
      if (!parentIsDepartment) {
        issues.push({
          id: `section-parent:${entity.id}`,
          severity: 'warning',
          area: t.areaStructure,
          title: t.sectionParentTitle,
          description: t.sectionParentDescription(ref),
          href: entityHref(entity.id),
        });
      }
    }
  }

  return issues;
}

const SEVERITY_WEIGHT: Record<AdminIssue['severity'], number> = {
  critical: 12,
  warning: 5,
  info: 1,
};

/**
 * computeHealthScore reduces an issue list to a 0..100 data-quality score:
 * start at 100, subtract the per-severity weight for each issue, clamp to 0..100.
 */
export function computeHealthScore(issues: AdminIssue[]): number {
  const penalty = issues.reduce((sum, issue) => sum + SEVERITY_WEIGHT[issue.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Convenience: per-severity counts for the KPI strip. */
export function countBySeverity(
  issues: AdminIssue[],
): Record<AdminIssue['severity'], number> {
  return issues.reduce<Record<AdminIssue['severity'], number>>(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 },
  );
}

/** Helper exported for tests / re-use: the entity types that may be roots. */
export const ROOT_ENTITY_TYPES: readonly OrgEntityType[] = ['company'] as const;
