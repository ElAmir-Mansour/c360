package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// EntityRollup aggregates contracts per linked legal-org entity over the SAME
// filter surface as ListContracts (GET /contracts/entity-rollup, feature #11):
// per bucket a contract count and total_value summed per currency. Total is the
// contract count across every bucket, so it always reconciles with the filtered
// list total the workspace is currently showing.
func (s *ContractService) EntityRollup(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) (*model.ContractEntityRollup, error) {
	items, err := s.contracts.EntityRollup(ctx, tenantID, filters)
	if err != nil {
		return nil, internalError("load contract entity rollup", err)
	}
	total := 0
	for _, item := range items {
		total += item.Count
	}
	return &model.ContractEntityRollup{
		TenantID:    tenantID,
		GeneratedAt: s.now().UTC(),
		Filters:     contractReportFilters(filters),
		Total:       total,
		Items:       items,
	}, nil
}

// normalizeOptionalUUID collapses a pointer to the zero UUID to nil, mirroring
// normalizeOptionalString for the optional org_entity_id link.
func normalizeOptionalUUID(id *uuid.UUID) *uuid.UUID {
	if id == nil || *id == uuid.Nil {
		return nil
	}
	return id
}
