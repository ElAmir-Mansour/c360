package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// ContractEntityRollupRow is one per-org-entity aggregate bucket over the
// CURRENT contract list filter set (GET /contracts/entity-rollup). Contracts
// without an org_entity_id fall into a single "unassigned" bucket where
// EntityID / EntityCode / EntityName are nil, so the row counts always
// reconcile with the filtered list total. EntityName is the bilingual
// legal_org_entities.name payload ({"ar","en"}), nil when the link dangles
// (entity deleted or never existed — no FK by design, see migration 000079).
type ContractEntityRollupRow struct {
	EntityID             *uuid.UUID           `json:"entity_id,omitempty"`
	EntityCode           *string              `json:"entity_code,omitempty"`
	EntityName           *forms.LocalizedText `json:"entity_name,omitempty"`
	Count                int                  `json:"count"`
	TotalValueByCurrency map[string]float64   `json:"total_value_by_currency"`
}

// ContractEntityRollup is the envelope for the per-entity contract aggregates.
// Filters echoes the effective list filters (same vocabulary as ContractReport)
// so the frontend can label the roll-up scope; Total is the contract count
// across all buckets (== filtered list total).
type ContractEntityRollup struct {
	TenantID    uuid.UUID                 `json:"tenant_id"`
	GeneratedAt time.Time                 `json:"generated_at"`
	Filters     map[string]string         `json:"filters"`
	Total       int                       `json:"total"`
	Items       []ContractEntityRollupRow `json:"items"`
}
