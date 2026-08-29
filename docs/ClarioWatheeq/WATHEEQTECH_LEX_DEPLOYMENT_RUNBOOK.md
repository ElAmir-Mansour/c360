# WatheeqTech / LEX deployment runbook

This runbook deploys an already approved immutable release candidate. Replace placeholders through the secret manager or release system; never paste production secrets into shell history, Git, Helm values, or this document.

## 1. Inputs and ownership

Required release record:

- Git revision and immutable image digests for gateway, Lex, frontend, IAM/onboarding, workflow, notification, audit, file and AI dependencies.
- Helm chart revision and environment values checksum.
- Migration inventory/version and database backup identifiers.
- Approved provider/config matrix and change ticket.
- Named deploy lead, database lead, security approver and rollback authority.
- Approved observation window, SLO thresholds and rollback deadline.

## 2. Preflight

From a clean checkout of the candidate revision:

```bash
git status --short
GOWORK=off go test -short ./...              # from backend/
GOWORK=off go vet ./...                      # from backend/
npm ci && npm run lint && npm run type-check # from frontend/
npm test -- --run && npm run build           # from frontend/
./scripts/check-api-contracts.sh
make validate-api
make helm-lint
make helm-template
```

Verify the target:

```bash
kubectl config current-context
kubectl get namespace clario360
kubectl -n clario360 get deploy,statefulset,job,pod
helm -n clario360 list
```

Stop if the context, namespace, active release, image policy or required secret references differ from the approved release record.

## 3. Backup and recovery marker

Before migrations:

1. Take consistent backups/snapshots for `platform_core`, `lex_db`, `workflow_db`, `audit_db`, `notification_db` and other databases changed by the release.
2. Capture PostgreSQL WAL/PITR position and retention status.
3. Snapshot/version the file/object evidence stores and record their version markers.
4. Record Kafka consumer offsets, outbox backlog and DLQ counts.
5. Verify the backup by restoring it into an isolated target and executing basic integrity queries.
6. Put the backup IDs and restore proof in the change record.

## 4. Secret and configuration checks

Verify references, not values:

- `LEX_DB_URL`, `PLATFORM_CORE_DB_URL`, pool limits and SSL mode.
- Redis address/password/DB; Kafka brokers/topic/group.
- JWT public verification key mount.
- contract field encryption mode/key or external key file.
- approval-authority trusted roots and revocation settings.
- file/reference-library, AI/OCR, signature, notification/SLA, Najiz/Nafath, SSO/SCIM, mail/calendar and webhook credentials for enabled features.
- frontend `GATEWAY_INTERNAL_URL` and intended browser API URL.
- `LEX_SEED_DEMO_DATA=false` and production environment/profile values.

The generic migrator has no seed flag. Demo/system seeding is a separate operation and is prohibited in normal production deployment.

## 5. Render and policy review

```bash
helm dependency build deploy/helm/clario360
helm lint deploy/helm/clario360 -f deploy/helm/clario360/values-production.yaml
helm template clario360 deploy/helm/clario360 \
  -n clario360 \
  -f deploy/helm/clario360/values-production.yaml \
  > /tmp/clario360-rendered.yaml
kubectl apply --dry-run=server -f /tmp/clario360-rendered.yaml
```

Review rendered image digests, service accounts, network policies, ingress, resource requests/limits, replica counts, PDBs, secret references, migration job arguments and the absence of demo seed jobs. Delete the temporary render after review according to local policy.

## 6. Migration sequence

Run exactly one migration leader. The chart’s migration hook/job may perform this; do not also run a manual migrator.

Manual diagnostic form, if the approved process requires it:

```bash
./migrator -direction up -db platform_core,lex_db,workflow_db,audit_db,notification_db \
  -platform-db-url '<secret-injected-dsn>' \
  -lex-db-url '<secret-injected-dsn>' \
  -workflow-db-url '<secret-injected-dsn>' \
  -audit-db-url '<secret-injected-dsn>' \
  -notification-db-url '<secret-injected-dsn>'
```

Never use example DSNs literally. Stop on an unknown database, missing migration directory or nonzero result. Record applied versions and run schema sanity checks before rolling application pods.

## 7. Deploy order

1. Gateway/IAM/onboarding changes that define entitlement and role behavior.
2. Database migration hook/job.
3. Workflow, audit, notification, file/reference and AI dependencies.
4. Lex service canary.
5. Frontend canary.
6. Remaining replicas after the observation gate.

Example release command:

```bash
helm upgrade --install clario360 deploy/helm/clario360 \
  --namespace clario360 --create-namespace \
  --values deploy/helm/clario360/values-production.yaml \
  --atomic --timeout 20m
```

Use environment-approved `--set`/post-render policy only for non-secret image digests and references. Prefer a reviewed values file managed by the release system.

## 8. Canary verification

```bash
kubectl -n clario360 rollout status deployment/api-gateway --timeout=10m
kubectl -n clario360 rollout status deployment/lex-service --timeout=10m
kubectl -n clario360 rollout status deployment/frontend --timeout=10m
kubectl -n clario360 get pods,jobs
```

Then verify:

- readiness/liveness and admin health endpoints;
- both `/api/v1/lex` and `/api/v1/watheeq` with entitled and non-entitled users;
- tenant isolation and representative read/write/approve/close actions;
- request → workflow → notification, contract → review/signature, obligation → reminder/outbox and document upload/preview;
- enabled provider test endpoints using non-destructive production smoke operations;
- DB connection pools, Redis, Kafka consumer lag, outbox age, DLQ, error rate, latency, CPU/memory, WebSocket health and traces;
- audit records contain tenant, actor, action, correlation and outcome.

## 9. Traffic ramp

Ramp only when the canary meets approved SLOs:

1. internal legal administrators;
2. limited business-unit cohort;
3. 25% traffic;
4. 50% traffic;
5. 100% traffic.

Hold each stage for the approved window. Roll back on any no-go condition in `WATHEEQTECH_LEX_PRODUCTION_READINESS.md`.

## 10. Completion

- Record chart revision, image digests, migration versions and rollout timestamps.
- Attach smoke, provider, performance and observability evidence.
- Confirm no validation-only credentials or sandbox flags remain.
- Close the change only after the rollback window and backup retention are confirmed.
