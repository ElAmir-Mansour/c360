package predict

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrNotFound is returned when a tenant-scoped prediction does not exist.
var ErrNotFound = errors.New("predict: not found")

// Store persists the rolling sample series and computed predictions. It is
// owned by this package and built over repository.DBTX (the shared pgx subset),
// so a caller passes either a pool for single reads or an open transaction so a
// state change commits atomically with its outbox event.
//
// Request-path methods filter by tenant_id (RLS is the backstop). The System*
// methods read across tenants for the background forecaster loop and are
// documented "background-loop only; bypasses tenant RLS by design", mirroring
// the RPO monitor's system path (§7).
type Store struct{}

// NewStore constructs a Store. It holds no state.
func NewStore() *Store { return &Store{} }

const insertSampleSQL = `
INSERT INTO dr_replication_samples
    (tenant_id, stream_id, observed_at, lag_seconds, throughput_bps, applied_seq)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (tenant_id, stream_id, observed_at) DO NOTHING
RETURNING id, created_at`

// InsertSample appends a telemetry sample. It is idempotent on
// (tenant, stream, observed_at): a re-delivered progress sample returns
// inserted=false without erroring, so Kafka at-least-once delivery does not
// double-count the series.
func (s *Store) InsertSample(ctx context.Context, db repository.DBTX, sample Sample) (inserted bool, err error) {
	row := db.QueryRow(ctx, insertSampleSQL,
		sample.TenantID, sample.StreamID, sample.ObservedAt.UTC(),
		sample.LagSeconds, sample.ThroughputBPS, sample.AppliedSeq,
	)
	var id string
	var createdAt sql.NullTime
	if scanErr := row.Scan(&id, &createdAt); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			// ON CONFLICT DO NOTHING returned no row → duplicate sample.
			return false, nil
		}
		return false, fmt.Errorf("predict: inserting sample for stream %s: %w", sample.StreamID, scanErr)
	}
	return true, nil
}

const pruneSamplesSQL = `
DELETE FROM dr_replication_samples
WHERE tenant_id = $1 AND stream_id = $2
  AND observed_at < (
    SELECT min(observed_at) FROM (
        SELECT observed_at FROM dr_replication_samples
        WHERE tenant_id = $1 AND stream_id = $2
        ORDER BY observed_at DESC
        LIMIT $3
    ) keep
  )`

// PruneSamples keeps at most keep most-recent samples for a stream, deleting
// older points so the series stays bounded. It returns the number of rows
// pruned. keep <= 0 is a no-op.
func (s *Store) PruneSamples(ctx context.Context, db repository.DBTX, tenantID, streamID string, keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	tag, err := db.Exec(ctx, pruneSamplesSQL, tenantID, streamID, keep)
	if err != nil {
		return 0, fmt.Errorf("predict: pruning samples for stream %s: %w", streamID, err)
	}
	return tag.RowsAffected(), nil
}

const listSamplesSQL = `
SELECT id, tenant_id, stream_id, observed_at, lag_seconds, throughput_bps, applied_seq, created_at
FROM dr_replication_samples
WHERE tenant_id = $1 AND stream_id = $2
ORDER BY observed_at DESC
LIMIT $3`

// ListSamples returns up to limit most-recent samples for a stream (tenant
// scoped), newest first.
func (s *Store) ListSamples(ctx context.Context, db repository.DBTX, tenantID, streamID string, limit int) ([]Sample, error) {
	if limit <= 0 {
		limit = 256
	}
	rows, err := db.Query(ctx, listSamplesSQL, tenantID, streamID, limit)
	if err != nil {
		return nil, fmt.Errorf("predict: listing samples for stream %s: %w", streamID, err)
	}
	defer rows.Close()
	return scanSamples(rows)
}

// upsertPredictionSQL writes the latest forecast for a stream. The unique
// (tenant_id, stream_id) constraint makes this a true upsert so dr_predictions
// holds exactly one current row per stream.
const upsertPredictionSQL = `
INSERT INTO dr_predictions
    (tenant_id, stream_id, group_label, rpo_objective_seconds, smoothed_lag_seconds,
     lag_trend_slope, throughput_trend_slope, predicted_breach_seconds,
     breach_forecast, throughput_collapse, sample_count, forecast_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
ON CONFLICT (tenant_id, stream_id) DO UPDATE SET
    group_label = EXCLUDED.group_label,
    rpo_objective_seconds = EXCLUDED.rpo_objective_seconds,
    smoothed_lag_seconds = EXCLUDED.smoothed_lag_seconds,
    lag_trend_slope = EXCLUDED.lag_trend_slope,
    throughput_trend_slope = EXCLUDED.throughput_trend_slope,
    predicted_breach_seconds = EXCLUDED.predicted_breach_seconds,
    breach_forecast = EXCLUDED.breach_forecast,
    throughput_collapse = EXCLUDED.throughput_collapse,
    sample_count = EXCLUDED.sample_count,
    forecast_at = EXCLUDED.forecast_at,
    updated_at = now()
RETURNING id`

// UpsertPrediction persists (insert or update) the latest forecast for a
// stream and back-fills the row ID.
func (s *Store) UpsertPrediction(ctx context.Context, db repository.DBTX, p *Prediction) error {
	row := db.QueryRow(ctx, upsertPredictionSQL,
		p.TenantID, p.StreamID, p.GroupLabel, p.RPOObjectiveSeconds, p.SmoothedLagSeconds,
		p.LagTrendSlope, p.ThroughputTrendSlope, nullFloat(p.PredictedBreachSeconds),
		p.BreachForecast, p.ThroughputCollapse, p.SampleCount, p.ForecastAt.UTC(),
	)
	if err := row.Scan(&p.ID); err != nil {
		return fmt.Errorf("predict: upserting prediction for stream %s: %w", p.StreamID, err)
	}
	return nil
}

const getPredictionSQL = `
SELECT id, tenant_id, stream_id, group_label, rpo_objective_seconds, smoothed_lag_seconds,
       lag_trend_slope, throughput_trend_slope, predicted_breach_seconds,
       breach_forecast, throughput_collapse, sample_count, forecast_at, updated_at
FROM dr_predictions
WHERE tenant_id = $1 AND stream_id = $2`

// GetPrediction loads the current prediction for a stream (tenant scoped),
// returning ErrNotFound when none exists yet.
func (s *Store) GetPrediction(ctx context.Context, db repository.DBTX, tenantID, streamID string) (*Prediction, error) {
	row := db.QueryRow(ctx, getPredictionSQL, tenantID, streamID)
	p, err := scanPrediction(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("prediction for stream %s: %w", streamID, ErrNotFound)
		}
		return nil, fmt.Errorf("predict: getting prediction for stream %s: %w", streamID, err)
	}
	return p, nil
}

const listPredictionsSQL = `
SELECT id, tenant_id, stream_id, group_label, rpo_objective_seconds, smoothed_lag_seconds,
       lag_trend_slope, throughput_trend_slope, predicted_breach_seconds,
       breach_forecast, throughput_collapse, sample_count, forecast_at, updated_at
FROM dr_predictions
WHERE tenant_id = $1
ORDER BY breach_forecast DESC, predicted_breach_seconds ASC NULLS LAST, forecast_at DESC`

// ListPredictions returns all current predictions for a tenant, most-urgent
// first (active breach forecasts, then by ascending breach horizon).
func (s *Store) ListPredictions(ctx context.Context, db repository.DBTX, tenantID string) ([]*Prediction, error) {
	rows, err := db.Query(ctx, listPredictionsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("predict: listing predictions: %w", err)
	}
	defer rows.Close()
	return scanPredictions(rows)
}

// systemListStreamStatesSQL pulls every streaming/seeding/degraded stream
// ACROSS ALL TENANTS together with its site's RPO objective, group label, the
// previously-recorded prediction flags, and the rolling sample window — all in
// one query so the background loop can recompute every forecast without N+1
// round-trips. Samples are aggregated into arrays ordered by observed_at and
// trimmed to the most recent $1 per stream.
const systemListStreamStatesSQL = `
WITH recent AS (
    SELECT
        s.tenant_id,
        s.stream_id,
        s.observed_at,
        -- A game-day induce_lag fault sets a drill-scope simulated lag offset for
        -- the stream; the forecaster HONORS it by adding it to every sampled lag,
        -- so an induced lag genuinely raises the smoothed lag and can flip
        -- breach_forecast. Real streams have no marker (COALESCE → 0), so this is
        -- a no-op outside a game-day drill.
        s.lag_seconds + COALESCE(m.lag_seconds, 0) AS lag_seconds,
        s.throughput_bps,
        s.applied_seq,
        row_number() OVER (PARTITION BY s.tenant_id, s.stream_id ORDER BY s.observed_at DESC) AS rn
    FROM dr_replication_samples s
    LEFT JOIN dr_drill_lag_marker m ON m.stream_id = s.stream_id
),
windowed AS (
    SELECT tenant_id, stream_id, observed_at, lag_seconds, throughput_bps, applied_seq
    FROM recent
    WHERE rn <= $1
),
agg AS (
    SELECT
        tenant_id,
        stream_id,
        array_agg(observed_at ORDER BY observed_at) AS observed_at,
        array_agg(lag_seconds ORDER BY observed_at) AS lag_seconds,
        array_agg(throughput_bps ORDER BY observed_at) AS throughput_bps,
        array_agg(applied_seq ORDER BY observed_at) AS applied_seq
    FROM windowed
    GROUP BY tenant_id, stream_id
)
SELECT
    rs.tenant_id,
    rs.id AS stream_id,
    COALESCE(cg.name, ps.name) AS group_label,
    ps.rpo_objective_seconds,
    COALESCE(p.breach_forecast, false) AS prev_breach,
    COALESCE(p.throughput_collapse, false) AS prev_collapse,
    a.observed_at,
    a.lag_seconds,
    a.throughput_bps,
    a.applied_seq
FROM replication_stream rs
JOIN protected_site ps ON ps.id = rs.site_id AND ps.tenant_id = rs.tenant_id
JOIN agg a ON a.tenant_id = rs.tenant_id AND a.stream_id = rs.id
LEFT JOIN consistency_group_member cgm ON cgm.site_id = rs.site_id
LEFT JOIN consistency_group cg ON cg.id = cgm.group_id AND cg.tenant_id = rs.tenant_id
LEFT JOIN dr_predictions p ON p.tenant_id = rs.tenant_id AND p.stream_id = rs.id
WHERE rs.status IN ('seeding','streaming','degraded','error')`

// SystemListStreamStates returns the per-stream forecasting inputs ACROSS ALL
// TENANTS for the background loop, including up to sampleWindow most-recent
// samples per stream.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only
// the leader-singleton forecaster loop may call this; never the request path.
func (s *Store) SystemListStreamStates(ctx context.Context, db repository.DBTX, sampleWindow int) ([]StreamPredictionState, error) {
	if sampleWindow <= 0 {
		sampleWindow = 256
	}
	rows, err := db.Query(ctx, systemListStreamStatesSQL, sampleWindow)
	if err != nil {
		return nil, fmt.Errorf("predict: system listing stream states: %w", err)
	}
	defer rows.Close()

	var states []StreamPredictionState
	for rows.Next() {
		var st StreamPredictionState
		// array_agg over NOT NULL columns never yields NULL elements. Use
		// pgx's FlatArray representation so real pgx rows and pgxmock rows
		// exercise the same PostgreSQL-array decode path.
		var observedAt pgtype.FlatArray[time.Time]
		var lag, tput pgtype.FlatArray[float64]
		var appliedSeq pgtype.FlatArray[int64]
		if err := rows.Scan(
			&st.TenantID, &st.StreamID, &st.GroupLabel, &st.RPOObjectiveSeconds,
			&st.PrevBreachForecast, &st.PrevThroughputCollapse,
			&observedAt, &lag, &tput, &appliedSeq,
		); err != nil {
			return nil, fmt.Errorf("predict: scanning stream state: %w", err)
		}
		n := len(observedAt)
		st.Samples = make([]Sample, 0, n)
		for i := 0; i < n; i++ {
			smp := Sample{
				TenantID:   st.TenantID,
				StreamID:   st.StreamID,
				ObservedAt: observedAt[i],
			}
			if i < len(lag) {
				smp.LagSeconds = lag[i]
			}
			if i < len(tput) {
				smp.ThroughputBPS = tput[i]
			}
			if i < len(appliedSeq) {
				smp.AppliedSeq = appliedSeq[i]
			}
			st.Samples = append(st.Samples, smp)
		}
		states = append(states, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("predict: reading stream states: %w", err)
	}
	return states, nil
}

func scanSamples(rows pgx.Rows) ([]Sample, error) {
	var out []Sample
	for rows.Next() {
		var s Sample
		var createdAt sql.NullTime
		if err := rows.Scan(
			&s.ID, &s.TenantID, &s.StreamID, &s.ObservedAt,
			&s.LagSeconds, &s.ThroughputBPS, &s.AppliedSeq, &createdAt,
		); err != nil {
			return nil, fmt.Errorf("predict: scanning sample: %w", err)
		}
		if createdAt.Valid {
			s.CreatedAt = createdAt.Time
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("predict: reading samples: %w", err)
	}
	return out, nil
}

func scanPredictions(rows pgx.Rows) ([]*Prediction, error) {
	var out []*Prediction
	for rows.Next() {
		p, err := scanPrediction(rows)
		if err != nil {
			return nil, fmt.Errorf("predict: scanning prediction: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("predict: reading predictions: %w", err)
	}
	return out, nil
}

// scanner is the minimal Scan surface shared by pgx.Row and pgx.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanPrediction(row scanner) (*Prediction, error) {
	var p Prediction
	var breach sql.NullFloat64
	if err := row.Scan(
		&p.ID, &p.TenantID, &p.StreamID, &p.GroupLabel, &p.RPOObjectiveSeconds,
		&p.SmoothedLagSeconds, &p.LagTrendSlope, &p.ThroughputTrendSlope, &breach,
		&p.BreachForecast, &p.ThroughputCollapse, &p.SampleCount, &p.ForecastAt, &p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if breach.Valid {
		v := breach.Float64
		p.PredictedBreachSeconds = &v
	}
	return &p, nil
}

func nullFloat(v *float64) sql.NullFloat64 {
	if v == nil {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: *v, Valid: true}
}

// ---------------------------------------------------------------------------
// Drill-scope lag marker (dr_drill_lag_marker) — the game-day induce_lag fault.
// ---------------------------------------------------------------------------

// ErrStreamNotFound is returned when a lag marker is set for a stream that does
// not exist, so the game-day induce_lag fault fails honestly instead of recording
// a marker no forecast can ever observe.
var ErrStreamNotFound = errors.New("predict: replication stream not found")

// SystemSetLagMarker sets (or replaces) a drill-scope simulated lag offset for a
// stream. The forecaster's systemListStreamStatesSQL adds this offset to every
// sampled lag, so an induced lag genuinely raises the smoothed lag and can flip
// breach_forecast — the observable signal a game-day step polls for. The tenant
// is resolved from the stream row in the same statement so the caller need only
// supply the stream id. Returns ErrStreamNotFound when the stream does not exist.
//
// SYSTEM PATH — game-day orchestrator only (leader singleton); bypasses tenant
// RLS by design (§7), exactly like the forecaster loop that reads the marker.
func (s *Store) SystemSetLagMarker(ctx context.Context, db repository.DBTX, streamID string, lagSeconds float64) error {
	if lagSeconds < 0 {
		lagSeconds = 0
	}
	tag, err := db.Exec(ctx, `
		INSERT INTO dr_drill_lag_marker (stream_id, tenant_id, lag_seconds)
		SELECT rs.id, rs.tenant_id, $2
		  FROM replication_stream rs
		 WHERE rs.id = $1
		ON CONFLICT (stream_id) DO UPDATE
		   SET lag_seconds = EXCLUDED.lag_seconds, created_at = now()`,
		streamID, lagSeconds)
	if err != nil {
		return fmt.Errorf("predict: setting drill lag marker for stream %s: %w", streamID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("stream %s: %w", streamID, ErrStreamNotFound)
	}
	return nil
}

// SystemClearLagMarker removes a stream's drill-scope lag marker. It is the
// induce_lag fault's revert: idempotent (clearing an absent marker is a no-op) so
// the orchestrator's exactly-once teardown is always safe to run.
//
// SYSTEM PATH — game-day orchestrator only (leader singleton); bypasses tenant
// RLS by design (§7).
func (s *Store) SystemClearLagMarker(ctx context.Context, db repository.DBTX, streamID string) error {
	if _, err := db.Exec(ctx, `DELETE FROM dr_drill_lag_marker WHERE stream_id = $1`, streamID); err != nil {
		return fmt.Errorf("predict: clearing drill lag marker for stream %s: %w", streamID, err)
	}
	return nil
}
