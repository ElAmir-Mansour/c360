package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// IntegrationMetricsRepository owns lex_integration_call_metrics (observability
// feature #16). The registry appends one row per dispatched TestConnection /
// SyncNow / Invoke with {op, latency_ms, ok, occurred_at}; the row carries NO
// payload and NO secrets — only a non-sensitive operation label + timing — so a
// call-metrics row can never leak a credential. Rows are tenant-scoped (tenant_id
// FIRST + table FORCE RLS as a backstop) and BOUNDED by a time window on every
// read plus a retention sweep (PruneOlderThan) so the table never grows
// unbounded.
//
// It deliberately mirrors the IntegrationDLQRepository / SyncLedger idiom: a thin
// repository over the shared pgx pool importing only stdlib + driver (no
// service-layer types, avoiding an import cycle with service/integration). The
// aggregate queries use Postgres percentile_cont for p50/p95 latency.
type IntegrationMetricsRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewIntegrationMetricsRepository builds the repository over the pool.
func NewIntegrationMetricsRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationMetricsRepository {
	return &IntegrationMetricsRepository{db: db, logger: logger}
}

// IntegrationCallMetric is the persisted shape of one call-metrics row.
type IntegrationCallMetric struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	EndpointID uuid.UUID
	Op         string
	LatencyMs  int
	OK         bool
	OccurredAt time.Time
}

// CallAggregate is the windowed aggregate over an endpoint's call-metrics rows:
// total calls, errored calls, and the percentile_cont p50/p95 latency. The
// service derives error_rate + SLO breach from it.
type CallAggregate struct {
	Calls        int64
	Errors       int64
	LatencyP50Ms float64
	LatencyP95Ms float64
}

// OpAggregate is the per-operation breakdown row (op, calls, errors, p95).
type OpAggregate struct {
	Op           string
	Calls        int64
	Errors       int64
	LatencyP95Ms float64
}

// EndpointAggregate is one row of the tenant rollup: the windowed aggregate keyed
// by endpoint (the overview joins it to endpoint identity in the service layer).
type EndpointAggregate struct {
	EndpointID   uuid.UUID
	Calls        int64
	Errors       int64
	LatencyP95Ms float64
}

// Record appends one call-metrics row. The caller sets TenantID, EndpointID, Op,
// LatencyMs, OK; ID and OccurredAt default when zero. It is append-only and
// tenant-scoped.
func (r *IntegrationMetricsRepository) Record(ctx context.Context, m *IntegrationCallMetric) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("lex/integration: metrics repository has no database")
	}
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.OccurredAt.IsZero() {
		m.OccurredAt = time.Now().UTC()
	}
	const q = `
		INSERT INTO lex_integration_call_metrics (
			id, tenant_id, endpoint_id, op, latency_ms, ok, occurred_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := r.db.Exec(ctx, q,
		m.ID, m.TenantID, m.EndpointID, m.Op, m.LatencyMs, m.OK, m.OccurredAt.UTC())
	return err
}

// Aggregate returns the windowed total aggregate for ONE endpoint: count, error
// count, and percentile_cont p50/p95 latency over rows since `since`. Zero rows
// yield a zero aggregate (the service then reports 0 calls / 0 error-rate).
func (r *IntegrationMetricsRepository) Aggregate(ctx context.Context, tenantID, endpointID uuid.UUID, since time.Time) (CallAggregate, error) {
	if r == nil || r.db == nil {
		return CallAggregate{}, fmt.Errorf("lex/integration: metrics repository has no database")
	}
	const q = `
		SELECT
			COUNT(*)::bigint                                                   AS calls,
			COALESCE(SUM(CASE WHEN ok THEN 0 ELSE 1 END), 0)::bigint          AS errors,
			COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0) AS p50,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95
		FROM lex_integration_call_metrics
		WHERE tenant_id = $1 AND endpoint_id = $2 AND occurred_at >= $3`
	var out CallAggregate
	err := r.db.QueryRow(ctx, q, tenantID, endpointID, since.UTC()).
		Scan(&out.Calls, &out.Errors, &out.LatencyP50Ms, &out.LatencyP95Ms)
	return out, err
}

// AggregateByOp returns the per-operation breakdown for ONE endpoint over the
// window (op, calls, errors, percentile_cont p95), highest-traffic op first.
func (r *IntegrationMetricsRepository) AggregateByOp(ctx context.Context, tenantID, endpointID uuid.UUID, since time.Time) ([]OpAggregate, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: metrics repository has no database")
	}
	const q = `
		SELECT
			op,
			COUNT(*)::bigint                                                   AS calls,
			COALESCE(SUM(CASE WHEN ok THEN 0 ELSE 1 END), 0)::bigint          AS errors,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95
		FROM lex_integration_call_metrics
		WHERE tenant_id = $1 AND endpoint_id = $2 AND occurred_at >= $3
		GROUP BY op
		ORDER BY calls DESC, op ASC`
	rows, err := r.db.Query(ctx, q, tenantID, endpointID, since.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]OpAggregate, 0)
	for rows.Next() {
		var o OpAggregate
		if err := rows.Scan(&o.Op, &o.Calls, &o.Errors, &o.LatencyP95Ms); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// AggregateByEndpoint returns the tenant rollup: one windowed aggregate per
// endpoint (endpoint_id, calls, errors, percentile_cont p95), highest-traffic
// first. The service joins each row to endpoint identity (kind/name) for the
// overview response.
func (r *IntegrationMetricsRepository) AggregateByEndpoint(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]EndpointAggregate, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("lex/integration: metrics repository has no database")
	}
	const q = `
		SELECT
			endpoint_id,
			COUNT(*)::bigint                                                   AS calls,
			COALESCE(SUM(CASE WHEN ok THEN 0 ELSE 1 END), 0)::bigint          AS errors,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95
		FROM lex_integration_call_metrics
		WHERE tenant_id = $1 AND occurred_at >= $2
		GROUP BY endpoint_id
		ORDER BY calls DESC`
	rows, err := r.db.Query(ctx, q, tenantID, since.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]EndpointAggregate, 0)
	for rows.Next() {
		var e EndpointAggregate
		if err := rows.Scan(&e.EndpointID, &e.Calls, &e.Errors, &e.LatencyP95Ms); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// PruneOlderThan deletes call-metrics rows older than `before` for a tenant,
// bounding the table (retention sweep). It is tenant-scoped; the caller runs it
// on a cadence with the longest dashboard window as the cutoff. Returns the
// number of rows deleted.
func (r *IntegrationMetricsRepository) PruneOlderThan(ctx context.Context, tenantID uuid.UUID, before time.Time) (int64, error) {
	if r == nil || r.db == nil {
		return 0, fmt.Errorf("lex/integration: metrics repository has no database")
	}
	ct, err := r.db.Exec(ctx,
		`DELETE FROM lex_integration_call_metrics WHERE tenant_id = $1 AND occurred_at < $2`,
		tenantID, before.UTC())
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}
