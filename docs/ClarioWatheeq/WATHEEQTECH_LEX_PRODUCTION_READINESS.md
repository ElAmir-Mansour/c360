# WatheeqTech / LEX production readiness

Assessment date: 2026-07-16  
Final verdict: **CONDITIONALLY READY**

## Executive decision

The repository is internally coherent enough for a controlled production-candidate deployment. Builds, deterministic tests, race integration, fresh migrations, API gates, frontend quality ratchets, Helm rendering and Compose validation pass after remediation. No known P0/P1 code contradiction remains in the audited WatheeqTech/LEX path.

The system is not unconditionally ready because evidence that cannot be produced from a local repository is still missing: customer/provider certification, deployed end-to-end browser execution, load/soak results and backup/restore/DR exercises. Those are explicit admission gates, not recommendations to ignore.

## Readiness scorecard

| Area | Result | Evidence / condition |
|---|---|---|
| Product capability traceability | Pass with conditions | 18 groups traced; 11 aligned, 7 environment/provider conditional |
| Frontend/backend consistency | Pass | No shipped capability group with a missing required side after remediation |
| Authorization and tenant isolation | Pass | Gateway, entitlement, tenant, fine-grained permissions, distinct-actor and integration tests |
| Migration safety | Pass | Fail-closed migrator, focused tests, integration-tag tests, fresh Lex apply; prior up/down/up evidence retained |
| Deterministic functional tests | Pass | Backend, frontend, Lex race integration and AI suites |
| API contract integrity | Pass with documented boundary | All 122 declared phase-1 operations implemented; 502/624 registered operations remain outside the public phase-1 contract |
| Supply-chain/dependency checks | Pass locally | npm audit 0; local Go SAST/container scanners were unavailable and remain CI responsibilities |
| Deployment manifests | Pass | Helm lint/template and Compose variants validate; production secrets fail closed |
| Live provider acceptance | Pending | Signature, Najiz/court, SSO/SCIM, mail/calendar, OCR/LLM and enabled webhooks |
| Deployed browser E2E/accessibility | Pending | 431 tests discovered; target execution requires the staging topology |
| Performance/capacity | Pending | Large LEX bundles observed; no current target load/soak result |
| Backup/restore/DR | Pending | Runbook exists; no current environment restore exercise supplied |

## Mandatory pre-production admission gates

All must be satisfied for the target customer/environment:

1. Run the 431 Playwright tests, including Watheeq workflows and accessibility, against the immutable candidate images in a production-like staging namespace.
2. Certify each enabled external provider with real non-production credentials. Disabled providers must be explicitly disabled; sandbox responses must be labeled as sandbox.
3. Execute a load/soak profile sized to the customer’s users, documents, workflows, WebSockets and background jobs. Record p50/p95/p99, error rate, saturation and Kafka/outbox lag.
4. Restore `platform_core`, `lex_db`, workflow/audit/notification databases and object/file evidence from backup into an isolated environment. Reconcile object versions and Kafka/outbox position.
5. Verify tenant isolation, role matrix and separation-of-duties using the customer’s actual IAM/organization import.
6. Record approved RTO/RPO and compare them to measured restore/failover results.
7. Supply production secrets through the approved secret manager; confirm no demo seed, validation-only secret or sandbox provider setting remains.
8. Expand/approve the intended public API boundary. The runtime may deploy with private operations, but documentation must not claim all 624 registered operations are public/contracted.

## Go / no-go criteria

### Go

- Candidate image digests, chart values and migration revision are approved.
- Backups and a point-in-time recovery marker exist and were restore-tested.
- Admission gates above have signed evidence.
- Readiness, liveness, metrics, traces, DB pools, Redis, Kafka, outbox and DLQ are healthy during canary.
- No open P0/P1 issue exists for the target configuration.

### No-go

- Migrator reports an unknown/missing database path, or schema version differs across replicas.
- Any enabled provider is untested, silently sandboxed or returning unverifiable success.
- Tenant/entitlement/permission checks fail for either API alias.
- Error rate, latency, resource saturation, consumer lag or outbox/DLQ breaches the approved threshold.
- Backup restore or evidence reconciliation has not been demonstrated.
- Production values enable demo seed data or contain validation-only credentials.

## Known non-blocking debt

- 502 registered operations are outside the phase-1 OpenAPI boundary.
- OpenAPI documentation-quality warnings remain.
- ESLint reports 1,061 post-remediation warnings with zero errors.
- `gofmt -l backend` reports a 592-file historical formatting backlog.
- Several LEX route bundles are approximately 600–654 kB in the production-build report and require measured performance work.
- Measured repository coverage is materially below an ideal mature-service target; current CI uses honest no-regression floors.

These are P2/P3 governance and engineering backlogs. They are not represented as completed and should be scheduled, but none is evidence of an active P0/P1 runtime contradiction.

## Final verdict

**CONDITIONALLY READY**

Promotion is authorized only after the environment/provider/customer-owned gates above are evidenced for the exact release candidate.
