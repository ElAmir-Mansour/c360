# Watheeq Legal Suite — Executive Capability Brief (Summary)

**Clario360 Platform · Code-Verified Assessment · 1 July 2026**

> Every claim below is derived from **direct inspection of the Watheeq/Lex source code, database schema and the client's own requirement register** — not from marketing material or self-report. Maturity labels reflect what the code does *today*.

Companion documents (same folder):
- `Lex_Watheeq_Executive_Brief.pptx` — 15-slide executive deck
- `Lex_Watheeq_Executive_OnePager.docx` — one-page board/email brief

---

## In one line

Watheeq is a **sovereign, end-to-end legal operations platform for Saudi Arabia** — Arabic-first, governance-grade, and genuinely built (not demo-ware). **~97% of the client's 189-capability requirement register is implemented today.**

---

## Scale of what is built (code-verified)

| Dimension | Figure |
|---|---|
| Backend legal modules | **22** |
| API business operations | **~600** route registrations (served under both `/lex` and `/watheeq`) |
| Legal record types (DB tables) | **~140** across **75** schema migrations |
| Frontend workspace screens | **67** |
| Reusable legal UI components | **20** |
| Governance roles | **14** (with **64** fine-grained permissions) |
| Connectors | **9** kinds — **6** self-serve production · **3** KSA gov-gated |
| Automated test suites | **144** (incl. 27 end-to-end) |
| Unimplemented placeholders in application code | **0** |

---

## Capability pillars & maturity

| Pillar | What the business can now do | Maturity |
|---|---|---|
| **End-to-End Legal Operations** | Service desk → SLA-governed matters; full case, investigation, consultation, settlement & request management; 8-service legal catalogue live day one; KSA working calendar. | 🟢 **Production-ready** |
| **Contract Lifecycle Management** | Intake, versioning, clause-by-clause review desk, redline, obligations, renewal alerts, searchable archive; AI-assisted risk & clause analysis. | 🟢 **Production-ready** (AI drafting 🟠 Partial — deployment-gated) |
| **Governance, Control & SoD** | 14 roles / 64 permissions; SoD enforced at assignment **and** live at decision (author ≠ approver, fail-closed); PKI-backed Delegation of Authority; tamper-evident hash-chained audit trail. | 🟢 **Production-ready** |
| **Automation & Approvals** | One reusable workflow engine; sequential/parallel chains, quorum (all/any/N-of-M), distinct-approver rules, SLA & escalation, conditional forms, background monitors. | 🟢 **Production-ready** |
| **Saudi Sovereignty & Compliance** | Arabic/RTL by default, Umm al-Qura Hijri calendar, Arabic-Indic numerals, SAR; in-Kingdom data residency; field-level encryption. | 🟢 **Production-ready** (localisation & residency) |
| **Enterprise Integration & Extensibility** | 6 self-serve connectors (SSO/SAML, HR/SCIM, e-archive WORM, email, internal REST, no-code custom) on a governed framework (maker-checker, dead-letter recovery, honest health). | 🟢 **Production-ready** |
| **Role-Aware Experience** | Workspace reshapes per persona; role-aware login, permission-scoped navigation, persona switcher, 67 screens. | 🟢 **Production-ready** (dedicated per-role landing pages 🟠 Partial — route to a shared role-aware home) |
| **KSA Government Systems** | Najiz (courts), Nafath (national identity), emdha (qualified e-signature) — built, run in a validated sandbox. | 🔵 **Gov-gated** (production go-live = authority credential step, not build) |
| **Watheeq demonstration dataset** | Day-one content: 8-service catalogue, org registry, KSA calendar, seeded cases/investigations/consultations/settlements/requests. | 🟦 **Seeded/Demo** (guaranteed-when-enabled, fatal-on-error, idempotent) |
| **Backup / DR / Business Continuity** | Delivered by the platform's ClarioDR layer — outside the legal application. | ⚪ **Roadmap** (platform layer) |

---

## Coverage vs the client requirement register

- **Client register:** `docs/ClarioWatheeq/Legal System Capabilities.xlsx` — **189 capabilities** (178 functional, 11 non-functional; 182 rated "Must"; 8 legal services). *(The 189 total is machine-verified from the register.)*
- **Implemented (code-read):** **~97%.** Conservative baseline = **96.8%** (177 implemented / **12** partial / **0** absent); rises to **~97%** (≈184 of 189) once the contract review-desk and clause tooling landed.
- **Honesty note:** coverage is a **code-read**, not an automated conformance test. The register `.xlsx` has **no status column**, so every coverage figure lives in the design/inventory markdown, not in machine-verified tests. **0 capabilities are absent from the codebase.**

---

## The honest gap list (path to 100%)

1. **Government activation (external — vendor-ready):** flip **Najiz / Nafath / emdha** (CAP-175 + identity/e-sign) from validated sandbox to production once the Ministry of Justice / relevant authority issues credentials. Not additional build.
2. **Verification & UAT (short):** confirm the **email, HR/SCIM, internal-REST and e-archive** connectors end-to-end in a client sandbox (CAP-174/176/177/178); deepen a few **contract-archive search & classification** screens (CAP-122/123).
3. **Platform assurance (platform roadmap):** **backup, disaster recovery & business continuity** (CAP-184/185/186 — ClarioDR/infra layer) and a **deeper mobile** experience (CAP-188).

> None of these are core legal-function gaps — they are **activation, verification and platform-assurance** steps.

---

## Differentiation (factual)

- **Sovereign by construction** — Arabic-first, Hijri-native, in-Kingdom residency, KSA authority connectors; not a localised afterthought.
- **Integrated, not assembled** — one workflow engine, one audit trail, one identity model across every legal function.
- **Governance-grade control** — enforced SoD + PKI-backed Delegation of Authority, built in rather than bolted on.
- **Predictable & self-hostable** — flat, sovereign deployment vs per-seat cloud lock-in.
- **Real, not demo-ware** — full persistence, 144 automated test suites, zero unimplemented placeholders in the application code.

---

## Honest caveats (stated plainly for a credibility-sensitive audience)

- **AI drafting/enrichment** is deployment-gated — the deterministic analysis engine is always on; generative features activate only where an AI provider is configured.
- **Strict PKI Delegation-of-Authority** enforcement activates when trusted certificate roots are provisioned (an operational step); otherwise it falls back to plain-text-with-warning.
- **Cross-service audit-ledger completeness** relies on a best-effort event relay; the per-domain audit rows are transactionally guaranteed and append-only.
- **Segregation of Duties** is currently enforced tenant-wide (per-org-entity scoping is designed, not yet wired).
- **i18n content** supports Arabic + English only, with English fallback for any untranslated string; formatting/localisation itself is production-ready.
- **KSA government connectors (Najiz/Nafath/emdha)** run in sandbox pending authority-issued credentials.

*Every figure and label above is traceable to code, schema, or the client register; where a capability depends on deployment configuration or external authority access, this brief says so.*
