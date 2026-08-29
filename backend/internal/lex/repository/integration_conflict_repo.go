package repository

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// IntegrationConflictRepository owns the integration conflict-resolution queue
// (lex_integration_conflicts, extensibility #20). A Reconcile pass writes one OPEN
// conflict row per field-level divergence it finds between a source record and its
// lex counterpart; an operator lists and resolves them. Rows are tenant-scoped
// (tenant_id FIRST + table FORCE RLS as a backstop) and carry only non-sensitive
// identifiers + the diverging values (no secret material).
//
// It mirrors the SyncLedger / IntegrationDLQRepository idiom: a thin repository over
// the shared pgx pool importing only stdlib + driver (no service-layer types), so it
// avoids an import cycle with service/integration. The storage row type is the twin
// of the service-layer integration.Conflict; the service maps between the two.
type IntegrationConflictRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewIntegrationConflictRepository builds the repository over the pool.
func NewIntegrationConflictRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationConflictRepository {
	return &IntegrationConflictRepository{db: db, logger: logger}
}

// Conflict status values (lex_integration_conflicts.status domain). Mirrors the
// CHECK constraint in the migration.
const (
	ConflictStatusOpen     = "open"
	ConflictStatusResolved = "resolved"
)

// IntegrationConflictRow is the persisted shape of one conflict row. It is the
// storage twin of integration.Conflict; the service layer maps between the two.
type IntegrationConflictRow struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	EndpointID  uuid.UUID
	ExternalID  string
	Field       string
	SourceValue string
	LexValue    string
	Status      string
	Resolution  string
	Suggested   string
	DetectedAt  time.Time
	ResolvedAt  *time.Time
	ResolvedBy  *uuid.UUID
}

// Upsert records (or refreshes) one OPEN conflict for a (tenant, endpoint,
// external_id, field). A re-detection of the same still-open conflict refreshes the
// diverging values + suggested resolution and bumps detected_at, but a conflict an
// operator already RESOLVED is left untouched (idempotent re-reconcile). It returns
// whether a row was newly inserted.
func (r *IntegrationConflictRepository) Upsert(ctx context.Context, row *IntegrationConflictRow) (created bool, err error) {
	if row.ID == uuid.Nil {
		row.ID = uuid.New()
	}
	if row.DetectedAt.IsZero() {
		row.DetectedAt = time.Now().UTC()
	}
	if row.Status == "" {
		row.Status = ConflictStatusOpen
	}
	const q = `
		INSERT INTO lex_integration_conflicts (
			id, tenant_id, endpoint_id, external_id, field,
			source_value, lex_value, status, resolution, suggested, detected_at
		) VALUES (
			$1,$2,$3,$4,$5,
			$6,$7,$8,$9,$10,$11
		)
		ON CONFLICT (tenant_id, endpoint_id, external_id, field)
		DO UPDATE SET
			source_value = EXCLUDED.source_value,
			lex_value    = EXCLUDED.lex_value,
			suggested    = EXCLUDED.suggested,
			detected_at  = EXCLUDED.detected_at
		WHERE lex_integration_conflicts.status = 'open'
		RETURNING (xmax = 0) AS inserted`
	err = r.db.QueryRow(ctx, q,
		row.ID, row.TenantID, row.EndpointID, strings.TrimSpace(row.ExternalID), strings.TrimSpace(row.Field),
		row.SourceValue, row.LexValue, row.Status, row.Resolution, row.Suggested, row.DetectedAt.UTC(),
	).Scan(&created)
	if err == pgx.ErrNoRows {
		// The WHERE on the DO UPDATE excluded an already-resolved row: it exists, was
		// not inserted, and must not be reopened. Treat as a no-op success.
		return false, nil
	}
	return created, err
}

// List returns conflicts for an endpoint (tenant-scoped), newest first. When status
// is non-empty it filters to that status; otherwise all statuses are returned.
func (r *IntegrationConflictRepository) List(ctx context.Context, tenantID, endpointID uuid.UUID, status string, limit int) ([]IntegrationConflictRow, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	args := []any{tenantID, endpointID}
	where := "tenant_id = $1 AND endpoint_id = $2"
	if s := strings.TrimSpace(status); s != "" {
		where += " AND status = $3"
		args = append(args, s)
	}
	args = append(args, limit)
	q := `
		SELECT id, tenant_id, endpoint_id, external_id, field,
		       source_value, lex_value, status, COALESCE(resolution, ''), COALESCE(suggested, ''),
		       detected_at, resolved_at, resolved_by
		FROM lex_integration_conflicts
		WHERE ` + where + `
		ORDER BY detected_at DESC
		LIMIT $` + itoa(len(args))
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]IntegrationConflictRow, 0)
	for rows.Next() {
		row, err := scanConflict(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Get returns one conflict by id (tenant-scoped), or pgx.ErrNoRows when absent.
func (r *IntegrationConflictRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*IntegrationConflictRow, error) {
	const q = `
		SELECT id, tenant_id, endpoint_id, external_id, field,
		       source_value, lex_value, status, COALESCE(resolution, ''), COALESCE(suggested, ''),
		       detected_at, resolved_at, resolved_by
		FROM lex_integration_conflicts
		WHERE tenant_id = $1 AND id = $2`
	row, err := scanConflict(r.db.QueryRow(ctx, q, tenantID, id))
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Resolve marks a conflict resolved with the chosen resolution + resolver/time. It
// is tenant-scoped and only flips an OPEN row, returning pgx.ErrNoRows when no open
// row matches (already resolved, or not found).
func (r *IntegrationConflictRepository) Resolve(ctx context.Context, tenantID, id uuid.UUID, resolution string, resolvedBy uuid.UUID, at time.Time) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE lex_integration_conflicts
		SET status = 'resolved', resolution = $3, resolved_by = $4, resolved_at = $5
		WHERE tenant_id = $1 AND id = $2 AND status = 'open'`,
		tenantID, id, strings.TrimSpace(resolution), resolvedBy, at.UTC())
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CountOpen returns the number of OPEN conflicts for an endpoint (tenant-scoped),
// for the console banner badge.
func (r *IntegrationConflictRepository) CountOpen(ctx context.Context, tenantID, endpointID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM lex_integration_conflicts WHERE tenant_id = $1 AND endpoint_id = $2 AND status = 'open'`,
		tenantID, endpointID).Scan(&n)
	return n, err
}

func scanConflict(row pgx.Row) (IntegrationConflictRow, error) {
	var c IntegrationConflictRow
	err := row.Scan(
		&c.ID, &c.TenantID, &c.EndpointID, &c.ExternalID, &c.Field,
		&c.SourceValue, &c.LexValue, &c.Status, &c.Resolution, &c.Suggested,
		&c.DetectedAt, &c.ResolvedAt, &c.ResolvedBy,
	)
	return c, err
}
