package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// IntegrationGovernanceRepository owns lex_integration_pending_changes (#13
// maker-checker). Every PROPOSED configuration change to a PROTECTED integration
// endpoint (an active production endpoint, or any gov-gated kind) is parked here
// (status=pending) until a second operator approves or rejects it. Rows are
// tenant-scoped (tenant_id FIRST + table FORCE RLS as a backstop).
//
// SECRET CUSTODY. proposed_config holds the operator-submitted config map (a
// secret field whose value is the redaction sentinel carries NO cleartext); the
// diff column is the human-facing before/after, MASKED for secrets by the
// governance service BEFORE it ever reaches this repository. Cleartext credentials
// are NEVER persisted here.
//
// It deliberately mirrors the IntegrationDLQRepository idiom: a thin repository
// over the shared pgx pool, an append-only Create, tenant-scoped Get/List, and a
// review (approve/reject) mutator. The storage row type is the twin of the
// service-layer integration.PendingChange, so the repository imports only stdlib +
// driver (no service-layer types, avoiding an import cycle with service/integration).
type IntegrationGovernanceRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewIntegrationGovernanceRepository builds the repository over the pool.
func NewIntegrationGovernanceRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationGovernanceRepository {
	return &IntegrationGovernanceRepository{db: db, logger: logger}
}

// Pending-change lifecycle status values (lex_integration_pending_changes.status
// domain). Mirrors the CHECK constraint in the migration.
const (
	PendingChangeStatusPending  = "pending"
	PendingChangeStatusApproved = "approved"
	PendingChangeStatusRejected = "rejected"
)

// IntegrationPendingChangeRow is the persisted shape of one pending-change row. It
// is the storage twin of integration.PendingChange; the service layer maps between
// the two. ProposedConfig is the operator-submitted config map (secrets carried as
// the sentinel only); Diff is the secret-MASKED before/after list.
type IntegrationPendingChangeRow struct {
	ID             uuid.UUID
	TenantID       uuid.UUID
	EndpointID     uuid.UUID
	ProposedConfig map[string]any
	Diff           []map[string]any
	RequestedBy    uuid.UUID
	RequestedAt    time.Time
	Status         string
	Reviewer       *uuid.UUID
	ReviewedAt     *time.Time
	Note           string
}

const pendingChangeSelectColumns = `
	id, tenant_id, endpoint_id,
	COALESCE(proposed_config, '{}'::jsonb), COALESCE(diff, '[]'::jsonb),
	requested_by, requested_at, status, reviewer, reviewed_at, COALESCE(note, '')`

// Create appends one pending-change row. The caller sets TenantID, EndpointID,
// ProposedConfig (secrets as the sentinel only), Diff (secret-masked), RequestedBy
// and (optionally) Note; ID defaults when zero, RequestedAt defaults to now(),
// Status defaults to 'pending'. Returns the assigned ID + RequestedAt on the row.
func (r *IntegrationGovernanceRepository) Create(ctx context.Context, row *IntegrationPendingChangeRow) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: governance repository has no database")
	}
	if row.ID == uuid.Nil {
		row.ID = uuid.New()
	}
	if strings.TrimSpace(row.Status) == "" {
		row.Status = PendingChangeStatusPending
	}
	configJSON, err := json.Marshal(orEmptyMap(row.ProposedConfig))
	if err != nil {
		return fmt.Errorf("lex/integration: marshal pending-change config: %w", err)
	}
	diffJSON, err := json.Marshal(orEmptyDiff(row.Diff))
	if err != nil {
		return fmt.Errorf("lex/integration: marshal pending-change diff: %w", err)
	}
	const q = `
		INSERT INTO lex_integration_pending_changes (
			id, tenant_id, endpoint_id, proposed_config, diff, requested_by, status, note
		) VALUES (
			$1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8
		)
		RETURNING requested_at`
	return r.db.QueryRow(ctx, q,
		row.ID, row.TenantID, row.EndpointID, configJSON, diffJSON, row.RequestedBy, row.Status, row.Note,
	).Scan(&row.RequestedAt)
}

// Get loads one pending-change row by id (tenant-scoped). Returns pgx.ErrNoRows
// when absent for the tenant.
func (r *IntegrationGovernanceRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*IntegrationPendingChangeRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: governance repository has no database")
	}
	row := r.db.QueryRow(ctx,
		`SELECT `+pendingChangeSelectColumns+` FROM lex_integration_pending_changes WHERE tenant_id = $1 AND id = $2`,
		tenantID, id)
	return r.scan(row)
}

// List returns the pending-change rows for a tenant (optionally filtered by status
// and/or endpoint), newest first, capped at limit (defaulted to 100, clamped to
// 1..500). An empty status returns all statuses; a nil endpointID returns all
// endpoints.
func (r *IntegrationGovernanceRepository) List(ctx context.Context, tenantID uuid.UUID, endpointID *uuid.UUID, status string, limit int) ([]IntegrationPendingChangeRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: governance repository has no database")
	}
	limit = clampDLQLimit(limit)
	args := []any{tenantID}
	where := "tenant_id = $1"
	if endpointID != nil {
		args = append(args, *endpointID)
		where += fmt.Sprintf(" AND endpoint_id = $%d", len(args))
	}
	if s := strings.TrimSpace(status); s != "" {
		args = append(args, s)
		where += fmt.Sprintf(" AND status = $%d", len(args))
	}
	args = append(args, limit)
	q := `SELECT ` + pendingChangeSelectColumns + ` FROM lex_integration_pending_changes WHERE ` + where +
		fmt.Sprintf(` ORDER BY requested_at DESC LIMIT $%d`, len(args))
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]IntegrationPendingChangeRow, 0)
	for rows.Next() {
		row, err := r.scanRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *row)
	}
	return out, rows.Err()
}

// Review transitions a pending row to approved/rejected, stamping the reviewer +
// reviewed_at + note. It only mutates a row still in 'pending' (the WHERE clause
// guards against a double review / a race), so a no-rows result reports the row was
// absent OR already reviewed for the tenant — the service maps that to a conflict.
func (r *IntegrationGovernanceRepository) Review(ctx context.Context, tenantID, id, reviewer uuid.UUID, status, note string, reviewedAt time.Time) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: governance repository has no database")
	}
	ct, err := r.db.Exec(ctx,
		`UPDATE lex_integration_pending_changes
		    SET status = $3, reviewer = $4, reviewed_at = $5, note = $6
		  WHERE tenant_id = $1 AND id = $2 AND status = $7`,
		tenantID, id, status, reviewer, reviewedAt.UTC(), note, PendingChangeStatusPending)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *IntegrationGovernanceRepository) scan(row pgx.Row) (*IntegrationPendingChangeRow, error) {
	var (
		out       IntegrationPendingChangeRow
		configRaw []byte
		diffRaw   []byte
	)
	if err := row.Scan(
		&out.ID, &out.TenantID, &out.EndpointID, &configRaw, &diffRaw,
		&out.RequestedBy, &out.RequestedAt, &out.Status, &out.Reviewer, &out.ReviewedAt, &out.Note,
	); err != nil {
		return nil, err
	}
	out.ProposedConfig = unmarshalPendingConfig(configRaw)
	out.Diff = unmarshalPendingDiff(diffRaw)
	return &out, nil
}

func (r *IntegrationGovernanceRepository) scanRows(rows pgx.Rows) (*IntegrationPendingChangeRow, error) {
	var (
		out       IntegrationPendingChangeRow
		configRaw []byte
		diffRaw   []byte
	)
	if err := rows.Scan(
		&out.ID, &out.TenantID, &out.EndpointID, &configRaw, &diffRaw,
		&out.RequestedBy, &out.RequestedAt, &out.Status, &out.Reviewer, &out.ReviewedAt, &out.Note,
	); err != nil {
		return nil, err
	}
	out.ProposedConfig = unmarshalPendingConfig(configRaw)
	out.Diff = unmarshalPendingDiff(diffRaw)
	return &out, nil
}

func unmarshalPendingConfig(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out
}

func unmarshalPendingDiff(raw []byte) []map[string]any {
	out := []map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

func orEmptyDiff(d []map[string]any) []map[string]any {
	if d == nil {
		return []map[string]any{}
	}
	return d
}
