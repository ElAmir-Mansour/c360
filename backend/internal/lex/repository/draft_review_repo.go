package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// DraftReviewRepository persists the lex-side projection of an AI-draft human
// review (Feature 4). Queries filter by tenant_id (primary) with table RLS as a
// backstop, mirroring the other lex repositories. Writes that participate in the
// engine-instance creation transaction accept a Queryer so they can run on the
// caller's pgx.Tx.
type DraftReviewRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewDraftReviewRepository(db *pgxpool.Pool, logger zerolog.Logger) *DraftReviewRepository {
	return &DraftReviewRepository{db: db, logger: logger}
}

const draftReviewColumns = `id, tenant_id, draft_id, title, draft_kind, content, review_status,
	review_task_id, workflow_instance_id, assignee_id, assignee_role, sla_deadline,
	review_notes, reviewed_by, reviewed_at, submitted_by, metadata, created_at, updated_at`

// Create inserts a new draft-review row. q may be a pool or a transaction so the
// insert can be committed atomically with the engine instance/task creation.
func (r *DraftReviewRepository) Create(ctx context.Context, q Queryer, dr *model.DraftReview) error {
	contentJSON, err := json.Marshal(orEmptyMap(dr.Content))
	if err != nil {
		return fmt.Errorf("marshal draft review content: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(dr.Metadata))
	if err != nil {
		return fmt.Errorf("marshal draft review metadata: %w", err)
	}
	row := q.QueryRow(ctx, `
		INSERT INTO lex_draft_reviews (
			id, tenant_id, draft_id, title, draft_kind, content, review_status,
			review_task_id, workflow_instance_id, assignee_id, assignee_role, sla_deadline,
			review_notes, reviewed_by, submitted_by, metadata
		) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
		RETURNING `+draftReviewColumns,
		dr.ID, dr.TenantID, dr.DraftID, dr.Title, dr.DraftKind, contentJSON, dr.ReviewStatus,
		dr.ReviewTaskID, dr.WorkflowInstanceID, dr.AssigneeID, dr.AssigneeRole, dr.SLADeadline,
		dr.ReviewNotes, dr.ReviewedBy, dr.SubmittedBy, metaJSON,
	)
	created, err := scanDraftReview(row)
	if err != nil {
		return err
	}
	*dr = *created
	return nil
}

// GetByDraft returns the most recent review for a draft (any status), used by
// the GET /drafting/{id}/review status endpoint.
func (r *DraftReviewRepository) GetByDraft(ctx context.Context, tenantID, draftID uuid.UUID) (*model.DraftReview, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+draftReviewColumns+`
		FROM lex_draft_reviews
		WHERE tenant_id = $1 AND draft_id = $2
		ORDER BY created_at DESC
		LIMIT 1`,
		tenantID, draftID,
	)
	return scanDraftReview(row)
}

// GetOpenByDraft returns the open (pending) review for a draft if one exists.
func (r *DraftReviewRepository) GetOpenByDraft(ctx context.Context, q Queryer, tenantID, draftID uuid.UUID) (*model.DraftReview, error) {
	row := q.QueryRow(ctx, `
		SELECT `+draftReviewColumns+`
		FROM lex_draft_reviews
		WHERE tenant_id = $1 AND draft_id = $2 AND review_status = $3
		LIMIT 1`,
		tenantID, draftID, model.DraftReviewStatusPending,
	)
	return scanDraftReview(row)
}

// GetByTask returns the review linked to an engine task id (any status). Used by
// the completion path to project the task outcome back onto the draft review.
func (r *DraftReviewRepository) GetByTask(ctx context.Context, q Queryer, tenantID, taskID uuid.UUID) (*model.DraftReview, error) {
	row := q.QueryRow(ctx, `
		SELECT `+draftReviewColumns+`
		FROM lex_draft_reviews
		WHERE tenant_id = $1 AND review_task_id = $2
		LIMIT 1`,
		tenantID, taskID,
	)
	return scanDraftReview(row)
}

// MarkReviewed transitions a pending review to its terminal outcome. It is a
// no-op (returns pgx.ErrNoRows) if the review is already terminal, keeping the
// completion path idempotent.
func (r *DraftReviewRepository) MarkReviewed(ctx context.Context, q Queryer, in model.DraftReviewOutcome) error {
	ct, err := q.Exec(ctx, `
		UPDATE lex_draft_reviews
		SET review_status = $3,
		    review_notes = $4,
		    reviewed_by = $5,
		    reviewed_at = $6,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND review_status = $7`,
		in.TenantID, in.ID, in.ReviewStatus, in.ReviewNotes, in.ReviewedBy, in.ReviewedAt,
		model.DraftReviewStatusPending,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanDraftReview(row pgx.Row) (*model.DraftReview, error) {
	var item model.DraftReview
	var contentJSON, metaJSON []byte
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.DraftID, &item.Title, &item.DraftKind, &contentJSON, &item.ReviewStatus,
		&item.ReviewTaskID, &item.WorkflowInstanceID, &item.AssigneeID, &item.AssigneeRole, &item.SLADeadline,
		&item.ReviewNotes, &item.ReviewedBy, &item.ReviewedAt, &item.SubmittedBy, &metaJSON,
		&item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.Content = map[string]any{}
	if len(contentJSON) > 0 {
		if err := json.Unmarshal(contentJSON, &item.Content); err != nil {
			return nil, fmt.Errorf("decode draft review content: %w", err)
		}
	}
	item.Metadata = map[string]any{}
	if len(metaJSON) > 0 {
		if err := json.Unmarshal(metaJSON, &item.Metadata); err != nil {
			return nil, fmt.Errorf("decode draft review metadata: %w", err)
		}
	}
	return &item, nil
}
