package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/repository"
)

// DocumentSearchService exposes full-text search over the legal document
// repository (CAP-169/182). It is read-mostly: Search ranks hits via the GIN-
// indexed search_vector; IndexExtractedText is the write seam that stores the
// extracted/OCR text so the GENERATED search_vector picks up document bodies.
type DocumentSearchService struct {
	repo   *repository.DocumentSearchRepository
	docs   *repository.DocumentRepository
	logger zerolog.Logger
	now    func() time.Time
}

func NewDocumentSearchService(repo *repository.DocumentSearchRepository, docs *repository.DocumentRepository, logger zerolog.Logger) *DocumentSearchService {
	return &DocumentSearchService{
		repo:   repo,
		docs:   docs,
		logger: logger.With().Str("service", "lex-document-search").Logger(),
		now:    time.Now,
	}
}

// Search runs the FTS query within tenant scope.
func (s *DocumentSearchService) Search(ctx context.Context, tenantID uuid.UUID, req dto.DocumentSearchRequest, page, perPage int) ([]dto.DocumentSearchHit, int, error) {
	req.Normalize()
	if req.Query == "" {
		return nil, 0, validationError("query is required", map[string]string{"query": "required"})
	}
	hits, total, err := s.repo.Search(ctx, tenantID, req, page, perPage)
	if err != nil {
		return nil, 0, internalError("search legal documents", err)
	}
	return hits, total, nil
}

// IndexExtractedText stores the document's extracted plaintext so the FTS vector
// includes the body. The document must exist within the tenant.
func (s *DocumentSearchService) IndexExtractedText(ctx context.Context, tenantID, documentID uuid.UUID, text string) error {
	if _, err := s.docs.Get(ctx, tenantID, documentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("document not found")
		}
		return internalError("load document", err)
	}
	if err := s.repo.SetExtractedText(ctx, tenantID, documentID, text); err != nil {
		return internalError("index document text", err)
	}
	return nil
}
