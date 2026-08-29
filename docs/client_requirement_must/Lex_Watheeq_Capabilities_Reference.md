# Lex / Watheeq Capabilities Reference

Generated: 2026-07-01

- Word document: `docs/client_requirement_must/Lex_Watheeq_Capabilities_Reference.docx`
- Code-verified capability entries: **222**
- API endpoint rows: **1204**
- Data model rows: **144**
- RBAC roles: **14** plus **6** SoD/RBAC controls
- Integration rows: **10**
- Gap/spec-only rows: **68**

## Status Breakdown

- Implemented: 199
- Partial: 17
- Seeded-Demo: 3
- Gov-gated: 3

## Module Breakdown

- Contracts: 38
- Cases & Investigations: 20
- Reporting & KPIs: 19
- Cases — Plaintiff: 15
- Notifications: 9
- Service Requests: 8
- Execution Rules: 8
- General / Technical: 8
- Cases — Defendant: 7
- Investigations: 7
- Legal Consultations: 7
- Attachments: 6
- Case Timelines: 5
- Settlements / ADR: 5
- Security & NFR: 5
- SLA Management: 4
- Escalation: 4
- Users & Permissions: 4
- Review & Risk: 4
- Workflow: 4
- Request Intake: 3
- Case Classification: 3
- Non-Functional — Security: 3
- Non-Functional — Usability: 3
- Obligations: 3
- Working Calendar: 2
- Workflow & Approvals: 2
- Non-Functional — Performance: 2
- Matters: 2
- Clause & Reg: 2
- Collaboration: 2
- Signature: 2
- Repository: 2
- Quality / NFR: 1
- AI Drafting: 1
- Analytics: 1
- Integrations: 1

## Gap Breakdown

- RTM row lacks direct code marker in scoped scan: 55
- Implemented but not fully production-proven: 6
- UX/localization proof gap: 4
- No scoped Lex code found: 3

## Notable Code-vs-Register Discrepancies

- The older docs/ClarioWatheeq/Lex_Coverage_GapAnalysis.md is stale for many modules. Code now contains service desk, legal cases, litigation, investigations, consultations, settlements, reporting, notifications, integration platform, RBAC/SoD and frontend pages it previously marked missing.
- The request mentions docs/client_requirement_must/Legal System Capabilities.xlsx. In this workspace the source register exists at docs/ClarioWatheeq/Legal System Capabilities.xlsx; the generated inventory workbook lives under docs/client_requirement_must.
- Several integration capabilities are implemented as configurable connectors but are honestly gov-gated or deployment-gated: Najiz/Takamul, Nafath, emdha/e-sign certification, production mailbox deliverability and production archive/WORM evidence.
- Backup, data recovery and business continuity are named in the register but no Lex-specific scoped application implementation was found; these should be evidenced by platform operations/infra controls rather than sold as app modules.
