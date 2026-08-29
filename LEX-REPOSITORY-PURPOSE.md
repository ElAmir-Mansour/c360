# LEX-REPOSITORY-PURPOSE — what the Repository is, and what to do about it

Answers feedback item 10: *"What is the purpose of the Repository?"*

This is a research answer, not a change. The product decision belongs to the client and to
Katanga, not to engineering. What follows is the evidence needed to make that decision, plus
the defects found on the way — which are separate from the naming question and should be
treated separately.

> **Verification status.** Every factual claim below has been independently re-checked against
> the code and against a read-only `lex_db` query (no writes). All row counts, label line
> numbers, endpoint identities and file references reproduced exactly. **Four claims did not**
> and have been corrected in place, each marked *"Correction to an earlier draft"*: the role
> count (15 → 14), the `lex:document:view` holder count (10 → 11), finding D-2 (three affected
> roles → two), and the folder-path language claim (§3). The `tsc` result in §6 has also been
> updated — it is no longer clean, for a reason unrelated to this task.

---

## 0. Scope check — which "Repository" this is

The client raised this inside the **Cases** feedback, so I first established what a case user
can actually see with that word on it. Searching the whole Lex frontend for `Repositor` and
`مستودع` gives exactly one user-visible surface inside Cases:

**`/lex/cases/[id]` → Documents tab** (`documents-tab.tsx`). Nowhere else in Cases. There is
**no `/lex/repository` route**, no Repository nav entry, and no Repository tab. It appears in
five places on that one tab:

| # | Where | English | Arabic | Source |
|---|---|---|---|---|
| 1 | Health tile, 2nd of 4 | `Repository` | `المستودع` | `labels.ts:1533` / `:2772` |
| 2 | Readiness checklist row | `Repository link` — *"At least one linked repository document for retention and reuse."* | `رابط المستودع` | `labels.ts:1558-1559` / `:2797-2798` |
| 3 | Button on every missing checklist row | `Reuse repository` | `إعادة استخدام المستودع` | `labels.ts:1542` / `:2781` |
| 4 | Badge in the preview pane | `Repository` | `المستودع` | `labels.ts:1483` / `:2722` |
| 5 | Button in the preview pane | `Open repository` | `فتح المستودع` | `labels.ts:1491` / `:2730` |

A second, weaker reading is possible: the **`/lex/documents`** page, whose nav label is
"Documents & Attachments" but whose own subtitle read *"Legal document repository backed by
the lex-service document APIs."* Both readings point at the same underlying thing, so this
document covers both. **If the client meant a different screen entirely, I need a screenshot** —
I have not guessed.

---

## 1. What the Repository actually does today

### It is not a feature. It is the `/lex/documents` store, seen from inside a case.

There is one shared document store in Lex — the `legal_documents` table — and `/lex/documents`
is its page. "Repository" is the word the Cases tab uses for that same store. It is a
cross-reference, not a separate capability.

**Route.** No route of its own. Rendered inside `/lex/cases/[id]`, Documents tab.

**Endpoints.** All pre-existing; nothing is Repository-specific:

| Call | Endpoint | Permission | Purpose |
|---|---|---|---|
| `casesApi.listRepositoryDocuments` | `GET /api/v1/lex/documents` | `lex:read` | Fills the "Reuse" picker |
| `casesApi.listCaseDocuments` | `GET /api/v1/lex/legal-cases/{id}/documents` | `lex:case:view` | The case's own document links |
| `casesApi.addCaseDocument` | `POST /api/v1/lex/legal-cases/{id}/documents` | `lex:case:edit` | Upload / link / reuse |
| `casesApi.deleteCaseDocument` | `DELETE .../documents/{linkId}` | `lex:case:edit` | Unlink |

`listRepositoryDocuments` hits the **identical endpoint** the `/lex/documents` page hits
(`frontend/src/lib/lex/cases.ts:1177` vs `frontend/src/lib/enterprise/api.ts:1740`). Same
route, same handler, same table. It is called with `page:1, per_page:100, sort:updated_at` and
**no case filter, no category filter, no confidentiality filter** — only already-linked
documents are excluded (`documents-tab.tsx:826-828`).

**Tables.**

- `legal_documents` — the store itself (title, type, category, confidentiality, tags,
  `current_version`, `metadata.folder_path`, soft delete).
- `document_versions` — version history, FK to `legal_documents`.
- `legal_case_documents` — the join row: `(case_id, document_id, source, category, notes,
  evidence_status, court_reference, submitted_by, submitted_at)`, unique per active
  `(tenant, case, document)`, RLS-isolated. Created by migration `000045`.

**What a user can do there.** The Add-document dialog has three modes; all three end at the
same `POST .../legal-cases/{id}/documents`:

- **Upload** — bytes go to the platform file-service, then
  `LegalCaseService.AddDocument` (`backend/internal/lex/service/legal_case_service.go:1677`)
  **creates a new `legal_documents` row plus a `document_versions` row** and links it,
  `source='uploaded_reference'`.
- **Link** — external URL; still creates a `legal_documents` row, `source='external_link'`.
- **Reuse** — picks an existing `legal_documents` row by id; creates only the join row,
  `source='reuse'`.

So **"Reuse" is the only mode where the Repository does anything the other two do not.** In
Upload and Link modes the user is putting a document *into* the repository without being told
that is what is happening. That is the heart of the confusion: the tab exposes the storage
mechanism as if it were a user-facing choice.

**Who can reach it.** Of the **14** roles in `LegalAffairsRoleDefs`
(`backend/internal/auth/legal_roles.go`). Counts below are resolved through `HasPermission`,
i.e. *after* the `expandGrants` verb implication, not from the raw permission slices:

| Capability | Gate | Roles |
|---|---|---|
| See the Documents tab and the Repository tile | `lex:case:view` | 9 — auditor, bu-ceo, case-supervisor, cases-manager, ceo, dept-manager, director, officer, shared-services-manager |
| Upload / Link / Reuse / Unlink | `lex:case:edit` | 4 — case-supervisor, cases-manager, director, officer |
| Load the Reuse picker (API) | `lex:read` | 13 — every role except `legal-system-admin` |
| Open `/lex/documents` (the page the tile refers to) | `lex:document:view` | 11 — all except `legal-ceo`, `legal-shared-services-manager`, `legal-system-admin` |

Note the mismatch on the last two rows — see finding D-2.

*Correction to an earlier draft, which said "15 `legal-*` roles" and put `lex:document:view` at
10. There are 14 role definitions, and 11 satisfy `lex:document:view` once verb implication is
applied. Re-derived by enumerating `LegalAffairsRoleDefs` through `HasPermission`, not by
reading the raw slices — the distinction is what the earlier draft got wrong.*

---

## 2. Overlap with the neighbouring surfaces

Lex has **eleven** places a file can live. They fall into two groups, and the split is not
visible to the user:

**Group A — backed by `legal_documents` (FK `document_id`). These are "the Repository".**

| Table | Rows (all tenants) |
|---|---|
| `legal_documents` | 45 active |
| `legal_case_documents` | **0 active** |
| `legal_matter_documents` | 0 |
| `legal_settlement_documents` | 0 |

**Group B — raw `file_id`, no `legal_documents` row, invisible to `/lex/documents`.**

| Table | Rows |
|---|---|
| `lex_contract_attachments` | 40 |
| `reference_library_documents` | 33 |
| `legal_consultation_documents` | 2 |
| `legal_pleading_attachments` | 0 |
| `legal_expert_documents` | 0 |
| `legal_defendant_attachments` | 0 |
| `legal_request_attachments` | 0 |

### What is actually duplicated

**`/lex/documents` ("Documents & Attachments") vs the case Repository — same data, two names.**
This is the real duplication. Same table, same endpoint, same rows. The nav calls it
"Documents & Attachments" / "المستندات والمرفقات"; the case tab calls it "Repository" /
"المستودع". One thing, two names, and the second name is never defined anywhere in the UI.

**Inside a single case, files live in two groups at once.** The Documents tab merges seven
sources into one list (`documents-tab.tsx:831-840`): case document links, browser-local
leftovers, pleadings, hearing reports, expert documents, judgments, defendant attachments.
Only the first two can ever count toward the Repository tile — pleading, expert and defendant
attachments are Group B and carry no `document_id`. **So the Repository tile is measuring a
storage-layer distinction the user has no way to perceive.** A case with twelve pleading
attachments and no case-document links reads "Repository: 0".

**Clause Library — no overlap.** `clause_library_items` (16 rows) holds reusable *clause text*
for contract drafting, not files. Different object, different job. Not a duplicate.

**Reference Library (`/lex/library`) — adjacent, not duplicated.** 33 rows in
`reference_library_documents`, all `published`, all with `library_tenant_id IS NULL` — a
read-only, cross-tenant corpus of laws, regulations and authority publications. Different
lifecycle (published/versioned centrally, never uploaded by a tenant user), different
permission (`lex:reference:view`). The overlap is only conceptual: a user hunting for "a
document" now has three plausible places to look — Documents, Reference Library, Knowledge Hub.

**Contract attachments — a genuine gap, in the other direction.** `lex_contract_attachments`
stores `file_id` directly and never creates a `legal_documents` row. 40 contract attachments
exist and **none of them appear in `/lex/documents`**. So "the repository" is not the single
store the name implies. (A `legal_documents.contract_id` column does exist, with 4 rows using
it — a second, parallel path.)

---

## 3. Is it reachable, used, and populated in the demo tenant?

Queried read-only against local `lex_db` (docker `clario360-postgres`, port 5436). No writes.

**Reachable: yes.** `/lex/documents` renders behind `LexRouteGuard route="/lex/documents"`.
The case Documents tab renders for any `lex:case:view` holder.

**Populated (the store): yes.** 45 active `legal_documents`, 63 versions, split
`aaaaaaaa-…0001` (Al Othaim demo) 23 / `1924590c-…` 22. All 23 demo rows have a `file_id` —
real bytes, not stubs. Types: 6 policy, 4 template, 4 other, 3 memo, 2 filing, 2 resolution,
1 opinion, 1 correspondence. Confidentiality: 9 confidential, 9 internal, 4 privileged,
1 public.

Folder paths (`metadata.folder_path`) are populated on 44 of 45 rows, but **not bilingually —
they are split by tenant, one language each**, and the demo tenant is the English one:

| Tenant | Arabic paths | Latin paths | Example |
|---|---|---|---|
| `aaaaaaaa-…0001` (Al Othaim demo) | 0 | 22 | `Litigation/Cases/2026`, `Compliance/ZATCA` |
| `1924590c-…` (other) | 22 | 0 | `التقاضي/القضايا/2026`, `الحوكمة/مجلس الإدارة/المحاضر` |

*Correction to an earlier draft, which called this "populated bilingually" and illustrated it
with one path from each tenant. That reads as a bilingual folder scheme; there isn't one.*

This matters, and it compounds D-5: in the demo tenant the folder **tree** is English while
**22 of 23 titles are Arabic**. An Arabic-locale user browsing the Reuse picker or the folder
tree therefore sees Arabic document names filed under English folders.

**Used (from a case): no. Zero.**

```
legal_case_documents        1 row total
legal_case_documents active 0 rows
```

The single row was created and soft-deleted **within the same second** on 2026-07-13
(`created_at 21:36:28.047`, `deleted_at 21:36:28.217`) — a test artefact, not usage.
`legal_matter_documents` and `legal_settlement_documents` are also empty.

**Consequences for what the client saw.** On all 5 demo cases:

- the **Repository tile always reads 0**;
- the readiness checklist always shows a **"Repository link — Recommended"** row in the missing
  list, since nothing can satisfy it;
- the **Reuse picker offers all 23 tenant documents** — board minutes, NDAs, ZATCA compliance
  files, 4 privileged memos — with no filter for relevance to the case;
- the "Repository" badge and "Open repository" button never appear at all, because no document
  in any demo case has a `repositoryDocumentId`.

So the client met a tile labelled with an undefined word, permanently showing zero, next to a
checklist item demanding "a repository link", next to a button offering to reuse documents that
have nothing to do with their case. **The question was entirely reasonable.**

---

## 4. Defects found while researching

These are not the naming question. They are real, reproducible, and worth fixing whichever
product option is chosen. I have not fixed them — all three are structural.

**D-1. "Open repository" is a dead link.** It navigates to
`/lex/documents?search=<document-uuid>` (`documents-tab.tsx:1379`). The documents list reads
`search` from the URL (`use-data-table.ts:122`) and the backend matches it with
`title ILIKE '%…%' OR description ILIKE '%…%'` only (`document_repo.go:60-63`). A UUID is never
in a title or description — verified: `0` of 45 rows contain their own id in either field. The
button therefore always lands on an empty list. **Fix:** deep-link by id
(`/lex/documents/{id}` or a `?document=` param the page resolves), not by free-text search.

**D-2. Two roles get silently bounced.** `legal-ceo` and `legal-shared-services-manager` hold
`lex:case:view` but no `lex:document:*` permission at all. They can see the Repository tile and
the "Open repository" button; clicking it hits `LexRouteGuard`, which **redirects to
`/dashboard` with no message** (`lex-route-guard.tsx:88-90`). **Fix:** hide the affordance when
the user lacks `lex:document:view`, or grant it alongside case view. This is a policy call, not
a bug fix.

*Correction to an earlier draft of this document, which named three roles.*
`legal-dept-manager` is **not** affected. Its raw permission slice contains only
`lex:document:add`, but the operational-verb⇒view implication in `expandGrants` promotes that to
`lex:document:view`, and the frontend resolver mirrors the same rule
(`src/stores/auth-store.ts:242` — *"Lex verb implication, mirroring the backend's expandGrants"*).
Both sides therefore let it through. Verified by enumerating `LegalAffairsRoleDefs` through
`HasPermission`: exactly 2 roles hold `lex:case:view` without `lex:document:view`.

**D-3. The tile's tooltip explains nothing.** `HealthMetric` sets
`title={statisticHint(label)}` (`documents-tab.tsx:2073`), which produces
*"Repository — open the records contributing to this statistic."* It restates the label. The
one place with room to define the term uses boilerplate.

**D-4 (minor). Dead localStorage path.** `storedDocuments` still merges browser-local
document stubs into the list (`documents-tab.tsx:719, 834`), but nothing writes to it any more —
the save mutation always calls the API. Only removal remains (`:1173`). It is harmless but it
keeps `local_reuse` / `notLinkedToRepository` copy alive for a flow that no longer exists.

**D-5 (minor, informational).** `legal_documents.title` is a single `TEXT` column with no
`title_ar`/`title_en` pair — unlike `reference_library_documents`, which has both. In the demo
tenant 22 of 23 titles are Arabic, so an English-locale user sees Arabic titles in the Reuse
picker with no fallback. Not a regression, just a limit of the schema — but note it points the
opposite way from the folder paths (§3), which are English in the same tenant.

---

## 5. Recommendation

**The honest answer to the client's question is: "Repository" is not a feature. It is the
Documents store, called by a second name in one tab, measured by a tile that counts a
storage-layer distinction the user cannot see, and empty in every demo case.**

It does **not** need to be removed — the underlying capability (one file, linked to many
matters, versioned once, retained once) is genuinely valuable and is the correct design. What
should go is the second name and the tile that reifies it.

### Option A — Fold the wording into Documents. **Recommended.**

Stop calling it a repository. Use the name the surface already has in the nav —
"Documents" / "المستندات" — everywhere in the case tab. Concretely:

- `Repository` tile → **`In Documents`** / **`في المستندات`**, or drop the tile entirely (it is
  the weakest of the four; "Required", "Metadata only" and "Versions" all describe case state,
  this one describes storage).
- `Reuse repository` → **`Link an existing document`** / **`ربط وثيقة موجودة`**.
- `Repository link` checklist row → **`Linked to Documents`** / **`مرتبطة بالمستندات`**, and
  consider dropping it: it is not a legal-readiness criterion, it is a housekeeping preference.
- `Open repository` → **`Open in Documents`** / **`فتح في المستندات`** — **but only after D-1 is
  fixed**, otherwise a clearer label makes a dead link more confident.

*Trade-off:* cheapest, lowest risk, no schema or route change, and it removes the second name
entirely. It does **not** fix the underlying incoherence that pleading/expert/defendant
attachments still bypass the store (Group B above) — a case will still have files that
"Documents" does not know about. That is a bigger piece of work and should be sequenced
separately.

### Option B — Give it a real job and keep a distinct name.

Define the Repository as the **retention and disposition** surface: the place where a file's
retention policy, disposition date, confidentiality and legal-hold status live, and the case
tab shows retention posture rather than a link count. The backing data already supports this —
`DocumentService.RepositorySummary` (`document_service.go:185`) already computes
retention-policy coverage and disposition-due counts via `buildDocumentRepositorySummary`
(`:479`), exposed as `GET /api/v1/lex/documents/repository-summary`; `/lex/documents` already
surfaces "Retention due" and "Missing policy" KPIs from it.

*Trade-off:* this is the only version of "Repository" that earns a distinct name, and it maps
to a real records-management concept a legal department will recognise. But it is a product
build, not a rename: the case tab would need a retention panel, and someone has to own the
retention taxonomy. Do not choose this unless the client actually wants records management.

### Option C — Remove the Repository tile and checklist row; keep Reuse.

Delete the tile, delete the "Repository link" checklist row, keep the Add-document dialog's
Reuse mode (renamed per Option A). The user keeps the ability to attach an existing document
without re-uploading, and loses a meaningless metric.

*Trade-off:* smallest surface, cleanest result, and it removes the permanently-zero number that
prompted the question. It loses the (weak) nudge toward reuse. Because the tile is currently 0
for every case in the demo, nothing of value is actually being lost today.

### Option D — Leave it, document it.

Add a real explanatory tooltip and an inline definition, keep the name.

*Trade-off:* cheapest of all, but it concedes that the surface needs a footnote to be
understood. If an experienced legal user could not work it out from the UI, a tooltip is
unlikely to be the difference.

### Recommended sequencing

1. **Fix D-1 and D-2 first.** A dead link and a silent redirect will be reported as bugs again
   regardless of what the thing is called.
2. **Then take Option A + C together** — rename to "Documents" everywhere in the case tab and
   drop the tile and the checklist row. That is a wording-and-deletion change with no backend
   work, and it answers the client's question by making it unaskable.
3. **Only then consider Option B**, and only if the client asks for retention management.
4. **Separately, and larger:** decide whether pleading/expert/defendant/contract attachments
   should move into `legal_documents`. Until they do, "the document store" is not the document
   store, and any count drawn from it will understate what a case actually holds.

---

## 6. What I changed, and what I deliberately did not

**Changed — one string pair, both locales.**
`frontend/src/app/(dashboard)/lex/documents/_lib/documents-labels.ts`, `pageDescription`:

- was: *"Legal document repository backed by the lex-service document APIs."* /
  *"مستودع الوثائق القانونية المدعوم بواجهات خدمة الوثائق."*
- now: *"The shared store for legal files. A document saved here can be linked to cases,
  matters and settlements instead of being uploaded again."* / *"المخزن المشترك للوثائق
  القانونية. يمكن ربط الوثيقة المحفوظة هنا بالقضايا والمسائل القانونية والتسويات بدلًا من رفعها
  مرة أخرى."*

The old string named an internal microservice to the client's lawyers and described the page by
its plumbing rather than its job. Replacing it is wording only, it pre-empts none of the four
options above, and every claim in the replacement is verified: `legal_case_documents`,
`legal_matter_documents` and `legal_settlement_documents` all FK to `legal_documents`.

**Deliberately not changed.** The five "Repository" labels in
`frontend/src/app/(dashboard)/lex/cases/_components/labels.ts`. Renaming them *is* the product
decision the client is being asked to make — Option A is a rename, Option C is a deletion, and
Option B keeps the name. Choosing one unilaterally would decide the ticket rather than answer
it. The exact label keys are listed in section 0 so whichever option is picked is a
ten-minute change.

Also not changed: D-1 through D-4 (all structural), the `documents-tab.tsx` component, any
migration (none needed — this task adds no schema), and any backend file.

**Verification (re-run on the second pass).** `npx vitest run` on
`src/app/(dashboard)/lex/documents/page.test.tsx` and
`src/lib/i18n/__tests__/watheeqtech-translation-memory.test.ts` — 2 files, 7 tests, all pass.
No test asserts the old string (grepped). The stale entry left in
`src/lib/i18n/watheeqtech-visible-text-v22.generated.ts:1599` is a lookup map, not a gate; it is
now simply unused for this key.

`npx tsc --noEmit` reports **exactly one error, and it is not mine**:

```
.next/types/app/(dashboard)/lex/inbox/page.ts(12,13): error TS2344
  Property 'LexInboxContent' is incompatible with index signature.
```

That is a generated Next.js page-type check failing because `/lex/inbox/page.tsx` now exports a
named component alongside its default — another agent's in-flight work on the inbox items (11–13),
in a file this task does not own. It is unrelated to Documents or the Repository, and no file
changed by this task appears in the error. An earlier draft of this document claimed tsc was
clean; that was true when written and is no longer true, so it is corrected here rather than
left to imply this task broke something.

---

## 7. What I need from the client

1. **Confirm which "Repository" you meant.** I found exactly one in Cases — the Documents tab.
   If it was a different screen, a screenshot settles it in seconds.
2. **Pick an option (A / B / C / D).** A+C is my recommendation and is cheap.
3. **Answer one question that decides Option B:** do you want Watheeq to manage document
   *retention and disposition* (how long each file is kept, when it is destroyed, who signs
   off)? If yes, Option B has a real job to do. If no, Option B is dead and A+C is clearly
   right.
