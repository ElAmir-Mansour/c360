# ClarioDR console — Playwright E2E specs

End-to-end specs for the critical Recovery Operations Console (`/dr`) journeys.

## Specs

| File | Journey |
| --- | --- |
| `critical-path.spec.ts` | Open `/dr` → command bar → declare-failover wizard pre-flight (readiness blocking/warnings) → drill mode → run list → `/dr/runs/[id]` war room (RTO countdown + gate timeline + next action) → approve gate → evidence/Prove reachable |
| `approvals.spec.ts` | `/dr/approvals` shows an awaiting item → one-click approve; deep-link into the run's full context |
| `integrations.spec.ts` | `/dr/integrations` create → test connection → delete (with confirm) |
| `ledger.spec.ts` | `/dr/prove/ledger` apply a filter → verify a per-entry Merkle inclusion proof |

Shared selectors + navigation helpers live in `_helpers.ts`. They mirror **stable
hooks that already exist in the real components** (role + accessible name, or an
existing `data-testid`); no `data-testid` was added to app source for these tests.

## Requirements to execute

These specs drive the **live application against a live backend**. To run them
green you need:

1. **The frontend dev server** on `http://localhost:3000` (the Playwright
   `webServer` config starts `npm run dev` and reuses an existing server).
2. **The live API stack** reachable through the BFF / gateway — the IAM service
   (`http://localhost:8081`), the gateway, and the ClarioDR backend so the
   `/api/v1/dr/*` reads/writes resolve.
3. **Auth storage-state.** Authentication is supplied by the project-wide fixture
   in `e2e/global-setup.ts`, wired via the `setup` project + the `chromium`
   project's `storageState: ./e2e/.auth/user.json` in `playwright.config.ts`.
   The `setup` project logs in via the IAM API and the BFF session endpoint and
   writes the storage state; every spec under `e2e/` (including `e2e/dr/`) then
   runs authenticated. No spec performs its own login.

## Backend-down behaviour

The specs are written to be **valid and listable without a live backend** and to
**not assume seeded DR data**:

- Always-true assertions cover the persistent console shell (command bar +
  section nav) and each route's framing, which render from the layout.
- Data-dependent steps (a selectable protection group, an in-flight / awaiting
  run, ledger entries) **branch with `test.skip(...)`** when the real data is
  absent, rather than asserting fabricated state. Write actions additionally skip
  when the operator lacks `dr:write` (the gated control is disabled/absent).

## Running

```bash
# List the DR specs without executing them (works with the backend down):
npx playwright test e2e/dr --list

# Execute the DR journeys (requires the live stack + auth storage-state above):
npx playwright test e2e/dr

# A single journey:
npx playwright test e2e/dr/integrations.spec.ts
```
