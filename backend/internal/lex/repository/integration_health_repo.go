package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// IntegrationHealthRepository owns the append-only health-check history ledger
// (lex_integration_health_checks, feature 6). Every connector Probe/Test
// dispatched by the registry persists one row here so the integration admin
// console can render a per-endpoint uptime sparkline (grade + reachability
// timeline). Rows are tenant-scoped (tenant_id FIRST + table RLS as a backstop)
// and carry only non-sensitive diagnostics — Detail is the operator-safe message
// the adapter already sanitized; secrets are NEVER written here.
//
// It deliberately mirrors the SyncLedger idiom (service/integration/sync_ledger.go):
// a thin repository over the shared pgx pool, an append-only Record, and a
// newest-first List for the timeline. There is no soft-delete (append-only
// history; the table CASCADE-deletes with its endpoint).
type IntegrationHealthRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewIntegrationHealthRepository builds the repository over the pool.
func NewIntegrationHealthRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationHealthRepository {
	return &IntegrationHealthRepository{db: db, logger: logger}
}

// IntegrationHealthCheckRow is the persisted shape of one health-check ledger row.
// It is the storage twin of integration.HealthCheckRecord; the service layer maps
// between the two so the repository imports only stdlib + driver (no service-layer
// types, avoiding an import cycle with service/integration).
type IntegrationHealthCheckRow struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	EndpointID uuid.UUID
	Grade      string
	Reachable  bool
	Detail     string
	CheckedAt  time.Time
}

// Record appends one health-check row. The caller sets TenantID, EndpointID,
// Grade, Reachable and Detail; ID and CheckedAt default when zero. Detail must
// already be sanitized (operator-safe, secret-free). Returns the assigned ID and
// CheckedAt.
func (r *IntegrationHealthRepository) Record(ctx context.Context, row *IntegrationHealthCheckRow) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: health repository has no database")
	}
	if row.ID == uuid.Nil {
		row.ID = uuid.New()
	}
	if row.CheckedAt.IsZero() {
		row.CheckedAt = time.Now().UTC()
	}
	const q = `
		INSERT INTO lex_integration_health_checks (
			id, tenant_id, endpoint_id, grade, reachable, detail, checked_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7
		)`
	_, err := r.db.Exec(ctx, q,
		row.ID, row.TenantID, row.EndpointID, row.Grade, row.Reachable, row.Detail, row.CheckedAt.UTC(),
	)
	return err
}

// List returns the most recent health-check rows for an endpoint (tenant-scoped),
// newest first, capped at limit (defaulted to 50, clamped to 1..500). It powers
// the uptime sparkline / health timeline in the admin console.
func (r *IntegrationHealthRepository) List(ctx context.Context, tenantID, endpointID uuid.UUID, limit int) ([]IntegrationHealthCheckRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: health repository has no database")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	const q = `
		SELECT id, tenant_id, endpoint_id, grade, reachable, COALESCE(detail, ''), checked_at
		FROM lex_integration_health_checks
		WHERE tenant_id = $1 AND endpoint_id = $2
		ORDER BY checked_at DESC
		LIMIT $3`
	rows, err := r.db.Query(ctx, q, tenantID, endpointID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]IntegrationHealthCheckRow, 0, limit)
	for rows.Next() {
		var row IntegrationHealthCheckRow
		if err := rows.Scan(
			&row.ID, &row.TenantID, &row.EndpointID, &row.Grade, &row.Reachable, &row.Detail, &row.CheckedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Latest returns the single most recent health-check row for an endpoint, or
// (nil, nil) when no probe has ever been recorded. It is the cheap read the
// degrade-transition detector uses: comparing the previously-recorded grade with
// the freshly-computed one lets the recorder fire a degrade alert exactly ONCE per
// healthy→unhealthy transition (idempotent — not on every probe tick) without a
// separate dedup table.
func (r *IntegrationHealthRepository) Latest(ctx context.Context, tenantID, endpointID uuid.UUID) (*IntegrationHealthCheckRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: health repository has no database")
	}
	const q = `
		SELECT id, tenant_id, endpoint_id, grade, reachable, COALESCE(detail, ''), checked_at
		FROM lex_integration_health_checks
		WHERE tenant_id = $1 AND endpoint_id = $2
		ORDER BY checked_at DESC
		LIMIT 1`
	var row IntegrationHealthCheckRow
	err := r.db.QueryRow(ctx, q, tenantID, endpointID).Scan(
		&row.ID, &row.TenantID, &row.EndpointID, &row.Grade, &row.Reachable, &row.Detail, &row.CheckedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}
