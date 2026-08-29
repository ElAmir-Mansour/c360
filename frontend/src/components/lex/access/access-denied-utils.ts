/**
 * Pure helpers behind the §15 Access-Denied UX. Kept framework-free so they are
 * trivially unit-testable.
 */

import { canAccess, type PermissionRequirement } from '@/lib/permissions';
import { LEX_ROLE_PERMISSIONS } from './lex-role-permissions';
import type { LegalRoleSummary } from './use-lex-access';

/**
 * Flatten a {@link PermissionRequirement} into the list of permission keys it
 * references, for display ("Required permission: lex:case:view"). A plain string
 * yields a single key; `anyOf`/`allOf` yield their members.
 */
export function requirementKeys(requirement?: PermissionRequirement): string[] {
  if (!requirement) return [];
  if (typeof requirement === 'string') return [requirement];
  if ('anyOf' in requirement) return requirement.anyOf;
  if ('allOf' in requirement) return requirement.allOf;
  return [];
}

/**
 * Human label for how the requirement must be satisfied:
 *   - single / allOf  → "lex:case:view" / "lex:a AND lex:b"
 *   - anyOf           → "lex:a OR lex:b"
 */
export function describeRequirement(
  requirement: PermissionRequirement | undefined,
  labels: { and: string; or: string },
): string {
  const keys = requirementKeys(requirement);
  if (keys.length <= 1) return keys[0] ?? '';
  if (requirement && typeof requirement === 'object' && 'allOf' in requirement) {
    return keys.join(` ${labels.and} `);
  }
  // anyOf (and any defensive fallthrough) read as OR.
  return keys.join(` ${labels.or} `);
}

/**
 * From the user's AVAILABLE legal roles, return those (other than the active
 * one) whose static permission set would satisfy the requirement — i.e. the
 * personas the user could switch to in order to access the page (§15). Uses the
 * SAME `canAccess` wildcard semantics as every other gate. The backend remains
 * authoritative; this only drives the "Switch persona" affordance.
 */
export function findSwitchableRoles(
  requirement: PermissionRequirement | undefined,
  availableRoles: LegalRoleSummary[],
  activeRoleSlug: string | null | undefined,
): LegalRoleSummary[] {
  if (!requirement) return [];
  return availableRoles.filter((role) => {
    if (role.slug === activeRoleSlug) return false;
    const perms = LEX_ROLE_PERMISSIONS[role.slug];
    if (!perms) return false;
    return canAccess([...perms], requirement);
  });
}

/** Pick the bilingual display name for a role per the active locale. */
export function roleDisplayName(
  role: LegalRoleSummary | null | undefined,
  locale: string,
): string | null {
  if (!role) return null;
  return locale.startsWith('ar') ? role.name_ar || role.name_en : role.name_en;
}
