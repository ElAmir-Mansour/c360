package cleanroom

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrNotFound is returned when no clean-room scan matches a query.
var ErrNotFound = errors.New("cleanroom: scan not found")

// Store persists dr_cleanroom_scan rows. It holds no state and takes a
// repository.DBTX on every method so callers choose the execution context: the
// service's open transaction makes the verdict insert atomic with its outbox
// event, while a pool serves single reads.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

const insertScanSQL = `
INSERT INTO dr_cleanroom_scan
    (tenant_id, recovery_point_id, group_id, verdict, scanner,
     chunks_scanned, bytes_scanned, detail, findings, started_at, finished_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id`

// CreateScan inserts a clean-room scan verdict and populates its generated id.
// findings is serialized to JSONB. It must be called with the transaction that
// carries the recovery-point promotion + outbox event so the three commit
// together.
func (Store) CreateScan(ctx context.Context, db repository.DBTX, s *Scan) error {
	findings := s.Findings
	if findings == nil {
		findings = []ChunkVerdict{}
	}
	findingsJSON, err := json.Marshal(findings)
	if err != nil {
		return fmt.Errorf("marshaling cleanroom findings: %w", err)
	}
	err = db.QueryRow(ctx, insertScanSQL,
		s.TenantID, s.RecoveryPointID, s.GroupID, s.Verdict, s.Scanner,
		s.ChunksScanned, s.BytesScanned, s.Detail, findingsJSON, s.StartedAt, s.FinishedAt,
	).Scan(&s.ID)
	if err != nil {
		return fmt.Errorf("creating cleanroom scan: %w", err)
	}
	return nil
}

const scanColumns = `
id, tenant_id, recovery_point_id, group_id, verdict, scanner,
chunks_scanned, bytes_scanned, detail, findings, started_at, finished_at`

func scanScan(row interface{ Scan(...any) error }) (*Scan, error) {
	var s Scan
	var findingsJSON []byte
	if err := row.Scan(
		&s.ID, &s.TenantID, &s.RecoveryPointID, &s.GroupID, &s.Verdict, &s.Scanner,
		&s.ChunksScanned, &s.BytesScanned, &s.Detail, &findingsJSON, &s.StartedAt, &s.FinishedAt,
	); err != nil {
		return nil, err
	}
	if len(findingsJSON) > 0 {
		if err := json.Unmarshal(findingsJSON, &s.Findings); err != nil {
			return nil, fmt.Errorf("unmarshaling cleanroom findings: %w", err)
		}
	}
	return &s, nil
}

const latestScanSQL = `SELECT ` + scanColumns + `
FROM dr_cleanroom_scan
WHERE tenant_id = $1 AND recovery_point_id = $2
ORDER BY finished_at DESC, id DESC
LIMIT 1`

// LatestScan returns the most recent clean-room scan for a recovery point.
func (Store) LatestScan(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) (*Scan, error) {
	s, err := scanScan(db.QueryRow(ctx, latestScanSQL, tenantID, recoveryPointID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("recovery point %s: %w", recoveryPointID, ErrNotFound)
		}
		return nil, fmt.Errorf("loading latest cleanroom scan: %w", err)
	}
	return s, nil
}

const listScansSQL = `SELECT ` + scanColumns + `
FROM dr_cleanroom_scan
WHERE tenant_id = $1 AND recovery_point_id = $2
ORDER BY finished_at DESC, id DESC`

// ListScans returns a recovery point's clean-room scan history, newest first.
func (Store) ListScans(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) ([]*Scan, error) {
	rows, err := db.Query(ctx, listScansSQL, tenantID, recoveryPointID)
	if err != nil {
		return nil, fmt.Errorf("listing cleanroom scans: %w", err)
	}
	defer rows.Close()

	var scans []*Scan
	for rows.Next() {
		s, err := scanScan(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning cleanroom scan: %w", err)
		}
		scans = append(scans, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading cleanroom scans: %w", err)
	}
	return scans, nil
}

const countCleanScansSQL = `
SELECT count(*)
FROM dr_cleanroom_scan
WHERE tenant_id = $1 AND recovery_point_id = $2 AND verdict = 'clean'`

// IsCleanValidated reports whether the recovery point has at least one CLEAN
// verdict on record — the gate the recovery executor checks before restoring
// into production.
func (Store) IsCleanValidated(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) (bool, error) {
	var n int
	if err := db.QueryRow(ctx, countCleanScansSQL, tenantID, recoveryPointID).Scan(&n); err != nil {
		return false, fmt.Errorf("counting clean cleanroom scans: %w", err)
	}
	return n > 0, nil
}
