# Clario Recover — Cyber Recovery workspace (Prompt 6)

`internal/recover/cyberrecovery` is the **Cyber Recovery** sub-solution
orchestration layer. It **composes** the existing `dr/*` services and adds the
distinguishing **clean-room recovery flow with a MANDATORY integrity gate**. It
owns **only** the flow state machine and its append-only transition log — it
never reimplements clean-room scanning, ransomware detection, or recovery-point
management.

## What it composes (calls public APIs of)

| Capability | Composed service | Used for |
|---|---|---|
| Clean-room integrity scan | `internal/dr/cleanroom` `Service.ScanRecoveryPoint` | the MANDATORY integrity gate |
| Ransomware signals | `internal/dr/ransomware` `Store.ListSignals` | dashboard early-warning surfacing |
| Clean points | shared `recovery_point` + `dr_cleanroom_scan` (read-only) | last-known-good selection + freshness |

The clean-room scan is adapted in `cmd/clario-dr-service/recover_cyber.go`
(`cleanroomGateScanner`) into the minimal `IntegrityScanner` projection.

## The flow & the hard gate

```
select last-known-good clean point   (POST /flows)
  -> provision to clean/bare-metal target   (POST /flows/{id}/provision)
  -> run runbook recovery                     (POST /flows/{id}/run-recovery)
  -> MANDATORY integrity-check gate           (POST /flows/{id}/integrity-check)
  -> request approval                          (POST /flows/{id}/request-approval)
  -> authorized sign-off (provenance)          (POST /flows/{id}/approve, dr:admin)
  -> RETURN TO PRODUCTION NETWORK              (POST /flows/{id}/return-to-production, dr:failover)
```

**`ReturnToProduction` is a hard, server-side blocker.** Inside the transaction
it re-asserts BOTH halves of the gate against the persisted flow (it does not
trust the phase):

1. the latest clean-room scan verdict is `clean`, **and**
2. an authorized approver has signed off **against that exact scan**
   (`approved_for_scan_id == integrity_scan_id`).

If either is false the action is refused (`409 integrity_gate_not_passed` /
`409 approval_required`) and the flow is **not** advanced. Re-running the
integrity gate **clears** any prior approval, so a stale sign-off can never be
replayed against a newer (or dirtier) scan. There is no code path to
`returned_to_production` that bypasses `Flow.CanReturnToProduction()`.

## Endpoints (mounted under `/api/recover/cyber-recovery`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /overview` | `dr:read` | live dashboard (clean points + freshness, ransomware signals, flows) |
| `GET /clean-points` | `dr:read` | last-known-good restore candidates |
| `GET /flows` | `dr:read` | flow inventory |
| `GET /flows/{id}` | `dr:read` | flow + append-only transition history |
| `POST /flows` | `dr:write` | select a clean point → start a flow |
| `POST /flows/{id}/provision` | `dr:write` | provision to target |
| `POST /flows/{id}/run-recovery` | `dr:write` | run runbook recovery |
| `POST /flows/{id}/integrity-check` | `dr:write` | **MANDATORY clean-room gate** |
| `POST /flows/{id}/request-approval` | `dr:write` | move to awaiting-approval |
| `POST /flows/{id}/approve` | `dr:admin` | **authorized sign-off** (provenance) |
| `POST /flows/{id}/return-to-production` | `dr:failover` | **HARD-gated** terminal action |
| `POST /flows/{id}/abort` | `dr:write` | abandon a non-terminal flow |

All routes self-gate with `RequirePermission` and run behind the same
`Auth`+`Tenant` middleware as the rest of `/api/recover`.

## Persistence

Migration `migrations/dr_db/000037_recover_cyber_recovery` (reversible,
apply/rollback verified):

- `recover_cyber_recovery_flow` — one row per flow; phase `CHECK`-constrained;
  optimistic-concurrency `version` column; RLS-isolated per tenant.
- `recover_cyber_recovery_event` — **append-only** transition log. No
  `UPDATE`/`DELETE` policy is created and the store exposes only `INSERT`/`SELECT`
  — immutability is enforced at both the DB and service layer.

## Concurrency & observability

- Every phase transition is an optimistic-concurrency `UPDATE … WHERE version = $`
  that bumps `version`; concurrent racers lose with `409 version_conflict` so no
  flow double-advances (proven by `TestReturnToProduction_ConcurrentReturnsOnlyOneWins`).
- Metrics (`recover_cyber_recovery_*`): transitions, integrity-gate verdicts,
  approvals, returns, and blocked-by-reason counters. Structured logs on each key
  event.

## Tests

`service_test.go` / `router_test.go` cover happy, failure, edge, concurrency, and
authz-denied paths, including **both gate cases**:

- **allowed:** `TestReturnToProduction_AllowedAfterCleanGateAndApproval`
- **forbidden:** `TestReturnToProduction_BlockedWithoutIntegrityPass`,
  `TestReturnToProduction_BlockedWithoutApproval`,
  `TestReturnToProduction_StaleApprovalInvalidatedByRescan`,
  and the HTTP mapping `TestRouter_ReturnToProduction_GateBlockMapsTo409`.

## Wiring (applied by the Wire agent)

The router exposes mount-relative routes; it is mounted under
`/cyber-recovery` on the product router. See the manifest `routerEdit` for the
exact registration lines for `internal/recover/router.go`, plus the
`cmd/clario-dr-service` threading of the composed clean-room service +
ransomware store into `configureCyberRecovery`.
