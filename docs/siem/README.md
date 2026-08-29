# siem-service

`siem-service` is the Clario 360 Security Information and Event Management
peer service. It runs alongside `iam-service`, `cyber-service`,
`workflow-engine`, `notification-service`, `file-service`, etc.

## SIEM-01 status

This branch ships only the foundation: health checks, `/_meta`, RBAC
permissions, the `siem_db` baseline schema, audit-emitter wiring, and
all observability scaffolding. **No business endpoints exist yet.**
Every later prompt (SIEM-02 → SIEM-30) assumes the foundation is
bulletproof.

See [`01-foundation.md`](./01-foundation.md) for the delivery list.

## Ports

| Surface  | Host port | Notes                                          |
| -------- | --------- | ---------------------------------------------- |
| HTTP     | **8094**  | re-allocated from the prompt's 8092 — collides with the API gateway. See `RECON.md`. |
| Admin    | **9082**  | `/healthz`, `/readyz`, `/metrics`, optional `/debug/pprof`. |

## Environment variables

All SIEM env vars carry the `SIEM_` prefix. Required values are marked
**YES**; everything else has a documented default.

| Variable                       | Required | Default                | Notes                                       |
| ------------------------------ | -------- | ---------------------- | ------------------------------------------- |
| `SIEM_HTTP_PORT`               | no       | `8094`                 |                                             |
| `SIEM_ADMIN_PORT`              | no       | `9082`                 |                                             |
| `SIEM_PG_DSN`                  | **YES**  | —                      | `postgres://…/siem_db?sslmode=…`            |
| `SIEM_PG_MAX_CONNS`            | no       | `20`                   |                                             |
| `SIEM_REDIS_ADDR`              | no       | `localhost:6379`       |                                             |
| `SIEM_REDIS_DB`                | no       | `7`                    | DB 7 is reserved for SIEM.                  |
| `SIEM_KAFKA_BROKERS`           | no       | `localhost:9092`       | Comma-separated.                            |
| `SIEM_KAFKA_CLIENT_ID`         | no       | `siem-service`         |                                             |
| `SIEM_KAFKA_TLS_ENABLED`       | no       | `false`                | Reserved for SIEM-04.                        |
| `SIEM_OPENSEARCH_URL`          | no       | empty                  | Reserved for SIEM-02.                        |
| `SIEM_OPENSEARCH_AUTH`         | no       | empty                  | Reserved for SIEM-02; redacted in logs.      |
| `SIEM_OTEL_EXPORTER_ENDPOINT`  | no       | `localhost:4317`       |                                             |
| `SIEM_SHUTDOWN_TIMEOUT_SEC`    | no       | `30`                   |                                             |
| `SIEM_ENABLE_PPROF`            | no       | `false`                |                                             |
| `SIEM_LOG_LEVEL`               | no       | `info`                 | `debug|info|warn|error`                     |
| `SIEM_JWT_ISSUER`              | no       | `clario360`            | Must match the IAM issuer.                  |
| `SIEM_JWT_PUBLIC_KEY_PATH`     | **YES**  | —                      | RS256 public key PEM file.                  |
| `SIEM_ENVIRONMENT`             | no       | `development`          |                                             |

The platform's `SIEM_AUDIT_SERVICE_URL` env var referenced by the prompt
is **not** used — `RECON.md §3.3` explains why (the platform audit
chain is an in-process `Ingest(entry)` API, not a peer HTTP service).

## Run locally

The local Clario 360 stack runs application services via PM2, not via
docker-compose. Use the dedicated Makefile targets:

```sh
# Build only the siem-service binary into backend/bin/siem-service
make siem-build

# Run it directly (assumes Postgres, Redis, Kafka, IAM keys are present
# locally per the dev setup notes).
make siem-run

# Unit tests
make siem-test

# Integration tests (Docker required)
make siem-test-integration

# Static vet
make siem-lint
```

PM2 picks the service up via `ecosystem.local.js`:

```sh
pm2 start ecosystem.local.js --only clario360-siem-service
```

## Database

`siem_db` is added to `deploy/docker/init-databases.sql` and is created
the first time the `postgres` compose service starts. Migrations live
under `backend/migrations/siem_db/`. The service runs `database.RunMigrations`
at startup; a failed migration is fatal and `/readyz` reports
`unhealthy` until the schema is up to date.

## Roles & permissions

| Permission                | Granted to (default roles)                  |
| ------------------------- | -------------------------------------------- |
| `siem:read`               | `analyst`, `viewer`, `tenant-admin`          |
| `siem:write`              | `tenant-admin`                               |
| `siem:hunt`               | `analyst`, `tenant-admin`                    |
| `siem:respond`            | `tenant-admin`                               |
| `siem:content_author`     | `tenant-admin`                               |
| `siem:compliance_attest`  | `tenant-admin`                               |
| `siem:supervisory_view`   | `super-admin` (cross-tenant audit hook)      |
| `siem:admin`              | `tenant-admin`                               |

`super-admin` already holds `admin:*`, which `auth.HasPermission`
short-circuits for every `siem:*` check. `siem:supervisory_view` is
listed explicitly so the role's permission set documents the
cross-tenant capability.

## Smoke probe

`scripts/smoke/siem-01.sh` exercises:

- `/healthz` (admin)
- `/readyz` (admin)
- `/metrics` for `siem_service_build_info`
- `/api/v1/siem/_meta` (gateway) — 401 without JWT, 200 with `SIEM_JWT`

## Contract check

`scripts/check-siem-contract.sh` enforces the static contract used by
later prompts: permission strings, gateway route, migration filenames,
Prometheus scrape job, dashboard JSON, package tree, frontend perm.

## Troubleshooting

| Symptom                                                   | Likely cause                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `siem-service failed: load config: missing required …`    | `SIEM_PG_DSN` or `SIEM_JWT_PUBLIC_KEY_PATH` not set.         |
| `/readyz` returns 503 indefinitely                        | Postgres unreachable or schema not migrated. Check logs.     |
| `/api/v1/siem/_meta` returns 502 via the gateway          | siem-service not running, or `GW_SVC_URL_SIEM` misconfigured. |
| 401 on every call through the gateway                     | JWT issuer mismatch between IAM and `SIEM_JWT_ISSUER`.        |
| 400 MISSING_TENANT on `/_meta` with a valid JWT           | Token has no `tid` claim (e.g., system-only token).           |

## See also

- `RECON.md` — reconnaissance notes and divergence resolutions.
- `REGRESSION.md` — test results captured against this branch.
- `docs/prompts/prompt01` — the master prompt this implementation follows.
