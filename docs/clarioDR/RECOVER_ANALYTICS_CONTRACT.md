# RECOVER_ANALYTICS_CONTRACT.md

**Clario Recover — unified RTO/RTA & recovery analytics contract (Prompt 8, Wave 3).**

This is the contract the landing page (Prompt 3) and every sub-solution overview
integrate. It is published by `backend/internal/recover/` (the analytics layer:
`analytics.go`, `analytics_store.go`, `analytics_router.go`, `analytics_metrics.go`).

It is the **REAL** endpoint — there is no placeholder, canned, or stubbed health
value. Every metric is computed server-side from real persisted execution records
and the **Application Metastore RTO seam** (Prompt 7, `internal/recover/metastore`).

Status: implemented and tested. Backend builds
(`GOWORK=off go build ./internal/recover/... ./internal/dr/...`), package tests
are green (`go test ./internal/recover/...`, incl. happy/failure/edge/authz-denied/
concurrency), `npx tsc --noEmit` is clean, and migration
`000039_recover_analytics_snapshot` applies and rolls back cleanly (RLS
enabled+forced; the snapshot is append-only — no UPDATE/DELETE policy or code path).

---

## 1. What it is

A single cross-sub-solution analytics rollup over the whole product. It
**composes**, it never reimplements:

- **RTO source — the Metastore seam.** The RTO **target** per application is
  resolved from `metastore.MetastoreClient.ListApplications` →
  `Application.RTOTargetSeconds`. RTO is **never hardcoded**.
- **RTA source — real execution records.** The **captured** RTA comes from the
  existing runbookstudio runs (`dr_studio_run.actual_duration_seconds`, stamped by
  the runbook engine at completion), joined to applications via the Metastore
  runbook link (`recover_metastore_runbook_link`). The same join generalises to
  the drill (`dr_drill_result`) and failover (`failover_run`) history; the shipped
  default sources per-application RTA from the linked runbook runs (the one join
  that is per-application by construction).
- **Readiness trend — the only owned state.** A point-in-time readiness score
  cannot be reconstructed from live records, so each computation appends **one
  immutable snapshot** (`recover_readiness_snapshot`, append-only) to grow the
  trend.

---

## 2. Endpoint

Mounted under **`/api/recover`** in `clario-dr-service`, behind the same
`Auth` + `Tenant` middleware as the rest of the Recover API. Response uses the
suiteapi `{data}` envelope.

| Method | Path | Permission | Entitlement |
|---|---|---|---|
| `GET` | `/api/recover/analytics` | `dr:read` | **any** of `recover.it_dr` / `recover.cloud_dr` / `recover.cyber_recovery` |

**AuthZ (server-side, never UI-only):** the route self-gates on the `dr:read`
permission; the service additionally resolves a Recover entitlement through the
existing licensing engine (the same `EntitlementResolver` the product view uses).
The portfolio view is product-wide, so **any one** of the three sub-solution keys
authorises it; a tenant entitled to **none** is denied.

**Errors:**
- `401 unauthorized` — no tenant / permission.
- `402 not_entitled` — no Recover entitlement; body carries
  `details.upgrade_url = /register?suites=recover&plan=trial`.
- `503 entitlement_unavailable` — licensing engine unreachable (fail-closed; a
  licensing outage is never silently treated as entitled).
- `500 internal` — unexpected; no stack trace leaked.

---

## 3. Response shape

```json
{
  "data": {
    "portfolio_readiness": 72,
    "progress": {
      "total_applications": 2,
      "recovered": 1,
      "at_risk": 1,
      "untested": 0,
      "in_progress": 0,
      "completion_ratio": 0.5
    },
    "applications": [
      {
        "application_id": "…",
        "app_key": "core-banking",
        "name": "Core Banking",
        "recovery_tier": "mission_critical",
        "rto_target_seconds": 600,        // from the Metastore seam
        "latest_rta_seconds": 900,        // from real execution records
        "rta_breach": true,
        "breach_seconds": 300,
        "execution_count": 1,
        "success_count": 1,
        "readiness": 50,
        "events": [
          {
            "event_id": "…",
            "source": "runbook_run",      // runbook_run | drill | failover
            "runbook_id": "…",
            "mode": "rehearsal",
            "status": "completed",
            "succeeded": true,
            "rta_actual_seconds": 900,    // present only once completed
            "started_at": "2026-06-29T00:00:00Z",
            "completed_at": "2026-06-29T00:15:00Z"
          }
        ]
      }
    ],
    "bottlenecks": [
      {
        "kind": "rto_breach",            // rto_breach | failing_recovery | untested_application
        "application_id": "…",
        "app_key": "core-banking",
        "label": "Core Banking missed its RTO target",
        "detail": "latest recovery took 900s vs a 600s target (300s over)",
        "severity": 0.8                  // 0..1, worst first
      }
    ],
    "readiness_trend": [
      { "score": 72, "application_count": 2, "breaching_count": 1, "captured_at": "2026-06-29T00:00:00Z" }
    ],
    "generated_at": "2026-06-29T00:00:00Z"
  }
}
```

Field semantics:

- **`portfolio_readiness`** (0..100): the weighted average of per-application
  readiness — tested coverage (0.50), RTO attainment (0.30), success ratio (0.20).
  An empty estate is `0` with explained components.
- **`progress`**: `recovered` = latest completed event within RTO target;
  `at_risk` = latest completed event breached the target; `untested` = no
  completed event yet; `in_progress` = a live (non-terminal) execution right now;
  `completion_ratio` = `recovered / total_applications`.
- **`applications`**: sorted **worst-first** (ascending readiness). `events` is a
  bounded, newest-first window (10) of the real execution records. `latest_rta_seconds`
  is the RTA of the most recent **completed** event; absent when untested.
  `rta_breach` / `breach_seconds` compare it to `rto_target_seconds` (the seam).
- **`bottlenecks`**: top 10, ranked by `severity` (highest first). `rto_breach`
  (latest RTA over target), `failing_recovery` (every captured event failed), and
  `untested_application` (a mission-critical / tier-1 app with no execution).
- **`readiness_trend`**: newest-first historical snapshots over a trailing 180-day
  window (≤60 points); the just-captured live point is at the head.

---

## 4. Persistence

Migration `000039_recover_analytics_snapshot` (reversible UP + DOWN), one table:

- `recover_readiness_snapshot` — one immutable row per portfolio-readiness
  capture (`score`, `application_count`, `breaching_count`, `components` JSONB,
  `captured_at`). **Append-only**: the store exposes no UPDATE/DELETE path and the
  migration grants no UPDATE/DELETE RLS policy, so the trend is a faithful
  historical record. RLS-isolated per tenant (the dr_db RLS clone).

No other schema is owned: the RTO target and the RTA execution records live in
the Metastore tables and the dr/* tables respectively, read in place.

---

## 5. Go surface (importable by other backend prompts)

```go
import recoverproduct "github.com/clario360/platform/internal/recover"

svc, _ := recoverproduct.NewAnalyticsService(recoverproduct.AnalyticsConfig{
    Runner:       recoverproduct.PGXRunner{Pool: db},
    Metastore:    metastoreRegistry, // satisfies AnalyticsMetastore (the RTO seam)
    Store:        recoverproduct.NewAnalyticsStore(),
    Entitlements: resolver,
    Metrics:      recoverproduct.NewAnalyticsMetrics(reg),
    Logger:       logger,
})
view, _ := svc.Analytics(ctx, tenantID, authorization) // (*AnalyticsView, error)
```

Observability (per-instance registry): `recover_analytics_requests_total`,
`recover_analytics_applications` (histogram), `recover_analytics_at_risk_applications`
(gauge), `recover_analytics_portfolio_readiness` (gauge).

---

## 6. Route registration (Wire agent applies)

The analytics handler is wired onto the existing Recover Auth+Tenant group in
`internal/recover/router.go` (already applied in this change). The exact
registration block, guarded so the product router stays usable without it:

```go
// Cross-sub-solution RTO/RTA & recovery analytics (Prompt 8).
if h.Analytics != nil {
    r.Group(func(r chi.Router) {
        r.Use(middleware.RequirePermission(auth.PermDRRead))
        r.Get("/analytics", h.Analytics.GetAnalytics)
    })
}
```

`cmd/clario-dr-service/recover.go` constructs the service over the same
`metastoreRegistry` (the RTO seam) and `resolver`, and sets
`router.Analytics = recoverproduct.NewAnalyticsHandler(analyticsSvc, logger)`.

---

## 7. For downstream agents

- **Landing page (Prompt 3):** bind the portfolio strip to `GET /api/recover/analytics`
  via `lib/recover/use-analytics.ts` → `<RecoverAnalyticsDashboard>`
  (`app/(dashboard)/recover/_components/recover-analytics-dashboard.tsx`). It
  renders real loading / error / not-entitled states — **no placeholder**. Already
  embedded in `app/(dashboard)/recover/page.tsx`.
- **Sub-solution overviews (Prompts 4/5/6):** reuse the same hook/component for an
  RTO-vs-RTA + readiness panel; the endpoint is product-wide, filtered client-side
  per sub-solution if a scoped view is wanted.
- **Frontend types:** `frontend/src/types/recover-analytics.ts` mirrors this shape
  field-for-field.
