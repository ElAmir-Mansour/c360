# Recover — Audit Trail & Regulatory Evidence (Prompt 10, the "Prove" surface)

An **immutable, append-only audit trail** across all three Recover sub-solutions
(IT DR, Cloud DR, Cyber Recovery), plus a **regulator-ready evidence export** in
**CSV and PDF**. It COMPOSES existing services — it owns no recovery logic and
writes nothing on the read paths.

Builds: `GOWORK=off go build ./internal/recover/... ./internal/dr/...`.
Tests (happy / failure / edge / authz-denied / concurrency, all green):
`GOWORK=off go test ./internal/recover/...`.

---

## 1. Append-only audit log (the spine)

Every recovery/rehearsal action records **who / what / when / which app-runbook-
event** to one immutable table: `recover_audit_event` (migration `000040`,
reversible UP+DOWN, applies & rolls back cleanly).

**Append-only at BOTH layers — no UPDATE or DELETE code path exists:**

- **Service layer** (`audit.go`, `audit_store.go`): `AuditStore` exposes exactly
  three methods — `Append`, `ListForEvent`, `ListRecentEvents`. There is no
  update/delete/mutate method on the interface, on `*SQLAuditStore`, or on
  `*AuditService`. `audit_store.go` contains exactly one write statement (an
  `INSERT`) and two `SELECT`s.
- **Database layer** (`000040` migration): the table runs `FORCE ROW LEVEL
  SECURITY` with a `FOR SELECT` read policy and a `FOR INSERT` append policy and
  **no UPDATE/DELETE/ALL policy**, so a non-superuser application role is denied
  UPDATE and DELETE (verified: `UPDATE 0` / `DELETE 0`). Same pattern as
  `000039_recover_analytics_snapshot`.

Proven by test: `TestAudit_AppendOnly_NoUpdateOrDeletePath` (reflection asserts no
mutator method exists and the interface has exactly the append+read trio),
`TestAudit_Store_HasNoUpdateOrDeleteSQL`, `TestAudit_Record_AppendsImmutably`,
`TestAudit_Record_Concurrent`.

### Recording an action (producer seam)

```go
audit.Record(ctx, tenantID, recover.AuditRecord{
    EventID:     runID,                       // the recovery event being audited
    SubSolution: recover.AuditSubSolutionITDR, // it_dr | cloud_dr | cyber_recovery
    Action:      recover.ActionRunbookRunCompleted,
    Actor:       recover.AuditActor{ID: &userID, Email: "op@bank.test"},
    ApplicationID: &appID, RunbookID: &rbID,
    Summary:     "runbook completed",
    Detail:      map[string]any{"rta_seconds": 900},
})
```

`Record` runs its own tenant-scoped transaction. `RecordTx` appends using a DBTX
the caller already holds, so a producer can write the audit row **atomically**
with the state transition it audits.

**Cyber Recovery is wired in:** `cyberrecovery.Service` accepts an optional
`AuditSink`; when set, every flow transition (select → provision → run →
integrity gate → request approval → approve → return-to-production / abort) emits
one unified audit row **in the same transaction** as the flow's own append-only
transition log. The adapter is `recover.NewCyberAuditSink(auditSvc)` (cmd wires
`Config.Audit`). Proven by `cyberrecovery.TestCyberRecovery_AuditSink_RecordsEveryAction`.

---

## 2. Endpoints (mounted under `/api/recover`)

All behind the same Auth+Tenant middleware as the rest of Recover; each self-gates
on `dr:read`, and the service additionally enforces a **Recover entitlement**
(any of the three sub-solution keys) server-side before returning any data.

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/api/recover/evidence` | `dr:read` + any `recover.*` | The "Prove" event list (audited recovery events, newest first). `?per_page` bounds it. |
| `GET` | `/api/recover/evidence/{eventId}` | `dr:read` + any `recover.*` | The full JSON evidence report. |
| `GET` | `/api/recover/evidence/{eventId}/export?format=csv\|pdf` | `dr:read` + any `recover.*` | The regulator-ready CSV / PDF download (default `pdf`). |

**Errors:** `401 unauthorized`, `402 not_entitled`
(`details.upgrade_url=/register?suites=recover&plan=trial`),
`404 not_found` (no evidence for the event), `400 bad_request` (bad uuid / format),
`503 entitlement_unavailable` (licensing outage — **fail-closed**), `500 internal`
(no stack trace leaked).

---

## 3. The evidence report (composed, real data)

`GET /evidence/{eventId}` resolves the event against the **existing** records and
composes one report. `{eventId}` is the recovery event — a runbookstudio **run
id** (IT/Cloud DR) or a cyber-recovery **flow id**.

- **Runbook executed + RTO vs RTA** — the `dr_studio_run` record joined to its
  application via the Metastore runbook link. **RTO target comes from the
  Metastore seam** (`Application.RTOTargetSeconds`) — never hardcoded; RTA is the
  run's captured `actual_duration_seconds`.
- **Integrity-check results** — the cyber-recovery flow's gate verdict
  (`recover_cyber_recovery_flow`), passed/failed.
- **Approvals** — the flow's authorized return-to-production sign-off, pinned to
  the integrity scan it was granted against (provenance).
- **Full timeline** — the append-only `recover_audit_event` log for the event,
  chronological.

Sections an event has no records for are **empty** — never a placeholder.

CSV: a flat, section-tagged document (`evidence_csv.go`, stdlib `encoding/csv`).
PDF: a **real PDF** via `github.com/jung-kurt/gofpdf` (`evidence_pdf.go`), starting
with the `%PDF-` magic and ending `%%EOF`. Both carry every section. Proven by
`TestEvidence_RenderCSV_Complete`, `TestEvidence_RenderPDF_ValidDocument`,
`TestEvidenceHandler_Export_ContentTypes`.

---

## 4. Wiring (Wire agent — route registration in `internal/recover/router.go`)

`Router` gained an optional `Evidence *EvidenceHandler` field. The Routes() block
(already applied in this change):

```go
// Audit trail & regulatory evidence export (Prompt 10): the "Prove" surface.
if h.Evidence != nil {
    r.Group(func(r chi.Router) {
        r.Use(middleware.RequirePermission(auth.PermDRRead))
        r.Get("/evidence", h.Evidence.listEvents)
        r.Get("/evidence/{eventId}", h.Evidence.getReport)
        r.Get("/evidence/{eventId}/export", h.Evidence.export)
    })
}
```

`cmd/clario-dr-service/recover.go` constructs the audit + evidence services over
the dr_db pool, the same `metastoreRegistry` (the RTO seam) and `resolver`, and
sets `router.Evidence = recoverproduct.NewEvidenceHandler(evidenceSvc, logger)`.
To activate the cyber-recovery producer, set
`cyberrecovery.Config.Audit = recoverproduct.NewCyberAuditSink(auditSvc)` where
the cyber-recovery service is constructed.

## 5. Frontend

`app/(dashboard)/recover/prove/` — the "Prove" surface lists audited recovery
events with a one-click CSV/PDF compliance export per event and an expandable
regulator-ready report. Client lib: `lib/recover/evidence.ts` +
`lib/recover/use-evidence.ts`; types: `types/recover-evidence.ts`. The export
downloads through the authenticated axios pipeline (`apiGetBlob`) since the access
token is in-memory.
