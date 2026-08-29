package model

import (
	"time"

	"github.com/google/uuid"
)

// LegalRequestPriorityChange is an append-only audit row (CAP-011) recording a
// reclassification of a request between the urgent/normal tiers. Rows are never
// updated or deleted (enforced by INSERT-only RLS on the backing table); the
// full change history is reconstructed by reading them in changed_at order.
type LegalRequestPriorityChange struct {
	ID           uuid.UUID       `json:"id"`
	TenantID     uuid.UUID       `json:"tenant_id"`
	RequestID    uuid.UUID       `json:"request_id"`
	FromPriority RequestPriority `json:"from_priority"`
	ToPriority   RequestPriority `json:"to_priority"`
	Reason       string          `json:"reason"`
	ChangedBy    uuid.UUID       `json:"changed_by"`
	ChangedAt    time.Time       `json:"changed_at"`
}
