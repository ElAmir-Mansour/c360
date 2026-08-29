# Demo Feedback #2 & #3 — Design

> #2 Session‑timeout logout redirects to the internal `localhost:3010`. #3 ClarioDR app — user
> "got lost, couldn't find it". Both root‑caused in code (file:line). Design‑only.

---

## Feedback #2 — Timeout logout lands on `https://localhost:3010/login`

### Root cause (confirmed)
`frontend/src/middleware.ts` builds redirect URLs with **`new URL('/login', req.url)`** at **lines
233 and 249** (and `/dashboard` at ~187/220). Behind nginx the Node server is reached at
`127.0.0.1:3010`, so **`req.url` resolves to the internal loopback host** — the `Location` header
becomes `https://localhost:3010/login?...` instead of the public origin. nginx
(`deploy/vps/nginx-clario360.conf.template:51‑54`) sets `Host $host` and `X-Forwarded-Proto $scheme`
but **not `X-Forwarded-Host`**, and the middleware never consults forwarded headers.
*(Note: `session-expired-dialog.tsx:48` already uses a relative client‑router push and is fine — the
bug is purely the middleware's absolute‑URL construction.)*

### Fix (small, robust)
1. **Use relative redirects in middleware** — replace `new URL('/login', req.url)` /
   `new URL('/dashboard', req.url)` with a **relative path** (`NextResponse.redirect(new URL(path,
   origin))` where `origin` is derived from forwarded headers, *or* simply redirect to the relative
   path and let the browser keep its current public origin). Relative is the most robust: the
   middleware never has to guess the origin, and the browser enforces it. Preserve the existing
   `?redirect=<safeRedirect(path)>` query.
2. **Add a `getPublicOrigin(req)` helper** (`frontend/src/lib/middleware-utils.ts`) for the cases that
   genuinely need an absolute URL: prefer `X-Forwarded-Host` + `X-Forwarded-Proto`, fall back to
   `Host`, then `NEXT_PUBLIC_APP_URL`. Use it at all four sites.
3. **nginx hardening** — add `proxy_set_header X-Forwarded-Host $host;` to the frontend location in
   `nginx-clario360.conf.template` (de‑facto standard; makes #2's helper correct for any proxy‑aware
   code, not just middleware).

### Verification
On `https://devops.ofpsplatform.com`: log in → clear the access cookie in DevTools (simulates timeout)
→ hit a protected route → assert the address bar shows **`https://devops.ofpsplatform.com/login?redirect=%2Fdashboard`** (public origin), login succeeds, and it bounces back to `/dashboard`. Add a
middleware unit test asserting a proxied request (`X-Forwarded-Host: devops.ofpsplatform.com`,
`X-Forwarded-Proto: https`, socket host `127.0.0.1:3010`) yields a redirect on the **public** origin.

**Effort:** ~half a day. High visibility (every user hits a timeout eventually).

---

## Feedback #3 — ClarioDR: "I got lost and couldn't find it"

### Diagnosis — it's IA, not missing features
ClarioDR (`frontend/src/app/(dashboard)/dr/`) has **16 routes** and a deeply capable backend
(`backend/internal/dr`): replication/data‑mover, runbooks (dependency DAGs), gated failover FSM,
RTO/RPO SLOs, recovery asset registry (sites/consistency‑groups/targets/network maps), drills &
game‑days, attestation ledger (hash‑chained, WORM, NCA‑ready), ransomware cleanroom, instant recovery
(CoW), coverage/workload capture, integrations catalog, BYOK sovereign keys, agent enrollment (mTLS).
**The capability is there; the wayfinding isn't.** Gaps found:

- **No orientation landing.** `/dr/page.tsx` opens with a live operations dashboard (runbook runs,
  protection‑group grid, attention queue) that **assumes product knowledge** — no overview that
  explains the **Protect → Recover → Rehearse → Prove → Readiness** lifecycle. (Cyber/Lex lead with
  feature‑oriented heroes; ClarioDR doesn't.)
- **Flat sidebar.** `config/navigation.ts:307‑330` lists **11 DR items as one flat list** — no
  grouping by lifecycle or function; users can't form a mental model.
- **Dual, unreconciled nav.** A separate 8‑tab horizontal **console nav** (`dr-console-nav.tsx`, in
  `layout.tsx:43`) coexists with the sidebar section — two navigations for the same app, defined in
  different places.
- **No breadcrumbs.** Deep routes (`/dr/runbooks/[id]`, `/dr/runs/[id]`, `/dr/prove/ledger`) have **no
  breadcrumb/back‑link** to their parent — easy to get stranded.
- **Vague label.** The suite entry is **"Resilience"** (`navigation.ts:148`) — new users don't map it
  to "Disaster Recovery / ClarioDR".

### Fix — ClarioDR Discovery & Navigation Overhaul
1. **Lifecycle‑grouped sidebar** (`config/navigation.ts` + `sidebar-section.tsx`) — reorganize the 11
   flat items into labeled subsections (reuse Cyber's CTEM/DSPM subsection pattern,
   `navigation.ts:225‑250`):
   - **Operations:** Overview · Approvals · Insights
   - **Lifecycle:** Protect · Recover · Rehearse · Prove (→ Ledger, Compliance) · Readiness
   - **Infrastructure:** Topology · Runbooks · Integrations
2. **Orientation landing** (`/dr/page.tsx`) — add a **hero + feature‑card grid above** the live
   dashboard, one card per lifecycle stage with a one‑line "what it does" + deep link (reuse Lex's
   `DomainTiles`/`CommandHero` or Cyber's `SectionCard`/`SectionGrid`). First‑time users land on a map,
   not a metrics wall. Keep the operational dashboard below for returning users.
3. **Breadcrumbs** on all drill‑in routes ("Resilience › Runbooks › <name>") via the existing
   breadcrumb system; add back‑links on `/dr/runs/[id]` and `/dr/runbooks/[id]`.
4. **Reconcile the dual nav** — make the horizontal console tabs and the sidebar subsections **derive
   from one source** (the lifecycle grouping), or drop the console tabs in favor of the grouped
   sidebar + breadcrumbs (recommended — one nav, not two).
5. **Clarify the label** — rename the suite entry **"Resilience" → "Disaster Recovery"** (or
   "ClarioDR · Resilience") so it's unmistakable in the suite switcher.

### Verification
Playwright: from another suite, open the suite switcher → "Disaster Recovery" → assert the `/dr`
landing shows the lifecycle feature cards; click each card → lands on the right route with a
breadcrumb; assert the sidebar shows the 3 grouped subsections. Real‑browser RTL/Arabic check.

**Effort:** ~3–4 days (frontend‑only; backend already exposes everything).

---

## Sequencing
Both are **frontend‑heavy and independent** of the Workflow Module phases, so they can land in the same
next redeploy. Recommended order: **#2 first** (tiny, high‑visibility), then **#3** (the IA overhaul).
Neither needs new backend or migrations — lower risk than the Workflow work.
