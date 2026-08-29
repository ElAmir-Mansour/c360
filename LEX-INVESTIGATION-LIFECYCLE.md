# LEX-INVESTIGATION-LIFECYCLE

Client feedback, Investigations page:

> On the Investigations page, there are four investigation categories in the first
> row, followed by another four options below. The concept is excellent (Fraud
> Investigations, Compliance Audits, Digital Evidence, and Board Review). However,
> when entering any of them, their purpose is unclear. Each appears to have its own
> lifecycle, but no actions can actually be performed. How can an investigation be
> moved from Approved to Closed? There is no defined lifecycle for the investigation
> itself.

---

## 1. Diagnosis: the lifecycle exists. The UI hides it.

This is not a missing feature. It is a **discoverability defect**, and the direct
question has a surprising answer.

**"How can an investigation be moved from Approved to Closed?"** — that edge is
already implemented, end to end:

| Layer | Evidence |
|---|---|
| Backend FSM | `investigationStatusTransitions[Approved] = {Closed}` |
| HTTP route | `POST /investigations/{id}/status` |
| FE API client | `lexInvestigationsApi.updateStatus` |
| FE transition map | `INVESTIGATION_STATUS_TRANSITIONS.approved = ['closed']` |

All four agree. Clicking the status badge on an **approved** investigation should
already offer Closed. The client never got that far — because the investigation
could not reach `approved` in the first place.

### 1.1 The actual defect — the forward path is fragmented across five endpoints

The generic status endpoint owns only **two** forward edges. Every other forward
move is driven by a different, domain-specific endpoint:

```
registered ──[POST /status]────────────► in_progress
in_progress ──[POST /results]──────────► results_recorded
results_recorded ──[POST /approval/start]──► pending_approval
pending_approval ──[POST /approval/decide]─► approved | rejected
approved ──[POST /status]──────────────► closed
```

Now read the generic transition map the status dialog is built from:

```ts
registered:       ['in_progress', 'cancelled'],
in_progress:      ['cancelled'],            // ← the trap
results_recorded: ['in_progress', 'cancelled'],
pending_approval: [],
approved:         ['closed'],
rejected:         ['in_progress', 'cancelled'],
```

**From `in_progress`, the only offered move is `cancelled`.** A user who opens an
active investigation, clicks the status badge looking for "what next", and is
shown a single option — *Cancel* — will reasonably conclude there is no lifecycle.
That is precisely the report we received.

The forward action they needed (*Record results*) exists, but lives on a different
screen, behind a different verb, with nothing on the status control pointing to it.

**Nothing is broken. Nothing is missing. The lifecycle is simply not narrated.**

### 1.2 The second complaint — two rows of four that are not the same kind of thing

The page renders two visually parallel rows:

- **Row 1** — four `<Link>` buttons to `/lex/investigations/{fraud,compliance,forensics,board-review}`
- **Row 2** — four `PresetButton`s that apply a saved filter to the list in place

Same size, same shape, adjacent — and semantically unrelated: one navigates away,
the other filters what you are looking at. Presented identically, the only way to
learn the difference is to click.

### 1.3 The third complaint — the category pages are dashboards, not workspaces

Each category route is a five-line file:

```tsx
export default function FraudInvestigationsPage() {
  return <InvestigationDeepDashboard variant="fraud" />;
}
```

`InvestigationDeepDashboard` is an analytics surface. It contains **no** lifecycle
verb — no `updateStatus`, no `recordResults`, no `startApproval`. So "entering any
of them" lands on charts, which is exactly why "their purpose is unclear" and "no
actions can actually be performed."

### 1.4 What is *not* wrong

Worth recording, because both look like bugs and are not:

- `InvestigationStatus.IsTerminal()` returns true for `approved`, even though
  `approved → closed` exists. This is deliberate and correctly handled: it is a
  **content-mutability** predicate, not a transition guard, and
  `investigation_service.go:380` explicitly gates on the FSM edge map instead.
- The results-approval edges are absent from the generic map **on purpose** — they
  must run through the approval chain so the maker-checker rules hold. The fix
  must not add them to the generic endpoint.

---

## 2. Design

Three changes, in descending order of value. The first alone resolves the client's
actual question.

### 2.1 A single Lifecycle Action Rail — one place that answers "what next"

Introduce one component that owns the whole journey and unifies all five verbs
behind one affordance. The user should never need to know which endpoint drives a
move.

```
┌─ Lifecycle ───────────────────────────────────────────────┐
│  ●───────●───────○───────○───────○                        │
│  Reg.   Active  Results  Approval  Closed                 │
│                                                            │
│  Next step:  [ Record findings ]        ← primary action   │
│  Findings and recommendations must be captured before the  │
│  results-approval chain can start.                         │
│                                                            │
│  Also available:  Cancel investigation                     │
└────────────────────────────────────────────────────────────┘
```

**A single `nextAction(investigation)` resolver** maps the current status to the
one forward move and the verb that performs it:

| Status | Next step | Endpoint |
|---|---|---|
| `registered` | Start investigation | `updateStatus(in_progress)` |
| `in_progress` | Record findings | `recordResults` |
| `results_recorded` | Send for approval | `startApproval` |
| `pending_approval` | Approve / Reject *(approver only)* | `decideApproval` |
| `approved` | **Close investigation** | `updateStatus(closed)` |
| `rejected` | Reopen for rework | `updateStatus(in_progress)` |
| `closed` / `cancelled` | — terminal, no action | — |

Design rules that make this honest rather than merely pretty:

1. **One primary action, always.** Exactly one forward move is promoted. Cancel
   and other side moves are demoted to a secondary group — never the only thing on
   screen, which is today's failure.
2. **Blocked actions state their reason and stay visible.** If findings are
   missing, or the caller lacks `lex:investigation:edit`, or they are the author of
   a decision they cannot approve (four-eyes), the button renders **disabled with
   the reason inline**. A hidden action is indistinguishable from a missing
   feature — which is the whole complaint.
3. **The rail is the only lifecycle affordance.** The bare status badge stops being
   a transition control. A status picker offering only "Cancelled" is worse than no
   control, because it teaches the user the lifecycle is a dead end.
4. **Terminal states say so explicitly** — "Closed on 12 May by A. Rahman", not an
   empty panel that reads as broken.

**Reuse, do not rebuild.** `investigation-lifecycle-stepper.tsx` already exists and
already renders the stage sequence; it is currently decorative. The work is to give
it an action slot and feed it the resolver — not to write a new stepper.

### 2.2 Collapse the eight statuses onto five visible stages

Eight raw statuses are more than the journey has meaningful steps, and two of them
are exception states rather than stages.

```
Registered → Active → Findings → Approval → Closed
                                     ├─ rejected  ↺ back to Active
                                     └─ cancelled ✕ stopped
```

`rejected` and `cancelled` render as **annotations on the stage they interrupted**,
not as stages of their own. A rejected investigation shows the Approval stage in a
warning state with "Returned for rework", which is what actually happened, instead
of implying a linear walk through a "Rejected" step.

### 2.3 Disambiguate the two rows, and give the categories a job

**The rows.** Give each its own labelled group rather than two anonymous button
strips: the four workspaces under a "Workspaces" heading with their navigational
nature made visible (an arrow, or rendered as cards rather than buttons); the four
presets under "Quick filters", styled as toggles because that is what they are —
a toggle and a link should never look identical.

**The categories.** `InvestigationDeepDashboard` is a genuinely useful analytics
surface; the problem is that it is the *only* thing behind a link that reads like a
workspace. Two honest options:

- **(a) Make them real workspaces** — lead with a filtered, actionable list of that
  category's investigations (with the lifecycle rail reachable per row), and keep
  the analytics below as a secondary panel. Matches what the label promises.
- **(b) Rename them for what they are** — "Fraud Analytics", "Compliance Analytics"
  — and route the actionable path through the main list's quick filters.

**(a) is recommended**: the client called the concept excellent, so the categories
should be strengthened, not demoted. But (b) is honest and much cheaper, and either
beats a link labelled "Fraud Investigations" that leads to charts.

---

## 3. Scope

**Frontend-only for the core fix.** The lifecycle, its guards, its permissions and
its audit trail are all already implemented and correct. No migration, no new
endpoint, no FSM change is required to answer "how do I move Approved to Closed" —
that path works today and simply needs to be surfaced.

| # | Change | Layer | Size |
|---|---|---|---|
| 1 | `nextAction` resolver + tests | FE lib | small, pure, high value |
| 2 | Action slot on the existing lifecycle stepper | FE component | small |
| 3 | Retire the status badge as a transition control | FE component | small |
| 4 | Five-stage collapse with rejected/cancelled as annotations | FE lib + component | small |
| 5 | Label + regroup the two button rows | FE page | small |
| 6 | Category pages → list-first workspaces | FE page | medium |

The one thing worth checking on the backend is whether `recordResults` should also
be reachable from `rejected` without a detour through `in_progress`. Today rework
is `rejected → in_progress → recordResults`, which is defensible — but if the
client expects a rejected investigation to be editable in place, that is a genuine
FSM question rather than a UI one.

## 4. Questions for the client

1. **Who closes an approved investigation** — the investigator, the approver, or a
   manager? It is currently gated on generic edit permission, which may be too
   loose for a close-out.
2. **Should closing require anything** — a final report attached, all evidence
   items dispositioned? Right now `approved → closed` has no preconditions.
3. **Do the four categories differ in lifecycle**, or only in subject matter? The
   feedback says "each appears to have its own lifecycle." They do **not** today —
   all four share one FSM. If Board Review genuinely needs different stages, that
   is a much larger piece of work and should be scoped separately before anything
   here is built.
