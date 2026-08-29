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

// CaseTaskRepository persists litigation-case tasks (CAP-040). Queries filter by
// tenant_id (primary predicate) with table RLS as a backstop; soft-delete via
// deleted_at. due_date is normalized to midnight UTC.
type CaseTaskRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseTaskRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseTaskRepository {
	return &CaseTaskRepository{db: db, logger: logger}
}

func (r *CaseTaskRepository) Create(ctx context.Context, q Queryer, t *model.CaseTask) error {
	metaJSON, err := json.Marshal(orEmptyMap(t.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case task metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_tasks (
			id, tenant_id, case_id, title, assignee_id, priority, status, due_date, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		t.ID, t.TenantID, t.CaseID, t.Title, t.AssigneeID, t.Priority, t.Status, legalCaseDatePtr(t.DueDate), metaJSON, t.CreatedBy,
	).Scan(&t.CreatedAt, &t.UpdatedAt)
}

// CreateIdempotentByAutomationKey creates an automation-owned task at most once
// per tenant/case/automation_key. If a live task with the same key already exists
// it hydrates t from that row and returns created=false. The database migration
// adds the matching partial unique index; ON CONFLICT DO NOTHING keeps retries
// and concurrent event handling quiet.
func (r *CaseTaskRepository) CreateIdempotentByAutomationKey(ctx context.Context, q Queryer, t *model.CaseTask, automationKey string) (bool, error) {
	metaJSON, err := json.Marshal(orEmptyMap(t.Metadata))
	if err != nil {
		return false, fmt.Errorf("marshal case task metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_tasks (
			id, tenant_id, case_id, title, assignee_id, priority, status, due_date, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
		ON CONFLICT DO NOTHING
		RETURNING created_at, updated_at`
	err = q.QueryRow(ctx, query,
		t.ID, t.TenantID, t.CaseID, t.Title, t.AssigneeID, t.Priority, t.Status, legalCaseDatePtr(t.DueDate), metaJSON, t.CreatedBy,
	).Scan(&t.CreatedAt, &t.UpdatedAt)
	if err == nil {
		return true, nil
	}
	if err != pgx.ErrNoRows {
		return false, err
	}
	existing, err := r.GetByAutomationKey(ctx, q, t.TenantID, t.CaseID, automationKey)
	if err != nil {
		return false, err
	}
	*t = *existing
	return false, nil
}

func (r *CaseTaskRepository) GetByAutomationKey(ctx context.Context, q Queryer, tenantID, caseID uuid.UUID, automationKey string) (*model.CaseTask, error) {
	query := caseTaskJSONSelect(`ct.tenant_id = $1 AND ct.case_id = $2 AND ct.metadata->>'automation_key' = $3 AND ct.deleted_at IS NULL`)
	return queryRowJSON[model.CaseTask](ctx, q, query, tenantID, caseID, automationKey)
}

func (r *CaseTaskRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.CaseTask, error) {
	query := caseTaskJSONSelect(`ct.tenant_id = $1 AND ct.case_id = $2 AND ct.id = $3 AND ct.deleted_at IS NULL`)
	return queryRowJSON[model.CaseTask](ctx, r.db, query, tenantID, caseID, id)
}

func (r *CaseTaskRepository) ListByCase(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseTask, error) {
	query := caseTaskJSONSelect(`ct.tenant_id = $1 AND ct.case_id = $2 AND ct.deleted_at IS NULL`) + " ORDER BY t.created_at ASC"
	return queryListJSON[model.CaseTask](ctx, r.db, query, tenantID, caseID)
}

func (r *CaseTaskRepository) Update(ctx context.Context, q Queryer, t *model.CaseTask) error {
	metaJSON, err := json.Marshal(orEmptyMap(t.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case task metadata: %w", err)
	}
	query := `
		UPDATE legal_case_tasks
		SET title = $4, assignee_id = $5, priority = $6, status = $7, due_date = $8, metadata = $9::jsonb, updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		t.TenantID, t.CaseID, t.ID, t.Title, t.AssigneeID, t.Priority, t.Status, legalCaseDatePtr(t.DueDate), metaJSON,
	).Scan(&t.UpdatedAt)
}

func (r *CaseTaskRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	return r.SoftDeleteTx(ctx, r.db, tenantID, caseID, id)
}

// SoftDeleteTx soft-deletes inside the caller's transaction so the delete and its
// sub-resource audit row commit atomically (WS4).
func (r *CaseTaskRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, caseID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `UPDATE legal_case_tasks SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func caseTaskJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ct.id, ct.tenant_id, ct.case_id, ct.title, ct.assignee_id, ct.priority,
			       ct.status, ct.due_date::timestamptz AS due_date,
			       COALESCE(ct.metadata, '{}'::jsonb) AS metadata,
			       ct.created_by, ct.created_at, ct.updated_at, ct.deleted_at
			FROM legal_case_tasks ct
			WHERE ` + where + `
		) t`
}
