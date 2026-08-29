# Clario Recover — Navigation & Routing (Prompt 2)

Surfaces **Recover** as a top-level product with three sub-solution workspaces,
driven by **live licensing entitlement**, with **server-side** route guards and
permanent redirects off the legacy `dr/*` paths. Composes the existing `dr/*`
pages via re-export — no recovery logic is forked.

## Routes

```
/recover                      product landing (live entitlement cards)
/recover/it-dr                IT Disaster Recovery workspace      (guard: recover.it_dr)
  /recover/it-dr/recover        ← redirect target of  /dr/recover
  /recover/it-dr/runbooks       ← redirect target of  /dr/runbooks
  /recover/it-dr/rehearse       ← redirect target of  /dr/rehearse
  /recover/it-dr/prove          ← redirect target of  /dr/prove
  /recover/it-dr/prove/ledger   ← redirect target of  /dr/prove/ledger
  /recover/it-dr/prove/compliance ← redirect target of /dr/prove/compliance
/recover/cloud-dr             Cloud Disaster Recovery workspace   (guard: recover.cloud_dr)
/recover/cyber-recovery       Cyber Recovery workspace            (guard: recover.cyber_recovery)
```

The workspace landing pages re-export the existing DR overview; the full composed
workspaces are owned by Prompts 4 (IT DR), 5 (Cloud DR), 6 (Cyber Recovery). Each
workspace layout mounts the shared DR console chrome (`dr/layout.tsx`) so the
re-exported pages keep their posture banner, command bar, copilot and the single
console-wide realtime registration.

## Permanent redirects (308)

Declared in `frontend/next.config.mjs` `redirects()`. Every legacy lifecycle URL
308-redirects to its Recover home; the `/dr/prove/:path*` wildcard preserves the
ledger/compliance deep links. The remaining DR routes (overview, approvals,
insights, protect, topology, integrations, readiness, runbooks `[id]`/runs deep
links) stay under `/dr`.

## Entitlement model (two layers, both real, both server-enforced)

1. **Coarse product gate** — `recover/layout.tsx` reuses `dr:read` via
   `PermissionRedirect`. No `dr:read` ⇒ no Recover surface at all.
2. **Per-sub-solution server guard** — each `recover/{slug}/layout.tsx` wraps its
   children in `RecoverServerGuard`, which resolves the tenant's **live**
   entitlement on the **server** via `GET /api/recover/products`
   (`src/lib/recover/products.server.ts`) and:
   - `active` ⇒ render the workspace,
   - not licensed ⇒ render "request access" (the unentitled tenant is **rejected**,
     not merely hidden),
   - licensing outage ⇒ **fail closed** ("entitlement unavailable"),
   - no session ⇒ redirect to login.

Nav visibility is the *cosmetic* layer: `filterRecoverNavByEntitlement`
(`src/config/navigation.ts`) hides sub-solution links whose slug is not `active`,
fed by `useRecoverProducts()`. Hiding the link is never the access control — the
server guard is.

## Backend wiring

`GET /api/recover/products` is published by `backend/internal/recover` (Prompt 1,
`RECOVER_CONTRACT.md`) and mounted in `clario-dr-service` under `/api/recover`.
Prompt 2 adds the gateway route `{Prefix: "/api/recover", Service:
"clario-dr-service"}` (`backend/internal/gateway/config/routes.go`) —
authenticated but **not** plan-gated at the gateway, so an unlicensed tenant can
still reach the products endpoint to discover the product and request access.
Per-sub-solution entitlement is resolved live in the response body.

## Tests

- `src/config/recover-navigation.test.ts` — suite/segment registration; nav
  visibility by entitlement (loading/none/partial/all); isolation from DR & other
  suites.
- `src/config/recover-redirects.test.ts` — every legacy redirect resolves to a
  real Recover page; targets re-export the DR page (no fork).
- `src/lib/recover/products.test.ts` — client entitlement helpers.
- `src/lib/recover/products.server.test.ts` — server guard: grants licensed,
  **rejects unlicensed**, fails closed on outage, handles unauthenticated.
- `internal/gateway/config/routes_test.go::TestDefaultRoutes_RecoverProductIsAuthedButNotPlanGated`
  — gateway route is authed but carries no plan gate.
