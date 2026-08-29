package model

import (
	"time"

	"github.com/google/uuid"
)

// Contract portfolio audit event types. They reuse the per-contract timeline
// vocabulary (buildContractTimeline) so a row in the portfolio feed and a row
// in GET /contracts/{id}/timeline describing the same fact carry the same
// event_type; contract_archived is feed-only because the timeline does not yet
// project the CAP-122 archive columns.
const (
	ContractAuditEventCreated           = "contract_created"
	ContractAuditEventStatusChanged     = "status_changed"
	ContractAuditEventArchived          = "contract_archived"
	ContractAuditEventAnalysisCompleted = "analysis_completed"
	ContractAuditEventVersionUploaded   = "version_uploaded"
	ContractAuditEventMetadata          = "metadata_event"
)

// ContractAuditEvent is one row of the tenant-wide contract portfolio audit
// feed (GET /contracts/audit): who changed what on which contract, when, and
// the before→after values where the schema retains them. Events are PROJECTED
// from the same durable storage the per-contract timeline reads —
// contracts.created_at / status_changed_* / archive_* / last_analyzed_at,
// contract_versions, and contracts.metadata->'timeline' — so the feed is
// append-only by construction: there is no second write path that could drift
// from the source of truth, and nothing in the feed is updatable in place.
type ContractAuditEvent struct {
	// ID is a synthetic, stable identifier derived from the projected row
	// (contract id + event kind, or the version row id) so clients can key on it.
	ID            string    `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	ContractID    uuid.UUID `json:"contract_id"`
	ContractTitle string    `json:"contract_title"`
	EventType     string    `json:"event_type"`
	// Field names the audited attribute (status, archive_status, risk_level,
	// document_version, lifecycle) so the frontend can group/filter columns.
	Field  string  `json:"field"`
	Before *string `json:"before,omitempty"`
	After  *string `json:"after,omitempty"`
	// ActorUserID is the mutating user where the schema stamps one (created_by,
	// status_changed_by, archived_by, uploaded_by); nil for system-derived
	// events such as analysis completion.
	ActorUserID *uuid.UUID `json:"actor_user_id,omitempty"`
	OccurredAt  time.Time  `json:"occurred_at"`
	// Source is the storage provenance of the event (e.g.
	// "contracts.status_changed_at"), mirroring ContractTimelineEvent.Source.
	Source string         `json:"source"`
	Detail map[string]any `json:"detail"`
}

// ContractAuditFilters scopes the portfolio audit feed. It embeds the
// contract-list filter set (status/type/risk_level/department/tag/search/
// owner + pagination) so the feed answers "the audit trail of exactly the
// contracts I am looking at" with the same query params as GET /contracts,
// plus an occurred_at window: From is inclusive; To is exclusive (the handler
// normalizes a date-only "to" to inclusive end-of-day before it gets here).
type ContractAuditFilters struct {
	ContractListFilters
	From *time.Time
	To   *time.Time
}
