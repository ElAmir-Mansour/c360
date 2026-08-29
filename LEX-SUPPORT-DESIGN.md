# LEX-SUPPORT-DESIGN

Design for the client's **internal support request** feature.

> *"This function is an internal support request. Example, a user from Contracts
> request a help from another user from Cases department. He/she can ask for help
> and Choose the department and assign a user from that department. We can add a
> time frame, so when the time period ends, the support request must be disappear.
> The idea might not be clear and we can discuss about it."*

---

## 1. What this is — and what it is not

This is **peer-to-peer help between legal staff**, and it is a genuinely new
concept in the module. It must not be confused with the two things it resembles:

| | Who asks | Who answers | Governance |
|---|---|---|---|
| **Service Desk** (`lex_requests`) | a *business* user outside legal | the legal department | SLA-bound, approval routing, deliverable, feedback loop |
| **Case collaboration** (`case_comments`) | legal staff | legal staff | a comment thread on one case; no assignee, no deadline, no state |
| **Support** (this design) | a *legal* user | a *named* legal colleague in another org unit | lightweight, time-boxed, self-clearing |

Support is deliberately the *thin* one: no approval chain, no deliverable, no
four-eyes. If it grows those, it has become a service request and should be one.

## 2. The substrate already exists

Almost everything this feature needs is already built. Confirmed by inspection:

**The org tree — and the client's exact example works today.**
`legal_org_entities` is a real adjacency tree (`parent_id` + denormalised
`path TEXT[]`), `legal_org_memberships` is the rank-and-file roster with a
`manager_user_id` reports-to edge, and it is populated in `lex_db` right now:

```
CASES     (section)     6 members
CONTRACTS (section)     5 members
LEGAL     (department)  4 members
```

So "a user from Contracts asks a user from Cases" is expressible against live
data on day one.

> **Two corrections to `LEX-LD-DISCOVERY.md` §2.2**, which was written when
> `lex_db` was at schema version 103: `legal_org_memberships` **does now exist and
> is populated** (15 rows) — it is no longer the missing table that document
> flags. Also, CASES and CONTRACTS are `entity_type='section'`, not `'department'`.
> The client says "department" colloquially; **the feature must target any org
> entity that has members, not hard-code `entity_type='department'`**, or the
> client's own example would not work.

**Assignee validation is already written.**
`CaseAssignmentValidator` + `CaseAssignmentOrgDirectory.ListActiveMemberships(ctx,
tenantID, entityID)` is precisely "list the users in the chosen department" *and*
the server-side proof that a submitted assignee really belongs to it. Reuse it
rather than re-deriving; the client-supplied assignee must never be trusted.

**The expiry sweeper has a working precedent.**
`internal/lex/monitor` holds ten monitors driven from `cmd/lex-service/main.go`:

```go
deliveryAutoCloseMonitor := lexmonitor.NewDeliveryAutoCloseMonitor(
    app.DeliveryConfirmationService, lexCfg.DeliveryAutoCloseInterval, logger)
go runBackground(ctx, logger, "lex-delivery-autoclose-monitor", deliveryAutoCloseMonitor.Run)
```

`DeliveryConfirmationService.AutoClose` + `ListTenantIDs` (tenant fan-out) is the
closest semantic twin that exists: *an unanswered thing past its deadline gets
resolved by a background job*. Clone that shape exactly.

**Also reusable:** `sla_business_calendar.go` (so a "3 day" window means three
*working* days in the tenant's calendar, not 72 wall-clock hours over a Saudi
weekend), the `Publisher` + outbox notification path, and `/lex/inbox` as the
personal work surface where an incoming ask belongs.

## 3. The one real design problem: "must disappear"

The client's words are *"the support request must be disappear."* Taken
literally — delete the row — this breaks three things:

1. **Audit.** Lex runs on an append-only audit substrate. A legal module that
   silently destroys records of who asked whom for help is not defensible.
2. **Workload truth.** If a colleague spent three hours helping, deleting the
   record erases that effort. The Team Workload panel and
   `GET /lex/reports/workforce` would under-report their real load — the exact
   metric a Legal Director uses to judge capacity.
3. **Recurrence.** "Contracts asks Cases for help on VAT clauses every quarter"
   is a staffing signal. Deleting it destroys the only evidence.

**Design: "disappear" means disappears from the *active work surface*, not from
the database.** On expiry the row transitions to a terminal `expired` status and
drops out of inboxes, open lists, badge counts and workload totals. It remains
readable in history and in reporting.

This satisfies what the client actually wants — *my inbox does not fill with
stale asks* — without lying to the audit trail. It is the first thing to confirm
in the discussion the client invited.

## 4. Data model

Migration `000106_lex_support_requests` (000105 is now taken and applied).

```sql
CREATE TABLE lex_support_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,

    -- WHO
    requester_id      UUID NOT NULL,
    requester_entity_id UUID REFERENCES legal_org_entities(id),  -- asker's own unit, denormalised for reporting
    target_entity_id  UUID NOT NULL REFERENCES legal_org_entities(id),  -- "choose the department"
    assignee_id       UUID NOT NULL,                                    -- "assign a user from that department"

    -- WHAT
    subject           TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
    body              TEXT NOT NULL DEFAULT '',
    priority          TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high')),

    -- OPTIONAL CONTEXT: pin the ask to the work item it is about.
    -- Deliberately a loose (type, id) pair, NOT six nullable FKs.
    subject_type      TEXT CHECK (subject_type IN
                        ('case','contract','consultation','matter','investigation','request')),
    subject_id        UUID,

    -- STATE
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN
                        ('open','accepted','resolved','declined','expired','cancelled')),
    resolution_note   TEXT NOT NULL DEFAULT '',

    -- TIME FRAME (§5)
    expires_at        TIMESTAMPTZ,          -- NULL = no time frame, stays until acted on
    accepted_at       TIMESTAMPTZ,
    closed_at         TIMESTAMPTZ,          -- set on any terminal status

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT ck_subject_pair CHECK (
        (subject_type IS NULL AND subject_id IS NULL) OR
        (subject_type IS NOT NULL AND subject_id IS NOT NULL))
);

-- The helper's inbox: my open asks, soonest-expiring first.
CREATE INDEX idx_lex_support_assignee_open ON lex_support_requests
    (tenant_id, assignee_id, status, expires_at)
    WHERE deleted_at IS NULL;

-- The requester's list.
CREATE INDEX idx_lex_support_requester ON lex_support_requests
    (tenant_id, requester_id, created_at DESC) WHERE deleted_at IS NULL;

-- The sweeper's scan: only ever open/accepted rows with a deadline.
CREATE INDEX idx_lex_support_due ON lex_support_requests (expires_at)
    WHERE status IN ('open','accepted') AND expires_at IS NOT NULL AND deleted_at IS NULL;
```

Plus RLS `ENABLE` + `FORCE` with the four `app.current_tenant_id` policies, per
the `lex_db` template (000076–000078, and 000105 which follows it).

**Why the loose `(subject_type, subject_id)` pair:** the ask may be about a case,
a contract, or nothing at all. Six nullable FK columns would need a six-way
mutual-exclusion constraint and a schema migration per new domain. The trade-off
is no referential integrity on `subject_id` — accepted deliberately, and the read
path must tolerate a dangling reference by degrading to a plain label.

## 5. Time frame semantics — the key ambiguity

The client's phrasing supports two genuinely different features, and they behave
oppositely on expiry:

**(a) A deadline for the helper** — "answer me within 2 days." Expiry is a
**failure**: it should notify, and arguably escalate to the assignee's
`manager_user_id`. This is SLA-shaped.

**(b) A validity window on the ask** — "I need this for the next 2 days; after
that it is moot." Expiry is **benign**: silent cleanup, nobody is at fault.

The phrase *"the support request must disappear"* points at **(b)** — you do not
silently vanish a missed obligation. **Design for (b), and make (a) reachable
later** by adding an escalation branch to the same monitor. Getting this wrong in
either direction produces either nagging escalations for something informal, or a
help request that quietly evaporates when someone was counting on it.

**Duration is entered as a business-day count, not a raw timestamp.** Resolve it
through the existing `sla_business_calendar.go` so a Thursday +2 days in a KSA
tenant lands on Monday, not Saturday. Persist the resolved `expires_at`; never
recompute it on read.

**Expiry only applies to non-terminal rows.** An `accepted` request that is being
actively worked still expires under (b), which is arguably wrong — see the open
questions.

## 6. State machine

```
              ┌──────────► declined ──┐
              │                       │
  open ───────┼──────────► accepted ──┼──► resolved      (terminal)
    │         │              │        │
    │         └──────────────┴────────┴──► expired       (terminal, by monitor)
    │
    └────────────────────────────────────► cancelled     (terminal, by requester)
```

- **open → accepted / declined** — assignee only.
- **accepted → resolved** — assignee marks it done with an optional note.
- **open|accepted → expired** — the monitor only. Never a user action.
- **open|accepted → cancelled** — requester only.
- Terminal states are final: no reopen. If help is needed again, ask again — the
  new row carries its own honest timestamps. (This mirrors how the module treats
  other terminal states, and avoids a reopen path that corrupts duration metrics.)

`closed_at` is stamped on every terminal transition so "how long did this take"
is a single subtraction rather than a status-history join.

## 7. Expiry monitor

New `internal/lex/monitor/support_expiry_monitor.go`, cloned from
`delivery_autoclose_monitor.go`:

```go
supportExpiryMonitor := lexmonitor.NewSupportExpiryMonitor(
    app.SupportRequestService, lexCfg.SupportExpiryInterval, logger)
go runBackground(ctx, logger, "lex-support-expiry-monitor", supportExpiryMonitor.Run)
```

- Tenant fan-out via a `ListTenantIDs`-style query (only tenants with due rows).
- The sweep is a **single bounded `UPDATE ... WHERE status IN ('open','accepted')
  AND expires_at <= now()`** returning the affected rows — not a select-then-loop,
  so two monitor replicas cannot double-expire.
- Interval from config, defaulting around 5 minutes. Expiry is not
  latency-critical; a request lingering four extra minutes is harmless, and a
  tight loop taxes the database for no benefit.
- Emit one metric (`lex_support_requests_expired_total`) so the ratio of expired
  to resolved is visible — a high expiry rate means the feature is not working,
  and nobody will notice otherwise.
- The monitor is the **only** writer of `expired`.

## 8. Permissions

Following the module's `lex:<domain>:<verb>` convention:

| Permission | Grants |
|---|---|
| `lex:support:view` | see support requests you are party to |
| `lex:support:create` | raise a request |
| `lex:support:respond` | accept / decline / resolve one assigned to you |
| `lex:support:oversee` | see all support traffic within your org subtree |

**Visibility rule — enforce server-side, never by filtering in the client:** a row
is readable if you are the requester, the assignee, **or** you hold
`lex:support:oversee` and the row's `target_entity_id` or `requester_entity_id`
falls inside your subtree (via `legal_org_entities.path`). This is the same
subtree-scoping the workforce report already performs, so the logic is not new.

Grant `view`/`create`/`respond` to the operational legal roles by default;
`oversee` to `legal-director`, `department_manager`, `section_supervisor`. Unlike
`lex:ai:use`, there is no reason to ship this dark — it is low-risk and useless
without grants.

## 9. API

```
POST   /api/v1/lex/support-requests                 create
GET    /api/v1/lex/support-requests                 list  (?box=inbox|sent, ?status=, ?entity_id=)
GET    /api/v1/lex/support-requests/{id}            detail
POST   /api/v1/lex/support-requests/{id}/accept
POST   /api/v1/lex/support-requests/{id}/decline    { note }
POST   /api/v1/lex/support-requests/{id}/resolve    { note }
POST   /api/v1/lex/support-requests/{id}/cancel     requester only

GET    /api/v1/lex/support-requests/directory       the two-step picker (§10)
```

`directory` returns the org entities the caller may direct a request to, and —
given `?entity_id=` — that entity's active members from
`ListActiveMemberships`. One endpoint, because the picker is one interaction and
two round-trips for a two-step dropdown is wasteful.

**`expires_at` is server-computed** from a submitted business-day count. Never
accept a client-supplied absolute timestamp: it invites clock-skew bugs and lets
a caller forge a window that outlives policy.

## 10. Frontend

**Entry points.** A global "Ask for support" action (top-bar quick action), plus a
contextual one on case/contract/consultation detail pages that pre-fills
`subject_type`/`subject_id`. The contextual path is the one that will actually get
used — asking for help almost always happens *while looking at the thing*.

**The picker is strictly two-step and dependent:** department first, then
assignee, where the assignee list is empty until a department is chosen and is
sourced from that department's roster. This mirrors the client's own description
and makes the invalid state (assignee not in the chosen department)
unrepresentable in the UI as well as rejected on the server.

**Helper's surface:** `/lex/inbox` gains an incoming-support section. This is the
existing personal work surface; a separate page would be a second inbox nobody
checks.

**Requester's surface:** a "sent" tab on the same screen.

**Time-frame control:** a business-day count with a resolved plain-language echo
("expires Monday 4 Aug"), so the working-calendar arithmetic is visible rather
than surprising.

**Countdown, then silence.** While open, show remaining time. On expiry the row
leaves the active list — matching the client's "disappear" — and is reachable only
under a History filter. Do not grey it out in place; that is not disappearing.

All copy bilingual en/ar from the start, `useLexFormat()` for dates and numbers,
per the module's standing rules.

## 11. Reporting and workload integration

`GET /lex/reports/workforce` already computes per-person load, and the Legal
Director dashboard renders it. Support asks are real work, so:

- Count `open` + `accepted` support requests toward the assignee's active load,
  as a **distinct domain** (`support`) alongside contracts/cases/consultations —
  so the workforce report's existing per-domain masking applies unchanged.
- Terminal rows leave the active count but stay in historical aggregates.

This closes the loop the client's feature implies: if Cases is constantly
absorbing Contracts' overflow, the Legal Director's Team Workload panel should
show it. Support requests that are invisible to workload reporting would
systematically under-count the busiest people.

## 12. Questions for the client

They explicitly invited discussion. In priority order:

1. **On expiry — cleanup or breach?** (§5) Does an unanswered request vanish
   quietly, or is missing the window a failure that notifies and escalates to the
   assignee's manager? Everything else follows from this.
2. **Does "disappear" mean deleted?** We propose it leaves active surfaces but is
   retained for audit and workload history (§3). Confirm that is acceptable.
3. **Can the helper decline?** Or is assignment binding? A decline path is
   strongly recommended — the alternative is silent non-response, which looks
   identical to neglect.
4. **Does an accepted, in-progress request still expire?** Expiring work someone
   is actively doing seems wrong; the likely answer is that accepting freezes or
   extends the clock.
5. **One assignee or several?** The description says one. Multi-assignee is a
   materially different feature (who owns it? does one response close it?) and
   should not be added by accident.
6. **Can the requester extend the window?** And how many times — an unlimited
   extension makes the time frame decorative.
7. **Cross-tenant / cross-company:** the org tree spans `business_unit` and
   `company`. May a user in one company ask someone in another, or is support
   confined to a subtree?

## 13. Sequencing

**Phase 1 — the client's described feature.** Table + RLS, service with the state
machine, the six endpoints, the two-step picker, inbox integration, expiry monitor,
notifications on create/accept/resolve. This is a self-contained vertical slice
and is genuinely small because the org tree, the validator, the monitor harness
and the notification path all already exist.

**Phase 2 — make it observable.** Workforce/domain integration (§11), the
`oversee` manager view, and the expired-vs-resolved metric.

**Phase 3 — only if asked.** Escalation on expiry, extensions, multi-assignee,
support-load analytics. Each of these is a step toward re-inventing the service
desk; take them one at a time and only on evidence.
