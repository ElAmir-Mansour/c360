package storageoffload

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists the storage-offload catalog (dr_storage_volume,
// dr_storage_snapshot). Every method takes a repository.DBTX — the same pgx
// subset the rest of dr_db uses — so a write can run inside the caller's
// tenant-scoped transaction (RLS active) or, for the poll/retention loop, a
// system transaction (RLS bypassed). The DB row is the orchestration ledger; the
// provider owns the array-side bytes.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// --- Volumes --------------------------------------------------------------

const insertVolumeSQL = `
INSERT INTO dr_storage_volume
    (tenant_id, name, provider, array_endpoint, source_location, site_id,
     retention_max_snapshots, retention_max_age_seconds)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at, updated_at`

// CreateVolume registers a storage volume to offload. tenant_id must match the
// surrounding transaction's app.current_tenant_id or RLS rejects it.
func (s *Store) CreateVolume(ctx context.Context, db repository.DBTX, v *Volume) error {
	var siteID *string
	if v.SiteID != nil {
		id := v.SiteID.String()
		siteID = &id
	}
	err := db.QueryRow(ctx, insertVolumeSQL,
		v.TenantID, v.Name, v.Provider, v.ArrayEndpoint, v.SourceLocation, siteID,
		v.RetentionMaxSnapshots, v.RetentionMaxAgeSeconds,
	).Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("volume %q: %w", v.Name, ErrAlreadyExists)
		}
		return fmt.Errorf("storageoffload: creating volume %q: %w", v.Name, err)
	}
	return nil
}

const volumeColumns = `
id, tenant_id, name, provider, array_endpoint, source_location, site_id,
retention_max_snapshots, retention_max_age_seconds, created_at, updated_at`

const selectVolumeSQL = `SELECT ` + volumeColumns + `
FROM dr_storage_volume WHERE tenant_id = $1 AND id = $2`

// GetVolume loads a volume by id within the tenant.
func (s *Store) GetVolume(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*Volume, error) {
	return scanVolume(db.QueryRow(ctx, selectVolumeSQL, tenantID, id))
}

const selectVolumeSystemSQL = `SELECT ` + volumeColumns + `
FROM dr_storage_volume WHERE id = $1`

// GetVolumeSystem loads a volume by id WITHOUT a tenant filter, for the
// background loop (it must resolve the volume of a claimed snapshot across
// tenants). It must run under a system transaction (app.bypass_rls).
func (s *Store) GetVolumeSystem(ctx context.Context, db repository.DBTX, id uuid.UUID) (*Volume, error) {
	return scanVolume(db.QueryRow(ctx, selectVolumeSystemSQL, id))
}

const listVolumesSQL = `SELECT ` + volumeColumns + `
FROM dr_storage_volume WHERE tenant_id = $1 ORDER BY created_at DESC`

// ListVolumes returns every volume for the tenant.
func (s *Store) ListVolumes(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*Volume, error) {
	rows, err := db.Query(ctx, listVolumesSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("storageoffload: listing volumes: %w", err)
	}
	defer rows.Close()
	var out []*Volume
	for rows.Next() {
		v, serr := scanVolume(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storageoffload: iterating volumes: %w", err)
	}
	return out, nil
}

// --- Snapshots ------------------------------------------------------------

const insertSnapshotSQL = `
INSERT INTO dr_storage_snapshot
    (tenant_id, volume_id, parent_id, kind, state)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at, updated_at`

// CreateSnapshot inserts a PENDING snapshot row (the orchestration intent). The
// provider handle, manifest hash, size, and ready state are filled in by
// MarkCreating / MarkReady once the provider has done the work.
func (s *Store) CreateSnapshot(ctx context.Context, db repository.DBTX, snap *Snapshot) error {
	if snap.State == "" {
		snap.State = StatePending
	}
	if snap.Kind == "" {
		snap.Kind = SnapshotKindFull
	}
	var parentID *string
	if snap.ParentID != nil {
		p := snap.ParentID.String()
		parentID = &p
	}
	err := db.QueryRow(ctx, insertSnapshotSQL,
		snap.TenantID, snap.VolumeID, parentID, snap.Kind, snap.State,
	).Scan(&snap.ID, &snap.CreatedAt, &snap.UpdatedAt)
	if err != nil {
		return fmt.Errorf("storageoffload: creating snapshot: %w", err)
	}
	return nil
}

const snapshotColumns = `
id, tenant_id, volume_id, parent_id, provider_handle, kind, state, manifest_hash,
size_bytes, changed_bytes, file_count, replicated_target, last_error,
created_at, ready_at, replicated_at, expired_at, updated_at`

const selectSnapshotSQL = `SELECT ` + snapshotColumns + `
FROM dr_storage_snapshot WHERE tenant_id = $1 AND id = $2`

// GetSnapshot loads a snapshot by id within the tenant.
func (s *Store) GetSnapshot(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*Snapshot, error) {
	return scanSnapshot(db.QueryRow(ctx, selectSnapshotSQL, tenantID, id))
}

const selectSnapshotSystemSQL = `SELECT ` + snapshotColumns + `
FROM dr_storage_snapshot WHERE id = $1`

// GetSnapshotSystem loads a snapshot by id WITHOUT a tenant filter, for the
// background loop. It must run under a system transaction (app.bypass_rls).
func (s *Store) GetSnapshotSystem(ctx context.Context, db repository.DBTX, id uuid.UUID) (*Snapshot, error) {
	return scanSnapshot(db.QueryRow(ctx, selectSnapshotSystemSQL, id))
}

const listSnapshotsByVolumeSQL = `SELECT ` + snapshotColumns + `
FROM dr_storage_snapshot WHERE tenant_id = $1 AND volume_id = $2 ORDER BY created_at DESC`

// ListSnapshotsByVolume returns a volume's snapshots, newest first.
func (s *Store) ListSnapshotsByVolume(ctx context.Context, db repository.DBTX, tenantID, volumeID uuid.UUID) ([]*Snapshot, error) {
	rows, err := db.Query(ctx, listSnapshotsByVolumeSQL, tenantID, volumeID)
	if err != nil {
		return nil, fmt.Errorf("storageoffload: listing snapshots: %w", err)
	}
	defer rows.Close()
	return scanSnapshots(rows)
}

const listSnapshotsByVolumeSystemSQL = `SELECT ` + snapshotColumns + `
FROM dr_storage_snapshot WHERE volume_id = $1 ORDER BY created_at DESC`

// ListSnapshotsByVolumeSystem returns a volume's snapshots WITHOUT a tenant
// filter, for the retention loop. Must run under a system transaction.
func (s *Store) ListSnapshotsByVolumeSystem(ctx context.Context, db repository.DBTX, volumeID uuid.UUID) ([]*Snapshot, error) {
	rows, err := db.Query(ctx, listSnapshotsByVolumeSystemSQL, volumeID)
	if err != nil {
		return nil, fmt.Errorf("storageoffload: system listing snapshots: %w", err)
	}
	defer rows.Close()
	return scanSnapshots(rows)
}

const latestReadySnapshotSQL = `SELECT ` + snapshotColumns + `
FROM dr_storage_snapshot
WHERE tenant_id = $1 AND volume_id = $2 AND state IN ('READY','REPLICATING','REPLICATED')
ORDER BY created_at DESC
LIMIT 1`

// LatestReadySnapshot returns the newest snapshot of a volume whose content is
// materialized (READY or already/being replicated), so a new incremental can be
// diffed against it. Returns ErrNotFound when none exists (the next snapshot must
// be a full base).
func (s *Store) LatestReadySnapshot(ctx context.Context, db repository.DBTX, tenantID, volumeID uuid.UUID) (*Snapshot, error) {
	return scanSnapshot(db.QueryRow(ctx, latestReadySnapshotSQL, tenantID, volumeID))
}

const claimActiveSnapshotsSQL = `SELECT ` + snapshotColumns + `
FROM dr_storage_snapshot
WHERE state IN ('PENDING','CREATING','REPLICATING')
ORDER BY created_at ASC
LIMIT $1
FOR UPDATE SKIP LOCKED`

// ClaimActiveSnapshots returns up to limit snapshots still being created or
// replicated, locked FOR UPDATE SKIP LOCKED so concurrent loop instances do not
// process the same row. System (RLS-bypass) path only.
func (s *Store) ClaimActiveSnapshots(ctx context.Context, db repository.DBTX, limit int) ([]*Snapshot, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := db.Query(ctx, claimActiveSnapshotsSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("storageoffload: claiming active snapshots: %w", err)
	}
	defer rows.Close()
	return scanSnapshots(rows)
}

const markCreatingSQL = `
UPDATE dr_storage_snapshot
   SET state = 'CREATING', provider_handle = $2, updated_at = now()
 WHERE id = $1 AND state = 'PENDING'`

// MarkCreating records the provider handle and moves PENDING -> CREATING. The
// WHERE guard makes a re-issue a no-op (returns false).
func (s *Store) MarkCreating(ctx context.Context, db repository.DBTX, id uuid.UUID, handle string) (bool, error) {
	tag, err := db.Exec(ctx, markCreatingSQL, id, handle)
	if err != nil {
		return false, fmt.Errorf("storageoffload: marking snapshot %s creating: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const markReadySQL = `
UPDATE dr_storage_snapshot
   SET state = 'READY', provider_handle = COALESCE(NULLIF($2,''), provider_handle),
       manifest_hash = $3, size_bytes = $4, changed_bytes = $5, file_count = $6,
       ready_at = now(), last_error = NULL, updated_at = now()
 WHERE id = $1 AND state IN ('PENDING','CREATING')`

// MarkReady records the captured manifest hash, size, delta, and file count and
// moves PENDING/CREATING -> READY. Guarded so a re-claim does not re-fire.
func (s *Store) MarkReady(ctx context.Context, db repository.DBTX, id uuid.UUID, handle, manifestHash string, sizeBytes, changedBytes int64, fileCount int) (bool, error) {
	tag, err := db.Exec(ctx, markReadySQL, id, handle, manifestHash, sizeBytes, changedBytes, fileCount)
	if err != nil {
		return false, fmt.Errorf("storageoffload: marking snapshot %s ready: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const markReplicatingSQL = `
UPDATE dr_storage_snapshot
   SET state = 'REPLICATING', replicated_target = $2, updated_at = now()
 WHERE id = $1 AND state = 'READY'`

// MarkReplicating moves READY -> REPLICATING and records the target atomically.
// Guarded so only a ready snapshot starts replicating (returns false otherwise).
func (s *Store) MarkReplicating(ctx context.Context, db repository.DBTX, id uuid.UUID, target string) (bool, error) {
	tag, err := db.Exec(ctx, markReplicatingSQL, id, target)
	if err != nil {
		return false, fmt.Errorf("storageoffload: marking snapshot %s replicating: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const markReplicatedSQL = `
UPDATE dr_storage_snapshot
   SET state = 'REPLICATED', replicated_target = $2, changed_bytes = $3,
       replicated_at = now(), last_error = NULL, updated_at = now()
 WHERE id = $1 AND state = 'REPLICATING'`

// MarkReplicated records the DR target and the bytes transferred and moves
// REPLICATING -> REPLICATED. Guarded so a re-claim does not re-fire.
func (s *Store) MarkReplicated(ctx context.Context, db repository.DBTX, id uuid.UUID, target string, transferred int64) (bool, error) {
	tag, err := db.Exec(ctx, markReplicatedSQL, id, target, transferred)
	if err != nil {
		return false, fmt.Errorf("storageoffload: marking snapshot %s replicated: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const markExpiredSQL = `
UPDATE dr_storage_snapshot
   SET state = 'EXPIRED', expired_at = now(), updated_at = now()
 WHERE id = $1 AND state NOT IN ('EXPIRED','FAILED')`

// MarkExpired moves a non-terminal snapshot to EXPIRED (retention deleted its
// bytes). Guarded so a terminal snapshot is untouched.
func (s *Store) MarkExpired(ctx context.Context, db repository.DBTX, id uuid.UUID) (bool, error) {
	tag, err := db.Exec(ctx, markExpiredSQL, id)
	if err != nil {
		return false, fmt.Errorf("storageoffload: marking snapshot %s expired: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const failSnapshotSQL = `
UPDATE dr_storage_snapshot
   SET state = 'FAILED', last_error = $2, updated_at = now()
 WHERE id = $1 AND state NOT IN ('EXPIRED','FAILED','REPLICATED')`

// FailSnapshot moves a non-terminal snapshot to FAILED with a reason. Guarded so
// a terminal/replicated snapshot is not clobbered.
func (s *Store) FailSnapshot(ctx context.Context, db repository.DBTX, id uuid.UUID, reason string) (bool, error) {
	tag, err := db.Exec(ctx, failSnapshotSQL, id, reason)
	if err != nil {
		return false, fmt.Errorf("storageoffload: failing snapshot %s: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const hasLiveChildSQL = `
SELECT EXISTS (
    SELECT 1 FROM dr_storage_snapshot
    WHERE parent_id = $1 AND state NOT IN ('EXPIRED','FAILED')
)`

// HasLiveChild reports whether a snapshot is still the parent of any non-terminal
// child. Retention must never expire such a snapshot: an incremental child still
// depends on its parent's content.
func (s *Store) HasLiveChild(ctx context.Context, db repository.DBTX, id uuid.UUID) (bool, error) {
	var exists bool
	if err := db.QueryRow(ctx, hasLiveChildSQL, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("storageoffload: checking live children of %s: %w", id, err)
	}
	return exists, nil
}

// --- scanning -------------------------------------------------------------

type rowScanner interface {
	Scan(dest ...any) error
}

func scanVolume(sc rowScanner) (*Volume, error) {
	var (
		v      Volume
		siteID *string
	)
	err := sc.Scan(
		&v.ID, &v.TenantID, &v.Name, &v.Provider, &v.ArrayEndpoint, &v.SourceLocation,
		&siteID, &v.RetentionMaxSnapshots, &v.RetentionMaxAgeSeconds, &v.CreatedAt, &v.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("storageoffload: scanning volume: %w", err)
	}
	if siteID != nil {
		id, perr := uuid.Parse(*siteID)
		if perr != nil {
			return nil, fmt.Errorf("storageoffload: parsing site_id %q: %w", *siteID, perr)
		}
		v.SiteID = &id
	}
	return &v, nil
}

func scanSnapshots(rows pgx.Rows) ([]*Snapshot, error) {
	var out []*Snapshot
	for rows.Next() {
		snap, err := scanSnapshot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, snap)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storageoffload: iterating snapshots: %w", err)
	}
	return out, nil
}

func scanSnapshot(sc rowScanner) (*Snapshot, error) {
	var (
		snap             Snapshot
		parentID         *string
		replicatedTarget sql.NullString
		lastError        sql.NullString
		readyAt          sql.NullTime
		replicatedAt     sql.NullTime
		expiredAt        sql.NullTime
	)
	err := sc.Scan(
		&snap.ID, &snap.TenantID, &snap.VolumeID, &parentID, &snap.ProviderHandle,
		&snap.Kind, &snap.State, &snap.ManifestHash, &snap.SizeBytes, &snap.ChangedBytes,
		&snap.FileCount, &replicatedTarget, &lastError, &snap.CreatedAt,
		&readyAt, &replicatedAt, &expiredAt, &snap.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("storageoffload: scanning snapshot: %w", err)
	}
	if parentID != nil {
		id, perr := uuid.Parse(*parentID)
		if perr != nil {
			return nil, fmt.Errorf("storageoffload: parsing parent_id %q: %w", *parentID, perr)
		}
		snap.ParentID = &id
	}
	snap.ReplicatedTarget = nullStr(replicatedTarget)
	snap.LastError = nullStr(lastError)
	snap.ReadyAt = nullTime(readyAt)
	snap.ReplicatedAt = nullTime(replicatedAt)
	snap.ExpiredAt = nullTime(expiredAt)
	return &snap, nil
}

func nullStr(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	return &s.String
}

func nullTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}
