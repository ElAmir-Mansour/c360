# LEX-SUPPORT-CONTEXT-AND-APPROVAL

Four asks on the Support feature, verified against the code.

> 1. The requestor should be able to link the case number or contract number to every request.
> 2. The "ask for support" action should be on every detail page — contract, case, investigation, task, consultation.
> 3. Also for collaboration — must be about the detail page.
> 4. Each support request should go to the **manager of the requestor for approval** before routing to the colleague who provides the support.

## Verdict

| # | Ask | State |
|---|---|---|
| 1 | Link a case/contract to the request | **Backend done, FE half-done** |
| 2 | Support action on each detail page | **Seam built, mounted nowhere** |
| 3 | Collaboration per detail page | Needs scoping — see §3 |
| 4 | Manager approval before routing | **Net-new** — state machine + migration |

---

## 1. Subject linkage — mostly already there

The backend is complete. `lex_support_requests` carries `subject_type` + `subject_id`
with a CHECK enforcing they are set together, and the Go model defines all six
types (`case`, `contract`, `consultation`, `matter`, `investigation`, `request`).
The FE client already sends both.

The composer even auto-binds context from the URL:

```ts
supportContextFromPathname('/lex/cases/<uuid>')  // → { subjectType: 'case', subjectId }
```

**Two real gaps:**

- **It shows the type, not the record.** The dialog renders `Linked to this case`
  — never the case *number*. The client asked to link "the case number or contract
  number", and a user cannot confirm they attached the right record from the word
  "case" alone. Resolve and display the human identifier (`CASE-2026-014`, the
  contract number) next to the type.
- **It cannot be set anywhere else.** Binding is implicit and URL-only, so from
  the Learning Centre (the screenshot) or the inbox there is no way to link a
  record at all. Add an optional record picker — searchable, by number — so a
  request raised away from the record can still be attached to one.

The picker should default to the URL-derived record when there is one, and stay
clearable: not every support request is about a specific file.

## 2. Detail-page entry points — the seam exists, nothing uses it

`support-composer.tsx` already exports everything needed:

```ts
openLexSupportComposer(context?)   // imperative seam
AskForSupportButton({ context })   // ready-made button
```

The button's own comment says it is the *"imperative seam for any
case/contract/consultation detail action"*. It is mounted in exactly **two**
places — the top bar and the inbox. **No detail page mounts it.**

So this is a mounting job, not a build. Add `AskForSupportButton` to the action
bar of each detail surface:

| Surface | Action bar | URL pattern already matched? |
|---|---|---|
| Case | `cases/[id]` | yes |
| Contract | `contracts/[id]` | yes |
| Consultation | `consultations/[id]/_components/consultation-action-bar.tsx` | yes |
| Investigation | `investigations/[id]` | yes |
| Matter | `matters/[id]` | yes |
| **Task** | `tasks/page.tsx` | **no — and there is no task detail route** |

**Tasks is the exception worth flagging.** `/lex/tasks` is a single list page with
no `[id]` detail route, and `task` is not one of the six `subject_type` values the
backend accepts. Supporting it means either adding a task detail page and a
seventh subject type (a schema change), or attaching the request to the task's
*parent* record instead. That is a product call — the other five are trivial.

Because the context is passed explicitly, each button binds its own record and no
longer depends on URL parsing — which also fixes nested routes (e.g. a contract's
approval sub-page) binding correctly.

## 3. Collaboration on the detail page

This one needs the client to be more specific before anything is built. Cases
already have a `CollaborationPanel` (comments + @mentions, per-record); contracts,
consultations and investigations have their own comment surfaces of varying
completeness.

Two plausible readings:

- **(a)** "Put the same *contextual affordance* pattern on collaboration" — i.e. a
  consistent comment/mention panel on every detail page, the way support is
  getting a consistent button. Sensible, and mostly a consolidation job.
- **(b)** "Collaboration requests should work like support requests" — i.e. invite
  a named colleague to collaborate on *this record*, which is closer to a second
  flavour of the support request.

**(a) is the cheaper and more likely reading**, but the two differ enormously in
cost. Worth one question before committing.

## 4. Manager approval — the significant change

Today a support request goes **straight to the colleague**:

```
open → accepted → resolved | declined | expired | cancelled
```

The client wants the requester's manager to approve first:

```
pending_manager_approval ──approve──► open → accepted → resolved
            │
            └──reject──► rejected (terminal)
```

`open` keeps its meaning — "routed to the colleague" — and gains a gate in front
of it. Nothing downstream of `open` changes.

### 4.1 Who is the manager — and the 3-in-19 problem

`legal_org_memberships.manager_user_id` already models the reports-to edge, so no
new relationship is needed. But in the live demo tenant:

```
active memberships: 19
with a manager set: 16
```

**Three people have no manager.** Their support requests would have no approver
and would sit in `pending_manager_approval` forever — a silent dead end that
looks exactly like the "no actions can be performed" complaint from the
Investigations feedback.

This must be decided before build, not discovered in production. Options:

- **(a) Fall back to the org-unit head** — resolve up the `legal_org_entities`
  tree to the `department_manager` / `legal_director` role holder. Most faithful
  to intent; a legal director genuinely has no manager but does have a peer above
  the unit.
- **(b) Auto-approve when no manager exists**, and record that it was auto-approved
  rather than approved by a person. Honest in the audit trail, weakest control.
- **(c) Block with a clear message** naming who to contact to fix the org data.

**Recommend (a) with (b) as the terminal fallback**, so a request is never
silently stuck. Whichever is chosen, the *reason* must be recorded — a request
that skipped human approval should say so on its face.

Also worth deciding: a **self-approval rule**. If the requester *is* the manager,
approving their own request is a four-eyes breach — but blocking it strands them.
Recommend auto-approve-with-reason rather than a self-approval click.

### 4.2 Schema

Migration `000118` (verify at author time — this repo has had four numbering
collisions, and the embedded migrator FATALs on duplicates):

```sql
ALTER TABLE lex_support_requests
    ADD COLUMN approver_user_id   UUID,          -- resolved at creation, frozen
    ADD COLUMN approval_decided_at TIMESTAMPTZ,
    ADD COLUMN approval_note      TEXT NOT NULL DEFAULT '',
    ADD COLUMN approval_route     TEXT NOT NULL DEFAULT 'manager'
        CHECK (approval_route IN ('manager','unit_head','auto_no_manager','auto_self'));
```

Then widen the status CHECK to admit `pending_manager_approval` and `rejected`,
and extend the closed_at invariant so `rejected` is terminal.

**The approver is resolved and frozen at creation.** Resolving it lazily at
approval time would mean an org-chart edit silently reassigns in-flight requests.

**Default the status to `pending_manager_approval`** — but note the existing row
(`status='open'`, 1 row in the demo tenant) predates the gate. Backfill it to
`open` with `approval_route='auto_no_manager'` rather than retroactively demanding
an approval that never happened.

### 4.3 The expiry window must start at approval

This is the subtle one. The validity window (`expires_at`) is currently computed
from creation. With a gate in front, **a slow manager would eat the colleague's
entire window** — a 2-day request approved on day 2 arrives already expired.

So `expires_at` must be materialised **when the request is approved**, not when it
is created, using the same tenant working calendar. While pending, the request has
no expiry clock at all.

Whether the *approval itself* should have a deadline (and what happens if the
manager never acts) is a separate question for the client — the same "cleanup or
breach" question from the original support design.

### 4.4 Surfaces

- The manager needs the pending request in their **inbox** — the existing support
  panel there already lists requests; it needs a "pending my approval" group with
  approve/reject in place, matching the inline-decision pattern.
- The requester needs to see it is **awaiting approval**, and by whom — otherwise
  it looks like the request vanished.
- The colleague must **not** see it until it is approved. The assignee query must
  exclude `pending_manager_approval`, or the gate is cosmetic.

Notification on: submitted-for-approval (to the manager), approved (to requester
and colleague), rejected (to requester, with the note).

## Sequencing

1. **Mount the button on the five detail pages** (§2) — trivial, seam already
   built, immediate visible win.
2. **Show the record number, add the picker** (§1) — small, backend already done.
3. **Manager approval** (§4) — migration, state machine, approver resolution,
   inbox surface, notifications. The real work.
4. **Collaboration** (§3) — after the client clarifies (a) vs (b).

## Questions for the client

1. **Tasks have no detail page** and `task` is not an accepted subject type. Add
   one, or attach task support requests to the parent record?
2. **Collaboration** — reading (a) or (b) in §3?
3. **Three users have no manager.** Fall back to the unit head, auto-approve, or
   block? (Recommend unit head, then auto-approve with the reason recorded.)
4. **Should the approval step itself have an SLA**, and what happens if the manager
   never responds?
5. **Can a manager edit the request before approving** — e.g. redirect it to a
   different colleague — or only approve/reject as submitted?
