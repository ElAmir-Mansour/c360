# METASTORE_SEAM.md

**Clario Recover — Application Metastore seam (Prompt 7, Wave 2).**

This is the contract the Recover product publishes for the application
source-of-truth that runbooks are built from. It is the Cutover **Application
Metastore** analogue: a CMDB-like registry of the applications in a tenant's
estate and the recovery-relevant metadata each one carries. Published by
`backend/internal/recover/metastore/`.

Status: implemented and tested. The default registry builds
(`GOWORK=off go build ./internal/recover/... ./internal/dr/...`), the package
tests are green (`go test ./internal/recover/metastore/...`), and migration
`000037_recover_metastore` applies and rolls back cleanly (RLS enabled+forced on
all six tables, verified against `dr_db`).

---

## 1. The seam (RECOVER §3.4)

A **real, stable interface** plus a **complete, persistence-backed default
implementation**. The dedicated Metastore product, later in the roadmap, swaps
the implementation behind the interface; what ships here is a real, working
feature today — **not a thin stub and not canned data**.

```go
import "github.com/clario360/platform/internal/recover/metastore"

// The seam.
type MetastoreClient interface {
    ResolveApplication(ctx, tenantID, id) (*Application, error)
    ResolveApplicationByKey(ctx, tenantID, appKey) (*Application, error)
    ListApplications(ctx, tenantID, limit, offset) (ListPage, error)
    CreateApplication(ctx, tenantID, ApplicationInput) (*Application, error)
    UpdateApplication(ctx, tenantID, id, ApplicationInput) (*Application, error)
    DeleteApplication(ctx, tenantID, id) error
}

// The shipped default: a real CMDB-like registry over six owned tables.
var _ MetastoreClient = (*metastore.DefaultRegistry)(nil)
```

`Application` resolves the recovery-relevant metadata: **owners**,
**environments**, **dependencies**, **recovery tier**, **RTO target (seconds)**,
**cloud accounts**, and **linked runbooks** (with the metadata revision each was
populated from).

A future Metastore product implements `MetastoreClient` against an external CMDB
without any caller change. Every Recover feature that needs application metadata
(the populate/sync actions; the analytics RTO join in Prompt 8) depends on this
interface, never on the concrete store.

---

## 2. Endpoints

All routes are mounted under **`/api/recover`** in `clario-dr-service`, behind
the same `Auth` + `Tenant` middleware as the rest of the Recover API, and each
route self-gates with `RequirePermission`. Responses use the suiteapi `{data}` /
`{data,meta}` envelopes.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET`    | `/api/recover/metastore/applications`                          | `dr:read`  | Paginated list of the tenant's applications (full metadata). |
| `GET`    | `/api/recover/metastore/applications/{id}`                     | `dr:read`  | Resolve one application's full recovery metadata. |
| `POST`   | `/api/recover/metastore/applications`                          | `dr:admin` | Register an application from a metadata payload. |
| `PUT`    | `/api/recover/metastore/applications/{id}`                     | `dr:admin` | Replace an application's metadata wholesale. |
| `DELETE` | `/api/recover/metastore/applications/{id}`                     | `dr:admin` | Remove an application (cascades children + links). |
| `POST`   | `/api/recover/metastore/applications/{id}/populate`            | `dr:write` | **Populate from Metastore**: materialize a Runbook Studio runbook from the application's metadata. |
| `POST`   | `/api/recover/metastore/applications/{id}/runbooks/{rid}/sync` | `dr:read`  | **Sync**: diff the linked runbook against current metadata and **flag drift**. |

Error mapping: `400 bad_request` (`ErrInvalid` / bad body), `401 unauthorized`
(no tenant/permission via `RequirePermission` → 403 on a permission miss),
`404 not_found` (`ErrNotFound` / `ErrRunbookNotLinked`), `409 conflict`
(`ErrAlreadyExists`), `422 no_recovery_target` (`ErrNoRecoveryTarget`),
`500 internal`. Stack traces are never leaked.

### Application payload (create/update)

```json
{
  "app_key": "core-banking",
  "name": "Core Banking",
  "description": "primary ledger",
  "recovery_tier": "mission_critical",   // mission_critical|tier_1|tier_2|tier_3
  "rto_target_seconds": 3600,
  "owners":        [{ "role": "business", "name": "Layla", "contact": "layla@bank" }],
  "environments":  [{ "key": "dr-jed", "kind": "disaster_recovery", "region": "me-central-2", "is_recovery_target": true }],
  "dependencies":  [{ "depends_on_app_key": "identity", "criticality": "hard" }],
  "cloud_accounts":[{ "provider": "aws", "account_ref": "1234567890", "region": "me-central-2" }]
}
```

`app_key` is the immutable, tenant-stable business identifier; an update keeps
it. The server owns `id`, `metadata_revision`, `metadata_hash`, and timestamps.

---

## 3. Populate from Metastore (real population, composing Runbook Studio)

`POST .../{id}/populate` turns an application's **current persisted metadata**
into an ordered recovery runbook by **composing** the existing
`internal/dr/runbookstudio` service (`CreateRunbook` with import steps) — it
never reimplements runbook authoring. The derived step sequence encodes the
recovery order the metadata implies:

1. **Notify owners** (comms) — pages the application's owners.
2. **Recover hard dependencies first** — one step per **hard** dependency
   (soft dependencies are skipped), sorted by `app_key`.
3. **Approval gate** — only for `mission_critical` / `tier_1` applications.
4. **Provision each recovery-target environment** — one step per environment
   flagged `is_recovery_target`, bound to its cloud account/region.
5. **Verify application** — health-check against the RTO target.

Each step carries structured params bound to the **real** metadata values. The
runbook is then **linked** to the application, stamped with the
`metadata_revision` it was populated from (the join the sync action diffs).
Re-populating refreshes the link to the current revision. `422` when the
application has no recovery-target environment (an empty runbook is refused).

Response: `{ data: { application_id, app_key, runbook_id, runbook_name,
task_count, source_revision } }`.

---

## 4. Sync (real diff, flags drift)

`POST .../{id}/runbooks/{rid}/sync` performs a **read-only** diff of a linked
runbook against the application's **current** metadata and **flags drift** — it
does not silently re-populate. A runbook is **stale** when the application's
current metadata fingerprint (`metadata_hash`) differs from the fingerprint the
runbook was populated from.

```json
{
  "data": {
    "application_id": "...",
    "runbook_id": "...",
    "drifted": true,
    "kind": "stale",                 // none|stale
    "source_revision": 1,
    "current_revision": 2,
    "source_hash": "...",
    "current_hash": "...",
    "changed_fields": [{ "field": "recovery_tier", "summary": "..." }]
  }
}
```

The fingerprint is the canonical, order-independent projection of the
**drift-relevant** metadata only (tier, RTO target, owners, environments,
dependencies, cloud accounts). Editing a non-drift field (e.g. `description`)
does **not** advance the revision and does **not** flag drift. `404
ErrRunbookNotLinked` when the runbook was never populated from the application.

---

## 5. Persistence

Migration `000037_recover_metastore` (reversible UP + DOWN), six tables, all
RLS-isolated per tenant (the dr_db RLS clone; `app.bypass_rls` reserved for
cross-tenant system paths):

- `recover_metastore_application` — scalars + `metadata_revision` / `metadata_hash`.
- `recover_metastore_owner`, `recover_metastore_environment`,
  `recover_metastore_dependency`, `recover_metastore_cloud_account` — the
  multi-valued metadata (`ON DELETE CASCADE`).
- `recover_metastore_runbook_link` — application↔runbook links with
  `source_revision` / `source_hash` (the drift join). `runbook_id` is a **soft
  reference** to the runbookstudio runbook (no cross-table FK — disjoint
  ownership).

Every mutating write recomputes the metadata fingerprint and advances the
revision **only when the drift-relevant metadata actually changed** (the
`FinalizeRevision` `FOR UPDATE` path), so an idempotent re-save never inflates
the revision and never spuriously flags drift.

---

## 6. Go surface (importable by other backend prompts)

```go
import "github.com/clario360/platform/internal/recover/metastore"

metastore.NewDefaultRegistry(metastore.Config{ Store, Runner, Metrics, Logger, Now })
metastore.NewPopulator(registry, studioSvc) // studioSvc satisfies RunbookAuthor
metastore.NewRouter(registry, populator, logger)

// Prompt 8 (analytics) joins the RTO target from the seam:
app, _ := registry.ResolveApplicationByKey(ctx, tenantID, appKey)
rtoTarget := app.RTOTargetSeconds
```

Observability: `recover_metastore_app_writes_total{op}`,
`recover_metastore_populate_total{tier}`, `recover_metastore_populate_tasks`,
`recover_metastore_sync_total{drifted}` (per-instance registry).

---

## 7. For downstream agents

- **Analytics (Prompt 8):** source the **RTO** from `Application.RTOTargetSeconds`
  via `ResolveApplicationByKey` / `ResolveApplication` (the seam) — never hardcode
  an RTO.
- **Onboarding (Prompt 9):** seed demo applications via
  `DefaultRegistry.CreateApplication` (real seeding into real tables) so the
  Metastore and the dashboards are non-empty.
- **Swappability:** implement `MetastoreClient` against an external CMDB to
  replace the default registry; callers are unchanged.
