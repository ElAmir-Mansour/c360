# Lex (Watheeq) Integration Platform — Research-Grounded Design

**Goal:** take every integration-table row from "planned stub" to a mature, honestly-graded end-to-end state via a unified **connector framework** + an **admin/integrations console** + production connectors.
**Basis:** 6 web-research agents (Nafath, Najiz, HR/identity, e-archiving, SSO, e-sign) + lead-architect synthesis against the real codebase. Date: 2026-06-26.

## Connector framework (extend, don't replace `integration_registry_service.go`)
Today `IntegrationAdapter = Kind() + Probe()`. Grow it:
- Keep `Probe(ctx,endpoint,now) IntegrationHealth` as the base readiness signal.
- Add **optional capability interfaces** (type-asserted by the registry):
  - `ConnectionTester { TestConnection(ctx,endpoint) (TestResult,error) }` — non-mutating auth/reachability probe; returns reachable + sanitized detail + sample-count; **never logs secrets**.
  - `Syncer { Sync(ctx,endpoint,mode) (SyncReport,error) }` — pull connectors (HR, najiz-read, archiving-reconcile); mode full|delta.
  - `Invoker { Invoke(ctx,endpoint,op,payload) (InvokeResult,error) }` — action connectors (najiz add-rep, e-archive write, esign dispatch).
- **Config + secrets:** reuse the proven `IntegrationEndpoint.Config → FieldCrypto AES-256-GCM enc:v1: → config_encrypted` custody. Adapters resolve plaintext config via the **repo directly** (the `najiz_court_adapter.go` pattern), never via the redacting service.
- **Per-kind `ConfigSchema` (`[]FieldSpec`: key, label{ar,en}, type, secret, required, enum, default, help)** = single source of truth for validation + UI rendering + **schema-aware redaction** (non-secret echoes value; secret → `__redacted__` sentinel; merge-on-update keeps ciphertext when the sentinel returns).

## Connectors (8) — maturity is honest
| Connector | Kind | Self-serve now? | Ships as |
|---|---|---|---|
| **Generic OIDC/SAML SSO** | sso | ✅ (Entra/Okta/Keycloak) | Production — **implement SAML XML-DSig** (`iam/federation/saml.go` is `ErrNotImplemented`); **fix `idp_repo.go` plaintext `client_secret`** (encrypt + redact) |
| **HR / identity (SCIM/HRIS/CSV-SFTP/LDAP)** | hr | ✅ Tier-1 | Production — pull + inbound SCIM server; reconcile to OrgEntity/UpsertRole. Tier-2 (GOSI/Qiwa/Muqeem) stays `planned` |
| **e-Archiving (CMIS / S3 object-lock / SharePoint)** | archiving | ✅ | Production — WORM + legal-hold + `in_kingdom_only` (PDPL) fail-closed; reuse `internal/dr/worm` |
| **e-Signature (DocuSign/Adobe/native + nafath/najiz/emdha)** | esign | ✅ for DocuSign/Adobe | Per-provider records replace the env-gated block; emdha-TSP + Najiz gov-gated |
| **Email (inbound intake + outbound)** | email | ✅ | Unify existing intake webhook + outbound dispatcher under the registry |
| **Internal generic REST/webhook** | internal | ✅ | Production catch-all (HMAC-signed) |
| **Najiz court portal (MoJ Takamul)** | najiz | ❌ gov-gated | Configurable adapter + sandbox/mock; read-only hearing/case sync first; writes gated `pending_nafath`; `status=planned` until Takamul onboarding |
| **Nafath identity-confirmation (e-sign basis)** | nafath_verify | ❌ gov-gated | Configurable + UAT mock; request/status/details + webhook. **Nafath is NOT a CA** → pair with a TSP (emdha) for legally-binding signing; keep `identity_confirmed` vs `signed` distinct |

## Admin console — NEW `frontend/src/app/(dashboard)/lex/admin/integrations/`
Mirror the org-entities admin module + graceful-degradation pattern.
- **List** — grouped-by-kind cards: status badge (planned/active/disabled/error), health-grade dot, last-checked, Test quick-action; KPI strip per grade.
- **Detail/New** — **`DynamicConnectorForm` driven by `GET /integrations/schema/{kind}`** (rendered, not hand-coded); secret fields write-only (`•••••• (set)` + Replace); right-rail Connection panel (env badge, **Test Connection**, Health, Enable/Disable, **Sync Now** full|delta); per-kind specializations (najiz onboarding banner, nafath number-match, sso discovery/SAML-metadata/SCIM-token, archiving WORM+in-kingdom, esign sub-tabs).
- **Logs** — sync-runs ledger + test timeline + audit + reconciliation-gaps.

## New API surface
`POST /integrations/{id}/test` · `POST /integrations/{id}/sync?mode=` · `GET /integrations/{id}/sync-runs` · `GET /integrations/schema/{kind}` · `POST/GET /scim/v2/Users|Groups|ServiceProviderConfig` (per-tenant bearer) · `POST /integrations/{id}/scim-token` · `POST /webhooks/lex/nafath/verify` · extend `/webhooks/lex/esign/{provider}` (DocuSign/Adobe). New RBAC: `lex:integration:read`, `lex:integration:manage`.

## Migrations (verify next free number at implement time)
`lex_integration_sync_runs` · `lex_hr_identity_map` · `lex_scim_tokens` · `lex:integration:*` RBAC seed · **`platform_core` idp_connections.client_secret encrypt-in-place + SAML fields** (closes the NCA/PDPL plaintext gap).

## Implementation phases
1. **Backend framework** (subpackage `service/integration/`: framework/schema/oauth/breaker/sync_ledger; registry extension; sync_runs migration + RBAC; handler+routes; unit tests).
2. **8 connectors** (parallel, one file each, `RegisterAdapter`; + SAML impl + idp secret fix + HR/SCIM migrations).
3. **Console UI** (lib client + list/dynamic-form/detail/logs).
4. **Wiring + sandbox + hardening** (sync scheduler, webhook routes, sandbox/mock transports for gov-gated, SCIM token issue, E2E + redaction regression guard).

## Open decisions (CTO)
- **Gov onboarding vs sandbox:** Najiz/Nafath/emdha/Tier-2-HR ship as configurable adapters + UAT/mock, `status=planned` until a tenant onboards — do NOT block delivery on gov access.
- **Najiz/Nafath endpoint contracts unconfirmed** (access-gated) → keep base_url/token_url/paths fully configurable; don't hardcode.
- **SAML library** choice (crewjam/saml or russellhaering/gosaml2) — lock before advertising SAML production-ready.
- **Nafath e-sign legal model** = nafath_verify (identity) + emdha-TSP (signature); confirm with KSA counsel re: E-Transactions Law.
- **IdP secret migration** = encrypt-in-place + backfill, no token-exchange downtime (JWT-key-mismatch class risk).
- **LoA/acr enforcement** for signing/DoA — recommend hard minimum (app-push number-match), configurable upward.
- **SCIM server scope** — Phase 1 pull-only vs inbound-push (attack surface).
- **Framework placement** — build lex-local with a clean port boundary; defer core-service extraction to ADR D-8 (Saleh).
