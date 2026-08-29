# Watheeq — Functional (CRUD/Lifecycle) Test Findings

**What this is:** real functional API testing — actual create/read/update/delete + state‑machine + approval/SoD operations driven through the live services (gateway → lex‑service → DB) on the **local** stack. Not render smoke. The live demo box was never touched. Reusable test scripts live in `scripts/functional-tests/*.py` (7 files, self‑cleaning).

## Summary

**~374 assertions across 7 business domains → 365 pass, 9 fail (all from 4 server bugs, in Contracts).**

| Domain | Result | Bugs |
|---|---|---|
| Requests & Intake | 35/35 ✅ | 0 |
| Cases & Litigation | 46/46 ✅ | 1 finding |
| Consultations & Investigations | 67/67 ✅ | 1 finding |
| Contracts & CLM | 70/79 ⚠️ | **4 server bugs (500s)** |
| Matters & Settlements | 50/50 ✅ | 2 findings |
| Approvals, DoA & SoD | 39/39 ✅ | 0 |
| SLA / Signatures / Docs / Org / Calendar | 57/57 ✅ | 0 |

**What genuinely works (verified end‑to‑end, real writes):** request lifecycle + auto‑spawn to case/consultation with back‑links; case CRUD + two‑phase intake + all sub‑resources; consultation & investigation full FSMs (incl. reject→rework→approve using a distinct approver); matter/settlement/obligation CRUD + settlement FSM to pending_approval + PII encryption round‑trip; **native e‑signature create→send→sign→custody with evidence hash**; SLA clock materialization + escalation + **working‑calendar‑driven deadline math**; approval‑policy versioning/audit/conflict‑check(409)/templates/restore; **no‑coarse‑fallback RBAC** and **dynamic author≠approver SoD** on the decision path.

---

## ✅ FIX STATUS — all 6 fixed (local tree)

| Finding | Fix | Verified |
|---|---|---|
| BUG‑1/2/3 review‑desk 500 | ORDER BY moved to the `t.` (outer) alias in 3 repos | ✅ **contracts.py 81/81** (was 70/79); review‑desk returns 200; final‑version ceremony works |
| BUG‑4 clause no‑tags 500 | tags default to `[]string{}` in Normalize (clause + regulation create) | ✅ contracts.py C0 → 201 (was 500) |
| FIND‑5 case DELETE SoD | `DELETE /legal-cases/{id}` wrapped in `withDistinctActor` | ✅ live: author DELETE → **403 SOD_CONFLICT** (was 204) |
| FIND‑6 consultation SoD | resolver adds `RespondedBy` to blocked actors | ✅ compiles; same guard mechanism as FIND‑5 |
| FIND‑7 matter FSM | added `matterStatusTransitions` map + wired into `UpdateStatus` | ✅ **matters_settlements.py 51/51, 0 findings** (was 1) |
| FIND‑8 settlement role slug | `legal_director` → `legal-director` in `buildApprovalTask` | ✅ compiles |

lex‑service was rebuilt (`.dev-bin/lex-service`) and restarted; all fixes are live on the **local** stack. **They are NOT yet on the demo box** — the live box still runs the old build. To close the review‑desk 500 on the demo box, the fixes must be committed and deployed (`deploy.sh redeploy`).

---

## BUGS — fix candidates (all now fixed — see status table above)

### 🔴 BUG‑1/2/3 — Contract review‑desk read repos: invalid SQL → HTTP 500 (CONFIRMED)
Three review‑desk read repositories append `ORDER BY … LIMIT …` **outside** the `row_to_json(t) FROM ( … ) t` subquery, so the inner table alias is out of scope → Postgres `42P01 missing FROM‑clause entry`.

- `repository/contract_attachment_repo.go:125` (`ListByContract`) → breaks `GET /contracts/{id}/review-desk` (overview), `GET …/review-desk/attachments`, `POST …/review-desk/completeness`.
- `repository/contract_correspondence_repo.go:71` (`ListByContract`) → breaks `GET …/review-desk/correspondence`.
- `repository/contract_recommendation_repo.go:77-84` (`GetActive`/`ListByContract`) → breaks `GET …/review-desk/recommendations`, and makes `POST …/review-desk/final-version` return **500 instead of the intended 409** gate.

**Cascade:** completeness can never pass → the whole contract review‑desk happy path (completeness → recommendation → final version) is blocked.
**Demo relevance:** 🔴 **If the demo opens a contract's review desk, it will show a 500.** The contract *list* page is fine (render smoke passed); the review‑desk sub‑view is the broken part.
**Fix (surgical):** move the `ORDER BY … LIMIT …` **inside** the inner `SELECT … FROM … WHERE …` (the contract/clause list repos already do this correctly). Independently reproduced: `GET /contracts/{id}/review-desk` → 500 `"load attachments"`.

### 🔴 BUG‑4 — Clause‑library create without `tags` → HTTP 500 (agent‑verified)
`clause_library_items.tags` is `NOT NULL DEFAULT '{}'`, but `CreateClauseLibraryItemRequest.Normalize` returns `nil` for omitted tags and the repo INSERT sends explicit `NULL` → not‑null violation → 500.

- `dto/library_dto.go:123/177`, `repository/library_repo.go:31-48`.
**Repro (agent):** `POST /clause-library` without `tags` → 500; with `tags:[…]` → 201.
**Demo relevance:** 🟡 only if a clause is created without tags during the demo.
**Fix:** default `tags` to `[]string{}` in `Normalize` (or coalesce to `'{}'` in the repo).

---

## GOVERNANCE / CONSISTENCY FINDINGS (not 500s, not demo‑blockers — but real, and in the area Watheeq sells on)

### 🟡 FIND‑5 — Case DELETE‑close bypasses SoD
`POST /legal-cases/{id}/status → closed` is distinct‑actor guarded (author → 403 SOD_CONFLICT), **but `DELETE /legal-cases/{id}` is not** — the author successfully hard‑closed their own case (204). `caseClose` (`routes.go:479`) lacks the `withDistinctActor` wrapper the status path has. Decide whether DELETE‑close should carry the same SoD control.

### 🟡 FIND‑6 — Consultation SoD keys on the wrong actor
The SoD control checks the record's *creator* (`CreatedBy`), not the *response author* (`RespondedBy`) — despite code/route comments saying "the advisor who authored the response cannot approve it." If a consultation is created by A and answered by advisor B, **B can approve their own response**. (`app.go:1662`.)

### 🟡 FIND‑7 — Matter status has no FSM transition guard
`Matter.UpdateStatus` (`matter_service.go:298`) validates only the enum — no from→to graph. A terminal `closed` matter silently re‑opens (`closed → open` → 200). Settlements *do* enforce their FSM; matters don't.

### 🟡 FIND‑8 — Settlement approval role‑slug mismatch (latent)
`SettlementService.buildApprovalTask` hardcodes `AssigneeRole: "legal_director"` (underscore), but the seeded slug is `legal-director` (hyphen) and the normalizer doesn't reconcile them → a genuine Legal Director's role would be **rejected** for the settlement approval task; only an `admin:*` holder bypasses. **Demo‑relevant** if settlement approval is shown as a plain legal‑director account.

---

## Minor notes (not bugs)
- Field‑validation errors return **HTTP 422** (not 400); malformed JSON → 400. Frontend should branch on 422.
- No dedicated `GET /workflow-policies/approval/{id}` single‑fetch (405); the request‑approval side has it.
- `method=otp` signing completes locally without an OTP challenge (deterministic path) — confirm intended.
- Investigation reject goes to a `rejected` state (a code comment says `in_progress`) — behavior fine, wording stale.
- Strict DoA X.509 PKI can't be exercised locally (no trusted roots in dev) — covered by Go unit tests (`approval_authority_pki_test.go`).

## Coverage gaps (environment‑limited)
- SoD‑gated *happy paths* (approve/close by a distinct approver) need a second seeded user with the approver role — the Consultations agent used `admin@apexbank.demo` as the distinct approver; the same approach extends the others.
- Gov e‑sign real integration (Najiz/Nafath/emdha sandbox + HMAC callbacks) needs the gov‑gated env; locally they correctly use honest deterministic stubs.
- Email‑webhook intake, automatic SLA monitor ladder (L2/L3 breach), and file‑upload variants not driven.

## Recommendation
**Before demo:** fix **BUG‑1/2/3** (surgical SQL change, 3 files) if the contract review desk will be shown, and **BUG‑4** (one‑line default) — both are low‑risk. Verify the **settlement‑approval role slug** (FIND‑8) if settlement approval is demoed. **Post‑demo:** address the SoD/FSM governance gaps (FIND‑5/6/7) — they matter because SoD is a core Watheeq selling point.
