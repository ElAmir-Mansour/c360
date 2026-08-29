package model

import (
	"time"

	"github.com/google/uuid"
)

// RequestNote is a persisted internal collaboration note on a legal request
// (Al Othaim PRD request detail right rail). Unlike the lifecycle-tied fields
// (approval decision notes, delivery/return reasons), these are free-form
// internal notes. Mentions are stored so the frontend can render @mentions.
// Author identity is denormalized (author_id + author_name) so the note thread
// renders without an extra user lookup. Mirrors MatterComment.
type RequestNote struct {
	ID        uuid.UUID `json:"id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	RequestID uuid.UUID `json:"request_id"`
	// Cycle is the review round this note belongs to, stamped from the request's
	// counter at insert. A request returned and resubmitted accrues rounds, and the
	// detail thread groups by this so "what was said the second time round" is
	// legible rather than lost in a flat list.
	Cycle      int        `json:"cycle"`
	Body       string     `json:"body"`
	Mentions   []string   `json:"mentions"`
	AuthorID   uuid.UUID  `json:"author_id"`
	AuthorName string     `json:"author_name"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	DeletedAt  *time.Time `json:"deleted_at,omitempty"`
}
