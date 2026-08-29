# WatheeqTech / LEX alignment audit

Audit date: 2026-07-16  
Decision: **CONDITIONALLY READY**

## 1. Scope and method

This audit inspected the repository rather than relying on product copy or route names. The review covered:

- 70 LEX frontend page entries, shared components, API clients, loading/empty/error states, bilingual/RTL gates, and permission-driven actions;
- the 1,736-line Lex route composition, service/repository/monitor/consumer layers, gateway aliases and entitlement enforcement;
- the phase-1 OpenAPI contract, API inventory and route-checking automation;
- 85 Lex up/down migration pairs plus related IAM, workflow, audit and notification persistence;
- Docker Compose, Helm, CI, image build definitions, secrets/config expectations and rollback controls;
- deterministic unit/integration/race tests, frontend tests/build, AI tests, dependency audit and API validation.

Baseline commands were run before remediation. Findings were classified only when backed by a concrete file, executable result, or an explicit missing environment/provider dependency.

## 2. Architecture reconstructed from code

```text
Browser / API consumer
        |
        v
API gateway: JWT + tenant + app.watheeq entitlement
        |  aliases: /api/v1/lex and /api/v1/watheeq
        v
Lex HTTP composition
        |
        +--> fine-grained permission / ABAC / distinct-actor guards
        +--> domain services and repositories --> lex_db
        +--> workflow / notification / audit / file / AI services
        +--> Redis locks/cache, Kafka events, outbox and DLQ
        +--> explicit external adapters (signature, court, identity, mail/calendar)

Next.js LEX UI --> typed/specialized clients --> gateway
```

The implementation is a large modular service, not a mock shell. Backend-only monitors are intentional exceptions to UI parity. Public/provider callbacks are intentional exceptions to ordinary browser-client parity.

## 3. Baseline evidence before edits

| Check | Baseline result |
|---|---|
| `GOWORK=off go test -short ./...` | Passed |
| `go build ./cmd/...` | Passed |
| `GOWORK=off go vet ./...` | Passed |
| Frontend lint, type-check, production build | Passed; 0 ESLint errors, 1,076 warnings, 291 routes emitted |
| Full frontend Vitest wrapper | Passed; jsdom emitted expected non-failing navigation noise in expiry tests |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `make validate-api` | Four specifications structurally valid; documentation warnings remained |
| Helm lint/template | Passed |
| Compose default/test and production overlay validation | Passed; production failed closed without required secret values as designed |
| API/event contract gate | Failed first on metadata equality, then exposed real DR and stale anchor drift |
| Design-system ratchet | Failed: inline hex count 38 versus baseline 24 |
| i18n ratchet | Initially unreachable behind the design failure; once reached, found 24 new hardcoded strings |
| Formatting inventory | 592 Go files reported by `gofmt -l`; this is a repository-wide quality backlog, not evidence that changed files were left unformatted |

## 4. Alignment conclusions

### Frontend to API

- Every shipped LEX journey sampled in the matrix resolves to a real client and registered backend route.
- No material LEX user action was accepted because a button existed; mutations were traced to services and persistence.
- Backend-only monitors, provider callbacks and admin scrape surfaces are intentional system consumers.
- The consultation board had a stale cast claiming the component was a stub. The component was already complete; the cast was removed and the real `ConsultationStatus` contract is now enforced.
- The organizational import workflow was functional but newly English-only. It now has one typed English/Arabic label bundle and localized status, history, validation and action copy.

### API to backend

- Both aliases are mounted and entitlement-gated.
- The checker now discovers permission-specific router variables such as `contractView`, `approvalWrite` and `contractReview`, not just the coarse `read`/`write` routers.
- All declared phase-1 operations match registered routes. The boundary declares 122 of 624 registered operations; 502 are deliberately reported as outside the current public contract.
- Ten required drafting operations remain exact in the phase-1 contract; extra internal/streaming routes no longer create a false failure.
- Newly registered DR integrations and sealed rehearsal-proof operations were added to the DR contract and route inventory. This cross-cutting defect prevented the global contract gate from ever reaching a clean result.

### API/service to persistence

- Lex integration tests create a fresh PostgreSQL database and apply the live Lex migrations before exercising real HTTP routes.
- All 85 Lex migrations had matching down files at audit time.
- Existing evidence from the immediately preceding repository audit includes an up/down/up Lex cycle. The current run independently re-proved a clean fresh apply through the race integration harness.
- No shipped LEX capability was found with a missing required table/migration.
- The generic migrator previously treated unknown database names and missing migration directories as successful skips. It now rejects invalid direction/database input and fails when the migration root or a selected database directory is absent.

### Authorization and audit

- Gateway entitlement, JWT, tenant and domain permission layers are separate and cumulative.
- High-risk decisions use fine-grained approve/close/security verbs and service-level assignee/distinct-actor checks; a coarse `lex:write` grant is not treated as universal approval authority.
- Tenant isolation and alias parity are covered by integration tests.
- Provider, workflow, status, notification/outbox and import operations have durable records or explicit audit/event paths. No unsupported `-seed` operation is allowed to claim success.

### Deployment and runtime

- Helm lint/render, Compose config and required-secret interpolation pass.
- Production Helm values disable demo seeding. The explicit `system-seeder` remains a separate development/demo operation.
- The migrator no longer advertises fake seed support. Production migration and seeding are separate, auditable actions.
- Environment-specific proof is still required for live identity, signature, court, mail/calendar, OCR/LLM and customer corpus integrations.

## 5. Findings and disposition

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| WTQ-MIG-001 | P1 | Migrator logged successful seeding without executing seed logic | Resolved: unsupported `-seed` flag removed; use explicit `system-seeder` only where authorized |
| WTQ-MIG-002 | P1 | Unknown databases and missing migration paths could exit successfully | Resolved: allowlist/deduplication, direction validation and fail-closed path checks with tests |
| WTQ-CON-001 | P1 | Contract checker rejected valid extension metadata, then contained stale route/client/wiring anchors | Resolved: required-key subset validation, normalized semantic anchors and current router discovery |
| WTQ-CON-002 | P2 | DR integrations and sealed rehearsal-proof routes were registered but undocumented | Resolved in DR OpenAPI and inventory |
| WTQ-UI-001 | P2 | Consultation board call site bypassed its real typed props with `unknown` | Resolved with direct component use and `ConsultationStatus` |
| WTQ-I18N-001 | P2 | Org import/settings fallback added 24 untranslated detections | Resolved; i18n gate passes and improved baseline is locked |
| WTQ-DS-001 | P2 | New inline hex styles exceeded the design-system ratchet | Resolved with semantic tokens; inline-hex count reduced to 9 |
| WTQ-OPS-001 | P3 | Compose used obsolete top-level schema versions | Resolved |
| WTQ-CON-003 | P2 | Phase-1 OpenAPI covers 122/624 registered operations | Open: explicit documentation boundary, not a runtime contradiction |
| WTQ-EXT-001 | External | Live provider, deployed E2E, restore/DR and load evidence is not available in this local repository | Open production conditions |
| WTQ-QLT-001 | P3 | 592-file Go formatting backlog, 1,061 post-remediation ESLint warnings, API documentation warnings and large LEX bundles | Open quality/performance backlog |

## 6. Quantitative result

- 18 capability groups traced.
- 11 internally aligned; 7 conditional on contract/provider/environment evidence.
- 0 confirmed broken end-to-end paths after remediation.
- 0 missing required frontend, backend or migration layers for shipped capability groups.
- 0 confirmed frontend/backend permission mismatches after remediation.
- Test gaps remain in five production-evidence categories: live providers, deployed browser journeys, load/soak, backup/restore/DR and customer data/model acceptance.

## 7. Verdict

**CONDITIONALLY READY**

There are no known unresolved P0/P1 repository contradictions in the audited path. The remaining release conditions require deployed infrastructure, customer/provider credentials or production-like operational exercises. The intentionally partial public API contract and quality backlogs must stay visible and cannot be described as full public-contract completion.
