package repository_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/repository"
)

const streamA = "11111111-1111-1111-1111-111111111111"

func TestAppendAppliedFrame_IdempotentReplay(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	repo := repository.New()
	now := time.Date(2026, 6, 13, 9, 30, 0, 0, time.UTC)
	payload := []byte("wal:insert:1")
	hash := sha256Hex(payload)

	mock.ExpectQuery(`INSERT INTO dr_applied_frame`).
		WithArgs(tenantA, streamA, int64(7), core.FrameKindWAL.String(), "0/16B6248", payload, hash, int64(len(payload)), now).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).
			AddRow("frame-1", now))

	got, err := repo.AppendAppliedFrame(context.Background(), mock, repository.AppendAppliedFrameInput{
		TenantID:      tenantA,
		StreamID:      streamA,
		Seq:           7,
		Kind:          core.FrameKindWAL.String(),
		SourceMarker:  "0/16B6248",
		Payload:       payload,
		PayloadSHA256: hash,
		PayloadBytes:  int64(len(payload)),
		AppliedAt:     now,
	})
	if err != nil {
		t.Fatalf("AppendAppliedFrame: %v", err)
	}
	if got.ID != "frame-1" || got.Seq != 7 || got.PayloadSHA256 != hash {
		t.Fatalf("unexpected frame: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAppendAppliedFrame_ConflictingReplay(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	repo := repository.New()
	now := time.Date(2026, 6, 13, 9, 31, 0, 0, time.UTC)
	payload := []byte("wal:conflict")
	hash := sha256Hex(payload)

	// ON CONFLICT ... DO UPDATE has a WHERE equality guard. If an existing seq
	// carries different bytes/metadata, PostgreSQL returns no row.
	mock.ExpectQuery(`INSERT INTO dr_applied_frame`).
		WithArgs(tenantA, streamA, int64(7), core.FrameKindWAL.String(), "0/16B6248", payload, hash, int64(len(payload)), now).
		WillReturnError(pgx.ErrNoRows)

	_, err := repo.AppendAppliedFrame(context.Background(), mock, repository.AppendAppliedFrameInput{
		TenantID:      tenantA,
		StreamID:      streamA,
		Seq:           7,
		Kind:          core.FrameKindWAL.String(),
		SourceMarker:  "0/16B6248",
		Payload:       payload,
		PayloadSHA256: hash,
		PayloadBytes:  int64(len(payload)),
		AppliedAt:     now,
	})
	if !errors.Is(err, repository.ErrFrameConflict) {
		t.Fatalf("got err %v, want ErrFrameConflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListContiguousAppliedFrames_TenantScoped(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	repo := repository.New()
	now := time.Date(2026, 6, 13, 9, 32, 0, 0, time.UTC)
	first := []byte("one")
	second := []byte("two")

	mock.ExpectQuery(`WITH ordered AS`).
		WithArgs(tenantA, streamA, int64(4)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "seq", "kind", "source_marker",
			"payload", "payload_sha256", "payload_bytes", "applied_at", "created_at",
		}).
			AddRow("frame-1", tenantA, streamA, int64(1), core.FrameKindWAL.String(), "0/1", first, sha256Hex(first), int64(len(first)), now, now).
			AddRow("frame-2", tenantA, streamA, int64(2), core.FrameKindWAL.String(), "0/2", second, sha256Hex(second), int64(len(second)), now.Add(time.Second), now))

	frames, err := repo.ListContiguousAppliedFrames(context.Background(), mock, tenantA, streamA, 4)
	if err != nil {
		t.Fatalf("ListContiguousAppliedFrames: %v", err)
	}
	if len(frames) != 2 {
		t.Fatalf("frames = %d, want 2", len(frames))
	}
	if frames[0].TenantID != tenantA || frames[0].StreamID != streamA {
		t.Fatalf("tenant/stream not scanned correctly: %+v", frames[0])
	}
	if string(frames[0].Payload)+string(frames[1].Payload) != "onetwo" {
		t.Fatalf("payload order mismatch: %+v", frames)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListAppliedFramesRange_ReturnsOrderedDelta(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	repo := repository.New()
	now := time.Date(2026, 6, 13, 9, 33, 0, 0, time.UTC)
	second := []byte("two")
	third := []byte("three")

	mock.ExpectQuery(`FROM dr_applied_frame`).
		WithArgs(tenantA, streamA, int64(1), int64(3)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "seq", "kind", "source_marker",
			"payload", "payload_sha256", "payload_bytes", "applied_at", "created_at",
		}).
			AddRow("frame-2", tenantA, streamA, int64(2), core.FrameKindWAL.String(), "0/2", second, sha256Hex(second), int64(len(second)), now, now).
			AddRow("frame-3", tenantA, streamA, int64(3), core.FrameKindWAL.String(), "0/3", third, sha256Hex(third), int64(len(third)), now.Add(time.Second), now))

	frames, err := repo.ListAppliedFramesRange(context.Background(), mock, tenantA, streamA, 1, 3)
	if err != nil {
		t.Fatalf("ListAppliedFramesRange: %v", err)
	}
	if len(frames) != 2 || frames[0].Seq != 2 || frames[1].Seq != 3 {
		t.Fatalf("frames = %+v, want seq 2,3", frames)
	}
	if string(frames[0].Payload)+string(frames[1].Payload) != "twothree" {
		t.Fatalf("payload order mismatch: %+v", frames)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
