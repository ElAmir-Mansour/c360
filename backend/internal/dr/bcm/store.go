package bcm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so this package's store, the
// evidence sources, and the service all speak the same execution-context type: a
// *pgxpool.Pool for a single read, or the caller's open transaction so the
// assessment header, its control-result rows, and the outbox event all commit
// atomically. This package adds its OWN read/write methods for its two owned
// tables (dr_bcm_assessment, dr_bcm_control_result) via raw queries rather than
// editing the shared repository.
type DBTX = repository.DBTX

// Store persists BCM assessments and their per-control results. It holds no
// state; the caller supplies the DBTX so a request runs under a tenant
// transaction (RLS backstop). There is no cross-tenant read path here — BCM
// assessments are always tenant-scoped and request-driven.
type Store struct{}

// NewStore constructs a stateless store.
func NewStore() *Store { return &Store{} }

// SaveAssessment inserts the assessment header and all its control-result rows
// within the caller's transaction. It returns the generated assessment id and
// created_at populated on hdr. Because every write uses the same db (the open
// tx), the header and results are atomic with the outbox event the service
// stages in the same tx.
func (s *Store) SaveAssessment(ctx context.Context, db DBTX, hdr *StoredAssessment, results []StoredControlResult) error {
	const insertHdr = `
INSERT INTO dr_bcm_assessment
    (tenant_id, group_id, pack_key, standard, pack_version, score, compliant,
     total_controls, satisfied, partial, failed, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING id, created_at`

	err := db.QueryRow(ctx, insertHdr,
		hdr.TenantID, hdr.GroupID, hdr.PackKey, hdr.Standard, hdr.PackVersion,
		hdr.Score, hdr.Compliant, hdr.TotalControls, hdr.Satisfied, hdr.Partial,
		hdr.Failed, hdr.CreatedBy,
	).Scan(&hdr.ID, &hdr.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert bcm assessment: %w", err)
	}

	const insertResult = `
INSERT INTO dr_bcm_control_result
    (assessment_id, tenant_id, control_code, control_title, verdict, reason,
     mandatory, weight, evidence_refs)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING id`

	for i := range results {
		r := &results[i]
		r.AssessmentID = hdr.ID
		r.TenantID = hdr.TenantID
		refs := r.EvidenceRefs
		if refs == nil {
			refs = []string{}
		}
		refsJSON, mErr := json.Marshal(refs)
		if mErr != nil {
			return fmt.Errorf("marshal evidence refs for %s: %w", r.ControlCode, mErr)
		}
		if err := db.QueryRow(ctx, insertResult,
			r.AssessmentID, r.TenantID, r.ControlCode, r.ControlTitle,
			string(r.Verdict), r.Reason, r.Mandatory, r.Weight, refsJSON,
		).Scan(&r.ID); err != nil {
			return fmt.Errorf("insert bcm control result %s: %w", r.ControlCode, err)
		}
	}

	return nil
}

// GetAssessment loads the assessment header by id within the db's RLS scope.
// Returns ErrAssessmentNotFound when no row matches (in the tenant's scope).
func (s *Store) GetAssessment(ctx context.Context, db DBTX, id uuid.UUID) (*StoredAssessment, error) {
	const q = `
SELECT id, tenant_id, group_id, pack_key, standard, pack_version, score, compliant,
       total_controls, satisfied, partial, failed, created_by, created_at
FROM dr_bcm_assessment
WHERE id = $1`

	var a StoredAssessment
	err := db.QueryRow(ctx, q, id).Scan(
		&a.ID, &a.TenantID, &a.GroupID, &a.PackKey, &a.Standard, &a.PackVersion,
		&a.Score, &a.Compliant, &a.TotalControls, &a.Satisfied, &a.Partial,
		&a.Failed, &a.CreatedBy, &a.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAssessmentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get bcm assessment: %w", err)
	}
	return &a, nil
}

// ListControlResults loads the control-result rows for an assessment, ordered by
// insertion id (catalog order, since SaveAssessment inserts in catalog order).
func (s *Store) ListControlResults(ctx context.Context, db DBTX, assessmentID uuid.UUID) ([]StoredControlResult, error) {
	const q = `
SELECT id, assessment_id, tenant_id, control_code, control_title, verdict, reason,
       mandatory, weight, evidence_refs
FROM dr_bcm_control_result
WHERE assessment_id = $1
ORDER BY created_at ASC, id ASC`

	rows, err := db.Query(ctx, q, assessmentID)
	if err != nil {
		return nil, fmt.Errorf("query bcm control results: %w", err)
	}
	defer rows.Close()

	out := make([]StoredControlResult, 0)
	for rows.Next() {
		var r StoredControlResult
		var verdict string
		var refsJSON []byte
		if err := rows.Scan(
			&r.ID, &r.AssessmentID, &r.TenantID, &r.ControlCode, &r.ControlTitle,
			&verdict, &r.Reason, &r.Mandatory, &r.Weight, &refsJSON,
		); err != nil {
			return nil, fmt.Errorf("scan bcm control result: %w", err)
		}
		r.Verdict = Verdict(verdict)
		if len(refsJSON) > 0 {
			if err := json.Unmarshal(refsJSON, &r.EvidenceRefs); err != nil {
				return nil, fmt.Errorf("unmarshal evidence refs for %s: %w", r.ControlCode, err)
			}
		}
		if r.EvidenceRefs == nil {
			r.EvidenceRefs = []string{}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate bcm control results: %w", err)
	}
	return out, nil
}

// GroupExists reports the group's name and whether it exists in the db's RLS
// scope. The service uses it so an assessment against a missing group is a clean
// ErrGroupNotFound rather than producing an empty-evidence assessment for a
// group the tenant does not own.
func (s *Store) GroupExists(ctx context.Context, db DBTX, groupID uuid.UUID) (string, bool, error) {
	var name string
	err := db.QueryRow(ctx, `SELECT name FROM consistency_group WHERE id = $1`, groupID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("check consistency group: %w", err)
	}
	return name, true, nil
}
