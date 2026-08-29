package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/journal"
	"github.com/clario360/platform/internal/dr/model"
)

// JournalResolver is the CDP journal resolve surface used by the DR service.
type JournalResolver interface {
	Resolve(ctx context.Context, tenantID, streamID uuid.UUID, req journal.ResolveRequest) (*journal.Resolution, error)
}

type journalDeps struct {
	resolver JournalResolver
	replayer *journal.Replayer
}

// WithJournal wires the CDP journal materialization path onto the service. The
// resolver identifies the segment set and cut; the replayer reads segment bytes
// and materializes a stream chunk for normal recovery-point sealing.
func (s *Service) WithJournal(resolver JournalResolver, replayer *journal.Replayer) *Service {
	if resolver != nil && replayer != nil {
		s.journal = &journalDeps{resolver: resolver, replayer: replayer}
	}
	return s
}

// JournalTargetInput names a point-in-time journal restore target. Exactly one
// of At, LSN or Seq must be set.
type JournalTargetInput struct {
	At  *time.Time `json:"at,omitempty"`
	LSN string     `json:"lsn,omitempty"`
	Seq *int64     `json:"seq,omitempty"`
}

func (in JournalTargetInput) resolveRequest() (journal.ResolveRequest, error) {
	set := 0
	var req journal.ResolveRequest
	if in.At != nil {
		at := in.At.UTC()
		req.At = &at
		set++
	}
	if in.LSN != "" {
		req.LSN = in.LSN
		set++
	}
	if in.Seq != nil {
		if *in.Seq <= 0 {
			return req, invalid("journal_target.seq", "must be a positive integer")
		}
		seq := *in.Seq
		req.Seq = &seq
		set++
	}
	if set != 1 {
		return req, invalid("journal_target", "exactly one of at, lsn, seq is required")
	}
	return req, nil
}

// MaterializeJournalRecoveryPointInput seals a synthetic recovery point from
// replayed journal bytes instead of the latest applied stream head.
type MaterializeJournalRecoveryPointInput struct {
	Target         JournalTargetInput
	RetentionUntil time.Time
}

// MaterializeJournalRecoveryPoint resolves every member stream in groupID to
// the same journal target, replays those segments to exact per-frame cuts, and
// seals the reconstructed bytes through the normal WORM recovery-point path.
func (s *Service) MaterializeJournalRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in MaterializeJournalRecoveryPointInput) (*model.RecoveryPoint, error) {
	if s.journal == nil || s.journal.resolver == nil || s.journal.replayer == nil {
		return nil, fmt.Errorf("%w: journal materializer", ErrNotConfigured)
	}
	req, err := in.Target.resolveRequest()
	if err != nil {
		return nil, err
	}
	chunks := JournalChunkSource{
		Resolver: s.journal.resolver,
		Replayer: s.journal.replayer,
		Target:   req,
	}
	return s.sealRecoveryPointWithChunks(ctx, tenantID, groupID, SealRecoveryPointInput{
		RetentionUntil: in.RetentionUntil,
	}, chunks)
}

// JournalChunkSource adapts a journal resolution+replay into the ChunkSource
// contract used by recovery-point sealing.
type JournalChunkSource struct {
	Resolver JournalResolver
	Replayer *journal.Replayer
	Target   journal.ResolveRequest
}

// Chunk materializes stream as of Target and returns the replayed bytes plus the
// actual marker and last frame timestamp reached by the replay executor.
func (s JournalChunkSource) Chunk(ctx context.Context, tenantID uuid.UUID, stream *model.ReplicationStream) (io.Reader, string, time.Time, error) {
	if s.Resolver == nil || s.Replayer == nil {
		return nil, "", time.Time{}, fmt.Errorf("%w: journal chunk source", ErrNotConfigured)
	}
	if stream == nil {
		return nil, "", time.Time{}, invalid("stream", "stream is required")
	}
	streamID, err := uuid.Parse(stream.ID)
	if err != nil {
		return nil, "", time.Time{}, invalid("stream_id", "stream id must be a UUID")
	}
	res, err := s.Resolver.Resolve(ctx, tenantID, streamID, s.Target)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	var buf bytes.Buffer
	replayed, err := s.Replayer.Replay(ctx, tenantID, res, &buf)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	marker := replayed.LastLSN
	if marker == "" {
		marker = res.CutLSN
	}
	lastCommit := replayed.LastAt
	if lastCommit.IsZero() {
		lastCommit = res.CutTS
	}
	return bytes.NewReader(buf.Bytes()), marker, lastCommit, nil
}
