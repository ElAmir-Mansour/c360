# WatheeqTech / LEX security review

Review date: 2026-07-16  
Result: no known unresolved P0/P1 repository defect in the audited path; live/provider and operational evidence remains conditional.

## 1. Trust boundaries

| Boundary | Primary controls | Residual concern |
|---|---|---|
| Browser/API caller → gateway | JWT verification, tenant context, `app.watheeq` entitlement, rate/route controls | Production key rotation and gateway policy must be exercised |
| Gateway → Lex | Internal service routing/token, tenant propagation, per-domain permission middleware | Mixed-version deployments can disagree; deploy gateway/IAM/Lex coherently |
| Lex → databases/cache/event bus | Tenant-scoped repositories, transactions, pools, Redis/Kafka config, outbox/DLQ | Restore/replay and capacity evidence is environment-specific |
| Lex → file/object/reference storage | File policy, object identifiers, evidence/version/custody paths | Customer storage/KMS/WORM policy must be validated live |
| Lex → external providers | Explicit mode/config, credentials, signed callbacks/idempotency where supported | Provider certification and network allowlists are pending |
| Public/provider callback → Lex | Provider authentication/signature, timestamp/replay/idempotency and uniform responses by domain | Every enabled provider’s real callback profile must be tested |
| Admin/org import → authority model | `lex:security:manage`, dry-run/validation, atomic apply, role/DOA rules | Customer org data and delegated authority require approval |

## 2. Identity, entitlement and tenant isolation

- `/api/v1/lex` and `/api/v1/watheeq` are aliases to the same service and are both gated by `app.watheeq`.
- JWT identity, tenant context and domain authorization are separate checks.
- Integration tests cover tenant-isolation and alias-parity behavior.
- Frontend guards improve UX but are not treated as the authorization boundary.
- Provider callbacks and service identities are exceptions to browser authentication and have dedicated verification paths.

Production action: verify the mounted public key, issuer/audience policy, clock skew, token revocation/rotation and internal token policy in the target cluster.

## 3. Authorization and separation of duties

- Domain verbs include read/add/edit/approve/close/distribute/security-manage rather than relying solely on coarse `lex:write`.
- Contract review/status/close and request/workflow decisions use approval authority, assignee/recipient checks and distinct-actor controls where the route/service can resolve the subject.
- Tenant administrator grant changes are migration-governed; mechanical rollback can restore broader authority and therefore needs security approval.
- The frontend consultation board, import UI and action visibility now use the same typed/permission vocabulary rather than unsafe casts.

No confirmed current frontend/backend permission mismatch was found in the capability matrix. Customer roles and custom grants still require a target-environment access review.

## 4. Input, file and integration security

- Request DTO/service validation and finite lifecycle enums constrain state transitions.
- Organization imports support dry-run server validation and atomic apply; user copy no longer hides validation behavior behind an English-only path.
- File/document flows use content/file policy, versioning and evidence linkage. Production must add malware/content-disarm policy according to the customer threat model.
- Integration responses omit credential material. DR integration credentials are documented as write-only and encrypted at rest.
- Provider sandbox adapters are explicit. No silent live-to-mock success fallback was accepted.
- URL/provider configuration is a potential SSRF/egress boundary; production must restrict egress and provider endpoints to approved networks/domains.

## 5. Secrets and cryptography

Required protected material includes database credentials, Redis/Kafka authentication, JWT verification keys, contract field-encryption keys or key files, approval-authority roots, provider/API/SCIM/webhook credentials and object-storage/KMS keys.

Controls/requirements:

- secrets only through the approved secret manager and mounted references;
- TLS and database SSL policy appropriate to the target;
- field encryption enabled with an approved key mode;
- trusted approval roots and revocation configuration supplied deliberately;
- key rotation and restore procedures rehearsed;
- no validation-only password or demo credential in production;
- logs/traces/errors must not include secret payloads, tokens or document content beyond approved classification.

## 6. Audit, integrity and non-repudiation

- Domain transitions persist actors/timestamps and workflow/provider/custody records as applicable.
- Transactional outbox paths prevent business state from being committed without its staged event for covered writes.
- Signature evidence and custody are required before signed contract activation in deterministic lifecycle tests.
- Audit/event evidence must be monitored for delivery, not merely written.

Target verification must prove tenant, actor, action, subject, correlation ID, result and timestamp for representative high-risk actions and verify retention/immutability policy.

## 7. Seed/demo and fake-success review

- The generic migrator’s fake `-seed` success path was removed.
- Missing migration roots/database directories and unknown DB selectors now fail.
- Production Helm values disable demo seed data.
- Explicit system/demo seed tooling remains appropriate for development/preview only.
- Najiz/provider mocks are explicit sandbox modes; they are not evidence of live integration.

## 8. Dependency and tooling evidence

Current local evidence:

- `npm audit --audit-level=high`: 0 vulnerabilities.
- Go build, vet, unit and race integration suites: passed.
- API contract, Helm and Compose validation: passed.

Unavailable in the current shell: `gosec`, `gitleaks`, `trivy`, `golangci-lint`, `govulncheck` and load tooling. The preceding audit recorded a clean `govulncheck` result, but this report does not relabel that as a current execution. Authoritative SAST, secret and container scanning must pass in CI for the exact image digests.

## 9. Security conditions before promotion

1. Execute target-environment access/tenant/SoD tests using customer identities.
2. Certify enabled providers, callback signing/replay and egress allowlists.
3. Run SAST, secret, dependency and container scans in CI against the candidate.
4. Restore encrypted databases and object evidence with key access proven.
5. Review the public API boundary: 122 operations are declared, 502 registered operations are not yet part of that public contract.
6. Complete performance/abuse/rate-limit tests and alert thresholds.

## 10. Security verdict

**CONDITIONALLY READY** — code-level high-severity findings discovered in this audit were remediated; promotion still depends on environment/provider/security-operations evidence.
