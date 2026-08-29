package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// RequestNoteService owns the internal collaboration-note lifecycle on a legal
// request. It mirrors the matter/case comment services: every query is
// tenant-scoped, the parent request is verified to exist, and a note write
// publishes a lex domain event. Mentions are persisted as provided (user IDs or
// display handles); resolving/notifying recipients is intentionally out of scope.
type RequestNoteService struct {
	db        *pgxpool.Pool
	requests  *repository.LegalRequestRepository
	notes     *repository.RequestNoteRepository
	publisher Publisher
	topic     string
	logger    zerolog.Logger
}

func NewRequestNoteService(db *pgxpool.Pool, requests *repository.LegalRequestRepository, notes *repository.RequestNoteRepository, publisher Publisher, topic string, logger zerolog.Logger) *RequestNoteService {
	return &RequestNoteService{
		db:        db,
		requests:  requests,
		notes:     notes,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-request-notes").Logger(),
	}
}

// ensureRequestExists verifies the parent request is visible in the tenant,
// translating ErrNoRows into a 404.
func (s *RequestNoteService) ensureRequestExists(ctx context.Context, tenantID, requestID uuid.UUID) error {
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal request not found")
		}
		return internalError("load legal request", err)
	}
	return enforceBaseRequesterOwnRequest(ctx, request)
}

func (s *RequestNoteService) ListNotes(ctx context.Context, tenantID, requestID uuid.UUID) ([]model.RequestNote, error) {
	if err := s.ensureRequestExists(ctx, tenantID, requestID); err != nil {
		return nil, err
	}
	items, err := s.notes.ListByRequest(ctx, tenantID, requestID)
	if err != nil {
		return nil, internalError("list request notes", err)
	}
	return items, nil
}

func (s *RequestNoteService) AddNote(ctx context.Context, tenantID, userID, requestID uuid.UUID, authorName string, req dto.CreateRequestNoteRequest) (*model.RequestNote, error) {
	req.Normalize()
	if req.Body == "" {
		return nil, validationError("note body is required", map[string]string{"body": "required"})
	}
	if err := s.ensureRequestExists(ctx, tenantID, requestID); err != nil {
		return nil, err
	}
	note := &model.RequestNote{
		ID:         uuid.New(),
		TenantID:   tenantID,
		RequestID:  requestID,
		Body:       req.Body,
		Mentions:   req.Mentions,
		AuthorID:   userID,
		AuthorName: authorName,
	}
	if err := s.notes.Create(ctx, s.db, note); err != nil {
		return nil, internalError("create request note", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.requests.note_added", tenantID, &userID, map[string]any{
		"id": requestID, "request_id": requestID, "note_id": note.ID, "mentions": note.Mentions,
	}, s.logger)
	return note, nil
}
