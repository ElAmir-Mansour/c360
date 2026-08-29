# Watheeq (Legal Suite) Pricing Calculator — Notes

**Workbook:** `docs/admin/Watheeq_Pricing_Calculator.xlsx` (separate from the full-platform calculator).
**Model:** per **legal SEAT** (legal software is seat-licensed), not per core. Built 2026-07-03, code-grounded. Recalculated headless — **zero formula errors**.

## Why a dedicated Watheeq model
Watheeq = the Lex legal suite (`internal/lex`), licensed stand-alone (`app.watheeq`). It has cost drivers the general platform model lacks, each on its own line:
- **E-signature transactions** — Najiz (MOJ) / emdha (TSP), per qualified signature, pass-through.
- **Identity verifications** — Nafath, per check.
- **Legal AI** — contract clause/obligation extraction + AID drafting engine.
- **10-year WORM legal archive** — records-management retention drives heavy cold storage (in-Kingdom / PDPL).
- **Smaller infra** — lex-service + platform core (~8–10 cores) vs. the full 16-service platform (~35 cores).

## Tier prices at default inputs (SaaS, 25 seats, 12-mo) — SAR/seat/mo incl VAT

| | Standard | Growth | Professional | Customized |
|---|---|---|---|---|
| Price / seat / mo | 283 | 458 | 881 | 1,757 |

E-signatures dominate the higher tiers (Professional 40 sigs/seat, Customized 150) — so the **e-sign unit cost is the most sensitive input** (Decision D3).

## The margin problem — and the corrected policy (now applied)

**Legacy policy (markup 1.3, stacked volume + annual discounts):** margin collapsed below the floor at exactly Watheeq's target scale (large legal departments / gov):

| Seats | Legacy margin | Corrected margin |
|---|---|---|
| 10 | 14.5% | **28.3%** |
| 25 | 10.0% | **28.3%** |
| 75 | **5.0% (below floor)** | **26.7%** |
| 150 | **−0.6% (loss)** | **21.3%** |
| 300–500 | **−0.6% (loss)** | **17.3%** |

**Corrected policy (now the workbook default), three changes:**
1. **Markup 1.3 → 1.55** — real headroom (list margin 35.5% vs 23%). Costs ~+19% on list price (Standard seat 283 → 355 SAR).
2. **Non-stacking discounts** — apply the *greater* of volume or annual, not both. Cleaner and client-explainable.
3. **Hard margin-floor clamp** — net price can never fall below cost × (1+floor), as a safety net against over-discounting.

Large clients still get up to **22% volume discount** (good optics), but realized margin stays **17–28% and never breaches the floor**. The **Discount Policy Model** sheet shows the full current-vs-corrected curve and lets Saleh tune markup, breakpoints, and stacking mode live. All three policy levers are editable on **Global Assumptions** (`B26` stacking mode, `B27` floor clamp) — set stacking mode back to `1` to reproduce the legacy behaviour for comparison.

## Open decisions (Saleh)
- **D1** — markup vs discount stack (see the critical finding — most urgent for Watheeq).
- **D2** — AI blended token cost (same as platform model; Sonnet-priced `opus-4-8` slug discrepancy).
- **D3** — real Najiz/emdha per-signature and Nafath per-verification rates; pass-through vs. markup ($2/sig and $0.50/verify are assumptions).
- **D4** — per-tier e-signature allowances and per-seat storage (esp. the 10-yr cold GB, which *grows* over the retention period — the monthly figure is point-in-time).

## Sheets
README (Watheeq) · Global Assumptions · Legal Transactions (e-sign/identity model) · Watheeq Per-Seat Pricing · Scenario Comparison · Client Price Sheet · Infrastructure Sizing (single-suite).
