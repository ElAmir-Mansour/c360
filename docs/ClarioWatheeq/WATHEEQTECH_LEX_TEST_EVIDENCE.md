# WatheeqTech / LEX test evidence

Evidence date: 2026-07-16  
Working branch: `watheeqTech`  
Baseline revision: `8c7b3ba9`; current remediation commit `448eef62` plus the documented remaining worktree.

## 1. Evidence policy

`Passed` means the command was executed in this workspace and returned zero during this audit unless explicitly marked as inherited prior evidence. Discovery/listing is not reported as test execution. Missing local tools are not reported as passed.

Host toolchain observed: Go 1.25.12, Node.js 25.2.1, npm 11.6.2, Docker 29.4, Docker Compose 5.1, Helm and kubectl. The Docker daemon was available.

## 2. Pre-remediation baseline

| Command / check | Result | Notes |
|---|---|---|
| `git status --short` | Passed / clean | Baseline established before changes |
| `GOWORK=off go test -short ./...` from `backend` | Passed | Repository-wide short backend suite |
| `go build ./cmd/...` from `backend` | Passed | All command packages built |
| `GOWORK=off go vet ./...` | Passed | No vet finding |
| `npm run lint && npm run type-check && npm run build` | Passed | 0 lint errors, 1,076 warnings; Next 15.5.18 compiled and emitted 291 routes |
| `npm test -- --run` | Passed | Serial integration/unit/source wrapper; expected jsdom navigation noise was non-failing |
| `npm audit --audit-level=high` | Passed | 0 vulnerabilities |
| `make validate-api` | Passed with warnings | Four OpenAPI documents valid; 174 documentation-quality warnings in the baseline run |
| `make helm-lint && make helm-template` | Passed | Chart lint/render succeeded |
| Default/test Compose `config -q` | Passed | Baseline emitted obsolete-version warnings |
| Production Compose `config -q` without required inputs | Failed as designed | Required secret interpolation is fail-closed |
| Production Compose with validation-only inputs | Passed | Configuration only; no service started |
| `./scripts/check-api-contracts.sh` | Failed | First exposed extension-metadata equality, then DR/LEX/stale-anchor drift |
| `npm run lint:ds` | Failed | Inline hex style count 38 vs baseline 24 |
| `PLAYWRIGHT_SKIP_WEB_SERVER=1 npx playwright test --list` | Passed discovery | 431 tests in 46 files; target browser tests were not executed |
| `gofmt -l backend` | Inventory result | 592 historical files; not a pass |

## 3. Post-remediation verification

| Command / check | Result | Evidence |
|---|---|---|
| `go test ./cmd/migrator` | Passed | New direction/database/path regression tests |
| `GOWORK=off go test -count=1 -tags=integration ./cmd/migrator` | Passed | 24.912s; testcontainer-backed migration integration |
| `GOWORK=off go test -race -count=1 -tags=integration ./internal/lex/integration` | Passed | 52.689s; fresh Lex migrations, real HTTP/service/repository flows and race detector |
| `GOWORK=off go test -short ./...` | Passed | Final post-remediation backend-wide short suite |
| `python3 -m pytest` in `ai/second-brain` | Passed | 79 passed, 2 skipped in 1.94s |
| `npm run type-check` | Passed | Includes typed consultation board and locale-aware settings/import changes |
| `npm run i18n:gate` | Passed | Lex 329 hardcoded detections, 95.9% translated signal coverage; global 90.0% |
| `npm run i18n:lex` | Passed | 856 Lex files; no raw-token display leak or untranslated `ar:` label finding |
| `npm run lint:ds` | Passed | hex classes 15; px-font 343; inline-hex styles 9; physical-direction classes 133 |
| `./scripts/check-api-contracts.sh` | Passed | Phase-1 boundary reports 122 of 624 operations; declared/source/anchor checks pass |
| `make validate-api` | Passed with warnings | Structural validity retained after DR route/schema additions |
| Compose default/test/production config | Passed | Obsolete version warning removed; required production values remain fail-closed |
| `npm audit --audit-level=high` | Passed | 0 vulnerabilities |
| `npm run lint` (final chain) | Passed | 0 errors, 1,061 warnings |
| Focused `npx vitest run 'src/lib/i18n/__tests__/termbase.test.ts'` | Passed | The first full wrapper exposed one net-new Arabic glossary violation; the label was corrected and all 7 glossary tests passed |
| Final `npm test -- --run` | Passed | Clean rerun of the serial integration/unit/source wrapper exited 0; expected jsdom navigation noise remained non-failing |
| Resource-contended `npm run build` attempt | Failed | The OS sent `SIGKILL` while this attempt overlapped the long frontend test run; it was not accepted as build evidence |
| Final isolated `npm run build` | Passed | Next 15.5.18 compiled in 103s, generated 291/291 static pages, emitted the route report and exited 0 |
| `git diff --check` | Passed | Final handoff check found no whitespace error in the tracked diff |

## 4. Migration evidence

- The current Lex race integration harness creates a fresh PostgreSQL database and applies `backend/migrations/lex_db` before tests.
- The migrator integration-tag suite passed after fail-closed input/path changes.
- The immediately preceding same-date repository audit recorded a live Lex migration cycle and platform-core up/down/up. This is retained as inherited evidence, not relabeled as a current command.
- All 85 Lex up files had matching down files at inventory time.
- No production database was mutated by this audit.

## 5. Coverage evidence

The immediately preceding same-date full coverage run recorded:

- frontend: 367 files, 2,605 tests, 31.13% statements, 25.82% branches, 28.50% functions and 31.99% lines;
- backend: 29.2% aggregate statement coverage; the CI `internal` scope measured 30.0%.

Those values are honest measured baselines, not ideal targets. The current work re-ran the functional suites but did not recompute a new combined coverage profile. CI no-regression floors must remain evidence-based and move upward as risk-based tests are added.

## 6. Expected/non-failing noise

The frontend serial suite prints jsdom `Not implemented: navigation (except hash changes)` during tests that assert full-page redirects/link behavior, and one intercepted XHR `EINVAL` message was observed while its test batch still passed. These are tracked as harness-quality debt because they can obscure future errors; they did not change exit status or assertion results.

## 7. Not executed locally

- Live signature/court/identity/mail/calendar/webhook/OCR/LLM provider acceptance.
- The 431 Playwright scenarios against a deployed target.
- Customer-sized load/soak and browser Core Web Vitals measurement.
- Target backup restore, PITR, cross-database/object reconciliation and DR/failover exercise.
- Current `golangci-lint`, `gosec`, `gitleaks`, `trivy`, `govulncheck` or k6 run because those tools were not installed locally.

CI and release engineering must attach these exact-candidate reports before unconditional promotion.
