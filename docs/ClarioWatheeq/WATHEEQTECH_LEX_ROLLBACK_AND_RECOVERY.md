# WatheeqTech / LEX rollback and recovery

Use this runbook only with an authorized incident/change lead. Application rollback is preferred over schema rollback when forward-compatible code can be restored safely. Never improvise a destructive database command under pressure.

## 1. Trigger and decision record

Rollback triggers include:

- authorization, tenant-isolation, encryption or evidence-integrity failure;
- migration failure or incompatible mixed schema/application versions;
- sustained SLO breach, crash loop, data corruption, outbox/DLQ growth or provider side effects;
- failed production smoke journey with no safe feature disable;
- accidental demo/sandbox configuration in production.

Record incident time, release/chart revision, image digests, migration versions, first bad request/correlation ID, affected tenants and the person authorizing rollback.

## 2. Containment

1. Stop traffic ramp and disable high-risk writes through the approved ingress/feature-control mechanism.
2. Preserve logs, traces, metrics, audit rows, outbox/DLQ state and database/WAL positions.
3. Pause background/provider dispatch only through supported configuration; do not delete pending events.
4. If tenant isolation or secrets are at risk, revoke affected tokens/credentials and isolate the service before ordinary rollback.

## 3. Application-only rollback

When the schema is backward compatible:

```bash
helm -n clario360 history clario360
helm -n clario360 rollback clario360 <known-good-revision> --wait --timeout 20m
kubectl -n clario360 rollout status deployment/api-gateway --timeout=10m
kubectl -n clario360 rollout status deployment/lex-service --timeout=10m
kubectl -n clario360 rollout status deployment/frontend --timeout=10m
```

Verify image digests rather than tags. Repeat entitlement, tenant-isolation, read/write and audit smoke tests before restoring traffic.

## 4. Schema rollback

Schema rollback is allowed only when the migration’s down path is reviewed against data written since the upgrade and a verified backup/PITR marker exists.

The migrator rolls back the selected database using its ordered down migration behavior:

```bash
./migrator -direction down -db lex_db -lex-db-url '<secret-injected-dsn>'
```

Rules:

- one migration leader only;
- stop writers/background jobs first;
- roll back only the versions required for the known-good application;
- never use an unknown database alias or missing migration path as a no-op—the remediated migrator fails these cases;
- validate row counts, constraints, indexes, tenant keys and migration version after each step;
- IAM/role rollback requires special security approval because restoring a previous broad grant can reintroduce separation-of-duties exposure.

If a down migration would lose or reinterpret production data, restore to an isolated database and perform an approved forward repair instead.

## 5. Point-in-time restore

1. Create isolated replacement databases; do not overwrite the only affected copy.
2. Restore base backups and replay WAL to the approved pre-incident marker.
3. Restore/version-match file/object evidence stores.
4. Reconcile workflow, audit and notification databases to the same logical boundary.
5. Compare Kafka offsets, outbox IDs and provider idempotency keys. Re-dispatch only events proven not to have produced an external side effect.
6. Run integrity queries and representative tenant journeys in isolation.
7. Cut over through the approved connection/secret change, then observe before restoring writes.

## 6. Event, outbox and DLQ recovery

- Do not truncate outbox or DLQ tables to make dashboards green.
- Classify each record as pending, safely retryable, externally completed, poison or superseded.
- Use correlation/idempotency keys and provider receipts before retrying signature, mail/calendar, court or webhook operations.
- Preserve original attempt history and record the recovery action as a new audit event.
- Monitor Kafka lag and outbox oldest age until both return to steady state.

## 7. Provider compromise or misconfiguration

1. Disable the affected integration explicitly.
2. Rotate provider/API/SCIM/webhook credentials and any encryption key affected by exposure, using the provider’s supported sequence.
3. Validate callback signing/replay protection with the new secret.
4. Reconcile external provider state against durable internal records.
5. Re-enable only after non-destructive live test evidence and security approval.

Sandbox mode must never be used to make production health appear successful.

## 8. Post-recovery verification

- both API aliases enforce `app.watheeq` and tenant context;
- role/DOA/distinct-actor behavior matches the approved matrix;
- schema versions and application digests are consistent across replicas;
- critical contract, request, matter, signature, obligation and document records reconcile;
- audit hashes/history, object evidence and provider receipts are intact;
- outbox/DLQ and consumer lag are stable;
- no demo seed data or validation-only secret remains.

## 9. Recovery evidence

Attach the timeline, commands, backup/PITR identifiers, before/after schema versions, integrity queries, smoke results, reconciliation report, data-loss assessment and follow-up owners. Do not claim an RTO/RPO result until the target environment exercise has measured it.
