package recover

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// SQLEvidenceStore is the read-only SQL implementation of EvidenceStore. It reads
// the EXISTING execution records in place — the runbookstudio run (dr_studio_run
// joined to dr_studio_runbook for the name and to recover_metastore_runbook_link
// for the application) and the cyber-recovery flow (recover_cyber_recovery_flow)
// — and never writes to or reimplements those tables. It holds no state; the
// caller supplies the tenant-scoped DBTX so every read is RLS-isolated.
type SQLEvidenceStore struct{}

// NewEvidenceStore constructs the read-only evidence store.
func NewEvidenceStore() *SQLEvidenceStore { return &SQLEvidenceStore{} }

var _ EvidenceStore = (*SQLEvidenceStore)(nil)

// runbookRunForEventSQL resolves one runbookstudio run by id (the run id IS the
// IT/Cloud DR event id), joining the runbook name and the LATEST Metastore
// application link for the runbook (a runbook may back more than one app; the
// freshest link is the population the evidence ties the RTO target to). The link
// join is LEFT so a run with no application still returns its execution record.
const runbookRunForEventSQL = `
SELECT r.id, r.runbook_id, b.name, r.mode, r.status,
       r.started_at, r.completed_at, r.actual_duration_seconds,
       l.application_id
  FROM dr_studio_run r
  JOIN dr_studio_runbook b ON b.id = r.runbook_id AND b.tenant_id = r.tenant_id
  LEFT JOIN LATERAL (
        SELECT application_id
          FROM recover_metastore_runbook_link ml
         WHERE ml.tenant_id = r.tenant_id AND ml.runbook_id = r.runbook_id
         ORDER BY ml.updated_at DESC
         LIMIT 1
       ) l ON true
 WHERE r.tenant_id = $1 AND r.id = $2`

// RunbookRunForEvent returns the runbook run identified by eventID, or (nil, nil)
// when eventID is not a runbook run for the tenant.
func (s *SQLEvidenceStore) RunbookRunForEvent(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID) (*EvidenceRunbookRow, error) {
	var (
		row   EvidenceRunbookRow
		appID sql.NullString
	)
	err := db.QueryRow(ctx, runbookRunForEventSQL, tenantID, eventID).Scan(
		&row.RunID, &row.RunbookID, &row.RunbookName, &row.Mode, &row.Status,
		&row.StartedAt, &row.CompletedAt, &row.ActualSeconds, &appID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if appID.Valid && appID.String != "" {
		v := appID.String
		row.ApplicationID = &v
	}
	return &row, nil
}

// cyberFlowForEventSQL resolves one cyber-recovery flow by id (the flow id IS the
// cyber-recovery event id), projecting the integrity-gate verdict and the
// authorized return-to-production sign-off provenance.
const cyberFlowForEventSQL = `
SELECT id, integrity_scan_id, integrity_verdict, integrity_checked_at, integrity_detail,
       approved_by, approved_by_email, approval_note, approved_for_scan_id, approved_at
  FROM recover_cyber_recovery_flow
 WHERE tenant_id = $1 AND id = $2`

// CyberFlowForEvent returns the cyber-recovery flow identified by eventID, or
// (nil, nil) when eventID is not a cyber flow for the tenant.
func (s *SQLEvidenceStore) CyberFlowForEvent(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID) (*EvidenceCyberRow, error) {
	var (
		row             EvidenceCyberRow
		scanID          sql.NullString
		verdict         sql.NullString
		checkedAt       sql.NullTime
		detail          sql.NullString
		approvedBy      sql.NullString
		approvedByEmail sql.NullString
		approvalNote    sql.NullString
		approvedForScan sql.NullString
		approvedAt      sql.NullTime
	)
	err := db.QueryRow(ctx, cyberFlowForEventSQL, tenantID, eventID).Scan(
		&row.FlowID, &scanID, &verdict, &checkedAt, &detail,
		&approvedBy, &approvedByEmail, &approvalNote, &approvedForScan, &approvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if scanID.Valid {
		v := scanID.String
		row.IntegrityScanID = &v
	}
	row.IntegrityVerdict = verdict.String
	row.IntegrityDetail = detail.String
	if checkedAt.Valid {
		t := checkedAt.Time
		row.IntegrityCheckedAt = &t
	}
	row.ApprovedBy = parseAuditUUID(approvedBy)
	row.ApprovedByEmail = approvedByEmail.String
	row.ApprovalNote = approvalNote.String
	if approvedForScan.Valid {
		v := approvedForScan.String
		row.ApprovedForScanID = &v
	}
	if approvedAt.Valid {
		t := approvedAt.Time
		row.ApprovedAt = &t
	}
	return &row, nil
}
