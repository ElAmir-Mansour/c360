package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/service"
)

// streamRPORows is the column set GetStream scans.
var streamRPOCols = []string{
	"id", "tenant_id", "site_id", "status", "applied_seq",
	"source_lsn", "applied_at", "source_committed_at", "last_error", "created_at", "updated_at",
}

func TestGetStreamRPO_ComputesLiveRPOFromAppliedAt(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	streamID := uuid.New()
	siteID := uuid.NewString()
	now := time.Now().UTC()
	appliedAt := now.Add(-90 * time.Second)
	stager := &fakeStager{}
	svc, runner := newService(mock, stager)

	mock.ExpectQuery(`FROM replication_stream WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), streamID.String()).
		WillReturnRows(pgxmock.NewRows(streamRPOCols).AddRow(
			streamID.String(), tenantID.String(), siteID, model.StreamStatusStreaming,
			int64(42), "0/ABCD", appliedAt, nil, nil, now, now))

	rpo, err := svc.GetStreamRPO(context.Background(), tenantID, streamID)
	if err != nil {
		t.Fatalf("GetStreamRPO: %v", err)
	}
	if !rpo.HasData {
		t.Fatal("HasData = false, want true (applied_at present)")
	}
	// RPO = now - applied_at; allow a few seconds of test-execution drift.
	if rpo.RPOSeconds < 88 || rpo.RPOSeconds > 95 {
		t.Fatalf("RPOSeconds = %d, want ~90", rpo.RPOSeconds)
	}
	if rpo.LagSeconds != rpo.RPOSeconds {
		t.Fatalf("LagSeconds = %d, want == RPOSeconds %d", rpo.LagSeconds, rpo.RPOSeconds)
	}
	if rpo.AppliedSeq != 42 || rpo.StreamID != streamID.String() {
		t.Fatalf("rpo = %+v, want applied_seq 42 + stream id", rpo)
	}
	if len(runner.readTenants) != 1 || runner.readTenants[0] != tenantID {
		t.Fatalf("read tenants = %v, want [%s]", runner.readTenants, tenantID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetStreamRPO_SeedingStreamReportsNoData(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	streamID := uuid.New()
	siteID := uuid.NewString()
	now := time.Now().UTC()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	// applied_at NULL → still seeding, no data-loss window yet.
	mock.ExpectQuery(`FROM replication_stream WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), streamID.String()).
		WillReturnRows(pgxmock.NewRows(streamRPOCols).AddRow(
			streamID.String(), tenantID.String(), siteID, model.StreamStatusSeeding,
			int64(0), nil, nil, nil, nil, now, now))

	rpo, err := svc.GetStreamRPO(context.Background(), tenantID, streamID)
	if err != nil {
		t.Fatalf("GetStreamRPO: %v", err)
	}
	if rpo.HasData {
		t.Fatal("HasData = true, want false for a seeding stream")
	}
	if rpo.RPOSeconds != 0 {
		t.Fatalf("RPOSeconds = %d, want 0 when seeding", rpo.RPOSeconds)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPauseStream_SetsPausedAndStagesEvent(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	streamID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(mock, stager)

	mock.ExpectExec(`UPDATE replication_stream SET status`).
		WithArgs(tenantID.String(), streamID.String(), model.StreamStatusPaused).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := svc.PauseStream(context.Background(), tenantID, streamID); err != nil {
		t.Fatalf("PauseStream: %v", err)
	}
	if len(runner.writeTenants) != 1 || runner.writeTenants[0] != tenantID {
		t.Fatalf("write tenants = %v, want [%s]", runner.writeTenants, tenantID)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.stream.paused" {
		t.Fatalf("staged events = %+v, want dr.stream.paused", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResumeStream_ReturnsToPendingAndStagesEvent(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	streamID := uuid.New()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectExec(`UPDATE replication_stream SET status`).
		WithArgs(tenantID.String(), streamID.String(), model.StreamStatusPending).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := svc.ResumeStream(context.Background(), tenantID, streamID); err != nil {
		t.Fatalf("ResumeStream: %v", err)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.stream.resumed" {
		t.Fatalf("staged events = %+v, want dr.stream.resumed", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Compile-time assertion that the input type embeds correctly.
var _ = service.SealRecoveryPointInput{}
