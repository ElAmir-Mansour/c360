package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/model"
)

func (r *LegalCaseRepository) CreateMilestone(ctx context.Context, q Queryer, milestone *model.CaseMilestone) error {
	metadata, err := json.Marshal(orEmptyMap(milestone.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case milestone metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO legal_case_milestones (
			id, tenant_id, case_id, title, description, milestone_type, status,
			milestone_date, completed_at, owner_id, source, source_reference,
			metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15
		)
		RETURNING created_at, updated_at`,
		milestone.ID, milestone.TenantID, milestone.CaseID, milestone.Title,
		milestone.Description, milestone.MilestoneType, milestone.Status,
		milestone.MilestoneDate.UTC(), milestone.CompletedAt, milestone.OwnerID,
		milestone.Source, milestone.SourceReference, metadata, milestone.CreatedBy,
		milestone.UpdatedBy,
	).Scan(&milestone.CreatedAt, &milestone.UpdatedAt)
}

func (r *LegalCaseRepository) GetMilestone(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.CaseMilestone, error) {
	return queryRowJSON[model.CaseMilestone](ctx, r.db, caseMilestoneJSONSelect(
		`m.tenant_id = $1 AND m.case_id = $2 AND m.id = $3 AND m.deleted_at IS NULL`,
	), tenantID, caseID, id)
}

func (r *LegalCaseRepository) ListMilestones(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseMilestone, error) {
	return queryListJSON[model.CaseMilestone](ctx, r.db, caseMilestoneJSONSelect(
		`m.tenant_id = $1 AND m.case_id = $2 AND m.deleted_at IS NULL`,
	)+` ORDER BY t.milestone_date ASC, t.created_at ASC`, tenantID, caseID)
}

func (r *LegalCaseRepository) UpdateMilestone(ctx context.Context, q Queryer, milestone *model.CaseMilestone) error {
	metadata, err := json.Marshal(orEmptyMap(milestone.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case milestone metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_milestones
		SET title = $4,
		    description = $5,
		    milestone_type = $6,
		    status = $7,
		    milestone_date = $8,
		    completed_at = $9,
		    owner_id = $10,
		    source = $11,
		    source_reference = $12,
		    metadata = $13::jsonb,
		    updated_by = $14,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		milestone.TenantID, milestone.CaseID, milestone.ID, milestone.Title,
		milestone.Description, milestone.MilestoneType, milestone.Status,
		milestone.MilestoneDate.UTC(), milestone.CompletedAt, milestone.OwnerID,
		milestone.Source, milestone.SourceReference, metadata, milestone.UpdatedBy,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalCaseRepository) SoftDeleteMilestone(ctx context.Context, q Queryer, tenantID, caseID, id, userID uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_milestones
		SET deleted_at = now(), updated_by = $4, updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		tenantID, caseID, id, userID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func caseMilestoneJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT m.id, m.tenant_id, m.case_id, m.title, m.description,
			       m.milestone_type, m.status, m.milestone_date, m.completed_at,
			       m.owner_id, m.source, m.source_reference,
			       COALESCE(m.metadata, '{}'::jsonb) AS metadata,
			       m.created_by, m.updated_by, m.created_at, m.updated_at, m.deleted_at
			FROM legal_case_milestones m
			WHERE ` + where + `
		) t`
}
