package model

import (
	"time"

	"github.com/google/uuid"
)

// MatterAuditEntry is one append-only governance audit row for a matter
// (lifecycle: create, triage, status transitions, contract link/unlink, update).
// It mirrors SettlementAuditEntry / LegalCaseAuditEntry: the backing table is
// INSERT-only at the RLS layer (no UPDATE/DELETE policy), so the trail is
// tamper-evident. Entries are returned oldest-first (chronological).
type MatterAuditEntry struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	MatterID    uuid.UUID      `json:"matter_id"`
	Action      string         `json:"action"`
	FromStatus  *string        `json:"from_status,omitempty"`
	ToStatus    *string        `json:"to_status,omitempty"`
	Detail      map[string]any `json:"detail"`
	ActorUserID uuid.UUID      `json:"actor_user_id"`
	CreatedAt   time.Time      `json:"created_at"`
}
