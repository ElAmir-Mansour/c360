# Clario Migrate Product Contract

Product key: `migrate`

Entitlement key: `migrate.cloud_migration`

Primary permission: `migrate:read`

## Capabilities

The product endpoint reports these capability groups:

- portfolio discovery and workload import;
- dependency move groups and approval;
- migration waves and critical path;
- cutover windows and go/no-go;
- rollback plans and readiness/validation gates;
- HTTP migration connectors;
- audit-backed evidence export.

## Gateway

Gateway routes:

- `GET /api/v1/migrate/product` is authenticated but not entitlement-gated so the
  UI can show licensed/unlicensed state.
- `/api/v1/migrate/*` is authenticated and gated by `migrate.cloud_migration`.

Default gateway service:

- name: `migrate-service`
- URL env override: `GW_SVC_URL_MIGRATE`
- default URL: `http://localhost:8100`

## Licensing And Onboarding

The entitlement key is registered in `internal/license/model/keys.go` and granted
to business-plus, enterprise, and trial plans by license migration
`000007_migrate_entitlement`.

The product is registered in the catalog suite map and self-serve product list.
The onboarding product picker includes the `migrate` suite so tenants can select
Cloud Migration during setup.

## RBAC

Tenant administrators receive:

- `migrate:read`
- `migrate:plan`
- `migrate:approve`
- `migrate:cutover`
- `migrate:rollback`
- `migrate:integrations`
- `migrate:evidence:export`
- `migrate:admin`

Analyst and viewer roles receive `migrate:read`.
