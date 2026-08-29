# Legal System Role Matrix — Implementation Design **v2** (Watheeq / lex)

> Translates `Legal System Role Matrix.xlsx` (14 roles · 6 verbs · ~40 capabilities, SoD + org
> hierarchy) onto the EXISTING lex RBAC. Grounded in a code audit (file:line). For the Abdullah Al
> Othaim tenant (`aaaaaaaa-…01`).
>
> **v2 supersedes v1.** v1 collapsed ~40 capabilities into ~16 domains and read off "highest authority
> per domain." That collapse leaked authority (an `:edit` on a whole domain re-grants restricted
> actions) and, in two places, inverted the SoD the matrix encodes. v2 keeps the domain families but
> makes **verbs independent flags** and pushes per-step approval *sequencing* into the approval chain,
> where the existing code already enforces it. See the changelog before reading on.

---

## 0. Changelog vs v1 (what changed and why)

| # | v1 problem | v2 fix |
|---|---|---|
| 1 | Domain collapse + "highest authority per domain" → `:edit` on a family re-grants restricted actions (e.g. Legal Officer got domain-wide `lex:case:edit`, which includes **assignment** — a Section-Manager-only action). | Verbs are **independent flags**, not a ladder. `edit` never implies `approve`/`close`/`assign`/`distribute`. Restricted actions get their own keys (`lex:case:assign`, `lex:contract:distribute`). §3. |
| 2 | **Bug:** `legal-advisor` granted `lex:contract:...approve` "(recommends)". The matrix gives LA only **A·E** on final sign-off; **P** is KSM/LD (CAP-120). v1 violated its own SoD. | LA loses `approve` entirely. Advisor recommends (`add,edit`); manager signs off. §3. |
| 3 | LA also carried `catalog:view, role:view, audit:read, integration:view, security:view` — a governance bundle copied from the Director. The matrix puts LA in no admin row. | Stripped. LA is operational-only. §3. |
| 4 | DM/BUC/CEO given `lex:case:approve` / `lex:consultation:approve`. Those matrix "P"s are **DOA request-level** approvals, not legal work-product sign-off. v1 let business managers approve legal pleadings/consultation answers. | Business-tier "P" maps to `lex:request:approve` only. Business roles get `lex:case:view`/`add` (initiate), never `lex:case:approve`. §3. |
| 5 | Coarse fallback `RequireAnyPermission(lex:<d>:<v>, lex:write)` applied to **all** routes, incl. approve/close → any legacy `lex:write` holder bypasses the matrix. | Fallback allowed on `view/add/edit` routes only. `approve`/`close`/`assign`/`distribute`/`manage` routes accept **no** coarse fallback. §4. |
| 6 | `:manage implies all lower verbs` asserted but rbac.go does literal `HasPermission` + `:*`. `lex:sla:manage` would fail a literal `lex:sla:view` check. | Verb-implication is **implemented** as a grant-expansion in the checker (§4.1), not assumed. |
| 7 | Static (role-level) SoD only. Same person could draft case X and approve case X if they held both roles; two-round review wasn't two *distinct* approvers. | Added **dynamic SoD** middleware (author ≠ approver per record) + **SSD** mutually-exclusive-role constraints. §4.2. In scope, asserted by test. |
| 8 | `legal-system-admin` holds `lex:role:manage` → can edit any role to self-grant `lex:case:approve`. The "config not authority" invariant was cosmetic. | System roles immutable; `role:assign` split from `role:manage`; **anti-escalation** (cannot grant a key you don't hold) + four-eyes + audit on permission changes. §4.3. |
| 9 | "own-scope" reporting written as a verb note; it's ABAC data-filtering and was unspecified → global `report:read` leaks cross-BU data. | Scope made explicit: ownership filter (own records) + entity scoping (own BU/section) via org-RBAC. §3.1. |
| 10 | Seeder "gated + non-fatal" for security-critical roles → silent no-op → lockout or fallback over-grant. | Seeding is **asserted**: startup verifies all 14 roles present for the tenant or fails the readiness check. §5. |
| 11 | "Audit immutable" rested on "no UPDATE/DELETE path" — but ADM's `security:manage`/DB reach defeats app-layer-only immutability. | If evidence integrity is in scope: append-only + external log shipping / WORM, not just a missing handler. §4.4. |

---

## 1. Principle: extend the existing RBAC, don't fork it

The lex stack already has the primitives — we map the matrix onto them:
- **Permission model** (`internal/auth/rbac.go`): `resource:action` strings, `:*` wildcard, `HasPermission`,
  `RequirePermission` / `RequireAnyPermission` middleware. Roles → permission arrays.
- **Granular verbs already exist**: `lex:view/add/edit/approve/close` (rbac.go:50‑54) ≈ the matrix's
  **V/A/E/P/C**; **M (Manage)** maps to `:manage` keys. So the 6 verbs are a known shape.
- **Org‑RBAC** (`internal/lex/middleware/orgrbac.go` + `legal_org_entities`/`legal_org_roles`): entity‑scoped
  verb checks against escalation **recipients**. This is where **SoD recipients** and the
  **L1→L2→L3 escalation chain** already live (`escalation_service.go`).
- **Seeding**: `role_seeder.go` (generic platform roles) + `seed_legal_affairs.go` (org registry with
  reports‑to hierarchy + 7 org‑role bindings). The 14 matrix roles don't exist yet — we add them.

**Gaps to close:** (a) the 14 named legal roles; (b) per‑capability verb keys with **independent** verb
semantics; (c) the role→permission map transcribed *faithfully* from the matrix; (d) enforcement of the
new keys on the legal‑affairs handlers with **no coarse fallback on elevated verbs**; (e) **dynamic SoD**
(author ≠ approver) and **SSD** role-exclusion, which RBAC alone does not provide; (f) **anti-escalation**
controls on role management.

---

## 2. Permission‑key scheme — `lex:<domain>:<verb>`

**Verbs.** V→`view`, A→`add`, E→`edit`, P→`approve`, C→`close`, M→`manage`, plus two **restricted**
verbs that the matrix treats as manager-only but which would otherwise hide inside `edit`:
`assign` (case work allocation) and `distribute` (contract allocation).

**Verbs are independent flags.** Holding `edit` grants **only** edit. It does **not** imply `approve`,
`close`, `assign`, or `distribute`. The only implications (expanded in the checker, §4.1) are:
- any operational verb `{add, edit, approve, close, assign, distribute}` on a domain ⇒ also `view` on it;
- `manage` on a **config** domain ⇒ all lower verbs on that config domain (it is the single elevated verb there).

There is **no** `approve ⇒ edit`, **no** `close ⇒ approve`. This is the property that prevents the v1 leak.

**Per-step approval *sequencing* is not a permission key.** The matrix's tier nuance — memo needs
*Supervisor then Section Manager*; a judgment-objection recommendation needs *Section Manager only* —
is **workflow sequencing**, enforced by the approval chain (org-RBAC recipients + the two-round logic in
`escalation_service.go`), not by inventing tiered keys. A permission key grants the **capability** to
approve within a domain; the **chain** decides which step routes to whom, and **dynamic SoD** (§4.2)
guarantees the approver is not the author. This matches the existing code and keeps the key-set small.

**Domains** (the matrix's ~40 functions grouped into coherent families):

| Domain | Matrix groups | Operational verbs | Restricted / config |
|---|---|---|---|
| `lex:request` | A Intake · B Approvals · C SLA‑acks · D Execution (request lifecycle) | view add edit approve close | — |
| `lex:case` | E cases (intake, records, hearings, pleadings, memos, timelines) | view add edit approve close | **assign** |
| `lex:investigation` | E investigations | view add edit approve close | — |
| `lex:settlement` | E settlements / ADR | view edit approve close | — |
| `lex:contract` | F contracts (intake, check, review, comms, archive) | view add edit approve close | **distribute** |
| `lex:consultation` | G consultations | view add edit approve close | — |
| `lex:document` | H attachments / docs | view add edit | — |
| `lex:report` | H KPI / reports (`lex:report:read` exists) | read | (scoped, §3.1) |
| `lex:notification` | H notifications | view edit | manage |
| `lex:sla` | C SLA targets / working calendar | view | manage |
| `lex:escalation` | C escalation matrix config + routing | view | manage |
| `lex:catalog` | I service‑catalog | view | manage |
| `lex:role` | I users / roles / permissions | view | **assign**, manage |
| `lex:audit` | I audit log (**read‑only — no write key ever**) | read | — |
| `lex:integration` | I Najiz/HR/archive (`lex:integration:read/manage` exist) | view | manage |
| `lex:security` | I security / data‑governance | view | manage |

These extend (not replace) coarse `lex:read`/`lex:write` (kept as fallbacks for `view/add/edit` routes
only) and the existing `lex:approval:*` / `lex:integration:*` tiers. New constants go in `auth/rbac.go`.

### 2.1 Why `assign` and `distribute` are their own verbs

In the matrix, the Legal Officer has **A·E** on case *records/pleadings* but only **V** on *assignment*;
the Advisor has **A·E** on contract *review* but is absent from *distribution* (LD/KSM/KSV only). If
assignment/distribution rode inside `edit`, granting an Officer `lex:case:edit` (which they need for
drafting) would silently also grant case assignment. Splitting them keeps drafting and allocation
independent — the v1 leak, closed.

---

## 3. The 14 roles → permission sets (transcribed faithfully from the matrix)

Each role is a `roles` row (`platform_core.roles`, `is_system_role=true`) with `slug`, AR/EN `name`, and a
`metadata` JSONB carrying `{tier, reports_to, org_unit, escalation_level}`. **Verbs are exactly those the
matrix grants — nothing is rounded up.** The seeder cross-checks each role's row in the xlsx so every cell
maps, and the SoD invariants are asserted by test (§7).

| Role (slug) | Tier · Reports‑to | Permission set (independent verbs) |
|---|---|---|
| **Requester** `legal-requester` | Business · Line Mgr | `lex:request:view,add,edit` · `lex:contract:view,add` · `lex:consultation:view,add` · `lex:document:view,add` · `lex:report:read` *(own-records, §3.1)* |
| **Dept Manager** `legal-dept-manager` | Business · BU CEO · **L2** | requester set **+** `lex:request:approve` *(DOA)* · `lex:case:view,add` *(initiate only)* · `lex:consultation:view,add` |
| **Business Unit CEO** `legal-bu-ceo` | Business · CEO | `lex:request:view,add,edit,approve` · `lex:case:view` · `lex:contract:view` · `lex:document:view` · `lex:report:read` *(own-BU)* |
| **CEO** `legal-ceo` | Business · Board | `lex:request:view,add,edit,approve` · `lex:case:view,add` *(issues directive)* · `lex:contract:view` · `lex:report:read` |
| **Legal Director** `legal-director` | Legal · SSM | `lex:request:*` · `lex:case:*` *(incl. assign)* · `lex:investigation:*` · `lex:settlement:*` · `lex:contract:*` *(incl. distribute)* · `lex:consultation:*` · `lex:document:view,add,edit` · `lex:notification:edit` · `lex:report:read` · `lex:sla:manage` · `lex:escalation:manage` · `lex:catalog:manage` · `lex:role:view` *(view only — mgmt is ADM)* · `lex:audit:read` · `lex:integration:view` · `lex:security:view` |
| **Cases & Investigations Sec. Mgr** `legal-cases-manager` | Legal · LD · **L2** | `lex:request:view,edit,approve` · `lex:case:view,add,edit,assign,approve,close` · `lex:investigation:view,approve,close` · `lex:settlement:view,approve,close` · `lex:document:view,add,edit` · `lex:report:read` |
| **Contracts Section Mgr** `legal-contracts-manager` | Legal · LD | `lex:request:view,approve` · `lex:contract:view,add,edit,distribute,approve,close` *(final sign-off CAP‑120)* · `lex:document:view,add,edit` · `lex:report:read` |
| **Case Supervisor** `legal-case-supervisor` | Legal · CSM · **L1** | `lex:request:view,approve` · `lex:case:view,edit,approve` *(first-tier review; **no** assign/close)* · `lex:investigation:view,edit` · `lex:settlement:view,edit` · `lex:document:view,add,edit` |
| **Contracts Supervisor** `legal-contracts-supervisor` | Legal · KSM | `lex:request:view,approve` · `lex:contract:view,add,edit,distribute` *(distribute + first-tier; **no** approve/close)* · `lex:document:view,add,edit` |
| **Legal Officer / Lawyer** `legal-officer` | Legal · CSV | `lex:request:view,edit` · `lex:case:view,add,edit` *(**no** assign/approve/close)* · `lex:investigation:view,add,edit` · `lex:settlement:view,add,edit` · `lex:document:view,add,edit` |
| **Legal Advisor / Consultant** `legal-advisor` | Legal · KSM | `lex:contract:view,add,edit` *(recommends — **no** approve/distribute/close)* · `lex:consultation:view,add,edit` *(responds — **no** approve)* · `lex:request:view` · `lex:document:view,add,edit` · `lex:report:read` |
| **Shared Services Unit Mgr** `legal-shared-services-manager` | Oversight · Exec · **L3** | `lex:request:view` · `lex:case:view` · `lex:investigation:view` · `lex:settlement:view` · `lex:contract:view` · `lex:consultation:view` · `lex:sla:view` · `lex:escalation:view` · `lex:report:read` · `lex:audit:read` |
| **Auditor / Compliance** `legal-auditor` | Oversight · SSM | **VIEW/READ ONLY** — `view` on request, case, investigation, settlement, contract, consultation, document; `lex:report:read` · `lex:audit:read` · `lex:catalog:view` · `lex:role:view` · `lex:integration:view` · `lex:security:view`. **No** add/edit/approve/close/assign/distribute/manage anywhere (SoD safeguard, CAP‑155/181). |
| **System Administrator** `legal-system-admin` | Admin · SSM | `lex:catalog:manage` · `lex:sla:manage` · `lex:escalation:manage` · `lex:notification:manage` · `lex:role:assign,manage` *(constrained, §4.3)* · `lex:integration:manage` · `lex:security:manage` · `lex:audit:read`. **No** operational `add/edit/approve/close/assign/distribute` on any legal domain — ADM is configuration, not case/contract authority. |

**SoD invariants (asserted by test):**
- No business-tier role (`requester`, `dept-manager`, `bu-ceo`, `ceo`) holds `lex:case:approve` /
  `lex:contract:approve` / `lex:consultation:approve`. Their only `approve` is `lex:request:approve` (DOA).
- `legal-officer` holds **no** `approve`/`close`/`assign` on any domain.
- `legal-advisor` holds **no** `approve` on `contract` or `consultation`, and **no** `distribute`.
- `legal-auditor` holds **only** `view`/`read` keys.
- `legal-system-admin` holds **no** operational write/approve/close; its `role:manage` is constrained (§4.3).
- `lex:audit` has **no** write verb in the entire catalog.

### 3.1 Scope is ABAC, layered on top of RBAC

RBAC says *which verbs*; it does not say *which rows*. Two scope filters apply and must be enforced in the
query layer / org-RBAC, not left to a global key:
- **Ownership filter** (`own-records`): `legal-requester` reads only requests/contracts where
  `created_by = userID` (or where they are a named party). A bare `lex:report:read` must be filtered by
  ownership for this role.
- **Entity scope** (`own-BU` / `own-section`): `legal-bu-ceo`, `legal-dept-manager` see only their org
  subtree; resolved by the existing `legal_org_roles` ↔ `legal_org_entities` binding in `orgrbac.go`.
  Oversight roles (`SSM`, `auditor`) are tenant-wide read.

Tenant isolation remains the outermost boundary (every query is `tenant_id`-scoped); BU/ownership scope is
*within* the tenant.

---

## 4. Enforcement (server‑side)

### 4.1 Verb-implication is implemented, not assumed

`auth/rbac.go` gets an `expandGrants(perms []string) set` that the checker runs once per request:
- `lex:<d>:manage` (config domains) → add `lex:<d>:view` (+ any other verbs that domain defines).
- `lex:<d>:<v>` for `v ∈ {add,edit,approve,close,assign,distribute}` → add `lex:<d>:view`.
- `lex:<d>:*` → expands to every verb the domain defines.
- **No** cross-verb implication beyond the above. `approve` does not add `edit`; `close` does not add `approve`.

`HasPermission` then matches against the expanded set. This makes "manage implies view" real (the v1 gap)
without making it a superset of approve/close.

### 4.2 Dynamic SoD (author ≠ approver) + SSD — **new in v2**

RBAC gives static SoD (the *Officer role* can't approve). It does **not** stop the same *person* who
authored a record from approving it if they also hold an approver role. We add two enforcement layers:

- **Instance-level check** — a `RequireDistinctActor` guard on every `:approve` / `:close` route compares
  the record's `initiated_by` / `created_by` (and prior-step approvers) against the current `userID`.
  If they match → **403 SoD-conflict**, regardless of permission. The two-round memo (CAP — Defendant
  §5.4) requires **two distinct** approvers; the guard records each step's approver and rejects a repeat.
- **Static Separation of Duties (SSD)** — a mutually-exclusive-role constraint table so a single user
  cannot simultaneously hold conflicting roles for the same org entity, e.g.
  `{legal-officer ⊥ legal-cases-manager}`, `{legal-advisor ⊥ legal-contracts-manager}`,
  `{any-operational ⊥ legal-auditor}`. Enforced at role-assignment time (`role:assign`) and re-checked at seed.

Both are asserted by test: a `legal-officer` who is also (wrongly) assigned `legal-cases-manager` is
rejected by SSD; an approver who authored the record is rejected by the instance guard.

### 4.3 Role management is constrained — closes the ADM superuser path

`lex:role:manage` is **not** a blank check:
- **System roles are immutable.** The 14 seeded roles (`is_system_role=true`) cannot have their permission
  sets edited via `role:manage` — only *assigned* to users (`role:assign`). Enforced in the role handler,
  not just labelled.
- **Anti-escalation.** When editing/creating a *custom* role, the checker forbids granting any key the
  acting user does not already hold (`grantedKeys ⊆ actorKeys`). ADM, holding no operational `approve`,
  therefore cannot mint a role with `lex:case:approve` and self-assign it.
- **Four-eyes + audit.** Any permission-set change or privileged role assignment writes an immutable
  `lex:audit` event and requires a second approver (config-gated). 

### 4.4 Per-domain gating, no coarse fallback on elevated verbs

Extend the lex route groups (`handler/routes.go`) so each capability family checks its domain key:
- `view/add/edit` routes → `RequireAnyPermission(lex:<d>:<v>, lex:write|lex:read)` — coarse fallback
  **retained** for migration compatibility, exactly like today's cross-cutting tiers.
- `approve / close / assign / distribute / manage` routes → `RequirePermission(lex:<d>:<v>)` **only** —
  **no** `lex:write` fallback. A legacy `lex:write` holder cannot approve or close. This is what makes the
  §7 acceptance bullets provable.

SoD + escalation recipients stay enforced by org‑RBAC (`orgrbac.go` `RequireOrgVerb` → entity recipients)
and the approval chain; matrix roles bind to org entities (Legal Dept → Sections) via `legal_org_roles`,
so *who* may approve a given step is the intersection of (capability key) ∩ (chain recipient) ∩ (distinct
actor).

### 4.5 Auditor immutability

No `lex:audit` write key exists in the catalog, and the audit table has no UPDATE/DELETE handler
(CAP‑155/181). **If regulatory evidence integrity is in scope**, app-layer absence is not enough — ADM's
`security:manage` / DB reach must not be able to rewrite history. Add append-only storage (DB-level
`INSERT`-only grant for the app principal) **and** asynchronous external log shipping / WORM, so the
authoritative copy is outside any in-product role's reach. Track as an explicit decision (in/out of scope).

---

## 5. Seeding

A new idempotent `LegalAffairsRoleSeeder` (`internal/lex/seeder/` or extending `seed_legal_affairs.go`):
- Upserts the 14 roles into `platform_core.roles` (`ON CONFLICT (tenant_id, slug)`), `is_system_role=true`,
  permissions JSON per §3, `metadata = {tier, reports_to, org_unit, escalation_level}`.
- Adds the new `lex:<domain>:<verb>` constants to `auth/rbac.go` (and the IAM permission catalog surfaced
  to the role-management UI), including the `assign`/`distribute` restricted verbs.
- Binds each role to the existing org entities (reports‑to chain) so org‑RBAC resolution and escalation
  recipients work; seeds the **SSD exclusion table** (§4.2).
- Runs at lex‑service startup for the demo tenant after `ensureOrgRegistry`. **Asserted, not best-effort:**
  startup readiness fails (and is surfaced) if any of the 14 roles, the permission catalog entries, or the
  SSD constraints are missing — so a silent no-op cannot leave the tenant relying on coarse fallback.

---

## 6. Frontend

- The role‑management UI (`admin/roles` + `role-form-dialog.tsx`) renders a permission tree from the
  `lex:*` keys — the new domain/verb keys (incl. `assign`/`distribute`) appear automatically; the 14 seeded
  roles list with AR/EN names + tier. System roles render **read-only** (immutable, §4.3).
- A **"Legal Role Matrix" view** (read‑only) under `lex/admin/`: the 14 roles × capability grid with the
  M/P/C/E/A/V cells, coloured by highest authority, rendered from the seeded role permissions — so the
  matrix is inspectable in‑product, bilingual / RTL. The grid renders from the **same** seeded data the
  server enforces, so drift between the doc and runtime is visible.

---

## 7. Plan & acceptance

1. **Keys** — add `lex:<domain>:<verb>` constants incl. `assign`/`distribute`/`manage`; implement
   `expandGrants` (§4.1) + catalog entries.
2. **Roles + seeder** — 14 role defs + `LegalAffairsRoleSeeder` (idempotent, demo tenant, org-bound,
   **asserted** present), SSD exclusion table.
3. **Enforcement** — per-domain gating with **no coarse fallback on approve/close/assign/distribute/manage**;
   `RequireDistinctActor` instance guard; constrained `role:manage` (immutable system roles + anti-escalation
   + four-eyes).
4. **Frontend** — surface the 14 roles + the matrix grid view; system roles read-only.
5. **Verify** — `go build` + lex tests + SoD/role tests + `tsc`; seed smoke (14 roles present for the tenant).

**Acceptance (all proven by test):**
- `legal-officer` can `add`/`edit` a case but **cannot** `approve`, `close`, or `assign` it.
- `legal-case-supervisor` can `approve` (first-tier) but **cannot** `assign` or `close`.
- `legal-cases-manager` can `assign`, `approve`, and `close`.
- `legal-advisor` can `add`/`edit` a contract and **respond** to a consultation but **cannot** `approve`
  either, and **cannot** `distribute`.
- A business-tier role's only `approve` is `lex:request:approve`; it cannot approve a case/contract/consultation.
- The **author** of a record is **denied** approving/closing it even with the capability (dynamic SoD);
  the two-round memo requires two **distinct** approvers.
- A legacy `lex:write` holder is **denied** on every `approve`/`close`/`assign`/`distribute`/`manage` route.
- `lex:sla:manage` satisfies a `lex:sla:view` check (implication works); `lex:case:approve` does **not**
  satisfy a `lex:case:edit` check (no reverse implication).
- **Auditor** can view every operational domain and **mutate nothing**; no `lex:audit` write key resolves.
- **ADM** configures catalog/calendar/roles but **cannot** approve a case and **cannot** mint/self-assign a
  role carrying a permission ADM doesn't hold (anti-escalation); editing a system role is rejected.