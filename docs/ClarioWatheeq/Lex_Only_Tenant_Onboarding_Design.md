# Lex‑Only Tenant Onboarding — Self‑Serve + Reusable Legal‑Affairs Template

> **Goal:** Let a legal organisation self‑serve onboard a **Watheeq‑only** SaaS tenant (licensed to `app.watheeq` and nothing else) and have it land **pre‑provisioned with the Legal Affairs profile** — the 8‑service catalog + SLAs, the L1/L2/L3 escalation ladder, the KSA working calendar, the 14 legal roles + org registry, and the persona‑aware UX — derived from `Legal System Capabilities.xlsx` (Abdullah Al Othaim). The same template is reused for every future Watheeq client.
>
> **Decisions (locked):** self‑serve signup (show the wizard) · reusable Legal‑Affairs template.

---

## 1. What already exists (so this is small)

- **Watheeq is a self‑serve suite.** `app.watheeq` is its entitlement key (`license/model/keys.go:31`); the wizard id `"lex"` maps to it (`catalog.go:71`); `"lex"` is in `SelfServeSuites` (`catalog.go:77`); the gateway gates `/api/v1/lex` on `app.watheeq` (`catalog.go:13`).
- **License scoping by selection.** `onboarding/service/license_client.go` assigns the shared `trial` plan (every self‑serve key + 5 seats), then **revokes the keys the customer did NOT select**. Select only Watheeq ⇒ trial scoped to `app.watheeq`. `RescopeLicense` re‑applies this on the suites step (provisioning runs at verify‑email *before* suites — re‑scope corrects it).
- **The Legal Affairs seed is already the template, tenant‑parametrized.** `lex/seed.go` (`SeedDemoDataWithOptions`, `opts.TenantID`) → `seed_legal_affairs.go::ensureOrgRegistry` seeds the org hierarchy + responsibility roles, working calendar, **8‑service catalog + working‑day SLAs**, **3‑level escalation ladder**, plus sample cases/investigations/consultations/settlements. Idempotent (no‑op once populated). It only *runs* for the demo tenant today (lex‑service startup, `LEX_SEED_TENANT`).

**Gap to close:** (a) split the seed into **CONFIG template** (always) vs **sample data** (demo only); (b) expose it as a **per‑tenant provisioning** action; (c) **trigger** it from onboarding when Watheeq is selected.

---

## 2. Design

### 2.1 The Legal‑Affairs template (config vs sample)
Refactor `seed_legal_affairs.go` into a reusable `ProvisionLegalAffairs(ctx, tenantID, opts)` where `opts.IncludeSampleData bool`:
- **CONFIG (always, for a real client):** org‑registry scaffold (Company → Shared‑Services Unit → Legal Dept → Cases/Contracts sections), the **8 services** (EN/AR, Available‑To, requester/provider approval, intake mailbox, urgent/normal SLA day‑ranges — verbatim from the xlsx *Service Catalog & SLA* sheet), **SLA targets**, the **escalation matrix** (L1 Section Supervisor +2d, L2 Dept Manager +4d, L3 Shared‑Services +6d — xlsx *Workflow & Escalation*), the **KSA working calendar**, and seeding/assertion of the **14 legal roles** ([[lex-role-matrix-v2]]).
- **SAMPLE (opt‑in, for a demo tenant):** the seeded cases/investigations/consultations/settlements/contracts so the tenant looks alive.
The xlsx becomes the canonical default `LegalAffairsProfile` data (today's hardcoded Al Othaim values move into a named default profile so future clients can override).

### 2.2 Per‑tenant provisioning entrypoint (lex‑service internal API)
Add a service‑token‑guarded internal endpoint on lex‑service (mirrors the licensing `/internal` pattern):
```
POST /internal/lex/provision    {tenant_id, include_sample_data, profile?}  → applies the template (idempotent)
```
Default `include_sample_data=false` for real onboarding; `true` only when the caller wants a populated demo.

### 2.3 Onboarding hook (the productization)
In the onboarding **provisioner**, after the tenant + license are scoped, for each selected suite run a suite post‑provision step. For `"lex"`/`app.watheeq`, call `POST /internal/lex/provision {tenant_id}` (service‑token), so a Watheeq signup lands with the Legal Affairs config template applied. Record it as a `ProvisioningStep` (visible in the onboarding status UI). Idempotent + non‑fatal (a transient lex outage doesn't fail the whole signup; a reconcile retries).

### 2.4 Self‑serve flow (end state)
1. `/register` → org "Abdullah Al Othaim — Legal".
2. Suite step → select **Watheeq only** → trial license scoped to `app.watheeq` (re‑scope revokes the rest).
3. Provisioner → `POST /internal/lex/provision` → Legal Affairs config template applied for the new tenant.
4. First admin login → persona‑aware Lex ([[lex-persona-ux]]): role badge, scoped sidebar, capabilities. Assign the org's staff to the 14 roles via the Role Assignments admin (or seed a starter admin = `legal-system-admin` + `legal-director`).
5. Tenant sees **only** Watheeq in the suite switcher (no other suite licensed).

---

## 3. Demo script (after build)
- Register `Abdullah Al Othaim — Legal`, pick **Watheeq only** → show the trial scoped to `app.watheeq`.
- Log in → Lex‑only suite switcher, the 8‑service catalog + SLAs + escalation already configured, the 14 roles present.
- Assign a few users to personas (Director / Cases Manager / Auditor) → show the role‑scoped sidebars from [[lex-persona-ux]].

---

## 4. Build plan
1. **Refactor** `seed_legal_affairs.go` → `ProvisionLegalAffairs(tenantID, {IncludeSampleData})` + a named default `LegalAffairsProfile` (the Al Othaim values from the xlsx). Keep the demo‑tenant startup seed calling it with `IncludeSampleData=true`.
2. **Internal endpoint** `POST /internal/lex/provision` (service‑token) → `ProvisionLegalAffairs`. Idempotent.
3. **Onboarding hook**: provisioner calls it for the `lex` suite; new `ProvisioningStep`.
4. **Verify** self‑serve Watheeq‑only scoping (register → app.watheeq only) + the hook applies the template; e2e on a throwaway tenant.
5. **Deploy** + onboard the Al Othaim Lex‑only tenant live.

**Acceptance:** a Watheeq‑only signup ends with `app.watheeq` as the sole entitlement, the 8‑service catalog + SLA + escalation + KSA calendar + 14 roles present for the new tenant, the suite switcher shows only Watheeq, and the persona‑UX scopes each assigned role.
