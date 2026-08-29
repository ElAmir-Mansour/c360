package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/cyber/dspm/access/model"
)

// AccessRemediationRepository handles dspm_access_remediation_actions and the
// remediation-decision columns on dspm_access_mappings.
type AccessRemediationRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewAccessRemediationRepository creates a new access remediation repository.
func NewAccessRemediationRepository(db *pgxpool.Pool, logger zerolog.Logger) *AccessRemediationRepository {
	return &AccessRemediationRepository{db: db, logger: logger}
}

// GetMapping returns a single active-or-inactive mapping by ID, scoped to tenant.
func (r *AccessRemediationRepository) GetMapping(ctx context.Context, tenantID, mappingID uuid.UUID) (*model.AccessMapping, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+mappingColumns()+`
		FROM dspm_access_mappings
		WHERE tenant_id = $1 AND id = $2
	`, tenantID, mappingID)
	m, err := scanMappingRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return m, nil
}

// ApplyRemediation atomically transitions the mapping's remediation state and
// (optionally) its access status, then writes the action to the ledger.
//
// mappingStatus, when non-empty, overrides dspm_access_mappings.status (e.g.
// 'revoked' for a revoke action, 'pending_review' for apply). remediationStatus
// is one of applied/revoked/dismissed. The persisted RemediationAction is
// returned with its generated ID and timestamp.
func (r *AccessRemediationRepository) ApplyRemediation(
	ctx context.Context,
	action *model.RemediationAction,
	remediationStatus string,
	mappingStatus string,
) error {
	if action.ID == uuid.Nil {
		action.ID = uuid.New()
	}
	now := time.Now().UTC()
	if action.CreatedAt.IsZero() {
		action.CreatedAt = now
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Update the mapping's remediation decision (and status if requested).
	if mappingStatus != "" {
		_, err = tx.Exec(ctx, `
			UPDATE dspm_access_mappings
			SET remediation_status = $1,
			    remediation_note   = $2,
			    remediated_by      = $3,
			    remediated_at      = $4,
			    status             = $5,
			    updated_at         = now()
			WHERE tenant_id = $6 AND id = $7
		`, remediationStatus, nullifyEmpty(action.Note), action.ActorID, now,
			mappingStatus, action.TenantID, action.MappingID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE dspm_access_mappings
			SET remediation_status = $1,
			    remediation_note   = $2,
			    remediated_by      = $3,
			    remediated_at      = $4,
			    updated_at         = now()
			WHERE tenant_id = $5 AND id = $6
		`, remediationStatus, nullifyEmpty(action.Note), action.ActorID, now,
			action.TenantID, action.MappingID)
	}
	if err != nil {
		return err
	}

	// Record the action in the ledger.
	_, err = tx.Exec(ctx, `
		INSERT INTO dspm_access_remediation_actions (
			id, tenant_id, mapping_id, identity_type, identity_id, identity_name,
			data_asset_id, data_asset_name, target_permission, recommendation_type,
			action, outcome, note, enforced_externally, actor_id, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
	`, action.ID, action.TenantID, action.MappingID, action.IdentityType, action.IdentityID, nullifyEmpty(action.IdentityName),
		action.DataAssetID, nullifyEmpty(action.DataAssetName), action.TargetPermission, nullifyEmpty(action.RecommendationType),
		action.Action, action.Outcome, nullifyEmpty(action.Note), action.EnforcedExternally, action.ActorID, action.CreatedAt,
	)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ListByMapping returns the remediation action ledger for a mapping.
func (r *AccessRemediationRepository) ListByMapping(ctx context.Context, tenantID, mappingID uuid.UUID) ([]model.RemediationAction, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, tenant_id, mapping_id, identity_type, identity_id, identity_name,
		       data_asset_id, data_asset_name, target_permission, recommendation_type,
		       action, outcome, note, enforced_externally, actor_id, created_at
		FROM dspm_access_remediation_actions
		WHERE tenant_id = $1 AND mapping_id = $2
		ORDER BY created_at DESC
	`, tenantID, mappingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]model.RemediationAction, 0)
	for rows.Next() {
		var a model.RemediationAction
		var identityName, dataAssetName, recType, note *string
		if err := rows.Scan(
			&a.ID, &a.TenantID, &a.MappingID, &a.IdentityType, &a.IdentityID, &identityName,
			&a.DataAssetID, &dataAssetName, &a.TargetPermission, &recType,
			&a.Action, &a.Outcome, &note, &a.EnforcedExternally, &a.ActorID, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		a.IdentityName = derefString(identityName)
		a.DataAssetName = derefString(dataAssetName)
		a.RecommendationType = derefString(recType)
		a.Note = derefString(note)
		results = append(results, a)
	}
	return results, rows.Err()
}

func nullifyEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
