# Platform Administrative Console — Design & Build Spec

> **Status:** Draft v1 for review · **Audience:** Platform engineering, CTO (Saleh), GTM (Abdullah)
> **Author:** Product/Architecture · **Date:** 2026-06-22
> **Scope:** The cross-tenant, cross-suite control plane for the **platform super-admin / SRE / owner** persona — distinct from the existing tenant-scoped `/admin` area.

This document is grounded in a direct read of the live codebase (paths and line numbers cited inline). Every capability is tagged **EXISTS** (with the file that implements it) or **GAP** (with a proposed contract). Do not treat the gaps as missing-by-accident — several are deliberate security postures (e.g. the gateway *strips* `X-Tenant-ID`), and the console must respect them.

---

## A. Verified architecture summary + corrections to the starting map

The starting map is largely accurate. The verified facts and the corrections that matter for the build follow.

### A.1 Confirmed

- **Core runtime is Go**, module `github.com/clario360/platform`, chi v5, all cmds need `GOWORK=off`. **14 long-running HTTP services** under `backend/cmd/*`: `api-gateway`, `iam-service`, `audit-service`, `license-service`, `file-service`, `workflow-engine`, `notification-service`, `automation-service`, and the seven suite services `cyber-service`, `siem-service`, `data-service`, `acta-service`, `lex-service`, `visus-service`, `clario-dr-service`. (The other ~20 `cmd/*` dirs are seeders, the migrator, the event-bus utility, simulators, and debug repro tools — not fleet members.)
- **Auth:** RS256 JWT. `auth.Claims` embeds `RegisteredClaims` + `UserID`(uid), `TenantID`(tid), `Email`, `Roles`, `Permissions`(omitempty), `SessionID`(sid) — `backend/internal/auth/jwt.go:17`. Context helpers `auth.UserFromContext`→`*ContextUser`, `auth.TenantFromContext`→`string`, `auth.ClaimsFromContext`→`*Claims` — `backend/internal/auth/context.go:29`.
- **RBAC** permission strings are `resource:action` (and three-segment `resource:sub:action`, e.g. `lex:approval:read`) — `backend/internal/auth/rbac.go`. Middleware `middleware.RequirePermission(perm string)` and `RequireAnyPermission(...perms)` — `backend/internal/middleware/auth.go:54,84`. ABAC `EnforceABAC` runs **after** RBAC.
- **Tenant lifecycle admin endpoints exist** under `/api/v1/admin/tenants/*` (provision / provision-status / deprovision / reprovision / reactivate), gated in-handler on `admin:*` — `backend/internal/onboarding/handler/admin_handler.go`, wired `backend/cmd/iam-service/main.go:545`.
- **Licensing model** is exactly the six tables named (`license_plans`, `plan_entitlements`, `tenant_licenses`, `entitlement_overrides`, `usage_counters`, `event_outbox`) — `backend/migrations/license_db/000001_init_schema.up.sql`. The service is `backend/internal/license/**` hosted by `cmd/license-service`, admin API gated on `licensing:admin`.
- **ABAC engine** exists at `backend/internal/authz` (`engine.go`, `policy.go`, `repository.go`), backed by table `abac_policies` in `platform_core` (`migrations/platform_core/000019_abac_policies.up.sql`).
- **Audit service** is hash-chained, monthly range-partitioned, in a dedicated `audit_db` — `backend/migrations/audit_db/000001_init_schema.up.sql`.
- **Observability:** shared bootstrap wires `/healthz`, `/readyz`, `/health`, `/metrics` on a separate **AdminRouter / admin port** — `backend/internal/observability/bootstrap/bootstrap.go:142`. Per-service Prometheus registries (not the global default).
- **Frontend** is Next.js 14 App Router, Arabic-first/RTL (`DEFAULT_LOCALE = 'ar'`, `backend`… `frontend/src/lib/i18n.ts:6`), TanStack Query, axios via `lib/api.ts`. The existing `/admin/*` area has the 13 feature groups listed in the map.

### A.2 Corrections (these change the build)

| # | Starting map said | Reality | Impact |
|---|---|---|---|
| C-1 | super_admin = `["admin:*","siem:supervisory_view"]` | True **in the runtime matcher** (`rbac.go:100`), but there is a **second, larger role catalog** seeded into `platform_core`/IAM (`role.go`, `000001_init_schema.up.sql:378`) where the super-admin slug carries bare `*`. The runtime gate **only resolves 4 hard-coded slugs** (`super_admin`, `tenant_admin`, `analyst`, `viewer`); IAM-seeded slugs like `security-analyst`, `ciso`, `legal-counsel` resolve to **zero** permissions. | **Foundational gap G-0** — see §G. New platform permissions must be added to the hard-coded `auth.RolePermissions["super_admin"]`, not just the DB. |
| C-2 | wildcard `"resource:action"` with wildcards | `admin:*` is **prefix-matched** (`admin:` matches `admin:tenants`, `admin:console`); but **bare `*` matches only by exact-equality** in the Go matcher (`rbac.go:139`). Frontend `checkPermission` (`auth-store.ts:112`) treats `*` as universal and also supports `resource:*` and `*:action`. | Console gating string must be chosen so the **held** wildcard matches it (see §B.4 / §G). |
| C-3 | impersonation / "act-as" feasible | **No backend support anywhere.** The gateway *actively strips* client `X-Tenant-ID` to prevent it (`proxy_headers.go:13`). No code mints a JWT for another principal. | Impersonation is a **net-new backend capability** with heavy security review (§E.2, §I). |
| C-4 | tenant statuses incl. provisioning | `TenantStatus` enum = `active, inactive, suspended, trial, onboarding, deprovisioned` (`model/tenant.go:12`). In-flight provisioning lives in a **separate** `OnboardingProvisioningStatus` enum (`pending, provisioning, completed, failed`). | The console must read **two** sources to show "mid-provisioning". |
| C-5 | "suspend" a tenant | The only suspend is `PUT /api/v1/tenants/{id}/status {status:"suspended"}` which **just flips a column** — it does **not** revoke sessions or API keys. A "suspended" tenant keeps working until tokens expire. | Need a **real** suspend endpoint (§F). Flag this prominently to operators. |
| C-6 | audit `prev_hash` | Column/field is **`previous_hash`** (+ `entry_hash`), not `prev_hash` (`audit/model/audit.go:26`). Genesis = `"GENESIS"`. | Type accuracy. |
| C-7 | audit super-admin can query all tenants | A super-admin can pivot to **exactly one** other tenant via `?tenant_id=` (`tenant_guard.go:29`). **No all-tenants query.** Audit routes have **no RBAC gate at all** — any authenticated user can export and even **DELETE partitions** (`admin_handler.go:138`). | All-tenants query + route RBAC are gaps (§F). |
| C-8 | Prometheus `/metrics` per service | True, **except** `notification-service` (main port 8090) and `workflow-engine` (main port 8083) use a *different* framework and the **default** registry — no admin port. And the gateway's rich `gw_*` metrics live on a registry that is **never attached to any handler** (`metrics.go:51`), so they are **not scrapeable as wired**. | Fleet-health scraper must special-case these; gateway metrics need wiring (§F gap). |
| C-9 | tenant detail route `[id]` | Folder is **`[tenantId]`** (`frontend/src/app/(dashboard)/admin/tenants/[tenantId]/`). | Path accuracy for the build. |
| C-10 | nav items support `labelAr` | **No `labelAr` field** on `NavItem`/`NavSection`. i18n is a separate typed dictionary (`useT()` + `lib/i18n/messages.ts`). | Localize nav labels via the dictionary, not a nav field (§D, §H). |
| C-11 | one DataTable; tones incl. gold/rose | **Two** DataTables: lightweight `shared/data-table.tsx` (`Column<T>`) and a heavier TanStack `shared/data-table/data-table.tsx`. `StatTone` `gold`→`kpi-theme-amber`, `rose`→`kpi-theme-red`, `slate`→`kpi-theme-primary` (no literal gold/rose CSS). | Screen specs pin the exact component (§E). |
| C-12 | license-service / AI governance are standalone | `license-service` is its own binary. **AI governance (`/api/v1/ai/*`) is hosted inside `iam-service`** (`backend/internal/aigovernance`, wired in `cmd/iam-service/main.go`), single-tenant via JWT + RLS. | Affects where the fleet-AI endpoint should live. |

### A.3 The canonical suite → service → entitlement map (verified)

Authoritative source is the gateway route table `backend/internal/gateway/config/routes.go:58-146` (field `RouteConfig.Entitlement`) plus the service registry (`routes.go:160-174`).

| Suite (UI) | Service binary | Main port | Admin port | Route prefix | Entitlement key | Frontend section |
|---|---|---|---|---|---|---|
| Cyber | `cyber-service` | 8085 | 9085* | `/api/v1/cyber`, `/api/v1/rca` | `suite.cyber` | `/cyber` |
| SIEM | `siem-service` | 8094 | 9082 | `/api/v1/siem` | `suite.siem` | (no section) |
| Data | `data-service` | 8086 | 9086* | `/api/v1/data` | `suite.data` | `/data` |
| Acta | `acta-service` | 8087 | 9087 | `/api/v1/acta` | `app.acta` | `/acta` |
| Watheeq/Lex | `lex-service` | 8088 | 9087† | `/api/v1/watheeq`, `/api/v1/lex` | `app.watheeq` | `/lex` |
| Visus/BOSALAH | `visus-service` | 8089 | 9089 | `/api/v1/visus` | `app.bosalah` | `/visus` |
| ClarioDR | `clario-dr-service` | 8097 | 9097 | `/api/v1/dr` | `suite.datastream` | `/dr` |
| — gateway | `api-gateway` | 8080 | 9080 | — | (n/a) | — |
| — IAM (+AI gov) | `iam-service` | 8081 | 9081 | `/api/v1/{users,roles,tenants,ai,...}` | (none — not plan-gated) | — |
| — audit | `audit-service` | 8084 | 9084* | `/api/v1/audit` | (none) | — |
| — license | `license-service` | 8096 | 9096 | `/api/v1/licensing` | (none) | — |
| — file | `file-service` | 8091 | 9091* | `/api/v1/files` | (none) | — |
| — workflow | `workflow-engine` | 8083 | **none (main port)** | `/api/v1/workflows` | (none) | — |
| — notification | `notification-service` | 8090 | **none (main port)** | `/api/v1/notifications` | (none) | — |
| — automation | `automation-service` | 8098 | 9098 | `/api/v1/automation` | (none) | — |

\* admin port derived from `ADMIN_PORT`/`MetricsPort` (default `90xx`); † lex defaults 9087 but is registered behind the gateway at 8088. The fleet-health endpoint must carry this table as config, not hard-code it.

The eight entitlement keys (`suite.cyber|data|siem|datastream`, `app.acta|watheeq|bosalah`, `seats.users`) are **duplicated across three places** (gateway `routes.go`, license seed SQL, and a comment) with **no single Go registry** — a small but real source-of-truth gap (§F).

---

## B. Recommendation: a new top-level `/platform` area (not an extension of `/admin`)

**Recommendation: build a distinct top-level `/platform` area, gated so only the super-admin persona ever sees it.** This is the default in the brief, and the codebase evidence strongly supports it.

### B.1 Why a separate area (evidence-based)

1. **`/admin` is structurally tenant-scoped.** Every `/admin/*` page except `/admin/tenants` derives its tenant from the JWT — `lib/api.ts:28` injects only `Authorization: Bearer <jwt>`, **no** `X-Tenant` header or `tenant_id` param. So `/admin/users`, `/admin/audit`, `/admin/billing`, `/admin/ai-governance` all show **the operator's own tenant**. A platform operator needs the opposite default: *all* tenants. Overloading `/admin` would force every page into a confusing dual-mode.
2. **The IA already treats `/admin` as a "global" section.** `navigation.ts` filters sections by route via `filterSectionsForRoute` (`navigation.ts:105`), and `admin` is **not** in `SUITE_ROUTE_SEGMENTS` (`navigation.ts:92`), so the Administration section renders on *every* route. `platform` is likewise absent from that tuple, so a new `/platform` section is automatically global and reachable everywhere — **zero routing changes needed**, just one new `NavSection`.
3. **Clean permission isolation.** The sidebar drops a whole section when the user lacks its `permission` (`sidebar.tsx:43`). Gate the new section on a string only the super-admin wildcard matches and tenant-admins never render it — no per-item leakage, no risk of a tenant-admin discovering cross-tenant controls.
4. **Different blast radius.** `/platform` actions are cross-tenant and destructive (deprovision *any* tenant, force-open a breaker, change a plan). Keeping them in a visually and routationally distinct shell (its own hero, its own colour accent) reduces "wrong-tenant" operator error.

### B.2 Relationship to the existing `/admin/tenants`

`/admin/tenants/*` is already a cross-tenant surface (lists/provisions/suspends arbitrary tenants — `tenants/page.tsx`, `use-tenants.ts`). It is the closest existing analogue to the console. **Plan: re-home its capabilities under `/platform/tenants` and leave a thin redirect** (or keep `/admin/tenants` as a deep-link target during transition). We do **not** duplicate logic — the new tenant screens reuse the existing `use-tenants.ts` hooks and DTOs.

### B.3 Shell

`/platform` lives under the same `(dashboard)` route group so it inherits the `DashboardLayout` (sidebar, header, WebSocket provider, command palette). It is **not** a new route group. Each page wraps its body in `<PermissionRedirect permission="admin:console">` (the same primitive `/admin/ai-governance` uses with `admin:read`).

### B.4 The gating string (important nuance)

Per correction **C-2**, the *held* wildcard must match the *required* string:
- super_admin's effective permission is `admin:*` (runtime) and/or `*` (IAM/dev). Frontend `checkPermission` matches `admin:*` against a required `admin:<x>` (resource-wildcard) and matches `*` against anything.
- A required string like `platform:read` is matched by `*` but **not** by `admin:*` (different resource) — so if a super-admin's token only carries `admin:*`, a `platform:read` gate would **hide the console from them**. That is a trap.

**Therefore: gate the frontend on `admin:console`** (matched by `admin:*` and `*`, never by `tenant_admin`). On the **backend**, P0 reuses the existing `admin:*` (`PermAdminAll`) check that the tenant-lifecycle endpoints already use; P1 introduces a granular `platform:*` catalog *added to the hard-coded super_admin role* (§G) so capabilities can later be delegated without handing out full `admin:*`.

---

## C. Information architecture / sitemap

All routes live under `frontend/src/app/(dashboard)/platform/`. Every page wraps in `<PermissionRedirect permission="admin:console">`. P-tags = delivery phase (§I).

| Route | Screen | Purpose | Frontend gate | Backend gate (P0 → target) | Phase |
|---|---|---|---|---|---|
| `/platform` | **Overview** | Fleet health, tenant/seat/license rollups, critical audit, expiries | `admin:console` | `admin:*` → `platform:fleet:read` | P0 |
| `/platform/tenants` | **Tenants** | Cross-tenant list/search/filter; lifecycle actions | `admin:console` | `admin:*` → `platform:tenants:read/write` | P0 |
| `/platform/tenants/[tenantId]` | **Tenant detail** | Drill-in: users, suites, license, usage, activity, AI, impersonate | `admin:console` | `admin:*` → `platform:tenants:read` | P0 |
| `/platform/suites` | **Suite catalog** | Per-suite enablement across estate, route→entitlement map, health | `admin:console` | `admin:*` → `platform:suites:read/write` | P0 |
| `/platform/licensing` | **Licensing** | Plan catalog, per-tenant licenses, seats vs usage, overrides, expiries | `admin:console` | `licensing:admin` | P0 |
| `/platform/licensing/plans/[planKey]` | Plan detail | Plan entitlements editor | `admin:console` | `licensing:admin` | P1 |
| `/platform/identity` | **Identity & Access** | System role/permission catalog, ABAC policies, user lookup, session/key oversight | `admin:console` | `admin:*` → `platform:identity:*`, `platform:abac:*` | P1 |
| `/platform/audit` | **Audit (platform-wide)** | Cross-tenant query, chain integrity, export, partitions | `admin:console` | `admin:*` → `audit:read:all` | P1 |
| `/platform/services` | **Service & infra ops** | Health/metrics per service, breakers, kill switches, rate limits, outbox/jobs | `admin:console` | `admin:*` → `platform:gateway:read/admin` | P1 |
| `/platform/ai` | **AI governance (fleet)** | Cross-tenant model registry, drift rollup | `admin:console` | `admin:*` → `platform:ai:read` | P2 |
| `/platform/provisioning` | **Provisioning oversight** | In-flight tenant provisioning, 12-step pipeline status | `admin:console` | `admin:*` | P2 |

`/platform` (index) renders the Overview directly (unlike `/admin` which `redirect()`s to `/admin/users` — `admin/page.tsx:4`).

---

## D. Navigation integration (exact `config/navigation.ts` change)

Add **one** `NavSection` to the `navigation` array. No change to `SUITE_ROUTE_SEGMENTS` (leaving `platform` out keeps the section global/always-visible). Verified types: `NavSection { id; label; permission; items }`, `NavItem { id; label; href; icon; permission?; badge?; children? }`, `BadgeConfig { endpoint; key; variant; pollIntervalMs; topics? }` (`navigation.ts:60-85`).

```ts
// frontend/src/config/navigation.ts — append to the `navigation` NavSection[] array.
// Icons Server, Building2, LayoutGrid, KeyRound, ScrollText, Activity, BrainCircuit,
// Boxes are from lucide-react (import alongside the existing icons at the top).
{
  id: 'platform',
  label: 'PLATFORM',                       // localize via dictionary, see §H
  permission: 'admin:console',             // matched by admin:* and * ; never by tenant_admin
  items: [
    { id: 'platform-overview', label: 'Overview',     href: '/platform',              icon: Server,        permission: 'admin:console' },
    { id: 'platform-tenants',  label: 'Tenants',      href: '/platform/tenants',      icon: Building2,     permission: 'admin:console',
      badge: { endpoint: '/api/v1/platform/tenants/summary', key: 'attention', variant: 'warning', pollIntervalMs: 60000, topics: ['platform.tenant.lifecycle'] } },
    { id: 'platform-suites',   label: 'Suites',       href: '/platform/suites',       icon: LayoutGrid,    permission: 'admin:console' },
    { id: 'platform-licensing',label: 'Licensing',    href: '/platform/licensing',    icon: Boxes,         permission: 'admin:console',
      badge: { endpoint: '/api/v1/platform/licensing/expiring/count', key: 'count', variant: 'destructive', pollIntervalMs: 300000 } },
    { id: 'platform-identity', label: 'Identity',     href: '/platform/identity',     icon: KeyRound,      permission: 'admin:console' },
    { id: 'platform-audit',    label: 'Audit',        href: '/platform/audit',        icon: ScrollText,    permission: 'admin:console' },
    { id: 'platform-services', label: 'Services',     href: '/platform/services',     icon: Activity,      permission: 'admin:console',
      badge: { endpoint: '/api/v1/platform/fleet/summary', key: 'unhealthy', variant: 'destructive', pollIntervalMs: 30000, topics: ['platform.fleet.health'] } },
    { id: 'platform-ai',       label: 'AI Governance',href: '/platform/ai',           icon: BrainCircuit,  permission: 'admin:console' },
  ],
}
```

**Badge mechanics (verified):** `useBadgeCounts` (`hooks/use-badge-counts.ts`) fetches each `endpoint` via `apiGet`, reads `payload[key]` as a number, polls every `pollIntervalMs` (clamped to a 120s base, doubled when collapsed, paused when `document.hidden`), and force-refetches on matching WebSocket `topics`. Each badge endpoint must return an object with the named numeric `key` (e.g. `{ unhealthy: 2 }`). All three badge endpoints above are **GAPs** (§F).

**Localization:** because `NavItem` has no `labelAr`, the `label` strings are rendered as-is by `SidebarNavItem`. To honour Arabic-first, either (a) the sidebar maps `label`→dictionary key, or (b) we accept English nav labels for v1 and localize page bodies. Recommended: add a small `t()` lookup in `SidebarNavItem` keyed by `item.id` against a new `nav.*` namespace in `messages.ts` (see §H). This is a generic improvement, not console-specific.

---

## E. Screen-by-screen specs

Page anatomy convention (verified across `/admin/*`): `'use client'` → `<PermissionRedirect>` → `<PageHeader>` → KPI row (`KpiCard`/`DetailStatCard`) → filters (`FilterConfig[]` + `SearchInput`) → `DataTable` (+ `useDataTable`) → `DetailPanel`/`ConfirmDialog` for drill-in/actions. Data via `useApiQuery(key[], url)` / `apiGet`/`apiPost` (`hooks/use-api.ts`, `lib/api.ts`). All destructive cross-tenant actions use `ConfirmDialog` with `variant="destructive"` and `typeToConfirm` set to the tenant slug.

### E.1 — Screen 1: Platform Overview (`/platform`) — **must-have, reference screen**

**Layout**
- `PageHeader` — `title="Platform Console"`, `eyebrow="Operator"`, `stats={[{label:'Tenants',value},{label:'Services healthy',value},{label:'Seats used',value}]}` (the glass stat tiles), `actions` = a refresh button + last-updated timestamp.
- **Fleet KPI row** (4× `KpiCard`): Services healthy/total (`tone` `emerald`/`rose` by ratio), Active tenants, Seats used vs licensed, Open critical audit events (24h).
- **Service health grid** — a `DataTable` (lightweight `shared/data-table.tsx`) of services with columns: name, suite/role, `StatusBadge` for status (healthy/degraded/unhealthy/unknown), readiness (per-dependency dots from `checks`), `circuit_breaker` state, error-rate %, p95 latency, version. Row click → side `DetailPanel` with the raw `/health` JSON + metric sparkline (`charts/line-chart.tsx`).
- **Two side panels:** (a) *License expiries* — compact list of licenses expiring ≤30d / in grace / expired (rose/gold tones); (b) *Recent critical audit* — last N `severity in (high,critical)` audit events across tenants, each linking to `/platform/audit`.
- **Provisioning ticker** — any tenant with `OnboardingProvisioningStatus = provisioning`, showing `progress_pct`.

**Key data → source**
- Fleet health → **GAP** `GET /api/v1/platform/fleet/health` (§F). Until built, the screen degrades gracefully to the gateway aggregator `GET {gateway-admin}/health` (liveness only, no metrics).
- Tenant rollup → **GAP** `GET /api/v1/platform/tenants/summary`.
- Seat rollup → **GAP** `GET /api/v1/licensing/admin/usage/rollup?key=seats.users`.
- License expiries → **GAP** `GET /api/v1/licensing/admin/licenses/expiring?within_days=30`.
- Critical audit → **GAP** `GET /api/v1/audit/admin/logs?all_tenants=true&severity=high,critical&...`.

**Primary actions:** none destructive (read-only dashboard). Refresh; deep-links into the other screens.

**States**
- *Loading:* `LoadingSkeleton variant="kpi"` for the KPI row, `variant="table"` for the grid.
- *Empty:* shouldn't happen for fleet (services are static); per-panel `EmptyState` if a sub-feed is empty ("No expiring licenses").
- *Error / partial:* the fleet endpoint returns **HTTP 200 even when degraded** (so the dashboard always renders) — render per-service `scrape_error` inline; use `ErrorState variant` only when the whole endpoint is unreachable. `detectVariant(error)` auto-classifies 401/403→permission.
- *Edge:* services `notification`(8090)/`workflow`(8083) are scraped on their **main** port — surface a tooltip noting they have no admin port; a `null` metrics block renders "—" not "0".

**Realtime:** poll the lightweight `GET /api/v1/platform/fleet/summary` every 30s for the header/badge; full grid refresh on demand or 60s. Optionally subscribe to `platform.fleet.health` WS topic via the realtime store for instant tile flips.

> A buildable reference implementation of this screen (page + hook + nav diff) is in **Appendix J**.

### E.2 — Screen 2: Tenant Management (`/platform/tenants`, `/platform/tenants/[tenantId]`) — must-have

**List (`/platform/tenants`)**
- `PageHeader` + KPI row: total / active / suspended / trial / deprovisioned (`StatusBadge` tones).
- Filters (`FilterConfig[]`): status (multi-select of the 6 enum values), subscription_tier (free/starter/professional/enterprise), `SearchInput` (name/slug/domain).
- `DataTable` columns: name+slug, status (`StatusBadge`), tier, **users** (count), **seats used/limit**, **license state** (active/in_grace/expired/suspended), storage, last activity, created. Row → detail.
- **Reuse** `frontend/src/hooks/use-tenants.ts` (already calls `/api/v1/tenants`, `/provision`, status mutations).

**The aggregates problem:** today `GET /api/v1/tenants` returns plain `TenantResponse` rows with **no** user counts, seats, license state or last-activity, and `TenantResponse` even omits `deprovisioned_at/retain_until` (`dto/tenant_dto.go:49`). Computing them client-side would be N× round-trips. → **GAP** `GET /api/v1/admin/tenants` returning `AdminTenantSummary[]` with the aggregates in one call (§F). P0 fallback: render the plain list and lazy-load license/usage per visible row.

**Detail (`/platform/tenants/[tenantId]`)** — reuse the existing 5-tab `tenant-detail.tsx` shell, extended:
- **Overview:** status, tier, `TenantUsage` KPIs (`active_users`, `api_calls`, `storage`, per-suite usage) from `GET /api/v1/tenants/{id}/usage` (EXISTS).
- **License tab (new):** plan, seats, state, expiry/grace, overrides — from `GET /api/v1/licensing/admin/tenants/{tenantID}/license` (EXISTS) + overrides list (**GAP**, §F).
- **Suites tab (new):** which entitlements the tenant holds and their resolved state — from `GET /api/v1/licensing/admin/tenants/{tenantID}/entitlements` (**GAP**).
- **AI tab (new, P2):** `GET /api/v1/admin/tenants/{id}/ai-summary` (**GAP**).
- **Users / Audit tabs:** deep-link to `/platform/identity?tenant_id=` and `/platform/audit?tenant_id=`.

**Primary actions (each → `ConfirmDialog` + audit):**

| Action | Endpoint | Status | Confirm | Audit |
|---|---|---|---|---|
| Provision (multi-DB) | `POST /api/v1/admin/tenants/provision` | EXISTS | type slug | event `tenant.provision.*` |
| Provision status (poll) | `GET /api/v1/admin/tenants/{id}/provision-status` | EXISTS | — | — |
| Reprovision | `POST /api/v1/admin/tenants/{id}/reprovision` | EXISTS | type slug | yes |
| Deprovision | `POST /api/v1/admin/tenants/{id}/deprovision {reason, retain_days}` | EXISTS (writes audit internally) | type slug + reason | yes |
| Reactivate | `POST /api/v1/admin/tenants/{id}/reactivate` | EXISTS (only within `retain_until`) | type slug | yes |
| **Suspend (real)** | `POST /api/v1/admin/tenants/{id}/suspend {reason}` | **GAP** — status flip alone (`PUT .../status`) does **not** cut access (C-5) | type slug + reason | yes |
| Unsuspend | `POST /api/v1/admin/tenants/{id}/unsuspend` | **GAP** | type slug | yes |
| **Impersonate / view-as** | `POST /api/v1/admin/tenants/{id}/impersonate {reason, ttl}` | **GAP — net-new, security-sensitive (C-3)** | type slug + reason, read-only default | mandatory `tenant.impersonation.started/stopped` |

**Impersonation — security call-out (must read):** there is **no** backend path to mint a token for another tenant, and the gateway *strips* `X-Tenant-ID` precisely to stop this. Building it means deliberately creating a cross-tenant trust path. Hard requirements: (1) short hard TTL (≤15 min); (2) **read-only by default** (the minted token carries a `readonly` claim honoured by services, or routes through a read-only gateway profile); (3) carries `impersonated_by`/`act_as` claims and an `X-Impersonated-By` propagation header so every downstream action is attributable; (4) **mandatory, non-bypassable** audit on start and stop; (5) a visible banner in the impersonated session; (6) gated on a dedicated `platform:tenants:impersonate` permission, never plain `admin:*`. This is an explicit decision for the human (§I, OQ-1).

**States:** loading → `LoadingSkeleton variant="table"`; empty → `EmptyState` "No tenants match"; provisioning row shows a progress chip; deprovisioned rows show `retain_until` countdown and disable destructive actions except Reactivate.

### E.3 — Screen 3: Suite Catalog & Enablement (`/platform/suites`) — must-have

**Layout**
- KPI row: # suites, # tenants, total active entitlements, suites with a health alert.
- A **matrix / catalog**: one card or table row per suite (from the §A.3 map) showing: display name, service health (from fleet endpoint), route prefix(es), entitlement key, contract/version (`RouteConfig.Contract` — `routes.go:23`), # tenants enabled. Expand a suite → list of tenants with that entitlement and a per-tenant enable/disable toggle.
- Use the lightweight `DataTable` for the per-suite tenant list; `StatusBadge` for enablement; `MetricTile` for the per-suite counts.

**Enable/disable per tenant** maps to an **entitlement override**: disabling suite X for tenant T = `PUT /api/v1/licensing/admin/tenants/{T}/overrides/{suite.X} {limit: 0, reason}` (limit 0 = revoked — verified semantics, `service.go:398`); re-enable = `DELETE` that override (restore plan default). Both EXISTS, both `licensing:admin`, both → `ConfirmDialog` + emit `license.override_set/removed` (already wired to `event_outbox`).

**Route→entitlement map view:** read-only table of `{prefix, service, entitlement, public, group, contract}`. Source is a compiled Go slice with **no read API** → **GAP** `GET /api/v1/gateway/admin/routes` (§F). P0 fallback: ship the map as a static TS constant mirroring `routes.go` (flag drift risk) or derive from a new `GET /api/v1/licensing/admin/entitlement-keys`.

**States:** a suite whose service is down shows a degraded badge but keeps the toggle enabled (entitlement state is independent of liveness). Toggling a suite a tenant doesn't have a plan for warns that the override will be created.

### E.4 — Screen 4: Licensing & Entitlements (`/platform/licensing`) — must-have

**Layout (tabbed):**
- **Plans tab:** `DataTable` of catalog plans (`GET /api/v1/licensing/admin/plans`, EXISTS) → row click opens `/platform/licensing/plans/[planKey]` with the entitlements editor (`PUT .../plans/{key}/entitlements`, EXISTS). Lifecycle: create / update / retire / reactivate (all EXISTS).
- **Tenant licenses tab:** fleet table of every tenant's license — plan, state, seats used/limit, expires_at, grace. → **GAP** `GET /api/v1/licensing/admin/tenants` (no cross-tenant query exists today). Row actions: assign/change license (`POST .../tenants/{id}/license`, EXISTS), suspend/resume license (EXISTS), issue offline license (`POST .../offline-license`, EXISTS).
- **Overrides:** per-tenant entitlement overrides — set/delete EXIST, but **no read/list endpoint** (the repo `ListOverrides` is unexposed) → **GAP** `GET /api/v1/licensing/admin/tenants/{id}/overrides`.
- **Usage & seats:** seats vs `usage_counters`. Admin read of another tenant's usage doesn't exist (only the tenant-self `/entitlements`) → **GAP** `GET /api/v1/licensing/admin/tenants/{id}/usage` and fleet rollup `GET /api/v1/licensing/admin/usage/rollup`.
- **Expiries panel:** licenses expiring/in-grace/expired → **GAP** `GET /api/v1/licensing/admin/licenses/expiring?within_days=` (the index `idx_tenant_licenses_expiry` exists; no query uses it).

**Computed license state** (`active|in_grace|expired|suspended`) is derived server-side by `TenantLicense.State()` (`model.go:93`) — render it via `StatusBadge`, do not recompute on the client.

**Primary actions → audit:** assign/change plan, set/clear override, suspend/resume license, issue offline license — all already emit `license.*` events to `event_outbox` (verified `service.go:94`). Wrap each in `ConfirmDialog`; seat/plan downgrades that drop below current usage must warn.

### E.5 — Outlines for phased screens (5–9)

**5. Identity & Access (`/platform/identity`, P1)**
- *Role/permission catalog:* render the system roles + permission strings with wildcard semantics explained. Source: the hard-coded `auth.RolePermissions` (4 slugs) **and** the IAM-seeded catalog — reconcile and surface the divergence (G-0). Read-only v1.
- *ABAC policies:* full CRUD + a **simulate** action. **Entire CRUD is a GAP** — `abac_policies` is writable only by raw SQL today (`authz/repository.go` is read-only). Proposed API in §F. UI: `DataTable` of policies (effect/action/resource_type/priority/enabled), `DetailPanel` editor for conditions, a "Simulate" form posting a subject/resource/action.
- *Cross-tenant user lookup:* **GAP** `GET /api/v1/admin/users/search` (today `/users` is hard-scoped to the JWT tenant; `GetByEmailGlobal` is internal-only).
- *Session/API-key oversight:* per-tenant key listing exists (`/api/v1/api-keys`); cross-tenant oversight + revocation is a partial gap.

**6. Audit & Compliance (platform-wide) (`/platform/audit`, P1)**
- Reuse the `/admin/audit` tabbed shell (Dashboard/Logs/Export/Integrity/Partitions). Differences: **all-tenants** query (today only single-tenant pivot — C-7), a tenant column, and **route RBAC** (today *none*). 
- *Cross-tenant query* → **GAP** `GET /api/v1/audit/admin/logs?all_tenants=true`. *Global integrity* → **GAP** `POST /api/v1/audit/admin/verify`. *Async export with job tracking* → **GAP** (handler returns 202 but no job store). Partition archive/delete must be gated to platform-admin (today ungated — security finding).

**7. Service & Infra Ops (`/platform/services`, P1)**
- *Health/metrics grid* (shares the fleet endpoint with Overview, fuller detail). 
- *Circuit breakers:* read state (today only via unauthenticated `/api/v1/gateway/status` or admin `/health`); force open/close/reset → **GAP** `POST /api/v1/gateway/admin/circuit/{service}`.
- *Kill switches / feature flags:* **none exist** → **GAP** `POST /api/v1/gateway/admin/killswitch`. 
- *Rate limits:* env-only today, tier resolver not even wired (C-8) → **GAP** runtime config API.
- *Outbox / background jobs:* `event_outbox` status (license + platform_core) — read view; `GET /platform/jobs/outbox` **GAP**.
- All control actions → `ConfirmDialog variant="destructive"` + audit.

**8. AI Governance — fleet view (`/platform/ai`, P2)**
- Extends `/admin/ai-governance` from single-tenant to fleet. Cross-tenant rollup **GAP** `GET /api/v1/admin/ai/fleet/models` (the per-tenant `/api/v1/ai/*` routes are RLS-locked to the JWT tenant; internal `listAllTenantIDs()` exists but isn't exposed). KPIs: total tenants/models, in-production, shadow, drift alerts; per-tenant drift health table; per-model-slug drill-down (same 20 default models are seeded into every tenant).

**9. Provisioning oversight (`/platform/provisioning`, P2)**
- Live table of tenants in `OnboardingProvisioningStatus = pending|provisioning|failed`, each expandable to the **12-step** `ProvisioningStep[]` (`provisioning.go:19`) with per-step status/duration/error and retry. Source: `GET /api/v1/admin/tenants/{id}/provision-status` (EXISTS) per tenant; a **GAP** list endpoint `GET /api/v1/admin/provisioning?status=in_flight` would avoid polling each tenant.

---

## F. API contract map (data need → endpoint)

**Legend:** ✅ EXISTS (cited) · 🟡 GAP (proposed). All proposed endpoints: RS256 JWT via the gateway, auth as noted. P0 may gate gaps on `admin:*`; target granular perms in §G.

### F.1 Existing endpoints the console reuses

| Need | Method · Path | Auth | Source |
|---|---|---|---|
| List tenants (cross-tenant, no aggregates) | `GET /api/v1/tenants` | `*` in-handler | `iam/handler/tenant_handler.go:36` ✅ |
| Get tenant | `GET /api/v1/tenants/{id}` | `*`/own | `tenant_handler.go:73` ✅ |
| Update tenant | `PUT /api/v1/tenants/{id}` | `*`/own | `tenant_handler.go:94` ✅ |
| Set status (weak suspend) | `PUT /api/v1/tenants/{id}/status` | `*` | `tenant_handler.go:121` ✅ |
| Tenant usage | `GET /api/v1/tenants/{id}/usage` | auth | `tenant_handler.go:165` ✅ |
| Provision (multi-DB async) | `POST /api/v1/admin/tenants/provision` | `admin:*` | `onboarding/handler/admin_handler.go:13` ✅ |
| Provision status | `GET /api/v1/admin/tenants/{id}/provision-status` | `admin:*` | `admin_handler.go:39` ✅ |
| Deprovision | `POST /api/v1/admin/tenants/{id}/deprovision` | `admin:*` | `admin_handler.go:60` ✅ |
| Reprovision | `POST /api/v1/admin/tenants/{id}/reprovision` | `admin:*` | `admin_handler.go:96` ✅ |
| Reactivate | `POST /api/v1/admin/tenants/{id}/reactivate` | `admin:*` | `admin_handler.go:116` ✅ |
| List plans | `GET /api/v1/licensing/admin/plans` | `licensing:admin` | `license/handler/handler.go:77` ✅ |
| Plan CRUD/lifecycle | `POST/PUT/.../retire/reactivate /api/v1/licensing/admin/plans/{key}` | `licensing:admin` | `handler.go:76-81` ✅ |
| Set plan entitlements | `PUT /api/v1/licensing/admin/plans/{key}/entitlements` | `licensing:admin` | `handler.go:82` ✅ |
| Assign / get tenant license | `POST/GET /api/v1/licensing/admin/tenants/{id}/license` | `licensing:admin` | `handler.go:85-86` ✅ |
| Suspend/resume license | `POST .../license/{suspend,resume}` | `licensing:admin` | `handler.go:87-88` ✅ |
| Set/remove override | `PUT/DELETE .../overrides/{key}` | `licensing:admin` | `handler.go:89-90` ✅ |
| Issue offline license | `POST .../offline-license` | `licensing:admin` | `handler.go:91` ✅ |
| Audit list (1-tenant pivot) | `GET /api/v1/audit/logs[?tenant_id=]` | JWT + TenantGuard | `audit/handler/audit_handler.go:33` ✅ |
| Audit verify (1 tenant) | `POST /api/v1/audit/verify` | JWT + TenantGuard | `audit/handler/admin_handler.go:37` ✅ |
| Partitions list/create/archive/delete | `.../audit/partitions...` | **none (gap)** | `admin_handler.go:87-138` ✅ |
| Per-tenant AI dashboard | `GET /api/v1/ai/dashboard` | JWT + Tenant (RLS) | `aigovernance/handler/dashboard_handler.go:34` ✅ |
| Gateway aggregated health | `GET {gw-admin}/health` | admin port | `cmd/api-gateway/main.go:296` ✅ |
| Per-service health/metrics | `GET {svc-admin}/health` · `/metrics` | admin port | `observability/bootstrap/bootstrap.go:142` ✅ |

### F.2 Gaps — proposed new endpoints

| # | Screen | Method · Path | Request → Response | Auth | Why missing |
|---|---|---|---|---|---|
| G1 | Overview/Services | `GET /api/v1/platform/fleet/health` | — → `{generated_at, overall_status, summary{total,healthy,degraded,unhealthy,unknown}, services[{name,suite,role,version,uptime,status,liveness,readiness,checks{postgres,redis,kafka},circuit_breaker,endpoints{http,admin},metrics{rps,error_rate_pct,p50,p95,p99,active,db_pool_pct,cpu_pct,mem_mb},last_scraped_at,scrape_error?}]}` | `platform:fleet:read` | No fleet aggregator; gateway `/health` is liveness-only + admin-port-private. Special-case notification(8090)/workflow(8083). |
| G1b | Overview header/badge | `GET /api/v1/platform/fleet/summary` | — → `{summary{...}, unhealthy:int}` | `platform:fleet:read` | lightweight poll for badge |
| G2 | Tenants list | `GET /api/v1/admin/tenants?search&status[]&tier[]&sort&page` | → `AdminTenantSummary[]{id,name,slug,status,subscription_tier,user_count,active_user_count,storage_used_bytes,license_state,seats,seats_used,provisioning_status,deprovisioned_at,retain_until,created_at,last_activity_at}` | `admin:*`→`platform:tenants:read` | `GET /tenants` has no aggregates; `TenantResponse` omits retention fields. Implement via LEFT JOIN counts, not N×usage. |
| G3 | Tenant detail/Overview | `GET /api/v1/platform/tenants/summary` | → `{tenant_count,active,suspended,trial,deprovisioned,total_users,total_storage_bytes,api_calls_24h,attention:int}` | `platform:tenants:read` | overview rollup |
| G4 | Tenants | `POST /api/v1/admin/tenants/{id}/suspend {reason}` · `.../unsuspend` | → `200` | `platform:tenants:write` | real suspend (revoke sessions+keys), reusing deprovisioner store methods without soft-delete (C-5). |
| G5 | Tenants | `POST /api/v1/admin/tenants/{id}/impersonate {target_user_id?,reason,ttl<=900}` → `{access_token,expires_at,impersonated_user_id,tenant_id,readonly}` | `platform:tenants:impersonate` | net-new; security-gated (C-3, OQ-1). |
| G6 | Identity | `GET /api/v1/admin/users/search?email&query&tenant_id?&status&page` → `AdminUserSummary[]{id,email,name,tenant_id,tenant_name,status,roles[],last_login_at}` | `platform:identity:read` | `/users` is tenant-locked. |
| G7 | Licensing | `GET /api/v1/licensing/admin/tenants?status&plan_key&expiring_within_days&page` → fleet license rows | `licensing:admin` | no cross-tenant license query. |
| G8 | Licensing | `GET /api/v1/licensing/admin/licenses/expiring?within_days=30` | `licensing:admin` | index exists, no query. |
| G9 | Licensing | `GET /api/v1/licensing/admin/tenants/{id}/overrides` | `licensing:admin` | repo `ListOverrides` unexposed. |
| G10 | Licensing | `GET /api/v1/licensing/admin/tenants/{id}/entitlements` · `.../usage?period=` | `licensing:admin` | only tenant-self `/entitlements` exists. |
| G11 | Licensing/Overview | `GET /api/v1/licensing/admin/usage/rollup?key=seats.users&period=` → `{total_limit,total_used,per_tenant[]}` | `licensing:admin` | no cross-tenant aggregate. |
| G12 | Suites | `GET /api/v1/licensing/admin/entitlement-keys` → `[{key,label,kind}]` | `licensing:admin` | no canonical key registry (dup'd 3×). |
| G13 | Suites/Services | `GET /api/v1/gateway/admin/routes` → `[{prefix,service,public,group,entitlement,contract}]` | `platform:gateway:read` | route map is a compiled slice. |
| G14 | Audit | `GET /api/v1/audit/admin/logs?all_tenants=true&...` → rows + `tenant_name` | `audit:read:all` | only single-tenant pivot. |
| G15 | Audit | `POST /api/v1/audit/admin/verify {date_from,date_to,tenant_ids?}` · `GET /api/v1/audit/admin/integrity/status` | `audit:integrity:verify` | per-tenant only; runner results not persisted/exposed. |
| G16 | Audit | `POST /api/v1/audit/exports` · `GET /api/v1/audit/exports/{job}` · `/download` | `audit:export` | 202 returned but no job store. |
| G17 | Audit (hardening) | add `RequirePermission` to **every** audit route; gate partition archive/delete on `audit:partition:admin` | — | routes currently ungated (security). |
| G18 | Services | `GET /api/v1/gateway/admin/circuit` · `POST .../circuit/{service} {action}` | `platform:gateway:read`/`admin` | breaker read is unauth-only; no control. |
| G19 | Services | `GET/POST /api/v1/gateway/admin/killswitch` | `platform:gateway:admin` | none exist; Redis-backed for cross-replica + restart survival. |
| G20 | Services | `GET/PUT /api/v1/gateway/admin/ratelimits[/tenants/{id}]` | `platform:gateway:admin` | env-only; also wire `NewLimiterWithTierResolver`. |
| G21 | Services (infra) | wire `gwMetrics.Registry` into a scrape surface | — | `gw_*` metrics not currently scrapeable (C-8). |
| G22 | ABAC | `GET/POST/PUT/PATCH/DELETE /api/v1/abac/policies[/{id}]` · `POST .../simulate` | `platform:abac:read`/`write` | no policy API; raw-SQL only. Must call `Repository.Invalidate(tenant)` on writes. |
| G23 | AI fleet | `GET /api/v1/admin/ai/fleet/models[?suite&drift&risk_tier]` · `GET .../fleet/models/{slug}` · `GET /api/v1/admin/tenants/{id}/ai-summary` | `platform:ai:read` | per-tenant RLS-locked; internal `listAllTenantIDs()` not exposed. |
| G24 | Provisioning | `GET /api/v1/admin/provisioning?status=in_flight` | `admin:*` | avoids per-tenant polling. |

**Cross-cutting backend gap G-0 (blocks granular gating):** `claims.Permissions` is never populated on access tokens and the runtime gate resolves only the 4 hard-coded role slugs (`rbac.go:99`). Any new `platform:*` permission must be **added to `auth.RolePermissions["super_admin"]`** to take effect via `RequirePermission`; alternatively populate `claims.Permissions` from `user.AllPermissions` in `GenerateTokenPair` (`jwt.go:93`) and match against it. P0 sidesteps this by reusing `admin:*` (already in `super_admin`).

---

## G. RBAC / permission additions

### G.1 New permission strings (add to `backend/internal/auth/rbac.go` and grant to `super_admin`)

```
console / visibility
  admin:console                  # frontend section + page gate (matched by admin:* and *)

platform namespace (granular, API-level; all granted to super_admin)
  platform:fleet:read            # fleet health + metrics rollup
  platform:tenants:read          # cross-tenant tenant + aggregates
  platform:tenants:write         # provision/suspend/deprovision/reprovision/reactivate
  platform:tenants:impersonate   # mint act-as token (separate, high-sensitivity)
  platform:suites:read
  platform:suites:write          # enable/disable suite per tenant (override)
  platform:identity:read         # cross-tenant user/session/key lookup
  platform:identity:write        # revoke session/key cross-tenant
  platform:abac:read
  platform:abac:write
  platform:gateway:read          # routes, breaker, rate-limit read
  platform:gateway:admin         # kill switch, breaker control, rate-limit write
  platform:ai:read               # fleet AI rollup

reused / existing
  admin:*                        # P0 umbrella for all of the above (already on super_admin)
  licensing:admin                # already gates the license admin API
  audit:read | audit:read:all | audit:export | audit:integrity:verify | audit:partition:admin   # NEW — audit routes are currently ungated
```

Grant model: add **all** `platform:*` + `admin:console` + the new `audit:*` strings to the hard-coded `super_admin` entry (`rbac.go:100`). Because `admin:*` already prefix-matches `admin:console`, the frontend works for super_admin immediately even before the granular strings exist; the granular strings exist so capabilities can later be delegated to a non-super operator role without `admin:*`.

### G.2 ABAC policies (optional, P2)

The console screens are RBAC-gated and don't require ABAC to function. But the **ABAC management UI** (Screen 5) needs the policy CRUD API (G22). One sensible platform policy to seed once the API exists: a `deny` policy on resource `platform.tenant` with condition `env.ip not_in <ops_cidr>` to restrict impersonation/deprovision to office/VPN egress. Author it through the new simulate→save flow, not raw SQL.

### G.3 Audit-route hardening (security finding, do regardless of console)

Audit routes (`cmd/audit-service/main.go:142`) currently require only JWT + TenantGuard — **any** authenticated tenant user can export logs and **archive/DELETE partitions**. Add `RequirePermission` per route (G17). This is a pre-existing vulnerability the console work should fix.

---

## H. Non-functionals

**Real-time vs polling.** Default to polling via TanStack Query with `refetchInterval`, matching the existing `useBadgeCounts`/`use-badge-counts.ts` pattern (120s base, paused on `document.hidden`). Cadences: fleet summary/badges 30s; tenant list on demand + 60s; license expiries 5 min; provisioning ticker 10s while any tenant is in-flight. Layer WebSocket **invalidation** (not data push) via the realtime store (`stores/realtime-store.ts`, topic→queryKey) for instant flips on `platform.fleet.health`, `platform.tenant.lifecycle`, `license.*`. Never put a fleet poll on a tight client loop — aggregate server-side.

**Performance / large sets.** Tenant and audit tables can be large. Use server-side pagination (every list gap endpoint takes `page`/`per_page`; audit caps `per_page` at 200 and `date_range ≤ 93 days` — `dto/query_dto.go`). Use the lightweight `DataTable` with server paging rather than client-side sort over thousands of rows; reserve the TanStack `data-table/` variant for toolbar-heavy screens. The fleet endpoint must fan out concurrently (like `CompositeHealthChecker`) with per-service timeouts and **always return 200** so one slow service can't blank the dashboard; cache its result ~10s server-side to absorb badge polling.

**Security & impersonation audit.** Every destructive/cross-tenant action writes to the hash chain. Two integrity caveats to fix: (1) the audit write path is best-effort Kafka (a broker outage silently drops records — `user_service.go:492`), so for *platform* destructive ops add a **transactional outbox** or a synchronous fail-closed audit write; (2) impersonation must be non-bypassably audited on start **and** stop with `impersonated_by`. Keep the gateway's `X-Tenant-ID` stripping intact; impersonation goes through the dedicated minted-token path, not header spoofing. Move the unauthenticated `GET /api/v1/gateway/status` (leaks topology) behind auth.

**i18n / RTL.** Arabic-first (`DEFAULT_LOCALE='ar'`, RTL via `<html dir>`). All console strings go into a new `platformConsole` (and `nav.platform`) namespace in **both** `ar` and `en` objects of `frontend/src/lib/i18n/messages.ts` (TS enforces key parity), consumed via `useT()` from `@/components/providers/locale-provider`. Do **not** create per-route `*-labels.ts` files (the ad-hoc pattern). Use CSS logical properties / Tailwind `ms-`/`me-`/`ps-`/`pe-` and `rtl:`/`ltr:` variants — never hard-code left/right. Numbers via `toLocaleString` (KpiCard already does this). Nav labels: extend `SidebarNavItem` to look up `nav.<item.id>` in the dictionary (small generic change) rather than adding a `labelAr` field.

**Resilience of the console itself.** Each screen degrades when a backing service is down: the Overview must render from whatever fleet data resolved; license/audit panels show `ErrorState` independently (`detectVariant` classifies 401/403→permission, 404→notFound). The console is an SRE tool — it has to work *while things are broken*.

---

## I. Phased delivery plan + open decisions

### P0 — Must-have core (Overview, Tenants, Suites, Licensing)
- **Frontend:** `/platform` shell + 4 screens reusing existing primitives and `use-tenants.ts`; nav `NavSection`; `admin:console` gate; `platformConsole` i18n namespace.
- **Backend (build in this order):**
  1. `admin:console` + `platform:fleet:read`/`tenants:read`/`tenants:write` added to `super_admin` (G-0 path).
  2. **G1/G1b** fleet health endpoint (highest leverage; unblocks Overview + Services badge).
  3. **G2/G3** admin tenant list with aggregates + overview summary.
  4. **G4** real suspend/unsuspend.
  5. **G7/G8/G9/G11** license fleet list, expiries, override read, seat rollup.
  6. **G17** audit-route RBAC hardening (security; cheap; do early).
- **Acceptance:** a super-admin can see fleet health, list/filter all tenants with seats+license state, provision/suspend/deprovision with confirm+audit, toggle a suite per tenant, and see expiring licenses.

### P1 — Identity, Audit, Services
- ABAC CRUD+simulate (**G22**), cross-tenant user search (**G6**), platform audit query+integrity+export (**G14/15/16**), gateway routes/breaker/kill-switch/ratelimit APIs (**G13/18/19/20**) and metrics wiring (**G21**), granular `platform:*` perms.

### P2 — AI fleet, Provisioning oversight, impersonation
- Fleet AI rollup (**G23**), provisioning list (**G24**), and — pending the OQ-1 decision — impersonation (**G5**) with full read-only/TTL/audit controls.

### Open questions / decisions for the human

- **OQ-1 (impersonation policy).** Build "log in as tenant"? If yes: read-only only, or read-write? TTL? Which egress/IP restriction? Who may hold `platform:tenants:impersonate`? This deliberately weakens the gateway's anti-impersonation posture — needs explicit owner sign-off. *Recommendation: P2, read-only, ≤15-min TTL, VPN-only, separate permission, mandatory dual audit.*
- **OQ-2 (granular vs umbrella perms).** Ship P0 on `admin:*` and add granular `platform:*` later, or invest in G-0 (populate `claims.Permissions`) up front so capabilities are delegable from day one? *Recommendation: `admin:*` for P0, granular in P1.*
- **OQ-3 (fleet metrics source).** Should the fleet endpoint scrape each service `/metrics` and compute rates in Go, or query a Prometheus/Grafana that already scrapes them? The latter is more accurate and cheaper but assumes Prometheus is deployed. *Recommendation: if Prometheus exists in the target env, query it; else in-Go parse with a server-side cache.*
- **OQ-4 (audit durability).** Accept best-effort Kafka audit for platform destructive actions, or invest in a transactional outbox / synchronous fail-closed write first? *Recommendation: at minimum a synchronous fail-closed audit write for deprovision/suspend/impersonate.*
- **OQ-5 (multi-region / data residency).** Is the estate single-region? If tenants are sharded across regions/DBs, the fleet and cross-tenant queries need a region dimension and fan-out. Not modelled here — confirm before P1.
- **OQ-6 (where new platform endpoints live).** New `platform:*` and admin aggregate endpoints — host in `iam-service` (already holds tenant + AI-governance admin), a new small `platform-service`, or the gateway? *Recommendation: `iam-service` for tenant/identity/fleet aggregation; keep gateway-control endpoints (G13/18/19/20) in the gateway; licensing gaps in `license-service`.*
- **OQ-7 (role-catalog reconciliation, G-0/C-1).** Two divergent role catalogs (hard-coded `auth.RolePermissions` vs IAM-seeded). Reconcile to one source of truth? This is broader than the console but the console surfaces it. *Recommendation: schedule a dedicated reconciliation; the console's Identity screen should display the divergence rather than hide it.*

---

## J. Appendix — buildable scaffold (reference: Platform Overview)

Not yet written to the app (the brief marks J optional). This is drop-in ready; say the word and I'll scaffold the route folders + wire the nav. All imports are verified against the cited files.

### J.1 File tree to create
```
frontend/src/app/(dashboard)/platform/
  layout.tsx                       # optional: shared <PermissionRedirect> + console accent
  page.tsx                         # Overview (below)
  tenants/page.tsx                 # clone of /admin/tenants, points at G2
  tenants/[tenantId]/page.tsx
  suites/page.tsx
  licensing/page.tsx
frontend/src/hooks/use-platform.ts # typed hooks for the gap endpoints (below)
frontend/src/types/platform.ts     # FleetHealth, AdminTenantSummary, ... types
```

### J.2 `hooks/use-platform.ts` (stubbed-friendly hook over the fleet endpoint)
```tsx
'use client';
import { useApiQuery } from '@/hooks/use-api';
import type { FleetHealth } from '@/types/platform';

// GET /api/v1/platform/fleet/health (gap G1). While the endpoint is unbuilt, the
// query simply errors and the screen renders its ErrorState — no mock needed.
export function useFleetHealth() {
  return useApiQuery<FleetHealth>(
    ['platform', 'fleet', 'health'],
    '/api/v1/platform/fleet/health',
    { refetchInterval: 30_000, staleTime: 10_000 },
  );
}
```

### J.3 `app/(dashboard)/platform/page.tsx` (reference Overview)
```tsx
'use client';

import { Server, Building2, Boxes, ShieldAlert } from 'lucide-react';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataTable, type Column } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { useFleetHealth } from '@/hooks/use-platform';
import type { FleetService } from '@/types/platform';

export default function PlatformOverviewPage() {
  return (
    <PermissionRedirect permission="admin:console">
      <OverviewBody />
    </PermissionRedirect>
  );
}

function OverviewBody() {
  const { data, isLoading, error, refetch } = useFleetHealth();

  const columns: Column<FleetService>[] = [
    { key: 'name', header: 'Service', render: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'role', header: 'Role' },
    { key: 'status', header: 'Health', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'error_rate_pct', header: 'Errors', align: 'right',
      render: (s) => (s.metrics ? `${s.metrics.error_rate_pct.toFixed(1)}%` : '—') },
    { key: 'p95', header: 'p95', align: 'right',
      render: (s) => (s.metrics ? `${s.metrics.p95.toFixed(0)} ms` : '—') },
    { key: 'circuit_breaker', header: 'Breaker',
      render: (s) => (s.circuit_breaker ? <StatusBadge status={s.circuit_breaker} variant="dot" /> : '—') },
    { key: 'version', header: 'Version' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Console"
        eyebrow="Operator"
        description="Fleet health and estate-wide controls."
        stats={data ? [
          { label: 'Services', value: `${data.summary.healthy}/${data.summary.total}` },
          { label: 'Tenants', value: data.summary.tenants ?? '—' },
          { label: 'Seats used', value: data.summary.seats_used ?? '—' },
        ] : undefined}
      />

      {isLoading && <LoadingSkeleton variant="kpi" />}

      {error && (
        <ErrorState variant={detectVariant(error)} error={error} onRetry={() => refetch()} />
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Services healthy" value={`${data.summary.healthy}/${data.summary.total}`}
              icon={Server} tone={data.summary.unhealthy > 0 ? 'rose' : 'emerald'} />
            <KpiCard title="Active tenants" value={data.summary.tenants ?? 0} icon={Building2} tone="sky" />
            <KpiCard title="Seats used" value={data.summary.seats_used ?? 0} icon={Boxes} tone="gold" />
            <KpiCard title="Critical events (24h)" value={data.summary.critical_audit_24h ?? 0}
              icon={ShieldAlert} tone={(data.summary.critical_audit_24h ?? 0) > 0 ? 'rose' : 'slate'} />
          </div>

          {data.services.length === 0 ? (
            <EmptyState icon={Server} title="No services reporting"
              description="The fleet health endpoint returned no services." />
          ) : (
            <DataTable<FleetService>
              columns={columns}
              data={data.services}
              getRowKey={(s) => s.name}
              ariaLabel="Fleet service health"
            />
          )}
        </>
      )}
    </div>
  );
}
```

### J.4 `types/platform.ts` (matches the G1 contract)
```ts
export interface FleetServiceMetrics {
  rps: number; error_rate_pct: number; p50: number; p95: number; p99: number;
  active: number; db_pool_pct?: number; cpu_pct?: number; mem_mb?: number;
}
export interface FleetService {
  name: string; suite?: string; role: string; version: string; uptime?: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  liveness: boolean; readiness: 'healthy' | 'degraded' | 'unhealthy';
  checks?: Record<string, { status: string; latency_ms?: number }>;
  circuit_breaker?: 'closed' | 'open' | 'half-open';
  endpoints?: { http: string; admin?: string };
  metrics?: FleetServiceMetrics; last_scraped_at?: string; scrape_error?: string;
}
export interface FleetHealth {
  generated_at: string;
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  summary: {
    total: number; healthy: number; degraded: number; unhealthy: number; unknown: number;
    tenants?: number; seats_used?: number; critical_audit_24h?: number;
  };
  services: FleetService[];
}
```

This screen renders immediately against a live or stubbed G1 endpoint, uses only verified primitives (`PageHeader`, `KpiCard`, lightweight `DataTable` with `Column<T>`, `StatusBadge`, `ErrorState`+`detectVariant`, `LoadingSkeleton variant="kpi"`, `EmptyState`, `PermissionRedirect`), and is the pattern every other console screen clones.
