# LEX-REQUEST-RETURN-SLA

Client feedback, Requests Page:

> - The request can be reviewed and returned many times between the business
>   entities and the corresponding department with thoughts and comments and many
>   times file uploads until they reach the file copy.
> - The SLA stops if the request is returned to the requestor. A new SLA start
>   over when the requestor sends the request back.

## Findings

**Requirement 1 was already structurally supported.** `requestStatusTransitions`
in `legal_request_service.go` already lets every department-held state move to
`returned`, and `returned → submitted` already exists — so the review/return loop
is unbounded today. `RequestNote` carries per-round comments, and
`legal_request_service.go` already permits attachment upload and edits while a
request is in `draft` **or** `returned`. Nothing in the FSM caps the rounds.

**Requirement 2 was genuinely broken, in two ways.**

1. `legal_sla_clocks` carried `UNIQUE (tenant_id, legal_request_id)` — *"Exactly
   one clock per request"*. A new SLA per submission round was not representable.
2. **Nothing stopped the clock on return.** `Transition(... returned)` never
   touched the SLA. The department was charged for the entire time the request sat
   in the *requester's* court, and a request bounced three times still showed one
   clock started at the first submission.

Worse, the monitor's scan (`ListDue`) filtered on `resolved_at IS NULL`. Because a
returned request's clock was never resolved, it kept **breaching and escalating**
while the requester held it.

## Design

A request's SLA is now a **sequence of clocks, one per submission cycle**:

```
cycle 1   submitted ─────────────► returned    outcome 'stopped'
cycle 2   resubmitted ───────────► delivered   outcome 'on_time' | 'breached'
```

**`stopped` is a fourth, non-judgemental terminal outcome** — deliberately not
`on_time` and not `breached`. A cycle that ended because the department handed the
request back is neither a success nor a failure of the department's turnaround;
folding it into either would corrupt the compliance ratio. Stopped cycles are
excluded from every outcome aggregate.

**The restart needs no separate entry point.** `StartClock`'s idempotency was
re-scoped from *the request* to *the live clock*: a repeated start signal while the
SLA runs returns the running clock, but a start after the previous cycle was
stopped legitimately opens cycle *n+1*, with deadlines materialised afresh from
the resubmission instant against the working calendar. That is exactly "a new SLA
starts over," and it keeps a single owner for clock creation.

**Invariant: at most one live clock per request**, enforced by a *partial* unique
index on `outcome = 'pending'` rather than the old total unique index. Many
historical cycles are allowed; two running clocks are not — so "the active clock"
is always unambiguous and a double-restart cannot race.

## Changes

**Migration `000110_sla_return_cycles`** (applied; `lex_db` now at 110)
- `cycle INT NOT NULL DEFAULT 1` (CHECK `>= 1`), `stopped_at TIMESTAMPTZ`
- outcome CHECK widened to include `'stopped'`; CHECK that `stopped_at` is present
  iff the outcome is `stopped`
- dropped `idx_legal_sla_clocks_request_unique`; added unique
  `(tenant_id, legal_request_id, cycle)` + **partial** unique on `outcome='pending'`
- partial index on `turnaround_due_at WHERE outcome='pending'` for the monitor scan

**Model** — `SLAClock.Cycle`, `SLAClock.StoppedAt`, `SLAClockOutcomeStopped`,
`SLAClockOutcome.Live()`.

**Repository** (`sla_clock_repo.go`)
- `GetActiveByRequest` (live cycle), `MaxCycle`, `StopActiveForRequest`
- `GetByRequest` now `ORDER BY cycle DESC LIMIT 1` — with several clocks possible
  it would otherwise return an arbitrary historical row
- `ListDue` gained `outcome = 'pending'` — **the load-bearing fix**; a stopped
  cycle also has `resolved_at IS NULL`, so without this it keeps breaching

**Service**
- `SLAService.StopClockForRequest` — audited, event-emitting, idempotent and total
  (no running clock ⇒ `(nil, nil)`)
- `ResolveClockForRequest` now resolves the **live** cycle, so a request delivered
  after a return is judged against the round it actually ran, not a stale deadline
- `LegalRequestService` gained the nil-tolerant `slaClockStopper` seam (mirroring
  `approvalStarter`), called on every `→ returned` transition. Best-effort and
  outside the transition transaction: the status flip is authoritative and a
  transient SLA failure must not roll it back.
- wired in `app.go` via `SetSLAStopper(slaService)`

**Analytics fixed for row multiplication.** Several queries joined clocks 1:1 to
requests and would now count a bounced request once per round:
- `detailed_analytics_repo.go` ×2 → `DISTINCT ON (tenant_id, legal_request_id)
  ORDER BY cycle DESC`
- `duration_fact_repo.go` → same, or one duration fact per round for one delivery
- `reporting_repo.go` `OverdueRequestCount` → `COUNT(DISTINCT legal_request_id)`
- `SLAOutcomeCounts` needed **no** change: its `outcome IN ('on_time','breached')`
  filter already excludes stopped cycles, so a bounced request contributes exactly
  one resolved clock

## Verification

- `go build ./...` clean; `go test ./internal/lex/... -count=1` green, 0 failures
- 5 new tests in `sla_return_cycle_test.go` covering the unbounded return loop,
  `stopped` validity/liveness, its exclusion from compliance, the `ListDue` fix,
  and the schema invariants
- Migration dry-run **up and down** inside a rolled-back transaction, then proved
  against live `lex_db`: a second live clock is rejected (`UniqueViolation`);
  after stopping cycle 1, cycle 2 is accepted (the return→resubmit path);
  `stopped` without `stopped_at` is rejected (`CheckViolation`)

## Round stamping and UI (migration 000112)

The round counter is authoritative on **`legal_requests.cycle`**, not derived from
`legal_sla_clocks`: notes and attachments exist while a request is still a draft,
long before completeness confirmation materialises any clock, so deriving from the
clock would leave every pre-clock note unstamped.

- `legal_requests.cycle` increments on `returned → submitted` **inside the guarded
  transition transaction**, so it can never diverge from the status.
- `legal_request_notes.cycle` and `legal_request_attachments.cycle` are stamped by
  a subquery **in the INSERT itself** — a caller cannot forget it, and it cannot
  drift between a read and a write.
- The SLA clock now adopts the request's round (`resolveClockCycle`), falling back
  to `max(clock cycle)+1`, so "SLA cycle 2" and "round 2 of the conversation" are
  the same number everywhere they are shown.
- Backfill sets each request's counter from its highest existing SLA cycle;
  everything else is round 1, the honest reading for history where the return
  count was never recorded.

**Frontend.** `groupByReviewRound` turns the flat, chronologically-ordered thread
into rounds; `ReviewRoundSeparator` marks the boundaries in the notes thread and
the attachments panel; `SlaRoundBanner` names the round on the SLA panel and, when
the round was stopped, states plainly that the pause is **not** a breach — a halted
clock next to a passed deadline otherwise reads as one.

Separators render only from round 2. A request that was never returned has one
round, and labelling it adds chrome without information.

## Verification

- `go build ./...` clean; `go test ./internal/lex/... -count=1` green
- `tsc --noEmit` clean; eslint 0 errors on all changed files
- Frontend: **1191 passed**, plus 11 new `review-rounds` cases covering ordering,
  numeric (not lexicographic) round sort, gaps, and the fallback that files a row
  with a missing/invalid cycle under round 1 rather than dropping a real comment.
  The 2 failures in the wider lex run are the known pre-existing
  `command-hero` / `operational-dashboard-kpis` cases, unrelated to this work.
- Both migrations dry-run up **and** down in a rolled-back transaction before
  being applied; `lex_db` is at **112**, clean, with `cycle` on all four tables.
  Stamping was proved end-to-end: with a request at round 3, an inserted note came
  back stamped `3`.

> Migration numbering collided mid-flight — a concurrent process took `000111`,
> and this work was renumbered to `000112`. Worth noting because the lex embedded
> migrator **FATALs at startup on duplicate migration numbers**, so the collision
> would have taken the service down rather than failing quietly.

## Still not done

- No "returned — awaiting your resubmission" call-to-action on the requests list.
  The data supports it (`status = 'returned'` plus the round counter); it is a
  list-surface design question rather than missing plumbing.

## Worth confirming with the client

1. **Does the acknowledgement window restart too, or only turnaround?** Currently
   the whole clock re-materialises, so a resubmitted request must be re-acknowledged.
   That seems right, but it is a policy choice.
2. **Should repeated returns be visible as a quality signal?** The data now
   supports "this request was bounced four times"; whether that should surface on
   the dashboard (and count against anyone) is a product decision.
3. **Does a return reset the priority-based SLA target?** If a request is
   re-prioritised between rounds, the new cycle picks up the *current* target. That
   is the honest reading, but it means a downgrade mid-flight lengthens the deadline.
