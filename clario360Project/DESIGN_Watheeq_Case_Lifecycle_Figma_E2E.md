# WatheeqTech case lifecycle — Figma-to-production traceability

Source: Figma file `atvfQpXz428wq1xbtbvgsu`, page `224:3`  
Page name: **WatheeqTech — Case Lifecycle (Deep)**

This document records how the bilingual Figma frames map to the production
Watheeq (`/lex`) implementation. The Figma English and Arabic frames share one
responsive implementation; locale and direction are resolved at runtime.
Figma sample names, dates, scores, and document records are not used as
production data.

## Screen coverage

| Figma frame(s) | Production surface | Persisted source / mutation |
|---|---|---|
| `227:6` / `541:6` — case qualification | `/lex/cases/[id]?tab=qualification` | Legal-case `metadata.qualification`; live case documents, parties, experts, risk matrix, and case-task creation |
| `227:207` / `541:195` — court sessions | `/lex/cases/[id]?tab=hearings` | Hearing create/update/delete, required-document metadata, adjournment, and hearing-report endpoints |
| `227:383` / `541:369` — case timeline | `/lex/cases/[id]?tab=timeline` and `/lex/case-timeline` | Aggregated case, hearing, task, pleading, expert, judgment, defendant, audit, hold, deadline, and delay data |
| `227:645` / `541:623` — company legal position | `/lex/cases/[id]?tab=position` | Legal-case role update, risk-derived position score, live parties/court facts, and case-task status updates |
| `227:734` / `541:752` — settlement tracking | `/lex/settlements/[id]` | Settlement offers, workflow decisions, approvals, timeline, holds, delays, and deadlines |
| `159:297` / `159:2025` — sessions calendar | `/lex/calendar` | Live hearings/calendar data with case deep links and locale-aware Gregorian/Hijri formatting |
| `541:920` / `541:2099` — deep sessions | `/lex/cases/[id]?tab=hearings` | Full hearing register, next-session preparation, attendees, required documents, minutes, decisions, and reports |
| `541:1244` / `541:2423` — evidence submissions | `/lex/cases/[id]?tab=documents` | Platform file upload, repository document creation/linking, external links, case-document removal, and related litigation artifacts |
| `541:1533` / `541:2714` — requests and memorandums | `/lex/cases/[id]?tab=pleadings` | Pleading create/update/version, approval submission, filing, attachments, and deletion |
| `541:1832` / `541:2973` — judicial decisions | `/lex/cases/[id]?tab=judgments` | Judgment creation, study/recommendation, objection deadline/task creation, document reference, and deletion |

## End-to-end contracts

- All case-detail mutations use `/api/v1/lex/legal-cases/...` through the typed
  `casesApi` client.
- File evidence uploads bytes to the platform file service first. The resulting
  file reference is then linked to a repository document and the case; an
  orphaned upload is deleted when linking fails.
- Legal-position role changes are permission-gated by `lex:case:edit` and
  persist through the legal-case update endpoint.
- Legal-position action checkboxes update the underlying case-task status; they
  are not local-only checklist state.
- The repeated Figma "Export main report" action opens the browser print flow
  with a bilingual, print-only report built from the current case aggregate,
  so users can print or save a PDF without duplicating case data locally.
- Plaintiff-only pleadings, experts, and judgments remain guarded by the saved
  company role. Defendant cases expose the incoming-lawsuit/Najiz workflow.
- Arabic and English use the same domain records and mutation paths. Labels,
  number/date formatting, and `dir` are resolved from the active locale.
- Read-only users see all permitted case facts but cannot invoke role, task,
  document, hearing, pleading, judgment, or settlement mutations.

## Verification

- `case-position-tab.test.tsx` covers company-role persistence, case-task
  completion, opposing-party selection, and read-only gates.
- `case-print-report.test.tsx` covers the export action and verifies that the
  printable report renders the live aggregate records.
- Existing case, timeline, settlement, calendar, document, pleading, hearing,
  expert, judgment, RBAC, and localization suites cover the remaining mapped
  surfaces.
- Frontend type-checking and the design-system linter are required gates for
  changes to this flow.
