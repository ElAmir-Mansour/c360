package assurance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Store persists recovery-assurance evaluations and their per-control results. It
// holds no state; the caller supplies the DBTX so a request runs under a tenant
// transaction (RLS backstop). This package owns its two tables
// (dr_assurance_assessment, dr_assurance_result) via raw queries rather than
// editing the shared DR repository.
type Store struct{}

// NewStore constructs a stateless store.
func NewStore() *Store { return &Store{} }

// SaveAssessment inserts the assessment header and all its control-result rows
// within the caller's transaction. It populates the generated id and created_at
// on hdr. Because every write uses the same db (the open tx), the header and
// results are atomic with the outbox event the service stages in the same tx.
func (s *Store) SaveAssessment(ctx context.Context, db DBTX, hdr *StoredAssessment, results []StoredResult) error {
	const insertHdr = `
INSERT INTO dr_assurance_assessment
    (tenant_id, group_id, profile_id, workload_id, score, verdict,
     total_checks, satisfied, partial, failed, evidence_snapshot, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING id, created_at`

	snapshotJSON, err := json.Marshal(hdr.EvidenceSnapshot)
	if err != nil {
		return fmt.Errorf("marshal evidence snapshot: %w", err)
	}
	err = db.QueryRow(ctx, insertHdr,
		hdr.TenantID, hdr.GroupID, hdr.ProfileID, hdr.WorkloadID, hdr.Score,
		string(hdr.Verdict), hdr.TotalChecks, hdr.Satisfied, hdr.Partial,
		hdr.Failed, snapshotJSON, hdr.CreatedBy,
	).Scan(&hdr.ID, &hdr.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert assurance assessment: %w", err)
	}

	const insertResult = `
INSERT INTO dr_assurance_result
    (assessment_id, tenant_id, control_code, control_title, verdict, severity,
     weight, message, recommendation, evidence_refs)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
			return fmt.Errorf("marshal evidence refs for %s: %w", r.Code, mErr)
		}
		if err := db.QueryRow(ctx, insertResult,
			r.AssessmentID, r.TenantID, r.Code, r.Title, string(r.Verdict),
			string(r.Severity), r.Weight, r.Message, r.Recommendation, refsJSON,
		).Scan(&r.ID); err != nil {
			return fmt.Errorf("insert assurance result %s: %w", r.Code, err)
		}
	}

	return nil
}

// GetAssessment loads the assessment header by id within the db's RLS scope.
// Returns ErrAssessmentNotFound when no row matches (in the tenant's scope).
func (s *Store) GetAssessment(ctx context.Context, db DBTX, id uuid.UUID) (*StoredAssessment, error) {
	const q = `
SELECT id, tenant_id, group_id, profile_id, workload_id, score, verdict,
       total_checks, satisfied, partial, failed, evidence_snapshot, created_by, created_at
FROM dr_assurance_assessment
WHERE id = $1`
	return scanAssessment(db.QueryRow(ctx, q, id))
}

// LatestForGroup loads the most recent assessment header for a group within the
// db's RLS scope. Returns ErrAssessmentNotFound when the group has none.
func (s *Store) LatestForGroup(ctx context.Context, db DBTX, groupID uuid.UUID) (*StoredAssessment, error) {
	const q = `
SELECT id, tenant_id, group_id, profile_id, workload_id, score, verdict,
       total_checks, satisfied, partial, failed, evidence_snapshot, created_by, created_at
FROM dr_assurance_assessment
WHERE group_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 1`
	return scanAssessment(db.QueryRow(ctx, q, groupID))
}

// rowScanner is the one-row scan surface shared by QueryRow results, so the
// header columns are decoded in exactly one place.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanAssessment(row rowScanner) (*StoredAssessment, error) {
	var a StoredAssessment
	var verdict string
	var snapshotJSON []byte
	err := row.Scan(
		&a.ID, &a.TenantID, &a.GroupID, &a.ProfileID, &a.WorkloadID, &a.Score,
		&verdict, &a.TotalChecks, &a.Satisfied, &a.Partial, &a.Failed,
		&snapshotJSON, &a.CreatedBy, &a.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAssessmentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get assurance assessment: %w", err)
	}
	a.Verdict = Verdict(verdict)
	if len(snapshotJSON) > 0 {
		if err := json.Unmarshal(snapshotJSON, &a.EvidenceSnapshot); err != nil {
			return nil, fmt.Errorf("unmarshal evidence snapshot: %w", err)
		}
	}
	return &a, nil
}

// ListResults loads the control-result rows for an assessment in stored order
// (catalog order, since SaveAssessment inserts in catalog order).
func (s *Store) ListResults(ctx context.Context, db DBTX, assessmentID uuid.UUID) ([]StoredResult, error) {
	const q = `
SELECT id, assessment_id, tenant_id, control_code, control_title, verdict,
       severity, weight, message, recommendation, evidence_refs
FROM dr_assurance_result
WHERE assessment_id = $1
ORDER BY created_at ASC, id ASC`

	rows, err := db.Query(ctx, q, assessmentID)
	if err != nil {
		return nil, fmt.Errorf("query assurance results: %w", err)
	}
	defer rows.Close()

	out := make([]StoredResult, 0)
	for rows.Next() {
		var r StoredResult
		var verdict, severity string
		var refsJSON []byte
		if err := rows.Scan(
			&r.ID, &r.AssessmentID, &r.TenantID, &r.Code, &r.Title, &verdict,
			&severity, &r.Weight, &r.Message, &r.Recommendation, &refsJSON,
		); err != nil {
			return nil, fmt.Errorf("scan assurance result: %w", err)
		}
		r.Verdict = Verdict(verdict)
		r.Severity = Severity(severity)
		if len(refsJSON) > 0 {
			if err := json.Unmarshal(refsJSON, &r.EvidenceRefs); err != nil {
				return nil, fmt.Errorf("unmarshal evidence refs for %s: %w", r.Code, err)
			}
		}
		if r.EvidenceRefs == nil {
			r.EvidenceRefs = []string{}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assurance results: %w", err)
	}
	return out, nil
}

// GroupExists reports the group's name and whether it exists in the db's RLS
// scope. The service uses it so an evaluation against a missing group is a clean
// ErrGroupNotFound rather than producing an empty-evidence assessment for a group
// the tenant does not own.
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
