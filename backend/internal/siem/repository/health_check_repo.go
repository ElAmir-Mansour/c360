package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/siem/model"
)

// PgxQuerier is the minimal subset of pgx-style methods used by the
// repository. *pgxpool.Pool and pgxmock.PgxPoolIface both satisfy it
// without adapters.
type PgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// HealthCheckRepository implements minimal CRUD on siem.health_check.
type HealthCheckRepository struct {
	db PgxQuerier
}

// NewHealthCheckRepository constructs the repo. db must be non-nil at
// call time or every method returns ErrNilDB.
func NewHealthCheckRepository(db PgxQuerier) *HealthCheckRepository {
	return &HealthCheckRepository{db: db}
}

// ErrNilDB is returned when the repository is invoked without a backing
// database handle.
var ErrNilDB = errors.New("siem repository: db handle is nil")

// Insert writes a row tagged with the given tenant id and returns the
// generated UUID. DB defaults fill in the timestamp.
func (r *HealthCheckRepository) Insert(ctx context.Context, tenantID model.TenantID) (string, error) {
	if r == nil || r.db == nil {
		return "", ErrNilDB
	}
	if tenantID == "" {
		return "", fmt.Errorf("tenant id required")
	}
	id := uuid.New().String()
	const q = `INSERT INTO siem.health_check (id, tenant_id) VALUES ($1, $2)`
	tag, err := r.db.Exec(ctx, q, id, tenantID)
	if err != nil {
		return "", fmt.Errorf("siem health_check insert: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return "", fmt.Errorf("siem health_check insert: expected 1 row, got %d", tag.RowsAffected())
	}
	return id, nil
}

// CountByTenant returns the number of rows for a given tenant id. Used
// by integration tests to verify isolation, and by the readiness probe
// to confirm the schema is reachable.
func (r *HealthCheckRepository) CountByTenant(ctx context.Context, tenantID model.TenantID) (int64, error) {
	if r == nil || r.db == nil {
		return 0, ErrNilDB
	}
	const q = `SELECT count(*) FROM siem.health_check WHERE tenant_id = $1`
	var n int64
	if err := r.db.QueryRow(ctx, q, tenantID).Scan(&n); err != nil {
		return 0, fmt.Errorf("siem health_check count: %w", err)
	}
	return n, nil
}

// Ping proves we can talk to siem_db and that the siem schema exists.
// Empty result is fine — the planner still validates the schema.
func (r *HealthCheckRepository) Ping(ctx context.Context) error {
	if r == nil || r.db == nil {
		return ErrNilDB
	}
	const q = `SELECT 1 FROM siem.health_check LIMIT 1`
	var ignored int
	err := r.db.QueryRow(ctx, q).Scan(&ignored)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("siem schema ping: %w", err)
	}
	return nil
}
