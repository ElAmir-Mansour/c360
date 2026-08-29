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

// CaseHearingRepository persists litigation-case hearings (CAP-044). BASE table:
// Phase 3 extends hearings with reports/minutes (the report/minute documents land
// via the Files service with entity_type='legal_case_hearing'). Queries filter by
// tenant_id (primary predicate) with table RLS as a backstop; soft-delete via
// deleted_at.
type CaseHearingRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseHearingRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseHearingRepository {
	return &CaseHearingRepository{db: db, logger: logger}
}

func (r *CaseHearingRepository) Create(ctx context.Context, q Queryer, h *model.CaseHearing) error {
	metaJSON, err := json.Marshal(orEmptyMap(h.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case hearing metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_hearings (
			id, tenant_id, case_id, hearing_date, location, notes, decision, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		h.ID, h.TenantID, h.CaseID, h.HearingDate, h.Location, h.Notes, h.Decision, metaJSON, h.CreatedBy,
	).Scan(&h.CreatedAt, &h.UpdatedAt)
}

func (r *CaseHearingRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.CaseHearing, error) {
	query := caseHearingJSONSelect(`ch.tenant_id = $1 AND ch.case_id = $2 AND ch.id = $3 AND ch.deleted_at IS NULL`)
	return queryRowJSON[model.CaseHearing](ctx, r.db, query, tenantID, caseID, id)
}

func (r *CaseHearingRepository) ListByCase(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseHearing, error) {
	query := caseHearingJSONSelect(`ch.tenant_id = $1 AND ch.case_id = $2 AND ch.deleted_at IS NULL`) + " ORDER BY t.hearing_date ASC"
	return queryListJSON[model.CaseHearing](ctx, r.db, query, tenantID, caseID)
}

func (r *CaseHearingRepository) Update(ctx context.Context, q Queryer, h *model.CaseHearing) error {
	metaJSON, err := json.Marshal(orEmptyMap(h.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case hearing metadata: %w", err)
	}
	query := `
		UPDATE legal_case_hearings
		SET hearing_date = $4, location = $5, notes = $6, decision = $7, metadata = $8::jsonb, updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		h.TenantID, h.CaseID, h.ID, h.HearingDate, h.Location, h.Notes, h.Decision, metaJSON,
	).Scan(&h.UpdatedAt)
}

func (r *CaseHearingRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	return r.SoftDeleteTx(ctx, r.db, tenantID, caseID, id)
}

// SoftDeleteTx soft-deletes inside the caller's transaction so the delete and its
// sub-resource audit row commit atomically (WS4).
func (r *CaseHearingRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, caseID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_case_hearings SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func caseHearingJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ch.id, ch.tenant_id, ch.case_id, ch.hearing_date, ch.location, ch.notes,
			       ch.decision, COALESCE(ch.metadata, '{}'::jsonb) AS metadata,
			       ch.created_by, ch.created_at, ch.updated_at, ch.deleted_at
			FROM legal_case_hearings ch
			WHERE ` + where + `
		) t`
}
