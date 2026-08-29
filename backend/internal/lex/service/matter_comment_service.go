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

// MatterCommentService owns the matter collaboration-note lifecycle. It mirrors
// the legal-case comment methods (ListComments/AddComment/UpdateComment/
// DeleteComment) on the matter aggregate: every query is tenant-scoped, the
// parent matter is verified to exist, and mutations publish a lex domain event.
type MatterCommentService struct {
	db        *pgxpool.Pool
	matters   *repository.MatterRepository
	comments  *repository.MatterCommentRepository
	publisher Publisher
	topic     string
	logger    zerolog.Logger
}

func NewMatterCommentService(db *pgxpool.Pool, matters *repository.MatterRepository, comments *repository.MatterCommentRepository, publisher Publisher, topic string, logger zerolog.Logger) *MatterCommentService {
	return &MatterCommentService{
		db:        db,
		matters:   matters,
		comments:  comments,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-matter-comments").Logger(),
	}
}

func (s *MatterCommentService) ensureMatterExists(ctx context.Context, tenantID, matterID uuid.UUID) error {
	_, err := s.loadMatter(ctx, tenantID, matterID)
	return err
}

// loadMatter fetches the parent matter tenant-scoped, translating ErrNoRows into
// a 404. It backs both the existence check and the owner lookup used to fan
// comment-watcher notifications.
func (s *MatterCommentService) loadMatter(ctx context.Context, tenantID, matterID uuid.UUID) (*model.Matter, error) {
	matter, err := s.matters.Get(ctx, tenantID, matterID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	return matter, nil
}

func (s *MatterCommentService) ListComments(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterComment, error) {
	if err := s.ensureMatterExists(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	items, err := s.comments.ListByMatter(ctx, tenantID, matterID)
	if err != nil {
		return nil, internalError("list matter comments", err)
	}
	return items, nil
}

func (s *MatterCommentService) AddComment(ctx context.Context, tenantID, userID, matterID uuid.UUID, authorName string, req dto.CreateMatterCommentRequest) (*model.MatterComment, error) {
	req.Normalize()
	if req.Body == "" {
		return nil, validationError("comment body is required", map[string]string{"body": "required"})
	}
	matter, err := s.loadMatter(ctx, tenantID, matterID)
	if err != nil {
		return nil, err
	}
	comment := &model.MatterComment{
		ID:           uuid.New(),
		TenantID:     tenantID,
		MatterID:     matterID,
		Body:         req.Body,
		Mentions:     req.Mentions,
		Metadata:     req.Metadata,
		AuthorUserID: userID,
		AuthorName:   authorName,
	}
	if err := s.comments.Create(ctx, s.db, comment); err != nil {
		return nil, internalError("create matter comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.comment_added", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "comment_id": comment.ID, "mentions": comment.Mentions,
	}, s.logger)
	// Best-effort: notify mentioned users and the matter owner (watcher). A
	// publish failure must never fail the comment write — writeEvent logs and
	// continues internally.
	s.publishCommentNotifications(ctx, tenantID, userID, matter, comment, comment.Mentions)
	return comment, nil
}

func (s *MatterCommentService) UpdateComment(ctx context.Context, tenantID, userID, matterID, commentID uuid.UUID, req dto.UpdateMatterCommentRequest) (*model.MatterComment, error) {
	req.Normalize()
	comment, err := s.comments.Get(ctx, tenantID, matterID, commentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter comment not found")
		}
		return nil, internalError("load matter comment", err)
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
			return nil, notFoundError("matter comment not found")
		}
		return nil, internalError("update matter comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.comment_updated", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "comment_id": comment.ID,
	}, s.logger)
	// Notify only newly-added mentions (don't re-ping users mentioned in a prior
	// revision). No owner-watcher ping on edit — that fires on creation only.
	if newMentions := addedMentions(priorMentions, comment.Mentions); len(newMentions) > 0 {
		matter, err := s.loadMatter(ctx, tenantID, matterID)
		if err == nil {
			s.publishMentionNotifications(ctx, tenantID, userID, matter, comment, newMentions)
		} else {
			s.logger.Error().Err(err).Str("matter_id", matterID.String()).Msg("load matter for mention notifications")
		}
	}
	return comment, nil
}

func (s *MatterCommentService) DeleteComment(ctx context.Context, tenantID, userID, matterID, commentID uuid.UUID) error {
	if _, err := s.comments.Get(ctx, tenantID, matterID, commentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter comment not found")
		}
		return internalError("load matter comment", err)
	}
	if err := s.comments.SoftDeleteTx(ctx, s.db, tenantID, matterID, commentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter comment not found")
		}
		return internalError("delete matter comment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.comment_deleted", tenantID, &userID, map[string]any{
		"id": matterID, "matter_id": matterID, "comment_id": commentID,
	}, s.logger)
	return nil
}

const commentSnippetMaxRunes = 140

// publishCommentNotifications fans out, best-effort, both the @mention pings and
// the matter-owner watcher ping when a comment is created. The author is never
// notified of their own comment, and the owner is not double-pinged when they are
// also a mentioned user.
func (s *MatterCommentService) publishCommentNotifications(ctx context.Context, tenantID, authorID uuid.UUID, matter *model.Matter, comment *model.MatterComment, mentions []string) {
	mentioned := s.publishMentionNotifications(ctx, tenantID, authorID, matter, comment, mentions)

	// Owner watcher: notify the matter owner on a new comment unless they are the
	// author or were already pinged as a mention.
	if matter == nil {
		return
	}
	owner := matter.OwnerUserID
	if owner == uuid.Nil || owner == authorID {
		return
	}
	if _, already := mentioned[owner]; already {
		return
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.comment_created", tenantID, &authorID, map[string]any{
		"id":            matter.ID,
		"matter_id":     matter.ID,
		"comment_id":    comment.ID,
		"owner_user_id": owner.String(),
		"author_id":     authorID.String(),
		"author_name":   comment.AuthorName,
		"snippet":       commentSnippet(comment.Body),
	}, s.logger)
}

// publishMentionNotifications emits one mention-bearing event per unique
// mentioned user (excluding the author). Each event carries a single recipient so
// the lex notification consumer can route it to exactly that user's inbox. It
// returns the set of users actually pinged so the owner-watcher path can avoid a
// duplicate. Publish failures are swallowed by writeEvent (logged, never fatal).
func (s *MatterCommentService) publishMentionNotifications(ctx context.Context, tenantID, authorID uuid.UUID, matter *model.Matter, comment *model.MatterComment, mentions []string) map[uuid.UUID]struct{} {
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

		matterID := comment.MatterID
		payload := map[string]any{
			"id":                matterID,
			"matter_id":         matterID,
			"comment_id":        comment.ID,
			"mentioned_user_id": mentionedID.String(),
			"author_id":         authorID.String(),
			"author_name":       comment.AuthorName,
			"snippet":           commentSnippet(comment.Body),
		}
		if matter != nil {
			payload["matter_title"] = matter.Title
		}
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matters.comment_mention", tenantID, &authorID, payload, s.logger)
	}
	return pinged
}

// addedMentions returns the mentions present in next but not in prior, so an edit
// only re-notifies the newly-added users.
func addedMentions(prior, next []string) []string {
	existing := make(map[string]struct{}, len(prior))
	for _, m := range prior {
		existing[strings.TrimSpace(m)] = struct{}{}
	}
	added := make([]string, 0, len(next))
	for _, m := range next {
		key := strings.TrimSpace(m)
		if key == "" {
			continue
		}
		if _, ok := existing[key]; ok {
			continue
		}
		added = append(added, m)
	}
	return added
}

// commentSnippet trims a comment body to a short, single-line preview suitable for
// a notification body.
func commentSnippet(body string) string {
	body = strings.TrimSpace(strings.Join(strings.Fields(body), " "))
	runes := []rune(body)
	if len(runes) <= commentSnippetMaxRunes {
		return body
	}
	return strings.TrimSpace(string(runes[:commentSnippetMaxRunes])) + "…"
}
