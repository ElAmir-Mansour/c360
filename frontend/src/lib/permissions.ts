/**
 * Shared permission-requirement primitive for the Lex (Watheeq) persona-UX model.
 *
 * Source of truth: docs/ClarioWatheeq/Lex_Codebase_RBAC_Map.md §7 (PermissionRequirement
 * + canAccess), §8 (route/nav permission map), §11 (sidebar filtering), §12 (command
 * palette), §18.1 (frontend registry).
 *
 * Nav items, command-palette entries, route guards, admin cards and action buttons all
 * evaluate access through the SAME `canAccess` helper, which delegates wildcard matching
 * to the authoritative `checkPermission` resolver in the auth store. We reuse — never
 * fork — that wildcard logic so the frontend UX layer stays consistent with the backend
 * (which remains the security boundary; this is a usability layer only).
 */

import { checkPermission } from "@/stores/auth-store";

/**
 * The smallest authorization unit a UI surface can declare (§7).
 *
 * - `string`            — a single permission key (e.g. `'lex:case:view'`). Backward
 *                         compatible with every existing nav item that used a plain
 *                         string permission.
 * - `{ anyOf: [...] }`  — satisfied when the user holds ANY one of the listed keys.
 * - `{ allOf: [...] }`  — satisfied only when the user holds ALL of the listed keys.
 */
export type PermissionRequirement =
  string | { anyOf: string[] } | { allOf: string[] };

/**
 * Evaluate whether a permission set satisfies a requirement (§7).
 *
 * `canAccess(perms, undefined)` returns `true` — an item with no declared requirement is
 * always visible (matches the historic "no permission ⇒ shown" sidebar behaviour). All
 * wildcard semantics (`*`, `lex:*`, `lex:integration:*`, `*:read`) are delegated to the
 * existing `checkPermission` resolver so this never re-implements matching.
 */
export function canAccess(
  permissions: string[],
  requirement?: PermissionRequirement,
): boolean {
  if (!requirement) return true;

  if (typeof requirement === "string") {
    return checkPermission(permissions, requirement);
  }

  if ("anyOf" in requirement) {
    return requirement.anyOf.some((permission) =>
      checkPermission(permissions, permission),
    );
  }

  if ("allOf" in requirement) {
    return requirement.allOf.every((permission) =>
      checkPermission(permissions, permission),
    );
  }

  return false;
}

/**
 * Adapter for React surfaces (sidebar / mobile nav / command palette) that hold the auth
 * store's `hasPermission` predicate rather than a raw permission array. Mirrors
 * {@link canAccess} exactly but routes each key through the supplied predicate, which
 * itself applies the same wildcard resolver. `undefined` requirement ⇒ visible.
 */
export function canAccessWith(
  hasPermission: (permission: string) => boolean,
  requirement?: PermissionRequirement,
): boolean {
  if (!requirement) return true;

  if (typeof requirement === "string") {
    return hasPermission(requirement);
  }

  if ("anyOf" in requirement) {
    return requirement.anyOf.some((permission) => hasPermission(permission));
  }

  if ("allOf" in requirement) {
    return requirement.allOf.every((permission) => hasPermission(permission));
  }

  return false;
}

/**
 * Central Lex route → permission registry (§8, §18.1). SINGLE SOURCE OF TRUTH consumed by
 * the sidebar nav config, the command palette, and (in later phases) route guards, admin
 * cards and dashboard tiles. Transcribed verbatim from the design's §8.1–§8.7 tables.
 *
 * The suite entry (`/lex`) keeps `lex:read` ONLY as a compatibility fallback inside its
 * `anyOf` (§8.1); every sub-route uses the granular `lex:<domain>:<verb>` requirement.
 */
export const LEX_ROUTE_PERMISSIONS: Record<string, PermissionRequirement> = {
  // ── 8.1 Suite entry ────────────────────────────────────────────────────────
  "/lex": {
    anyOf: [
      "lex:request:view",
      "lex:case:view",
      "lex:contract:view",
      "lex:consultation:view",
      "lex:audit:read",
      "lex:catalog:view",
      "lex:role:view",
      "lex:integration:read",
      // Compatibility fallback only — not the primary route into the suite.
      "lex:read",
    ],
  },

  // ── 8.2 Business / request routes ───────────────────────────────────────────
  "/lex/service-desk": "lex:request:view",
  "/lex/service-desk/new": "lex:request:add",
  "/lex/service-desk/[id]": "lex:request:view",
  "/lex/approvals/requests": "lex:request:approve",
  "/lex/approvals/requests/[id]": "lex:request:approve",
  "/lex/approvals/escalations": {
    anyOf: [
      "lex:request:approve",
      "lex:escalation:view",
      "lex:escalation:manage",
    ],
  },

  // ── 8.3 Case, investigation, and settlement routes ──────────────────────────
  "/lex/cases": "lex:case:view",
  // This operational panel renders report aggregates, case rows, and
  // investigation findings/subjects together. Require the complete read set so
  // a user cannot enter through one domain and receive data from another.
  "/lex/cases/control": {
    allOf: ["lex:case:view", "lex:investigation:view"],
  },
  "/lex/cases/control/overview": {
    allOf: ["lex:case:view", "lex:investigation:view"],
  },
  "/lex/cases/control/assignment": {
    allOf: ["lex:case:view", "lex:investigation:view"],
  },
  "/lex/cases/control/litigation": {
    allOf: ["lex:case:view", "lex:investigation:view"],
  },
  "/lex/cases/new": "lex:case:add",
  "/lex/cases/[id]": "lex:case:view",
  "/lex/case-timeline": "lex:case:view",
  "/lex/investigations": "lex:investigation:view",
  "/lex/investigations/new": "lex:investigation:add",
  "/lex/investigations/[id]": "lex:investigation:view",
  "/lex/investigations/[id]/report": "lex:investigation:view",
  "/lex/settlements": "lex:settlement:view",
  "/lex/settlements/new": "lex:settlement:add",
  "/lex/settlements/[id]": "lex:settlement:view",

  // ── 8.4 Contract and consultation routes ────────────────────────────────────
  "/lex/contracts": "lex:contract:view",
  "/lex/contracts/new": "lex:contract:add",
  // The contracts + consultations service-workspace panel renders both domains'
  // aggregates and record rows together. Require the read set for either domain
  // so the workspace opens for anyone who owns part of it, while each section
  // still fail-soft self-hides the domain the caller cannot see.
  "/lex/contracts/control": {
    anyOf: ["lex:contract:view", "lex:consultation:view"],
  },
  "/lex/contracts/control/assignment": {
    anyOf: ["lex:contract:view", "lex:consultation:view"],
  },
  "/lex/contracts/[id]": "lex:contract:view",
  "/lex/contracts/archived": "lex:contract:view",
  "/lex/consultations": "lex:consultation:view",
  "/lex/consultations/new": "lex:consultation:add",
  "/lex/consultations/[id]": "lex:consultation:view",
  "/lex/consultations/[id]/response": "lex:consultation:view",
  "/lex/consultations/archive": "lex:consultation:view",

  // ── 8.5 Document, drafting, and knowledge routes ────────────────────────────
  "/lex/documents": "lex:document:view",
  "/lex/documents/new": "lex:document:add",
  // WatheeqTech Reference Library — read-only Saudi legal corpus for every
  // authenticated user. `lex:reference:view` lights up if/when the dedicated
  // slug ships; `lex:read` keeps it visible to all legal personas today.
  "/lex/library": { anyOf: ["lex:reference:view", "lex:read"] },
  "/lex/knowledge-hub": { anyOf: ["lex:reference:view", "lex:read"] },
  "/lex/learning-centre": { anyOf: ["lex:reference:view", "lex:read"] },
  "/lex/policies": {
    anyOf: ["lex:catalog:view", "lex:reference:view", "lex:audit:read"],
  },
  "/lex/drafting": {
    anyOf: [
      "lex:document:add",
      "lex:document:edit",
      "lex:contract:add",
      "lex:contract:edit",
      "lex:consultation:add",
      "lex:consultation:edit",
    ],
  },
  // Backend approval-policy reads accept either the granular approval read key
  // or the legacy Lex read baseline; keep the page guard aligned with that tier.
  "/lex/workflow-policies": { anyOf: ["lex:approval:read", "lex:read"] },
  "/lex/playbooks": { anyOf: ["lex:catalog:view", "lex:document:view"] },
  "/lex/clause-library": { anyOf: ["lex:catalog:view", "lex:contract:view"] },
  "/lex/regulations": { anyOf: ["lex:catalog:view", "lex:audit:read"] },

  // ── 8.6 Insight and oversight routes ────────────────────────────────────────
  "/lex/reports/analytics": "lex:report:read",
  "/lex/reports/builder": "lex:report:read",
  "/lex/analytics/risk": { anyOf: ["lex:report:read", "lex:audit:read"] },
  "/lex/compliance": "lex:audit:read",
  "/lex/audit": "lex:audit:read",
  "/lex/entities": { anyOf: ["lex:report:read", "lex:audit:read"] },
  "/lex/calendar": {
    anyOf: [
      "lex:request:view",
      "lex:case:view",
      "lex:contract:view",
      "lex:consultation:view",
    ],
  },
  "/lex/inbox": {
    anyOf: [
      "lex:support:view",
      "lex:support:create",
      "lex:support:respond",
      "lex:request:view",
      "lex:case:view",
      "lex:contract:view",
      "lex:consultation:view",
    ],
  },
  // Ad-hoc manager tasks are visible to the contracts/consultations team and
  // Legal Director. The backend still enforces creator, assignee and reviewer
  // lifecycle rules on every command.
  "/lex/tasks": {
    anyOf: ["lex:contract:view", "lex:consultation:view", "lex:read"],
  },

  // ── 8.7 Admin and configuration routes ──────────────────────────────────────
  "/lex/admin": {
    anyOf: [
      "lex:catalog:view",
      "lex:catalog:manage",
      "lex:sla:view",
      "lex:sla:manage",
      "lex:escalation:view",
      "lex:escalation:manage",
      "lex:notification:view",
      "lex:notification:manage",
      "lex:role:view",
      "lex:role:assign",
      "lex:role:manage",
      "lex:integration:read",
      "lex:integration:manage",
      "lex:security:view",
      "lex:security:manage",
      "lex:approval:read",
      "lex:approval:admin",
    ],
  },
  "/lex/admin/working-calendars": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/service-catalog": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/service-catalog/*": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/sla-targets": { anyOf: ["lex:sla:view", "lex:sla:manage"] },
  "/lex/admin/sla-targets/*": { anyOf: ["lex:sla:view", "lex:sla:manage"] },
  "/lex/admin/escalations": {
    anyOf: ["lex:escalation:view", "lex:escalation:manage"],
  },
  "/lex/admin/escalations/*": "lex:escalation:manage",
  "/lex/admin/attachment-policies": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/attachment-policies/*": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/org-entities": {
    anyOf: ["lex:security:view", "lex:security:manage"],
  },
  "/lex/admin/org-entities/*": {
    anyOf: ["lex:security:view", "lex:security:manage"],
  },
  "/lex/admin/classifications": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/classifications/*": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  // Competent-court reference list. Same catalog tier as the sibling
  // reference-data screens: view to read, manage to mutate (the page's own
  // create/edit/delete affordances gate on lex:catalog:manage).
  "/lex/admin/courts": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  "/lex/admin/courts/*": {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  },
  // FR-WATHEEQ-005 Legal Holds register. Page self-gates on the coarse backend
  // tiers (view lex:read, apply/release lex:write); accept view OR manage so the
  // guard admits both a read-only viewer and a manage-capable operator.
  "/lex/admin/legal-holds": { anyOf: ["lex:read", "lex:write"] },
  "/lex/admin/request-approval-policies": {
    anyOf: ["lex:approval:read", "lex:approval:admin"],
  },
  "/lex/admin/request-approval-policies/*": {
    anyOf: ["lex:approval:read", "lex:approval:admin"],
  },
  // Contract approval-policy governance + its /templates sub-page share the
  // granular approval tier (view lex:approval:read, restore lex:approval:admin).
  "/lex/admin/contract-approval-policies": {
    anyOf: ["lex:approval:read", "lex:approval:admin"],
  },
  "/lex/admin/contract-approval-policies/*": {
    anyOf: ["lex:approval:read", "lex:approval:admin"],
  },
  // §13 view-OR-manage rule (see LEX_ADMIN_NAV_PERMISSIONS below): the hub and
  // sidebar show these surfaces to view OR manage holders, so the route guards
  // must accept the same set — a view-only Auditor opens the integrations
  // sub-consoles read-only, and a manage-only System Administrator must not be
  // bounced from pages they operate. Page-level mutation controls still check
  // the :manage/:read split; the server remains the security boundary.
  "/lex/admin/integrations": {
    anyOf: ["lex:integration:read", "lex:integration:manage"],
  },
  "/lex/admin/integrations/*": {
    anyOf: ["lex:integration:read", "lex:integration:manage"],
  },
  "/lex/admin/role-matrix": { anyOf: ["lex:role:view", "lex:role:manage"] },
  // Reserved for §13 surfaces whose pages have NOT shipped yet (no admin-hub
  // card links here today; the guard fails closed if a page appears without
  // updating this registry).
  "/lex/admin/role-assignments": "lex:role:assign",
  "/lex/admin/roles": "lex:role:manage",
  "/lex/admin/security": {
    anyOf: ["lex:security:view", "lex:security:manage"],
  },
  "/lex/admin/security/*": "lex:security:manage",
  "/lex/notifications": {
    anyOf: ["lex:notification:view", "lex:notification:manage"],
  },
  "/lex/notifications/*": "lex:notification:manage",
};

/**
 * Admin nav-item and direct admin page visibility (§13 "Admin Hub Redesign").
 * An admin card is hidden only when the user has "neither view nor manage". A
 * System Administrator holds the `:manage` keys but NOT the `:view` keys (see
 * backend/internal/auth/legal_roles.go), so gating these UX surfaces on `:view`
 * alone would hide or deny the persona meant to operate them.
 *
 * These requirements encode that §13 view-OR-manage rule. Page-level mutation
 * controls still check the relevant `:manage` / `:admin` key; the authoritative
 * server checks remain the security boundary.
 */
export const LEX_ADMIN_NAV_PERMISSIONS = {
  group: {
    anyOf: [
      "lex:catalog:view",
      "lex:catalog:manage",
      "lex:sla:view",
      "lex:sla:manage",
      "lex:escalation:view",
      "lex:escalation:manage",
      "lex:notification:view",
      "lex:notification:manage",
      "lex:role:view",
      "lex:role:assign",
      "lex:role:manage",
      "lex:integration:read",
      "lex:integration:manage",
      "lex:security:view",
      "lex:security:manage",
      "lex:approval:read",
      "lex:approval:admin",
    ],
  } satisfies PermissionRequirement,
  workingCalendars: {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  } satisfies PermissionRequirement,
  serviceCatalog: {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  } satisfies PermissionRequirement,
  slaTargets: {
    anyOf: ["lex:sla:view", "lex:sla:manage"],
  } satisfies PermissionRequirement,
  escalations: {
    anyOf: ["lex:escalation:view", "lex:escalation:manage"],
  } satisfies PermissionRequirement,
  attachmentPolicies: {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  } satisfies PermissionRequirement,
  orgEntities: {
    anyOf: ["lex:security:view", "lex:security:manage"],
  } satisfies PermissionRequirement,
  classifications: {
    anyOf: ["lex:catalog:view", "lex:catalog:manage"],
  } satisfies PermissionRequirement,
  legalHolds: {
    anyOf: ["lex:read", "lex:write"],
  } satisfies PermissionRequirement,
  approvalPolicies: {
    anyOf: ["lex:approval:read", "lex:approval:admin"],
  } satisfies PermissionRequirement,
  contractApprovalPolicies: {
    anyOf: ["lex:approval:read", "lex:approval:admin"],
  } satisfies PermissionRequirement,
  integrations: {
    anyOf: ["lex:integration:read", "lex:integration:manage"],
  } satisfies PermissionRequirement,
  roleMatrix: {
    anyOf: ["lex:role:view", "lex:role:manage"],
  } satisfies PermissionRequirement,
} as const;
