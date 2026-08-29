// Package framestore persists the exact applied stream bytes used to build
// immutable recovery points. It is deliberately below the DR service layer:
// ingest/applier code can append frames here after a successful apply, and the
// recovery-point service can read a deterministic chunk through its ChunkSource
// interface without knowing the storage schema.
package framestore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

var (
	// ErrInvalidFrame is returned when a frame cannot be represented in the DB
	// backed store.
	ErrInvalidFrame = errors.New("framestore: invalid frame")
	// ErrNoContiguousFrames is returned when a stream claims applied bytes but
	// the store has no contiguous prefix beginning at seq=1.
	ErrNoContiguousFrames = errors.New("framestore: no contiguous applied frames")
	// ErrIncompleteContiguousFrames is returned when the store has a contiguous
	// prefix, but it does not reach the stream's durable applied checkpoint.
	ErrIncompleteContiguousFrames = errors.New("framestore: incomplete contiguous applied frames")
)

// Repository is the narrow repository surface used by Store.
type Repository interface {
	AppendAppliedFrame(ctx context.Context, db repository.DBTX, in repository.AppendAppliedFrameInput) (*repository.AppliedFrame, error)
	ListContiguousAppliedFrames(ctx context.Context, db repository.DBTX, tenantID, streamID string, throughSeq int64) ([]repository.AppliedFrame, error)
}

// Store is the DB-backed durable applied-frame store.
type Store struct {
	repo Repository
	db   repository.DBTX
	now  func() time.Time
}

// Option configures Store.
type Option func(*Store)

// WithClock overrides the apply timestamp source, primarily for deterministic
// tests.
func WithClock(now func() time.Time) Option {
	return func(s *Store) {
		if now != nil {
			s.now = now
		}
	}
}

// New constructs a Store over a repository and pgx execution context.
func New(repo Repository, db repository.DBTX, opts ...Option) *Store {
	s := &Store{repo: repo, db: db, now: func() time.Time { return time.Now().UTC() }}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// AppendFrame records a frame after it has been successfully applied to the
// recovery target. Replays of the same frame are idempotent in the repository;
// replays with different bytes fail with repository.ErrFrameConflict.
func (s *Store) AppendFrame(ctx context.Context, tenantID uuid.UUID, frame core.Frame) (*repository.AppliedFrame, error) {
	if s == nil || s.repo == nil {
		return nil, errors.New("framestore: repository is required")
	}
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidFrame)
	}
	if frame.StreamID == "" {
		return nil, fmt.Errorf("%w: stream id is required", ErrInvalidFrame)
	}
	if frame.Seq == 0 || frame.Seq > math.MaxInt64 {
		return nil, fmt.Errorf("%w: seq %d cannot be stored", ErrInvalidFrame, frame.Seq)
	}
	if !frame.Kind.Valid() {
		return nil, fmt.Errorf("%w: frame kind %d is invalid", ErrInvalidFrame, frame.Kind)
	}

	payload := append([]byte{}, frame.Payload...)
	sum := sha256.Sum256(payload)
	return s.repo.AppendAppliedFrame(ctx, s.db, repository.AppendAppliedFrameInput{
		TenantID:      tenantID.String(),
		StreamID:      frame.StreamID,
		Seq:           int64(frame.Seq),
		Kind:          frame.Kind.String(),
		SourceMarker:  frame.SourceLSN,
		Payload:       payload,
		PayloadSHA256: hex.EncodeToString(sum[:]),
		PayloadBytes:  int64(len(payload)),
		AppliedAt:     s.now(),
	})
}

// Manifest describes the exact contiguous bytes returned for recovery-point
// sealing.
type Manifest struct {
	TenantID      string
	StreamID      string
	FromSeq       uint64
	ThroughSeq    uint64
	FrameCount    int
	PayloadBytes  int64
	PayloadSHA256 string
	SourceMarker  string
	AppliedAt     time.Time
	Frames        []ManifestFrame
}

// ManifestFrame is the per-frame digest metadata in a Manifest.
type ManifestFrame struct {
	Seq           uint64
	Kind          string
	SourceMarker  string
	PayloadSHA256 string
	PayloadBytes  int64
	AppliedAt     time.Time
}

// Chunk is the actual byte stream to seal plus its deterministic manifest.
type Chunk struct {
	Reader   io.Reader
	Manifest Manifest
}

// LatestContiguous returns the actual applied payload bytes for streamID from
// seq=1 through the latest contiguous frame not greater than throughSeq.
func (s *Store) LatestContiguous(ctx context.Context, tenantID uuid.UUID, streamID string, throughSeq uint64) (*Chunk, error) {
	if s == nil || s.repo == nil {
		return nil, errors.New("framestore: repository is required")
	}
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidFrame)
	}
	if streamID == "" {
		return nil, fmt.Errorf("%w: stream id is required", ErrInvalidFrame)
	}
	if throughSeq > math.MaxInt64 {
		return nil, fmt.Errorf("%w: through seq %d cannot be stored", ErrInvalidFrame, throughSeq)
	}

	rows, err := s.repo.ListContiguousAppliedFrames(ctx, s.db, tenantID.String(), streamID, int64(throughSeq))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		if throughSeq == 0 {
			empty := sha256.Sum256(nil)
			return &Chunk{
				Reader: bytes.NewReader(nil),
				Manifest: Manifest{
					TenantID:      tenantID.String(),
					StreamID:      streamID,
					PayloadSHA256: hex.EncodeToString(empty[:]),
				},
			}, nil
		}
		return nil, fmt.Errorf("%w: stream %s through seq %d", ErrNoContiguousFrames, streamID, throughSeq)
	}

	var payload bytes.Buffer
	hash := sha256.New()
	manifest := Manifest{
		TenantID:   tenantID.String(),
		StreamID:   streamID,
		FromSeq:    uint64(rows[0].Seq),
		FrameCount: len(rows),
		Frames:     make([]ManifestFrame, 0, len(rows)),
	}
	for _, row := range rows {
		payload.Write(row.Payload)
		hash.Write(row.Payload)
		manifest.ThroughSeq = uint64(row.Seq)
		manifest.PayloadBytes += row.PayloadBytes
		if row.SourceMarker != "" {
			manifest.SourceMarker = row.SourceMarker
		}
		if !row.AppliedAt.IsZero() {
			manifest.AppliedAt = row.AppliedAt
		}
		manifest.Frames = append(manifest.Frames, ManifestFrame{
			Seq:           uint64(row.Seq),
			Kind:          row.Kind,
			SourceMarker:  row.SourceMarker,
			PayloadSHA256: row.PayloadSHA256,
			PayloadBytes:  row.PayloadBytes,
			AppliedAt:     row.AppliedAt,
		})
	}
	manifest.PayloadSHA256 = hex.EncodeToString(hash.Sum(nil))

	return &Chunk{
		Reader:   bytes.NewReader(payload.Bytes()),
		Manifest: manifest,
	}, nil
}

// Chunk implements the DR service's ChunkSource shape. It returns the exact
// contiguous applied bytes through stream.AppliedSeq, the source marker from the
// manifest, and the applied wall-clock for achieved-RPO computation.
func (s *Store) Chunk(ctx context.Context, tenantID uuid.UUID, stream *model.ReplicationStream) (io.Reader, string, time.Time, error) {
	if stream == nil {
		return nil, "", time.Time{}, fmt.Errorf("%w: stream is required", ErrInvalidFrame)
	}
	if stream.AppliedSeq < 0 {
		return nil, "", time.Time{}, fmt.Errorf("%w: negative applied seq %d", ErrInvalidFrame, stream.AppliedSeq)
	}
	chunk, err := s.LatestContiguous(ctx, tenantID, stream.ID, uint64(stream.AppliedSeq))
	if err != nil {
		return nil, "", time.Time{}, err
	}
	if stream.AppliedSeq > 0 && chunk.Manifest.ThroughSeq != uint64(stream.AppliedSeq) {
		return nil, "", time.Time{}, fmt.Errorf("%w: stream %s checkpoint seq %d has durable contiguous frames through seq %d",
			ErrIncompleteContiguousFrames, stream.ID, stream.AppliedSeq, chunk.Manifest.ThroughSeq)
	}
	return chunk.Reader, chunk.Manifest.SourceMarker, chunk.Manifest.AppliedAt, nil
}
