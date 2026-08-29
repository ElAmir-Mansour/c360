# RECOVER_CONTRACT.md

**Clario Recover — product & entitlement contract (Prompt 1, Wave 1 foundation).**
This is the contract every other Recover prompt (navigation, landing page, the
three sub-solution workspaces, the Metastore seam, analytics, onboarding, the
prove surface) depends on. It is published by `backend/internal/recover/`.

Status: implemented and tested. Backend builds (`GOWORK=off go build ./...`),
package tests green (`go test ./internal/recover/...`), migration applies and
rolls back cleanly.

---

## 1. The product

One product, **`recover`** (label "Clario Recover"), with **three sub-solutions**.
Each sub-solution composes existing, wired `dr/*` services — Recover adds no
recovery logic of its own; it is a productization layer.

| Sub-solution slug | Label | Entitlement key | Composed `dr/*` services |
|---|---|---|---|
| `it-dr` | IT Disaster Recovery | `recover.it_dr` | runbookstudio, registry, topology, recoverytier, drillsched, attestledger |
| `cloud-dr` | Cloud Disaster Recovery | `recover.cloud_dr` | iacdr, vmcapture, bootgraph, appverify, failback |
| `cyber-recovery` | Cyber Recovery | `recover.cyber_recovery` | cleanroom, cybervault, ransomware, instant, attestledger |

The slugs are **stable** — navigation, routing, analytics, and onboarding key
off them. They are exported as `recover.SubSolution*` constants and via
`recover.SubSolutionIDs()`.

---

## 2. Entitlement keys

The three keys are registered in the **canonical licensing key registry**
(`internal/license/model/keys.go` → `EntitlementKeys`) as `suite`-kind keys, so
the gateway and the licensing admin surface recognise them like any other suite
key. **They reuse the existing entitlement engine** — there is no second
entitlement system.

```
recover.it_dr          → Recover — IT Disaster Recovery
recover.cloud_dr       → Recover — Cloud Disaster Recovery
recover.cyber_recovery → Recover — Cyber Recovery
```

Exported in Go as:
`license/model.RecoverITDRKey`, `RecoverCloudDRKey`, `RecoverCyberRecoveryKey`
(aliased by `recover.EntitlementITDR / EntitlementCloudDR / EntitlementCyberRecovery`).

**Resolution path (single source of truth):** the Recover product resolves each
key per-tenant through `gateway/entitlement.HTTPChecker`, which forwards the
caller's validated bearer token to the licensing service
(`GET /api/v1/licensing/check?key=...`). The licensing service derives the same
tenant from the same token and decides from the tenant's plan + overrides. There
is **never** a hardcoded "all enabled".

**Fail modes:** production fails **closed** — a licensing outage yields HTTP 503
`entitlement_unavailable`, never a silent grant. Dev may set
`RECOVER_ENTITLEMENT_FAIL_OPEN=true` to treat an outage as entitled (the
response records the degraded reason).

**Self-serve upgrade:** the gateway maps all three keys to the `recover` suite,
so a 402 denial yields `upgrade_url=/register?suites=recover&plan=trial`.

---

## 3. Endpoints

All Recover routes are mounted under **`/api/recover`** in `clario-dr-service`,
behind the same `Auth` + `Tenant` middleware as `/api/v1/dr`, and each route
self-gates with `RequirePermission`.

### `GET /api/recover/products` — permission `dr:read`

Returns the product, its three sub-solutions, each sub-solution's **live
per-tenant entitlement state**, and the underlying composed capabilities.

Response (suiteapi `{data}` envelope):

```json
{
  "data": {
    "product": "recover",
    "label": "Clario Recover",
    "sub_solutions": [
      {
        "id": "it-dr",
        "label": "IT Disaster Recovery",
        "value_prop": "Author and execute dynamic recovery runbooks ...",
        "entitlement_key": "recover.it_dr",
        "entitlement": {
          "key": "recover.it_dr",
          "active": true,        // licensed for this tenant (from the licensing engine)
          "activated": true,     // tenant has turned the sub-solution on (onboarding)
          "reason": ""           // denial reason when active=false
        },
        "capabilities": [
          {
            "id": "runbookstudio",
            "label": "Runbook Studio",
            "description": "Editable recovery runbooks ...",
            "service": "github.com/clario360/platform/internal/dr/runbookstudio"
          }
          // ...
        ]
      }
      // cloud-dr, cyber-recovery ...
    ]
  }
}
```

`active` vs `activated`:
- **`active`** = the licensing engine grants the key for this tenant (entitlement).
- **`activated`** = the tenant has explicitly turned the sub-solution on
  (persisted by Recover; written by onboarding, Prompt 9). A sub-solution can be
  `active:true, activated:false` (licensed, offered to enable).

Errors: `401 unauthorized` (no tenant/permission), `503 entitlement_unavailable`
(licensing engine unreachable, fail-closed), `500 internal`.

### `POST /api/recover/sub-solutions/{id}/activate` — permission `dr:admin`

Persists whether a tenant has activated one sub-solution. `{id}` is a
sub-solution slug; body `{"activated": true|false}`. Idempotent upsert.
**Activation does not grant licensing entitlement** — that remains the licensing
engine's responsibility. This is the persistence seam onboarding (Prompt 9) uses.

```json
// 200 { "data": { "sub_solution": "cloud-dr", "activated": true, "updated_at": "..." } }
```

Errors: `400 bad_request` (missing/invalid body), `404 not_found` (unknown
slug), `401 unauthorized`.

---

## 4. Persistence

- **Entitlement** is **not** duplicated — it lives in the licensing engine
  (`platform_core`) and is resolved at request time.
- **Activation** is persisted in `dr_db.recover_sub_solution_activation`
  (migration `000036_recover_activation`), one row per `(tenant_id, sub_solution)`,
  RLS-isolated per tenant, with a `CHECK` on the three slugs. Migration is
  reversible (UP + DOWN, verified apply/rollback).

---

## 5. For downstream agents

- **Navigation/routing (Prompt 2):** drive visibility off
  `GET /api/recover/products` → `sub_solutions[].entitlement.active`. Slugs map
  to routes `recover/it-dr`, `recover/cloud-dr`, `recover/cyber-recovery`.
- **Landing page (Prompt 3):** card state = `entitlement.active` (active) vs
  not-licensed (show "Request access"); `entitlement.activated` distinguishes
  enabled vs offered.
- **Onboarding (Prompt 9):** write licensing entitlements via the licensing
  service (`license.service.AssignLicense` / plan entitlements with the three
  keys), and call `POST /api/recover/sub-solutions/{id}/activate` to record the
  tenant's selection.
- **Capability composition:** the registry (`recover.Registry()`) is the
  authoritative map of which `dr/*` services back each sub-solution.

## 6. Go surface (importable by other backend prompts)

```go
import recoverproduct "github.com/clario360/platform/internal/recover"

recoverproduct.Product                 // "recover"
recoverproduct.SubSolutionITDR         // "it-dr" (+ CloudDR, CyberRecovery)
recoverproduct.SubSolutionIDs()        // []string{"it-dr","cloud-dr","cyber-recovery"}
recoverproduct.Registry()              // []SubSolution with composed capabilities
recoverproduct.EntitlementITDR         // "recover.it_dr" (+ CloudDR, CyberRecovery)

// Service: composes the licensing engine + activation store + registry.
svc, _ := recoverproduct.NewService(recoverproduct.Config{ Runner, Store, Entitlements, Logger })
svc.GetProducts(ctx, tenantID, authorization) // (*ProductView, error)
svc.SetActivation(ctx, tenantID, slug, activated)
```
