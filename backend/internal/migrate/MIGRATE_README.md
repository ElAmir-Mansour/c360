# Clario Migrate Runtime Notes

Binary: `cmd/migrate-service`

Default ports:

- HTTP: `8100`
- admin: `9100`

Required configuration:

- `MIGRATE_DATABASE_URL`
- `MIGRATE_LICENSE_SERVICE_URL`

Optional configuration:

- `MIGRATE_DR_DATABASE_URL` for Recover Metastore enrichment;
- `MIGRATE_JWT_PUBLIC_KEY_PATH`;
- `MIGRATE_MIGRATIONS_PATH`;
- `MIGRATE_ENTITLEMENT_TIMEOUT`;
- `MIGRATE_CONNECTOR_TIMEOUT`;
- `MIGRATE_ENTITLEMENT_FAIL_OPEN`.

## Main API Surfaces

- `GET /api/v1/migrate/product`
- `GET|POST /api/v1/migrate/programs`
- `GET|POST /api/v1/migrate/programs/{programID}/workloads`
- `POST /api/v1/migrate/programs/{programID}/workloads/import`
- `GET|POST /api/v1/migrate/programs/{programID}/move-groups`
- `POST /api/v1/migrate/move-groups/{moveGroupID}/validate`
- `POST /api/v1/migrate/move-groups/{moveGroupID}/submit`
- `POST /api/v1/migrate/move-groups/{moveGroupID}/decision`
- `GET|POST /api/v1/migrate/programs/{programID}/waves`
- `GET /api/v1/migrate/waves/{waveID}/critical-path`
- `GET|POST /api/v1/migrate/programs/{programID}/windows`
- `GET|POST /api/v1/migrate/windows/{windowID}/rollback-plan`
- `POST /api/v1/migrate/rollback-plans/{rollbackPlanID}/decision`
- `GET|POST /api/v1/migrate/windows/{windowID}/gate-checks`
- `POST /api/v1/migrate/gate-checks/{checkID}/result`
- `GET /api/v1/migrate/programs/{programID}/command-center`
- `GET|POST /api/v1/migrate/connectors`
- `POST /api/v1/migrate/connectors/{connectorID}/invoke`
- `GET /api/v1/migrate/programs/{programID}/evidence?format=csv|pdf`

## Verification Boundary

Unit and package-level tests cover domain transitions, gateway registration,
catalog/license registration, and fleet registration. A live connector execution
requires a real endpoint and environment-backed secret reference; the service does
not fabricate external migration execution.
