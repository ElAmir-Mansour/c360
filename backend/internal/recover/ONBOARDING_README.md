# Recover Onboarding & Demo Templates (Prompt 9)

**Clario Recover — sub-solution selection + demo seeding (Wave 3, full-stack backend).**

Lets a tenant select which Recover sub-solutions to activate and land in a
**populated, navigable** product (the audit's P0 discoverability). On activation
it writes the corresponding activation (the Prompt 1 entitlement model) and
**seeds realistic demo content per selected sub-solution via real seeding logic**,
then offers a one-click full removal.

It **composes** the existing services — the Recover product `Service`
(activation), the Application Metastore `DefaultRegistry` (demo apps) + `Populator`
(demo runbooks, which itself composes Runbook Studio) — and owns **no recovery or
seeding logic of its own**. No canned UI fixtures: the demo content is real rows
in the real tables produced by the same paths a tenant uses by hand.

## Endpoints

Mounted under `/api/recover` on the same `Auth` + `Tenant` group as the rest of
the Recover product. Both self-gate on `dr:admin` (they mutate activation state
and seed/remove content). Responses use the suiteapi `{data}` envelope.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `POST`   | `/api/recover/onboarding/activate`  | `dr:admin` | Activate the selected sub-solutions and seed demo content for each. |
| `DELETE` | `/api/recover/onboarding/demo-data` | `dr:admin` | Remove ALL demo content for the tenant (idempotent). |

### Activate request / response

```json
// POST /api/recover/onboarding/activate
{ "sub_solutions": ["it-dr", "cloud-dr", "cyber-recovery"] }
```

```json
// 200
{ "data": { "results": [
  { "sub_solution": "it-dr", "activated": true, "already_seeded": false,
    "application_keys": ["demo-it-dr-core-banking"],
    "application_count": 1, "runbook_count": 1 }
  // cloud-dr, cyber-recovery ...
] } }
```

Errors: `400 bad_request` (empty selection / `ErrNoSubSolutionsSelected` / a bad
metadata payload), `404 not_found` (unknown sub-solution slug — rejected before
any state is written, so there is no partial activation), `401 unauthorized`
(no tenant / not `dr:admin`).

### Remove demo data

```json
// DELETE /api/recover/onboarding/demo-data  → 200
{ "data": { "runbooks_removed": 3, "applications_removed": 3 } }
```

## What gets seeded

One realistic demo application per selected sub-solution, each with a
recovery-target environment so a real runbook is materialized from it:

| Sub-solution | Demo app (`app_key`) | Tier | Runbook shape (from metadata) |
|---|---|---|---|
| `it-dr` | `demo-it-dr-core-banking` | mission_critical | app-failover to the DR data centre |
| `cloud-dr` | `demo-cloud-dr-payments-api` | tier_1 | region-failover to the secondary region |
| `cyber-recovery` | `demo-cyber-erp` | mission_critical | clean-room recovery (integrity-gated) |

Every demo `app_key` is namespaced `demo-…` and every name is tagged `[DEMO]`.
The runbook is produced by `metastore.Populator.Populate` (composes Runbook
Studio `CreateRunbook` with import steps) — the same path the
`POST /api/recover/metastore/applications/{id}/populate` action uses — so the
seeded runbooks are real, linked records the analytics endpoint and the
dashboards read.

## Idempotency & removability

A ledger table (`recover_demo_seed_item`, migration
`000041_recover_demo_seed`) records every demo entity created
`(tenant_id, sub_solution, kind, ref_id, app_key)`:

- **Idempotent seed:** a sub-solution that already has demo applications is a
  no-op (`already_seeded: true`); a half-finished earlier seed (the app landed,
  the ledger row did not) is **adopted** via `ErrAlreadyExists` rather than
  failing. The ledger's `UNIQUE (tenant_id, kind, ref_id)` + `ON CONFLICT DO
  NOTHING` makes re-recording a no-op.
- **Full removal:** `RemoveDemoData` deletes every ledgered runbook (direct
  delete on `dr_studio_runbook`, cascading its tasks/runs) then every ledgered
  Metastore application (via `DefaultRegistry.DeleteApplication`, cascading its
  children + runbook links), then the ledger rows. Removing when nothing is
  seeded is a clean zero.

`kind` is one of `metastore_application` or `runbook`. `ref_id` is a soft
reference to the owning table's id (no cross-table FK — disjoint ownership).

## Persistence

Migration `000041_recover_demo_seed` (reversible UP + DOWN, verified apply +
rollback + re-apply). One table, RLS enabled + forced per tenant (the dr_db RLS
clone; `app.bypass_rls` reserved for system paths), indexed on
`(tenant_id, sub_solution)` and `(tenant_id, sub_solution, app_key)`.

## Go surface

```go
import recoverproduct "github.com/clario360/platform/internal/recover"

svc, _ := recoverproduct.NewOnboardingService(recoverproduct.OnboardingConfig{
    Activator:      productSvc,          // *recover.Service (SetActivation)
    Registry:       metastoreRegistry,   // *metastore.DefaultRegistry
    Populator:      metastorePopulator,  // *metastore.Populator (composes Runbook Studio)
    Runner:         recoverproduct.PGXRunner{Pool: db},
    SeedStore:      recoverproduct.NewDemoSeedStore(),
    RunbookDeleter: recoverproduct.NewRunbookDeleter(),
    Logger:         logger,
})
svc.Onboard(ctx, tenantID, []string{"it-dr"}, &userID) // (*OnboardResult, error)
svc.RemoveDemoData(ctx, tenantID)                       // (*RemoveDemoResult, error)
```

`cmd/clario-dr-service/recover.go` constructs it over the same
`metastoreRegistry` / `metastorePopulator` the Metastore seam uses and sets
`router.Onboarding = recoverproduct.NewOnboardingHandler(onboardingSvc, logger)`.

## Route registration (Wire agent)

The onboarding handler is wired onto the existing Recover Auth+Tenant group in
`internal/recover/router.go`, guarded so the product router stays usable without
it:

```go
// Onboarding sub-solution selection + demo templates (Prompt 9).
if h.Onboarding != nil {
    h.Onboarding.Register(r)
}
```

(`Register` adds the two `dr:admin`-gated routes onto the group.)

## Tests

`onboarding_test.go` (all in-package, mocks only in the test file): happy path
(selection writes the correct activations; each sub-solution seeds one real
app + one real runbook in the metastore/ledger), idempotent re-seed (no new
apps/runbooks; `already_seeded`), existing-app adoption, full removal (metastore
+ runbooks + ledger all cleared), idempotent removal, empty-selection and
unknown-slug edge cases (rejected before any write), populate-error propagation,
constructor validation, concurrency (8 concurrent same-tenant onboards →
no orphaned ledger; removal fully cleans), and router authz (dr:admin required;
analyst denied; unauthenticated denied; 400 empty body; 404 unknown slug).
