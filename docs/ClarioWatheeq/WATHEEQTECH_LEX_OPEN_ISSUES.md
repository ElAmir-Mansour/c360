# WatheeqTech / LEX open issues

Snapshot date: 2026-07-16  
Release verdict while these conditions remain: **CONDITIONALLY READY**

No known unresolved P0/P1 repository contradiction remains after remediation. The production admission conditions below are external/environment-specific or customer-owned. Internal P2/P3 debt is listed separately and must not be described as completed.

## Production admission conditions

| ID | Severity | Issue / impact | Owner | Dependency | Exit evidence | Blocks unconditional readiness |
|---|---|---|---|---|---|---|
| WTQ-OPEN-001 | Environment P1 | Full Playwright/accessibility suite has been discovered (431 tests/46 files) but not executed against the immutable production-like candidate | Release engineering + QA | Deployed staging topology, identities and seeded acceptance fixtures | Signed test report with failures resolved and image/chart digests recorded | Yes |
| WTQ-OPEN-002 | External P1 | Enabled live providers are not certified in this local audit: signature, Najiz/court, Nafath/identity, SSO/SCIM, mail/calendar, OCR/LLM and webhooks as applicable | Integration owners + customer security | Provider test tenants/credentials, approved egress and callback URLs | Provider-specific success/failure/replay/idempotency/reconciliation evidence; disabled providers explicitly disabled | Yes |
| WTQ-OPEN-003 | Environment P1 | No current customer-sized load/soak result or capacity envelope | SRE/performance | Production-like data volume/topology and load tooling | Approved p50/p95/p99, errors, saturation, DB pools, Kafka/outbox/DLQ and WebSocket results | Yes |
| WTQ-OPEN-004 | Environment P1 | No current target backup/restore/PITR and multi-store recovery exercise | DBA/SRE | Target backup system, KMS keys, object store and isolated restore environment | Timed restore, integrity reconciliation, measured RTO/RPO and signed recovery report | Yes |
| WTQ-OPEN-005 | Customer P1 | Customer role/DOA/org import, jurisdiction/calendar, corpus and retention model are not accepted | Customer product/legal/security owners | Approved master data, corpus, IAM and policy decisions | Access matrix/SoD tests, import dry-run/apply report, corpus relevance and retention approval | Yes |

These conditions are P1 for promotion of a specific environment, but they are not undiscovered code contradictions that can be truthfully closed from a local repository without credentials or infrastructure.

## Internal engineering backlog

| ID | Severity | Issue / impact | Owner | Required action / exit criterion |
|---|---|---|---|---|
| WTQ-OPEN-101 | P2 | Phase-1 Watheeq OpenAPI declares 122 of 624 registered operations; 502 are outside the public contract | API/product architecture | Decide public/private boundary, then add reviewed operations/schemas/security/error semantics in phases; contract checker count must move monotonically toward the approved target |
| WTQ-OPEN-102 | P2 | API specifications remain structurally valid with documentation-quality warnings | API owners | Resolve license/tag/4xx/operationId warnings or adopt a reviewed warning budget with per-spec ratchet |
| WTQ-OPEN-103 | P2 | LEX production-build bundles include routes around 600–654 kB | Frontend/platform performance | Measure real Web Vitals; split heavy editors/charts/data modules; meet target LCP/INP/transfer budgets |
| WTQ-OPEN-104 | P3 | Frontend lint has 0 errors but 1,061 post-remediation warnings | Frontend owners | Burn down restricted legacy primitives, hook dependency and unused-disable warnings; add a warning ratchet |
| WTQ-OPEN-105 | P3 | `gofmt -l backend` reports 592 historical files | Backend owners | Format in bounded domain PRs with tests; keep all newly changed Go files formatted |
| WTQ-OPEN-106 | P2 | Aggregate backend/frontend coverage is materially below mature-service targets | Engineering leads | Add risk-based tests and ratchet measured coverage upward; never claim fictional 70%/60% results |
| WTQ-OPEN-107 | P3 | jsdom prints non-failing navigation/XHR noise in redirect/link tests | Frontend test owners | Stub navigation/network at the harness boundary so real errors are easier to see while retaining redirect assertions |
| WTQ-OPEN-108 | P2 | Current local shell lacked `golangci-lint`, `gosec`, `gitleaks`, `trivy`, `govulncheck` and load tools | DevSecOps | Ensure exact-candidate CI jobs execute, retain reports and block on policy severity |

## Closed in this audit

| ID | Closed issue | Evidence |
|---|---|---|
| WTQ-MIG-001 | Fake migrator seed success | `-seed` removed; explicit seeder separation documented |
| WTQ-MIG-002 | Unknown/missing migration input succeeded | Fail-closed validation plus unit/integration tests |
| WTQ-CON-001 | Contract checker rejected valid extension metadata and contained stale anchors | Required-key validation, current route discovery and passing gate |
| WTQ-CON-002 | DR integration/sealed-proof routes undocumented | OpenAPI paths, permissions and schemas added |
| WTQ-UI-001 | Consultation board unsafe cast | Direct typed component contract |
| WTQ-I18N-001 | New untranslated organization/settings copy | Bilingual label bundles; ratchets pass and are re-baselined downward |
| WTQ-DS-001 | Inline color regression | Semantic tokens; inline style count reduced to 9 |
| WTQ-OPS-001 | Obsolete Compose version declarations | Removed; all overlays validate |

## Review cadence

- Admission conditions: reviewed at every release go/no-go.
- P2 contract/performance/coverage items: owner and target milestone required before general public API commitment.
- P3 cleanup: monthly ratchet review.
- Any newly discovered authorization, tenant isolation, evidence integrity, migration data-loss or secret-exposure issue is immediately reclassified as P0/P1 and invalidates the current verdict.
