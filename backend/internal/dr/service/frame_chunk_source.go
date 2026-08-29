package service

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/framestore"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// AppliedFrameChunkSource seals the actual durable applied frame bytes for a
// stream. It runs the frame read through the service's tenant-scoped read path,
// so dr_applied_frame RLS is active just like every other request-path query.
type AppliedFrameChunkSource struct {
	tx   TenantRunner
	repo framestore.Repository
}

// NewAppliedFrameChunkSource constructs a production ChunkSource over the
// durable applied-frame store.
func NewAppliedFrameChunkSource(tx TenantRunner, repo framestore.Repository) AppliedFrameChunkSource {
	return AppliedFrameChunkSource{tx: tx, repo: repo}
}

// AppliedFrameChunkSource returns a ChunkSource bound to this Service's
// tenant-scoped runner.
func (s *Service) AppliedFrameChunkSource(repo framestore.Repository) AppliedFrameChunkSource {
	return NewAppliedFrameChunkSource(s.tx, repo)
}

// Chunk returns the exact contiguous applied bytes through stream.AppliedSeq.
func (s AppliedFrameChunkSource) Chunk(ctx context.Context, tenantID uuid.UUID, stream *model.ReplicationStream) (io.Reader, string, time.Time, error) {
	if s.tx == nil || s.repo == nil {
		return nil, "", time.Time{}, fmt.Errorf("%w: applied frame chunk source", ErrNotConfigured)
	}
	if stream == nil {
		return nil, "", time.Time{}, invalid("stream", "stream is required")
	}
	if stream.AppliedSeq < 0 {
		return nil, "", time.Time{}, invalid("applied_seq", "applied seq must not be negative")
	}

	var chunk *framestore.Chunk
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		store := framestore.New(s.repo, tx)
		var err error
		chunk, err = store.LatestContiguous(ctx, tenantID, stream.ID, uint64(stream.AppliedSeq))
		if err != nil {
			return err
		}
		if stream.AppliedSeq > 0 && chunk.Manifest.ThroughSeq != uint64(stream.AppliedSeq) {
			return fmt.Errorf("%w: stream %s checkpoint seq %d has durable contiguous frames through seq %d",
				framestore.ErrIncompleteContiguousFrames, stream.ID, stream.AppliedSeq, chunk.Manifest.ThroughSeq)
		}
		return err
	}); err != nil {
		return nil, "", time.Time{}, err
	}
	return chunk.Reader, chunk.Manifest.SourceMarker, chunk.Manifest.AppliedAt, nil
}
