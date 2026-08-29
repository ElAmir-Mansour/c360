# ClarioDR (`/dr/*`) — Detailed UI/UX Audit

> Trigger: client said the DR UI "looks like there are no action buttons" and "I have no idea what or
> how to use it." Audit of every `/dr/*` route (code‑read + live data‑state check). Design‑only.

---

## 0. Verdict — it's a **cold‑start / empty‑state** problem, not missing capability

The backend is deeply capable (replication, runbooks, gated failover, RTO/RPO, asset registry, drills,
attestation ledger, ransomware cleanroom, BYOK — 14 areas). The UI exists and is rich. But:

1. **The demo tenant has ZERO DR data** (live‑verified: `dr/groups`, `dr/sites`, `dr/streams`,
   `dr/failover-runs` all return **0 items**). ClarioDR is *configure‑then‑operate*; with nothing
   configured, every operational surface is empty.
2. **Almost every action is gated on `dr:write` AND a selected protection group.** With no group, the
   command‑bar and page actions render **disabled** — a toolbar that "looks dead."
3. **The empty‑state experience is uneven** — the landing is good, but the operational child pages are
   poor (disabled buttons, vanishing CTAs, no "create a group first" guidance).

So the client isn't wrong: on an empty tenant there is genuinely **almost nothing they can click**, and
no data to show DR working. **Two fixes solve 90% of this: (P0) seed realistic demo DR data so the
console is alive, and (P1) fix the child‑page empty states.**

---

## 1. Per‑area findings

### `/dr` Landing + command bar — **GOOD** ✅
- Renders the **orientation band** (hero + 5 lifecycle cards + 10 capability cards — from the #3 work),
  always visible even while loading/errored.
- **Protection Groups** card has a proper empty state: *"Create your first protection group"* +
  **"Set up protection"** button → `/dr/protect` (`page.tsx:617`).
- Command bar has 4 actions — **Declare failover / Run a runbook / Seal recovery point** (all
  `dr:write` **+ active group**) and **Rehearse** (`dr:write` only). All **disabled** when empty, with
  hover tooltips ("Select a protection group first").
- **Gap:** the toolbar looks inert (disabled, reasons only on hover); orientation cards deep‑link into
  empty child pages with no "set up protection first" hint.

### `/dr/protect` — **GOOD first‑run** ✅
- When `groups.length === 0` it **auto‑routes to the Inventory tab** so the guided onboarding +
  **`CreateGroupDialog`** (`_components/provision/`) is the first thing shown (`page.tsx:60‑65`). This is
  the correct on‑ramp: *landing → "Set up protection" → /dr/protect → create group.*
- **Gap:** discoverability — a user who lands elsewhere first never sees this; it relies on entering via
  the landing CTA.

### `/dr/recover` (+ `/dr/runs/[id]`) — **POOR** ❌
- Renders the **full feature UI with 18+ disabled buttons** (declare/approve/cancel failover, failback,
  isolated boot, validate point…), all needing `dr:write` + an active group/failover.
- **The empty‑state CTA "Declare a failover" is HIDDEN when no group is selected** — i.e. it vanishes
  exactly when the user needs the on‑ramp. No page‑level "create a protection group first" guidance.
- **Client‑facing effect:** "18+ disabled buttons, where do I click?"

### `/dr/rehearse` + `/dr/readiness` — **POOR** ❌
- Drill calendar empty state has **no action button** ("Create an isolated drill schedule…" but nothing
  to click). Game‑day "Create scenario" is **greyed with no tooltip/banner** explaining why. All
  rehearse/readiness actions disabled with **zero on‑view explanation**.
- **No full‑page empty state** pointing to Protect.

### `/dr/runbooks` (+ `[id]`, `runs/[runId]`) — **POOR** ❌
- Has an EmptyState ("Create a runbook below, or open by id…") but **no action button on it**; **no
  runbook catalog/list** — users must know/paste a runbook **UUID**. Authoring works, but runbooks are
  **orphaned from the required upstream setup** (a group is needed to execute).

### `/dr/prove` (+ `ledger`, `compliance`) & `/dr/integrations` / `/dr/insights` / `/dr/approvals` — **same pattern** ⚠️
*(audit agents for these hit the tool's structured‑output cap; from the established pattern + code
structure:)* attestation/compliance/insights surfaces render **empty with no data**, and **Integrations**
— the *other* place a user must act first (connect a hypervisor/storage/k8s source + credentials) — is
not surfaced as a first‑run step. Approvals shows an empty queue.

---

## 2. The action inventory + why it's "no buttons"

Every operational action follows the same gate: **`dr:write` AND a selected protection group** (some
also need a stream/recovery‑point/failover). On an empty tenant *none* of those preconditions exist, so
the UI is technically full of buttons that are **all disabled**. Disabled reasons live in **hover
tooltips**, so without hovering the page reads as "no actions." The only *enabled* first action anywhere
is the landing's **"Set up protection"** and protect's **Create Group** dialog.

> Net: the app is gated correctly for *safety* (you shouldn't declare a failover with nothing to fail
> over to), but the **first‑run/empty experience wasn't designed** — it assumes data already exists.

---

## 3. Recommendations (prioritized)

### P0 — **Seed realistic demo DR data for the demo tenant** (highest impact)
The single change that makes ClarioDR *demoable and self‑explanatory*. Seed (idempotent, like the other
suites' demo data): 2–3 **protection groups** (e.g. "Riyadh DR", "Core Banking"), their **sites** +
**consistency groups** + **boot order**, **replication streams** with live RPO/lag, a few **recovery
points** (some sealed/validated), 1–2 **runbooks** (with a DAG), a completed **drill** + a sample
**failover run** (terminal), **readiness scores**, and a couple **attestation‑ledger** entries. Result:
the client opens `/dr` to a **populated, alive console** — enabled actions, real metrics, a runbook to
open, a run to inspect — and *immediately sees how it works*. (Mirrors `seed_legal_affairs.go`.)

### P1 — **Fix the operational child‑page empty states** (recover / rehearse / readiness / runbooks)
- Add a **page‑level empty state** when `groups.length === 0`: a prominent card — *"Set up disaster
  recovery → Create your first protection group"* + CTA → `/dr/protect` — instead of a wall of disabled
  buttons. (Recover, Rehearse, Readiness, Runbooks.)
- **Stop hiding the on‑ramp CTA**: show "Declare failover" / "Create drill" **always when `dr:write`**,
  disabled with an **inline reason** ("Select a protection group first") — never vanishing.
- **Inline disabled reasons** (small helper text/badge under the toolbar), not only hover tooltips, so
  the command bar doesn't read as dead.
- **Runbooks:** add a **runbook catalog/list** (no UUID paste) + an empty‑state "Create runbook" button.

### P2 — **Guided first‑run + wayfinding**
- A persistent **"No protection groups yet — start in Protect"** banner (DRPostureBanner) across DR
  child routes until the first group exists.
- Orientation lifecycle/capability cards: add subtle "requires a protection group" / "set up first"
  copy so deep‑links don't dump users into empty pages blind.
- Surface **Integrations** as an explicit first‑run step ("Connect a source to begin replication").
- Step‑up perms: when a user has `dr:write` but not `dr:failover`, show a clear message at the confirm
  step rather than a silently disabled button.

---

## 4. Suggested sequence
1. **P0 demo‑data seeder** (~1–2 d) — makes the demo work *today*; reuses the DR domain models + the
   onboarding/seed pattern. **Do this first.**
2. **P1 child‑page empty states** (~2–3 d) — the durable fix for real (empty) tenants.
3. **P2 wayfinding polish** (~1–2 d).

> Note: this builds on the #3 nav/orientation work (now live) and the role‑permission fix (DR is now
> visible + `dr:write`‑capable for tenant‑admins). With P0 in place, the orientation cards finally lead
> into a *populated* app.
