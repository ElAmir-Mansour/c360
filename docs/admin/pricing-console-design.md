# Pricing & Quoting — Build Spec (Platform Admin Console)

Status: DESIGN (reversible code + tests only; HOLD on deploy/shared-DB migrations)
Owner service: `license-service` (`backend/cmd/license-service`, DB `license_db`)
Console area: `frontend/src/app/(dashboard)/console/platform/pricing/*`
Source of truth for the model: `docs/admin/Enterprise_Pricing_Calculator_2.xlsx` (2 sheets: per-user, per-core; all money SAR)
Grounding read: `docs/platform-admin-console.md`, licensing sibling `.../console/platform/licensing/*`

Golden-vector re-derivation: the FORMULA MAPPING in §3 was executed against all published golden
vectors (per-user and per-core, all 4 tiers, all Std line items, RealizedMargin) and reproduces every
figure to < 1e-6 SAR. These vectors are the acceptance tests in §3.4.

---

## 1. Architecture

### 1.1 Why license-service
PRICING is the natural sibling of LICENSING: the 4 tiers (Standard/Growth/Professional/Customized)
conceptually map to `license_plans`, and the commercial loop (quote → accept → plan assign →
provisioning) terminates in the licensing lifecycle that already exists in this service
(`AssignLicense`, `plan_entitlements`, `usage_counters`). Co-locating avoids a new service, reuses the
DB pool, the outbox/event pattern, the JWT auth + `licensing:admin` RBAC wiring, and migration tooling.

New Go package: `backend/internal/pricing/` mirroring the licensing package layout:

```
backend/internal/pricing/
  engine/        engine.go   engine_test.go      # PURE server-authoritative calculator (no I/O)
  model/         model.go    model_test.go       # PricingConfig, Quote, tier outputs, sentinels
  config/                                        # (reuse license/config; add PRICING_* only if needed)
  repository/    repository.go repository_test.go
  service/       service.go  service_test.go     # versioned config CRUD + compute orchestration
  handler/       handler.go  integration_test.go # HTTP surface (mounted by license-service main)
```

Wiring (in `backend/cmd/license-service/main.go`, additive, no behavior change to existing routes):
- construct `pricingSvc := pricingservice.New(svc.DBPool, pricingrepo.New(), logger)`
- construct `pricingHandler := pricinghandler.New(pricingSvc, logger)`
- mount under the SAME authenticated group as licensing:
  `svc.Router.Route("/api/v1/pricing", func(r){ r.Use(sharedmw.Auth(jwtMgr)); r.Use(sharedmw.Tenant); r.Mount("/", pricingHandler.Routes()) })`
- migrations already auto-run via `runMigrations` (path `migrations/license_db`); the new files just get picked up.

### 1.2 Server-authoritative engine (hard rule)
The engine is a PURE Go function `engine.Compute(cfg PricingConfig, in Inputs) Quote`. It runs ONLY on
the server. The client NEVER sends rates, factors, margin floor, markup, or internal cost — it sends
only the INPUTS (deployment, term, volume drivers, storage). The server loads the active
`pricing_config` version, computes tiers, and returns them.
- Margin floor guardrail is evaluated server-side; a "BELOW FLOOR" result is enforced, not advisory.
- `InternalCost`, `GrossProfit`, `RealizedMargin`, `markup`, and per-unit build-up rates are INTERNAL
  fields. They are computed always but SERIALIZED ONLY into the internal DTO returned to
  `pricing:admin`/internal roles (§4, §5). The client-facing tier DTO physically omits these fields —
  masking is by struct shape, not by a runtime flag the client could flip.

### 1.3 Config is versioned data, not code
The ~40 rates live in `pricing_config` rows (§2), each an immutable version with effective dates and
`created_by`. The engine takes a `PricingConfig` value; it has no hard-coded rates except the
compiled-in `DefaultConfig()` used to seed version 1 and to back the golden-vector tests. Changing a
rate = publishing a new version (governed, audited), never a code change.

### 1.4 Audit / tamper-evidence
Every config publish and every quote status transition (Phase 2) stages an event through the existing
transactional outbox (`outbox.Write` on topic `Topics.LicenseEvents`, event source `license-service`,
event types `pricing.config_published`, `pricing.quote_*`). The audit consumer already folds
`platform.license.events` into the hash-chained audit log (`internal/audit/hash/chain.go`), so pricing
governance inherits tamper-evident history with zero new plumbing. Config publishes therefore commit
in ONE transaction with their outbox event, exactly like `AssignLicense`.

---

## 2. Data Model (migrations → `backend/migrations/license_db/`)

Next free number is **000009** (latest is 000008). All new migrations are additive / reversible /
idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, down = `DROP TABLE IF EXISTS`).
No changes to existing tables → existing license-service tests cannot regress.

### 2.1 `pricing_config` (Phase 1) — VERSIONED, single source of truth

`000009_pricing_config.up.sql`

```sql
CREATE TABLE IF NOT EXISTS pricing_config (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    version        INT         NOT NULL UNIQUE,          -- monotonic; app-assigned = max(version)+1
    status         TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','archived')),
    -- The ~40 rates as a typed JSONB payload (see 2.1.1). One payload column keeps the
    -- migration stable as the model evolves; the Go struct is the typed contract & is
    -- validated on write, so JSONB is a serialization detail, not a schema escape hatch.
    payload        JSONB       NOT NULL,
    currency       TEXT        NOT NULL DEFAULT 'SAR',
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to   TIMESTAMPTZ,                          -- NULL = open-ended (current active)
    notes          TEXT        NOT NULL DEFAULT '',
    created_by     UUID        NOT NULL,                 -- IAM user id (from JWT sub)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most ONE active version at a time (partial unique index enforces the invariant in-DB).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_config_single_active
    ON pricing_config ((status)) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pricing_config_effective
    ON pricing_config (effective_from, effective_to);
```

Seed version 1 idempotently from `DefaultConfig()` in the same migration (or a `000010_seed_pricing_config`)
so a fresh DB has an active config that reproduces the golden vectors. `ON CONFLICT (version) DO NOTHING`.

Rationale for JSONB-payload over ~40 columns: the payload is a **typed** Go struct (`PricingRates`)
marshalled whole; adding a rate is a struct field + a new config VERSION, never an `ALTER TABLE`.
Every field is range-validated on write (§2.1.1), so we get the auditability of typed config without
migration churn. (If the business later wants SQL-level analytics on individual rates, a generated
column or a flattened view can be added additively.)

#### 2.1.1 `PricingRates` payload (the ~40 governed rates)

```jsonc
{
  "fx_usd_to_sar": 3.75,
  "vat_rate": 0.15,
  "markup_multiplier": 1.30,
  "sales_discount_default": 0.0,
  "annual_commit_discount": 0.10,      // applied when term_months >= annual_commit_min_months
  "annual_commit_min_months": 12,
  "min_margin_floor": 0.10,

  "tier_resource_factor": { "standard": 1.0, "growth": 1.15, "professional": 1.35, "customized": 1.6 },

  "ai_cost_per_1m_tokens": 3.0,
  "ai_allowance_millions": { "standard": 2, "growth": 5, "professional": 10 }, // per unit; Customized excluded
  "ai_dedicated_cost": 500.0,          // Customized: flat, uncapped, NOT per-unit

  "storage_hot_usd_per_gb": 5.0,
  "storage_cold_usd_per_gb": 1.0,
  "storage_volume_factor_saas": 0.8,
  "storage_volume_factor_local": 0.5,  // on-prem or air-gapped

  "deployment_setup_flat": 500.0,      // 0 for SaaS
  "airgap_high_security_multiplier": 1.4,

  "per_user": {                        // per-unit base build-up
    "compute": 4, "licensing": 3, "support": 2.5, "security": 1.5, "overhead": 2
    // base_cost = 13
  },
  "per_core": {
    "compute": 20, "licensing": 8, "support": 6, "security": 4, "overhead": 2, // base_cost = 40
    "cost_per_vm": 100
  },

  "volume_breakpoints": [              // step LOOKUP by units, ascending; pick highest threshold <= units
    { "min_units": 0,   "discount": 0.0 },
    { "min_units": 25,  "discount": 0.05 },
    { "min_units": 100, "discount": 0.10 },
    { "min_units": 250, "discount": 0.15 }
  ]
}
```

Write-time validation (service layer, fail-closed): all rates finite and >= 0; `vat_rate`, discounts,
`min_margin_floor` in [0,1]; `markup_multiplier` >= 1; tier factors > 0; `volume_breakpoints` sorted
ascending and starting at `min_units: 0`. Reject the publish on any violation (400).

### 2.2 `quotes` (Phase 2 — DESIGNED NOW, built later)

`000011_quotes.up.sql` (NOT built in Phase 1; schema fixed here so the engine/DTO shapes are forward-compatible)

```sql
CREATE TABLE IF NOT EXISTS quotes (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number      TEXT        NOT NULL UNIQUE,       -- e.g. Q-2026-000042 (app-generated, sequential)
    model             TEXT        NOT NULL CHECK (model IN ('per_user','per_core')),
    pricing_config_id UUID        NOT NULL REFERENCES pricing_config(id), -- exact version priced against
    pricing_version   INT         NOT NULL,              -- denormalized for fast display / immutability
    -- Commercial linkage (all nullable; a quote may precede a tenant/lead):
    tenant_id         UUID,                              -- set once linked to a provisioned tenant
    lead_id           UUID,                              -- CRM/lead linkage (forward-looking)
    account_name      TEXT        NOT NULL DEFAULT '',
    -- Inputs snapshot: the exact Inputs struct the tiers were computed from (reproducible).
    inputs            JSONB       NOT NULL,
    -- Computed tiers: the full 4-tier output INCLUDING the internal margin block. This table is
    -- INTERNAL (never served to a client); exports mask margin at the API layer (§4.4), not here.
    computed_tiers    JSONB       NOT NULL,
    selected_tier     TEXT        CHECK (selected_tier IN ('standard','growth','professional','customized')),
    status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','accepted','rejected','expired')),
    -- Governance: a below-floor quote can only reach 'sent'/'accepted' with an approval record.
    below_floor       BOOLEAN     NOT NULL DEFAULT FALSE,
    floor_override_by UUID,                              -- approver (IAM user) if below_floor was overridden
    floor_override_at TIMESTAMPTZ,
    valid_until       TIMESTAMPTZ,                       -- quote validity window
    created_by        UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_status    ON quotes (status);
CREATE INDEX IF NOT EXISTS idx_quotes_tenant    ON quotes (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_created   ON quotes (created_at DESC);
```

`computed_tiers` stores the internal block so an accepted quote is a permanent, reproducible commercial
record (config version + inputs + margins). Client-facing exports re-serialize through the masked DTO.

---

## 3. Formula Mapping — the engine contract

Domain types (Go, `internal/pricing/model`):

```go
type Model string        // "per_user" | "per_core"
type Deployment int       // 1=SaaS, 2=OnPrem/VPC, 3=AirGapped
type Tier string          // "standard" | "growth" | "professional" | "customized"

type Inputs struct {
    Model        Model
    Deployment   Deployment
    TermMonths   int
    Users        int64   // per_user model
    Cores        int64   // per_core model
    VMs          int64   // per_core model
    HotStorageGB float64
    ColdStorageGB float64
    SalesDiscount *float64 // optional; nil → cfg.SalesDiscountDefault
}
```

All money is SAR. `markup*FX` is applied to EVERY client-facing line item. `baseCost` = sum of the
per-unit build-up components (per-user default 13, per-core default 40). `units` = Users (per_user) or
Cores (per_core). `agM` (air-gap multiplier) = `airgap_high_security_multiplier` when Deployment==3 else 1.
`saas` = Deployment==1.

### 3.1 Line items — PER-USER

```
UserBaseCharge         = Users * baseCost * tierFactor[tier] * agM * markup * FX
AIAllocation (Std/G/Pro) = Users * aiAllowanceMillions[tier] * aiCostPer1M * markup * FX
AIAllocation (Customized) = aiDedicatedCost * markup * FX          # flat, uncapped, NOT * Users
DataStorage            = ((HotGB*hot$) + (ColdGB*cold$)) * (saas?0.8:0.5) * markup * FX   # SAME across tiers
DeploymentSetupPremium = (Deployment==1 ? 0 : setupFlat * agM) * markup * FX              # agM==1.4 only when dep==3
```

### 3.2 Line items — PER-CORE

```
CoreBaseCharge         = Cores * baseCost * tierFactor[tier] * agM * markup * FX
AIAllocation (Std/G/Pro) = Cores * aiAllowanceMillions[tier] * aiCostPer1M * markup * FX
AIAllocation (Customized) = aiDedicatedCost * markup * FX
VMInfrastructure       = VMs * costPerVM * agM * markup * FX        # SAME across tiers
DeploymentSetupPremium = (Deployment==1 ? 0 : setupFlat * agM) * markup * FX
```

### 3.3 Roll-up — BOTH models (per tier)

```
SubTotal        = sum(line items for the tier)
appliedVolDisc  = stepLookup(units, volume_breakpoints)          # >=250→.15, >=100→.10, >=25→.05, else 0
VolumeDiscount  = -SubTotal * appliedVolDisc
TermDiscount    = -(SubTotal + VolumeDiscount) * (TermMonths >= 12 ? annualCommitDiscount : 0)
SalesDiscount   = -(SubTotal + VolumeDiscount + TermDiscount) * salesDisc     # salesDisc default 0
NetSubTotal     = SubTotal + VolumeDiscount + TermDiscount + SalesDiscount
VAT             = NetSubTotal * 0.15
TotalMonthly    = NetSubTotal + VAT
ContractValue   = TotalMonthly * TermMonths

# INTERNAL-ONLY (never in a client-facing DTO/export):
InternalCost    = SubTotal / markup
GrossProfit     = NetSubTotal - InternalCost
RealizedMargin  = GrossProfit / NetSubTotal
Guardrail       = RealizedMargin < min_margin_floor ? "BELOW FLOOR" : "OK"
```

Rounding: compute in float64 at full precision; round ONLY for display/export (2 dp SAR). Persisted
`computed_tiers` keeps full precision. Tests assert equality to < 0.01 SAR (see 3.4).

### 3.4 Golden vectors — acceptance tests (`engine_test.go`)

Defaults: SaaS (dep=1), term=12, per-user Users=1 / per-core Cores=1 & VMs=1, Hot=2GB Cold=5GB,
all default rates. `assert |got - want| < 0.01`.

PER-USER `TotalMonthly` (SAR): Standard 156.414375 · Growth 211.66396875 · Professional 300.46696875 · Customized 2688.309
PER-USER `ContractValue`: 1876.9725 · 2539.967625 · 3605.603625 · 32259.708
PER-USER Standard line items: UserBase 63.375 · AI 29.25 · Storage 58.5 · Setup 0 · SubTotal 151.125 · TermDisc -15.1125 · NetSubTotal 136.0125 · VAT 20.401875
RealizedMargin all tiers ≈ 0.145299, Guardrail OK.

PER-CORE `TotalMonthly` (SAR): Standard 736.66125 · Growth 812.345625 · Professional 928.395 · Customized 3350.295
PER-CORE `ContractValue`: 8839.935 · 9748.1475 · 11140.74 · 40203.54
PER-CORE Standard line items: CoreBase 195 · AI 29.25 · VM 487.5 · SubTotal 711.75 · TermDisc -71.175 · NetSubTotal 640.575 · VAT 96.08625

(All 18 figures were re-derived from §3.1–3.3 and match to < 1e-6.)

Additional engine tests (guard the branches the golden vectors don't hit):
- term < 12 → TermDiscount == 0.
- Deployment 2 (on-prem): Setup line = 500*markup*FX, storage factor 0.5.
- Deployment 3 (air-gap): base/VM/setup all *1.4; storage factor 0.5.
- Volume breakpoints: units 24/25/99/100/249/250 → 0/.05/.05/.10/.10/.15.
- Customized AI: constant across Users/Cores counts (flat 500 line, uncapped).
- A crafted low-margin config → Guardrail "BELOW FLOOR".

---

## 4. API Surface

Mounted at `/api/v1/pricing` (JWT + Tenant middleware from `main.go`, same as licensing). Envelope is
`suiteapi.WriteData` → `{ "data": ... }` (frontend `unwrap()` already tolerates it). All admin/config
routes gated per §5.

### 4.1 Compute (Phase 1) — the calculator
```
POST /compute
  body: { model, deployment, term_months, users?, cores?, vms?, hot_storage_gb, cold_storage_gb, sales_discount? }
  → 200 { data: { pricing_version, currency:"SAR", tiers: [ ClientTier x4 ] } }
```
`ClientTier` (margin block PHYSICALLY ABSENT): `{ tier, line_items:{...}, sub_total, volume_discount,
term_discount, sales_discount, net_sub_total, vat, total_monthly, contract_value }`.

Internal variant for pricing:admin / internal roles:
```
POST /compute?include_internal=true      (server IGNORES the flag unless caller holds pricing:admin)
  → 200 { data: { pricing_version, tiers: [ InternalTier x4 ] } }
```
`InternalTier` = `ClientTier` + `{ internal_cost, gross_profit, realized_margin, guardrail }`. The flag
alone NEVER unlocks margin — the handler checks the JWT permission and, if absent, serves the masked
DTO regardless of the flag. Masking is enforced by choosing the DTO type by role, server-side.

### 4.2 Config CRUD — versioned (Phase 1)
```
GET  /admin/config              list all versions (metadata; payload only for pricing:read+)
GET  /admin/config/active       the current active version + full payload
GET  /admin/config/{version}    one version
POST /admin/config              create a DRAFT from a payload (validated §2.1.1) → 201
PUT  /admin/config/{version}    edit a DRAFT payload (active/archived are immutable → 409)
POST /admin/config/{version}/publish   draft→active (archives the prior active, sets effective_to);
                                       one transaction + staged pricing.config_published event
POST /admin/config/{version}/archive   active→archived (guarded; leaves no active → 409 unless a
                                       replacement is published in the same call)
```
Publish/archive follow the `AssignLicense` pattern: `database.RunInTx` + `outbox.Write` in the same tx.
Rate values echoed to non-internal `pricing:read` are allowed (they are governed config, not per-quote
margin); the strictly INTERNAL secret is per-quote `internal_cost/gross_profit/realized_margin`.

### 4.3 Quotes (Phase 2 — designed, not built in P1)
```
POST /quotes                    persist a computed quote (server recomputes from stored config+inputs;
                                does NOT trust client tier numbers) → assigns quote_number, status=draft
GET  /quotes                    list (filters: status, tenant_id, model; paginated)
GET  /quotes/{id}               one quote (internal view for pricing:admin; masked for pricing:read)
POST /quotes/{id}/send          draft→sent (blocks if below_floor && no override → 409)
POST /quotes/{id}/accept        sent→accepted
POST /quotes/{id}/reject        → rejected
POST /quotes/{id}/override-floor  records floor_override_by/at (requires pricing:admin) — see §5
```

### 4.4 Export (Phase 2)
```
GET  /quotes/{id}/export?format=pdf|xlsx
```
Server-rendered. The export pipeline serializes through the MASKED client DTO — `internal_cost`,
`gross_profit`, `realized_margin`, `markup`, and internal build-up rates are NEVER in a client-facing
export, by construction (the exporter takes `ClientTier`, which lacks the fields).

---

## 5. RBAC

New verbs (add to `internal/auth/rbac.go` as `Perm*` constants; register on the platform/pricing roles):

| Verb | Gates |
|------|-------|
| `pricing:read`  | GET compute (masked), GET config metadata + payload, GET quotes (masked) |
| `pricing:write` | POST /compute, create/edit DRAFT config, create/send quotes |
| `pricing:admin` | publish/archive config, internal margin view (`InternalTier`), below-floor override |

Rules:
- **Margin masking (hard):** `internal_cost / gross_profit / realized_margin / guardrail / markup` are
  served ONLY to callers with `pricing:admin`. Enforced by DTO-type selection in the handler
  (`InternalTier` vs `ClientTier`), NOT a boolean the client sends. `include_internal=true` from a
  non-admin is silently downgraded to the masked DTO.
- **Below-floor override needs approval:** a quote whose selected tier is `guardrail == "BELOW FLOOR"`
  cannot transition draft→sent/accepted unless `POST /override-floor` recorded a `pricing:admin`
  approver (`floor_override_by/at`). The transition handler re-checks server-side; the override is
  audited (staged event `pricing.floor_overridden`).
- **Route gating:** compute/read = `RequireAnyPermission("pricing:read","pricing:write","pricing:admin")`;
  config writes = `RequirePermission("pricing:write")`; publish/archive/internal = `RequirePermission("pricing:admin")`.
- **No role migration needed:** `HasPermission` prefix-matches `admin:*` (super_admin) and the frontend
  console already gates on `admin:console`, so super-admins get full pricing access with zero DB change.
  Grant `pricing:*` (or the granular trio) to the commercial/pricing operator role via the existing
  role-permission seed when that role is defined.
- Frontend: gate the `/console/platform/pricing` page shell on `admin:console` (mirrors licensing);
  hide the margin columns/KPIs unless the hydrated permission set contains `pricing:admin`.

---

## 6. Integration Loop (tier ↔ license_plan ↔ provisioning ↔ metering)

1. **Tier → license_plan:** the 4 tiers map to catalog plans by key
   (`standard`/`growth`/`professional`/`customized`). An accepted quote's `selected_tier` +
   `tenant_id` drives an `AssignLicense(plan_key=selected_tier, seats=Users, expires_at=now+term)` —
   the EXISTING licensing lifecycle. Phase 1 does NOT auto-assign; it establishes the mapping so
   Phase 3 can call `AssignLicense` on quote acceptance.
2. **AI allowance → usage metering:** the tier's `ai_allowance_millions * units` becomes a metered
   entitlement limit on the assigned plan (key e.g. `ai.tokens`, expressed in millions or tokens),
   consumed via the existing `usage_counters` / `Consume` path. Customized = uncapped (NULL limit,
   dedicated infra) — mirrors how `enterprise` grants `seats.users` NULL today.
3. **Seats:** `Users` (per_user) → `seats.users` limit on the tenant license (already the seat key).
4. **Provisioning:** Phase 3 wires quote-accept → `AssignLicense` → the onboarding provisioner's
   existing "assign default license" step, reusing `/internal/licensing` service-token path if the
   caller is a backend service.

The pricing engine itself performs NO writes to licensing tables; the loop is an explicit orchestration
step (Phase 3) so pricing stays a pure calculator + governed config store.

---

## 7. Phasing

**Phase 1 — Engine + Config + Calculator (this build, reversible, no deploy):**
- `internal/pricing/{engine,model,repository,service,handler}` packages.
- Migration `000009_pricing_config` (+ seed v1 from `DefaultConfig()`).
- `POST /compute` (masked + admin-internal), config CRUD + publish/archive (versioned, audited).
- Golden-vector `engine_test.go` (all 18 figures < 0.01 SAR) + branch tests + validation tests.
- Frontend `/console/platform/pricing`: a tabbed page (mirrors licensing) — **Calculator** tab
  (inputs form → POST /compute → 4 tier cards; margin/guardrail KPIs only for `pricing:admin`) and a
  **Config** tab (version list, view active payload, draft editor, publish). RTL/Arabic-first, uses
  the shared console primitives (`PageHeader`, `Tabs`, react-query hooks like `use-license-plans.ts`,
  the `unwrap()` envelope helper).

**Phase 2 — Quotes + Export:**
- Migration `000011_quotes`; quote persist/list/get, status machine, `quote_number` generator.
- Export (pdf/xlsx) through the MASKED DTO; below-floor override flow + approval audit.
- Frontend **Quotes** tab (draft/sent/accepted pipeline, tenant/lead link, export button).

**Phase 3 — Commercial loop:**
- Quote-accept → `AssignLicense` (tier→plan) + AI-allowance metering wiring + provisioning handoff.
- Lead/CRM linkage; renewal/expiry hooks off the existing `licenses/expiring` fleet read.

---

## 8. Constraints honored
- **HOLD:** reversible code + tests only; no deploy; migrations are additive/reversible/idempotent and
  target `license_db` locally — NOT run against shared/prod DB here.
- **No git ops:** files left unstaged/uncommitted.
- **Backward-compat:** no existing table/route/behavior touched; existing license-service tests unaffected.
- **Observability:** any new Prometheus metrics use `prometheus.NewRegistry()` + `promauto.With(reg)`
  (never the default registry); validation and engine guards fail-closed.
- `GOWORK=off` on all go commands; chi v5; pgx; module `github.com/clario360/platform`.
```
