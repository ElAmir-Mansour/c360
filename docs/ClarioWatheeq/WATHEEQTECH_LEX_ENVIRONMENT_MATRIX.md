# WatheeqTech / LEX environment matrix

This matrix distinguishes safe defaults from production requirements. Exact values belong in the secret/configuration system, not this document.

## 1. Environment behavior

| Concern | Local development | Shared preview/demo | Staging / production candidate | Production | Air-gapped / regulated |
|---|---|---|---|---|---|
| `ENVIRONMENT` / `LEX_ENVIRONMENT` | `development` | `development` or explicit preview | protected non-production value | `production` | regulated/air-gap profile |
| Images | local/build tags acceptable | immutable preferred | immutable digests required | immutable digests required | mirrored, signed, scanned digests |
| Databases | local Compose/testcontainers | isolated demo DBs | production-like isolated DBs | managed HA/PITR | approved sovereign/isolated PostgreSQL |
| TLS/SSL | may use local exceptions | TLS recommended | required | required | approved internal PKI/mTLS |
| Demo seed | explicit opt-in | allowed only when labeled demo | off | off | off |
| Providers | deterministic/sandbox explicit | sandbox explicit | provider test tenants | live certified | approved on-prem/sovereign adapters only |
| Secrets | `.env` excluded from Git | secret store | production-like secret manager | approved secret manager/HSM/KMS | local sovereign secret/KMS system |
| Observability | console/local | shared non-sensitive | full metrics/logs/traces | full SLO/audit alerting | approved local collectors and retention |
| Browser E2E | local subset | full demo topology | mandatory full suite | smoke only after prior staging pass | isolated full suite |
| Backup/restore | optional disposable | periodic | mandatory rehearsal | mandatory verified PITR | mandatory offline/sovereign recovery |

## 2. Core required configuration

| Category | Variables / references | Production rule |
|---|---|---|
| Database | `LEX_DB_URL`, `PLATFORM_CORE_DB_URL`, `LEX_DB_MAX_CONNS`, `LEX_DB_MIN_CONNS` | Secret DSNs, TLS, pool budget across replicas, backups/PITR |
| Cache | `LEX_REDIS_ADDR`, `LEX_REDIS_PASSWORD`, `LEX_REDIS_DB` | Auth/TLS/network policy; no shared unscoped instance |
| Event bus | `LEX_KAFKA_BROKERS`, `LEX_KAFKA_TOPIC`, `LEX_KAFKA_GROUP_ID` | Auth/TLS, topic retention, lag/DLQ alerts |
| Identity | `LEX_JWT_PUBLIC_KEY_PATH`, internal service token/reference | Mounted key, issuer/audience/rotation verified |
| HTTP/admin | `LEX_HTTP_PORT`, `LEX_ADMIN_PORT`, rate limit | Admin port private; probes/scrape policy only |
| Encryption | `LEX_CONTRACT_FIELD_ENCRYPTION_MODE`, `LEX_CONTRACT_FIELD_ENCRYPTION_KEY` or `_KEY_FILE` | Approved key source; rotation and restore tested |
| Approval trust | `LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_PEM` or `_FILE`, revocation controls | Explicit trusted roots; fail closed when required |
| Frontend | `GATEWAY_INTERNAL_URL`, intended browser API URL | Correct internal/external split; no localhost fallback |

## 3. Feature-conditional configuration

| Feature | Variables / dependency | Required evidence when enabled |
|---|---|---|
| AI/OCR/drafting | `LEX_AI_SERVICE_URL`, `LEX_LLM_ENRICHMENT_ENABLED`, input/token/timeout settings and provider secrets | Model/version, data policy, evaluation, latency/error and fail-closed test |
| File/reference library | `LEX_FILE_SERVICE_URL`, `LEX_REFERENCE_LIBRARY_TENANT_ID` or `LEX_REFERENCE_LIBRARY_DIR` | Access policy, malware/content controls, corpus/version and residency |
| Signatures | `LEX_SIGNATURE_PROVIDER_MODE`, endpoint/API key/timeout | Test tenant certification, callback signing, evidence/custody reconciliation |
| Notifications/reminders | Lex, obligation and SLA provider mode/endpoint/API key/timeout variables | Non-duplicate delivery, retry/idempotency, bounce/failure and opt-out tests |
| Court / Najiz / Nafath | relevant `LEX_NAJIZ_*` and identity-provider settings | Real sandbox certification, signed callbacks and approved egress |
| SSO/SCIM | `LEX_SSO_SUCCESS_REDIRECT`, IdP certificates/client secrets, SCIM credentials and origins | Login/logout/provision/deprovision/group mapping and rotation |
| Mail/calendar/webhooks | SMTP/SendGrid/calendar secrets and webhook signing material | Delivery, replay, idempotency and data-classification acceptance |
| Background jobs | expiry/compliance/renewal/SLA/proximity/outbox/delivery/sync/rotation intervals | Positive bounded intervals, singleton/concurrency and alert tests |
| Jurisdiction/persona | `LEX_ORG_JURISDICTION`, persona/role landing settings | Customer-approved legal terminology, calendars and role mapping |

## 4. Deployment-profile controls

- Production: `LEX_SEED_DEMO_DATA=false`; do not invoke `system-seeder`.
- The migrator supports migration only. `-seed` is intentionally invalid after remediation.
- Production overlays must fail configuration rendering when required secret variables are missing.
- Sandbox provider mode must be visible in configuration, UI/evidence and audit records.
- Disabled optional providers must fail clearly when a user invokes their capability; they must not manufacture success.
- Air-gap/regulated deployments must replace public SaaS dependencies with approved reachable services and prove certificate, trust-root, update, backup and time-sync procedures.

## 5. External dependency matrix

| Dependency | LEX consumers | Health/readiness evidence |
|---|---|---|
| PostgreSQL | all durable domain data | connection, migration version, query/error/pool saturation |
| Redis | locks, cache, background coordination | connectivity, auth, latency, eviction and leader/singleton behavior |
| Kafka/Redpanda | domain events, integrations, consumers | topic availability, producer errors, lag, retries and DLQ |
| Gateway/IAM/license | identity, tenant, entitlement, role grants | both aliases, positive/negative entitlement and tenant tests |
| Workflow/audit/notification | approvals, evidence, delivery | end-to-end correlation and failure/retry behavior |
| File/object/reference storage | documents, signatures, evidence, corpus | upload/read/version, encryption, retention and restore |
| AI/OCR | analysis, drafting, extraction, semantic search | evaluation, timeout, limits and disabled/failure behavior |
| External providers | signatures, court, identity, mail/calendar/webhooks | provider-specific certification and reconciliation |

## 6. Release-time validation

For the exact values/digests, render Helm, run server-side dry-run, confirm secret references, execute smoke/negative authorization checks, and archive a redacted configuration manifest/checksum. Never copy secret values into the evidence bundle.
