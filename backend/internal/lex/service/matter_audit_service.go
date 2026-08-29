package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// MatterAuditService exposes the READ path over the append-only matter
// governance trail (legal_matter_audit_log). It mirrors SettlementService.ListAudit:
// verify the matter exists + is tenant-scoped, then return the chronological trail.
//
// NOTE: matter mutations do not currently emit rows into this table (see
// repository/matter_audit_repo.go), so the feed is empty until emission is wired
// in a follow-up. The read path is correct and ships independently.
type MatterAuditService struct {
	matters *repository.MatterRepository
	audit   *repository.MatterAuditRepository
}

func NewMatterAuditService(matters *repository.MatterRepository, audit *repository.MatterAuditRepository) *MatterAuditService {
	return &MatterAuditService{matters: matters, audit: audit}
}

// ListAudit returns the append-only governance trail for a matter, oldest-first.
func (s *MatterAuditService) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]model.MatterAuditEntry, error) {
	if _, err := s.matters.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	entries, err := s.audit.ListAudit(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load matter audit", err)
	}
	return entries, nil
}
