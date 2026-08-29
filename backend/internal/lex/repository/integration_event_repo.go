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

// IntegrationEventRepository owns lex_integration_events (observability feature
// #17, the inbound-event inspector + replay). Every verified INBOUND event a
// webhook accepts (and every synthetic/test loop) appends one row carrying the
// kind, signature_valid flag, lifecycle status (received | processed | failed),
// the resulting lex action, a REDACTED jsonb payload, and a sanitized error. The
// EVENT-LOG SERVICE redacts the payload BEFORE it reaches this repository, so
// secrets / PII are NEVER persisted here in cleartext.
//
// It mirrors the IntegrationDLQRepository idiom: a thin repository over the
// shared pgx pool with an append-only Record, tenant-scoped Get / List
// (filterable by direction / kind / status), importing only stdlib + driver (no
// service-layer types, avoiding an import cycle with service/integration). The
// storage row is the twin of the service-layer integration.IntegrationEvent.
type IntegrationEventRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewIntegrationEventRepository builds the repository over the pool.
func NewIntegrationEventRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationEventRepository {
	return &IntegrationEventRepository{db: db, logger: logger}
}

// Integration event direction + status domains (mirror the migration CHECKs).
const (
	EventDirectionInbound  = "inbound"
	EventDirectionOutbound = "outbound"

	EventStatusReceived  = "received"
	EventStatusProcessed = "processed"
	EventStatusFailed    = "failed"
)

// IntegrationEventRow is the persisted shape of one inbound-event row. It is the
// storage twin of integration.IntegrationEvent; Payload is ALREADY REDACTED.
type IntegrationEventRow struct {
	ID             uuid.UUID
	TenantID       uuid.UUID
	EndpointID     uuid.UUID
	Direction      string
	Kind           string
	SignatureValid bool
	Status         string
	ResultAction   string
	Payload        map[string]any
	Error          string
	OccurredAt     time.Time
}

// IntegrationEventFilter is the optional filter set for List (empty fields are
// not applied). Limit defaults/clamps in the repository.
type IntegrationEventFilter struct {
	Direction string
	Kind      string
	Status    string
	Limit     int
}

const integrationEventSelectColumns = `
	id, tenant_id, endpoint_id, direction, kind, signature_valid,
	status, result_action, COALESCE(payload, '{}'::jsonb), COALESCE(error, ''), occurred_at`

// Record appends one inbound-event row. The caller sets TenantID, EndpointID,
// Direction, Kind, SignatureValid, Status, ResultAction, Payload (already
// redacted) and Error; ID and OccurredAt default when zero. Returns the assigned
// ID on the row.
func (r *IntegrationEventRepository) Record(ctx context.Context, row *IntegrationEventRow) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: event repository has no database")
	}
	if row.ID == uuid.Nil {
		row.ID = uuid.New()
	}
	if row.OccurredAt.IsZero() {
		row.OccurredAt = time.Now().UTC()
	}
	if strings.TrimSpace(row.Direction) == "" {
		row.Direction = EventDirectionInbound
	}
	if strings.TrimSpace(row.Status) == "" {
		row.Status = EventStatusReceived
	}
	payloadJSON, err := json.Marshal(orEmptyMap(row.Payload))
	if err != nil {
		return fmt.Errorf("lex/integration: marshal event payload: %w", err)
	}
	const q = `
		INSERT INTO lex_integration_events (
			id, tenant_id, endpoint_id, direction, kind, signature_valid,
			status, result_action, payload, error, occurred_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`
	_, err = r.db.Exec(ctx, q,
		row.ID, row.TenantID, row.EndpointID, row.Direction, row.Kind, row.SignatureValid,
		row.Status, row.ResultAction, payloadJSON, row.Error, row.OccurredAt.UTC())
	return err
}

// Get loads one event row by id (tenant-scoped). Returns pgx.ErrNoRows when
// absent for the tenant.
func (r *IntegrationEventRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*IntegrationEventRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: event repository has no database")
	}
	row := r.db.QueryRow(ctx,
		`SELECT `+integrationEventSelectColumns+` FROM lex_integration_events WHERE tenant_id = $1 AND id = $2`,
		tenantID, id)
	return r.scan(row)
}

// ListByEndpoint returns the event rows for ONE endpoint (tenant-scoped), newest
// first, filtered by the optional direction/kind/status, capped at the filter's
// clamped limit.
func (r *IntegrationEventRepository) ListByEndpoint(ctx context.Context, tenantID, endpointID uuid.UUID, f IntegrationEventFilter) ([]IntegrationEventRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: event repository has no database")
	}
	args := []any{tenantID, endpointID}
	where := "tenant_id = $1 AND endpoint_id = $2"
	where, args = appendEventFilters(where, args, f)
	args = append(args, clampEventLimit(f.Limit))
	q := `SELECT ` + integrationEventSelectColumns + ` FROM lex_integration_events WHERE ` + where +
		fmt.Sprintf(` ORDER BY occurred_at DESC LIMIT $%d`, len(args))
	return r.queryRows(ctx, q, args...)
}

// ListByTenant returns the event rows ACROSS every endpoint for a tenant, newest
// first, filtered by the optional direction/kind/status, capped at the clamped
// limit.
func (r *IntegrationEventRepository) ListByTenant(ctx context.Context, tenantID uuid.UUID, f IntegrationEventFilter) ([]IntegrationEventRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: event repository has no database")
	}
	args := []any{tenantID}
	where := "tenant_id = $1"
	where, args = appendEventFilters(where, args, f)
	args = append(args, clampEventLimit(f.Limit))
	q := `SELECT ` + integrationEventSelectColumns + ` FROM lex_integration_events WHERE ` + where +
		fmt.Sprintf(` ORDER BY occurred_at DESC LIMIT $%d`, len(args))
	return r.queryRows(ctx, q, args...)
}

// appendEventFilters appends the optional direction/kind/status predicates to a
// WHERE clause + arg list, returning the extended clause + args.
func appendEventFilters(where string, args []any, f IntegrationEventFilter) (string, []any) {
	if v := strings.TrimSpace(f.Direction); v != "" {
		args = append(args, v)
		where += fmt.Sprintf(" AND direction = $%d", len(args))
	}
	if v := strings.TrimSpace(f.Kind); v != "" {
		args = append(args, v)
		where += fmt.Sprintf(" AND kind = $%d", len(args))
	}
	if v := strings.TrimSpace(f.Status); v != "" {
		args = append(args, v)
		where += fmt.Sprintf(" AND status = $%d", len(args))
	}
	return where, args
}

func (r *IntegrationEventRepository) queryRows(ctx context.Context, q string, args ...any) ([]IntegrationEventRow, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]IntegrationEventRow, 0)
	for rows.Next() {
		row, err := r.scanRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *row)
	}
	return out, rows.Err()
}

func (r *IntegrationEventRepository) scan(row pgx.Row) (*IntegrationEventRow, error) {
	var (
		out        IntegrationEventRow
		payloadRaw []byte
	)
	if err := row.Scan(
		&out.ID, &out.TenantID, &out.EndpointID, &out.Direction, &out.Kind, &out.SignatureValid,
		&out.Status, &out.ResultAction, &payloadRaw, &out.Error, &out.OccurredAt,
	); err != nil {
		return nil, err
	}
	out.Payload = unmarshalEventPayload(payloadRaw)
	return &out, nil
}

func (r *IntegrationEventRepository) scanRows(rows pgx.Rows) (*IntegrationEventRow, error) {
	var (
		out        IntegrationEventRow
		payloadRaw []byte
	)
	if err := rows.Scan(
		&out.ID, &out.TenantID, &out.EndpointID, &out.Direction, &out.Kind, &out.SignatureValid,
		&out.Status, &out.ResultAction, &payloadRaw, &out.Error, &out.OccurredAt,
	); err != nil {
		return nil, err
	}
	out.Payload = unmarshalEventPayload(payloadRaw)
	return &out, nil
}

func unmarshalEventPayload(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out
}

func clampEventLimit(limit int) int {
	if limit <= 0 {
		return 100
	}
	if limit > 500 {
		return 500
	}
	return limit
}
