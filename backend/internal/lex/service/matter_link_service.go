package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// MatterLinkService manages cross-domain related-items edges from a matter to
// sibling lex entities (FEATURE 9). It verifies the parent matter exists and is
// visible to the tenant before mutating, validates that the link target exists
// and belongs to the same tenant (no dangling links), tenant-scopes every
// operation, dedups against the unique index with a friendly conflict, and
// emits domain events mirroring the other matter sub-resources.
//
// Enrichment choice: the target rows live in heterogeneous domains
// (consultations, investigations, legal cases, settlements, litigation,
// contracts), each with its own repository, table, and column shapes. Rather
// than couple this service to six aggregate repositories, the link repository
// owns a single per-target-type mapping (table + reference/title columns) and
// resolves existence + display fields in one query per distinct type. The
// model carries optional TargetReference/TargetTitle fields; these are
// populated best-effort on read and are additive to the wire contract, so the
// frontend type continues to match.
type MatterLinkService struct {
	matters   *repository.MatterRepository
	links     *repository.MatterLinkRepository
	publisher Publisher
	topic     string
	logger    zerolog.Logger
}

func NewMatterLinkService(
	matters *repository.MatterRepository,
	links *repository.MatterLinkRepository,
	publisher Publisher,
	topic string,
	logger zerolog.Logger,
) *MatterLinkService {
	return &MatterLinkService{
		matters:   matters,
		links:     links,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger,
	}
}

func (s *MatterLinkService) ensureMatterExists(ctx context.Context, tenantID, matterID uuid.UUID) error {
	if _, err := s.matters.Get(ctx, tenantID, matterID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter not found")
		}
		return internalError("load matter", err)
	}
	return nil
}

func (s *MatterLinkService) ListLinks(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterLink, error) {
	if err := s.ensureMatterExists(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	items, err := s.links.ListByMatter(ctx, tenantID, matterID)
	if err != nil {
		return nil, internalError("list matter links", err)
	}
	// Best-effort enrichment: populate target reference/title in place. Failures
	// are swallowed inside EnrichTargets so the list never fails on a stale or
	// since-deleted target.
	s.links.EnrichTargets(ctx, tenantID, items)
	return items, nil
}

func (s *MatterLinkService) AddLink(ctx context.Context, tenantID, userID, matterID uuid.UUID, req dto.CreateMatterLinkRequest) (*model.MatterLink, error) {
	req.Normalize()
	if !model.ValidMatterLinkTargetType(req.TargetType) {
		return nil, validationError("invalid target_type", map[string]string{"target_type": "invalid"})
	}
	if req.TargetID == uuid.Nil {
		return nil, validationError("target_id is required", map[string]string{"target_id": "required"})
	}
	if err := s.ensureMatterExists(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	// Validate the target before inserting: the referenced entity must exist and
	// belong to the same tenant. This rejects dangling links with a clear 4xx
	// instead of persisting an edge that points at nothing. ResolveTarget also
	// hands back the reference/title we use to enrich the created row below.
	reference, title, err := s.links.ResolveTarget(ctx, tenantID, req.TargetType, req.TargetID)
	if err != nil {
		if err == repository.ErrTargetNotFound {
			return nil, validationError("target not found for this tenant", map[string]string{"target_id": "not_found"})
		}
		return nil, internalError("resolve matter link target", err)
	}
	link := &model.MatterLink{
		ID:           uuid.New(),
		TenantID:     tenantID,
		MatterID:     matterID,
		TargetType:   req.TargetType,
		TargetID:     req.TargetID,
		Relationship: req.Relationship,
		CreatedBy:    userID,
	}
	if err := s.links.Create(ctx, link); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("this related item is already linked to the matter")
		}
		return nil, internalError("create matter link", err)
	}
	link.TargetReference = reference
	link.TargetTitle = title
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.related_linked", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "link_id": link.ID,
		"target_type": string(link.TargetType), "target_id": link.TargetID,
	}, s.logger)
	return link, nil
}

func (s *MatterLinkService) DeleteLink(ctx context.Context, tenantID, userID, matterID, linkID uuid.UUID) error {
	if err := s.ensureMatterExists(ctx, tenantID, matterID); err != nil {
		return err
	}
	if err := s.links.Delete(ctx, tenantID, matterID, linkID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter link not found")
		}
		return internalError("delete matter link", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.related_unlinked", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "link_id": linkID,
	}, s.logger)
	return nil
}
