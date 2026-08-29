# Cloud DR sub-solution workspace (Recover · Prompt 5)

The Cloud Disaster Recovery sub-solution workspace. It **composes** the existing
`dr/*` cloud-recovery services into one productized read surface under
`/api/recover/cloud-dr` — it owns **no recovery logic** and reuses the bootgraph
engine's boot plan verbatim.

## What it composes (public APIs only — no fork, no rewrite)

| Capability | Composed service | Public API used |
|---|---|---|
| Dependency-aware boot sequencing | `internal/dr/bootgraph` | `Manager.GetPlan` |
| VM capture (workloads) | `internal/dr/vmcapture` | `Service.ListSources` |
| Infrastructure-as-Code DR (workloads) | `internal/dr/iacdr` | `Service.ListSnapshots` |
| Recovery scopes / sites / failover history | `internal/dr/repository` | `ListGroups`, `ListGroupMembers`, `ListSites`, `ListFailoverRuns` |

Failover/failback **execution** stays on the existing `dr:failover`-gated
endpoints under `/api/v1/dr` (bootgraph boot-runs, the failover FSM). Cloud DR
only surfaces **reads** and the pre-flight boot-sequence visualization.

## Endpoints (all `dr:read`, behind Auth+Tenant)

- `GET /api/recover/cloud-dr/overview` — workloads (VM captures + IaC
  snapshots), the last failover/drill test (with RTO objective vs captured
  actual), and boot-graph status across recovery scopes. One bounded set of
  reads (one boot plan per scope); no N+1 over individual workloads.
- `GET /api/recover/cloud-dr/regions` — each recovery scope's boot-graph status
  (the list the region/AZ failover view renders before a target is selected).
- `GET /api/recover/cloud-dr/regions/{groupID}/boot-plan` — the **real**,
  dependency-ordered boot plan (bootgraph tiers, verbatim) for one scope, to
  visualise BEFORE execution. `404 not_found` for a scope outside the tenant.

All routes resolve the tenant from the validated bearer token; a scope from
another tenant is invisible (RLS read transactions) and yields 404.

## Persistence

None added. Every value is read from existing tables (consistency groups,
protected sites, failover runs, vmcapture sources, iacdr snapshots) — so there
is **no new migration**. Activation/entitlement remain owned by Prompt 1.

## Go surface

```go
recoverproduct.NewCloudDRService(recoverproduct.CloudDRConfig{
    Planner:   bootMgr,                                          // *bootgraph.Manager
    Estate:    recoverproduct.NewRepositoryEstateReader(db, nil),
    Workloads: recoverproduct.NewServiceWorkloadReader(vmSvc, iacSvc),
    Logger:    logger,
})
recoverproduct.NewCloudDRRouter(svc, logger) // assigned to Router.CloudDR
```

## Frontend

`frontend/src/app/(dashboard)/recover/cloud-dr/`:
- `page.tsx` + `_components/cloud-dr-dashboard.tsx` — overview (workloads,
  RTO-vs-RTA of the last failover test, boot-graph KPIs).
- `_components/region-failover-view.tsx` — select a target region/AZ scope →
  visualise the real bootgraph boot sequence (tier ladder) before execution.
- `rehearse/page.tsx` — re-exports the **shared** rehearsal flow
  (`dr/rehearse/page`), the same component IT DR uses — not forked.
