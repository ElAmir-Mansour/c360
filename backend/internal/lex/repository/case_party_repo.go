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

// CasePartyRepository persists litigation-case parties (CAP-043). Base table:
// Phase 3 plaintiff/defendant flows extend it with detail tables FK'd to
// legal_case_parties. Queries filter by tenant_id (primary predicate) with table
// RLS as a backstop; soft-delete via deleted_at.
type CasePartyRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCasePartyRepository(db *pgxpool.Pool, logger zerolog.Logger) *CasePartyRepository {
	return &CasePartyRepository{db: db, logger: logger}
}

func (r *CasePartyRepository) Create(ctx context.Context, q Queryer, p *model.CaseParty) error {
	metaJSON, err := json.Marshal(orEmptyMap(p.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case party metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_parties (
			id, tenant_id, case_id, role, name, identifier, contact, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		p.ID, p.TenantID, p.CaseID, p.Role, p.Name, p.Identifier, p.Contact, metaJSON, p.CreatedBy,
	).Scan(&p.CreatedAt, &p.UpdatedAt)
}

func (r *CasePartyRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.CaseParty, error) {
	query := casePartyJSONSelect(`cp.tenant_id = $1 AND cp.case_id = $2 AND cp.id = $3 AND cp.deleted_at IS NULL`)
	return queryRowJSON[model.CaseParty](ctx, r.db, query, tenantID, caseID, id)
}

func (r *CasePartyRepository) ListByCase(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseParty, error) {
	query := casePartyJSONSelect(`cp.tenant_id = $1 AND cp.case_id = $2 AND cp.deleted_at IS NULL`) + " ORDER BY t.created_at ASC"
	return queryListJSON[model.CaseParty](ctx, r.db, query, tenantID, caseID)
}

func (r *CasePartyRepository) Update(ctx context.Context, q Queryer, p *model.CaseParty) error {
	metaJSON, err := json.Marshal(orEmptyMap(p.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case party metadata: %w", err)
	}
	query := `
		UPDATE legal_case_parties
		SET role = $4, name = $5, identifier = $6, contact = $7, metadata = $8::jsonb, updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		p.TenantID, p.CaseID, p.ID, p.Role, p.Name, p.Identifier, p.Contact, metaJSON,
	).Scan(&p.UpdatedAt)
}

func (r *CasePartyRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	return r.SoftDeleteTx(ctx, r.db, tenantID, caseID, id)
}

// SoftDeleteTx soft-deletes inside the caller's transaction so the delete and its
// sub-resource audit row commit atomically (WS4).
func (r *CasePartyRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, caseID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_case_parties SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func casePartyJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT cp.id, cp.tenant_id, cp.case_id, cp.role, cp.name, cp.identifier,
			       cp.contact, COALESCE(cp.metadata, '{}'::jsonb) AS metadata,
			       cp.created_by, cp.created_at, cp.updated_at, cp.deleted_at
			FROM legal_case_parties cp
			WHERE ` + where + `
		) t`
}
