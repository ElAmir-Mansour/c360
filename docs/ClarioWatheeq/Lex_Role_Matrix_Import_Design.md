# Tenant Role-Matrix Import — Capability Design

**Suite:** WatheeqTech / Lex (Legal Affairs) · **Author:** Platform Engineering · **Status:** **IMPLEMENTED (P1–P3) & certified** · **Date:** 2026-07-24

> **Implementation note (2026-07-24):** all phases are built and certified: migration `platform_core/000031`, the enforcement overlay (`internal/auth/tenant_overlay.go` + tenant-aware `RequirePermission`), the import service/handler/routes (`/api/v1/lex/role-matrix/*`), four-eyes activation (`RequireDistinctActor` + service re-check), the frontend import + versions dialogs on `/lex/admin/role-matrix`, and an import-aware seeder (restart no longer clobbers an activated import). Certification: DB-backed lifecycle test (`role_matrix_cert_test.go`) against the real platform_core — template → dry-run → commit → four-eyes → **enforcement flip** → **template round-trip fidelity** → **true deactivation-revocation** → **custom-role persona surfacing** → **self-escalation block** → tenant isolation → seeder-restart survival → phantom reconcile → rollback; plus an httptest of the exact HTTP gating chain.
>
> **§7.4 anti-escalation — IMPLEMENTED (2026-07-24) as a self-escalation guard.** A naive "importer cannot grant a permission they don't hold" is unworkable (a config-only System Administrator holds `lex:role:manage` but no operational grants, so it would block the whole feature). The workable, implemented control: the importer may not use an import to grant a role **they themselves are assigned** a permission they do not already effectively hold — this blocks bootstrapping one's own authority while still letting a config-only admin build any operational matrix for roles they don't hold (gated by four-eyes activation + elevated-grant warnings). Enforced in `planRoleMatrixImport` (code `self_escalation`, a hard error) using a tenant-aware effective-permission check against the pre-import overlay; the importer's role slugs flow from their JWT via the handler. A **different** administrator must import a change that elevates the importer's own role.
>
> **Custom-role persona surfacing — IMPLEMENTED (2026-07-24), closing the former P4 gap.** A user holding only an imported CUSTOM role is now surfaced as a switchable persona in `/api/v1/lex/me` (READY, not `NO_LEX_ROLE_ASSIGNED`) and a baseline role the tenant deactivated is hidden. `PersonaService` gained a nil-safe `PersonaRoleReader` (`RoleMatrixPersonaReader` against platform_core) that merges active import roles into the built-in roster and removes tombstoned ones; it degrades to the built-in defs on a reader outage, so a baseline user can never be locked out. The frontend needed no change — the persona switcher already renders `name_en/name_ar` from the role summary.
>
> **Post-review hardening (2026-07-24, 24-finding adversarial pass, worst-first):** a multi-agent security review confirmed and drove fixes for: (1) **failed-revocation** — a deactivated/omitted baseline role now loads as an explicit enforcement TOMBSTONE (empty grant set) instead of silently falling back to the wider code-map default; (2) **enforcement fork** — every interior lex authorization check was swept from the code-map-only `auth.HasPermission` to the tenant-aware `HasPermissionCtx`/`HasAnyPermissionCtx`, so an active import is enforced uniformly, not only at the route gate; (3) **platform-slug shadowing** — imports may no longer name reserved platform slugs (super-admin/tenant-admin/viewer/…); rejected at validation, skipped by the loader, and out of the template's scope; (4) **phantom roles on rollback** — activation now deactivates any import role absent from the activated snapshot, so re-activating an older version cannot leave a later version's custom role enforced; (5) **blank-template wipe** — a blank column in merge mode is "no statement" (keeps current grants), never a silent full revocation; (6) **seeder clobber** — the startup seeder is import-aware (`WHERE roles.source IS DISTINCT FROM 'import'`); (7) **cache correctness** — the overlay cache carries a per-tenant generation (an in-flight load cannot overwrite a newer activation), serializes loads per tenant (no DB stampede), and degrades to the last-known-good overlay on loader error (never widening a narrowed tenant); (8) **CSV formula injection** — all CSV exports neutralize `=+-@` leading cells; (9) **concurrency** — a per-tenant advisory lock + draft supersession + a 200-row import-log retention bound remove MAX(version)+1 races and unbounded growth.
>
> **Residual (accepted) behaviour — cold-start fail-open:** if lex-service restarts while platform_core is briefly unreachable, a tenant that NARROWED a baseline role has that role resolve to the code-map default until the first successful overlay load (bounded by a 30s retry). This is a deliberate availability-over-strictness floor (failing closed would deny every legal user during any DB blip); it can only reveal code-map defaults, never mint tenant-invented grants, and once any successful load occurs the narrowing invariant holds. Documented and test-covered in `internal/auth/tenant_overlay.go`.
**Companion artifact:** `Lex_Role_Matrix_Import_Template.xlsx` (this folder)
**Grounded against:** `Lex_Effective_Access_Control_Matrix.xlsx` (the current effective RBAC)

---

## 1. Goal

Let a **tenant administrator import a Role Matrix from an Excel/CSV template** so each tenant can define its own role → permission grants (and role roster / org-hierarchy metadata) instead of being fixed to the built-in 14 Watheeq roles. The flow must be **template-driven, validated, previewed, versioned, four-eyes-activated, audited, and per-tenant isolated** — and it must *actually be enforced*, not just displayed.

Yes, this is very buildable. About 70% of the plumbing already exists; the design below reuses it and closes the one real gap (enforcement).

---

## 2. Current state (what exists vs. what's missing)

| Concern | Status | Evidence |
|---|---|---|
| Per-tenant role storage | **Exists** | `platform_core.roles`: `tenant_id` FK, `UNIQUE(tenant_id, slug)`, `permissions JSONB`, `metadata JSONB`, `is_system_role` — `migrations/platform_core/000001_init_schema.up.sql:127-154`, `000026_roles_metadata.up.sql` |
| Per-tenant role seeder | **Exists** | `LegalAffairsRoleSeeder` upserts 14 roles per tenant, idempotent `ON CONFLICT (tenant_id, slug) DO UPDATE`, writes `permissions`+`metadata` — `internal/lex/seeder/legal_roles.go` |
| Role CRUD API | **Exists (but limited)** | `RoleService`/`RoleHandler` at `/api/v1/roles` (create/update/delete/assign, SSD checks) — `internal/iam/...`. **Blocks `is_system_role` rows**; its permission writes are **display-only**. |
| SoD exclusions | **Exists** | `legal_role_exclusions` (SSD pairs) — `migrations/platform_core/000027`; assign-time check in `RoleService.AssignRole` |
| Org-role bindings (per entity) | **Exists & enforced** | `legal_org_roles` + `RequireOrgVerb` — a *separate* 7-key vocabulary binding users to entities |
| Read-only role-matrix UI + drift banner | **Exists** | `/lex/admin/role-matrix` page + `use-runtime-role-perms.ts` (reads `GET /api/v1/roles`, shows doc↔runtime drift) |
| Org-Structure **import** (template/validate/preview/commit/history) | **Exists — the pattern to mirror** | `org-structure-import-dialog.tsx`, `org_structure_import.go`, `org_entity_handler.go`, `writeSimpleXLSX` |
| Config **version history + restore** | **Exists — pattern to mirror** | `request-approval-policies/_components/policy-versions-dialog.tsx` |
| **Tenant-scoped enforcement of DB role permissions** | **❌ MISSING — the one real gap** | `rbac.go HasPermission` resolves slugs against a **global** `RolePermissions` code map keyed by slug only; it **never reads `roles.permissions` and never sees a tenant id**. The `perms` JWT claim is populated? No — JWT carries **role slugs only**. See `legal_roles.go:9-21` resolution note. |

> **The decisive fact.** Today, seeding or editing `platform_core.roles.permissions` **enforces nothing** — enforcement is 100% the Go code map. An import capability is therefore *primarily an enforcement change*, wrapped in a familiar import UX. Everything else is reuse.

---

## 3. Architecture — the enforcement overlay (the crux)

We must make `HasPermission` **tenant-aware** so imported grants bite. Two options were considered:

**Option A — DB overlay + in-memory tenant cache (RECOMMENDED).**
Keep the built-in 14 roles in the code map as **defaults** (fast, always present, SoD-test-asserted). Add a **tenant permission overlay** loaded from `platform_core.roles.permissions` into a tenant-keyed, RW-locked cache, invalidated on import-activate.

```
resolve(tenantID, roleSlug):
    overlay = TenantRolePermissions[tenantID][roleSlug]   # from DB, cached
    if overlay present:  return expandGrants(overlay)      # tenant customised
    return expandGrants(RolePermissions[roleSlug])         # built-in default
```

- New signature `HasPermissionForTenant(tenantID, roles, perm)` (and `Any`/`All`). `RequirePermission`/`RequireAnyPermission` already have the tenant in context (`auth.TenantFromContext`) — thread it in.
- `EffectivePermissions` (the UX/persona source behind `GET /lex/me`) reads the same overlay so the UI and the server never disagree.
- Cache load: lazy per-tenant on first check (or warm at tenant provision); invalidate the tenant's entry on activate. TTL as a safety net.
- **`expandGrants` is unchanged** — the effective-verb implication rules apply to overlay grants exactly as to defaults, so the imported matrix stays "direct grants only" and the engine expands (config `:manage`→lower verbs; operational verb→`:view`).

**Option B — populate the unused `perms` JWT claim from the DB at token issue.** Rejected as primary: it bloats tokens, and a role-matrix change would only take effect on **re-login** (unacceptable for an admin action that should apply immediately), and short-circuits the existing slug-only design.

**Decision: Option A.** It is the smallest correct change, preserves the built-ins' determinism, and makes imports take effect immediately after activation via cache invalidation.

**System-role policy.** Imports never mutate the global Go `LegalAffairsRoleDefs`. They write **tenant-scoped rows** in `platform_core.roles`. A tenant may *override* a built-in slug (its overlay row wins for that tenant) or add *new custom* slugs. The built-in defaults remain the safety floor if a tenant has no overlay. `is_system_role` becomes advisory metadata ("this row shadows a platform baseline role"), not a write-block, for the role-matrix importer (which has its own governance, below) — the generic `/api/v1/roles` write-block stays as-is.

---

## 4. Data model

Reuse `platform_core.roles` (no change needed to *store* grants). Add governance around it:

**Additive columns on `roles`** (migration):
- `source TEXT NOT NULL DEFAULT 'seed'` — `seed` | `import` | `manual`.
- `active BOOLEAN NOT NULL DEFAULT true` — park a role without deleting it.
- `matrix_version INT` — the role-matrix version that last wrote this row.

**New: `legal_role_matrix_versions`** (per-tenant, versioned snapshots — mirrors approval-policy versions):
`id, tenant_id, version (int, seq per tenant), status ('draft'|'active'|'superseded'|'rolled_back'), source_filename, checksum, change_reason, snapshot JSONB (full roles+grants), created_by, created_at, activated_by, activated_at`. RLS on `tenant_id`. One `active` row per tenant (partial unique index).

**New: `legal_role_matrix_imports`** (dry-run + commit jobs — mirrors `OrgImportJob`):
`id, tenant_id, version_id (nullable until commit), dry_run BOOL, status ('validated'|'failed'|'committed'), row_count, error_count, errors JSONB, diff JSONB, created_by, created_at`. RLS on `tenant_id`.

SoD pairs continue to live in `legal_role_exclusions` (per-tenant); the importer validates against them and may write new ones.

---

## 5. The template (`Lex_Role_Matrix_Import_Template.xlsx`)

Mirrors the client's own *Legal System Role Matrix.xlsx* (Roster + Legend + capability view) but adds a **machine-authoritative, deterministic** grants sheet:

| Sheet | Role |
|---|---|
| **1. Instructions** | How to fill, verb legend (V/A/E/P/C/AS/D/M), effective-expansion rules, the validation gates, the 7-step import flow. |
| **3. Grants (Role × Permission)** | **AUTHORITATIVE — the importer reads only this.** Rows = the 54 `lex:<domain>:<verb>` slugs (grouped by domain); columns = the 14 role codes (REQ…ADM). Cell = `X` (direct grant) / blank. Pre-filled with the validated baseline; cells carry a dropdown data-validation. Auto-granted baselines (`workflow:read/task`, `lex:reference:view`) shown greyed and ignored. |
| **4. Roles** | Editable roster: code, slug, EN/AR, tier, org unit, reports-to, escalation, `is_system`, `active`. 3 blank rows for custom roles (new slug). Tier + Yes/No dropdowns. |
| **5. Capability view (ref)** | Human view (domain × role with verb-codes) mirroring the client format — reference only, not read on import. |
| **6. Permission Catalog** | Locked list of valid slugs + descriptions + Elevated/Config flags — the validation source. |

Design choices: **direct grants only** (engine expands); a **normalized X-grid** (not stacked verb-codes) so parsing is deterministic; **pre-filled baseline** so tenants start from a known-good matrix; **CSV/XLSX both accepted** (the backend already parses both via `writeSimpleXLSX` + `encoding/csv`; the client XLSX parser is the hand-rolled jszip+DOMParser one used by the org import — no new dependency).

---

## 6. Import pipeline (mirror the Org-Structure Import end-to-end)

```
 Download template  ──► GET  /api/v1/lex/role-matrix/import-template?format=xlsx&sample=current
   (pre-filled with the tenant's current active matrix; writeSimpleXLSX)

 Upload + DRY-RUN   ──► POST /api/v1/lex/role-matrix/imports { dry_run:true, rows:[...] }
   parse → validate → compute diff. NO writes. Returns { status, errors[], diff, preview_version }

 Fix + re-upload    ──► (repeat dry-run until errors == 0)

 Commit (draft)     ──► POST /api/v1/lex/role-matrix/imports { dry_run:false, change_reason }
   creates legal_role_matrix_versions(status='draft') + snapshot. Still NOT enforced.

 Activate (4-eyes)  ──► POST /api/v1/lex/role-matrix/versions/{id}/activate
   RequireDistinctActor(importer ≠ activator) → upsert platform_core.roles (source='import',
   matrix_version=N) → mark version active, prior active → superseded → invalidate the tenant's
   overlay cache → audit. Enforcement now reflects the new matrix immediately.

 Rollback           ──► POST /api/v1/lex/role-matrix/versions/{id}/rollback  (re-activate a prior version)
 History / errors   ──► GET  /api/v1/lex/role-matrix/versions ; GET .../imports/{id}/errors (CSV/JSON blob)
```

**Idempotent activation** reuses the seeder's upsert (`ON CONFLICT (tenant_id, slug) DO UPDATE`). A `replace` mode deactivates roles absent from the import (never hard-deletes — set `active=false`), guarded by a destructive-mode warning (as the org import does for `replace`).

---

## 7. Validation & SoD gates (block activation on failure)

The dry-run validator runs, in order:

1. **Schema** — required columns present, role slugs lowercase-kebab & unique, cells ∈ {X, blank}.
2. **Catalog membership** — every granted slug ∈ Permission Catalog (unknown slug → reject).
3. **SoD / four-eyes** — no role holds an authoring verb (`add`/`edit`) *and* `approve` on the same domain where that pair is SoD-registered; honour `legal_role_exclusions` SSD pairs; an "Auditor-archetype" role stays read-only (no write/approve/close/assign/distribute/manage).
4. **Anti-escalation** — the importing admin cannot grant any role a permission the importer does not themselves hold (prevents privilege escalation).
5. **Admin-only verbs** — granting `role:manage`/`role:assign` to a non-admin role → warning requiring explicit confirmation.
6. **Lockout guard** — at least one active role must retain `lex:role:manage` (never lock the tenant out of role admin).
7. **System-role identity** — a row marked `is_system=Yes` may be re-tiered/renamed but keeps its slug identity; removing a baseline role only deactivates it.

Errors are returned per-row (downloadable CSV, like the org import) so the admin fixes and re-uploads. Warnings surface in the preview but don't block once confirmed.

---

## 8. API surface (net-new, under `/api/v1/lex/role-matrix`)

Mirror `org_entity_handler.go` + `org_structure_import.go`, gated by the existing tiers:

| Method · Path | Permission tier | Purpose |
|---|---|---|
| `GET /role-matrix/import-template` | `lex:role:view` (or `manage`) | Download template (blob), pre-filled with current matrix |
| `POST /role-matrix/imports` (`dry_run:true`) | `lex:role:manage` | Validate + diff preview (no writes) |
| `POST /role-matrix/imports` (`dry_run:false`) | `lex:role:manage` | Commit a draft version |
| `POST /role-matrix/versions/{id}/activate` | `lex:role:manage` + **distinct-actor** | Activate (four-eyes) — the only write to enforcement |
| `POST /role-matrix/versions/{id}/rollback` | `lex:role:manage` + distinct-actor | Re-activate a prior version |
| `GET /role-matrix/versions` | `lex:role:view` | Version history |
| `GET /role-matrix/imports/{id}/errors` | `lex:role:view` | Error report (CSV/JSON blob) |

Frontend client methods mirror the org trio in `lib/lex/admin.ts` (`getRoleMatrixTemplate`, `importRoleMatrix`, `listRoleMatrixVersions`, `activateRoleMatrixVersion`, `getRoleMatrixImportErrors`), envelope `{data}`, blobs via `apiGetBlob`.

---

## 9. Frontend

Extend the existing **read-only** `/lex/admin/role-matrix` page (no new route needed):

- **Import** button, rendered only under `hasPermission('lex:role:manage')` (mirror `org-entities/page.tsx` `extraActions={canWrite ? <…ImportDialog/> : undefined}`), opening a **`RoleMatrixImportDialog`** cloned from `OrgStructureImportDialog`: template download (xlsx/csv), file picker, mode select (merge/replace), **dry-run preview** (per-role added/removed grants + error list + error-CSV), and an **atomic commit** gate (`canApply = status==='validated' && errors===0`).
- **Activate / Version history** sub-panel cloned from `policy-versions-dialog.tsx` (list versions, `activate`, `rollback`, each with `change_reason`, behind a `ConfirmDialog`; four-eyes note).
- The existing **drift banner** (`use-runtime-role-perms.ts`) already visualises doc↔runtime differences — after the enforcement overlay lands it becomes the "live vs. baseline" delta, which is exactly the review surface an import wants.
- Bilingual EN/AR copy (LexBilingual bundle); RTL-safe.

Gating: `lex:role:view` sees the matrix + history; `lex:role:manage` imports/activates. Per the current matrix only **ADM (legal-system-admin)** holds `role:manage`, and **LD + AUD** hold `role:view` — so, by default, only the System Administrator can import, and the Legal Director/Auditor can review. That is the correct SoD posture.

---

## 10. Governance, audit, isolation

- **RBAC**: import/activate = `lex:role:manage`; review = `lex:role:view`.
- **Four-eyes**: `RequireDistinctActor` on activate/rollback (importer ≠ activator) — reuses the exact middleware already guarding case/contract decisions; **fails closed** with `SOD_CONFLICT`.
- **Versioned + reason-tagged**: every commit is a restorable snapshot; every activate/rollback is audited (actor, timestamp, diff, checksum) into the tenant audit trail.
- **Tenant isolation**: all new tables + `roles` writes are RLS-scoped on `current_setting('app.current_tenant_id')`; an import can only ever touch the caller's tenant.
- **Enforcement remains the boundary**: the frontend import UI is convenience; the backend validators + overlay are authoritative.

---

## 11. Rollout — phased so nothing regresses

| Phase | Deliverable | Risk |
|---|---|---|
| **P0** | Template + this design (this PR). | None — artifacts only. |
| **P1** | Storage + versions + audit tables + import validate/commit endpoints (dry-run + draft), **display-only** (writes `roles.permissions` but enforcement still code-map). Frontend import dialog + preview. | Low — nothing is enforced yet; matches today's "DB is display-only" reality. |
| **P2** | **Enforcement overlay** (Option A): tenant-aware `HasPermissionForTenant` + cache + invalidation + `EffectivePermissions` read overlay. Activation now bites. | Medium — the security-critical switch. Behind a per-tenant feature flag; built-ins are the default floor; extensive SoD tests (extend `legal_roles_test.go`). |
| **P3** | Activate (four-eyes) + rollback + version history UI + replace-mode. | Low — governance wrappers over P1/P2. |
| **P4** | Optional: org-role binding import (second target: `legal_org_roles`), CSV/JSON parity, template i18n. | Low. |

**Backward compatibility:** the built-in 14 roles keep working unchanged for every tenant that never imports (their overlay is empty → defaults apply). The `legal_roles_test.go` SoD invariants stay green.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Tenant locks itself out of role admin | Lockout guard (§7.6): ≥1 active role must keep `lex:role:manage`. |
| Privilege escalation via import | Anti-escalation (§7.4): can't grant beyond the importer's own effective set. |
| Enforcement/UX drift | `EffectivePermissions` + `HasPermission` read the SAME overlay; drift banner surfaces any mismatch. |
| Cache staleness after activate | Explicit per-tenant invalidation on activate + short TTL safety net. |
| Corrupt/oversized upload | Reuse the org-import size/parse guards; validation fails closed; dry-run never writes. |
| System-role identity loss | Baseline slugs cannot be renamed away; removal only deactivates. |
| Performance (per-request DB read) | In-memory tenant-keyed cache; DB hit only on cache miss / after invalidation. |

---

## 13. Effort (indicative)

- **Backend:** ~1 migration (3 tables/cols), `role_matrix_service.go` + `role_matrix_handler.go` (clone org import ≈ 60%), the overlay in `rbac.go` (the careful 20%), routes wiring, SoD tests.
- **Frontend:** `RoleMatrixImportDialog` + versions panel (clone org + policy-versions ≈ 70%), `lib/lex/admin.ts` methods, bilingual copy.
- **Template:** done (`Lex_Role_Matrix_Import_Template.xlsx`).

Net: a well-bounded feature where the only genuinely new, security-sensitive code is the ~1 file enforcement overlay; everything else clones a shipped pattern.
