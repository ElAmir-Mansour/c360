package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// CreateCaseClassificationRequest adds a node to the case-classification taxonomy
// (CAP-075). parent_id (optional) places the node under an existing classification
// so admins can extend the cascading chain.
type CreateCaseClassificationRequest struct {
	ParentID *uuid.UUID          `json:"parent_id,omitempty"`
	Code     string              `json:"code"`
	Name     forms.LocalizedText `json:"name"`
	Active   *bool               `json:"active,omitempty"`
	Sort     *int                `json:"sort,omitempty"`
	Metadata map[string]any      `json:"metadata,omitempty"`
}

// UpdateCaseClassificationRequest patches a node. Nil fields are left unchanged.
// Reparenting via parent_id rewrites the materialized path of the node and all of
// its descendants. is_system classifications cannot be reparented or deactivated
// destructively (enforced in the service).
type UpdateCaseClassificationRequest struct {
	ParentID *uuid.UUID           `json:"parent_id,omitempty"`
	Code     *string              `json:"code,omitempty"`
	Name     *forms.LocalizedText `json:"name,omitempty"`
	Active   *bool                `json:"active,omitempty"`
	Sort     *int                 `json:"sort,omitempty"`
	Metadata map[string]any       `json:"metadata,omitempty"`
}

// MergeCaseClassificationRequest deprecates the source classification and
// redirects every matter referencing it to target_id (feature #5).
type MergeCaseClassificationRequest struct {
	TargetID uuid.UUID `json:"target_id"`
}

// MergeCaseClassificationResult reports the outcome of a merge: how many matters
// were reassigned and that the source was deactivated.
type MergeCaseClassificationResult struct {
	SourceID          uuid.UUID `json:"source_id"`
	TargetID          uuid.UUID `json:"target_id"`
	Reassigned        int64     `json:"reassigned"`
	SourceDeactivated bool      `json:"source_deactivated"`
}

// CaseClassificationAuditEntry is one row of the append-only governance audit log
// projected for the admin UI (newest-first). actor_id/actor_name are nullable
// (the audit log carries only actor_id; actor_name is reserved for an optional
// future user join and is currently null). before/after are the raw JSON
// snapshots captured around the mutation.
type CaseClassificationAuditEntry struct {
	ID               uuid.UUID  `json:"id"`
	ClassificationID uuid.UUID  `json:"classification_id"`
	Action           string     `json:"action"`
	ActorID          *uuid.UUID `json:"actor_id"`
	ActorName        *string    `json:"actor_name,omitempty"`
	Before           any        `json:"before"`
	After            any        `json:"after"`
	CreatedAt        time.Time  `json:"created_at"`
}

// ReorderCaseClassificationsRequest atomically re-sequences the sibling set under
// parent_id: each id in ordered_ids has its sort set to its index. parent_id is
// null for root-level nodes. All ids must be current siblings of parent_id
// (tenant-scoped) or the request is rejected.
type ReorderCaseClassificationsRequest struct {
	ParentID   *uuid.UUID  `json:"parent_id"`
	OrderedIDs []uuid.UUID `json:"ordered_ids"`
}

// ReorderCaseClassificationsResult reports how many rows had their sort updated.
type ReorderCaseClassificationsResult struct {
	Updated int `json:"updated"`
}

// BulkCaseClassificationsRequest flips the active flag on many classifications in
// one transaction. action is "activate" or "deactivate". System (is_system) rows
// are skipped on deactivate (mirroring delete semantics) and counted out of the
// updated total.
type BulkCaseClassificationsRequest struct {
	Action string      `json:"action"`
	IDs    []uuid.UUID `json:"ids"`
}

// BulkCaseClassificationsResult reports how many rows were actually flipped (rows
// already in the target state, missing rows, and skipped system rows are excluded).
type BulkCaseClassificationsResult struct {
	Updated int `json:"updated"`
}

func (r *CreateCaseClassificationRequest) Normalize() {
	r.Code = strings.ToUpper(strings.TrimSpace(r.Code))
	r.Name.AR = strings.TrimSpace(r.Name.AR)
	r.Name.EN = strings.TrimSpace(r.Name.EN)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *UpdateCaseClassificationRequest) Normalize() {
	if r.Code != nil {
		trimmed := strings.ToUpper(strings.TrimSpace(*r.Code))
		r.Code = &trimmed
	}
	if r.Name != nil {
		r.Name.AR = strings.TrimSpace(r.Name.AR)
		r.Name.EN = strings.TrimSpace(r.Name.EN)
	}
}
