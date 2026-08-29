# internal/recover — Clario Recover product & entitlement model

The productization layer that turns the existing `dr/*` modules into a
discoverable **"Recover"** product with three sub-solutions, real per-tenant
entitlement gating, and a capability registry. It **composes** the wired `dr/*`
services — it does not move, fork, or reimplement any of their logic, and it
**reuses the existing entitlement engine** (never a second one).

The full cross-agent contract is **`docs/clarioDR/RECOVER_CONTRACT.md`**.

## What this package owns

- `model.go` — the `Recover` product definition, the three sub-solutions
  (`it-dr`, `cloud-dr`, `cyber-recovery`), and the immutable capability registry
  mapping each sub-solution to the real `dr/*` services it composes.
- `entitlement.go` — `EntitlementResolver`, a thin adapter over the existing
  `gateway/entitlement.Checker`. Every decision delegates to the licensing
  service (token-forwarded); fail-open/fail-closed configurable.
- `store.go` — `recover_sub_solution_activation` persistence (per-tenant
  activation), with `PGXRunner` (RLS-scoped read/write transactions).
- `service.go` — composes resolver + store + registry into the product view and
  persists activation changes.
- `router.go` — the HTTP surface.

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/recover/products` | `dr:read` | product + per-sub-solution entitlement state + capabilities |
| POST | `/api/recover/sub-solutions/{id}/activate` | `dr:admin` | persist tenant activation of a sub-solution |

Mounted in `cmd/clario-dr-service/main.go` under an `/api/recover` Auth+Tenant
group; wiring lives in `cmd/clario-dr-service/recover.go`.

## Entitlement keys (canonical, in `license/model/keys.go`)

```
recover.it_dr · recover.cloud_dr · recover.cyber_recovery
```

Resolved per-tenant via the licensing service. Production fails **closed** (503
on a licensing outage). `RECOVER_ENTITLEMENT_FAIL_OPEN=true` is dev-only.

## Config (env, read in `internal/dr/config`)

- `RECOVER_LICENSE_SERVICE_URL` (or `GW_SVC_URL_LICENSE`) — licensing service
  base URL. Default `http://localhost:8096`.
- `RECOVER_ENTITLEMENT_FAIL_OPEN` — bool, default false (fail closed).
- `RECOVER_ENTITLEMENT_TIMEOUT` — Go duration, default `3s`.

## Persistence

`dr_db` migration `000036_recover_activation` (UP + DOWN, reversible). RLS clone
of the dr_db convention; `CHECK` on the three slugs. Licensing entitlement is
**not** stored here — it lives in the licensing engine.

## Tests

```
GOWORK=off go test ./internal/recover/...
```

Covers: registry shape & immutability; keys registered in the licensing model;
entitlement resolution licensed/not-licensed/fail-open/fail-closed; product view
merges entitlement + activation; "never all-enabled"; store/outage error
propagation; endpoint shape; and authorization (dr:read for products, dr:admin
for activate — analyst denied).
