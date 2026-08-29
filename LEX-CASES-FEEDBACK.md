# LEX-CASES-FEEDBACK — verification and design

Client feedback on the Cases module, item by item: **is it correct**, and what to do.

## Verdict table

| # | Client item | Verdict |
|---|---|---|
| 1 | Link a contract number / pick a request when creating a case | **Correct — missing** |
| 2 | Contract creation workflow "still showing error" | **Cannot reproduce — need details** |
| 3 | Add 5 new case types | **Already exist** — all five, seeded and active |
| 4 | Remove duplicated top section; move toolbar down | **Correct — layout** |
| 5 | Competent Court → dropdown; remove Court Number | **Correct — free text today** |
| 6 | Courts list | **Blocked — the list you sent is empty** |
| 7 | Merge Intake + Classification; Case Type + Other | **Correct — layout, plus a real taxonomy problem** |
| 8 | AI Case Summary → last section | **Correct — layout** |
| 9 | Remove Required Actions under Legal Position | **Correct — layout** |
| 10 | What is the Repository for? | **Fair question — needs a product answer** |
| 11 | Decide in place, not on another page | **Partly built already** |
| 12 | Director/Case-Manager request pages omit case requests | **Likely correct — same root cause as 13** |
| 13 | Wrong submitter shown on Pending My Decision | **CONFIRMED BUG — one line** |
| 14 | Director cannot approve at Initial Assignment | **Correct, and working as designed** |

---

## 1. The confirmed bug (item 13) — one line, exactly as reported

> *"A case was submitted by the Director user, but on the Pending My Decision page, it
> incorrectly shows the Case Manager as the submitter."*

`frontend/src/app/(dashboard)/lex/inbox/_lib/use-inbox.ts`, in `caseTaskToItem`:

```ts
const approverRole = task.assignee_role?.trim() || metadataString(task, 'approver_ref') || 'legal-approver';
return {
  ...
  requestedBy: approverRole,   // ← the APPROVER in the SUBMITTER field
```

`requestedBy` is documented in the same file as *"Display name of the requester /
initiator"*. For case-intake rows it is populated with the **approver role**
instead. Because the case-intake chain's first approver is the
`legal-cases-manager` role, every case row displays "Case Manager" as its
submitter — regardless of who actually raised it. The Director's case is not
mis-attributed in the data; only the column is wrong.

The two sibling sources do it correctly, which is why only cases misbehave:

```ts
requestedBy: s.counterparty_name || s.created_by || ''   // settlements
requestedBy: r.requester_name || ''                       // requests
```

**Fix.** Carry the real initiator through the case-intake task metadata and read
it here, falling back to blank rather than to a role — a role name in a person
column is worse than an empty cell, because it reads as fact. The task metadata
already carries `case_number`, `case_id`, `subject_type` and `source`, so adding
`submitted_by` / `submitted_by_name` at task creation is the natural place. Keep
`approverRole` — it is genuinely needed by `action`, just not as the submitter.

**Add a regression test.** This is the kind of defect that returns silently; a
case-intake fixture asserting `requestedBy` is the initiator and never the
approver role would have caught it.

---

## 2. Item 14 — the Director genuinely cannot approve, and that is deliberate

> *"The case is in the Initial Assignment stage, but the Director is unable to approve it."*

Correct, and not a defect. The case-intake chain's first approver is the **role**
`legal-cases-manager` — asserted in `legal_case_intake_service_test.go:115`
(`first approver role = ..., want legal-cases-manager`). A user holding
`legal-director` is not that role, so the task is not theirs to decide.

This is a **product question, not a bug**, and there are three legitimate answers:

- **(a) Leave it.** Separation of duties is the point: the Director should not
  approve their own intake. Given they submitted the case here, letting them
  approve it defeats the four-eyes rule the module enforces everywhere else.
- **(b) Add the Director as an alternative approver** on the first rung, so either
  role can clear it. Faster, weaker control.
- **(c) Give the Director an escalation/override** with its own audit reason —
  they can act, but the record shows they overrode rather than approved normally.

**(a) or (c) are recommended; (b) quietly removes a control.** Whichever is chosen,
the UI must *explain* rather than silently disable: today it looks broken, which
is why it was reported as a bug. Show "Awaiting Case Manager approval" with the
named approver, not an inert button.

---

## 3. Item 3 — all five case types already exist

> *"We need to add new 5 case types: أجرة المثل، قضايا إخلاء، قضايا ضريبية، تحقيقات داخلية، مطالبات أجرة"*

Every one is already seeded in `legal_case_classifications`, `active`, and marked
`is_system`, with the Arabic names essentially as requested:

| Requested | Code | Seeded Arabic name |
|---|---|---|
| أجرة المثل | `FAIR_RENT` | أجرة المثل |
| قضايا إخلاء | `EVICTION` | إخلاء |
| قضايا ضريبية | `TAX` | اللجنة الضريبية |
| تحقيقات داخلية | `INTERNAL_INVESTIGATION` | تحقيق داخلي |
| مطالبات أجرة | `RENT_CLAIM` | مطالبة بالأجرة |

Alongside `RENTAL_DISPUTE`, `LABOR`, `COMMERCIAL`, `ENFORCEMENT`.

**So why did the client not see them?** The taxonomy is stored **twice**: as flat
root codes (`EVICTION`, `RENT_CLAIM`, `FAIR_RENT`, `TAX`) *and* as a nested cascade
(`RD_EVICTION → RD_RENT_CLAIM → RD_FAIR_RENT → RD_TAX_COMMITTEE`) modelling the
rental-dispute escalation path. The creation form uses `ClassificationPicker`,
which walks the tree — so the same concept appears at different depths, and the
flat roots may not surface where the user expects.

**Design.** Do not add duplicate types. Instead:
1. Decide which representation is canonical for *selection* — recommend the flat
   roots for picking a case type, with the cascade reserved for showing the
   escalation path on an existing case.
2. Make `ClassificationPicker` open on the selectable set, searchable by Arabic
   name, so "أجرة المثل" is one keystroke away.
3. Reconcile the duplication so `EVICTION` and `RD_EVICTION` are not two answers
   to the same question.

This is the same failure pattern as the Investigations feedback: the capability
exists, the UI does not narrate it.

---

## 4. Items 1, 5, 6, 7 — the creation form

**Item 1 — contract / request linkage. Correct, genuinely missing.** There is no
`contract_number` or `request_id` field in `case-form-dialog.tsx`. The spine
supports it: `legal_requests` already carries `subject_type`/`subject_id`
back-links to a spawned case, so the join exists — the form simply never offers
it. Add two optional, mutually-exclusive linkage fields: a contract picker and a
request picker (searchable, not free text, so the link is a real foreign key
rather than a typed string).

**Item 5 — Competent Court. Correct.** Today:

```ts
competent_court: z.string().trim().optional().default(''),
court_number:    z.string().trim().optional().default(''),
```

Free text, exactly as the client says — which is how the same court ends up spelled
three ways and why court-level reporting cannot be trusted. Replace with a
reference list, and drop `court_number`.

Follow the classification precedent rather than hardcoding an enum: a small
`legal_courts` table (code, bilingual name, active, is_system, sort) so admins can
maintain it per tenant without a deploy. Migrate existing free-text values by
matching where possible and leaving the rest for manual reconciliation — do not
silently discard them.

**Item 6 — BLOCKED.** The courts list arrived as eight empty quotation marks:
`"", "", "", "", "", "", "", ""`. The content did not survive the copy. **Please
resend the eight court names** — nothing here can be built without them, and
guessing Saudi court names would be worse than waiting.

**Item 7 — merge Intake and Classification.** Reasonable, and it pairs naturally
with the taxonomy cleanup above. On "Other with a text field": allow it, but store
it as a real classification request rather than an orphan string, otherwise "Other"
becomes an unqueryable bucket that quietly swallows the cases nobody categorised.
Suggest capturing the free text and surfacing it to admins as a candidate new
classification.

---

## 5. Items 4, 8, 9 — layout

All three are straightforward and I have no objection:

- **4** — remove the duplicated Portfolio / Delete Portfolio / Plaintiff Side /
  Defense Side row and move Inbox, Export, Table View, Timeline, Calendar into the
  lower toolbar. One toolbar, not two.
- **8** — move AI Case Summary to the bottom. It is assistive, not primary, and it
  currently outranks the case's own facts.
- **9** — remove Required Actions below Legal Position; Tasks already carries them.
  Two lists of the same actions guarantees they will disagree.

Worth confirming for 9: are the two lists **actually** the same data, or does
Required Actions show something Tasks omits? If they differ, removing it loses
information. I did not verify this and it should be checked before deleting.

---

## 6. Items 10, 11, 12 — questions and partial finds

**Item 10 — "What is the purpose of the Repository?"** A fair question and the
honest answer is that if an experienced user cannot tell, the surface is not
earning its place in the navigation. This needs a product decision — either give
it a clear job and label it accordingly, or fold it into Documents. Not something
engineering should answer unilaterally.

**Item 11 — decide in place.** Partly built already: `InboxRow` has an inline
`onDecide` approve button *and* a link out. The complaint most likely refers to
the dashboard's "Pending My Decision" entry point, which navigates to `/lex/inbox`
rather than opening the decision where you are. Design: make the dashboard widget
itself decision-capable, reusing the existing `onDecide` path, and keep the link
as a secondary "see all". The decision primitive already exists — it just is not
mounted on the widget.

**Item 12 — case requests missing from the Director / Case-Manager request pages.**
Very likely the same root cause as item 13: the case-intake queue is a *separate*
source (`listVisibleCaseIntakeTasks`, `LEX_CASE_INTAKE_TASKS`) from the request
approvals source (`listMyApprovalRequests`). A page built on the requests source
alone will never show case-intake work. Verify which source each page uses, then
either union the two or state clearly that the page is requests-only. I did not
confirm which page the client meant, so this one needs a repro.

---

## 7. Item 2 — the contract creation error

> *"Make sure the workflow of creation the contract is fully successful. Because
> it's still showing error."*

I could not reproduce this from the description, and I am not going to guess at a
fix for an unidentified error. To act on it I need:

- the exact error text or screenshot,
- which contract flow (new contract, contract from request, contract from case),
- the acting user's role,
- roughly when it happened, so the lex-service logs can be correlated.

Flagging rather than silently dropping it: this is the only item in the list I
cannot evaluate.

---

## Recommended sequencing

**First — the confirmed defect and the misleading UI.** Item 13 (one-line fix plus
a regression test) and item 14's "explain instead of disable". These are what made
the module feel broken.

**Second — layout.** Items 4, 8, 9. Cheap, no backend, immediately visible.

**Third — the creation form.** Items 1, 5, 7 plus the taxonomy reconciliation
behind item 3. This is the largest piece and needs the courts list (item 6) before
it can be finished.

**Blocked pending the client:** item 6 (empty courts list), item 2 (no repro), item
10 (product decision), and the SoD question in item 14.
