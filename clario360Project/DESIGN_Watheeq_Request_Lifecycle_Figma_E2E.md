# WatheeqTech request lifecycle — Figma-to-production traceability

Source: Figma file `atvfQpXz428wq1xbtbvgsu`, page `176:2`  
Page name: **WatheeqTech — Request Lifecycle**

The Figma page contains six desktop frames: details, attachments, and
review/submit in Arabic and English. Production uses one responsive implementation
at `/lex/service-desk/new`; locale, direction, validation messages, and date/number
formatting resolve at runtime.

## Screen coverage

| Figma frame(s) | Production surface | Real source / mutation |
|---|---|---|
| `176:7` / `176:488` — request details | Wizard step 2 | Live service catalog, authenticated requester, active organisation registry, eligibility result, bilingual title, description, priority, requested due date, and notes |
| `176:132` / `176:617` — attachments | Wizard step 3 | Platform file upload, 25 MB/type validation, progress, asynchronous virus-scan polling, attachment-policy slots, deletion, and clean-scan gate |
| `176:265` / `176:754` — review and submit | Wizard step 4 | Live draft values, locale-formatted due date, real SLA target projection, uploaded file summary, required attestation, create endpoint, then submit endpoint |
| Post-submit confirmation | Submission result | Server request number and returned workflow status; status-derived approval/routing tracker and links to the persisted request |

## End-to-end contracts

- The final action executes both lifecycle commands:
  `POST /api/v1/lex/legal-requests`, followed by
  `POST /api/v1/lex/legal-requests/{id}/submit`.
- Successful submission can start the configured approval workflow automatically
  or route no-approval services immediately. The confirmation uses the request
  returned by that transition, not the intermediate draft.
- If creation succeeds but submission fails, the server draft is retained and
  surfaced to the requester. Retrying submits the same draft and never creates a
  duplicate request or duplicate attachment links.
- Requesting department/entity and requested due date are required by the Figma
  intake contract. Past requested dates are rejected before submission.
- Notes and requested due date persist in request metadata. The notes also enter
  the immutable submit audit detail.
- Files are uploaded and scanned before request creation. Required attachment
  policy and clean-scan status are enforced at step transition and again before
  submission.
- Read/write access remains permission-gated by `lex:request:add`; request
  visibility and approval decisions remain enforced by the backend actor scope.

## Verification

- `request-submission.test.ts` covers create→submit sequencing, audit notes, and
  duplicate-safe retry after a partial failure.
- `wizard-validation.test.ts` covers the required date and elapsed-date boundary.
- `submission-success.test.ts` covers status-derived approval, routing, and
  delivered tracker states.
- `watheeq-request-approval-e2e.spec.ts` provisions a real service, organisation
  entity, workflow definition, and approval policy; submits through the browser;
  completes the approval task; and verifies that the request reaches `routed`.
