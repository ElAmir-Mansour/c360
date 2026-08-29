package model

import (
	"time"

	"github.com/google/uuid"
)

// LegalRequestFeedback is the requester's append-only satisfaction response for
// one delivered or closed legal request. Rating is constrained to the 1..5
// scale in both the service and database.
type LegalRequestFeedback struct {
	ID          uuid.UUID `json:"id"`
	TenantID    uuid.UUID `json:"tenant_id"`
	RequestID   uuid.UUID `json:"request_id"`
	Rating      int       `json:"rating"`
	Comment     string    `json:"comment"`
	SubmittedBy uuid.UUID `json:"submitted_by"`
	SubmittedAt time.Time `json:"submitted_at"`
}
