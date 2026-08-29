package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// MatterDocumentService manages the matter <-> document registry links (FEATURE
// 5). It mirrors the case document-link flow: validate the matter and the target
// document exist, insert the join row in a transaction, emit a CloudEvent. The
// linked document is never created or mutated here — only the link row — and
// deletes remove the LINK, never the document (WORM).
type MatterDocumentService struct {
	db        *pgxpool.Pool
	matters   *repository.MatterRepository
	links     *repository.MatterDocumentRepository
	documents *repository.DocumentRepository
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
}

func NewMatterDocumentService(
	db *pgxpool.Pool,
	matters *repository.MatterRepository,
	links *repository.MatterDocumentRepository,
	documents *repository.DocumentRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *MatterDocumentService {
	return &MatterDocumentService{
		db:        db,
		matters:   matters,
		links:     links,
		documents: documents,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-matter-documents").Logger(),
	}
}

func (s *MatterDocumentService) ListDocuments(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterDocumentLink, error) {
	if err := s.ensureMatterExists(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	items, err := s.links.ListByMatter(ctx, tenantID, matterID)
	if err != nil {
		return nil, internalError("list matter documents", err)
	}
	return items, nil
}

func (s *MatterDocumentService) AddDocument(ctx context.Context, tenantID, userID, matterID uuid.UUID, req dto.CreateMatterDocumentLinkRequest) (*model.MatterDocumentLink, error) {
	req.Normalize()
	if err := s.ensureMatterExists(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	if req.DocumentID == nil {
		return nil, validationError("document_id is required", map[string]string{"document_id": "required"})
	}
	if _, err := s.documents.Get(ctx, tenantID, *req.DocumentID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, validationError("linked document not found", map[string]string{"document_id": "not_found"})
		}
		return nil, internalError("load linked document", err)
	}

	link := &model.MatterDocumentLink{
		ID:           uuid.New(),
		TenantID:     tenantID,
		MatterID:     matterID,
		DocumentID:   *req.DocumentID,
		Relationship: req.Relationship,
		CreatedBy:    userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start matter document transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.links.Create(ctx, tx, link); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("document is already linked to this matter")
		}
		return nil, internalError("link matter document", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit matter document transaction", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.document_linked", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "matter_document_id": link.ID, "document_id": link.DocumentID, "relationship": link.Relationship,
	}, s.logger)
	return s.links.Get(ctx, tenantID, matterID, link.ID)
}

func (s *MatterDocumentService) DeleteDocument(ctx context.Context, tenantID, userID, matterID, linkID uuid.UUID) error {
	link, err := s.links.Get(ctx, tenantID, matterID, linkID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter document link not found")
		}
		return internalError("load matter document link", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start matter document delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.links.SoftDeleteTx(ctx, tx, tenantID, matterID, linkID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter document link not found")
		}
		return internalError("delete matter document link", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit matter document delete transaction", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.document_unlinked", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "matter_document_id": linkID, "document_id": link.DocumentID,
	}, s.logger)
	return nil
}

func (s *MatterDocumentService) ensureMatterExists(ctx context.Context, tenantID, matterID uuid.UUID) error {
	if _, err := s.matters.Get(ctx, tenantID, matterID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter not found")
		}
		return internalError("load matter", err)
	}
	return nil
}
