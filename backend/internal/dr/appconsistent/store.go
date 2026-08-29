package appconsistent

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists dr_consistency_barrier rows. It holds no state and takes a
// repository.DBTX on every method so callers choose the execution context: the
// Coordinator's open transaction makes the barrier insert atomic with the
// recovery-point seal + outbox event, while a pool serves single reads.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

const insertBarrierSQL = `
INSERT INTO dr_consistency_barrier
    (tenant_id, group_id, recovery_point_id, consistency_level, provider,
     barrier_lsn, success, quiesced, thawed, detail, error, requested_by,
     quiesce_started_at, quiesce_finished_at, thaw_started_at, thaw_finished_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING id, created_at`

// CreateBarrier inserts a consistency-barrier record and populates its generated
// id + created_at. It must be called with the transaction that carries the
// recovery-point seal (when one was produced) and its outbox event so the rows
// commit together.
func (Store) CreateBarrier(ctx context.Context, db repository.DBTX, b *Barrier) error {
	if b.TenantID == "" {
		return fmt.Errorf("%w: tenant id is required", ErrInvalidInput)
	}
	if b.GroupID == "" {
		return fmt.Errorf("%w: group id is required", ErrInvalidInput)
	}
	if b.ConsistencyLevel != ConsistencyApplication && b.ConsistencyLevel != ConsistencyCrash {
		return fmt.Errorf("%w: consistency level %q", ErrInvalidInput, b.ConsistencyLevel)
	}
	switch b.Provider {
	case ProviderScript, ProviderHTTP, ProviderNone:
	default:
		return fmt.Errorf("%w: provider %q", ErrInvalidInput, b.Provider)
	}
	err := db.QueryRow(ctx, insertBarrierSQL,
		b.TenantID, b.GroupID, b.RecoveryPointID, b.ConsistencyLevel, b.Provider,
		b.BarrierLSN, b.Success, b.Quiesced, b.Thawed, b.Detail, b.Error, b.RequestedBy,
		b.QuiesceStartedAt, b.QuiesceFinishedAt, b.ThawStartedAt, b.ThawFinishedAt,
	).Scan(&b.ID, &b.CreatedAt)
	if err != nil {
		return fmt.Errorf("creating consistency barrier: %w", err)
	}
	return nil
}

const barrierColumns = `
id, tenant_id, group_id, recovery_point_id, consistency_level, provider,
barrier_lsn, success, quiesced, thawed, detail, error, requested_by,
quiesce_started_at, quiesce_finished_at, thaw_started_at, thaw_finished_at, created_at`

func scanBarrier(row interface{ Scan(...any) error }) (*Barrier, error) {
	var b Barrier
	if err := row.Scan(
		&b.ID, &b.TenantID, &b.GroupID, &b.RecoveryPointID, &b.ConsistencyLevel, &b.Provider,
		&b.BarrierLSN, &b.Success, &b.Quiesced, &b.Thawed, &b.Detail, &b.Error, &b.RequestedBy,
		&b.QuiesceStartedAt, &b.QuiesceFinishedAt, &b.ThawStartedAt, &b.ThawFinishedAt, &b.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &b, nil
}

const getBarrierSQL = `SELECT ` + barrierColumns + `
FROM dr_consistency_barrier
WHERE tenant_id = $1 AND id = $2`

// GetBarrier loads one barrier scoped to the tenant.
func (Store) GetBarrier(ctx context.Context, db repository.DBTX, tenantID, id string) (*Barrier, error) {
	b, err := scanBarrier(db.QueryRow(ctx, getBarrierSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("barrier %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("loading barrier %s: %w", id, err)
	}
	return b, nil
}

const listBarriersByGroupSQL = `SELECT ` + barrierColumns + `
FROM dr_consistency_barrier
WHERE tenant_id = $1 AND group_id = $2
ORDER BY created_at DESC, id DESC`

// ListBarriersByGroup returns a consistency group's barrier history, newest first.
func (Store) ListBarriersByGroup(ctx context.Context, db repository.DBTX, tenantID, groupID string) ([]*Barrier, error) {
	rows, err := db.Query(ctx, listBarriersByGroupSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("listing consistency barriers: %w", err)
	}
	defer rows.Close()

	var barriers []*Barrier
	for rows.Next() {
		b, err := scanBarrier(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning consistency barrier: %w", err)
		}
		barriers = append(barriers, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading consistency barriers: %w", err)
	}
	return barriers, nil
}
