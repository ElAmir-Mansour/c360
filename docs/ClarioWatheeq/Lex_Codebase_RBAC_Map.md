# Lex (Watheeq) SaaS RBAC + Persona UX Design — Updated Version

> **Status:** SaaS-ready product and implementation design.
>
> **Purpose:** Convert the current Lex/Watheeq RBAC factual map into a polished SaaS authorization and user-experience model: persona-aware login, role-scoped navigation, exact action gates, role-aware landing pages, demo seeding, and an implementation plan.
>
> **Source baseline:** The existing codebase already defines 14 legal roles, a `lex:<domain>:<verb>` permission scheme, backend role expansion, JWT role plumbing, frontend navigation, session hydration, and a known gap list. This document turns that baseline into the recommended target design.
>
> **Design stance:** Backend authorization remains authoritative. Frontend permission checks improve UX only; they do not replace server-side enforcement.

---

## 1. Executive Decision

Lex should move from a coarse, suite-level RBAC experience to a **persona-first SaaS model**:

1. **Every visible route, sidebar item, command-palette item, card, tab, and action must declare the smallest required permission.**
2. **The user should never discover permissions by clicking into 403s.** Navigation should reflect what the active persona can actually do.
3. **The Lex shell should display the user's active legal persona**, including role name, tier, org unit, escalation level, and key capabilities.
4. **Post-login routing should send users to the page that matches their primary legal role.**
5. **Admin, oversight, legal operations, and business requester work must remain visually and functionally separate.**
6. **Multi-role users should use an explicit active-persona model**, not an invisible union-of-roles UX.
7. **Coarse permissions such as `lex:read` and `lex:write` should remain only as compatibility fallbacks**, not as the primary frontend UX model.

The goal is not to add more roles. The current role model is already strong. The goal is to make the SaaS interface, route protection, and product workflows faithfully express the permissions that already exist.

---

## 2. SaaS Design Principles

### 2.1 Least-privilege UX

A user should see only modules, dashboards, actions, tabs, reports, and admin cards that are relevant to their effective Lex permissions.

### 2.2 Server-authoritative authorization

The backend remains the source of truth for authorization. Frontend filtering is a usability layer only. A hidden button must not be the security boundary.

### 2.3 Role-native workspaces

The SaaS should feel different for a requester, legal officer, legal advisor, cases manager, contracts manager, auditor, and system administrator.

### 2.4 No silent denial

A blocked direct URL should render a useful access-denied page explaining:

- the required permission,
- the user's active legal role,
- whether another assigned persona can access it,
- and how to request access.

### 2.5 Active persona over union-of-roles

For Lex, a user with multiple legal roles should operate under one active legal persona at a time. This avoids confusing dashboards and reduces privilege ambiguity.

For the first implementation phase, the UI can use active persona as a UX model while the backend still evaluates assigned roles. For the mature SaaS model, backend Lex authorization should evaluate the selected `active_legal_role` for legal-domain permissions.

### 2.6 Business/legal/admin separation

Business requesters and approvers should not see internal legal operations by default. Legal operators should not see system configuration unless explicitly granted. Auditors should see evidence and reports, not mutation controls. System administrators should configure the suite, not operate legal cases.

---

## 3. Final SaaS Decisions

| Decision | Target design |
|---|---|
| Effective permissions | Computed by the backend from the authoritative code permission map, not trusted from the DB display JSON alone. |
| JWT contents | Keep role slugs in JWT. Optionally add `active_legal_role` and `permissions_version`; do not rely on JWT permissions as the only source of truth. |
| BFF/session | Extend `/api/auth/session` or add `/api/lex/me` to return active Lex persona, role metadata, and expanded effective permissions. |
| Middleware | Keep Edge middleware auth-focused unless JWT permissions are intentionally populated. Persona routing should occur immediately after session hydration. |
| Multi-role | Use an active persona picker for users with more than one legal role. Persist last selected persona per tenant/user. |
| Sidebar | Tag every Lex item with granular permission requirements. The existing sidebar filter can then hide irrelevant items. |
| Command palette | Apply the same route permission map used by the sidebar. |
| Admin hub | Gate each admin card by its own config permission, not by `lex:read`. |
| Landing | `/lex` becomes a role-personalized command center. |
| Integration permission mismatch | Normalize to `lex:integration:read` and `lex:integration:manage` unless a real intermediate editor role is introduced. Replace frontend `lex:integration:write` checks with `lex:integration:manage`. |

---

## 4. Effective Lex Session Contract

Add a backend endpoint or BFF-enriched session object that gives the frontend a complete Lex context.

Recommended endpoint:

```http
GET /api/v1/lex/me
```

Recommended response:

```ts
type LexMeResponse = {
  tenant_id: string;
  user_id: string;

  active_legal_role: LegalRoleSummary | null;
  available_legal_roles: LegalRoleSummary[];

  effective_permissions: string[];
  permission_version: string;

  persona_landing: string;
  persona_badges: PersonaBadge[];

  org_bindings: OrgBindingSummary[];
  sod_constraints: SodConstraintSummary[];

  capabilities: {
    can_request: boolean;
    can_handle_cases: boolean;
    can_handle_contracts: boolean;
    can_approve_requests: boolean;
    can_approve_cases: boolean;
    can_approve_contracts: boolean;
    can_close_matters: boolean;
    can_assign_cases: boolean;
    can_distribute_contracts: boolean;
    can_audit: boolean;
    can_manage_configuration: boolean;
    can_manage_roles: boolean;
    can_manage_integrations: boolean;
  };
};

type LegalRoleSummary = {
  slug: string;
  name_en: string;
  name_ar: string;
  tier: 'Business' | 'Legal' | 'Oversight' | 'Admin';
  org_unit: string | null;
  escalation_level: 0 | 1 | 2 | 3;
};
```

### Resolution algorithm

```ts
function resolveLexContext(user): LexContext {
  const legalRoles = user.roles.filter(role => role.slug.startsWith('legal-'));

  if (legalRoles.length === 0) {
    return {
      active_legal_role: null,
      available_legal_roles: [],
      effective_permissions: [],
      persona_landing: '/dashboard',
      access_state: 'NO_LEX_ROLE_ASSIGNED',
    };
  }

  const activeRole = selectActiveRole({
    legalRoles,
    lastSelectedRole: user.preferences.lex_active_role,
    tenantDefaultRole: null,
  });

  return {
    active_legal_role: activeRole,
    available_legal_roles: legalRoles,
    effective_permissions: expandFromAuthoritativeRoleMap(activeRole.slug),
    persona_landing: landingForRole(activeRole.slug),
    access_state: 'READY',
  };
}
```

### Important implementation detail

The effective permissions returned to the frontend should be expanded by backend code using the same permission map used for server authorization. The frontend should not become dependent on stale `roles.permissions` display metadata from the database.

---

## 5. Persona Matrix

| Role | SaaS persona | Default landing | Primary modules | Hidden by default | Key allowed actions |
|---|---|---|---|---|---|
| `legal-requester` | Employee/request initiator | `/lex/service-desk` | My Requests, New Request, My Documents, My Consultations, My Contracts | Cases, investigations, settlements, admin, audit | Create/edit own requests, contracts, consultations, documents |
| `legal-dept-manager` | Requesting department approver | `/lex/approvals/requests` | Department Requests, Approvals, Service Desk, Contracts, Case Intake | Internal investigations, settlements, legal admin | Approve requests, add case intake, add/edit contracts |
| `legal-bu-ceo` | BU executive approver | `/lex/approvals/requests` | Executive request approvals, case/contract status, analytics summary | Operational drafting, internal legal admin | Approve requests, view case/contract status |
| `legal-ceo` | Executive management | `/lex/executive` | Executive dashboard, major requests, case/contract status | Operational queues, system admin | Approve strategic requests, view high-level matters |
| `legal-director` | Head of Legal | `/lex/command-center` | All legal domains, approvals, escalations, SLA, audit read, role view | System security/integration mutation unless separately granted | Assign, approve, close, manage legal configuration |
| `legal-cases-manager` | Cases/investigations manager | `/lex/cases` | Cases, investigations, settlements, request approvals, case analytics | Contract governance/admin config unrelated to cases | Assign, approve, close cases/investigations/settlements |
| `legal-contracts-manager` | Contracts manager | `/lex/contracts` | Contracts, contract approvals, distribution, contract analytics | Case/investigation operations | Distribute, approve, close contracts |
| `legal-case-supervisor` | Case team supervisor | `/lex/cases` | Assigned cases, investigations, settlements, request approvals | Contract approvals, system admin | Edit and approve cases; edit investigations/settlements |
| `legal-contracts-supervisor` | Contract team supervisor | `/lex/contracts` | Contracts, distribution queue, contract drafting | Case ops, final contract approval/close | Add/edit/distribute contracts; no final approval/close |
| `legal-officer` | Handling lawyer | `/lex/my-work` | My cases, investigations, settlements, documents, assigned requests | Approval queues, admin, audit, role matrix | Add/edit operational legal work; no approve/close/assign |
| `legal-advisor` | Contract/consultation advisor | `/lex/consultations` | Consultations, contracts, documents, reports | Cases, investigations, settlements, case approvals | Add/edit contracts and consultations; no governance bundle |
| `legal-shared-services-manager` | Oversight and escalation monitor | `/lex/oversight` | SLA, escalations, reports, audit read, cross-domain view | Mutation controls, operational assignments | View-only oversight and escalation monitoring |
| `legal-auditor` | Compliance auditor | `/lex/compliance` | Audit, compliance, reports, role matrix, security view, all-domain read-only | All write/approve/close/assign controls | Read-only evidence review; export audit/compliance reports |
| `legal-system-admin` | Lex system administrator | `/lex/admin` | Role management, catalog, SLA, escalation, notification, integrations, security | Operational cases/contracts/settlements unless separately assigned | Manage configuration, roles, integrations, security; no operational legal actions |

---

## 6. Post-Login Routing

After successful login and session hydration, route users by active legal role.

```ts
const LEX_PERSONA_LANDING: Record<string, string> = {
  'legal-requester': '/lex/service-desk',
  'legal-dept-manager': '/lex/approvals/requests',
  'legal-bu-ceo': '/lex/approvals/requests',
  'legal-ceo': '/lex/executive',

  'legal-director': '/lex/command-center',
  'legal-cases-manager': '/lex/cases',
  'legal-contracts-manager': '/lex/contracts',
  'legal-case-supervisor': '/lex/cases',
  'legal-contracts-supervisor': '/lex/contracts',
  'legal-officer': '/lex/my-work',
  'legal-advisor': '/lex/consultations',

  'legal-shared-services-manager': '/lex/oversight',
  'legal-auditor': '/lex/compliance',
  'legal-system-admin': '/lex/admin',
};
```

### Login flow

1. User submits login.
2. Auth store receives token and stores BFF session.
3. Frontend hydrates `/api/auth/session`.
4. Frontend fetches or receives `lexContext`.
5. If `redirectTo` is present and permitted, honor it.
6. Else route to `lexContext.persona_landing`.
7. If multiple legal roles exist and no active persona is selected, show persona picker first.
8. If no legal role exists, send to `/dashboard` with a clear access message.

### Deep-link behavior

When a user opens a direct URL:

- If authenticated and permitted: render route.
- If authenticated but not permitted: render `/access-denied` with required permission and active role.
- If another assigned persona can access the route: offer “Switch persona”.
- If unauthenticated: redirect to login with `redirectTo`.

---

## 7. Permission Requirement Type

The frontend needs a shared permission requirement type so nav, commands, cards, tabs, and buttons can use the same evaluation logic.

```ts
export type PermissionRequirement =
  | string
  | { anyOf: string[] }
  | { allOf: string[] };

export function canAccess(
  permissions: string[],
  requirement?: PermissionRequirement,
): boolean {
  if (!requirement) return true;

  if (typeof requirement === 'string') {
    return checkPermission(permissions, requirement);
  }

  if ('anyOf' in requirement) {
    return requirement.anyOf.some(permission => checkPermission(permissions, permission));
  }

  if ('allOf' in requirement) {
    return requirement.allOf.every(permission => checkPermission(permissions, permission));
  }

  return false;
}
```

The existing wildcard resolver can remain, but every Lex route should move to granular `lex:<domain>:<verb>` requirements.

---

## 8. Route and Navigation Permission Map

Use this as the source of truth for `navigation.ts`, command palette registration, route guards, admin cards, and dashboard tiles.

### 8.1 Suite entry

| Item | Route | Requirement |
|---|---:|---|
| Watheeq suite entry | `/lex` | `{ anyOf: ['lex:request:view', 'lex:case:view', 'lex:contract:view', 'lex:consultation:view', 'lex:audit:read', 'lex:catalog:view', 'lex:role:view', 'lex:integration:read'] }` |

`lex:read` can remain as a compatibility fallback, but it should not be the only route into the suite.

### 8.2 Business/request routes

| Item | Route | Requirement |
|---|---:|---|
| My Requests | `/lex/service-desk` | `lex:request:view` |
| New Request | `/lex/service-desk/new` | `lex:request:add` |
| Request detail | `/lex/service-desk/[id]` | `lex:request:view` |
| Request approvals | `/lex/approvals/requests` | `lex:request:approve` |

### 8.3 Case, investigation, and settlement routes

| Item | Route | Requirement |
|---|---:|---|
| Litigation Cases | `/lex/cases` | `lex:case:view` |
| New Case | `/lex/cases/new` | `lex:case:add` |
| Case detail | `/lex/cases/[id]` | `lex:case:view` |
| Case timeline | `/lex/case-timeline` | `lex:case:view` |
| Investigations | `/lex/investigations` | `lex:investigation:view` |
| New Investigation | `/lex/investigations/new` | `lex:investigation:add` |
| Investigation detail | `/lex/investigations/[id]` | `lex:investigation:view` |
| Settlements & ADR | `/lex/settlements` | `lex:settlement:view` |
| New Settlement | `/lex/settlements/new` | `lex:settlement:add` |
| Settlement detail | `/lex/settlements/[id]` | `lex:settlement:view` |

### 8.4 Contract and consultation routes

| Item | Route | Requirement |
|---|---:|---|
| Contracts | `/lex/contracts` | `lex:contract:view` |
| New Contract | `/lex/contracts/new` | `lex:contract:add` |
| Contract detail | `/lex/contracts/[id]` | `lex:contract:view` |
| Archived Contracts | `/lex/contracts/archived` | `lex:contract:view` |
| Consultations | `/lex/consultations` | `lex:consultation:view` |
| New Consultation | `/lex/consultations/new` | `lex:consultation:add` |
| Consultation detail | `/lex/consultations/[id]` | `lex:consultation:view` |

### 8.5 Document, drafting, and knowledge routes

| Item | Route | Requirement |
|---|---:|---|
| Documents | `/lex/documents` | `lex:document:view` |
| Upload/Add Document | `/lex/documents/new` | `lex:document:add` |
| AI Drafting | `/lex/drafting` | `{ anyOf: ['lex:document:add', 'lex:document:edit', 'lex:contract:add', 'lex:contract:edit', 'lex:consultation:add', 'lex:consultation:edit'] }` |
| Playbooks | `/lex/playbooks` | `{ anyOf: ['lex:catalog:view', 'lex:document:view'] }` |
| Clause Library | `/lex/clause-library` | `{ anyOf: ['lex:catalog:view', 'lex:contract:view'] }` |
| Regulations | `/lex/regulations` | `{ anyOf: ['lex:catalog:view', 'lex:audit:read'] }` |

### 8.6 Insight and oversight routes

| Item | Route | Requirement |
|---|---:|---|
| Analytics & KPIs | `/lex/reports/analytics` | `lex:report:read` |
| Risk Analytics | `/lex/analytics/risk` | `{ anyOf: ['lex:report:read', 'lex:audit:read'] }` |
| Compliance | `/lex/compliance` | `lex:audit:read` |
| Audit Log | `/lex/audit` | `lex:audit:read` |
| Entities / Exposure | `/lex/entities` | `{ anyOf: ['lex:report:read', 'lex:audit:read'] }` |
| Calendar | `/lex/calendar` | `{ anyOf: ['lex:request:view', 'lex:case:view', 'lex:contract:view', 'lex:consultation:view'] }` |
| Inbox | `/lex/inbox` | `{ anyOf: ['lex:request:view', 'lex:case:view', 'lex:contract:view', 'lex:consultation:view'] }` |

### 8.7 Admin and configuration routes

| Item | Route | Requirement |
|---|---:|---|
| Legal Affairs Admin | `/lex/admin` | `{ anyOf: ['lex:catalog:view', 'lex:sla:view', 'lex:escalation:view', 'lex:notification:view', 'lex:role:view', 'lex:integration:read', 'lex:security:view', 'lex:approval:read'] }` |
| Working Calendars | `/lex/admin/working-calendars` | `{ anyOf: ['lex:catalog:view', 'lex:catalog:manage'] }` |
| Service Catalog | `/lex/admin/service-catalog` | `lex:catalog:view` |
| Manage Service Catalog | `/lex/admin/service-catalog/*` | `lex:catalog:manage` |
| SLA Targets | `/lex/admin/sla-targets` | `lex:sla:view` |
| Manage SLA Targets | `/lex/admin/sla-targets/*` | `lex:sla:manage` |
| Escalation Policies | `/lex/admin/escalations` | `lex:escalation:view` |
| Manage Escalations | `/lex/admin/escalations/*` | `lex:escalation:manage` |
| Attachment Policies | `/lex/admin/attachment-policies` | `lex:catalog:view` |
| Manage Attachment Policies | `/lex/admin/attachment-policies/*` | `lex:catalog:manage` |
| Org Entities | `/lex/admin/org-entities` | `lex:security:view` |
| Manage Org Entities | `/lex/admin/org-entities/*` | `lex:security:manage` |
| Classifications | `/lex/admin/classifications` | `lex:catalog:view` |
| Manage Classifications | `/lex/admin/classifications/*` | `lex:catalog:manage` |
| Request Approval Policies | `/lex/admin/request-approval-policies` | `lex:approval:read` |
| Manage Approval Policies | `/lex/admin/request-approval-policies/*` | `lex:approval:admin` |
| Integrations | `/lex/admin/integrations` | `lex:integration:read` |
| Manage Integrations | `/lex/admin/integrations/*` | `lex:integration:manage` |
| Role Matrix | `/lex/admin/role-matrix` | `lex:role:view` |
| Assign Roles | `/lex/admin/role-assignments` | `lex:role:assign` |
| Manage Roles | `/lex/admin/roles` | `lex:role:manage` |
| Security | `/lex/admin/security` | `lex:security:view` |
| Manage Security | `/lex/admin/security/*` | `lex:security:manage` |
| Notifications | `/lex/notifications` | `lex:notification:view` |
| Notification Preferences / Rules | `/lex/notifications/*` | `lex:notification:manage` |

---

## 9. Action Gate Matrix

Action-level authorization must use domain-specific permissions.

| Domain | UI action | Required permission |
|---|---|---|
| Request | View request | `lex:request:view` |
| Request | Create request | `lex:request:add` |
| Request | Edit request | `lex:request:edit` |
| Request | Approve request | `lex:request:approve` |
| Request | Close/resolve request | `lex:request:close` |
| Case | View case | `lex:case:view` |
| Case | Create case | `lex:case:add` |
| Case | Edit case | `lex:case:edit` |
| Case | Assign/reassign case | `lex:case:assign` |
| Case | Approve case/status decision | `lex:case:approve` |
| Case | Close case | `lex:case:close` |
| Investigation | View investigation | `lex:investigation:view` |
| Investigation | Create investigation | `lex:investigation:add` |
| Investigation | Edit investigation | `lex:investigation:edit` |
| Investigation | Approve investigation stage/status | `lex:investigation:approve` |
| Investigation | Close investigation | `lex:investigation:close` |
| Settlement | View settlement | `lex:settlement:view` |
| Settlement | Create settlement | `lex:settlement:add` |
| Settlement | Edit settlement | `lex:settlement:edit` |
| Settlement | Approve settlement | `lex:settlement:approve` |
| Settlement | Close settlement | `lex:settlement:close` |
| Contract | View contract | `lex:contract:view` |
| Contract | Create contract | `lex:contract:add` |
| Contract | Edit contract | `lex:contract:edit` |
| Contract | Distribute contract | `lex:contract:distribute` |
| Contract | Approve contract | `lex:contract:approve` |
| Contract | Close/archive contract | `lex:contract:close` |
| Consultation | View consultation | `lex:consultation:view` |
| Consultation | Create consultation | `lex:consultation:add` |
| Consultation | Edit/respond/archive consultation | `lex:consultation:edit` |
| Consultation | Approve consultation response | `lex:consultation:approve` |
| Consultation | Close consultation | `lex:consultation:close` |
| Document | View document | `lex:document:view` |
| Document | Upload/add document | `lex:document:add` |
| Document | Edit document metadata/content | `lex:document:edit` |
| Report | View reports/analytics | `lex:report:read` |
| Audit | View audit tab/log/evidence | `lex:audit:read` |
| SLA | View SLA config | `lex:sla:view` |
| SLA | Manage SLA config | `lex:sla:manage` |
| Escalation | View escalation config | `lex:escalation:view` |
| Escalation | Manage escalation config | `lex:escalation:manage` |
| Catalog | View catalog/classification config | `lex:catalog:view` |
| Catalog | Manage catalog/classification config | `lex:catalog:manage` |
| Notification | View notifications | `lex:notification:view` |
| Notification | Manage notification preferences/rules | `lex:notification:manage` |
| Role | View role matrix | `lex:role:view` |
| Role | Assign roles | `lex:role:assign` |
| Role | Manage role definitions | `lex:role:manage` |
| Integration | View integrations | `lex:integration:read` |
| Integration | Create/update/disable integrations | `lex:integration:manage` |
| Security | View security settings | `lex:security:view` |
| Security | Manage security settings | `lex:security:manage` |

### Explicit removals

Replace these patterns:

```ts
hasPermission('lex:write')
hasPermission('lex:approve')
hasPermission('lex:close')
```

with the relevant domain permission:

```ts
hasPermission('lex:case:approve')
hasPermission('lex:contract:distribute')
hasPermission('lex:settlement:close')
hasPermission('lex:audit:read')
hasPermission('lex:role:view')
```

---

## 10. Role-Personalized `/lex` Landing

The `/lex` page should remain the suite home, but its widgets should branch by active persona.

| Persona | Required widgets |
|---|---|
| Requester | My open requests, draft requests, SLA countdowns, recently returned items, create request CTA |
| Department Manager / BU CEO / CEO | Pending approvals, high-risk requests, overdue department items, legal response status, executive summary |
| Legal Director | Cross-domain command center, escalations, SLA breaches, approval queues, workload distribution, audit exceptions |
| Cases Manager | Case queue, unassigned cases, pending approvals, investigation status, settlement approvals, aging by lawyer |
| Contracts Manager | Contract queue, distribution queue, pending approvals, renewal/expiry risk, high-value contract exposure |
| Case Supervisor | Assigned team workload, cases awaiting review, investigation follow-up, settlement review queue |
| Contracts Supervisor | Contracts awaiting distribution, drafts in review, advisor workload, contracts needing revision |
| Legal Officer | My assigned cases, investigation tasks, settlement drafts, due dates, document requests |
| Legal Advisor | My consultations, contract drafts, documents requiring advice, clause/playbook shortcuts |
| Shared Services Manager | SLA board, escalation ladder, cross-domain aging, read-only operational health |
| Auditor | Audit exceptions, SoD checks, access review, role matrix, immutable activity log, compliance reports |
| System Admin | Configuration health, role assignments, integration status, security alerts, notification rules, seed/readiness status |

---

## 11. Sidebar Model

### 11.1 Navigation item shape

```ts
type NavItem = {
  label: string;
  href: string;
  icon?: Icon;
  permission?: PermissionRequirement;
  children?: NavItem[];
  badge?: NavBadge;
  personaHints?: string[];
};
```

### 11.2 Filtering behavior

```ts
function filterNav(items: NavItem[], permissions: string[]): NavItem[] {
  return items
    .filter(item => canAccess(permissions, item.permission))
    .map(item => ({
      ...item,
      children: item.children ? filterNav(item.children, permissions) : undefined,
    }))
    .filter(item => !item.children || item.children.length > 0);
}
```

### 11.3 UX rule

Do not show a parent group if all children are hidden. Do not show a disabled item unless it is part of an upsell/access-request pattern. For internal enterprise legal workflow, hiding is preferable to showing locked operational modules.

---

## 12. Command Palette Model

The command palette must use the same `LEX_ROUTE_PERMISSIONS` registry as the sidebar.

```ts
const allowedCommands = LEX_COMMANDS.filter(command =>
  canAccess(effectivePermissions, command.permission),
);
```

No command should route a user to a page that the sidebar would hide.

---

## 13. Admin Hub Redesign

The admin hub should become a permission-filtered grid.

| Card | View permission | Manage permission |
|---|---|---|
| Working Calendars | `lex:catalog:view` | `lex:catalog:manage` |
| Service Catalog | `lex:catalog:view` | `lex:catalog:manage` |
| SLA Targets | `lex:sla:view` | `lex:sla:manage` |
| Escalation Policies | `lex:escalation:view` | `lex:escalation:manage` |
| Attachment Policies | `lex:catalog:view` | `lex:catalog:manage` |
| Org Entities | `lex:security:view` | `lex:security:manage` |
| Classifications | `lex:catalog:view` | `lex:catalog:manage` |
| Approval Policies | `lex:approval:read` | `lex:approval:admin` |
| Integrations | `lex:integration:read` | `lex:integration:manage` |
| Role Matrix | `lex:role:view` | `lex:role:manage` |
| Role Assignments | `lex:role:assign` | `lex:role:manage` |
| Security | `lex:security:view` | `lex:security:manage` |
| Notification Rules | `lex:notification:view` | `lex:notification:manage` |

Cards should display in one of three states:

1. **Hidden:** user has neither view nor manage.
2. **Read-only:** user has view but not manage.
3. **Manageable:** user has manage.

---

## 14. Capabilities Sheet

Add a “My Lex Access” sheet from the profile menu or Lex shell footer.

It should show:

- active legal role,
- available legal roles,
- tier and escalation level,
- effective permissions grouped by domain,
- org-role bindings,
- SoD exclusions affecting the user,
- unavailable capabilities and how to request them.

Example grouping:

```txt
Requests
  ✓ View
  ✓ Add
  ✓ Edit
  ✕ Approve
  ✕ Close

Cases
  ✓ View
  ✓ Add
  ✓ Edit
  ✕ Assign
  ✕ Approve
  ✕ Close
```

---

## 15. Access-Denied UX

Replace silent redirect-to-dashboard with an explicit access page.

Recommended copy:

```txt
You do not have access to Litigation Cases.

Required permission: lex:case:view
Your active Lex role: Legal Advisor / Consultant

This role can work on consultations, contracts, and documents, but not litigation cases.
```

When applicable:

```txt
You have another role that can access this page: Cases & Investigations Section Manager.
Switch persona to continue.
```

---

## 16. Demo Seed Assignments

The demo environment should seed actual user-to-legal-role assignments, not just the role catalog.

Minimum recommended demo set:

| Demo persona | Required role |
|---|---|
| Employee requester | `legal-requester` |
| Department manager | `legal-dept-manager` |
| Legal director | `legal-director` |
| Cases manager | `legal-cases-manager` |
| Contracts manager | `legal-contracts-manager` |
| Handling lawyer | `legal-officer` |
| Legal advisor | `legal-advisor` |
| Auditor | `legal-auditor` |
| System administrator | `legal-system-admin` |

If using the existing Apex Legal demo users, assign at least:

| Existing demo hint | Assignment |
|---|---|
| Ada | `legal-director` |
| Lara | `legal-cases-manager` |
| Emeka | `legal-auditor` |

Add equivalent demo users for requester, contracts manager, legal officer, legal advisor, and system administrator if no existing user naturally maps to those personas.

Seed validation should fail readiness if:

- any of the 14 roles is missing,
- required demo role assignments are missing in demo mode,
- forbidden SoD pairs are assigned,
- seeded demo users have no effective Lex landing.

---

## 17. Backend Implementation Checklist

### 17.1 Effective permissions endpoint

Add one of:

```http
GET /api/v1/lex/me
```

or extend:

```http
GET /api/v1/users/me
GET /api/auth/session
```

with a `lexContext` object.

### 17.2 Permission expansion service

Create a reusable backend function:

```go
type EffectivePermissionService interface {
  ResolveLexContext(ctx context.Context, userID, tenantID uuid.UUID, activeRoleSlug *string) (*LexContext, error)
}
```

This service should:

1. load assigned legal roles,
2. apply active persona selection,
3. validate SoD constraints,
4. expand permissions from the authoritative role map,
5. return role metadata and capabilities.

### 17.3 Active persona endpoint

```http
POST /api/v1/lex/persona
Content-Type: application/json

{
  "role_slug": "legal-cases-manager"
}
```

Behavior:

- validate the role is assigned to the user in the tenant,
- persist last selected persona,
- optionally reissue/refresh session token with `active_legal_role`,
- return updated `lexContext`.

### 17.4 Backend authorization policy

For mature active-persona enforcement, Lex backend checks should evaluate:

```txt
active legal role permissions + platform/system bypasses explicitly allowed by policy
```

not an invisible union of all legal roles.

Until that is implemented, document that active persona is a UX model, not a backend security boundary.

### 17.5 Integration permission cleanup

Current target:

- `lex:integration:read` for viewing,
- `lex:integration:manage` for creating, editing, disabling, replaying, and operating integrations.

Remove frontend checks for `lex:integration:write` unless the backend permission scheme adds that verb formally.

---

## 18. Frontend Implementation Checklist

### 18.1 Add central route permission registry

```ts
export const LEX_ROUTE_PERMISSIONS: Record<string, PermissionRequirement> = {
  '/lex/service-desk': 'lex:request:view',
  '/lex/service-desk/new': 'lex:request:add',
  '/lex/cases': 'lex:case:view',
  '/lex/cases/new': 'lex:case:add',
  '/lex/investigations': 'lex:investigation:view',
  '/lex/settlements': 'lex:settlement:view',
  '/lex/contracts': 'lex:contract:view',
  '/lex/consultations': 'lex:consultation:view',
  '/lex/documents': 'lex:document:view',
  '/lex/admin/role-matrix': 'lex:role:view',
  '/lex/admin/integrations': 'lex:integration:read',
};
```

### 18.2 Update `navigation.ts`

Replace coarse Lex item permissions:

```ts
permission: 'lex:read'
permission: 'lex:write'
```

with granular requirements from `LEX_ROUTE_PERMISSIONS`.

### 18.3 Update page-level guards

Replace page gates like:

```tsx
<PermissionRedirect permission="lex:read" />
```

with route-specific gates:

```tsx
<PermissionRedirect permission="lex:case:view" />
<PermissionRedirect permission="lex:contract:view" />
<PermissionRedirect permission="lex:audit:read" />
<PermissionRedirect permission="lex:role:view" />
```

### 18.4 Update action gates

Replace `canWrite`, `canApprove`, and `canClose` with domain-specific checks.

Example:

```ts
const canEditCase = hasPermission('lex:case:edit');
const canAssignCase = hasPermission('lex:case:assign');
const canApproveCase = hasPermission('lex:case:approve');
const canCloseCase = hasPermission('lex:case:close');
const canViewAudit = hasPermission('lex:audit:read');
```

### 18.5 Add role badge

Display in the Lex shell:

```txt
Legal Advisor / Consultant · Legal tier · Escalation L0
```

For Arabic/RTL:

```txt
المستشار القانوني · الإدارة القانونية · مستوى التصعيد 0
```

### 18.6 Add persona switcher

Rules:

- Show only if user has more than one legal role.
- Switching persona refreshes `lexContext`.
- If the current page is not allowed under the new persona, route to the new persona landing.

---

## 19. Testing Matrix

### 19.1 Navigation visibility tests

| Role | Must see | Must not see |
|---|---|---|
| `legal-requester` | My Requests, New Request | Cases, Investigations, Settlements, Admin |
| `legal-advisor` | Contracts, Consultations, Documents | Cases, Investigations, Settlements, Case Approvals |
| `legal-officer` | Cases, Investigations, Settlements, Documents | Assign, Approve, Close, Admin |
| `legal-cases-manager` | Cases, Investigations, Settlements, Assign/Approve/Close | Contract final approval unless granted |
| `legal-contracts-manager` | Contracts, Distribution, Contract Approvals | Case approvals |
| `legal-auditor` | Compliance, Audit, Reports, Role Matrix | Any mutation button |
| `legal-system-admin` | Admin config, roles, integrations, security | Operational case/contract work queues |

### 19.2 Direct URL tests

For each role:

1. Open every Lex route directly.
2. Assert permitted routes render.
3. Assert forbidden routes show access-denied with required permission.
4. Assert no forbidden page silently redirects to generic dashboard.

### 19.3 Action tests

Examples:

| Scenario | Expected result |
|---|---|
| Legal officer opens case detail | Can view/edit, cannot assign/approve/close |
| Case supervisor opens case detail | Can approve, cannot close unless granted |
| Contracts supervisor opens contract detail | Can distribute, cannot approve/close |
| Auditor opens any detail page | Can view and audit, cannot mutate |
| System admin opens admin integrations | Can manage integrations |
| Legal director opens SLA config | Can manage SLA/escalation/catalog |

### 19.4 Backend policy tests

Test every elevated route:

- approve,
- close,
- assign,
- distribute,
- manage,
- role assignment,
- integration management,
- security management.

None of these should pass only because the user has coarse `lex:write`.

---

## 20. Migration Plan

### Phase 1 — Permission registry and sidebar cleanup

- Add `PermissionRequirement` type.
- Add `LEX_ROUTE_PERMISSIONS`.
- Retag all Lex navigation items.
- Filter command palette using the same registry.
- Hide empty groups.

### Phase 2 — Page and action gates

- Replace `lex:read` page gates with route-specific gates.
- Replace `lex:write`, `lex:approve`, and `lex:close` action gates with domain-specific gates.
- Gate audit tabs with `lex:audit:read`.
- Gate admin hub cards individually.

### Phase 3 — Persona-aware session and landing

- Add `lexContext` to session.
- Implement post-login role landing.
- Build role-personalized `/lex` widgets.
- Add role badge and access-denied page.

### Phase 4 — Demo seeding and validation

- Seed user-to-legal-role assignments.
- Add readiness checks for demo personas.
- Add e2e tests for each role.

### Phase 5 — Active persona enforcement

- Add persona switch endpoint.
- Persist selected persona.
- Optionally reissue JWT with `active_legal_role`.
- Update backend Lex authorization to evaluate active persona where required.

---

## 21. Acceptance Criteria

The implementation is SaaS-ready when all of the following are true:

1. A Legal Advisor cannot see or open cases, investigations, or settlements unless explicitly granted.
2. A Legal Officer can create/edit assigned legal work but cannot approve, close, or assign.
3. A Contracts Supervisor can distribute contracts but cannot approve or close them.
4. An Auditor has read-only access across evidence, audit, compliance, reports, and role matrix, with no mutation controls.
5. A System Administrator sees admin/configuration surfaces, not operational case or contract work queues.
6. The admin hub hides cards the user cannot view.
7. The command palette cannot route users to forbidden pages.
8. `/lex` shows different widgets for requester, legal operator, manager, auditor, and admin personas.
9. Login routes users to persona-appropriate landings.
10. Direct forbidden URLs show a clear access-denied page with the required permission.
11. Demo users actually hold legal roles and demonstrate all major personas.
12. Backend tests prove elevated actions do not pass through coarse `lex:write`.
13. The integration permission mismatch is removed.
14. Every Lex sidebar item, route, card, tab, and mutation action has a declared minimum permission.

---

## 22. Recommended Immediate Patch List

Apply these first for the largest SaaS UX improvement:

1. Change sidebar items from `lex:read`/`lex:write` to granular route permissions.
2. Add `LEX_ROUTE_PERMISSIONS` and reuse it in the command palette.
3. Gate admin cards individually.
4. Replace `lex:approve`/`lex:close` checks with domain-specific checks.
5. Gate audit tabs with `lex:audit:read`.
6. Replace `lex:integration:write` with `lex:integration:manage`.
7. Add post-login `landingForRole(roleSlug)`.
8. Add role badge in Lex shell.
9. Add a useful access-denied page.
10. Seed demo legal-role assignments.

---

## 23. Updated Verdict

With the changes in this document, Lex becomes a credible enterprise SaaS RBAC experience:

- backend authorization remains authoritative,
- the UI becomes role-native instead of route-generic,
- users stop encountering avoidable 403s,
- operational, oversight, business, and admin work are separated,
- demo tenants show the intended product story,
- and the product is ready for buyer-facing SaaS evaluation.

The core RBAC model does not need a rewrite. The main work is aligning navigation, landing, action gates, and session/persona behavior with the model already present in the codebase.
