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

// IntegrationDLQRepository owns the integration dead-letter queue
// (lex_integration_dlq, reliability feature #11). Every FAILED integration
// operation the registry dispatches — a Sync / Invoke / TestConnection dispatch,
// or a verified-but-failed inbound webhook handling — appends one row here so the
// admin console can list and REPLAY it. Rows are tenant-scoped (tenant_id FIRST +
// table FORCE RLS as a backstop) and carry only a REDACTED payload + a sanitized
// error message; the DLQ SERVICE strips secrets from the payload before it ever
// reaches this repository, so cleartext credentials are NEVER persisted here.
//
// It deliberately mirrors the SyncLedger / IntegrationHealthRepository idiom: a
// thin repository over the shared pgx pool, an append-only Record, tenant-scoped
// List/Get, and lifecycle status mutators. The storage row type is the twin of the
// service-layer integration.DeadLetter so the repository imports only stdlib +
// driver (no service-layer types, avoiding an import cycle with service/integration).
type IntegrationDLQRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewIntegrationDLQRepository builds the repository over the pool.
func NewIntegrationDLQRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationDLQRepository {
	return &IntegrationDLQRepository{db: db, logger: logger}
}

// DLQ lifecycle status values (lex_integration_dlq.status domain). Mirrors the
// CHECK constraint in the migration.
const (
	DLQStatusFailed   = "failed"
	DLQStatusReplayed = "replayed"
	DLQStatusResolved = "resolved"
)

// IntegrationDLQRow is the persisted shape of one dead-letter row. It is the
// storage twin of integration.DeadLetter; the service layer maps between the two.
// Payload is the REDACTED operation payload (secrets already stripped upstream).
type IntegrationDLQRow struct {
	ID            uuid.UUID
	TenantID      uuid.UUID
	EndpointID    uuid.UUID
	Source        string
	Summary       string
	Payload       map[string]any
	Error         string
	Attempts      int
	Status        string
	CreatedAt     time.Time
	LastAttemptAt *time.Time
}

const dlqSelectColumns = `
	id, tenant_id, endpoint_id, source, summary,
	COALESCE(payload, '{}'::jsonb), COALESCE(error, ''),
	attempts, status, created_at, last_attempt_at`

// Record appends one dead-letter row. The caller sets TenantID, EndpointID,
// Source, Summary, Payload (already redacted), Error and (optionally) Attempts;
// ID and CreatedAt default when zero, Status defaults to 'failed'. Returns the
// assigned ID + CreatedAt on the row.
func (r *IntegrationDLQRepository) Record(ctx context.Context, row *IntegrationDLQRow) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: dlq repository has no database")
	}
	if row.ID == uuid.Nil {
		row.ID = uuid.New()
	}
	if strings.TrimSpace(row.Status) == "" {
		row.Status = DLQStatusFailed
	}
	payloadJSON, err := json.Marshal(orEmptyMap(row.Payload))
	if err != nil {
		return fmt.Errorf("lex/integration: marshal dlq payload: %w", err)
	}
	const q = `
		INSERT INTO lex_integration_dlq (
			id, tenant_id, endpoint_id, source, summary, payload, error, attempts, status, last_attempt_at
		) VALUES (
			$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10
		)
		RETURNING created_at`
	return r.db.QueryRow(ctx, q,
		row.ID, row.TenantID, row.EndpointID, row.Source, row.Summary,
		payloadJSON, row.Error, row.Attempts, row.Status, row.LastAttemptAt,
	).Scan(&row.CreatedAt)
}

// Get loads one dead-letter row by id (tenant-scoped). Returns pgx.ErrNoRows when
// absent for the tenant.
func (r *IntegrationDLQRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*IntegrationDLQRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: dlq repository has no database")
	}
	row := r.db.QueryRow(ctx,
		`SELECT `+dlqSelectColumns+` FROM lex_integration_dlq WHERE tenant_id = $1 AND id = $2`,
		tenantID, id)
	return r.scan(row)
}

// ListByEndpoint returns the dead-letter rows for one endpoint (tenant-scoped),
// newest first, capped at limit (defaulted to 100, clamped to 1..500). An empty
// status returns all statuses; a non-empty status filters to it.
func (r *IntegrationDLQRepository) ListByEndpoint(ctx context.Context, tenantID, endpointID uuid.UUID, status string, limit int) ([]IntegrationDLQRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: dlq repository has no database")
	}
	limit = clampDLQLimit(limit)
	args := []any{tenantID, endpointID}
	where := "tenant_id = $1 AND endpoint_id = $2"
	if s := strings.TrimSpace(status); s != "" {
		args = append(args, s)
		where += fmt.Sprintf(" AND status = $%d", len(args))
	}
	args = append(args, limit)
	q := `SELECT ` + dlqSelectColumns + ` FROM lex_integration_dlq WHERE ` + where +
		fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d`, len(args))
	return r.queryRows(ctx, q, args...)
}

// ListByTenant returns the dead-letter rows ACROSS every endpoint for a tenant,
// newest first, capped at limit. An empty status returns all statuses.
func (r *IntegrationDLQRepository) ListByTenant(ctx context.Context, tenantID uuid.UUID, status string, limit int) ([]IntegrationDLQRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: dlq repository has no database")
	}
	limit = clampDLQLimit(limit)
	args := []any{tenantID}
	where := "tenant_id = $1"
	if s := strings.TrimSpace(status); s != "" {
		args = append(args, s)
		where += fmt.Sprintf(" AND status = $%d", len(args))
	}
	args = append(args, limit)
	q := `SELECT ` + dlqSelectColumns + ` FROM lex_integration_dlq WHERE ` + where +
		fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d`, len(args))
	return r.queryRows(ctx, q, args...)
}

// ListFailedForEndpoint returns every row still in the 'failed' state for an
// endpoint (tenant-scoped, oldest first so a batch replay processes them in the
// order they failed). It backs ReplayFailed.
func (r *IntegrationDLQRepository) ListFailedForEndpoint(ctx context.Context, tenantID, endpointID uuid.UUID) ([]IntegrationDLQRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: dlq repository has no database")
	}
	q := `SELECT ` + dlqSelectColumns + `
		FROM lex_integration_dlq
		WHERE tenant_id = $1 AND endpoint_id = $2 AND status = $3
		ORDER BY created_at ASC`
	return r.queryRows(ctx, q, tenantID, endpointID, DLQStatusFailed)
}

// MarkAttempt increments the attempt counter, stamps last_attempt_at, and sets the
// status (typically replayed on success, or back to failed on a re-failure). It is
// tenant-scoped; pgx.ErrNoRows reports the row was absent for the tenant.
func (r *IntegrationDLQRepository) MarkAttempt(ctx context.Context, tenantID, id uuid.UUID, status string, attemptAt time.Time) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: dlq repository has no database")
	}
	ct, err := r.db.Exec(ctx,
		`UPDATE lex_integration_dlq
		    SET attempts = attempts + 1, status = $3, last_attempt_at = $4
		  WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, status, attemptAt.UTC())
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *IntegrationDLQRepository) queryRows(ctx context.Context, q string, args ...any) ([]IntegrationDLQRow, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]IntegrationDLQRow, 0)
	for rows.Next() {
		row, err := r.scanRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *row)
	}
	return out, rows.Err()
}

func (r *IntegrationDLQRepository) scan(row pgx.Row) (*IntegrationDLQRow, error) {
	var (
		out        IntegrationDLQRow
		payloadRaw []byte
	)
	if err := row.Scan(
		&out.ID, &out.TenantID, &out.EndpointID, &out.Source, &out.Summary,
		&payloadRaw, &out.Error, &out.Attempts, &out.Status, &out.CreatedAt, &out.LastAttemptAt,
	); err != nil {
		return nil, err
	}
	out.Payload = unmarshalDLQPayload(payloadRaw)
	return &out, nil
}

func (r *IntegrationDLQRepository) scanRows(rows pgx.Rows) (*IntegrationDLQRow, error) {
	var (
		out        IntegrationDLQRow
		payloadRaw []byte
	)
	if err := rows.Scan(
		&out.ID, &out.TenantID, &out.EndpointID, &out.Source, &out.Summary,
		&payloadRaw, &out.Error, &out.Attempts, &out.Status, &out.CreatedAt, &out.LastAttemptAt,
	); err != nil {
		return nil, err
	}
	out.Payload = unmarshalDLQPayload(payloadRaw)
	return &out, nil
}

func unmarshalDLQPayload(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out
}

func clampDLQLimit(limit int) int {
	if limit <= 0 {
		return 100
	}
	if limit > 500 {
		return 500
	}
	return limit
}
