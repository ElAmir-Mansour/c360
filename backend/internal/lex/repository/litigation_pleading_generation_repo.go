package repository

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SetGenerationMetadata persists the resumable state of an AI pleading job in
// the pleading's existing metadata document. The current-job guard prevents a
// late token or completion from an older, cancelled job overwriting a retry.
func (r *LegalPleadingRepository) SetGenerationMetadata(
	ctx context.Context,
	tenantID, caseID, pleadingID, jobID uuid.UUID,
	state any,
	requireCurrent bool,
) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}

	query := `
		UPDATE legal_pleadings
		SET metadata = jsonb_set(
		        COALESCE(metadata, '{}'::jsonb),
		        '{ai_generation}',
		        $4::jsonb,
		        true
		    ),
		    updated_at = now()
		WHERE tenant_id = $1
		  AND case_id = $2
		  AND id = $3
		  AND deleted_at IS NULL`
	args := []any{tenantID, caseID, pleadingID, payload}
	if requireCurrent {
		query = `
			UPDATE legal_pleadings
			SET metadata = jsonb_set(
			        COALESCE(metadata, '{}'::jsonb),
			        '{ai_generation}',
			        $5::jsonb,
			        true
			    ),
			    updated_at = now()
			WHERE tenant_id = $1
			  AND case_id = $2
			  AND id = $3
			  AND deleted_at IS NULL
			  AND metadata #>> '{ai_generation,job_id}' = $4
			  AND COALESCE(metadata #>> '{ai_generation,status}', '') NOT IN (
			      'cancelled', 'completed', 'failed'
			  )`
		args = []any{tenantID, caseID, pleadingID, jobID.String(), payload}
	}
	ct, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
