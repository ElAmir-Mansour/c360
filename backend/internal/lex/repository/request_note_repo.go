package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// RequestNoteRepository persists internal collaboration notes on a legal request.
// It mirrors MatterCommentRepository: tenant_id-first scoping, JSON row
// projection for reads, soft delete, and a Queryer-driven write path so callers
// can run inside a transaction. Mentions are stored as a JSONB array of strings.
type RequestNoteRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewRequestNoteRepository(db *pgxpool.Pool, logger zerolog.Logger) *RequestNoteRepository {
	return &RequestNoteRepository{db: db, logger: logger}
}

func (r *RequestNoteRepository) Create(ctx context.Context, q Queryer, n *model.RequestNote) error {
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(n.Mentions))
	if err != nil {
		return fmt.Errorf("marshal request note mentions: %w", err)
	}
	query := `
		INSERT INTO legal_request_notes (
			id, tenant_id, request_id, body, mentions, author_id, author_name, cycle
		) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,
			-- Stamped from the request's round counter in the same statement rather
			-- than passed in: a caller cannot forget it, and it cannot drift from the
			-- request between a read and a write.
			COALESCE((SELECT cycle FROM legal_requests WHERE tenant_id = $2 AND id = $3), 1))
		RETURNING created_at, updated_at, cycle`
	return q.QueryRow(ctx, query,
		n.ID, n.TenantID, n.RequestID, n.Body, mentionsJSON, n.AuthorID, n.AuthorName,
	).Scan(&n.CreatedAt, &n.UpdatedAt, &n.Cycle)
}

func (r *RequestNoteRepository) ListByRequest(ctx context.Context, tenantID, requestID uuid.UUID) ([]model.RequestNote, error) {
	query := requestNoteJSONSelectWithSuffix(
		`rn.tenant_id = $1 AND rn.request_id = $2 AND rn.deleted_at IS NULL`,
		` ORDER BY rn.created_at ASC`,
	)
	return queryListJSON[model.RequestNote](ctx, r.db, query, tenantID, requestID)
}

func requestNoteJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT rn.id, rn.tenant_id, rn.request_id, rn.cycle, rn.body,
			       COALESCE(rn.mentions, '[]'::jsonb) AS mentions,
			       rn.author_id, rn.author_name,
			       rn.created_at, rn.updated_at, rn.deleted_at
			FROM legal_request_notes rn
			WHERE ` + where + suffix + `
		) t`
}
