package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ContractClauseCommentService owns the clause collaboration-note lifecycle
// (CAP-110). It clones MatterCommentService: every query is tenant-scoped, the
// parent clause is verified to exist (tenant + contract + clause), mutations
// publish a lex domain event, and @mentions fan best-effort notifications. The
// thread is scoped by (tenant, contract, clause); replies carry parent_comment_id.
type ContractClauseCommentService struct {
	db        *pgxpool.Pool
	clauses   *repository.ClauseRepository
	comments  *repository.ContractClauseCommentRepository
	publisher Publisher
	topic     string
	logger    zerolog.Logger
}

func NewContractClauseCommentService(db *pgxpool.Pool, clauses *repository.ClauseRepository, comments *repository.ContractClauseCommentRepository, publisher Publisher, topic string, logger zerolog.Logger) *ContractClauseCommentService {
	return &ContractClauseCommentService{
		db:        db,
		clauses:   clauses,
		comments:  comments,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-clause-comments").Logger(),
	}
}

// loadClause fetches the parent clause tenant-scoped, translating ErrNoRows into
// a 404. It backs the existence check guarding every comment operation.
func (s *ContractClauseCommentService) loadClause(ctx context.Context, tenantID, contractID, clauseID uuid.UUID) (*model.Clause, error) {
	clause, err := s.clauses.Get(ctx, tenantID, contractID, clauseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause not found")
		}
		return nil, internalError("load clause", err)
	}
	return clause, nil
}

func (s *ContractClauseCommentService) ListComments(ctx context.Context, tenantID, contractID, clauseID uuid.UUID) ([]model.ContractClauseComment, error) {
	if _, err := s.loadClause(ctx, tenantID, contractID, clauseID); err != nil {
		return nil, err
	}
	items, err := s.comments.ListByClause(ctx, tenantID, clauseID)
	if err != nil {
		return nil, internalError("list clause comments", err)
	}
	return items, nil
}

func (s *ContractClauseCommentService) AddComment(ctx context.Context, tenantID, userID, contractID, clauseID uuid.UUID, authorName string, req dto.CreateContractClauseCommentRequest) (*model.ContractClauseComment, error) {
	req.Normalize()
	if req.Body == "" {
		return nil, validationError("comment body is required", map[string]string{"body": "required"})
	}
	clause, err := s.loadClause(ctx, tenantID, contractID, clauseID)
	if err != nil {
		return nil, err
	}
	var parentID *uuid.UUID
	if req.ParentCommentID != nil {
		parsed, perr := uuid.Parse(*req.ParentCommentID)
		if perr != nil {
			return nil, validationError("invalid parent comment id", map[string]string{"parent_comment_id": "invalid"})
		}
		// Verify the parent comment belongs to this same clause (tenant-scoped).
		if _, perr := s.comments.Get(ctx, tenantID, clauseID, parsed); perr != nil {
			if perr == pgx.ErrNoRows {
				return nil, notFoundError("parent comment not found")
			}
			return nil, internalError("load parent comment", perr)
		}
		parentID = &parsed
	}
	comment := &model.ContractClauseComment{
		ID:              uuid.New(),
		TenantID:        tenantID,
		ContractID:      contractID,
		ClauseID:        clauseID,
		ParentCommentID: parentID,
		Body:            req.Body,
		Mentions:        req.Mentions,
		Metadata:        req.Metadata,
		AuthorUserID:    userID,
		AuthorName:      authorName,
	}
	if err := s.comments.Create(ctx, s.db, comment); err != nil {
		return nil, internalError("create clause comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.comment_added", tenantID, &userID, map[string]any{
		"id": clauseID, "contract_id": contractID, "clause_id": clauseID, "comment_id": comment.ID, "mentions": comment.Mentions,
	}, s.logger)
	// Best-effort: notify mentioned users. A publish failure must never fail the
	// comment write — writeEvent logs and continues internally.
	s.publishMentionNotifications(ctx, tenantID, userID, clause, comment, comment.Mentions)
	return comment, nil
}

func (s *ContractClauseCommentService) UpdateComment(ctx context.Context, tenantID, userID, contractID, clauseID, commentID uuid.UUID, req dto.UpdateContractClauseCommentRequest) (*model.ContractClauseComment, error) {
	req.Normalize()
	if _, err := s.loadClause(ctx, tenantID, contractID, clauseID); err != nil {
		return nil, err
	}
	comment, err := s.comments.Get(ctx, tenantID, clauseID, commentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause comment not found")
		}
		return nil, internalError("load clause comment", err)
	}
	priorMentions := comment.Mentions
	if req.Body != nil {
		comment.Body = *req.Body
	}
	if req.Mentions != nil {
		comment.Mentions = req.Mentions
	}
	if req.Metadata != nil {
		comment.Metadata = req.Metadata
	}
	if comment.Body == "" {
		return nil, validationError("comment body is required", map[string]string{"body": "required"})
	}
	if err := s.comments.Update(ctx, s.db, comment); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause comment not found")
		}
		return nil, internalError("update clause comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.comment_updated", tenantID, &userID, map[string]any{
		"id": clauseID, "contract_id": contractID, "clause_id": clauseID, "comment_id": comment.ID,
	}, s.logger)
	// Notify only newly-added mentions (don't re-ping users mentioned in a prior
	// revision).
	if newMentions := addedMentions(priorMentions, comment.Mentions); len(newMentions) > 0 {
		if clause, lerr := s.loadClause(ctx, tenantID, contractID, clauseID); lerr == nil {
			s.publishMentionNotifications(ctx, tenantID, userID, clause, comment, newMentions)
		} else {
			s.logger.Error().Err(lerr).Str("clause_id", clauseID.String()).Msg("load clause for mention notifications")
		}
	}
	return comment, nil
}

func (s *ContractClauseCommentService) DeleteComment(ctx context.Context, tenantID, userID, contractID, clauseID, commentID uuid.UUID) error {
	if _, err := s.loadClause(ctx, tenantID, contractID, clauseID); err != nil {
		return err
	}
	if _, err := s.comments.Get(ctx, tenantID, clauseID, commentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("clause comment not found")
		}
		return internalError("load clause comment", err)
	}
	if err := s.comments.SoftDeleteTx(ctx, s.db, tenantID, clauseID, commentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("clause comment not found")
		}
		return internalError("delete clause comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.comment_deleted", tenantID, &userID, map[string]any{
		"id": clauseID, "contract_id": contractID, "clause_id": clauseID, "comment_id": commentID,
	}, s.logger)
	return nil
}

// publishMentionNotifications emits one mention-bearing event per unique mentioned
// user (excluding the author). Each event carries a single recipient so the lex
// notification consumer can route it to exactly that user's inbox. Publish
// failures are swallowed by writeEvent (logged, never fatal).
func (s *ContractClauseCommentService) publishMentionNotifications(ctx context.Context, tenantID, authorID uuid.UUID, clause *model.Clause, comment *model.ContractClauseComment, mentions []string) {
	pinged := make(map[uuid.UUID]struct{}, len(mentions))
	for _, raw := range mentions {
		mentionedID, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil || mentionedID == uuid.Nil {
			continue
		}
		if mentionedID == authorID {
			continue // never notify the author of their own mention
		}
		if _, seen := pinged[mentionedID]; seen {
			continue // de-duplicate repeated mentions of the same user
		}
		pinged[mentionedID] = struct{}{}

		payload := map[string]any{
			"id":                comment.ClauseID,
			"contract_id":       comment.ContractID,
			"clause_id":         comment.ClauseID,
			"comment_id":        comment.ID,
			"mentioned_user_id": mentionedID.String(),
			"author_id":         authorID.String(),
			"author_name":       comment.AuthorName,
			"snippet":           commentSnippet(comment.Body),
		}
		if clause != nil {
			payload["clause_title"] = clause.Title
		}
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.comment_mention", tenantID, &authorID, payload, s.logger)
	}
}
