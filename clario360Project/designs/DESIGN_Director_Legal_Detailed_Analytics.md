# Director Legal Detailed Analytics — implementation design

Status: implementation-ready  
Owner surface: Watheeq / Reports & Performance Indicators  
Route: `/lex/reports/analytics`  
Authorization: `lex:report:read` (the Legal Director role already holds it)

## 1. Research findings

The legal suite already has a canonical request spine in `legal_requests`. It is
the correct grain for the requested dashboard because each row carries the
tenant, request type, service, department, priority, lifecycle status, subject
link, and creation timestamp. Processing time is recorded by
`legal_request_execution_state` and `lex_duration_facts`; SLA outcomes are
recorded by `legal_sla_clocks` / request-processing duration facts.

The existing `/dashboard/legal-affairs` payload is domain-centric (cases,
contracts, consultations). It cannot truthfully power a request-centric view:
its totals use different grains and it has no priority filter, request trend,
request completion rate, satisfaction response, or cross-domain advisor rollup.
It remains available for the deeper legacy tabs, but the Director overview gets
a purpose-built request-grain read model.

The system did not previously capture requester satisfaction. Displaying a
hard-coded `4.6/5` would therefore be false. A tenant-isolated, append-only
`legal_request_feedback` record is added and can be submitted once by the
requester after delivery/closure. Until responses exist, the dashboard shows
"No responses" rather than zero or a fabricated rating.

The request spine does not have a generic assignee. Advisor identity is derived
from the actual downstream owner for each linked subject:

- consultation: `legal_consultations.advisor_id/advisor_name`;
- case: `legal_cases.handling_officer_id/responsible_lawyer`;
- contract: `lex_contract_intakes.assigned_reviewer_id/assigned_reviewer_name`.

Rows without a resolvable advisor are excluded from the advisor ranking and are
not attributed to an invented "unassigned advisor".

## 2. Experience design

The overview follows the supplied visual hierarchy while using the platform
design system:

1. Header: Detailed Analytics, generated timestamp, CSV/XLSX/print actions.
2. Controls: compare toggle, report date range, priority, service type,
   department, and reset. State is URL-addressable.
3. KPI strip: total requests, completion rate, average processing time,
   satisfaction, SLA compliance, and pending requests. Every KPI includes its
   sample/definition and an optional previous-period delta.
4. Analysis row: monthly request trend and requests by department.
5. Operations row: legal advisor performance and service-type distribution.
6. The existing `/lex/reports` export surface remains linked for the established
   case, contract, consultation, performance, and SLA reports.

Loading, empty, error, reduced-motion, keyboard, RTL, and print states are
first-class. A valid empty result renders zero-volume charts plus explicit
sample-aware unavailable states; it never substitutes demo data.

## 3. Metric contract

All current-period filters apply at the `legal_requests.created_at` grain. Date
`to` is inclusive in the HTTP contract and converted to an exclusive upper
bound internally.

| Metric | Definition |
| --- | --- |
| Total requests | Count of non-deleted requests created in the selected period. |
| Completion rate | Requests with status `closed` / total requests × 100. Cancelled requests remain in the denominator. |
| Average processing time | Average working hours from request-processing duration facts when available; otherwise execution `clock_started_at → delivered_at`. Only completed samples are included. |
| Satisfaction | Mean of submitted 1–5 feedback ratings for in-scope requests; null with sample 0 when no feedback exists. |
| SLA compliance | Final on-time SLA outcomes / all final SLA outcomes × 100. Pending clocks are reported as sample context but are not in the denominator. |
| Pending requests | Requests not in terminal status `closed` or `cancelled`. |
| Monthly trend | Dense calendar-month count of created requests; missing months are zero. Previous counts align by ordinal month when comparison is enabled. |
| Department distribution | Request count grouped by normalized department; null/blank is `unspecified`. |
| Service distribution | Request count grouped by `request_type`; labels resolve through the existing bilingual service vocabulary. |
| Advisor performance | Completed and active linked requests, final SLA compliance, and real feedback average/sample grouped by resolved downstream advisor. |

Previous period is the immediately preceding window with the same inclusive
number of calendar days. Count deltas use percent change; rate/score deltas use
percentage points or rating points. A previous value of zero is represented as
"new" rather than infinite percent.

## 4. API contract

`GET /api/v1/lex/reports/detailed-analytics`

Query:

- `from=YYYY-MM-DD`, `to=YYYY-MM-DD` (defaults to current year-to-date);
- `priority=urgent|normal`;
- `type=<request_type>`;
- `department=<exact department>`;
- `compare=true|false` (default true);
- `format=csv|xlsx` for governed exports.

The response contains the resolved current/previous windows, filters, KPI
summary, dense trend, distributions, advisors, and filter options. One response
keeps the visual internally consistent and prevents each card from observing a
different database moment.

`GET /api/v1/lex/legal-requests/{id}/feedback` returns the submitted response or
`null`. `POST` to the same path accepts `{rating: 1..5, comment?: string}`. The
service enforces tenant scope, delivered/closed status, requester ownership,
one response per request, bounded comment length, and append-only persistence.

## 5. Security and data integrity

- Existing JWT, tenant guard, RLS, ABAC, and `lex:report:read` gates remain in
  force on analytics.
- Feedback read uses `lex:request:view`; submission also requires that permission
  plus requester ownership in the service layer.
- Every query binds tenant and filter values as parameters.
- Feedback has no update/delete RLS policies and a unique request key.
- CSV/XLSX exports use the same service result and filters as the screen.
- No cross-tenant names, request records, ratings, or counts can be joined.

## 6. Verification

- Service tests cover period resolution, invalid filters, empty samples,
  comparison math, and dense trend alignment.
- Handler tests cover URL parsing, invalid comparison values, and honest export
  output for unavailable samples.
- Frontend API contract tests cover the detailed analytics and request-feedback
  routes; type-check and touched-file lint cover the new dashboard components.
- The migration is exercised against PostgreSQL, including its up/down path,
  constraints, and RLS policies. Backend-wide tests and a production frontend
  build are the completion gates.
