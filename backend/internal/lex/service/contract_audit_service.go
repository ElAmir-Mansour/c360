package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ContractAuditService exposes the READ path over the contract portfolio
// audit feed (GET /contracts/audit). It mirrors MatterAuditService's shape —
// a thin, tenant-scoped projection service — but operates portfolio-wide:
// instead of one aggregate's trail it returns the merged, filter-aware event
// stream projected from the durable governance columns contracts already
// write (creation, status transitions with before→after, CAP-122 archive
// stamps, analysis completions, version uploads, metadata timeline entries).
// There is no mutation surface: the feed is append-only by construction.
type ContractAuditService struct {
	audit *repository.ContractAuditRepository
}

func NewContractAuditService(audit *repository.ContractAuditRepository) *ContractAuditService {
	return &ContractAuditService{audit: audit}
}

// ListPortfolioAudit returns one page of the tenant's contract audit feed
// (newest-first) plus the total matching event count. Filters carry the same
// contract-list semantics as GET /contracts plus an occurred_at window.
func (s *ContractAuditService) ListPortfolioAudit(ctx context.Context, tenantID uuid.UUID, filters model.ContractAuditFilters) ([]model.ContractAuditEvent, int, error) {
	if filters.From != nil && filters.To != nil && filters.To.Before(*filters.From) {
		return nil, 0, validationError("'to' must not be before 'from'", map[string]string{"to": "must not be before 'from'"})
	}
	events, total, err := s.audit.ListPortfolioAudit(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("load contract portfolio audit", err)
	}
	return events, total, nil
}
