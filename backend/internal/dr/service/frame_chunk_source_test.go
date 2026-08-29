package service_test

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/framestore"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/service"
)

func TestAppliedFrameChunkSourceReturnsDurableAppliedBytes(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	streamID := uuid.NewString()
	appliedAt := time.Date(2026, 6, 13, 12, 30, 0, 0, time.UTC)
	frameRepo := &fakeAppliedFrameRepo{
		frames: []repository.AppliedFrame{
			{Seq: 1, Kind: "FILE_DELTA", SourceMarker: "0/1", Payload: []byte("frame-1"), PayloadBytes: 7, AppliedAt: appliedAt.Add(-time.Second)},
			{Seq: 2, Kind: "FILE_DELTA", SourceMarker: "0/2", Payload: []byte("frame-2"), PayloadBytes: 7, AppliedAt: appliedAt},
		},
	}
	runner := &fakeRunner{}
	source := service.NewAppliedFrameChunkSource(runner, frameRepo)

	reader, marker, commit, err := source.Chunk(context.Background(), tenantID, &model.ReplicationStream{
		ID:         streamID,
		TenantID:   tenantID.String(),
		AppliedSeq: 2,
	})
	if err != nil {
		t.Fatalf("Chunk: %v", err)
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read chunk: %v", err)
	}
	if string(data) != "frame-1frame-2" {
		t.Fatalf("chunk bytes = %q, want applied frame payload bytes", data)
	}
	if marker != "0/2" {
		t.Fatalf("marker = %q, want 0/2", marker)
	}
	if !commit.Equal(appliedAt) {
		t.Fatalf("commit = %s, want %s", commit, appliedAt)
	}
	if frameRepo.tenantID != tenantID.String() || frameRepo.streamID != streamID || frameRepo.throughSeq != 2 {
		t.Fatalf("repo args tenant=%s stream=%s through=%d", frameRepo.tenantID, frameRepo.streamID, frameRepo.throughSeq)
	}
	if len(runner.readTenants) != 1 || runner.readTenants[0] != tenantID {
		t.Fatalf("read tenants = %v, want [%s]", runner.readTenants, tenantID)
	}
}

func TestAppliedFrameChunkSourceErrorsWhenFramesLagCheckpoint(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	streamID := uuid.NewString()
	appliedAt := time.Date(2026, 6, 13, 12, 35, 0, 0, time.UTC)
	frameRepo := &fakeAppliedFrameRepo{
		frames: []repository.AppliedFrame{
			{Seq: 1, Kind: "FILE_DELTA", SourceMarker: "0/1", Payload: []byte("frame-1"), PayloadBytes: 7, AppliedAt: appliedAt},
		},
	}
	runner := &fakeRunner{}
	source := service.NewAppliedFrameChunkSource(runner, frameRepo)

	_, _, _, err := source.Chunk(context.Background(), tenantID, &model.ReplicationStream{
		ID:         streamID,
		TenantID:   tenantID.String(),
		AppliedSeq: 2,
	})
	if !errors.Is(err, framestore.ErrIncompleteContiguousFrames) {
		t.Fatalf("got err %v, want ErrIncompleteContiguousFrames", err)
	}
	if frameRepo.throughSeq != 2 {
		t.Fatalf("through seq = %d, want 2", frameRepo.throughSeq)
	}
}

type fakeAppliedFrameRepo struct {
	frames     []repository.AppliedFrame
	tenantID   string
	streamID   string
	throughSeq int64
}

func (r *fakeAppliedFrameRepo) AppendAppliedFrame(context.Context, repository.DBTX, repository.AppendAppliedFrameInput) (*repository.AppliedFrame, error) {
	return nil, errors.New("AppendAppliedFrame should not be called")
}

func (r *fakeAppliedFrameRepo) ListContiguousAppliedFrames(_ context.Context, _ repository.DBTX, tenantID, streamID string, throughSeq int64) ([]repository.AppliedFrame, error) {
	r.tenantID = tenantID
	r.streamID = streamID
	r.throughSeq = throughSeq
	return r.frames, nil
}
