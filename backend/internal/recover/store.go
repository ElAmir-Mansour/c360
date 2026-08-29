package recover

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// Activation is the persisted record that a tenant has activated (or
// deactivated) one Recover sub-solution. This is the productization layer's own
// per-tenant state — distinct from licensing entitlement, which lives in the
// licensing engine. A sub-solution can be licensed (entitled) but not yet
// activated by the tenant; activation is what onboarding (Prompt 9) writes.
type Activation struct {
	SubSolution string    `json:"sub_solution"`
	Activated   bool      `json:"activated"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TenantRunner runs a function in a tenant-scoped transaction. RunReadWithTenant
// is read-only (RLS-enforced); RunWithTenant is read-write. Both set
// app.current_tenant_id so the recover_sub_solution_activation RLS policy
// isolates tenants.
type TenantRunner interface {
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner using the shared tenant
// transaction helpers, mirroring readmodel.PGXRunner.
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("recover: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("recover: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

var _ TenantRunner = PGXRunner{}

// ActivationStore persists per-tenant sub-solution activation state. The
// concrete implementation is SQL-backed; the interface keeps the service
// unit-testable without a database.
type ActivationStore interface {
	// ListActivations returns the activation rows for the tenant on db, keyed by
	// sub-solution slug. Sub-solutions with no row are absent (treated as
	// not-activated by the service).
	ListActivations(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (map[string]Activation, error)
	// SetActivation upserts one sub-solution's activation flag for the tenant.
	SetActivation(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, subSolution string, activated bool, now time.Time) error
}

// SQLActivationStore is the SQL-backed ActivationStore over
// recover_sub_solution_activation.
type SQLActivationStore struct{}

// NewActivationStore constructs the SQL activation store.
func NewActivationStore() *SQLActivationStore { return &SQLActivationStore{} }

// ListActivations reads every activation row for the tenant.
func (s *SQLActivationStore) ListActivations(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (map[string]Activation, error) {
	rows, err := db.Query(ctx,
		`SELECT sub_solution, activated, updated_at
		   FROM recover_sub_solution_activation
		  WHERE tenant_id = $1`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]Activation)
	for rows.Next() {
		var a Activation
		if err := rows.Scan(&a.SubSolution, &a.Activated, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out[a.SubSolution] = a
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// SetActivation upserts the activation flag for one (tenant, sub-solution).
func (s *SQLActivationStore) SetActivation(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, subSolution string, activated bool, now time.Time) error {
	_, err := db.Exec(ctx,
		`INSERT INTO recover_sub_solution_activation (tenant_id, sub_solution, activated, created_at, updated_at)
		      VALUES ($1, $2, $3, $4, $4)
		 ON CONFLICT (tenant_id, sub_solution)
		 DO UPDATE SET activated = EXCLUDED.activated,
		               updated_at = EXCLUDED.updated_at`,
		tenantID, subSolution, activated, now)
	return err
}

var _ ActivationStore = (*SQLActivationStore)(nil)
