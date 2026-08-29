# LEX-LD-CONTRACTS

Authoritative type and query contract for `GET /api/v1/lex/reports/workforce`.

**This file supersedes every reference to `LEX-LD-SPEC.md` in `LEX-LD-CONTRACT-DECISIONS.md`.**
That document was produced outside the repository and is not present. Where a decision cites
"spec §2.1", "spec §3" or "spec §4", read this file instead. Nothing else in
`LEX-LD-CONTRACT-DECISIONS.md` changes except where amended below.

Amendments A5, A6, A8, A10, A12, A13 are already incorporated. A14 is new and defined in §3.2.

Commit this to the repository root alongside `LEX-LD-DISCOVERY.md`.

---

## 1. Types

### 1.1 Go — `backend/internal/lex/model/workforce.go`

```go
package model

// MetricValue is the universal numeric carrier. Every number the endpoint returns
// is a MetricValue, never a bare int or float.
//
// Available is false for any metric with no valid denominator, no source, or a
// failed source. Those render as unavailable, never as a fabricated zero.
// This follows the existing AnalyticsMetric convention in detailed_analytics.go.
type MetricValue struct {
	Value       *float64 `json:"value"`
	Available   bool     `json:"available"`
	Reason      string   `json:"reason,omitempty"`      // required when Available == false
	Numerator   *int     `json:"numerator,omitempty"`
	Denominator *int     `json:"denominator,omitempty"`
	Sample      *int     `json:"sample,omitempty"`      // n behind a median or average
}

type ScopeMode string

const (
	ScopeModeOrg      ScopeMode = "org"
	ScopeModeSelf     ScopeMode = "self"
	ScopeModeTenant   ScopeMode = "tenant"
	ScopeModeUnscoped ScopeMode = "unscoped"
)

type ScopeEnvelope struct {
	Mode        ScopeMode   `json:"mode"`
	EntityIDs   []uuid.UUID `json:"entity_ids"`
	UserIDs     []uuid.UUID `json:"user_ids"`
	MemberCount int         `json:"member_count"`
	Reason      string      `json:"reason,omitempty"`     // "roster_not_configured", "no_org_role"
	Warning     string      `json:"warning,omitempty"`    // "roster_stale"
	StaleDays   *int        `json:"stale_days,omitempty"`
}

type CalendarSource string

const (
	CalendarSourceTenant     CalendarSource = "tenant"
	CalendarSourceFallbackUTC CalendarSource = "fallback_utc"
)

// PeriodEnvelope carries A5: the reporting calendar port may silently fall back to
// a 24x7 UTC calendar. That fallback is acceptable for SLA math and unacceptable for
// a figure a director compares month over month, so the endpoint reports which
// calendar it actually used.
type PeriodEnvelope struct {
	From           string         `json:"from"`
	To             string         `json:"to"`
	Timezone       string         `json:"timezone"`
	CalendarSource CalendarSource `json:"calendar_source"`
	WorkingDays    MetricValue    `json:"working_days"`
}

type CoverageExclusion struct {
	Domain string `json:"domain"`
	Reason string `json:"reason"`           // "no_assignee_column", "assignee_encrypted", "partial"
	Detail string `json:"detail,omitempty"`
}

type CoverageEnvelope struct {
	DomainsRequested  int                 `json:"domains_requested"`
	DomainsReturned   int                 `json:"domains_returned"`
	ItemsTotal        int                 `json:"items_total"`
	ItemsAttributed   int                 `json:"items_attributed"`
	ItemsUnattributed int                 `json:"items_unattributed"`
	AttributionPct    int                 `json:"attribution_pct"`
	RowsReturned      int                 `json:"rows_returned"`
	RowsTruncated     int                 `json:"rows_truncated"`
	Exclusions        []CoverageExclusion `json:"exclusions"`
}

type DomainErrorKind string

const (
	DomainErrorForbidden  DomainErrorKind = "forbidden"
	DomainErrorQueryError DomainErrorKind = "query_error"
)

// Forbidden and QueryError must not collapse. "You may not see this" and
// "we could not compute this" warrant different UI and different user action.
type DomainError struct {
	Domain string          `json:"domain"`
	Kind   DomainErrorKind `json:"kind"`
	Detail string          `json:"detail,omitempty"`
}

type AttributionPath string

const (
	AttributionDirect AttributionPath = "direct"
	AttributionLinked AttributionPath = "linked"
)

type DomainBreakdown struct {
	Domain          string          `json:"domain"`
	Rel             string          `json:"rel"`   // owner|handler|advisor|reviewer|supervisor
	AttributionPath AttributionPath `json:"attribution_path"`
	Open            int             `json:"open"`
	Resolved        int             `json:"resolved"`
}

type TeamMemberMetrics struct {
	ActiveWorkload         MetricValue `json:"active_workload"`
	LoadIndexPct           MetricValue `json:"load_index_pct"`
	UtilisationPct         MetricValue `json:"utilisation_pct"`
	CompletionRatePct      MetricValue `json:"completion_rate_pct"`
	OnTimePct              MetricValue `json:"on_time_pct"`
	MedianCycleDays        MetricValue `json:"median_cycle_days"`
	ApprovalLatencyHrs     MetricValue `json:"approval_latency_hrs"`
	ObligationDischargePct MetricValue `json:"obligation_discharge_pct"`
	OverdueCount           MetricValue `json:"overdue_count"`
	IdleAssignmentPct      MetricValue `json:"idle_assignment_pct"`
}

type IdentityStatus string

const (
	IdentityResolved   IdentityStatus = "resolved"
	IdentityUnverified IdentityStatus = "unverified"  // fell back to denormalised name column
	IdentityUnknown    IdentityStatus = "unknown"
)

type TeamMember struct {
	UserID         uuid.UUID          `json:"user_id"`
	DisplayName    string             `json:"display_name"`
	AvatarURL      string             `json:"avatar_url,omitempty"`  // A6: may be omitted, see §4
	Title          map[string]string  `json:"title,omitempty"`       // bilingual JSONB, omitted when absent
	EntityID       *uuid.UUID         `json:"entity_id,omitempty"`
	IdentityStatus IdentityStatus     `json:"identity_status"`
	UserStatus     string             `json:"user_status"`           // "active" | "inactive" | ...
	Metrics        TeamMemberMetrics  `json:"metrics"`
	ByDomain       []DomainBreakdown  `json:"by_domain"`
	LinkedCount    int                `json:"linked_count"`          // items reached via indirect attribution
}

type WorkforceRollup struct {
	DistributionGini      MetricValue    `json:"distribution_gini"`
	KeyPersonConcentration MetricValue   `json:"key_person_concentration_pct"`
	BacklogBurnPct        MetricValue    `json:"backlog_burn_pct"`
	UnroutedRequests      MetricValue    `json:"unrouted_requests"`
	Aging                 map[string]int `json:"aging"` // d0_30, d31_60, d61_90, d90_plus
}

type WorkforceReport struct {
	Scope    ScopeEnvelope    `json:"scope"`
	Period   PeriodEnvelope   `json:"period"`
	Team     []TeamMember     `json:"team"`
	Rollup   WorkforceRollup  `json:"rollup"`
	Coverage CoverageEnvelope `json:"coverage"`
	Degraded bool             `json:"degraded"`
	Errors   []DomainError    `json:"errors"`
}
```

The handler wraps `WorkforceReport` in `suiteapi.WriteData`, producing `{"data": {…}}` —
confirmed at `backend/internal/suiteapi/http.go:40,55`.

### 1.2 TypeScript

Mirror the above exactly, camelCased at the API-client boundary in the module's existing style.
Place beside the panels. `MetricValue.value` is `number | null`; a `null` value with
`available: true` is a contract violation and should fail a type-level or runtime assertion.

---

## 2. Scope resolver

Recursive on `parent_id`. Do **not** use `legal_org_entities.path` — its contents are
unverified and a resolver governing who a director may see must not rest on an unverified
denormalisation.

Key off `legal_org_roles.role_key = 'legal_director'`, **not** the RBAC slug. The two
vocabularies are unreconciled: RBAC uses `legal-director` (hyphen), org uses `legal_director`
(underscore). The org binding is authoritative for scope.

```sql
-- $1 tenant_id, $2 caller_user_id
WITH RECURSIVE roots AS (
    SELECT e.id
      FROM legal_org_roles r
      JOIN legal_org_entities e
        ON e.id = r.entity_id AND e.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1
       AND r.user_id   = $2
       AND r.role_key  = 'legal_director'
       AND r.active
       AND e.active
),
subtree AS (
    SELECT id FROM roots
  UNION
    SELECT c.id
      FROM legal_org_entities c
      JOIN subtree s ON c.parent_id = s.id
     WHERE c.tenant_id = $1 AND c.active
)
SELECT DISTINCT m.user_id, m.entity_id, m.manager_user_id, m.title, m.capacity_units
  FROM legal_org_memberships m
  JOIN subtree s ON s.id = m.entity_id
 WHERE m.tenant_id = $1
   AND m.active
   AND m.deleted_at IS NULL;
```

*VERIFY:* `legal_org_roles` — confirm whether it carries `deleted_at`. If so, add
`AND r.deleted_at IS NULL`.

### 2.1 Mode selection

| Condition | Mode | Behaviour |
|---|---|---|
| Rows returned | `org` | Figures scoped to the subtree |
| Caller has no `legal_org_roles` row | `unscoped` | `reason: "no_org_role"`, department-wide figures, visible banner |
| `legal_org_memberships` missing or empty | `unscoped` | `reason: "roster_not_configured"`, department-wide figures, visible banner |
| `scope=self` | `self` | Caller only. **No workforce permission required** |
| `scope=tenant` | `tenant` | Requires `lex:workforce:read` **and** an executive role. Never the fallback for a failed org resolve |

`entity_id`, when supplied, must be validated as a member of `subtree`. Return **403** if it is
not. Never silently widen, never silently ignore.

---

## 3. Attribution CTE

### 3.1 Join corrections (A12)

Phase A found the assumed join columns wrong. Verified reality:

| Source | Link to request |
|---|---|
| `legal_consultations` | `legal_request_id` |
| `legal_cases` | **`request_id`** — not `legal_request_id` |
| `lex_contract_intakes` | **No request column.** Linked through `subject_id` / contract |

Because intakes have no request-grain link, they are **excluded from the request-attribution
branch**. They remain fully covered by direct attribution on `assigned_reviewer_id`. Replicate
the exact joins at `detailed_analytics_repo.go:215-235`; do not reconstruct them from this table.

### 3.2 Status semantics (A14 — new)

Phase A item 4 established what the existing resolution-rate endpoint counts as resolved. The
attribution CTE **aligns to those definitions** so that a completion rate and the resolution-rate
panel on the same screen cannot disagree.

Two booleans, both explicit. Do not conflate them: an abandoned item is neither open nor resolved,
and counting it either way corrupts the completion-rate denominator.

| Domain | `is_open` (on the owner's plate) | `is_resolved` | Abandoned |
|---|---|---|---|
| contracts | draft, internal_review, legal_review, negotiation, pending_signature, suspended | active, expired, terminated, renewed | cancelled |
| cases | intake, phase1, phase2, open, under_procedure | closed | cancelled |
| consultations | submitted, classified, routed | responded, approved, archived | — |
| matters | intake, open, in_review, waiting_on_business, on_hold | closed | cancelled |
| obligations | open, in_progress, blocked | completed | waived, cancelled |
| contract_intakes | received, acknowledged, routed_to_legal, under_review | completed | *VERIFY `returned`* |

`completion_rate_pct = resolved / (resolved + open)`. Abandoned excluded from both.

*VERIFY:* for `lex_contract_intakes`, determine whether `returned` is terminal or a loop-back.
The request spine treats `returned` as a loop-back; intakes may differ. Report what you find.

Note the consultations row: `responded` counts as resolved. This is the basis of A13 — once an
advisor has responded, their work is done, and the KPI must reflect the same boundary the
resolution-rate panel uses.

### 3.3 The CTE

```sql
-- $1 tenant_id, $2 user_ids uuid[]
WITH attribution AS (
    SELECT tenant_id, owner_user_id AS user_id, 'owner'::text AS rel,
           'contracts'::text AS domain, id AS subject_id, status,
           status IN ('draft','internal_review','legal_review','negotiation',
                      'pending_signature','suspended')                    AS is_open,
           status IN ('active','expired','terminated','renewed')           AS is_resolved,
           created_at, status_changed_at AS closed_at, expiry_date::date AS due_date,
           'direct'::text AS attribution_path
      FROM contracts
     WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_user_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, legal_reviewer_id, 'reviewer', 'contracts', id, status,
           status IN ('draft','internal_review','legal_review','negotiation',
                      'pending_signature','suspended'),
           status IN ('active','expired','terminated','renewed'),
           created_at, status_changed_at, expiry_date::date, 'direct'
      FROM contracts
     WHERE tenant_id = $1 AND deleted_at IS NULL AND legal_reviewer_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, owner_user_id, 'owner', 'matters', id, status,
           status IN ('intake','open','in_review','waiting_on_business','on_hold'),
           status = 'closed',
           created_at, closed_at, due_date, 'direct'
      FROM legal_matters
     WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_user_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, owner_user_id, 'owner', 'obligations', id, status,
           status IN ('open','in_progress','blocked'),
           status = 'completed',
           created_at, completed_at, due_date, 'direct'
      FROM legal_obligations
     WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_user_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, advisor_id, 'advisor', 'consultations', id, status,
           status IN ('submitted','classified','routed'),
           status IN ('responded','approved','archived'),
           created_at, COALESCE(archived_at, approved_at, responded_at), NULL::date, 'direct'
      FROM legal_consultations
     WHERE tenant_id = $1 AND deleted_at IS NULL AND advisor_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, handling_officer_id, 'handler', 'cases', id, status,
           status IN ('intake','phase1','phase2','open','under_procedure'),
           status = 'closed',
           created_at, NULL::timestamptz, NULL::date, 'direct'
      FROM legal_cases
     WHERE tenant_id = $1 AND deleted_at IS NULL AND handling_officer_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, supervisor_id, 'supervisor', 'cases', id, status,
           status IN ('intake','phase1','phase2','open','under_procedure'),
           status = 'closed',
           created_at, NULL::timestamptz, NULL::date, 'direct'
      FROM legal_cases
     WHERE tenant_id = $1 AND deleted_at IS NULL AND supervisor_id IS NOT NULL

  UNION ALL
    SELECT tenant_id, assigned_reviewer_id, 'reviewer', 'contract_intakes', id, status,
           status IN ('received','acknowledged','routed_to_legal','under_review'),
           status = 'completed',
           received_at, NULL::timestamptz, NULL::date, 'direct'
      FROM lex_contract_intakes
     WHERE tenant_id = $1 AND deleted_at IS NULL AND assigned_reviewer_id IS NOT NULL
)
SELECT * FROM attribution WHERE user_id = ANY($2);
```

`legal_cases.closed_at` is `NULL` throughout — the column does not exist. Case cycle time is
therefore unavailable, not approximated. Report it as `available: false,
reason: "no_close_timestamp"`. Adding the column is Phase 3 work, out of scope here.

### 3.4 Indirect attribution — requests

Separate branch, `attribution_path = 'linked'`. Never blended into the direct figure: the
headline number is direct, linked renders as secondary "+N via linked records", and sorting
and ranking use direct only.

Replicate the join structure from `detailed_analytics_repo.go:215-235` verbatim, corrected per
§3.1 — consultations on `legal_request_id`, cases on `request_id`, intakes excluded.

### 3.5 Grouping rule — absolute

```sql
-- FORBIDDEN. Exists at detailed_analytics_repo.go:249-250. Do not reproduce.
GROUP BY COALESCE(a.advisor_id::text, 'legacy:' || LOWER(BTRIM(a.advisor_name)))
```

It merges two people sharing a display name into one row and splits one person recorded under
two spellings into two. Group on non-null UUID only. Name-only rows are excluded from `team[]`
and counted in `coverage.items_unattributed`.

### 3.6 Unrouted requests

Goes in `rollup`, not `team` — it belongs to nobody by definition, which is the point.

```sql
SELECT count(*)
  FROM legal_requests s
 WHERE s.tenant_id = $1
   AND s.deleted_at IS NULL
   AND s.status NOT IN ('draft','cancelled','closed')
   AND NOT EXISTS (SELECT 1 FROM legal_consultations c WHERE c.legal_request_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM legal_cases         k WHERE k.request_id        = s.id);
```

Intakes omitted — no request-grain link exists (§3.1).

---

## 4. Identity resolution

Build `ResolveUsers(ctx, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]UserRef, error)`
against `platform_core`, wrapped in `database.RunReadWithTenant`, single round trip. The two
existing directories resolve one user at a time and are not reusable at team scale.

### 4.1 Avatar payload guard (A6)

`users.avatar_url` exists and stores raster data URLs inline, so each row carries the image
bytes.

Measure the batch payload for a 15-person team. **If the total exceeds ~200KB, drop `avatar_url`
from the batch select** and render monograms. Report the measured size in your summary. Do not
ship a dashboard that transfers a megabyte of base64 to draw fifteen circles.

### 4.2 Fallback order

1. Resolve UUID → `platform_core.users` → `identity_status: "resolved"`.
2. Unresolvable → denormalised name column (`owner_name`, `advisor_name`,
   `responsible_lawyer`) → `identity_status: "unverified"`.
3. Neither → excluded from `team[]`, counted in `coverage.items_unattributed`.

| Case | `display_name` |
|---|---|
| Resolves | `First Last` |
| Blank, `employee_code` present | `employee_code`, `identity_status: "unverified"` |
| Neither | `Unidentified user · …{last 4 of UUID}` — never blank, never a groupable "Unknown" |
| `users.status <> 'active'` with open items | Row renders, `user_status: "inactive"`. **Never dropped** — open work assigned to a departed user is a governance signal, and hiding it is how it stays unresolved |

`title` comes from `legal_org_memberships.title` (bilingual JSONB). When the membership row is
absent, **omit the field entirely**. Never infer a title from an RBAC role slug.

---

## 5. Unresolvable fields

Any field whose contract cannot be determined from this document plus the repository: implement
it as `MetricValue{Available: false, Reason: "<specific>"}`, list it in your summary under
"unresolved contracts", and do not guess a shape.

That is the correct behaviour, not a failure. A metric that renders as unavailable with a stated
reason is honest; a metric that renders a plausible number derived from an invented contract is
