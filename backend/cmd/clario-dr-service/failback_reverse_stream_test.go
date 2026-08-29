package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/failback"
	drmodel "github.com/clario360/platform/internal/dr/model"
	drrepo "github.com/clario360/platform/internal/dr/repository"
)

const (
	failbackTenantID = "11111111-1111-1111-1111-111111111111"
	failbackRunID    = "22222222-2222-2222-2222-222222222222"
	failbackGroupID  = "33333333-3333-3333-3333-333333333333"
	failbackFromSite = "44444444-4444-4444-4444-444444444444"
	failbackToSite   = "55555555-5555-5555-5555-555555555555"
	sourceStreamID   = "66666666-6666-6666-6666-666666666666"
	targetStreamID   = "77777777-7777-7777-7777-777777777777"
)

func TestSyncFailbackReverseStreamCopiesMissingFramesToTarget(t *testing.T) {
	t.Parallel()

	mock := newFailbackMock(t)
	repo := drrepo.New()
	store := failback.NewStore()
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	streamID := failbackReverseStreamID(failbackRunID)
	payload2 := []byte("reverse-frame-2")
	payload3 := []byte("reverse-frame-3")

	expectReverseRecord(mock, streamID, int64(3), int64(1), nil, nil, int64(24), false, failback.ReverseStreamStatusSyncing, now)
	expectStream(mock, sourceStreamID, failbackFromSite, drmodel.StreamStatusPaused, int64(3), "0/3", now)
	expectStream(mock, targetStreamID, failbackToSite, drmodel.StreamStatusPaused, int64(10), "0/1", now)
	mock.ExpectQuery(`FROM dr_applied_frame`).
		WithArgs(failbackTenantID, sourceStreamID, int64(1), int64(3)).
		WillReturnRows(appliedFrameRows().
			AddRow("frame-2", failbackTenantID, sourceStreamID, int64(2), core.FrameKindWAL.String(), "0/2", payload2, sha256HexLocal(payload2), int64(len(payload2)), now, now).
			AddRow("frame-3", failbackTenantID, sourceStreamID, int64(3), core.FrameKindWAL.String(), "0/3", payload3, sha256HexLocal(payload3), int64(len(payload3)), now.Add(time.Second), now))
	expectAppendFrame(mock, targetStreamID, int64(11), "0/2", payload2, now)
	expectAppendFrame(mock, targetStreamID, int64(12), "0/3", payload3, now)
	mock.ExpectExec(`UPDATE replication_stream`).
		WithArgs(failbackTenantID, targetStreamID, int64(12), "0/3", pgxmock.AnyArg(), drmodel.StreamStatusPaused, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(`UPDATE dr_failback_reverse_stream`).
		WithArgs(streamID, int64(3), int64(3), pgxmock.AnyArg(), pgxmock.AnyArg(), int64(0), true, failback.ReverseStreamStatusDrained, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := syncFailbackReverseStream(context.Background(), mock, repo, store, streamID); err != nil {
		t.Fatalf("syncFailbackReverseStream: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncFailbackReverseStreamFailsOnSourceFrameGap(t *testing.T) {
	t.Parallel()

	mock := newFailbackMock(t)
	repo := drrepo.New()
	store := failback.NewStore()
	now := time.Date(2026, 6, 13, 10, 1, 0, 0, time.UTC)
	streamID := failbackReverseStreamID(failbackRunID)
	payload3 := []byte("reverse-frame-3")

	expectReverseRecord(mock, streamID, int64(3), int64(1), nil, nil, int64(24), false, failback.ReverseStreamStatusSyncing, now)
	expectStream(mock, sourceStreamID, failbackFromSite, drmodel.StreamStatusPaused, int64(3), "0/3", now)
	expectStream(mock, targetStreamID, failbackToSite, drmodel.StreamStatusPaused, int64(10), "0/1", now)
	mock.ExpectQuery(`FROM dr_applied_frame`).
		WithArgs(failbackTenantID, sourceStreamID, int64(1), int64(3)).
		WillReturnRows(appliedFrameRows().
			AddRow("frame-3", failbackTenantID, sourceStreamID, int64(3), core.FrameKindWAL.String(), "0/3", payload3, sha256HexLocal(payload3), int64(len(payload3)), now, now))

	err := syncFailbackReverseStream(context.Background(), mock, repo, store, streamID)
	if !errors.Is(err, failback.ErrInvalidState) {
		t.Fatalf("error = %v, want ErrInvalidState", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func newFailbackMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func expectReverseRecord(mock pgxmock.PgxPoolIface, streamID string, headSeq, appliedSeq int64, headLSN, appliedLSN any, bytesPending int64, window bool, status string, now time.Time) {
	mock.ExpectQuery(`FROM dr_failback_reverse_stream WHERE stream_id`).
		WithArgs(streamID).
		WillReturnRows(pgxmock.NewRows([]string{
			"stream_id", "run_id", "tenant_id", "group_id", "from_site", "to_site",
			"source_stream_id", "target_stream_id", "head_seq", "applied_seq",
			"head_lsn", "applied_lsn", "bytes_pending", "cutover_window_open",
			"status", "last_error", "created_at", "updated_at",
		}).AddRow(
			streamID, failbackRunID, failbackTenantID, failbackGroupID, failbackFromSite, failbackToSite,
			sourceStreamID, targetStreamID, headSeq, appliedSeq, headLSN, appliedLSN,
			bytesPending, window, status, nil, now, now,
		))
}

func expectStream(mock pgxmock.PgxPoolIface, streamID, siteID, status string, appliedSeq int64, sourceLSN string, now time.Time) {
	mock.ExpectQuery(`FROM replication_stream WHERE tenant_id`).
		WithArgs(failbackTenantID, streamID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "site_id", "status", "applied_seq",
			"source_lsn", "applied_at", "source_committed_at", "last_error", "created_at", "updated_at",
		}).AddRow(streamID, failbackTenantID, siteID, status, appliedSeq, sourceLSN, now, nil, nil, now, now))
}

func appliedFrameRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "stream_id", "seq", "kind", "source_marker",
		"payload", "payload_sha256", "payload_bytes", "applied_at", "created_at",
	})
}

func expectAppendFrame(mock pgxmock.PgxPoolIface, streamID string, seq int64, marker string, payload []byte, createdAt time.Time) {
	mock.ExpectQuery(`INSERT INTO dr_applied_frame`).
		WithArgs(failbackTenantID, streamID, seq, core.FrameKindWAL.String(), marker, payload, sha256HexLocal(payload), int64(len(payload)), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("target-frame", createdAt))
}

func sha256HexLocal(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
