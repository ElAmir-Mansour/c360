# Lex / Watheeq Legal Suite — Capability Inventory (Summary)

**Workbook:** [`Lex_Watheeq_Capabilities_Inventory.xlsx`](./Lex_Watheeq_Capabilities_Inventory.xlsx)
**Generated:** 2026-07-01 · **Method:** read-only code inventory of `backend/internal/lex` (70 handlers, ~130 services), 77 `lex_db` migrations, 5 `platform_core` touchpoints, and 68 Next.js frontend routes. Every capability is traceable to a route, handler, migration, or UI file — nothing is copied from a spec without confirming the code exists.

> **Path note:** the task requested `docs/client_requirement_must/`, which does not exist in the repo. The referenced register actually lives at **`docs/ClarioWatheeq/Legal System Capabilities.xlsx`** (189 caps). This deliverable was written to the requested `docs/client_requirement_must/` path; the companion Watheeq docs and register are under `docs/ClarioWatheeq/`.

## Headline numbers

| Metric | Count |
|---|---|
| Distinct capabilities inventoried (Capabilities sheet) | **124** (mapping the 189 register CAPs + **18** LEX-NEW capabilities beyond the register) |
| Al Othaim BRD register capabilities cross-checked (CAP Register Checklist sheet) | **189** — code-verified: **184 Implemented, 1 Gov-gated sandbox, 4 Partial (platform-level), 0 Absent** |
| HTTP route registrations (API Endpoints sheet) | **623** (→ **1,210** endpoint paths across the `/api/v1/lex` + `/api/v1/watheeq` twin prefixes); **36** are public/pre-auth or service-token |
| Data-model tables (Data Model sheet) | **141** `lex_db` tables across 77 migrations + **5** `platform_core` touchpoints |
| RBAC (RBAC & SoD sheet) | **14** named legal roles · **63** `lex:*` permission slugs · **8** SoD/DoA constraint families · **8** approval-policy-engine capabilities |
| Integrations (Integrations sheet) | **11** connectors · **14** framework capabilities · **14** process env vars |
| Frontend (Frontend Routes sheet) | **67** lex routes · ~18 shared components · 5 KSA localization modules · persona/role-aware UX |
| Seeded/demo content (Seeded Content sheet) | **17** seeded item groups (8-service catalog, org registry, KSA calendar, 5 cases, 3 investigations, ≥4 consultations, 3 settlements, ≥5 requests, 14-role RBAC, …) |
| Spec-only / partial gaps (Spec-only & Gaps sheet) | **16** rows (12 register-Partial contract/integration caps + 4 platform-level NFRs) |

## Workbook sheets

1. **Overview** — one row per functional module (38 modules) with description, capability count, backend/frontend coverage.
2. **Capabilities** — the core sheet, 124 rows, 14 columns (ID, module, name, description, layer, API, backend source, frontend, tables, permission, depends-on, status, evidence, notes). Status colour-coded.
3. **API Endpoints** — all 623 route registrations with method, path, resolved permission tier, handler, module, and `routes.go` line.
4. **Data Model** — 141 tables (purpose, key columns, source migration, module, notes) + platform_core touchpoints + RLS/encryption/WORM note.
5. **RBAC & SoD** — the 14 roles, 63 permission slugs, SoD/DoA constraints, and the approval-policy engine.
6. **Integrations** — 11 connectors (with maturity colour-coding), the connector framework, and env vars.
7. **Frontend Routes** — 67 routes with actions + backend calls, shared components, KSA layer, persona UX.
8. **Spec-only & Gaps** — capabilities the register/RTM flag Partial, or that are platform-level, with code reality and what's missing.
9. **Seeded Content** — the seeded Legal-Affairs demo data, clearly labelled.
10. **CAP Register Checklist** — all 189 Al Othaim CAP-IDs with code-verified status and which inventory row covers each (1:1 checklist; **0 uncovered**).

## Breakdown by module (Capabilities sheet)

| Module | # caps | Module | # caps |
|---|---|---|---|
| Contracts / CLM & Review Desk | 19 | Reporting & KPIs | 5 |
| Case Management | 7 | Users & Permissions (RBAC) | 4 |
| Litigation (Plaintiff) | 7 | SLA Management | 4 |
| Execution Rules | 7 | Escalation | 4 |
| Integrations | 7 | Service Requests | 6 |
| Attachments / Documents | 6 | Document Editor / Redline | 3 |
| NFR (Security/Perf/Reliability/Usability) | 11 | AI Drafting · Playbooks · Approvals/DoA | 6 |
| Working Calendar · General/Technical | 6 | Notifications · Workflow · Service Catalog | 6 |
| Litigation-Defendant · Classification · Investigations · Timelines · Settlements · Consultations · Legal Hold · Obligations · Signatures · Matters · Compliance · Persona · Onboarding | 1 each | | |

(Single-row modules use a grouped CAP-range row, e.g. `CAP-042–051` case master-data; every individual CAP is still listed 1:1 on the CAP Register Checklist sheet.)

## Status breakdown (189 register caps, code-verified)

- **Implemented — 184** (incl. 8 also seeded with demo data, and the HR/e-archive/email/internal connectors).
- **Gov-gated sandbox — 1** (CAP-175 Najiz: connector present, reads live, writes gated until MoJ Takamul onboarding).
- **Partial — 4** (CAP-184 backups, CAP-185 recovery, CAP-186 business continuity — all platform-level ClarioDR/infra, not lex-specific code; CAP-188 mobile — responsive shell, deep editor/admin desktop-first).
- **Absent — 0.**

The 18 LEX-NEW capabilities (not in the register) are all Implemented: collaborative document editor / redline (92 routes), governed-LLM AI drafting studio (AID-01..11) + prompt library + draft review, bilingual clause/regulation libraries + playbooks + clause-deviation detection, legal hold, obligation tracking + reminders, e-signature envelopes + custody, matter management + conflict check, compliance rules engine, the approval-policy engine + DoA X.509/PKI authority evidence, role-aware persona UX (`/lex/me`), the connector-framework depth (DLQ/breaker/maker-checker/egress/observability/conflict-queue/custom-connector/rotation), Nafath identity confirmation, and Legal-Affairs starter-template provisioning.

## Notable discrepancies between code and the existing register

1. **The 12 "Partial" caps in `Legal_Capabilities_100pct_Design.md` (96.8% baseline) are backend-implemented in code.** The 7 Contract Review-Desk caps (CAP-107/109/110/111/117/122/123) each have a wired handler + migration; the 5 integration caps (CAP-174/176/177/178 + Najiz-175) have real connectors. The "Partial" label reflected UI depth / live-UAT / gov-onboarding, not missing backend. Per the trust-the-code rule this inventory marks them **Implemented** (or **Gov-gated sandbox** for Najiz) and records the register classification in the Notes column — raising the code-verified figure to **184 Implemented / 1 gov-gated / 4 partial**.

2. **Two different registers exist.** The **CAP-*** register (189, Al Othaim BRD, `docs/ClarioWatheeq/Legal System Capabilities.xlsx`) is the client spec-of-record and is what code was mapped against. A separate **WTQ-*** RTM (100-cap CLM prototype, `clario360Project/legal/Clario360 Watheeq RTM v2.xlsx`) tracks the older Business+/CLM prototype scope (39 Delivered / 40 Partial / 21 Planned) with different IDs and an older baseline — its 21 Planned items (live external gov integrations, production email/calendar reminder creds, KSA residency + deployment-encryption evidence) are the true forward-looking backlog and are captured in the Gaps sheet note.

3. **Twin suite prefixes.** Every JWT-gated lex route is registered under **both** `/api/v1/lex` and `/api/v1/watheeq` (623 registrations → 1,210 live paths). The Watheeq legal suite *is* `internal/lex`; the two prefixes are the same backend.

4. **RBAC is code-map driven, not DB-driven.** The IAM-issued JWT carries only role slugs; the granular `lex:<domain>:<verb>` permissions are resolved from Go code (`auth.RolePermissions`) and, on the frontend, hydrated by unioning `GET /api/v1/lex/me` `effective_permissions` into `hasPermission`. The DB `roles.permissions` JSONB is used only for the role-management UI/audit.

5. **The org node always reads "Abdullah Al Othaim Investment Company"** in the seeder regardless of tenant, while the contract counterparty ("party A") name varies by tenant (Apex Legal Partners LLP on the live demo box `aaaaaaaa-…01`, Clario Holdings otherwise). Seeding runs only when `LEX_SEED_DEMO_DATA=true` and is idempotent; the 14-role seed is assertion-fatal at startup.
