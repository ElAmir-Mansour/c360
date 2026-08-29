# Clario360 — Onboarding, Product Selection & Licensing Design

> Status: **Draft for review** · Author: platform · Scope: customer self‑serve onboarding,
> product/suite selection, and plan/licensing wiring · Supersedes the implicit "register →
> wizard → (no license)" behaviour.
>
> This document is grounded in a verbatim audit of the current code (file:line refs throughout).
> Decisions **D1–D9** at the end are framed for CTO sign‑off (Saleh) and feed the decision register.

---

## 0. TL;DR

Today a customer **can pick suites** in the onboarding wizard but **cannot pick a plan**, and the
choice grants **no license** — onboarding and the (fully‑built) license engine are completely
decoupled. Worse, every self‑serve tenant is hard‑coded to **`subscription_tier='enterprise'`** at
registration while receiving **no `tenant_licenses` row**, so the gateway returns **`402` on suite
routes** until a super‑admin manually assigns a license. On top of that there are **five
unreconciled product/plan vocabularies**, and the wizard ids `lex`/`visus` don't even match their
entitlement keys (`app.watheeq`/`app.bosalah`), while `siem`/`datastream` (billable) aren't
selectable at all.

**This design** introduces a **single canonical product/plan model**, a **trial‑by‑default**
self‑serve flow, a **plan + product selection** sub‑step in the wizard, and an
**onboarding→license‑service provisioning step** that grants a bounded, selected‑product license —
with a sales‑assisted path for paid/enterprise. Delivered in **4 phases** (P0 unblocks the 402 in
days).

---

## 1. Goals / Non‑Goals

**Goals**
- A customer completing self‑serve onboarding ends with a **real, bounded license** (no 402 surprise, no silent enterprise grant).
- The customer can **select products (suites/apps)** and a **plan/tier** during onboarding, constrained by what the plan grants.
- **One canonical source of truth** for products↔entitlement‑keys↔plans, consumed by gateway, license‑service, onboarding, admin, and marketing.
- A **sales‑assisted** path for paid/enterprise/sovereign that reuses the existing admin license‑assignment + offline‑license machinery.
- Entitlement enforcement (`402`) drives an **upsell**, not a dead end.

**Non‑Goals (this round)**
- Building a payment processor / self‑serve card checkout (paid = sales‑assisted for now; payment hook is P3).
- Per‑app metering/billing beyond the existing `seats.users` meter.
- Re‑theming marketing pricing.

---

## 2. Current state (as‑is) — verified

### 2.1 Onboarding (iam‑service · `backend/internal/onboarding`)
- Public **register** → **verify‑email (OTP)** → JWT, then a **5‑step authenticated wizard**:
  `1 organization · 2 branding · 3 team · 4 suites · 5 complete`
  (`service/common.go:333-348`; transitions in `repository/onboarding_repo.go:367-495`).
- Wizard state = **`tenant_onboarding`** (`migrations/platform_core/000003_tenant_onboarding.up.sql`):
  `active_suites TEXT[] DEFAULT '{cyber,data,visus}'`, `current_step INT`, `steps_completed INT[]`,
  `wizard_completed BOOL`, `provisioning_status` (`pending|provisioning|completed|failed`).
- Step 4 `SuitesStepRequest.active_suites` is validated against **`{cyber,data,acta,lex,visus}`**
  (`common.go:310-331`) — **no `siem`, no `datastream`**.
- ⚠️ At registration the tenant is created **`status='onboarding'`, `subscription_tier='enterprise'`**
  (`onboarding_repo.go:90-96`, literal `iammodel.TierEnterprise`).
- Completion flips `tenants.status` → `active` via `provisioner.SetTenantStatus` (`provisioner.go:202`).
- The **provisioner pipeline** (`provisioner.go:243-284`) runs 11 steps
  (verify DB/migrations, seed roles/settings/cyber rules/visus KPIs+dashboard/lex compliance/AI‑gov models, buckets, audit init) and makes **zero** license/entitlement calls (`grep license|entitlement|plan` over `internal/onboarding` = 0 hits). **`active_suites` never becomes entitlements.**

### 2.2 Licensing (license‑service · `backend/internal/license`, `license_db`)
A complete, independent engine — just **not wired to onboarding**:
- Tables: `license_plans`, `plan_entitlements`, `tenant_licenses` (**UNIQUE(tenant_id)** → one active plan), `entitlement_overrides`, `usage_counters`. Offline **RS256‑signed** license files supported.
- **Only two catalog plans** seeded (`migrations/license_db/000002_seed_plans.up.sql`): `business-plus`
  (`seats.users=500`) and `enterprise` (unlimited). **No free/trial plan.** Dev tenant
  `aaaaaaaa‑…01` → `business-plus`.
- Entitlement‑key registry (`model/keys.go:25-40`): `suite.cyber, suite.data, suite.siem,
  suite.datastream, app.acta, app.watheeq, app.bosalah, seats.users`. `lex`/`visus` are aliases,
  not canonical keys. **Real key gaps: `app.mahamatech`, `app.ehkam`, and child app keys.**
- API under `/api/v1/licensing` (gateway `Public:false`, never plan‑gated): enforcement (`GET /check`,
  `GET /entitlements`, `POST /usage`, `POST /offline-license/activate`) + admin (`licensing:admin`):
  plans CRUD, `POST /admin/tenants/{id}/license` (`AssignLicenseInput{TenantID,PlanKey,Seats,ExpiresAt,GraceDays}`),
  suspend/resume, overrides, usage rollup.
- Domain: `Entitlement{Key, Limit *int64}` (nil=granted/unbounded, >0=quota, 0=revoked);
  `TenantLicense.State(now)` → `active | in_grace | expired | suspended` (`model.go:90-105`).

### 2.3 Enforcement (gateway)
- Routes tagged with an entitlement key (`gateway/config/routes.go:58-150`):
  `cyber,rca→suite.cyber · data→suite.data · siem→suite.siem · dr→suite.datastream ·
  acta→app.acta · watheeq→app.watheeq · lex→app.watheeq (ALIAS) · visus→app.bosalah`.
- `ProxyEntitlement` (`middleware/proxy_entitlement.go:25-110`): `decision.Allowed==false` →
  **`402` `ENTITLEMENT_REQUIRED`**; missing tenant + fail‑closed → `403`; check error +
  fail‑closed → `503`.

### 2.4 The five vocabularies (the core mess)
| Product | Wizard suite id | Entitlement key | DB plans | Admin tier | Marketing id | Problem |
|---|---|---|---|---|---|---|
| Cyber / ClarioSec | `cyber` | `suite.cyber` | bp, ent | cyber | `clariosec` (4 apps) | marketing has no `cyber` id; apps lack keys |
| Data / ClarioInsight | `data` | `suite.data` | bp, ent | data | `clarioinsight` | Visus split across vocabularies |
| **SIEM** | **— (not selectable)** | `suite.siem` | bp, ent | siem | (under clariosec) | **billable but un‑selectable in wizard** |
| **DataStream / ClarioDR** | **— (not selectable)** | `suite.datastream` | bp, ent | dr | `datastream` (4 apps) | **billable but un‑selectable in wizard** |
| Acta | `acta` | `app.acta` | bp, ent | acta | `acta` | wizard treats app as a "suite" |
| **Lex / Watheeq** | **`lex`** | **`app.watheeq`** | bp, ent (`app.watheeq`) | lex→watheeq | `watheeq` | wizard id is an alias; needs canonical map |
| **Visus / BOSALAH** | **`visus`** | **`app.bosalah`** | bp, ent (`app.bosalah`) | visus→bosalah | `bosalah`/`dashboards` | wizard id is an alias; in default suites but no plan grants it self‑serve |
| MahamaTech | — | **none** | none | none | `mahamatech` | **Phase‑1 product, not licensable** |
| EHKAM | — | **none** | none | none | `ehkam` | not licensable |
| `tenants.subscription_tier` | n/a | n/a (not a key) | enum `free/starter/professional/enterprise` | drives admin UI | marketing `Suite/Platform/Sovereign` | **4th/5th plan vocab; only `license_db` plans enforce** |

---

## 3. The canonical model (single source of truth)

Define **one registry** that every layer consumes. Recommended shape (D4 = **two‑level**):

### 3.1 Products
- A **Product** is either a **Suite** (billable bundle) or an **App** (a unit inside a suite).
- **Entitlement keys** are the atomic grant: `suite.<x>` and `app.<y>`. **Granting `suite.X`
  implies its child `app.*` keys** (resolver rule), so suite‑level billing keeps working while
  per‑app gating becomes possible later.

**Canonical product registry (proposed):**

| Suite (key) | Apps (keys) | Wizard/route id | Notes |
|---|---|---|---|
| `suite.cyber` | `app.ctem, app.dspm, app.ueba, app.vciso` | `cyber` | ClarioSec |
| `suite.siem` | `app.siem` | **add `siem`** | currently un‑selectable |
| `suite.data` | `app.data_intelligence` | `data` | ClarioInsight |
| `suite.datastream` | `app.clariodr, app.migration, app.sync, app.dwh` | **add `datastream`** | currently un‑selectable |
| `suite.business_plus` | `app.acta, app.watheeq (=lex), app.bosalah (=visus), app.mahamatech, app.ehkam` | `acta/lex/visus/...` | Business+ apps |

> Keep **`lex`** and **`visus`** as UI/back‑compat aliases only; do **not** add `app.lex` or
> `app.visus` as real license keys unless gateway routes are also changed. Canonical mapping:
> `lex→app.watheeq`, `visus→app.bosalah`. Add real keys only for real products that need direct
> enforcement, e.g. `app.mahamatech`, `app.ehkam` (D‑gap fix). The registry should be generated
> from one canonical JSON/YAML catalog into Go + TypeScript constants, then contract‑tested against
> gateway route entitlements, license keys, onboarding products, and frontend catalogs.

### 3.2 Plans
- A **Plan** = a set of granted entitlement keys (+ per‑key limits) + a `seats.users` cap +
  commercial metadata (price/visibility/self‑serve flag). Plans live in `license_db.license_plans`
  (already the only enforcing vocabulary).
- **Collapse the other plan vocabularies onto `license_db` plans.** `tenants.subscription_tier`
  becomes a **derived display value** (mapped from the active plan), not a source of truth.

**Proposed plan catalog (extends the existing two):**

| Plan key | Self‑serve | Grants | Seats | Term | Maps marketing → |
|---|---|---|---|---|---|
| **`trial`** *(new)* | ✅ auto | base plan grants **`seats.users` only**; selected products are granted per tenant | 5 | 14–30d (`expires_at`+grace) | "Start free" |
| `business-plus` *(exists)* | ❌ sales | cyber, siem, data, datastream, acta, watheeq, bosalah | 500 | annual | "Suite" |
| `enterprise` *(exists)* | ❌ sales | all + unlimited | ∞ | annual | "Platform" / "Sovereign" |

> A perpetual **`free`** plan (e.g. `cyber` only, 5 seats) is optional (D2) — recommended to keep the
> default a **time‑boxed trial** so commercial follow‑up is forced, and reserve `free` for a
> deliberate freemium SKU later.

---

## 4. Target onboarding flow (to‑be)

```
 marketing /pricing ──"Start free"(deep-link: ?suites=…&plan=trial)──┐
                                                                     ▼
 register (public)  ─▶  verify-email (OTP) ─▶  authenticated wizard
   org + admin                                  1 organization
   (no plan field)                              2 branding
                                                3 team invites
                                                4 PRODUCTS + PLAN     ← selection happens here
                                                5 provision / ready   ← ASSIGNS the license
 "Talk to sales" (Platform/Sovereign) ─▶ lead → admin assigns paid license / offline-license
```

### 4.1 State machine change (D3 = **sub‑step of step 4**, no renumber)
Keep the 5‑step machine; **extend step 4 ("suites") into "Products & Plan"**:
- Select **products** (suites/apps the canonical registry marks self‑serve‑selectable).
- Select/confirm **plan** (default `trial`) + **seats** (default 5, ≤ plan cap).
- Persist on `tenant_onboarding`: keep `active_suites`, **add `plan_key TEXT`, `seats INT`**.
- This avoids renumbering `complete`, the repo transitions, and the frontend stepper. (Alt: a real
  step 5 "Plan" + step 6 "complete" — cleaner UX, more churn; deferred unless product wants it.)

### 4.2 Self‑serve vs sales‑assisted (D1 = **hybrid**)
- **Self‑serve** path: only the **`trial`** plan is auto‑provisionable; the wizard provisions it.
- **Paid** plans are **not** auto‑grantable from the wizard — selecting "Business+/Enterprise/Sovereign"
  records intent + raises a **lead** and shows "our team will activate this"; activation is the
  existing admin **`POST /admin/tenants/{id}/license`** or **offline‑license** flow.

### 4.3 Default tier fix (D2)
- **Stop hard‑coding `TierEnterprise`** at `onboarding_repo.go:96`. New tenants start with **no
  paid grant**; the provisioner assigns the **`trial`** license. `subscription_tier` is set from the
  resolved plan (or column deprecated).

---

## 5. Onboarding → licensing wiring (the missing link)

### 5.1 New provisioner step (D6 = **service‑to‑service call**, option B)
Insert **"Assign Default License"** into `provisioner.pipelineSteps()` (`provisioner.go:243-284`),
**before** `SetTenantStatus(active)`:
1. Resolve `tenant_onboarding.active_suites` → entitlement keys via the **canonical map**
   (`lex→app.watheeq`, `visus→app.bosalah`, suites→`suite.*`).
2. Call license‑service **internal scoped assign**:
   `AssignScopedLicense{TenantID, PlanKey:'trial', Seats, ExpiresAt:now+trialDays, GraceDays,
   GrantedEntitlements:[...]}`.
3. The `trial` plan itself grants **only `seats.users`**. The selected product entitlements are
   written as per‑tenant **positive overrides** (`limit_value=NULL`) in the same license‑service
   transaction. Do **not** seed a broad trial plan and revoke unselected products; that risks future
   products being accidentally included.
4. **Idempotent**: `tenant_licenses` is `UNIQUE(tenant_id)` — re‑run = upsert; scoped assign also
   replaces prior onboarding‑managed product grants for that tenant.
5. **Failure policy** (D7): fail‑provisioning vs downgrade‑to‑minimal. Recommend **fail the step
   loudly** (provisioning_status=`failed`, retryable) so no tenant goes live un‑licensed.
- **Do NOT cross‑write `license_db` from onboarding** (onboarding lives in `platform_core`). Add a
  thin **internal/machine‑auth** scoped assign endpoint (service token), since the existing assign
  requires `licensing:admin` (a human scope). The license service must own the license row,
  onboarding product grants, outbox events, and cache invalidation atomically.

### 5.2 Seats enforcement (D5)
- Provisioner sets `tenant_licenses.seats` from the plan/selection.
- Wire **iam user invite/create** → license‑service `POST /usage{key:'seats.users',amount:1}` (or
  `GET /check`) so the cap actually binds (today seeded but unenforced).

---

## 6. API contracts (new / changed)

| # | Type | Contract | Notes |
|---|---|---|---|
| 1 | DB | `license_db/000005_seed_trial_plan` | add `trial` (+ optional `free`) plan; `trial` grants `seats.users=5` only |
| 2 | Code | `license/model/keys.go` | add real missing product keys such as `app.mahamatech`, `app.ehkam`; keep `lex`/`visus` as aliases, not license keys |
| 3 | DB | `platform_core/000033_onboarding_plan` | `tenant_onboarding` += `plan_key TEXT`, `seats INT`; **stop hard‑coding enterprise** in `onboarding_repo.go:90-96` |
| 4 | API | `GET /api/v1/onboarding/plans` (public‑in‑wizard) | returns the **self‑serve‑assignable** catalog for the plan step (passthrough to licensing catalog filtered `self_serve=true`) |
| 5 | API | extend step‑4 DTO `SuitesStepRequest` → `ProductsPlanStepRequest{active_suites[], plan_key, seats}` | map ids→canonical entitlement keys; add `siem/datastream` only when product says they are self‑serve ready |
| 6 | API | internal **`POST /internal/licensing/tenants/{id}/scoped-license`** (service‑token auth) | provisioner calls this; assigns plan + selected product grants atomically; not `licensing:admin` |
| 7 | Code | **canonical catalog generator** | one JSON/YAML source generates Go + TS constants; contract tests prevent gateway/license/onboarding/frontend drift |
| 8 | API | `402` response carries `upgrade_url`/`plan_required` | so the FE `402` interceptor deep‑links to `/pricing` / manage‑subscription |

---

## 7. Data model changes (migrations)

- **`license_db/000005`** — `trial` plan (+`free`?) with `seats.users=5` only; product grants are
  tenant‑scoped overrides created during onboarding.
- **`license/model/keys.go`** — add missing real app keys (+ child apps where needed); keep alias
  strings (`lex`, `visus`) outside the enforcement key registry.
- **`platform_core` migration** — `tenant_onboarding.plan_key`, `.seats`; document
  `subscription_tier` as **derived/deprecated** (or add a CHECK mapping). Change the registration
  insert default off `TierEnterprise`.
- **Existing‑tenant backfill** — first produce an audit report (active/onboarding/dev/paid/test).
  Then assign `business-plus`/`enterprise` for known paid tenants and `trial` for eligible self‑serve
  tenants so enforcement state is consistent.

---

## 8. Enforcement & lifecycle

- **`402` → upsell**: FE axios `402` interceptor → toast + route to `/pricing` (self‑serve trial CTA)
  or tenant `manage subscription` (request upgrade). Today `402` is an unhandled dead end.
- **Trial lifecycle**: `expires_at` + `grace_days` already model `active→in_grace→expired`
  (`model.go:90-105`). Add a **scheduled job** (license‑service) to flip expired trials → suspend
  suite access + notify (reuse notification‑service). Upgrade clears it.
- **Upgrade**: self‑serve "request upgrade" → lead/admin assign (paid) **or** offline‑license
  activate (`POST /offline-license/activate`) — both exist.
- **Fail‑open/closed**: confirm intended posture per env (`middleware/proxy_entitlement.go`) — recommend
  **fail‑closed in prod** for suite routes, **fail‑open** for licensing/auth/onboarding.

---

## 9. Frontend UX

- **Wizard step 4 "Products & Plan"** (`app/(onboarding)/setup/_components/`): product/suite
  configurator that **respects the chosen plan's grants** (greys out non‑entitled), a **plan card
  selector** (default Trial), seats input; trial banner ("14 days, 5 seats, upgrade anytime").
  Add `siem`/`datastream` to `shared.ts SUITES` only when product confirms they are ready for
  self‑serve onboarding.
- **Marketing `/pricing` → signup bridge** (D7): "Start free" deep‑links `…/register?suites=…&plan=trial`
  using the **canonical id map** (marketing `clariosec/clarioinsight/business-plus/datastream` →
  wizard/keys); "Talk to sales" stays for Platform/Sovereign.
- **Tenant‑admin "Manage subscription"** (`/admin/billing`): show **real** plan/usage/seats from
  `GET /api/v1/licensing/entitlements` + `/usage` (today it's decorative off `subscription_tier`);
  "Request upgrade" CTA.
- **Super‑admin console** (`/console/platform/licensing`): already exists (plan CRUD, assign,
  offline‑license, overrides, usage) — keep as the activation surface for paid.

---

## 10. Phased delivery

**P0 — Unblock (days): every new tenant gets a real, bounded license.**
- Add `trial` plan (mig 000005) with `seats.users=5` only + canonical id→key alias map.
- Add provisioner **"Assign Default License"** step (trial + selected product grants) + internal
  scoped assign endpoint; stop hard‑coding enterprise; audit/backfill existing tenants.
- Keep the selectable product surface unchanged unless product confirms `siem/datastream` are
  self‑serve ready. → **No more 402‑on‑signup; no silent enterprise.**

**P1 — Selection UX:** extend step 4 → Products+Plan (DTO + `plan_key/seats` columns); public
`GET /onboarding/plans`; product configurator respects plan; optionally add `siem/datastream`;
`402` upsell interceptor.

**P2 — Commerce loop:** marketing→signup deep‑link; tenant "Manage subscription/Request upgrade";
seat enforcement on user‑invite; trial‑expiry job + notifications.

**P3 — Payments / formal sales:** payment‑provider hook for self‑serve paid **or** formalize
lead→quote→offline‑license issuance; per‑app SKUs if needed.

---

## 11. Decisions for sign‑off (→ decision register)

| ID | Decision | Recommendation |
|---|---|---|
| **D1** | Self‑serve vs sales‑assisted | **Hybrid**: self‑serve **trial**; paid = sales/admin/offline‑license |
| **D2** | Default tier | **Trial** (time‑boxed, selected‑suites, 5 seats); **stop enterprise hard‑code**; `free` later |
| **D3** | Where plan selection lives | **Sub‑step of wizard step 4** (no renumber); `RegisterRequest` unchanged |
| **D4** | Entitlement granularity | **Two‑level**: `suite.*` billable + `app.*` children; aliases map to canonical keys, not duplicate keys |
| **D5** | Seats | Keep single `seats.users`; **wire enforcement** on user‑invite |
| **D6** | Onboarding→license mechanism | **Service‑to‑service scoped assign** in provisioner (internal endpoint), idempotent and atomic |
| **D7** | Marketing→signup bridge & 402 UX | **"Start free" deep‑link** + `402`→`/pricing` upsell; keep "Talk to sales" for top tiers |
| **D8** | `subscription_tier` enum fate | **Deprecate as source of truth**; derive from active `license_db` plan |
| **D9** | Provisioning license‑assign failure | **Fail the provisioning step** (retryable) — never go live un‑licensed |

---

## 12. Risks
- **Existing tenants**: all currently `enterprise` w/o licenses → audit before backfill, or they'll
  402 once enforcement tightens.
- **Canonical map drift**: 5 layers duplicate the mapping today — the shared module **must** become
  the only definition or drift returns. Generate Go + TS constants from one catalog and add a
  contract test asserting gateway tags == catalog keys.
- **lex/visus rename**: changing wizard ids to real keys touches FE + `common.go` validation +
  default `active_suites` — do behind the alias map to stay back‑compat.
- **Trial overgrant**: if `trial` contains product grants directly, future products can accidentally
  become available to every trial tenant. Keep trial product access as onboarding‑managed overrides.
- **Trial abuse**: dedupe by org/email/domain; cap trials per org.

---

## 13. Implementation status — P0 SHIPPED & E2E‑verified (2026‑06‑28)

P0 is implemented, unit‑tested, deployed to the live box, and verified end‑to‑end. The
adversarial review's feasibility fixes were incorporated; the mechanism below is what was
actually built (it differs from the first‑draft mechanism in §5.1 — that draft was infeasible).

**What shipped**
- **Canonical catalog** — `backend/internal/catalog/catalog.go` (+ tests): single source mapping
  wizard suite ids → entitlement keys (incl. the aliases `lex→app.watheeq`, `visus→app.bosalah`)
  and the self‑serve key set. `siem`/`datastream` are now selectable
  (`ensureActiveSuites`, `common.go`). **No wizard ids renamed; no new entitlement keys added**
  (so `keys.go`/`keys_test.go` are untouched) — per review fix #6.
- **`trial` plan** — `migrations/license_db/000005_seed_trial_plan.{up,down}.sql`: a **catalog**
  plan granting *all* self‑serve keys + `seats.users=5`. Scoping is done by **revoke overrides**
  (`Limit=0`) on the keys a tenant did NOT select — review fix #1 (overrides can only revoke, so
  grant‑all‑then‑revoke, NOT the infeasible "overrides limit to selected").
- **Service‑to‑service integration** — review fix #4: new `middleware.ServiceToken` (shared) +
  `Handler.InternalRoutes()` mounting `POST /internal/licensing/tenants/{id}/license`,
  `PUT|DELETE /overrides/{key}` under it; license‑service mounts it **only when
  `LICENSE_INTERNAL_TOKEN` is set** (opt‑in, off by default). The onboarding provisioner calls it
  via `internal/onboarding/service/license_client.go` (HTTP + `X-Service-Token`). Direct
  service‑to‑service (not via gateway); **no JWT‑permission path needed**.
- **Provisioner step** — `provisioner.go` "Assign Default License" (last step, before
  `SetTenantStatus(active)`): assigns the `trial` plan scoped to the suites known at provision time.
- **Sequencing fix (not in the original doc)** — provisioning is triggered at **verify‑email**
  (`registration_service.go:302`), *before* the wizard suites step, so the provisioner sees the
  **default** suites. The customer's real selection is applied by a **re‑scope on the suites step**
  (`WizardService.SaveSuites → RescopeLicense`): re‑grant selected keys (DELETE revoke override) +
  revoke the rest. Best‑effort/non‑fatal so a licensing hiccup never fails the wizard.
- **Stop the enterprise hard‑code** — `onboarding_repo.go` now creates tenants `TierFree` (display
  only); the real grant is the trial license.

**Wiring/config**: iam‑service `LICENSE_INTERNAL_URL` (→ license‑service `:8096`) +
`LICENSE_INTERNAL_TOKEN`; license‑service same `LICENSE_INTERNAL_TOKEN` (ecosystem + `clario360.env`).

**E2E result (live, https://devops.ofpsplatform.com box)** — onboarded a fresh tenant, selected
`[cyber, lex]`:
- tenant created `subscription_tier='free'` (no enterprise); provisioner assigned `plan=trial,
  seats=5, status=active` (no more `402`‑on‑signup).
- After the suites step, `entitlement_overrides` = `app.acta, app.bosalah, suite.data,
  suite.datastream, suite.siem` revoked → only `suite.cyber` + `app.watheeq` (lex) granted.
- **Gateway enforcement**: `/api/v1/cyber/*` and `/api/v1/lex/*` → **200**; `/api/v1/data/*` and
  `/api/v1/siem/*` → **402**. Exactly the selection.

**Deferred (P1+ — per review, explicitly NET‑NEW, not shipped)**
- Wizard **plan picker** UI + persisted `plan_key/seats` on `tenant_onboarding` (D3) and a public
  `GET /onboarding/plans` — P0 auto‑assigns `trial`, no picker yet.
- **Two‑level resolver** (`suite.X` ⇒ child `app.*`) — review fix #3: net‑new; gating stays at
  `suite.*`/existing flat keys for now.
- **Seat enforcement** at user‑invite (review fix #7: counter already meters at `enforce=false`;
  the synchronous `Check` before user‑create is not wired).
- **`402` upsell payload** (`plan_required`/`upgrade_url`) + FE interceptor (review fix #8).
- **Trial‑expiry job**, marketing `/pricing`→signup deep‑link, paid self‑serve / payments (P2/P3).
- **`platform_core` migration** for deprecating `subscription_tier` would be **000024** (review fix
  #5) — not needed for P0 (we set `TierFree` in code).

---

## 14. Implementation status — P1/P2 UX & upsell pass (2026‑06‑28)

Implemented in this pass:
- **Persisted onboarding plan intent** — `tenant_onboarding.plan_key` and `tenant_onboarding.seats`
  are added by `platform_core/000024_onboarding_plan_selection` and included in the base
  onboarding migration for new environments. Wizard progress now returns both fields.
- **Products & Plan API** — `GET /api/v1/onboarding/plans` returns the self‑serve trial catalog and
  products from `internal/catalog` (`cyber`, `data`, `siem`, `datastream`, `acta`, `lex`, `visus`).
- **Wizard step 4 UX** — the frontend step is now **Products & Plan**: trial banner, plan card,
  capped seats input, server-catalog products, entitlement/plan-constrained disabled states, and a
  `{active_suites, plan_key, seats}` submit payload.
- **Trial re-scope now carries seats** — saving step 4 persists the seat count and reassigns the
  scoped trial license with that count before applying selected/unselected product overrides.
- **402 upsell contract** — gateway `ENTITLEMENT_REQUIRED` responses now include
  `plan_required` and `upgrade_url`; the frontend API layer preserves those fields and dispatches a
  `clario360:entitlement-required` browser event. The root toast provider now listens for that event
  and shows a visible upgrade prompt with a same-origin review action.
- **Marketing → signup bridge** — `/pricing` now exposes a `Start free` trial CTA to
  `/register?suites=cyber,data,siem,datastream,acta,lex,visus&plan=trial`, and registration
  preserves sanitized `suites`/`plan=trial` into the verify-email URL. Verification now carries that
  intent into the setup wizard draft before redirecting.
- **Invite acceptance metering signal** — accepting an invitation now emits the IAM
  `com.clario360.iam.user.created` event so existing license metering sees invited users too.

Verified in this pass:
- Backend focused tests:
  `GOWORK=off go test -C backend ./internal/catalog ./internal/onboarding/service ./internal/onboarding/handler ./internal/license/model ./internal/gateway/config ./internal/gateway/middleware ./internal/gateway/integration ./cmd/iam-service ./cmd/license-service`
- Backend integration tests:
  `GOWORK=off go test -C backend -tags=integration -count=1 -timeout 6m ./internal/onboarding/integration`
  and `GOWORK=off go test -C backend -tags=integration -count=1 -timeout 4m ./internal/license/handler`
- Frontend focused tests:
  `npx vitest run src/__tests__/integration/register-flow.test.tsx src/__tests__/integration/wizard-steps.test.tsx src/lib/api.test.ts src/components/providers/toast-provider.test.tsx`
- Frontend type-check:
  `npm run type-check`
- Scoped frontend ESLint on touched onboarding/auth/API/marketing files.
- `git diff --check`.

Still deferred / not fully solved:
- **Atomic scoped license endpoint** — onboarding still uses generic internal license assignment plus
  override calls, not a single transaction in license-service.
- **Hard seat enforcement** — usage is now more complete for accepted invitations, but create/accept
  flows still do not synchronously reserve seats before user creation.
- **Trial expiry scheduler/notifications**, existing-tenant backfill, tenant-admin real billing page,
  and generated Go+TS catalog contract remain open.
