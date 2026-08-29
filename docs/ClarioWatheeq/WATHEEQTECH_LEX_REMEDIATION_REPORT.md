# WatheeqTech / LEX remediation report

Date: 2026-07-16  
Outcome: repository blockers found by the baseline were corrected and re-tested. No production deployment was performed.

## 1. Remediation principles

- Preserve existing architecture and user changes.
- Remove fake success paths instead of documenting them as features.
- Keep provider sandbox behavior explicit; never silently substitute it for live success.
- Make gates reflect their declared scope while still failing on phantom routes and missing required operations.
- Add focused regression tests for changed behavior, then run broader verification.

## 2. Implemented changes

### Database migrator

Files: `backend/cmd/migrator/main.go`, `backend/cmd/migrator/main_test.go`

- Removed the unsupported `-seed` flag and its misleading “database seeded successfully” message.
- Added early `up`/`down` direction validation.
- Added an allowlisted, trimmed and de-duplicated database selection parser.
- Unknown names and empty comma-separated selections now fail before configuration/database work.
- Migration root discovery now returns an error instead of a fictional fallback path.
- A missing selected database directory is a migration failure, not a warning/skip.
- Added tests for direction validation, all/default selection, trimming, deduplication, unknown/empty names and migration directory discovery.

Operational change: migration and demo/system data seeding are separate commands. Production must not pass `-seed`; development seed data is handled by the explicit `system-seeder` and remains disabled in production Helm values.

### Frontend type safety and localization

Files include:

- `frontend/src/app/(dashboard)/lex/consultations/page.tsx`
- `frontend/src/app/(dashboard)/lex/admin/org-entities/_components/org-structure-import-dialog.tsx`
- `frontend/src/app/(dashboard)/lex/admin/org-entities/_components/org-import-labels.ts`
- `frontend/src/app/(dashboard)/settings/settings-client.tsx`
- `frontend/src/app/(dashboard)/settings/page.tsx`
- `frontend/src/app/(dashboard)/settings/_lib/settings-i18n.ts`

Changes:

- Removed the consultation board’s `unknown`/`React.ComponentType` escape hatch.
- Typed board advancement with the shared `ConsultationStatus` union and used the real board component directly.
- Localized the complete organization-structure import flow in English and Arabic, including modes, warnings, validation summaries, status/history and actions.
- Moved the settings Suspense fallback into a locale-aware client component and added its accessible label to the settings catalog.
- Replaced one remaining hardcoded file-size placeholder with the existing attachment label layer.
- Re-ran and locked the i18n baseline: Lex is at 329 hardcoded scanner detections and 95.9% translated signal coverage; global translated signal coverage is 90.0%.

### Design-system regression

Files include the Clario360 marketing CSS and home/suite/resources/contact components.

- Replaced newly added raw `#fff` uses with `--card`/`--text-inv`.
- Added semantic muted third-party-tool tokens for the sprawl illustration.
- Removed the related lint suppression.
- Inline hex style detections fell from the failing baseline observation of 38 to 9; the improved ratchet baseline is committed in the worktree.

### API and contract validation

Files: `scripts/check-api-contracts.sh`, `docs/api/clario-dr-service.openapi.yaml`

- `x-gateway-contract` now validates required keys while permitting documented extension metadata such as regulated posture.
- DR integration CRUD/test and sealed rehearsal-proof routes were added to the API contract with permission metadata and credential-redacting schemas.
- Lex route discovery now includes permission-specific Chi router variables.
- The phase-1 boundary is measured as 122 declared of 624 registered operations; undeclared internal routes are reported instead of making a phase-1 gate logically impossible.
- Declared routes with no implementation still fail.
- Ten required drafting operations must still be both registered and declared.
- Frontend semantic anchors tolerate quote, whitespace, trailing-comma and semicolon changes introduced by formatting, without reducing the required anchor set.
- Stale permission-router, overview-component and DR integrations-resolver wiring anchors were updated.

### Compose hygiene

Files: `docker-compose.yml`, `docker-compose.test.yml`

- Removed obsolete top-level Compose version declarations.
- Revalidated default, test and production overlays; the production overlay still fails closed if required secrets are absent.

## 3. Verification after changes

| Verification | Result |
|---|---|
| Migrator focused tests | Passed |
| Migrator integration-tag suite | Passed in 24.912s |
| Lex integration suite with `-race` | Passed in 52.689s |
| AI second-brain pytest | 79 passed, 2 skipped |
| Frontend type-check | Passed |
| i18n gate and Lex-specific i18n gate | Passed; 856 Lex files scanned by the Lex-specific gate |
| Design-system ratchet | Passed; all four measures below the former baseline |
| API/event contract checker | Passed; prints phase-1 122/624 measurement |
| OpenAPI structural validation | Passed; documentation warnings remain |
| Helm lint/template | Passed |
| Compose default/test/production config | Passed with validation-only secret inputs |
| npm dependency audit | 0 vulnerabilities |

The complete final command transcript and distinction between current and inherited evidence are recorded in `WATHEEQTECH_LEX_TEST_EVIDENCE.md`.

## 4. Deliberately not changed

- No live external provider was called and no production environment was mutated.
- No demo seed was enabled in production.
- No fake mock-success fallback was added.
- The 502 operations outside the phase-1 public contract were not bulk-described with invented schemas.
- The repository-wide 592-file Go formatting backlog was not mechanically rewritten because that would create unrelated risk and obscure the audited fixes.
- No customer RTO/RPO, capacity or regulatory certification result is claimed without an executed environment-specific test.

## 5. Residual conditions

See `WATHEEQTECH_LEX_OPEN_ISSUES.md`. The release remains **CONDITIONALLY READY**, subject to live provider certification, production-like deployed E2E, backup/restore/DR and load/soak evidence.
