package cyberrecovery

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// ErrFlowNotFound is returned when a flow id does not resolve for the tenant.
var ErrFlowNotFound = errors.New("cyberrecovery: flow not found")

// ErrVersionConflict is returned when an optimistic-concurrency transition loses
// the version race (a concurrent operator already advanced the flow).
var ErrVersionConflict = errors.New("cyberrecovery: flow modified concurrently")

// TenantRunner runs a function inside a tenant-scoped read or read-write
// transaction (RLS set via SET LOCAL app.current_tenant_id). *pgxpool.Pool is
// adapted by PGXRunner; tests supply a fake.
type TenantRunner interface {
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner using the shared tenant-context
// helpers, mirroring cleanroom.PGXRunner and recover.PGXRunner.
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("cyberrecovery: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("cyberrecovery: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

var _ TenantRunner = PGXRunner{}

// Store is the persistence surface for the clean-room recovery flow and its
// append-only transition log, plus the composed read of last-known-good clean
// points. It holds no state; the flow table and the event log are the source of
// truth. All methods take a repository.DBTX so the service can compose a
// transition + event write atomically.
type Store interface {
	// CreateFlow inserts a new flow at PhaseCleanPointSelected and returns it.
	CreateFlow(ctx context.Context, db repository.DBTX, f *Flow) error
	// GetFlow loads one flow scoped to the tenant.
	GetFlow(ctx context.Context, db repository.DBTX, tenantID, flowID uuid.UUID) (*Flow, error)
	// ListFlows returns a tenant's flows newest first, capped by limit.
	ListFlows(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]Flow, error)
	// UpdateFlow persists a flow's mutable columns under optimistic concurrency:
	// the UPDATE matches on the expected version and bumps it. Returns
	// ErrVersionConflict when no row matched (a concurrent transition won).
	UpdateFlow(ctx context.Context, db repository.DBTX, f *Flow, expectedVersion int64) error
	// AppendEvent writes one immutable transition row. There is no update/delete
	// counterpart by design — the log is append-only.
	AppendEvent(ctx context.Context, db repository.DBTX, e *FlowEvent) error
	// ListEvents returns a flow's transition history, oldest first.
	ListEvents(ctx context.Context, db repository.DBTX, tenantID, flowID uuid.UUID) ([]FlowEvent, error)
	// ListCleanPoints returns the tenant's validated recovery points (newest
	// first) joined with their latest clean-room verdict, capped by limit.
	ListCleanPoints(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]CleanPoint, error)
	// GetCleanPoint returns one validated recovery point + its latest verdict,
	// or ErrFlowNotFound's recovery-point analogue (ErrCleanPointNotFound).
	GetCleanPoint(ctx context.Context, db repository.DBTX, tenantID, pointID uuid.UUID) (*CleanPoint, error)
}

// ErrCleanPointNotFound is returned when a clean-point id does not resolve to a
// validated recovery point for the tenant.
var ErrCleanPointNotFound = errors.New("cyberrecovery: clean point not found or not validated")

// PGStore is the Postgres-backed Store.
type PGStore struct{}

// NewStore constructs the Postgres store.
func NewStore() *PGStore { return &PGStore{} }

var _ Store = (*PGStore)(nil)

const insertFlowSQL = `
INSERT INTO recover_cyber_recovery_flow
    (tenant_id, clean_point_id, group_id, target_label, target_kind, phase, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, version, created_at, updated_at`

// CreateFlow inserts a new flow at PhaseCleanPointSelected.
func (s *PGStore) CreateFlow(ctx context.Context, db repository.DBTX, f *Flow) error {
	err := db.QueryRow(ctx, insertFlowSQL,
		f.TenantID, f.CleanPoint, f.GroupID, f.TargetLabel, string(f.TargetKind), string(f.Phase), nullUUID(f.CreatedBy),
	).Scan(&f.ID, &f.Version, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return fmt.Errorf("cyberrecovery: creating flow: %w", err)
	}
	return nil
}

const selectFlowColumns = `
    id, tenant_id, clean_point_id, group_id, target_label, target_kind, phase,
    runbook_run_id, integrity_scan_id, integrity_verdict, integrity_checked_at, integrity_detail,
    approved_by, approved_by_email, approved_at, approval_note, approved_for_scan_id,
    returned_by, returned_at, abort_reason, version, created_by, created_at, updated_at`

const selectFlowSQL = `SELECT ` + selectFlowColumns + `
FROM recover_cyber_recovery_flow WHERE tenant_id = $1 AND id = $2`

// GetFlow loads one flow scoped to the tenant.
func (s *PGStore) GetFlow(ctx context.Context, db repository.DBTX, tenantID, flowID uuid.UUID) (*Flow, error) {
	row := db.QueryRow(ctx, selectFlowSQL, tenantID, flowID)
	f, err := scanFlow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("flow %s: %w", flowID, ErrFlowNotFound)
		}
		return nil, fmt.Errorf("cyberrecovery: loading flow: %w", err)
	}
	return f, nil
}

const listFlowsSQL = `SELECT ` + selectFlowColumns + `
FROM recover_cyber_recovery_flow
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT $2`

// ListFlows returns a tenant's flows newest first.
func (s *PGStore) ListFlows(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]Flow, error) {
	limit = clampLimit(limit, 100)
	rows, err := db.Query(ctx, listFlowsSQL, tenantID, limit)
	if err != nil {
		return nil, fmt.Errorf("cyberrecovery: listing flows: %w", err)
	}
	defer rows.Close()
	out := []Flow{}
	for rows.Next() {
		f, err := scanFlow(rows)
		if err != nil {
			return nil, fmt.Errorf("cyberrecovery: scanning flow: %w", err)
		}
		out = append(out, *f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cyberrecovery: reading flows: %w", err)
	}
	return out, nil
}

const updateFlowSQL = `
UPDATE recover_cyber_recovery_flow SET
    phase = $3,
    runbook_run_id = $4,
    integrity_scan_id = $5,
    integrity_verdict = $6,
    integrity_checked_at = $7,
    integrity_detail = $8,
    approved_by = $9,
    approved_by_email = $10,
    approved_at = $11,
    approval_note = $12,
    approved_for_scan_id = $13,
    returned_by = $14,
    returned_at = $15,
    abort_reason = $16,
    version = version + 1,
    updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND version = $17
RETURNING version, updated_at`

// UpdateFlow persists a flow's mutable columns under optimistic concurrency.
func (s *PGStore) UpdateFlow(ctx context.Context, db repository.DBTX, f *Flow, expectedVersion int64) error {
	err := db.QueryRow(ctx, updateFlowSQL,
		f.TenantID, f.ID, string(f.Phase), nullString(f.RunbookRunID),
		nullUUID(f.IntegrityScanID), nullString(f.IntegrityVerdict), nullTime(f.IntegrityCheckedAt), f.IntegrityDetail,
		nullUUID(f.ApprovedBy), nullString(f.ApprovedByEmail), nullTime(f.ApprovedAt), f.ApprovalNote, nullUUID(f.ApprovedForScanID),
		nullUUID(f.ReturnedBy), nullTime(f.ReturnedAt), f.AbortReason,
		expectedVersion,
	).Scan(&f.Version, &f.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVersionConflict
		}
		return fmt.Errorf("cyberrecovery: updating flow: %w", err)
	}
	return nil
}

const insertEventSQL = `
INSERT INTO recover_cyber_recovery_event
    (tenant_id, flow_id, from_phase, to_phase, actor_id, actor_email, detail)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, created_at`

// AppendEvent writes one immutable transition row.
func (s *PGStore) AppendEvent(ctx context.Context, db repository.DBTX, e *FlowEvent) error {
	detail := e.Detail
	if detail == nil {
		detail = map[string]any{}
	}
	blob, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("cyberrecovery: marshaling event detail: %w", err)
	}
	if err := db.QueryRow(ctx, insertEventSQL,
		e.TenantID, e.FlowID, string(e.FromPhase), string(e.ToPhase), nullUUID(e.ActorID), nullString(e.ActorEmail), blob,
	).Scan(&e.ID, &e.CreatedAt); err != nil {
		return fmt.Errorf("cyberrecovery: appending event: %w", err)
	}
	return nil
}

const listEventsSQL = `
SELECT id, flow_id, from_phase, to_phase, actor_id, actor_email, detail, created_at
FROM recover_cyber_recovery_event
WHERE tenant_id = $1 AND flow_id = $2
ORDER BY created_at ASC, id ASC`

// ListEvents returns a flow's transition history, oldest first.
func (s *PGStore) ListEvents(ctx context.Context, db repository.DBTX, tenantID, flowID uuid.UUID) ([]FlowEvent, error) {
	rows, err := db.Query(ctx, listEventsSQL, tenantID, flowID)
	if err != nil {
		return nil, fmt.Errorf("cyberrecovery: listing events: %w", err)
	}
	defer rows.Close()
	out := []FlowEvent{}
	for rows.Next() {
		var e FlowEvent
		var actorID sql.NullString
		var actorEmail sql.NullString
		var blob []byte
		var from, to string
		if err := rows.Scan(&e.ID, &e.FlowID, &from, &to, &actorID, &actorEmail, &blob, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("cyberrecovery: scanning event: %w", err)
		}
		e.FromPhase = Phase(from)
		e.ToPhase = Phase(to)
		if actorID.Valid {
			if id, perr := uuid.Parse(actorID.String); perr == nil {
				e.ActorID = &id
			}
		}
		if actorEmail.Valid {
			e.ActorEmail = actorEmail.String
		}
		if len(blob) > 0 {
			_ = json.Unmarshal(blob, &e.Detail)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cyberrecovery: reading events: %w", err)
	}
	return out, nil
}

// listCleanPointsSQL composes the shared recovery_point table with its latest
// clean-room verdict (a correlated lookup of the freshest dr_cleanroom_scan row
// per point). Only validated points are returned — the last-known-good set.
const listCleanPointsSQL = `
SELECT rp.id, rp.group_id, rp.marker_lsn, rp.sealed_at, rp.is_validated, rp.legal_hold,
       cs.verdict, cs.finished_at
FROM recovery_point rp
LEFT JOIN LATERAL (
    SELECT verdict, finished_at
    FROM dr_cleanroom_scan s
    WHERE s.tenant_id = rp.tenant_id AND s.recovery_point_id = rp.id
    ORDER BY s.finished_at DESC
    LIMIT 1
) cs ON true
WHERE rp.tenant_id = $1 AND rp.is_validated = true
ORDER BY rp.sealed_at DESC
LIMIT $2`

// ListCleanPoints returns the tenant's validated recovery points (newest first)
// with their latest clean-room verdict.
func (s *PGStore) ListCleanPoints(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]CleanPoint, error) {
	limit = clampLimit(limit, 50)
	rows, err := db.Query(ctx, listCleanPointsSQL, tenantID, limit)
	if err != nil {
		return nil, fmt.Errorf("cyberrecovery: listing clean points: %w", err)
	}
	defer rows.Close()
	out := []CleanPoint{}
	for rows.Next() {
		cp, err := scanCleanPoint(rows)
		if err != nil {
			return nil, fmt.Errorf("cyberrecovery: scanning clean point: %w", err)
		}
		out = append(out, cp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cyberrecovery: reading clean points: %w", err)
	}
	return out, nil
}

const getCleanPointSQL = `
SELECT rp.id, rp.group_id, rp.marker_lsn, rp.sealed_at, rp.is_validated, rp.legal_hold,
       cs.verdict, cs.finished_at
FROM recovery_point rp
LEFT JOIN LATERAL (
    SELECT verdict, finished_at
    FROM dr_cleanroom_scan s
    WHERE s.tenant_id = rp.tenant_id AND s.recovery_point_id = rp.id
    ORDER BY s.finished_at DESC
    LIMIT 1
) cs ON true
WHERE rp.tenant_id = $1 AND rp.id = $2 AND rp.is_validated = true`

// GetCleanPoint returns one validated recovery point + its latest verdict.
func (s *PGStore) GetCleanPoint(ctx context.Context, db repository.DBTX, tenantID, pointID uuid.UUID) (*CleanPoint, error) {
	row := db.QueryRow(ctx, getCleanPointSQL, tenantID, pointID)
	cp, err := scanCleanPoint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("clean point %s: %w", pointID, ErrCleanPointNotFound)
		}
		return nil, fmt.Errorf("cyberrecovery: loading clean point: %w", err)
	}
	return &cp, nil
}

// --- scan helpers ----------------------------------------------------------

// scannable is the minimal interface both pgx.Row and pgx.Rows satisfy.
type scannable interface {
	Scan(dest ...any) error
}

func scanFlow(row scannable) (*Flow, error) {
	var f Flow
	var targetKind, phase string
	var runbookRunID, integrityVerdict, approvedByEmail, approvalNote, abortReason sql.NullString
	var integrityScanID, approvedBy, approvedForScanID, returnedBy, createdBy sql.NullString
	var integrityCheckedAt, approvedAt, returnedAt sql.NullTime
	if err := row.Scan(
		&f.ID, &f.TenantID, &f.CleanPoint, &f.GroupID, &f.TargetLabel, &targetKind, &phase,
		&runbookRunID, &integrityScanID, &integrityVerdict, &integrityCheckedAt, &f.IntegrityDetail,
		&approvedBy, &approvedByEmail, &approvedAt, &approvalNote, &approvedForScanID,
		&returnedBy, &returnedAt, &abortReason, &f.Version, &createdBy, &f.CreatedAt, &f.UpdatedAt,
	); err != nil {
		return nil, err
	}
	f.TargetKind = TargetKind(targetKind)
	f.Phase = Phase(phase)
	f.RunbookRunID = runbookRunID.String
	f.IntegrityVerdict = integrityVerdict.String
	f.ApprovedByEmail = approvedByEmail.String
	f.ApprovalNote = approvalNote.String
	f.AbortReason = abortReason.String
	f.IntegrityScanID = parseNullUUID(integrityScanID)
	f.ApprovedBy = parseNullUUID(approvedBy)
	f.ApprovedForScanID = parseNullUUID(approvedForScanID)
	f.ReturnedBy = parseNullUUID(returnedBy)
	f.CreatedBy = parseNullUUID(createdBy)
	f.IntegrityCheckedAt = nullableTime(integrityCheckedAt)
	f.ApprovedAt = nullableTime(approvedAt)
	f.ReturnedAt = nullableTime(returnedAt)
	return &f, nil
}

func scanCleanPoint(row scannable) (CleanPoint, error) {
	var cp CleanPoint
	var verdict sql.NullString
	var scanAt sql.NullTime
	if err := row.Scan(
		&cp.ID, &cp.GroupID, &cp.MarkerLSN, &cp.SealedAt, &cp.IsValidated, &cp.LegalHold,
		&verdict, &scanAt,
	); err != nil {
		return CleanPoint{}, err
	}
	cp.LatestScanVerdict = verdict.String
	cp.LatestScanAt = nullableTime(scanAt)
	return cp, nil
}

func clampLimit(limit, fallback int) int {
	if limit <= 0 || limit > 1000 {
		return fallback
	}
	return limit
}

func nullUUID(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return *id
}

func parseNullUUID(s sql.NullString) *uuid.UUID {
	if !s.Valid || s.String == "" {
		return nil
	}
	id, err := uuid.Parse(s.String)
	if err != nil {
		return nil
	}
	return &id
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

func nullableTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}
