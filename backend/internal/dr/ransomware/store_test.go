package ransomware

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	storeTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	storeStream = "cccccccc-0000-0000-0000-000000000001"
)

func newStoreMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func TestStore_UpsertBaseline(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()

	mock.ExpectExec(`INSERT INTO dr_ransomware_baselines`).
		WithArgs(storeTenant, storeStream, 1024.0, 16.0, 4.0, 0.5, 6.5, 0.1, int64(12)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := s.UpsertBaseline(context.Background(), mock, Baseline{
		TenantID:       storeTenant,
		StreamID:       storeStream,
		ByteRateMean:   1024,
		ByteRateVar:    16,
		ChangeRateMean: 4,
		ChangeRateVar:  0.5,
		EntropyMean:    6.5,
		EntropyVar:     0.1,
		Samples:        12,
	})
	if err != nil {
		t.Fatalf("UpsertBaseline: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_UpsertBaseline_RequiresIDs(t *testing.T) {
	t.Parallel()
	s := NewStore()
	if err := s.UpsertBaseline(context.Background(), newStoreMock(t), Baseline{StreamID: storeStream}); err == nil {
		t.Fatal("expected an error when tenant_id is empty")
	}
}

func TestStore_GetBaseline_Found(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	now := time.Date(2026, 6, 13, 9, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT tenant_id, stream_id, byte_rate_mean`).
		WithArgs(storeTenant, storeStream).
		WillReturnRows(pgxmock.NewRows([]string{
			"tenant_id", "stream_id", "byte_rate_mean", "byte_rate_var",
			"change_rate_mean", "change_rate_var", "entropy_mean", "entropy_var", "samples", "updated_at",
		}).AddRow(storeTenant, storeStream, 2048.0, 4.0, 8.0, 1.0, 7.0, 0.2, int64(9), now))

	b, ok, err := s.GetBaseline(context.Background(), mock, storeTenant, storeStream)
	if err != nil {
		t.Fatalf("GetBaseline: %v", err)
	}
	if !ok {
		t.Fatal("expected ok=true")
	}
	if b.ByteRateMean != 2048 || b.EntropyMean != 7.0 || b.Samples != 9 {
		t.Fatalf("unexpected baseline: %+v", b)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_GetBaseline_NotFound(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()

	mock.ExpectQuery(`SELECT tenant_id, stream_id, byte_rate_mean`).
		WithArgs(storeTenant, storeStream).
		WillReturnError(pgx.ErrNoRows)

	_, ok, err := s.GetBaseline(context.Background(), mock, storeTenant, storeStream)
	if err != nil {
		t.Fatalf("GetBaseline should not error on no rows: %v", err)
	}
	if ok {
		t.Fatal("expected ok=false when no baseline exists")
	}
}

func TestStore_InsertSignal(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	created := now.Add(time.Millisecond)

	mock.ExpectQuery(`INSERT INTO dr_ransomware_signals`).
		WithArgs(
			storeTenant, storeStream, SignalEntropy, SeverityConfirmed,
			7.9, 6.0, 0.0, 7.5, int64(42), "0/ABC", "rp-clean",
			"bulk-encryption", now,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("sig-1", created))

	sig := &Signal{
		TenantID:               storeTenant,
		StreamID:               storeStream,
		Kind:                   SignalEntropy,
		Severity:               SeverityConfirmed,
		Observed:               7.9,
		Baseline:               6.0,
		Ratio:                  0,
		Threshold:              7.5,
		SampleSeq:              42,
		SourceLSN:              "0/ABC",
		CuratedRecoveryPointID: "rp-clean",
		Detail:                 "bulk-encryption",
		ObservedAt:             now,
	}
	if err := s.InsertSignal(context.Background(), mock, sig); err != nil {
		t.Fatalf("InsertSignal: %v", err)
	}
	if sig.ID != "sig-1" || !sig.CreatedAt.Equal(created) {
		t.Fatalf("generated fields not populated: %+v", sig)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_InsertSignal_NullsOptionalFields(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	now := time.Date(2026, 6, 13, 10, 5, 0, 0, time.UTC)

	// Empty source_lsn and curated id must be inserted as SQL NULL, not "".
	mock.ExpectQuery(`INSERT INTO dr_ransomware_signals`).
		WithArgs(
			storeTenant, storeStream, SignalByteRate, SeverityWarning,
			500000.0, 1000.0, 500.0, 5.0, int64(0), nil, nil, "spike", now,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("sig-2", now))

	sig := &Signal{
		TenantID:   storeTenant,
		StreamID:   storeStream,
		Kind:       SignalByteRate,
		Severity:   SeverityWarning,
		Observed:   500000,
		Baseline:   1000,
		Ratio:      500,
		Threshold:  5,
		Detail:     "spike",
		ObservedAt: now,
	}
	if err := s.InsertSignal(context.Background(), mock, sig); err != nil {
		t.Fatalf("InsertSignal: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_InsertSignal_RejectsInvalidKind(t *testing.T) {
	t.Parallel()
	s := NewStore()
	err := s.InsertSignal(context.Background(), newStoreMock(t), &Signal{
		TenantID: storeTenant, StreamID: storeStream, Kind: "bogus",
	})
	if err == nil {
		t.Fatal("expected an error for an invalid signal kind")
	}
}

func TestStore_ListSignals(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	now := time.Date(2026, 6, 13, 11, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT id, tenant_id, stream_id, signal_kind`).
		WithArgs(storeTenant, 100).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "signal_kind", "severity", "observed", "baseline",
			"ratio", "threshold", "sample_seq", "source_lsn", "curated_recovery_point_id",
			"detail", "observed_at", "created_at",
		}).
			AddRow("sig-1", storeTenant, storeStream, SignalEntropy, SeverityConfirmed, 7.9, 6.0, 0.0, 7.5, int64(42), "0/ABC", "rp-clean", "d1", now, now).
			AddRow("sig-2", storeTenant, storeStream, SignalByteRate, SeverityWarning, 1e6, 1000.0, 1000.0, 5.0, int64(0), nil, nil, "d2", now, now))

	got, err := s.ListSignals(context.Background(), mock, storeTenant, 0) // 0 -> default 100
	if err != nil {
		t.Fatalf("ListSignals: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d signals, want 2", len(got))
	}
	if got[0].CuratedRecoveryPointID != "rp-clean" || got[0].SampleSeq != 42 {
		t.Fatalf("row 0 scan wrong: %+v", got[0])
	}
	// Row 2 has NULL source_lsn / curated id -> empty strings, not crash.
	if got[1].SourceLSN != "" || got[1].CuratedRecoveryPointID != "" {
		t.Fatalf("row 1 nulls not handled: %+v", got[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemLatestCleanRecoveryPoint_Found(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	cutoff := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	sealed := cutoff.Add(-10 * time.Minute)

	mock.ExpectQuery(`SELECT id, group_id, marker_lsn, sealed_at, object_keys`).
		WithArgs(storeTenant, cutoff).
		WillReturnRows(pgxmock.NewRows([]string{"id", "group_id", "marker_lsn", "sealed_at", "object_keys"}).
			AddRow("rp-clean", "g1", "0/CLEAN", sealed, []byte(`{"s1":"k1"}`)))

	cp, err := s.SystemLatestCleanRecoveryPoint(context.Background(), mock, storeTenant, cutoff)
	if err != nil {
		t.Fatalf("SystemLatestCleanRecoveryPoint: %v", err)
	}
	if cp.ID != "rp-clean" || cp.GroupID != "g1" || string(cp.ObjectKeys) != `{"s1":"k1"}` {
		t.Fatalf("unexpected clean point: %+v", cp)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemLatestCleanRecoveryPoint_None(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	cutoff := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT id, group_id, marker_lsn, sealed_at, object_keys`).
		WithArgs(storeTenant, cutoff).
		WillReturnError(pgx.ErrNoRows)

	_, err := s.SystemLatestCleanRecoveryPoint(context.Background(), mock, storeTenant, cutoff)
	if !errors.Is(err, ErrNoCleanPoint) {
		t.Fatalf("got %v, want ErrNoCleanPoint", err)
	}
}

func TestStore_SystemPinCleanRecoveryPoint(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()

	mock.ExpectExec(`UPDATE recovery_point SET legal_hold = true`).
		WithArgs(storeTenant, "rp-clean").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	ok, err := s.SystemPinCleanRecoveryPoint(context.Background(), mock, storeTenant, "rp-clean")
	if err != nil {
		t.Fatalf("SystemPinCleanRecoveryPoint: %v", err)
	}
	if !ok {
		t.Fatal("expected ok=true when a row was updated")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemPinCleanRecoveryPoint_NoRow(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()

	mock.ExpectExec(`UPDATE recovery_point SET legal_hold = true`).
		WithArgs(storeTenant, "missing").
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	ok, err := s.SystemPinCleanRecoveryPoint(context.Background(), mock, storeTenant, "missing")
	if err != nil {
		t.Fatalf("SystemPinCleanRecoveryPoint: %v", err)
	}
	if ok {
		t.Fatal("expected ok=false when no row matched")
	}
}

func TestStore_SystemListBaselines(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	now := time.Date(2026, 6, 13, 8, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT tenant_id, stream_id, byte_rate_mean(.|\n)*ORDER BY stream_id`).
		WillReturnRows(pgxmock.NewRows([]string{
			"tenant_id", "stream_id", "byte_rate_mean", "byte_rate_var",
			"change_rate_mean", "change_rate_var", "entropy_mean", "entropy_var", "samples", "updated_at",
		}).
			AddRow(storeTenant, storeStream, 100.0, 1.0, 2.0, 0.1, 5.0, 0.0, int64(3), now))

	out, err := s.SystemListBaselines(context.Background(), mock)
	if err != nil {
		t.Fatalf("SystemListBaselines: %v", err)
	}
	if len(out) != 1 || out[0].StreamID != storeStream || out[0].Samples != 3 {
		t.Fatalf("unexpected baselines: %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
