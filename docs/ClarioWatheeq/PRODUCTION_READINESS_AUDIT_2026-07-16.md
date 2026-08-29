# WatheeqTech / Lex Production Readiness Audit

**Audit date:** 2026-07-16  
**Scope:** the complete `clario360` repository, with release ownership focused on the WatheeqTech/Lex product and every shared platform dependency on its request path  
**Release action:** validation and repository changes only; no production deployment or production-data mutation was performed

## 1. Executive verdict

**READY WITH CONDITIONS**

The repository is suitable for a controlled staging release and production-candidate exercise. The audit found and corrected high-impact authorization, trust configuration, seed-data integrity, routing, API-specification, deployment, dependency-vulnerability, frontend-regression, and CI coverage defects. The uncached backend suite, the Lex integration suite under the race detector, database migration cycles, seed validation, backend builds, the complete 2,605-test frontend coverage run, the production frontend build, Helm validation, dependency audits, Go vulnerability analysis, and API validation have passed locally.

Production approval remains conditional on environment-specific evidence that cannot be produced from this repository alone:

1. Complete acceptance in the target environment for Nafath/Najiz, the chosen e-signature provider, SSO/SCIM, SMTP/calendar, object/reference storage, OCR/LLM, and notification-provider credentials.
2. A target-cluster backup/restore drill, disaster-recovery exercise, and representative load/capacity test with the production topology and data-volume assumptions.
3. A release-candidate smoke and browser E2E run against the deployed staging stack, including TLS, DNS, ingress, cookies, WebSockets, Kafka, Redis, and all production secret mounts.
4. Formal review of the documented OpenAPI coverage gap. The checked-in Lex OpenAPI document is valid but represents a governed phase-1 contract, not every internal or administrative route.

No known critical or high-severity repository defect remains open. The conditions above are release gates, not assertions that an external provider passed without credentials. Current statement coverage is 29.2% across all Go packages and 31.13% across the frontend; CI now enforces measured no-regression floors, while material coverage growth remains explicit engineering debt.

## 2. Architecture discovered

```text
Browser / Next.js 15 application
  -> Next server/BFF and API rewrite
  -> API gateway
       -> JWT/session validation
       -> tenant + entitlement (app.watheeq)
       -> route-specific authentication
       -> Lex RBAC / organization RBAC / ABAC / residency controls
  -> Go Lex service handlers
       -> request validation and response envelopes
       -> application/domain services
       -> PostgreSQL repositories and transactions
       -> Redis cache, rate limits, idempotency and DLQ state
       -> Kafka events, outbox consumers and background monitors
       -> file/object storage and reference-library services
       -> signature, notification, calendar, SSO/SCIM, Najiz/Nafath and AI/OCR adapters
```

The repository is a monorepo with:

- A Go 1.25.12 backend composed of the API gateway and separately built domain/platform services under `backend/cmd`.
- Lex domain code under `backend/internal/lex`, plus shared IAM, audit, workflow, notification, file, event, tenancy, entitlement, ABAC and gateway packages.
- A Next.js 15/React frontend under `frontend`, using TanStack Query for server state, Zustand stores for client/auth state, typed enterprise/API clients, and an Arabic-first message registry.
- PostgreSQL databases and ordered up/down migrations; Redis; Kafka/Redpanda; object/file storage; and an AI second-brain runtime.
- Docker build definitions, a Helm chart under `deploy/helm/clario360`, GitHub Actions CI, local integration harnesses, and Playwright E2E/accessibility suites.

WatheeqTech is represented as the product/tenant-facing legal experience; `Lex` is the service, route, permission, database, and frontend namespace. The supported API aliases `/api/v1/lex` and `/api/v1/watheeq` deliberately share the same service while the entitlement boundary is `app.watheeq`.

### Inventory evidence

- 70 Lex page entry points in the frontend dashboard tree.
- 632 registered backend routes across the repository inventory; the Lex route file contains the legal product surface and both aliases.
- 172 Lex backend `_test.go` files.
- 85 Lex up migrations and 85 matching down migrations.
- The phase-1 Lex OpenAPI document contains 95 paths, 122 operations, and 234 schemas.

## 3. WatheeqTech/Lex feature and contract matrix

This matrix groups related operations so it remains usable as a release artifact. Exact operation shapes for the governed public subset are in `docs/api/watheeq-lex-service.openapi.yaml`; internal route registrations and frontend clients are the source of truth for the larger administrative surface.

| Workflow / capability | Frontend entry and state | Backend contract | Auth / tenancy / data / external dependencies | UI states and automated evidence | Alignment |
|---|---|---|---|---|---|
| Session, persona and product access | Auth pages, auth store, Lex access guard, `/lex` shell | Auth login/refresh/logout/me; Lex context/me; gateway route policy | JWT/session, tenant context, `app.watheeq`, role grants | Hydration, unauthenticated, forbidden, expired-session and entitled states; auth, middleware and store tests | Aligned after stale permission/store tests were corrected |
| Gateway and public callback boundaries | BFF/rewrite and enterprise client | Both `/api/v1/lex/*` and `/api/v1/watheeq/*`; explicit public SSO, email-HMAC and guest-portal prefixes | Public callback proof where applicable; JWT + tenant + entitlement elsewhere | Route-order regression tests cover longer public prefixes before generic protected routes | Aligned after fix |
| Legal service desk / requests | Request list/detail/create, catalog, intake and approval workspaces | Request CRUD, catalog, intake, approval policy/template, decision, execution, SLA and escalation handlers | Tenant/org visibility, requester/assignee roles, approval SoD; notifications/workflows | Loading/empty/error/success and decision authorization tests | Aligned for shipped UI; server-only operations are administrative/background by design |
| Litigation cases | Case lists, detail, timeline, assignment/intake dialogs | Case CRUD/search, assignment, intake, tasks, deadlines, evidence and lifecycle decisions | Case visibility, legal role matrix, org scope; files/calendar | Negative authorization and intake/assignment regression tests | Aligned after object/role checks were hardened |
| Consultations and legal opinions | Consultation screens and matter links | Consultation CRUD, assignment, response/opinion and lifecycle routes | Tenant/org and legal-role visibility | Query/mutation UI states and backend auth tests | Aligned |
| Investigations and settlements | Investigation/settlement pages and dialogs | CRUD, participants/evidence, approvals, settlement decisions and status transitions | Legal role/SoD, tenant and org scope; files/signatures | Validation, forbidden and lifecycle coverage | Aligned |
| Contracts and analysis | Contract list/detail, entity rollups, analytics, bulk AI, clauses, renewal/review UI | Contract CRUD/search/report, text search, versions, upload, analysis, clauses, playbooks, renewal and review | Legal roles, tenant/org scope; file service, OCR/LLM, notifications | Loading/empty/error, analysis and lifecycle integration tests | Aligned internally; live OCR/LLM/provider acceptance remains a condition |
| Documents and editor | Document list/detail/editor, versions, guest/share dialogs | Document CRUD, upload/version, editor session, collaboration, guest/public link and download routes | JWT or scoped guest proof; tenant ownership; object/file storage | Editor fallback, versioning, guest and access tests | Aligned; target object-storage smoke required |
| Matters, obligations and deadlines | Matter list/detail, obligation summary, timeline and reporting | Matter CRUD/search/report, obligations, deadlines, associations and calendar/reminder operations | Matter visibility, tenant/org scope; calendar/notification provider | Side-query isolation, localized state, report and dialog tests | Aligned after stale mocks and real client imports were corrected |
| E-signatures | Signature profiles, placements, envelope and custody UI | Profile, placement, envelope, recipient, send/sign/complete, provider callback and custody/evidence routes | Tenant/role, scoped recipient proof, encryption, provider API | Seed and integration fixtures now require real signature evidence before activation | Aligned in deterministic tests; live provider certification remains a condition |
| Library, playbooks and regulations | Library search/ask/recent views, playbooks, regulations | Corpus/library, playbook and regulation search/CRUD/governance handlers | Entitlement + role; file/reference library, OCR/AI | Empty/error/search and Arabic terminology checks | Aligned; live reference corpus/OCR/AI acceptance required |
| Compliance and alerts | Compliance dashboard/rules/alerts detail | Rules, checks/runs, alerts, scores, status and reports | Legal/compliance roles; scheduled monitors and notifications | Alert/detail and negative-path tests | Aligned |
| Workflow and drafting | Drafting workspace, definitions/forms designer, instances/tasks | Draft lifecycle/streaming; workflow definition/form/template/instance/task contracts | Role/tenant scope; AI stream and workflow engine | Draft stream regression, form-schema roundtrip, condition coercion and task tests | Aligned after registry and streaming-test fixes |
| Organization, roles and delegated authority | Org tree/entities, role matrix, SSO/SCIM and security admin | Org entities, membership, role grants, DoA evidence, impersonation, SSO and SCIM | Strong tenant isolation, org scope, trusted approval roots | RBAC/SoD, impersonation, visibility and approval-evidence tests | Aligned after tenant-admin wildcard removal and trust fail-closed changes |
| Integrations, sync and DLQ | Connector registry/config, events/logs/conflicts/DLQ/metrics UI | Connector CRUD, endpoints, sync runs, conflicts, pending changes, metrics, diagnostics and DLQ ops | Integration view/manage split; secret references; ops admin port | Extensive component/handler tests and route authorization | Aligned; target connectors require credentialed smoke |
| Notifications, calendar and reports | Notification center/preferences; calendar/report/export actions | Notification preferences/delivery; reminders; report/export routes | Tenant/user scope; SMTP/webhook/calendar providers | Loading/error/retry behavior and provider-mode tests | Aligned in deterministic modes; live provider delivery required |
| Background processing and operations | No direct end-user consumer by design | Expiry, compliance, renewal, SLA, delivery auto-close, proximity, outbox, integration sync/rotation and DLQ monitors | Service identities, Redis/Kafka/Postgres and admin scrape port | Startup/config validation, integration and race coverage | Intentional backend-only surface |

### Deliberate consumer exceptions

- Health, readiness, metrics and DLQ-count operations are consumed by the orchestrator/operations plane, not the product UI.
- Kafka consumers, outbox dispatchers, scheduled monitors, migration/seed commands and provider callbacks are backend-only by design.
- Some administrative and partner endpoints are intentionally driven by external systems, webhooks, SSO/SCIM clients or operations tooling rather than a browser page.
- The existing `docs/architecture/FRONTEND_BACKEND_FEATURE_PARITY.md` is a March 2026 snapshot and materially under-reports the current Lex UI. It must not be used as the release source of truth; this audit and live route/client inventories supersede it until that document is regenerated.

## 4. Issues found and disposition

### Critical / high — fixed

1. **Tenant administrator violated legal separation of duties.** A coarse `lex:*` grant allowed legal decisions outside the intended configuration role. It was replaced in runtime expansion, role defaults, onboarding seeds and database migration with explicit configuration/CRUD permissions. Decision authorization tests cover the boundary.
2. **Public/protected route matching was order-sensitive.** SSO callbacks, email-HMAC endpoints and guest-portal routes could be captured by a broader JWT/entitlement prefix. Longer proof-bearing public prefixes now precede generic protected aliases, with regression tests for both `/lex` and `/watheeq`.
3. **Delegation-of-Authority approval trust could fall back to caller evidence.** Protected profiles now require configured trusted authority roots and fail closed. Development can explicitly use keyless mode; non-development cannot. Invalid/nonpositive rotation configuration is rejected.
4. **Seed contract activation did not require a completed native signature envelope.** The generic pending-signature transition was removed. Seed envelopes are idempotent and activation occurs atomically only with signature evidence; integration fixtures use the real lifecycle.
5. **Organization and legal action authorization gaps.** Organization middleware, legal object visibility, impersonation behavior, intake/assignment and workflow-decision tests were corrected so tenant/org/persona boundaries agree end to end.
6. **Production encryption/trust values were not wired safely by Helm.** The chart now requires secret-backed field encryption and approval roots in protected profiles and removes duplicated/misaligned ConfigMap values.
7. **CI could report green with missing coverage or failed integration commands.** The frontend test wrapper now executes one argument-preserving Vitest coverage process; backend integration failures are no longer swallowed; CI fails if the summary is absent.
8. **An unauthenticated DLQ metric lived on public service routers.** Lex and notification DLQ count probes now live beside metrics on the dedicated admin port.
9. **The Go dependency graph contained 37 reachable published vulnerabilities.** The toolchain, runtime images and affected direct/transitive dependencies were upgraded. `govulncheck ./...` now reports no reachable vulnerabilities, and both module and vendor resolution paths verify.

### Medium — fixed

1. The Lex OpenAPI file contained invalid indentation, duplicate schema properties and a missing `ValidationError` reference; the license contract contained a duplicate `x-outbox` key and invalid OpenAPI 3.1 nullable shapes. `make validate-api` now discovers and validates all four checked-in API/OpenAPI YAML contracts and fails if none are found.
2. Gateway forwarding appended the peer address multiple times. Forwarding ownership is now left to `httputil.ReverseProxy`, with a single `X-Real-IP` derivation.
3. Frontend and backend Lex verb implications disagreed for configuration personas. Frontend permission resolution and route requirements now mirror backend grant expansion.
4. The backend build loop could continue after a service failed. It now runs with shell fail-fast behavior.
5. Integration testcontainers referenced an obsolete Redpanda version. The harness now uses a supported pinned image.
6. Arabic/English test state, message registries, terminology gates and nested Radix focus behavior caused nondeterministic or stale regressions. Locale-explicit helpers, message registration, deterministic test storage cleanup and focused dialog mocks were added.
7. Several UI tests mocked only the primary Lex request while real sibling/report queries escaped to the API. Tests now model the complete component contract.
8. Helm values contained duplicate top-level keys and twelve repeated autoscaling blocks, which permissive YAML parsers could silently overwrite. Duplicate configuration was removed and both default and production values now pass strict YAML parsing before Helm lint/render.
9. The marketing mobile drawer overrode Radix's internal title identifier, breaking the accessible name relationship. It now uses Radix-managed title/description wiring and passes its focused suite without the prior accessibility warning.

### Low / debt — remaining

1. ESLint has a substantial existing warning backlog: 1,076 warnings when run without `--quiet`. There are no lint errors in the release check, but the warning baseline should be burned down incrementally. **Owner:** frontend maintainers. **Remediation:** ratchet warnings per package/page and prohibit net-new warnings in CI.
2. Repository statement coverage is 29.2% backend overall (30.0% for CI's `internal` scope) and 31.13% frontend. CI now fails below 30.0%/31.0% respectively, preventing regression without pretending the previous 70%/60% labels were achieved. **Owner:** backend/frontend maintainers. **Remediation:** add tests around zero/low-coverage handlers, repositories, startup wiring and UI pages, then raise each floor monotonically.
3. The OpenAPI phase-1 file does not enumerate all internal/admin Lex routes, and structural validation reports 174 non-blocking documentation-quality warnings across the four contracts. **Owner:** API governance. **Remediation:** decide which routes are public contracts, complete operation documentation and enforce handler/spec drift checks.
4. The old parity report is stale. **Owner:** architecture/documentation. **Remediation:** regenerate from current route and client inventories or archive it.

## 5. Files changed

The working tree was clean before this audit. The handoff contains 133 changed paths: 127 modified and 6 added. The tracked diff is 1,635 insertions and 4,405 deletions; most deletions are removal of duplicated Helm values blocks rather than product-code removal. Changes are confined to release hardening and regression evidence.

| Area | Files | Reason |
|---|---|---|
| CI and commands | `.github/workflows/ci.yml`, `Makefile`, `frontend/scripts/test.sh`, `frontend/vitest.config.ts` | Fail-closed API/integration/build/coverage checks, measured no-regression floors and usable coverage output |
| Go toolchain/dependencies | `go.work`, `backend/go.mod`, `backend/go.sum`, seven service Dockerfiles, two testcontainer helpers | Pin Go 1.25.12 and patched dependencies/images; adapt to the current testcontainers port API |
| Frontend dependencies/config | `frontend/package.json`, `frontend/package-lock.json`, `frontend/eslint.config.mjs`, `frontend/next.config.mjs` | Safe dependency upgrades, zero-audit dependency graph, generated-output lint exclusion and internal gateway rewrite |
| Gateway | `backend/internal/gateway/config/routes.go` and tests; proxy header/reverse proxy files | Correct public-prefix precedence and forwarding headers |
| Lex configuration/runtime | `backend/internal/lex/config/config.go` and new tests; `backend/cmd/lex-service/main.go` | Fail-closed approval trust, interval validation and ops-only DLQ probe |
| RBAC/tenancy | `backend/internal/auth/rbac.go`, IAM role model, onboarding role seeder, legal/org middleware and related tests | Remove coarse tenant-admin legal authority; align SoD, visibility and impersonation |
| Data lifecycle | Lex seed, integration fixtures/harness, case-intake/workflow services and tests | Signature-backed activation, idempotency, current Redpanda and lifecycle authorization |
| Database | `backend/migrations/platform_core/000028_tenant_admin_lex_sod.{up,down}.sql` | Forward and reversible correction for existing tenant-admin roles |
| Service startup | service `main.go` files and `backend/cmd/migrator/main.go` | Consistent startup/config behavior and admin-plane routing |
| Helm | Lex ConfigMap/deployment, shared services ConfigMap, `values.yaml`, `values-production.yaml` | Remove duplicate settings/autoscaling blocks and require secret-backed encryption/trusted roots in production |
| API contracts | `docs/api/watheeq-lex-service.openapi.yaml`, `docs/api/license-entitlement.openapi.yaml` | Valid schema structure, unique extension keys and correct OpenAPI 3.1 nullable types |
| Frontend permission state | `frontend/src/lib/permissions.ts`, `frontend/src/stores/auth-store.ts`, new/updated store tests | Mirror backend effective permission semantics |
| Frontend Lex/UI tests | Lex overview/drafting/admin/matters/playbooks/regulations/signature/settings files and tests | Real contract mocks, localized assertions and regression coverage |
| Shared frontend tests/i18n | test setup/helpers, admin form builders/tests, marketing mobile navigation, affected integration tests, message/glossary/termbase files | Deterministic locale/focus behavior, accessible dialog naming, registry availability and terminology ratchet |
| Audit evidence | `docs/ClarioWatheeq/PRODUCTION_READINESS_AUDIT_2026-07-16.md` | Architecture, contract matrix, findings, proof, risks and release/rollback checklist |

The exact file-level inventory is the 133-line `git status --short` output captured at handoff; the grouped table above maps every path to its purpose. No unrelated pre-existing user changes were present to preserve.

<details>
<summary>Exact 133-path change manifest</summary>

```text
 M .github/workflows/ci.yml
 M Makefile
 M backend/cmd/acta-service/main.go
 M backend/cmd/api-gateway/Dockerfile
 M backend/cmd/audit-service/Dockerfile
 M backend/cmd/cyber-service/Dockerfile
 M backend/cmd/cyber-service/main.go
 M backend/cmd/data-service/main.go
 M backend/cmd/file-service/Dockerfile
 M backend/cmd/iam-service/Dockerfile
 M backend/cmd/lex-service/main.go
 M backend/cmd/migrator/main.go
 M backend/cmd/notification-service/Dockerfile
 M backend/cmd/notification-service/main.go
 M backend/cmd/siem-service/Dockerfile
 M backend/cmd/system-seeder/main.go
 M backend/cmd/visus-service/main.go
 M backend/go.mod
 M backend/go.sum
 M backend/internal/auth/rbac.go
 M backend/internal/auth/rbac_test.go
 M backend/internal/data/connector/testhelpers/clickhouse_container.go
 M backend/internal/data/connector/testhelpers/dolt_container.go
 M backend/internal/gateway/config/routes.go
 M backend/internal/gateway/config/routes_test.go
 M backend/internal/gateway/middleware/proxy_headers.go
 M backend/internal/gateway/proxy/reverse_proxy.go
 M backend/internal/iam/model/role.go
 M backend/internal/lex/config/config.go
 M backend/internal/lex/handler/case_assignment_authz_test.go
 M backend/internal/lex/handler/case_intake_task_inbox_authz_test.go
 M backend/internal/lex/handler/contract_workflow_decision_authz_test.go
 M backend/internal/lex/handler/routes.go
 M backend/internal/lex/integration/fixtures_test.go
 M backend/internal/lex/integration/harness_test.go
 M backend/internal/lex/middleware/orgrbac.go
 M backend/internal/lex/middleware/orgrbac_test.go
 M backend/internal/lex/seed.go
 M backend/internal/lex/service/approval_orchestrator_test.go
 M backend/internal/lex/service/legal_case_intake_service.go
 M backend/internal/lex/service/legal_case_intake_service_test.go
 M backend/internal/lex/service/workflow_service.go
 M backend/internal/middleware/legal_rbac_authz_test.go
 M backend/internal/onboarding/service/seeder/role_seeder.go
 M deploy/helm/clario360/templates/configmap-services.yaml
 M deploy/helm/clario360/templates/lex-service/configmap.yaml
 M deploy/helm/clario360/templates/lex-service/deployment.yaml
 M deploy/helm/clario360/values-production.yaml
 M deploy/helm/clario360/values.yaml
 M docs/api/license-entitlement.openapi.yaml
 M docs/api/watheeq-lex-service.openapi.yaml
 M frontend/eslint.config.mjs
 M frontend/next.config.mjs
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/scripts/i18n-glossary.json
 M frontend/scripts/test.sh
 M frontend/src/__tests__/integration/ai-governance-detail.test.tsx
 M frontend/src/__tests__/integration/audit-logs.test.tsx
 M frontend/src/__tests__/integration/cyber/alert-list.test.tsx
 M frontend/src/__tests__/integration/cyber/asset-detail.test.tsx
 M frontend/src/__tests__/integration/cyber/asset-inventory.test.tsx
 M frontend/src/__tests__/integration/cyber/ctem.test.tsx
 M frontend/src/__tests__/integration/cyber/mitre-matrix.test.tsx
 M frontend/src/__tests__/integration/cyber/remediation.test.tsx
 M frontend/src/__tests__/integration/cyber/risk-heatmap.test.tsx
 M frontend/src/__tests__/integration/cyber/rules.test.tsx
 M frontend/src/__tests__/integration/cyber/scan-history.test.tsx
 M frontend/src/__tests__/integration/cyber/soc-dashboard.test.tsx
 M frontend/src/__tests__/integration/lex-case-timeline.test.tsx
 M frontend/src/__tests__/integration/lex-contract-lifecycle.test.tsx
 M frontend/src/__tests__/integration/lex-drafting.test.tsx
 M frontend/src/__tests__/integration/lex-governance-decisions.test.tsx
 M frontend/src/__tests__/integration/lex-overview-watheeq.test.tsx
 M frontend/src/__tests__/integration/notebook-workspace.test.tsx
 M frontend/src/__tests__/integration/task-detail.test.tsx
 M frontend/src/__tests__/integration/task-management.test.tsx
 M frontend/src/__tests__/integration/user-management.test.tsx
 M frontend/src/__tests__/integration/wizard-steps.test.tsx
 M frontend/src/__tests__/setup.ts
 M frontend/src/__tests__/unit/data/create-source-wizard.test.tsx
 M frontend/src/__tests__/unit/data/query-builder.test.tsx
 M frontend/src/__tests__/unit/data/source-card.test.tsx
 M frontend/src/__tests__/unit/data/transform-list.test.tsx
 M frontend/src/app/(dashboard)/acta/meetings/[id]/_components/agenda-vote-dialog.test.tsx
 M frontend/src/app/(dashboard)/admin/audit/_components/json-diff-viewer.test.tsx
 M frontend/src/app/(dashboard)/admin/audit/_components/json-diff-viewer.tsx
 M frontend/src/app/(dashboard)/admin/roles/_components/permission-tree.test.tsx
 M frontend/src/app/(dashboard)/admin/roles/_components/permission-tree.tsx
 M frontend/src/app/(dashboard)/admin/workflows/definitions/[defId]/designer/components/condition-builder.test.tsx
 M frontend/src/app/(dashboard)/admin/workflows/definitions/[defId]/designer/components/condition-builder.tsx
 M frontend/src/app/(dashboard)/admin/workflows/definitions/[defId]/designer/components/form-schema-builder.test.tsx
 M frontend/src/app/(dashboard)/admin/workflows/definitions/[defId]/designer/components/form-schema-builder.tsx
 M frontend/src/app/(dashboard)/admin/workflows/forms/forms-admin.roundtrip.test.tsx
 M frontend/src/app/(dashboard)/cyber/vciso/_components/message-diagnostics.test.tsx
 M frontend/src/app/(dashboard)/dr/readiness/page.test.tsx
 M frontend/src/app/(dashboard)/lex/admin/_lib/admin-hub-cards.ts
 M frontend/src/app/(dashboard)/lex/admin/integrations/pending-changes/page.test.tsx
 M frontend/src/app/(dashboard)/lex/admin/page.test.tsx
 M frontend/src/app/(dashboard)/lex/admin/request-approval-policies/templates/_components/template-form-dialog.test.tsx
 M frontend/src/app/(dashboard)/lex/compliance/page.test.tsx
 M frontend/src/app/(dashboard)/lex/contracts/_lib/contracts-labels.ts
 M frontend/src/app/(dashboard)/lex/contracts/page.test.tsx
 M frontend/src/app/(dashboard)/lex/documents/editor-route-fallback.test.tsx
 M frontend/src/app/(dashboard)/lex/documents/page.test.tsx
 M frontend/src/app/(dashboard)/lex/drafting/page.test.tsx
 M frontend/src/app/(dashboard)/lex/matters/[id]/matter-detail.test.tsx
 M frontend/src/app/(dashboard)/lex/matters/_components/matter-obligation-summary.tsx
 M frontend/src/app/(dashboard)/lex/matters/_components/matters-list.test.tsx
 M frontend/src/app/(dashboard)/lex/playbooks/_components/labels.ts
 M frontend/src/app/(dashboard)/lex/playbooks/page.test.tsx
 M frontend/src/app/(dashboard)/lex/regulations/page.test.tsx
 M frontend/src/app/(dashboard)/lex/signatures/_components/labels.ts
 M frontend/src/app/(dashboard)/settings/_lib/settings-i18n.ts
 M frontend/src/components/dashboard/dashboard-resilience.test.tsx
 M frontend/src/components/layout/navigation-labels.test.ts
 M frontend/src/components/marketing/shell/mobile-nav.tsx
 M frontend/src/components/workflows/task-claim-button.test.tsx
 M frontend/src/components/workflows/workflow-step-timeline.test.tsx
 M frontend/src/lib/i18n/__tests__/termbase-baseline.json
 M frontend/src/lib/i18n/__tests__/termbase.test.ts
 M frontend/src/lib/i18n/messages.ts
 M frontend/src/lib/marketing/data.test.ts
 M frontend/src/lib/permissions.ts
 M frontend/src/stores/auth-store.ts
 M frontend/vitest.config.ts
 M go.work
?? backend/internal/lex/config/config_test.go
?? backend/internal/lex/handler/integration_registry_authz_test.go
?? backend/migrations/platform_core/000028_tenant_admin_lex_sod.down.sql
?? backend/migrations/platform_core/000028_tenant_admin_lex_sod.up.sql
?? docs/ClarioWatheeq/PRODUCTION_READINESS_AUDIT_2026-07-16.md
?? frontend/src/stores/check-permission.test.ts
```

</details>

## 6. Tests added or strengthened

- New Lex config tests for protected-profile approval roots, development downgrade and invalid rotation intervals.
- New integration-registry authorization coverage.
- New frontend permission implication/store coverage.
- Gateway alias and public-prefix precedence tests.
- Tenant-admin SoD and legal decision negative-path tests across runtime RBAC, seeded roles and handler middleware.
- Organization RBAC, impersonation, visibility, case assignment/intake and contract decision authorization tests.
- Native signature envelope/seed activation and integration fixture coverage.
- Frontend drafting stream, complete matter side-query/report, form-schema roundtrip, condition-builder, agenda-vote and locale-sensitive page tests.
- Termbase enforcement improved and its violation baseline reduced from 1,448 to 1,056 across 175 bundles, with no net-new violations allowed.
- Accessible-name regression coverage for the Radix mobile navigation drawer.
- CI coverage-report presence, numeric validation and measured backend/frontend ratchets.

## 7. Verification evidence

### Passed

| Command / check | Result |
|---|---|
| `GOWORK=off go test -count=1 ./...` from `backend` | Passed the full uncached backend suite after dependency upgrades |
| `GOWORK=off go test -count=1 -coverprofile=... ./...` | Passed; 29.2% aggregate statement coverage (61,808/211,350); CI's `internal` scope is 30.0% (60,578/201,869) |
| `GOWORK=off go vet ./...` from `backend` | Passed |
| `GOWORK=off go test -race -count=1 -tags=integration ./internal/lex/integration` | Passed in 32.738s |
| Live Lex migration up; platform-core up/down/up; Lex seed lifecycle | Passed against local PostgreSQL, including rollback/reapply |
| `make build` | Passed all backend service builds; loop now fails fast |
| `govulncheck ./...` | No reachable vulnerabilities; one vulnerable module symbol is present but not called |
| `go mod verify`; `go list -mod=vendor all`; clean `GOFLAGS=-mod=mod go test -run '^$' ./...` | Module checks passed; both vendor and clean module-download compile paths resolve |
| `make validate-api` | Discovered and structurally validated all four API/OpenAPI YAML documents; 174 documentation-quality warnings remain non-blocking |
| Strict YAML parse of CI and Helm values | Passed; no duplicate YAML keys remain in default/production values |
| `helm lint` and `helm template` with dummy required secret references | Passed default and production-value validation/rendering |
| `npm audit` and `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run test:coverage` | 367 files and 2,605 tests passed; statements 31.13%, branches 25.82%, functions 28.50%, lines 31.99% |
| `npm run type-check` | Passed after the final source/test edits |
| `npm run lint -- --quiet`; default lint | Quiet release gate passed with 0 errors; default report contains 1,076 warnings |
| `npm run build` | Next.js 15.5.18 production build passed; compilation completed in 88s and emitted 291 route entries |
| `PLAYWRIGHT_SKIP_WEB_SERVER=1 npx playwright test --list` | Discovered 431 browser tests in 46 files without mutating a target environment |
| AI runtime test suite | 79 tests passed |
| Tracked-source credential/secret scan | No committed credential match found |
| `git diff --check`, `gofmt -l`, strict workflow YAML | Passed final whitespace, formatting and workflow-structure checks |

### Tool availability and bounded checks

- `golangci-lint`, `gosec`, `trivy` and `gitleaks` were not installed in the local shell. CI defines authoritative lint/SAST/container/secret jobs. `go vet`, `govulncheck`, npm audit, tracked-source scanning and the other checks above provide local evidence without claiming those unavailable tools ran.
- Browser E2E execution requires the complete Docker/staging topology and external-provider configuration. All 431 tests were discovered, while component/integration suites used safe deterministic providers; the credentialed staging E2E step remains an explicit release condition.
- The full frontend suite emits non-failing jsdom noise from intentional localhost fallbacks, unsupported navigation, zero-dimension chart fixtures and a small number of description warnings. The mobile-navigation accessible-name defect found during the audit was fixed; remaining stderr should be ratcheted separately from pass/fail status.

## 8. Security, reliability, performance and operations findings

### Security

- JWT, tenant, entitlement, org, role and object-visibility boundaries were traced through both API aliases.
- Tenant-admin permissions now observe legal separation of duties and are corrected for both new and existing tenants.
- DoA evidence verification, encryption mode and trusted-root configuration fail closed in protected environments.
- Guest, SSO and email-HMAC routes are public only where an alternative scoped proof is part of the contract.
- DLQ/metrics operations are removed from the public service plane.
- Go 1.25.12, patched service build images and updated dependencies remove all 37 previously reachable `govulncheck` findings.
- No tracked secrets were found; `govulncheck` reports no reachable vulnerability and npm reports no known vulnerability.

### Reliability

- Signature-backed state transitions are atomic and seed operations are idempotent.
- Migration rollback/reapply, Lex integration tests and the race detector passed.
- Background intervals are validated; nonpositive integration rotation is rejected.
- CI no longer hides integration failures, silently omits coverage or compares the current repository with fictional 70%/60% coverage claims. Numeric 30.0% backend and 31.0% frontend no-regression floors are enforced and ready to ratchet upward.
- External HTTP modes validate endpoint, API key and timeout configuration.
- All checked-in API contracts are discovered fail-closed, and deployment values pass strict YAML parsing as well as Helm semantics.

### Performance

- Potentially large operational collections use page/filter contracts; dashboard data uses bounded cache TTLs.
- Redis/Kafka/Postgres resource lifecycle and the Lex integration harness completed cleanly under race detection.
- No confirmed release-blocking N+1 or unbounded-query defect was found in the audited Lex workflows.
- The production frontend build completes, but several Lex routes have first-load JavaScript above 600 kB; bundle budgets and route-level code splitting should be established before calling performance debt closed.
- Representative load and production-dataset query evidence remain target-environment gates, not locally inferred passes.

### Operations

- Health, readiness, metrics and DLQ probes are on the intended admin plane.
- Helm production values require encryption and approval-authority secret references.
- Default/production values have no duplicate YAML keys; twelve repeated autoscaling blocks and the duplicate secret block were removed. The chart renders with distinct service settings instead of parser-dependent overwrites.
- The release must retain correlation/request IDs through ingress and gateway and monitor HTTP errors, Kafka lag, outbox/DLQ depth, DB saturation, provider latency/failure, signature callbacks and background monitor failures.

## 9. Database migration and rollback considerations

The new `platform_core/000028_tenant_admin_lex_sod` migration removes the tenant administrator's coarse `lex:*` authority and installs the explicit legal configuration/CRUD set used by code and tenant seeding. Its down migration restores the preceding grant model for mechanical rollback.

Deployment rules:

1. Take and verify a platform-core backup before applying migrations.
2. Apply migrations with a single migration leader before rolling application pods.
3. Confirm `000028` affected the expected tenant-admin roles and did not change custom legal roles.
4. Deploy gateway, Lex and onboarding/IAM changes together; mixed versions can temporarily disagree on effective grants.
5. Treat the down migration as emergency mechanical rollback only: restoring `lex:*` also restores the separation-of-duties exposure. Prefer rolling application code forward after diagnosis.
6. Lex schema migrations have matching down files and passed the local cycle, but production rollback must account for data written after the forward migration; take a point-in-time recovery marker.

## 10. Required production configuration and dependencies

Never place secret values in Git or ordinary ConfigMaps. The chart/secret manager must supply the relevant entries.

### Core required values

- `ENVIRONMENT` / `LEX_ENVIRONMENT` set to the protected target profile.
- `LEX_DB_URL` and `PLATFORM_CORE_DB_URL`; pool settings sized for replica count.
- `LEX_REDIS_ADDR`, `LEX_REDIS_PASSWORD`, `LEX_REDIS_DB`.
- `LEX_KAFKA_BROKERS`, topic and consumer group settings.
- `LEX_JWT_PUBLIC_KEY_PATH` (or the platform's equivalent mounted verification key).
- `LEX_CONTRACT_FIELD_ENCRYPTION_MODE` plus `LEX_CONTRACT_FIELD_ENCRYPTION_KEY` for software mode or `LEX_CONTRACT_FIELD_ENCRYPTION_KEY_FILE` for external/KMS mode.
- `LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_PEM` or `LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_FILE`; revocation settings when enabled.
- Frontend `GATEWAY_INTERNAL_URL` at build/runtime and the intended `NEXT_PUBLIC_API_URL` for the browser deployment model.

### Feature-conditional values

- Signature provider mode, endpoint, API key and timeout.
- Obligation/SLA/Lex notification provider mode, endpoint, API key and timeout.
- `LEX_FILE_SERVICE_URL`, `LEX_REFERENCE_LIBRARY_TENANT_ID` or mounted `LEX_REFERENCE_LIBRARY_DIR`.
- `LEX_AI_SERVICE_URL`, LLM enablement/token/input/timeout limits and the AI/OCR provider's own secrets.
- SSO success redirect, IdP certificates/client secrets, SCIM credentials and approved origins.
- SMTP/SendGrid, calendar, Najiz, Nafath, object-storage and webhook signing credentials.
- Monitor intervals, cache TTL, rate limit, jurisdiction, migration path and deliberate seed settings. `LEX_SEED_DEMO_DATA` must be off for normal production startup.

External dependencies are PostgreSQL, Redis, Kafka/Redpanda-compatible brokers, file/object and reference storage, the gateway/IAM/entitlement services, workflow/audit/notification services, the AI/OCR runtime, and every enabled identity, court, signature, mail/calendar or webhook provider.

## 11. Remaining risks and exact manual verification

| Severity | Risk / impact | Owner | Required closure evidence |
|---|---|---|---|
| High release gate | A provider could reject real certificates, callback URLs, payloads or network egress despite deterministic tests | Integration/release owner | Credentialed staging journeys for Nafath/Najiz, e-sign, SSO/SCIM, mail/calendar, object storage and OCR/LLM; preserve provider IDs and callback audit records |
| High release gate | Backup/restore, DR and production-scale behavior depend on the target topology | SRE/DBA | Timed backup restore, failover/DR exercise, RPO/RTO evidence and representative load test with alert thresholds |
| Medium | Low aggregate statement coverage leaves broad startup, handler, repository and UI surfaces protected mainly by compile/build checks | Engineering leads | Keep the 30.0%/31.0% ratchets fail-closed, prioritize risk-based tests and raise both floors monotonically |
| Medium | Public contract documentation covers a governed subset and the checked files retain 174 documentation warnings | API governance | Approve the public/internal boundary, close documentation warnings and add handler/spec drift automation |
| Medium | Browser E2E cannot prove ingress/TLS/cookie/WebSocket behavior without a deployed stack | QA/release owner | Run Playwright smoke, role journeys and accessibility suite against the release-candidate staging URL |
| Medium | Several Lex routes exceed 600 kB first-load JavaScript and no enforced route budget exists | Frontend/performance owner | Capture target-device Web Vitals, split heavy editor/compliance dependencies and add route-level bundle budgets |
| Low | ESLint warning debt can conceal future maintainability problems | Frontend owner | Ratcheted warning baseline and scheduled cleanup |

## 12. Safe deployment checklist and rollback plan

### Ordered deployment

1. Freeze the release commit; run CI from a clean checkout and archive test, coverage, image digest, SBOM and vulnerability artifacts.
2. Review this report's conditions; obtain API/security/DBA/SRE sign-off and confirm no critical/high finding is open.
3. Back up platform-core and Lex databases; record PITR positions and prove the backup is readable.
4. Provision secret-manager entries and certificates; validate expiry, DNS, TLS, callback allowlists and outbound network policies without logging values.
5. Render and policy-scan the exact Helm production values. Confirm admin ports are not exposed publicly and seed-demo mode is disabled.
6. Apply platform-core and Lex migrations once. Verify migration status, role-grant counts and schema checks before application rollout.
7. Deploy gateway/IAM/onboarding and Lex-compatible service versions using immutable image digests; then notification/workflow/file/AI dependencies and the frontend.
8. Wait for readiness. Check logs/metrics/traces, DB pools, Redis, Kafka consumer lag, outbox and DLQ before admitting traffic.
9. Run smoke tests for both API aliases, login/session refresh, every production persona, tenant isolation, request/case/contract/document/matter/signature workflows, exports, notifications and external callbacks.
10. Run the credentialed provider matrix, Playwright E2E/accessibility suite and a bounded load test. Verify audit records and absence of sensitive log data.
11. Increase traffic gradually with error-rate, latency, saturation, Kafka lag, DLQ, signature/provider and authorization-denial alerts watched by an assigned owner.
12. Close the release only after a monitoring soak and evidence archive.

### Rollback

1. Stop traffic progression and disable background writers/provider callbacks if data compatibility is at risk.
2. Roll frontend and services back together to the previous immutable digests; do not leave gateway/RBAC and Lex on incompatible versions.
3. Prefer a forward code correction while retaining forward database migrations when schemas are backward-compatible.
4. If database rollback is unavoidable, quiesce writers, preserve a forensic backup, assess post-migration data, execute the tested down migration under DBA control and validate role/schema state.
5. Restoring `000028` reintroduces broad tenant-admin legal authority; compensate by disabling affected admin accounts or applying an emergency explicit-grant patch until the secure version is restored.
6. Re-run readiness and core journey smoke tests, reconcile Kafka/outbox/DLQ/provider callbacks, and document the incident before reopening traffic.
