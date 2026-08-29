package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ContractClauseAmendmentService owns the proposed-clause-amendment lifecycle
// (CAP-111): propose a redlined revision of a clause, list the proposals on a
// clause, and accept/reject one. Every query is tenant-scoped, the parent clause
// (and thus the contract) is verified to exist, and mutations publish a lex
// domain event. Mirrors MatterCommentService.
//
// An accepted amendment is the input the review-desk recommendation (CAP-118)
// reads back: see the app-wiring note on RecordRecommendation. This service does
// not itself call RecordRecommendation — that coupling is owned by the
// review-desk flow, which reads accepted amendments via ListAmendments.
type ContractClauseAmendmentService struct {
	db         *pgxpool.Pool
	clauses    *repository.ClauseRepository
	amendments *repository.ContractClauseAmendmentRepository
	publisher  Publisher
	topic      string
	logger     zerolog.Logger
	now        func() time.Time
}

func NewContractClauseAmendmentService(db *pgxpool.Pool, clauses *repository.ClauseRepository, amendments *repository.ContractClauseAmendmentRepository, publisher Publisher, topic string, logger zerolog.Logger) *ContractClauseAmendmentService {
	return &ContractClauseAmendmentService{
		db:         db,
		clauses:    clauses,
		amendments: amendments,
		publisher:  publisherOrNoop(publisher),
		topic:      topic,
		logger:     logger.With().Str("service", "lex-clause-amendments").Logger(),
		now:        time.Now,
	}
}

// loadClause fetches the parent clause tenant- and contract-scoped, translating
// ErrNoRows into a 404. It backs both the existence check and the current-text
// snapshot used to baseline a redline when the client omits original_text.
func (s *ContractClauseAmendmentService) loadClause(ctx context.Context, tenantID, contractID, clauseID uuid.UUID) (*model.Clause, error) {
	clause, err := s.clauses.Get(ctx, tenantID, contractID, clauseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause not found")
		}
		return nil, internalError("load clause", err)
	}
	return clause, nil
}

func (s *ContractClauseAmendmentService) ListAmendments(ctx context.Context, tenantID, contractID, clauseID uuid.UUID) ([]model.ContractClauseAmendment, error) {
	if _, err := s.loadClause(ctx, tenantID, contractID, clauseID); err != nil {
		return nil, err
	}
	items, err := s.amendments.ListByClause(ctx, tenantID, contractID, clauseID)
	if err != nil {
		return nil, internalError("list clause amendments", err)
	}
	return items, nil
}

func (s *ContractClauseAmendmentService) ProposeAmendment(ctx context.Context, tenantID, userID, contractID, clauseID uuid.UUID, req dto.ProposeClauseAmendmentRequest) (*model.ContractClauseAmendment, error) {
	req.Normalize()
	if req.ProposedText == "" {
		return nil, validationError("proposed_text is required", map[string]string{"proposed_text": "required"})
	}
	clause, err := s.loadClause(ctx, tenantID, contractID, clauseID)
	if err != nil {
		return nil, err
	}
	// Baseline the redline against the clause's current content when the client
	// does not supply its own original_text snapshot.
	originalText := req.OriginalText
	if originalText == "" {
		originalText = clause.Content
	}
	amendment := &model.ContractClauseAmendment{
		ID:           uuid.New(),
		TenantID:     tenantID,
		ClauseID:     clauseID,
		ContractID:   contractID,
		OriginalText: originalText,
		ProposedText: req.ProposedText,
		Reason:       req.Reason,
		Status:       model.ClauseAmendmentProposed,
		ProposedBy:   userID,
	}
	if err := s.amendments.Create(ctx, s.db, amendment); err != nil {
		return nil, internalError("create clause amendment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.amendment_proposed", tenantID, &userID, map[string]any{
		"id":           amendment.ID,
		"clause_id":    clauseID,
		"contract_id":  contractID,
		"proposed_by":  userID,
		"amendment_id": amendment.ID,
	}, s.logger)
	return amendment, nil
}

func (s *ContractClauseAmendmentService) DecideAmendment(ctx context.Context, tenantID, userID, contractID, clauseID, amendmentID uuid.UUID, req dto.DecideClauseAmendmentRequest) (*model.ContractClauseAmendment, error) {
	req.Normalize()
	if req.Status != model.ClauseAmendmentAccepted && req.Status != model.ClauseAmendmentRejected {
		return nil, validationError("status must be accepted or rejected", map[string]string{"status": "invalid"})
	}
	existing, err := s.amendments.Get(ctx, tenantID, contractID, clauseID, amendmentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause amendment not found")
		}
		return nil, internalError("load clause amendment", err)
	}
	if existing.Status != model.ClauseAmendmentProposed {
		return nil, conflictError("clause amendment has already been decided")
	}
	if err := s.amendments.Decide(ctx, s.db, tenantID, contractID, clauseID, amendmentID, userID, req.Status); err != nil {
		if err == pgx.ErrNoRows {
			// Lost a race: another decider transitioned the row first.
			return nil, conflictError("clause amendment has already been decided")
		}
		return nil, internalError("decide clause amendment", err)
	}
	amendment, err := s.amendments.Get(ctx, tenantID, contractID, clauseID, amendmentID)
	if err != nil {
		return nil, internalError("reload clause amendment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.amendment_decided", tenantID, &userID, map[string]any{
		"id":           amendment.ID,
		"clause_id":    clauseID,
		"contract_id":  contractID,
		"status":       amendment.Status,
		"decided_by":   userID,
		"amendment_id": amendment.ID,
	}, s.logger)
	return amendment, nil
}
