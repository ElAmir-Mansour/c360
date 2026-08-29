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

// SettlementDocumentService manages the settlement <-> document registry links
// (FEATURE 12). It mirrors the matter document-link flow: validate the settlement
// and the target document exist, insert the join row in a transaction, emit a
// CloudEvent. The linked document is never created or mutated here — only the link
// row — and deletes remove the LINK, never the document (WORM).
type SettlementDocumentService struct {
	db          *pgxpool.Pool
	settlements *repository.SettlementRepository
	links       *repository.SettlementDocumentRepository
	documents   *repository.DocumentRepository
	publisher   Publisher
	metrics     *metrics.Metrics
	topic       string
	logger      zerolog.Logger
}

func NewSettlementDocumentService(
	db *pgxpool.Pool,
	settlements *repository.SettlementRepository,
	links *repository.SettlementDocumentRepository,
	documents *repository.DocumentRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *SettlementDocumentService {
	return &SettlementDocumentService{
		db:          db,
		settlements: settlements,
		links:       links,
		documents:   documents,
		publisher:   publisherOrNoop(publisher),
		metrics:     appMetrics,
		topic:       topic,
		logger:      logger.With().Str("service", "lex-settlement-documents").Logger(),
	}
}

func (s *SettlementDocumentService) ListDocuments(ctx context.Context, tenantID, settlementID uuid.UUID) ([]model.SettlementDocumentLink, error) {
	if err := s.ensureSettlementExists(ctx, tenantID, settlementID); err != nil {
		return nil, err
	}
	items, err := s.links.ListBySettlement(ctx, tenantID, settlementID)
	if err != nil {
		return nil, internalError("list settlement documents", err)
	}
	return items, nil
}

func (s *SettlementDocumentService) AddDocument(ctx context.Context, tenantID, userID, settlementID uuid.UUID, req dto.CreateSettlementDocumentLinkRequest) (*model.SettlementDocumentLink, error) {
	req.Normalize()
	if err := s.ensureSettlementExists(ctx, tenantID, settlementID); err != nil {
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

	link := &model.SettlementDocumentLink{
		ID:           uuid.New(),
		TenantID:     tenantID,
		SettlementID: settlementID,
		DocumentID:   *req.DocumentID,
		Relationship: req.Relationship,
		CreatedBy:    userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start settlement document transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.links.Create(ctx, tx, link); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("document is already linked to this settlement")
		}
		return nil, internalError("link settlement document", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit settlement document transaction", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.document_linked", tenantID, &userID, map[string]any{
		"id": settlementID, "settlement_id": settlementID, "settlement_document_id": link.ID, "document_id": link.DocumentID, "relationship": link.Relationship,
	}, s.logger)
	return s.links.Get(ctx, tenantID, settlementID, link.ID)
}

func (s *SettlementDocumentService) DeleteDocument(ctx context.Context, tenantID, userID, settlementID, linkID uuid.UUID) error {
	link, err := s.links.Get(ctx, tenantID, settlementID, linkID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("settlement document link not found")
		}
		return internalError("load settlement document link", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start settlement document delete transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.links.SoftDeleteTx(ctx, tx, tenantID, settlementID, linkID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("settlement document link not found")
		}
		return internalError("delete settlement document link", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit settlement document delete transaction", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.settlement.document_unlinked", tenantID, &userID, map[string]any{
		"id": settlementID, "settlement_id": settlementID, "settlement_document_id": linkID, "document_id": link.DocumentID,
	}, s.logger)
	return nil
}

func (s *SettlementDocumentService) ensureSettlementExists(ctx context.Context, tenantID, settlementID uuid.UUID) error {
	if _, err := s.settlements.Get(ctx, tenantID, settlementID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("settlement not found")
		}
		return internalError("load settlement", err)
	}
	return nil
}
