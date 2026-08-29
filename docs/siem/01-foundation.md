# SIEM-01 — Foundation

This document captures *exactly* what SIEM-01 delivers. It is the
checklist the next prompt (SIEM-02) treats as load-bearing.

## What SIEM-01 ships

### New code

- `backend/cmd/siem-service/` — service entrypoint, Dockerfile,
  build-tagged integration test.
- `backend/internal/siem/` package tree:
  - `model/` — TenantID/Severity aliases, `HealthCheck` row, `MetaInfo`
    response.
  - `repository/` — `HealthCheckRepository` (insert/count/ping) plus
    pgxmock-backed unit tests.
  - `service/` — `MetaService`, `SIEMMetrics` per-instance Prometheus
    registry, `Build()` re-export of buildinfo for `cmd/` callers.
  - `handler/` — chi sub-router that mounts `GET /api/v1/siem/_meta`
    plus 501 stubs at `/sources`, `/parsers`, `/settings` gated by
    `RequirePermission("siem:admin")`.
  - `consumer/` — Kafka consumer lifecycle wrapper (no topics yet).
  - `producer/` — CloudEvents-aware producer with a tenant-presence
    guard plus an in-memory `FakeProducer`.
  - `config/` — `SIEM_`-prefixed env loader with redacting `String()`.
  - `csql/` — placeholder package (SIEM-17 territory).
  - `audit/` — `Emitter` interface, `NewSyntheticBootstrapEntry`,
    `NoOp`, `InMemory`.
  - `internal/buildinfo/` — `-ldflags`-injected Version/Commit/BuildTime.
- `backend/migrations/siem_db/000001_init.{up,down}.sql` — `siem` schema
  and the `siem.health_check` table.
- `backend/migrations/platform_core/000014_siem_permissions.{up,down}.sql`
  — extends the four system roles with the SIEM permission set.
- `deploy/monitoring/grafana/siem-service-baseline.json` — baseline dashboard.
- `scripts/smoke/siem-01.sh` — runnable smoke probe.
- `scripts/check-siem-contract.sh` — static contract validator.
- `docs/siem/README.md`, `docs/siem/01-foundation.md`, `RECON.md`,
  `REGRESSION.md`.

### Modified files (intentional, narrow)

- `backend/internal/auth/rbac.go` — adds `PermSIEM*` constants and
  updates `RolePermissions` for `analyst`, `viewer`, `tenant_admin`,
  `super_admin`.
- `backend/internal/gateway/config/routes.go` — adds `/api/v1/siem` →
  `siem-service` route, plus the `siem-service` upstream URL.
- `docker-compose.yml` — adds `siem-service` under the opt-in `apps`
  profile so default `docker compose up` keeps booting infra only.
- `deploy/docker/init-databases.sql` — creates `siem_db`, grants
  privileges, installs `pgcrypto` + `uuid-ossp`.
- `ecosystem.local.js` — adds the `siem-service` PM2 entry; adds
  `GW_SVC_URL_SIEM` to the gateway block.
- `deploy/monitoring/prometheus/prometheus.yml` — adds the
  `clario360-siem-service` scrape job.
- `Makefile` — adds `siem-{build,run,test,test-integration,lint,clean}`
  targets, registers `siem-service` in `SERVICES`, adds the port
  mapping.
- `frontend/src/config/suite-permissions.ts` — single new entry
  `siem: 'siem:read'`.

No other production code was modified. The five files identified in
`RECON.md §3.6` as carrying pre-existing `prometheus.DefaultRegistry`
violations are explicitly **untouched** per the carry-over scope.

## What SIEM-01 deliberately does NOT ship

- Any business endpoint beyond `/_meta`. (`/sources`, `/parsers`,
  `/settings` return 501.)
- Any Kafka topic subscriptions or producer messages.
- The `responder`, `content_author`, `compliance` roles (do not exist
  in the platform; per `RECON.md §3.5` they are NOT created).
- A real audit-service HTTP client. The audit emitter is a typed
  abstraction with `NoOp` and `InMemory` implementations.
- The OpenSearch hot store (SIEM-02).
- Sources, parsers, rules, alerts, hunts, dashboards (SIEM-03+).

## Acceptance criteria — evidence

| §7 line | How it's evidenced                                                                                |
| ------- | -------------------------------------------------------------------------------------------------- |
| 1       | `docker compose up` (default profile) keeps infra healthy; adding `--profile apps` brings the siem-service container up. |
| 2       | `curl http://localhost:9082/healthz` → 200 ok.                                                     |
| 3       | `curl http://localhost:9082/readyz` → 200 once Postgres is reachable; 503 otherwise.               |
| 4       | `curl http://localhost:9082/metrics` exposes `siem_service_build_info` (relabeled to `clario360_siem_build_info` by Prometheus). |
| 5       | `curl -H "Authorization: Bearer …" http://localhost:8092/api/v1/siem/_meta` returns the `MetaInfo` JSON. |
| 6       | Same call without `Authorization` → 401; with a JWT missing `tid` → 400 MISSING_TENANT (the platform tenant middleware's actual response code — `RECON.md §3.5`). |
| 7       | `GOWORK=off go build ./...` is recorded in `REGRESSION.md`.                                        |
| 8       | `GOWORK=off go test -race -count=1 ./...` is recorded in `REGRESSION.md`.                          |
| 9       | `make siem-test` recorded with coverage in `REGRESSION.md`.                                        |
| 10      | `scripts/smoke/siem-01.sh` syntax-checked; full pass requires a live stack.                        |
| 11      | `scripts/check-siem-contract.sh` exits 0 — recorded in `REGRESSION.md`.                            |
| 12      | Prometheus job + Grafana JSON shipped; full pass requires a running monitoring stack.              |
| 13      | `RECON.md` and `REGRESSION.md` are at repo root.                                                   |
| 14      | Modified-file list is exactly the one above; no peer service code touched.                         |
