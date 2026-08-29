package predict

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	tenantA  = "aaaaaaaa-0000-0000-0000-000000000001"
	streamID = "11111111-1111-1111-1111-111111111111"
)

func newMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func TestInsertSample_Inserted(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`INSERT INTO dr_replication_samples`).
		WithArgs(tenantA, streamID, now, 42.0, 1_000_000.0, int64(7)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("sample-1", now))

	inserted, err := store.InsertSample(context.Background(), mock, Sample{
		TenantID: tenantA, StreamID: streamID, ObservedAt: now,
		LagSeconds: 42, ThroughputBPS: 1_000_000, AppliedSeq: 7,
	})
	if err != nil {
		t.Fatalf("InsertSample: %v", err)
	}
	if !inserted {
		t.Fatal("expected inserted=true for a fresh sample")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertSample_DuplicateIsNoOp(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	// ON CONFLICT DO NOTHING returns no row → pgx.ErrNoRows → inserted=false.
	mock.ExpectQuery(`INSERT INTO dr_replication_samples`).
		WithArgs(tenantA, streamID, now, 42.0, 1_000_000.0, int64(7)).
		WillReturnError(pgx.ErrNoRows)

	inserted, err := store.InsertSample(context.Background(), mock, Sample{
		TenantID: tenantA, StreamID: streamID, ObservedAt: now,
		LagSeconds: 42, ThroughputBPS: 1_000_000, AppliedSeq: 7,
	})
	if err != nil {
		t.Fatalf("InsertSample on duplicate must not error: %v", err)
	}
	if inserted {
		t.Fatal("expected inserted=false for a duplicate sample")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPruneSamples(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()

	mock.ExpectExec(`DELETE FROM dr_replication_samples`).
		WithArgs(tenantA, streamID, 100).
		WillReturnResult(pgxmock.NewResult("DELETE", 5))

	n, err := store.PruneSamples(context.Background(), mock, tenantA, streamID, 100)
	if err != nil {
		t.Fatalf("PruneSamples: %v", err)
	}
	if n != 5 {
		t.Fatalf("expected 5 pruned, got %d", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPruneSamples_ZeroKeepIsNoOp(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	n, err := store.PruneSamples(context.Background(), mock, tenantA, streamID, 0)
	if err != nil || n != 0 {
		t.Fatalf("keep<=0 must be a no-op, got n=%d err=%v", n, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpsertPrediction(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	horizon := 90.0

	mock.ExpectQuery(`INSERT INTO dr_predictions`).
		WithArgs(
			tenantA, streamID, "group-a", 300, 250.0,
			0.5, -10.0, sqlNullFloat(horizon),
			true, false, 12, now,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("pred-1"))

	p := &Prediction{
		TenantID: tenantA, StreamID: streamID, GroupLabel: "group-a",
		RPOObjectiveSeconds: 300, SmoothedLagSeconds: 250, LagTrendSlope: 0.5,
		ThroughputTrendSlope: -10, PredictedBreachSeconds: &horizon,
		BreachForecast: true, ThroughputCollapse: false, SampleCount: 12,
		ForecastAt: now,
	}
	if err := store.UpsertPrediction(context.Background(), mock, p); err != nil {
		t.Fatalf("UpsertPrediction: %v", err)
	}
	if p.ID != "pred-1" {
		t.Fatalf("ID not back-filled, got %q", p.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetPrediction_NotFound(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()

	mock.ExpectQuery(`SELECT id, tenant_id, stream_id`).
		WithArgs(tenantA, streamID).
		WillReturnError(pgx.ErrNoRows)

	_, err := store.GetPrediction(context.Background(), mock, tenantA, streamID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetPrediction_Found(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT id, tenant_id, stream_id`).
		WithArgs(tenantA, streamID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "group_label", "rpo_objective_seconds",
			"smoothed_lag_seconds", "lag_trend_slope", "throughput_trend_slope",
			"predicted_breach_seconds", "breach_forecast", "throughput_collapse",
			"sample_count", "forecast_at", "updated_at",
		}).AddRow(
			"pred-1", tenantA, streamID, "group-a", 300,
			250.0, 0.5, -10.0, 90.0, true, false, 12, now, now,
		))

	p, err := store.GetPrediction(context.Background(), mock, tenantA, streamID)
	if err != nil {
		t.Fatalf("GetPrediction: %v", err)
	}
	if p.ID != "pred-1" || !p.BreachForecast || p.PredictedBreachSeconds == nil || *p.PredictedBreachSeconds != 90 {
		t.Fatalf("unexpected prediction: %+v", p)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListPredictions(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT id, tenant_id, stream_id`).
		WithArgs(tenantA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "group_label", "rpo_objective_seconds",
			"smoothed_lag_seconds", "lag_trend_slope", "throughput_trend_slope",
			"predicted_breach_seconds", "breach_forecast", "throughput_collapse",
			"sample_count", "forecast_at", "updated_at",
		}).
			AddRow("p1", tenantA, "s1", "g1", 300, 250.0, 0.5, -10.0, 90.0, true, false, 12, now, now).
			AddRow("p2", tenantA, "s2", "g2", 300, 30.0, 0.0, 0.0, nil, false, false, 12, now, now))

	got, err := store.ListPredictions(context.Background(), mock, tenantA)
	if err != nil {
		t.Fatalf("ListPredictions: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 predictions, got %d", len(got))
	}
	if got[1].PredictedBreachSeconds != nil {
		t.Fatalf("second prediction should have a nil horizon (NULL), got %v", *got[1].PredictedBreachSeconds)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemListStreamStates_ScansSampleArrays(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()
	t0 := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	t1 := t0.Add(30 * time.Second)
	t2 := t0.Add(60 * time.Second)

	mock.ExpectQuery(`WITH recent AS`).
		WithArgs(256).
		WillReturnRows(pgxmock.NewRows([]string{
			"tenant_id", "stream_id", "group_label", "rpo_objective_seconds",
			"prev_breach", "prev_collapse",
			"observed_at", "lag_seconds", "throughput_bps", "applied_seq",
		}).AddRow(
			tenantA, streamID, "group-a", 300, false, false,
			pgtype.FlatArray[time.Time]{t0, t1, t2},
			pgtype.FlatArray[float64]{30, 40, 50},
			pgtype.FlatArray[float64]{1e6, 9e5, 8e5},
			pgtype.FlatArray[int64]{1, 2, 3},
		))

	states, err := store.SystemListStreamStates(context.Background(), mock, 256)
	if err != nil {
		t.Fatalf("SystemListStreamStates: %v", err)
	}
	if len(states) != 1 {
		t.Fatalf("expected 1 state, got %d", len(states))
	}
	st := states[0]
	if len(st.Samples) != 3 {
		t.Fatalf("expected 3 samples, got %d", len(st.Samples))
	}
	if st.Samples[0].LagSeconds != 30 || st.Samples[2].LagSeconds != 50 {
		t.Fatalf("lag values mis-scanned: %+v", st.Samples)
	}
	if !st.Samples[1].ObservedAt.Equal(t1) {
		t.Fatalf("observed_at mis-scanned: %v", st.Samples[1].ObservedAt)
	}
	if st.Samples[2].AppliedSeq != 3 {
		t.Fatalf("applied_seq mis-scanned: %d", st.Samples[2].AppliedSeq)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// sqlNullFloat mirrors store.nullFloat for argument matching in expectations.
func sqlNullFloat(v float64) sql.NullFloat64 {
	return sql.NullFloat64{Float64: v, Valid: true}
}

func TestSystemSetLagMarker_Set(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()

	mock.ExpectExec(`INSERT INTO dr_drill_lag_marker`).
		WithArgs(streamID, 600.0).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := store.SystemSetLagMarker(context.Background(), mock, streamID, 600); err != nil {
		t.Fatalf("SystemSetLagMarker: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemSetLagMarker_UnknownStream(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()

	// The INSERT ... SELECT FROM replication_stream affects 0 rows when the stream
	// does not exist → ErrStreamNotFound, so the induce_lag fault fails honestly.
	mock.ExpectExec(`INSERT INTO dr_drill_lag_marker`).
		WithArgs(streamID, 600.0).
		WillReturnResult(pgxmock.NewResult("INSERT", 0))

	err := store.SystemSetLagMarker(context.Background(), mock, streamID, 600)
	if !errors.Is(err, ErrStreamNotFound) {
		t.Fatalf("err = %v, want ErrStreamNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemSetLagMarker_ClampsNegative(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()

	// A negative induced lag is clamped to 0 (a marker never shortens lag).
	mock.ExpectExec(`INSERT INTO dr_drill_lag_marker`).
		WithArgs(streamID, 0.0).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := store.SystemSetLagMarker(context.Background(), mock, streamID, -5); err != nil {
		t.Fatalf("SystemSetLagMarker: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemClearLagMarker(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := NewStore()

	mock.ExpectExec(`DELETE FROM dr_drill_lag_marker WHERE stream_id = \$1`).
		WithArgs(streamID).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	if err := store.SystemClearLagMarker(context.Background(), mock, streamID); err != nil {
		t.Fatalf("SystemClearLagMarker: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
