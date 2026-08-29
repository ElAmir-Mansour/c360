# Clario360 Pricing Calculator — Model Notes

**Workbook:** `docs/admin/Enterprise_Pricing_Calculator_FINAL.xlsx`
**Built:** 2026-07-03 · code-grounded (backend/deploy research) + real Claude API pricing.
**Original draft** (`Enterprise_Pricing_Calculator_2.xlsx`) left untouched as a fallback.

Every price cell is a live formula. Recalculated headless (LibreOffice) — **zero `#REF!`/`#DIV0!` errors**; changing a Global input propagates to both models (verified: markup 1.3→1.5 moved Per-User Standard 156→180 SAR and margin 14.5%→25.9%).

## Tier prices at default inputs (SaaS, 12-month term)

**Per-User (1 user) — SAR/month incl. VAT:**

| | Standard | Growth | Professional | Customized |
|---|---|---|---|---|
| Monthly (incl VAT) | 156.41 | 211.66 | 300.47 | 2,688.31 |
| Realized margin | 14.5% | 14.5% | 14.5% | 14.5% |

**Per-Core (1 core, 1 VM) — SAR/month incl. VAT:** 736.66 / 812.35 / 928.39 / 3,350.30.

**Scenario (100-user tenant, per user/mo incl VAT):** SaaS 156 · On-Prem 159 · Air-Gapped 195 (Standard tier). Setup premium amortizes; local storage is cheaper; air-gap carries the 1.4× base surcharge.

## The realized-margin finding (Decision D1)

Realized margin is **~14.5% and identical across all four tiers**, because it depends only on markup vs. discount, not tier:

> margin = 1 − 1 / (markup × (1 − annual discount)) = 1 − 1/(1.3 × 0.9) = **14.5%**

The 10% annual discount erodes the 1.3× markup. Levers for Saleh: raise markup (→1.5 gives ~26%), cut the annual discount, or raise the floor. **This is an open decision — the model surfaces it, does not resolve it.**

## Assumptions Saleh must confirm (Low/Med confidence)

| Input | Value | Why to confirm |
|---|---|---|
| **AI cost /1M tokens** | $3 (blended) | Real: Opus $5/$25, Sonnet $3/$15, Haiku $1/$5. **The code hardcodes the `opus-4-8` slug at $3/$15 — that is actually Sonnet pricing (a bug/discrepancy).** Batch −50% & caching ≈0.1× can justify $3; true-Opus without optimization is ~$12/1M. Confirm the blend. |
| **Markup 1.3 / annual disc 10% / floor 10%** | policy | Drive the 14.5% margin — commercial policy, not derived. |
| **Compute $/core, $/user** | $20 / $4 | $20/core ≈ GCP e2-std-4 ($24/core); $4/user is derived, not measured. |
| **Third-party licensing $8/core, $3/user** | placeholder | Stack is almost all OSS ($0) — likely conservative. |

## What IS grounded (High confidence)

- **Storage $5/GB hot, $1/GB cold, SaaS 0.8×, local 0.5×** — confirmed in `docs/admin/pricing-console-design.md`.
- **Per-tenant AI hard cap $50/day / 500k tokens/day** — enforced in `cyber/vciso/llm` rate limiter → ~$1,500/tenant/mo ceiling.
- **Per-tenant baseline 2 GB DB + 5 GB files**; **legal e-archive 10-yr WORM**, **DR journal 7-day** — from SC-005 + `earchive_worm.go`.
- **Infra cost by tenant tier** (SC-005): 50→$3.2k, 100→$7k, 250→$14k, 500→$28k /mo on GKE e2-std-4.
- **FX 3.75, VAT 15%** — SAR peg / ZATCA.

## Open decisions

- **D1** — markup vs discount / margin floor (see above).
- **D2** — AI blended token cost (see above); note the Sonnet-priced `opus-4-8` slug discrepancy.
- **D3** — storage & VM are **flat across all tiers** by design (only base + AI scale). Conscious choice — decide if tiers should differentiate.
- **D4** — **SMS is not wired** (no Twilio/Unifonic in code); email is SendGrid/SMTP. SMS is modelled as a forward-looking cost on the Integrations sheet, not a shipped one.

## Sheets added vs. the draft

README & Instructions · Global Assumptions (single source of truth) · Cost Basis & Assumptions (every input + source + confidence) · Integrations & 3rd-Party (AI, SMS, email, gov e-sign, threat feeds, KMS, Vault…) · Support Staffing Model (bottom-up support cost) · Infrastructure Sizing (16-service footprint → per-core basis) · Scenario Comparison · Client Price Sheet. Per-User & Per-Core preserve the draft's formula logic.
